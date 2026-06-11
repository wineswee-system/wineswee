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
import { loadInsuranceBrackets, findPTInsuredSalary } from './insuranceBrackets'
import { getEffectiveBenefits, calculateBonus, getStoreIdByName } from './benefitPolicy'

export async function computeBatchPayroll({ month, orgId, employees, storeFilter }) {
  const monthStart = month + '-01'
  const [_y, _m] = month.split('-').map(Number)
  const _lastDay = new Date(_y, _m, 0).getDate()
  const monthEnd = `${month}-${String(_lastDay).padStart(2, '0')}`

  const batchBrackets = await loadInsuranceBrackets(_y)

  // 跨店打卡支援：員工是「primary store=該店」或「additional_stores 含該店」都算
  // 加掛入職日過濾：入職日 > 月末 的員工不入該月薪資（例：5/15 入職的人不該出現在 4 月薪資）
  const scopedEmployees = (storeFilter
    ? employees.filter(e =>
        e.store === storeFilter
        || (Array.isArray(e.additional_stores) && e.additional_stores.includes(storeFilter))
      )
    : employees
  ).filter(e => !e.join_date || e.join_date <= monthEnd)

  // 補休過期：拉所有 scopedEmployees 在月底之前到期、status='active' 的 ledger
  // 月結時 generate_payroll 會把這些自動兌現加進加班費 → 預覽也要顯示
  const compTimeLedgerPromise = supabase.from('comp_time_ledger')
    .select('employee_id, hours, hours_used, frozen_ot_amount, expires_at')
    .eq('status', 'active')
    .lt('expires_at', monthEnd)
    .in('employee_id', scopedEmployees.map(e => e.id))

  const [attRes, otRes, lvRes, ssRes, holRes, legalRes, storeRes, ctRes, storeSettingsRes] = await Promise.all([
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
    compTimeLedgerPromise,
    supabase.from('store_settings').select('store_id, work_hour_system'),
  ])

  // 過期補休：聚合到 employee_id → 兌現金額（frozen_amount × remaining / hours）
  const ctMap = {}
  for (const l of (ctRes?.data || [])) {
    const remaining = Number(l.hours) - Number(l.hours_used)
    if (remaining <= 0) continue
    const amt = Math.ceil(Number(l.frozen_ot_amount || 0) * remaining / Math.max(Number(l.hours), 1))
    if (!ctMap[l.employee_id]) ctMap[l.employee_id] = { amount: 0, count: 0 }
    ctMap[l.employee_id].amount += amt
    ctMap[l.employee_id].count += 1
  }

  const storeToleranceMap = {}
  for (const s of (storeRes.data || [])) {
    storeToleranceMap[s.id] = Number(s.late_tolerance_minutes) || 5
  }
  const DEFAULT_TOLERANCE = 5

  // store_id → work_hour_system，給「國定加班倍率」分流用
  // - 變形工時（2週/4週/8週）：§30-1 國定可調移 → 當日視為平日，FT 不另計加倍
  // - 標準工時 / 行政員工（無 store）：§37 國定加倍 → FT 也應 ×2
  const storeWhsMap = {}
  for (const ss of (storeSettingsRes?.data || [])) {
    if (ss.store_id) storeWhsMap[ss.store_id] = ss.work_hour_system || '標準工時'
  }
  const isVariableHours = (storeId) => {
    const whs = storeWhsMap[storeId]
    return whs && whs !== '標準工時'  // 任何變形工時都算
  }

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
    if (!target[id]) target[id] = { weekday: 0, restday: 0, weekly_off: 0, holiday: 0, rows: [] }
    let cat = o.ot_category
    if (!cat && o.request_date) {
      const dow = new Date(o.request_date).getDay()
      // 沒分類就退而求其次依 DOW 估：週日 → 例假、週六 → 休息、其他 → 平日
      cat = dow === 0 ? 'weekly_off' : dow === 6 ? 'restday' : 'weekday'
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
    // ★ 員工分類擴充：employment_category 4 個值（NULL → 舊邏輯不動）
    //   regular(正職門市) / admin(行政) / parttime(兼職) / piece(計件)
    const empCategory     = ss.employment_category || null
    const isPiece         = empCategory === 'piece'
    const isPTLike        = isHourly || isPiece  // 投保走 PT 級距（11100/29500）
    const att             = attMap[emp.id] || { hours: 0, holidayHours: 0, lateMins: 0, days: 0, lateRows: [] }
    const ot              = otMap[emp.id]  || { weekday: 0, restday: 0, holiday: 0, rows: [] }
    const otException     = otExceptionMap[emp.id] || { weekday: 0, restday: 0, holiday: 0, rows: [] }
    const leaveStats      = lvMap[emp.id]  || { unpaidHours: 0, halfPayHours: 0, unpaidDays: 0 }
    const absenceDays     = leaveStats.unpaidDays
    const unpaidHours     = leaveStats.unpaidHours
    const halfPayHours    = leaveStats.halfPayHours
    const policyBonus     = bonusMap[emp.id] || 0
    const legalDeductionTotal = legalMap[emp.id] || 0

    // ★ 計件員工：月薪 = 本月件數 × 單價（HR 在員工編輯頁手動填件數）
    const pieceCount = Number(ss.current_piece_count) || 0
    const pieceRate  = Number(ss.piece_rate) || 0
    const baseSalary = isPiece
      ? Math.ceil(pieceCount * pieceRate)
      : isHourly
        ? Math.ceil((ss.hourly_rate || 0) * att.hours)
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
      : Math.round(baseForInsure / 30 / 8 * 100) / 100  // 四捨五入到小數第 2 位

    // 判斷員工分類（決定國定加班倍率）：
    // 不用 role 判斷（部分行政員工 role 設成 manager/store_staff，但實際掛在「總部」）
    // 改看所屬店的 work_hour_system：
    // - store 變形工時（12 家實體門市都設 4週變形）→ 門市正職
    //   → 1.34/1.67 階梯（§30-1 國定可調移，當日視為平日）
    // - store 標準工時 / 未設（行政員工掛在威士威總部）→ 行政正職
    //   → ×1 全程（月薪已含 30 天工資）
    // - PT (isHourly)：×2 全程
    const empStoreId = storeIdMap[emp.store] || null
    const empIsVariableHours = isVariableHours(empStoreId)

    // ── 單筆 (per-row) 倍率計算 — 給 detail UI 顯示用 ──
    // 依員工分類給 holiday 的倍率算法（PT ×2 / 行政 ×1 / 門市 1.34/1.67）
    const calcRowPayAndLabel = (hours, cat) => {
      const h = Number(hours) || 0
      if (cat === 'restday') {
        const rd1 = Math.min(h, 2)
        const rd2 = Math.min(Math.max(h - 2, 0), 6)
        const rd3 = Math.max(h - 8, 0)
        const pay = Math.ceil(rd1 * hourlyRate * 1.34 + rd2 * hourlyRate * 1.67 + rd3 * hourlyRate * 2.67)
        const label = h <= 2 ? '×1.34' : h <= 8 ? '×1.34 / ×1.67' : '×1.34 / ×1.67 / ×2.67'
        return { _pay: pay, _rate_label: label }
      }
      if (cat === 'weekly_off') {
        return { _pay: Math.ceil(h * hourlyRate * 2), _rate_label: '×2.0' }
      }
      if (cat === 'holiday') {
        if (isHourly) return { _pay: Math.ceil(h * hourlyRate * 2), _rate_label: '×2.0' }
        if (empIsVariableHours) {
          const pay = h <= 2
            ? Math.ceil(h * hourlyRate * 1.34)
            : Math.ceil(2 * hourlyRate * 1.34 + (h - 2) * hourlyRate * 1.67)
          return { _pay: pay, _rate_label: h <= 2 ? '×1.34' : '×1.34 / ×1.67' }
        }
        // 行政 FT：×1（月薪已含）
        return { _pay: Math.ceil(h * hourlyRate), _rate_label: '×1.0' }
      }
      // weekday
      const pay = h <= 2
        ? Math.ceil(h * hourlyRate * 1.34)
        : Math.ceil(2 * hourlyRate * 1.34 + (h - 2) * hourlyRate * 1.67)
      return { _pay: pay, _rate_label: h <= 2 ? '×1.34' : '×1.34 / ×1.67' }
    }

    // 把 row 加上 _pay 跟 _rate_label，讓 detail UI 直接顯示，不再自己算
    const enrichRows = (rows) => {
      for (const r of (rows || [])) {
        const { _pay, _rate_label } = calcRowPayAndLabel(r.hours, r.category || 'weekday')
        r._pay = _pay
        r._rate_label = _rate_label
      }
    }
    enrichRows(ot.rows)
    enrichRows(otException.rows)

    const calcOtPay = (bucket) => {
      // 把 rows 按 date+category 分組（同日同類別合計再套階梯，§32 是「每日」重設）
      // bucket.rows: [{ date, hours, category }]
      const rowsByDayCat = {}
      for (const r of (bucket.rows || [])) {
        const key = `${r.date}|${r.category}`
        rowsByDayCat[key] = (rowsByDayCat[key] || 0) + (Number(r.hours) || 0)
      }
      const sumByDay = (cat, perDayCalc) => {
        let total = 0
        for (const [key, h] of Object.entries(rowsByDayCat)) {
          if (!key.endsWith(`|${cat}`)) continue
          total += perDayCalc(h)
        }
        return total
      }

      // 平日：每日前 2h × 1.34，超過 × 1.67
      const weekday = sumByDay('weekday', h =>
        h <= 2
          ? Math.ceil(h * hourlyRate * 1.34)
          : Math.ceil(2 * hourlyRate * 1.34 + (h - 2) * hourlyRate * 1.67)
      )
      // 休息日：每日 前 2h × 1.34，3~8h × 1.67，9~12h × 2.67
      const restday = sumByDay('restday', h => {
        const rd1 = Math.min(h, 2)
        const rd2 = Math.min(Math.max(h - 2, 0), 6)
        const rd3 = Math.max(h - 8, 0)
        return Math.ceil(rd1 * hourlyRate * 1.34 + rd2 * hourlyRate * 1.67 + rd3 * hourlyRate * 2.67)
      })
      // 例假：FT/PT 都 ×2 全程（沒階梯，flat）
      const weeklyOff = Math.ceil((bucket.weekly_off || 0) * hourlyRate * 2)
      // 國定假日加班 — 依員工所屬店的工時制度分流：
      //  - PT 時薪：×2 全程
      //  - FT + 變形工時店（12 家門市）：每日前 2h × 1.34，超過 × 1.67
      //  - FT + 其他（行政員工掛總部）：×1 全程（月薪已含 30 天工資）
      const holiday = sumByDay('holiday', h => {
        if (isHourly) return Math.ceil(h * hourlyRate * 2)
        if (empIsVariableHours) {
          return h <= 2
            ? Math.ceil(h * hourlyRate * 1.34)
            : Math.ceil(2 * hourlyRate * 1.34 + (h - 2) * hourlyRate * 1.67)
        }
        return Math.ceil(h * hourlyRate)  // 行政正職：×1
      })
      return {
        weekday, restday, weekly_off: weeklyOff, holiday,
        total: weekday + restday + weeklyOff + holiday,
      }
    }

    const otLegalPay = calcOtPay(ot)
    const otExceptionPay = calcOtPay(otException)

    const holidayBonus = isHourly
      ? Math.ceil((att.holidayHours || 0) * hourlyRate * 1)
      : 0

    // 過期補休兌現（generate_payroll 月結時也會同樣加進去）
    const compTimeSettledPay   = ctMap[emp.id]?.amount || 0
    const compTimeSettledCount = ctMap[emp.id]?.count  || 0
    // ★ 計件員工強制 OT = 0（不算加班費，月薪 = 件數×單價）
    const regularOvertimePay = isPiece ? 0 : (otLegalPay.total + holidayBonus + compTimeSettledPay)
    const extraOvertimePay   = isPiece ? 0 : otExceptionPay.total
    const overtimePay        = regularOvertimePay + extraOvertimePay

    const otPayWeekday   = otLegalPay.weekday
    const otPayRestday   = otLegalPay.restday
    const otPayWeeklyOff = otLegalPay.weekly_off
    const otPayHoliday   = otLegalPay.holiday

    const lateDeduction   = Math.floor(att.lateMins / 30) * Math.floor(hourlyRate * 0.5)
    const unpaidDeduction   = isHourly ? 0 : Math.floor(unpaidHours * hourlyRate)
    const halfPayDeduction  = isHourly ? 0 : Math.floor(halfPayHours * hourlyRate * 0.5)
    const absenceDeduction  = unpaidDeduction + halfPayDeduction
    const attendanceBonus = (att.lateMins > 0 || absenceDays > 0) ? 0 : attendanceBonusBase

    // 月薪底薪 / 固定津貼比例（月中入職 / 當月離職）
    // 用「在職曆日 / 當月曆日數」當分母：
    //   - 4 月就 ?/30，3 月 ?/31，2 月 ?/28(or 29)
    //   - 不分週六週日、不扣國定，純曆日
    //   - 配合 §30-1 四週變形（沒固定 Mon-Fri）
    const [_yr, _mo] = month.split('-').map(Number)
    const _mStart = new Date(_yr, _mo - 1, 1)
    const _mEnd   = new Date(_yr, _mo, 0)
    const _countDays = (from, to) => {
      let n = 0; const d = new Date(from)
      while (d <= to) { n++; d.setDate(d.getDate() + 1) }
      return n
    }
    const _totalDays = _countDays(_mStart, _mEnd) || 1  // = 月曆日總數
    let salaryProrateRatio = 1
    let salaryActualDays   = _totalDays
    if (!isHourly) {
      const _toD = s => { const m = String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1],+m[2]-1,+m[3]) : null }
      const _joinD   = _toD(emp.join_date)
      const _resignD = _toD(emp.resign_date)
      const _effStart = _joinD   && _joinD   > _mStart ? _joinD   : _mStart
      const _effEnd   = _resignD && _resignD < _mEnd   ? _resignD : _mEnd
      if (_effStart > _mStart || _effEnd < _mEnd) {
        salaryActualDays   = _countDays(_effStart, _effEnd) || 1
        salaryProrateRatio = salaryActualDays / _totalDays
      }
    }
    // 舊欄名相容（外部消費者讀 salary_actual_wd / salary_total_wd）— 把曆日數寫進去
    const salaryActualWD = salaryActualDays
    const _totalWD       = _totalDays
    const _p = salaryProrateRatio
    const effBase      = !isHourly ? Math.ceil(baseSalary          * _p) : baseSalary
    const effRole      = !isHourly ? Math.ceil(roleAllowance       * _p) : roleAllowance
    const effMeal      = !isHourly ? Math.ceil(mealAllowance       * _p) : mealAllowance
    const effTransp    = !isHourly ? Math.ceil(transportAllow      * _p) : transportAllow
    const effAttBonus  = !isHourly ? Math.ceil(attendanceBonus     * _p) : attendanceBonus
    const effNight     = !isHourly ? Math.ceil(nightAllowance      * _p) : nightAllowance
    const effCross     = !isHourly ? Math.ceil(crossStoreAllowance * _p) : crossStoreAllowance
    const effOtherC    = !isHourly ? Math.ceil(otherCustomTotal    * _p) : otherCustomTotal

    // 投保金額：
    // 1. 員工有設 base_insured → 用設定值（廠商手動覆寫）
    // 2. PT 沒設 → 自動找級距（時薪 × 工時 → PT 11,100~29,500 範圍對應級距）
    // 3. FT 沒設 → 用 baseForInsure (base + 津貼)
    const insuredSalary = ss.base_insured != null && Number(ss.base_insured) > 0
      ? Number(ss.base_insured)
      : (isPTLike
        ? findPTInsuredSalary(batchBrackets?.labor || [], baseSalary + roleAllowance)
        : baseForInsure)

    const fullMonthResult = calculateNetSalary(effBase, {
      insuredSalary,
      isPartTime: isPTLike,  // ★ piece 也走 PT 投保邏輯
      dependents,
      voluntaryPensionRate: voluntaryRate,
      brackets: batchBrackets,
      overtimePay: overtimePay + effRole + effNight + effCross + effMeal + effTransp + effAttBonus + effOtherC,
      bonus: policyBonus,
      otherDeductions: absenceDeduction + lateDeduction + legalDeductionTotal,
      withholdTax: false,
      // 員工資料的勞健保 toggle（false → 該險全歸 0）
      skipLaborInsurance:  !emp.labor_insurance,
      skipHealthInsurance: !emp.health_insurance,
    })

    const { inServiceDays, monthDays } = calculateInServiceDays(emp.join_date, emp.resign_date, month)
    const prorationRatio = monthDays > 0 ? inServiceDays / monthDays : 1
    const isPartialMonth = prorationRatio < 1 && prorationRatio > 0

    let result = fullMonthResult
    if (isPartialMonth) {
      const proratedLabor   = Math.floor(fullMonthResult.laborInsurance * prorationRatio)
      const proratedPension = Math.floor(fullMonthResult.pension        * prorationRatio)
      const proratedLaborE  = Math.ceil(fullMonthResult.laborEmployer  * prorationRatio)
      const proratedPensionE= Math.ceil(fullMonthResult.pensionEmployer* prorationRatio)
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
        netSalary:         Math.ceil(fullMonthResult.gross - newTotalDeductions),  // 無條件進位到整數元
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
      custom_allowances_total: !isHourly ? Math.ceil(customTotal * _p) : customTotal,
      regular_overtime_pay: regularOvertimePay,
      extra_overtime_pay:   extraOvertimePay,
      overtimePay,
      // 過期補休兌現（已併入 regular_overtime_pay，這裡分開列出來給 UI 顯示）
      comp_time_settled_pay:   compTimeSettledPay,
      comp_time_settled_count: compTimeSettledCount,
      policyBonus,

      workDays:         att.days,
      workHours:        att.hours,
      holidayHours:     att.holidayHours || 0,
      holidayBonus,
      otWeekday:        ot.weekday,
      otRestday:        ot.restday,
      otWeeklyOff:      ot.weekly_off || 0,
      otHoliday:        ot.holiday,
      otPayWeekday,
      otPayRestday,
      otPayWeeklyOff,
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
      _ot_legal_weekday:     ot.weekday,
      _ot_legal_restday:     ot.restday,
      _ot_legal_weekly_off:  ot.weekly_off || 0,
      _ot_legal_holiday:     ot.holiday,
      _ot_exc_weekday:       otException.weekday,
      _ot_exc_restday:       otException.restday,
      _ot_exc_weekly_off:    otException.weekly_off || 0,
      _ot_exc_holiday:       otException.holiday,
      _ot_exc_weekday_pay:   otExceptionPay.weekday,
      _ot_exc_restday_pay:   otExceptionPay.restday,
      _ot_exc_weekly_off_pay:otExceptionPay.weekly_off,
      _ot_exc_holiday_pay:   otExceptionPay.holiday,

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
