import { useState, useEffect } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import { getQuotations, getSalesOrders } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import { DollarSign, TrendingUp, FileText, ShoppingCart, Truck, RotateCcw, Clock, BarChart3, Package } from 'lucide-react'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

const colors = { cyan: '#22d3ee', blue: '#3b82f6', purple: '#a78bfa', green: '#34d399', orange: '#fb923c', red: '#f87171', pink: '#f472b6', yellow: '#fbbf24' }

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
function generateDemoData() {
  const customers = ['台積電', '鴻海精密', '聯發科技', '中華電信', '統一超商', '遠傳電信', '富邦金控', '國泰人壽', '長榮航空', '台塑石化']
  const statuses = ['草稿', '已確認', '已完成', '已取消']
  const paymentStatuses = ['已付款', '未付款', '部分付款']
  const shippingStatuses = ['已出貨', '待出貨']
  const products = ['工業感測器 A1', 'LED 控制模組', '不鏽鋼管件組', '包裝材料套組', '客製化PCB板', '潤滑油桶裝', '防塵濾網', '電源供應器']

  const now = new Date()
  const quotations = []
  const orders = []

  // 6 months of data
  for (let m = 5; m >= 0; m--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const qCount = 8 + Math.floor(Math.random() * 12)
    const oCount = 5 + Math.floor(Math.random() * 10)

    for (let i = 0; i < qCount; i++) {
      const day = 1 + Math.floor(Math.random() * 28)
      const amount = Math.round((5000 + Math.random() * 95000) * 100) / 100
      quotations.push({
        id: `q-${m}-${i}`,
        quote_number: `QT-${String(monthDate.getFullYear()).slice(2)}${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(i + 1).padStart(3, '0')}`,
        customer: customers[Math.floor(Math.random() * customers.length)],
        status: statuses[Math.floor(Math.random() * statuses.length)],
        grand_total: amount,
        created_at: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T10:00:00`,
        items: Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
          product: products[Math.floor(Math.random() * products.length)],
          qty: 1 + Math.floor(Math.random() * 20),
          unit_price: 500 + Math.floor(Math.random() * 5000),
        })),
      })
    }

    for (let i = 0; i < oCount; i++) {
      const day = 1 + Math.floor(Math.random() * 28)
      const amount = Math.round((8000 + Math.random() * 120000) * 100) / 100
      orders.push({
        id: `o-${m}-${i}`,
        order_number: `SO-${String(monthDate.getFullYear()).slice(2)}${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(i + 1).padStart(3, '0')}`,
        customer: customers[Math.floor(Math.random() * customers.length)],
        payment_status: paymentStatuses[Math.floor(Math.random() * paymentStatuses.length)],
        shipping_status: shippingStatuses[Math.floor(Math.random() * shippingStatuses.length)],
        grand_total: amount,
        created_at: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T10:00:00`,
        items: Array.from({ length: 1 + Math.floor(Math.random() * 4) }, () => ({
          product: products[Math.floor(Math.random() * products.length)],
          qty: 1 + Math.floor(Math.random() * 30),
          unit_price: 500 + Math.floor(Math.random() * 5000),
        })),
      })
    }
  }

  return { quotations, orders }
}

