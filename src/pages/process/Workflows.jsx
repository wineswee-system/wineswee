import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, CheckCircle, Clock,
  AlertCircle, X, Users, User, FileText, Lock, Play, Pause, BarChart3,
  ClipboardList, Square, RotateCcw, Ban, StickyNote
} from 'lucide-react'
import {
  getWorkflows, createWorkflow, updateWorkflow,
  getWorkflowInstances, createWorkflowInstance, updateWorkflowInstance, deleteWorkflowInstance,
  getWorkflowSteps, createWorkflowStep, updateWorkflowStep, deleteWorkflowStep, createWorkflowStepsBatch
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import TaskDetailPanel from '../../components/TaskDetailPanel'

const CATEGORIES = ['HR', '營運', '採購', '展店', '倉管', '財務', '行銷']
const STATUS_LIST = ['待處理', '進行中', '已完成', '已擱置']

const STATUS_CONFIG = {
  '待處理': { color: 'var(--text-muted)', bg: 'var(--glass-light)', icon: Square, label: '待處理' },
  '進行中': { color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)', icon: RotateCcw, label: '進行中' },
  '已完成': { color: 'var(--accent-green)', bg: 'var(--accent-green-dim)', icon: CheckCircle, label: '已完成' },
  '已擱置': { color: 'var(--accent-red)', bg: 'rgba(239,68,68,0.1)', icon: Ban, label: '已擱置' },
}

export default function Workflows() {
  const [tab, setTab] = useState('instances')
  const [workflows, setWorkflows] = useState([])
  const [instances, setInstances] = useState([])
  const [steps, setSteps] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Detail view state
  const [selectedInstance, setSelectedInstance] = useState(null)
  const [selectedStep, setSelectedStep] = useState(null)
  const [checklists, setChecklists] = useState([])

  // Modals
  const [showDefModal, setShowDefModal] = useState(false)
  const [defForm, setDefForm] = useState({ name: '', category: CATEGORIES[0], steps: '', description: '' })
  const [showAddTaskModal, setShowAddTaskModal] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00' })
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [notesStep, setNotesStep] = useState(null)
  const [notesText, setNotesText] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ assignee: '', groups: '' })

  useEffect(() => {
    Promise.all([
      getWorkflows(),
      getWorkflowInstances(),
      getWorkflowSteps(),
      supabase.from('employees').select('id, name, dept, position').eq('status', '在職').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('checklists').select('*').order('id'),
    ]).then(([w, inst, st, emp, loc, cl]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setSteps(st.data || [])
      setEmployees(emp.data || [])
      setStores(loc.data || [])
      setChecklists(cl.data || [])
    }).catch(err => {
      console.error('Failed to load:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [])

  // ── Instance helpers ──
  const getInstanceSteps = (instId) => steps.filter(s => s.instance_id === instId).sort((a, b) => a.step_order - b.step_order)

  const getStats = (instId) => {
    const s = getInstanceSteps(instId)
    const total = s.length
    const pending = s.filter(x => x.status === '待處理').length
    const inProgress = s.filter(x => x.status === '進行中').length
    const completed = s.filter(x => x.status === '已完成').length
    const blocked = s.filter(x => x.status === '已擱置').length
    const pct = total > 0 ? Math.round(completed / total * 100) : 0
    return { total, pending, inProgress, completed, blocked, pct }
  }

  // ── Handlers ──
  const handleStatusChange = async (stepId, newStatus) => {
    const completedAt = newStatus === '已完成' ? new Date().toISOString() : null
    const { data } = await updateWorkflowStep(stepId, { status: newStatus, completed_at: completedAt })
    if (data) {
      setSteps(prev => prev.map(s => s.id === stepId ? data : s))
      // Check if all done
      const instId = data.instance_id
      const instSteps = steps.map(s => s.id === stepId ? data : s).filter(s => s.instance_id === instId)
      const allDone = instSteps.length > 0 && instSteps.every(s => s.status === '已完成')
      if (allDone) {
        const { data: inst } = await updateWorkflowInstance(instId, { status: '已完成', completed_at: new Date().toISOString() })
        if (inst) setInstances(prev => prev.map(i => i.id === instId ? inst : i))
      }
    }
  }

  const handleConfirmTask = async (stepId) => {
    const { data } = await updateWorkflowStep(stepId, {
      confirmed: true,
      confirmed_at: new Date().toISOString(),
    })
    if (data) setSteps(prev => prev.map(s => s.id === stepId ? data : s))
  }

  const handleSaveNotes = async () => {
    if (!notesStep) return
    const { data } = await updateWorkflowStep(notesStep.id, { notes: notesText })
    if (data) setSteps(prev => prev.map(s => s.id === notesStep.id ? data : s))
    setShowNotesModal(false)
    setNotesStep(null)
  }

  const handleAddTask = async () => {
    if (!taskForm.title || !selectedInstance) return
    const instSteps = getInstanceSteps(selectedInstance.id)
    const maxOrder = instSteps.length > 0 ? Math.max(...instSteps.map(s => s.step_order)) : 0
    const { data } = await createWorkflowStep({
      instance_id: selectedInstance.id,
      step_order: maxOrder + 1,
      title: taskForm.title,
      assignee: taskForm.assignee,
      store: taskForm.store || selectedInstance.store,
      planned_start: taskForm.planned_start || null,
      due_date: taskForm.due_date || null,
      due_time: taskForm.due_time || '17:00',
      status: '待處理',
    })
    if (data) {
      setSteps(prev => [...prev, data])
      setShowAddTaskModal(false)
      setTaskForm({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00' })
    }
  }

  const handleEditInstance = async () => {
    if (!selectedInstance) return
    const groups = editForm.groups ? editForm.groups.split(',').map(g => g.trim()).filter(Boolean) : []
    const { data } = await updateWorkflowInstance(selectedInstance.id, {
      assignee: editForm.assignee || null,
      groups: groups.length > 0 ? groups : null,
    })
    if (data) {
      setInstances(prev => prev.map(i => i.id === selectedInstance.id ? data : i))
      setSelectedInstance(data)
      setShowEditModal(false)
    }
  }

  const handleDeleteStep = async (stepId) => {
    if (!confirm('確定刪除此任務？')) return
    await deleteWorkflowStep(stepId)
    setSteps(prev => prev.filter(s => s.id !== stepId))
  }

  // ── Workflow definition handlers ──
  const handleSubmitDef = async () => {
    if (!defForm.name) return
    const { data } = await createWorkflow({
      name: defForm.name, category: defForm.category,
      steps: Number(defForm.steps) || 1, description: defForm.description,
      status: '已啟用', active_instances: 0,
    })
    if (data) {
      setWorkflows(prev => [...prev, data])
      setShowDefModal(false)
      setDefForm({ name: '', category: CATEGORIES[0], steps: '', description: '' })
    }
  }

  const runningCount = instances.filter(i => i.status === '進行中').length
  const completedCount = instances.filter(i => i.status === '已完成').length

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  // ════════════════════════════════════════════════════════════
  // ══ Instance Detail View ═══════════════════════════════════
  // ════════════════════════════════════════════════════════════
  if (selectedInstance) {
    const inst = instances.find(i => i.id === selectedInstance.id) || selectedInstance
    const instSteps = getInstanceSteps(inst.id)
    const stats = getStats(inst.id)

    return (
      <div className="fade-in">
        {/* ── Header ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          marginBottom: 20, padding: '20px 24px',
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
          borderRadius: 14,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{inst.store || inst.template_name}</h2>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {inst.template_name} · {inst.started_at?.slice(0, 10)}
            </div>

            {/* Assignment info */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>指派</span>
              <button className="btn btn-sm btn-secondary" onClick={() => {
                setEditForm({
                  assignee: inst.assignee || '',
                  groups: (inst.groups || []).join(', '),
                })
                setShowEditModal(true)
              }}>
                <Pencil size={11} /> 編輯
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                <User size={13} /> {inst.assignee || '未指定負責人'}
              </div>
              {(inst.groups || []).map((g, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                  padding: '3px 10px', borderRadius: 6,
                  background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                  border: '1px solid rgba(6,182,212,0.2)',
                }}>
                  <Users size={12} /> {g}
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => setSelectedInstance(null)} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', padding: 4, fontSize: 20, lineHeight: 1,
          }}>
            <X size={22} />
          </button>
        </div>

        {/* ── Progress Bar ── */}
        <div style={{
          padding: '16px 24px', marginBottom: 20,
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
          borderRadius: 14,
        }}>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--accent-cyan)', minWidth: 50 }}>{stats.pct}%</div>
            <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--border-medium)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 6,
                width: `${stats.pct}%`,
                background: stats.pct === 100
                  ? 'var(--accent-green)'
                  : 'linear-gradient(90deg, var(--accent-cyan), var(--accent-blue))',
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>

          {/* Status counts */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { icon: '⬜', label: '待處理', count: stats.pending, color: 'var(--text-muted)' },
              { icon: '🔄', label: '進行中', count: stats.inProgress, color: 'var(--accent-cyan)' },
              { icon: '✅', label: '已完成', count: stats.completed, color: 'var(--accent-green)' },
              { icon: '🚫', label: '已擱置', count: stats.blocked, color: 'var(--accent-red)' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span>{s.icon}</span>
                <span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
              </div>
            ))}
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              共 <strong>{stats.total}</strong>
            </div>
          </div>
        </div>

        {/* ── Task Table Header ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={16} /> 步驟任務 ({stats.total})
          </div>
          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => {
            setTaskForm({ title: '', assignee: '', store: inst.store || '', planned_start: '', due_date: '', due_time: '17:00' })
            setShowAddTaskModal(true)
          }}>
            <Plus size={13} /> 新增任務
          </button>
        </div>

        {/* ── Task Table ── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="data-table-wrapper">
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>#</th>
                  <th>任務名稱</th>
                  <th style={{ width: 90 }}>負責人</th>
                  <th style={{ width: 140 }}>門市</th>
                  <th style={{ width: 110 }}>計畫開始</th>
                  <th style={{ width: 130 }}>截止日期</th>
                  <th style={{ width: 90 }}>狀態</th>
                  <th style={{ width: 140 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {instSteps.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>尚無任務，點擊「新增任務」開始</td></tr>
                )}
                {instSteps.map(step => {
                  const sc = STATUS_CONFIG[step.status] || STATUS_CONFIG['待處理']
                  return (
                    <tr key={step.id} style={{
                      borderLeft: `3px solid ${sc.color}`,
                      cursor: 'pointer',
                    }} onClick={() => setSelectedStep(step)}>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }}>
                        {step.step_order}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{step.title}</div>
                        {step.notes && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            📝 {step.notes}
                          </div>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: 12 }}>{step.assignee || <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {step.store || inst.store || '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {step.planned_start || <span style={{ color: 'var(--border-medium)' }}>年/月/日</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {step.due_date ? (
                          <div>
                            <div>{step.due_date}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>🕐 {step.due_time || '17:00'}</div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--border-medium)' }}>年/月/日</span>
                        )}
                      </td>
                      <td>
                        <select
                          value={step.status}
                          onChange={e => handleStatusChange(step.id, e.target.value)}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: '4px 6px', borderRadius: 6,
                            border: `1px solid ${sc.color}`,
                            background: sc.bg, color: sc.color,
                            cursor: 'pointer', outline: 'none',
                          }}
                        >
                          {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button
                            title="備註"
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={() => {
                              setNotesStep(step)
                              setNotesText(step.notes || '')
                              setShowNotesModal(true)
                            }}
                          >
                            📝 備註
                          </button>
                          {!step.confirmed ? (
                            <button
                              title="確認任務"
                              className="btn btn-sm btn-secondary"
                              style={{ padding: '4px 8px', fontSize: 11 }}
                              onClick={() => handleConfirmTask(step.id)}
                            >
                              🔐 確認任務
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              ✅ 完成
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Notes Modal ── */}
        {showNotesModal && notesStep && (
          <Modal title={`📝 備註 — ${notesStep.title}`} onClose={() => setShowNotesModal(false)} onSubmit={handleSaveNotes}>
            <textarea
              className="form-input"
              style={{ width: '100%', minHeight: 120, resize: 'vertical' }}
              placeholder="輸入備註內容..."
              value={notesText}
              onChange={e => setNotesText(e.target.value)}
            />
          </Modal>
        )}

        {/* ── Add Task Modal ── */}
        {showAddTaskModal && (
          <Modal title="新增任務" onClose={() => setShowAddTaskModal(false)} onSubmit={handleAddTask}>
            <Field label="任務名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：電力申請" value={taskForm.title}
                onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="負責人">
                <select className="form-input" style={{ width: '100%' }} value={taskForm.assignee}
                  onChange={e => setTaskForm(f => ({ ...f, assignee: e.target.value }))}>
                  <option value="">請選擇</option>
                  {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                </select>
              </Field>
              <Field label="門市">
                <select className="form-input" style={{ width: '100%' }} value={taskForm.store}
                  onChange={e => setTaskForm(f => ({ ...f, store: e.target.value }))}>
                  <option value="">請選擇</option>
                  {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="計畫開始">
                <input className="form-input" type="date" style={{ width: '100%' }} value={taskForm.planned_start}
                  onChange={e => setTaskForm(f => ({ ...f, planned_start: e.target.value }))} />
              </Field>
              <Field label="截止日期">
                <input className="form-input" type="date" style={{ width: '100%' }} value={taskForm.due_date}
                  onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} />
              </Field>
              <Field label="截止時間">
                <input className="form-input" type="time" style={{ width: '100%' }} value={taskForm.due_time}
                  onChange={e => setTaskForm(f => ({ ...f, due_time: e.target.value }))} />
              </Field>
            </div>
          </Modal>
        )}

        {/* ── Edit Instance Modal ── */}
        {showEditModal && (
          <Modal title="編輯指派" onClose={() => setShowEditModal(false)} onSubmit={handleEditInstance}>
            <Field label="負責人">
              <select className="form-input" style={{ width: '100%' }} value={editForm.assignee}
                onChange={e => setEditForm(f => ({ ...f, assignee: e.target.value }))}>
                <option value="">未指定</option>
                {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="群組（逗號分隔）">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：Ai, 信義安和-新店建置專案群組"
                value={editForm.groups}
                onChange={e => setEditForm(f => ({ ...f, groups: e.target.value }))} />
            </Field>
          </Modal>
        )}

        {/* ── Task Detail Panel ── */}
        {selectedStep && (
          <TaskDetailPanel
            step={selectedStep}
            instance={inst}
            allSteps={instSteps}
            employees={employees}
            stores={stores}
            checklists={checklists}
            onUpdate={(updatedStep) => {
              setSteps(prev => prev.map(s => s.id === updatedStep.id ? updatedStep : s))
              setSelectedStep(updatedStep)
            }}
            onDelete={(stepId) => {
              setSteps(prev => prev.filter(s => s.id !== stepId))
              setSelectedStep(null)
            }}
            onClose={() => setSelectedStep(null)}
          />
        )}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════
  // ══ List View (Default) ════════════════════════════════════
  // ════════════════════════════════════════════════════════════
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 流程</h2>
            <p>標準作業流程設計與管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowDefModal(true)}><Plus size={14} /> 新增流程</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已啟用流程</div>
          <div className="stat-card-value">{workflows.filter(w => w.status === '已啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">執行中實例</div>
          <div className="stat-card-value">{runningCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">已完成</div>
          <div className="stat-card-value">{completedCount}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        {[
          { key: 'instances', label: `執行中 (${runningCount})` },
          { key: 'completed', label: `已完成 (${completedCount})` },
          { key: 'definitions', label: `流程定義 (${workflows.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '10px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══ Instances Tab ══ */}
      {(tab === 'instances' || tab === 'completed') && (
        <div>
          {instances.filter(i => tab === 'instances' ? i.status === '進行中' : i.status === '已完成').length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              {tab === 'instances' ? '目前沒有執行中的流程。從 SOP 範本部署即可建立。' : '尚無已完成的流程。'}
            </div>
          ) : instances.filter(i => tab === 'instances' ? i.status === '進行中' : i.status === '已完成').map(inst => {
            const stats = getStats(inst.id)
            return (
              <div
                key={inst.id}
                className="card"
                style={{ marginBottom: 12, cursor: 'pointer', transition: 'border-color 0.2s' }}
                onClick={() => setSelectedInstance(inst)}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = ''}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.store || inst.template_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {inst.template_name} · {inst.started_at?.slice(0, 10)}
                        {inst.completed_at && ` · 完成：${inst.completed_at.slice(0, 10)}`}
                      </div>
                      {inst.assignee && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          👤 {inst.assignee}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {/* Mini stats */}
                    <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                      <span title="待處理">⬜ {stats.pending}</span>
                      <span title="進行中" style={{ color: 'var(--accent-cyan)' }}>🔄 {stats.inProgress}</span>
                      <span title="已完成" style={{ color: 'var(--accent-green)' }}>✅ {stats.completed}</span>
                    </div>
                    {/* Circular progress */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: stats.pct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)' }}>
                          {stats.pct}%
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stats.completed}/{stats.total} 步</div>
                      </div>
                      <div style={{
                        width: 48, height: 48, borderRadius: '50%',
                        background: `conic-gradient(${stats.pct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)'} ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <div style={{
                          width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-secondary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700,
                        }}>
                          {stats.pct === 100 ? '✅' : `${stats.pct}%`}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══ Definitions Tab ══ */}
      {tab === 'definitions' && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>流程名稱</th><th>分類</th><th>步驟數</th><th>說明</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>
                {workflows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無流程定義</td></tr>}
                {workflows.map(w => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 600 }}>{w.name}</td>
                    <td><span className="badge badge-cyan">{w.category}</span></td>
                    <td>{w.steps}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12, maxWidth: 300 }}>{w.description}</td>
                    <td>
                      <span className={`badge ${w.status === '已啟用' ? 'badge-success' : w.status === '已停用' ? 'badge-danger' : 'badge-warning'}`}>
                        <span className="badge-dot"></span>{w.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" onClick={async () => {
                          const newStatus = w.status === '已啟用' ? '已停用' : '已啟用'
                          const { data } = await updateWorkflow(w.id, { status: newStatus })
                          if (data) setWorkflows(prev => prev.map(x => x.id === w.id ? data : x))
                        }}>{w.status === '已啟用' ? <Pause size={12} /> : <Play size={12} />}</button>
                        <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-red)' }} onClick={async () => {
                          if (!confirm('確定刪除？')) return
                          await supabase.from('workflows').delete().eq('id', w.id)
                          setWorkflows(prev => prev.filter(x => x.id !== w.id))
                        }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ New Definition Modal ══ */}
      {showDefModal && (
        <Modal title="新增流程" onClose={() => setShowDefModal(false)} onSubmit={handleSubmitDef}>
          <Field label="流程名稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：請假審批流程" value={defForm.name} onChange={e => setDefForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={defForm.category} onChange={e => setDefForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="步驟數">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="1" min="1" value={defForm.steps} onChange={e => setDefForm(f => ({ ...f, steps: e.target.value }))} />
            </Field>
          </div>
          <Field label="說明">
            <textarea className="form-input" style={{ width: '100%', resize: 'vertical' }} rows={3} placeholder="流程說明" value={defForm.description} onChange={e => setDefForm(f => ({ ...f, description: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
