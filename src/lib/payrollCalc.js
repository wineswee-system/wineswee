/**
 * 批次計薪 — 共用邏輯
 *
 * 抽自 Salary.jsx handleBatchPayroll，給 /hr/salary + /otx 共用。
 * 純 function：吃輸入、回傳 preview 陣列，不碰任何 React state。
 *
 * 使用方式：
 *   const preview = await computeBatchPayroll({ month, orgId, employees, storeFilter })
 *   setBatchPreview(preview)
 *   setShowBatchModal(true)
 */

import { supabase } from './supabase'
import { calculateNetSalary, calculateInServiceDays } from './payroll'
import { loadInsuranceBrackets } from './insuranceBrackets'
import { getEffectiveBenefits, calculateBonus, getStoreIdByName } from './benefitPolicy'

export async function computeBatchPayroll({ month, orgId, employees, storeFilter }) {
  const monthStart = month + '-01'
  const [_y, _m] = month.split('-').map(Number)
  const _lastDay = new Date(_y, _m, 0).getDate()
  const monthEnd = `${month}-${String(_lastDay).padStart(2, '0')}`

  const batchBrackets = await loadInsuranceBrackets(_y)

  const scopedEmployees = storeFilter
    ? employees.filter(e => e.store === storeFilter)
    : employees

  const [attRes, otRes, lvRes, ssRes, holRes, legalRes, storeRes] = await Promise.all([
    supabase.from('attendance_records')
      .select('employee_id, store_id, date, total_hours, is_late, late_minutes')
      .eq('organization_id', orgId)
      .gte('date', monthStart).lte('date', monthEnd),
    supabase.from('overtime_requests')
      .select('employee_id, ot_hours, ot_type, ot_category, request_date, is_exception')
      .eq('status', '已核准')
      .eq('organization_id', orgId)
      .gte('request_date', monthStart).lte('request_date', monthEnd),
    supabase.from('leave_requests')
      .select('employee_id, days, hours, type')
      .eq('status', '已核准')
      .eq('organization_id', orgId)
      .gte('start_date', monthStart).lte('start_date', monthEnd),
    supabase.from('salary_structures')
      .select('*')
      .in('employee_id', scopedEmployees.map(e => e.id)),
    supabase.from('holidays')
      .select('date, is_workday')
      .gte('date', monthStart).lte('date', monthEnd),
    supabase.from('legal_deductions')
      .select('employee_id, monthly_amount, monthly_percent, deduction_type, status, started_month')
      .eq('organization_id', orgId)
      .eq('status', '進行中')
      .lte('started_month', month),
    supabase.from('stores').select('id, late_tolerance_minutes'),
  ])

  const storeToleranceMap = {}
  for (const s of (storeRes.data || [])) {
    storeToleranceMap[s.id] = Number(s.late_tolerance_minutes) || 5
  }
  const DEFAULT_TOLERANCE = 5

  const holidayDates = new Set(
    (holRes.data || []).filter(h => h.is_workday === false).map(h => h.date)
  )

  const attMap = {}
  for (const a of (attRes.data || [])) {
    const id = a.employee_id
    if (!attMap[id]) attMap[id] = { hours: 0, holidayHours: 0, lateMins: 0, days: 0, lateRows: [] }
    const h = Number(a.total_hours || 0)
    if (holidayDates.has(a.date)) attMap[id].holidayHours += h
    attMap[id].hours += h
    attMap[id].days  += 1
    const lateMin = Number(a.late_minutes || 0)
    const tolerance = storeToleranceMap[a.store_id] ?? DEFAULT_TOLERANCE
    if (a.is_late && lateMin > tolerance) {
      attMap[id].lateMins += lateMin
      attMap[id].lateRows.push({ date: a.date, late_minutes: lateMin, tolerance })
    }
  }

  const otMap = {}
  const otExceptionMap = {}
  for (const o of (otRes.data || [])) {
    const id = o.employee_id
    const target = o.is_exception ? otExceptionMap : otMap
    if (!target[id]) target[id] = { weekday: 0, restday: 0, holiday: 0, rows: [] }
    let cat = o.ot_category
    if (!cat && o.request_date) {
      const dow = new Date(o.request_date).getDay()
      cat = dow === 0 ? 'holiday' : dow === 6 ? 'restday' : 'weekday'
    }
    cat = cat || 'weekday'
    const hours = Number(o.ot_hours || 0)
    target[id][cat] = (target[id][cat] || 0) + hours
    target[id].rows.push({ date: o.request_date, hours, category: cat, type: o.ot_type, is_exception: !!o.is_exception })
  }

  const UNPAID_TYPES   = ['事假', 'personal', '無薪假', 'unpaid']
  const HALF_PAY_TYPES = ['病假', 'sick', '生理假', 'menstrual']
  const lvMap = {}
  for (const l of (lvRes.data || [])) {
    const id = l.employee_id
    if (!lvMap[id]) lvMap[id] = { unpaidHours: 0, halfPayHours: 0, unpaidDays: 0 }
    const t = l.type
    const h = Number(l.hours) || (Number(l.days) || 0) * 8
    const d = Number(l.days) || 0
    if (UNPAID_TYPES.includes(t)) {
      lvMap[id].unpaidHours += h
      lvMap[id].unpaidDays  += d
    } else if (HALF_PAY_TYPES.includes(t)) {
      lvMap[id].halfPayHours += h
    }
  }

  const ssMap = {}
  for (const ss of (ssRes.data || [])) ssMap[ss.employee_id] = ss

  const legalMap = {}
  for (const ld of (legalRes.data || [])) {
    const id = ld.employee_id
    if (!legalMap[id]) legalMap[id] = 0
    if (ld.deduction_type === 'fixed' || !ld.deduction_type) {
      legalMap[id] += Number(ld.monthly_amount || 0)
    }
  }

  const storeNames = [...new Set(scopedEmployees.map(e => e.store).filter(Boolean))]
  const storeIdEntries = await Promise.all(storeNames.map(async name => [name, await getStoreIdByName(name)]))
  const storeIdMap = Object.fromEntries(storeIdEntries)

  const bonusMap = {}
  await Promise.all(scopedEmployees.map(async (emp) => {
    const storeId = storeIdMap[emp.store] || null
    const bonusBenefits = await getEffectiveBenefits(emp.id, storeId, 'bonus')
    let total = 0
    for (const [, config] of Object.entries(bonusBenefits))
      total += calculateBonus(config, { sales: 0, attendance_rate: 1 })
    bonusMap[emp.id] = total
  }))

  return scopedEmployees.map(emp => {
    const ss              = ssMap[emp.id] || {}
    const isHourly        = ss.salary_type === 'hourly'
    const att             = attMap[emp.id] || { hours: 0, holidayHours: 0, lateMins: 0, days: 0, lateRows: [] }
    const ot              = otMap[emp.id]  || { weekday: 0, restday: 0, holiday: 0, rows: [] }
    const otException     = otExceptionMap[emp.id] || { weekday: 0, restday: 0, holiday: 0, rows: [] }
    const leaveStats      = lvMap[emp.id]  || { unpaidHours: 0, halfPayHours: 0, unpaidDays: 0 }
    const absenceDays     = leaveStats.unpaidDays
    const unpaidHours     = leaveStats.unpaidHours
    const halfPayHours    = leaveStats.halfPayHours
    const policyBonus     = bonusMap[emp.id] || 0
    const legalDeductionTotal = legalMap[emp.id] || 0

    const baseSalary = isHourly
      ? Math.round((ss.hourly_rate || 0) * att.hours)
      : (ss.base_salary || emp.base_salary || 0)
    const roleAllowance   = Number(ss.supervisor_allowance || 0) + Number(ss.role_allowance || 0)
    const mealAllowance   = ss.meal_allowance    || 0
    const transportAllow  = ss.transport_allowance || 0
    const attendanceBonusBase = ss.attendance_bonus || 0
    const customAllowances = Array.isArray(ss.custom_allowances) ? ss.custom_allowances : []
    const customTotal      = customAllowances.reduce((s, c) => s + (Number(c.amount) || 0), 0)
    const nightStructured  = Number(ss.night_shift_allowance) || 0
    const crossStructured  = Number(ss.cross_store_allowance) || 0
    const nightCustom      = Number(customAllowances.find(c => /夜班|夜間/.test(c.name || ''))?.amount || 0)
    const crossCustom      = Number(customAllowances.find(c => /跨店|跨區/.test(c.name || ''))?.amount || 0)
    const nightAllowance      = nightStructured > 0 ? nightStructured : nightCustom
    const crossStoreAllowance = crossStructured > 0 ? crossStructured : crossCustom
    const otherCustomTotal = customAllowances.reduce((s, c) => {
      if (/夜班|夜間|跨店|跨區/.test(c.name || '')) return s
      return s + (Number(c.amount) || 0)
    }, 0)
    const dependents       = ss.health_ins_dependents || 0
    const voluntaryRate    = (Number(emp.labor_pension_self_rate) || 0) / 100

    const baseForInsure = (ss.base_salary || emp.base_salary || 0)
      + roleAllowance + nightAllowance + crossStoreAllowance
      + mealAllowance + transportAllow + attendanceBonusBase + otherCustomTotal

    const hourlyRate = isHourly
      ? (Number(ss.hourly_rate) || 0)
      : Math.round(baseForInsure / 30 / 8)

    const calcOtPay = (bucket) => {
      const weekday = bucket.weekday <= 2
        ? Math.round(bucket.weekday * hourlyRate * 1.34)
        : Math.round(2 * hourlyRate * 1.34 + (bucket.weekday - 2) * hourlyRate * 1.67)
      const rd1 = Math.min(bucket.restday, 2)
      const rd2 = Math.min(Math.max(bucket.restday - 2, 0), 6)
      const rd3 = Math.max(bucket.restday - 8, 0)
      const restday = Math.round(rd1 * hourlyRate * 1.34 + rd2 * hourlyRate * 1.67 + rd3 * hourlyRate * 2.67)
      const holiday = Math.round(bucket.holiday * hourlyRate * 2)
      return { weekday, restday, holiday, total: weekday + restday + holiday }
    }

    const otLegalPay = calcOtPay(ot)
    const otExceptionPay = calcOtPay(otException)

    const holidayBonus = isHourly
      ? Math.round((att.holidayHours || 0) * hourlyRate * 1)
      : 0

    const regularOvertimePay = otLegalPay.total + holidayBonus
    const extraOvertimePay   = otExceptionPay.total
    const overtimePay        = regularOvertimePay + extraOvertimePay

    const otPayWeekday = otLegalPay.weekday
    const otPayRestday = otLegalPay.restday
    const otPayHoliday = otLegalPay.holiday

    const lateDeduction   = Math.floor(att.lateMins / 30) * Math.round(hourlyRate * 0.5)
    const unpaidDeduction   = isHourly ? 0 : Math.round(unpaidHours * hourlyRate)
    const halfPayDeduction  = isHourly ? 0 : Math.round(halfPayHours * hourlyRate * 0.5)
    const absenceDeduction  = unpaidDeduction + halfPayDeduction
    const attendanceBonus = (att.lateMins > 0 || absenceDays > 0) ? 0 : attendanceBonusBase

    // 月薪底薪 / 固定津貼比例（月中入職 / 當月離職）
    const [_yr, _mo] = month.split('-').map(Number)
    const _mStart = new Date(_yr, _mo - 1, 1)
    const _mEnd   = new Date(_yr, _mo, 0)
    const _countWD = (from, to) => {
      let n = 0; const d = new Date(from)
      while (d <= to) {
        const dow = d.getDay()
        const ds  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        if (dow !== 0 && dow !== 6 && !holidayDates.has(ds)) n++
        d.setDate(d.getDate() + 1)
      }
      return n
    }
    const _totalWD = _countWD(_mStart, _mEnd) || 1
    let salaryProrateRatio = 1
    let salaryActualWD     = _totalWD
    if (!isHourly) {
      const _toD = s => { const m = String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1],+m[2]-1,+m[3]) : null }
      const _joinD   = _toD(emp.join_date)
      const _resignD = _toD(emp.resign_date)
      const _effStart = _joinD   && _joinD   > _mStart ? _joinD   : _mStart
      const _effEnd   = _resignD && _resignD < _mEnd   ? _resignD : _mEnd
      if (_effStart > _mStart || _effEnd < _mEnd) {
        salaryActualWD     = _countWD(_effStart, _effEnd) || 1
        salaryProrateRatio = salaryActualWD / _totalWD
      }
    }
    const _p = salaryProrateRatio
    const effBase      = !isHourly ? Math.round(baseSalary          * _p) : baseSalary
    const effRole      = !isHourly ? Math.round(roleAllowance       * _p) : roleAllowance
    const effMeal      = !isHourly ? Math.round(mealAllowance       * _p) : mealAllowance
    const effTransp    = !isHourly ? Math.round(transportAllow      * _p) : transportAllow
    const effAttBonus  = !isHourly ? Math.round(attendanceBonus     * _p) : attendanceBonus
    const effNight     = !isHourly ? Math.round(nightAllowance      * _p) : nightAllowance
    const effCross     = !isHourly ? Math.round(crossStoreAllowance * _p) : crossStoreAllowance
    const effOtherC    = !isHourly ? Math.round(otherCustomTotal    * _p) : otherCustomTotal

    const insuredSalary = ss.base_insured != null && Number(ss.base_insured) > 0
      ? Number(ss.base_insured)
      : (isHourly ? 0 : baseForInsure)

    const fullMonthResult = calculateNetSalary(effBase, {
      insuredSalary,
      isPartTime: isHourly,
      dependents,
      voluntaryPensionRate: voluntaryRate,
      brackets: batchBrackets,
      overtimePay: overtimePay + effRole + effNight + effCross + effMeal + effTransp + effAttBonus + effOtherC,
      bonus: policyBonus,
      otherDeductions: absenceDeduction + lateDeduction + legalDeductionTotal,
      withholdTax: false,
    })

    const { inServiceDays, monthDays } = calculateInServiceDays(emp.join_date, emp.resign_date, month)
    const prorationRatio = monthDays > 0 ? inServiceDays / monthDays : 1
    const isPartialMonth = prorationRatio < 1 && prorationRatio > 0

    let result = fullMonthResult
    if (isPartialMonth) {
      const proratedLabor   = Math.round(fullMonthResult.laborInsurance * prorationRatio)
      const proratedPension = Math.round(fullMonthResult.pension        * prorationRatio)
      const proratedLaborE  = Math.round(fullMonthResult.laborEmployer  * prorationRatio)
      const proratedPensionE= Math.round(fullMonthResult.pensionEmployer* prorationRatio)
      const insuranceDelta  =
        (fullMonthResult.laborInsurance + fullMonthResult.pension)
        - (proratedLabor + proratedPension)
      const newTotalDeductions = fullMonthResult.totalDeductions - insuranceDelta
      result = {
        ...fullMonthResult,
        laborInsurance:    proratedLabor,
        pension:           proratedPension,
        laborEmployer:     proratedLaborE,
        pensionEmployer:   proratedPensionE,
        totalDeductions:   newTotalDeductions,
        netSalary:         fullMonthResult.gross - newTotalDeductions,
        employerTotalCost: fullMonthResult.gross + proratedLaborE + fullMonthResult.healthEmployer + proratedPensionE,
      }
    }

    return {
      employee:         emp.name,
      employee_id:      emp.id,
      dept:             emp.dept || emp.departments?.name || '',
      department_id:    emp.department_id,
      position:         emp.position || '',
      store:            emp.store || '',

      base_salary:      effBase,
      role_allowance:   effRole,
      meal_allowance:   effMeal,
      transport_allowance: effTransp,
      night_allowance:    Number(effNight) || 0,
      cross_store_allowance: Number(effCross) || 0,
      other_custom_total: Math.max(0, effOtherC),
      attendance_bonus: effAttBonus,
      custom_allowances: customAllowances,
      custom_allowances_total: !isHourly ? Math.round(customTotal * _p) : customTotal,
      regular_overtime_pay: regularOvertimePay,
      extra_overtime_pay:   extraOvertimePay,
      overtimePay,
      policyBonus,

      workDays:         att.days,
      workHours:        att.hours,
      holidayHours:     att.holidayHours || 0,
      holidayBonus,
      otWeekday:        ot.weekday,
      otRestday:        ot.restday,
      otHoliday:        ot.holiday,
      otPayWeekday,
      otPayRestday,
      otPayHoliday,
      absenceDays,
      unpaidHours,
      halfPayHours,
      lateMins:         att.lateMins,

      _is_hourly:           isHourly,
      _hourly_rate:         hourlyRate,
      _base_for_insure:     baseForInsure,
      _insured_salary:      insuredSalary,
      _supervisor_allowance: Number(ss.supervisor_allowance || 0),
      _raw_role_allowance:  Number(ss.role_allowance || 0),
      _ot_rows:             ot.rows || [],
      _ot_exception_rows:   otException.rows || [],
      _late_rows:           att.lateRows || [],
      _ot_legal_weekday:    ot.weekday,
      _ot_legal_restday:    ot.restday,
      _ot_legal_holiday:    ot.holiday,
      _ot_exc_weekday:      otException.weekday,
      _ot_exc_restday:      otException.restday,
      _ot_exc_holiday:      otException.holiday,
      _ot_exc_weekday_pay:  otExceptionPay.weekday,
      _ot_exc_restday_pay:  otExceptionPay.restday,
      _ot_exc_holiday_pay:  otExceptionPay.holiday,

      absenceDeduction,
      unpaidDeduction,
      halfPayDeduction,
      lateDeduction,
      legal_deduction:  legalDeductionTotal,

      health_ins_dependents: dependents,
      pension_self_pct: Number(emp.labor_pension_self_rate) || 0,

      in_service_days:       inServiceDays,
      month_days:            monthDays,
      proration_ratio:       prorationRatio,
      is_partial_month:      isPartialMonth,
      salary_prorate_ratio:  salaryProrateRatio,
      salary_actual_wd:      salaryActualWD,
      salary_total_wd:       _totalWD,
      join_date:             emp.join_date  || null,
      resign_date:           emp.resign_date|| null,

      ...result,
    }
  })
}
