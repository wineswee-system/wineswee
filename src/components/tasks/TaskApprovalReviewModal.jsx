import { useEffect, useState } from 'react'
import { X, FileText, Paperclip, MessageSquare, GitBranch, FolderKanban, ListChecks } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { updateTaskConfirmation } from '../../lib/db'
import Badge from '../ui/Badge'

// task_confirmations.status → 顯示
const CONF_STATUS = {
  pending:     { label: '待審批', status: 'warning' },
  approved:    { label: '已核准', status: 'success' },
  rejected:    { label: '已退回', status: 'error' },
  waiting:     { label: '等待中', color: 'gray' },
  auto_closed: { label: '已結束', color: 'gray' },
}
const confBadge = (s) => {
  const c = CONF_STATUS[s] || { label: s || '—', color: 'gray' }
  return <Badge size="sm" status={c.status} color={c.color}>{c.label}</Badge>
}

const attUrl = (a) =>
  (a.storage_path
    ? supabase.storage.from('task-attachments').getPublicUrl(a.storage_path).data?.publicUrl
    : a.file_url) || a.file_url

const card = {
  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
  borderRadius: 10, padding: '14px 16px', marginBottom: 12,
}
const secLabel = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800,
  color: 'var(--accent-cyan)', marginBottom: 10,
}
const kv = { display: 'grid', gridTemplateColumns: '96px 1fr', gap: '6px 12px', fontSize: 13 }
const kLabel = { color: 'var(--text-muted)' }
const kVal = { color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }

function Row({ label, children }) {
  return (<><div style={kLabel}>{label}</div><div style={kVal}>{children ?? '—'}</div></>)
}

/**
 * 簽核者用的「唯讀」任務簽核視窗:一次看到 ①任務詳情 ②所屬專案 ③流程/簽核,底部可通過/退回。
 * 完全不依賴「任務管理頁」開放。
 */
