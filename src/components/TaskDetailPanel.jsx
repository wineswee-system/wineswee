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
import TaskAttachmentsTab from './tasks/TaskAttachmentsTab'

const STATUS_LIST = ['未開始', '待簽核', '進行中', '已完成', '已擱置']
const PRIORITY_LIST = ['低', '中', '高']


export default function TaskDetailPanel({
  step: task, instance, allSteps, employees, stores, checklists,
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
      toast.success('已更新')
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
          padding: '14px 24px 0', borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          {/* Breadcrumb */}
          {instance && (
            <nav aria-label="breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 500 }}>{instance.template_name}</span>
              <span aria-hidden="true" style={{ color: 'var(--border-medium)' }}>›</span>
              <span aria-current="page" style={{ color: 'var(--text-secondary)' }}>tk-{task.id}</span>
            </nav>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14 }}>
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
        </div>

        {/* ── Tab Bar ── */}
        <div style={{
          display: 'flex', gap: 2, padding: '0 24px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)', flexShrink: 0,
        }}>
          {(() => {
            const allItems = linkedChecklists.flatMap(lc => checklistItemsMap[lc.checklist_id] || [])
            const doneCount = allItems.filter(i => i.checked).length
            const subtaskLabel = allItems.length > 0 ? `子任務 ${doneCount}/${allItems.length}` : '子任務'
            return [
              { id: 'basic',       label: '基本' },
              { id: 'subtasks',    label: subtaskLabel },
              { id: 'relations',   label: '關聯' },
              { id: 'approval',    label: '簽核' },
              { id: 'attachments', label: `附件 (${attachments.length})` },
              { id: 'discussion',  label: '討論' },
              { id: 'changelog',   label: '變更日誌' },
            ]
          })().map(t => {
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

              {/* ── 時間追蹤 ── */}
              <TaskTimeBlock task={task} />

              <div style={sectionStyle}>
                <div style={{ ...labelStyle, marginTop: 0 }}>備註</div>
                <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }}
                  placeholder="備註..." value={form.notes} onChange={e => setAndDirty('notes', e.target.value)} />
              </div>

              {(task.bucket || task.section_id || task.recurrence_rule) && (
                <div style={{ ...sectionStyle, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>唯讀欄位（在任務頁編輯）</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {task.bucket && (
                      <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>類型</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{task.bucket}</span>
                      </div>
                    )}
                    {task.section_id && (
                      <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>看板欄 ID</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{task.section_id}</span>
                      </div>
                    )}
                    {task.recurrence_rule && (
                      <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>重複規則</span>
                        <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 12 }}>{task.recurrence_rule}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

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

          {/* ═══ Subtasks Tab ═══ */}
          {activeTab === 'subtasks' && (
            <SubtasksTab
              task={task}
              linkedChecklists={linkedChecklists}
              checklistItemsMap={checklistItemsMap}
              setChecklistItemsMap={setChecklistItemsMap}
              employees={employees}
            />
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

          {/* ═══ 附件 Tab ═══ */}
          {activeTab === 'attachments' && (
            <TaskAttachmentsTab
              task={task}
              profile={profile}
              attachments={attachments}
              setAttachments={setAttachments}
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

// ─── 時間追蹤 Block（in 基本 tab）───
function TaskTimeBlock({ task }) {
  const [logs, setLogs] = useState([])
  const [adding, setAdding] = useState(false)
  const [hours, setHours] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [estHours, setEstHours] = useState(task?.estimated_hours ?? '')
  const [estSaving, setEstSaving] = useState(false)

  useEffect(() => {
    if (!task?.id) return
    supabase.from('task_time_logs').select('*').eq('task_id', task.id).order('logged_date', { ascending: false })
      .then(({ data }) => setLogs(data || []))
  }, [task?.id])

  const totalLogged = logs.reduce((s, l) => s + Number(l.hours), 0)
  const est = Number(estHours) || 0
  const pct = est > 0 ? Math.min(100, Math.round((totalLogged / est) * 100)) : 0
  const overBudget = est > 0 && totalLogged > est

  const saveLog = async () => {
    if (!hours || Number(hours) <= 0) return
    setSaving(true)
    const { data } = await supabase.from('task_time_logs').insert({
      task_id: task.id, hours: Number(hours), note: note.trim() || null,
    }).select().single()
    if (data) { setLogs(prev => [data, ...prev]); setHours(''); setNote(''); setAdding(false) }
    setSaving(false)
  }

  const saveEst = async () => {
    setEstSaving(true)
    await supabase.from('tasks').update({ estimated_hours: estHours ? Number(estHours) : null }).eq('id', task.id)
    setEstSaving(false)
  }

  return (
    <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>⏱ 時間追蹤</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>預估</span>
          <input type="number" min="0" step="0.5" value={estHours} onChange={e => setEstHours(e.target.value)}
            onBlur={saveEst}
            style={{ width: 60, fontSize: 12, padding: '2px 6px', borderRadius: 5, border: '1px solid var(--border-medium)', background: 'var(--bg-input)', color: 'var(--text-primary)', textAlign: 'right' }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>h{estSaving ? ' ✓' : ''}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          {est > 0 && (
            <div style={{ flex: 1, height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: overBudget ? 'var(--accent-red)' : 'var(--accent-cyan)', transition: 'width 0.3s' }} />
            </div>
          )}
          <span style={{ fontSize: 12, fontWeight: 700, color: overBudget ? 'var(--accent-red)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {totalLogged.toFixed(1)}h{est > 0 ? ` / ${est}h` : ' 已記錄'}
          </span>
        </div>
        <button onClick={() => setAdding(v => !v)} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border-medium)', borderRadius: 5, background: 'none', color: 'var(--accent-cyan)', cursor: 'pointer' }}>
          + 記錄
        </button>
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input type="number" min="0.5" step="0.5" placeholder="小時" value={hours} onChange={e => setHours(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveLog(); if (e.key === 'Escape') setAdding(false) }}
            style={{ width: 70, fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--accent-cyan)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          <input type="text" placeholder="備註（選填）" value={note} onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveLog(); if (e.key === 'Escape') setAdding(false) }}
            style={{ flex: 1, fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border-medium)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          <button className="btn btn-primary" style={{ fontSize: 12, padding: '3px 10px' }} disabled={saving || !hours} onClick={saveLog}>儲存</button>
          <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => setAdding(false)}>取消</button>
        </div>
      )}

      {logs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
          {logs.map(l => (
            <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{l.logged_date}</span>
              <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{Number(l.hours).toFixed(1)}h</span>
              {l.note && <span style={{ flex: 1, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 子任務 Tab ───
function SubtasksTab({ task, linkedChecklists, checklistItemsMap, setChecklistItemsMap, employees = [] }) {
  const [childTasks, setChildTasks] = useState([])
  const [addingChild, setAddingChild] = useState(false)
  const [newChildTitle, setNewChildTitle] = useState('')
  const [newChildAssignee, setNewChildAssignee] = useState('')
  const [savingChild, setSavingChild] = useState(false)

  useEffect(() => {
    if (!task?.id) return
    supabase.from('tasks').select('id,title,status,assignee,due_date').eq('parent_task_id', task.id).order('id')
      .then(({ data }) => setChildTasks(data || []))
  }, [task?.id])

  const addChildTask = async () => {
    if (!newChildTitle.trim()) return
    setSavingChild(true)
    const { data } = await supabase.from('tasks').insert({
      title: newChildTitle.trim(),
      assignee: newChildAssignee || null,
      status: '未開始',
      parent_task_id: task.id,
      store: task.store,
    }).select().single()
    if (data) setChildTasks(prev => [...prev, data])
    setNewChildTitle(''); setNewChildAssignee(''); setAddingChild(false); setSavingChild(false)
  }

  const toggleChildStatus = async (child) => {
    const next = child.status === '已完成' ? '未開始' : '已完成'
    const { data } = await supabase.from('tasks').update({ status: next }).eq('id', child.id).select().single()
    if (data) setChildTasks(prev => prev.map(c => c.id === child.id ? data : c))
  }

  const allItems = linkedChecklists.flatMap(lc =>
    (checklistItemsMap[lc.checklist_id] || []).map(item => ({ ...item, _clId: lc.checklist_id }))
  )
  const childDone = childTasks.filter(c => c.status === '已完成').length
  const totalItems = allItems.length + childTasks.length
  const doneCount = allItems.filter(i => i.checked).length + childDone
  const pct = totalItems > 0 ? Math.round((doneCount / totalItems) * 100) : 0

  const toggleItem = async (item) => {
    const next = !item.checked
    const { error } = await supabase.from('checklist_items').update({ checked: next }).eq('id', item.id)
    if (error) return
    setChecklistItemsMap(prev => ({
      ...prev,
      [item._clId]: (prev[item._clId] || []).map(x => x.id === item.id ? { ...x, checked: next } : x),
    }))
  }

  const hasContent = linkedChecklists.length > 0 || childTasks.length > 0

  if (!hasContent && !addingChild) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>☑️</div>
        <div style={{ marginBottom: 12 }}>尚無子任務或查核清單</div>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setAddingChild(true)}>+ 新增子任務</button>
      </div>
    )
  }

  return (
    <div>
      {/* Progress bar */}
      {totalItems > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            <span>完成進度</span>
            <span style={{ fontWeight: 700, color: pct === 100 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{doneCount} / {totalItems}</span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, transition: 'width 0.3s ease',
              width: `${pct}%`,
              background: pct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)',
            }} />
          </div>
        </div>
      )}

      {/* Child tasks (parent_task_id) */}
      {(childTasks.length > 0 || addingChild) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--accent-cyan)' }}>⊞</span>
            子任務
            <span style={{ fontWeight: 400 }}>({childDone}/{childTasks.length})</span>
            <button onClick={() => setAddingChild(true)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-cyan)', fontSize: 11, padding: '2px 6px' }}>+ 新增</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {childTasks.map(child => (
              <div key={child.id}
                onClick={() => toggleChildStatus(child)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 8, cursor: 'pointer',
                  background: child.status === '已完成' ? 'var(--accent-green-dim)' : 'var(--bg-card)',
                  border: `1px solid ${child.status === '已完成' ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 4, border: `2px solid ${child.status === '已完成' ? 'var(--accent-green)' : 'var(--border-medium)'}`,
                  background: child.status === '已完成' ? 'var(--accent-green)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {child.status === '已完成' && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ flex: 1, fontSize: 13, color: child.status === '已完成' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: child.status === '已完成' ? 'line-through' : 'none' }}>
                  {child.title}
                </span>
                {child.assignee && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>👤 {child.assignee}</span>}
                {child.due_date && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>📅 {child.due_date.slice(5)}</span>}
                <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>tk-{child.id}</span>
              </div>
            ))}
            {addingChild && (
              <div style={{ display: 'flex', gap: 6, padding: '6px 0' }}>
                <input autoFocus value={newChildTitle} onChange={e => setNewChildTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addChildTask(); if (e.key === 'Escape') { setAddingChild(false); setNewChildTitle('') } }}
                  placeholder="子任務標題" className="form-input" style={{ flex: 1, fontSize: 12 }} />
                <select className="form-input" style={{ fontSize: 12, minWidth: 90 }} value={newChildAssignee} onChange={e => setNewChildAssignee(e.target.value)}>
                  <option value="">負責人</option>
                  {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                </select>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '3px 10px' }} disabled={savingChild || !newChildTitle.trim()} onClick={addChildTask}>儲存</button>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => { setAddingChild(false); setNewChildTitle('') }}>取消</button>
              </div>
            )}
          </div>
        </div>
      )}

      {childTasks.length === 0 && !addingChild && linkedChecklists.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <button onClick={() => setAddingChild(true)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: '0 0 8px' }}>
            + 新增子任務
          </button>
        </div>
      )}

      {/* Items grouped by checklist */}
      {linkedChecklists.map(lc => {
        const items = checklistItemsMap[lc.checklist_id] || []
        const clDone = items.filter(i => i.checked).length
        return (
          <div key={lc.checklist_id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--accent-green)' }}>☑</span>
              {lc.name || `清單 #${lc.checklist_id}`}
              <span style={{ fontWeight: 400 }}>({clDone}/{items.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(item => (
                <div key={item.id}
                  onClick={() => toggleItem({ ...item, _clId: lc.checklist_id })}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px',
                    borderRadius: 8, cursor: 'pointer',
                    background: item.checked ? 'var(--accent-green-dim)' : 'var(--bg-card)',
                    border: `1px solid ${item.checked ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: 4, border: `2px solid ${item.checked ? 'var(--accent-green)' : 'var(--border-medium)'}`,
                    background: item.checked ? 'var(--accent-green)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
                  }}>
                    {item.checked && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{
                    fontSize: 13, lineHeight: 1.4,
                    color: item.checked ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: item.checked ? 'line-through' : 'none',
                  }}>
                    {item.content || item.text || item.title || '(無標題)'}
                  </span>
                </div>
              ))}
              {items.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 10px' }}>此清單無項目</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── 綁定表單顯示元件（流程任務內的「需完成事項」清單）───
function TaskFormBindingsBlock({ bindings }) {
  const STATUS_STYLE = {
    '未填':   { bg: 'var(--glass-light)',       color: 'var(--text-muted)',    icon: '⚪' },
    '簽核中': { bg: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', icon: '🔵' },
    '已退回': { bg: 'var(--accent-red-dim)',    color: 'var(--accent-red)',    icon: '❌' },
    '已完成': { bg: 'var(--accent-green-dim)',  color: 'var(--accent-green)',  icon: '✅' },
  }
  // 驗收段（核銷/入庫驗收）對應的「申請段」型別
  const applyTypeFor = (ft) =>
    ft === 'expense_settle' ? 'expense_apply'
    : ft === 'goods_transfer_receipt' ? 'goods_transfer_apply'
    : null
  // 驗收段在「同任務的申請段尚未完成」時鎖定（純 UX；真實 gate 在 DB record 層）
  const isLocked = (b) => {
    const at = applyTypeFor(b.form_type)
    if (!at) return false
    const sib = bindings.find(x => x.form_type === at)
    return sib ? sib.status !== '已完成' : false  // 無對應申請段 → 不鎖（獨立驗收，靠 record gate）
  }
  // 該卡片的動作狀態
  const actionFor = (b) => {
    if (isLocked(b)) return { label: '🔒 申請核准後解鎖', clickable: false }
    if (b.form_type === 'expense_settle')
      return b.form_id ? { label: '→ 去核銷', clickable: true } : { label: '等申請建立', clickable: false }
    if (b.form_type === 'goods_transfer_receipt')
      return b.form_id ? { label: '→ 去驗收', clickable: true } : { label: '等申請建立', clickable: false }
    if (!b.form_id) return { label: '→ 去填寫', clickable: true }
    return { label: '', clickable: false }  // 已認領的整單/申請段 → 只查狀態
  }
  const navTo = (b) => {
    if (!actionFor(b).clickable) return
    let u = null
    if (b.form_type === 'expense_settle') {
      u = b.form_id ? `/process/expense-requests?focus=${b.form_id}&settle=1` : null
    } else if (b.form_type === 'goods_transfer_receipt') {
      u = b.form_id ? `/process/transfer-requests?focus=${b.form_id}&receipt=1` : null
    } else {
      // 申請段 / 整單 / 其他：帶 binding_id 跳轉，submit 時表單頁寫回 linked_binding_id
      u = (b.form_type === 'expense_request' || b.form_type === 'expense_apply') ? `/process/expense-requests?binding_id=${b.id}`
        : b.form_type === 'expense'         ? `/process/expenses?binding_id=${b.id}`
        : b.form_type === 'store_audit'     ? `/process/store-audits?new=1&binding_id=${b.id}`
        : (b.form_type === 'goods_transfer' || b.form_type === 'goods_transfer_apply') ? `/process/transfer-requests?new=1&binding_id=${b.id}`
        : `/process/forms/custom/${b.form_template_id}?binding_id=${b.id}`
    }
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
          const act = actionFor(b)
          const locked = isLocked(b)
          return (
            <div key={b.id} onClick={() => navTo(b)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderRadius: 6, background: 'var(--bg-card)',
                cursor: act.clickable ? 'pointer' : 'default',
                opacity: locked ? 0.6 : 1,
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
                {act.label && (
                  <span style={{ fontSize: 11, color: locked ? 'var(--text-muted)' : 'var(--accent-cyan)', fontWeight: 600 }}>{act.label}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
