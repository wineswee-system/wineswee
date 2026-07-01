import { useState, useEffect } from 'react'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { getDispatchJobs } from '../../lib/db/dispatch'

const PRIORITY_BADGE = { urgent: 'badge-danger', high: 'badge-warning', normal: 'badge-cyan', low: 'badge-neutral' }
const PRIORITY_LABEL = { urgent: '緊急', high: '高', normal: '一般', low: '低' }
const SLA_BADGE = { on_track: 'badge-success', at_risk: 'badge-warning', breached: 'badge-danger' }
const SLA_LABEL = { on_track: '正常', at_risk: '風險', breached: '逾期' }
const STATUS_BADGE = {
  queued: 'badge-warning', assigned: 'badge-info', in_transit: 'badge-cyan',
  out_for_delivery: 'badge-cyan', delivered: 'badge-success',
  failed: 'badge-danger', exception: 'badge-danger', closed: 'badge-neutral',
}
const STATUS_LABEL = {
  queued: '待派送', assigned: '已指派', in_transit: '運送中',
  out_for_delivery: '派送中', delivered: '已送達',
  failed: '失敗', exception: '異常', closed: '已關閉',
}

export default function DispatchDashboard() {
  const orgId = useOrgId()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    getDispatchJobs(orgId)
      .then(({ data }) => setJobs(data || []))
      .finally(() => setLoading(false))
  }, [orgId])

  if (loading) return <LoadingSpinner />

  const counts = {
    queued: jobs.filter(j => j.status === 'queued').length,
    assigned: jobs.filter(j => j.status === 'assigned').length,
    in_transit: jobs.filter(j => j.status === 'in_transit').length,
    delivered: jobs.filter(j => j.status === 'delivered').length,
    at_risk: jobs.filter(j => j.sla_status === 'at_risk').length,
    breached: jobs.filter(j => j.sla_status === 'breached').length,
  }

  const filtered = jobs.filter(j => {
    if (statusFilter !== 'all' && j.status !== statusFilter) return false
    if (priorityFilter !== 'all' && j.priority !== priorityFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        j.job_number?.toLowerCase().includes(q) ||
        j.recipient_name?.toLowerCase().includes(q) ||
        j.carrier_name?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const statCards = [
    { label: '待派送', value: counts.queued, color: 'var(--accent-orange)', icon: '📋' },
    { label: '已指派', value: counts.assigned, color: 'var(--accent-blue)', icon: '📌' },
    { label: '運送中', value: counts.in_transit, color: 'var(--accent-cyan)', icon: '🚚' },
    { label: '已送達', value: counts.delivered, color: 'var(--accent-green)', icon: '✅' },
    { label: 'SLA風險', value: counts.at_risk, color: 'var(--accent-orange)', icon: '⚠️' },
    { label: 'SLA逾期', value: counts.breached, color: 'var(--accent-red)', icon: '🔴' },
  ]

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <h2><span className="header-icon">🚛</span> 派送總覽</h2>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>監控所有派送任務狀態與 SLA 達成率</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {statCards.map(c => (
          <div key={c.label} className="stat-card" style={{ borderTop: `3px solid ${c.color}` }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{c.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📦</span> 派送任務列表</div>
          <span className="badge badge-neutral">{filtered.length} 筆</span>
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '0 16px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-bar" style={{ flex: '1 1 200px' }}>
            <span className="search-icon">🔍</span>
            <input
              className="form-input"
              placeholder="搜尋任務編號、收件人、物流商..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%' }}
            />
          </div>
          <select className="form-input" style={{ width: 130 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">全部狀態</option>
            {Object.keys(STATUS_LABEL).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="form-input" style={{ width: 110 }} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            <option value="all">全部優先級</option>
            {Object.keys(PRIORITY_LABEL).map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </div>

        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>任務編號</th>
                <th>收件人</th>
                <th>物流商</th>
                <th>狀態</th>
                <th>SLA</th>
                <th>優先級</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                    查無符合條件的任務
                  </td>
                </tr>
              )}
              {filtered.map(j => (
                <tr key={j.id}>
                  <td style={{ fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>{j.job_number}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{j.recipient_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{j.recipient_phone}</div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{j.carrier_name || '—'}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[j.status] || 'badge-neutral'}`}>
                      <span className="badge-dot"></span>
                      {STATUS_LABEL[j.status] || j.status}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${SLA_BADGE[j.sla_status] || 'badge-neutral'}`}>
                      {SLA_LABEL[j.sla_status] || '—'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${PRIORITY_BADGE[j.priority] || 'badge-neutral'}`}>
                      {PRIORITY_LABEL[j.priority] || j.priority || '—'}
                    </span>
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
