// ════════════════════════════════════════════════════════════════════════════
// 比對 harness：preview_payroll（新 DB RPC） vs 前端 computeBatchPayroll
//
// 重用「真的」前端金錢數學 src/lib/payroll.js（純函式，直接 import），
// DB-glue（loadInsuranceBrackets / getEffectiveBenefits / getStoreIdByName）與
// computeBatchPayroll 主體照抄 payrollCalc.js，改用 service_role client。
// 然後 call preview_payroll，逐人逐欄 deep-diff。
//
// 用法：node scripts/_diff_preview_payroll.mjs [YYYY-MM] [orgId] [storeFilter]
//   預設 2026-04 / org 1 / 全門市
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { calculateNetSalary, calculateInServiceDays } from '../src/lib/payroll.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .filter(l => l.trim() && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── 純函式（照抄 insuranceBrackets.js / benefitPolicy.js）──
function findPTInsuredSalary(brackets, salary) {
  const PT_MIN = 11100, PT_MAX = 29500
  if (!brackets || brackets.length === 0) return PT_MIN
  const pt = brackets.filter(b => b.insured_salary >= PT_MIN && b.insured_salary <= PT_MAX).slice().sort((a, b) => a.insured_salary - b.insured_salary)
  if (pt.length === 0) return PT_MIN
  for (const b of pt) if (b.insured_salary >= salary) return b.insured_salary
  return PT_MAX
}
function calculateBonus(cfg, ctx = {}) {
  if (!cfg?.type) return 0
  switch (cfg.type) {
    case 'fixed': return cfg.amount || 0
    case 'percent': { const base = ctx[cfg.base] || 0; const raw = Math.round(base * (cfg.rate || 0)); return cfg.cap ? Math.min(raw, cfg.cap) : raw }
    case 'milestone': { const tiers = cfg.tiers || []; const v = ctx[cfg.base] || ctx.value || 0; let r = 0; for (const t of tiers.sort((a, b) => b.target - a.target)) { if (v >= t.target) { r = t.reward; break } } return r }
    default: return 0
  }
}
// ── DB-glue（照抄，改 service client）──
const _bracketCache = new Map()
async function loadInsuranceBrackets(year) {
  if (!year) return null
  if (_bracketCache.has(year)) return _bracketCache.get(year)
  const [l, h] = await Promise.all([
    supabase.from('labor_ins_brackets').select('*').eq('year', year).order('grade'),
    supabase.from('health_ins_brackets').select('*').eq('year', year).order('grade'),
  ])
  const labor = l.data || [], health = h.data || []
  const res = (labor.length === 0 || health.length === 0) ? null : { labor, health, year }
  _bracketCache.set(year, res)
  return res
}
async function getStoreIdByName(name) {
  if (!name) return null
  const { data } = await supabase.from('stores').select('id').eq('name', name).single()
  return data?.id || null
}
async function getEffectiveBenefits(employeeId, storeId, category) {
  const all = []
  const { data: g } = await supabase.from('benefit_policies').select('*').eq('category', category).eq('is_active', true).is('store_id', null).is('employee_id', null)
  if (g) all.push(...g)
  if (storeId) { const { data: s } = await supabase.from('benefit_policies').select('*').eq('category', category).eq('is_active', true).eq('store_id', storeId).is('employee_id', null); if (s) all.push(...s) }
  if (employeeId) { const { data: e } = await supabase.from('benefit_policies').select('*').eq('category', category).eq('is_active', true).eq('employee_id', employeeId); if (e) all.push(...e) }
  const now = new Date().toISOString().slice(0, 10)
  const active = all.filter(p => p.effective_from <= now && (!p.effective_to || p.effective_to >= now))
  const result = {}
  for (const p of active) {
    const spec = (p.employee_id ? 2 : 0) + (p.store_id ? 1 : 0)
    const ex = result[p.code]
    if (!ex || spec > ex._specificity) result[p.code] = { ...p.config, _policyId: p.id, _specificity: spec, _notes: p.notes }
  }
  for (const c of Object.keys(result)) delete result[c]._specificity
  return result
}

