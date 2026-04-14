import { useState, useEffect, useMemo } from 'react'
import { Download, Plus, Calculator } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { calculateLaborInsurance, calculateHealthInsurance, calculateLaborPension, calculateMonthlyWithholding, calculateNetSalary } from '../../lib/payroll'
import { exportSalaryPdf } from '../../lib/exportPdf'
import { getEffectiveBenefits, calculateBonus, getStoreIdByName } from '../../lib/benefitPolicy'
import LoadingSpinner from '../../components/LoadingSpinner'
import SalaryTable from './components/SalaryTable'
import SalaryFormModal from './components/SalaryFormModal'
import BatchPayrollModal from './components/BatchPayrollModal'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

// ── Real-time payroll deduction calculator ──
function computeDeductions(f) {
  const baseSalary = Number(f.base_salary) || 0
  const overtimePay = Number(f.overtime_pay) || 0
  const allowances = Number(f.allowances) || 0
  const bonus = Number(f.bonus) || 0
  const dependents = Number(f.dependents) || 0
  const voluntaryRate = (Number(f.voluntary_pension_rate) || 0) / 100
  const absenceDeduction = Number(f.absence_deduction) || 0
  const lateDeduction = Number(f.late_deduction) || 0
  const otherDeduction = Number(f.other_deduction) || 0

  const gross = baseSalary + overtimePay + allowances + bonus

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
    laborDetail: labor,
    healthDetail: health,
    pensionDetail: pension,
    taxDetail: tax,
  }
}

const emptyForm = {
  employee: '', month: new Date().toISOString().slice(0, 7),
  base_salary: '', overtime_pay: '', allowances: '', bonus: '',
  dependents: '0', voluntary_pension_rate: '0',
  absence_deduction: '', late_deduction: '', other_deduction: '', deduction_note: '',
}

