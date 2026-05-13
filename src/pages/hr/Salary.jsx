import { useState, useEffect, useMemo } from 'react'
import { Download, Plus, Calculator } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { calculateLaborInsurance, calculateHealthInsurance, calculateLaborPension, calculateMonthlyWithholding, calculateNetSalary, calculateInServiceDays } from '../../lib/payroll'
import { exportSalaryPdf } from '../../lib/exportPdf'
import { getEffectiveBenefits, calculateBonus, getStoreIdByName } from '../../lib/benefitPolicy'
import LoadingSpinner from '../../components/LoadingSpinner'
import SalaryTable from './components/SalaryTable'
import SalaryFormModal from './components/SalaryFormModal'
import BatchPayrollModal from './components/BatchPayrollModal'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const CHINESE_MONTHS = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月']

function genMonthOptions(count = 24) {
  const opts = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opts.push({ val, label: `${d.getFullYear()} ${CHINESE_MONTHS[d.getMonth()]}` })
  }
  return opts
}

// ── Real-time payroll deduction calculator ──
function computeDeductions(f) {
  const baseSalary = Number(f.base_salary) || 0
  const overtimePay = Number(f.overtime_pay) || 0
  // ★ 拆分津貼欄位（與 salary_structures 一致）
  const roleAllowance      = Number(f.role_allowance) || 0
  const mealAllowance      = Number(f.meal_allowance) || 0
  const transportAllowance = Number(f.transport_allowance) || 0
  const attendanceBonus    = Number(f.attendance_bonus) || 0
  // ★ 自訂津貼累加（chip 列表）
  const customAllowancesTotal = Array.isArray(f.custom_allowances)
    ? f.custom_allowances.reduce((s, c) => s + (Number(c.amount) || 0), 0)
    : 0
  const allowancesTotal = roleAllowance + mealAllowance + transportAllowance + attendanceBonus + customAllowancesTotal
  const bonus = Number(f.bonus) || 0
  const dependents = Number(f.dependents) || 0
  const voluntaryRate = (Number(f.voluntary_pension_rate) || 0) / 100
  const absenceDeduction = Number(f.absence_deduction) || 0
  const lateDeduction = Number(f.late_deduction) || 0
  const otherDeduction = Number(f.other_deduction) || 0

  const gross = baseSalary + overtimePay + allowancesTotal + bonus

  const labor = calculateLaborInsurance(baseSalary)
  const health = calculateHealthInsurance(baseSalary, dependents)
  const pension = calculateLaborPension(baseSalary, voluntaryRate)
  const tax = calculateMonthlyWithholding(gross)

  const laborIns = labor.employee_share
  const healthIns = health.employee_share
  const pensionSelf = pension.employee_voluntary
  const incomeTax = tax.withholding_amount
  const manualDeductions = absenceDeduction + lateDeduction + otherDeduction
  const totalDeductions = laborIns + healthIns + pensionSelf + incomeTax + manualDeductions
  const net = gross - totalDeductions

  return {
    gross,
    laborIns,
    healthIns,
    pensionSelf,
    incomeTax,
    manualDeductions,
    totalDeductions,
    net,
    allowancesTotal,
    customAllowancesTotal,
    laborDetail: labor,
    healthDetail: health,
    pensionDetail: pension,
    taxDetail: tax,
  }
}

const emptyForm = {
  employee: '', month: new Date().toISOString().slice(0, 7),
  base_salary: '', overtime_pay: '', bonus: '',
  // ★ 拆分津貼欄位（跟 salary_structures 對齊）
  role_allowance: '', meal_allowance: '', transport_allowance: '', attendance_bonus: '',
  custom_allowances: [],  // [{name, amount}]
  dependents: '0', voluntary_pension_rate: '0',
  absence_deduction: '', late_deduction: '', other_deduction: '', deduction_note: '',
}

