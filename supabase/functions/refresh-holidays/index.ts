import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// Restrict CORS to the app's own origin in production.
// Set SITE_URL via: supabase secrets set SITE_URL=https://your-domain.com
// @ts-ignore — Deno global available at runtime in Supabase Edge Functions
const SITE_URL = Deno.env.get('SITE_URL') || '*'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ══════════════════════════════════════════════════════════════
//  台灣國定假日產生器 — 10 年長期版
//  依據勞基法 §37 及行政院人事行政總處公告
//
//  資料來源優先順序：
//  1. 政府 Open Data API（行政院人事行政總處）
//  2. 本地農曆查表（2025-2036，12 年份）
//  3. 查表即將耗盡時自動發出預警事件
// ══════════════════════════════════════════════════════════════

/** 固定日期的國定假日（每年不變）
 *  2025 立法院修《紀念日及節日實施條例》新增 3 個：
 *    9/28  教師節（孔子誕辰）
 *    10/25 臺灣光復節（暨金門古寧頭大捷紀念日）
 *    12/25 行憲紀念日
 *  自 2025 起生效。
 */
const FIXED_HOLIDAYS = [
  { month: 1,  day: 1,  name: '元旦' },
  { month: 2,  day: 28, name: '和平紀念日' },
  { month: 4,  day: 4,  name: '兒童節' },
  { month: 5,  day: 1,  name: '勞動節' },
  { month: 9,  day: 28, name: '教師節' },
  { month: 10, day: 10, name: '國慶日' },
  { month: 10, day: 25, name: '臺灣光復節' },
  { month: 12, day: 25, name: '行憲紀念日' },
]

/**
 * 農曆假日查表（2025-2036，共 12 年）
 * 來源：中央氣象署天文日曆 / 行政院人事行政總處
 *
 * 維護說明：
 * - 此查表為 fallback，正常情況下會優先從政府 API 取得
 * - 若需延伸年份，只要新增該年的 entry 即可
 * - 清明節日期每年需確認（大多在 4/4 或 4/5）
 */
