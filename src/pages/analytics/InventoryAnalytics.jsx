import { useState, useEffect } from 'react'
import { Download, Printer } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import { exportToCSV, exportToPDF } from '../../lib/exportUtils'
import LoadingSpinner from '../../components/LoadingSpinner'
import DateRangePicker from '../../components/DateRangePicker'

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

export default function InventoryAnalytics() {
  const [stockLevels, setStockLevels] = useState([])
  const [movements, setMovements] = useState([])
  const [cogs, setCogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('stock_levels').select('*'),
      supabase.from('inventory_transactions').select('*'),
      supabase.from('accounts_payable').select('amount, created_at'),
    ]).then(([sl, sm, ap]) => {
      setStockLevels(sl.data || [])
      setMovements(sm.data || [])
      setCogs(ap.data || [])
    }).catch(err => {
      console.error('Failed to load inventory data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filterByDate = (arr) => {
    if (!dateRange) return arr
    return arr.filter(r => {
      const d = (r.created_at || r.date || '').slice(0, 10)
      return d >= dateRange.startDate && d <= dateRange.endDate
    })
  }

  const filtered = filterByDate(stockLevels)
  const filteredMov = filterByDate(movements)
  const now = new Date()

  // ── KPI calculations ──
  const totalSKU = filtered.length
  const totalValue = filtered.reduce((s, r) => s + (r.quantity || 0) * (r.unit_cost || 0), 0)
  const lowStockItems = filtered.filter(r => r.quantity <= (r.min_qty || 0)).length
  const daysSinceMove = (r) => r.last_movement_date ? Math.floor((now - new Date(r.last_movement_date)) / 86400000) : 999
  const deadItems = filtered.filter(r => daysSinceMove(r) >= 90)
  const avgInventoryValue = totalValue || 1
  const totalCOGS = filterByDate(cogs).reduce((s, r) => s + (r.amount || 0), 0)
  const turnoverRate = avgInventoryValue > 0 ? (totalCOGS / avgInventoryValue).toFixed(2) : '0.00'

  // Count items with stock discrepancy (quantity < 0 as proxy for discrepancy)
  const discrepancyItems = filtered.filter(r => (r.quantity || 0) < 0).length

  // ── Chart 1: Inventory Turnover Trend (6 months) ──
  const turnLabels = []
  const turnData = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const yr = d.getFullYear(); const mo = d.getMonth()
    turnLabels.push(`${yr}/${String(mo + 1).padStart(2, '0')}`)
    const moCOGS = cogs.filter(r => { const cd = new Date(r.created_at); return cd.getFullYear() === yr && cd.getMonth() === mo }).reduce((s, r) => s + (r.amount || 0), 0)
    turnData.push(avgInventoryValue > 0 ? +(moCOGS / avgInventoryValue).toFixed(2) : 0)
  }
  const turnoverLineData = {
    labels: turnLabels,
    datasets: [{
      label: '庫存週轉率',
      data: turnData,
      borderColor: colors.cyan,
      backgroundColor: 'rgba(34,211,238,0.1)',
      fill: true, tension: 0.4, pointRadius: 5,
      pointBackgroundColor: colors.cyan, pointBorderColor: '#0f172a', pointBorderWidth: 2,
    }],
  }

  // ── Chart 2: ABC Analysis ──
  const sorted = [...filtered].sort((a, b) => (b.quantity * b.unit_cost) - (a.quantity * a.unit_cost))
  const cumTotal = totalValue || 1
  let cumSum = 0; let classA = 0; let classB = 0; let classC = 0
  sorted.forEach(r => {
    cumSum += (r.quantity || 0) * (r.unit_cost || 0)
    const pct = cumSum / cumTotal
    if (pct <= 0.8) classA++
    else if (pct <= 0.95) classB++
    else classC++
  })
  const abcBarData = {
    labels: ['A 類 (80% 價值)', 'B 類 (15% 價值)', 'C 類 (5% 價值)'],
    datasets: [{
      label: '品項數量',
      data: [classA, classB, classC],
      backgroundColor: [colors.cyan, colors.orange, colors.purple],
      borderRadius: 8, borderSkipped: false, barThickness: 40,
    }],
  }

  // ── Chart 3: Stock Aging (Doughnut) ──
  const buckets = { '0-30 天': 0, '31-60 天': 0, '61-90 天': 0, '90+ 天': 0 }
  filtered.forEach(r => {
    const days = daysSinceMove(r)
    if (days <= 30) buckets['0-30 天']++
    else if (days <= 60) buckets['31-60 天']++
    else if (days <= 90) buckets['61-90 天']++
    else buckets['90+ 天']++
  })
  const agingDoughnutData = {
    labels: Object.keys(buckets),
    datasets: [{
      data: Object.values(buckets),
      backgroundColor: [colors.green, colors.blue, colors.orange, colors.red],
      borderWidth: 0, hoverOffset: 6,
    }],
  }

  // ── Chart 4: Warehouse Utilization (Bar) ──
  const whMap = {}
  filtered.forEach(r => {
    const wh = r.warehouse || r.location || '未分類'
    whMap[wh] = (whMap[wh] || 0) + (r.quantity || 0)
  })
  const whEntries = Object.entries(whMap).sort((a, b) => b[1] - a[1])
  const whBarData = {
    labels: whEntries.map(([k]) => k),
    datasets: [{
      label: '庫存數量',
      data: whEntries.map(([, v]) => v),
      backgroundColor: whEntries.map((_, i) => [colors.cyan, colors.blue, colors.purple, colors.green, colors.orange, colors.pink][i % 6]),
      borderRadius: 8, borderSkipped: false, barThickness: 36,
    }],
  }

  // ── Chart 5: Stock Movement Trend (Line) ──
  const movLabels = []; const inData = []; const outData = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const yr = d.getFullYear(); const mo = d.getMonth()
    movLabels.push(`${yr}/${String(mo + 1).padStart(2, '0')}`)
    const moMov = filteredMov.filter(r => { const md = new Date(r.date || r.created_at); return md.getFullYear() === yr && md.getMonth() === mo })
    inData.push(moMov.filter(r => r.type === 'inbound').reduce((s, r) => s + (r.quantity || 0), 0))
    outData.push(moMov.filter(r => r.type === 'outbound').reduce((s, r) => s + Math.abs(r.quantity || 0), 0))
  }
  const movLineData = {
    labels: movLabels,
    datasets: [
      { label: '入庫', data: inData, borderColor: colors.green, backgroundColor: 'rgba(52,211,153,0.1)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.green },
      { label: '出庫', data: outData, borderColor: colors.orange, backgroundColor: 'rgba(251,146,60,0.1)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.orange },
    ],
  }

  // ── Dead Stock Table ──
  const deadStock = deadItems
    .map(r => ({ sku: r.sku_name || r.sku_id, qty: r.quantity || 0, value: (r.quantity || 0) * (r.unit_cost || 0), days: daysSinceMove(r) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 20)

  const handleExportCSV = () => {
    const exportData = filtered.map(r => ({
      sku_name: r.sku_name || '', quantity: r.quantity || 0, unit_cost: r.unit_cost || 0,
      value: (r.quantity || 0) * (r.unit_cost || 0), warehouse: r.warehouse || '', last_movement: r.last_movement_date || '',
    }))
    exportToCSV(exportData, [
      { key: 'sku_name', label: 'SKU 名稱' }, { key: 'quantity', label: '數量' }, { key: 'unit_cost', label: '單位成本' },
      { key: 'value', label: '庫存價值' }, { key: 'warehouse', label: '倉庫' }, { key: 'last_movement', label: '最後異動日' },
    ], `庫存分析_${new Date().toISOString().slice(0, 10)}`)
  }

  return (
    <div className="fade-in" id="inventory-analytics-page">
      <div className="page-header">
        <h2><span className="header-icon">📦</span> 庫存分析</h2>
        <p>庫存結構、週轉效率與倉儲利用分析</p>
        <div className="export-btn-group" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={handleExportCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> 匯出 CSV
          </button>
          <button className="btn btn-primary" onClick={() => exportToPDF('inventory-analytics-page', '庫存分析')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Printer size={15} /> 列印報表
          </button>
        </div>
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {/* ── KPI Cards ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">SKU 總數</div>
          <div className="stat-card-value">{totalSKU}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">庫存總值</div>
          <div className="stat-card-value">NT$ {totalValue.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">低庫存品項</div>
          <div className="stat-card-value">{lowStockItems}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">庫存週轉率</div>
          <div className="stat-card-value">{turnoverRate}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">呆滯品項</div>
          <div className="stat-card-value">{deadItems.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">盤差品項</div>
          <div className="stat-card-value">{discrepancyItems}</div>
        </div>
      </div>

      {/* ── Row 1: Turnover Trend + ABC Analysis ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">📈 庫存週轉趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={turnoverLineData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">📊 ABC 分類分析</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={abcBarData} options={{ ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, stepSize: 1 } } } }} />
          </div>
        </div>
      </div>

      {/* ── Row 2: Stock Aging + Warehouse Utilization ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">⏳ 庫齡分布</div></div>
          <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px 8px' }}>
            <Doughnut data={agingDoughnutData} options={{ ...chartOpts, cutout: '60%', plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">🏭 倉庫庫存分布</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={whBarData} options={{ ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
      </div>

      {/* ── Row 3: Stock Movement Trend ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">🔄 進出庫趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={movLineData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
      </div>

      {/* ── Dead Stock Table ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">🚫 呆滯品項明細（90+ 天無異動）</div></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU 名稱</th>
                <th style={{ textAlign: 'right' }}>數量</th>
                <th style={{ textAlign: 'right' }}>庫存價值</th>
                <th style={{ textAlign: 'right' }}>閒置天數</th>
              </tr>
            </thead>
            <tbody>
              {deadStock.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>目前無呆滯品項</td></tr>
              ) : deadStock.map((r, i) => (
                <tr key={i}>
                  <td>{r.sku}</td>
                  <td style={{ textAlign: 'right' }}>{r.qty.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>NT$ {r.value.toLocaleString()}</td>
                  <td style={{ textAlign: 'right', color: r.days >= 180 ? colors.red : colors.orange }}>{r.days} 天</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
