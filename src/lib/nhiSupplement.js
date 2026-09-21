/**
 * F-B4 二代健保補充保費 — RPC wrapper + 純函式（試算預覽/測試用）
 *
 * 正式計算與入帳一律走 DB RPC（CONVENTIONS.md 第 3 點：DB 是唯一真相源）；
 * 本檔純函式僅「鏡射」DB 內同一套數學，供前端預覽與單元測試，
 * 演算法若調整必須同步改 supabase/migrations/20260705190000_nhi_supplement.sql。
 *
 * 6 類扣費（健保法 §31）：
 *   高額獎金（年度累計 > 4 × 投保金額，超額計費）— secure_calculate_nhi_supplement 自動推導
 *   兼職所得（單次 ≥ 基本工資）/ 執行業務 / 股利 / 利息 / 租金（單次 ≥ 2 萬）— 手動登錄
 *   單次計費上限 1,000 萬；費率 2.11%（2026/115）
 */
import { supabase } from './supabase'
import { getNhiParams } from './db/nhiSupplement'

// ══════════════════════════════════════
//  法規常數（hardcoded fallback — 正式計算請以 loadNhiParams() 讀 DB 參數表）
// ══════════════════════════════════════

/** 2026/115 補充保費費率 2.11% */
export const NHI_SUPPLEMENT_RATE_2026 = 0.0211
/** 高額獎金門檻倍數（投保金額 × 4） */
export const NHI_BONUS_MULTIPLE = 4
/** 兼職所得單次起扣門檻 = 基本工資（2026: 29,500，對齊 src/lib/payroll.js） */
export const NHI_PARTTIME_THRESHOLD_2026 = 29500
/** 執行業務/股利/利息/租金 單次起扣門檻 NT$20,000 */
export const NHI_OTHER_INCOME_THRESHOLD = 20000
/** 單次給付計費上限 NT$10,000,000 */
export const NHI_PAYMENT_CAP = 10000000

/** 手動登錄類別（高額獎金由 RPC 自動推導、不可手動） */
export const NHI_MANUAL_CATEGORIES = ['兼職所得', '執行業務', '股利', '利息', '租金']

/**
 * 讀 DB 年度參數（無資料時退 2026 hardcoded fallback）
 * @param {number} year - 西元年
 */
export async function loadNhiParams(year) {
  const row = await getNhiParams(year)
  if (row) return row
  return {
    effective_year: 2026,
    rate: NHI_SUPPLEMENT_RATE_2026,
    bonus_multiple: NHI_BONUS_MULTIPLE,
    single_payment_threshold: NHI_PARTTIME_THRESHOLD_2026,
    other_income_threshold: NHI_OTHER_INCOME_THRESHOLD,
    payment_cap: NHI_PAYMENT_CAP,
  }
}

// ══════════════════════════════════════
//  純函式（鏡射 DB RPC 的數學）
// ══════════════════════════════════════

/**
 * 高額獎金補充保費 — 只課「本次給付落在 4 倍門檻以上」的部分
 *
 * 門檻 = insuredSalary × multiple；累計後 = cumulativeBonusBefore + thisBonus
 * 計費基礎 = max(0, 累計後 − max(門檻, 累計前))：
 *   - 累計後仍 ≤ 門檻 → 0（尚未超過 4 倍投保薪資，免扣）
 *   - 本次跨越門檻   → 只課超過門檻的那一段
 *   - 累計前已超門檻 → 本次全額計費
 * 再套單次計費上限 cap；保費 = round(計費基礎 × rate)。
 * 無投保金額（insuredSalary ≤ 0，未在本單位投保）→ 不屬本類，回 0。
 *
 * @param {{cumulativeBonusBefore:number, thisBonus:number, insuredSalary:number,
 *          rate?:number, multiple?:number, cap?:number}} p
 * @returns {{taxableBase:number, premium:number}}
 */