const LUNAR_HOLIDAYS: Record<number, Array<{ month: number; day: number; name: string }>> = {
  2025: [
    { month: 1, day: 28, name: '小年夜' },
    { month: 1, day: 29, name: '除夕' },
    { month: 1, day: 30, name: '春節初一' },
    { month: 1, day: 31, name: '春節初二' },
    { month: 2, day: 1, name: '春節初三' },
    { month: 4, day: 4, name: '清明節' },
    { month: 5, day: 31, name: '端午節' },
    { month: 10, day: 6, name: '中秋節' },
  ],
  2026: [
    { month: 2, day: 15, name: '小年夜' },
    { month: 2, day: 16, name: '除夕' },
    { month: 2, day: 17, name: '春節初一' },
    { month: 2, day: 18, name: '春節初二' },
    { month: 2, day: 19, name: '春節初三' },
    { month: 4, day: 5, name: '清明節' },
    { month: 6, day: 19, name: '端午節' },
    { month: 9, day: 25, name: '中秋節' },
  ],
  2027: [
    { month: 2, day: 5, name: '小年夜' },
    { month: 2, day: 6, name: '除夕' },
    { month: 2, day: 7, name: '春節初一' },
    { month: 2, day: 8, name: '春節初二' },
    { month: 2, day: 9, name: '春節初三' },
    { month: 4, day: 5, name: '清明節' },
    { month: 6, day: 19, name: '端午節' },
    { month: 10, day: 11, name: '中秋節' },
  ],
  2028: [
    { month: 1, day: 25, name: '小年夜' },
    { month: 1, day: 26, name: '除夕' },
    { month: 1, day: 27, name: '春節初一' },
    { month: 1, day: 28, name: '春節初二' },
    { month: 1, day: 29, name: '春節初三' },
    { month: 4, day: 4, name: '清明節' },
    { month: 6, day: 7, name: '端午節' },
    { month: 9, day: 29, name: '中秋節' },
  ],
  2029: [
    { month: 2, day: 12, name: '小年夜' },
    { month: 2, day: 13, name: '除夕' },
    { month: 2, day: 14, name: '春節初一' },
    { month: 2, day: 15, name: '春節初二' },
    { month: 2, day: 16, name: '春節初三' },
    { month: 4, day: 4, name: '清明節' },
    { month: 5, day: 28, name: '端午節' },
    { month: 9, day: 19, name: '中秋節' },
  ],
  2030: [
    { month: 2, day: 2, name: '小年夜' },
    { month: 2, day: 3, name: '除夕' },
    { month: 2, day: 4, name: '春節初一' },
    { month: 2, day: 5, name: '春節初二' },
    { month: 2, day: 6, name: '春節初三' },
    { month: 4, day: 5, name: '清明節' },
    { month: 6, day: 17, name: '端午節' },
    { month: 10, day: 8, name: '中秋節' },
  ],
  2031: [
    { month: 1, day: 22, name: '小年夜' },
    { month: 1, day: 23, name: '除夕' },
    { month: 1, day: 24, name: '春節初一' },
    { month: 1, day: 25, name: '春節初二' },
    { month: 1, day: 26, name: '春節初三' },
    { month: 4, day: 5, name: '清明節' },
    { month: 6, day: 6, name: '端午節' },
    { month: 9, day: 27, name: '中秋節' },
  ],
  2032: [
    { month: 2, day: 10, name: '小年夜' },
    { month: 2, day: 11, name: '除夕' },
    { month: 2, day: 12, name: '春節初一' },
    { month: 2, day: 13, name: '春節初二' },
    { month: 2, day: 14, name: '春節初三' },
    { month: 4, day: 4, name: '清明節' },
    { month: 6, day: 24, name: '端午節' },
    { month: 10, day: 15, name: '中秋節' },
  ],
  2033: [
    { month: 1, day: 30, name: '小年夜' },
    { month: 1, day: 31, name: '除夕' },
    { month: 2, day: 1, name: '春節初一' },
    { month: 2, day: 2, name: '春節初二' },
    { month: 2, day: 3, name: '春節初三' },
    { month: 4, day: 5, name: '清明節' },
    { month: 6, day: 13, name: '端午節' },
    { month: 10, day: 5, name: '中秋節' },
  ],
  2034: [
    { month: 2, day: 18, name: '小年夜' },
    { month: 2, day: 19, name: '除夕' },
    { month: 2, day: 20, name: '春節初一' },
    { month: 2, day: 21, name: '春節初二' },
    { month: 2, day: 22, name: '春節初三' },
    { month: 4, day: 5, name: '清明節' },
    { month: 6, day: 3, name: '端午節' },
    { month: 9, day: 24, name: '中秋節' },
  ],
  2035: [
    { month: 2, day: 7, name: '小年夜' },
    { month: 2, day: 8, name: '除夕' },
    { month: 2, day: 9, name: '春節初一' },
    { month: 2, day: 10, name: '春節初二' },
    { month: 2, day: 11, name: '春節初三' },
    { month: 4, day: 5, name: '清明節' },
    { month: 6, day: 22, name: '端午節' },
    { month: 10, day: 13, name: '中秋節' },
  ],
  2036: [
    { month: 1, day: 27, name: '小年夜' },
    { month: 1, day: 28, name: '除夕' },
    { month: 1, day: 29, name: '春節初一' },
    { month: 1, day: 30, name: '春節初二' },
    { month: 1, day: 31, name: '春節初三' },
    { month: 4, day: 4, name: '清明節' },
    { month: 6, day: 10, name: '端午節' },
    { month: 10, day: 1, name: '中秋節' },
  ],
}

/** 查表涵蓋的最後年份 */
const LOOKUP_TABLE_LAST_YEAR = Math.max(...Object.keys(LUNAR_HOLIDAYS).map(Number))

// ══════════════════════════════════════════════════════════════
//  政府 Open Data API
//  資料來源：
//  1. ruyut/TaiwanCalendar — DGPA 官方資料的 JSON 鏡像（jsDelivr CDN）
//     格式: [{ date: "20260101", week: "四", isHoliday: true, description: "開國紀念日" }]
//  2. 新北市 Open Data — 政府行政機關辦公日曆表（備用）
//     格式: [{ date: "20260101", name: "...", isholiday: "是", holidaycategory: "..." }]
//
//  均為免費公開資料，不需 API Key
// ══════════════════════════════════════════════════════════════

type LunarHoliday = { month: number; day: number; name: string }

/**
 * 嘗試從公開 API 取得指定年份的假日資料
 * 優先用 ruyut/TaiwanCalendar（jsDelivr CDN，最穩定），備用新北市 Open Data
 */
async function fetchGovHolidays(year: number): Promise<LunarHoliday[] | null> {
  const endpoints = [
    {
      url: `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`,
      parser: parseRuyutData,
    },
    {
      url: `https://data.ntpc.gov.tw/api/datasets/308DCD75-6434-45BC-A95F-584DA4FED251/json?size=400`,
      parser: (data: unknown) => parseNtpcData(data, year),
    },
  ]

  for (const { url, parser } of endpoints) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      })
      clearTimeout(timeout)

      if (!res.ok) continue

      const data = await res.json()
      const holidays = parser(data)
      if (holidays && holidays.length >= 3) {
        console.log(`[refresh-holidays] Got ${holidays.length} lunar holidays from ${url} for ${year}`)
        return holidays
      }
    } catch (err: unknown) {
      console.warn(`[refresh-holidays] API attempt failed (${url}): ${(err as Error).message}`)
      continue
    }
  }

  return null
}

