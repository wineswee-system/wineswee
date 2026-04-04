import { useState, useEffect, useMemo } from 'react'
import { AlertTriangle, TrendingUp, TrendingDown, Bell, CheckCircle, XCircle, ArrowUp, ArrowDown } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler } from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler)

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

/* ── helpers ── */
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function stddev(arr) { const m = mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length || 1)) }

function getMonthKey(d) { return (d || '').slice(0, 7) }
function last7Months() {
  const out = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

function detectAnomaly(values, label, formatter = (v) => v.toLocaleString()) {
  if (values.length < 2) return null
  const history = values.slice(0, -1)
  const current = values[values.length - 1]
  const m = mean(history)
  const sd = stddev(history)
  if (sd === 0) return null
  const prev = history[history.length - 1] || m
  const changePct = prev !== 0 ? ((current - prev) / Math.abs(prev)) * 100 : 0
  const lower2 = m - 2 * sd, upper2 = m + 2 * sd
  const lower1 = m - sd, upper1 = m + sd
  let severity = null, direction = null
  if (current > upper2) { severity = '高'; direction = 'up' }
  else if (current < lower2) { severity = '高'; direction = 'down' }
  else if (current > upper1 || current < lower1) { severity = '中'; direction = current > upper1 ? 'up' : 'down' }
  if (!severity) return null
  return {
    id: label,
    metric: label,
    current,
    currentFmt: formatter(current),
    rangeLow: lower2,
    rangeHigh: upper2,
    rangeFmt: `${formatter(Math.round(lower2))} ~ ${formatter(Math.round(upper2))}`,
    changePct: changePct.toFixed(1),
    direction,
    severity,
    detectedDate: new Date().toISOString().slice(0, 10),
    status: '未確認',
    values,
    mean: m,
    sd,
  }
}

export default function AnomalyDetection() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rawData, setRawData] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [filter, setFilter] = useState('全部')

  useEffect(() => {
    Promise.all([
      supabase.from('accounts_receivable').select('*'),
      supabase.from('accounts_payable').select('*'),
      supabase.from('stock_levels').select('*'),
      supabase.from('opportunities').select('*'),
    ]).then(([ar, ap, stock, opp]) => {
      setRawData({ ar: ar.data || [], ap: ap.data || [], stock: stock.data || [], opp: opp.data || [] })
    }).catch(() => setError('資料載入失敗，請重新整理頁面'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!rawData) return
    const months = last7Months()
    const { ar, ap, stock, opp } = rawData

    // Monthly AR revenue
    const arByMonth = months.map(m => ar.filter(r => getMonthKey(r.due_date || r.created_at) === m).reduce((s, r) => s + (r.paid_amount || 0), 0))
    // Monthly AP cost
    const apByMonth = months.map(m => ap.filter(r => getMonthKey(r.due_date || r.created_at) === m).reduce((s, r) => s + (r.amount || 0), 0))
    // Low stock count per month (use updated_at or fallback: latest snapshot)
    const lowStockByMonth = months.map(m => stock.filter(r => getMonthKey(r.updated_at || r.created_at) <= m && (r.quantity <= (r.min_quantity || 0))).length)
    // Overdue AR count
    const today = new Date().toISOString().slice(0, 10)
    const overdueByMonth = months.map(m => ar.filter(r => getMonthKey(r.due_date) === m && r.status !== 'paid' && (r.due_date || '') < today).length)
    // Monthly opportunity count
    const oppByMonth = months.map(m => opp.filter(r => getMonthKey(r.created_at) === m).length)

    const fmt = (v) => `$${v.toLocaleString()}`
    const detected = [
      detectAnomaly(arByMonth, '本月營收', fmt),
      detectAnomaly(apByMonth, '本月支出', fmt),
      detectAnomaly(lowStockByMonth, '低庫存品項數'),
      detectAnomaly(overdueByMonth, '應收逾期筆數'),
      detectAnomaly(oppByMonth, '本月商機數'),
    ].filter(Boolean)

    setAlerts(detected)
    if (detected.length && !selectedAlert) setSelectedAlert(detected[0])
  }, [rawData])

  const handleConfirm = (id) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: '已確認' } : a))
  const handleIgnore = (id) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: '已處理' } : a))

  const filtered = useMemo(() => {
    if (filter === '全部') return alerts
    return alerts.filter(a => a.severity === filter)
  }, [alerts, filter])

  const kpi = useMemo(() => ({
    total: alerts.length,
    high: alerts.filter(a => a.severity === '高').length,
    medium: alerts.filter(a => a.severity === '中').length,
    confirmed: alerts.filter(a => a.status === '已確認' || a.status === '已處理').length,
  }), [alerts])

  /* trend chart for selected alert */
  const trendData = useMemo(() => {
    if (!selectedAlert) return null
    const months = last7Months()
    const vals = selectedAlert.values
    const m = selectedAlert.mean
    const sd = selectedAlert.sd
    return {
      labels: months.map(mo => mo.slice(5) + '月'),
      datasets: [
        { label: selectedAlert.metric, data: vals, borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.10)', pointRadius: vals.map((_, i) => i === vals.length - 1 ? 7 : 3), pointBackgroundColor: vals.map((_, i) => i === vals.length - 1 ? colors.red : colors.cyan), tension: 0.35, borderWidth: 2, fill: false, order: 1 },
        { label: '+2σ', data: vals.map(() => m + 2 * sd), borderColor: colors.orange, borderDash: [6, 4], borderWidth: 1, pointRadius: 0, fill: false, order: 2 },
        { label: '-2σ', data: vals.map(() => m - 2 * sd), borderColor: colors.orange, borderDash: [6, 4], borderWidth: 1, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(251,146,60,0.06)', order: 3 },
        { label: '平均', data: vals.map(() => m), borderColor: colors.purple, borderDash: [3, 3], borderWidth: 1, pointRadius: 0, fill: false, order: 4 },
      ],
    }
  }, [selectedAlert])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const severityIcon = (s) => s === '高' ? '🔴' : s === '中' ? '🟡' : '🟢'

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bell size={26} /> 異常偵測
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>自動偵測趨勢變化與異常數據</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><AlertTriangle size={18} color={colors.orange} /><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>偵測到的異常</span></div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{kpi.total}</div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><XCircle size={18} color={colors.red} /><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>高風險</span></div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.red }}>{kpi.high}</div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><AlertTriangle size={18} color={colors.yellow} /><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>中風險</span></div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.yellow }}>{kpi.medium}</div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><CheckCircle size={18} color={colors.green} /><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>已確認</span></div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.green }}>{kpi.confirmed}</div>
        </div>
      </div>

      {/* Trend Chart */}
      {selectedAlert && trendData && (
        <div className="card">
          <div className="card-header"><h3 className="card-title">趨勢圖：{selectedAlert.metric}</h3></div>
          <div style={{ height: 300, padding: '0 16px 16px' }}>
            <Line data={trendData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8 }}>
        {['全部', '高', '中'].map(f => (
          <button key={f} className={`btn ${filter === f ? 'btn-primary' : ''}`} onClick={() => setFilter(f)}
            style={{ padding: '6px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: filter === f ? 'none' : '1px solid var(--border-default)', background: filter === f ? undefined : 'var(--bg-elevated)', color: filter === f ? undefined : 'var(--text-secondary)', cursor: 'pointer' }}>
            {f === '全部' ? '全部' : `${severityIcon(f)} ${f}風險`}
          </button>
        ))}
      </div>

      {/* Alerts Table */}
      <div className="card">
        <div className="card-header"><h3 className="card-title">異常警報列表</h3></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>風險</th>
                <th>指標名稱</th>
                <th>目前值</th>
                <th>預期範圍 (±2σ)</th>
                <th>變動 %</th>
                <th>偵測日期</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  <CheckCircle size={24} style={{ marginBottom: 8 }} /><br />目前無異常偵測
                </td></tr>
              )}
              {filtered.map(a => (
                <tr key={a.id} onClick={() => setSelectedAlert(a)} style={{ cursor: 'pointer', background: selectedAlert?.id === a.id ? 'rgba(34,211,238,0.06)' : undefined }}>
                  <td>{severityIcon(a.severity)} {a.severity}</td>
                  <td style={{ fontWeight: 600 }}>
                    {a.direction === 'up' ? <TrendingUp size={14} color={colors.red} style={{ marginRight: 4, verticalAlign: 'middle' }} /> : <TrendingDown size={14} color={colors.blue} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                    {a.metric}
                  </td>
                  <td style={{ fontWeight: 600 }}>{a.currentFmt}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{a.rangeFmt}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: Number(a.changePct) >= 0 ? colors.red : colors.green, fontWeight: 600, fontSize: 13 }}>
                      {Number(a.changePct) >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                      {Math.abs(Number(a.changePct))}%
                    </span>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{a.detectedDate}</td>
                  <td>
                    <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: a.status === '未確認' ? 'rgba(251,146,60,0.15)' : a.status === '已確認' ? 'rgba(59,130,246,0.15)' : 'rgba(52,211,153,0.15)', color: a.status === '未確認' ? colors.orange : a.status === '已確認' ? colors.blue : colors.green }}>
                      {a.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                      {a.status === '未確認' && (
                        <>
                          <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => handleConfirm(a.id)}>確認</button>
                          <button className="btn" style={{ padding: '4px 12px', fontSize: 12, border: '1px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 6 }} onClick={() => handleIgnore(a.id)}>忽略</button>
                        </>
                      )}
                      {a.status === '已確認' && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>已處理中</span>}
                      {a.status === '已處理' && <CheckCircle size={16} color={colors.green} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
