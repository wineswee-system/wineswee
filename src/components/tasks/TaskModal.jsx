import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Pencil, Save, Trash2, Bell, Copy, Repeat, Calendar, Activity as ActivityIcon, Info } from 'lucide-react'
import InputModal from '../ui/InputModal'
import SearchableSelect, { empOptions } from '../SearchableSelect'
import {
  updateTask, deleteTask,
  getTaskComments, getTaskAttachments,
  getTaskChecklists, getTaskDependencies,
  getApprovalChains, getApprovalFormByTask, getApprovalFormSteps,
  getTaskConfirmations,
  getChecklistItems,
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { confirm } from '../../lib/confirm'
import { describeRule, materializeNextInstance } from '../../lib/recurrence'
import { notifyWatchers } from '../../lib/mentions'
import ChangelogPanel from '../ChangelogPanel'
import TaskWatchers from './TaskWatchers'
import TaskRelationsTab from './TaskRelationsTab'
import TaskApprovalTab from './TaskApprovalTab'
import TaskDiscussionTab from './TaskDiscussionTab'
import TaskActivity from './TaskActivity'
import { TaskCustomFieldsView } from './CustomFieldsEditor'

const STATUS_LIST = ['未開始', '進行中', '已完成', '已擱置']
const PRIORITY_LIST = ['低', '中', '高']
// 大分類 (bucket) — Chinese names; also normalises legacy English values from DB
const BUCKET_OPTIONS = ['一般工作', '私人工作', '工作流程', '專案']
const normBucket = b => ({ General: '一般工作', Personal: '私人工作', Workflow: '工作流程', Project: '專案' }[b] || b || '一般工作')
// 業務分類 (category) options
const CATEGORY_OPTIONS = ['工作流程', 'HR', '營運', '採購', '展店', '倉管', '財務', '行銷', '客服']

export default function TaskModal({
  task, employees = [], sections = [], stores = [],
  approvalChains: approvalChainsProp = [],
  currentUser, onClose, onChange, onDelete, onDuplicate,
}) {
  const { profile } = useAuth()
  const user = currentUser || profile

  const [form, setForm] = useState({
    title: '', status: '未開始', priority: '中',
    assignee: '', assignee_id: null,
    bucket: '一般工作', category: '', store: '',
    planned_start: '', due_date: '', due_time: '', reminder_at: '',
    section_id: '', recurrence_rule: '',
    notes: '', description: '',
    workflow_instance_id: '', project_id: '',
    approval_chain_id: '',
    confirmation_mode: 'parallel',
  })
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [activeTab, setActiveTab] = useState('basic')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activityRefresh, setActivityRefresh] = useState(0)

  const [comments, setComments] = useState([])
  const [attachments, setAttachments] = useState([])
  const [formBindings, setFormBindings] = useState([])
  const [linkedChecklists, setLinkedChecklists] = useState([])
  const [checklistItemsMap, setChecklistItemsMap] = useState({})
  const [dependencies, setDependencies] = useState([])
  const [approvalChains, setApprovalChains] = useState([])
  const [approvalForm, setApprovalForm] = useState(null)
  const [approvalSteps, setApprovalSteps] = useState([])
  const [approvalPriority, setApprovalPriority] = useState('中')
  const [approvalMode, setApprovalMode] = useState('sequential')
  const [confirmations, setConfirmations] = useState([])
  const [newConfirmApprover, setNewConfirmApprover] = useState('')
  const [newConfirmPriority, setNewConfirmPriority] = useState('中')
  const [allProjects, setAllProjects] = useState([])
  const [allWorkflowInstances, setAllWorkflowInstances] = useState([])
  const [sopTemplates, setSopTemplates] = useState([])
  const [triggeredInstances, setTriggeredInstances] = useState([])

  const [inputModal, setInputModal] = useState({ open: false, title: '', label: '', placeholder: '', required: true, onConfirm: null })
  const openInput = (title, label, onConfirm, { placeholder = '', required = true } = {}) =>
    setInputModal({ open: true, title, label, placeholder, required, onConfirm })
  const closeInput = () => setInputModal(m => ({ ...m, open: false, onConfirm: null }))

  useEffect(() => { setIsDirty(false) }, [task?.id])

  useEffect(() => {
    if (!task) return
    const resolvedId = task.assignee_id
      || (task.assignee ? employees.find(e => e.name === task.assignee)?.id : null)
      || null
    setForm({
      title: task.title || '',
      status: task.status || '未開始',
      priority: task.priority || '中',
      assignee: task.assignee || '',
      assignee_id: resolvedId,
      bucket: normBucket(task.bucket),
      category: task.category || '',
      store: task.store || '',
      planned_start: task.planned_start || '',
      due_date: task.due_date || '',
      due_time: task.due_time || '',
      reminder_at: task.reminder_at || '',
      section_id: task.section_id || '',
      recurrence_rule: task.recurrence_rule || '',
      notes: task.notes || task.description || '',
      description: task.description || task.notes || '',
      workflow_instance_id: task.workflow_instance_id || '',
      project_id: task.project_id || '',
      approval_chain_id: task.approval_chain_id ? String(task.approval_chain_id) : '',
      confirmation_mode: task.confirmation_mode || 'parallel',
    })
    setTitleDraft(task.title || '')
    setEditingTitle(false)

    const safe = (p) => Promise.resolve(p).then(r => r?.error ? { data: null } : r, () => ({ data: null }))
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
      setApprovalChains(ac.data?.length ? ac.data : approvalChainsProp)
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
        getApprovalFormSteps(af.data.id)
          .then(({ data: steps }) => setApprovalSteps(steps || []))
          .catch(() => setApprovalSteps([]))
      } else {
        setApprovalForm(null)
        setApprovalSteps([])
      }
      const linked = cl.data || []
      if (linked.length > 0) {
        Promise.all(linked.map(lc => safe(getChecklistItems(lc.checklist_id)))).then(results => {
          const map = {}
          linked.forEach((lc, i) => { map[lc.checklist_id] = results[i].data || [] })
          setChecklistItemsMap(map)
        })
      }
    }).catch(() => {})
  }, [task?.id, employees]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
  }, [])

  if (!task) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setAndDirty = (k, v) => { set(k, v); setIsDirty(true) }

  const handleClose = async () => {
    if (isDirty && !(await confirm({ message: '有未儲存的變更，確定要離開嗎？' }))) return
    setIsDirty(false)
    onClose?.()
  }

  const handleSave = async () => {
    setSaving(true)
    const prevStatus = task.status
    const payload = {
      title: titleDraft || form.title,
      status: form.status,
      priority: form.priority,
      assignee_id: form.assignee_id ?? employees.find(e => e.name === form.assignee)?.id ?? null,
      assignee: form.assignee || null,
      bucket: form.bucket || null,
      category: form.category || null,
      store: form.store || null,
      planned_start: form.planned_start || null,
      due_date: form.due_date || null,
      due_time: form.due_time || null,
      reminder_at: form.reminder_at || null,
      section_id: form.section_id ? Number(form.section_id) : null,
      recurrence_rule: form.recurrence_rule || null,
      notes: form.notes || null,
      description: form.notes || null,
      workflow_instance_id: form.workflow_instance_id ? Number(form.workflow_instance_id) : null,
      project_id: form.project_id ? Number(form.project_id) : null,
      approval_chain_id: form.approval_chain_id ? Number(form.approval_chain_id) : null,
      confirmation_mode: form.confirmation_mode || 'parallel',
      completed_at: form.status === '已完成' ? (task.completed_at || new Date().toISOString()) : null,
    }
    const { data } = await updateTask(task.id, payload)
    if (data) {
      if (form.status === '已完成' && prevStatus !== '已完成' && data.recurrence_rule) {
        await materializeNextInstance(task.id)
      }
      setIsDirty(false)
      setActivityRefresh(k => k + 1)
      notifyWatchers(task.id, { taskTitle: data.title, action: '任務已更新', actor: user?.name }).catch(() => {})
      onChange?.(data)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!(await confirm({ message: `刪除任務「${task.title}」？` }))) return
    await deleteTask(task.id)
    onDelete?.(task.id)
    onClose?.()
  }

  const setReminder = (type) => {
    if (!form.due_date) return
    const due = new Date(form.due_date + 'T' + (form.due_time || '17:00'))
    let reminder
    if (type === '1hr') reminder = new Date(due.getTime() - 60 * 60 * 1000)
    else if (type === '1day') reminder = new Date(due.getTime() - 24 * 60 * 60 * 1000)
    else reminder = new Date(form.due_date + 'T09:00')
    setAndDirty('reminder_at', reminder.toISOString().slice(0, 16))
  }

  const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, marginTop: 18 }
  const sectionStyle = {
    padding: '16px 20px', marginBottom: 12, borderRadius: 10,
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
  }
  const fieldGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 780, maxHeight: '85vh',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 16,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        overflow: 'hidden', margin: 'auto',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            {task.task_code && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                border: '1px solid rgba(6,182,212,0.2)', flexShrink: 0,
              }}>
                {task.task_code}
              </span>
            )}
            {editingTitle ? (
              <input
                className="form-input"
                value={titleDraft}
                onChange={e => { setTitleDraft(e.target.value); setIsDirty(true) }}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={e => e.key === 'Enter' && setEditingTitle(false)}
                autoFocus
                style={{ fontSize: 18, fontWeight: 800, flex: 1 }}
              />
            ) : (
              <h3
                style={{ margin: 0, fontSize: 18, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={() => setEditingTitle(true)}
              >
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', flexShrink: 0 }}>#{task.id}</span>
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
              <button className="btn btn-sm btn-secondary" title="複製此任務"
                onClick={async () => { await onDuplicate(task); handleClose() }}
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
            { id: 'discussion', label: `討論 (${comments.length})` },
            { id: 'activity',   label: '活動' },
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

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ═══ 基本 Tab ═══ */}
          {activeTab === 'basic' && (
            <>
              <div style={sectionStyle}>
                {/* Row 1: 狀態 / 優先級 / 類型(bucket) / 業務分類(category) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.9fr 0.9fr', gap: 12 }}>
                  <div>
                    <div style={labelStyle}>狀態</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.status}
                      onChange={e => setAndDirty('status', e.target.value)}>
                      {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>優先級</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.priority}
                      onChange={e => setAndDirty('priority', e.target.value)}>
                      {PRIORITY_LIST.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>類型</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.bucket}
                      onChange={e => setAndDirty('bucket', e.target.value)}>
                      {BUCKET_OPTIONS.map(b => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>業務分類</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.category}
                      onChange={e => setAndDirty('category', e.target.value)}>
                      <option value="">未指定</option>
                      {CATEGORY_OPTIONS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                {/* Row 2: 負責人 / 歸屬門市 */}
                <div style={fieldGrid}>
                  <div>
                    <div style={labelStyle}>負責人</div>
                    <SearchableSelect
                      value={form.assignee_id || null}
                      onChange={(v) => {
                        const emp = employees.find(x => String(x.id) === String(v))
                        setForm(f => ({ ...f, assignee_id: emp?.id || null, assignee: emp?.name || '' }))
                        setIsDirty(true)
                      }}
                      options={empOptions(employees, { keyBy: 'id' })}
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

                {/* 工作流 / 專案 已搬到「關聯」tab */}

                {/* 所在欄位（如有） */}
                {sections.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={labelStyle}>所在欄位</div>
                    <select className="form-input" style={{ width: '100%' }} value={form.section_id || ''}
                      onChange={e => setAndDirty('section_id', e.target.value || null)}>
                      <option value="">（無）</option>
                      {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Date section */}
              <div style={sectionStyle}>
                <div style={fieldGrid}>
                  <div>
                    <div style={labelStyle}>計畫開始日</div>
                    <input className="form-input" type="date" style={{ width: '100%' }}
                      value={form.planned_start} onChange={e => setAndDirty('planned_start', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={labelStyle}>截止日</div>
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
                      {task.completed_at ? task.completed_at.replace('T', ' ').slice(0, 16) : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 綁定表單已搬到「關聯」tab */}

              {/* Recurrence */}
              <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)' }}>
                  <Repeat size={14} /> 週期性
                </div>
                <select className="form-input" style={{ width: '100%' }} value={form.recurrence_rule}
                  onChange={e => setAndDirty('recurrence_rule', e.target.value)}>
                  {[
                    { value: '', label: '不重複' },
                    { value: 'FREQ=DAILY', label: '每天' },
                    { value: 'FREQ=WEEKLY', label: '每週' },
                    { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: '工作日' },
                    { value: 'FREQ=MONTHLY', label: '每月' },
                  ].map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {form.recurrence_rule && (
                  <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 6, fontWeight: 600 }}>
                    <Calendar size={10} style={{ display: 'inline', marginRight: 3 }} />
                    {describeRule(form.recurrence_rule)} · 完成後自動建立下次
                  </div>
                )}
              </div>

              {/* Notes / description */}
              <div style={sectionStyle}>
                <div style={{ ...labelStyle, marginTop: 0 }}>備註 / 說明</div>
                <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }}
                  placeholder="備註或說明..."
                  value={form.notes}
                  onChange={e => { setAndDirty('notes', e.target.value); setAndDirty('description', e.target.value) }}
                />
              </div>

              {/* Watchers */}
              <TaskWatchers taskId={task.id} employees={employees} currentUser={user}
                onChange={() => setActivityRefresh(k => k + 1)} />

              {/* Custom fields */}
              {form.project_id && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>自訂欄位</div>
                  <TaskCustomFieldsView taskId={task.id} projectId={Number(form.project_id)} employees={employees} />
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                ID: {task.id} &nbsp;&nbsp; 建立: {task.created_at?.slice(0, 10)}
              </div>
            </>
          )}

          {/* ═══ 關聯 Tab ═══ */}
          {activeTab === 'relations' && (
            <TaskRelationsTab
              task={task}
              checklists={[]}
              linkedChecklists={linkedChecklists}
              setLinkedChecklists={setLinkedChecklists}
              checklistItemsMap={checklistItemsMap}
              setChecklistItemsMap={setChecklistItemsMap}
              dependencies={dependencies}
              setDependencies={setDependencies}
              allSteps={[]}
              sopTemplates={sopTemplates}
              triggeredInstances={triggeredInstances}
              setTriggeredInstances={setTriggeredInstances}
              // ── 新增：綁定表單 + 工作流 / 專案 ──
              formBindings={formBindings}
              setFormBindings={setFormBindings}
              form={form}
              setAndDirty={setAndDirty}
              allWorkflowInstances={allWorkflowInstances}
              allProjects={allProjects}
            />
          )}

          {/* ═══ 簽核 Tab ═══ */}
          {activeTab === 'approval' && (
            <TaskApprovalTab
              task={task}
              profile={user}
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
              onUpdate={onChange}
            />
          )}

          {/* ═══ 討論 Tab ═══ */}
          {activeTab === 'discussion' && (
            <TaskDiscussionTab
              task={task}
              profile={user}
              attachments={attachments}
              setAttachments={setAttachments}
              comments={comments}
              setComments={setComments}
              openInput={openInput}
              closeInput={closeInput}
            />
          )}

          {/* ═══ 活動 Tab ═══ */}
          {activeTab === 'activity' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 12 }}>
                <ActivityIcon size={14} /> 活動紀錄
              </div>
              <TaskActivity taskId={task.id} refreshKey={activityRefresh} />
              <div style={{ marginTop: 24 }}>
                <ChangelogPanel
                  tables={['tasks']}
                  targetId={task?.id}
                  orgId={user?.organization_id}
                  currentUser={user?.name}
                />
              </div>
            </>
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
