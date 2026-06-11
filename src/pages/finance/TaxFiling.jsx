import { useState, useEffect } from 'react'
import { FileText, Upload, Download, CheckCircle, Clock, AlertTriangle, Send, Printer, Calendar } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { generate401Report, generate403Report, generateMediaFile } from '../../lib/taxReport'
import LoadingSpinner from '../../components/LoadingSpinner'
import { exportToCSV, exportToPDF } from '../../lib/exportUtils'

import { fmtNT as fmt } from '../../lib/currency'
const toROCYear = (y) => y - 1911

const BIMONTH_PERIODS = [
  { label: '1-2月', startMonth: 1, endMonth: 2 },
  { label: '3-4月', startMonth: 3, endMonth: 4 },
  { label: '5-6月', startMonth: 5, endMonth: 6 },
  { label: '7-8月', startMonth: 7, endMonth: 8 },
  { label: '9-10月', startMonth: 9, endMonth: 10 },
  { label: '11-12月', startMonth: 11, endMonth: 12 },
]

const STATUS_MAP = {
  '待申報': { icon: Clock, cls: 'badge-warning' },
  '已產生': { icon: FileText, cls: 'badge-info' },
  '已申報': { icon: Send, cls: 'badge-success' },
  '已確認': { icon: CheckCircle, cls: 'badge-success' },
}