// ── computeBatchPayroll（照抄 src/lib/payrollCalc.js，改 supabase 為上面的 service client）──
async function computeBatchPayroll({ month, orgId, employees, storeFilter }) {
  const monthStart = month + '-01'
  const [_y, _m] = month.split('-').map(Number)
  const _lastDay = new Date(_y, _m, 0).getDate()
  const monthEnd = `${month}-${String(_lastDay).padStart(2, '0')}`
  const batchBrackets = await loadInsuranceBrackets(_y)
  const scopedEmployees = (storeFilter
    ? employees.filter(e => e.store === storeFilter || (Array.isArray(e.additional_stores) && e.additional_stores.includes(storeFilter)))
    : employees).filter(e => !e.join_date || e.join_date <= monthEnd)
  const compTimeLedgerPromise = supabase.from('comp_time_ledger').select('employee_id, hours, hours_used, frozen_ot_amount, expires_at').eq('status', 'active').lt('expires_at', monthEnd).in('employee_id', scopedEmployees.map(e => e.id))
  const [attRes, otRes, lvRes, ssRes, holRes, legalRes, storeRes, ctRes, storeSettingsRes] = await Promise.all([
    supabase.from('attendance_records').select('employee_id, store_id, date, total_hours, is_late, late_minutes').eq('organization_id', orgId).gte('date', monthStart).lte('date', monthEnd),
    supabase.from('overtime_requests').select('employee_id, ot_hours, ot_type, ot_category, request_date, is_exception').eq('status', '已核准').eq('organization_id', orgId).gte('request_date', monthStart).lte('request_date', monthEnd),
    supabase.from('leave_requests').select('employee_id, days, hours, type').eq('status', '已核准').eq('organization_id', orgId).gte('start_date', monthStart).lte('start_date', monthEnd),
    supabase.from('salary_structures').select('*').in('employee_id', scopedEmployees.map(e => e.id)),
    supabase.from('holidays').select('date, is_workday').gte('date', monthStart).lte('date', monthEnd),
    supabase.from('legal_deductions').select('employee_id, monthly_amount, monthly_percent, deduction_type, status, started_month').eq('organization_id', orgId).eq('status', '進行中').lte('started_month', month),
    supabase.from('stores').select('id, late_tolerance_minutes'),
    compTimeLedgerPromise,
    supabase.from('store_settings').select('store_id, work_hour_system'),
  ])
  const ctMap = {}
  for (const l of (ctRes?.data || [])) { const remaining = Number(l.hours) - Number(l.hours_used); if (remaining <= 0) continue; const amt = Math.ceil(Number(l.frozen_ot_amount || 0) * remaining / Math.max(Number(l.hours), 1)); if (!ctMap[l.employee_id]) ctMap[l.employee_id] = { amount: 0, count: 0 }; ctMap[l.employee_id].amount += amt; ctMap[l.employee_id].count += 1 }
  const storeToleranceMap = {}
  for (const s of (storeRes.data || [])) storeToleranceMap[s.id] = Number(s.late_tolerance_minutes) || 5
  const DEFAULT_TOLERANCE = 5
  const holidayDates = new Set((holRes.data || []).filter(h => h.is_workday === false).map(h => h.date))
  const attMap = {}
  for (const a of (attRes.data || [])) { const id = a.employee_id; if (!attMap[id]) attMap[id] = { hours: 0, holidayHours: 0, lateMins: 0, days: 0, lateRows: [] }; const h = Number(a.total_hours || 0); if (holidayDates.has(a.date)) attMap[id].holidayHours += h; attMap[id].hours += h; attMap[id].days += 1; const lateMin = Number(a.late_minutes || 0); const tol = storeToleranceMap[a.store_id] ?? DEFAULT_TOLERANCE; if (a.is_late && lateMin > tol) { attMap[id].lateMins += lateMin; attMap[id].lateRows.push({ date: a.date, late_minutes: lateMin, tolerance: tol }) } }
  const otMap = {}, otExceptionMap = {}
  for (const o of (otRes.data || [])) { const id = o.employee_id; const target = o.is_exception ? otExceptionMap : otMap; if (!target[id]) target[id] = { weekday: 0, restday: 0, weekly_off: 0, holiday: 0, rows: [] }; let cat = o.ot_category; if (!cat && o.request_date) { const dow = new Date(o.request_date).getDay(); cat = dow === 0 ? 'weekly_off' : dow === 6 ? 'restday' : 'weekday' } cat = cat || 'weekday'; const hours = Number(o.ot_hours || 0); target[id][cat] = (target[id][cat] || 0) + hours; target[id].rows.push({ date: o.request_date, hours, category: cat, type: o.ot_type, is_exception: !!o.is_exception }) }
  const UNPAID_TYPES = ['事假', 'personal', '無薪假', 'unpaid'], HALF_PAY_TYPES = ['病假', 'sick', '生理假', 'menstrual']
  const lvMap = {}
  for (const l of (lvRes.data || [])) { const id = l.employee_id; if (!lvMap[id]) lvMap[id] = { unpaidHours: 0, halfPayHours: 0, unpaidDays: 0 }; const t = l.type; const h = Number(l.hours) || (Number(l.days) || 0) * 8; const d = Number(l.days) || 0; if (UNPAID_TYPES.includes(t)) { lvMap[id].unpaidHours += h; lvMap[id].unpaidDays += d } else if (HALF_PAY_TYPES.includes(t)) { lvMap[id].halfPayHours += h } }
  const ssMap = {}
  for (const ss of (ssRes.data || [])) ssMap[ss.employee_id] = ss
  const legalMap = {}
  for (const ld of (legalRes.data || [])) { const id = ld.employee_id; if (!legalMap[id]) legalMap[id] = 0; if (ld.deduction_type === 'fixed' || !ld.deduction_type) legalMap[id] += Number(ld.monthly_amount || 0) }
  const storeNames = [...new Set(scopedEmployees.map(e => e.store).filter(Boolean))]
  const storeIdEntries = await Promise.all(storeNames.map(async name => [name, await getStoreIdByName(name)]))
  const storeIdMap = Object.fromEntries(storeIdEntries)
  const bonusMap = {}
  await Promise.all(scopedEmployees.map(async (emp) => { const storeId = storeIdMap[emp.store] || null; const bb = await getEffectiveBenefits(emp.id, storeId, 'bonus'); let total = 0; for (const [, config] of Object.entries(bb)) total += calculateBonus(config, { sales: 0, attendance_rate: 1 }); bonusMap[emp.id] = total }))

  return scopedEmployees.map(emp => {
    const ss = ssMap[emp.id] || {}
    const isHourly = ss.salary_type === 'hourly'
    const empCategory = ss.employment_category || null
    const isPiece = empCategory === 'piece'
    const isPTLike = isHourly || isPiece
    const att = attMap[emp.id] || { hours: 0, holidayHours: 0, lateMins: 0, days: 0, lateRows: [] }
    const ot = otMap[emp.id] || { weekday: 0, restday: 0, holiday: 0, rows: [] }
    const otException = otExceptionMap[emp.id] || { weekday: 0, restday: 0, holiday: 0, rows: [] }
    const leaveStats = lvMap[emp.id] || { unpaidHours: 0, halfPayHours: 0, unpaidDays: 0 }
    const absenceDays = leaveStats.unpaidDays, unpaidHours = leaveStats.unpaidHours, halfPayHours = leaveStats.halfPayHours
    const policyBonus = bonusMap[emp.id] || 0
    const legalDeductionTotal = legalMap[emp.id] || 0
    const pieceCount = Number(ss.current_piece_count) || 0, pieceRate = Number(ss.piece_rate) || 0
    const baseSalary = isPiece ? Math.ceil(pieceCount * pieceRate) : isHourly ? Math.ceil((ss.hourly_rate || 0) * att.hours) : (ss.base_salary || emp.base_salary || 0)
    const roleAllowance = Number(ss.supervisor_allowance || 0) + Number(ss.role_allowance || 0)
    const mealAllowance = ss.meal_allowance || 0, transportAllow = ss.transport_allowance || 0, attendanceBonusBase = ss.attendance_bonus || 0
    const customAllowances = Array.isArray(ss.custom_allowances) ? ss.custom_allowances : []
    const customTotal = customAllowances.reduce((s, c) => s + (Number(c.amount) || 0), 0)
    const nightStructured = Number(ss.night_shift_allowance) || 0, crossStructured = Number(ss.cross_store_allowance) || 0
    const nightCustom = Number(customAllowances.find(c => /夜班|夜間/.test(c.name || ''))?.amount || 0)
    const crossCustom = Number(customAllowances.find(c => /跨店|跨區/.test(c.name || ''))?.amount || 0)
    const nightAllowance = nightStructured > 0 ? nightStructured : nightCustom
    const crossStoreAllowance = crossStructured > 0 ? crossStructured : crossCustom
    const otherCustomTotal = customAllowances.reduce((s, c) => { if (/夜班|夜間|跨店|跨區/.test(c.name || '')) return s; return s + (Number(c.amount) || 0) }, 0)
    const dependents = ss.health_ins_dependents || 0
    const voluntaryRate = (Number(emp.labor_pension_self_rate) || 0) / 100
    const baseForInsure = (ss.base_salary || emp.base_salary || 0) + roleAllowance + nightAllowance + crossStoreAllowance + mealAllowance + transportAllow + attendanceBonusBase + otherCustomTotal
    const hourlyRate = isHourly ? (Number(ss.hourly_rate) || 0) : Math.round(baseForInsure / 30 / 8 * 100) / 100
    const calcOtPay = (bucket) => {
      const rowsByDayCat = {}
      for (const r of (bucket.rows || [])) { const key = `${r.date}|${r.category}`; rowsByDayCat[key] = (rowsByDayCat[key] || 0) + (Number(r.hours) || 0) }
      const sumByDay = (cat, fn) => { let t = 0; for (const [k, h] of Object.entries(rowsByDayCat)) { if (!k.endsWith(`|${cat}`)) continue; t += fn(h) } return t }
      const weekday = sumByDay('weekday', h => h <= 2 ? Math.ceil(h * hourlyRate * 1.34) : Math.ceil(2 * hourlyRate * 1.34 + (h - 2) * hourlyRate * 1.67))
      const restday = sumByDay('restday', h => { const a = Math.min(h, 2), b = Math.min(Math.max(h - 2, 0), 6), c = Math.max(h - 8, 0); return Math.ceil(a * hourlyRate * 1.34 + b * hourlyRate * 1.67 + c * hourlyRate * 2.67) })
      const weeklyOff = isHourly ? Math.ceil((bucket.weekly_off || 0) * hourlyRate * 2) : Math.ceil((bucket.weekly_off || 0) * hourlyRate * 1)
      const holiday = sumByDay('holiday', h => { if (isHourly) return Math.ceil(h * hourlyRate * 2); const base = Math.min(h, 8) * hourlyRate; const o1 = Math.min(Math.max(h - 8, 0), 2) * hourlyRate * 1.34; const o2 = Math.max(h - 10, 0) * hourlyRate * 1.67; return Math.ceil(base + o1 + o2) })
      return { weekday, restday, weekly_off: weeklyOff, holiday, total: weekday + restday + weeklyOff + holiday }
    }
    const otLegalPay = calcOtPay(ot), otExceptionPay = calcOtPay(otException)
    const holidayBonus = !isPiece ? Math.ceil((att.holidayHours || 0) * hourlyRate * 1) : 0
    const compTimeSettledPay = ctMap[emp.id]?.amount || 0, compTimeSettledCount = ctMap[emp.id]?.count || 0
    const regularOvertimePay = isPiece ? 0 : (otLegalPay.total + holidayBonus + compTimeSettledPay)
    const extraOvertimePay = isPiece ? 0 : otExceptionPay.total
    const overtimePay = regularOvertimePay + extraOvertimePay
    const lateDeduction = Math.floor(att.lateMins / 30) * Math.floor(hourlyRate * 0.5)
    const unpaidDeduction = isHourly ? 0 : Math.floor(unpaidHours * hourlyRate)
    const halfPayDeduction = isHourly ? 0 : Math.floor(halfPayHours * hourlyRate * 0.5)
    const absenceDeduction = unpaidDeduction + halfPayDeduction
    const attendanceBonus = (att.lateMins > 0 || absenceDays > 0) ? 0 : attendanceBonusBase
    const [_yr, _mo] = month.split('-').map(Number)
    const _mStart = new Date(_yr, _mo - 1, 1), _mEnd = new Date(_yr, _mo, 0)
    const _countDays = (from, to) => { let n = 0; const d = new Date(from); while (d <= to) { n++; d.setDate(d.getDate() + 1) } return n }
    const _totalDays = _countDays(_mStart, _mEnd) || 1
    let salaryProrateRatio = 1, salaryActualDays = _totalDays
    if (!isHourly) {
      const _toD = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null }
      const _joinD = _toD(emp.join_date), _resignD = _toD(emp.resign_date)
      const _effStart = _joinD && _joinD > _mStart ? _joinD : _mStart
      const _effEnd = _resignD && _resignD < _mEnd ? _resignD : _mEnd
      if (_effStart > _mStart || _effEnd < _mEnd) { salaryActualDays = _countDays(_effStart, _effEnd) || 1; salaryProrateRatio = salaryActualDays / _totalDays }
    }
    const _p = salaryProrateRatio
    const effBase = !isHourly ? Math.ceil(baseSalary * _p) : baseSalary
    const effRole = !isHourly ? Math.ceil(roleAllowance * _p) : roleAllowance
    const effMeal = !isHourly ? Math.ceil(mealAllowance * _p) : mealAllowance
    const effTransp = !isHourly ? Math.ceil(transportAllow * _p) : transportAllow
    const effAttBonus = !isHourly ? Math.ceil(attendanceBonus * _p) : attendanceBonus
    const effNight = !isHourly ? Math.ceil(nightAllowance * _p) : nightAllowance
    const effCross = !isHourly ? Math.ceil(crossStoreAllowance * _p) : crossStoreAllowance
    const effOtherC = !isHourly ? Math.ceil(otherCustomTotal * _p) : otherCustomTotal
    const insuredSalary = ss.base_insured != null && Number(ss.base_insured) > 0 ? Number(ss.base_insured) : (isPTLike ? findPTInsuredSalary(batchBrackets?.labor || [], baseSalary + roleAllowance) : baseForInsure)
    const fullMonthResult = calculateNetSalary(effBase, { insuredSalary, isPartTime: isPTLike, dependents, voluntaryPensionRate: voluntaryRate, brackets: batchBrackets, overtimePay: overtimePay + effRole + effNight + effCross + effMeal + effTransp + effAttBonus + effOtherC, bonus: policyBonus, otherDeductions: absenceDeduction + lateDeduction + legalDeductionTotal, withholdTax: false, skipLaborInsurance: !emp.labor_insurance, skipHealthInsurance: !emp.health_insurance })
    const { inServiceDays, monthDays } = calculateInServiceDays(emp.join_date, emp.resign_date, month)
    const prorationRatio = monthDays > 0 ? inServiceDays / monthDays : 1
    const isPartialMonth = prorationRatio < 1 && prorationRatio > 0
    let result = fullMonthResult
    if (isPartialMonth) {
      const pl = Math.floor(fullMonthResult.laborInsurance * prorationRatio), pp = Math.floor(fullMonthResult.pension * prorationRatio)
      const ple = Math.ceil(fullMonthResult.laborEmployer * prorationRatio), ppe = Math.ceil(fullMonthResult.pensionEmployer * prorationRatio)
      const delta = (fullMonthResult.laborInsurance + fullMonthResult.pension) - (pl + pp)
      const ntd = fullMonthResult.totalDeductions - delta
      result = { ...fullMonthResult, laborInsurance: pl, pension: pp, laborEmployer: ple, pensionEmployer: ppe, totalDeductions: ntd, netSalary: Math.ceil(fullMonthResult.gross - ntd), employerTotalCost: fullMonthResult.gross + ple + fullMonthResult.healthEmployer + ppe }
    }
    return {
      employee: emp.name, employee_id: emp.id,
      base_salary: effBase, role_allowance: effRole, meal_allowance: effMeal, transport_allowance: effTransp,
      night_allowance: Number(effNight) || 0, cross_store_allowance: Number(effCross) || 0, other_custom_total: Math.max(0, effOtherC),
      attendance_bonus: effAttBonus, custom_allowances_total: !isHourly ? Math.ceil(customTotal * _p) : customTotal,
      regular_overtime_pay: regularOvertimePay, extra_overtime_pay: extraOvertimePay, overtimePay,
      comp_time_settled_pay: compTimeSettledPay, comp_time_settled_count: compTimeSettledCount, policyBonus,
      workDays: att.days, workHours: att.hours, holidayHours: att.holidayHours || 0, holidayBonus,
      otWeekday: ot.weekday, otRestday: ot.restday, otWeeklyOff: ot.weekly_off || 0, otHoliday: ot.holiday,
      otPayWeekday: otLegalPay.weekday, otPayRestday: otLegalPay.restday, otPayWeeklyOff: otLegalPay.weekly_off, otPayHoliday: otLegalPay.holiday,
      absenceDays, unpaidHours, halfPayHours, lateMins: att.lateMins,
      absenceDeduction, unpaidDeduction, halfPayDeduction, lateDeduction, legal_deduction: legalDeductionTotal,
      health_ins_dependents: dependents, pension_self_pct: Number(emp.labor_pension_self_rate) || 0,
      in_service_days: inServiceDays, month_days: monthDays, proration_ratio: prorationRatio, is_partial_month: isPartialMonth,
      salary_prorate_ratio: salaryProrateRatio, salary_actual_wd: salaryActualDays, salary_total_wd: _totalDays,
      _is_hourly: isHourly, _hourly_rate: hourlyRate, _base_for_insure: baseForInsure, _insured_salary: insuredSalary,
      ...result,
    }
  })
}

