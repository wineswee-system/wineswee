import { useState } from 'react'
import { FileText, Download, Printer, Calculator } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { generate401FromDB, taxReportToCSV } from '../../lib/taxReport'
import { exportTaxReportPdf } from '../../lib/exportPdf'
import LoadingSpinner from '../../components/LoadingSpinner'

import { fmtNT as fmt } from '../../lib/currency'

const PERIOD_OPTIONS = [
  { value: 1, label: '第1期 (1-2月)' },
  { value: 2, label: '第2期 (3-4月)' },
  { value: 3, label: '第3期 (5-6月)' },
  { value: 4, label: '第4期 (7-8月)' },
  { value: 5, label: '第5期 (9-10月)' },
  { value: 6, label: '第6期 (11-12月)' },
]

export default function TaxReport() {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentPeriod = Math.ceil((now.getMonth() + 1) / 2)

  const [year, setYear] = useState(currentYear)
  const [period, setPeriod] = useState(currentPeriod)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)

  const yearOptions = []
  for (let y = currentYear - 2; y <= currentYear + 2; y++) {
    yearOptions.push(y)
  }

  const handleGenerate = () => {
    setLoading(true)
    setError(null)
    setReport(null)

    generate401FromDB(year, period, supabase)
      .then(data => {
        setReport(data)
      })
      .catch(err => {
        console.error('Failed to generate 401 report:', err)
        setError(err.message || '產生報表失敗，請重新嘗試')
      })
      .finally(() => {
        setLoading(false)
      })
  }

  const handleExportPdf = () => {
    if (!report) return
    exportTaxReportPdf(report)
  }

  const handleExportCsv = () => {
    if (!report) return
    const csv = taxReportToCSV(report)
    const bom = '\uFEFF'
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `401-tax-report-${report.startDate}-${report.endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const thStyle = {
    textAlign: 'right',
    fontFamily: 'monospace',
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Calculator size={22} /></span> 營業稅申報 Tax Report</h2>
            <p>401 營業稅申報表 -- 雙月申報</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleExportPdf} disabled={!report}>
              <Printer size={14} /> 匯出 PDF
            </button>
            <button className="btn btn-primary" onClick={handleExportCsv} disabled={!report}>
              <Download size={14} /> 匯出 CSV
            </button>
          </div>
        </div>
      </div>

      {/* Period Selector */}
      <div className="card" style={{ marginBottom: 20, padding: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ fontWeight: 600 }}>年度</label>
        <select
          className="form-input"
          style={{ width: 150 }}
          value={year}
          onChange={e => setYear(Number(e.target.value))}
        >
          {yearOptions.map(y => (
            <option key={y} value={y}>{y - 1911}年 ({y})</option>
          ))}
        </select>

        <label style={{ fontWeight: 600 }}>期別</label>
        <select
          className="form-input"
          style={{ width: 180 }}
          value={period}
          onChange={e => setPeriod(Number(e.target.value))}
        >
          {PERIOD_OPTIONS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        <button className="btn btn-primary" onClick={handleGenerate} disabled={loading}>
          <FileText size={14} /> {loading ? '產生中...' : '產生報表'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: 24, color: 'var(--accent-red)', textAlign: 'center', marginBottom: 20, background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--accent-red)' }}>
          <h3>{error}</h3>
          <button className="btn btn-primary" onClick={handleGenerate} style={{ marginTop: 12 }}>重新嘗試</button>
        </div>
      )}

      {/* Loading */}
      {loading && <LoadingSpinner />}

      {/* Report Display */}
      {report && !loading && (
        <>
          {/* Period Info */}
          <div className="card" style={{ marginBottom: 20, padding: 16, background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <span style={{ fontSize: 18, fontWeight: 700 }}>401 營業稅申報表</span>
                <span style={{ marginLeft: 12, color: 'var(--text-secondary)' }}>
                  {report.period} ({report.startDate} ~ {report.endDate})
                </span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                產生時間：{new Date().toLocaleString('zh-TW')}
              </span>
            </div>
          </div>

          {/* Section 1 - Sales / Output */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <h3 className="card-title">一、銷項 (Sales / Output)</h3>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>項目</th>
                    <th style={{ textAlign: 'right' }}>發票張數</th>
                    <th style={{ textAlign: 'right' }}>銷售額(未稅)</th>
                    <th style={{ textAlign: 'right' }}>稅額</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>應稅 (5%)</td>
                    <td style={thStyle}>{report.sales.taxable.count}</td>
                    <td style={thStyle}>{fmt(report.sales.taxable.amount)}</td>
                    <td style={thStyle}>{fmt(report.sales.taxable.tax)}</td>
                  </tr>
                  <tr>
                    <td>零稅率</td>
                    <td style={thStyle}>{report.sales.zeroRated.count}</td>
                    <td style={thStyle}>{fmt(report.sales.zeroRated.amount)}</td>
                    <td style={thStyle}>NT$ 0</td>
                  </tr>
                  <tr>
                    <td>免稅</td>
                    <td style={thStyle}>{report.sales.exempt.count}</td>
                    <td style={thStyle}>{fmt(report.sales.exempt.amount)}</td>
                    <td style={thStyle}>NT$ 0</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, background: 'var(--glass-light)' }}>
                    <td>合計</td>
                    <td style={thStyle}>{report.sales.total.count}</td>
                    <td style={thStyle}>{fmt(report.sales.total.amount)}</td>
                    <td style={thStyle}>{fmt(report.sales.total.tax)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Section 2 - Purchases / Input */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <h3 className="card-title">二、進項 (Purchases / Input)</h3>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>項目</th>
                    <th style={{ textAlign: 'right' }}>張數</th>
                    <th style={{ textAlign: 'right' }}>進貨額(未稅)</th>
                    <th style={{ textAlign: 'right' }}>稅額</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>應稅進項</td>
                    <td style={thStyle}>{report.purchases.taxable.count}</td>
                    <td style={thStyle}>{fmt(report.purchases.taxable.amount)}</td>
                    <td style={thStyle}>{fmt(report.purchases.taxable.tax)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, background: 'var(--glass-light)' }}>
                    <td>合計</td>
                    <td style={thStyle}>{report.purchases.total.count}</td>
                    <td style={thStyle}>{fmt(report.purchases.total.amount)}</td>
                    <td style={thStyle}>{fmt(report.purchases.total.tax)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Section 3 - Tax Summary */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <h3 className="card-title">三、應納稅額計算</h3>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 500 }}>
                <div style={{ fontWeight: 600 }}>銷項稅額</div>
                <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 16 }}>{fmt(report.summary.outputTax)}</div>

                <div style={{ fontWeight: 600 }}>進項稅額</div>
                <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 16 }}>{fmt(report.summary.inputTax)}</div>

                <div style={{ borderTop: '2px solid var(--border)', paddingTop: 12, gridColumn: '1 / -1' }} />

                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  {report.summary.isRefund ? '溢付稅額（留抵）' : '應納稅額'}
                </div>
                <div style={{
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  fontSize: 22,
                  fontWeight: 700,
                  color: report.summary.isRefund ? 'var(--accent-blue)' : 'var(--accent-green)',
                }}>
                  {fmt(Math.abs(report.summary.taxPayable))}
                </div>
              </div>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label">銷項發票數</div>
              <div className="stat-card-value">{report.sales.total.count} 張</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">銷項稅額</div>
              <div className="stat-card-value">{fmt(report.summary.outputTax)}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">進項稅額</div>
              <div className="stat-card-value">{fmt(report.summary.inputTax)}</div>
            </div>
            <div className="stat-card" style={{
              '--card-accent': report.summary.isRefund ? 'var(--accent-blue)' : 'var(--accent-green)',
              '--card-accent-dim': report.summary.isRefund ? 'var(--accent-blue-dim)' : 'var(--accent-green-dim)',
            }}>
              <div className="stat-card-label">{report.summary.isRefund ? '溢付稅額' : '應納稅額'}</div>
              <div className="stat-card-value">{fmt(Math.abs(report.summary.taxPayable))}</div>
            </div>
          </div>
        </>
      )}

      {/* Empty state when no report generated yet */}
      {!report && !loading && !error && (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Calculator size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
          <h3 style={{ marginBottom: 8 }}>請選擇期別後按「產生報表」</h3>
          <p>系統將自動從發票及應付帳款資料產生 401 營業稅申報表</p>
        </div>
      )}
    </div>
  )
}
