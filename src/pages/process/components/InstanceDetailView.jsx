import { useState, useEffect } from 'react'
import { toast } from '../../../lib/toast'
import {
  Plus, Pencil, ChevronLeft, MoreVertical, Archive, Trash2,
  Users, User, ClipboardList, FolderOpen, ShieldCheck, ShieldX, X, GripVertical, GitBranch, LayoutDashboard
} from 'lucide-react'
import { updateTask } from '../../../lib/db'
import TaskContextMenu from '../../../components/ui/TaskContextMenu'
import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import TaskDetailPanel from '../../../components/TaskDetailPanel'
import BoundFormsField from '../../../components/tasks/BoundFormsField'
import WorkflowDagView from '../../../components/tasks/WorkflowDagView'

const STATUS_LIST = ['未開始', '待簽核', '進行中', '待確認', '已完成', '已退回', '已擱置']

const STATUS_CONFIG = {
  '未開始': { color: 'var(--text-muted)', bg: 'var(--glass-light)' },
  '待簽核': { color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
  '進行中': { color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)' },
  '待確認': { color: 'var(--accent-purple)', bg: 'var(--accent-purple-dim)' },
  '已完成': { color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
  '已退回': { color: 'var(--accent-red)', bg: 'var(--accent-red-dim)' },
  '已擱置': { color: 'var(--accent-red)', bg: 'var(--accent-red-dim)' },
}
// 任何 STATUS_CONFIG 沒對到的 status 都 fallback 到「未開始」（避免 sc.color 讀 undefined 崩）
const FALLBACK_STATUS = STATUS_CONFIG['未開始']

// ── Quick-add inline row at bottom of step table ──
function QuickAddRow({ inst, employees, onDirectSave }) {
  const [active, setActive] = useState(false)
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  const reset = () => { setTitle(''); setAssignee(''); setDueDate(''); setActive(false) }

  const save = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      await onDirectSave({ title: title.trim(), assignee, due_date: dueDate })
      reset()
    } catch (err) {
      const { toast } = await import('../../../lib/toast')
      toast.error('新增失敗：' + (err?.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  if (!active) {
    return (
      <tr>
        <td colSpan={8} style={{ padding: '6px 12px' }}>
          <button
            onClick={() => setActive(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-cyan)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <Plus size={13} /> 快速新增任務
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr style={{ background: 'var(--accent-cyan-dim)', borderLeft: '3px solid var(--accent-cyan)' }}>
      <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>—</td>
      <td colSpan={2}>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') reset() }}
          placeholder="任務名稱（Enter 儲存 · Esc 取消）"
          style={{ width: '100%', fontSize: 13, padding: '4px 6px', borderRadius: 5, border: '1.5px solid var(--accent-cyan)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
        />
      </td>
      <td>
        <select className="form-input" style={{ fontSize: 11, padding: '3px 4px' }}
          value={assignee} onChange={e => setAssignee(e.target.value)}>
          <option value="">— 負責人 —</option>
          {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
        </select>
      </td>
      <td>{inst.store || '—'}</td>
      <td></td>
      <td>
        <input type="date" className="form-input" style={{ fontSize: 11, padding: '3px 4px' }}
          value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </td>
      <td colSpan={2} style={{ whiteSpace: 'nowrap' }}>
        <button className="btn btn-primary" style={{ fontSize: 11, padding: '3px 10px' }} disabled={saving || !title.trim()} onClick={save}>
          {saving ? '…' : '儲存'}
        </button>
        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px', marginLeft: 4 }} onClick={reset}>取消</button>
      </td>
    </tr>
  )
}

export default function InstanceDetailView({
  inst, instSteps, stats, employees, stores, checklists, projects = [], lineGroups = [],
  approvalChains = [],
  currentUser = '', isAdmin = false, isSuperAdmin = false,
  // Modal states
  showNotesModal, notesStep, notesText, setNotesText, setShowNotesModal, setNotesStep,
  showAddTaskModal, taskForm, setTaskForm, setShowAddTaskModal,
  showEditModal, editForm, setEditForm, setShowEditModal,
  selectedStep, setSelectedStep,
  // Handlers
  onClose, onStatusChange, onConfirmTask, onSaveNotes, onAddTask, onEditInstance,
  onStepUpdate, onStepDelete, onStepDuplicate,
  onArchive, onDelete,
  onChainApprove,
  onStepReorder,
}) {
  const [confirmModal, setConfirmModal] = useState({ open: false, step: null, reason: '' })
  const [menuOpen, setMenuOpen] = useState(false)
  const [chainRejectReason, setChainRejectReason] = useState('')
  const [chainRejectOpen, setChainRejectOpen] = useState(false)
  const [chainBusy, setChainBusy] = useState(false)
  const [addTaskErrors, setAddTaskErrors] = useState({})
  const [dragStepId, setDragStepId] = useState(null)
  const [dragOverStepId, setDragOverStepId] = useState(null)
  const [activeTab, setActiveTab] = useState('steps')  // 'steps' | 'dag' | 'board'
  const [boardDragId, setBoardDragId] = useState(null)
  const [boardDragSrcStatus, setBoardDragSrcStatus] = useState(null)
  const [boardOverCol, setBoardOverCol] = useState(null)
  const [editingTitleId, setEditingTitleId] = useState(null)
  const [editingTitleVal, setEditingTitleVal] = useState('')
  const [titleSaving, setTitleSaving] = useState(false)
  const [ctxMenu, setCtxMenu] = useState(null) // { task, x, y }
  const [editingAssigneeId, setEditingAssigneeId] = useState(null)
  const [editingDueDateId, setEditingDueDateId] = useState(null)

  const handleAddTask = () => {
    const errs = {}
    if (!taskForm.title?.trim()) errs.title = '任務名稱為必填'
    if (!taskForm.due_date) errs.due_date = '截止日期為必填'
    if (Object.keys(errs).length > 0) { setAddTaskErrors(errs); return false }
    setAddTaskErrors({})
    return onAddTask()
  }

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpen])
  const currentProject = projects.find(p => p.id === inst.project_id)

  const canConfirm = (step) => {
    if (isSuperAdmin || isAdmin) return true
    if (step.confirmation_approver && step.confirmation_approver === currentUser) return true
    return false
  }
  return (
    <div className="fade-in" style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        {/* Breadcrumb */}
        <nav aria-label="breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13, flexWrap: 'wrap' }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <ChevronLeft size={15} /> 流程管理
          </button>
          {currentProject && (
            <>
              <span aria-hidden="true" style={{ color: 'var(--border-medium)' }}>›</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{currentProject.name}</span>
            </>
          )}
          <span aria-hidden="true" style={{ color: 'var(--border-medium)' }}>›</span>
          <span aria-current="page" style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{inst.template_name}</span>
        </nav>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 24px', background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 14 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>wf-{inst.id}</span>
            {inst.template_name}
          </h2>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{inst.store} · {inst.started_at?.slice(0, 10)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>指派</span>
            <button className="btn btn-sm btn-secondary" onClick={() => { setEditForm({ assignee: inst.assignee || '', groups: inst.groups || [], project_id: inst.project_id || '', completion_chain_id: inst.completion_chain_id ? String(inst.completion_chain_id) : '' }); setShowEditModal(true) }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 10px', borderRadius: 6, background: currentProject ? 'var(--accent-purple-dim)' : 'var(--glass-light)', color: currentProject ? 'var(--accent-purple)' : 'var(--text-muted)', border: currentProject ? '1px solid rgba(168,85,247,0.2)' : '1px solid var(--border-subtle)' }}>
              <FolderOpen size={12} /> {currentProject ? currentProject.name : '未關聯專案'}
            </div>
          </div>
        </div>

        {/* ⋮ More menu */}
        <div style={{ position: 'relative', flexShrink: 0, alignSelf: 'flex-start' }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <MoreVertical size={18} />
          </button>
          {menuOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: 4, minWidth: 130, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
              <button
                onClick={() => { setMenuOpen(false); onArchive?.(inst) }}
                style={{ width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', borderRadius: 6, textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <Archive size={14} /> 封存
              </button>
              <button
                onClick={() => { setMenuOpen(false); onDelete?.(inst) }}
                style={{ width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent-red)', borderRadius: 6, textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-red-dim)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <Trash2 size={14} /> 刪除
              </button>
            </div>
          )}
        </div>
        </div>
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

      {/* ── 整體完成後簽核鏈狀態 ── */}
      {inst.completion_chain_id && inst.chain_status !== '未啟動' && (() => {
        const chain = approvalChains.find(c => c.id === inst.completion_chain_id)
        const currentStepInfo = chain?.steps?.find(s => s.step_order === inst.chain_current_step)
        const statusColor = inst.chain_status === '已核准' ? 'var(--accent-green)'
          : inst.chain_status === '已駁回' ? 'var(--accent-red)'
          : 'var(--accent-orange)'
        const statusBg = inst.chain_status === '已核准' ? 'var(--accent-green-dim)'
          : inst.chain_status === '已駁回' ? 'var(--accent-red-dim)'
          : 'var(--accent-orange-dim)'
        return (
          <div style={{
            marginBottom: 20, padding: '14px 18px', borderRadius: 14,
            background: statusBg, border: `1.5px solid ${statusColor}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: statusColor, display: 'flex', alignItems: 'center', gap: 8 }}>
                {inst.chain_status === '已核准' ? <ShieldCheck size={16} /> : inst.chain_status === '已駁回' ? <ShieldX size={16} /> : <ShieldCheck size={16} />}
                整體完成簽核
                <span style={{ fontSize: 11, fontWeight: 400, padding: '2px 8px', borderRadius: 6, background: statusColor, color: '#fff' }}>
                  {inst.chain_status}
                </span>
              </div>
              {chain && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {chain.name} · 共 {chain.steps?.length || 0} 關
                </div>
              )}
            </div>
            {inst.chain_status === '簽核中' && currentStepInfo && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                目前：第 {inst.chain_current_step + 1} 關 — {currentStepInfo.label || currentStepInfo.role || '—'}
              </div>
            )}
            {inst.chain_status === '簽核中' && onChainApprove && (
              chainRejectOpen ? (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    placeholder="退回原因（必填）..."
                    style={{ width: '100%', minHeight: 60, padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--accent-red)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }}
                    value={chainRejectReason}
                    onChange={e => setChainRejectReason(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      disabled={chainBusy || !chainRejectReason.trim()}
                      onClick={async () => {
                        if (!chainRejectReason.trim()) return
                        setChainBusy(true)
                        await onChainApprove(inst.id, 'reject', chainRejectReason.trim())
                        setChainBusy(false)
                        setChainRejectOpen(false)
                        setChainRejectReason('')
                      }}
                      style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1.5px solid var(--accent-red)', background: 'var(--accent-red)', color: '#fff', opacity: (!chainRejectReason.trim() || chainBusy) ? 0.5 : 1 }}>
                      確認退回
                    </button>
                    <button
                      disabled={chainBusy}
                      onClick={() => { setChainRejectOpen(false); setChainRejectReason('') }}
                      style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '1.5px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    disabled={chainBusy}
                    onClick={async () => {
                      setChainBusy(true)
                      await onChainApprove(inst.id, 'approve')
                      setChainBusy(false)
                    }}
                    style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1.5px solid var(--accent-green)', background: 'var(--accent-green)', color: '#fff', display: 'flex', alignItems: 'center', gap: 6, opacity: chainBusy ? 0.5 : 1 }}>
                    <ShieldCheck size={14} /> 核准
                  </button>
                  <button
                    disabled={chainBusy}
                    onClick={() => setChainRejectOpen(true)}
                    style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1.5px solid var(--accent-red)', background: 'transparent', color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ShieldX size={14} /> 退回
                  </button>
                </div>
              )
            )}
          </div>
        )
      })()}

      {/* Tab bar + action button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { k: 'steps', icon: <ClipboardList size={14} />,     label: `步驟任務 (${stats.total})` },
            { k: 'board', icon: <LayoutDashboard size={14} />,   label: '看板' },
            { k: 'dag',   icon: <GitBranch size={14} />,         label: '依賴圖' },
          ].map(({ k, icon, label }) => {
            const active = activeTab === k
            return (
              <button key={k} onClick={() => setActiveTab(k)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  border:     `1px solid ${active ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                  background:  active ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                  color:       active ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>
                {icon} {label}
              </button>
            )
          })}
        </div>
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => {
          setTaskForm({ title: '', assignee: '', store: inst.store || '', planned_start: '', due_date: '', due_time: '17:00' })
          setShowAddTaskModal(true)
        }}><Plus size={13} /> 新增任務</button>
      </div>

      {/* Board view */}
      {activeTab === 'board' && (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
          {STATUS_LIST.map(status => {
            const sc = STATUS_CONFIG[status] || FALLBACK_STATUS
            const colTasks = instSteps.filter(s => s.status === status)
            const isOver = boardOverCol === status
            return (
              <div key={status}
                role="group"
                aria-label={status}
                onDragOver={e => { e.preventDefault(); setBoardOverCol(status) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setBoardOverCol(null) }}
                onDrop={e => {
                  e.preventDefault()
                  setBoardOverCol(null)
                  if (boardDragId && boardDragSrcStatus !== status) {
                    onStatusChange(boardDragId, status)
                  }
                  setBoardDragId(null)
                  setBoardDragSrcStatus(null)
                }}
                style={{
                  minWidth: 200, flex: '0 0 200px',
                  background: isOver ? sc.bg : 'var(--bg-card)',
                  border: `1px solid ${isOver ? sc.color : 'var(--border-medium)'}`,
                  borderRadius: 12, padding: 10, transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '0 4px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: sc.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{status}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{colTasks.length}</span>
                </div>
                <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40 }}>
                  {colTasks.map(step => (
                    <div key={step.id}
                      draggable
                      role="listitem"
                      aria-label={step.title}
                      aria-grabbed={boardDragId === step.id}
                      onDragStart={() => { setBoardDragId(step.id); setBoardDragSrcStatus(step.status) }}
                      onDragEnd={() => { setBoardDragId(null); setBoardDragSrcStatus(null) }}
                      onClick={() => setSelectedStep(step)}
                      style={{
                        background: 'var(--bg-secondary)', borderRadius: 8, padding: 10,
                        border: `1px solid var(--border-subtle)`,
                        borderLeft: `3px solid ${sc.color}`,
                        cursor: 'pointer', opacity: boardDragId === step.id ? 0.4 : 1,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 6 }}>{step.title}</div>
                      <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                        {step.task_code && (
                          <span style={{ padding: '1px 5px', borderRadius: 3, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 700, fontSize: 10 }}>
                            {step.task_code}
                          </span>
                        )}
                        {step.assignee && <span>👤 {step.assignee}</span>}
                        {step.due_date && <span>📅 {step.due_date.slice(5)}</span>}
                      </div>
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 16, opacity: 0.5 }}>拖曳至此</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* DAG view */}
      {activeTab === 'dag' && (
        <div className="card" style={{ padding: '16px 20px' }}>
          <WorkflowDagView steps={instSteps} instanceId={inst.id} />
        </div>
      )}

      {/* Task table */}
      {activeTab === 'steps' && (
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
                const sc = STATUS_CONFIG[step.status] || FALLBACK_STATUS
                const isDragTarget = dragOverStepId === step.id && dragStepId !== step.id
                return (
                  <tr key={step.id}
                    draggable
                    onDragStart={() => setDragStepId(step.id)}
                    onDragEnd={() => { setDragStepId(null); setDragOverStepId(null) }}
                    onDragOver={e => { e.preventDefault(); setDragOverStepId(step.id) }}
                    onDrop={e => { e.preventDefault(); onStepReorder?.(dragStepId, step.id); setDragStepId(null); setDragOverStepId(null) }}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ task: step, x: e.clientX, y: e.clientY }) }}
                    style={{ borderLeft: `3px solid ${sc.color}`, cursor: 'pointer', borderTop: isDragTarget ? '2px solid var(--accent-cyan)' : undefined }}
                    onClick={() => setSelectedStep(step)}>
                    <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <GripVertical size={12} style={{ opacity: 0.35, cursor: 'grab', flexShrink: 0 }} onClick={e => e.stopPropagation()} />
                        <span style={{ fontWeight: 700, fontSize: 12 }}>{step.step_order}</span>
                      </div>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {step.task_code && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid rgba(6,182,212,0.2)', flexShrink: 0, letterSpacing: '0.03em' }}>
                            {step.task_code}
                          </span>
                        )}
                        {editingTitleId === step.id ? (
                          <input
                            autoFocus
                            disabled={titleSaving}
                            value={editingTitleVal}
                            onChange={e => setEditingTitleVal(e.target.value)}
                            onBlur={async () => {
                              if (titleSaving) return
                              const trimmed = editingTitleVal.trim()
                              if (trimmed && trimmed !== step.title) {
                                setTitleSaving(true)
                                const { data, error } = await updateTask(step.id, { title: trimmed })
                                setTitleSaving(false)
                                if (error) {
                                  toast.error('標題更新失敗')
                                  setEditingTitleVal(step.title)
                                  setEditingTitleId(null)
                                  return
                                }
                                if (data) onStepUpdate?.(data)
                              }
                              setEditingTitleId(null)
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') e.currentTarget.blur()
                              if (e.key === 'Escape') {
                                setEditingTitleVal(step.title)  // reset so onBlur sees no diff
                                setEditingTitleId(null)
                              }
                            }}
                            style={{
                              fontWeight: 600, fontSize: 13, padding: '2px 6px',
                              borderRadius: 4, border: '1.5px solid var(--accent-cyan)',
                              background: 'var(--bg-input)', color: 'var(--text-primary)',
                              outline: 'none', width: '100%', minWidth: 120,
                              opacity: titleSaving ? 0.6 : 1,
                            }}
                          />
                        ) : (
                          <div
                            style={{ fontWeight: 600, cursor: 'pointer' }}
                            onClick={() => setSelectedStep(step)}
                            onDoubleClick={e => { e.stopPropagation(); setEditingTitleId(step.id); setEditingTitleVal(step.title) }}
                            title="雙擊可直接編輯標題"
                          >
                            {step.title}
                          </div>
                        )}
                      </div>
                    </td>
                    {/* Assignee — click to pick inline */}
                    <td onClick={e => e.stopPropagation()} style={{ position: 'relative', minWidth: 90 }}>
                      {editingAssigneeId === step.id ? (
                        <select autoFocus className="form-input" style={{ fontSize: 11, padding: '2px 4px', minWidth: 90 }}
                          value={step.assignee || ''}
                          onChange={async e => {
                            const { data } = await updateTask(step.id, { assignee: e.target.value || null })
                            if (data) onStepUpdate?.(data)
                            setEditingAssigneeId(null)
                          }}
                          onBlur={() => setEditingAssigneeId(null)}>
                          <option value="">— 未指派 —</option>
                          {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12, cursor: 'pointer', display: 'block', padding: '2px 4px', borderRadius: 4 }}
                          onClick={() => setEditingAssigneeId(step.id)}
                          title="點擊指派"
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          {step.assignee || <span style={{ color: 'var(--border-medium)' }}>— 指派</span>}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{step.store || inst.store || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{step.planned_start || <span style={{ color: 'var(--border-medium)' }}>年/月/日</span>}</td>
                    {/* Due date — click to pick inline */}
                    <td onClick={e => e.stopPropagation()} style={{ fontSize: 12, minWidth: 110 }}>
                      {editingDueDateId === step.id ? (
                        <input autoFocus type="date" className="form-input" style={{ fontSize: 11, padding: '2px 4px', width: 120 }}
                          defaultValue={step.due_date || ''}
                          onBlur={async e => {
                            const val = e.target.value
                            if (val !== step.due_date) {
                              const { data } = await updateTask(step.id, { due_date: val || null })
                              if (data) onStepUpdate?.(data)
                            }
                            setEditingDueDateId(null)
                          }}
                          onKeyDown={e => { if (e.key === 'Escape') setEditingDueDateId(null) }}
                        />
                      ) : (
                        <div style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}
                          onClick={() => setEditingDueDateId(step.id)}
                          title="點擊編輯日期"
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          {step.due_date
                            ? <><div>{step.due_date}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>🕐 {step.due_time || '17:00'}</div></>
                            : <span style={{ color: 'var(--border-medium)' }}>— 設定日期</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      <select value={step.status} onClick={e => e.stopPropagation()}
                        onChange={e => { e.stopPropagation(); onStatusChange(step.id, e.target.value) }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '4px 6px', borderRadius: 6, border: `1px solid ${sc.color}`, background: sc.bg, color: sc.color, cursor: 'pointer', outline: 'none' }}>
                        {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={e => { e.stopPropagation(); setNotesStep(step); setNotesText(step.notes || ''); setShowNotesModal(true) }}>📝 備註</button>
                        {step.confirmation_status === 'approved' ? (
                          <span style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            ✅ {step.confirmed_by} {step.confirmed_at?.slice(0, 10)}
                          </span>
                        ) : step.confirmation_status === 'rejected' ? (
                          <span style={{ fontSize: 11, color: 'var(--accent-red)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'help' }}
                            title={step.confirmation_rejected_reason || ''}>
                            ❌ {step.confirmed_by} {step.confirmed_at?.slice(0, 10)}
                          </span>
                        ) : canConfirm(step) ? (
                          <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={e => { e.stopPropagation(); setConfirmModal({ open: true, step, reason: '' }) }}>
                            🔐 確認任務
                          </button>
                        ) : step.confirmation_approver ? (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>待 {step.confirmation_approver}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {/* Quick-add inline row */}
              <QuickAddRow
                inst={inst}
                employees={employees}
                onDirectSave={async (draft) => {
                  const { createTask } = await import('../../../lib/db')
                  const maxOrder = instSteps.reduce((m, s) => Math.max(m, s.step_order || 0), 0)
                  const payload = {
                    title: draft.title,
                    assignee: draft.assignee || null,
                    due_date: draft.due_date || null,
                    due_time: '17:00',
                    status: '未開始',
                    workflow_instance_id: inst.id,
                    store: inst.store,
                    step_order: maxOrder + 1,
                  }
                  const { data, error } = await createTask(payload)
                  if (error) throw new Error(error.message)
                  if (data) onStepUpdate?.({ ...data, _isNew: true })
                }}
              />
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <TaskContextMenu
          task={ctxMenu.task}
          x={ctxMenu.x} y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onEdit={step => { setSelectedStep(step); setCtxMenu(null) }}
          onDuplicate={step => { onStepDuplicate?.(step); setCtxMenu(null) }}
          onStatusChange={(id, status) => { onStatusChange(id, status); setCtxMenu(null) }}
          onDelete={id => { onStepDelete?.(id); setCtxMenu(null) }}
          assigneeOptions={employees.map(e => e.name)}
          onAssign={async (id, name) => {
            const { data } = await updateTask(id, { assignee: name })
            if (data) onStepUpdate?.(data)
            setCtxMenu(null)
          }}
        />
      )}

      {/* Modals */}
      {showNotesModal && notesStep && (
        <Modal title={`📝 備註 — ${notesStep.title}`} onClose={() => setShowNotesModal(false)} onSubmit={onSaveNotes}>
          <textarea className="form-input" style={{ width: '100%', minHeight: 120, resize: 'vertical' }} placeholder="輸入備註內容..." value={notesText} onChange={e => setNotesText(e.target.value)} />
        </Modal>
      )}
      {showAddTaskModal && (
        <Modal title="新增任務" onClose={() => { setAddTaskErrors({}); setShowAddTaskModal(false) }} onSubmit={handleAddTask}>
          <Field label="任務名稱" required error={!!addTaskErrors.title} errorMsg={addTaskErrors.title}>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：電力申請"
              value={taskForm.title}
              onChange={e => { setTaskForm(f => ({ ...f, title: e.target.value })); if (addTaskErrors.title) setAddTaskErrors(e => ({ ...e, title: undefined })) }} />
          </Field>
          <Field label="說明">
            <textarea className="form-input" rows={2} style={{ width: '100%', resize: 'vertical' }}
              placeholder="任務細節（選填）"
              value={taskForm.description || ''}
              onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責人">
              <SearchableSelect
                value={taskForm.assignee}
                onChange={(v) => setTaskForm(f => ({ ...f, assignee: v || '' }))}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋負責人..."
              />
            </Field>
            <Field label="門市">
              <select className="form-input" style={{ width: '100%' }}
                value={taskForm.store}
                onChange={e => setTaskForm(f => ({ ...f, store: e.target.value }))}>
                <option value="">請選擇</option>
                {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="優先級">
              <select className="form-input" style={{ width: '100%' }}
                value={taskForm.priority || '中'}
                onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </Field>
            <Field label="角色（選填）">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：店長 / 督導"
                value={taskForm.role || ''}
                onChange={e => setTaskForm(f => ({ ...f, role: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="計畫開始">
              <input className="form-input" type="date" style={{ width: '100%' }}
                value={taskForm.planned_start}
                onChange={e => setTaskForm(f => ({ ...f, planned_start: e.target.value }))} />
            </Field>
            <Field label="截止日期" required error={!!addTaskErrors.due_date} errorMsg={addTaskErrors.due_date}>
              <input className="form-input" type="date" style={{ width: '100%' }}
                value={taskForm.due_date}
                onChange={e => { setTaskForm(f => ({ ...f, due_date: e.target.value })); if (addTaskErrors.due_date) setAddTaskErrors(er => ({ ...er, due_date: undefined })) }} />
            </Field>
            <Field label="截止時間">
              <input className="form-input" type="time" style={{ width: '100%' }}
                value={taskForm.due_time}
                onChange={e => setTaskForm(f => ({ ...f, due_time: e.target.value }))} />
            </Field>
          </div>

          {/* ★ 進階：清單勾選 + 簽核 */}
          <div style={{
            marginTop: 16, padding: 12, borderRadius: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>
              🔧 進階設定（選填）
            </div>

            <Field label="清單勾選（任務內顯示給執行人勾完成）">
              <select className="form-input" style={{ width: '100%' }}
                value={taskForm.checklist_id || ''}
                onChange={e => setTaskForm(f => ({ ...f, checklist_id: e.target.value }))}>
                <option value="">不掛清單</option>
                {checklists.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
              </select>
            </Field>

            <Field label="簽核方式">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { v: 'none',  l: '不需簽核' },
                  { v: 'people', l: '指定人員' },
                  { v: 'chain', l: '套用簽核鏈' },
                ].map(opt => {
                  const cur = taskForm.approval_mode || 'none'
                  const active = cur === opt.v
                  return (
                    <button type="button" key={opt.v}
                      onClick={() => setTaskForm(f => ({
                        ...f,
                        approval_mode: opt.v,
                        confirmation_approvers: opt.v === 'people' ? (f.confirmation_approvers || []) : [],
                        approval_chain_id: opt.v === 'chain' ? (f.approval_chain_id || '') : '',
                      }))}
                      style={{
                        flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                        cursor: 'pointer',
                        border: active ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
                        background: active ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                        color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      }}>
                      {opt.l}
                    </button>
                  )
                })}
              </div>
            </Field>

            {/* 指定人員 */}
            {taskForm.approval_mode === 'people' && (
              <>
                <Field label="加入審批人員">
                  <SearchableSelect
                    value=""
                    onChange={(name) => {
                      if (!name) return
                      setTaskForm(f => {
                        const cur = f.confirmation_approvers || []
                        if (cur.includes(name)) return f
                        return { ...f, confirmation_approvers: [...cur, name] }
                      })
                    }}
                    options={empOptions(
                      employees.filter(e => !(taskForm.confirmation_approvers || []).includes(e.name)),
                      { keyBy: 'name' }
                    )}
                    placeholder="🔍 搜尋姓名 / 職稱 / 部門 / 門市..."
                  />
                </Field>
                {(taskForm.confirmation_approvers || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {(taskForm.confirmation_approvers || []).map(name => (
                      <span key={name} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '4px 10px', borderRadius: 14, fontSize: 12,
                        background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)',
                        border: '1px solid var(--accent-purple)',
                      }}>
                        <ShieldCheck size={11} /> {name}
                        <button type="button"
                          onClick={() => setTaskForm(f => ({
                            ...f,
                            confirmation_approvers: (f.confirmation_approvers || []).filter(x => x !== name)
                          }))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-purple)', padding: 0, lineHeight: 1 }}>
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {(taskForm.confirmation_approvers || []).length > 1 && (
                  <Field label="多人簽核模式">
                    <select className="form-input" style={{ width: '100%' }}
                      value={taskForm.confirmation_mode || 'parallel'}
                      onChange={e => setTaskForm(f => ({ ...f, confirmation_mode: e.target.value }))}>
                      <option value="parallel">並簽（任一人通過即可）</option>
                      <option value="sequential">會簽（每個人都要通過）</option>
                    </select>
                  </Field>
                )}
              </>
            )}

            {/* 套用簽核鏈 */}
            {taskForm.approval_mode === 'chain' && (
              <Field label="選擇簽核鏈">
                <select className="form-input" style={{ width: '100%' }}
                  value={taskForm.approval_chain_id || ''}
                  onChange={e => setTaskForm(f => ({ ...f, approval_chain_id: e.target.value }))}>
                  <option value="">— 請選擇 —</option>
                  {approvalChains.map(ac => (
                    <option key={ac.id} value={ac.id}>
                      {ac.name}{ac.category ? ` (${ac.category})` : ''}
                    </option>
                  ))}
                </select>
                {taskForm.approval_chain_id && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    執行人按完成後，系統會依鏈逐關通知合法簽核者
                  </div>
                )}
              </Field>
            )}
          </div>

          {/* ★ 綁定表單 — 任務完成前需填完；可指定每張誰來填 */}
          <BoundFormsField
            value={taskForm.required_forms || []}
            onChange={v => setTaskForm(f => ({ ...f, required_forms: v }))}
            employees={employees}
            defaultAssigneeId={employees.find(e => e.name === taskForm.assignee)?.id || null}
          />
        </Modal>
      )}
      {showEditModal && (
        <Modal title="編輯流程" onClose={() => setShowEditModal(false)} onSubmit={onEditInstance}>
          <Field label="整體完成後簽核鏈">
            <select className="form-input" style={{ width: '100%' }}
              value={editForm.completion_chain_id || ''}
              onChange={e => setEditForm(f => ({ ...f, completion_chain_id: e.target.value || '' }))}>
              <option value="">不需要 — 所有任務完成即結案</option>
              {approvalChains.map(c => (
                <option key={c.id} value={c.id}>{c.name}（{c.steps?.length || 0} 關）</option>
              ))}
            </select>
          </Field>
          <Field label="負責人">
            <SearchableSelect
              value={editForm.assignee}
              onChange={(v) => setEditForm(f => ({ ...f, assignee: v || '' }))}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="未指定"
            />
          </Field>
          <Field label="群組">
            {lineGroups.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>尚無 LINE 群組（由 LINE Webhook 自動建立）</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', padding: '4px 0' }}>
                {lineGroups.map(g => {
                  const checked = (editForm.groups || []).includes(g.group_name)
                  return (
                    <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: checked ? 'var(--accent-cyan-dim)' : 'transparent', border: checked ? '1px solid rgba(6,182,212,0.2)' : '1px solid transparent' }}>
                      <input type="checkbox" checked={checked}
                        onChange={e => setEditForm(f => ({
                          ...f,
                          groups: e.target.checked
                            ? [...(f.groups || []), g.group_name]
                            : (f.groups || []).filter(x => x !== g.group_name)
                        }))}
                        style={{ accentColor: 'var(--accent-cyan)', width: 14, height: 14 }}
                      />
                      <Users size={12} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
                      <span style={{ color: checked ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>{g.group_name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </Field>
          <Field label="所屬專案">
            <select className="form-input" style={{ width: '100%' }} value={editForm.project_id} onChange={e => setEditForm(f => ({ ...f, project_id: e.target.value }))}>
              <option value="">不關聯專案</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>{/* ── 左欄結束 ── */}

      {/* 右側：點步驟後滑出該任務詳情（對齊專案頁主從版面，取代原本全螢幕 modal） */}
      {selectedStep && (
        <div style={{
          flex: '1 1 0', minWidth: 0,
          borderLeft: '1px solid var(--border-medium)',
          background: 'var(--bg-primary)',
          position: 'sticky', top: 0, alignSelf: 'flex-start',
          maxHeight: 'calc((100vh - var(--topnav-height)) / var(--app-font-scale, 1))',
          overflowY: 'auto',
        }}>
          <TaskDetailPanel
            mode="panel"
            step={selectedStep} instance={inst} allSteps={instSteps} employees={employees} stores={stores} checklists={checklists}
            onUpdate={onStepUpdate}
            onDelete={onStepDelete}
            onDuplicate={onStepDuplicate}
            onClose={() => setSelectedStep(null)} />
        </div>
      )}

      {/* ── Confirm / Reject Task Modal ── */}
      {confirmModal.open && confirmModal.step && (
        <div onClick={() => setConfirmModal(s => ({ ...s, open: false }))}
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 16, padding: 28, width: 420, maxWidth: '92vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🔐 確認任務</h3>
              <button onClick={() => setConfirmModal(s => ({ ...s, open: false }))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><X size={16} /></button>
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{confirmModal.step.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>負責人：{confirmModal.step.assignee || '—'}</div>
            </div>
            <Field label="拒絕原因（拒絕時必填）">
              <textarea className="form-input" rows={3} style={{ width: '100%', resize: 'vertical' }}
                placeholder="如選擇拒絕，請說明原因..."
                value={confirmModal.reason}
                onChange={e => setConfirmModal(s => ({ ...s, reason: e.target.value }))} />
            </Field>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmModal(s => ({ ...s, open: false }))}>取消</button>
              <button
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: 'var(--accent-red)', color: '#fff' }}
                onClick={() => {
                  if (!confirmModal.reason.trim()) { toast.warning('請填寫拒絕原因'); return }
                  onConfirmTask(confirmModal.step.id, 'rejected', confirmModal.reason.trim())
                  setConfirmModal({ open: false, step: null, reason: '' })
                }}>
                <ShieldX size={14} /> 拒絕
              </button>
              <button
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: 'var(--accent-green)', color: '#fff' }}
                onClick={() => {
                  onConfirmTask(confirmModal.step.id, 'approved', null)
                  setConfirmModal({ open: false, step: null, reason: '' })
                }}>
                <ShieldCheck size={14} /> 核准
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