/** 農曆假日關鍵字 */
const LUNAR_KEYWORDS = ['春節', '除夕', '小年夜', '端午', '中秋', '清明', '初一', '初二', '初三']

/**
 * 解析 ruyut/TaiwanCalendar 格式
 * 每天一筆: { date: "20260101", week: "四", isHoliday: true, description: "開國紀念日" }
 */
function parseRuyutData(data: unknown): LunarHoliday[] | null {
  if (!Array.isArray(data)) return null

  const results: LunarHoliday[] = []

  for (const item of data) {
    if (item.isHoliday !== true) continue
    const desc: string = item.description || ''
    if (!desc || !LUNAR_KEYWORDS.some(kw => desc.includes(kw))) continue

    const dateStr: string = item.date || ''
    if (dateStr.length !== 8) continue

    const y = parseInt(dateStr.slice(0, 4))
    const m = parseInt(dateStr.slice(4, 6))
    const d = parseInt(dateStr.slice(6, 8))
    if (isNaN(y) || isNaN(m) || isNaN(d)) continue

    results.push({ month: m, day: d, name: normalizeName(desc) })
  }

  return results.length > 0 ? results : null
}

/**
 * 解析新北市 Open Data 格式
 * { date: "20260101", name: "...", isholiday: "是", holidaycategory: "..." }
 */
function parseNtpcData(data: unknown, year: number): LunarHoliday[] | null {
  if (!Array.isArray(data)) return null

  const results: LunarHoliday[] = []

  for (const item of data) {
    if (item.isholiday !== '是') continue
    const name: string = item.name || ''
    if (!name || !LUNAR_KEYWORDS.some(kw => name.includes(kw))) continue

    const dateStr: string = item.date || ''
    if (dateStr.length !== 8) continue

    const y = parseInt(dateStr.slice(0, 4))
    const m = parseInt(dateStr.slice(4, 6))
    const d = parseInt(dateStr.slice(6, 8))
    if (isNaN(y) || isNaN(m) || isNaN(d)) continue
    if (y !== year) continue

    results.push({ month: m, day: d, name: normalizeName(name) })
  }

  return results.length > 0 ? results : null
}

/** 標準化假日名稱，對齊本地查表格式 */
function normalizeName(raw: string): string {
  if (raw.includes('小年夜')) return '小年夜'
  if (raw.includes('除夕')) return '除夕'
  if (raw.includes('初一')) return '春節初一'
  if (raw.includes('初二')) return '春節初二'
  if (raw.includes('初三')) return '春節初三'
  if (raw.includes('清明')) return '清明節'
  if (raw.includes('端午')) return '端午節'
  if (raw.includes('中秋')) return '中秋節'
  return raw
}

// ══════════════════════════════════════════════════════════════
//  補假邏輯 + 假日產生器
// ══════════════════════════════════════════════════════════════

/**
 * 2026 年起「只補假不補班」新制：
 * - 國定假日逢週六 → 前一個週五補假
 * - 國定假日逢週日 → 後一個週一補假
 */
