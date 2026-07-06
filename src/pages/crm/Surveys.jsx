import { useState, useEffect, useCallback } from 'react'
import { Plus, BarChart2, Pencil, Trash2, PlayCircle, ChevronDown, Send } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { getSurveys, deleteSurvey, updateSurvey } from '../../lib/db'
import { dispatchDueLineSurveyInvitations } from '../../lib/comms/lineSender'
import { toast } from '../../lib/toast'
import { logger } from '../../lib/logger'
import SurveyBuilderModal from './components/SurveyBuilderModal'
import SurveyResultsPanel from './components/SurveyResultsPanel'

const STATUS_META = {
  draft:  { label: '草稿',  color: 'var(--text-muted)',    bg: 'var(--bg-tertiary)' },
  active: { label: '啟用中', color: 'var(--accent-green)',  bg: 'var(--accent-green-dim)' },
  paused: { label: '暫停',  color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
  closed: { label: '已結束', color: 'var(--text-muted)',    bg: 'var(--bg-tertiary)' },
}

const TRIGGER_LABELS = { post_purchase: '購後觸發', manual: '手動發送' }
const CHANNEL_LABELS = { line: 'LINE', sms: 'SMS', email: 'Email' }

export default function Surveys() {
  const { currentOrg } = useTenant()
  const [surveys, setSurveys] = useState([])
  const [loading, setLoading] = useState(true)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editing, setEditing]         = useState(null)
  const [viewing, setViewing]         = useState(null)
  const [statusMenuId, setStatusMenuId] = useState(null)

  const load = useCallback(async () => {
    if (!currentOrg?.id) return
    setLoading(true)
    const { data } = await getSurveys(currentOrg.id)
    setSurveys(data || [])
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { load() }, [load])

  async function handleDelete(id) {
    if (!confirm('確定刪除此問卷？相關邀請與回覆也會一併刪除。')) return
    await deleteSurvey(id)
    load()
  }

  async function handleStatusChange(id, newStatus) {
    setStatusMenuId(null)
    await updateSurvey(id, { status: newStatus })
    load()
  }

  function openCreate() { setEditing(null); setBuilderOpen(true) }
  function openEdit(s)  { setEditing(s);    setBuilderOpen(true) }

  const [dispatchingId, setDispatchingId] = useState(null)
  // 發送此問卷「已到期」的 LINE 邀請（購後觸發由 crmHandlers 排入 pending，
  // 到 send_after 時間後由此發送；未綁定 LINE 的會員維持 pending）
  async function handleDispatchLine(s) {
    if (!confirm(`發送「${s.name}」的到期 LINE 邀請？`)) return
    setDispatchingId(s.id)
    try {
      const r = await dispatchDueLineSurveyInvitations(s.id)
      if (r.due === 0) toast.info('目前沒有到期待發送的邀請')
      else toast.success(
        `LINE 已發送 ${r.sent} 筆` +
        (r.skipped > 0 ? `，${r.skipped} 筆未綁定略過` : '') +
        (r.failed > 0 ? `，${r.failed} 筆失敗` : '')
      )
    } catch (err) {
      logger.error('[Surveys] LINE 邀請發送失敗', { surveyId: s.id, error: err.message })
      toast.error(`發送失敗：${err.message}`)
    } finally {
      setDispatchingId(null)
    }
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.25rem', margin: 0 }}>問卷管理</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0.25rem 0 0' }}>建立購後問卷並透過 LINE 發送給會員</p>
        </div>
        <button
          onClick={openCreate}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'var(--accent-cyan)', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
        >
          <Plus size={16} /> 新增問卷
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem', fontSize: '0.9rem' }}>載入中…</div>
      ) : surveys.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem', fontSize: '0.9rem' }}>尚無問卷，點擊「新增問卷」開始建立</div>
      ) : (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>
                {['問卷名稱', '觸發方式', '發送管道', '狀態', '建立日期', '操作'].map(h => (
                  <th key={h} style={{ padding: '0.625rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.78rem' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {surveys.map(s => {
                const sm = STATUS_META[s.status] || STATUS_META.draft
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.name}</div>
                      {s.description && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.15rem' }}>{s.description}</div>}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
                      {TRIGGER_LABELS[s.trigger_type] || s.trigger_type}
                      {s.trigger_type === 'post_purchase' && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>購後 {s.trigger_delay_hours}h 發送</div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
                      {CHANNEL_LABELS[s.send_channel] || s.send_channel}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <button
                          onClick={() => setStatusMenuId(statusMenuId === s.id ? null : s.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: sm.bg, color: sm.color, border: 'none', borderRadius: '4px', padding: '0.2rem 0.55rem', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
                        >
                          {sm.label} <ChevronDown size={11} />
                        </button>
                        {statusMenuId === s.id && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '6px', minWidth: '100px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', marginTop: '2px' }}>
                            {Object.entries(STATUS_META).map(([k, v]) => (
                              <button
                                key={k}
                                onClick={() => handleStatusChange(s.id, k)}
                                style={{ display: 'block', width: '100%', padding: '0.4rem 0.75rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: v.color, fontSize: '0.8rem' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                              >
                                {v.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {s.created_at?.slice(0, 10) || '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <ActionBtn icon={<BarChart2 size={14} />} title="查看結果" onClick={() => setViewing(s)} color="var(--accent-blue)" />
                        {s.send_channel === 'line' && (
                          <ActionBtn
                            icon={<Send size={14} />}
                            title={dispatchingId === s.id ? '發送中…' : '發送到期 LINE 邀請'}
                            onClick={() => dispatchingId || handleDispatchLine(s)}
                            color="var(--accent-cyan)"
                          />
                        )}
                        <ActionBtn icon={<PlayCircle size={14} />} title="試跑 Pilot" onClick={() => window.location.href = `/crm/pilots?survey=${s.id}`} color="var(--accent-purple)" />
                        <ActionBtn icon={<Pencil size={14} />}    title="編輯"     onClick={() => openEdit(s)}  color="var(--text-muted)" />
                        <ActionBtn icon={<Trash2 size={14} />}    title="刪除"     onClick={() => handleDelete(s.id)} color="var(--accent-red)" />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {builderOpen && (
        <SurveyBuilderModal
          survey={editing}
          orgId={currentOrg?.id}
          onClose={() => setBuilderOpen(false)}
          onSaved={() => { setBuilderOpen(false); load() }}
        />
      )}

      {viewing && (
        <SurveyResultsPanel
          survey={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}

function ActionBtn({ icon, title, onClick, color }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.3rem', cursor: 'pointer', color }}
    >
      {icon}
    </button>
  )
}