export function calcBonusSupplement({
  cumulativeBonusBefore = 0,
  thisBonus = 0,
  insuredSalary = 0,
  rate = NHI_SUPPLEMENT_RATE_2026,
  multiple = NHI_BONUS_MULTIPLE,
  cap = NHI_PAYMENT_CAP,
} = {}) {
  const before = Number(cumulativeBonusBefore) || 0
  const bonus = Number(thisBonus) || 0
  const insured = Number(insuredSalary) || 0

  if (bonus <= 0 || insured <= 0) return { taxableBase: 0, premium: 0 }

  const threshold = insured * multiple
  const after = before + bonus
  // 超額部分 = 累計後超過「門檻與累計前取大者」的量（= 本次落在門檻以上的部分）
  let taxableBase = Math.max(0, after - Math.max(threshold, before))
  taxableBase = Math.min(taxableBase, cap)

  return { taxableBase, premium: Math.round(taxableBase * rate) }
}

/**
 * 單次給付類（兼職所得/執行業務/股利/利息/租金）補充保費
 *
 * 未達門檻 → 免扣（taxableBase 0）；達門檻 → 全額計費（非只課超過門檻部分），
 * 套單次計費上限 cap。門檻依類別：兼職所得 = 基本工資、其餘 = 2 萬。
 *
 * @param {{amount:number, threshold?:number, rate?:number, cap?:number,
 *          category?:string}} p - threshold 未給時依 category 取預設門檻
 * @returns {{taxableBase:number, premium:number, belowThreshold:boolean}}
 */
export function calcSinglePaymentSupplement({
  amount = 0,
  threshold,
  rate = NHI_SUPPLEMENT_RATE_2026,
  cap = NHI_PAYMENT_CAP,
  category = '',
} = {}) {
  const pay = Number(amount) || 0
  const th = threshold != null
    ? Number(threshold)
    : (category === '兼職所得' ? NHI_PARTTIME_THRESHOLD_2026 : NHI_OTHER_INCOME_THRESHOLD)

  if (pay <= 0 || pay < th) {
    return { taxableBase: 0, premium: 0, belowThreshold: true }
  }

  const taxableBase = Math.min(pay, cap)
  return { taxableBase, premium: Math.round(taxableBase * rate), belowThreshold: false }
}

/**
 * 雇主（投保單位）負擔 = (受雇者薪資支出總額 − 健保投保金額總額) × 費率，下限 0
 *
 * @param {{salaryTotal:number, insuredTotal:number, rate?:number}} p
 * @returns {{taxableBase:number, premium:number}}
 */
export function calcEmployerSupplement({
  salaryTotal = 0,
  insuredTotal = 0,
  rate = NHI_SUPPLEMENT_RATE_2026,
} = {}) {
  const base = Math.max(0, (Number(salaryTotal) || 0) - (Number(insuredTotal) || 0))
  return { taxableBase: base, premium: Math.round(base * rate) }
}

// ══════════════════════════════════════
//  RPC wrapper（正式計算 — DB 是唯一真相源）
// ══════════════════════════════════════

/**
 * 計算本期高額獎金補充保費（server-side，冪等 upsert nhi_supplement_records）
 * @param {string} period - 'YYYY-MM'
 * @returns {Promise<{period:string, calculated:number, skipped_no_insured:number, total_premium:number}>}
 */
export async function calculateNhiSupplement(period) {
  const { data, error } = await supabase.rpc('secure_calculate_nhi_supplement', { p_period: period })
  if (error) throw new Error(error.message || '二代健保補充保費計算失敗')
  return data
}

/**
 * 計算本期雇主負擔（server-side，upsert nhi_employer_records）
 * @param {string} period - 'YYYY-MM'
 * @returns {Promise<{salary_total:number, insured_total:number, premium:number}>}
 */
export async function calculateNhiEmployer(period) {
  const { data, error } = await supabase.rpc('secure_calculate_nhi_employer', { p_period: period })
  if (error) throw new Error(error.message || '二代健保雇主負擔計算失敗')
  return data
}

/**
 * 手動登錄其餘 5 類代扣（server-side 驗證門檻/上限）
 * @param {{period:string, employeeId:number, category:string, amount:number, sourceId?:string}} p
 */
export async function addNhiManualRecord({ period, employeeId, category, amount, sourceId } = {}) {
  const { data, error } = await supabase.rpc('secure_add_nhi_record', {
    p_period: period,
    p_employee_id: employeeId,
    p_category: category,
    p_amount: amount,
    p_source_id: sourceId ?? null,
  })
  if (error) throw new Error(error.message || '手動登錄失敗')
  return data
}
