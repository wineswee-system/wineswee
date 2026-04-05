import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, GripVertical, Save, Layout, Settings, BarChart3, PieChart, TrendingUp, Table } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal from '../../components/Modal'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

const colors = { cyan: '#22d3ee', blue: '#3b82f6', purple: '#a78bfa', green: '#34d399', orange: '#fb923c', red: '#f87171', pink: '#f472b6', yellow: '#fbbf24' }
const colorArr = Object.values(colors)

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94a3b8', font: { size: 11, weight: 600 }, padding: 12, usePointStyle: true, pointStyleWidth: 8 } },
    tooltip: { backgroundColor: 'rgba(15,23,55,0.95)', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: 'rgba(148,163,184,0.15)', borderWidth: 1, padding: 12, cornerRadius: 10 },
  },
}
const grid = { color: 'rgba(148,163,184,0.06)' }
const tick = { color: '#64748b', font: { size: 11 } }

const WIDGET_TYPES = [
  { type: 'stat', label: 'KPI 數值卡', icon: TrendingUp },
  { type: 'bar', label: '長條圖', icon: BarChart3 },
  { type: 'line', label: '折線圖', icon: TrendingUp },
  { type: 'doughnut', label: '圓餅圖', icon: PieChart },
  { type: 'table', label: '表格', icon: Table },
]

const DATA_SOURCES = [
  { value: 'accounts_receivable', label: '應收帳款', fields: ['amount', 'paid_amount', 'status', 'due_date', 'created_at'] },
  { value: 'accounts_payable', label: '應付帳款', fields: ['amount', 'paid_amount', 'status', 'created_at'] },
  { value: 'opportunities', label: '商機', fields: ['amount', 'stage', 'created_at'] },
  { value: 'stock_levels', label: '庫存', fields: ['quantity', 'min_qty', 'category', 'product_name'] },
  { value: 'employees', label: '員工', fields: ['department', 'status', 'position', 'created_at'] },
  { value: 'attendance_records', label: '出勤', fields: ['status', 'date', 'department'] },
  { value: 'pos_transactions', label: 'POS交易', fields: ['total_amount', 'payment_method', 'created_at'] },
]

const METRICS = [
  { value: 'count', label: '計數' },
  { value: 'sum', label: '加總' },
  { value: 'average', label: '平均' },
]

const GROUP_BY = [
  { value: 'month', label: '月份' },
  { value: 'department', label: '部門' },
  { value: 'status', label: '狀態' },
  { value: 'category', label: '類別' },
]

const SIZES = [
  { value: '1x1', label: '1x1', span: 1 },
  { value: '2x1', label: '2x1', span: 2 },
  { value: '3x1', label: '3x1', span: 3 },
]

const STORAGE_KEY = 'dashboard-builder-widgets'

const defaultWidgets = [
  { id: 'w1', title: '本月營收', type: 'stat', dataSource: 'accounts_receivable', metric: 'sum', groupBy: 'status', size: '1x1' },
  { id: 'w2', title: '商機階段分布', type: 'bar', dataSource: 'opportunities', metric: 'count', groupBy: 'status', size: '1x1' },
  { id: 'w3', title: '庫存類別比例', type: 'doughnut', dataSource: 'stock_levels', metric: 'sum', groupBy: 'category', size: '1x1' },
  { id: 'w4', title: '出勤狀態', type: 'bar', dataSource: 'attendance_records', metric: 'count', groupBy: 'status', size: '1x1' },
]

function aggregate(rows, metric, groupBy) {
  const groups = {}
  rows.forEach(r => {
    const key = groupBy === 'month'
      ? (r.created_at || r.date || '').slice(0, 7) || '未知'
      : r[groupBy] || '未分類'
    if (!groups[key]) groups[key] = []
    groups[key].push(r)
  })

  const numField = (r) => {
    for (const k of ['amount', 'total_amount', 'quantity', 'paid_amount']) {
      if (r[k] !== undefined) return Number(r[k]) || 0
    }
    return 1
  }

  const labels = Object.keys(groups).sort()
  const values = labels.map(k => {
    const arr = groups[k]
    if (metric === 'count') return arr.length
    if (metric === 'sum') return arr.reduce((s, r) => s + numField(r), 0)
    if (metric === 'average') return arr.length ? Math.round(arr.reduce((s, r) => s + numField(r), 0) / arr.length) : 0
    return arr.length
  })

  return { labels, values }
}

