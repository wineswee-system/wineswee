import { supabase } from '../supabase'
import { logger } from '../logger'
import { getTenantOrgId } from '../events/middleware/tenantContext.js'

// ─── F-A2 傳票自動拋轉引擎 ───────────────────────────────────────
//
// 規則表驅動（posting_rules）的單據→傳票拋轉：
//   - postFromDocument()：呼叫 secure_auto_post_voucher RPC（金流寫入一律 RPC）
//   - previewVoucher()：純前端模板求值，供 PostingRules.jsx 試算預覽
//   - 金額運算式語言（與 SQL 端 posting_eval_amount 對齊，刻意極簡）：
//       payload key ｜ key*rate ｜ key-key ｜ key+key

/** 單據類型 → zh-TW 標籤（與 posting_rules.doc_type 對齊） */
export const POSTING_DOC_TYPES = {
  sales_shipment:       '銷貨出貨',
  sales_return:         '銷貨退回/折讓',
  purchase_receipt:     '進貨驗收',
  purchase_return:      '進貨退出/折讓',
  payment_received:     '收款',
  payment_made:         '付款',
  inventory_count:      '盤點盈虧',
  payroll_monthly:      '薪資月結',
  depreciation_monthly: '折舊月提',
  open_item_settle:     '立沖立帳/沖銷',
}

/**
 * 全域預設模板（與 supabase/migrations/20260705100000_posting_rules.sql 的
 * 種子資料保持一致 — 改一邊要同步另一邊）。
 * UI 在尚未讀到 DB 規則時作為顯示/試算的 fallback。
 */
export const DEFAULT_POSTING_TEMPLATES = {
  sales_shipment: [
    { account_code: '1130', account_name: '應收帳款',     side: 'debit',  amount_expr: 'total',     cost_center_from: 'store_id' },
    { account_code: '4100', account_name: '營業收入',     side: 'credit', amount_expr: 'total-tax', cost_center_from: 'store_id' },
    { account_code: '2170', account_name: '銷項稅額',     side: 'credit', amount_expr: 'tax',       cost_center_from: 'store_id' },
  ],
  sales_return: [
    { account_code: '4200', account_name: '銷貨退回及折讓', side: 'debit',  amount_expr: 'total-tax', cost_center_from: 'store_id' },
    { account_code: '2170', account_name: '銷項稅額',     side: 'debit',  amount_expr: 'tax',       cost_center_from: 'store_id' },
    { account_code: '1130', account_name: '應收帳款',     side: 'credit', amount_expr: 'total',     cost_center_from: 'store_id' },
  ],
  purchase_receipt: [
    { account_code: '1150', account_name: '存貨',         side: 'debit',  amount_expr: 'total-tax', cost_center_from: 'warehouse_id' },
    { account_code: '1170', account_name: '進項稅額',     side: 'debit',  amount_expr: 'tax',       cost_center_from: 'warehouse_id' },
    { account_code: '2100', account_name: '應付帳款',     side: 'credit', amount_expr: 'total',     cost_center_from: 'warehouse_id' },
  ],
  purchase_return: [
    { account_code: '2100', account_name: '應付帳款',     side: 'debit',  amount_expr: 'total',     cost_center_from: 'warehouse_id' },
    { account_code: '1150', account_name: '存貨',         side: 'credit', amount_expr: 'total-tax', cost_center_from: 'warehouse_id' },
    { account_code: '1170', account_name: '進項稅額',     side: 'credit', amount_expr: 'tax',       cost_center_from: 'warehouse_id' },
  ],
  payment_received: [
    { account_code: '1102', account_name: '銀行存款',     side: 'debit',  amount_expr: 'amount', cost_center_from: 'store_id' },
    { account_code: '1130', account_name: '應收帳款',     side: 'credit', amount_expr: 'amount', cost_center_from: 'store_id' },
  ],
  payment_made: [
    { account_code: '2100', account_name: '應付帳款',     side: 'debit',  amount_expr: 'amount', cost_center_from: 'store_id' },
    { account_code: '1102', account_name: '銀行存款',     side: 'credit', amount_expr: 'amount', cost_center_from: 'store_id' },
  ],
  inventory_count: [
    { account_code: '5150', account_name: '存貨盤損',     side: 'debit',  amount_expr: 'amount', cost_center_from: 'warehouse_id' },
    { account_code: '1150', account_name: '存貨',         side: 'credit', amount_expr: 'amount', cost_center_from: 'warehouse_id' },
  ],
  payroll_monthly: [
    { account_code: '6100', account_name: '薪資費用',     side: 'debit',  amount_expr: 'gross',     cost_center_from: 'department' },
    { account_code: '2120', account_name: '應付薪資',     side: 'credit', amount_expr: 'net',       cost_center_from: 'department' },
    { account_code: '2130', account_name: '代扣款項',     side: 'credit', amount_expr: 'gross-net', cost_center_from: 'department' },
  ],
  depreciation_monthly: [
    { account_code: '6300', account_name: '折舊費用',     side: 'debit',  amount_expr: 'amount', cost_center_from: 'cost_center' },
    { account_code: '1610', account_name: '累計折舊',     side: 'credit', amount_expr: 'amount', cost_center_from: 'cost_center' },
  ],
  open_item_settle: [
    { account_code: '2260', account_name: '預收貨款',     side: 'debit',  amount_expr: 'amount', cost_center_from: 'store_id' },
    { account_code: '4100', account_name: '營業收入',     side: 'credit', amount_expr: 'amount', cost_center_from: 'store_id' },
  ],
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * 求值金額運算式（與 SQL posting_eval_amount 語意一致）。
 * 支援：`key`｜`key*rate`｜`key-key`｜`key+key`。空運算式 → 0。
 * @param {string} expr
 * @param {Record<string, unknown>} payload
 * @returns {number}
 */
export function evaluateAmountExpr(expr, payload = {}) {
  if (expr == null || String(expr).trim() === '') return 0
  const e = String(expr).replace(/\s+/g, '')
  const num = (key) => round2(payload[key] ?? 0)

  let m
  if ((m = e.match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/))) return num(m[1])
  if ((m = e.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\*([0-9]+(?:\.[0-9]+)?)$/))) return round2(num(m[1]) * Number(m[2]))
  if ((m = e.match(/^([a-zA-Z_][a-zA-Z0-9_]*)-([a-zA-Z_][a-zA-Z0-9_]*)$/))) return round2(num(m[1]) - num(m[2]))
  if ((m = e.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\+([a-zA-Z_][a-zA-Z0-9_]*)$/))) return round2(num(m[1]) + num(m[2]))

  throw new Error(`不支援的金額運算式：${expr}（僅支援 key / key*rate / key-key / key+key）`)
}

