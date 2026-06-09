import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Workflow, ListChecks, CheckSquare, TrendingUp, Clock, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp, Check, X, Pencil, Save } from 'lucide-react'
import { getWorkflows, getWorkflowInstances, getTasks, getChecklists, updateTask, getEmployees } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { useRealtimeTable } from '../../lib/hooks/useRealtimeSync'
import { advanceWorkflow } from '../../lib/workflowIntegration'
import { checkAndNotifyDailyTasks } from '../../lib/taskDueChecker'
import LoadingSpinner from '../../components/LoadingSpinner'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const STATUS_CONFIG = {
  '進行中': { color: 'var(--accent-cyan)', icon: Clock, badge: 'badge-info' },
  '已完成': { color: 'var(--accent-green)', icon: CheckCircle, badge: 'badge-success' },
  '已退回': { color: 'var(--accent-red)', icon: XCircle, badge: 'badge-danger' },
}

export default function ProcessOverview() {
  const [workflows, setWorkflows] = useState([])
  const [instances, setInstances] = useState([])
  const [steps, setSteps] = useState([])
  const [tasks, setTasks] = useState([])
  const [checklists, setChecklists] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)

  useEffect(() => {
    Promise.all([
      getWorkflows(),
      getWorkflowInstances(),
      supabase.from('tasks').select('*').not('workflow_instance_id', 'is', null).order('step_order'),
      getTasks(),
      getChecklists(),
      getEmployees(),
    ]).then(([w, inst, st, t, c, emp]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setSteps(st.data || [])
      setTasks(t.data || [])
      setChecklists(c.data || [])
      setEmployees(emp.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
      // 每次 session 自動檢查今日到期及已逾期任務，依負責人發一則輪播提醒
      checkAndNotifyDailyTasks().catch(err => console.warn('[Overview] Task daily check failed:', err))
    })
  }, [])

  // Live-sync: tasks table drives both standalone tasks and workflow steps
  useRealtimeTable('tasks', {
    onInsert: (row) => {
      if (row.workflow_instance_id) setSteps((p) => [row, ...p.filter((t) => t.id !== row.id)])
      else setTasks((p) => [row, ...p.filter((t) => t.id !== row.id)])
    },
    onUpdate: (row) => {
      setSteps((p) => p.map((t) => (t.id === row.id ? row : t)))
      setTasks((p) => p.map((t) => (t.id === row.id ? row : t)))
    },
    onDelete: (row) => {
      setSteps((p) => p.filter((t) => t.id !== row.id))
      setTasks((p) => p.filter((t) => t.id !== row.id))
    },
  })
  useRealtimeTable('workflow_instances', {
    onInsert: (row) => setInstances((p) => [...p.filter((i) => i.id !== row.id), row]),
    onUpdate: (row) => setInstances((p) => p.map((i) => (i.id === row.id ? row : i))),
    onDelete: (row) => setInstances((p) => p.filter((i) => i.id !== row.id)),
  })

  // ── Reject modal state ──
  const [rejectPending, setRejectPending] = useState(null) // { stepId, onDone? }
  const [rejectReason, setRejectReason] = useState('')

  const reload = () => {
    setLoading(true)
    Promise.all([
      getWorkflows(), getWorkflowInstances(),
      supabase.from('tasks').select('*').not('workflow_instance_id', 'is', null).order('step_order'),
      getTasks(), getChecklists(),
    ]).then(([w, inst, st, t, c]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setSteps(st.data || [])
      setTasks(t.data || [])
      setChecklists(c.data || [])
      // employees are stable session-wide; loaded once on mount, not on every approval action
    }).finally(() => setLoading(false))
  }

  const handleApprove = async (stepId) => {
    setActionLoading(true)
    await advanceWorkflow(stepId, '主管', '核准')
    reload()
    setActionLoading(false)
  }

  // Opens the reject reason modal; onDone is called after the reject succeeds.
  const handleReject = (stepId, onDone) => {
    setRejectReason('')
    setRejectPending({ stepId, onDone })
  }

  const doReject = async () => {
    if (!rejectReason.trim()) return
    setActionLoading(true)
    try {
      await advanceWorkflow(rejectPending.stepId, '主管', '退回', rejectReason.trim())
      reload()
      rejectPending.onDone?.()
      setRejectPending(null)
      setRejectReason('')
    } catch (err) {
      toast.error('退回失敗：' + (err?.message || '未知錯誤'))
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const activeInstances = instances.filter(i => i.status === '進行中')
  const completedInstances = instances.filter(i => i.status === '已完成')
  const rejectedInstances = instances.filter(i => i.status === '已退回')
  const pendingSteps = steps.filter(s => s.status === '待簽核')
  const completedTasks = tasks.filter(t => t.status === '已完成').length
  const checklistProgress = checklists.reduce((s, c) => s + (c.completed || 0), 0)
  const checklistTotal = checklists.reduce((s, c) => s + (c.items || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">👁️</span> 流程總覽</h2>
        <p>所有簽核流程、任務與查核清單的即時狀態</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-icon"><Workflow size={16} /></div>
          <div className="stat-card-label">進行中簽核</div>
          <div className="stat-card-value">{activeInstances.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-icon"><AlertCircle size={16} /></div>
          <div className="stat-card-label">待簽核步驟</div>
          <div className="stat-card-value">{pendingSteps.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-icon"><CheckCircle size={16} /></div>
          <div className="stat-card-label">已完成簽核</div>
          <div className="stat-card-value">{completedInstances.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-icon"><TrendingUp size={16} /></div>
          <div className="stat-card-label">任務完成率</div>
          <div className="stat-card-value">{tasks.length ? Math.round(completedTasks / tasks.length * 100) : 0}%</div>
        </div>
      </div>

      {/* 簽核流程實例（從 HR 產生的） */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 簽核流程</div>
          <span className="badge badge-neutral">{instances.length} 筆</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>流程名稱</th><th>任務統計</th><th>申請人</th><th>審核人</th><th>開始時間</th><th>狀態</th><th>進度</th></tr></thead>
            <tbody>
              {instances.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                  尚無簽核流程 — 當員工提交請假/加班/報帳/出差/採購時會自動產生
                </td></tr>
              ) : instances.map(inst => {
                const instSteps = steps.filter(s => s.workflow_instance_id === inst.id)
                const completed = instSteps.filter(s => s.status === '已完成').length
                const inProgress = instSteps.filter(s => s.status === '進行中').length
                const blocked = instSteps.filter(s => s.status === '已退回' || s.status === '已擱置').length
                const notStarted = instSteps.filter(s => s.status === '未開始' || s.status === '待簽核').length
                const total = instSteps.length
                const cfg = STATUS_CONFIG[inst.status] || STATUS_CONFIG['進行中']
                const isExpanded = expandedId === inst.id
                const currentStep = instSteps.find(s => s.status === '待簽核')
                return (
                  <React.Fragment key={inst.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : inst.id)}>
                      <td style={{ fontWeight: 600 }}>
                        {isExpanded ? <ChevronUp size={14} style={{ marginRight: 4 }} /> : <ChevronDown size={14} style={{ marginRight: 4 }} />}
                        {inst.template_name}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <span title="進行中" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>
                            <Clock size={10} />{inProgress}
                          </span>
                          <span title="已完成" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>
                            <CheckCircle size={10} />{completed}
                          </span>
                          <span title="已擱置" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}>
                            <XCircle size={10} />{blocked}
                          </span>
                          <span title="未開始" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' }}>
                            <AlertCircle size={10} />{notStarted}
                          </span>
                        </div>
                      </td>
                      <td>{inst.started_by || '-'}</td>
                      <td>{currentStep?.assignee || inst.assignee || '-'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.started_at?.slice(0, 10)}</td>
                      <td><span className={`badge ${cfg.badge}`}><span className="badge-dot"></span>{inst.status}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--border)' }}>
                            <div style={{ height: '100%', borderRadius: 3, width: `${total ? (completed / total * 100) : 0}%`, background: cfg.color, transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{completed}/{total}</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} style={{ padding: '0 16px 16px', background: 'var(--glass-light)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
                            {instSteps.map(s => (
                              <div key={s.id}
                                onClick={e => { e.stopPropagation(); setSelectedTask({ ...s, _instance: inst }) }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                                  borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                                  cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-cyan)' }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}>
                                <div style={{
                                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: s.status === '已完成' ? 'var(--accent-green)' : s.status === '已退回' ? 'var(--accent-red)' : 'var(--border-medium)',
                                  color: '#fff', fontSize: 12, fontWeight: 700,
                                }}>{s.step_order}</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    {s.assignee || '未指派'} · {s.role || '-'}
                                    {s.confirmed_by && ` · ${s.confirmed_by} ${s.confirmed_at?.slice(0, 10) || ''}`}
                                    {s.notes && ` · ${s.notes}`}
                                  </div>
                                </div>
                                <span className={`badge ${s.status === '已完成' ? 'badge-success' : s.status === '已退回' ? 'badge-danger' : 'badge-warning'}`}>
                                  <span className="badge-dot"></span>{s.status}
                                </span>
                                {s.status === '待簽核' && inst.status === '進行中' && (
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <button className="btn btn-sm btn-primary" disabled={actionLoading}
                                      onClick={e => { e.stopPropagation(); handleApprove(s.id) }}>
                                      <Check size={12} /> 核准
                                    </button>
                                    <button className="btn btn-sm" style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}
                                      disabled={actionLoading}
                                      onClick={e => { e.stopPropagation(); handleReject(s.id) }}>
                                      <X size={12} /> 退回
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        {/* 流程模板 */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🔄</span> 流程模板</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>流程名稱</th><th>步驟數</th><th>狀態</th></tr></thead>
              <tbody>
                {workflows.length === 0 ? (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無流程模板</td></tr>
                ) : workflows.map(w => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td>{w.steps}</td>
                    <td><span className={`badge ${w.status === '已啟用' ? 'badge-success' : 'badge-warning'}`}><span className="badge-dot"></span>{w.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 查核清單 */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">✅</span> 查核清單進度</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {checklists.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>尚無查核清單</div>
            ) : checklists.map(c => {
              const pct = c.items ? Math.round((c.completed || 0) / c.items * 100) : 0
              return (
                <div key={c.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.completed || 0}/{c.items || 0}</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--accent-green)' : pct > 50 ? 'var(--accent-cyan)' : 'var(--accent-orange)' }}></div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{c.assignee} · {c.category}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {selectedTask && (
        <TaskDetailOverlay
          task={selectedTask}
          employees={employees}
          onClose={() => setSelectedTask(null)}
          onApprove={async (id) => { await handleApprove(id); setSelectedTask(null) }}
          onReject={(id) => handleReject(id, () => setSelectedTask(null))}
          onSaved={() => { setSelectedTask(null); reload() }}
          actionLoading={actionLoading}
        />
      )}

      {/* ── Reject reason modal (replaces window.prompt) ── */}
      {rejectPending && createPortal(
        <div
          onClick={() => { if (!actionLoading) { setRejectPending(null); setRejectReason('') } }}
          style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'var(--bg-modal-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 14, padding: 28, width: 440, maxWidth: '94vw' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>退回流程</h3>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>退回原因 *</label>
            <textarea
              className="form-input"
              autoFocus
              rows={4}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              placeholder="請說明退回原因..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) doReject() }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" disabled={actionLoading}
                onClick={() => { setRejectPending(null); setRejectReason('') }}>取消</button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}
                disabled={actionLoading || !rejectReason.trim()}
                onClick={doReject}
              >
                <X size={13} /> {actionLoading ? '處理中...' : '確認退回'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

const STATUS_OPTIONS = ['待簽核', '進行中', '已完成', '已退回', '已擱置']
const PRIORITY_OPTIONS = ['低', '中', '高']

function TaskDetailOverlay({ task, employees = [], onClose, onApprove, onReject, onSaved, actionLoading }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [form, setForm] = useState({
    title: task.title || '',
    status: task.status || '待簽核',
    assignee: task.assignee || '',
    role: task.role || '',
    priority: task.priority || '中',
    due_date: task.due_date?.slice(0, 10) || '',
    description: task.description || '',
    notes: task.notes || '',
  })

  const setFD = (updates) => { setForm(f => ({ ...f, ...updates })); setIsDirty(true) }

  const handleClose = async () => {
    if (editing && isDirty && !(await confirm({ message: '有未儲存的變更，確定要離開嗎？' }))) return
    onClose()
  }

  const handleCancel = () => {
    setEditing(false)
    setIsDirty(false)
    setForm({
      title: task.title || '',
      status: task.status || '待簽核',
      assignee: task.assignee || '',
      role: task.role || '',
      priority: task.priority || '中',
      due_date: task.due_date?.slice(0, 10) || '',
      description: task.description || '',
      notes: task.notes || '',
    })
  }

  useEffect(() => {
    const onKey = async (e) => {
      if (e.key === 'Escape') {
        if (editing && isDirty && !(await confirm({ message: '有未儲存的變更，確定要離開嗎？' }))) return
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [editing, isDirty, onClose])

  const inst = task._instance || {}
  const statusBadge = task.status === '已完成' ? 'badge-success' : task.status === '已退回' ? 'badge-danger' : task.status === '進行中' ? 'badge-info' : 'badge-warning'
  const canAct = task.status === '待簽核' && inst.status === '進行中'

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        due_date: form.due_date || null,
        assignee_id: employees.find(e => e.name === form.assignee)?.id ?? null,
        completed_at: form.status === '已完成' ? (task.completed_at || new Date().toISOString()) : null,
      }
      const { error } = await updateTask(task.id, payload)
      if (error) throw error
      toast.success('已儲存')
      onSaved?.()
    } catch (err) {
      console.error('[Overview] Failed to update task:', err)
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
      setSaving(false)
    }
  }

  const Row = ({ label, value }) => (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ width: 110, fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{value || <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>
    </div>
  )

  const Field = ({ label, children }) => (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
      <label style={{ width: 110, fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )

  return createPortal(
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)',
          maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: task.status === '已完成' ? 'var(--accent-green)' : task.status === '已退回' ? 'var(--accent-red)' : 'var(--border-medium)',
              color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0,
            }}>{task.step_order}</div>
            {editing ? (
              <input value={form.title} onChange={e => setFD({ title: e.target.value })}
                className="form-input" style={{ fontSize: 15, fontWeight: 600, flex: 1 }} />
            ) : (
              <h3 style={{ margin: 0, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</h3>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {!editing && (
              <button onClick={() => setEditing(true)} className="btn btn-sm" style={{ padding: '6px 10px' }} aria-label="編輯">
                <Pencil size={14} /> 編輯
              </button>
            )}
            <button onClick={handleClose} className="btn btn-sm" style={{ padding: 6 }} aria-label="關閉"><X size={14} /></button>
          </div>
        </div>

        <div style={{ padding: '12px 20px' }}>
          {editing ? (
            <>
              <Field label="狀態">
                <select value={form.status} onChange={e => setFD({ status: e.target.value })} className="form-input" style={{ width: '100%' }}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Row label="所屬流程" value={inst.template_name} />
              <Row label="申請人" value={inst.started_by} />
              <Field label="負責人">
                <SearchableSelect
                  value={form.assignee}
                  onChange={(v) => setFD({ assignee: v || '' })}
                  options={empOptions(employees, { keyBy: 'name' })}
                  placeholder="搜尋員工姓名/職稱..."
                />
              </Field>
              <Field label="角色">
                <input value={form.role} onChange={e => setFD({ role: e.target.value })} className="form-input" style={{ width: '100%' }} />
              </Field>
              <Field label="優先順序">
                <select value={form.priority} onChange={e => setFD({ priority: e.target.value })} className="form-input" style={{ width: '100%' }}>
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="到期日">
                <input type="date" value={form.due_date} onChange={e => setFD({ due_date: e.target.value })} className="form-input" style={{ width: '100%' }} />
              </Field>
              <Field label="描述">
                <textarea value={form.description} onChange={e => setFD({ description: e.target.value })} rows={3} className="form-input" style={{ width: '100%', resize: 'vertical' }} />
              </Field>
              <Field label="備註">
                <textarea value={form.notes} onChange={e => setFD({ notes: e.target.value })} rows={2} className="form-input" style={{ width: '100%', resize: 'vertical' }} />
              </Field>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <span className={`badge ${statusBadge}`}><span className="badge-dot"></span>{task.status}</span>
              </div>
              <Row label="所屬流程" value={inst.template_name} />
              <Row label="申請人" value={inst.started_by} />
              <Row label="負責人" value={task.assignee} />
              <Row label="角色" value={task.role} />
              <Row label="優先順序" value={task.priority} />
              <Row label="到期日" value={task.due_date?.slice(0, 10)} />
              <Row label="開始時間" value={task.created_at?.replace('T', ' ').slice(0, 16)} />
              <Row label="確認人" value={task.confirmed_by} />
              <Row label="確認時間" value={task.confirmed_at?.replace('T', ' ').slice(0, 16)} />
              <Row label="描述" value={task.description} />
              <Row label="備註" value={task.notes} />
            </>
          )}
        </div>

        {editing ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border-subtle)' }}>
            <button className="btn btn-sm" disabled={saving} onClick={handleCancel}>取消</button>
            <button className="btn btn-sm btn-primary" disabled={saving} onClick={handleSave}>
              <Save size={12} /> {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        ) : canAct && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border-subtle)' }}>
            <button className="btn btn-sm" style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}
              disabled={actionLoading} onClick={() => onReject(task.id)}>
              <X size={12} /> 退回
            </button>
            <button className="btn btn-sm btn-primary" disabled={actionLoading} onClick={() => onApprove(task.id)}>
              <Check size={12} /> 核准
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
