import { useState, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { getManufacturingOrders, getWorkCenters } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const COLORS = ['#3b82f6', '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#22d3ee', '#fbbf24', '#f87171']

function daysBetween(d1, d2) {
  return Math.ceil((new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24))
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function Scheduling() {
  const [orders, setOrders] = useState([])
  const [workCenters, setWorkCenters] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() + 1) // Monday
    return d.toISOString().slice(0, 10)
  })
  const [viewDays, setViewDays] = useState(14)

  const load = async () => {
    setLoading(true)
    const [ordersRes, wcRes] = await Promise.all([getManufacturingOrders(), getWorkCenters()])
    setOrders(ordersRes.data || [])
    setWorkCenters(wcRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const weekEnd = addDays(weekStart, viewDays - 1)
  const days = Array.from({ length: viewDays }, (_, i) => addDays(weekStart, i))

  // Filter orders that overlap with the visible window
  const visibleOrders = orders.filter(o => {
    if (!o.start_date || !o.due_date) return false
    return o.start_date <= weekEnd && o.due_date >= weekStart
  })

  const statusColor = (s) => {
    switch (s) {
      case '待生產': return '#fbbf24'
      case '生產中': return '#3b82f6'
      case '已完成': return '#34d399'
      case '已取消': return '#f87171'
      default: return '#94a3b8'
    }
  }

  const prevWeek = () => setWeekStart(addDays(weekStart, -7))
  const nextWeek = () => setWeekStart(addDays(weekStart, 7))
  const today = () => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() + 1)
    setWeekStart(d.toISOString().slice(0, 10))
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📅</span> 生產排程</h2>
            <p>Production Scheduling — 製令甘特圖</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={viewDays} onChange={e => setViewDays(Number(e.target.value))} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <option value={7}>1 週</option>
              <option value={14}>2 週</option>
              <option value={21}>3 週</option>
              <option value={30}>1 月</option>
            </select>
            <button className="btn btn-secondary" onClick={prevWeek}><ChevronLeft size={14} /></button>
            <button className="btn btn-secondary" onClick={today}>今天</button>
            <button className="btn btn-secondary" onClick={nextWeek}><ChevronRight size={14} /></button>
            <button className="btn btn-primary" onClick={load}><RefreshCw size={14} /> 重新整理</button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">總製令</div>
          <div className="stat-card-value">{orders.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': '#fbbf24', '--card-accent-dim': 'rgba(251,191,36,0.15)' }}>
          <div className="stat-card-label">待生產</div>
          <div className="stat-card-value">{orders.filter(o => o.status === '待生產').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">生產中</div>
          <div className="stat-card-value">{orders.filter(o => o.status === '生產中').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成</div>
          <div className="stat-card-value">{orders.filter(o => o.status === '已完成').length}</div>
        </div>
      </div>

      {/* Gantt Chart */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'auto' }}>
        {/* Header row with dates */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 2 }}>
          <div style={{ minWidth: 200, padding: '10px 16px', fontWeight: 700, fontSize: 13, borderRight: '1px solid var(--border)' }}>
            製令
          </div>
          {days.map(day => {
            const d = new Date(day)
            const isWeekend = d.getDay() === 0 || d.getDay() === 6
            const isToday = day === new Date().toISOString().slice(0, 10)
            return (
              <div key={day} style={{
                minWidth: 48, flex: 1, padding: '6px 4px', textAlign: 'center', fontSize: 11, fontWeight: 600,
                background: isToday ? 'var(--accent-blue-dim)' : isWeekend ? 'rgba(148,163,184,0.05)' : 'transparent',
                borderRight: '1px solid var(--border)',
                color: isToday ? 'var(--accent-blue)' : isWeekend ? 'var(--text-secondary)' : 'var(--text-primary)',
              }}>
                <div>{d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}</div>
                <div style={{ fontSize: 10, opacity: 0.7 }}>{['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}</div>
              </div>
            )
          })}
        </div>

        {/* Order rows */}
        {visibleOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>此時段無排程的製令</div>
        ) : visibleOrders.map((order, oi) => {
          const startOffset = Math.max(0, daysBetween(weekStart, order.start_date))
          const endOffset = Math.min(viewDays, daysBetween(weekStart, order.due_date) + 1)
          const barStart = startOffset
          const barWidth = Math.max(1, endOffset - startOffset)
          const progress = order.quantity > 0 ? Math.round(((order.completed_qty || 0) / order.quantity) * 100) : 0
          const color = COLORS[oi % COLORS.length]

          return (
            <div key={order.id} style={{ display: 'flex', borderBottom: '1px solid var(--border)', minHeight: 48 }}>
              <div style={{ minWidth: 200, padding: '8px 12px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{order.mo_number || `MO-${order.id}`}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {order.product_name} x{order.quantity}
                  <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: `color-mix(in srgb, ${statusColor(order.status)} 15%, transparent)`, color: statusColor(order.status) }}>{order.status}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flex: 1, position: 'relative', alignItems: 'center' }}>
                {days.map((day, di) => {
                  const d = new Date(day)
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6
                  const isToday = day === new Date().toISOString().slice(0, 10)
                  return (
                    <div key={day} style={{
                      minWidth: 48, flex: 1, height: '100%',
                      background: isToday ? 'var(--accent-blue-dim)' : isWeekend ? 'rgba(148,163,184,0.03)' : 'transparent',
                      borderRight: '1px solid var(--border)',
                    }} />
                  )
                })}
                {/* Gantt bar */}
                <div style={{
                  position: 'absolute', top: 10, bottom: 10,
                  left: `calc(${(barStart / viewDays) * 100}%)`,
                  width: `calc(${(barWidth / viewDays) * 100}%)`,
                  background: `color-mix(in srgb, ${color} 25%, transparent)`,
                  border: `2px solid ${color}`,
                  borderRadius: 6,
                  overflow: 'hidden',
                  display: 'flex', alignItems: 'center', paddingLeft: 8,
                  fontSize: 11, fontWeight: 600, color,
                }}>
                  {/* Progress fill */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, bottom: 0,
                    width: `${progress}%`,
                    background: `color-mix(in srgb, ${color} 30%, transparent)`,
                    borderRadius: 4,
                  }} />
                  <span style={{ position: 'relative', zIndex: 1 }}>{progress}%</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
        {['待生產', '生產中', '已完成'].map(s => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: statusColor(s) }} />
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}
