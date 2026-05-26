import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Filter, Download } from 'lucide-react'
import { getTrialBalance } from '../../lib/accounting'
import { exportTrialBalancePdf } from '../../lib/exportPdf'
import LoadingSpinner from '../../components/LoadingSpinner'

import { fmtNT as fmt } from '../../lib/currency'

export default function TrialBalance() {
  const [trialData, setTrialData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10))

  const loadData = (date) => {
    setLoading(true)
    setError(null)
    getTrialBalance(date).then(data => {
      setTrialData(data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }

  useEffect(() => {
    loadData(asOfDate)
  }, [])

  const handleDateChange = (newDate) => {
    setAsOfDate(newDate)
    loadData(newDate)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const totalDebit = Math.round(trialData.reduce((s, r) => s + (r.debit_balance || 0), 0) * 100) / 100
  const totalCredit = Math.round(trialData.reduce((s, r) => s + (r.credit_balance || 0), 0) * 100) / 100
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01

  const typeColor = (type) => {
    switch (type) {
      case '資產': return 'var(--accent-blue)'
      case '負債': return 'var(--accent-red)'
      case '權益': return 'var(--accent-purple)'
      case '收入': return 'var(--accent-green)'
      case '營業費用': return 'var(--accent-orange)'
      case '銷貨成本': return 'var(--accent-orange)'
      case '營業外收入/支出': return 'var(--accent-cyan)'
      default: return 'var(--text-secondary)'
    }
  }

  const handleExportPdf = () => {
    exportTrialBalancePdf(trialData, asOfDate, { totalDebit, totalCredit, isBalanced })
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📊</span> 試算表 Trial Balance</h2>
            <p>各科目借貸餘額彙總（僅含已過帳傳票）</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Filter size={14} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>截止日期</span>
            <input
              type="date"
              value={asOfDate}
              onChange={e => handleDateChange(e.target.value)}
              className="form-input"
              style={{ padding: '6px 12px', fontSize: 13 }}
            />
            <button className="btn btn-primary" onClick={handleExportPdf} style={{ fontSize: 12, padding: '6px 12px' }}>
              <Download size={14} /> 匯出 PDF
            </button>
          </div>
        </div>
      </div>

      {!isBalanced && (
        <div style={{ padding: '12px 16px', marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid var(--accent-red)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} style={{ color: 'var(--accent-red)' }} />
          <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>
            警告：試算表不平衡！借方合計 {fmt(totalDebit)}，貸方合計 {fmt(totalCredit)}，差額 {fmt(Math.abs(totalDebit - totalCredit))}
          </span>
        </div>
      )}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">科目數</div>
          <div className="stat-card-value">{trialData.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">借方合計</div>
          <div className="stat-card-value">{fmt(totalDebit)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">貸方合計</div>
          <div className="stat-card-value">{fmt(totalCredit)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': isBalanced ? 'var(--accent-green)' : 'var(--accent-red)', '--card-accent-dim': isBalanced ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">平衡狀態</div>
          <div className="stat-card-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isBalanced
              ? <><CheckCircle size={18} style={{ color: 'var(--accent-green)' }} /> 平衡</>
              : <><AlertTriangle size={18} style={{ color: 'var(--accent-red)' }} /> 不平衡</>
            }
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 試算表明細</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>截至 {asOfDate}</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>科目代碼</th>
                <th>科目名稱</th>
                <th>類別</th>
                <th style={{ textAlign: 'right' }}>借方餘額</th>
                <th style={{ textAlign: 'right' }}>貸方餘額</th>
              </tr>
            </thead>
            <tbody>
              {trialData.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>截至此日期無已過帳資料</td></tr>
              ) : trialData.map((row, i) => (
                <tr key={row.account_code || i}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.account_code}</td>
                  <td>{row.account_name}</td>
                  <td><span style={{ color: typeColor(row.type), fontWeight: 600, fontSize: 12 }}>{row.type}</span></td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: row.debit_balance > 0 ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {row.debit_balance > 0 ? fmt(row.debit_balance) : '-'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: row.credit_balance > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                    {row.credit_balance > 0 ? fmt(row.credit_balance) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                <td colSpan={3} style={{ textAlign: 'right' }}>合計</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-green)' }}>{fmt(totalDebit)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-red)' }}>{fmt(totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Balance indicator footer */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 8,
          fontSize: 14,
          fontWeight: 600,
          color: isBalanced ? 'var(--accent-green)' : 'var(--accent-red)',
          background: isBalanced ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
        }}>
          {isBalanced
            ? <><CheckCircle size={16} /> 借貸平衡</>
            : <><AlertTriangle size={16} /> 借貸不平衡，差額 {fmt(Math.abs(totalDebit - totalCredit))}</>
          }
        </div>
      </div>
    </div>
  )
}
