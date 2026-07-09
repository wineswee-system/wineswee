/**
 * 薪資逐筆調整套用引擎
 *
 * 不動 payroll.js 既有計算邏輯。提供純函數 applyAdjustmentsToBatchItem，
 * 把 active adjustments 的差異套到 Salary.jsx 已算好的 batchPreview item 上，
 * 重算受影響欄位（late_deduction / overtime_pay / absence_deduction /
 *                attendance_bonus / gross / totalDeductions / netSalary）。
 *
 * 不重算：勞健保 / 勞退 / 所得稅 / 法扣 — 沿用既有值（這些不會被 adjustment 影響）。
 *
 * Adjustment JSONB 規範（與 SQL R3 一致）：
 *   attendance.late_minutes        : {"value": <int>}
 *   attendance.ot_hours_weekday    : {"value": <numeric>}
 *   attendance.ot_hours_holiday    : {"value": <numeric>}
 *   leave.leave_days               : {"days": <numeric>, "bucket": "unpaid"|"half"}
 *   leave.leave_pay_mode           : {"mode": "unpaid"|"half"|"paid", "days": <numeric>}
 *   overtime.ot_hours_weekday      : {"value": <numeric>}
 *   overtime.ot_hours_holiday      : {"value": <numeric>}
 *   manual_bonus.amount            : original = null, new = {"amount": <numeric>, "label": "..."}
 *   manual_deduction.amount        : original = null, new = {"amount": <numeric>, "label": "..."}
 */

// ── helpers ──────────────────────────────────────────────────────────────

function n(v, d = 0) {
  const x = Number(v)
  return Number.isFinite(x) ? x : d
}

/**
 * 從 batchItem 反推時薪。
 * Salary.jsx 算薪時：lateDeduction = floor(lateMins/30) × round(hourly × 0.5)
 *                    unpaidDeduction = round(unpaidHours × hourly)
 *                    regular_overtime_pay (weekday) = round(otWeekday × hourly × 1.34) 之類
 * 多個來源都能反推；優先用最不容易整數誤差的那條。
 * 沒辦法反推 → 回 0（會導致重算金額錯，呼叫端要警告）。
 */
export function deriveHourlyRate(item) {
  if (n(item.hourly_rate) > 0) return n(item.hourly_rate)

  // 從 unpaidDeduction / unpaidHours 反推（無 floor、最精準）
  const uh = n(item.unpaidHours)
  const ud = n(item.unpaidDeduction)
  if (uh > 0 && ud > 0) return Math.round(ud / uh)

  // 從加班費反推（平日）
  const owd = n(item.otWeekday)
  const orp = n(item.regular_overtime_pay)
  if (owd > 0 && orp > 0) {
    if (owd <= 2) return Math.round(orp / owd / 1.34)
    return Math.round(orp / (2 * 1.34 + (owd - 2) * 1.67))
  }

  // 從遲到扣反推（有 floor，不精準但聊勝於無）
  const lm = n(item.lateMins)
  const ld = n(item.lateDeduction)
  if (lm >= 30 && ld > 0) {
    const blocks = Math.floor(lm / 30)
    return Math.round((ld / blocks) * 2)
  }

  return 0
}

// ── OT 公式（對齊 payroll.js / generate_payroll §24/§39）──
function otPayWeekday(hours, hourly) {
  if (hours <= 0 || hourly <= 0) return 0
  if (hours <= 2) return Math.round(hours * hourly * 1.34)
  return Math.round(2 * hourly * 1.34 + (hours - 2) * hourly * 1.67)
}

function otPayHoliday(hours, hourly) {
  if (hours <= 0 || hourly <= 0) return 0
  const rd1 = Math.min(hours, 2)
  const rd2 = Math.min(Math.max(hours - 2, 0), 6)
  const rd3 = Math.max(hours - 8, 0)
  return Math.round(rd1 * hourly * 1.34 + rd2 * hourly * 1.67 + rd3 * hourly * 2.67)
}

// ── main ──────────────────────────────────────────────────────────────────

/**
 * 套用 adjustments 到 batchPreview item，回傳新 item（不 mutate 原物件）。
 *
 * @param {object} item  Salary.jsx 算好的 batchPreview 元素（含 lateMins / otWeekday / otHoliday / unpaidHours / halfPayHours / 各扣項小計 / gross / totalDeductions / netSalary 等）
 * @param {Array<object>} adjustments  active 調整列表（superseded_at IS NULL 的 salary_adjustments）
 * @param {object} [context]  額外脈絡：{ hourlyRate, attendanceBonusBase, salaryType }
 *                            未提供時嘗試從 item 反推
 * @returns {object}  新 item，含受影響欄位重算後的值 + adjustments 摘要欄位
 */
