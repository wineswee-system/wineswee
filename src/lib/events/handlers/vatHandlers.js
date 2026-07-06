import { supabase } from '../../supabase.js'
import { logger } from '../../logger.js'

/**
 * F-B3 進銷項憑證檔自動彙入 handlers。
 *
 * 發票生命週期事件 → vat_output_documents（401 申報正式資料來源）：
 *   - finance.invoice.issued    → upsert 銷項憑證（有統編格式 31 / 無統編 35）
 *   - finance.invoice.voided    → 同日作廢：移除該筆銷項（及殘留折讓列）
 *   - finance.invoice.allowance → 跨日折讓：原憑證保留 + 另立負額折讓（格式 33）
 *
 * 冪等：secure_ingest_vat_document 以 UNIQUE(organization_id, source_type, source_id)
 * upsert，事件重播/重試不會重複計入。彙入失敗一律 throw — 讓 EventBus 的 DLQ
 * middleware 接手，不吞錯（同 postingHandlers 模式）。
 */

const SOURCE_INVOICE = 'pos_invoice'
const SOURCE_ALLOWANCE = 'pos_invoice_allowance'

/** 以 payment_id（冪等鍵）撈發票主檔；找不到時回 null（可由憑證檔頁「一鍵補入」回填） */
async function fetchInvoiceByPayment(paymentId, orgId) {
  let q = supabase
    .from('pos_invoices')
    .select('id, organization_id, invoice_number, invoice_date, sales_amount, tax_amount, buyer_tax_id, status')
    .eq('payment_id', paymentId)
  // 事件 metadata 帶 org 時顯式限縮（tenantContext middleware 注入；RLS 之外的第二道防線）
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(`讀取發票主檔失敗：${error.message}`)
  return data
}

async function ingest(payload) {
  const { error } = await supabase.rpc('secure_ingest_vat_document', {
    p_direction: 'output',
    p_payload: payload,
  })
  if (error) throw new Error(`銷項憑證彙入失敗：${error.message}`)
}

export function registerVatHandlers(bus) {
  // ── 發票開立 → 銷項憑證 ──
  bus.subscribe('finance.invoice.issued', async function onInvoiceIssuedVatIngest(event) {
    const { payment_id } = event.payload
    const inv = await fetchInvoiceByPayment(payment_id, event.metadata?.organization_id)
    if (!inv) {
      // 主檔尚不可見（RLS/延遲）→ 留給憑證檔頁「一鍵補入」backfill 回填，不進 DLQ
      logger.warn('[vatHandlers] 找不到發票主檔，略過憑證彙入（可由補入回填）', {
        module: 'finance', payment_id,
      })
      return
    }

    await ingest({
      source_type: SOURCE_INVOICE,
      source_id: String(inv.id),
      format_code: inv.buyer_tax_id ? '31' : '35', // 有統編 → 三聯式存證；無統編 → B2C
      doc_number: inv.invoice_number,
      doc_date: inv.invoice_date,
      counterparty_ubn: inv.buyer_tax_id || null,
      amount: Number(inv.sales_amount) || 0,
      tax_amount: Number(inv.tax_amount) || 0,
      tax_type: '應稅',
    })

    logger.info('[vatHandlers] 銷項憑證已彙入', {
      module: 'finance', invoice_number: inv.invoice_number, source_id: String(inv.id),
    })
  })

  // ── 同日作廢 → 憑證檔不計入（移除既有列）──
  bus.subscribe('finance.invoice.voided', async function onInvoiceVoidedVatRemove(event) {
    const { payment_id } = event.payload
    const inv = await fetchInvoiceByPayment(payment_id, event.metadata?.organization_id)
    if (!inv) return

    await ingest({ _action: 'remove', source_type: SOURCE_INVOICE, source_id: String(inv.id) })
    await ingest({ _action: 'remove', source_type: SOURCE_ALLOWANCE, source_id: String(inv.id) })

    logger.info('[vatHandlers] 作廢發票已自憑證檔移除', {
      module: 'finance', invoice_number: inv.invoice_number, source_id: String(inv.id),
    })
  })

  // ── 跨日折讓 → 另立負額折讓證明單（格式 33，全額折讓）──
  bus.subscribe('finance.invoice.allowance', async function onInvoiceAllowanceVatIngest(event) {
    const { payment_id } = event.payload
    const inv = await fetchInvoiceByPayment(payment_id, event.metadata?.organization_id)
    if (!inv) {
      logger.warn('[vatHandlers] 找不到發票主檔，略過折讓憑證彙入（可由補入回填）', {
        module: 'finance', payment_id,
      })
      return
    }

    await ingest({
      source_type: SOURCE_ALLOWANCE,
      source_id: String(inv.id),
      format_code: '33', // 銷項折讓證明單
      doc_number: inv.invoice_number,
      doc_date: inv.invoice_date,
      counterparty_ubn: inv.buyer_tax_id || null,
      amount: -(Number(inv.sales_amount) || 0),
      tax_amount: -(Number(inv.tax_amount) || 0),
      tax_type: '應稅',
    })

    logger.info('[vatHandlers] 折讓憑證已彙入（負額格式 33）', {
      module: 'finance', invoice_number: inv.invoice_number, source_id: String(inv.id),
    })
  })
}