export default function TaxFiling() {
  const now = new Date()
  const [tab, setTab] = useState('401')
  const [year, setYear] = useState(now.getFullYear())
  const [periodIdx, setPeriodIdx] = useState(Math.floor((now.getMonth()) / 2))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [arData, setArData] = useState([])
  const [apData, setApData] = useState([])
  const [salaryData, setSalaryData] = useState([])
  const [report401, setReport401] = useState(null)
  const [report403, setReport403] = useState(null)
  const [filingHistory, setFilingHistory] = useState([])

  const rocYear = toROCYear(year)
  const period = BIMONTH_PERIODS[periodIdx]

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('accounts_receivable').select('*'),
      supabase.from('accounts_payable').select('*'),
      supabase.from('salary_records').select('*'),
      supabase.from('tax_filings').select('*').order('id', { ascending: false }),
    ]).then(([ar, ap, sal, fil]) => {
      setArData(ar.data || [])
      setApData(ap.data || [])
      setSalaryData(sal.data || [])
      setFilingHistory(fil.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [])

  // Filter data by selected period
  const filterByPeriod = (items, dateField = 'date') => {
    const start = `${year}-${String(period.startMonth).padStart(2, '0')}-01`
    const endMonth = period.endMonth
    const endDate = new Date(year, endMonth, 0)
    const end = endDate.toISOString().slice(0, 10)
    return items.filter(item => {
      const d = item[dateField] || item.invoice_date || item.created_at || ''
      return d >= start && d <= end
    })
  }

  const filteredAR = filterByPeriod(arData, 'due_date')
  const filteredAP = filterByPeriod(apData, 'due_date')
  const filteredSalary = salaryData.filter(s => {
    const m = s.month || s.pay_month || ''
    return m.startsWith(String(year))
  })

  // KPI calculations for 401
  const salesCount = filteredAR.length
  const salesAmount = filteredAR.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const purchaseCount = filteredAP.length
  const purchaseAmount = filteredAP.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const salesTax = Math.round(salesAmount * 0.05)
  const purchaseTax = Math.round(purchaseAmount * 0.05)
  const netTax = salesTax - purchaseTax

  const handleGenerate401 = () => {
    const salesInvoices = filteredAR.map(r => ({
      invoice_no: r.invoice_number || r.id,
      date: r.due_date || r.created_at,
      buyer_tax_id: r.tax_id || '',
      buyer_name: r.customer_name || r.description || '',
      amount: Number(r.amount) || 0,
    }))
    const purchaseInvoices = filteredAP.map(r => ({
      invoice_no: r.invoice_number || r.id,
      date: r.due_date || r.created_at,
      seller_tax_id: r.tax_id || '',
      seller_name: r.vendor_name || r.description || '',
      amount: Number(r.amount) || 0,
    }))
    const result = generate401Report(salesInvoices, purchaseInvoices, { year, startMonth: period.startMonth, endMonth: period.endMonth })
    setReport401(result)
  }

  const handleGenerate403 = () => {
    const records = filteredSalary.map(s => ({
      payee_id: s.employee_id || s.id,
      payee_name: s.employee_name || '',
      income_type: s.income_type || '50',
      gross_amount: Number(s.gross_salary || s.amount) || 0,
      tax_withheld: Number(s.tax_withheld || s.withholding_tax) || 0,
    }))
    const result = generate403Report(records, { year, startMonth: 1, endMonth: 12 })
    setReport403(result)
  }

  const handleMediaDownload = (type) => {
    const report = type === '401' ? report401 : report403
    if (!report) return
    const content = generateMediaFile(report, type)
    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}_${rocYear}年_媒體申報檔.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCSV = () => {
    if (tab === '401' && report401) {
      const rows = [...(report401.rows?.sales || []), ...(report401.rows?.purchases || [])]
      exportToCSV(rows, [
        { key: 'invoice_no', label: '發票號碼' },
        { key: 'date', label: '日期' },
        { key: 'amount', label: '金額' },
        { key: 'tax', label: '稅額' },
      ], `401報表_${rocYear}年${period.label}`)
    } else if (tab === '403' && report403) {
      exportToCSV(report403.records, [
        { key: 'payee_name', label: '所得人' },
        { key: 'income_type_name', label: '所得類別' },
        { key: 'gross_amount', label: '給付總額' },
        { key: 'tax_withheld', label: '扣繳稅額' },
      ], `403報表_${rocYear}年`)
    }
  }

  const handleExportPDF = () => {
    exportToPDF(`${tab}申報報表 — ${rocYear}年${tab === '401' ? period.label : ''}`)
  }

  const statusBadge = (status) => {
    const cfg = STATUS_MAP[status] || STATUS_MAP['待申報']
    const Icon = cfg.icon
    return <span className={`badge ${cfg.cls}`}><Icon size={14} style={{ marginRight: 4 }} />{status}</span>
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1>📋 營業稅申報</h1>
          <p>401/403 申報管理</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleExportCSV} disabled={tab === '401' ? !report401 : !report403}><Download size={16} /> 匯出 CSV</button>
          <button className="btn btn-primary" onClick={handleExportPDF}><Printer size={16} /> 匯出 PDF</button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="card" style={{ marginBottom: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Calendar size={18} />
        <label>年度</label>
        <select className="form-input" style={{ width: 120 }} value={year} onChange={e => setYear(Number(e.target.value))}>
          {[...Array(5)].map((_, i) => { const y = now.getFullYear() - 2 + i; return <option key={y} value={y}>{toROCYear(y)}年 ({y})</option> })}
        </select>
        {tab === '401' && (
          <>
            <label>期別</label>
            <select className="form-input" style={{ width: 140 }} value={periodIdx} onChange={e => setPeriodIdx(Number(e.target.value))}>
              {BIMONTH_PERIODS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
        {[{ key: '401', label: '401 營業稅' }, { key: '403', label: '403 扣繳申報' }].map(t => (
          <button key={t.key} className={`btn ${tab === t.key ? 'btn-primary' : ''}`} style={{ borderRadius: tab === t.key ? '8px 8px 0 0' : '8px 8px 0 0', minWidth: 140 }} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* 401 Tab */}
      {tab === '401' && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card"><div className="stat-label">銷項發票數</div><div className="stat-value">{salesCount} 張</div></div>
            <div className="stat-card"><div className="stat-label">銷項金額</div><div className="stat-value">{fmt(salesAmount)}</div></div>
            <div className="stat-card"><div className="stat-label">進項發票數</div><div className="stat-value">{purchaseCount} 張</div></div>
            <div className="stat-card"><div className="stat-label">進項金額</div><div className="stat-value">{fmt(purchaseAmount)}</div></div>
          </div>

          {/* Sales Summary */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><h3 className="card-title">銷項發票彙總</h3></div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>編號</th><th>客戶</th><th>到期日</th><th>金額</th><th>稅額(5%)</th></tr></thead>
                <tbody>
                  {filteredAR.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center' }}>本期無銷項資料</td></tr> : filteredAR.map((r, i) => (
                    <tr key={i}>
                      <td>{r.invoice_number || r.id}</td>
                      <td>{r.customer_name || r.description}</td>
                      <td>{r.due_date}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.amount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(Math.round((Number(r.amount) || 0) * 0.05))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Purchase Summary */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><h3 className="card-title">進項發票彙總</h3></div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>編號</th><th>供應商</th><th>到期日</th><th>金額</th><th>稅額(5%)</th></tr></thead>
                <tbody>
                  {filteredAP.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center' }}>本期無進項資料</td></tr> : filteredAP.map((r, i) => (
                    <tr key={i}>
                      <td>{r.invoice_number || r.id}</td>
                      <td>{r.vendor_name || r.description}</td>
                      <td>{r.due_date}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.amount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(Math.round((Number(r.amount) || 0) * 0.05))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tax Calculation */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><h3 className="card-title">稅額計算</h3></div>
            <div style={{ padding: 16 }}>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <tbody>
                    <tr><td>銷項稅額</td><td style={{ textAlign: 'right' }}>{fmt(salesTax)}</td></tr>
                    <tr><td>進項稅額</td><td style={{ textAlign: 'right' }}>{fmt(purchaseTax)}</td></tr>
                    <tr style={{ fontWeight: 700, fontSize: '1.1em' }}>
                      <td>{netTax >= 0 ? '應納稅額' : '溢付稅額'}</td>
                      <td style={{ textAlign: 'right', color: netTax >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{fmt(Math.abs(netTax))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <button className="btn btn-primary" onClick={handleGenerate401}><FileText size={16} /> 產生401報表</button>
            <button className="btn btn-primary" onClick={() => handleMediaDownload('401')} disabled={!report401}><Upload size={16} /> 產生媒體申報檔</button>
          </div>

          {report401 && (
            <div className="card" style={{ marginBottom: 16, border: '2px solid var(--accent-green)' }}>
              <div className="card-header"><h3 className="card-title"><CheckCircle size={18} /> 401 報表已產生</h3></div>
              <div style={{ padding: 16 }}>
                <p>期別：{report401.period}</p>
                <p>銷項 {report401.salesInvoiceCount} 張 / 稅額 {fmt(report401.salesTax)}</p>
                <p>進項 {report401.purchaseInvoiceCount} 張 / 稅額 {fmt(report401.purchaseTax)}</p>
                <p style={{ fontWeight: 700 }}>{report401.netTax >= 0 ? '應納稅額' : '溢付稅額'}：{fmt(Math.abs(report401.netTax))}</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* 403 Tab */}
      {tab === '403' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header"><h3 className="card-title">各類所得扣繳彙總 — {rocYear}年</h3></div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>員工</th><th>所得類別</th><th>給付總額</th><th>扣繳稅額</th></tr></thead>
                <tbody>
                  {filteredSalary.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center' }}>本年度無扣繳資料</td></tr> : filteredSalary.map((s, i) => (
                    <tr key={i}>
                      <td>{s.employee_name || s.employee_id}</td>
                      <td>{s.income_type === '50' || !s.income_type ? '薪資所得' : s.income_type}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(s.gross_salary || s.amount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(s.tax_withheld || s.withholding_tax || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 16, fontWeight: 700 }}>
              合計扣繳稅額：{fmt(filteredSalary.reduce((s, r) => s + (Number(r.tax_withheld || r.withholding_tax) || 0), 0))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <button className="btn btn-primary" onClick={handleGenerate403}><FileText size={16} /> 產生403報表</button>
            <button className="btn btn-primary" onClick={() => handleMediaDownload('403')} disabled={!report403}><Upload size={16} /> 產生媒體申報檔</button>
          </div>

          {report403 && (
            <div className="card" style={{ marginBottom: 16, border: '2px solid var(--accent-green)' }}>
              <div className="card-header"><h3 className="card-title"><CheckCircle size={18} /> 403 報表已產生</h3></div>
              <div style={{ padding: 16 }}>
                <p>期別：{report403.period}</p>
                {report403.summary_by_type.map((t, i) => (
                  <p key={i}>{t.income_type_name}：{t.count} 筆 / 給付 {fmt(t.total_gross)} / 扣繳 {fmt(t.total_withheld)}</p>
                ))}
                <p style={{ fontWeight: 700 }}>合計扣繳：{fmt(report403.summary.total_withheld)}</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Filing History */}
      <div className="card">
        <div className="card-header"><h3 className="card-title">申報歷史紀錄</h3></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>期別</th><th>類型</th><th>金額</th><th>狀態</th><th>申報日期</th></tr></thead>
            <tbody>
              {filingHistory.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center' }}>尚無申報紀錄</td></tr> : filingHistory.map((f, i) => (
                <tr key={i}>
                  <td>{f.period}</td>
                  <td>{f.type}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(f.amount)}</td>
                  <td>{statusBadge(f.status)}</td>
                  <td>{f.filed_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
