/**
 * Shared Schedule Utilities
 *
 * Extracted from schedulingAi.js, schedulingAlgo.js, and laborLaw.js
 * to eliminate duplication and provide a single source of truth for:
 * - Time parsing & shift hour calculations
 * - Date utilities (monthly / weekly)
 * - Absence type definitions
 * - Cross-store eligibility checks
 */

// ══════════════════════════════════════════════════════════════
//  Time Helpers
// ══════════════════════════════════════════════════════════════

/** Parse "HH:MM" or "HHMM" to decimal hours (e.g., "09:30" → 9.5) */
export function parseTime(t) {
  if (!t) return 0
  const str = String(t).replace(/：/g, ':')
  const [h, m] = str.includes(':') ? str.split(':').map(Number) : [Number(str.slice(0, -2) || 0), Number(str.slice(-2) || 0)]
  return (h || 0) + (m || 0) / 60
}

/** Calculate working hours for a shift definition (handles midnight crossing) */
export function getShiftHours(def) {
  const s = parseTime(def.start_time)
  const e = parseTime(def.end_time)
  return e > s ? e - s : (24 - s + e)
}

/** Get the effective end hour (adds 24 for midnight-crossing shifts) */
export function effectiveEndHour(def) {
  const s = parseTime(def.start_time)
  const e = parseTime(def.end_time)
  return e < s ? e + 24 : e
}

/** Check if a shift overlaps 22:00–06:00 */
export function isNightShift(def) {
  const s = parseTime(def.start_time)
  const e = parseTime(def.end_time)
  return s >= 22 || e <= 6 || e < s
}

/** Calculate gap in hours between two shifts on consecutive days */
export function shiftGapHours(prevDef, currDef) {
  const prevEnd = effectiveEndHour(prevDef)
  const currStart = parseTime(currDef.start_time)
  return (currStart + 24) - prevEnd
}

// ══════════════════════════════════════════════════════════════
//  Date Helpers
// ══════════════════════════════════════════════════════════════

/** Get all dates for a given month as YYYY-MM-DD strings */
export function getMonthDates(year, month) {
  const dates = []
  const daysInMonth = new Date(year, month, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    // Use local date format to avoid timezone issues with toISOString()
    const mm = String(month).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    dates.push(`${year}-${mm}-${dd}`)
  }
  return dates
}

/** Split a date array into weekly chunks (Mon–Sun aligned). Last chunk may be shorter. */
export function splitIntoWeeks(dates) {
  if (!dates || dates.length === 0) return []
  const weeks = []
  let currentWeek = []

  for (const date of dates) {
    const dow = new Date(date).getDay() // 0=Sun
    // Start new week on Monday (dow=1), unless it's the very first date
    if (dow === 1 && currentWeek.length > 0) {
      weeks.push(currentWeek)
      currentWeek = []
    }
    currentWeek.push(date)
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)

  return weeks
}

/** Get 7 dates for a week given an offset from current week */
export function getWeekDates(offset = 0) {
  const now = new Date()
  const dayOfWeek = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayOfWeek + 1 + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    // Use local date format to avoid timezone issues
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  })
}

/** Get day-of-week label in Chinese for a date string */
export function getDayLabel(dateStr) {
  const labels = ['日', '一', '二', '三', '四', '五', '六']
  return labels[new Date(dateStr).getDay()]
}

/** Format YYYY-MM string from year and month */
export function formatYearMonth(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Parse YYYY-MM string into { year, month } */
export function parseYearMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  return { year: y, month: m }
}

// ══════════════════════════════════════════════════════════════
//  Absence Types
// ══════════════════════════════════════════════════════════════

export const ABSENCE_TYPES = {
  REST: '休',
  COMP_OFF: '補休',
  SICK: '病',
  ANNUAL: '特休',
  MEETING: '會議',
  MATERNITY: '產',
}

export const ABSENCE_CONFIG = {
  '休':   { label: '休假', color: '#6b7280', icon: '😴', countsAsRest: true },
  '補休': { label: '補休', color: '#3b82f6', icon: '🔄', countsAsRest: true },
  '病':   { label: '病假', color: '#ef4444', icon: '🏥', countsAsRest: false },
  '特休': { label: '特休', color: '#10b981', icon: '🌴', countsAsRest: true },
  '會議': { label: '會議', color: '#8b5cf6', icon: '📋', countsAsRest: false },
  '產':   { label: '產假', color: '#f59e0b', icon: '👶', countsAsRest: true },
}

