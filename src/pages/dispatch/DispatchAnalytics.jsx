import { useState, useEffect } from 'react'
import { toast } from '../../lib/toast'
import { useOrgId } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { getDispatchKPIs } from '../../lib/db/dispatch'

function defaultDateFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function fmtTime(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const STATUS_COLOR_MAP = {
  pending: 'var(--accent-blue)',
  picked_up: 'var(--accent-cyan)',
  in_transit: 'var(--accent-cyan)',
  out_for_delivery: 'var(--accent-purple)',
  delivered: 'var(--accent-green)',
  failed: 'var(--accent-orange)',
  exception: 'var(--accent-red)',
  cancelled: 'var(--accent-red)',
}

const STATUS_LABEL = {
  pending: '待處理', picked_up: '已攬收', in_transit: '運送中',
  out_for_delivery: '派送中', delivered: '已送達', failed: '失敗',
  exception: '異常', cancelled: '已取消',
}

const SLA_EVENT_TYPE_MAP = {
  breach: '破線', at_risk: 'SLA 風險', recovered: '已恢復', warning: '警告',
}

function MetricBar({ label, value, max = 100, color, suffix = '%' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}{suffix}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 4, background: color, width: `${pct}%`, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

export default function DispatchAnalytics() {
  const orgId = useOrgId()
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(todayStr)
  const [kpis, setKpis] = useState(null)
  const [statusBreakdown, setStatusBreakdown] = useState([])
  const [slaEvents, setSlaEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const [kpiResult, { data: jobs }, { data: slaData }] = await Promise.all([
        getDispatchKPIs(orgId, dateFrom, dateTo),
        supabase.from('dispatch_jobs')
          .select('status')
          .eq('org_id', orgId)
          .gte('created_at', dateFrom)
          .lte('created_at', dateTo),
        supabase.from('dispatch_sla_events')
          .select('id, event_type, job_id, triggered_at, notes, dispatch_jobs(job_number)')
          .order('triggered_at', { ascending: false })
          .limit(50),
      ])
      setKpis(kpiResult)
      const counts = {}
      for (const j of jobs ?? []) counts[j.status] = (counts[j.status] ?? 0) + 1
      setStatusBreakdown(
        Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count }))
      )
      setSlaEvents(slaData ?? [])
    } catch (e) {
      setError(e.message ?? '載入失敗')
      toast.error('載入失敗', { description: e.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [orgId])

  const totalJobs = statusBreakdown.reduce((s, r) => s + r.count, 0)

  const otdColor = kpis
    ? kpis.otdRate >= 90 ? 'var(--accent-green)' : kpis.otdRate >= 70 ? 'var(--accent-orange)' : 'var(--accent-red)'
    : 'var(--accent-cyan)'
  const farColor = kpis
    ? kpis.firstAttemptRate >= 85 ? 'var(--accent-green)' : kpis.firstAttemptRate >= 65 ? 'var(--accent-orange)' : 'var(--accent-red)'
    : 'var(--accent-cyan)'
  const excColor = kpis
    ? kpis.exceptionRate > 5 ? 'var(--accent-red)' : kpis.exceptionRate > 2 ? 'var(--accent-orange)' : 'var(--accent-green)'
    : 'var(--accent-cyan)'

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📊</span> 派遣分析</h2>
            <p>準時率、首次成功率、在途時間與異常指標</p>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="form-input" type="date" style={{ width: 140 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span style={{ color: 'var(--text-muted)' }}>至</span>
            <input className="form-input" type="date" style={{ width: 140 }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
            <button className="btn btn-secondary" onClick={load} disabled={loading}>
              {loading ? '載入中…' : '重新載入'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--accent-red-dim, rgba(239,68,68,0.12))', color: 'var(--accent-red)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {kpis && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">準時率（OTD）</div>
              <div className="stat-value" style={{ color: otdColor }}>{kpis.otdRate}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">首次成功率</div>
              <div className="stat-value" style={{ color: farColor }}>{kpis.firstAttemptRate}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">平均在途時數</div>
              <div className="stat-value" style={{ color: 'var(--accent-cyan)' }}>{kpis.avgTransitHours} h</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">異常率</div>
              <div className="stat-value" style={{ color: excColor }}>{kpis.exceptionRate}%</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title"><span className="card-title-icon">📈</span> 指標概覽</span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <MetricBar label="準時率（OTD）" value={kpis.otdRate} color={otdColor} />
              <MetricBar label="首次成功率" value={kpis.firstAttemptRate} color={farColor} />
              <MetricBar label="平均在途時數" value={kpis.avgTransitHours} max={48} suffix=" h" color="var(--accent-cyan)" />
              <MetricBar label="異常率" value={kpis.exceptionRate} color={excColor} />
            </div>
          </div>
        </>
      )}

      {!kpis && !loading && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          選取日期範圍後點選「重新載入」
        </div>
      )}

      {statusBreakdown.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title"><span className="card-title-icon">🗂️</span> 狀態分佈</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {statusBreakdown.map(({ status, count }) => {
              const pct = totalJobs > 0 ? Math.round((count / totalJobs) * 100) : 0
              const color = STATUS_COLOR_MAP[status] ?? 'var(--accent-blue)'
              return (
                <div key={status} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{STATUS_LABEL[status] ?? status}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color }}>{count} 件 ({pct}%)</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, background: color, width: `${pct}%`, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title"><span className="card-title-icon">⚠️</span> SLA 事件紀錄</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>事件類型</th>
                <th>任務編號</th>
                <th>觸發時間</th>
                <th>備注</th>
              </tr>
            </thead>
            <tbody>
              {slaEvents.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>無 SLA 事件</td></tr>
              )}
              {slaEvents.map(ev => (
                <tr key={ev.id}>
                  <td>
                    <span className={ev.event_type === 'breach' ? 'badge badge-danger' : ev.event_type === 'at_risk' ? 'badge badge-warning' : 'badge badge-info'}>
                      {SLA_EVENT_TYPE_MAP[ev.event_type] ?? ev.event_type}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{ev.dispatch_jobs?.job_number ?? ev.job_id ?? '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{fmtTime(ev.triggered_at)}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{ev.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
