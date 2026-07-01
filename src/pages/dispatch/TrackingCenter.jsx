import { useState, useEffect, useRef } from 'react'
import { toast } from '../../lib/toast'
import { useOrgId } from '../../contexts/AuthContext'
import { getDispatchJobs, getTrackingEvents } from '../../lib/db/dispatch'
import { appendManualUpdate } from '../../lib/dispatch/trackingAggregator'

const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'in_transit', label: '運送中' },
  { key: 'delivered', label: '已送達' },
  { key: 'exception', label: '異常' },
  { key: 'sla_risk', label: 'SLA 風險' },
]

const JOB_STATUS_MAP = {
  pending: { label: '待處理', cls: 'badge badge-warning' },
  picked_up: { label: '已攬收', cls: 'badge badge-info' },
  in_transit: { label: '運送中', cls: 'badge badge-cyan' },
  out_for_delivery: { label: '派送中', cls: 'badge badge-cyan' },
  delivered: { label: '已送達', cls: 'badge badge-success' },
  failed: { label: '失敗', cls: 'badge badge-danger' },
  exception: { label: '異常', cls: 'badge badge-danger' },
  cancelled: { label: '已取消', cls: 'badge badge-danger' },
}

const EVENT_CODE_MAP = {
  picked_up: { label: '已攬收', cls: 'badge badge-info' },
  in_transit: { label: '運送中', cls: 'badge badge-cyan' },
  out_for_delivery: { label: '派送中', cls: 'badge badge-cyan' },
  delivered: { label: '已送達', cls: 'badge badge-success' },
  failed: { label: '失敗', cls: 'badge badge-danger' },
  exception: { label: '異常', cls: 'badge badge-danger' },
}

const MANUAL_STATUS_OPTIONS = [
  { value: 'in_transit', label: '運送中' },
  { value: 'out_for_delivery', label: '派送中' },
  { value: 'delivered', label: '已送達' },
  { value: 'failed', label: '失敗' },
  { value: 'exception', label: '異常' },
]

