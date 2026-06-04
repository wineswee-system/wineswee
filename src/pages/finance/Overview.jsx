import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle, BarChart3 } from 'lucide-react'
import { getAccounts, getAccountsReceivable, getAccountsPayable } from '../../lib/db'
import { calculateProfitability } from '../../lib/automation'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useOrgId } from '../../contexts/AuthContext'

export default function Overview() {
  const orgId = useOrgId()
  const [accounts, setAccounts] = useState([])
  const [ar, setAr] = useState([])
  const [ap, setAp] = useState([])
  const [profit, setProfit] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7)
    Promise.all([
      getAccounts(orgId),
      getAccountsReceivable(orgId),
      getAccountsPayable(orgId),
      calculateProfitability(month),
    ]).then(([a, r, p, prof]) => {
      setAccounts(a.data || [])
      setAr(r.data || [])
      setAp(p.data || [])
      setProfit(prof)
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [orgId])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const sumByType = (type) => accounts.filter(a => a.type === type).reduce((s, a) => s + (Number(a.balance) || 0), 0)
  const totalAssets = sumByType('資產')
  const totalLiabilities = sumByType('負債')
  const equity = sumByType('業主權益')
  const monthlyRevenue = sumByType('收入')

  const arTotal = ar.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const arPaid = ar.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0)
  const apTotal = ap.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const apPaid = ap.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0)

  const today = new Date().toISOString().slice(0, 10)

  const statusBadge = (status, dueDate) => {
    if (status === '已收款' || status === '已付款') return <span className="badge badge-success"><span className="badge-dot"></span>{status}</span>
    if (status === '部分收款' || status === '部分付款') return <span className="badge badge-info"><span className="badge-dot"></span>{status}</span>
    if (dueDate && dueDate < today) return <span className="badge badge-danger"><span className="badge-dot"></span>逾期</span>
    return <span className="badge badge-warning"><span className="badge-dot"></span>{status}</span>
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💰</span> 財務總覽</h2>
            <p>公司財務狀況總覽與關鍵指標</p>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總資產</div>
          <div className="stat-card-value">NT$ {totalAssets.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">總負債</div>
          <div className="stat-card-value">NT$ {totalLiabilities.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">業主權益</div>
          <div className="stat-card-value">NT$ {equity.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">本月收入</div>
          <div className="stat-card-value">NT$ {monthlyRevenue.toLocaleString()}</div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 12 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">應收帳款總額</div>
          <div className="stat-card-value">NT$ {arTotal.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">已收金額</div>
          <div className="stat-card-value">NT$ {arPaid.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">應付帳款總額</div>
          <div className="stat-card-value">NT$ {apTotal.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">已付金額</div>
          <div className="stat-card-value">NT$ {apPaid.toLocaleString()}</div>
        </div>
      </div>

      {/* 成本核算 Profitability */}
      {profit && (
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', marginTop: 8 }}>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
            <div className="stat-card-icon"><TrendingUp size={16} /></div>
            <div className="stat-card-label">營收</div>
            <div className="stat-card-value">NT$ {profit.revenue.toLocaleString()}</div>
          </div>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
            <div className="stat-card-icon"><DollarSign size={16} /></div>
            <div className="stat-card-label">進貨成本</div>
            <div className="stat-card-value">NT$ {profit.purchaseCost.toLocaleString()}</div>
          </div>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
            <div className="stat-card-icon"><DollarSign size={16} /></div>
            <div className="stat-card-label">人工成本</div>
            <div className="stat-card-value">NT$ {profit.laborCost.toLocaleString()}</div>
          </div>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
            <div className="stat-card-icon"><TrendingDown size={16} /></div>
            <div className="stat-card-label">總成本</div>
            <div className="stat-card-value">NT$ {profit.totalCost.toLocaleString()}</div>
          </div>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
            <div className="stat-card-icon"><BarChart3 size={16} /></div>
            <div className="stat-card-label">毛利</div>
            <div className="stat-card-value" style={{ color: profit.grossProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              NT$ {profit.grossProfit.toLocaleString()}
            </div>
          </div>
          <div className="stat-card" style={{ '--card-accent': profit.grossMargin >= 30 ? 'var(--accent-green)' : 'var(--accent-orange)', '--card-accent-dim': profit.grossMargin >= 30 ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)' }}>
            <div className="stat-card-icon"><TrendingUp size={16} /></div>
            <div className="stat-card-label">毛利率</div>
            <div className="stat-card-value">{profit.grossMargin}%</div>
          </div>
        </div>
      )}

      {/* 應收帳款 Aging */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📊</span> 應收帳款 Aging</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>發票號碼</th>
                <th>客戶</th>
                <th>應收金額</th>
                <th>已收金額</th>
                <th>到期日</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {ar.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無應收帳款資料</td></tr>}
              {ar.map(r => (
                <tr key={r.id} style={r.due_date < today && r.status !== '已收款' ? { color: 'var(--accent-red)' } : {}}>
                  <td style={{ fontWeight: 600 }}>{r.invoice_number}</td>
                  <td>{r.customer}</td>
                  <td>NT$ {(Number(r.amount) || 0).toLocaleString()}</td>
                  <td>NT$ {(Number(r.paid_amount) || 0).toLocaleString()}</td>
                  <td>{r.due_date}</td>
                  <td>{statusBadge(r.status, r.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 應付帳款 Aging */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 應付帳款 Aging</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>帳單號碼</th>
                <th>供應商</th>
                <th>應付金額</th>
                <th>已付金額</th>
                <th>到期日</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {ap.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無應付帳款資料</td></tr>}
              {ap.map(r => (
                <tr key={r.id} style={r.due_date < today && r.status !== '已付款' ? { color: 'var(--accent-red)' } : {}}>
                  <td style={{ fontWeight: 600 }}>{r.bill_number}</td>
                  <td>{r.supplier}</td>
                  <td>NT$ {(Number(r.amount) || 0).toLocaleString()}</td>
                  <td>NT$ {(Number(r.paid_amount) || 0).toLocaleString()}</td>
                  <td>{r.due_date}</td>
                  <td>{statusBadge(r.status, r.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
