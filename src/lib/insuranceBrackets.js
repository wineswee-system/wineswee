/**
 * 勞健保級距載入器
 *
 * 從 DB labor_ins_brackets / health_ins_brackets 載入年度級距表，
 * 提供 sync lookup helper 給 payroll.js 使用。
 *
 * 設計：
 * - 帶 year 快取（同 process 共用），避免每張薪資單都打 DB
 * - 載入失敗或 DB 沒有該年度資料時，回傳 null（payroll.js 會 fallback 到 hardcoded）
 * - row 結構：{ year, grade, insured_salary, min_salary, employee_premium, employer_premium }
 *
 * Bracket 語意：
 * - 月薪 X 落入「min_salary <= X <= insured_salary」的那個 grade
 * - 高於最後一級的 insured_salary → 一律取最後一級（cap）
 */

import { supabase } from './supabase'

// year -> Promise<{labor, health, year}> | null
const cache = new Map()

/**
 * 載入指定年度的勞健保級距表（含快取）
 *
 * @param {number} year - 西元年（如 2026）
 * @returns {Promise<{labor: Array, health: Array, year: number} | null>}
 *   若 DB 沒資料或載入失敗，回傳 null（呼叫端可 fallback）
 */
export async function loadInsuranceBrackets(year) {
  if (!year || !Number.isFinite(year)) return null
  if (cache.has(year)) return cache.get(year)

  const p = (async () => {
    const [laborRes, healthRes] = await Promise.all([
      supabase.from('labor_ins_brackets').select('*').eq('year', year).order('grade'),
      supabase.from('health_ins_brackets').select('*').eq('year', year).order('grade'),
    ])
    if (laborRes.error) throw laborRes.error
    if (healthRes.error) throw healthRes.error
    const labor = laborRes.data || []
    const health = healthRes.data || []
    if (labor.length === 0 || health.length === 0) {
      // 該年度沒資料
      return null
    }
    return { labor, health, year }
  })()

  cache.set(year, p)
  try {
    return await p
  } catch (e) {
    // 載入失敗：清掉 cache 讓下次重試
    cache.delete(year)
    console.error('[insuranceBrackets] load failed for year', year, e)
    return null
  }
}

/**
 * 從 brackets 陣列中找對應月薪的 grade row
 *
 * @param {Array} brackets - 已 sort by grade asc 的 bracket 陣列
 * @param {number} salary - 月薪
 * @param {number} startInsured - 起算的最低 insured_salary（FT 從 29500，PT 鐵則從 11100）
 * @returns {object | null} bracket row，或 null（陣列空）
 */
function findBracketRow(brackets, salary, startInsured) {
  if (!brackets || brackets.length === 0) return null
  // 找第一個 insured_salary >= startInsured 且 >= salary 的級距
  for (const b of brackets) {
    if (b.insured_salary < startInsured) continue
    if (b.insured_salary >= salary) return b
  }
  // 超過最高級 → 取最後一級（cap）
  return brackets[brackets.length - 1]
}

/**
 * 勞保級距查找
 *
 * 業務鐵則：
 * - PT 一律投保 11,100（forcePartTimeMin: true 預設）
 * - FT 最低 29,500（基本工資），最高 cap 在「>= 45,800 對應的最後 FT 級距」
 *   （DB 表 grade 35 = 45,800，之後 grade 36+ 雖然 insured_salary 上升，
 *    但 employee_premium 凍結在 1,145；我們直接照 DB 用，不另作 cap 邏輯）
 *
 * @param {Array} laborBrackets - DB labor brackets (whole year, all 82 grades)
 * @param {number} salary - 月薪
 * @param {object} [opts]
 * @param {boolean} [opts.isPartTime=false]
 * @param {boolean} [opts.forcePartTimeMin=true]
 * @returns {object | null}
 */
export function findLaborBracket(laborBrackets, salary, opts = {}) {
  const { isPartTime = false, forcePartTimeMin = true } = opts
  if (!laborBrackets || laborBrackets.length === 0) return null

  if (isPartTime && forcePartTimeMin) {
    // PT 鐵則：固定 11,100
    return laborBrackets.find(b => b.insured_salary === 11100) || null
  }

  // FT：從 29,500 起算。月薪 < 29,500 也對齊 29,500 級
  // 注意：勞保實際的法定 cap 是 45,800（grade 35）。
  // 但 DB 表有 1–82 級，我們不主動 cap，由 employee_premium 凍結在 1,145 來反映「>= 45,800 都一樣」。
  return findBracketRow(laborBrackets, salary, 29500)
}

/**
 * 健保級距查找
 *
 * 健保無 PT 例外 — 一律從第 1 級（29,500）起算
 * 最高級 313,000（grade 82）
 *
 * @param {Array} healthBrackets - DB health brackets
 * @param {number} salary - 月薪
 * @returns {object | null}
 */
export function findHealthBracket(healthBrackets, salary) {
  return findBracketRow(healthBrackets, salary, 29500)
}

/**
 * 從投保金額反查 row（給「指定投保金額」場景用，如手動指定 insured_salary）
 *
 * @param {Array} brackets
 * @param {number} insuredSalary
 * @returns {object | null}
 */
export function findBracketByInsured(brackets, insuredSalary) {
  if (!brackets || brackets.length === 0) return null
  for (const b of brackets) {
    if (b.insured_salary >= insuredSalary) return b
  }
  return brackets[brackets.length - 1]
}

/**
 * 清除快取（給測試或手動 refresh 用）
 */
export function clearInsuranceBracketsCache(year) {
  if (year) cache.delete(year)
  else cache.clear()
}
