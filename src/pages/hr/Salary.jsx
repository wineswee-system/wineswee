import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Plus, Calculator, Pencil, Landmark } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { calculateLaborInsurance, calculateHealthInsurance, calculateLaborPension, calculateMonthlyWithholding, calculateNetSalary, calculateInServiceDays } from '../../lib/payroll'
import { loadInsuranceBrackets } from '../../lib/insuranceBrackets'
import { exportSalaryPdf } from '../../lib/exportPdf'
import { getEffectiveBenefits, calculateBonus, getStoreIdByName } from '../../lib/benefitPolicy'
import { computeBatchPayroll } from '../../lib/payrollCalc'
import LoadingSpinner from '../../components/LoadingSpinner'
import SalaryTable from './components/SalaryTable'
import SalaryFormModal from './components/SalaryFormModal'
import BatchPayrollModal from './components/BatchPayrollModal'
import BankImportModal from './components/BankImportModal'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { fmtNT as fmt } from '../../lib/currency'

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
// brackets: { labor, health } from insuranceBrackets.loadInsuranceBrackets()，可為 null（fallback hardcoded）
function computeDeductions(f, brackets) {
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

  const labor = calculateLaborInsurance(baseSalary, { brackets: brackets?.labor })
  const health = calculateHealthInsurance(baseSalary, { dependents, brackets: brackets?.health })
  const pension = calculateLaborPension(baseSalary, voluntaryRate)
  const tax = calculateMonthlyWithholding(gross)

  const laborIns = labor.employee_share
  const healthIns = health.employee_share
  const pensionSelf = pension.employee_voluntary
  // 所得稅不代扣（員工年度自行申報），與批次計薪 payrollCalc.js withholdTax: false 對齊
  const incomeTax = 0
  const manualDeductions = absenceDeduction + lateDeduction + otherDeduction
  const totalDeductions = laborIns + healthIns + pensionSelf + manualDeductions
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
  const navigate = useNavigate()
  const { profile, role } = useAuth()
  const orgId = profile?.organization_id
  const userRole = role?.name || profile?.role || 'store_staff'
  const isStaff = userRole === 'store_staff'
  const isManager = userRole === 'manager'
  const isAdmin = userRole === 'admin' || userRole === 'super_admin'

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
  const [showBankImport, setShowBankImport] = useState(false)

  // 勞健保級距（從 DB 載入，year 隨 form.month / 篩選 month 變動）
  // 結構：{ labor: [...], health: [...] } 或 null（DB 沒資料時 fallback hardcoded）
  const [brackets, setBrackets] = useState(null)
  const bracketYear = useMemo(() => {
    const monthStr = form?.month || month || new Date().toISOString().slice(0, 7)
    return parseInt(monthStr.slice(0, 4), 10) || new Date().getFullYear()
  }, [form?.month, month])
  useEffect(() => {
    let cancelled = false
    loadInsuranceBrackets(bracketYear).then(b => {
      if (!cancelled) setBrackets(b)
    })
    return () => { cancelled = true }
  }, [bracketYear])

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    Promise.all([
      supabase.from('salary_records').select('*').eq('organization_id', orgId).order('id'),
      supabase.from('bonus_records').select('*').eq('organization_id', orgId),
      supabase.from('employees').select('id, name, dept, store, additional_stores, department_id, position, store_id, base_salary, hourly_rate, salary_type, meal_allowance, transport_allowance, housing_allowance, join_date, resign_date, status, labor_pension_self_rate, labor_insurance, health_insurance, departments!department_id(name), stores!store_id(name)').or(`status.eq.在職,and(status.eq.離職,resign_date.gte.${new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10)})`).eq('organization_id', orgId).order('name'),
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
  const deductions = useMemo(() => computeDeductions(form, brackets), [form, brackets])

  // ★ 這三個 useMemo 必須在早返（loading/error）之前，否則 hooks 順序不一致 → React #310
  // O(1) name-keyed employee lookup
  const empNameMap = useMemo(() => {
    const m = {}
    employees.forEach(e => { m[e.name] = e })
    return m
  }, [employees])

  const filtered = useMemo(() => records.filter(r =>
    (!month || !r.month || r.month === month) &&
    (deptFilter === '' || (empNameMap[r.employee]?.dept || '') === deptFilter) &&
    (storeFilter === '' || (empNameMap[r.employee]?.store || '') === storeFilter)
  ), [records, month, deptFilter, storeFilter, empNameMap])

  // Stats — derived from filtered; recomputed only when filtered changes
  const { totalGross, totalDeductionsSum, totalNet, employeeCount } = useMemo(() => ({
    totalGross:        filtered.reduce((s, r) => s + (r.base_salary || 0) + (r.allowance || 0) + (r.overtime || 0) + (r.bonus || 0), 0),
    totalDeductionsSum: filtered.reduce((s, r) => s + (r.deductions || 0), 0),
    totalNet:          filtered.reduce((s, r) => s + (r.net_salary || 0), 0),
    employeeCount:     filtered.length,
  }), [filtered])

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
  // 治本：試算改走後端聚合 RPC preview_payroll（一次回完整明細，純讀無副作用），
  // 取代前端 computeBatchPayroll 的 N+1 query + 瀏覽器運算 → 更快 + 與入帳同源。
  // 與前端逐人逐欄比對 83/88 完全一致，餘 5 筆為 ±1 元浮點毛邊(DB 較準)+ 時鐘差。
  // DB 失敗自動 fallback 前端;要完全回退把 USE_DB_PREVIEW 改 false。
  const USE_DB_PREVIEW = true
  const handleBatchPayroll = async () => {
    try {
      let preview
      if (USE_DB_PREVIEW) {
        const { data, error } = await supabase.rpc('preview_payroll', {
          p_period: month, p_org: orgId, p_store_filter: storeFilter || null,
        })
        if (error) throw error
        preview = Array.isArray(data) ? data : []
      } else {
        preview = await computeBatchPayroll({ month, orgId, employees, storeFilter })
      }
      setBatchPreview(preview)
      setShowBatchModal(true)
    } catch (err) {
      console.warn('[handleBatchPayroll] preview_payroll 失敗，fallback 前端:', err)
      try {
        const preview = await computeBatchPayroll({ month, orgId, employees, storeFilter })
        setBatchPreview(preview)
        setShowBatchModal(true)
      } catch (err2) {
        console.error('Batch payroll failed:', err2)
        toast.error('計薪失敗：' + (err2.message || err.message || '未知錯誤'))
      }
    }
  }


  const handleBatchSaveCore = async (status) => {
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
      // status='draft' → 走 _with_status wrapper；其他 → 既有 v2 行為
      const isDraft = status === 'draft'
      const data = (await Promise.all(
        payloads.map(p => isDraft
          ? supabase.rpc('secure_upsert_salary_v2_with_status', { p_data: p, p_status: 'draft' }).then(({ data: row }) => row)
          : supabase.rpc('secure_upsert_salary_v2',             { p_data: p })                    .then(({ data: row }) => row)
        )
      )).filter(Boolean)
      if (data) {
        setRecords(prev => {
          const existing = new Map(prev.map(r => [`${r.employee}-${r.month}`, r]))
          data.forEach(d => existing.set(`${d.employee}-${d.month}`, d))
          return Array.from(existing.values())
        })
      }
      setShowBatchModal(false)
      setBatchPreview([])
      if (isDraft) {
        toast.success(`已存為草稿，跳到逐筆調整 →`)
        navigate(`/hr/salary-adjust?month=${month}`)
      }
    } catch (err) {
      console.error('Batch save failed:', err)
      toast.error((status === 'draft' ? '儲存草稿失敗：' : '儲存失敗：') + (err.message || ''))
    } finally {
      setBatchSaving(false)
    }
  }

  const handleBatchSave        = () => handleBatchSaveCore('finalized')
  const handleBatchSaveAsDraft = () => handleBatchSaveCore('draft')

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const getEmpDept = (name) => empNameMap[name]?.dept || ''
  const getEmpStore = (name) => empNameMap[name]?.store || ''

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
              <button className="btn btn-secondary" onClick={() => navigate(`/hr/salary-adjust?month=${month}`)}>
                <Pencil size={14} /> 逐筆調整
              </button>
              <button className="btn btn-secondary" onClick={() => navigate('/hr/salary-audit-log')}>
                🔍 稽核
              </button>
              <button className="btn btn-secondary" onClick={() => exportSalaryPdf(filtered, month)}>
                <Download size={14} /> 匯出 PDF
              </button>
              {isAdmin && (
                <button className="btn btn-secondary" onClick={() => setShowBankImport(true)}>
                  <Landmark size={14} /> 匯入銀行帳號
                </button>
              )}
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
        brackets={brackets}
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

      {/* ── 匯入銀行帳號（admin）── */}
      {showBankImport && (
        <BankImportModal onClose={() => setShowBankImport(false)} />
      )}

      {/* ── Batch Payroll Modal ── */}
      {showBatchModal && (
        <BatchPayrollModal
          month={month}
          batchPreview={batchPreview}
          batchSaving={batchSaving}
          onSaveAsDraft={handleBatchSaveAsDraft}
          onClose={() => setShowBatchModal(false)}
          onSave={handleBatchSave}
        />
      )}
    </div>
  )
}
