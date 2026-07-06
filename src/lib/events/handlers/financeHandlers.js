import { supabase } from '../../supabase.js'
import { hasActiveRule } from '../../accounting/postingEngine.js'
import { logger } from '../../logger.js'

/**
 * Finance event handlers.
 * Subscribes to cross-module events that produce financial records (AR, AP, JE).
 *
 * F-A2 起：傳票（JE）改由規則表驅動的 postingHandlers 產生。
 * 本檔硬寫科目的 JE 段落改為「讓位」— 若該單據類型有啟用中的 posting_rules
 * （全域種子預設啟用），legacy 路徑跳過 JE，避免與規則引擎雙重入帳。
 * AR / AP 單據建立不受影響。
 */
export function registerFinanceHandlers(bus) {
  // ── WMS shipment completed → create AR + journal entry ──
  bus.subscribe('wms.shipment.completed', async function onShipmentCompleted(event) {
    const { customer, order_ref, total_amount, shipment_id } = event.payload
    const invoiceNumber = `INV-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`

    const { data: ar, error: arError } = await supabase.from('accounts_receivable').insert({
      invoice_number: invoiceNumber,
      customer,
      order_ref: order_ref || shipment_id,
      amount: total_amount,
      paid_amount: 0,
      due_date: getDueDate(30),
      status: '未收款',
      // 事件 metadata 帶 org 時顯式寫入（無則由 DB trigger set_org_default 補）
      ...(event.metadata?.organization_id ? { organization_id: event.metadata.organization_id } : {}),
    }).select().single()

    if (arError) throw new Error(`AR creation failed: ${arError.message}`)

    // Emit downstream event
    await bus.publish('finance.ar.created', {
      ar_id: ar.id,
      invoice_number: invoiceNumber,
      customer,
      amount: total_amount,
      source: '出貨',
      source_id: shipment_id,
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── AR created → create journal entry (Dr 應收 / Cr 營業收入) ──
  bus.subscribe('finance.ar.created', async function onARCreated(event) {
    const { customer, amount, invoice_number, source, source_id } = event.payload

    // F-A2：出貨（source='出貨'）的傳票已由規則引擎（postingHandlers 訂閱
    // wms.shipment.completed → sales_shipment）產生，有規則時 legacy 硬寫路徑
    // 讓位，避免雙重入帳。其他來源（POS 等）不在引擎覆蓋範圍，維持 legacy。
    if (source === '出貨' && await hasActiveRule('sales_shipment')) {
      logger.info('[financeHandlers] sales_shipment 有拋轉規則，legacy JE 讓位', { source, source_id })
      return
    }

    const entryNumber = `JE-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`

    const { data: entry, error: entryError } = await supabase.rpc('secure_create_journal_entry', {
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: `${source === '出貨' ? '出貨' : '銷售'}產生應收 - ${customer} (${invoice_number})`,
      p_lines: [
        { account_code: '1300', account_name: '應收帳款', debit: amount, credit: 0, memo: `${customer} - ${invoice_number}` },
        { account_code: '4100', account_name: '營業收入', debit: 0, credit: amount, memo: `${customer} - ${invoice_number}` },
      ],
      p_source: source || '出貨',
      p_source_id: source_id,
      p_created_by: '系統',
    })

    if (entryError) throw new Error(`Journal entry failed: ${entryError.message}`)

    await bus.publish('finance.journal.posted', {
      entry_id: entry.id,
      entry_number: entryNumber,
      amount,
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── Purchase goods receipt completed → create AP + journal entry ──
  bus.subscribe('purchase.goods_receipt.completed', async function onGoodsReceiptCompleted(event) {
    const { supplier, po_number, po_id, total_amount, tax, shipping, payment_terms } = event.payload
    const amount = (total_amount || 0) + (tax || 0) + (shipping || 0)
    const paymentDays = parsePaymentTerms(payment_terms)
    const billNumber = `BILL-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`

    const { data: ap, error: apError } = await supabase.from('accounts_payable').insert({
      bill_number: billNumber,
      supplier,
      po_ref: po_number,
      amount,
      paid_amount: 0,
      due_date: getDueDate(paymentDays),
      status: '未付款',
      // 事件 metadata 帶 org 時顯式寫入（無則由 DB trigger set_org_default 補）
      ...(event.metadata?.organization_id ? { organization_id: event.metadata.organization_id } : {}),
    }).select().single()

    if (apError) throw new Error(`AP creation failed: ${apError.message}`)

    // Emit downstream event
    await bus.publish('finance.ap.created', {
      ap_id: ap.id,
      bill_number: billNumber,
      supplier,
      amount,
      po_ref: po_number,
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })

    // F-A2：進貨驗收傳票已由規則引擎（postingHandlers → purchase_receipt）產生，
    // 有啟用規則時 legacy 硬寫路徑讓位，避免雙重入帳。
    if (await hasActiveRule('purchase_receipt')) {
      logger.info('[financeHandlers] purchase_receipt 有啟用拋轉規則，legacy JE 讓位', { po_id, po_number })
      return
    }

    // Create journal entry (Dr 營業成本 / Cr 應付帳款)
    const { data: entry, error: entryError } = await supabase.rpc('secure_create_journal_entry', {
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: `採購入庫 - ${supplier} (${po_number})`,
      p_lines: [
        { account_code: '5100', account_name: '營業成本', debit: amount, credit: 0, memo: `${supplier} - ${po_number}` },
        { account_code: '2100', account_name: '應付帳款', debit: 0, credit: amount, memo: `${supplier} - ${po_number}` },
      ],
      p_source: '採購',
      p_source_id: po_id,
      p_created_by: '系統',
    })

    if (entryError) throw new Error(`Journal entry failed: ${entryError.message}`)
  })

  // ── Expense approved → create journal entry ──
  bus.subscribe('hr.expense.approved', async function onExpenseApproved(event) {
    const { expense_id, employee, category, amount: rawAmount, description, date } = event.payload
    const amount = Number(rawAmount)
    const entryNumber = `JE-EXP-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-4)}`

    const categoryAccountMap = {
      '交通': { code: '6200', name: '交通費' },
      '住宿': { code: '6300', name: '旅費' },
      '餐飲': { code: '6400', name: '交際費' },
      '設備': { code: '6500', name: '設備維護費' },
      '其他': { code: '6900', name: '其他費用' },
    }

    const account = categoryAccountMap[category] || categoryAccountMap['其他']

    const { data: entry, error: entryError } = await supabase.rpc('secure_create_journal_entry', {
      p_entry_date: date || new Date().toISOString().slice(0, 10),
      p_description: `費用驗收 - ${employee} (${category}: ${description || ''})`,
      p_lines: [
        { account_code: account.code, account_name: account.name, debit: amount, credit: 0, memo: `${employee} - ${category}` },
        { account_code: '1100', account_name: '現金', debit: 0, credit: amount, memo: `${employee} - ${category}` },
      ],
      p_source: '費用驗收',
      p_source_id: expense_id,
      p_created_by: '系統',
    })

    if (entryError) throw new Error(`Expense JE failed: ${entryError.message}`)
  })
}

// ── Helpers ──

function getDueDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function parsePaymentTerms(terms) {
  if (!terms) return 30
  const match = terms.match(/NET(\d+)/)
  return match ? parseInt(match[1], 10) : 30
}