export default function SalesOverview() {
  const [quotations, setQuotations] = useState([])
  const [orders, setOrders] = useState([])
  const [shipments, setShipments] = useState([])
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    Promise.all([
      getQuotations(),
      getSalesOrders(),
      supabase.from('shipments').select('*'),
      supabase.from('sales_returns').select('*'),
    ]).then(([qRes, soRes, shipRes, retRes]) => {
      const q = qRes.data || []
      const o = soRes.data || []
      if (q.length === 0 && o.length === 0) {
        const demo = generateDemoData()
        setQuotations(demo.quotations)
        setOrders(demo.orders)
        setIsDemo(true)
      } else {
        setQuotations(q)
        setOrders(o)
      }
      setShipments(shipRes.data || [])
      setReturns(retRes.data || [])
    }).catch(err => {
      console.error('Failed to load sales data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  // --- KPIs ---
  const totalOrderRevenue = orders.reduce((s, o) => s + (o.grand_total || 0), 0)
  const totalQuoteValue = quotations.reduce((s, q) => s + (q.grand_total || 0), 0)
  const pendingQuotes = quotations.filter(q => q.status === '草稿' || q.status === '已確認').length
  const pendingShipments = orders.filter(o => o.shipping_status === '待出貨').length
  const unpaidOrders = orders.filter(o => o.payment_status === '未付款' || o.payment_status === '部分付款')
  const unpaidAmount = unpaidOrders.reduce((s, o) => s + (o.grand_total || 0), 0)
  const returnCount = returns.length

  // --- Quote to Order conversion rate ---
  const confirmedQuotes = quotations.filter(q => q.status === '已完成' || q.status === '已確認').length
  const conversionRate = quotations.length > 0 ? Math.round((confirmedQuotes / quotations.length) * 100) : 0

  // --- Monthly revenue trend (last 6 months) ---
  const now = new Date()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${d.getMonth() + 1}月` }
  })

  const monthlyOrders = months.map(m => {
    const monthOrders = orders.filter(o => (o.created_at || '').slice(0, 7) === m.key)
    return monthOrders.reduce((s, o) => s + (o.grand_total || 0), 0)
  })
  const monthlyQuotes = months.map(m => {
    const monthQuotes = quotations.filter(q => (q.created_at || '').slice(0, 7) === m.key)
    return monthQuotes.reduce((s, q) => s + (q.grand_total || 0), 0)
  })

  const trendChartData = {
    labels: months.map(m => m.label),
    datasets: [
      {
        label: '訂單金額',
        data: monthlyOrders.map(v => Math.round(v)),
        borderColor: colors.cyan,
        backgroundColor: colors.cyan + '20',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: colors.cyan,
      },
      {
        label: '報價金額',
        data: monthlyQuotes.map(v => Math.round(v)),
        borderColor: colors.purple,
        backgroundColor: colors.purple + '15',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: colors.purple,
        borderDash: [5, 5],
      },
    ],
  }

  const trendChartOptions = {
    ...chartOpts,
    scales: {
      x: { grid: gridStyle, ticks: tickStyle },
      y: { grid: gridStyle, ticks: { ...tickStyle, callback: v => `$${(v / 1000).toFixed(0)}k` }, beginAtZero: true },
    },
  }

  // --- Order status breakdown ---
  const paymentCounts = {}
  orders.forEach(o => { paymentCounts[o.payment_status || '未分類'] = (paymentCounts[o.payment_status || '未分類'] || 0) + 1 })
  const paymentStatusColors = { '已付款': colors.green, '未付款': colors.red, '部分付款': colors.orange }

  const orderStatusChartData = {
    labels: Object.keys(paymentCounts),
    datasets: [{
      data: Object.values(paymentCounts),
      backgroundColor: Object.keys(paymentCounts).map(k => paymentStatusColors[k] || colors.blue),
      borderWidth: 0,
    }],
  }

  // --- Top customers by order revenue ---
  const customerRevenue = {}
  orders.forEach(o => {
    const name = o.customer || '未知客戶'
    customerRevenue[name] = (customerRevenue[name] || 0) + (o.grand_total || 0)
  })
  const topCustomers = Object.entries(customerRevenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const topCustomerChartData = {
    labels: topCustomers.map(([name]) => name.length > 8 ? name.slice(0, 8) + '…' : name),
    datasets: [{
      label: '訂單金額',
      data: topCustomers.map(([, v]) => Math.round(v)),
      backgroundColor: topCustomers.map((_, i) => [colors.cyan, colors.blue, colors.purple, colors.green, colors.orange, colors.pink, colors.yellow, colors.red][i % 8] + 'CC'),
      borderColor: topCustomers.map((_, i) => [colors.cyan, colors.blue, colors.purple, colors.green, colors.orange, colors.pink, colors.yellow, colors.red][i % 8]),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }

  const topCustomerChartOptions = {
    ...chartOpts,
    indexAxis: 'y',
    plugins: { ...chartOpts.plugins, legend: { display: false } },
    scales: {
      x: { grid: gridStyle, ticks: { ...tickStyle, callback: v => `$${(v / 1000).toFixed(0)}k` }, beginAtZero: true },
      y: { grid: { display: false }, ticks: tickStyle },
    },
  }

  // --- Monthly order count bar chart ---
  const monthlyOrderCounts = months.map(m => orders.filter(o => (o.created_at || '').slice(0, 7) === m.key).length)
  const monthlyQuoteCounts = months.map(m => quotations.filter(q => (q.created_at || '').slice(0, 7) === m.key).length)

  const countChartData = {
    labels: months.map(m => m.label),
    datasets: [
      { label: '訂單數', data: monthlyOrderCounts, backgroundColor: colors.cyan + 'CC', borderColor: colors.cyan, borderWidth: 1, borderRadius: 4 },
      { label: '報價數', data: monthlyQuoteCounts, backgroundColor: colors.purple + '80', borderColor: colors.purple, borderWidth: 1, borderRadius: 4 },
    ],
  }

  const countChartOptions = {
    ...chartOpts,
    scales: {
      x: { grid: gridStyle, ticks: tickStyle },
      y: { grid: gridStyle, ticks: tickStyle, beginAtZero: true },
    },
  }

  // --- Recent orders table ---
  const recentOrders = [...orders].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 8)

  const payBadge = { '已付款': 'badge-success', '未付款': 'badge-danger', '部分付款': 'badge-warning' }
  const shipBadge = { '已出貨': 'badge-success', '待出貨': 'badge-warning', '已取消': 'badge-danger' }

  return (
    <div className="fade-in">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2><span className="header-icon">📊</span> 銷售管理儀表板</h2>
          <p>報價、訂單、出貨與收款狀態一目瞭然</p>
        </div>
        {isDemo && (
          <span style={{ padding: '4px 12px', borderRadius: 8, background: 'var(--accent-orange)', color: '#fff', fontSize: 11, fontWeight: 600 }}>展示資料</span>
        )}
      </div>

      {/* KPI Cards - Row 1 */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label"><DollarSign size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />訂單總金額</div>
          <div className="stat-card-value">$ {Math.round(totalOrderRevenue).toLocaleString()}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{orders.length} 筆訂單</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label"><FileText size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />報價總金額</div>
          <div className="stat-card-value">$ {Math.round(totalQuoteValue).toLocaleString()}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>待處理 {pendingQuotes} 筆</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label"><TrendingUp size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />報價轉換率</div>
          <div className="stat-card-value">{conversionRate}%</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{confirmedQuotes} / {quotations.length} 筆成交</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label"><Clock size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />未收款金額</div>
          <div className="stat-card-value">$ {Math.round(unpaidAmount).toLocaleString()}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>待出貨 {pendingShipments} 筆 / 退貨 {returnCount} 筆</div>
        </div>
      </div>

      {/* Charts Row 1: Revenue Trend + Order Status */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><TrendingUp size={16} /></span> 月營收趨勢</div>
          </div>
          <div style={{ padding: '8px 16px 16px', height: 300 }}>
            <Line data={trendChartData} options={trendChartOptions} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><DollarSign size={16} /></span> 訂單付款狀態</div>
          </div>
          <div style={{ padding: '8px 16px 16px', height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Doughnut data={orderStatusChartData} options={{
              ...chartOpts,
              cutout: '60%',
              plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } },
            }} />
          </div>
        </div>
      </div>

      {/* Charts Row 2: Top Customers + Monthly Count */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><BarChart3 size={16} /></span> 客戶訂單排行</div>
          </div>
          <div style={{ padding: '8px 16px 16px', height: 300 }}>
            <Bar data={topCustomerChartData} options={topCustomerChartOptions} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Package size={16} /></span> 月訂單 / 報價數量</div>
          </div>
          <div style={{ padding: '8px 16px 16px', height: 300 }}>
            <Bar data={countChartData} options={countChartOptions} />
          </div>
        </div>
      </div>

      {/* Recent Orders Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><ShoppingCart size={16} /></span> 最近訂單</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>訂單編號</th>
                <th>客戶</th>
                <th style={{ textAlign: 'right' }}>金額</th>
                <th>付款狀態</th>
                <th>出貨狀態</th>
                <th>建立日期</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(o => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.order_number}</td>
                  <td>{o.customer}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>$ {Math.round(o.grand_total || 0).toLocaleString()}</td>
                  <td><span className={`badge ${payBadge[o.payment_status] || 'badge-info'}`}>{o.payment_status}</span></td>
                  <td><span className={`badge ${shipBadge[o.shipping_status] || 'badge-info'}`}>{o.shipping_status}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{(o.created_at || '').slice(0, 10)}</td>
                </tr>
              ))}
              {recentOrders.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>尚無訂單資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
