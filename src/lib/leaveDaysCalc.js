// 請假天數計算 — 跟 LIFF (sme-ops-liff/src/pages/Leave.jsx) 對齊的核心邏輯。
// 改任何一邊請也改另一邊，避免主系統 / LIFF 算出來不一致。

/**
 * 計算工作天數（排除週六日 + 國定假日）
 * @param {string} startStr 'YYYY-MM-DD'
 * @param {string} endStr   'YYYY-MM-DD'，空值視為單日
 * @param {string[]} holidayList 國定假日清單 ['YYYY-MM-DD', ...]
 * @returns {number} 工作天數（最少 1）
 */
export function countWorkDays(startStr, endStr, holidayList = []) {
  if (!startStr) return 0
  const start = new Date(startStr)
  const end = new Date(endStr || startStr)
  const holidaySet = new Set(holidayList)
  let count = 0
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay() // 0=Sun, 6=Sat
    const dateStr = d.toISOString().slice(0, 10)
    if (day !== 0 && day !== 6 && !holidaySet.has(dateStr)) {
      count++
    }
  }
  return Math.max(1, count)
}

/**
 * 跨日時數差（時段 mode 用）：HH:MM → HH:MM
 * 跨日 end <= start 自動 +24h
 */
export function diffHours(startTime, endTime) {
  if (!startTime || !endTime) return 0
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) mins += 24 * 60
  return mins / 60
}

/**
 * 把計算出的天/時往上對齊到 step 倍數
 * 例 1.3 天 step=0.5 → 1.5 天
 */
export function snapToStep(val, step) {
  if (!val || !step) return val
  return Math.ceil(val / step - 1e-9) * step
}

/**
 * 計算請假天數（依 unit）
 * @param {Object} form { unit, start_date, end_date, start_time, end_time }
 * @param {string[]} holidays
 * @param {number} step
 * @returns {number} 天數（snap 過 step）
 */
export function calcLeaveDays(form, holidays = [], step = 0.5) {
  if (!form?.start_date) return 0
  if (form.unit === 'hour') {
    // 時段 mode：跨日時數 / 8 換成天
    const hours = diffHours(form.start_time, form.end_time)
    return snapToStep(hours / 8, step)
  }
  // 日 mode：扣週末/國假
  const wd = countWorkDays(form.start_date, form.end_date || form.start_date, holidays)
  return snapToStep(wd, step)
}

/**
 * 檢查日期是否與既有假單重疊
 * @param {Object} form { start_date, end_date }
 * @param {Array} records 既有假單清單
 * @param {number|null} editingId 編輯中的 id（跳過 self）
 * @returns {Object|null} 重疊的單，沒重疊回 null
 */
export function findDateOverlap(form, records, editingId = null) {
  if (!form?.start_date) return null
  const startD = new Date(form.start_date)
  const endD = new Date(form.end_date || form.start_date)
  return records.find(r => {
    if (r.id === editingId) return false
    if (r.status === '已拒絕' || r.status === '已取消') return false
    const rStart = new Date(r.start_date)
    const rEnd = new Date(r.end_date || r.start_date)
    return startD <= rEnd && endD >= rStart
  }) || null
}