// ── 比對 ──
const FIELDS = ['base_salary', 'role_allowance', 'meal_allowance', 'transport_allowance', 'night_allowance', 'cross_store_allowance', 'other_custom_total', 'attendance_bonus', 'custom_allowances_total', 'regular_overtime_pay', 'extra_overtime_pay', 'overtimePay', 'comp_time_settled_pay', 'comp_time_settled_count', 'policyBonus', 'workDays', 'workHours', 'holidayHours', 'holidayBonus', 'otWeekday', 'otRestday', 'otWeeklyOff', 'otHoliday', 'otPayWeekday', 'otPayRestday', 'otPayWeeklyOff', 'otPayHoliday', 'absenceDays', 'unpaidHours', 'halfPayHours', 'lateMins', 'absenceDeduction', 'unpaidDeduction', 'halfPayDeduction', 'lateDeduction', 'legal_deduction', 'health_ins_dependents', 'pension_self_pct', 'in_service_days', 'month_days', 'is_partial_month', 'salary_actual_wd', 'salary_total_wd', '_is_hourly', '_hourly_rate', '_base_for_insure', '_insured_salary', 'gross', 'insuredLabor', 'insuredHealth', 'laborInsurance', 'healthInsurance', 'pension', 'incomeTax', 'totalDeductions', 'netSalary', 'laborEmployer', 'healthEmployer', 'pensionEmployer']
const near = (a, b) => { const x = Number(a) || 0, y = Number(b) || 0; return Math.abs(x - y) < 0.011 }