/**
 * 從規則清單解析適用規則：先依「特定性」選（組織自訂優先於全域預設
 * organization_id NULL），再看啟停 — 選中的規則若停用回傳 null，
 * 不回落全域（組織停用 = 這個單據類型刻意不自動拋轉）。
 * 與 RPC secure_auto_post_voucher 的解析邏輯一致，供 UI 預覽用。
 * @param {Array<{doc_type: string, template_name?: string, organization_id?: number|null, is_active?: boolean}>} rules
 * @param {string} docType
 * @param {{orgId?: number|null, templateName?: string}} [opts]
 * @returns {object|null} 啟用中的最適規則；無規則或已停用 → null
 */
export function resolveActiveRule(rules, docType, { orgId = null, templateName = 'default' } = {}) {
  const candidates = (rules || []).filter(r =>
    r.doc_type === docType &&
    (r.template_name || 'default') === templateName &&
    (r.organization_id == null || orgId == null || r.organization_id === orgId)
  )
  if (candidates.length === 0) return null
  // 組織規則優先於全域（organization_id NULL）
  candidates.sort((a, b) => (a.organization_id == null ? 1 : 0) - (b.organization_id == null ? 1 : 0))
  const best = candidates[0]
  return best.is_active === false ? null : best
}

/**
 * 試算預覽：純前端依模板行求值，回傳傳票明細與平衡檢查結果。
 * @param {string|{lines: Array}} docTypeOrRule — doc_type（用預設模板）或規則物件（用其 lines）
 * @param {Record<string, unknown>} payload — 樣本單據資料（total / tax / amount / store_id …）
 * @param {{accounts?: Array<{code: string, name: string}>}} [opts] — 傳入科目表時會校驗科目存在
 * @returns {{lines: Array<{account_code: string, account_name: string, debit: number, credit: number, cost_center: string|null}>, totalDebit: number, totalCredit: number, balanced: boolean, errors: string[]}}
 */
