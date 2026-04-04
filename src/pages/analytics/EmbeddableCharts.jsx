import { useState } from 'react'
import { Share2, Copy, ExternalLink, Code, Eye, Plus, Trash2 } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

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

const DATA_SOURCES = {
  revenue: { label: '營收趨勢', labels: ['1月','2月','3月','4月','5月','6月'], data: [320,410,380,520,490,610] },
  funnel: { label: '銷售漏斗', labels: ['潛在','接觸','報價','談判','成交'], data: [120,85,62,38,24] },
  inventory: { label: '庫存狀態', labels: ['充足','偏低','不足','缺貨'], data: [45,28,15,7] },
  receivable: { label: '應收帳齡', labels: ['0-30天','31-60天','61-90天','90天以上'], data: [580,320,180,95] },
  taskRate: { label: '任務完成率', labels: ['週一','週二','週三','週四','週五'], data: [78,85,72,90,88] },
}

const CHART_TYPES = { bar: '長條圖', line: '折線圖', doughnut: '圓餅圖' }
const VISIBILITY_OPTS = [{ value: 'public', label: '公開' }, { value: 'password', label: '需要密碼' }]
const EXPIRY_OPTS = [{ value: 'none', label: '無限期' }, { value: '7d', label: '7天' }, { value: '30d', label: '30天' }]
const THEME_OPTS = [{ value: 'dark', label: '深色' }, { value: 'light', label: '淺色' }]

const PALETTE = [colors.cyan, colors.blue, colors.purple, colors.green, colors.orange, colors.red, colors.pink, colors.yellow]

const buildChartData = (source, type) => {
  const src = DATA_SOURCES[source]
  if (!src) return null
  const bg = type === 'doughnut' ? PALETTE.slice(0, src.labels.length) : colors.cyan
  const border = type === 'doughnut' ? PALETTE.slice(0, src.labels.length) : colors.cyan
  return {
    labels: src.labels,
    datasets: [{ label: src.label, data: src.data, backgroundColor: bg, borderColor: border, borderWidth: type === 'doughnut' ? 0 : 2, fill: type === 'line', tension: 0.4 }],
  }
}

const scaleOpts = (type) => type === 'doughnut' ? {} : { scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }

const initialCharts = [
  { id: 'ch-001', title: '月營收走勢圖', type: 'line', source: 'revenue', visibility: 'public', expiry: 'none', theme: 'dark', views: 142, createdAt: '2026-03-20' },
  { id: 'ch-002', title: '銷售漏斗分析', type: 'doughnut', source: 'funnel', visibility: 'public', expiry: '30d', theme: 'dark', views: 87, createdAt: '2026-03-25' },
  { id: 'ch-003', title: '庫存水位儀表板', type: 'bar', source: 'inventory', visibility: 'password', expiry: 'none', theme: 'light', views: 53, createdAt: '2026-04-01' },
  { id: 'ch-004', title: '每週任務完成率', type: 'bar', source: 'taskRate', visibility: 'public', expiry: '7d', theme: 'dark', views: 31, createdAt: '2026-04-03' },
]

const ChartRenderer = ({ type, data, height = 160 }) => {
  if (!data) return null
  const opts = { ...chartOpts, ...scaleOpts(type) }
  const style = { height }
  return (
    <div style={style}>
      {type === 'bar' && <Bar data={data} options={opts} />}
      {type === 'line' && <Line data={data} options={opts} />}
      {type === 'doughnut' && <Doughnut data={data} options={opts} />}
    </div>
  )
}

const statusBadge = (chart) => {
  if (chart.expiry !== 'none') {
    const days = chart.expiry === '7d' ? 7 : 30
    const created = new Date(chart.createdAt)
    const expDate = new Date(created.getTime() + days * 86400000)
    if (new Date() > expDate) return <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: 'rgba(248,113,113,0.15)', color: colors.red }}>已過期</span>
  }
  if (chart.visibility === 'password') return <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: 'rgba(251,191,36,0.15)', color: colors.yellow }}>私密</span>
  return <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: 'rgba(34,211,238,0.15)', color: colors.cyan }}>公開</span>
}

