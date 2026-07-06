/**
 * 單據編號取號（F-C3.1 單據編號規則表）
 *
 * 所有單據（報價/訂單/請購/採購/驗收/退貨/折讓/傳票/盤點）統一走
 * allocate_document_number RPC 原子取號，杜絕 app 層 Date.now() 取號撞號。
 *
 * 規則表：document_number_rules（org 自訂優先，fallback 全域預設）
 * 流水號：document_number_sequences（org × doc_type × period_key）
 *
 * 純函式（derivePeriodKey / formatDocumentNumber / formatPreview）與 DB 端
 * RPC 的產號邏輯一致，僅供 UI 預覽與單元測試 — 正式取號一律走 RPC。
 */
import { supabase } from './supabase'
import { logger } from './logger'
import { getTenantOrgId } from './events/middleware/tenantContext'

/** 支援的單據類型（與 migration 種子一致） */
export const DOC_TYPES = {
  quotation: 'QT',           // 報價單
  sales_order: 'SO',         // 銷貨訂單
  purchase_request: 'PR',    // 請購單
  purchase_order: 'PO',      // 採購單
  goods_receipt: 'GR',       // 進貨驗收單
  sales_return: 'SR',        // 銷貨退回單
  sales_allowance: 'SA',     // 銷貨折讓單
  purchase_allowance: 'PA',  // 進貨折讓單
  journal_entry: 'JE',       // 會計傳票
  stock_count: 'SC',         // 盤點單
}

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * 依規則的 reset_cycle 推導期別鍵（純函式，與 RPC 內邏輯一致）
 *
 * @param {{reset_cycle?: string}} rule - 編號規則（'year'|'month'|'none'）
 * @param {Date} [date] - 基準日（預設今天，取本地時區）
 * @returns {string} 'YYYY'（年重置）/ 'YYYYMM'（月重置）/ ''（不重置）
 */
export function derivePeriodKey(rule, date = new Date()) {
  const cycle = rule?.reset_cycle
  if (cycle === 'year') return String(date.getFullYear())
  if (cycle === 'month') return `${date.getFullYear()}${pad2(date.getMonth() + 1)}`
  return ''
}

/**
 * 依規則的 date_format 推導單號日期段（純函式）
 *
 * @param {{date_format?: string}} rule - 'YYYYMM' | 'YYYYMMDD' | ''
 * @param {Date} [date]
 * @returns {string}
 */
export function deriveDatePart(rule, date = new Date()) {
  const fmt = rule?.date_format
  const ym = `${date.getFullYear()}${pad2(date.getMonth() + 1)}`
  if (fmt === 'YYYYMM') return ym
  if (fmt === 'YYYYMMDD') return `${ym}${pad2(date.getDate())}`
  return ''
}

/**
 * 將規則 + 流水號組成單號（純函式，與 RPC 輸出格式一致）
 * 格式：prefix-日期段-零補流水號（空段自動略過，用 '-' 串接）
 *
 * @param {object} rule - {prefix, date_format, sequence_digits}
 * @param {number} seq - 流水號
 * @param {Date} [date]
 * @returns {string} 例：'QT-202607-0001'
 */
export function formatDocumentNumber(rule, seq, date = new Date()) {
  const digits = rule?.sequence_digits ?? 4
  const seqStr = String(seq)
  const padded = seqStr.padStart(Math.max(digits, seqStr.length), '0')
  return [rule?.prefix, deriveDatePart(rule, date), padded]
    .filter(Boolean)
    .join('-')
}

/**
 * 規則預覽（管理 UI 顯示「下一號長相」用）
 *
 * @param {object} rule - {prefix, date_format, sequence_digits}
 * @param {Date} [date]
 * @returns {string} 例：'QT-202607-0001'
 */
export function formatPreview(rule, date = new Date()) {
  return formatDocumentNumber(rule, 1, date)
}

/**
 * 原子取號 — 呼叫 allocate_document_number RPC
 *
 * @param {string} docType - 單據類型（見 DOC_TYPES）
 * @param {{orgId?: number}} [opts] - 可覆寫 org（預設取當前 session 的 tenant org）
 * @returns {Promise<string>} 完整單號，例：'PO-202607-0001'
 * @throws {Error} org 缺失 / 規則不存在 / RPC 失敗
 */
export async function allocateDocumentNumber(docType, opts = {}) {
  const orgId = opts.orgId ?? getTenantOrgId()
  if (!orgId) {
    throw new Error('取號失敗：無法取得 organization_id（尚未登入或 tenant 未載入）')
  }

  const { data, error } = await supabase.rpc('allocate_document_number', {
    p_doc_type: docType,
    p_org: orgId,
  })

  if (error) {
    logger.error('Document number allocation failed', {
      module: 'documentNumber', doc_type: docType, organization_id: orgId, error: error.message,
    })
    throw new Error(`單據取號失敗（${docType}）：${error.message}`)
  }
  if (!data) {
    throw new Error(`單據取號失敗（${docType}）：RPC 未回傳單號`)
  }
  return data
}
