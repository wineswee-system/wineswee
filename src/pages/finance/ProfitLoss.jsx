import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Filter, Calendar } from 'lucide-react'
import { getIncomeStatement } from '../../lib/accounting'
import LoadingSpinner from '../../components/LoadingSpinner'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

function getMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  return { start, end }
}

export default function ProfitLoss() {
  const [plData, setPlData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const defaultRange = getMonthRange()
  const [startDate, setStartDate] = useState(defaultRange.start)
  const [endDate, setEndDate] = useState(defaultRange.end)

  const loadData = (start, end) => {
    setLoading(true)
    setError(null)
    getIncomeStatement(start, end).then(data => {
      setPlData(data)
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }

  useEffect(() => {
    loadData(startDate, endDate)
  }, [])

  const handleFilter = () => {
    loadData(startDate, endDate)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const {
    revenue = [],
    costOfGoodsSold = [],
    grossProfit = 0,
    operatingExpenses = [],
    operatingIncome = 0,
    otherIncome = [],
    otherExpenses = [],
    netIncome = 0,
  } = plData || {}

  const totalRevenue = revenue.reduce((s, r) => s + (r.amount || 0), 0)
  const totalCOGS = costOfGoodsSold.reduce((s, r) => s + (r.amount || 0), 0)
  const totalOpex = operatingExpenses.reduce((s, r) => s + (r.amount || 0), 0)
  const totalOtherIncome = otherIncome.reduce((s, r) => s + (r.amount || 0), 0)
  const totalOtherExpenses = otherExpenses.reduce((s, r) => s + (r.amount || 0), 0)

  const pctOf = (n) => totalRevenue > 0 ? ((n / totalRevenue) * 100).toFixed(1) : '0.0'
  const grossMargin = pctOf(grossProfit)
  const operatingMargin = pctOf(operatingIncome)
  const netMargin = pctOf(netIncome)

  const valColor = (n) => n >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'

  const LineItem = ({ label, amount, bold, indent, showPct }) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: `8px ${indent ? '12px 8px 32px' : '12px'}`,
      fontWeight: bold ? 700 : 400,
      borderBottom: bold ? '2px solid var(--border-medium)' : '1px solid var(--border-subtle)',
      background: bold ? 'var(--glass-light)' : 'transparent',
    }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'monospace', color: bold ? valColor(amount) : 'inherit', display: 'flex', gap: 12, alignItems: 'center' }}>
        {fmt(amount)}
        {showPct && <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 60, textAlign: 'right' }}>
          ({pctOf(amount)}%)
        </span>}
      </span>
    </div>
  )

  const ItemList = ({ items }) => (
    <>
      {items.map((row, i) => (
        <LineItem key={i} label={`  ${row.item}`} amount={row.amount} indent showPct />
      ))}
    </>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📈</span> 損益表 Income Statement</h2>
            <p>收入與費用分析（僅含已過帳傳票）</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Calendar size={14} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>期間</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="form-input"
              style={{ padding: '6px 12px', fontSize: 13 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>~</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="form-input"
              style={{ padding: '6px 12px', fontSize: 13 }}
            />
            <button className="btn btn-primary" onClick={handleFilter} style={{ fontSize: 12, padding: '6px 12px' }}>
              <Filter size={14} /> 查詢
            </button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">營業收入</div>
          <div className="stat-card-value">{fmt(totalRevenue)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">毛利率</div>
          <div className="stat-card-value">{grossMargin}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">營業利益率</div>
          <div className="stat-card-value">{operatingMargin}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': netIncome >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', '--card-accent-dim': netIncome >= 0 ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">營業淨利</div>
          <div className="stat-card-value" style={{ color: valColor(netIncome), display: 'flex', alignItems: 'center', gap: 6 }}>
            {netIncome >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            {fmt(netIncome)}
          </div>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 損益表明細</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{startDate} ~ {endDate}</span>
        </div>

        <div>
          {/* Revenue */}
          <LineItem label="一、營業收入 Revenue" amount={totalRevenue} bold />
          <ItemList items={revenue} />

          {/* COGS */}
          <LineItem label="二、營業成本 Cost of Goods Sold" amount={totalCOGS} bold />
          <ItemList items={costOfGoodsSold} />

          {/* Gross Profit */}
          <LineItem label="三、營業毛利 Gross Profit" amount={grossProfit} bold showPct />

          {/* Operating Expenses */}
          <LineItem label="四、營業費用 Operating Expenses" amount={totalOpex} bold />
          <ItemList items={operatingExpenses} />

          {/* Operating Income */}
          <LineItem label="五、營業利益 Operating Income" amount={operatingIncome} bold showPct />

          {/* Other Income */}
          {otherIncome.length > 0 && (
            <>
              <LineItem label="六、營業外收入 Other Income" amount={totalOtherIncome} bold />
              <ItemList items={otherIncome} />
            </>
          )}

          {/* Other Expenses */}
          {otherExpenses.length > 0 && (
            <>
              <LineItem label="七、營業外支出 Other Expenses" amount={totalOtherExpenses} bold />
              <ItemList items={otherExpenses} />
            </>
          )}

          {/* Net Income */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '16px 12px', fontWeight: 700, fontSize: 18,
            borderTop: '3px double var(--border-medium)', background: 'var(--glass-light)',
          }}>
            <span>本期淨利（淨損）Net Income</span>
            <span style={{ fontFamily: 'monospace', color: valColor(netIncome), display: 'flex', alignItems: 'center', gap: 12 }}>
              {netIncome >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
              {fmt(netIncome)}
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>({netMargin}%)</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