/** Check if a shift value represents any type of absence */
export function isAbsence(shift) {
  if (!shift) return false
  return Object.values(ABSENCE_TYPES).includes(shift)
}

/** Get the display config for an absence type */
export function getAbsenceConfig(type) {
  return ABSENCE_CONFIG[type] || null
}

/** All absence labels for dropdowns */
export function getAbsenceOptions() {
  return Object.entries(ABSENCE_CONFIG).map(([value, cfg]) => ({
    value,
    label: cfg.label,
    icon: cfg.icon,
  }))
}

// ══════════════════════════════════════════════════════════════
//  Cross-Store Helpers
// ══════════════════════════════════════════════════════════════

/** Check if an employee can work at a given store */
export function canWorkAtStore(employee, storeName, locations = []) {
  if (!storeName) return true
  if (employee.store === storeName) return true
  const additionalStores = employee.additional_stores || []
  if (additionalStores.includes(storeName)) return true
  // Also check by store ID
  const targetStore = locations.find(l => l.name === storeName)
  if (targetStore && additionalStores.includes(targetStore.id)) return true
  return false
}

/** Get list of employees eligible for cross-store work at a given store */
export function getCrossStoreEligible(employees, storeName, locations = []) {
  return employees.filter(emp =>
    emp.store !== storeName && canWorkAtStore(emp, storeName, locations)
  )
}

// ══════════════════════════════════════════════════════════════
//  Monthly Scheduling Constants
// ══════════════════════════════════════════════════════════════

/** Target rest days per month (Taiwan standard: ~8-10) */
export const MONTHLY_REST_DAYS_TARGET = 10

/** Monthly overtime cap (勞基法 §32) */
export const MONTHLY_OVERTIME_CAP = 46

/** Weekly standard hours */
export const WEEKLY_STANDARD_HOURS = 40

/** Daily max hours (勞基法 §30 + §32) */
export const DAILY_MAX_HOURS = 12

/** Daily max NORMAL hours for flexible work systems (勞基法 §30-3) */
export const DAILY_MAX_NORMAL_HOURS_FLEX = 10

/** Min shift interval hours (勞基法 §34) */
export const MIN_SHIFT_INTERVAL = 11

/** Max consecutive work days — 兼職 (勞基法 §36 七休一) */
export const MAX_CONSECUTIVE_WORK_DAYS = 6
/** Max consecutive work days — 正職四週變形 (勞基法 §36 但書，2週集中工作) */
export const MAX_CONSECUTIVE_WORK_DAYS_FT = 12

/** Min rest days per week (勞基法 §36 一例一休) */
export const MIN_WEEKLY_REST_DAYS = 2

/** 4-week flexible work system constants (勞基法 §30-3) */
export const FLEX_4W_TOTAL_HOURS = 160
export const FLEX_4W_REST_DAYS = 8
export const FLEX_4W_PERIOD_WEEKS = 4

/**
 * Get scheduling constraints based on work hour system
 * @param {string} system - '標準工時' | '2週變形' | '4週變形' | '8週變形'
 */
export function getWorkSystemConstraints(system) {
  switch (system) {
    case '4週變形':
      return {
        dailyNormalMax: 10,
        dailyAbsoluteMax: 12,
        periodWeeks: 4,
        periodTotalHours: 160,
        periodRestDays: 8,
        weeklyRestMin: 1,         // 可以單週只休 1 天（但 4 週要補回 8 天）
        canConcentrateRest: true,  // 休息日可集中
      }
    case '2週變形':
      return {
        dailyNormalMax: 10,
        dailyAbsoluteMax: 12,
        periodWeeks: 2,
        periodTotalHours: 84,
        periodRestDays: 4,
        weeklyRestMin: 1,
        canConcentrateRest: true,
      }
    case '8週變形':
      return {
        dailyNormalMax: 8,
        dailyAbsoluteMax: 12,
        periodWeeks: 8,
        periodTotalHours: 320,
        periodRestDays: 16,
        weeklyRestMin: 1,
        canConcentrateRest: true,
      }
    default: // 標準工時
      return {
        dailyNormalMax: 8,
        dailyAbsoluteMax: 12,
        periodWeeks: 1,
        periodTotalHours: 40,
        periodRestDays: 2,
        weeklyRestMin: 2,
        canConcentrateRest: false,
      }
  }
}