export default function EmbeddableCharts() {
  const [sharedCharts, setSharedCharts] = useState(initialCharts)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPreview, setShowPreview] = useState(null)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({ title: '', type: 'bar', source: 'revenue', visibility: 'public', expiry: 'none', theme: 'dark' })

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const totalViews = sharedCharts.reduce((s, c) => s + c.views, 0)
  const publicCount = sharedCharts.filter(c => c.visibility === 'public').length

  const handleCreate = () => {
    if (!form.title.trim()) return flash('請輸入圖表標題')
    const newChart = { ...form, id: `ch-${Date.now()}`, views: 0, createdAt: new Date().toISOString().slice(0, 10) }
    setSharedCharts(prev => [newChart, ...prev])
    setShowCreateModal(false)
    setForm({ title: '', type: 'bar', source: 'revenue', visibility: 'public', expiry: 'none', theme: 'dark' })
    flash('圖表已建立')
  }

  const handleDelete = (id) => {
    setSharedCharts(prev => prev.filter(c => c.id !== id))
    flash('圖表已刪除')
  }

  const copyLink = (id) => {
    const url = `${window.location.origin}/embed/${id}`
    navigator.clipboard.writeText(url).then(() => flash('連結已複製'))
  }

  const copyEmbed = (id) => {
    const code = `<iframe src="${window.location.origin}/embed/${id}" width="600" height="400" frameborder="0"></iframe>`
    navigator.clipboard.writeText(code).then(() => flash('嵌入碼已複製'))
  }

  const kpis = [
    { label: '已建立圖表', value: sharedCharts.length, color: colors.cyan },
    { label: '公開中', value: publicCount, color: colors.green },
    { label: '總瀏覽次數', value: totalViews.toLocaleString(), color: colors.purple },
  ]

  return (
    <div className="fade-in" style={{ padding: 24 }}>
      {/* Toast */}
      {toast && <div style={{ position: 'fixed', top: 24, right: 24, zIndex: 9999, background: 'rgba(15,23,55,0.95)', color: '#f1f5f9', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, border: '1px solid rgba(34,211,238,0.3)' }}>{toast}</div>}

      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Share2 size={22} /> 圖表分享</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>建立可嵌入的圖表供外部使用</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> 建立分享圖表
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {kpis.map(k => (
          <div className="card" key={k.label} style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {sharedCharts.map(chart => (
          <div className="card" key={chart.id} style={{ padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <ChartRenderer type={chart.type} data={buildChartData(chart.source, chart.type)} height={140} />
            </div>
            <div className="card-header" style={{ padding: 0, border: 'none', marginBottom: 8 }}>
              <div>
                <div className="card-title" style={{ fontSize: 14, margin: 0 }}>{chart.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {CHART_TYPES[chart.type]} &middot; {chart.createdAt} &middot; {chart.views} 次瀏覽
                </div>
              </div>
              {statusBadge(chart)}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn" onClick={() => copyLink(chart.id)} title="複製連結" style={{ padding: '4px 8px', fontSize: 12 }}><Copy size={14} /></button>
              <button className="btn" onClick={() => copyEmbed(chart.id)} title="複製嵌入碼" style={{ padding: '4px 8px', fontSize: 12 }}><Code size={14} /></button>
              <button className="btn" onClick={() => setShowPreview(chart)} title="預覽" style={{ padding: '4px 8px', fontSize: 12 }}><Eye size={14} /></button>
              <button className="btn" onClick={() => handleDelete(chart.id)} title="刪除" style={{ padding: '4px 8px', fontSize: 12, color: colors.red }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowCreateModal(false)}>
          <div className="card" style={{ width: 480, maxHeight: '85vh', overflowY: 'auto', padding: 24 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px' }}>建立分享圖表</h3>

            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>圖表標題</label>
            <input className="form-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="輸入圖表名稱" style={{ width: '100%', marginBottom: 14 }} />

            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>圖表類型</label>
            <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ width: '100%', marginBottom: 14 }}>
              {Object.entries(CHART_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>

            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>資料來源</label>
            <select className="form-input" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} style={{ width: '100%', marginBottom: 14 }}>
              {Object.entries(DATA_SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>

            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>可見性</label>
            <select className="form-input" value={form.visibility} onChange={e => setForm(f => ({ ...f, visibility: e.target.value }))} style={{ width: '100%', marginBottom: 14 }}>
              {VISIBILITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>有效期限</label>
            <select className="form-input" value={form.expiry} onChange={e => setForm(f => ({ ...f, expiry: e.target.value }))} style={{ width: '100%', marginBottom: 14 }}>
              {EXPIRY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>主題</label>
            <select className="form-input" value={form.theme} onChange={e => setForm(f => ({ ...f, theme: e.target.value }))} style={{ width: '100%', marginBottom: 14 }}>
              {THEME_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Preview */}
            {form.source && (
              <div style={{ marginBottom: 16, background: 'rgba(148,163,184,0.04)', borderRadius: 10, padding: 12 }}>
                <ChartRenderer type={form.type} data={buildChartData(form.source, form.type)} height={180} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowCreateModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate}>建立</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowPreview(null)}>
          <div className="card" style={{ width: 680, padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{showPreview.title}</h3>
              {statusBadge(showPreview)}
            </div>
            <ChartRenderer type={showPreview.type} data={buildChartData(showPreview.source, showPreview.type)} height={360} />
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
              {CHART_TYPES[showPreview.type]} &middot; {DATA_SOURCES[showPreview.source]?.label} &middot; 建立於 {showPreview.createdAt} &middot; {showPreview.views} 次瀏覽
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => copyLink(showPreview.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><Copy size={14} /> 複製連結</button>
              <button className="btn" onClick={() => copyEmbed(showPreview.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><Code size={14} /> 複製嵌入碼</button>
              <button className="btn" onClick={() => setShowPreview(null)}>關閉</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