export function previewVoucher(docTypeOrRule, payload = {}, { accounts } = {}) {
  const templateLines = typeof docTypeOrRule === 'string'
    ? DEFAULT_POSTING_TEMPLATES[docTypeOrRule]
    : docTypeOrRule?.lines

  if (!Array.isArray(templateLines) || templateLines.length < 2) {
    return { lines: [], totalDebit: 0, totalCredit: 0, balanced: false, errors: ['拋轉規則明細不足（至少一借一貸）'] }
  }

  const errors = []
  const lines = []
  let totalDebit = 0
  let totalCredit = 0

  templateLines.forEach((tl, i) => {
    const side = String(tl.side || '').toLowerCase()
    if (!tl.account_code) { errors.push(`第 ${i + 1} 行缺少科目代碼`); return }
    if (side !== 'debit' && side !== 'credit') { errors.push(`第 ${i + 1} 行 side 必須為 debit 或 credit`); return }

    let amount
    try {
      amount = evaluateAmountExpr(tl.amount_expr, payload)
    } catch (err) {
      errors.push(err.message)
      return
    }
    if (amount < 0) { errors.push(`第 ${i + 1} 行金額為負：${amount}`); return }
    if (amount === 0) return // 稅額 0 等情況：整行略過

    let accountName = tl.account_name
    if (Array.isArray(accounts)) {
      const acct = accounts.find(a => a.code === tl.account_code)
      if (acct) accountName = acct.name
      else if (!accountName) { errors.push(`科目不存在且規則未提供科目名稱：${tl.account_code}`); return }
    }

    const costCenter = tl.cost_center_from ? (payload[tl.cost_center_from] ?? null) : null

    lines.push({
      account_code: tl.account_code,
      account_name: accountName || tl.account_code,
      debit:  side === 'debit'  ? amount : 0,
      credit: side === 'credit' ? amount : 0,
      cost_center: costCenter == null ? null : String(costCenter),
    })
    if (side === 'debit') totalDebit = round2(totalDebit + amount)
    else totalCredit = round2(totalCredit + amount)
  })

  if (lines.length < 2) errors.push('拋轉後有效明細不足（金額全為 0？）')

  return {
    lines,
    totalDebit,
    totalCredit,
    balanced: errors.length === 0 && totalDebit === totalCredit && totalDebit > 0,
    errors,
  }
}

/**
 * 單據 → 傳票自動拋轉（呼叫 secure_auto_post_voucher RPC，server-side 求值 + 冪等）。
 * 同一 (source_type, source_id) 重複呼叫回傳既有傳票，不會重複入帳。
 * @param {string} docType — posting_rules.doc_type（見 POSTING_DOC_TYPES）
 * @param {string} sourceType — 來源單據類型（冪等鍵一部分，例 'wms.shipment'）
 * @param {string|number} sourceId — 來源單據 id（冪等鍵一部分）
 * @param {Record<string, unknown>} payload — 金額/描述等資料（total, tax, amount, description…）
 * @returns {Promise<object|null>} 傳票列；規則停用時為 null（刻意不拋轉）
 * @throws {Error} RPC 錯誤（找不到規則 / 不平衡 / 科目缺失）— 讓 EventBus DLQ 接手，不吞錯
 */
export async function postFromDocument(docType, sourceType, sourceId, payload = {}) {
  const { data, error } = await supabase.rpc('secure_auto_post_voucher', {
    p_doc_type: docType,
    p_source_type: sourceType,
    p_source_id: String(sourceId),
    p_payload: payload,
  })

  if (error) {
    logger.error('[postingEngine] 自動拋轉失敗', {
      docType, sourceType, sourceId: String(sourceId), error: error.message,
    })
    throw new Error(`傳票自動拋轉失敗（${docType}）：${error.message}`)
  }

  if (!data) {
    logger.info('[postingEngine] 規則已停用，略過拋轉', { docType, sourceType, sourceId: String(sourceId) })
    return null
  }

  return data
}

/**
 * 查詢某單據類型是否「由規則引擎接管」— 只要存在規則列（啟用與否皆算，
 * RLS 已限縮為本組織列 + 全域列）就回 true。
 * financeHandlers 用它決定 legacy 硬寫傳票路徑是否讓位（防雙重入帳）：
 * 規則存在但停用時，代表刻意關閉自動拋轉，legacy 也不該再入帳。
 * 結果快取 60 秒，避免每個事件都打一次 DB。
 * @param {string} docType
 * @returns {Promise<boolean>}
 */
const _ruleCache = new Map() // docType → { value, expires }
export async function hasActiveRule(docType) {
  const cached = _ruleCache.get(docType)
  if (cached && cached.expires > Date.now()) return cached.value

  const orgId = getTenantOrgId()
  let q = supabase
    .from('posting_rules')
    .select('id')
    .eq('doc_type', docType)
  // 顯式限縮本組織列 + 全域列（RLS 之外的第二道防線）
  if (orgId) q = q.or(`organization_id.eq.${orgId},organization_id.is.null`)
  const { data, error } = await q.limit(1)

  if (error) {
    logger.warn('[postingEngine] 查詢拋轉規則失敗，視為無規則', { docType, error: error.message })
    return false
  }

  const value = (data?.length ?? 0) > 0
  _ruleCache.set(docType, { value, expires: Date.now() + 60_000 })
  return value
}

/** 測試/規則異動後清快取 */
export function clearRuleCache() {
  _ruleCache.clear()
}