function fmtTime(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TrackingCenter() {
  const orgId = useOrgId()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('all')

  const [panelJob, setPanelJob] = useState(null)
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)

  const [manualCode, setManualCode] = useState('in_transit')
  const [manualNote, setManualNote] = useState('')
  const [posting, setPosting] = useState(false)
  const panelRef = useRef(null)

  const load = async () => {
    if (!orgId) return
    setLoading(true)
    const { data, error } = await getDispatchJobs(orgId)
    if (error) toast.error('載入失敗', { description: error.message })
    else setJobs(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [orgId])

  const openPanel = async (job) => {
    setPanelJob(job)
    setManualCode('in_transit')
    setManualNote('')
    setEventsLoading(true)
    const { data, error } = await getTrackingEvents(job.id)
    if (error) toast.error('事件載入失敗')
    else setEvents(data ?? [])
    setEventsLoading(false)
  }

  const closePanel = () => { setPanelJob(null); setEvents([]) }

  const handleManualUpdate = async () => {
    if (!panelJob) return
    setPosting(true)
    try {
      await appendManualUpdate({
        jobId: panelJob.id,
        shipmentId: panelJob.shipment_id ?? null,
        eventCode: manualCode,
        description: manualNote || null,
        actorId: null,
      })
      toast.success('狀態已更新')
      setManualNote('')
      const { data } = await getTrackingEvents(panelJob.id)
      setEvents(data ?? [])
      load()
    } catch (e) {
      toast.error('更新失敗', { description: e.message })
    } finally {
      setPosting(false)
    }
  }

  const filtered = jobs.filter(j => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      (j.tracking_number ?? '').toLowerCase().includes(q) ||
      (j.job_number ?? '').toLowerCase().includes(q) ||
      (j.recipient_name ?? '').toLowerCase().includes(q)
    const matchTab = activeTab === 'all' ? true
      : activeTab === 'sla_risk' ? (j.sla_status === 'at_risk' || j.sla_status === 'breached')
      : j.status === activeTab
    return matchSearch && matchTab
  })

  return (
    <div className="fade-in" style={{ position: 'relative' }}>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🗺️</span> 追蹤中心</h2>
            <p>全貨況即時追蹤，SLA 監控與手動狀態更新</p>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={load}>重新整理</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          className="form-input"
          style={{ maxWidth: 280 }}
          placeholder="搜尋任務編號、追蹤號碼、收件人…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {STATUS_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: '5px 14px',
                borderRadius: 9999,
                border: '1px solid var(--border-medium)',
                background: activeTab === t.key ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                color: activeTab === t.key ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: activeTab === t.key ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>任務編號</th>
                <th>追蹤號碼</th>
                <th>物流商</th>
                <th>收件人</th>
                <th>狀態</th>
                <th>SLA</th>
                <th>上次更新</th>
                <th>動作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>載入中…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>無符合資料</td></tr>
              )}
              {!loading && filtered.map(j => {
                const statusDef = JOB_STATUS_MAP[j.status] ?? { label: j.status, cls: 'badge' }
                const slaCls = j.sla_status === 'breached' ? 'badge badge-danger'
                  : j.sla_status === 'at_risk' ? 'badge badge-warning'
                  : j.sla_status === 'on_time' ? 'badge badge-success'
                  : 'badge'
                const slaLabel = j.sla_status === 'breached' ? 'SLA 破線'
                  : j.sla_status === 'at_risk' ? 'SLA 風險'
                  : j.sla_status === 'on_time' ? '準時'
                  : j.sla_status ?? '—'
                return (
                  <tr key={j.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{j.job_number ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{j.tracking_number ?? '—'}</td>
                    <td>{j.carrier_configs?.name ?? '—'}</td>
                    <td>{j.recipient_name ?? '—'}</td>
                    <td><span className={statusDef.cls}>{statusDef.label}</span></td>
                    <td><span className={slaCls}>{slaLabel}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{fmtTime(j.updated_at)}</td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => openPanel(j)}
                      >
                        查看時間軸
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {panelJob && (
        <>
          <div
            onClick={closePanel}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }}
          />
          <div
            ref={panelRef}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
              background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-md)',
              zIndex: 201, display: 'flex', flexDirection: 'column', overflowY: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-medium)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>追蹤時間軸</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{panelJob.job_number ?? panelJob.tracking_number}</div>
              </div>
              <button
                onClick={closePanel}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 20, lineHeight: 1 }}
              >×</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {eventsLoading && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>載入中…</div>}
              {!eventsLoading && events.length === 0 && (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>尚無追蹤事件</div>
              )}
              {!eventsLoading && events.map((ev, idx) => {
                const evDef = EVENT_CODE_MAP[ev.event_code] ?? { label: ev.event_code, cls: 'badge' }
                return (
                  <div key={ev.id ?? idx} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%', marginTop: 4, flexShrink: 0,
                        background: idx === events.length - 1 ? 'var(--accent-cyan)' : 'var(--border-medium)',
                      }} />
                      {idx < events.length - 1 && (
                        <div style={{ width: 2, flex: 1, background: 'var(--border-medium)', marginTop: 4 }} />
                      )}
                    </div>
                    <div style={{ flex: 1, paddingBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span className={evDef.cls}>{evDef.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTime(ev.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{ev.description ?? ev.event_code}</div>
                      {ev.location && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>📍 {ev.location}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-medium)', background: 'var(--bg-secondary)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: 'var(--text-primary)' }}>手動更新</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select className="form-input" value={manualCode} onChange={e => setManualCode(e.target.value)}>
                  {MANUAL_STATUS_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <input
                  className="form-input"
                  placeholder="備注（選填）"
                  value={manualNote}
                  onChange={e => setManualNote(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleManualUpdate}
                  disabled={posting}
                  style={{ width: '100%' }}
                >
                  {posting ? '更新中…' : '送出更新'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