const month = process.argv[2] || '2026-04'
const orgId = Number(process.argv[3] || 1)
const storeFilter = process.argv[4] || null

const prevMonth1 = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10)
const { data: employees } = await supabase.from('employees')
  .select('id, name, dept, store, additional_stores, department_id, position, store_id, base_salary, hourly_rate, salary_type, meal_allowance, transport_allowance, housing_allowance, join_date, resign_date, status, labor_pension_self_rate, labor_insurance, health_insurance, departments!department_id(name), stores!store_id(name)')
  .or(`status.eq.在職,and(status.eq.離職,resign_date.gte.${prevMonth1})`).eq('organization_id', orgId).order('name')

const front = await computeBatchPayroll({ month, orgId, employees: employees || [], storeFilter })
const { data: dbRows, error } = await supabase.rpc('preview_payroll', { p_period: month, p_org: orgId, p_store_filter: storeFilter })
if (error) { console.error('preview_payroll error:', error.message); process.exit(1) }
const dbById = Object.fromEntries((dbRows || []).map(r => [r.employee_id, r]))

console.log(`比對 ${month} org${orgId}${storeFilter ? ' 門市:' + storeFilter : ''} — 前端 ${front.length} 人 / DB ${(dbRows || []).length} 人\n`)
let pass = 0, fail = 0
const fieldFailCount = {}
for (const f of front) {
  const d = dbById[f.employee_id]
  if (!d) { console.log(`#${f.employee_id} ${f.employee}  ✗ DB 沒這人`); fail++; continue }
  const diffs = []
  for (const k of FIELDS) {
    const a = f[k], b = d[k]
    const eq = (typeof a === 'boolean' || typeof a === 'string') ? (a === b) : near(a, b)
    if (!eq) { diffs.push(`    ${k}: 前端=${JSON.stringify(a)} DB=${JSON.stringify(b)}`); fieldFailCount[k] = (fieldFailCount[k] || 0) + 1 }
  }
  if (diffs.length === 0) pass++
  else { console.log(`#${f.employee_id} ${f.employee} [${f._is_hourly ? 'PT' : 'FT'}]  ✗`); diffs.forEach(x => console.log(x)); fail++ }
}
console.log(`\n結果：✓${pass}  ✗${fail}`)
if (Object.keys(fieldFailCount).length) { console.log('各欄位失敗次數：'); Object.entries(fieldFailCount).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k}: ${n}`)) }
process.exit(fail ? 1 : 0)
