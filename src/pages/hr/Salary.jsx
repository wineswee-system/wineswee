import { useState, useEffect, useMemo } from 'react'
import { Download, ChevronDown, ChevronRight, Plus, Calculator, Users, Play } from 'lucide-react'
import { getSalaryRecords, upsertSalaryRecord, getEmployees } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { calculateLaborInsurance, calculateHealthInsurance, calculateLaborPension, calculateMonthlyWithholding, calculateNetSalary } from '../../lib/payroll'
import { exportSalaryPdf } from '../../lib/exportPdf'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

// ── Employee select grouped by department ──
function EmpSelect({ value, onChange, employees, departments }) {
  return (
    <select className="form-input" style={{ width: '100%' }} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">請選擇員工</option>
      {departments.map(d => (
        <optgroup key={d.id} label={d.name}>
          {employees.filter(e => e.dept === d.name).map(e => (
            <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

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
      const { data } = await supabase.from('salary_records').update(payload).eq('id', editingRecord.id).select().single()
      if (data) {
        setRecords(prev => prev.map(r => r.id === data.id ? data : r))
      }
    } else {
      const { data } = await supabase.from('salary_records').insert(payload).select().single()
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

    const preview = employees.map(emp => {
      const baseSalary = emp.base_salary || 0
      const att = attMap[emp.name] || { hours: 0, late: 0, days: 0 }
      const otHours = otMap[emp.name] || 0
      const absenceDays = lvMap[emp.name]?.absence || 0
      const overtimePay = Math.round(otHours * (baseSalary / 30 / 8) * 1.34)
      const absenceDeduction = Math.round(absenceDays * (baseSalary / 30))
      const lateDeduction = att.late * 100

      const result = calculateNetSalary(baseSalary, {
        dependents: 0, voluntaryPensionRate: 0,
        overtimePay, bonus: 0,
        otherDeductions: absenceDeduction + lateDeduction,
      })
      return {
        employee: emp.name, dept: emp.dept, base_salary: baseSalary,
        workDays: att.days, workHours: att.hours, otHours, absenceDays, lateCount: att.late,
        overtimePay, absenceDeduction, lateDeduction,
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
        allowance: 0,
        overtime: 0,
        bonus: 0,
        dependents: 0,
        voluntary_pension_rate: 0,
        labor_insurance: p.laborInsurance,
        health_insurance: p.healthInsurance,
        pension_self: p.pension,
        income_tax: p.incomeTax,
        absence_deduction: 0,
        late_deduction: 0,
        other_deduction: 0,
        deduction_note: '',
        insurance: p.laborInsurance + p.healthInsurance,
        deductions: p.totalDeductions,
        net_salary: p.netSalary,
      }))
      const { data } = await supabase.from('salary_records').upsert(payloads, { onConflict: 'employee,month' }).select()
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

  // ── Deduction breakdown row items ──
  function buildBreakdownItems(r) {
    const base = r.base_salary || 0
    const laborDetail = calculateLaborInsurance(base)
    const healthDetail = calculateHealthInsurance(base, r.dependents || 0)
    const pensionDetail = calculateLaborPension(base, (r.voluntary_pension_rate || 0) / 100)
    const dailyRate = Math.round(base / 30)
    const hourlyRate = Math.round(dailyRate / 8)

    return [
      { label: '底薪', value: base, color: 'var(--text-primary)', sign: '', section: 'add' },
      { label: '加班費', value: r.overtime || 0, color: 'var(--accent-cyan)', sign: '+', section: 'add',
        note: r.overtime ? `時薪 ${hourlyRate} = 月薪 ${base.toLocaleString()} ÷ 30 ÷ 8（勞基法 §24）` : null },
      { label: '津貼', value: r.allowance || 0, color: 'var(--accent-green)', sign: '+', section: 'add' },
      { label: '獎金', value: r.bonus || 0, color: 'var(--accent-purple)', sign: '+', section: 'add' },
      { label: null, section: 'divider-gross' },
      { label: '總薪資', value: base + (r.overtime || 0) + (r.allowance || 0) + (r.bonus || 0), color: 'var(--accent-cyan)', sign: '=', section: 'total', bold: true },
      { label: null, section: 'divider-deduct' },
      { label: '勞保自付額', value: r.labor_insurance || 0, color: 'var(--accent-orange)', sign: '-', section: 'deduct',
        note: `投保級距 ${laborDetail.insured_salary.toLocaleString()} × 12% × 20% = ${laborDetail.employee_share.toLocaleString()}（勞保條例 §15）` },
      { label: '健保自付額', value: r.health_insurance || 0, color: 'var(--accent-orange)', sign: '-', section: 'deduct',
        note: `投保級距 ${healthDetail.insured_salary.toLocaleString()} × 5.17% × 30%${r.dependents ? ` × ${1 + Math.min(r.dependents, 3)}口` : ''} = ${healthDetail.employee_share.toLocaleString()}（健保法 §27）` },
      { label: '勞退自提', value: r.pension_self || 0, color: 'var(--accent-orange)', sign: '-', section: 'deduct',
        note: r.voluntary_pension_rate ? `提繳工資 ${Math.min(base, 150000).toLocaleString()} × ${r.voluntary_pension_rate}% = ${pensionDetail.employee_voluntary.toLocaleString()}（勞退條例 §14）` : '未自提（可自提 0~6% 節稅，勞退條例 §14）' },
      { label: '所得稅扣繳', value: r.income_tax || 0, color: 'var(--accent-red)', sign: '-', section: 'deduct',
        note: '依各類所得扣繳率標準（所得稅法 §88）' },
      { label: '事假扣薪', value: r.absence_deduction || 0, color: 'var(--accent-red)', sign: '-', section: 'deduct',
        note: r.absence_deduction ? `日薪 ${dailyRate.toLocaleString()} = 月薪 ÷ 30（勞工請假規則 §7，不給薪）` : null },
      { label: '遲到扣薪', value: r.late_deduction || 0, color: 'var(--accent-red)', sign: '-', section: 'deduct' },
      { label: `其他扣款${r.deduction_note ? `（${r.deduction_note}）` : ''}`, value: r.other_deduction || 0, color: 'var(--accent-red)', sign: '-', section: 'deduct' },
    ]
  }

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

      {/* ── Department filter ── */}
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
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 薪資明細</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>點擊列展開完整計算過程</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>員工</th>
                <th>部門</th>
                <th>底薪</th>
                <th>加班費</th>
                <th>津貼</th>
                <th>獎金</th>
                <th style={{ color: 'var(--accent-orange)' }}>勞保</th>
                <th style={{ color: 'var(--accent-orange)' }}>健保</th>
                <th style={{ color: 'var(--accent-orange)' }}>勞退自提</th>
                <th style={{ color: 'var(--accent-red)' }}>所得稅</th>
                <th style={{ fontWeight: 800 }}>實領薪資</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={13} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>本月尚無薪資紀錄</td></tr>
              )}
              {filtered.map(r => {
                const bonusDetail = getBonusDetail(r.employee)
                const isExpanded = expanded === r.id
                const breakdownItems = buildBreakdownItems(r)
                const gross = (r.base_salary || 0) + (r.overtime || 0) + (r.allowance || 0) + (r.bonus || 0)
                return (
                  <tbody key={r.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExpanded ? null : r.id)}>
                      <td>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td style={{ fontWeight: 600 }}>{r.employee}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(r.employee) || '-'}</td>
                      <td>{fmt(r.base_salary)}</td>
                      <td style={{ color: 'var(--accent-cyan)' }}>{r.overtime ? `+${(r.overtime).toLocaleString()}` : '-'}</td>
                      <td style={{ color: 'var(--accent-green)' }}>{r.allowance ? `+${(r.allowance).toLocaleString()}` : '-'}</td>
                      <td style={{ color: 'var(--accent-purple)' }}>{r.bonus ? `+${(r.bonus).toLocaleString()}` : '-'}</td>
                      <td style={{ color: 'var(--accent-orange)', fontSize: 12 }}>-{(r.labor_insurance || 0).toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-orange)', fontSize: 12 }}>-{(r.health_insurance || 0).toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-orange)', fontSize: 12 }}>{r.pension_self ? `-${r.pension_self.toLocaleString()}` : '-'}</td>
                      <td style={{ color: 'var(--accent-red)', fontSize: 12 }}>{r.income_tax ? `-${r.income_tax.toLocaleString()}` : '-'}</td>
                      <td style={{ fontWeight: 800, color: 'var(--accent-green)', fontSize: 15 }}>{fmt(r.net_salary)}</td>
                      <td>
                        <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={e => { e.stopPropagation(); openEdit(r) }}>編輯</button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={13} style={{ padding: 0 }}>
                          <div style={{ background: 'var(--glass-light)', padding: '16px 24px', borderTop: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

                              {/* Payroll breakdown */}
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📐 薪資計算明細</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  {breakdownItems.map((item, i) => {
                                    if (item.section === 'divider-gross' || item.section === 'divider-deduct') {
                                      return <div key={i} style={{ borderTop: '1px dashed var(--border-medium)', margin: '4px 0' }} />
                                    }
                                    if (item.section === 'total') {
                                      return (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'var(--accent-cyan-dim)', border: '1px solid var(--accent-cyan)', fontSize: 13 }}>
                                          <span style={{ fontWeight: 700 }}>{item.sign} {item.label}</span>
                                          <span style={{ color: item.color, fontWeight: 800 }}>{fmt(item.value)}</span>
                                        </div>
                                      )
                                    }
                                    return (
                                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: 7, background: 'var(--bg-card)', fontSize: 13 }}>
                                        <div>
                                          <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                                          {item.note && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.note}</div>}
                                        </div>
                                        <span style={{ color: item.value === 0 ? 'var(--text-muted)' : item.color, fontWeight: 600 }}>
                                          {item.value === 0 ? '—' : `${item.sign} ${fmt(item.value).replace('NT$ ', 'NT$ ')}`}
                                        </span>
                                      </div>
                                    )
                                  })}
                                  {/* Net salary */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', fontSize: 14, marginTop: 6 }}>
                                    <span style={{ fontWeight: 700 }}>= 實領薪資</span>
                                    <span style={{ color: 'var(--accent-green)', fontWeight: 800 }}>{fmt(r.net_salary)}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Bonus detail */}
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>🏆 獎金明細</div>
                                {bonusDetail.length === 0 ? (
                                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 16, background: 'var(--bg-card)', borderRadius: 8, textAlign: 'center' }}>
                                    本月尚無獎金紀錄<br />
                                    <span style={{ fontSize: 11 }}>可至「績效獎金」頁面新增</span>
                                  </div>
                                ) : bonusDetail.map(b => (
                                  <div key={b.id} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', marginBottom: 8, border: '1px solid var(--border-subtle)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                      <span style={{ fontSize: 13, fontWeight: 700 }}>{b.role_type} 獎金</span>
                                      <span style={{ color: 'var(--accent-purple)', fontWeight: 800 }}>{fmt(b.total_bonus)}</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                                        <span>基本績效獎</span><span>{fmt(b.base_bonus)}</span>
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                                        <span>數據達標獎</span><span>{fmt(b.data_bonus)}</span>
                                      </div>
                                    </div>
                                    {b.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, padding: '4px 8px', background: 'var(--glass-light)', borderRadius: 6 }}>說明：{b.notes}</div>}
                                  </div>
                                ))}

                                {/* Legal reference */}
                                <div style={{ marginTop: 16 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>📖 法規依據</div>
                                  <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {[
                                      { law: '勞基法 §24', desc: '加班費計算：前2h加給1/3，後2h加給2/3' },
                                      { law: '勞基法 §38-4', desc: '特休未休應折算工資（日薪 × 未休天數）' },
                                      { law: '勞保條例 §15', desc: '勞保費分攤：勞工20%、雇主70%、政府10%' },
                                      { law: '健保法 §27', desc: '健保費分攤：被保險人30%、雇主60%、政府10%' },
                                      { law: '勞退條例 §14', desc: '雇主提繳6%，勞工可自提0~6%（免稅）' },
                                      { law: '所得稅法 §88', desc: '薪資所得扣繳，依扣繳率標準表計算' },
                                      { law: '2026 基本工資', desc: '月薪 NT$29,500 / 時薪 NT$196' },
                                    ].map((item, i) => (
                                      <div key={i} style={{ display: 'flex', gap: 8 }}>
                                        <span style={{ color: 'var(--accent-cyan)', fontWeight: 600, whiteSpace: 'nowrap' }}>{item.law}</span>
                                        <span>{item.desc}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Employer cost summary */}
                                <div style={{ marginTop: 16 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>🏢 雇主成本（參考）</div>
                                  <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {(() => {
                                      const laborEr = calculateLaborInsurance(r.base_salary || 0).employer_share
                                      const healthEr = calculateHealthInsurance(r.base_salary || 0, r.dependents || 0).employer_share
                                      const pensionEr = calculateLaborPension(r.base_salary || 0).employer_contribution
                                      return (
                                        <>
                                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>勞保雇主負擔</span><span>{fmt(laborEr)}</span>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>健保雇主負擔</span><span>{fmt(healthEr)}</span>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>勞退 6% 提繳</span><span>{fmt(pensionEr)}</span>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 4, marginTop: 2 }}>
                                            <span style={{ fontWeight: 600 }}>雇主額外成本</span>
                                            <span style={{ fontWeight: 700, color: 'var(--accent-red)' }}>{fmt(laborEr + healthEr + pensionEr)}</span>
                                          </div>
                                        </>
                                      )
                                    })()}
                                  </div>
                                </div>
                              </div>

                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create / Edit Modal ── */}
      {showModal && (
        <Modal title={editingRecord ? '編輯薪資紀錄' : '新增薪資紀錄'} onClose={() => { setShowModal(false); setEditingRecord(null); setForm(emptyForm) }} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工 *">
              <EmpSelect value={form.employee} onChange={v => set('employee', v)} employees={employees} departments={departments} />
            </Field>
            <Field label="月份">
              <input className="form-input" type="month" style={{ width: '100%' }} value={form.month} onChange={e => set('month', e.target.value)} />
            </Field>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-green)', margin: '8px 0 4px' }}>▲ 薪資項目</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            <Field label="底薪">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} />
            </Field>
            <Field label="加班費">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.overtime_pay} onChange={e => set('overtime_pay', e.target.value)} />
            </Field>
            <Field label="津貼">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.allowances} onChange={e => set('allowances', e.target.value)} />
            </Field>
            <Field label="獎金">
              <input className="form-input" type="number" style={{ width: '100%', borderColor: 'var(--accent-purple)' }} placeholder="0" value={form.bonus} onChange={e => set('bonus', e.target.value)} />
            </Field>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-orange)', margin: '8px 0 4px' }}>⚙ 保險參數</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="健保眷屬人數">
              <input className="form-input" type="number" min="0" max="3" style={{ width: '100%' }} value={form.dependents} onChange={e => set('dependents', e.target.value)} />
            </Field>
            <Field label="勞退自提比率 (%)">
              <input className="form-input" type="number" min="0" max="6" step="1" style={{ width: '100%' }} placeholder="0" value={form.voluntary_pension_rate} onChange={e => set('voluntary_pension_rate', e.target.value)} />
            </Field>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-red)', margin: '8px 0 4px' }}>▼ 其他扣款</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="事假扣薪">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.absence_deduction} onChange={e => set('absence_deduction', e.target.value)} />
            </Field>
            <Field label="遲到扣薪">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.late_deduction} onChange={e => set('late_deduction', e.target.value)} />
            </Field>
            <Field label="其他扣款">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.other_deduction} onChange={e => set('other_deduction', e.target.value)} />
            </Field>
          </div>
          <Field label="其他扣款說明">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：預支薪資扣還、公司借款..." value={form.deduction_note} onChange={e => set('deduction_note', e.target.value)} />
          </Field>

          {/* ── Real-time auto-calculation panel ── */}
          <div style={{ background: 'var(--glass-light)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border-medium)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
              <Calculator size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              自動計算預覽（即時更新）
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
                <span style={{ color: 'var(--text-muted)' }}>總薪資</span>
                <span style={{ fontWeight: 600 }}>{fmt(deductions.gross)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
                <span style={{ color: 'var(--accent-orange)' }}>勞保自付</span>
                <span style={{ fontWeight: 600 }}>-{deductions.laborIns.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
                <span style={{ color: 'var(--accent-orange)' }}>健保自付</span>
                <span style={{ fontWeight: 600 }}>-{deductions.healthIns.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
                <span style={{ color: 'var(--accent-orange)' }}>勞退自提</span>
                <span style={{ fontWeight: 600 }}>{deductions.pensionSelf > 0 ? `-${deductions.pensionSelf.toLocaleString()}` : '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
                <span style={{ color: 'var(--accent-red)' }}>所得稅扣繳</span>
                <span style={{ fontWeight: 600 }}>{deductions.incomeTax > 0 ? `-${deductions.incomeTax.toLocaleString()}` : '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
                <span style={{ color: 'var(--accent-red)' }}>其他扣款</span>
                <span style={{ fontWeight: 600 }}>{deductions.manualDeductions > 0 ? `-${deductions.manualDeductions.toLocaleString()}` : '—'}</span>
              </div>
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', fontSize: 14, fontWeight: 700, color: 'var(--accent-green)', textAlign: 'center', marginTop: 10 }}>
              實領薪資：{fmt(deductions.net)}
            </div>
          </div>
        </Modal>
      )}

      {/* ── Batch Payroll Modal ── */}
      {showBatchModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'var(--bg-modal-overlay)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowBatchModal(false)}>
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            borderRadius: 16,
            width: '100%', maxWidth: 900,
            maxHeight: '85vh',
            boxShadow: 'var(--shadow-xl)',
            animation: 'fadeIn 0.15s ease',
            display: 'flex', flexDirection: 'column',
          }} onClick={e => e.stopPropagation()}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>
                <Calculator size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                批次計薪預覽 — {month}
              </h3>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {batchPreview.length} 位員工</span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
              <div className="data-table-wrapper">
                <table className="data-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>員工</th>
                      <th>部門</th>
                      <th>底薪</th>
                      <th>總薪資</th>
                      <th style={{ color: 'var(--accent-orange)' }}>勞保</th>
                      <th style={{ color: 'var(--accent-orange)' }}>健保</th>
                      <th style={{ color: 'var(--accent-red)' }}>所得稅</th>
                      <th style={{ color: 'var(--accent-red)' }}>扣除合計</th>
                      <th style={{ color: 'var(--accent-green)', fontWeight: 800 }}>實領</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchPreview.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{p.employee}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{p.dept || '-'}</td>
                        <td>{fmt(p.base_salary)}</td>
                        <td>{fmt(p.gross)}</td>
                        <td style={{ color: 'var(--accent-orange)' }}>-{p.laborInsurance.toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-orange)' }}>-{p.healthInsurance.toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-red)' }}>{p.incomeTax > 0 ? `-${p.incomeTax.toLocaleString()}` : '—'}</td>
                        <td style={{ color: 'var(--accent-red)', fontWeight: 600 }}>-{p.totalDeductions.toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-green)', fontWeight: 800 }}>{fmt(p.netSalary)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                      <td colSpan={3}>合計</td>
                      <td>{fmt(batchPreview.reduce((s, p) => s + p.gross, 0))}</td>
                      <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + p.laborInsurance, 0).toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-orange)' }}>-{batchPreview.reduce((s, p) => s + p.healthInsurance, 0).toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-red)' }}>-{batchPreview.reduce((s, p) => s + p.incomeTax, 0).toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-red)' }}>-{batchPreview.reduce((s, p) => s + p.totalDeductions, 0).toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-green)' }}>{fmt(batchPreview.reduce((s, p) => s + p.netSalary, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                使用員工底薪計算，不含加班費 / 獎金 / 扣款。儲存後可逐筆編輯調整。
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setShowBatchModal(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleBatchSave} disabled={batchSaving}>
                  {batchSaving ? '儲存中...' : (<><Play size={14} /> 確認儲存 {batchPreview.length} 筆</>)}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