export function applyAdjustmentsToBatchItem(item, adjustments, context = {}) {
  if (!item) return item
  const list = Array.isArray(adjustments) ? adjustments.filter(a => !a.superseded_at) : []
  if (list.length === 0) return { ...item, _adjustmentsCount: 0, _manualBonusTotal: 0, _manualBackpayTotal: 0, _manualDeductionTotal: 0 }

  // ── 1. 計算 effective 聚合值（套用 adjustment 差量）──
  let lateMins     = n(item.lateMins)
  let otWeekday    = n(item.otWeekday)
  let otHoliday    = n(item.otHoliday)
  let unpaidHours  = n(item.unpaidHours)
  let halfPayHours = n(item.halfPayHours)
  let manualBonus  = 0
  let manualDeduct = 0
  let manualBackpay = 0

  for (const adj of list) {
    const orig = adj.original_value || {}
    const newV = adj.new_value     || {}
    const stype = adj.source_type
    const field = adj.field

    if (stype === 'attendance' || stype === 'overtime') {
      const o = n(orig.value)
      const v = n(newV.value)
      if      (field === 'late_minutes')     lateMins  += (v - o)
      else if (field === 'ot_hours_weekday') otWeekday += (v - o)
      else if (field === 'ot_hours_holiday') otHoliday += (v - o)
    } else if (stype === 'leave') {
      if (field === 'leave_days') {
        const od = n(orig.days)
        const nd = n(newV.days)
        const bucket = newV.bucket || orig.bucket || 'unpaid'
        const deltaHours = (nd - od) * 8
        if (bucket === 'half') halfPayHours += deltaHours
        else                   unpaidHours  += deltaHours
      } else if (field === 'leave_pay_mode') {
        const days = n(orig.days ?? newV.days)
        const om = orig.mode || 'unpaid'
        const nm = newV.mode || 'unpaid'
        const hours = days * 8
        if (om === 'unpaid')      unpaidHours  -= hours
        else if (om === 'half')   halfPayHours -= hours
        if (nm === 'unpaid')      unpaidHours  += hours
        else if (nm === 'half')   halfPayHours += hours
        // 'paid' → 不進任何桶
      }
    } else if (stype === 'manual_bonus' && field === 'amount') {
      manualBonus += n(newV.amount)
    } else if (stype === 'manual_backpay' && field === 'amount') {
      manualBackpay += n(newV.amount)
    } else if (stype === 'manual_deduction' && field === 'amount') {
      manualDeduct += n(newV.amount)
    }
  }

  // Guards — 不允許負值
  lateMins     = Math.max(0, lateMins)
  otWeekday    = Math.max(0, otWeekday)
  otHoliday    = Math.max(0, otHoliday)
  unpaidHours  = Math.max(0, unpaidHours)
  halfPayHours = Math.max(0, halfPayHours)

  // ── 2. 取時薪（context > item.hourly_rate > 反推）──
  const hourly = n(context.hourlyRate) > 0 ? n(context.hourlyRate) : deriveHourlyRate(item)
  const isHourly = (context.salaryType ?? item.salary_type) === 'hourly'

  // ── 3. 重算受影響欄位 ──
  const newLateDeduction       = Math.floor(lateMins / 30) * Math.round(hourly * 0.5)
  const newRegularOvertimePay  = otPayWeekday(otWeekday, hourly)
  const newExtraOvertimePay    = otPayHoliday(otHoliday, hourly)
  const newOvertimePay         = newRegularOvertimePay + newExtraOvertimePay
  const newUnpaidDeduction     = isHourly ? 0 : Math.round(unpaidHours  * hourly)
  const newHalfPayDeduction    = isHourly ? 0 : Math.round(halfPayHours * hourly * 0.5)
  const newAbsenceDeduction    = newUnpaidDeduction + newHalfPayDeduction

  // attendance_bonus 復原（context 提供時用 base；否則用既有 item.attendance_bonus 加上「之前因 0 化所減去的」）
  // 簡化：如果 context.attendanceBonusBase 提供 → 用它做基準；否則直接沿用 item.attendance_bonus
  // 這樣未提供 context 時，遲到/請假調整後 attendance_bonus 不會自動恢復為全額，要在 Salary.jsx 提供 base 才會
  const bonusBase = n(context.attendanceBonusBase ?? item.attendance_bonus_base)
  const hasLateOrAbsent = lateMins > 0 || (unpaidHours + halfPayHours) > 0
  const newAttendanceBonus = bonusBase > 0
    ? (hasLateOrAbsent ? 0 : bonusBase)
    : n(item.attendance_bonus) // fallback：不知道 base 就保持原值

  // ── 4. 重建 gross ──
  // 用 item 已有的各加項欄位（base/role/meal/transport/night/cross/other_custom），
  // attendance_bonus 跟 overtime_pay 用新值，加上 manual_bonus
  const newGross =
      n(item.base_salary)
    + n(item.role_allowance)
    + n(item.meal_allowance)
    + n(item.transport_allowance)
    + n(item.night_allowance)
    + n(item.cross_store_allowance)
    + n(item.other_custom_total)
    + newAttendanceBonus
    + newOvertimePay
    + n(item.policyBonus)
    + manualBonus
    + manualBackpay

  // ── 5. 重建 totalDeductions ──
  // 保留：勞保+健保+勞退+所得稅+法扣（這些 adjustment 不會動）
  // 重算：absence + late
  // 加：manual_deduction
  const fixedDeductions =
      n(item.laborInsurance)
    + n(item.healthInsurance)
    + n(item.pension)
    + n(item.income_tax_withheld)         // 業務鐵則：預設 0，但若 calculateNetSalary 算了仍保留
    + n(item.legal_deduction)

  const newTotalDeductions =
      fixedDeductions
    + newAbsenceDeduction
    + newLateDeduction
    + manualDeduct

  const newNetSalary = newGross - newTotalDeductions

  return {
    ...item,
    // 聚合計數
    lateMins,
    otWeekday,
    otHoliday,
    unpaidHours,
    halfPayHours,
    // 重算後的金額
    lateDeduction:        newLateDeduction,
    regular_overtime_pay: newRegularOvertimePay,
    extra_overtime_pay:   newExtraOvertimePay,
    overtimePay:          newOvertimePay,
    unpaidDeduction:      newUnpaidDeduction,
    halfPayDeduction:     newHalfPayDeduction,
    absenceDeduction:     newAbsenceDeduction,
    attendance_bonus:     newAttendanceBonus,
    gross:                newGross,
    totalDeductions:      newTotalDeductions,
    netSalary:            newNetSalary,
    // adjustment 摘要 — 給 UI 顯示用
    _adjustmentsCount:    list.length,
    _manualBonusTotal:    manualBonus,
    _manualBackpayTotal:  manualBackpay,
    _manualDeductionTotal: manualDeduct,
  }
}

