import { useState, useEffect } from 'react'
import Modal, { Field } from '../../../components/Modal'
import { supabase } from '../../../lib/supabase'
import { displaySettleStatus } from '../../../lib/displayLabel'
import {
  Plus, ChevronRight, ChevronDown, Check, Clock, Pause, Ban, Play,
  MessageSquare, Workflow, CheckSquare, Edit3, Trash2, FolderOpen,
  Users, Settings, Columns, GitBranch, MoreVertical, GripVertical,
  TrendingDown, DollarSign,
} from 'lucide-react'
import TaskDetailPanel from '../../../components/TaskDetailPanel'
import TaskQuickCreateModal from '../../../components/tasks/TaskQuickCreateModal'
import ProjectMembers from '../../../components/tasks/ProjectMembers'
import ChangelogPanel from '../../../components/ChangelogPanel'
import { ProjectCustomFieldsAdmin } from '../../../components/tasks/CustomFieldsEditor'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import ProjectFormModal from './ProjectFormModal'
import InputModal from '../../../components/ui/InputModal'
import BurndownChart from '../../../components/tasks/BurndownChart'

const STATUS_MAP = {
  '規劃中': { color: 'var(--accent-blue)',   bg: 'var(--accent-blue-dim)',   icon: Clock },
  '進行中': { color: 'var(--accent-cyan)',   bg: 'var(--accent-cyan-dim)',   icon: Play },
  '已完成': { color: 'var(--accent-green)',  bg: 'var(--accent-green-dim)',  icon: Check },
  '暫停':   { color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)', icon: Pause },
  '已取消': { color: 'var(--accent-red)',    bg: 'var(--accent-red-dim)',    icon: Ban },
}
const PRIORITY_COLORS = { '高': 'var(--accent-red)', '中': 'var(--accent-yellow)', '低': 'var(--accent-green)' }
const TASK_STATUS_LIST = ['未開始', '待簽核', '進行中', '待確認', '已完成', '已退回', '已擱置']
const TASK_STATUS_CONFIG = {
  '未開始': { color: 'var(--text-muted)', bg: 'var(--glass-light)' },
  '待簽核': { color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
  '進行中': { color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)' },
  '待確認': { color: 'var(--accent-purple)', bg: 'var(--accent-purple-dim)' },
  '已完成': { color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
  '已退回': { color: 'var(--accent-red)', bg: 'var(--accent-red-dim)' },
  '已擱置': { color: 'var(--accent-red)', bg: 'var(--accent-red-dim)' },
}
const TASK_STATUS_FALLBACK = TASK_STATUS_CONFIG['未開始']
const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '-'

// ─── 列表 tab component ───
function ProjectListsTab({ projectId, tasks }) {
  const [lists, setLists] = useState([])
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')

  useEffect(() => {
    supabase.from('project_lists').select('*').eq('project_id', projectId).order('sort_order')
      .then(({ data }) => setLists(data || []))
  }, [projectId])

  const addList = async () => {
    if (!newName.trim()) return
    setSaving(true)
    const { data } = await supabase.from('project_lists').insert({ project_id: projectId, name: newName.trim(), sort_order: lists.length }).select().single()
    if (data) setLists(prev => [...prev, data])
    setNewName(''); setAdding(false); setSaving(false)
  }

  const renameList = async (id) => {
    const current = lists.find(l => l.id === id)
    if (!editName.trim() || editName.trim() === current?.name) { setEditId(null); return }
    const { data } = await supabase.from('project_lists').update({ name: editName.trim() }).eq('id', id).select().single()
    if (data) setLists(prev => prev.map(l => l.id === id ? data : l))
    setEditId(null)
  }

  const deleteList = async (id) => {
    if (!window.confirm('確定刪除此列表？（任務不會被刪除，但會取消分組）')) return
    await supabase.from('project_lists').delete().eq('id', id)
    setLists(prev => prev.filter(l => l.id !== id))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>專案列表 ({lists.length})</span>
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => setAdding(true)}>+ 新增列表</button>
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input autoFocus className="form-input" style={{ flex: 1, fontSize: 13 }} placeholder="列表名稱" value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addList(); if (e.key === 'Escape') { setAdding(false); setNewName('') } }} />
          <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving || !newName.trim()} onClick={addList}>儲存</button>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => { setAdding(false); setNewName('') }}>取消</button>
        </div>
      )}

      {lists.length === 0 && !adding && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, fontSize: 13 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
          尚無列表。建立列表以將任務分組管理。
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lists.map(list => {
          const listTasks = tasks.filter(t => t.list_id === list.id)
          const doneTasks = listTasks.filter(t => t.status === '已完成').length
          return (
            <div key={list.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckSquare size={15} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
                {editId === list.id ? (
                  <input autoFocus className="form-input" style={{ flex: 1, fontSize: 13 }} value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => renameList(list.id)}
                    onKeyDown={e => { if (e.key === 'Enter') renameList(list.id); if (e.key === 'Escape') setEditId(null) }} />
                ) : (
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                    onDoubleClick={() => { setEditId(list.id); setEditName(list.name) }}>
                    {list.name}
                  </span>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{doneTasks}/{listTasks.length} 已完成</span>
                <button onClick={() => { setEditId(list.id); setEditName(list.name) }}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }} title="重新命名">
                  <Edit3 size={13} />
                </button>
                <button onClick={() => deleteList(list.id)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }} title="刪除列表">
                  <Trash2 size={13} />
                </button>
              </div>
              {listTasks.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 25 }}>
                  {listTasks.slice(0, 5).map(t => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: t.status === '已完成' ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.status === '已完成' ? 'var(--accent-green)' : 'var(--accent-cyan)', flexShrink: 0 }} />
                      <span style={{ textDecoration: t.status === '已完成' ? 'line-through' : 'none' }}>{t.title}</span>
                      {t.assignee && <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>👤 {t.assignee}</span>}
                    </div>
                  ))}
                  {listTasks.length > 5 && <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 16 }}>… 還有 {listTasks.length - 5} 個任務</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Expense-request status → accent color (matches Finance module canonical palette)