/** Weekend days (JS getDay(): 0=Sun, 5=Fri, 6=Sat) — business uses Fri+Sat as weekend */
export const WEEKEND_DAYS = [5, 6]

/** Weekday days (Sun~Thu) */
export const WEEKDAY_DAYS = [0, 1, 2, 3, 4]

/** Check if a JS getDay() value is a weekend day */
export function isWeekendDay(dayOfWeek) {
  return WEEKEND_DAYS.includes(dayOfWeek)
}

// ── Variable-period cycle helpers ──────────────────────────
// 給定日期 + 變形工時 system + anchor，算出該日屬於哪個 cycle，
// 以及該 cycle 的起迄、總時數上限、休假天數要求。
//
// system: '標準工時' | '2週變形' | '4週變形' | '8週變形'
// anchorDate: 'YYYY-MM-DD' string or Date (變形週期起算日)
// date: 'YYYY-MM-DD' string or Date (要查詢的日期)
//
// 回傳：
//   標準工時 / 沒 anchor → { mode: 'monthly', label: '2026-05', start, end, ...constraints }
//   變形工時 + 有 anchor → { mode: 'cycle', cycleIndex: 0, label: 'Cycle #1 (2026-05-01 ~ 2026-05-28)', start, end, ...constraints }

// 所有日期都當作 UTC midnight 處理，避免時區跳日
const _toDate = (d) => {
  if (d instanceof Date) return d
  // 'YYYY-MM-DD' → UTC midnight Date
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}
const _addDays = (d, n) => {
  const r = new Date(d.getTime())
  r.setUTCDate(r.getUTCDate() + n)
  return r
}
const _isoDate = (d) => {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const _msPerDay = 86400000

export function getCycleFor(date, system, anchorDate) {
  const constraints = getWorkSystemConstraints(system)
  const d = _toDate(date)

  // 標準工時 / 沒 anchor → 月制 fallback
  if (system === '標準工時' || !anchorDate) {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    return {
      mode: 'monthly',
      cycleIndex: null,
      label: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      start: _isoDate(start),
      end: _isoDate(end),
      ...constraints,
    }
  }

  // 變形工時：以 anchor 為基準切 cycle
  const anchor = _toDate(anchorDate)
  const cycleLenDays = constraints.periodWeeks * 7
  const diffDays = Math.floor((d.getTime() - anchor.getTime()) / _msPerDay)
  const cycleIndex = Math.floor(diffDays / cycleLenDays)
  const start = _addDays(anchor, cycleIndex * cycleLenDays)
  const end = _addDays(start, cycleLenDays - 1)

  return {
    mode: 'cycle',
    cycleIndex,
    label: `Cycle #${cycleIndex + 1} (${_isoDate(start)} ~ ${_isoDate(end)})`,
    start: _isoDate(start),
    end: _isoDate(end),
    ...constraints,
  }
}

/**
 * 列舉一段日期區間內所有 cycle 的邊界（給 UI 畫分界線用）
 * 例：4週變形 anchor=2026-05-01，問 2026-05 月內的 cycle 邊界
 *   → [{start:'2026-05-01', end:'2026-05-28', cycleIndex:0}]
 *   （5/29~5/31 已屬下一 cycle，會也包含進來）
 */
export function listCyclesInRange(rangeStart, rangeEnd, system, anchorDate) {
  if (system === '標準工時' || !anchorDate) return []
  const result = []
  const constraints = getWorkSystemConstraints(system)
  const cycleLenDays = constraints.periodWeeks * 7
  const anchor = _toDate(anchorDate)
  const rs = _toDate(rangeStart)
  const re = _toDate(rangeEnd)
  // 找 rangeStart 所屬 cycle
  const startDiff = Math.floor((rs.getTime() - anchor.getTime()) / _msPerDay)
  let idx = Math.floor(startDiff / cycleLenDays)
  while (true) {
    const cs = _addDays(anchor, idx * cycleLenDays)
    const ce = _addDays(cs, cycleLenDays - 1)
    if (cs.getTime() > re.getTime()) break
    result.push({
      cycleIndex: idx,
      start: _isoDate(cs),
      end: _isoDate(ce),
      label: `Cycle #${idx + 1}`,
    })
    idx += 1
  }
  return result
}
