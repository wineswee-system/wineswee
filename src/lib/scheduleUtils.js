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

/**
 * 依班次毛時數推算休息分鐘（公司政策階梯）：
 *   gross < 5h  → 0 分
 *   5 ≤ gross < 9h → 30 分
 *   gross ≥ 9h → 60 分（上限）
 * 不讀 break_minutes 欄位 — 班別表的舊資料一律以本公式為準。
 */
export function getRestMinutes(grossHours) {
  if (grossHours < 5) return 0
  if (grossHours < 9) return 30
  return 60
}

/** 班次淨工時（毛時數扣自動算出的休息），取代 `getShiftHours(def) - (def.break_minutes||60)/60` */
export function getNetWorkHours(def) {
  const gross = getShiftHours(def)
  return gross - getRestMinutes(gross) / 60
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

const DAY_NAMES_SUN_FIRST = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/**
 * Get operating_hours for a specific date.
 * Reads storeSettings.operating_hours or .operatingHours (camelCase fallback).
 * Returns { open, close } strings or null if not set.
 */
export function getOperatingHoursForDate(storeSettings, dateStr) {
  if (!storeSettings || !dateStr) return null
  const dow = new Date(dateStr).getDay()
  const key = DAY_NAMES_SUN_FIRST[dow]
  return storeSettings.operating_hours?.[key] || storeSettings.operatingHours?.[key] || null
}

/**
 * Source-of-truth per-day operating-hours window check.
 * A shift fits if its start/end interval (handling midnight crossing) lies
 * entirely within [open, close]. Used to GUARD shift generation/selection so
 * shifts never get assigned outside that day's OH. NEVER returns true with a
 * tolerance > 0.01h (rounding only) — the user's rule is "hardcoded, no overflow".
 *
 * @param {{start_time:string,end_time:string}} shiftDef
 * @param {string} dateStr  YYYY-MM-DD
 * @param {object} storeSettings
 * @returns {boolean} true if OH not set (no constraint) or shift fits within OH
 */
export function isShiftWithinOH(shiftDef, dateStr, storeSettings) {
  const oh = getOperatingHoursForDate(storeSettings, dateStr)
  if (!oh?.open || !oh?.close) return true
  if (!shiftDef?.start_time || !shiftDef?.end_time) return true
  const ohOpen = parseTime(oh.open)
  const ohClose = parseTime(oh.close)
  const ohCloseEff = ohClose <= ohOpen ? ohClose + 24 : ohClose
  const sh = parseTime(shiftDef.start_time)
  const eh = parseTime(shiftDef.end_time)
  const ehEff = eh <= sh ? eh + 24 : eh
  return sh >= ohOpen - 0.01 && ehEff <= ohCloseEff + 0.01
}

/**
 * Per-day window check by raw start/end hour numbers (decimal hours).
 * Same rule as isShiftWithinOH but for ad-hoc generated windows (set-cover loop, fallback).
 */
export function isWindowWithinOH(startH, grossH, dateStr, storeSettings) {
  const oh = getOperatingHoursForDate(storeSettings, dateStr)
  if (!oh?.open || !oh?.close) return true
  const ohOpen = parseTime(oh.open)
  const ohClose = parseTime(oh.close)
  const ohCloseEff = ohClose <= ohOpen ? ohClose + 24 : ohClose
  const endH = startH + grossH
  return startH >= ohOpen - 0.01 && endH <= ohCloseEff + 0.01
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

/**
 * 判斷員工是否為兼職（Part-Time）— 統一認多種 employment_type 寫法
 * 避免 DB 存 'part_time' 但 hard-code 只認 '兼職' → 演算法誤判為 FT → H3 連續上班沒擋
 */
export function isPartTime(emp) {
  if (!emp) return false
  const t = emp.employment_type
  if (t === '兼職' || t === 'PT' || t === 'pt' || t === 'part_time' || t === 'parttime') return true
  if (emp.position?.includes('PT')) return true
  return false
}

/**
 * 從 shift label 直接 parse 出 start/end time（不依賴 shift_definitions）
 *   '10:30~19:30' → { start: '10:30', end: '19:30' }
 *   '1030-1930'   → { start: '10:30', end: '19:30' }
 *   '11~20'       → { start: '11:00', end: '20:00' }
 *   '19~1'        → { start: '19:00', end: '01:00' }
 *   '早班' / '休' → null（不是時段範圍）
 */
export function parseShiftRange(shift) {
  if (!shift || typeof shift !== 'string') return null
  // 先 normalize 成 HH:MM~HH:MM，再 split
  const normalized = formatShiftLabel(shift)
  const m = normalized.match(/^(\d{1,2}:\d{2})~(\d{1,2}:\d{2})$/)
  if (!m) return null
  return { start: m[1], end: m[2] }
}

/**
 * Parse 工作範圍 column from 排班總表 export.
 * Handles the "N|HH:MM" day-of-month cross-midnight prefix used by some HR exports.
 *   "12:30~16:30"    → { start: "12:30", end: "16:30", crossMidnight: false, grossHours: 4,   netHours: 3.5 }
 *   "20:00~03|01:00" → { start: "20:00", end: "01:00", crossMidnight: true,  grossHours: 5,   netHours: 4.5 }
 *   "20:30~01:30"    → { start: "20:30", end: "01:30", crossMidnight: true,  grossHours: 5,   netHours: 4.5 }
 * Returns null if unparseable.
 */
export function parseWorkRange(raw) {
  if (!raw || typeof raw !== 'string') return null
  const parts = raw.trim().split(/[~～]/)
  if (parts.length !== 2) return null
  const startStr = parts[0].trim()
  // "N|HH:MM" or "次日HH:MM" — cross-midnight end markers
  const hadDayPrefix = /^\d+\|/.test(parts[1].trim()) || /^次日/.test(parts[1].trim())
  const endStr = parts[1].trim().replace(/^\d+\|/, '').replace(/^次日\s*/, '')
  const normalizeHM = s => {
    const m1 = s.match(/^(\d{1,2}):(\d{2})$/)
    if (m1) return `${m1[1].padStart(2, '0')}:${m1[2]}`
    const m2 = s.match(/^(\d{2})(\d{2})$/)
    if (m2) return `${m2[1]}:${m2[2]}`
    const m3 = s.match(/^(\d{1,2})$/)
    if (m3) return `${s.padStart(2, '0')}:00`
    return null
  }
  const start = normalizeHM(startStr)
  const end = normalizeHM(endStr)
  if (!start || !end) return null
  const startH = parseTime(start)
  const endH = parseTime(end)
  const crossMidnight = hadDayPrefix || endH < startH
  const gross = crossMidnight ? (24 - startH + endH) : (endH - startH)
  const net = gross - getRestMinutes(gross) / 60
  return {
    start,
    end,
    crossMidnight,
    grossHours: Math.round(gross * 100) / 100,
    netHours:   Math.round(net  * 100) / 100,
  }
}

/**
 * Normalize shift display label：把所有時間範圍格式統一成 HH:MM~HH:MM
 *   '1030-1930'   → '10:30~19:30'   (compact no-colon dash)
 *   '10:30-19:30' → '10:30~19:30'   (colon dash)
 *   '11~20'       → '11:00~20:00'   (compact tilde)
 *   '19~1'        → '19:00~01:00'
 *   '10:30~19:30' → '10:30~19:30'   (already canonical)
 * 對 absence / shift name (譬如 '早班', '休') 原樣回傳
 */
export function formatShiftLabel(shift) {
  if (!shift || typeof shift !== 'string') return shift
  // "HHMM-HHMM" / "HHMM~HHMM" (compact no-colon)
  const compactMatch = shift.match(/^(\d{2})(\d{2})\s*[-~]\s*(\d{2})(\d{2})$/)
  if (compactMatch) {
    return `${compactMatch[1]}:${compactMatch[2]}~${compactMatch[3]}:${compactMatch[4]}`
  }
  // "HH-HH" / "HH~HH" (compact integer-hours)
  const intMatch = shift.match(/^(\d{1,2})\s*[-~]\s*(\d{1,2})$/)
  if (intMatch) {
    return `${intMatch[1].padStart(2, '0')}:00~${intMatch[2].padStart(2, '0')}:00`
  }
  // "HH:MM-HH:MM" / "HH:MM~HH:MM" (full colon)
  const fullMatch = shift.match(/^(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})$/)
  if (fullMatch) {
    const [, s, e] = fullMatch
    const pad = (t) => {
      const [h, m] = t.split(':')
      return `${h.padStart(2, '0')}:${m}`
    }
    return `${pad(s)}~${pad(e)}`
  }
  // "HH:MM~次日HH:MM" — cross-midnight with 次日 (next-day) marker; strip marker, keep canonical form
  const nextDayMatch = shift.match(/^(\d{1,2}:\d{2})\s*[-~～]\s*次日\s*(\d{1,2}:\d{2})$/)
  if (nextDayMatch) {
    const pad = t => { const [h, m] = t.split(':'); return `${h.padStart(2, '0')}:${m}` }
    return `${pad(nextDayMatch[1])}~${pad(nextDayMatch[2])}`
  }
  return shift
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
  WEEKLY_OFF:  '例假',  // 勞基法 §36 一例一休的「例」— 原則不可上班
  REST_DAY:    '休息',  // 勞基法 §36 一例一休的「休」— 可上班但需加班費
  REST:        '休',    // legacy 通用「休」（未明確區分例/休的舊資料）
  COMP_OFF:    '補休',
  SICK:        '病',
  ANNUAL:      '特休',
  MEETING:     '會議',
  MATERNITY:   '產',
  PERSONAL:    '事',
  WEDDING:     '婚',
  FUNERAL:     '喪',
  OFFICIAL:    '公',
  MENSTRUAL:   '生',
  WORK_INJURY:   '工傷',
  PATERNITY:     '陪產',
  FAMILY_CARE:   '家',
  MENTAL_HEALTH: '心',
  PRENATAL:      '產檢',
  PARENTAL:      '育嬰',
  NOT_HIRED:     '未入職',
  RESIGNED:      '已離職',
}

export const ABSENCE_CONFIG = {
  // countsAsRest: 是否算進「月休配額」（公司給的法定例休/休息日）
  //   true  = 公司排的休，吃月休配額
  //   false = 員工請的假，另計，不影響月休配額
  // payRate: 薪資比例 (1.0 全薪、0.5 半薪、0 無薪)
  '例假': { label: '例假',     color: '#dc2626', icon: '🛑', countsAsRest: true,  payRate: 1.0 }, // 原則不准上班（除緊急 §40）
  '休息': { label: '休息',     color: '#6b7280', icon: '🌙', countsAsRest: true,  payRate: 1.0 }, // 可上班需加班費
  '休':   { label: '休假',     color: '#6b7280', icon: '😴', countsAsRest: true,  payRate: 1.0 }, // legacy 未明確區分
  '補休': { label: '補休',     color: '#3b82f6', icon: '🔄', countsAsRest: true,  payRate: 1.0 },
  '病':   { label: '病假',     color: '#ef4444', icon: '🏥', countsAsRest: false, payRate: 0.5 }, // 勞基法：普通病假前 30 天半薪
  '特休': { label: '特休',     color: '#10b981', icon: '🌴', countsAsRest: false, payRate: 1.0 },
  '會議': { label: '會議',     color: '#8b5cf6', icon: '📋', countsAsRest: false, payRate: 1.0 },
  '產':   { label: '產假',     color: '#f59e0b', icon: '👶', countsAsRest: false, payRate: 1.0 }, // 勞基法 §50：產假 8 週全薪
  '事':   { label: '事假',     color: '#9ca3af', icon: '✈️',  countsAsRest: false, payRate: 0   }, // 勞基法 §43：事假無薪
  '婚':   { label: '婚假',     color: '#ec4899', icon: '💍', countsAsRest: false, payRate: 1.0 },
  '喪':   { label: '喪假',     color: '#1f2937', icon: '🕯️', countsAsRest: false, payRate: 1.0 },
  '公':   { label: '公假',     color: '#0ea5e9', icon: '🏛️', countsAsRest: false, payRate: 1.0 }, // 公務指派全薪
  '生':   { label: '生理假',   color: '#f43f5e', icon: '🌸', countsAsRest: false, payRate: 0.5 }, // 性平法：每月 1 天，超過併入病假
  '工傷': { label: '公傷病假', color: '#dc2626', icon: '🚑', countsAsRest: false, payRate: 1.0 }, // 勞基法 §59：原領工資補償
  '陪產': { label: '陪產假',   color: '#0891b2', icon: '👨‍👶', countsAsRest: false, payRate: 1.0 }, // 性平法：5 天全薪
  '家':   { label: '家庭照顧假', color: '#7c3aed', icon: '🏠', countsAsRest: false, payRate: 0   }, // 性平法：每年 7 天，無薪
  '心':   { label: '心理健康假', color: '#059669', icon: '💚', countsAsRest: false, payRate: 1.0 }, // 企業自訂
  '產檢': { label: '產檢假',   color: '#db2777', icon: '🤰', countsAsRest: false, payRate: 1.0 }, // 性平法：5 次全薪
  '育嬰': { label: '育嬰假',   color: '#ea580c', icon: '👶', countsAsRest: false, payRate: 0   }, // 性平法：無薪育嬰留職停薪
  // 邊界日 — 演算法用，員工尚未/不再服務於公司，countsAsRest=false 避免吃月休配額
  '未入職': { label: '未入職',  color: '#cbd5e1', icon: '·',  countsAsRest: false, payRate: 0   },
  '已離職': { label: '已離職',  color: '#cbd5e1', icon: '·',  countsAsRest: false, payRate: 0   },
}

/**
 * 取得假別薪資比例 (1.0=全薪, 0.5=半薪, 0=無薪)
 * 上班日 / 不在 ABSENCE_CONFIG 內 → 1.0 (照算)
 */
export function getAbsencePayRate(shift) {
  if (!shift) return 1.0
  const cfg = ABSENCE_CONFIG[shift]
  return cfg ? cfg.payRate : 1.0
}

/** Check if a shift value represents any type of absence */
export function isAbsence(shift) {
  if (!shift) return false
  return Object.values(ABSENCE_TYPES).includes(shift)
}

/**
 * 是否算進「月休配額」(公司給的休)
 * 員工請的假 (特休/病/產/事假等) 不算 → 不影響月休天數
 */
export function countsAsMonthlyRest(shift) {
  if (!shift) return false
  const cfg = ABSENCE_CONFIG[shift]
  return !!cfg?.countsAsRest
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
/** Max consecutive work days — 正職 (統一七休一，原 12 天但書改 6 天) */
export const MAX_CONSECUTIVE_WORK_DAYS_FT = 6

/** Min rest days per week (勞基法 §36 一例一休) */
export const MIN_WEEKLY_REST_DAYS = 2

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

// ══════════════════════════════════════════════════════════════
//  例假 / 休息 quota 檢查（依工時制不同）
// ══════════════════════════════════════════════════════════════
//
// 各工時制 §36 要求：
// - 標準工時：每 7 天 ≥1 例 + ≥1 休
// - 2 週變形 (§30-I)：每 7 天 ≥1 例；2 週共 2 例 + 4 休
// - 4 週變形 (§30-II)：每 2 週 ≥1 例；4 週共 4 例 + 4 休（彈性集中放 OK）
// - 8 週變形 (§30-III)：同標準工時（每 7 天 1 例 1 休）
//
// legacy '休' 視為「休息」（向後相容；未來新排都明確標 '例假' / '休息'）
//
// @param schedules - [{ employee, date, shift }]
// @param workHourSystem - '標準工時' | '2週變形' | '4週變形' | '8週變形'
// @param anchorDate - 變形工時 cycle 起算日 'YYYY-MM-DD'（標準工時可省）
// @param startDate, endDate - 檢查範圍 'YYYY-MM-DD'
// @returns { errors: [{ employee, constraint, law, message, severity }], warnings: [] }
export function validateLeisureQuota({ schedules, workHourSystem, anchorDate, startDate, endDate }) {
  const errors = []
  const warnings = []
  if (!schedules || schedules.length === 0) return { errors, warnings }
  if (!startDate || !endDate) return { errors, warnings }

  const isWeeklyOff = s => s === '例假'
  const isRestDay = s => s === '休息' || s === '休' // legacy 休 算休息

  // group by employee
  const byEmp = {}
  schedules.forEach(s => {
    if (!byEmp[s.employee]) byEmp[s.employee] = []
    byEmp[s.employee].push(s)
  })

  for (const [empName, scheds] of Object.entries(byEmp)) {
    const checkRange = (rangeStart, rangeEnd, label, minWeeklyOff, minRestDays) => {
      const inRange = scheds.filter(s => s.date >= rangeStart && s.date <= rangeEnd)
      const woCount = inRange.filter(s => isWeeklyOff(s.shift)).length
      const rdCount = inRange.filter(s => isRestDay(s.shift)).length
      if (woCount < minWeeklyOff) {
        errors.push({
          employee: empName,
          constraint: 'H5',
          law: '勞基法 §36',
          message: `${empName} ${label} 例假 ${woCount}/${minWeeklyOff} 不足`,
          severity: 'error',
        })
      }
      if (rdCount < minRestDays) {
        errors.push({
          employee: empName,
          constraint: 'H5',
          law: '勞基法 §36',
          message: `${empName} ${label} 休息 ${rdCount}/${minRestDays} 不足`,
          severity: 'error',
        })
      }
    }

    if (workHourSystem === '4週變形' && anchorDate) {
      // 4 週變形：每 cycle (4 週) 4+4，且每 2 週至少 1 例
      const cycles = listCyclesInRange(startDate, endDate, '4週變形', anchorDate)
      for (const c of cycles) {
        checkRange(c.start, c.end, c.label, 4, 4)
        // 每 2 週子窗口 ≥1 例
        const cs = _toDate(c.start)
        for (let w = 0; w < 4; w += 2) {
          const subStart = _addDays(cs, w * 7)
          const subEnd = _addDays(subStart, 13)
          const inSub = scheds.filter(s => s.date >= _isoDate(subStart) && s.date <= _isoDate(subEnd))
          const woInSub = inSub.filter(s => isWeeklyOff(s.shift)).length
          if (woInSub < 1) {
            errors.push({
              employee: empName,
              constraint: 'H5',
              law: '勞基法 §36',
              message: `${empName} ${_isoDate(subStart)}~${_isoDate(subEnd)} 2 週內缺例假`,
              severity: 'error',
            })
          }
        }
      }
    } else if (workHourSystem === '2週變形' && anchorDate) {
      // 2 週變形：每 cycle 2+4
      const cycles = listCyclesInRange(startDate, endDate, '2週變形', anchorDate)
      for (const c of cycles) {
        checkRange(c.start, c.end, c.label, 2, 4)
      }
    } else {
      // 標準工時 / 8 週變形 / 沒 anchor → 每 7 天 ≥1 例 + ≥1 休
      // 以 startDate 為基準切 7-day windows
      const start = _toDate(startDate)
      const end = _toDate(endDate)
      const totalDays = Math.floor((end.getTime() - start.getTime()) / _msPerDay) + 1
      for (let i = 0; i + 7 <= totalDays; i += 7) {
        const ws = _addDays(start, i)
        const we = _addDays(ws, 6)
        const wsStr = _isoDate(ws)
        const weStr = _isoDate(we)
        checkRange(wsStr, weStr, `${wsStr}~${weStr}`, 1, 1)
      }
    }
  }

  return { errors, warnings }
}
