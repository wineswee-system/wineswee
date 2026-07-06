import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Filter, Download } from 'lucide-react'
import { getTrialBalance, getAccountType } from '../../lib/accounting'
import { getAccounts } from '../../lib/db'
import { exportTrialBalancePdf } from '../../lib/exportPdf'
import LoadingSpinner from '../../components/LoadingSpinner'

import { fmtNT as fmt } from '../../lib/currency'

// 級次「總帳科目」：依 accounts.parent_code 把明細科目滾算到最上層科目
function rollUpToParents(rows, accountsList) {
  const acctMap = Object.fromEntries((accountsList || []).map(a => [a.code, a]))
  const topCode = (code) => {
    let cur = code
    let guard = 0
    while (acctMap[cur]?.parent_code && guard++ < 10) cur = acctMap[cur].parent_code
    return cur
  }
  const grouped = {}
  for (const row of rows) {
    const code = topCode(row.account_code)
    if (!grouped[code]) {
      const acct = acctMap[code]
      grouped[code] = {
        account_code: code,
        account_name: acct?.name || (code === row.account_code ? row.account_name : code),
        type: acct?.type || row.type || getAccountType(code),
        net: 0,
      }
    }
    grouped[code].net = Math.round((grouped[code].net + row.debit_balance - row.credit_balance) * 100) / 100
  }
  return Object.values(grouped)
    .map(({ net, ...g }) => ({
      ...g,
      debit_balance: net >= 0 ? net : 0,
      credit_balance: net < 0 ? Math.round(Math.abs(net) * 100) / 100 : 0,
    }))
    .sort((a, b) => a.account_code.localeCompare(b.account_code))
}

export default function TrialBalance() {
  const [trialData, setTrialData] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10))
  const [level, setLevel] = useState('明細') // 級次：明細科目（預設）/ 總帳科目

  const loadData = (date) => {
    setLoading(true)
    setError(null)
    Promise.all([getTrialBalance(date), getAccounts()]).then(([data, accountsRes]) => {
      setTrialData(data || [])
      setAccounts(accountsRes.data || [])
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

  const displayData = level === '總帳' ? rollUpToParents(trialData, accounts) : trialData

  const totalDebit = Math.round(displayData.reduce((s, r) => s + (r.debit_balance || 0), 0) * 100) / 100
  const totalCredit = Math.round(displayData.reduce((s, r) => s + (r.credit_balance || 0), 0) * 100) / 100
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
    exportTrialBalancePdf(displayData, asOfDate, { totalDebit, totalCredit, isBalanced })
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📊</span> 試算表 Trial Balance</h2>
            <p>各科目借貸餘額彙總（僅含已過帳傳票）</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* 級次切換：總帳科目（依 parent_code 彙總）/ 明細科目（預設） */}
            <div style={{ display: 'flex', border: '1px solid var(--border-medium)', borderRadius: 6, overflow: 'hidden' }}>
              {['總帳', '明細'].map(lv => (
                <button
                  key={lv}
                  onClick={() => setLevel(lv)}
                  className="btn"
                  style={{
                    fontSize: 12, padding: '6px 12px', borderRadius: 0, border: 'none',
                    background: level === lv ? 'var(--accent-cyan-dim)' : 'transparent',
                    color: level === lv ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                    fontWeight: level === lv ? 700 : 400,
                  }}
                >
                  {lv}科目
                </button>
              ))}
            </div>
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
          <div className="stat-card-label">科目數（{level}級）</div>
          <div className="stat-card-value">{displayData.length}</div>
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
              {displayData.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>截至此日期無已過帳資料</td></tr>
              ) : displayData.map((row, i) => (
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
