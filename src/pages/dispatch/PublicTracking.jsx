import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const STATUS_MAP = {
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
  picked_up: { label: '已攬收', icon: '📦' },
  in_transit: { label: '運送中', icon: '🚚' },
  out_for_delivery: { label: '派送中', icon: '🛵' },
  delivered: { label: '已簽收', icon: '✅' },
  failed: { label: '派送失敗', icon: '❌' },
  exception: { label: '異常', icon: '⚠️' },
  manual: { label: '狀態更新', icon: '📋' },
}

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function fmtDateTime(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function PublicTracking() {
  const { number } = useParams()
  const [job, setJob] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!number) { setNotFound(true); setLoading(false); return }
    const run = async () => {
      setLoading(true)
      const { data: jobData, error: jobErr } = await supabase
        .from('dispatch_jobs')
        .select('id, tracking_number, status, recipient_name, destination, estimated_date, carrier_configs(name)')
        .eq('tracking_number', number)
        .single()
      if (jobErr || !jobData) { setNotFound(true); setLoading(false); return }
      setJob(jobData)
      const { data: evData } = await supabase
        .from('dispatch_tracking_events')
        .select('id, event_code, description, location, created_at')
        .eq('job_id', jobData.id)
        .order('created_at', { ascending: true })
      setEvents(evData ?? [])
      setLoading(false)
    }
    run()
  }, [number])

  const outerStyle = {
    minHeight: '100vh',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 16px',
  }
  const wrapStyle = { width: '100%', maxWidth: 600 }

  if (loading) {
    return (
      <div style={outerStyle}>
        <div style={wrapStyle}>
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>載入中…</div>
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div style={outerStyle}>
        <div style={wrapStyle}>
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>找不到追蹤記錄</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>查無追蹤號碼：</p>
            <p style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 600, color: 'var(--accent-cyan)' }}>
              {number ?? '（未提供）'}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 16 }}>
              請確認號碼是否正確，或聯繫客服查詢配送進度。
            </p>
          </div>
        </div>
      </div>
    )
  }

  const statusDef = STATUS_MAP[job.status] ?? { label: job.status, cls: 'badge' }

  return (
    <div style={outerStyle}>
      <div style={wrapStyle}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📦</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            包裹追蹤
          </h1>
          <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>{job.tracking_number}</p>
        </div>

        <div className="card" style={{ marginBottom: 16, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>配送狀態</div>
            <span className={statusDef.cls}>{statusDef.label}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>物流商</div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{job.carrier_configs?.name ?? '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>收件人</div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{job.recipient_name ?? '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>配送地址</div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{job.destination ?? '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>預計送達</div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{fmtDate(job.estimated_date)}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: 'var(--text-primary)' }}>配送動態</div>
          {events.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0', fontSize: 14 }}>
              尚無配送事件記錄
            </div>
          )}
          {events.map((ev, idx) => {
            const evDef = EVENT_CODE_MAP[ev.event_code] ?? { label: ev.event_code, icon: '📋' }
            const isLast = idx === events.length - 1
            return (
              <div key={ev.id ?? idx} style={{ display: 'flex', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: isLast ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                    border: `2px solid ${isLast ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                  }}>
                    {evDef.icon}
                  </div>
                  {!isLast && (
                    <div style={{ width: 2, flex: 1, background: 'var(--border-medium)', margin: '4px 0' }} />
                  )}
                </div>
                <div style={{ flex: 1, paddingBottom: isLast ? 0 : 20 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: isLast ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>
                      {evDef.label}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDateTime(ev.created_at)}</span>
                  </div>
                  {ev.description && ev.description !== evDef.label && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 2 }}>{ev.description}</div>
                  )}
                  {ev.location && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>📍 {ev.location}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: 'var(--text-muted)' }}>
          如有疑問，請聯繫客服人員
        </div>
      </div>
    </div>
  )
}