function applySubstituteHoliday(date: Date, year: number): Date | null {
  // 2026 前無此新制
  if (year < 2026) return null

  const dow = date.getDay() // 0=Sun, 6=Sat
  if (dow === 6) {
    const sub = new Date(date)
    sub.setDate(sub.getDate() - 1)
    return sub
  }
  if (dow === 0) {
    const sub = new Date(date)
    sub.setDate(sub.getDate() + 1)
    return sub
  }
  return null
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface HolidayRecord {
  name: string
  date: string
  type: string
  multiplier: number
}

/**
 * 產生指定年份的所有國定假日（含補假）
 * @param lunarOverride — 如果政府 API 有資料，會優先使用
 */
function generateHolidaysForYear(
  year: number,
  lunarOverride?: Array<{ month: number; day: number; name: string }> | null,
): HolidayRecord[] {
  const holidays: HolidayRecord[] = []
  const seen = new Set<string>()

  const addHoliday = (name: string, date: Date, multiplier = 2) => {
    const dateStr = formatDate(date)
    if (!seen.has(dateStr)) {
      seen.add(dateStr)
      holidays.push({ name, date: dateStr, type: '國定假日', multiplier })
    }
  }

  // 固定假日
  for (const h of FIXED_HOLIDAYS) {
    const d = new Date(year, h.month - 1, h.day)
    addHoliday(h.name, d)

    const sub = applySubstituteHoliday(d, year)
    if (sub) addHoliday(`${h.name}（補假）`, sub)
  }

  // 農曆假日：優先用 API 資料，fallback 到查表
  const lunar = lunarOverride || LUNAR_HOLIDAYS[year]
  if (lunar) {
    for (const h of lunar) {
      const d = new Date(year, h.month - 1, h.day)
      addHoliday(h.name, d)

      const sub = applySubstituteHoliday(d, year)
      if (sub) addHoliday(`${h.name}（補假）`, sub)
    }
  }

  return holidays.sort((a, b) => a.date.localeCompare(b.date))
}

// ══════════════════════════════════════════════════════════════
//  排班規則快照 — 寫入 scheduling_rules_snapshot 供排班引擎參考
// ══════════════════════════════════════════════════════════════

interface RuleSnapshot {
  category: string
  rule_key: string
  title: string
  value: string
  law_ref: string
  effective_year: number
}

/**
 * 基本工資歷年表（勞動部公告）
 * 新年度公告後需在此新增一行即可
 */
const BASIC_WAGE_TABLE: Record<number, { monthly: number; hourly: number }> = {
  2024: { monthly: 27470, hourly: 183 },
  2025: { monthly: 28590, hourly: 190 },
  2026: { monthly: 28590, hourly: 190 },
  // 未來年份：cron 執行時若查不到，使用最近已知的值
}

function getBasicWage(year: number): { monthly: number; hourly: number } {
  if (BASIC_WAGE_TABLE[year]) return BASIC_WAGE_TABLE[year]
  // fallback: 用最近一年已知的數據
  const knownYears = Object.keys(BASIC_WAGE_TABLE).map(Number).sort((a, b) => b - a)
  const nearest = knownYears.find(y => y <= year) || knownYears[0]
  return BASIC_WAGE_TABLE[nearest]
}

function generateSchedulingRules(year: number): RuleSnapshot[] {
  const wage = getBasicWage(year)

  return [
    { category: '工時', rule_key: 'daily_max', title: '每日正常工時上限', value: '8', law_ref: '勞基法 §30', effective_year: year },
    { category: '工時', rule_key: 'weekly_max', title: '每週正常工時上限', value: '40', law_ref: '勞基法 §30', effective_year: year },
    { category: '工時', rule_key: 'daily_total_max', title: '每日上限（含加班）', value: '12', law_ref: '勞基法 §32', effective_year: year },
    { category: '加班', rule_key: 'monthly_overtime_max', title: '每月加班上限', value: '46', law_ref: '勞基法 §32', effective_year: year },
    { category: '加班', rule_key: 'monthly_overtime_ext', title: '延長加班上限', value: '54', law_ref: '勞基法 §32', effective_year: year },
    { category: '加班', rule_key: 'quarterly_overtime_ext', title: '三個月加班上限', value: '138', law_ref: '勞基法 §32', effective_year: year },
    { category: '輪班', rule_key: 'shift_interval', title: '輪班間隔', value: '11', law_ref: '勞基法 §34', effective_year: year },
    { category: '輪班', rule_key: 'shift_interval_min', title: '輪班間隔（經同意縮短）', value: '8', law_ref: '勞基法 §34', effective_year: year },
    { category: '休息', rule_key: 'weekly_rest_day', title: '每週例假', value: '1', law_ref: '勞基法 §36', effective_year: year },
    { category: '休息', rule_key: 'consecutive_work_max', title: '連續工作上限', value: '6', law_ref: '勞基法 §36', effective_year: year },
    { category: '薪資', rule_key: 'basic_monthly', title: '基本月薪', value: String(wage.monthly), law_ref: '勞基法 §21', effective_year: year },
    { category: '薪資', rule_key: 'basic_hourly', title: '基本時薪', value: String(wage.hourly), law_ref: '勞基法 §21', effective_year: year },
    { category: '夜間', rule_key: 'female_night_start', title: '女性夜間工作限制起', value: '22', law_ref: '勞基法 §49', effective_year: year },
    { category: '夜間', rule_key: 'female_night_end', title: '女性夜間工作限制止', value: '6', law_ref: '勞基法 §49', effective_year: year },
  ]
}

// ══════════════════════════════════════════════════════════════
//  Edge Function Handler
// ══════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const now = new Date()
    const currentYear = now.getFullYear()
    const targetYears = [currentYear, currentYear + 1]

    // 可透過 body 指定特定年份
    let body: { years?: number[] } = {}
    try { body = await req.json() } catch { /* no body is fine */ }
    const years = body.years?.length ? body.years : targetYears

    const results: Record<number, { holidays: number; rules: number; source: string }> = {}
    const warnings: string[] = []

    for (const year of years) {
      // ── 1. 取得農曆假日資料（API 優先，查表 fallback） ──
      let lunarSource = 'lookup_table'
      let lunarData: Array<{ month: number; day: number; name: string }> | null = null

      // 先嘗試政府 API
      const govData = await fetchGovHolidays(year)
      if (govData && govData.length >= 3) {
        lunarData = govData
        lunarSource = 'gov_api'
      } else if (LUNAR_HOLIDAYS[year]) {
        lunarData = LUNAR_HOLIDAYS[year]
        lunarSource = 'lookup_table'
      } else {
        // 查表也沒有 — 只能產生固定假日
        lunarSource = 'fixed_only'
        warnings.push(
          `⚠️ ${year} 年無農曆假日資料（查表僅涵蓋至 ${LOOKUP_TABLE_LAST_YEAR} 年，政府 API 亦未回傳）。` +
          `僅產生固定假日（元旦/228/兒童節/勞動節/國慶），春節/端午/中秋需手動新增。`
        )
      }

      // ── 2. 產生假日 ──
      const holidays = generateHolidaysForYear(year, lunarData)

      // 先刪除該年度的國定假日（保留公司假日）
      await supabase
        .from('holidays')
        .delete()
        .eq('type', '國定假日')
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)

      if (holidays.length > 0) {
        const { error: insertErr } = await supabase
          .from('holidays')
          .insert(holidays)

        if (insertErr) {
          console.error(`Failed to insert holidays for ${year}:`, insertErr)
          throw insertErr
        }
      }

      // ── 3. 產生排班規則快照 ──
      const rules = generateSchedulingRules(year)

      const { error: ruleErr } = await supabase
        .from('scheduling_rules_snapshot')
        .upsert(rules, { onConflict: 'rule_key,effective_year' })

      if (ruleErr) {
        console.warn(`scheduling_rules_snapshot upsert warning:`, ruleErr.message)
      }

      results[year] = {
        holidays: holidays.length,
        rules: rules.length,
        source: lunarSource,
      }
    }

    // ── 4. 查表到期預警 ──
    const maxRequestedYear = Math.max(...years)
    const yearsRemaining = LOOKUP_TABLE_LAST_YEAR - maxRequestedYear

    if (yearsRemaining <= 2) {
      const urgency = yearsRemaining <= 0 ? 'critical' : 'warning'
      const msg = yearsRemaining <= 0
        ? `🚨 農曆假日查表已耗盡（最後年份 ${LOOKUP_TABLE_LAST_YEAR}），${maxRequestedYear} 年後需依賴政府 API 或手動更新。請儘速更新 Edge Function 的 LUNAR_HOLIDAYS 查表。`
        : `⚠️ 農曆假日查表剩餘 ${yearsRemaining} 年（至 ${LOOKUP_TABLE_LAST_YEAR}），請提前更新 LUNAR_HOLIDAYS 查表以確保假日資料持續產生。`

      warnings.push(msg)

      // 寫入系統警告事件，讓管理後台能顯示
      await supabase.from('business_events').insert({
        event_id: `holidays_expiry_warn_${Date.now()}`,
        event_type: 'system.warning',
        domain: 'HR',
        action: 'lookup_table_expiry',
        payload: {
          urgency,
          lookup_table_last_year: LOOKUP_TABLE_LAST_YEAR,
          years_remaining: yearsRemaining,
          message: msg,
        },
        metadata: { source: 'refresh-holidays', requires_action: true },
        timestamp: now.toISOString(),
      })
    }

    // ── 5. 更新 triggers 表的 last_run ──
    await supabase
      .from('triggers')
      .update({ last_run: now.toISOString() })
      .eq('name', '假日與排班規則刷新')

    // ── 6. 寫入 business_events 審計紀錄 ──
    await supabase.from('business_events').insert({
      event_id: `holidays_refresh_${Date.now()}`,
      event_type: 'holidays.refreshed',
      domain: 'HR',
      action: 'refresh',
      payload: { years, results, warnings },
      metadata: { source: 'cron', triggered_at: now.toISOString() },
      timestamp: now.toISOString(),
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: `已刷新 ${years.join(', ')} 年度假日與排班規則`,
        results,
        warnings: warnings.length > 0 ? warnings : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err: unknown) {
    console.error('refresh-holidays error:', err)
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