export default function TaskApprovalReviewModal({ taskId, confId, onClose, onDone }) {
  const [loading, setLoading] = useState(true)
  const [task, setTask] = useState(null)
  const [project, setProject] = useState(null)
  const [projectTasks, setProjectTasks] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [checklist, setChecklist] = useState([])
  const [attachments, setAttachments] = useState([])
  const [comments, setComments] = useState([])
  const [confs, setConfs] = useState([])
  const [wf, setWf] = useState([])
  const [busy, setBusy] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const { data: t } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle()
      if (!alive) return
      setTask(t)
      const jobs = []
      const push = (p, set) => jobs.push(p.then(r => { if (alive) set(r.data || (Array.isArray(r.data) ? [] : null)) }).catch(() => {}))
      if (t?.project_id) {
        push(supabase.from('projects').select('*').eq('id', t.project_id).maybeSingle(), setProject)
        push(supabase.from('tasks').select('id,title,status').eq('project_id', t.project_id).is('parent_task_id', null).order('id'), setProjectTasks)
      }
      push(supabase.from('tasks').select('id,title,status').eq('parent_task_id', taskId).order('id'), setSubtasks)
      push(supabase.from('task_checklist_items').select('*').eq('task_id', taskId).order('sort_order'), setChecklist)
      push(supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at'), setAttachments)
      push(supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at'), setComments)
      push(supabase.from('task_confirmations').select('*').eq('task_id', taskId).order('step_order').order('id'), setConfs)
      push(supabase.from('workflow_instances').select('id,template_name,status,started_at').eq('triggered_by_task_id', taskId).order('started_at', { ascending: false }), setWf)
      await Promise.allSettled(jobs)
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [taskId])

  const thisConf = confs.find(c => c.id === confId)
  const canAct = !thisConf || thisConf.status === 'pending'

  const doAction = async (status) => {
    if (status === 'rejected' && !reason.trim()) { setShowReject(true); return }
    setBusy(true)
    const { data, error } = await updateTaskConfirmation(confId, {
      status,
      notes: status === 'rejected' ? reason.trim() : null,
      responded_at: new Date().toISOString(),
    })
    setBusy(false)
    if (error || !data) {
      alert((status === 'approved' ? '通過' : '退回') + '失敗:' + (error?.message || '未知,請重試'))
      return
    }
    onDone?.(status)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
          borderRadius: 14, width: 'min(720px, 100%)', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loading ? '載入中…' : (task?.title || `任務 #${taskId}`)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              任務 #{taskId}{task?.task_code ? ` · ${task.task_code}` : ''} · 簽核
            </div>
          </div>
          <button onClick={onClose} aria-label="關閉" style={{
            display: 'flex', padding: 6, borderRadius: 8, border: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer',
          }}><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 24, textAlign: 'center' }}>載入內容中…</div>
          ) : (
            <>
              {/* ① 任務詳情 */}
              <div style={card}>
                <div style={secLabel}><FileText size={15} /> 任務詳情</div>
                <div style={kv}>
                  <Row label="負責人">{task?.assignee || '—'}</Row>
                  <Row label="狀態">{task?.status || '—'}</Row>
                  <Row label="優先度">{task?.priority || '—'}</Row>
                  <Row label="到期日">{task?.due_date || '—'}</Row>
                  <Row label="門市">{task?.store || '—'}</Row>
                  <Row label="說明">{task?.description || task?.notes || '—'}</Row>
                </div>

                {subtasks.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>子任務</div>
                    {subtasks.map(s => (
                      <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
                        <span style={{ flex: 1, color: 'var(--text-primary)' }}>{s.title}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.status}</span>
                      </div>
                    ))}
                  </div>
                )}

                {checklist.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      <ListChecks size={13} /> 檢查清單({checklist.filter(i => i.checked).length}/{checklist.length})
                    </div>
                    {checklist.map(i => (
                      <div key={i.id} style={{ fontSize: 13, padding: '2px 0', color: i.checked ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: i.checked ? 'line-through' : 'none' }}>
                        {i.checked ? '☑' : '☐'} {i.title}
                      </div>
                    ))}
                  </div>
                )}

                {attachments.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      <Paperclip size={13} /> 附件({attachments.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {attachments.map(a => (
                        <a key={a.id} href={attUrl(a)} target="_blank" rel="noreferrer noopener"
                          style={{ fontSize: 12, color: 'var(--accent-blue)', background: 'var(--accent-blue-dim)', padding: '4px 10px', borderRadius: 6, textDecoration: 'none' }}>
                          {a.file_name || '附件'}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ② 所屬專案 */}
              {project && (
                <div style={card}>
                  <div style={secLabel}><FolderKanban size={15} /> 所屬專案</div>
                  <div style={kv}>
                    <Row label="專案">{project.name}</Row>
                    <Row label="狀態">{project.status || '—'}</Row>
                    <Row label="進度">{project.progress != null ? `${project.progress}%` : '—'}</Row>
                    <Row label="說明">{project.description || '—'}</Row>
                  </div>
                  {projectTasks.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        專案任務({projectTasks.filter(t => t.status === '已完成').length}/{projectTasks.length} 完成)
                      </div>
                      {projectTasks.map(pt => (
                        <div key={pt.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
                          <span style={{ flex: 1, color: pt.id === taskId ? 'var(--accent-cyan)' : 'var(--text-primary)', fontWeight: pt.id === taskId ? 700 : 400 }}>
                            {pt.title}{pt.id === taskId ? '（本任務）' : ''}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pt.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ③ 流程 / 簽核 */}
              <div style={card}>
                <div style={secLabel}><GitBranch size={15} /> 流程 / 簽核</div>
                {confs.length === 0 && wf.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</div>
                )}
                {confs.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0', borderBottom: i < confs.length - 1 ? '1px dashed var(--border-subtle)' : 'none' }}>
                    <span style={{ width: 52, color: 'var(--text-muted)', fontSize: 12 }}>第 {(c.step_order ?? 0) + 1} 關</span>
                    <span style={{ flex: 1, color: 'var(--text-primary)' }}>
                      {c.approver || '—'}{c.id === confId ? '（你）' : ''}
                    </span>
                    {confBadge(c.status)}
                  </div>
                ))}
                {wf.map(w => (
                  <div key={w.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
                    <span style={{ flex: 1, color: 'var(--text-secondary)' }}>工作流:{w.template_name || `#${w.id}`}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{w.status}</span>
                  </div>
                ))}
              </div>

              {/* 留言 */}
              {comments.length > 0 && (
                <div style={card}>
                  <div style={secLabel}><MessageSquare size={15} /> 留言({comments.length})</div>
                  {comments.map(cm => (
                    <div key={cm.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px dashed var(--border-subtle)' }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{cm.author || '—'}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{String(cm.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{cm.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部:通過 / 退回 */}
        {!loading && canAct && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', padding: 14, background: 'var(--bg-card)' }}>
            {showReject && (
              <textarea
                value={reason} onChange={e => setReason(e.target.value)}
                placeholder="請輸入退回原因…" rows={2}
                style={{
                  width: '100%', marginBottom: 10, padding: '8px 10px', fontSize: 13, resize: 'vertical',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)', borderRadius: 8,
                }}
              />
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                disabled={busy}
                onClick={() => (showReject ? doAction('rejected') : setShowReject(true))}
                style={{
                  padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
                  background: 'var(--accent-red-dim)', color: 'var(--accent-red)', border: '1px solid var(--accent-red)',
                  opacity: busy ? 0.6 : 1,
                }}
              >退回</button>
              <button
                disabled={busy}
                onClick={() => doAction('approved')}
                style={{
                  padding: '9px 22px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
                  background: 'var(--accent-cyan)', color: '#fff', border: '1px solid var(--accent-cyan)',
                  opacity: busy ? 0.6 : 1,
                }}
              >{busy ? '處理中…' : '通過'}</button>
            </div>
          </div>
        )}
        {!loading && !canAct && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', padding: 14, background: 'var(--bg-card)', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            此關已{CONF_STATUS[thisConf?.status]?.label || '處理'},無需再簽
          </div>
        )}
      </div>
    </div>
  )
}