/**
 * 計算單筆 adjustment 對 net salary 的影響金額。
 * 用於稽核儀表板「影響金額」欄。
 * 簡化版：只算明顯的單向 delta（精準度足夠用於排序/篩選）。
 *
 * @param {object} adjustment  單筆 salary_adjustment row
 * @param {number} hourlyRate  該員工時薪
 * @returns {number}  正值 = 增加員工實領（紅包/有薪假）；負值 = 減少實領（扣項/還原請假扣）
 */
export function estimateAdjustmentImpact(adjustment, hourlyRate = 0) {
  if (!adjustment) return 0
  const orig = adjustment.original_value || {}
  const newV = adjustment.new_value     || {}
  const stype = adjustment.source_type
  const field = adjustment.field
  const h = n(hourlyRate)

  if (stype === 'attendance' || stype === 'overtime') {
    if (field === 'late_minutes') {
      // 影響 = (orig - new) / 30 × hourly × 0.5（減少分鐘 = 員工拿到更多）
      const blocksDelta = Math.floor(n(orig.value) / 30) - Math.floor(n(newV.value) / 30)
      return Math.round(blocksDelta * h * 0.5)
    }
    if (field === 'ot_hours_weekday') {
      return otPayWeekday(n(newV.value), h) - otPayWeekday(n(orig.value), h)
    }
    if (field === 'ot_hours_holiday') {
      return otPayHoliday(n(newV.value), h) - otPayHoliday(n(orig.value), h)
    }
  } else if (stype === 'leave') {
    const bucket = newV.bucket || orig.bucket || 'unpaid'
    const rate = bucket === 'half' ? h * 0.5 : h
    if (field === 'leave_days') {
      const delta = n(orig.days) - n(newV.days)  // 減少請假天數 = 員工增加
      return Math.round(delta * 8 * rate)
    }
    if (field === 'leave_pay_mode') {
      const days = n(orig.days ?? newV.days)
      const factor = (mode) => mode === 'paid' ? 0 : mode === 'half' ? 0.5 : 1
      const oldRate = factor(orig.mode || 'unpaid') * h
      const newRate = factor(newV.mode || 'unpaid') * h
      return Math.round((oldRate - newRate) * days * 8)
    }
  } else if (stype === 'manual_bonus' && field === 'amount') {
    return n(newV.amount)
  } else if (stype === 'manual_deduction' && field === 'amount') {
    return -n(newV.amount)
  }
  return 0
}
