import { useState, useEffect, useRef } from 'react'
import { ModalOverlay } from './Modal'
import { createPortal } from 'react-dom'
import { X, Pencil, Save, Trash2, Upload, Clock, Bell, Check } from 'lucide-react'
import {
  updateTask, deleteTask,
  getTaskComments, createTaskComment,
  getTaskAttachments, createTaskAttachment, deleteTaskAttachment,
  getTaskChecklists, linkTaskChecklist, unlinkTaskChecklist,
  getTaskDependencies, createTaskDependency, deleteTaskDependency,
  getChecklistItems, updateChecklistItem,
  getApprovalChains,
  getApprovalFormByTask, createApprovalForm, updateApprovalForm,
  getApprovalFormSteps, createApprovalFormSteps, updateApprovalFormStep,
} from '../lib/db'
import { supabase } from '../lib/supabase'
import { notifyApproval } from '../lib/lineNotify'

const STATUS_LIST = ['待處理', '進行中', '已完成', '已擱置']
const PRIORITY_LIST = ['低', '中', '高']

export default function TaskDetailPanel({
  step: task, instance, allSteps, employees, stores, checklists,
  onUpdate, onDelete, onClose,
}) {
  const [form, setForm] = useState({})
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [showTime, setShowTime] = useState(false)

  // Sub-data
  const [comments, setComments] = useState([])
  const [attachments, setAttachments] = useState([])
  const [linkedChecklists, setLinkedChecklists] = useState([])
  const [checklistItemsMap, setChecklistItemsMap] = useState({}) // { checklistId: items[] }
  const [dependencies, setDependencies] = useState([])
  const [approvalChains, setApprovalChains] = useState([])
  const [approvalForm, setApprovalForm] = useState(null)
  const [approvalSteps, setApprovalSteps] = useState([])
  const [commentText, setCommentText] = useState('')
  const [saving, setSaving] = useState(false)
  const commentsEndRef = useRef(null)

  useEffect(() => {
    if (!task) return
    setForm({
      status: task.status || '待處理',
      priority: task.priority || '中',
      assignee: task.assignee || '',
      store: task.store || '',
      category: task.category || 'Workflow',
      planned_start: task.planned_start || '',
      due_date: task.due_date || '',
      due_time: task.due_time || '',
      reminder_at: task.reminder_at || '',
      approval_chain_id: task.approval_chain_id || '',
      notes: task.notes || '',
    })
    setTitleDraft(task.title)
    setShowTime(!!task.due_time)
    setEditingTitle(false)

    Promise.all([
      getTaskComments(task.id),
      getTaskAttachments(task.id),
      getTaskChecklists(task.id),
      getTaskDependencies(task.id),
      getApprovalChains(),
      getApprovalFormByTask(task.id),
    ]).then(([c, a, cl, d, ac, af]) => {
      setComments(c.data || [])
      setAttachments(a.data || [])
      setLinkedChecklists(cl.data || [])
      setDependencies(d.data || [])
      setApprovalChains(ac.data || [])
      // Load approval form & steps
      if (af.data) {
        setApprovalForm(af.data)
        getApprovalFormSteps(af.data.id).then(({ data: steps }) => setApprovalSteps(steps || []))
      } else {
        setApprovalForm(null)
        setApprovalSteps([])
      }
      // Load items for each linked checklist
      const linked = cl.data || []
      if (linked.length > 0) {
        Promise.all(linked.map(lc => getChecklistItems(lc.checklist_id)))
          .then(results => {
            const map = {}
            linked.forEach((lc, i) => { map[lc.checklist_id] = results[i].data || [] })
            setChecklistItemsMap(map)
          })
      } else {
        setChecklistItemsMap({})
      }
    })
  }, [task?.id])

  // Lock body scroll when modal is open
  useEffect(() => {
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
  }, [])

  // Dirty state: track if user made changes
  const [isDirty, setIsDirty] = useState(false)
  useEffect(() => { setIsDirty(false) }, [step?.id])
  const setAndDirty = (k, v) => { set(k, v); setIsDirty(true) }

  const handleClose = () => {
    if (isDirty && !confirm('有未儲存的變更，確定要離開嗎？')) return
    onClose()
  }

  // Only auto-scroll comments when user adds a new one (not on initial load)
  const initialLoad = useRef(true)
  useEffect(() => {
    if (initialLoad.current) { initialLoad.current = false; return }
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments.length])

  if (!task) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    const payload = {
      ...form,
      title: titleDraft,
      planned_start: form.planned_start || null,
      due_date: form.due_date || null,
      due_time: form.due_time || null,
      reminder_at: form.reminder_at || null,
      approval_chain_id: form.approval_chain_id ? Number(form.approval_chain_id) : null,
      completed_at: form.status === '已完成' ? (task.completed_at || new Date().toISOString()) : null,
    }
    const { data } = await updateTask(task.id, payload)
    if (data) { onUpdate(data); setIsDirty(false) }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirm('確定刪除此任務？')) return
    await deleteTask(task.id)
    onDelete(task.id)
  }

  // ── Approval (簽核) ──
  const handleStartApproval = async (chainId) => {
    if (!chainId) return
    const chain = approvalChains.find(c => c.id === Number(chainId))
    if (!chain) return
    const { data: form } = await createApprovalForm({
      title: `${task.title} — 簽核`,
      applicant: task.assignee || '系統',
      chain_id: chain.id,
      ref_task_id: task.id,
      status: '簽核中',
      current_step: 0,
    })
    if (!form) return
    setApprovalForm(form)
    // Create steps from chain
    const stepRows = (chain.steps || []).map((s, i) => ({
      form_id: form.id,
      step_order: i + 1,
      role: s.role,
      status: i === 0 ? '待簽' : '等待中',
    }))
    const { data: steps } = await createApprovalFormSteps(stepRows)
    setApprovalSteps(steps || [])
    // Notify: step.role now stores the employee name directly
    const firstStep = chain.steps?.[0]
    if (firstStep?.role) {
      notifyApproval(firstStep.role, task.title, `第 1 關：${firstStep.label || firstStep.role}`)
    }
  }

  const handleApprovalAction = async (formStepId, action, comment) => {
    const newStatus = action === 'approve' ? '已核准' : '已退回'
    const currentUser = task.assignee || instance?.assignee || '系統'
    const { data } = await updateApprovalFormStep(formStepId, {
      status: newStatus,
      approver: currentUser,
      comment: comment || null,
      acted_at: new Date().toISOString(),
    })
    if (!data) return
    const updated = approvalSteps.map(s => s.id === formStepId ? data : s)
    setApprovalSteps(updated)

    if (action === 'approve') {
      // Advance to next step
      const nextStep = updated.find(s => s.status === '等待中')
      if (nextStep) {
        const { data: ns } = await updateApprovalFormStep(nextStep.id, { status: '待簽' })
        if (ns) setApprovalSteps(prev => prev.map(s => s.id === ns.id ? ns : s))
        await updateApprovalForm(approvalForm.id, { current_step: nextStep.step_order })
      } else {
        // All approved
        const { data: f } = await updateApprovalForm(approvalForm.id, {
          status: '已通過', completed_at: new Date().toISOString(),
        })
        if (f) setApprovalForm(f)
      }
    } else {
      // Rejected
      const { data: f } = await updateApprovalForm(approvalForm.id, { status: '已退回' })
      if (f) setApprovalForm(f)
    }
  }

  // Comments
  const handleSendComment = async () => {
    if (!commentText.trim()) return
    const { data } = await createTaskComment({ task_id: task.id, author: '使用者', content: commentText.trim() })
    if (data) setComments(prev => [...prev, data])
    setCommentText('')
  }

  // Toggle checklist item (from linked checklist)
  const handleToggleLinkedItem = async (item) => {
    const { data } = await updateChecklistItem(item.id, { checked: !item.checked })
    if (data) {
      const updatedItems = (checklistItemsMap[item.checklist_id] || []).map(i => i.id === item.id ? data : i)
      setChecklistItemsMap(prev => ({ ...prev, [item.checklist_id]: updatedItems }))
      // Persist completed count to checklists table
      const completed = updatedItems.filter(i => i.checked).length
      await supabase.from('checklists').update({ completed }).eq('id', item.checklist_id)
    }
  }

  // Checklists link
  const handleLinkChecklist = async (checklistId) => {
    if (!checklistId) return
    const { data } = await linkTaskChecklist(task.id, Number(checklistId))
    if (data) {
      const cl = checklists.find(c => c.id === Number(checklistId))
      setLinkedChecklists(prev => [...prev, { ...data, checklists: cl }])
    }
  }

  const handleUnlinkChecklist = async (linkId) => {
    await unlinkTaskChecklist(linkId)
    setLinkedChecklists(prev => prev.filter(l => l.id !== linkId))
  }

  // Dependencies
  const otherSteps = allSteps.filter(s => s.id !== task.id)
  const prerequisites = dependencies.filter(d => d.task_id === task.id && d.dep_type === 'prerequisite')
  const triggers = dependencies.filter(d => d.task_id === task.id && d.dep_type === 'trigger')

  const handleAddDep = async (depTaskId, type) => {
    if (!depTaskId) return
    const { data } = await createTaskDependency({ task_id: task.id, depends_on_task_id: Number(depTaskId), dep_type: type })
    if (data) setDependencies(prev => [...prev, data])
  }

  const handleRemoveDep = async (depId) => {
    await deleteTaskDependency(depId)
    setDependencies(prev => prev.filter(d => d.id !== depId))
  }

  // Reminder quick set
  const setReminder = (type) => {
    if (!form.due_date) return
    const due = new Date(form.due_date + 'T' + (form.due_time || '17:00'))
    let reminder
    if (type === '1hr') reminder = new Date(due.getTime() - 60 * 60 * 1000)
    else if (type === '1day') reminder = new Date(due.getTime() - 24 * 60 * 60 * 1000)
    else reminder = new Date(form.due_date + 'T09:00')
    set('reminder_at', reminder.toISOString().slice(0, 16))
  }

  const getStepLabel = (id) => {
    const s = allSteps.find(x => x.id === id)
    return s ? `${s.step_order}. ${s.title}` : `#${id}`
  }

  const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, marginTop: 18 }
  const sectionStyle = {
    padding: '16px 20px', marginBottom: 12, borderRadius: 10,
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
  }
  const fieldGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }

  return (
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
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, cursor: 'pointer' }}
                onClick={() => setEditingTitle(true)}>
                {titleDraft}
                <Pencil size={14} style={{ marginLeft: 8, color: 'var(--accent-orange)', verticalAlign: 'middle' }} />
              </h3>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 13 }}>
              <Save size={13} /> {saving ? '...' : '更新'}
            </button>
            <button className="btn btn-sm btn-secondary" onClick={handleDelete}
              style={{ color: 'var(--accent-red)', padding: '6px 8px' }}>
              <Trash2 size={15} />
            </button>
            <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Body (scrollable) ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ═══ Section: Basic Fields ═══ */}
          <div style={sectionStyle}>
            <div style={fieldGrid}>
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
            </div>

            <div style={fieldGrid}>
              <div>
                <div style={labelStyle}>負責人</div>
                <select className="form-input" style={{ width: '100%' }} value={form.assignee}
                  onChange={e => setAndDirty('assignee', e.target.value)}>
                  <option value="">未指定</option>
                  {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                </select>
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
                <input className="form-input" style={{ width: '100%' }} readOnly
                  value={instance?.store || instance?.template_name || ''} />
              </div>
              <div>
                <div style={labelStyle}>分類</div>
                <select className="form-input" style={{ width: '100%' }} value={form.category}
                  onChange={e => setAndDirty('category', e.target.value)}>
                  {['Workflow', 'HR', '營運', '採購', '展店', '倉管', '財務', '行銷'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ═══ Section: Dates & Time ═══ */}
          <div style={sectionStyle}>
            <div style={fieldGrid}>
              <div>
                <div style={labelStyle}>計畫開始日</div>
                <input className="form-input" type="date" style={{ width: '100%' }}
                  value={form.planned_start} onChange={e => setAndDirty('planned_start', e.target.value)} />
              </div>
              <div>
                <div style={labelStyle}>計畫完成日</div>
                <input className="form-input" type="date" style={{ width: '100%' }}
                  value={form.due_date} onChange={e => setAndDirty('due_date', e.target.value)} />
              </div>
            </div>

            {!showTime ? (
              <button onClick={() => setShowTime(true)} style={{
                background: 'none', border: 'none', color: 'var(--accent-cyan)',
                fontSize: 12, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4, marginTop: 10,
              }}>
                <Clock size={13} /> 設定時間
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <input className="form-input" type="time" value={form.due_time}
                  onChange={e => setAndDirty('due_time', e.target.value)} style={{ width: 160 }} />
                <button onClick={() => { setShowTime(false); setAndDirty('due_time', '') }} style={{
                  background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer',
                }}><X size={16} /></button>
              </div>
            )}

            <div style={labelStyle}>
              <Bell size={13} style={{ verticalAlign: 'middle', color: 'var(--accent-red)' }} /> 提醒時間
            </div>
            <input className="form-input" type="datetime-local" style={{ width: '100%' }}
              value={form.reminder_at ? form.reminder_at.slice(0, 16) : ''}
              onChange={e => setAndDirty('reminder_at', e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {[
                { label: '到期前1hr', type: '1hr' },
                { label: '到期前1天', type: '1day' },
                { label: '當天09:00', type: 'morning' },
              ].map(r => (
                <button key={r.type} onClick={() => setReminder(r.type)} style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: '1px solid var(--border-medium)', background: 'var(--bg-card)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}>{r.label}</button>
              ))}
            </div>
          </div>

          {/* ═══ Section: Approval ═══ */}
          <div style={sectionStyle}>
            <div style={labelStyle}>🔐 確認審批</div>
            <select className="form-input" style={{ width: '100%' }} value={form.approval_chain_id}
              onChange={e => setAndDirty('approval_chain_id', e.target.value)}>
              <option value="">＋ 新增審批</option>
              {approvalChains.map(ac => <option key={ac.id} value={ac.id}>{ac.name}</option>)}
            </select>
          </div>

          {/* ═══ Section: 清單設定 (select existing checklists) ═══ */}
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📋 清單設定 ({linkedChecklists.length})</span>
            </div>

            {/* Linked checklists with their items */}
            {linkedChecklists.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>尚無關聯清單，請從下方選擇</div>
            ) : linkedChecklists.map(lc => {
              const clItems = checklistItemsMap[lc.checklist_id] || []
              const clChecked = clItems.filter(i => i.checked).length
              const clTotal = clItems.length
              return (
                <div key={lc.id} style={{
                  marginBottom: 10, borderRadius: 8,
                  border: '1px solid var(--border-subtle)', overflow: 'hidden',
                }}>
                  {/* Checklist header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: 'var(--glass-light)',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {lc.checklists?.name || `清單 #${lc.checklist_id}`}
                      {clTotal > 0 && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>({clChecked}/{clTotal})</span>}
                    </span>
                    <button onClick={() => handleUnlinkChecklist(lc.id)} style={{
                      background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 11,
                    }}>移除</button>
                  </div>

                  {/* Progress bar */}
                  {clTotal > 0 && (
                    <div style={{ padding: '4px 12px 0' }}>
                      <div style={{ height: 4, borderRadius: 2, background: 'var(--border-medium)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 2,
                          width: `${Math.round(clChecked / clTotal * 100)}%`,
                          background: clChecked === clTotal ? 'var(--accent-green)' : 'var(--accent-cyan)',
                        }} />
                      </div>
                    </div>
                  )}

                  {/* Items */}
                  <div style={{ padding: '8px 12px' }}>
                    {clItems.map(item => (
                      <div key={item.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                      }}>
                        <button onClick={() => handleToggleLinkedItem(item)} style={{
                          width: 20, height: 20, borderRadius: 4,
                          border: `2px solid ${item.checked ? 'var(--accent-green)' : 'var(--border-medium)'}`,
                          background: item.checked ? 'var(--accent-green)' : 'transparent',
                          color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, padding: 0,
                        }}>
                          {item.checked && <Check size={12} />}
                        </button>
                        <span style={{
                          fontSize: 12,
                          textDecoration: item.checked ? 'line-through' : 'none',
                          color: item.checked ? 'var(--text-muted)' : 'var(--text-primary)',
                        }}>{item.title}</span>
                      </div>
                    ))}
                    {clItems.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>此清單尚無項目，請到「查核清單」頁面新增</div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Select existing checklist */}
            <select className="form-input" style={{ width: '100%', fontSize: 12 }}
              value="" onChange={e => {
                const id = e.target.value
                if (!id) return
                handleLinkChecklist(id).then(() => {
                  // Load items for newly linked checklist
                  getChecklistItems(Number(id)).then(({ data }) => {
                    setChecklistItemsMap(prev => ({ ...prev, [Number(id)]: data || [] }))
                  })
                })
              }}>
              <option value="">＋ 選擇已建立的清單...</option>
              {(checklists || []).filter(c => !linkedChecklists.some(lc => lc.checklist_id === c.id))
                .map(c => <option key={c.id} value={c.id}>{c.name} ({c.completed}/{c.items})</option>)}
            </select>
          </div>

          {/* ═══ Section: Notes ═══ */}
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, marginTop: 0 }}>備註</div>
            <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }}
              placeholder="備註..." value={form.notes} onChange={e => setAndDirty('notes', e.target.value)} />
          </div>

          {/* ID & Created */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
            ID: {task.id} &nbsp;&nbsp; 建立: {task.created_at?.slice(0, 10)}
            {task.confirmation_status === 'approved' && <span style={{ marginLeft: 12, color: 'var(--accent-green)' }}>✅ {task.confirmation_responded_at?.slice(0, 10)}</span>}
          </div>

          {/* ═══ Section: Prerequisites ═══ */}
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, marginTop: 0 }}>🔒 前置條件（全部完成後才開始）</div>
            {prerequisites.map(d => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: 'var(--glass-light)', borderRadius: 8, marginBottom: 4,
                border: '1px solid var(--border-subtle)', fontSize: 13,
              }}>
                <span style={{ flex: 1 }}>→ {getStepLabel(d.depends_on_task_id)}</span>
                <button onClick={() => handleRemoveDep(d.id)} style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                }}><X size={14} /></button>
              </div>
            ))}
            <select className="form-input" style={{ width: '100%', fontSize: 12 }}
              value="" onChange={e => handleAddDep(e.target.value, 'prerequisite')}>
              <option value="">＋ 新增前置條件...</option>
              {otherSteps.filter(s => !prerequisites.some(p => p.depends_on_task_id === s.id))
                .map(s => <option key={s.id} value={s.id}>{s.step_order}. {s.title}</option>)}
            </select>
          </div>

          {/* ═══ Section: Triggers ═══ */}
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, marginTop: 0 }}>⚠️ 觸發動作（完成時執行）</div>
            {triggers.map(d => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: 'var(--glass-light)', borderRadius: 8, marginBottom: 4,
                border: '1px solid var(--border-subtle)', fontSize: 13,
              }}>
                <span style={{ flex: 1 }}>→ {getStepLabel(d.depends_on_task_id)}</span>
                <button onClick={() => handleRemoveDep(d.id)} style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                }}><X size={14} /></button>
              </div>
            ))}
            <select className="form-input" style={{ width: '100%', fontSize: 12 }}
              value="" onChange={e => handleAddDep(e.target.value, 'trigger')}>
              <option value="">＋ 新增觸發任務...</option>
              {otherSteps.filter(s => !triggers.some(t => t.depends_on_task_id === s.id))
                .map(s => <option key={s.id} value={s.id}>{s.step_order}. {s.title}</option>)}
            </select>
          </div>

          {/* ═══ Section: Attachments ═══ */}
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📎 附件 ({attachments.length})</span>
              <button className="btn btn-sm btn-secondary" style={{ fontSize: 11 }}
                onClick={() => {
                  const url = prompt('輸入檔案 URL:')
                  const name = prompt('檔案名稱:')
                  if (url && name) {
                    createTaskAttachment({ task_id: task.id, file_name: name, file_url: url, uploaded_by: '使用者' })
                      .then(({ data }) => { if (data) setAttachments(prev => [...prev, data]) })
                  }
                }}>
                <Upload size={11} /> 上傳
              </button>
            </div>
            {attachments.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無附件</div>
            ) : attachments.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', background: 'var(--glass-light)', borderRadius: 8,
                marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 12,
              }}>
                <a href={a.file_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)' }}>
                  📄 {a.file_name}
                </a>
                <button onClick={async () => {
                  await deleteTaskAttachment(a.id)
                  setAttachments(prev => prev.filter(x => x.id !== a.id))
                }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* ═══ Section: Approval (簽核系統) ═══ */}
          <div style={{
            ...sectionStyle,
            border: '2px solid var(--accent-purple)',
            background: 'linear-gradient(135deg, var(--bg-card), rgba(139,92,246,0.05))',
          }}>
            <div style={{ ...labelStyle, marginTop: 0, color: 'var(--accent-purple)', fontSize: 14 }}>
              🔏 簽核流程
            </div>

            {!approvalForm ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>尚未啟動簽核，選擇簽核鏈開始</div>
                <select className="form-input" style={{ width: '100%', fontSize: 13 }}
                  value="" onChange={e => handleStartApproval(e.target.value)}>
                  <option value="">＋ 選擇簽核鏈...</option>
                  {approvalChains.map(ac => (
                    <option key={ac.id} value={ac.id}>
                      {ac.name} ({(ac.steps || []).length} 關)
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                {/* Form status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                    background: approvalForm.status === '已通過' ? 'var(--accent-green-dim)' :
                      approvalForm.status === '已退回' ? 'rgba(239,68,68,0.1)' : 'var(--accent-purple-dim, rgba(139,92,246,0.15))',
                    color: approvalForm.status === '已通過' ? 'var(--accent-green)' :
                      approvalForm.status === '已退回' ? 'var(--accent-red)' : 'var(--accent-purple, #8b5cf6)',
                    border: `1px solid ${approvalForm.status === '已通過' ? 'rgba(52,211,153,0.3)' :
                      approvalForm.status === '已退回' ? 'rgba(239,68,68,0.3)' : 'rgba(139,92,246,0.3)'}`,
                  }}>
                    {approvalForm.status === '已通過' ? '✅ 已通過' : approvalForm.status === '已退回' ? '❌ 已退回' : '⏳ 簽核中'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    申請人：{approvalForm.applicant}
                  </span>
                </div>

                {/* Steps timeline */}
                <div style={{ position: 'relative', paddingLeft: 24 }}>
                  {/* Vertical line */}
                  <div style={{
                    position: 'absolute', left: 9, top: 8, bottom: 8, width: 2,
                    background: 'var(--border-medium)',
                  }} />

                  {approvalSteps.map((as, i) => {
                    const isActive = as.status === '待簽'
                    const isDone = as.status === '已核准'
                    const isRejected = as.status === '已退回'
                    return (
                      <div key={as.id} style={{ position: 'relative', marginBottom: 16 }}>
                        {/* Dot */}
                        <div style={{
                          position: 'absolute', left: -24, top: 2,
                          width: 18, height: 18, borderRadius: '50%',
                          background: isDone ? 'var(--accent-green)' : isRejected ? 'var(--accent-red)' :
                            isActive ? 'var(--accent-purple, #8b5cf6)' : 'var(--border-medium)',
                          border: isActive ? '3px solid rgba(139,92,246,0.3)' : 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 10, zIndex: 1,
                        }}>
                          {isDone ? '✓' : isRejected ? '✗' : i + 1}
                        </div>

                        {/* Content */}
                        <div style={{
                          padding: '10px 14px', borderRadius: 10,
                          background: isActive ? 'rgba(139,92,246,0.08)' : 'var(--glass-light)',
                          border: `1px solid ${isActive ? 'rgba(139,92,246,0.3)' : 'var(--border-subtle)'}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>
                                第 {as.step_order} 關：{as.role || '審核者'}
                              </div>
                              {as.approver && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                  👤 {as.approver} · {as.acted_at ? new Date(as.acted_at).toLocaleString('zh-TW') : ''}
                                </div>
                              )}
                              {as.comment && (
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                                  💬 {as.comment}
                                </div>
                              )}
                            </div>
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                              background: isDone ? 'var(--accent-green-dim)' : isRejected ? 'rgba(239,68,68,0.1)' :
                                isActive ? 'rgba(139,92,246,0.15)' : 'var(--glass-light)',
                              color: isDone ? 'var(--accent-green)' : isRejected ? 'var(--accent-red)' :
                                isActive ? 'var(--accent-purple, #8b5cf6)' : 'var(--text-muted)',
                            }}>
                              {as.status}
                            </span>
                          </div>

                          {/* Action buttons for active step */}
                          {isActive && approvalForm.status === '簽核中' && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                              <button
                                className="btn btn-sm"
                                style={{
                                  background: 'var(--accent-green)', color: '#fff', border: 'none',
                                  padding: '6px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                                }}
                                onClick={() => {
                                  const comment = prompt('審核意見（可留空）：')
                                  handleApprovalAction(as.id, 'approve', comment)
                                }}
                              >
                                ✅ 核准
                              </button>
                              <button
                                className="btn btn-sm"
                                style={{
                                  background: 'var(--accent-red)', color: '#fff', border: 'none',
                                  padding: '6px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                                }}
                                onClick={() => {
                                  const comment = prompt('退回原因：')
                                  if (comment) handleApprovalAction(as.id, 'reject', comment)
                                }}
                              >
                                ❌ 退回
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* ═══ Section: Comments ═══ */}
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, marginTop: 0 }}>💬 備註 ({comments.length})</div>
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
              {comments.map(c => (
                <div key={c.id} style={{
                  padding: '8px 12px', marginBottom: 6, borderRadius: 8,
                  background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)' }}>⚙️ {c.author}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(c.created_at).toLocaleString('zh-TW')}
                    </span>
                  </div>
                  <div style={{ fontSize: 13 }}>🚩 {c.content}</div>
                </div>
              ))}
              <div ref={commentsEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" type="text" style={{ flex: 1 }}
                placeholder="輸入備註..."
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendComment()} />
              <button className="btn btn-primary" onClick={handleSendComment}
                style={{ fontSize: 12, padding: '8px 14px' }}>
                送出
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
