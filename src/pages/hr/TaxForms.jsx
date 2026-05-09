import { useState, useEffect, useMemo } from 'react'
import { FileText, Download, RefreshCw, Calculator, Printer, Settings } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getTaxWithholdingRecords, upsertTaxWithholding } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { printWithholdingCertificate, printBatchCertificates } from '../../lib/withholdingCertificate'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
// 扣繳單位（公司）資料 — 存 localStorage，每次列印帶入
const COMPANY_KEY = 'sme_withholding_company'
const loadCompany = () => {
  try { return JSON.parse(localStorage.getItem(COMPANY_KEY) || '{}') } catch { return {} }
}
const saveCompany = (c) => localStorage.setItem(COMPANY_KEY, JSON.stringify(c || {}))

export default function TaxForms() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [salaries, setSalaries] = useState([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [computing, setComputing] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [format, setFormat] = useState('50')   // 50/52/54
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [company, setCompany] = useState(loadCompany)

  useEffect(() => {
    Promise.all([
      getTaxWithholdingRecords(year),
      supabase.from('employees').select('id, name, id_number, address, department_id, position, status, join_date, departments(name)').order('name'),
      supabase.from('salary_records').select('*').like('month', `${year}-%`).order('month'),
    ]).then(([r, e, s]) => {
      setRecords(r.data || [])
      setEmployees(e.data || [])
      setSalaries(s.data || [])
    }).catch(err => {
      console.error('Failed to load tax data:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [year])

  // 列印單張憑單
  const handlePrintOne = async (record) => {
    if (!company?.name) {
      if (!(await confirm({ message: '尚未設定扣繳單位（公司）資料，要先設定嗎？' }))) return
      setShowCompanyModal(true)
      return
    }
    const emp = employees.find(e => e.name === record.employee)
    printWithholdingCertificate({ record, employee: emp, company, format })
  }

  // 批次列印
  const handlePrintBatch = async () => {
    if (!company?.name) {
      if (!(await confirm({ message: '尚未設定扣繳單位（公司）資料，要先設定嗎？' }))) return
      setShowCompanyModal(true)
      return
    }
    if (records.length === 0) return toast.error('尚無資料可列印')
    printBatchCertificates({ records, employees, company, format })
  }

  const handleSaveCompany = () => {
    saveCompany(company)
    setShowCompanyModal(false)
    toast.error('扣繳單位資料已儲存（瀏覽器本機）')
  }

  const handleCompute = async () => {
    setComputing(true)
    const empSalaries = {}
    salaries.forEach(s => {
      if (!empSalaries[s.employee]) empSalaries[s.employee] = []
      empSalaries[s.employee].push(s)
    })

    const results = []
    for (const emp of employees) {
      const monthlyRecords = empSalaries[emp.name] || []
      if (!monthlyRecords.length) continue

      let grossSalary = 0, totalLI = 0, totalHI = 0, totalPensionEmp = 0, totalPensionEr = 0, totalTax = 0, totalBonus = 0

      monthlyRecords.forEach(m => {
        grossSalary += (m.base_salary || 0) + (m.allowance || 0) + (m.overtime || 0)
        totalLI += m.labor_insurance || 0
        totalHI += m.health_insurance || 0
        totalPensionEmp += m.pension_employee || 0
        totalPensionEr += m.pension_employer || 0
        totalTax += m.tax_withheld || 0
        totalBonus += m.bonus || 0
      })

      const taxableIncome = grossSalary - totalLI - totalHI - totalPensionEmp

      const record = {
        employee: emp.name,
        year,
        gross_salary: grossSalary,
        taxable_income: Math.max(taxableIncome, 0),
        tax_withheld: totalTax,
        labor_insurance: totalLI,
        health_insurance: totalHI,
        pension_employee: totalPensionEmp,
        pension_employer: totalPensionEr,
        bonus_total: totalBonus,
        status: '已產生',
        generated_at: new Date().toISOString(),
      }

      const { data } = await upsertTaxWithholding(record)
      if (data) results.push(data)
    }

    setRecords(results)
    setComputing(false)
    toast.success(`已產生 ${results.length} 筆扣繳憑單`)
  }

  const stats = useMemo(() => {
    const total = records.length
    const totalGross = records.reduce((s, r) => s + (r.gross_salary || 0), 0)
    const totalTax = records.reduce((s, r) => s + (r.tax_withheld || 0), 0)
    const generated = records.filter(r => r.status === '已產生').length
    return { total, totalGross, totalTax, generated }
  }, [records])

  const handleExportCSV = () => {
    const headers = ['員工', '年度', '給付總額', '所得淨額', '扣繳稅額', '勞保費', '健保費', '勞退自提', '勞退雇提', '獎金']
    const rows = records.map(r => [
      r.employee, r.year, r.gross_salary, r.taxable_income, r.tax_withheld,
      r.labor_insurance, r.health_insurance, r.pension_employee, r.pension_employer, r.bonus_total,
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `扣繳憑單_${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🧾</span> 扣繳憑單</h2>
            <p>年度薪資所得扣繳暨免扣繳憑單產製</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="form-input" style={{ fontSize: 13, width: 100 }} value={year} onChange={e => setYear(Number(e.target.value))}>
              {[2026, 2025, 2024].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="form-input" style={{ fontSize: 13, width: 200 }} value={format} onChange={e => setFormat(e.target.value)} title="所得格式">
              <option value="50">50 號 — 薪資所得</option>
              <option value="52">52 號 — 其他所得</option>
              <option value="54">54 號 — 執行業務所得</option>
            </select>
            <button className="btn btn-secondary" onClick={() => setShowCompanyModal(true)} title="設定扣繳單位資料">
              <Settings size={14} /> 公司資料
            </button>
            <button className="btn btn-secondary" onClick={handleCompute} disabled={computing}>
              <Calculator size={14} /> {computing ? '計算中...' : '重新計算'}
            </button>
            <button className="btn btn-secondary" onClick={handlePrintBatch} disabled={!records.length}>
              <Printer size={14} /> 批次列印 ({records.length})
            </button>
            <button className="btn btn-primary" onClick={handleExportCSV} disabled={!records.length}>
              <Download size={14} /> 匯出 CSV
            </button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'rgba(6,182,212,0.12)' }}>
          <div className="stat-card-label">已產生筆數</div>
          <div className="stat-card-value">{stats.generated}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'rgba(16,185,129,0.12)' }}>
          <div className="stat-card-label">給付總額</div>
          <div className="stat-card-value">${(stats.totalGross / 10000).toFixed(0)}萬</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'rgba(245,158,11,0.12)' }}>
          <div className="stat-card-label">扣繳稅額合計</div>
          <div className="stat-card-value">${stats.totalTax.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'rgba(139,92,246,0.12)' }}>
          <div className="stat-card-label">員工數</div>
          <div className="stat-card-value">{stats.total}</div>
        </div>
      </div>

      {/* Records table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📄</span> {year} 年度扣繳憑單</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>給付總額</th>
                <th>所得淨額</th>
                <th>扣繳稅額</th>
                <th>勞保費</th>
                <th>健保費</th>
                <th>勞退(自提)</th>
                <th>勞退(雇提)</th>
                <th>獎金</th>
                <th>狀態</th>
                <th>列印</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedEmp(selectedEmp === r.id ? null : r.id)}>
                  <td style={{ fontWeight: 600 }}>{r.employee}</td>
                  <td>${(r.gross_salary || 0).toLocaleString()}</td>
                  <td>${(r.taxable_income || 0).toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>${(r.tax_withheld || 0).toLocaleString()}</td>
                  <td>${(r.labor_insurance || 0).toLocaleString()}</td>
                  <td>${(r.health_insurance || 0).toLocaleString()}</td>
                  <td>${(r.pension_employee || 0).toLocaleString()}</td>
                  <td>${(r.pension_employer || 0).toLocaleString()}</td>
                  <td>${(r.bonus_total || 0).toLocaleString()}</td>
                  <td>
                    <span className={`badge ${r.status === '已產生' ? 'badge-success' : 'badge-info'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => handlePrintOne(r)}
                      title={`列印 ${format} 號扣繳憑單`}
                    >
                      <Printer size={11} /> 列印
                    </button>
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>尚無資料，請點擊「重新計算」產生扣繳憑單</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 扣繳單位（公司）資料 Modal — 存 localStorage */}
      {showCompanyModal && (
        <Modal title="扣繳單位（公司）資料" onClose={() => setShowCompanyModal(false)} onSubmit={handleSaveCompany} submitLabel="儲存">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: 10, borderRadius: 6, marginBottom: 12 }}>
            列印扣繳憑單時會自動帶入這些資料。儲存於瀏覽器本機（每台電腦各自設定）。
          </div>
          <Field label="公司名稱 *">
            <input className="form-input" style={{ width: '100%' }} value={company.name || ''}
              onChange={e => setCompany(c => ({ ...c, name: e.target.value }))}
              placeholder="例：○○有限公司" />
          </Field>
          <Field label="統一編號 *">
            <input className="form-input" style={{ width: '100%' }} value={company.tax_id || ''}
              onChange={e => setCompany(c => ({ ...c, tax_id: e.target.value }))}
              placeholder="8 位數" maxLength={8} />
          </Field>
          <Field label="公司地址">
            <input className="form-input" style={{ width: '100%' }} value={company.address || ''}
              onChange={e => setCompany(c => ({ ...c, address: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="扣繳義務人姓名">
              <input className="form-input" style={{ width: '100%' }} value={company.withholder_name || ''}
                onChange={e => setCompany(c => ({ ...c, withholder_name: e.target.value }))}
                placeholder="通常是負責人或 HR 主管" />
            </Field>
            <Field label="扣繳義務人身分證">
              <input className="form-input" style={{ width: '100%' }} value={company.withholder_id || ''}
                onChange={e => setCompany(c => ({ ...c, withholder_id: e.target.value }))}
                maxLength={10} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