export default function Salary() {
  // Role-based access
  const { profile, role } = useAuth()
  const orgId = profile?.organization_id
  const userRole = role?.name || profile?.role || 'store_staff'
  const isStaff = userRole === 'store_staff'
  const isManager = userRole === 'manager'

  const [records, setRecords] = useState([])
  const [bonusRecords, setBonusRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState(isManager ? (profile?.store || '') : '')
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [expanded, setExpanded] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingRecord, setEditingRecord] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState(null)
  // Batch payroll state
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchPreview, setBatchPreview] = useState([])
  const [batchSaving, setBatchSaving] = useState(false)

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    Promise.all([
      supabase.from('salary_records').select('*').eq('organization_id', orgId).order('id'),
      supabase.from('bonus_records').select('*').eq('organization_id', orgId),
      supabase.from('employees').select('id, name, dept, store, department_id, position, store_id, base_salary, hourly_rate, salary_type, meal_allowance, transport_allowance, housing_allowance, join_date, resign_date, departments!department_id(name), stores!store_id(name)').eq('status', '在職').eq('organization_id', orgId).order('name'),
      supabase.from('departments').select('*').eq('organization_id', orgId).order('name'),
      supabase.from('stores').select('*').eq('organization_id', orgId).order('name'),
    ]).then(([s, b, e, d, st]) => {
      let recs = s.data || []
      // store_staff: 只看自己的薪資
      if (isStaff && profile?.name) recs = recs.filter(r => r.employee === profile.name)
      // manager: 只看自己門市
      if (isManager && profile?.store) {
        const storeEmps = new Set((e.data || []).filter(emp => emp.store === profile.store).map(emp => emp.name))
        recs = recs.filter(r => storeEmps.has(r.employee))
      }
      setRecords(recs)
      setBonusRecords(b.data || [])
      setEmployees(e.data || [])
      setDepartments(d.data || [])
      setStores(st.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ★ 自訂津貼操作（跟 SalaryStructures 同 pattern）
  const addCustomAllowance = (preset) => {
    setForm(f => ({ ...f, custom_allowances: [...(f.custom_allowances || []), { name: preset || '', amount: 0 }] }))
  }
  const updateCustomAllowance = (idx, key, val) => {
    setForm(f => ({ ...f, custom_allowances: f.custom_allowances.map((c, i) => i === idx ? { ...c, [key]: val } : c) }))
  }
  const removeCustomAllowance = (idx) => {
    setForm(f => ({ ...f, custom_allowances: f.custom_allowances.filter((_, i) => i !== idx) }))
  }

  // ★ 選員工後自動從 salary_structures 帶入預設值（新增模式）
  useEffect(() => {
    if (!form.employee || editingRecord) return  // 編輯模式不覆蓋
    const emp = employees.find(e => e.name === form.employee)
    if (!emp?.id) return
    supabase.from('salary_structures').select('*').eq('employee_id', emp.id).maybeSingle()
      .then(({ data: ss }) => {
        if (!ss) return
        setForm(f => ({
          ...f,
          base_salary:         f.base_salary         || String(ss.base_salary || ''),
          role_allowance:      f.role_allowance      || String(ss.role_allowance || ''),
          meal_allowance:      f.meal_allowance      || String(ss.meal_allowance || ''),
          transport_allowance: f.transport_allowance || String(ss.transport_allowance || ''),
          attendance_bonus:    f.attendance_bonus    || String(ss.attendance_bonus || ''),
          custom_allowances:   (f.custom_allowances?.length > 0) ? f.custom_allowances : (ss.custom_allowances || []),
          dependents:          f.dependents !== '0' ? f.dependents : String(ss.health_ins_dependents ?? 0),
        }))
      })
  }, [form.employee, editingRecord, employees])

  // ★ 同月份警告：是否已有 payroll_record
  const [payrollWarning, setPayrollWarning] = useState(null)
  useEffect(() => {
    if (!form.employee || !form.month) { setPayrollWarning(null); return }
    const emp = employees.find(e => e.name === form.employee)
    if (!emp?.id) { setPayrollWarning(null); return }
    supabase.from('payroll_records').select('id').eq('employee_id', emp.id).eq('pay_period', form.month).maybeSingle()
      .then(({ data }) => {
        setPayrollWarning(data?.id ? '⚠️ 此員工此月份已有正式薪資結算紀錄（payroll_records）。手動建立可能造成雙重計算。' : null)
      }).catch(() => setPayrollWarning(null))
  }, [form.employee, form.month, employees])

  // Real-time deduction preview
  const deductions = useMemo(() => computeDeductions(form), [form])

  // ── Create / Edit submit ──
  const handleSubmit = async () => {
    if (!form.employee) return
    // ★ 同月已有 payroll_record 警告（雙重計算防呆）
    if (payrollWarning && !editingRecord) {
      if (!(await confirm({ message: payrollWarning + '\n\n仍要繼續建立手動紀錄嗎？' }))) return
    }
    const d = deductions
    // 過濾空 custom_allowances
    const cleanCustomAllowances = (form.custom_allowances || [])
      .filter(c => c.name && c.name.trim())
      .map(c => ({ name: c.name.trim(), amount: Number(c.amount) || 0 }))

    const payload = {
      employee: form.employee,
      month: form.month,
      base_salary: Number(form.base_salary) || 0,
      // ★ 對齊 salary_structures 的拆分欄位
      role_allowance:      Number(form.role_allowance) || 0,
      meal_allowance:      Number(form.meal_allowance) || 0,
      transport_allowance: Number(form.transport_allowance) || 0,
      attendance_bonus:    Number(form.attendance_bonus) || 0,
      custom_allowances:   cleanCustomAllowances,
      // 加班 / 獎金 / 保險參數
      overtime_pay:        Number(form.overtime_pay) || 0,
      bonus:               Number(form.bonus) || 0,
      health_ins_dependents: Number(form.dependents) || 0,
      pension_self_pct:    Number(form.voluntary_pension_rate) || 0,
      // 扣款
      absence_deduction:   Number(form.absence_deduction) || 0,
      late_deduction:      Number(form.late_deduction) || 0,
      other_deduction:     Number(form.other_deduction) || 0,
      other_deduction_note: form.deduction_note || '',
      // legacy 合併欄位（用 deductions 結果）
      allowances_total:    d.allowancesTotal,
      insurance:           d.laborIns + d.healthIns,
      deductions_total:    d.totalDeductions,
      net_salary:          d.net,
    }

    if (editingRecord) {
      const { data } = await supabase.rpc('secure_update_salary', { p_id: editingRecord.id, p_data: payload })
      if (data) {
        setRecords(prev => prev.map(r => r.id === data.id ? data : r))
      }
    } else {
      // ★ 改用 v2：JSONB-based，支援所有對齊後欄位（含拆分津貼/自訂津貼/扣款明細）
      const { data, error } = await supabase.rpc('secure_upsert_salary_v2', { p_data: payload })
      if (error) { toast.error('儲存失敗：' + error.message); return }
      if (data) {
        setRecords(prev => [...prev, data])
      }
    }
    setShowModal(false)
    setEditingRecord(null)
    setForm(emptyForm)
  }

  // ── Open edit modal ──
  const openEdit = (r) => {
    setEditingRecord(r)
    setForm({
      employee: r.employee || '',
      month: r.month || new Date().toISOString().slice(0, 7),
      base_salary: String(r.base_salary || ''),
      overtime_pay: String(r.overtime_pay ?? r.overtime ?? ''),
      bonus: String(r.bonus || ''),
      role_allowance: String(r.role_allowance || ''),
      meal_allowance: String(r.meal_allowance || ''),
      transport_allowance: String(r.transport_allowance || ''),
      attendance_bonus: String(r.attendance_bonus || ''),
      custom_allowances: Array.isArray(r.custom_allowances) ? r.custom_allowances : [],
      dependents: String(r.health_ins_dependents ?? r.dependents ?? '0'),
      voluntary_pension_rate: String(r.pension_self_pct ?? r.voluntary_pension_rate ?? '0'),
      absence_deduction: String(r.absence_deduction || ''),
      late_deduction: String(r.late_deduction || ''),
      other_deduction: String(r.other_deduction || ''),
      deduction_note: r.other_deduction_note || r.deduction_note || '',
    })
    setShowModal(true)
  }

  // ── Batch payroll run ──
  const handleBatchPayroll = async () => {
    try {
      const monthStart = month + '-01'
      // 算當月最後一天（避開 4/6/9/11 月沒 31 號的問題）
      const [_y, _m] = month.split('-').map(Number)
      const _lastDay = new Date(_y, _m, 0).getDate()  // 0 = 上個月最後一天 = 當月最後一天
      const monthEnd = `${month}-${String(_lastDay).padStart(2, '0')}`

      // 用 storeFilter 過濾員工（store_staff/manager 已預設過；admin 選了門市才會帶值）
      const scopedEmployees = storeFilter
        ? employees.filter(e => e.store === storeFilter)
        : employees

      // Fetch all data in parallel (correct field names)
      const [attRes, otRes, lvRes, ssRes, holRes, legalRes] = await Promise.all([
        supabase.from('attendance_records')
          .select('employee_id, date, total_hours, is_late, late_minutes')
          .eq('organization_id', orgId)
          .gte('date', monthStart).lte('date', monthEnd),
        supabase.from('overtime_requests')
          .select('employee_id, ot_hours, ot_type, ot_category, request_date')
          .eq('status', '已核准')
          .eq('organization_id', orgId)
          .gte('request_date', monthStart).lte('request_date', monthEnd),
        supabase.from('leave_requests')
          .select('employee_id, days, leave_type')
          .eq('status', '已核准')
          .eq('organization_id', orgId)
          .gte('start_date', monthStart).lte('start_date', monthEnd),
        supabase.from('salary_structures')
          .select('*')
          .in('employee_id', scopedEmployees.map(e => e.id)),
        // 國定假日清單：用來判定打卡那天是否該加倍計薪（勞基法 §39）
        supabase.from('holidays')
          .select('date, is_workday')
          .gte('date', monthStart).lte('date', monthEnd),
        // 法扣（民事執行命令 / 養育費 / 債務）— 進行中 + 起始月 ≤ 計薪月
        supabase.from('legal_deductions')
          .select('employee_id, monthly_amount, monthly_percent, deduction_type, status, started_month')
          .eq('organization_id', orgId)
          .eq('status', '進行中')
          .lte('started_month', month),
      ])

      // 國定假日 Set（is_workday=false）→ 該日上班自動加倍，不需申請加班
      const holidayDates = new Set(
        (holRes.data || [])
          .filter(h => h.is_workday === false)
          .map(h => h.date)
      )

      // attendance map: employee_id → { hours, holidayHours, lateMins, days }
      // hours        = 平日 + 補班日 + 例假/休息日 (打卡正常 1 倍工資)
      // holidayHours = 國定假日打卡工時 (要額外加 1 倍 → 合計 2 倍)
      const attMap = {}
      for (const a of (attRes.data || [])) {
        const id = a.employee_id
        if (!attMap[id]) attMap[id] = { hours: 0, holidayHours: 0, lateMins: 0, days: 0 }
        const h = Number(a.total_hours || 0)
        if (holidayDates.has(a.date)) {
          attMap[id].holidayHours += h
        }
        attMap[id].hours    += h
        attMap[id].days     += 1
        if (a.is_late) attMap[id].lateMins += Number(a.late_minutes || 0)
      }

      // overtime map: employee_id → { weekday, restday, holiday }
      // ot_category 由 DB trigger 依 holidays 表 + 星期幾自動分類（勞基法 §36）：
      //   weekday=平日 ×1.34/1.67、restday=休息日 ×1.34/1.67/2.67、holiday=例假/國定 ×2
      // 舊資料若 ot_category 為 NULL，fallback：用 request_date 的星期幾粗略分類
      const otMap = {}
      for (const o of (otRes.data || [])) {
        const id = o.employee_id
        if (!otMap[id]) otMap[id] = { weekday: 0, restday: 0, holiday: 0 }
        let cat = o.ot_category
        if (!cat && o.request_date) {
          const dow = new Date(o.request_date).getDay()  // 0=Sun, 6=Sat
          cat = dow === 0 ? 'holiday' : dow === 6 ? 'restday' : 'weekday'
        }
        cat = cat || 'weekday'
        otMap[id][cat] = (otMap[id][cat] || 0) + Number(o.ot_hours || 0)
      }

      // leave map: employee_id → { absence days }
      const lvMap = {}
      for (const l of (lvRes.data || [])) {
        const id = l.employee_id
        if (!lvMap[id]) lvMap[id] = { absence: 0 }
        if (['事假', 'personal', '無薪假', 'unpaid'].includes(l.leave_type)) {
          lvMap[id].absence += (Number(l.days) || 0)
        }
      }

      // salary structures map: employee_id → record
      const ssMap = {}
      for (const ss of (ssRes.data || [])) ssMap[ss.employee_id] = ss

      // legal deductions map: employee_id → total monthly amount
      // 暫不支援 percent 型 — 需要先算出 gross 才能套，目前批次計薪流程中
      // 法扣 percent 計算需要 gross 已知，先 stage #1.5 只算 fixed amount。
      const legalMap = {}
      for (const ld of (legalRes.data || [])) {
        const id = ld.employee_id
        if (!legalMap[id]) legalMap[id] = 0
        if (ld.deduction_type === 'fixed' || !ld.deduction_type) {
          legalMap[id] += Number(ld.monthly_amount || 0)
        }
        // percent 型暫存 monthly_percent，後續加 stage #2 處理
      }

      // bonus policies
      const storeNames = [...new Set(scopedEmployees.map(e => e.store).filter(Boolean))]
      const storeIdMap = {}
      for (const name of storeNames) storeIdMap[name] = await getStoreIdByName(name)

      const bonusMap = {}
      await Promise.all(scopedEmployees.map(async (emp) => {
        const storeId = storeIdMap[emp.store] || null
        const bonusBenefits = await getEffectiveBenefits(emp.id, storeId, 'bonus')
        let total = 0
        for (const [, config] of Object.entries(bonusBenefits))
          total += calculateBonus(config, { sales: 0, attendance_rate: 1 })
        bonusMap[emp.id] = total
      }))

      const preview = scopedEmployees.map(emp => {
        const ss              = ssMap[emp.id] || {}
        const isHourly        = ss.salary_type === 'hourly'
        const att          = attMap[emp.id] || { hours: 0, holidayHours: 0, lateMins: 0, days: 0 }
        const ot           = otMap[emp.id]  || { weekday: 0, restday: 0, holiday: 0 }
        const absenceDays  = lvMap[emp.id]?.absence || 0
        const policyBonus  = bonusMap[emp.id] || 0
        const legalDeductionTotal = legalMap[emp.id] || 0

        // 時薪制：本薪 = 時薪 × 當月工時；月薪制：本薪 = 設定值
        // att.hours 已含國定假日 1 倍工時；國定假日的額外 1 倍透過下面 holidayBonus 加給
        const baseSalary      = isHourly
          ? Math.round((ss.hourly_rate || 0) * att.hours)
          : (ss.base_salary || emp.base_salary || 0)
        // 主管津貼（Plan A 2026-05-13）：
        //   - 新資料走 supervisor_allowance
        //   - 老資料 role_allowance > 0（永春 setup script 把主管放這欄）也吃，fallback 相容
        const roleAllowance   = Number(ss.supervisor_allowance || 0) + Number(ss.role_allowance || 0)
        const mealAllowance   = ss.meal_allowance    || 0
        const transportAllow  = ss.transport_allowance || 0
        const attendanceBonusBase = ss.attendance_bonus || 0
        const customAllowances = Array.isArray(ss.custom_allowances) ? ss.custom_allowances : []
        const customTotal      = customAllowances.reduce((s, c) => s + (Number(c.amount) || 0), 0)
        // 從結構化欄位 + custom_allowances 取出夜班/跨區，結構化欄位優先
        const nightStructured  = Number(ss.night_shift_allowance) || 0
        const crossStructured  = Number(ss.cross_store_allowance) || 0
        const nightCustom      = Number(customAllowances.find(c => /夜班|夜間/.test(c.name || ''))?.amount || 0)
        const crossCustom      = Number(customAllowances.find(c => /跨店|跨區/.test(c.name || ''))?.amount || 0)
        const nightAllowance      = nightStructured > 0 ? nightStructured : nightCustom
        const crossStoreAllowance = crossStructured > 0 ? crossStructured : crossCustom
        // 其他自訂津貼（扣掉已歸類的夜班/跨區）
        const otherCustomTotal = customAllowances.reduce((s, c) => {
          if (/夜班|夜間|跨店|跨區/.test(c.name || '')) return s
          return s + (Number(c.amount) || 0)
        }, 0)
        const dependents       = ss.health_ins_dependents || 0
        const voluntaryRate    = (ss.voluntary_pension_rate || 0) / 100

        // 業務鐵則 v3：正職時薪 / 日薪 / 投保 都以「本薪 + 所有經常性津貼」為基準
        //   = base + 主管 + 夜班 + 跨區 + 餐費 + 交通 + 全勤 + 其他自訂
        //   不含加班費、不含獎金
        //   用上面解析後的變數（已避開 結構化+custom 重複算）
        const baseForInsure = (ss.base_salary || emp.base_salary || 0)
          + roleAllowance       // 主管 + 職務
          + nightAllowance      // 夜班（結構化 or custom）
          + crossStoreAllowance // 跨區（結構化 or custom）
          + mealAllowance
          + transportAllow
          + attendanceBonusBase
          + otherCustomTotal    // custom_allowances 扣除已歸類的夜班/跨區

        // 時薪基準（業務鐵則 v3）：
        //   時薪制 PT → 直接用 ss.hourly_rate
        //   月薪正職   → (本薪 + 所有津貼) / 30 / 8
        const hourlyRate = isHourly
          ? (Number(ss.hourly_rate) || 0)
          : Math.round(baseForInsure / 30 / 8)

        // 加班費：勞基法 §24 三桶階梯
        // 平日延長工時：前 2h × 1.34，第 3~4h × 1.67
        const otPayWeekday = ot.weekday <= 2
          ? Math.round(ot.weekday * hourlyRate * 1.34)
          : Math.round(2 * hourlyRate * 1.34 + (ot.weekday - 2) * hourlyRate * 1.67)

        // 休息日加班：前 2h × 1.34，第 3~8h × 1.67，第 9~12h × 2.67
        const rd1 = Math.min(ot.restday, 2)
        const rd2 = Math.min(Math.max(ot.restday - 2, 0), 6)
        const rd3 = Math.max(ot.restday - 8, 0)
        const otPayRestday = Math.round(rd1 * hourlyRate * 1.34 + rd2 * hourlyRate * 1.67 + rd3 * hourlyRate * 2.67)

        // 例假日/國定假日「加班申請」：全額加倍 × 2
        const otPayHoliday = Math.round(ot.holiday * hourlyRate * 2)

        // 國定假日「正常打卡上班」加給：僅時薪制適用
        //   時薪制：baseSalary 已含 1 倍（hourly × hours），這裡再加 1 倍 → 合計 ×2
        //   月薪制：月薪固定值已含整月工資（含國定假日），廠商實務上不另外加給 → 0
        const holidayBonus = isHourly
          ? Math.round((att.holidayHours || 0) * hourlyRate * 1)
          : 0

        // 對齊廠商 PDF：加班費 = 平日 + 休息日；額外加班費 = 國定/例假 + 國定打卡加給
        const regularOvertimePay = otPayWeekday + otPayRestday
        const extraOvertimePay   = otPayHoliday + holidayBonus
        const overtimePay        = regularOvertimePay + extraOvertimePay

        // Late deduction: FLOOR(lateMins/30) × hourlyRate × 0.5（hourlyRate 已用新基準）
        const lateDeduction   = Math.floor(att.lateMins / 30) * Math.round(hourlyRate * 0.5)
        // Absence deduction:
        //   PT → 0（缺勤已透過 att.hours 自動反映在 baseSalary）
        //   正職 → absentDays × (本薪+津貼)/30 ＝ absentDays × 日薪
        const absenceDeduction = isHourly
          ? 0
          : Math.round(absenceDays * (baseForInsure / 30))

        // Attendance bonus: zero if late or absent
        const attendanceBonus = (att.lateMins > 0 || absenceDays > 0) ? 0 : attendanceBonusBase

        // 投保金額（業務鐵則 v3）：
        //   月薪人員 → min(baseForInsure, 45,800)
        //              ↑ 廠商把健保也 cap 在勞保最高 45,800（實務簡化，非健保法規定）
        //   PT      → 走 PT 最低（payroll.js 內 fixed 11,100）
        // salary_structures.base_insured 若有值則覆寫（admin 可手動調）
        const insuredSalary = ss.base_insured != null && Number(ss.base_insured) > 0
          ? Number(ss.base_insured)
          : (isHourly
              ? 0
              : Math.min(baseForInsure, 45800))

        const fullMonthResult = calculateNetSalary(baseSalary, {
          insuredSalary,
          isPartTime: isHourly,
          dependents,
          voluntaryPensionRate: voluntaryRate,
          // 「應發」放進 overtimePay 參數（calculateNetSalary 內 totalGross = base + overtimePay + bonus）
          // 這裡用解析後的津貼（避免結構化+custom 重複算）
          overtimePay: overtimePay + roleAllowance + nightAllowance + crossStoreAllowance + mealAllowance + transportAllow + attendanceBonus + otherCustomTotal,
          bonus: policyBonus,
          // 扣項：出勤扣 + 法扣
          otherDeductions: absenceDeduction + lateDeduction + legalDeductionTotal,
          withholdTax: false,  // 所得稅由個人 5 月申報，公司不代扣
        })

        // ─── 在職不滿月 proration（業務鐵則 v3 #5B）───
        // 新進當月：join_date → 月底；離職當月：月初 → resign_date
        // 業務鐵則：
        //   勞保 → 按天 (在保天數/當月天數)
        //   勞退 → 按天 (同勞保)
        //   健保 → 全月不打折（廠商實務：當月加保扣整月健保費）
        //   本薪/津貼/加班費 → 不 prorate
        //     （PT 已由 att.hours 反映；月薪員工的津貼是契約給定）
        const { inServiceDays, monthDays } = calculateInServiceDays(emp.join_date, emp.resign_date, month)
        const prorationRatio = monthDays > 0 ? inServiceDays / monthDays : 1
        const isPartialMonth = prorationRatio < 1 && prorationRatio > 0

        let result = fullMonthResult
        if (isPartialMonth) {
          // 勞保 + 勞退 按天，健保不動
          const proratedLabor   = Math.round(fullMonthResult.laborInsurance * prorationRatio)
          const proratedPension = Math.round(fullMonthResult.pension * prorationRatio)
          const proratedLaborE  = Math.round(fullMonthResult.laborEmployer * prorationRatio)
          const proratedPensionE= Math.round(fullMonthResult.pensionEmployer * prorationRatio)
          // 重算 totalDeductions / netSalary（健保不變，所以只算勞保 + 勞退的 delta）
          const insuranceDelta =
            (fullMonthResult.laborInsurance + fullMonthResult.pension)
            - (proratedLabor + proratedPension)
          const newTotalDeductions = fullMonthResult.totalDeductions - insuranceDelta
          result = {
            ...fullMonthResult,
            laborInsurance:    proratedLabor,
            // healthInsurance:   不動（全月）
            pension:           proratedPension,
            laborEmployer:     proratedLaborE,
            // healthEmployer:    不動（全月）
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

          // ── 加項 ──
          base_salary:      baseSalary,
          role_allowance:   roleAllowance,
          meal_allowance:   mealAllowance,
          transport_allowance: transportAllow,
          night_allowance:    Number(nightAllowance) || 0,
          cross_store_allowance: Number(crossStoreAllowance) || 0,
          other_custom_total: Math.max(0, otherCustomTotal),
          attendance_bonus: attendanceBonus,
          custom_allowances: customAllowances,
          custom_allowances_total: customTotal,
          regular_overtime_pay: regularOvertimePay,  // 平日+休息日加班
          extra_overtime_pay:   extraOvertimePay,    // 國定/例假加班 + 國定打卡加給
          overtimePay,                                // = regular + extra
          policyBonus,                                // 績效獎金

          // ── 出勤資訊（給 audit）──
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
          lateMins:         att.lateMins,

          // ── 扣項明細 ──
          absenceDeduction,
          lateDeduction,
          legal_deduction:  legalDeductionTotal,

          // ── 配置 ──
          health_ins_dependents: dependents,
          pension_self_pct: ss.voluntary_pension_rate || 0,

          // ── 在職天數（給 UI 顯示「在保 24/30」標示用）──
          in_service_days: inServiceDays,
          month_days:      monthDays,
          proration_ratio: prorationRatio,
          is_partial_month: isPartialMonth,
          join_date:       emp.join_date || null,
          resign_date:     emp.resign_date || null,

          // ── calculateNetSalary 回傳：gross / 投保 / 員工自付 / 雇主負擔 / netSalary 等 ──
          ...result,
        }
      })

      setBatchPreview(preview)
      setShowBatchModal(true)
    } catch (err) {
      console.error('Batch payroll failed:', err)
      toast.error('計薪失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleBatchSave = async () => {
    setBatchSaving(true)
    try {
      const payloads = batchPreview.map(p => ({
        employee:             p.employee,
        month,
        base_salary:          p.base_salary,
        role_allowance:       p.role_allowance       || 0,
        meal_allowance:       p.meal_allowance        || 0,
        transport_allowance:  p.transport_allowance   || 0,
        attendance_bonus:     p.attendance_bonus      || 0,
        custom_allowances:    p.custom_allowances     || [],
        overtime_pay:         p.overtimePay           || 0,
        bonus:                p.policyBonus           || 0,
        health_ins_dependents: p.health_ins_dependents || 0,
        pension_self_pct:     p.pension_self_pct      || 0,
        absence_deduction:    p.absenceDeduction      || 0,
        late_deduction:       p.lateDeduction         || 0,
        other_deduction:      0,
        other_deduction_note: '',
        allowances_total:     (p.role_allowance || 0) + (p.meal_allowance || 0) + (p.transport_allowance || 0) + (p.attendance_bonus || 0) + (p.custom_allowances_total || 0),
        insurance:            (p.laborInsurance || 0) + (p.healthInsurance || 0),
        deductions_total:     p.totalDeductions       || 0,
        net_salary:           p.netSalary             || 0,
      }))
      // 批次薪資：逐筆走 secure_upsert_salary_v2（支援拆分津貼）
      const results = []
      for (const p of payloads) {
        const { data: row } = await supabase.rpc('secure_upsert_salary_v2', { p_data: p })
        if (row) results.push(row)
      }
      const data = results
      if (data) {
        setRecords(prev => {
          const existing = new Map(prev.map(r => [`${r.employee}-${r.month}`, r]))
          data.forEach(d => existing.set(`${d.employee}-${d.month}`, d))
          return Array.from(existing.values())
        })
      }
      setShowBatchModal(false)
      setBatchPreview([])
    } catch (err) {
      console.error('Batch save failed:', err)
    } finally {
      setBatchSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''
  const getEmpStore = (name) => employees.find(e => e.name === name)?.store || ''

  const filtered = records.filter(r =>
    (!month || !r.month || r.month === month) &&
    (deptFilter === '' || getEmpDept(r.employee) === deptFilter) &&
    (storeFilter === '' || getEmpStore(r.employee) === storeFilter)
  )

  // Stats
  const totalGross = filtered.reduce((s, r) => {
    return s + (r.base_salary || 0) + (r.allowance || 0) + (r.overtime || 0) + (r.bonus || 0)
  }, 0)
  const totalDeductionsSum = filtered.reduce((s, r) => s + (r.deductions || 0), 0)
  const totalNet = filtered.reduce((s, r) => s + (r.net_salary || 0), 0)
  const employeeCount = filtered.length

  const getBonusDetail = (name) => bonusRecords.filter(b => b.employee_name === name && b.period === month)

  return (
    <div className="fade-in">
      {/* ── Page header ── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💰</span> 薪資管理</h2>
            <p>員工薪資計算與發放管理（整合勞健保 / 所得稅自動計算）</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isStaff && <>
              <button className="btn btn-primary" onClick={() => { setEditingRecord(null); setForm(emptyForm); setShowModal(true) }}>
                <Plus size={14} /> 新增薪資
              </button>
              <button className="btn btn-secondary" onClick={handleBatchPayroll}>
                <Calculator size={14} /> 批次計薪
              </button>
              <button className="btn btn-secondary" onClick={() => exportSalaryPdf(filtered, month)}>
                <Download size={14} /> 匯出 PDF
              </button>
            </>}
          </div>
        </div>
      </div>

      {/* ── Filter bar: month | store ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, marginBottom: 16,
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            className="form-input"
            style={{ fontSize: 13, minWidth: 130, border: 'none', background: 'transparent', padding: '2px 4px' }}
            value={month}
            onChange={e => setMonth(e.target.value)}
          >
            {genMonthOptions().map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
        </div>
        {!isStaff && (
          <>
            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-medium)' }} />
            <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>門市</span>
              <select
                className="form-input"
                style={{ fontSize: 13, minWidth: 140, border: 'none', background: 'transparent', padding: '2px 4px' }}
                value={storeFilter}
                onChange={e => setStoreFilter(e.target.value)}
                disabled={isManager}
              >
                <option value="">全部門市</option>
                {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {/* ── Stats cards ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總薪資（Gross）</div>
          <div className="stat-card-value">{fmt(totalGross)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">扣除合計</div>
          <div className="stat-card-value">{fmt(totalDeductionsSum)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">實領合計（Net）</div>
          <div className="stat-card-value">{fmt(totalNet)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">計薪人數</div>
          <div className="stat-card-value">{employeeCount} 人</div>
        </div>
      </div>

      {/* ── Salary table ── */}
      <SalaryTable
        filtered={filtered}
        expanded={expanded}
        setExpanded={setExpanded}
        getEmpDept={getEmpDept}
        getBonusDetail={getBonusDetail}
        openEdit={openEdit}
      />

      {/* ── Create / Edit Modal ── */}
      {showModal && (
        <SalaryFormModal
          editingRecord={editingRecord}
          form={form}
          set={set}
          deductions={deductions}
          employees={employees}
          departments={departments}
          payrollWarning={payrollWarning}
          addCustomAllowance={addCustomAllowance}
          updateCustomAllowance={updateCustomAllowance}
          removeCustomAllowance={removeCustomAllowance}
          onClose={() => { setShowModal(false); setEditingRecord(null); setForm(emptyForm) }}
          onSubmit={handleSubmit}
        />
      )}

      {/* ── Batch Payroll Modal ── */}
      {showBatchModal && (
        <BatchPayrollModal
          month={month}
          batchPreview={batchPreview}
          batchSaving={batchSaving}
          onClose={() => setShowBatchModal(false)}
          onSave={handleBatchSave}
        />
      )}
    </div>
  )
}
