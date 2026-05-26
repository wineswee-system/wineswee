import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import Modal, { Field } from '../../components/Modal'
import { toast } from '../../lib/toast'
import {
  Plus, X, ChevronRight, ChevronDown, Check, Clock, Pause, Ban, Play,
  MessageSquare, Workflow, CheckSquare, Edit3, Trash2, FolderOpen, Filter, Rocket, Copy,
  Users, Settings, Columns, GitBranch, MoreVertical, Search, GripVertical
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getEmployees, getProjectSections, createProjectSection, updateProjectSection, deleteProjectSection, createWorkflowInstance, updateTask, createTask, drainEntity } from '../../lib/db'
import TaskDetailPanel from '../../components/TaskDetailPanel'
import { useAuth } from '../../contexts/AuthContext'
import { useAuditLog } from '../../lib/useAuditLog'
import { notifyTaskAssignee, notifyTaskStarted } from '../../lib/lineNotify'
import LoadingSpinner from '../../components/LoadingSpinner'
import ProjectMembers from '../../components/tasks/ProjectMembers'
import ChangelogPanel from '../../components/ChangelogPanel'
import { ProjectCustomFieldsAdmin } from '../../components/tasks/CustomFieldsEditor'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'

import { confirm } from '../../lib/confirm'
import InputModal from '../../components/ui/InputModal'
import ProjectDetailPanel from './components/ProjectDetailPanel'
import ProjectDeployModal from './components/ProjectDeployModal'
import ProjectFormModal from './components/ProjectFormModal'
import ProjectListView from './components/ProjectListView'

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

const emptyForm = { name: '', description: '', status: '規劃中', priority: '中', owner: '', department: '', store: '', start_date: '', end_date: '', budget: '', template_id: '' }

const PROJECT_FIELD_LABELS = {
  name: '名稱', description: '描述', status: '狀態', priority: '優先', owner: '負責人',
  department: '部門', store: '門市', start_date: '開始日', end_date: '結束日', budget: '預算',
}

