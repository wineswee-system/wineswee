import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

// Status badge config — mirrors STATUS_CONFIG in InstanceDetailView
function getInstanceStatusBadge(instance) {
  const { status, planned_end_date } = instance
  if (status === '已完成') {
    return { label: '已完成', color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' }
  }
  if (planned_end_date && new Date(planned_end_date) < new Date()) {
    return { label: '逾期', color: 'var(--accent-red)', bg: 'var(--accent-red-dim)' }
  }
  return { label: '進行中', color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)' }
}

function StatCard({ label, value }) {
  return (
    <div style={{
      background: 'var(--glass-light)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 10,
      padding: '14px 16px',
      flex: '1 1 0',
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>{value}</span>
    </div>
  )
}

export default function TemplateAnalyticsModal({ template, usageCount, onClose }) {
  const [analytics, setAnalytics] = useState(null)
  const [instances, setInstances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!template?.id) return

    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [analyticsRes, instancesRes] = await Promise.all([
          supabase
            .from('sop_template_analytics')
            .select('*')
            .eq('template_id', template.id)
            .maybeSingle(),
          supabase
            .from('workflow_instances')
            .select('id, store, started_by, status, created_at, planned_end_date')
            .eq('template_name', template.name)
            .order('created_at', { ascending: false })
            .limit(10),
        ])

        if (cancelled) return

        if (analyticsRes.error) throw analyticsRes.error
        if (instancesRes.error) throw instancesRes.error

        setAnalytics(analyticsRes.data ?? null)
        setInstances(instancesRes.data ?? [])
      } catch (err) {
        if (!cancelled) setError(err.message ?? '載入失敗')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [template?.id, template?.name])

  // ── Derived stats ──
  const deployCount = analytics?.deploy_count ?? usageCount ?? instances.length

  const completionRate = analytics?.completion_rate != null
    ? `${Number(analytics.completion_rate).toFixed(1)}%`
    : instances.length > 0
      ? `${((instances.filter(i => i.status === '已完成').length / instances.length) * 100).toFixed(1)}%`
      : '—'

  let avgDays = '—'
  if (analytics?.avg_completion_days != null) {
    avgDays = `${Number(analytics.avg_completion_days).toFixed(1)} 天`
  }

  const inProgressCount = instances.filter(i => i.status !== '已完成').length

  function formatDate(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  }

  return (
    /* overlay */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1001,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      {/* modal panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 600,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
              {template.category ?? '流程範本'}
            </div>
            <h2 style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {template.name}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              使用分析
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="關閉"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 8,
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--glass-light)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'none'
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}>

          {loading && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>
              載入中…
            </div>
          )}

          {error && (
            <div style={{
              background: 'var(--accent-red-dim)',
              color: 'var(--accent-red)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* ── Stats row (4 cards) ── */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <StatCard label="部署次數" value={deployCount} />
                <StatCard label="完成率" value={completionRate} />
                <StatCard label="平均完成天數" value={avgDays} />
                <StatCard label="進行中" value={inProgressCount} />
              </div>

              {/* ── Recent deployments table ── */}
              <div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 10,
                  letterSpacing: '0.02em',
                }}>
                  最近部署
                </div>

                {instances.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: 13,
                    padding: '24px 0',
                    background: 'var(--glass-light)',
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                  }}>
                    尚無部署紀錄
                  </div>
                ) : (
                  <div style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10,
                    overflow: 'hidden',
                  }}>
                    {/* table header */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 90px 100px',
                      padding: '8px 14px',
                      background: 'var(--glass-light)',
                      borderBottom: '1px solid var(--border-subtle)',
                      gap: 8,
                    }}>
                      {['店家', '發起人', '狀態', '建立日期'].map(h => (
                        <span key={h} style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                        }}>
                          {h}
                        </span>
                      ))}
                    </div>

                    {/* table rows */}
                    {instances.map((inst, idx) => {
                      const badge = getInstanceStatusBadge(inst)
                      return (
                        <div
                          key={inst.id ?? idx}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr 90px 100px',
                            padding: '9px 14px',
                            gap: 8,
                            alignItems: 'center',
                            borderBottom: idx < instances.length - 1
                              ? '1px solid var(--border-subtle)'
                              : 'none',
                            background: idx % 2 === 1 ? 'var(--glass-light)' : 'transparent',
                          }}
                        >
                          <span style={{
                            fontSize: 13,
                            color: 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {inst.store ?? '—'}
                          </span>
                          <span style={{
                            fontSize: 13,
                            color: 'var(--text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {inst.started_by ?? '—'}
                          </span>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            background: badge.bg,
                            color: badge.color,
                            whiteSpace: 'nowrap',
                          }}>
                            {badge.label}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {formatDate(inst.created_at)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── Coming-soon placeholder ── */}
              <div style={{
                background: 'var(--glass-light)',
                border: '1px dashed var(--border-subtle)',
                borderRadius: 10,
                padding: '20px 18px',
                textAlign: 'center',
              }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                }}>
                  詳細步驟瓶頸分析
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  即將推出 — 將顯示各步驟平均等待時間與卡關熱點
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
