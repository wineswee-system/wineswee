/**
 * F-C3.2 折讓單（銷貨/進貨）— 三個 Track 的交會點
 *
 * 獨立單據（非退貨）：連動原單、金額/稅額 →
 *   確認時觸發 電子發票折讓 D0401（F-B1）+ 傳票（F-A2）+ 進銷項憑證檔（F-B3）。
 *
 * AL-02 鐵則：折讓「不動庫存」（與退貨的本質差異）— 本檔全程不 import、
 * 不呼叫任何 inventory / stock 模組，也不寫任何庫存相關資料表。
 *
 * 寫入規範：
 *   - 草稿建立走 db 層 insert（RLS 限 draft + 本組織）
 *   - 「確認」一律走 SECURITY DEFINER RPC（傳票 + 憑證檔在 SQL 端同一交易完成）
 */
import { supabase } from './supabase'
import { logger } from './logger'
import { getEventBus } from './events/index.js'
import { getTenantOrgId } from './events/middleware/tenantContext'
import { allocateDocumentNumber } from './documentNumber'
import { calculateInvoiceTax } from './einvoice'
import { voidInvoice } from './invoiceService'
import { insertSalesAllowance, insertPurchaseAllowance } from './db/allowances'

/** 折讓單狀態（與 CHECK 約束對齊） */
export const ALLOWANCE_STATUSES = ['draft', 'confirmed', 'cancelled']