export default function Projects() {
  const { profile } = useAuth()
  const { logAction, logFieldChange } = useAuditLog()
  const [projects, setProjects] = useState([])
  const [workflows, setWorkflows] = useState([])
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [templates, setTemplates] = useState([])
  const [approvalChains, setApprovalChains] = useState([])
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployTpl, setDeployTpl] = useState(null)
  const [deployForm, setDeployForm] = useState({ name: '', store: '', owner: '' })
  const [deploying, setDeploying] = useState(false)
  const [tplSaving, setTplSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [filterOwner, setFilterOwner] = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [sections, setSections] = useState([])
  const [newSection, setNewSection] = useState('')
  // Workflow management within project
  const [showWorkflowModal, setShowWorkflowModal] = useState(false)
  const [workflowTab, setWorkflowTab] = useState('attach') // 'attach' | 'create'
  const [freeInstances, setFreeInstances] = useState([])
  const [selectedAttachId, setSelectedAttachId] = useState('')
  const [newWfForm, setNewWfForm] = useState({ template_name: '', assignee: '', store: '', due_date: '' })
  const [workflowSaving, setWorkflowSaving] = useState(false)
  const [pendingWfAttach, setPendingWfAttach] = useState([])
  const [pendingWfCreate, setPendingWfCreate] = useState([])
  const [pendingTasks, setPendingTasks] = useState([])
  const [inputModal, setInputModal] = useState({ open: false, title: '', label: '', placeholder: '', required: true, onConfirm: null })
  const openInput = (title, label, onConfirm, { placeholder = '', required = true } = {}) =>
    setInputModal({ open: true, title, label, placeholder, required, onConfirm })
  const closeInput = () => setInputModal(m => ({ ...m, open: false, onConfirm: null }))
  // Task interaction in project detail
  const [addingTaskWfId, setAddingTaskWfId] = useState(null)
  const [addTaskForm, setAddTaskForm] = useState({ title: '', assignee: '', due_date: '', required_forms: [] })
  const [addingDirectTask, setAddingDirectTask] = useState(false)
  const [directTaskForm, setDirectTaskForm] = useState({ title: '', assignee: '', due_date: '', priority: '中', required_forms: [] })
  const [collapsedWfIds, setCollapsedWfIds] = useState(new Set())
  const toggleWf = (id) => setCollapsedWfIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const [wfMenuId, setWfMenuId] = useState(null)
  const [projMenuId, setProjMenuId] = useState(null)
  const [dragWfId, setDragWfId] = useState(null)
  const [dragOverWfId, setDragOverWfId] = useState(null)
  const [dragTaskId, setDragTaskId] = useState(null)
  const [dragOverTaskId, setDragOverTaskId] = useState(null)

  const handleWfRename = (w) => {
    openInput('重命名流程', '流程名稱', async (name) => {
      closeInput()
      if (!name || name === w.template_name) return
      const { error } = await supabase.from('workflow_instances').update({ template_name: name }).eq('id', w.id)
      if (error) { toast.error('重命名失敗'); return }
      setWorkflows(prev => prev.map(x => x.id === w.id ? { ...x, template_name: name } : x))
      toast.success('已更新')
    }, { placeholder: w.template_name })
  }

  const handleWfDelete = async (w) => {
    if (!(await confirm({ message: `確定刪除流程「${w.template_name}」？此操作無法復原。` }))) return
    const { error } = await supabase.from('workflow_instances').delete().eq('id', w.id)
    if (error) { toast('刪除失敗', 'error'); return }
    setWorkflows(prev => prev.filter(x => x.id !== w.id))
    setTasks(prev => prev.filter(t => t.workflow_instance_id !== w.id))
    toast('已刪除')
  }

  const handleWfEdit = async (wfId, patch) => {
    const { data } = await supabase.from('workflow_instances').update(patch).eq('id', wfId).select().single()
    if (data) setWorkflows(prev => prev.map(w => w.id === wfId ? data : w))
  }

  const handleProjectOrderChange = async (type, id, order) => {
    const val = order !== '' && order != null ? Number(order) : null
    if (type === 'wf') {
      await supabase.from('workflow_instances').update({ project_order: val }).eq('id', id)
      setWorkflows(prev => prev.map(w => w.id === id ? { ...w, project_order: val } : w))
    } else {
      await supabase.from('tasks').update({ project_order: val }).eq('id', id)
      setTasks(prev => prev.map(t => t.id === id ? { ...t, project_order: val } : t))
    }
  }

  const handleWfReorder = async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId || !selected) return
    const sorted = workflows
      .filter(w => w.project_id === selected.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    const from = sorted.findIndex(w => w.id === fromId)
    const to = sorted.findIndex(w => w.id === toId)
    if (from === -1 || to === -1) return
    const reordered = [...sorted]
    reordered.splice(to, 0, reordered.splice(from, 1)[0])
    const updates = reordered.map((w, i) => ({ id: w.id, sort_order: i + 1 }))
    setWorkflows(prev => prev.map(w => { const u = updates.find(u => u.id === w.id); return u ? { ...w, sort_order: u.sort_order } : w }))
    await Promise.all(updates.map(u => supabase.from('workflow_instances').update({ sort_order: u.sort_order }).eq('id', u.id)))
  }

  const handleTaskReorder = async (fromId, toId, wfId) => {
    if (!fromId || !toId || fromId === toId) return
    const sorted = tasks
      .filter(t => t.workflow_instance_id === wfId)
      .sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
    const from = sorted.findIndex(t => t.id === fromId)
    const to = sorted.findIndex(t => t.id === toId)
    if (from === -1 || to === -1) return
    const reordered = [...sorted]
    reordered.splice(to, 0, reordered.splice(from, 1)[0])
    const updates = reordered.map((t, i) => ({ id: t.id, step_order: i + 1 }))
    setTasks(prev => prev.map(t => { const u = updates.find(u => u.id === t.id); return u ? { ...t, step_order: u.step_order } : t }))
    await Promise.all(updates.map(u => supabase.from('tasks').update({ step_order: u.step_order }).eq('id', u.id)))
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [pRes, wRes, eRes, sRes, cRes, tplRes, acRes] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('workflow_instances').select('*').not('project_id', 'is', null).order('sort_order'),
      getEmployees(),
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('project_comments').select('*').order('created_at', { ascending: false }),
      supabase.from('project_templates').select('*').order('id'),
      supabase.from('approval_chains').select('id, name, steps:approval_chain_steps(id)').order('name'),
    ])
    // Load tasks that either carry project_id directly OR belong to a project's workflow instance
    const wIds = (wRes.data || []).map(w => w.id)
    const tRes = wIds.length > 0
      ? await supabase.from('tasks').select('*')
          .or(`project_id.not.is.null,workflow_instance_id.in.(${wIds.join(',')})`)
          .order('step_order')
      : await supabase.from('tasks').select('*').not('project_id', 'is', null).order('step_order')
    setProjects(pRes.data || [])
    setWorkflows(wRes.data || [])
    setTasks(tRes.data || [])
    setEmployees((eRes.data || []).filter(e => e.status === '在職'))
    setStores(sRes.data || [])
    setComments(cRes.data || [])
    setTemplates(tplRes.data || [])
    setApprovalChains(acRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!wfMenuId) return
    const close = () => setWfMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [wfMenuId])
  useEffect(() => {
    if (!projMenuId) return
    const close = () => setProjMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [projMenuId])

  useEffect(() => {
    if (!selected) return
    getProjectSections(selected.id).then(({ data }) => setSections(data || []))
  }, [selected?.id])

  const addSection = async () => {
    if (!newSection.trim()) return
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.sort_order || 0), 0)
    const { data } = await createProjectSection({
      project_id: selected.id, name: newSection.trim(),
      sort_order: maxOrder + 1, color: 'var(--text-muted)',
    })
    if (data) setSections(prev => [...prev, data])
    setNewSection('')
  }

  const removeSection = async (id) => {
    if (!(await confirm({ message: '刪除此欄位？任務不會刪除但會脫離欄位。' }))) return
    await deleteProjectSection(id)
    setSections(prev => prev.filter(s => s.id !== id))
  }

  const renameSection = async (id, name) => {
    await updateProjectSection(id, { name })
    setSections(prev => prev.map(s => s.id === id ? { ...s, name } : s))
  }

  // Stats
  const getStats = (projectId) => {
    const pWorkflows = workflows.filter(w => w.project_id === projectId)
    const wfTasks = pWorkflows.flatMap(w => tasks.filter(t => t.workflow_instance_id === w.id))
    const directTasks = tasks.filter(t => t.project_id === projectId && !t.workflow_instance_id)
    const pTasks = [...wfTasks, ...directTasks]
    const total = pTasks.length
    const completed = pTasks.filter(t => t.status === '已完成').length
    const inProgress = pTasks.filter(t => t.status === '進行中').length
    const pending = total - completed - inProgress
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, inProgress, pending, pct, workflows: pWorkflows.length }
  }

  const resetNewProjectState = () => {
    setPendingWfAttach([])
    setPendingWfCreate([])
    setPendingTasks([])
  }

  // CRUD
  const handleSubmit = async () => {
    if (!form.name) return
    const payload = {
      ...form,
      budget: form.budget ? Number(form.budget) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      template_id: form.template_id ? Number(form.template_id) : null,
    }
    if (!profile?.organization_id) { toast.error('身份資訊未載入，請重新整理頁面'); return }
    payload.organization_id = profile.organization_id
    if (editingId) {
      const oldProj = projects.find(p => p.id === editingId)
      const { data, error } = await supabase.from('projects').update(payload).eq('id', editingId).select().single()
      if (error) { toast.error('更新失敗，請稍後再試'); return }
      if (data) {
        setProjects(prev => prev.map(p => p.id === editingId ? data : p))
        if (selected?.id === editingId) setSelected(data)
        if (oldProj) {
          const idLabel = `pj-${String(editingId).padStart(6, '0')}`
          for (const key of Object.keys(PROJECT_FIELD_LABELS)) {
            const oldVal = String(oldProj[key] ?? '')
            const newVal = String(payload[key] ?? '')
            if (oldVal !== newVal) {
              await logFieldChange('projects', editingId, PROJECT_FIELD_LABELS[key], oldVal, newVal, `${idLabel} ${oldProj.name}`)
            }
          }
        }
      }
    } else {
      payload.owner = payload.owner || profile?.name || ''
      const { data, error } = await supabase.from('projects').insert(payload).select().single()
      if (error) { toast.error('建立失敗，請稍後再試'); return }
      if (data) {
        setProjects(prev => [data, ...prev])
        await logAction('新增', 'projects', data.id, `pj-${String(data.id).padStart(6, '0')} ${data.name}`)
        let sortOrder = 1
        for (const id of pendingWfAttach) {
          await supabase.from('workflow_instances').update({ project_id: data.id, sort_order: sortOrder++ }).eq('id', id)
        }
        for (const wf of pendingWfCreate) {
          await createWorkflowInstance({
            template_name: wf.template_name, status: '進行中',
            started_by: payload.owner, store: payload.store || null,
            due_date: payload.end_date || null, project_id: data.id,
            sort_order: sortOrder++, started_at: new Date().toISOString(),
          })
        }
        if (pendingTasks.length > 0) {
          const taskRows = pendingTasks.map((t, i) => ({
            title: t.title, project_id: data.id,
            assignee: t.assignee || null, due_date: t.due_date || null,
            priority: t.priority || '中',
            // step 1 直接開工 進行中、step 2+ 待處理（等前一步 trigger 自動 advance）
            status: i === 0 ? '進行中' : '待處理',
            started_at: i === 0 ? new Date().toISOString() : null,
            step_order: i + 1, bucket: 'Project',
            store: payload.store || null,
            organization_id: profile?.organization_id || null,
          }))
          await supabase.from('tasks').insert(taskRows)
        }
        if (pendingWfAttach.length > 0 || pendingWfCreate.length > 0 || pendingTasks.length > 0) load()
      }
    }
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
    resetNewProjectState()
  }

  const openEdit = (p, e) => {
    e?.stopPropagation()
    setForm({
      name: p.name, description: p.description || '', status: p.status, priority: p.priority || '中',
      owner: p.owner || '', department: p.department || '', store: p.store || '',
      start_date: p.start_date || '', end_date: p.end_date || '', budget: p.budget || '',
      template_id: p.template_id || '',
    })
    setEditingId(p.id)
    setShowModal(true)
  }

  const handleDelete = async (id, e) => {
    e?.stopPropagation()
    if (!(await confirm({ title: '刪除專案', message: `確定刪除此專案？所有相關流程與任務的連結將解除，資料會移入回收暫存區備份（可供復原）。此操作無法立即復原。`, confirmLabel: '確認刪除', danger: true }))) return
    const proj = projects.find(p => p.id === id)
    if (proj) {
      await drainEntity({
        entityType: 'project',
        entityId: id,
        entityName: proj.name,
        payload: proj,
        relatedData: null,
        deletedBy: profile?.name || '管理員',
        organizationId: profile?.organization_id || null,
      })
    }
    await supabase.from('projects').delete().eq('id', id)
    if (proj) await logAction('刪除', 'projects', id, `pj-${String(id).padStart(6, '0')} ${proj.name}`)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const openWorkflowModal = async (proj) => {
    const { data } = await supabase.from('workflow_instances').select('id, template_name, status, started_by, started_at').is('project_id', null).order('started_at', { ascending: false })
    setFreeInstances(data || [])
    setSelectedAttachId('')
    setNewWfForm({ template_name: '', assignee: proj.owner || profile?.name || '', store: proj.store || '', due_date: proj.end_date || '' })
    setWorkflowTab('attach')
    setShowWorkflowModal(true)
  }

  const attachWorkflow = async () => {
    if (!selectedAttachId || !selected) return
    setWorkflowSaving(true)
    const { error } = await supabase.from('workflow_instances').update({ project_id: selected.id }).eq('id', selectedAttachId)
    if (error) { toast.error('連結失敗，請稍後再試'); setWorkflowSaving(false); return }
    const maxOrder = workflows.filter(w => w.project_id === selected.id).reduce((m, w) => Math.max(m, w.sort_order || 0), 0)
    await supabase.from('workflow_instances').update({ sort_order: maxOrder + 1 }).eq('id', selectedAttachId)
    const { data: updatedWf } = await supabase.from('workflow_instances').select('*').eq('id', selectedAttachId).single()
    if (updatedWf) setWorkflows(prev => [...prev, { ...updatedWf, sort_order: maxOrder + 1 }])
    const { data: wfTasks } = await supabase.from('tasks').select('*').eq('workflow_instance_id', selectedAttachId).order('step_order')
    if (wfTasks?.length) setTasks(prev => [...prev, ...wfTasks])
    setShowWorkflowModal(false)
    setWorkflowSaving(false)
  }

  const createWorkflow = async () => {
    if (!newWfForm.template_name || !selected) return
    setWorkflowSaving(true)
    const maxOrder = workflows.filter(w => w.project_id === selected.id).reduce((m, w) => Math.max(m, w.sort_order || 0), 0)
    const { data: newWf, error } = await createWorkflowInstance({
      template_name: newWfForm.template_name,
      status: '進行中',
      started_by: newWfForm.assignee || profile?.name || '',
      store: newWfForm.store || null,
      due_date: newWfForm.due_date || null,
      project_id: selected.id,
      sort_order: maxOrder + 1,
      started_at: new Date().toISOString(),
    })
    if (error) { toast.error('建立失敗，請稍後再試'); setWorkflowSaving(false); return }
    if (newWf) setWorkflows(prev => [...prev, newWf])
    setShowWorkflowModal(false)
    setWorkflowSaving(false)
  }

  const handleTaskStatusChange = async (taskId, newStatus) => {
    const prevTask = tasks.find(t => t.id === taskId)
    const { data } = await updateTask(taskId, {
      status: newStatus,
      completed_at: newStatus === '已完成' ? new Date().toISOString() : null,
    })
    if (data) {
      setTasks(prev => prev.map(t => t.id === taskId ? data : t))
      if (newStatus === '進行中' && prevTask?.status !== '進行中' && data.assignee) {
        notifyTaskStarted(data.assignee, data.title, '', data.id, {
          dueDate: data.due_date, description: data.description, notes: data.notes, store: data.store,
          approvalRequired: data.status === '待簽核',
        }).catch(() => {})
      }
    }
  }

  // 可從 inline form (使用 state addTaskForm) 或 modal (傳 formData) 呼叫
  const handleAddTaskToWorkflow = async (wfId, formData) => {
    const fd = formData || addTaskForm
    if (!fd.title?.trim()) return false
    const instTasks = tasks.filter(t => t.workflow_instance_id === wfId)
    const maxOrder = instTasks.reduce((m, t) => Math.max(m, t.step_order || 0), 0)
    const wf = workflows.find(w => w.id === wfId)
    const empId = fd.assignee
      ? (employees.find(e => e.name === fd.assignee)?.id || null)
      : null
    const isFirstStep = instTasks.length === 0
    const { data } = await createTask({
      workflow_instance_id: wfId,
      project_id: selected?.id || null,
      title: fd.title.trim(),
      description: fd.description || null,
      assignee: fd.assignee || null,
      assignee_id: empId,
      store: fd.store || null,
      planned_start: fd.planned_start || null,
      due_date: fd.due_date || null,
      role: fd.role || null,
      status: isFirstStep ? '進行中' : '待處理',
      step_order: maxOrder + 1,
      bucket: '工作流程',
      category: '工作流程',
      priority: fd.priority || '中',
      organization_id: profile?.organization_id || null,
    })
    if (!data) return false
    // 綁定表單
    for (const f of (fd.required_forms || [])) {
      await supabase.rpc('create_task_form_binding', {
        p_task_id: data.id, p_form_type: f.form_type, p_form_template_id: f.form_template_id || null,
      })
    }
    setTasks(prev => [...prev, data])
    if (!formData) {
      // inline path: 清空 state
      setAddTaskForm({ title: '', assignee: '', due_date: '', required_forms: [] })
      setAddingTaskWfId(null)
    }
    if (data.assignee) notifyTaskAssignee(data.assignee, data.title, wf?.template_name || '', data.id, {
      dueDate: data.due_date, description: data.description, notes: data.notes, store: data.store,
      approvalRequired: data.status === '待簽核',
    }).catch(() => {})
    return true
  }

  const handleAddDirectTask = async (formData) => {
    const fd = formData || directTaskForm
    if (!fd.title?.trim() || !selected) return false
    const directTasks = tasks.filter(t => t.project_id === selected.id && !t.workflow_instance_id)
    const maxOrder = directTasks.reduce((m, t) => Math.max(m, t.step_order || 0), 0)
    const empId = fd.assignee ? (employees.find(e => e.name === fd.assignee)?.id || null) : null
    const { data } = await createTask({
      project_id: selected.id,
      title: fd.title.trim(),
      description: fd.description || null,
      assignee: fd.assignee || null,
      assignee_id: empId,
      store: fd.store || null,
      planned_start: fd.planned_start || null,
      due_date: fd.due_date || null,
      role: fd.role || null,
      priority: fd.priority || '中',
      status: '待處理',
      step_order: maxOrder + 1,
      bucket: 'Project',
      category: 'Project',
      organization_id: profile?.organization_id || null,
    })
    if (!data) return false
    // 綁定表單
    for (const f of (fd.required_forms || [])) {
      await supabase.rpc('create_task_form_binding', {
        p_task_id: data.id, p_form_type: f.form_type, p_form_template_id: f.form_template_id || null,
      })
    }
    setTasks(prev => [...prev, data])
    return true
  }

  const addComment = async (projectId) => {
    if (!commentText.trim()) return
    const { data } = await supabase.from('project_comments').insert({
      project_id: projectId, author: profile?.name || '系統', content: commentText,
    }).select().single()
    if (data) setComments(prev => [data, ...prev])
    setCommentText('')
  }

  // Deploy template → create project + workflows + tasks
  const handleDeploy = async () => {
    if (!deployTpl || !deployForm.name) return
    // ★ 多廠商安全：profile.organization_id 一定要有，沒有就拒絕（之前 fallback || 1 會把
    //   未載入的 profile 全部塞進 demo org，是 silent corruption）
    const orgId = profile?.organization_id
    if (!orgId) {
      toast.error('身份資訊未載入完成，請重新登入再操作')
      return
    }

    setDeploying(true)
    try {
      const tpl = deployTpl
      const today = new Date().toISOString().slice(0, 10)
      const endDate = tpl.estimated_days ? new Date(Date.now() + tpl.estimated_days * 86400000).toISOString().slice(0, 10) : null

      // 1. Create project
      const { data: project } = await supabase.from('projects').insert({
        name: deployForm.name,
        description: tpl.description,
        status: '進行中',
        priority: tpl.default_priority || '中',
        owner: deployForm.owner || profile?.name || '',
        store: deployForm.store || null,
        start_date: today,
        end_date: endDate,
        budget: tpl.estimated_budget,
        organization_id: orgId,
        template_id: tpl.id,
      }).select().single()

      if (!project) throw new Error('建立專案失敗')

      // 2. Create workflows + tasks
      const tplWorkflows = Array.isArray(tpl.workflows) ? tpl.workflows : JSON.parse(tpl.workflows || '[]')
      for (let i = 0; i < tplWorkflows.length; i++) {
        const wf = tplWorkflows[i]
        const { data: instance } = await supabase.from('workflow_instances').insert({
          template_name: wf.name,
          status: '進行中',
          started_by: deployForm.owner || profile?.name || '',
          store: deployForm.store || null,
          project_id: project.id,
          organization_id: orgId,  // ★ 補 org_id，否則 org-scoped 查詢會漏
          sort_order: i + 1,
          started_at: new Date().toISOString(),
        }).select().single()

        if (instance && wf.tasks?.length > 0) {
          const taskRows = wf.tasks.map((t, j) => ({
            title: t.title,
            workflow_instance_id: instance.id,
            project_id: project.id,
            organization_id: orgId,  // ★ 補 org_id
            // step 1 直接開工 進行中、step 2+ 待處理（等 trg_task_advance_next_step 推進）
            status: j === 0 ? '進行中' : '待處理',
            started_at: j === 0 ? new Date().toISOString() : null,
            role: t.role || null,
            step_order: j + 1,
            priority: t.priority || '中',
            due_date: endDate,
            store: deployForm.store || null,
            bucket: 'Project',
            category: wf.name || null,
          }))
          await supabase.from('tasks').insert(taskRows)
        }
      }

      // LINE notify project owner
      if (deployForm.owner) {
        notifyTaskAssignee(deployForm.owner, `專案「${deployForm.name}」已建立`, '專案部署', null).catch(() => {})
      }

      setShowDeployModal(false)
      setDeployTpl(null)
      load()
    } catch (err) {
      toast.error('部署失敗，請稍後再試')
    }
    setDeploying(false)
  }

  const openDeploy = (tpl) => {
    setDeployTpl(tpl)
    setDeployForm({ name: tpl.name, store: '', owner: profile?.name || '' })
    setShowDeployModal(true)
  }

  const handleEditTemplate = async (id, payload) => {
    setTplSaving(true)
    const { data, error } = await supabase
      .from('project_templates')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (error) {
      toast.error('儲存失敗：' + error.message)
    } else if (data) {
      setTemplates(prev => prev.map(t => t.id === id ? data : t))
      toast.success('模板已更新')
    }
    setTplSaving(false)
  }

  const handleDeleteTemplate = async (tpl) => {
    if (!(await confirm({ message: `確定刪除模板「${tpl.name}」？已部署的專案不受影響。`, confirmLabel: '確認刪除', danger: true }))) return
    const { error } = await supabase.from('project_templates').delete().eq('id', tpl.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    setTemplates(prev => prev.filter(t => t.id !== tpl.id))
    toast.success('模板已刪除')
  }

  if (loading) return <LoadingSpinner />

  const activeStatuses = tab === 'active' ? ['規劃中', '進行中'] : tab === 'completed' ? ['已完成'] : ['暫停', '已取消']
  const filtered = projects.filter(p => {
    if (!activeStatuses.includes(p.status)) return false
    if (search) { const s = search.toLowerCase(); if (!p.name?.toLowerCase().includes(s) && !p.owner?.toLowerCase().includes(s) && !`pj-${p.id}`.includes(s)) return false }
    if (filterOwner && p.owner !== filterOwner) return false
    if (filterStore && p.store !== filterStore) return false
    return true
  })

  const activeCount = projects.filter(p => ['規劃中', '進行中'].includes(p.status)).length
  const completedCount = projects.filter(p => p.status === '已完成').length
  const archivedCount = projects.filter(p => ['暫停', '已取消'].includes(p.status)).length

  // Detail view
  if (selected) {
    const p = selected
    const stats = getStats(p.id)
    const pWorkflows = workflows.filter(w => w.project_id === p.id).sort((a, b) => {
      if (a.project_order != null && b.project_order != null) return a.project_order - b.project_order
      if (a.project_order != null) return -1
      if (b.project_order != null) return 1
      return (a.sort_order || 0) - (b.sort_order || 0)
    })
    const pComments = comments.filter(c => c.project_id === p.id)

    return (
      <ProjectDetailPanel
        p={p}
        stats={stats}
        pWorkflows={pWorkflows}
        pComments={pComments}
        tasks={tasks}
        setTasks={setTasks}
        employees={employees}
        stores={stores}
        templates={templates}
        sections={sections}
        setSections={setSections}
        newSection={newSection}
        setNewSection={setNewSection}
        addSection={addSection}
        removeSection={removeSection}
        renameSection={renameSection}
        profile={profile}
        comments={comments}
        setComments={setComments}
        commentText={commentText}
        setCommentText={setCommentText}
        addComment={addComment}
        showModal={showModal}
        setShowModal={setShowModal}
        editingId={editingId}
        setEditingId={setEditingId}
        form={form}
        setForm={setForm}
        handleSubmit={handleSubmit}
        openEdit={openEdit}
        handleDelete={handleDelete}
        showWorkflowModal={showWorkflowModal}
        setShowWorkflowModal={setShowWorkflowModal}
        workflowTab={workflowTab}
        setWorkflowTab={setWorkflowTab}
        freeInstances={freeInstances}
        selectedAttachId={selectedAttachId}
        setSelectedAttachId={setSelectedAttachId}
        newWfForm={newWfForm}
        setNewWfForm={setNewWfForm}
        workflowSaving={workflowSaving}
        attachWorkflow={attachWorkflow}
        createWorkflow={createWorkflow}
        openWorkflowModal={openWorkflowModal}
        workflows={workflows}
        setWorkflows={setWorkflows}
        addingTaskWfId={addingTaskWfId}
        setAddingTaskWfId={setAddingTaskWfId}
        addTaskForm={addTaskForm}
        setAddTaskForm={setAddTaskForm}
        handleAddTaskToWorkflow={handleAddTaskToWorkflow}
        handleTaskStatusChange={handleTaskStatusChange}
        addingDirectTask={addingDirectTask}
        setAddingDirectTask={setAddingDirectTask}
        directTaskForm={directTaskForm}
        setDirectTaskForm={setDirectTaskForm}
        handleAddDirectTask={handleAddDirectTask}
        collapsedWfIds={collapsedWfIds}
        toggleWf={toggleWf}
        wfMenuId={wfMenuId}
        setWfMenuId={setWfMenuId}
        projMenuId={projMenuId}
        setProjMenuId={setProjMenuId}
        dragWfId={dragWfId}
        setDragWfId={setDragWfId}
        dragOverWfId={dragOverWfId}
        setDragOverWfId={setDragOverWfId}
        dragTaskId={dragTaskId}
        setDragTaskId={setDragTaskId}
        dragOverTaskId={dragOverTaskId}
        setDragOverTaskId={setDragOverTaskId}
        handleWfReorder={handleWfReorder}
        handleTaskReorder={handleTaskReorder}
        handleWfRename={handleWfRename}
        handleWfDelete={handleWfDelete}
        onWfEdit={handleWfEdit}
        onProjectOrderChange={handleProjectOrderChange}
        approvalChains={approvalChains}
        inputModal={inputModal}
        closeInput={closeInput}
        onBack={() => setSelected(null)}
        setSelected={setSelected}
        pendingWfAttach={pendingWfAttach}
        setPendingWfAttach={setPendingWfAttach}
        pendingWfCreate={pendingWfCreate}
        setPendingWfCreate={setPendingWfCreate}
        pendingTasks={pendingTasks}
        setPendingTasks={setPendingTasks}
      />
    )
  }

  // List view
  return (
    <ProjectListView
      projects={projects}
      templates={templates}
      employees={employees}
      stores={stores}
      filtered={filtered}
      tab={tab}
      setTab={setTab}
      activeCount={activeCount}
      completedCount={completedCount}
      archivedCount={archivedCount}
      search={search}
      setSearch={setSearch}
      filterOwner={filterOwner}
      setFilterOwner={setFilterOwner}
      filterStore={filterStore}
      setFilterStore={setFilterStore}
      getStats={getStats}
      setSelected={setSelected}
      openEdit={openEdit}
      handleDelete={handleDelete}
      projMenuId={projMenuId}
      setProjMenuId={setProjMenuId}
      showModal={showModal}
      setShowModal={setShowModal}
      editingId={editingId}
      setEditingId={setEditingId}
      form={form}
      setForm={setForm}
      handleSubmit={handleSubmit}
      freeInstances={freeInstances}
      setFreeInstances={setFreeInstances}
      pendingWfAttach={pendingWfAttach}
      setPendingWfAttach={setPendingWfAttach}
      pendingWfCreate={pendingWfCreate}
      setPendingWfCreate={setPendingWfCreate}
      pendingTasks={pendingTasks}
      setPendingTasks={setPendingTasks}
      resetNewProjectState={resetNewProjectState}
      profile={profile}
      showDeployModal={showDeployModal}
      setShowDeployModal={setShowDeployModal}
      deployTpl={deployTpl}
      deployForm={deployForm}
      setDeployForm={setDeployForm}
      deploying={deploying}
      handleDeploy={handleDeploy}
      openDeploy={openDeploy}
      onEditTemplate={handleEditTemplate}
      onDeleteTemplate={handleDeleteTemplate}
      tplSaving={tplSaving}
    />
  )
}