export default function Salary() {
  const [records, setRecords] = useState([])
  const [bonusRecords, setBonusRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
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
    Promise.all([
      supabase.from('salary_records').select('*').order('id'),
      supabase.from('bonus_records').select('*'),
      supabase.from('employees').select('id, name, dept, position, store, base_salary, hourly_rate, salary_type, meal_allowance, transport_allowance, housing_allowance').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
    ]).then(([s, b, e, d, st]) => {
      setRecords(s.data || [])
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
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Real-time deduction preview
  const deductions = useMemo(() => computeDeductions(form), [form])

  // ── Create / Edit submit ──
  const handleSubmit = async () => {
    if (!form.employee) return
    const d = deductions
    const payload = {
      employee: form.employee,
      month: form.month,
      base_salary: Number(form.base_salary) || 0,
      allowance: Number(form.allowances) || 0,
      overtime: Number(form.overtime_pay) || 0,
      bonus: Number(form.bonus) || 0,
      dependents: Number(form.dependents) || 0,
      voluntary_pension_rate: Number(form.voluntary_pension_rate) || 0,
      labor_insurance: d.laborIns,
      health_insurance: d.healthIns,
      pension_self: d.pensionSelf,
      income_tax: d.incomeTax,
      absence_deduction: Number(form.absence_deduction) || 0,
      late_deduction: Number(form.late_deduction) || 0,
      other_deduction: Number(form.other_deduction) || 0,
      deduction_note: form.deduction_note || '',
      insurance: d.laborIns + d.healthIns,
      deductions: d.totalDeductions,
      net_salary: d.net,
    }

    if (editingRecord) {
      const { data } = await supabase.rpc('secure_update_salary', { p_id: editingRecord.id, p_data: payload })
      if (data) {
        setRecords(prev => prev.map(r => r.id === data.id ? data : r))
      }
    } else {
      const { data } = await supabase.rpc('secure_upsert_salary', {
        p_employee: payload.employee, p_month: payload.month,
        p_base_salary: payload.base_salary, p_allowance: payload.allowance ?? 0,
        p_overtime: payload.overtime ?? 0, p_deductions: payload.deductions ?? 0,
        p_insurance: payload.insurance ?? 0, p_net_salary: payload.net_salary ?? null,
      })
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
      overtime_pay: String(r.overtime || ''),
      allowances: String(r.allowance || ''),
      bonus: String(r.bonus || ''),
      dependents: String(r.dependents || '0'),
      voluntary_pension_rate: String(r.voluntary_pension_rate || '0'),
      absence_deduction: String(r.absence_deduction || ''),
      late_deduction: String(r.late_deduction || ''),
      other_deduction: String(r.other_deduction || ''),
      deduction_note: r.deduction_note || '',
    })
    setShowModal(true)
  }

  // ── Batch payroll run ──
  const handleBatchPayroll = async () => {
    try {
    // Pull attendance data for the month
    const monthStart = month + '-01'
    const monthEnd = month + '-31'
    const { data: attendance } = await supabase.from('attendance_records')
      .select('employee, hours, status').gte('date', monthStart).lte('date', monthEnd)
    const { data: overtime } = await supabase.from('overtime_requests')
      .select('employee, hours').eq('status', '已核准').gte('date', monthStart).lte('date', monthEnd)
    const { data: leaves } = await supabase.from('leave_requests')
      .select('employee, days, type').eq('status', '已核准').gte('start_date', monthStart).lte('start_date', monthEnd)

    const attMap = {}
    for (const a of (attendance || [])) {
      if (!attMap[a.employee]) attMap[a.employee] = { hours: 0, late: 0, days: 0 }
      attMap[a.employee].hours += Number(a.hours || 0)
      attMap[a.employee].days++
      if (a.status === '遲到') attMap[a.employee].late++
    }
    const otMap = {}
    for (const o of (overtime || [])) {
      otMap[o.employee] = (otMap[o.employee] || 0) + Number(o.hours || 0)
    }
    const lvMap = {}
    for (const l of (leaves || [])) {
      if (!lvMap[l.employee]) lvMap[l.employee] = { absence: 0 }
      if (l.type === '事假') lvMap[l.employee].absence += (l.days || 0)
    }

    // 查詢每位員工的獎金政策
    const bonusMap = {}
    for (const emp of employees) {
      const storeId = await getStoreIdByName(emp.store)
      const bonusBenefits = await getEffectiveBenefits(emp.id, storeId, 'bonus')
      let totalBonus = 0
      for (const [, config] of Object.entries(bonusBenefits)) {
        totalBonus += calculateBonus(config, { sales: 0, attendance_rate: 1 })
      }
      bonusMap[emp.name] = totalBonus
    }

    const preview = employees.map(emp => {
      const baseSalary = emp.base_salary || 0
      const att = attMap[emp.name] || { hours: 0, late: 0, days: 0 }
      const otHours = otMap[emp.name] || 0
      const absenceDays = lvMap[emp.name]?.absence || 0
      const policyBonus = bonusMap[emp.name] || 0
      // Tiered OT: first 2h = 1.34x, 3h+ = 1.67x (勞基法 §24)
      const hourlyRate = baseSalary / 30 / 8
      const overtimePay = otHours <= 2
        ? Math.round(otHours * hourlyRate * 1.34)
        : Math.round(2 * hourlyRate * 1.34 + (otHours - 2) * hourlyRate * 1.67)
      const absenceDeduction = Math.round(absenceDays * (baseSalary / 30))
      const lateDeduction = att.late * 100

      const result = calculateNetSalary(baseSalary, {
        dependents: 0, voluntaryPensionRate: 0,
        overtimePay, bonus: policyBonus,
        otherDeductions: absenceDeduction + lateDeduction,
      })
      return {
        employee: emp.name, dept: emp.dept, base_salary: baseSalary,
        workDays: att.days, workHours: att.hours, otHours, absenceDays, lateCount: att.late,
        overtimePay, absenceDeduction, lateDeduction, policyBonus,
        ...result,
      }
    })
    setBatchPreview(preview)
    setShowBatchModal(true)
    } catch (err) {
      console.error('Batch payroll failed:', err)
      alert('計薪失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleBatchSave = async () => {
    setBatchSaving(true)
    try {
      const payloads = batchPreview.map(p => ({
        employee: p.employee,
        month,
        base_salary: p.base_salary,
        allowance: (p.meal_allowance || 0) + (p.transport_allowance || 0) + (p.housing_allowance || 0),
        overtime: p.overtimePay || 0,
        bonus: p.policyBonus || 0,
        dependents: 0,
        voluntary_pension_rate: 0,
        labor_insurance: p.laborInsurance,
        health_insurance: p.healthInsurance,
        pension_self: p.pension,
        income_tax: p.incomeTax,
        absence_deduction: p.absenceDeduction || 0,
        late_deduction: p.lateDeduction || 0,
        other_deduction: 0,
        deduction_note: '',
        insurance: p.laborInsurance + p.healthInsurance,
        deductions: p.totalDeductions,
        net_salary: p.netSalary,
      }))
      // 批次薪資：逐筆走 secure_upsert_salary
      const results = []
      for (const p of payloads) {
        const { data: row } = await supabase.rpc('secure_upsert_salary', {
          p_employee: p.employee, p_month: p.month,
          p_base_salary: p.base_salary, p_allowance: p.allowance ?? 0,
          p_overtime: p.overtime ?? 0, p_deductions: p.deductions ?? 0,
          p_insurance: p.insurance ?? 0, p_net_salary: p.net_salary ?? null,
        })
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
            <input type="month" className="form-input" value={month} onChange={e => setMonth(e.target.value)} style={{ fontSize: 13 }} />
            <button className="btn btn-primary" onClick={() => { setEditingRecord(null); setForm(emptyForm); setShowModal(true) }}>
              <Plus size={14} /> 新增薪資
            </button>
            <button className="btn btn-secondary" onClick={handleBatchPayroll}>
              <Calculator size={14} /> 批次計薪
            </button>
            <button className="btn btn-secondary" onClick={() => exportSalaryPdf(filtered, month)}>
              <Download size={14} /> 匯出 PDF
            </button>
          </div>
        </div>
      </div>

      {/* ── Store filter ── */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏪 門市</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
          <option value="">全部門市</option>
          {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
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