/** 狀態 → zh-TW 標籤 */
export const ALLOWANCE_STATUS_LABELS = {
  draft: '草稿',
  confirmed: '已確認',
  cancelled: '已取消',
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * 純函式：由明細行計算折讓金額/稅額（AL-01）。
 * 稅額計算沿用電子發票模組 calculateInvoiceTax（5% 應稅、逐行四捨五入）。
 *
 * @param {Array<{description?: string, quantity?: number, unit_price?: number}>} lines
 * @param {string} [taxType] - '應稅' | '零稅率' | '免稅'
 * @returns {{lines: Array<{description: string, quantity: number, unit_price: number, amount: number, tax: number}>,
 *            amount: number, taxAmount: number, total: number, taxRate: number}}
 */
export function computeAllowanceTotals(lines, taxType = '應稅') {
  const items = (lines || []).map((l) => ({
    description: l?.description ?? '',
    qty: Number(l?.quantity) || 0,
    unitPrice: Number(l?.unit_price) || 0,
  }))

  const { subtotal, taxAmount, total, taxRate, items_with_tax } = calculateInvoiceTax(items, taxType)

  return {
    lines: items_with_tax.map((it) => ({
      description: it.description,
      quantity: it.qty,
      unit_price: it.unit_price,
      amount: it.amount,
      tax: it.tax,
    })),
    amount: subtotal,      // 未稅折讓額
    taxAmount,             // 折讓稅額
    total,                 // 含稅折讓總額
    taxRate,
  }
}

/**
 * 純函式：原單剩餘可折讓額（AL-03 上限 — 與 RPC 端查核邏輯一致）。
 * 剩餘 = 原單總額 −（已確認折讓的 amount + tax_amount 合計）。
 * 剛好折完（剩餘 0）合法；回傳負值代表資料已超限（RPC 端會擋）。
 *
 * @param {number} originalTotal - 原單含稅總額
 * @param {Array<{amount?: number, tax_amount?: number}|number>} [confirmedAllowances]
 * @returns {number}
 */
export function remainingAllowable(originalTotal, confirmedAllowances = []) {
  const used = (confirmedAllowances || []).reduce((sum, a) => {
    if (typeof a === 'number') return sum + (Number(a) || 0)
    return sum + (Number(a?.amount) || 0) + (Number(a?.tax_amount) || 0)
  }, 0)
  return round2((Number(originalTotal) || 0) - used)
}

/** 事件發布（發布失敗不影響折讓結果 — 同 invoiceService 慣例） */
async function publishAllowanceEvent(payload) {
  try {
    const bus = getEventBus()
    await bus.publish('finance.invoice.allowance', payload)
  } catch (e) {
    logger.warn('finance.invoice.allowance event publish failed', {
      module: 'finance', invoice_number: payload?.invoice_number, reason: e?.message,
    })
  }
}

/**
 * 建立銷貨折讓草稿：SA 取號（allocate_document_number）→ 稅額計算 → insert draft。
 * 不動庫存、不拋傳票 — 傳票/憑證/發票折讓一律在 confirmSalesAllowance 的 RPC 交易觸發。
 *
 * @param {{orgId?: number, originalDocType?: 'sales_order'|'pos_invoice'|'manual',
 *          originalDocId?: string|number, customerName?: string, invoiceNumber?: string,
 *          lines: Array<{description: string, quantity: number, unit_price: number}>,
 *          taxType?: string, reason?: string, createdBy?: string}} data
 * @returns {Promise<object>} sales_allowances 草稿列
 */
export async function createSalesAllowance(data = {}) {
  const orgId = data.orgId ?? getTenantOrgId()
  if (!orgId) throw new Error('建立折讓單失敗：無法取得 organization_id（尚未登入或 tenant 未載入）')

  const totals = computeAllowanceTotals(data.lines, data.taxType)
  if (!(totals.total > 0)) throw new Error('折讓金額必須大於 0（請確認明細行數量/單價）')

  const allowanceNumber = await allocateDocumentNumber('sales_allowance', { orgId })

  const { data: row, error } = await insertSalesAllowance({
    organization_id: orgId,
    allowance_number: allowanceNumber,
    original_doc_type: data.originalDocType || 'manual',
    original_doc_id: data.originalDocId == null ? null : String(data.originalDocId),
    customer_name: data.customerName || null,
    invoice_number: data.invoiceNumber || null,
    lines: totals.lines,
    amount: totals.amount,
    tax_amount: totals.taxAmount,
    reason: data.reason || null,
    status: 'draft',
    created_by: data.createdBy || null,
  })

  if (error) {
    logger.error('[allowances] 建立銷貨折讓草稿失敗', {
      module: 'sales', allowance_number: allowanceNumber, error: error.message,
    })
    throw new Error(`建立銷貨折讓單失敗：${error.message}`)
  }
  return row
}

/**
 * 確認銷貨折讓：RPC secure_confirm_sales_allowance（SQL 端同一交易 —
 * AL-03 上限查核 + F-A2 傳票 + F-B3 銷項折讓憑證 格式 33）。
 *
 * D0401 佈線（與 migration 20260705180000 的去重設計成對）：
 *   1. 連動發票且「全額折讓 + 有 payment_id」→ 呼叫 invoiceService.voidInvoice(paymentId)
 *      → void-invoice edge function 開 D0401（同日則 F0501），成功後其內部發布
 *      finance.invoice.allowance → vatHandlers 以 (pos_invoice_allowance, 發票id)
 *      入負額憑證（SQL 端此情境刻意不入檔，避免雙計）。
 *   2. 連動發票但「部分折讓」→ 現行 void-invoice edge 僅支援全額 D0401，且發
 *      finance.invoice.allowance 會讓 vatHandlers 以「發票全額」入負檔造成錯帳
 *      → 不打 provider、不發事件；憑證檔已由 RPC 以實際折讓額入檔，
 *      D0401 需至加值中心後台以部分金額開立（logger.warn 提示）。
 *   3. 連動發票但 payment 連結不可得（找不到發票主檔 / legacy 無 payment_id）
 *      → 無法從此處走 void-invoice edge，直接發布 finance.invoice.allowance
 *      事件留審計軌跡（vatHandlers 依 payment_id 找不到主檔會安全略過，
 *      不會重複入檔 — 憑證檔已由 RPC 入檔）。
 *
 * @param {string} id - sales_allowances.id
 * @returns {Promise<{allowance: object, einvoice: {mode: 'd0401'|'event'|'manual'|'none', ok?: boolean, voidType?: string, error?: string, reason?: string}}>}
 */
export async function confirmSalesAllowance(id) {
  if (!id) throw new Error('缺少折讓單 id')

  const { data: allowance, error } = await supabase.rpc('secure_confirm_sales_allowance', { p_id: id })
  if (error) {
    logger.error('[allowances] 銷貨折讓確認失敗', { module: 'sales', id, error: error.message })
    throw new Error(`銷貨折讓確認失敗：${error.message}`)
  }

  let einvoice = { mode: 'none' }

  if (allowance?.invoice_number) {
    const { data: inv, error: invErr } = await supabase
      .from('pos_invoices')
      .select('id, payment_id, sales_amount, tax_amount, status')
      .eq('invoice_number', allowance.invoice_number)
      .maybeSingle()
    if (invErr) {
      logger.warn('[allowances] 讀取連動發票失敗，略過 D0401 佈線', {
        module: 'sales', id, invoice_number: allowance.invoice_number, reason: invErr.message,
      })
    }

    const allowanceTotal = round2((Number(allowance.amount) || 0) + (Number(allowance.tax_amount) || 0))
    const invoiceTotal = inv ? round2((Number(inv.sales_amount) || 0) + (Number(inv.tax_amount) || 0)) : null

    if (inv?.payment_id && allowanceTotal === invoiceTotal) {
      // 路徑 1：全額折讓 → D0401（跨日）/ F0501（同日）由 edge function 判斷；
      // 成功後 voidInvoice 內部發布 finance.invoice.allowance → vatHandlers 入負額憑證
      const res = await voidInvoice(String(inv.payment_id))
      einvoice = { mode: 'd0401', ...res }
      if (!res.ok) {
        logger.error('[allowances] 折讓已確認但發票折讓（D0401）未成功，可由發票查詢頁重試', {
          module: 'sales', id, invoice_number: allowance.invoice_number, reason: res.error,
        })
      }
    } else if (inv?.payment_id) {
      // 路徑 2：部分折讓 — 不打 provider、不發事件（見檔頭說明）；D0401 需人工至加值中心開立
      einvoice = { mode: 'manual', reason: 'partial' }
      logger.warn('[allowances] 部分折讓：D0401 需至加值中心以部分金額開立（憑證檔已依實際折讓額入檔）', {
        module: 'sales', id, invoice_number: allowance.invoice_number,
        allowance_total: allowanceTotal, invoice_total: invoiceTotal,
      })
    } else {
      // 路徑 3：payment 連結不可得 → 發事件留審計軌跡（vatHandlers 會安全略過，不重複入檔）
      await publishAllowanceEvent({
        payment_id: '',
        invoice_number: allowance.invoice_number,
        provider: null,
      })
      einvoice = { mode: 'event' }
    }
  }

  return { allowance, einvoice }
}

/**
 * 建立進貨折讓草稿：PA 取號 → 稅額計算 → insert draft（鏡像 createSalesAllowance）。
 *
 * @param {{orgId?: number, originalDocType?: 'purchase_order'|'goods_receipt'|'manual',
 *          originalDocId?: string|number, supplierName?: string, supplierUbn?: string,
 *          invoiceNumber?: string, deductionCode?: '可扣抵'|'不可扣抵',
 *          lines: Array<{description: string, quantity: number, unit_price: number}>,
 *          taxType?: string, reason?: string, createdBy?: string}} data
 * @returns {Promise<object>} purchase_allowances 草稿列
 */
export async function createPurchaseAllowance(data = {}) {
  const orgId = data.orgId ?? getTenantOrgId()
  if (!orgId) throw new Error('建立折讓單失敗：無法取得 organization_id（尚未登入或 tenant 未載入）')

  const totals = computeAllowanceTotals(data.lines, data.taxType)
  if (!(totals.total > 0)) throw new Error('折讓金額必須大於 0（請確認明細行數量/單價）')

  const allowanceNumber = await allocateDocumentNumber('purchase_allowance', { orgId })

  const { data: row, error } = await insertPurchaseAllowance({
    organization_id: orgId,
    allowance_number: allowanceNumber,
    original_doc_type: data.originalDocType || 'manual',
    original_doc_id: data.originalDocId == null ? null : String(data.originalDocId),
    supplier_name: data.supplierName || null,
    supplier_ubn: data.supplierUbn || null,
    invoice_number: data.invoiceNumber || null,
    deduction_code: data.deductionCode || '可扣抵',
    lines: totals.lines,
    amount: totals.amount,
    tax_amount: totals.taxAmount,
    reason: data.reason || null,
    status: 'draft',
    created_by: data.createdBy || null,
  })

  if (error) {
    logger.error('[allowances] 建立進貨折讓草稿失敗', {
      module: 'purchase', allowance_number: allowanceNumber, error: error.message,
    })
    throw new Error(`建立進貨折讓單失敗：${error.message}`)
  }
  return row
}

/**
 * 確認進貨折讓：RPC secure_confirm_purchase_allowance（SQL 端同一交易 —
 * AL-03 上限查核 + F-A2 傳票 + F-B3 進項折讓憑證 格式 25、deduction_code 透傳）。
 * 進項方向無我方開票行為（折讓證明單由供應商開立），故無 D0401 佈線。
 *
 * @param {string} id - purchase_allowances.id
 * @returns {Promise<object>} 更新後 purchase_allowances 列
 */
export async function confirmPurchaseAllowance(id) {
  if (!id) throw new Error('缺少折讓單 id')

  const { data, error } = await supabase.rpc('secure_confirm_purchase_allowance', { p_id: id })
  if (error) {
    logger.error('[allowances] 進貨折讓確認失敗', { module: 'purchase', id, error: error.message })
    throw new Error(`進貨折讓確認失敗：${error.message}`)
  }
  return data
}
