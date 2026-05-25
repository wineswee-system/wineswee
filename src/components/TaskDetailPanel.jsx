import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Pencil, Save, Trash2, Bell, Copy, Info } from 'lucide-react'
import InputModal from './ui/InputModal'
import SearchableSelect, { empOptions } from './SearchableSelect'
import { toast } from '../lib/toast'
import {
  updateTask, deleteTask,
  getTaskComments, getTaskAttachments,
  getTaskChecklists, getTaskDependencies,
  getApprovalChains, getApprovalFormByTask, getApprovalFormSteps,
  getTaskConfirmations,
  getChecklistItems,
} from '../lib/db'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import ChangelogPanel from './ChangelogPanel'
import { confirm } from '../lib/confirm'
import { useAuditLog } from '../lib/useAuditLog'
import { diffAndLogTask } from '../lib/taskAudit'
import { fmtDateTimeTW } from '../lib/datetime'

import TaskRelationsTab from './tasks/TaskRelationsTab'
import TaskApprovalTab from './tasks/TaskApprovalTab'
import TaskDiscussionTab from './tasks/TaskDiscussionTab'

const STATUS_LIST = ['未開始', '待簽核', '進行中', '已完成', '已擱置']
const PRIORITY_LIST = ['低', '中', '高']


export default function TaskDetailPanel({
  step: task, allSteps, employees, stores, checklists,
  onUpdate, onDelete, onDuplicate, onClose,
}) {
  const { profile } = useAuth()
  const { logAction, logFieldChange } = useAuditLog()
  const [form, setForm] = useState({})
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [activeTab, setActiveTab] = useState('basic')

  // Sub-data
  const [comments, setComments] = useState([])
  const [attachments, setAttachments] = useState([])
  const [linkedChecklists, setLinkedChecklists] = useState([])
  const [checklistItemsMap, setChecklistItemsMap] = useState({})
  const [dependencies, setDependencies] = useState([])
  const [approvalChains, setApprovalChains] = useState([])
  const [approvalForm, setApprovalForm] = useState(null)
  const [approvalSteps, setApprovalSteps] = useState([])
  const [approvalPriority, setApprovalPriority] = useState('中')
  const [approvalMode, setApprovalMode] = useState('sequential')
  const [confirmations, setConfirmations] = useState([])
  const [formBindings, setFormBindings] = useState([])
  const [newConfirmApprover, setNewConfirmApprover] = useState('')
  const [newConfirmPriority, setNewConfirmPriority] = useState('中')
  const [saving, setSaving] = useState(false)

  // Relations tab data
  const [sopTemplates, setSopTemplates] = useState([])
  const [triggeredInstances, setTriggeredInstances] = useState([])

  // Basic tab dropdowns
  const [allProjects, setAllProjects] = useState([])
  const [allWorkflowInstances, setAllWorkflowInstances] = useState([])

  // InputModal state
  const [inputModal, setInputModal] = useState({ open: false, title: '', label: '', placeholder: '', required: true, onConfirm: null })
  const openInput = (title, label, onConfirm, { placeholder = '', required = true } = {}) =>
    setInputModal({ open: true, title, label, placeholder, required, onConfirm })
  const closeInput = () => setInputModal(m => ({ ...m, open: false, onConfirm: null }))

  useEffect(() => {
    if (!task) return
    setForm({
      status: task.status || '待簽核',
      priority: task.priority || '中',
      assignee: task.assignee || '',
      store: task.store || '',
      category: task.category || 'Workflow',
      planned_start: task.planned_start || '',
      due_date: task.due_date || '',
      due_time: task.due_time || '',
      reminder_at: task.reminder_at || '',
      confirmation_mode: task.confirmation_mode || 'parallel',
      notes: task.notes || '',
      workflow_instance_id: task.workflow_instance_id || '',
      project_id: task.project_id || '',
    })
    setTitleDraft(task.title)
    setEditingTitle(false)

    const safe = (promise) => Promise.resolve(promise).then(r => r?.error ? { data: null } : r, () => ({ data: null }))
    Promise.all([
      safe(getTaskComments(task.id)),
      safe(getTaskAttachments(task.id)),
      safe(getTaskChecklists(task.id)),
      safe(getTaskDependencies(task.id)),
      safe(getApprovalChains()),
      safe(getApprovalFormByTask(task.id)),
      safe(getTaskConfirmations(task.id)),
      safe(supabase.from('task_form_bindings').select('*').eq('task_id', task.id).order('id')),
      safe(supabase.from('sop_templates').select('id, name, steps').order('id')),
      safe(supabase.from('workflow_instances').select('id, template_name, status, started_at, store').eq('triggered_by_task_id', task.id).order('started_at', { ascending: false })),
      safe(supabase.from('projects').select('id, name').order('name')),
      safe(supabase.from('workflow_instances').select('id, template_name, status').order('id')),
    ]).then(([c, a, cl, d, ac, af, tc, bindings, tpl, trig, proj, wfAll]) => {
      setComments(c.data || [])
      setAttachments(a.data || [])
      setLinkedChecklists(cl.data || [])
      setDependencies(d.data || [])
      setApprovalChains(ac.data || [])
      setConfirmations(tc.data || [])
      setFormBindings(bindings.data || [])
      setSopTemplates(tpl.data || [])
      setTriggeredInstances(trig.data || [])
      setAllProjects(proj.data || [])
      setAllWorkflowInstances(wfAll.data || [])
      if (af.data) {
        setApprovalForm(af.data)
        setApprovalPriority(af.data.priority || '中')
        setApprovalMode(af.data.mode || 'sequential')
        getApprovalFormSteps(af.data.id).then(({ data: steps }) => setApprovalSteps(steps || [])).catch(() => setApprovalSteps([]))
      } else {
        setApprovalForm(null)
        setApprovalSteps([])
        setApprovalPriority('中')
        setApprovalMode('sequential')
      }
      const linked = cl.data || []
      if (linked.length > 0) {
        Promise.all(linked.map(lc => safe(getChecklistItems(lc.checklist_id))))
          .then(results => {
            const map = {}
            linked.forEach((lc, i) => { map[lc.checklist_id] = results[i].data || [] })
            setChecklistItemsMap(map)
          })
      } else {
        setChecklistItemsMap({})
      }
    }).catch(() => {})
  }, [task?.id])

  // Lock body scroll when modal is open
  useEffect(() => {
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const [isDirty, setIsDirty] = useState(false)
  useEffect(() => { setIsDirty(false) }, [task?.id])
  const setAndDirty = (k, v) => { set(k, v); setIsDirty(true) }

  const handleClose = async () => {
    if (isDirty && !(await confirm({ message: '有未儲存的變更，確定要離開嗎？' }))) return
    setIsDirty(false)
    onClose()
  }

  if (!task) return null

  const handleSave = async () => {
    setSaving(true)
    const prevStatus = task.status

    if (form.status === '已完成' && prevStatus !== '已完成' && task.approval_chain_id) {
      const hasAnyConfirm = confirmations.length > 0
      const hasPending = confirmations.some(c => c.status === 'pending')
      const wasRejected = task.confirmation_status === 'rejected'

      if (!hasAnyConfirm) {
        const { data: result, error } = await supabase.rpc('web_complete_task', { p_task_id: task.id })
        if (error || !result?.ok) {
          setForm(f => ({ ...f, status: prevStatus }))
          setSaving(false)
          toast.error('啟動簽核失敗：' + (error?.message || result?.error || '未知錯誤'))
          return
        }
        const { data: tcData } = await supabase.from('task_confirmations').select('*').eq('task_id', task.id).order('created_at')
        setConfirmations(tcData || [])
        setForm(f => ({ ...f, status: result.status === '已完成' ? '已完成' : prevStatus }))
        setSaving(false)
        if (result.has_pending_confirmations) {
          toast.success('已啟動簽核流程，完成所有簽核後任務會自動標記為已完成')
        }
        return
      }
      if (wasRejected) {
        setForm(f => ({ ...f, status: prevStatus }))
        setSaving(false)
        toast.error('簽核已退回，請聯絡管理員重啟簽核流程')
        return
      }
      if (hasPending) {
        setForm(f => ({ ...f, status: prevStatus }))
        setSaving(false)
        toast.error('請等待簽核完成後，任務會自動標記為已完成')
        return
      }
    }

    const payload = {
      ...form,
      title: titleDraft,
      assignee_id: employees.find(e => e.name === form.assignee)?.id ?? null,
      planned_start: form.planned_start || null,
      due_date: form.due_date || null,
      due_time: form.due_time || null,
      reminder_at: form.reminder_at || null,
      confirmation_mode: form.confirmation_mode || 'parallel',
      completed_at: form.status === '已完成' ? (task.completed_at || new Date().toISOString()) : null,
      workflow_instance_id: form.workflow_instance_id || null,
      project_id: form.project_id || null,
    }
    const { data } = await updateTask(task.id, payload)
    if (data) {
      onUpdate(data)
      setIsDirty(false)
      diffAndLogTask(logFieldChange, task, data)
      if (form.status === '已完成' && prevStatus !== '已完成') {
        const triggerDeps = dependencies.filter(d => d.task_id === task.id && d.dep_type === 'trigger')
        for (const dep of triggerDeps) {
          const { data: cascaded } = await supabase
            .from('tasks')
            .update({ status: '進行中' })
            .eq('id', dep.depends_on_task_id)
            .eq('status', '待簽核')
            .select()
          if (cascaded?.length) {
            logFieldChange('tasks', dep.depends_on_task_id, '狀態', '待簽核', '進行中', cascaded[0].title)
          }
        }
      }
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!(await confirm({ message: '確定刪除此任務？' }))) return
    const { error } = await deleteTask(task.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    logAction('刪除', 'tasks', task.id, task.title)
    onDelete(task.id)
  }

  const setReminder = (type) => {
    if (!form.due_date) return
    const due = new Date(form.due_date + 'T' + (form.due_time || '17:00'))
    let reminder
    if (type === '1hr') reminder = new Date(due.getTime() - 60 * 60 * 1000)
    else if (type === '1day') reminder = new Date(due.getTime() - 24 * 60 * 60 * 1000)
    else reminder = new Date(form.due_date + 'T09:00')
    set('reminder_at', reminder.toISOString().slice(0, 16))
  }

  const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, marginTop: 18 }
  const sectionStyle = {
    padding: '16px 20px', marginBottom: 12, borderRadius: 10,
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
  }
  const fieldGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }

  return createPortal(
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)',
      width: '100vw', height: '100vh',
    }} onMouseDown={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div style={{
        width: '100%', maxWidth: 780,
        maxHeight: '85vh',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 16,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        animation: 'fadeIn 0.2s ease',
        overflow: 'hidden',
        margin: 'auto',
      }}>
        {/* ── Header ── */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            {editingTitle ? (
              <input
                className="form-input"
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={e => e.key === 'Enter' && setEditingTitle(false)}
                autoFocus
                style={{ fontSize: 18, fontWeight: 800, flex: 1 }}
              />
            ) : (
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={() => setEditingTitle(true)}>
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', flexShrink: 0 }}>tk-{task.id}</span>
                {titleDraft}
                <Pencil size={14} style={{ marginLeft: 4, color: 'var(--accent-orange)', flexShrink: 0 }} />
              </h3>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 13 }}>
              <Save size={13} /> {saving ? '...' : '更新'}
            </button>
            {onDuplicate && (
              <button className="btn btn-sm btn-secondary"
                title="複製此任務（含負責人/審批/簽核鏈/清單，加到流程最後）"
                onClick={async () => { await onDuplicate(task); handleClose(); }}
                style={{ color: 'var(--accent-cyan)', padding: '6px 8px' }}>
                <Copy size={15} />
              </button>
            )}
            <button className="btn btn-sm btn-secondary" onClick={handleDelete}
              style={{ color: 'var(--accent-red)', padding: '6px 8px' }}>
              <Trash2 size={15} />
            </button>
            <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Tab Bar ── */}
        <div style={{
          display: 'flex', gap: 2, padding: '0 24px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)', flexShrink: 0,
        }}>
          {[
            { id: 'basic',      label: '基本' },
            { id: 'relations',  label: '關聯' },
            { id: 'approval',   label: '簽核' },
            { id: 'discussion', label: '討論' },
            { id: 'changelog',  label: '變更日誌' },
          ].map(t => {
            const active = activeTab === t.id
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                padding: '10px 18px', fontSize: 13, fontWeight: 600,
                background: 'none', border: 'none', cursor: 'pointer',
                color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                borderBottom: `2px solid ${active ? 'var(--accent-cyan)' : 'transparent'}`,
                marginBottom: -1,
              }}>{t.label}</button>
            )
          })}
        </div>

        {/* ── Body (scrollable) ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ═══ Basic Tab ═══ */}
          {activeTab === 'basic' && (
            <>
              <div style={sectionStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 1fr', gap: 12 }}>
                  <div>
                    <div style={labelStyle}>狀態</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.status}
                      onChange={e => setAndDirty('status', e.target.value)}>
                      {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>優先度</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.priority}
                      onChange={e => setAndDirty('priority', e.target.value)}>
                      {PRIORITY_LIST.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>分類</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.category}
                      onChange={e => setAndDirty('category', e.target.value)}>
                      {['Workflow', 'HR', '營運', '採購', '展店', '倉管', '財務', '行銷'].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div style={fieldGrid}>
                  <div>
                    <div style={labelStyle}>負責人</div>
                    <SearchableSelect
                      value={form.assignee}
                      onChange={(v) => setAndDirty('assignee', v || '')}
                      options={empOptions(employees, { keyBy: 'name' })}
                      placeholder="搜尋員工姓名/職稱..."
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>歸屬門市</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.store}
                      onChange={e => setAndDirty('store', e.target.value)}>
                      <option value="">未指定</option>
                      {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                <div style={fieldGrid}>
                  <div>
                    <div style={labelStyle}>工作流</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.workflow_instance_id}
                      onChange={e => setAndDirty('workflow_instance_id', e.target.value ? Number(e.target.value) : '')}>
                      <option value="">未指定</option>
                      {allWorkflowInstances.map(w => (
                        <option key={w.id} value={w.id}>{w.template_name}{w.status ? ` (${w.status})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>專案</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.project_id}
                      onChange={e => setAndDirty('project_id', e.target.value ? Number(e.target.value) : '')}>
                      <option value="">未指定</option>
                      {allProjects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div style={sectionStyle}>
                <div style={fieldGrid}>
                  <div>
                    <div style={labelStyle}>計畫開始日</div>
                    <input className="form-input" type="date" style={{ width: '100%' }}
                      value={form.planned_start} onChange={e => setAndDirty('planned_start', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={labelStyle}>預計完成日</div>
                    <input className="form-input" type="date" style={{ width: '100%' }}
                      value={form.due_date} onChange={e => setAndDirty('due_date', e.target.value)} />
                    <input className="form-input" type="time" style={{ width: '100%' }}
                      value={form.due_time || ''} onChange={e => setAndDirty('due_time', e.target.value)} />
                  </div>
                  <div>
                    <div style={labelStyle}>
                      <Bell size={13} style={{ verticalAlign: 'middle', color: 'var(--accent-red)' }} /> 提醒時間
                    </div>
                    <input className="form-input" type="datetime-local" style={{ width: '100%' }}
                      value={form.reminder_at ? form.reminder_at.slice(0, 16) : ''}
                      onChange={e => setAndDirty('reminder_at', e.target.value)} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {[
                        { label: '1hr前', type: '1hr' },
                        { label: '1天前', type: '1day' },
                        { label: '09:00', type: 'morning' },
                      ].map(r => (
                        <button key={r.type} onClick={() => setReminder(r.type)} style={{
                          padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          border: '1px solid var(--border-medium)', background: 'var(--bg-card)',
                          color: 'var(--text-secondary)', cursor: 'pointer',
                        }}>{r.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
                      實際完成日
                      <Info size={12} title="完成時自動記錄時間戳記" style={{ color: 'var(--text-muted)', cursor: 'default', flexShrink: 0 }} />
                    </div>
                    <div style={{ fontSize: 14, color: task.completed_at ? 'var(--text-secondary)' : 'var(--text-muted)', padding: '7px 10px', lineHeight: '1.4' }}>
                      {task.completed_at ? fmtDateTimeTW(task.completed_at) : '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div style={sectionStyle}>
                <div style={{ ...labelStyle, marginTop: 0 }}>備註</div>
                <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }}
                  placeholder="備註..." value={form.notes} onChange={e => setAndDirty('notes', e.target.value)} />
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
                ID: {task.id} &nbsp;&nbsp; 建立: {task.created_at?.slice(0, 10)}
                {task.confirmation_status === 'approved' && (
                  <span style={{ marginLeft: 12, color: 'var(--accent-green)' }}>
                    ✅ {task.confirmation_responded_at?.slice(0, 10)}
                  </span>
                )}
              </div>

              {/* 綁定表單清單（流程 step 設定的必填表單）*/}
              {formBindings.length > 0 && (
                <TaskFormBindingsBlock bindings={formBindings} taskId={task.id} />
              )}
            </>
          )}

          {/* ═══ Relations Tab ═══ */}
          {activeTab === 'relations' && (
            <TaskRelationsTab
              task={task}
              checklists={checklists}
              linkedChecklists={linkedChecklists}
              setLinkedChecklists={setLinkedChecklists}
              checklistItemsMap={checklistItemsMap}
              setChecklistItemsMap={setChecklistItemsMap}
              dependencies={dependencies}
              setDependencies={setDependencies}
              allSteps={allSteps}
              sopTemplates={sopTemplates}
              triggeredInstances={triggeredInstances}
              setTriggeredInstances={setTriggeredInstances}
              formBindings={formBindings}
              setFormBindings={setFormBindings}
              form={form}
              setAndDirty={setAndDirty}
              allWorkflowInstances={allWorkflowInstances}
              allProjects={allProjects}
            />
          )}

          {/* ═══ Approval Tab ═══ */}
          {activeTab === 'approval' && (
            <TaskApprovalTab
              task={task}
              profile={profile}
              employees={employees}
              form={form}
              setAndDirty={setAndDirty}
              confirmations={confirmations}
              setConfirmations={setConfirmations}
              newConfirmApprover={newConfirmApprover}
              setNewConfirmApprover={setNewConfirmApprover}
              newConfirmPriority={newConfirmPriority}
              setNewConfirmPriority={setNewConfirmPriority}
              approvalChains={approvalChains}
              approvalForm={approvalForm}
              setApprovalForm={setApprovalForm}
              approvalSteps={approvalSteps}
              setApprovalSteps={setApprovalSteps}
              approvalPriority={approvalPriority}
              setApprovalPriority={setApprovalPriority}
              approvalMode={approvalMode}
              setApprovalMode={setApprovalMode}
              openInput={openInput}
              closeInput={closeInput}
              onUpdate={onUpdate}
            />
          )}

          {/* ═══ Discussion Tab ═══ */}
          {activeTab === 'discussion' && (
            <TaskDiscussionTab
              task={task}
              profile={profile}
              attachments={attachments}
              setAttachments={setAttachments}
              comments={comments}
              setComments={setComments}
              openInput={openInput}
              closeInput={closeInput}
            />
          )}

          {/* ═══ Changelog Tab ═══ */}
          {activeTab === 'changelog' && (
            <div style={{ padding: '4px 0' }}>
              <ChangelogPanel
                tables={['tasks']}
                targetId={task?.id}
                orgId={profile?.organization_id}
                currentUser={profile?.name}
              />
            </div>
          )}

        </div>
      </div>

      <InputModal
        isOpen={inputModal.open}
        title={inputModal.title}
        label={inputModal.label}
        placeholder={inputModal.placeholder}
        required={inputModal.required}
        onConfirm={inputModal.onConfirm || (() => {})}
        onCancel={closeInput}
      />
    </div>,
    document.body
  )
}

// ─── 綁定表單顯示元件（流程任務內的「需完成事項」清單）───
function TaskFormBindingsBlock({ bindings }) {
  const STATUS_STYLE = {
    '未填':   { bg: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)',     icon: '⚪' },
    '簽核中': { bg: 'rgba(245,158,11,0.15)',   color: 'var(--accent-orange)', icon: '🔵' },
    '已退回': { bg: 'rgba(239,68,68,0.15)',    color: 'var(--accent-red)',    icon: '❌' },
    '已完成': { bg: 'rgba(34,197,94,0.15)',    color: 'var(--accent-green)',  icon: '✅' },
  }
  const navTo = (b) => {
    // 帶 binding_id 跳轉到對應表單頁，submit 時表單頁負責寫回 linked_binding_id
    const u = b.form_id
      ? null  // 已有 form_id 表示已認領 → 點卡只是查狀態
      : (b.form_type === 'expense_request' ? `/process/expense-requests?binding_id=${b.id}`
        : b.form_type === 'expense'         ? `/process/expenses?binding_id=${b.id}`
        : b.form_type === 'store_audit'     ? `/process/store-audits?new=1&binding_id=${b.id}`
        : `/process/forms/custom/${b.form_template_id}?binding_id=${b.id}`)
    if (u) window.open(u, '_blank')
  }
  const completed = bindings.filter(b => b.status === '已完成').length
  return (
    <div style={{ marginBottom: 16, padding: 12, background: 'var(--glass-light)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>📋 需完成表單</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{completed}/{bindings.length} 完成</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bindings.map(b => {
          const s = STATUS_STYLE[b.status] || STATUS_STYLE['未填']
          return (
            <div key={b.id} onClick={() => navTo(b)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderRadius: 6, background: 'var(--bg-card)',
                cursor: b.form_id ? 'default' : 'pointer',
                border: '1px solid var(--border-subtle)',
              }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {s.icon} {b.form_label}
                  {b.form_id && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>#{b.form_id}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  完成條件：{b.required_status}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{b.status}</span>
                {!b.form_id && (
                  <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>→ 去填寫</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