const EXPENSE_STATUS_COLOR = {
  '申請中': 'var(--accent-blue)',
  '已核准': 'var(--accent-green)',
  '待核銷': 'var(--accent-yellow)',
  '已核銷': 'var(--accent-cyan)',
  '已駁回': 'var(--accent-red)',
}

export default function ProjectDetailPanel({
  p,
  stats,
  pWorkflows,
  pComments,
  tasks,
  employees,
  stores,
  templates,
  profile,
  sections,
  newSection,
  setNewSection,
  addSection,
  removeSection,
  renameSection,
  commentText,
  setCommentText,
  addComment,
  openWorkflowModal,
  collapsedWfIds,
  toggleWf,
  wfMenuId,
  setWfMenuId,
  handleWfRename,
  handleWfDelete,
  handleWfReorder,
  handleTaskReorder,
  dragWfId,
  setDragWfId,
  dragOverWfId,
  setDragOverWfId,
  dragTaskId,
  setDragTaskId,
  dragOverTaskId,
  setDragOverTaskId,
  addingTaskWfId,
  setAddingTaskWfId,
  handleAddTaskToWorkflow,
  addingDirectTask,
  setAddingDirectTask,
  handleAddDirectTask,
  handleTaskStatusChange,
  showModal,
  setShowModal,
  form,
  setForm,
  editingId,
  setEditingId,
  handleSubmit,
  openEdit,
  handleDelete,
  freeInstances,
  pendingWfAttach,
  setPendingWfAttach,
  pendingWfCreate,
  setPendingWfCreate,
  pendingTasks,
  setPendingTasks,
  resetNewProjectState,
  showWorkflowModal,
  setShowWorkflowModal,
  workflowTab,
  setWorkflowTab,
  selectedAttachId,
  setSelectedAttachId,
  newWfForm,
  setNewWfForm,
  workflowSaving,
  attachWorkflow,
  createWorkflow,
  projMenuId,
  setProjMenuId,
  inputModal,
  closeInput,
  onBack,
  onWfEdit,
  onProjectOrderChange,
  approvalChains = [],
  departments = [],
  allExpenses = [],
  onLinkExpense,
  onUnlinkExpense,
}) {
  const [detailTab, setDetailTab] = useState('overview')
  const [selectedTask, setSelectedTask] = useState(null)
  const [editWfOpen, setEditWfOpen] = useState(false)
  const [editWfForm, setEditWfForm] = useState({})

  const sc = STATUS_MAP[p.status] || {}

  return (
    <div className="fade-in" style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <button className="btn btn-secondary" style={{ marginBottom: 8, fontSize: 12 }} onClick={onBack}>← 返回專案列表</button>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="header-icon">📁</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}>pj-{p.id}</span>
              {p.name}
              <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: sc.color, background: sc.bg }}>{p.status}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: PRIORITY_COLORS[p.priority] }}>{p.priority}</span>
            </h2>
            <p>{p.description || '無說明'}</p>
          </div>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-secondary" style={{ padding: '6px 8px' }} onClick={e => { e.stopPropagation(); setProjMenuId(projMenuId === p.id ? null : p.id) }}>
              <MoreVertical size={15} />
            </button>
            {projMenuId === p.id && (
              <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', zIndex: 50, minWidth: 130 }} onClick={e => e.stopPropagation()}>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', borderRadius: '8px 8px 0 0' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  onClick={(e) => { setProjMenuId(null); openEdit(p, e) }}
                ><Edit3 size={13} /> 編輯專案</button>
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', color: 'var(--accent-red)', fontSize: 13, cursor: 'pointer', borderRadius: '0 0 8px 8px' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  onClick={(e) => { setProjMenuId(null); handleDelete(p.id, e) }}
                ><Trash2 size={13} /> 刪除專案</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats + Progress */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 1.5fr', gap: 10, marginBottom: 16 }}>
        {[
          { label: '流程', value: stats.workflows, color: 'var(--accent-cyan)' },
          { label: '總任務', value: stats.total, color: 'var(--accent-blue)' },
          { label: '已完成', value: stats.completed, color: 'var(--accent-green)' },
          { label: '進行中', value: stats.inProgress, color: 'var(--accent-orange)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
        <div className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: `conic-gradient(var(--accent-cyan) ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>{stats.pct}%</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>整體進度</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-cyan)' }}>{stats.pct}%</div>
            <div style={{ height: 3, borderRadius: 2, background: 'var(--border-medium)', marginTop: 4, width: 80 }}>
              <div style={{ height: '100%', borderRadius: 2, width: `${stats.pct}%`, background: 'var(--accent-cyan)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Meta info */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, padding: '10px 14px', background: 'var(--glass-light)', borderRadius: 10 }}>
        {p.owner && <div><span style={{ color: 'var(--text-muted)' }}>負責人</span> <strong style={{ color: 'var(--text-primary)' }}>{p.owner}</strong></div>}
        {p.department && <div><span style={{ color: 'var(--text-muted)' }}>部門</span> {p.department}</div>}
        {p.store && <div><span style={{ color: 'var(--text-muted)' }}>門市</span> {p.store}</div>}
        {p.start_date && <div><span style={{ color: 'var(--text-muted)' }}>開始</span> {p.start_date}</div>}
        {p.end_date && <div><span style={{ color: 'var(--text-muted)' }}>預計完成</span> {p.end_date}</div>}
        {p.budget && <div><span style={{ color: 'var(--text-muted)' }}>預算</span> {fmt(p.budget)}</div>}
        {p.template_id && (() => { const tpl = templates.find(t => t.id === p.template_id); return tpl ? <div><span style={{ color: 'var(--text-muted)' }}>模板</span> {tpl.name}</div> : null })()}
      </div>

      {/* Detail tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 16, overflowX: 'auto' }}>
        {[
          { k: 'overview',  label: '總覽',     icon: FolderOpen },
          { k: 'burndown',  label: '燃盡圖',   icon: TrendingDown },
          { k: 'budget',    label: '預算',     icon: DollarSign },
          { k: 'members',   label: '成員',     icon: Users },
          { k: 'sections',  label: '欄位',     icon: Columns },
          { k: 'fields',    label: '自訂欄位', icon: Settings },
          { k: 'changelog', label: '變更日誌', icon: GitBranch },
        ].map(t => {
          const Icon = t.icon
          const active = detailTab === t.k
          return (
            <button key={t.k} onClick={() => setDetailTab(t.k)} style={{
              padding: '8px 14px', border: 'none', background: 'transparent',
              borderBottom: active ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              color: active ? 'var(--accent-cyan)' : 'var(--text-muted)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <Icon size={13} />{t.label}
            </button>
          )
        })}
      </div>

      {detailTab === 'members' && (
        <ProjectMembers
          projectId={p.id}
          employees={employees}
          currentUser={profile}
          autoMemberIds={(() => {
            const ids = new Set()
            const wfIds = new Set(pWorkflows.map(w => w.id))
            tasks.forEach(t => {
              if (wfIds.has(t.workflow_instance_id) && t.assignee_id) ids.add(t.assignee_id)
            })
            const nameAlreadyIn = (n) => [...ids].some(id => employees.find(e => e.id === id)?.name === n)
            const byName = (n) => employees.find(e => e.name === n)?.id
            if (p.owner_id) ids.add(p.owner_id)
            else if (p.owner && !nameAlreadyIn(p.owner)) { const id = byName(p.owner); if (id) ids.add(id) }
            pWorkflows.forEach(w => {
              if (w.started_by_id) ids.add(w.started_by_id)
              else if (w.started_by && !nameAlreadyIn(w.started_by)) { const id = byName(w.started_by); if (id) ids.add(id) }
            })
            return [...ids]
          })()}
        />
      )}

      {detailTab === 'fields' && (
        <ProjectCustomFieldsAdmin projectId={p.id} />
      )}

      {detailTab === 'changelog' && (
        <ChangelogPanel
          tables={['projects', 'project_comments', 'project_sections']}
          targetId={p.id}
          orgId={profile?.organization_id}
          currentUser={profile?.name}
        />
      )}

      {detailTab === 'sections' && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
            <Columns size={14} /> 看板欄位 ({sections.length})
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input
              className="form-input" style={{ flex: 1, fontSize: 13 }}
              placeholder="新欄位名稱，例：審核中"
              value={newSection} onChange={e => setNewSection(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSection()}
            />
            <button className="btn btn-primary" onClick={addSection} disabled={!newSection.trim()}>
              <Plus size={13} /> 新增
            </button>
          </div>
          {sections.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
              尚無自訂欄位。看板會使用預設狀態欄位。
            </div>
          ) : sections.map(s => (
            <div key={s.id} className="card" style={{ padding: '8px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: s.color }} />
              <input
                defaultValue={s.name}
                onBlur={e => e.target.value !== s.name && renameSection(s.id, e.target.value)}
                style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, fontWeight: 600, outline: 'none' }}
              />
              <button
                className="btn btn-secondary"
                style={{ padding: '3px 7px', color: 'var(--accent-red)' }}
                onClick={() => removeSection(s.id)}
              ><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* ── Burndown tab ── */}
      {detailTab === 'burndown' && (() => {
        const wfIdSet = new Set(pWorkflows.map(w => w.id))
        const allProjectTasks = tasks.filter(t =>
          t.project_id === p.id || wfIdSet.has(t.workflow_instance_id)
        )
        return (
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <TrendingDown size={15} /> 任務燃盡圖
            </div>
            {(!p.start_date || !p.end_date) && (
              <div style={{ fontSize: 12, color: 'var(--accent-orange)', marginBottom: 10, padding: '6px 10px', background: 'var(--accent-orange-dim)', borderRadius: 6 }}>
                ⚠️ 未設定專案開始/結束日期，圖表將以任務建立時間與今天推算範圍。建議編輯專案補齊日期以得到更準確的燃盡線。
              </div>
            )}
            <BurndownChart
              tasks={allProjectTasks}
              startDate={p.start_date}
              endDate={p.end_date}
            />
          </div>
        )
      })()}

      {/* ── Budget tab ── */}
      {detailTab === 'budget' && (() => {
        const linked = allExpenses.filter(e => e.project_id === p.id)
        const requested = linked.filter(e => e.status !== '已核銷')
        const settled = linked.filter(e => e.status === '已核銷')
        const actualSpent = linked.reduce((s, e) => s + Number(e.actual_amount ?? e.estimated_amount ?? 0), 0)
        const budget = Number(p.budget || 0)
        const pct = budget > 0 ? Math.min(100, Math.round((actualSpent / budget) * 100)) : null
        const overBudget = budget > 0 && actualSpent > budget

        const ExpenseRow = ({ e }) => (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
            borderBottom: '1px solid var(--border-subtle)', fontSize: 13,
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>er-{e.id}</span>
            <span style={{ flex: 1, fontWeight: 500 }}>{e.title}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.employee}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)', minWidth: 80, textAlign: 'right' }}>
              {fmt(e.actual_amount ?? e.estimated_amount)}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
              color: EXPENSE_STATUS_COLOR[e.status] || 'var(--text-muted)',
              background: 'var(--glass-light)', whiteSpace: 'nowrap',
            }}>{displaySettleStatus(e.status)}</span>
          </div>
        )

        return (
          <div>
            {/* Budget bar */}
            <div className="card" style={{ padding: '18px 20px', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                <DollarSign size={15} /> 預算概覽
              </div>
              {budget > 0 ? (
                <>
                  <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
                    {[
                      { label: '核准預算', val: fmt(budget), color: 'var(--accent-blue)' },
                      { label: '實際支出', val: fmt(actualSpent), color: overBudget ? 'var(--accent-red)' : 'var(--accent-green)' },
                      { label: '剩餘', val: fmt(budget - actualSpent), color: overBudget ? 'var(--accent-red)' : 'var(--text-secondary)' },
                      { label: '費用筆數', val: linked.length, color: 'var(--accent-cyan)' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--glass-light)', textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{s.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>
                    使用率 {pct}%{overBudget && <span style={{ color: 'var(--accent-red)', marginLeft: 6, fontWeight: 700 }}>⚠️ 超出預算</span>}
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--border-medium)' }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      width: `${pct}%`,
                      background: overBudget ? 'var(--accent-red)' : pct > 80 ? 'var(--accent-orange)' : 'var(--accent-cyan)',
                      transition: 'width 0.4s',
                    }} />
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                  未設定預算金額。可於「編輯專案」中設定。
                </div>
              )}
            </div>

            {/* 已申請費用 */}
            <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>
                已申請費用（{requested.length}）
              </div>
              {requested.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>此專案尚無已申請費用。</div>
              ) : requested.map(e => <ExpenseRow key={e.id} e={e} />)}
            </div>

            {/* 已核銷費用 */}
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>
                已核銷費用（{settled.length}）
              </div>
              {settled.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>此專案尚無已核銷費用。</div>
              ) : settled.map(e => <ExpenseRow key={e.id} e={e} />)}
            </div>
          </div>
        )
      })()}

      {detailTab === 'overview' && <>

      {/* Workflows */}
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
          <Workflow size={15} /> 流程（{pWorkflows.length}）
        </span>
        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => openWorkflowModal(p)}>
          <Plus size={12} /> 連結 / 建立流程
        </button>
      </div>

      {pWorkflows.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          尚無流程。到「流程管理 → 流程」建立時可指定專案。
        </div>
      ) : pWorkflows.map(w => {
        const wTasks = tasks.filter(t => t.workflow_instance_id === w.id).sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
        const wTotal = wTasks.length
        const wDone = wTasks.filter(t => t.status === '已完成').length
        const wInProgress = wTasks.filter(t => t.status === '進行中').length
        const wPending = wTotal - wDone - wInProgress
        const wPct = wTotal > 0 ? Math.round((wDone / wTotal) * 100) : 0
        const wColor = w.status === '已完成' ? 'var(--accent-green)' : w.status === '已退回' ? 'var(--accent-red)' : 'var(--accent-cyan)'
        const wColorBg = w.status === '已完成' ? 'var(--accent-green-dim)' : w.status === '已退回' ? 'var(--accent-red-dim)' : 'var(--accent-cyan-dim)'
        const wCollapsed = collapsedWfIds.has(w.id)

        return (
          <div key={w.id} className="card"
            draggable
            onDragStart={() => setDragWfId(w.id)}
            onDragEnd={() => { setDragWfId(null); setDragOverWfId(null) }}
            onDragOver={e => { e.preventDefault(); setDragOverWfId(w.id) }}
            onDrop={e => { e.preventDefault(); handleWfReorder(dragWfId, w.id); setDragOverWfId(null) }}
            style={{ marginBottom: 10, padding: '14px 16px', ...(dragOverWfId === w.id && dragWfId !== w.id ? { outline: '2px solid var(--accent-cyan)', outlineOffset: -2 } : {}) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggleWf(w.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>#</span>
                  <input
                    key={w.project_order}
                    type="number" min="1"
                    defaultValue={w.project_order ?? ''}
                    onBlur={e => onProjectOrderChange?.('wf', w.id, e.target.value)}
                    title="執行順位（跨流程與任務）"
                    style={{ width: 38, fontSize: 11, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', textAlign: 'center' }}
                    placeholder="—"
                  />
                </div>
                <GripVertical size={14} style={{ color: 'var(--text-muted)', cursor: 'grab', flexShrink: 0, opacity: 0.45 }} onClick={e => e.stopPropagation()} />
                {wCollapsed
                  ? <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, transition: 'transform 0.2s' }} />
                  : <ChevronDown size={14} style={{ color: 'var(--accent-cyan)', flexShrink: 0, transition: 'transform 0.2s' }} />
                }
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginRight: 5 }}>wf-{w.id}</span>
                    {w.template_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {w.started_by && `${w.started_by} · `}{w.started_at?.slice(0, 10)}
                    <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, color: wColor, background: wColorBg }}>{w.status}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ display: 'flex', gap: 10, fontSize: 12, whiteSpace: 'nowrap' }}>
                  <span>⬜ {wPending}</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>🔄 {wInProgress}</span>
                  <span style={{ color: 'var(--accent-green)' }}>✅ {wDone}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: wPct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)', lineHeight: 1 }}>{wPct}%</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{wDone}/{wTotal}</div>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: `conic-gradient(${wPct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)'} ${wPct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{wPct}%</div>
                  </div>
                </div>
                {/* Workflow kebab menu */}
                <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '4px 6px', lineHeight: 1 }}
                    onClick={() => setWfMenuId(wfMenuId === w.id ? null : w.id)}
                  ><MoreVertical size={14} /></button>
                  {wfMenuId === w.id && (
                    <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', zIndex: 50, minWidth: 130 }}>
                      <button
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', borderRadius: '8px 8px 0 0' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        onClick={() => {
                          setWfMenuId(null)
                          setEditWfForm({
                            template_name: w.template_name || '',
                            assignee: w.assignee || '',
                            store: w.store || '',
                            planned_start_date: w.planned_start_date || '',
                            planned_end_date: w.planned_end_date || '',
                            priority: w.priority || '中',
                            completion_chain_id: w.completion_chain_id ? String(w.completion_chain_id) : '',
                            notes: w.notes || '',
                            _wfId: w.id,
                          })
                          setEditWfOpen(true)
                        }}
                      ><Edit3 size={13} /> 編輯流程</button>
                      <button
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        onClick={() => { setWfMenuId(null); handleWfRename(w) }}
                      ><Edit3 size={13} /> 改名</button>
                      <button
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', color: 'var(--accent-red)', fontSize: 13, cursor: 'pointer', borderRadius: '0 0 8px 8px' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        onClick={() => { setWfMenuId(null); handleWfDelete(w) }}
                      ><Trash2 size={13} /> 刪除流程</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tasks section */}
            {!wCollapsed && <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingLeft: 24 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckSquare size={11} /> 步驟任務 ({wTasks.length})
                </span>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 3 }}
                  onClick={e => { e.stopPropagation(); setAddingTaskWfId(addingTaskWfId === w.id ? null : w.id) }}
                >
                  <Plus size={10} /> 新增任務
                </button>
              </div>

              {wTasks.length === 0 && addingTaskWfId !== w.id && (
                <div style={{ paddingLeft: 24, fontSize: 12, color: 'var(--text-muted)', paddingBottom: 4 }}>尚無步驟，點右側「新增任務」開始</div>
              )}

              {wTasks.map((t) => {
                const tsc = TASK_STATUS_CONFIG[t.status] || TASK_STATUS_FALLBACK
                return (
                  <div key={t.id}
                    draggable
                    onDragStart={() => setDragTaskId(t.id)}
                    onDragEnd={() => { setDragTaskId(null); setDragOverTaskId(null) }}
                    onDragOver={e => { e.preventDefault(); setDragOverTaskId(t.id) }}
                    onDrop={e => { e.preventDefault(); handleTaskReorder(dragTaskId, t.id, w.id); setDragOverTaskId(null) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px 5px 4px', fontSize: 13, borderRadius: 6, cursor: 'pointer', transition: 'background 0.15s',
                      borderTop: dragOverTaskId === t.id && dragTaskId !== t.id ? '2px solid var(--accent-cyan)' : '2px solid transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => setSelectedTask(t)}
                  >
                    <GripVertical size={12} style={{ color: 'var(--text-muted)', cursor: 'grab', flexShrink: 0, opacity: 0.4 }} onClick={e => e.stopPropagation()} />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>tk-{t.id}</span>
                    <span style={{
                      flex: 1, fontWeight: 500, lineHeight: 1.4,
                      textDecoration: t.status === '已完成' ? 'line-through' : 'none',
                      color: t.status === '已完成' ? 'var(--text-muted)' : 'var(--text-primary)',
                    }}>{t.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 60 }}>{t.assignee || '—'}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 60 }}>{t.due_date || '—'}</span>
                    <select
                      value={t.status}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { e.stopPropagation(); handleTaskStatusChange(t.id, e.target.value) }}
                      style={{ fontSize: 11, fontWeight: 600, padding: '3px 6px', borderRadius: 6, border: `1px solid ${tsc.color}`, background: tsc.bg, color: tsc.color, cursor: 'pointer', outline: 'none', minWidth: 72 }}
                    >
                      {TASK_STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )
              })}

              {/* inline form 已改為彈出 modal — modal 統一在元件最下面 render */}
            </div>}
          </div>
        )
      })}

      {/* Direct project tasks */}
      {(() => {
        const directTasks = tasks.filter(t => t.project_id === p.id && !t.workflow_instance_id)
        return (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                <CheckSquare size={15} /> 獨立任務（{directTasks.length}）
              </span>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => { setAddingDirectTask(v => !v) }}>
                <Plus size={12} /> 新增任務
              </button>
            </div>
            <div className="card" style={{ padding: '8px 12px' }}>
              {directTasks.length === 0 && !addingDirectTask && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>尚無獨立任務。點「新增任務」直接加入專案。</div>
              )}
              {directTasks.sort((a, b) => {
                if (a.project_order != null && b.project_order != null) return a.project_order - b.project_order
                if (a.project_order != null) return -1
                if (b.project_order != null) return 1
                return (a.step_order || 0) - (b.step_order || 0)
              }).map((t) => {
                const tsc = TASK_STATUS_CONFIG[t.status] || TASK_STATUS_FALLBACK
                return (
                  <div key={t.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 13, borderRadius: 6, cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => setSelectedTask(t)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>#</span>
                      <input
                        key={t.project_order}
                        type="number" min="1"
                        defaultValue={t.project_order ?? ''}
                        onBlur={e => onProjectOrderChange?.('task', t.id, e.target.value)}
                        title="執行順位（跨流程與任務）"
                        style={{ width: 38, fontSize: 11, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', textAlign: 'center' }}
                        placeholder="—"
                      />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>tk-{t.id}</span>
                    <span style={{ flex: 1, fontWeight: 500, lineHeight: 1.4, textDecoration: t.status === '已完成' ? 'line-through' : 'none', color: t.status === '已完成' ? 'var(--text-muted)' : 'var(--text-primary)' }}>{t.title}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: PRIORITY_COLORS[t.priority], minWidth: 20 }}>{t.priority}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 60 }}>{t.assignee || '—'}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 60 }}>{t.due_date || '—'}</span>
                    <select
                      value={t.status}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { e.stopPropagation(); handleTaskStatusChange(t.id, e.target.value) }}
                      style={{ fontSize: 11, fontWeight: 600, padding: '3px 6px', borderRadius: 6, border: `1px solid ${tsc.color}`, background: tsc.bg, color: tsc.color, cursor: 'pointer', outline: 'none', minWidth: 72 }}
                    >
                      {TASK_STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )
              })}
              {/* inline form 已改為彈出 modal */}
            </div>
          </div>
        )
      })()}

      {/* Lists */}
      <div style={{ marginTop: 20 }}>
        <ProjectListsTab projectId={p.id} tasks={tasks} />
      </div>

      {/* Comments */}
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
        <MessageSquare size={15} /> 備註（{pComments.length}）
      </div>
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, maxWidth: 500 }}>
          <input type="text" value={commentText} onChange={e => setCommentText(e.target.value)}
            placeholder="新增備註..." onKeyDown={e => e.key === 'Enter' && addComment(p.id)}
            className="form-input" style={{ flex: 1, fontSize: 13 }} />
          <button className="btn btn-primary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={() => addComment(p.id)}>送出</button>
        </div>
        {pComments.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>尚無備註</div>
        ) : pComments.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
            <strong style={{ color: 'var(--accent-cyan)', fontSize: 12, flexShrink: 0 }}>{c.author}</strong>
            <span style={{ flex: 1 }}>{c.content}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{c.created_at?.slice(0, 16).replace('T', ' ')}</span>
          </div>
        ))}
      </div>

      </>}
    </div>

    {selectedTask && (
      <div style={{
        width: 440,
        flexShrink: 0,
        borderLeft: '1px solid var(--border-medium)',
        background: 'var(--bg-primary)',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        maxHeight: 'calc((100vh - var(--topnav-height)) / var(--app-font-scale, 1))',
        overflowY: 'auto',
      }}>
        <TaskDetailPanel
          mode="panel"
          step={selectedTask}
          instance={pWorkflows.find(w => w.id === selectedTask.workflow_instance_id) || null}
          allSteps={selectedTask.workflow_instance_id
            ? tasks.filter(t => t.workflow_instance_id === selectedTask.workflow_instance_id)
            : [selectedTask]}
          employees={employees}
          stores={stores}
          checklists={[]}
          onUpdate={updated => setSelectedTask(updated)}
          onDelete={() => setSelectedTask(null)}
          onClose={() => setSelectedTask(null)}
        />
      </div>
    )}

      {/* Edit workflow modal */}
      {editWfOpen && (
        <Modal title="編輯流程" onClose={() => setEditWfOpen(false)}
          onSubmit={async () => {
            const patch = {
              template_name: editWfForm.template_name || undefined,
              assignee: editWfForm.assignee || null,
              store: editWfForm.store || null,
              planned_start_date: editWfForm.planned_start_date || null,
              planned_end_date: editWfForm.planned_end_date || null,
              priority: editWfForm.priority || '中',
              completion_chain_id: editWfForm.completion_chain_id ? Number(editWfForm.completion_chain_id) : null,
              notes: editWfForm.notes || null,
            }
            await onWfEdit?.(editWfForm._wfId, patch)
            setEditWfOpen(false)
          }}
          submitLabel="儲存"
        >
          <Field label="流程名稱" required>
            <input className="form-input" style={{ width: '100%' }}
              value={editWfForm.template_name || ''}
              onChange={e => setEditWfForm(f => ({ ...f, template_name: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責人">
              <SearchableSelect
                value={editWfForm.assignee}
                onChange={(v) => setEditWfForm(f => ({ ...f, assignee: v || '' }))}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋負責人..."
              />
            </Field>
            <Field label="門市">
              <select className="form-input" style={{ width: '100%' }}
                value={editWfForm.store || ''}
                onChange={e => setEditWfForm(f => ({ ...f, store: e.target.value }))}>
                <option value="">不指定</option>
                {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="計畫開始">
              <input className="form-input" type="date" style={{ width: '100%' }}
                value={editWfForm.planned_start_date || ''}
                onChange={e => setEditWfForm(f => ({ ...f, planned_start_date: e.target.value }))} />
            </Field>
            <Field label="預期完成日">
              <input className="form-input" type="date" style={{ width: '100%' }}
                value={editWfForm.planned_end_date || ''}
                onChange={e => setEditWfForm(f => ({ ...f, planned_end_date: e.target.value }))} />
            </Field>
            <Field label="優先度">
              <select className="form-input" style={{ width: '100%' }}
                value={editWfForm.priority || '中'}
                onChange={e => setEditWfForm(f => ({ ...f, priority: e.target.value }))}>
                <option>高</option><option>中</option><option>低</option>
              </select>
            </Field>
          </div>
          <Field label="整體完成後簽核鏈（選填）">
            <select className="form-input" style={{ width: '100%' }}
              value={editWfForm.completion_chain_id || ''}
              onChange={e => setEditWfForm(f => ({ ...f, completion_chain_id: e.target.value || '' }))}>
              <option value="">不需要 — 所有任務完成即結案</option>
              {approvalChains.map(c => (
                <option key={c.id} value={c.id}>{c.name}（{c.steps?.length || 0} 關）</option>
              ))}
            </select>
          </Field>
          <Field label="備註（選填）">
            <textarea className="form-input" style={{ width: '100%', minHeight: 56, resize: 'vertical' }}
              value={editWfForm.notes || ''}
              onChange={e => setEditWfForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
        </Modal>
      )}

      {/* Workflow attach/create modal */}
      {showWorkflowModal && (
        <Modal
          title="連結 / 建立流程"
          onClose={() => setShowWorkflowModal(false)}
          onSubmit={workflowTab === 'attach' ? attachWorkflow : createWorkflow}
          submitLabel={workflowSaving ? '儲存中...' : workflowTab === 'attach' ? '連結' : '建立'}
        >
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
            {[{ k: 'attach', label: '連結現有流程' }, { k: 'create', label: '建立新流程' }].map(t => (
              <button key={t.k} onClick={() => setWorkflowTab(t.k)} style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: workflowTab === t.k ? 'var(--accent-cyan)' : 'var(--bg-card)',
                color: workflowTab === t.k ? '#fff' : 'var(--text-muted)',
                border: workflowTab === t.k ? 'none' : '1px solid var(--border-medium)',
              }}>{t.label}</button>
            ))}
          </div>
          {workflowTab === 'attach' ? (
            freeInstances.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                沒有未連結的流程實例。請先在「流程管理」建立流程。
              </div>
            ) : (
              <Field label="選擇要連結的流程">
                <select className="form-input" style={{ width: '100%' }} value={selectedAttachId} onChange={e => setSelectedAttachId(e.target.value)}>
                  <option value="">請選擇…</option>
                  {freeInstances.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.template_name} — {w.status}{w.started_by ? ` (${w.started_by})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )
          ) : (
            <>
              <Field label="流程名稱" required>
                <input className="form-input" style={{ width: '100%' }} placeholder="例：開店前準備流程" value={newWfForm.template_name} onChange={e => setNewWfForm(f => ({ ...f, template_name: e.target.value }))} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="負責人">
                  <SearchableSelect
                    value={newWfForm.assignee}
                    onChange={(v) => setNewWfForm(f => ({ ...f, assignee: v || '' }))}
                    options={empOptions(employees, { keyBy: 'name' })}
                    placeholder="請選擇負責人"
                  />
                </Field>
                <Field label="門市">
                  <select className="form-input" style={{ width: '100%' }} value={newWfForm.store} onChange={e => setNewWfForm(f => ({ ...f, store: e.target.value }))}>
                    <option value="">不指定</option>
                    {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="計畫開始">
                  <input className="form-input" type="date" style={{ width: '100%' }} value={newWfForm.planned_start_date || ''} onChange={e => setNewWfForm(f => ({ ...f, planned_start_date: e.target.value }))} />
                </Field>
                <Field label="預期完成日">
                  <input className="form-input" type="date" style={{ width: '100%' }} value={newWfForm.planned_end_date || ''} onChange={e => setNewWfForm(f => ({ ...f, planned_end_date: e.target.value }))} />
                </Field>
                <Field label="優先度">
                  <select className="form-input" style={{ width: '100%' }} value={newWfForm.priority || '中'} onChange={e => setNewWfForm(f => ({ ...f, priority: e.target.value }))}>
                    <option>高</option><option>中</option><option>低</option>
                  </select>
                </Field>
                <Field label="截止日期（選填）">
                  <input className="form-input" type="date" style={{ width: '100%' }} value={newWfForm.due_date} onChange={e => setNewWfForm(f => ({ ...f, due_date: e.target.value }))} />
                </Field>
              </div>
              <Field label="整體完成後簽核鏈（選填）">
                <select className="form-input" style={{ width: '100%' }} value={newWfForm.completion_chain_id || ''} onChange={e => setNewWfForm(f => ({ ...f, completion_chain_id: e.target.value || '' }))}>
                  <option value="">不需要 — 所有任務完成即結案</option>
                  {approvalChains.map(c => (
                    <option key={c.id} value={c.id}>{c.name}（{c.steps?.length || 0} 關）</option>
                  ))}
                </select>
              </Field>
              <Field label="備註（選填）">
                <textarea className="form-input" style={{ width: '100%', minHeight: 56, resize: 'vertical' }} value={newWfForm.notes || ''} onChange={e => setNewWfForm(f => ({ ...f, notes: e.target.value }))} />
              </Field>
            </>
          )}
        </Modal>
      )}

      {/* Edit project modal (inside detail view) */}
      {showModal && (
        <ProjectFormModal
          editingId={editingId}
          form={form}
          setForm={setForm}
          onClose={() => { setShowModal(false); setEditingId(null); resetNewProjectState() }}
          onSubmit={handleSubmit}
          employees={employees}
          stores={stores}
          templates={templates}
          approvalChains={approvalChains}
          departments={departments}
          freeInstances={freeInstances}
          pendingWfAttach={pendingWfAttach}
          setPendingWfAttach={setPendingWfAttach}
          pendingWfCreate={pendingWfCreate}
          setPendingWfCreate={setPendingWfCreate}
          pendingTasks={pendingTasks}
          setPendingTasks={setPendingTasks}
        />
      )}

      <InputModal
        isOpen={inputModal.open}
        title={inputModal.title}
        label={inputModal.label}
        placeholder={inputModal.placeholder}
        required={inputModal.required}
        onConfirm={inputModal.onConfirm || (() => {})}
        onCancel={closeInput}
      />

      {/* 新增工作流程任務 (open when addingTaskWfId set) */}
      <TaskQuickCreateModal
        open={addingTaskWfId !== null}
        title="新增工作流程任務"
        employees={employees}
        stores={stores}
        approvalChains={approvalChains}
        onClose={() => setAddingTaskWfId(null)}
        onSubmit={(formData) => handleAddTaskToWorkflow(addingTaskWfId, formData)}
      />

      {/* 新增獨立專案任務 (open when addingDirectTask) */}
      <TaskQuickCreateModal
        open={addingDirectTask}
        title="新增專案任務"
        employees={employees}
        stores={stores}
        approvalChains={approvalChains}
        onClose={() => setAddingDirectTask(false)}
        onSubmit={(formData) => handleAddDirectTask(formData)}
      />
    </div>
  )
}
