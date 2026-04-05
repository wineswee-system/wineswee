import { useState, useEffect } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { Monitor, DollarSign, TrendingUp, ShoppingCart, CreditCard, Clock, Store, BarChart3 } from 'lucide-react'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

const colors = { cyan: '#22d3ee', blue: '#3b82f6', purple: '#a78bfa', green: '#34d399', orange: '#fb923c', red: '#f87171', pink: '#f472b6', yellow: '#fbbf24' }
const storeColors = [colors.cyan, colors.blue, colors.purple, colors.green, colors.orange, colors.pink, colors.yellow, colors.red]

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94a3b8', font: { size: 11, weight: 600 }, padding: 12, usePointStyle: true, pointStyleWidth: 8 } },
    tooltip: { backgroundColor: 'rgba(15,23,55,0.95)', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: 'rgba(148,163,184,0.15)', borderWidth: 1, padding: 12, cornerRadius: 10 },
  },
}
const gridStyle = { color: 'rgba(148,163,184,0.06)' }
const tickStyle = { color: '#64748b', font: { size: 11 } }

// Generate demo data when no real data exists
function generateDemoData(locations) {
  const storeNames = locations.length > 0 ? locations.map(l => l.name) : ['台北總部', '台中分店', '高雄分店']
  const storeIds = locations.length > 0 ? locations.map(l => l.id) : [1, 2, 3]
  const today = new Date().toISOString().slice(0, 10)
  const paymentMethods = ['現金', '信用卡', 'LINE Pay', '綠界支付', '銀行轉帳']
  const transactions = []

  storeIds.forEach((storeId, si) => {
    // Each store has a different volume pattern
    const baseVolume = [45, 30, 25][si % 3]
    for (let h = 8; h <= 21; h++) {
      // Peak hours: 11-13 lunch, 17-19 dinner
      let hourMultiplier = 1
      if (h >= 11 && h <= 13) hourMultiplier = 2.5
      else if (h >= 17 && h <= 19) hourMultiplier = 2.0
      else if (h >= 9 && h <= 10) hourMultiplier = 1.3
      else if (h >= 14 && h <= 16) hourMultiplier = 0.8

      const txCount = Math.round(baseVolume * hourMultiplier / 14 * (0.8 + Math.random() * 0.4))
      for (let t = 0; t < txCount; t++) {
        const total = Math.round((80 + Math.random() * 350) * 100) / 100
        transactions.push({
          id: `demo-${storeId}-${h}-${t}`,
          store_id: storeId,
          store_name: storeNames[si],
          location_id: storeId,
          total,
          status: Math.random() > 0.03 ? 'completed' : 'refunded',
          payment_method: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
          created_at: `${today}T${String(h).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}:00`,
          items_count: Math.floor(1 + Math.random() * 5),
        })
      }
    }
  })

  return { transactions, storeNames, storeIds }
}

