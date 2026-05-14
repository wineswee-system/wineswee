// 全站日期/時間 helper — 一律走台北時區（Asia/Taipei）
//
// 為什麼需要：
//   原本 `new Date().toISOString().slice(0, 10)` 是 UTC 日期。
//   台灣凌晨 0~8am 之間呼叫會回**前一天**（UTC 跟台北差 8 小時），
//   造成「今日打卡」、「申請日 default」、「日期 filter」會錯一天。
//
// 新 code 一律 import 這個 lib，不要再用：
//   ❌ new Date().toISOString().slice(0, 10)
//   ❌ d.toLocaleString() / toLocaleDateString() (沒指定 timeZone)

const TW = 'Asia/Taipei'

/**
 * 今日（台北）'YYYY-MM-DD'
 * 取代 `new Date().toISOString().slice(0, 10)`
 */
export function todayTW() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TW })
}

/**
 * 任意 Date / ISO string → 'YYYY-MM-DD'（台北日期）
 */
export function toTWDate(d) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-CA', { timeZone: TW })
}

/**
 * 顯示用日期 'YYYY/MM/DD'（台北）
 */
export function fmtDateTW(d) {
  const iso = toTWDate(d)
  return iso ? iso.replace(/-/g, '/') : ''
}

/**
 * 顯示用日期時間 'YYYY/MM/DD HH:MM'（台北 24h）
 */
export function fmtDateTimeTW(d) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  const dateStr = fmtDateTW(date)
  const timeStr = date.toLocaleTimeString('zh-TW', {
    timeZone: TW,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${dateStr} ${timeStr}`
}

/**
 * 顯示用時間 'HH:MM'（台北 24h）
 */
export function fmtTimeTW(d) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-TW', {
    timeZone: TW,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * 現在台北時間 'HH:MM'（給打卡 default 用）
 */
export function nowTimeTW() {
  return fmtTimeTW(new Date())
}

/**
 * N 天前的台北日期 'YYYY-MM-DD'
 * 例 nDaysAgoTW(7) = 一週前
 */
export function nDaysAgoTW(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toTWDate(d)
}

/**
 * 月初 'YYYY-MM-01'（台北）
 */
export function monthStartTW(d = new Date()) {
  const iso = toTWDate(d)
  return iso ? iso.slice(0, 7) + '-01' : ''
}