function totalStat(rows, metric) {
  const numField = (r) => {
    for (const k of ['amount', 'total_amount', 'quantity', 'paid_amount']) {
      if (r[k] !== undefined) return Number(r[k]) || 0
    }
    return 1
  }
  if (metric === 'count') return rows.length
  if (metric === 'sum') return rows.reduce((s, r) => s + numField(r), 0)
  if (metric === 'average') return rows.length ? Math.round(rows.reduce((s, r) => s + numField(r), 0) / rows.length) : 0
  return rows.length
}

function formatNum(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString()
}

// ── Widget renderer ──
function WidgetContent({ widget, data }) {
  const rows = data[widget.dataSource] || []
  const { labels, values } = aggregate(rows, widget.metric, widget.groupBy)

  if (widget.type === 'stat') {
    const val = totalStat(rows, widget.metric)
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>{formatNum(val)}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          {METRICS.find(m => m.value === widget.metric)?.label} · {DATA_SOURCES.find(d => d.value === widget.dataSource)?.label}
        </div>
      </div>
    )
  }

  if (widget.type === 'bar') {
    return (
      <Bar data={{
        labels,
        datasets: [{ label: widget.title, data: values, backgroundColor: labels.map((_, i) => colorArr[i % colorArr.length]), borderRadius: 6, borderSkipped: false }],
      }} options={{ ...chartOpts, scales: { x: { grid, ticks: tick }, y: { grid, ticks: tick, beginAtZero: true } } }} />
    )
  }

  if (widget.type === 'line') {
    return (
      <Line data={{
        labels,
        datasets: [{
          label: widget.title, data: values, borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.08)',
          pointBackgroundColor: colors.cyan, tension: 0.4, fill: true, borderWidth: 2, pointRadius: 3,
        }],
      }} options={{ ...chartOpts, scales: { x: { grid, ticks: tick }, y: { grid, ticks: tick, beginAtZero: true } } }} />
    )
  }

  if (widget.type === 'doughnut') {
    return (
      <Doughnut data={{
        labels,
        datasets: [{ data: values, backgroundColor: labels.map((_, i) => colorArr[i % colorArr.length]), borderWidth: 0 }],
      }} options={{ ...chartOpts, cutout: '65%' }} />
    )
  }

  if (widget.type === 'table') {
    return (
      <div style={{ overflow: 'auto', maxHeight: 200, fontSize: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['分組', '數值'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l}>
                <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>{l}</td>
                <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontWeight: 600 }}>{formatNum(values[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>未知元件類型</div>
}

// ── Main component ──
export default function DashboardBuilder() {
  const [widgets, setWidgets] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : defaultWidgets
    } catch { return defaultWidgets }
  })
  const [editingId, setEditingId] = useState(null)
  const [showPalette, setShowPalette] = useState(false)
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [dragIdx, setDragIdx] = useState(null)

  // Fetch all needed data sources
  useEffect(() => {
    const sources = [...new Set(widgets.map(w => w.dataSource))]
    if (sources.length === 0) { setLoading(false); return }

    Promise.all(sources.map(src => supabase.from(src).select('*')))
      .then(results => {
        const map = {}
        sources.forEach((src, i) => { map[src] = results[i].data || [] })
        setData(map)
      })
      .catch(err => console.error('載入資料失敗:', err))
      .finally(() => setLoading(false))
  }, [widgets.map(w => w.dataSource).join(',')])

  const saveToStorage = useCallback((w) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(w))
  }, [])

  const handleSave = () => {
    saveToStorage(widgets)
    alert('儀表板已儲存')
  }

  const addWidget = (type) => {
    const id = `w${Date.now()}`
    const newWidget = { id, title: WIDGET_TYPES.find(t => t.type === type)?.label || '新元件', type, dataSource: 'accounts_receivable', metric: 'count', groupBy: 'status', size: '1x1' }
    const next = [...widgets, newWidget]
    setWidgets(next)
    saveToStorage(next)
    setShowPalette(false)
  }

  const deleteWidget = (id) => {
    const next = widgets.filter(w => w.id !== id)
    setWidgets(next)
    saveToStorage(next)
  }

  const updateWidget = (updated) => {
    const next = widgets.map(w => w.id === updated.id ? updated : w)
    setWidgets(next)
    saveToStorage(next)
    setEditingId(null)
  }

  // Drag reorder
  const handleDragStart = (idx) => setDragIdx(idx)
  const handleDragOver = (e) => e.preventDefault()
  const handleDrop = (targetIdx) => {
    if (dragIdx === null || dragIdx === targetIdx) return
    const arr = [...widgets]
    const [moved] = arr.splice(dragIdx, 1)
    arr.splice(targetIdx, 0, moved)
    setWidgets(arr)
    saveToStorage(arr)
    setDragIdx(null)
  }

  const editingWidget = widgets.find(w => w.id === editingId)

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in" style={{ padding: '0 0 32px' }}>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layout size={22} /> 🎨 自訂儀表板
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>拖曳排列、設定資料來源，打造專屬分析面板</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={15} /> 儲存
          </button>
          <button className="btn btn-primary" onClick={() => setShowPalette(!showPalette)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={15} /> 新增元件
          </button>
        </div>
      </div>

      {/* Widget palette */}
      {showPalette && (
        <div className="card" style={{ marginBottom: 20, padding: 16 }}>
          <div className="card-header" style={{ marginBottom: 12 }}>
            <h3 className="card-title" style={{ fontSize: 14 }}>選擇元件類型</h3>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {WIDGET_TYPES.map(wt => (
              <button key={wt.type} className="btn btn-secondary" onClick={() => addWidget(wt.type)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10, cursor: 'pointer' }}>
                <wt.icon size={16} /> {wt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dashboard grid */}
      {widgets.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Layout size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p style={{ fontSize: 14 }}>尚無元件，點擊「新增元件」開始建立</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {widgets.map((w, idx) => {
            const span = SIZES.find(s => s.value === w.size)?.span || 1
            return (
              <div
                key={w.id}
                className="card"
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(idx)}
                style={{
                  gridColumn: `span ${span}`,
                  padding: 0, overflow: 'hidden',
                  opacity: dragIdx === idx ? 0.5 : 1,
                  transition: 'opacity 0.2s ease, box-shadow 0.2s ease',
                }}
              >
                {/* Widget header */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <GripVertical size={14} style={{ color: 'var(--text-muted)', cursor: 'grab' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{w.title}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setEditingId(w.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }} title="設定">
                      <Settings size={14} />
                    </button>
                    <button onClick={() => deleteWidget(w.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }} title="刪除">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {/* Widget content */}
                <div style={{ padding: 16, height: w.type === 'stat' ? 120 : 220 }}>
                  <WidgetContent widget={w} data={data} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Config modal */}
      {editingWidget && (
        <Modal title="元件設定" onClose={() => setEditingId(null)} onSubmit={() => updateWidget(editingWidget)}>
          <ConfigForm widget={editingWidget} onChange={(updated) => {
            setWidgets(prev => prev.map(w => w.id === updated.id ? updated : w))
          }} />
        </Modal>
      )}
    </div>
  )
}

// ── Config form inside modal ──
function ConfigForm({ widget, onChange }) {
  const update = (field, value) => onChange({ ...widget, [field]: value })

  return (
    <>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>元件名稱</label>
        <input className="form-input" value={widget.title} onChange={e => update('title', e.target.value)} />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>資料來源</label>
        <select className="form-input" value={widget.dataSource} onChange={e => update('dataSource', e.target.value)}>
          {DATA_SOURCES.map(ds => <option key={ds.value} value={ds.value}>{ds.label}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>指標</label>
        <select className="form-input" value={widget.metric} onChange={e => update('metric', e.target.value)}>
          {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>分組依據</label>
        <select className="form-input" value={widget.groupBy} onChange={e => update('groupBy', e.target.value)}>
          {GROUP_BY.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>圖表類型</label>
        <select className="form-input" value={widget.type} onChange={e => update('type', e.target.value)}>
          {WIDGET_TYPES.map(wt => <option key={wt.type} value={wt.type}>{wt.label}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>尺寸</label>
        <select className="form-input" value={widget.size} onChange={e => update('size', e.target.value)}>
          {SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
    </>
  )
}