export default function POSOverview() {
  const [transactions, setTransactions] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [storeFilter, setStoreFilter] = useState('')
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('pos_transactions').select('*'),
      supabase.from('locations').select('*'),
    ]).then(([txRes, locRes]) => {
      const locs = locRes.data || []
      setLocations(locs)
      if (txRes.data && txRes.data.length > 0) {
        // Enrich transactions with store name from locations
        const locMap = Object.fromEntries(locs.map(l => [l.id, l.name]))
        const enriched = txRes.data.map(t => ({ ...t, store_name: locMap[t.location_id] || locMap[t.store_id] || '未知分店' }))
        setTransactions(enriched)
      } else {
        // Use demo data
        const demo = generateDemoData(locs)
        setTransactions(demo.transactions)
        setIsDemo(true)
      }
    }).catch(err => {
      console.error('Failed to load POS data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  // --- Derive store list from data ---
  const storeNames = [...new Set(transactions.map(t => t.store_name).filter(Boolean))]
  const filtered = storeFilter ? transactions.filter(t => t.store_name === storeFilter) : transactions
  const completed = filtered.filter(t => t.status === 'completed')
  const refunded = filtered.filter(t => t.status === 'refunded')

  // --- Aggregate KPIs ---
  const totalRevenue = completed.reduce((s, t) => s + (t.total || 0), 0)
  const txCount = completed.length
  const avgTicket = txCount > 0 ? totalRevenue / txCount : 0
  const refundTotal = refunded.reduce((s, t) => s + (t.total || 0), 0)

  // --- Sales by hour (all stores stacked or single store) ---
  const hours = Array.from({ length: 14 }, (_, i) => i + 8) // 08:00 - 21:00
  const hourLabels = hours.map(h => `${String(h).padStart(2, '0')}:00`)

  const hourlyByStore = {}
  storeNames.forEach(name => {
    hourlyByStore[name] = new Array(hours.length).fill(0)
  })
  completed.forEach(t => {
    const h = parseInt((t.created_at || '').slice(11, 13), 10)
    const idx = h - 8
    if (idx >= 0 && idx < hours.length && hourlyByStore[t.store_name]) {
      hourlyByStore[t.store_name][idx] += (t.total || 0)
    }
  })

  const hourlyChartData = {
    labels: hourLabels,
    datasets: (storeFilter ? [storeFilter] : storeNames).map((name, i) => ({
      label: name,
      data: (hourlyByStore[name] || []).map(v => Math.round(v)),
      backgroundColor: storeColors[i % storeColors.length] + 'CC',
      borderColor: storeColors[i % storeColors.length],
      borderWidth: 1,
      borderRadius: 4,
    })),
  }

  const hourlyChartOptions = {
    ...chartOpts,
    plugins: {
      ...chartOpts.plugins,
      title: { display: false },
    },
    scales: {
      x: { stacked: !storeFilter, grid: gridStyle, ticks: tickStyle },
      y: { stacked: !storeFilter, grid: gridStyle, ticks: { ...tickStyle, callback: v => `$${(v / 1000).toFixed(0)}k` }, beginAtZero: true },
    },
  }

  // --- Payment method breakdown ---
  const paymentBreakdown = {}
  completed.forEach(t => {
    const method = t.payment_method || '其他'
    paymentBreakdown[method] = (paymentBreakdown[method] || 0) + (t.total || 0)
  })
  const payMethods = Object.keys(paymentBreakdown)
  const payValues = Object.values(paymentBreakdown)

  const paymentChartData = {
    labels: payMethods,
    datasets: [{
      data: payValues.map(v => Math.round(v)),
      backgroundColor: [colors.cyan, colors.blue, colors.green, colors.purple, colors.orange, colors.pink, colors.yellow].slice(0, payMethods.length),
      borderWidth: 0,
    }],
  }

  // --- Per-store summary table ---
  const storeSummary = storeNames.map((name, i) => {
    const storeTx = transactions.filter(t => t.store_name === name && t.status === 'completed')
    const revenue = storeTx.reduce((s, t) => s + (t.total || 0), 0)
    const count = storeTx.length
    const avg = count > 0 ? revenue / count : 0
    const refunds = transactions.filter(t => t.store_name === name && t.status === 'refunded').length
    // Peak hour
    const hourCounts = {}
    storeTx.forEach(t => {
      const h = (t.created_at || '').slice(11, 13)
      hourCounts[h] = (hourCounts[h] || 0) + 1
    })
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]
    return { name, revenue, count, avg, refunds, peakHour: peakHour ? `${peakHour[0]}:00` : '-', color: storeColors[i % storeColors.length] }
  }).sort((a, b) => b.revenue - a.revenue)

  const maxRevenue = storeSummary.length > 0 ? storeSummary[0].revenue : 1

  const filterBtnStyle = (active) => ({
    padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  return (
    <div className="fade-in">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2><span className="header-icon">🖥️</span> POS 多店營運儀表板</h2>
          <p>即時彙整各分店銷售數據，掌握全通路營運狀況</p>
        </div>
        {isDemo && (
          <span style={{ padding: '4px 12px', borderRadius: 8, background: 'var(--accent-orange)', color: '#fff', fontSize: 11, fontWeight: 600 }}>展示資料</span>
        )}
      </div>

      {/* Store Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={filterBtnStyle(storeFilter === '')} onClick={() => setStoreFilter('')}>全部分店</button>
        {storeNames.map(name => (
          <button key={name} style={filterBtnStyle(storeFilter === name)} onClick={() => setStoreFilter(name)}>{name}</button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label"><DollarSign size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />總營業額</div>
          <div className="stat-card-value">$ {Math.round(totalRevenue).toLocaleString()}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{storeFilter || '全部分店'}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label"><ShoppingCart size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />交易筆數</div>
          <div className="stat-card-value">{txCount.toLocaleString()}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>退款 {refunded.length} 筆</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label"><TrendingUp size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />平均客單價</div>
          <div className="stat-card-value">$ {Math.round(avgTicket).toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label"><CreditCard size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />退款金額</div>
          <div className="stat-card-value">$ {Math.round(refundTotal).toLocaleString()}</div>
        </div>
      </div>

      {/* Charts Row: Hourly Sales + Payment Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Hourly Sales Bar Chart */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Clock size={16} /></span> 各時段營業額 {storeFilter ? `— ${storeFilter}` : '（依分店堆疊）'}</div>
          </div>
          <div style={{ padding: '8px 16px 16px', height: 320 }}>
            <Bar data={hourlyChartData} options={hourlyChartOptions} />
          </div>
        </div>

        {/* Payment Method Doughnut */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><CreditCard size={16} /></span> 付款方式分佈</div>
          </div>
          <div style={{ padding: '8px 16px 16px', height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Doughnut data={paymentChartData} options={{
              ...chartOpts,
              cutout: '60%',
              plugins: {
                ...chartOpts.plugins,
                legend: { ...chartOpts.plugins.legend, position: 'bottom' },
              },
            }} />
          </div>
        </div>
      </div>

      {/* Per-Store Summary Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Store size={16} /></span> 各分店業績總覽</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>分店</th>
                <th style={{ textAlign: 'right' }}>營業額</th>
                <th>佔比</th>
                <th style={{ textAlign: 'right' }}>交易筆數</th>
                <th style={{ textAlign: 'right' }}>平均客單價</th>
                <th style={{ textAlign: 'right' }}>退款筆數</th>
                <th>尖峰時段</th>
              </tr>
            </thead>
            <tbody>
              {storeSummary.map(s => (
                <tr key={s.name}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>{s.name}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>$ {Math.round(s.revenue).toLocaleString()}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                        <div style={{ width: `${(s.revenue / maxRevenue * 100).toFixed(1)}%`, height: '100%', borderRadius: 3, background: s.color, transition: 'width 0.5s ease' }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 36, textAlign: 'right' }}>
                        {totalRevenue > 0 ? ((s.revenue / totalRevenue) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>{s.count.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>$ {Math.round(s.avg).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{s.refunds}</td>
                  <td><span className="badge badge-info">{s.peakHour}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
