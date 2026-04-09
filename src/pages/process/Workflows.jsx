import { useState, useEffect } from 'react'
import {
  Plus, Pencil, Trash2, ChevronRight, CheckCircle,
  X, Users, User, Play, Pause, Rocket, Archive,
  ClipboardList, Square, RotateCcw, Ban, ChevronDown
} from 'lucide-react'
import {
  getWorkflows, createWorkflow, updateWorkflow,
  getWorkflowInstances, updateWorkflowInstance,
  getWorkflowSteps, createWorkflowStep, updateWorkflowStep
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import TaskDetailPanel from '../../components/TaskDetailPanel'
import { notifyTaskAssignee } from '../../lib/lineNotify'

const STATUS_LIST = ['待處理', '進行中', '已完成', '已擱置']

const STATUS_CONFIG = {
  '待處理': { color: 'var(--text-muted)', bg: 'var(--glass-light)' },
  '進行中': { color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)' },
  '已完成': { color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
  '已擱置': { color: 'var(--accent-red)', bg: 'rgba(239,68,68,0.1)' },
}

export default function Workflows() {
  const [tab, setTab] = useState('active')
  const [workflows, setWorkflows] = useState([])
  const [instances, setInstances] = useState([])
  const [steps, setSteps] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [checklists, setChecklists] = useState([])
  const [templates, setTemplates] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [filterStore, setFilterStore] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')

  // Detail view
  const [selectedInstance, setSelectedInstance] = useState(null)
  const [selectedStep, setSelectedStep] = useState(null)

  // Modals
  const [showAddTaskModal, setShowAddTaskModal] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00' })
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [notesStep, setNotesStep] = useState(null)
  const [notesText, setNotesText] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ assignee: '', groups: '' })

  // SOP deploy
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployTemplate, setDeployTemplate] = useState(null)
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState(null)
  const [deployForm, setDeployForm] = useState({ location: '', assignees: {} })

  useEffect(() => {
    Promise.all([
      getWorkflows(),
      getWorkflowInstances(),
      getWorkflowSteps(),
      supabase.from('employees').select('id, name, dept, position').eq('status', '在職').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('checklists').select('*').order('id'),
      supabase.from('sop_templates').select('*').order('id'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([w, inst, st, emp, loc, cl, tpl, dept]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setSteps(st.data || [])
      setEmployees(emp.data || [])
      setStores(loc.data || [])
      setChecklists(cl.data || [])
      setTemplates(tpl.data || [])
      setDepartments(dept.data || [])
    }).catch(err => {
      console.error('Failed to load:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [])

  // ── Helpers ──
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
      const instId = data.instance_id
      const instSteps = steps.map(s => s.id === stepId ? data : s).filter(s => s.instance_id === instId)
      if (instSteps.length > 0 && instSteps.every(s => s.status === '已完成')) {
        const { data: inst } = await updateWorkflowInstance(instId, { status: '已完成', completed_at: new Date().toISOString() })
        if (inst) setInstances(prev => prev.map(i => i.id === instId ? inst : i))
      }
    }
  }

  const handleConfirmTask = async (stepId) => {
    const { data } = await updateWorkflowStep(stepId, { confirmed: true, confirmed_at: new Date().toISOString() })
    if (data) setSteps(prev => prev.map(s => s.id === stepId ? data : s))
  }

  const handleSaveNotes = async () => {
    if (!notesStep) return
    const { data } = await updateWorkflowStep(notesStep.id, { notes: notesText })
    if (data) setSteps(prev => prev.map(s => s.id === notesStep.id ? data : s))
    setShowNotesModal(false)
  }

  const handleAddTask = async () => {
    if (!taskForm.title || !selectedInstance) return
    const instSteps = getInstanceSteps(selectedInstance.id)
    const maxOrder = instSteps.length > 0 ? Math.max(...instSteps.map(s => s.step_order)) : 0
    const { data } = await createWorkflowStep({
      instance_id: selectedInstance.id, step_order: maxOrder + 1,
      title: taskForm.title, assignee: taskForm.assignee,
      store: taskForm.store || selectedInstance.store,
      planned_start: taskForm.planned_start || null,
      due_date: taskForm.due_date || null, due_time: taskForm.due_time || '17:00',
      status: '待處理',
    })
    if (data) {
      setSteps(prev => [...prev, data])
      setShowAddTaskModal(false)
      setTaskForm({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00' })
      if (taskForm.assignee) notifyTaskAssignee(taskForm.assignee, taskForm.title, selectedInstance.store || selectedInstance.template_name, data.id)
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

  // ── SOP Deploy ──
  const handleDeploy = async () => {
    if (!deployTemplate || !deployForm.location) return
    setDeploying(true)
    try {
      const tplSteps = deployTemplate.steps || []
      const loc = deployForm.location
      const { data: instance } = await supabase.from('workflow_instances').insert({
        template_name: deployTemplate.name, store: loc,
        status: '進行中', started_by: employees[0]?.name || '系統',
      }).select().single()
      if (instance) {
        const stepRows = tplSteps.map((step, i) => ({
          instance_id: instance.id, step_order: i + 1,
          title: step.title, description: step.description,
          role: step.role, assignee: deployForm.assignees[i] || '',
          store: loc, status: '待處理',
        }))
        await supabase.from('workflow_steps').insert(stepRows)
        setInstances(prev => [instance, ...prev])
        setDeployResult({ location: loc, count: tplSteps.length })
      }
    } catch (err) {
      alert('部署失敗：' + (err.message || '未知錯誤'))
    }
    setDeploying(false)
  }

  // ── Filtered instances ──
  const filteredInstances = instances.filter(i => {
    if (filterStore && i.store !== filterStore) return false
    if (filterAssignee && i.assignee !== filterAssignee) return false
    return true
  })
  const activeInstances = filteredInstances.filter(i => i.status === '進行中')
  const archivedInstances = filteredInstances.filter(i => i.status === '已完成')

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  // ════════════════════════════════════════════════════════════
  // ══ Instance Detail View ════════════════════════════════════
  // ════════════════════════════════════════════════════════════
  if (selectedInstance) {
    const inst = instances.find(i => i.id === selectedInstance.id) || selectedInstance
    const instSteps = getInstanceSteps(inst.id)
    const stats = getStats(inst.id)

    return (
      <div className="fade-in">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, padding: '20px 24px', background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 14 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{inst.store || inst.template_name}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{inst.template_name} · {inst.started_at?.slice(0, 10)}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>指派</span>
              <button className="btn btn-sm btn-secondary" onClick={() => { setEditForm({ assignee: inst.assignee || '', groups: (inst.groups || []).join(', ') }); setShowEditModal(true) }}>
                <Pencil size={11} /> 編輯
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                <User size={13} /> {inst.assignee || '未指定負責人'}
              </div>
              {(inst.groups || []).map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 10px', borderRadius: 6, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid rgba(6,182,212,0.2)' }}>
                  <Users size={12} /> {g}
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => setSelectedInstance(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}><X size={22} /></button>
        </div>

        {/* Progress */}
        <div style={{ padding: '16px 24px', marginBottom: 20, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--accent-cyan)', minWidth: 50 }}>{stats.pct}%</div>
            <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--border-medium)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 6, width: `${stats.pct}%`, background: stats.pct === 100 ? 'var(--accent-green)' : 'linear-gradient(90deg, var(--accent-cyan), var(--accent-blue))', transition: 'width 0.4s ease' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { icon: '⬜', count: stats.pending, color: 'var(--text-muted)' },
              { icon: '🔄', count: stats.inProgress, color: 'var(--accent-cyan)' },
              { icon: '✅', count: stats.completed, color: 'var(--accent-green)' },
              { icon: '🚫', count: stats.blocked, color: 'var(--accent-red)' },
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span>{s.icon}</span><span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
              </div>
            ))}
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>共 <strong>{stats.total}</strong></div>
          </div>
        </div>

        {/* Task table header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={16} /> 步驟任務 ({stats.total})
          </div>
          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => {
            setTaskForm({ title: '', assignee: '', store: inst.store || '', planned_start: '', due_date: '', due_time: '17:00' })
            setShowAddTaskModal(true)
          }}><Plus size={13} /> 新增任務</button>
        </div>

        {/* Task table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="data-table-wrapper">
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>#</th>
                  <th>任務名稱</th><th style={{ width: 90 }}>負責人</th><th style={{ width: 140 }}>門市</th>
                  <th style={{ width: 110 }}>計畫開始</th><th style={{ width: 130 }}>截止日期</th>
                  <th style={{ width: 90 }}>狀態</th><th style={{ width: 140 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {instSteps.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>尚無任務</td></tr>}
                {instSteps.map(step => {
                  const sc = STATUS_CONFIG[step.status] || STATUS_CONFIG['待處理']
                  return (
                    <tr key={step.id} style={{ borderLeft: `3px solid ${sc.color}`, cursor: 'pointer' }} onClick={() => setSelectedStep(step)}>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }}>{step.step_order}</td>
                      <td><div style={{ fontWeight: 600 }}>{step.title}</div></td>
                      <td><span style={{ fontSize: 12 }}>{step.assignee || '—'}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{step.store || inst.store || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{step.planned_start || <span style={{ color: 'var(--border-medium)' }}>年/月/日</span>}</td>
                      <td style={{ fontSize: 12 }}>
                        {step.due_date ? <div><div>{step.due_date}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>🕐 {step.due_time || '17:00'}</div></div>
                          : <span style={{ color: 'var(--border-medium)' }}>年/月/日</span>}
                      </td>
                      <td>
                        <select value={step.status} onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); handleStatusChange(step.id, e.target.value) }}
                          style={{ fontSize: 11, fontWeight: 600, padding: '4px 6px', borderRadius: 6, border: `1px solid ${sc.color}`, background: sc.bg, color: sc.color, cursor: 'pointer', outline: 'none' }}>
                          {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); setNotesStep(step); setNotesText(step.notes || ''); setShowNotesModal(true) }}>📝 備註</button>
                          {!step.confirmed ? (
                            <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                              onClick={e => { e.stopPropagation(); handleConfirmTask(step.id) }}>🔐 確認任務</button>
                          ) : <span style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 600 }}>✅ 完成</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modals */}
        {showNotesModal && notesStep && (
          <Modal title={`📝 備註 — ${notesStep.title}`} onClose={() => setShowNotesModal(false)} onSubmit={handleSaveNotes}>
            <textarea className="form-input" style={{ width: '100%', minHeight: 120, resize: 'vertical' }} placeholder="輸入備註內容..." value={notesText} onChange={e => setNotesText(e.target.value)} />
          </Modal>
        )}
        {showAddTaskModal && (
          <Modal title="新增任務" onClose={() => setShowAddTaskModal(false)} onSubmit={handleAddTask}>
            <Field label="任務名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：電力申請" value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="負責人"><select className="form-input" style={{ width: '100%' }} value={taskForm.assignee} onChange={e => setTaskForm(f => ({ ...f, assignee: e.target.value }))}><option value="">請選擇</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select></Field>
              <Field label="門市"><select className="form-input" style={{ width: '100%' }} value={taskForm.store} onChange={e => setTaskForm(f => ({ ...f, store: e.target.value }))}><option value="">請選擇</option>{stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="計畫開始"><input className="form-input" type="date" style={{ width: '100%' }} value={taskForm.planned_start} onChange={e => setTaskForm(f => ({ ...f, planned_start: e.target.value }))} /></Field>
              <Field label="截止日期"><input className="form-input" type="date" style={{ width: '100%' }} value={taskForm.due_date} onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} /></Field>
              <Field label="截止時間"><input className="form-input" type="time" style={{ width: '100%' }} value={taskForm.due_time} onChange={e => setTaskForm(f => ({ ...f, due_time: e.target.value }))} /></Field>
            </div>
          </Modal>
        )}
        {showEditModal && (
          <Modal title="編輯指派" onClose={() => setShowEditModal(false)} onSubmit={handleEditInstance}>
            <Field label="負責人"><select className="form-input" style={{ width: '100%' }} value={editForm.assignee} onChange={e => setEditForm(f => ({ ...f, assignee: e.target.value }))}><option value="">未指定</option>{employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</select></Field>
            <Field label="群組（逗號分隔）"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：Ai, 信義安和-新店建置專案群組" value={editForm.groups} onChange={e => setEditForm(f => ({ ...f, groups: e.target.value }))} /></Field>
          </Modal>
        )}
        {selectedStep && (
          <TaskDetailPanel step={selectedStep} instance={inst} allSteps={instSteps} employees={employees} stores={stores} checklists={checklists}
            onUpdate={d => { setSteps(prev => prev.map(s => s.id === d.id ? d : s)); setSelectedStep(d) }}
            onDelete={id => { setSteps(prev => prev.filter(s => s.id !== id)); setSelectedStep(null) }}
            onClose={() => setSelectedStep(null)} />
        )}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════
  // ══ Main List View ═════════════════════════════════════════
  // ════════════════════════════════════════════════════════════
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 流程管理</h2>
            <p>管理流程範本及進行中的工作流程</p>
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 20, padding: '14px 20px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🏪 門市</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 140 }} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
            <option value="">全部門市</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>👤 負責人</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 140 }} value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
            <option value="">全部人員</option>
            {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
          </select>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
        {[
          { key: 'active', label: `🟢 進行中流程 (${activeInstances.length})` },
          { key: 'templates', label: `📁 流程範本 (${templates.length})` },
          { key: 'archived', label: `📦 封存流程 (${archivedInstances.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '10px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══ Active Instances ══ */}
      {tab === 'active' && (
        <div>
          {activeInstances.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>目前沒有進行中的流程。從「流程範本」部署即可建立。</div>
          ) : activeInstances.map(inst => {
            const stats = getStats(inst.id)
            return (
              <div key={inst.id} className="card" style={{ marginBottom: 12, cursor: 'pointer', transition: 'border-color 0.2s' }}
                onClick={() => setSelectedInstance(inst)}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.store || inst.template_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.template_name} · {inst.started_at?.slice(0, 10)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                      <span>⬜ {stats.pending}</span>
                      <span style={{ color: 'var(--accent-cyan)' }}>🔄 {stats.inProgress}</span>
                      <span style={{ color: 'var(--accent-green)' }}>✅ {stats.completed}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-cyan)' }}>{stats.pct}%</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stats.completed}/{stats.total}</div>
                      </div>
                      <div style={{ width: 48, height: 48, borderRadius: '50%', background: `conic-gradient(var(--accent-cyan) ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{stats.pct}%</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══ Templates (SOP) ══ */}
      {tab === 'templates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {templates.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無流程範本</div>
          ) : templates.map(tpl => {
            const tplSteps = tpl.steps || []
            return (
              <div key={tpl.id} className="card" style={{ padding: 0 }}>
                <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{tpl.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      <span className="badge badge-cyan" style={{ marginRight: 8 }}>{tpl.category}</span>
                      {tplSteps.length} 個步驟 · {tpl.description || ''}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-primary" style={{ padding: '6px 14px' }} onClick={() => {
                    setDeployTemplate(tpl); setDeployForm({ location: '', assignees: {} }); setDeployResult(null); setShowDeployModal(true)
                  }}><Rocket size={13} /> 部署</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══ Archived ══ */}
      {tab === 'archived' && (
        <div>
          {archivedInstances.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無封存流程</div>
          ) : archivedInstances.map(inst => {
            const stats = getStats(inst.id)
            return (
              <div key={inst.id} className="card" style={{ marginBottom: 12, cursor: 'pointer', opacity: 0.7 }} onClick={() => setSelectedInstance(inst)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.store || inst.template_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.template_name} · 完成：{inst.completed_at?.slice(0, 10)}</div>
                  </div>
                  <span style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: 13 }}>✅ 已完成 ({stats.total} 步)</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══ Deploy Modal ══ */}
      {showDeployModal && deployTemplate && (
        <Modal title={`🚀 部署「${deployTemplate.name}」`} onClose={() => { setShowDeployModal(false); setDeployResult(null) }}
          onSubmit={deployResult ? () => { setShowDeployModal(false); setDeployResult(null) } : handleDeploy}
          submitLabel={deployResult ? '完成' : deploying ? '部署中...' : '確認部署'}>
          {deployResult ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>部署成功！</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                已為 <strong>{deployResult.location}</strong> 建立 <strong>{deployResult.count}</strong> 個任務
              </div>
            </div>
          ) : (
            <>
              <Field label="部署到哪個分店 *">
                <select className="form-input" style={{ width: '100%' }} value={deployForm.location} onChange={e => setDeployForm(f => ({ ...f, location: e.target.value }))}>
                  <option value="">請選擇分店</option>
                  {stores.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              </Field>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', margin: '16px 0 10px' }}>指派負責人</div>
              {(deployTemplate.steps || []).map((step, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', marginBottom: 6, border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Step {i + 1}：{step.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>角色：{step.role || '-'}</div>
                  </div>
                  <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={deployForm.assignees[i] || ''}
                    onChange={e => setDeployForm(f => ({ ...f, assignees: { ...f.assignees, [i]: e.target.value } }))}>
                    <option value="">請選擇</option>
                    {departments.map(d => (
                      <optgroup key={d.id} label={d.name}>
                        {employees.filter(e => e.dept === d.name).map(e => <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
