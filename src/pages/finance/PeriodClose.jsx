import { useState, useEffect } from 'react'
import { Lock, Unlock, X, AlertTriangle } from 'lucide-react'
import { getAccountingPeriods, createAccountingPeriod, updateAccountingPeriod, createJournalEntry, batchCreateJournalLines, getAccounts } from '../../lib/db'
import { getIncomeStatement } from '../../lib/accounting'
import LoadingSpinner from '../../components/LoadingSpinner'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

export default function PeriodClose() {
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [closing, setClosing] = useState(null)

  const load = async () => {
    setLoading(true)
    const { data, error } = await getAccountingPeriods()
    if (error) setError(error.message)
    else setPeriods(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleClose = async (period) => {
    if (!confirm(`確定要關閉 ${period.period} 期間？關帳後該期間的傳票將無法修改���`)) return
    setClosing(period.id)
    await updateAccountingPeriod(period.id, {
      status: '已關帳',
      closed_by: '系統',
      closed_at: new Date().toISOString(),
    })
    setClosing(null)
    load()
  }

  const handleReopen = async (period) => {
    if (!confirm(`確定要重新開放 ${period.period}？`)) return
    await updateAccountingPeriod(period.id, { status: '開放', closed_by: null, closed_at: null })
    load()
  }

  const handleYearEnd = async () => {
    const year = new Date().getFullYear()
    if (!confirm(`將產生 ${year} 年度結轉分錄（本期損益 → 保留盈餘），是否繼續？`)) return

    setClosing('yearend')
    try {
      const startDate = `${year}-01-01`
      const endDate = `${year}-12-31`
      const pl = await getIncomeStatement(startDate, endDate)
      const netIncome = pl?.netIncome || 0

      if (netIncome === 0) {
        alert('本年度淨利為 0，無需結轉')
        setClosing(null)
        return
      }

      // Create closing entry: Dr Revenue accounts, Cr Expense accounts, net to Retained Earnings (3300)
      const lines = []
      // Close revenue to income summary
      if (pl.revenue?.items) {
        for (const item of pl.revenue.items) {
          if (item.amount) lines.push({ account_code: item.account_code, account_name: item.account_name, debit: item.amount, credit: 0, memo: '年度結轉' })
        }
      }
      // Close expenses
      if (pl.operatingExpenses?.items) {
        for (const item of pl.operatingExpenses.items) {
          if (item.amount) lines.push({ account_code: item.account_code, account_name: item.account_name, debit: 0, credit: item.amount, memo: '年度結轉' })
        }
      }
      // Net to retained earnings
      lines.push({
        account_code: '3300', account_name: '保留盈餘',
        debit: netIncome < 0 ? Math.abs(netIncome) : 0,
        credit: netIncome > 0 ? netIncome : 0,
        memo: `${year} 年度淨利結轉`,
      })

      const { data: entry, error: entryErr } = await createJournalEntry({
        entry_number: `JE-CLOSE-${year}`,
        entry_date: `${year}-12-31`,
        description: `${year} 年度結帳分錄`,
        source: '年度結帳',
        status: '草稿',
        created_by: '系統',
      })

      if (entryErr) { setError(entryErr.message); setClosing(null); return }

      const linesWithEntry = lines.map(l => ({ ...l, entry_id: entry.id }))
      const { error: linesErr } = await batchCreateJournalLines(linesWithEntry)
      if (linesErr) setError(linesErr.message)
      else alert(`已建立年度結帳分錄 JE-CLOSE-${year}，淨利 ${fmt(netIncome)} 結轉至保留盈餘（草稿狀態）`)
    } catch (err) {
      setError(err.message)
    }
    setClosing(null)
  }

  const addNextPeriod = async () => {
    const last = periods[periods.length - 1]
    if (!last) return
    const [y, m] = last.period.split('-').map(Number)
    const nextM = m === 12 ? 1 : m + 1
    const nextY = m === 12 ? y + 1 : y
    const period = `${nextY}-${String(nextM).padStart(2, '0')}`
    const start = `${nextY}-${String(nextM).padStart(2, '0')}-01`
    const lastDay = new Date(nextY, nextM, 0).getDate()
    const end = `${nextY}-${String(nextM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const { error } = await createAccountingPeriod({ period, start_date: start, end_date: end, status: '開放' })
    if (error) setError(error.message)
    else load()
  }

  if (loading) return <LoadingSpinner />

  const openCount = periods.filter(p => p.status === '開放').length
  const closedCount = periods.filter(p => p.status === '��關帳').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔒</span> 期間關帳</h2>
            <p>Period Close — 會計期間管理與年度結帳</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={addNextPeriod}>新增下期</button>
            <button className="btn btn-primary" onClick={handleYearEnd} disabled={closing === 'yearend'}>
              {closing === 'yearend' ? '處理中...' : '年度結帳'}
            </button>
          </div>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">開放期間</div>
          <div className="stat-card-value">{openCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">已關帳</div>
          <div className="stat-card-value">{closedCount}</div>
        </div>
      </div>

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>期間</th>
              <th>起始日</th>
              <th>結束日</th>
              <th>狀態</th>
              <th>關帳人</th>
              <th>關帳時間</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {periods.map(p => (
              <tr key={p.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.period}</td>
                <td>{p.start_date}</td>
                <td>{p.end_date}</td>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {p.status === '已關帳' ? <Lock size={13} style={{ color: 'var(--accent-orange)' }} /> : <Unlock size={13} style={{ color: 'var(--accent-green)' }} />}
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: p.status === '已關帳' ? 'var(--accent-orange-dim)' : 'var(--accent-green-dim)', color: p.status === '已關��' ? 'var(--accent-orange)' : 'var(--accent-green)' }}>{p.status}</span>
                  </span>
                </td>
                <td>{p.closed_by || '-'}</td>
                <td style={{ fontSize: 12 }}>{p.closed_at ? new Date(p.closed_at).toLocaleString('zh-TW') : '-'}</td>
                <td>
                  {p.status === '開放' ? (
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleClose(p)} disabled={closing === p.id}>
                      <Lock size={12} /> {closing === p.id ? '關帳中...' : '關帳'}
                    </button>
                  ) : (
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleReopen(p)}>
                      <Unlock size={12} /> 重新開放
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
