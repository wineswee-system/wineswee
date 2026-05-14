import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import Modal, { Field } from '../../components/Modal'
import { toast } from '../../lib/toast'
import {
  Plus, X, ChevronRight, ChevronDown, Check, Clock, Pause, Ban, Play,
  MessageSquare, Workflow, CheckSquare, Edit3, Trash2, FolderOpen, Filter, Rocket, Copy,
  Users, Settings, Columns, GitBranch
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getEmployees, getProjectSections, createProjectSection, updateProjectSection, deleteProjectSection, createWorkflowInstance, updateTask, createTask, drainEntity } from '../../lib/db'
import TaskDetailPanel from '../../components/TaskDetailPanel'
import { useAuth } from '../../contexts/AuthContext'
import { notifyTaskAssignee, notifyTaskStarted } from '../../lib/lineNotify'
import LoadingSpinner from '../../components/LoadingSpinner'
import ProjectMembers from '../../components/tasks/ProjectMembers'
import ChangelogPanel from '../../components/ChangelogPanel'
import { ProjectCustomFieldsAdmin } from '../../components/tasks/CustomFieldsEditor'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'

import { confirm } from '../../lib/confirm'
const STATUS_MAP = {
  '規劃中': { color: 'var(--accent-blue)', icon: Clock },
  '進行中': { color: 'var(--accent-cyan)', icon: Play },
  '已完成': { color: 'var(--accent-green)', icon: Check },
  '暫停':   { color: 'var(--accent-yellow)', icon: Pause },
  '已取消': { color: 'var(--accent-red)', icon: Ban },
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

const emptyForm = { name: '', description: '', status: '規劃中', priority: '中', owner: '', department: '', store: '', start_date: '', end_date: '', budget: '' }

export default function Projects() {
  const { profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [workflows, setWorkflows] = useState([])
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [templates, setTemplates] = useState([])
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployTpl, setDeployTpl] = useState(null)
  const [deployForm, setDeployForm] = useState({ name: '', store: '', owner: '' })
  const [deploying, setDeploying] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [tab, setTab] = useState('active')
  const [detailTab, setDetailTab] = useState('overview')
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
  const [inlineWfMode, setInlineWfMode] = useState(null) // null | 'attach' | 'create'
  const [inlineWfAttachId, setInlineWfAttachId] = useState('')
  const [inlineWfCreate, setInlineWfCreate] = useState({ template_name: '' })
  const [pendingTasks, setPendingTasks] = useState([])
  const [inlineTaskMode, setInlineTaskMode] = useState(false)
  const [inlineTask, setInlineTask] = useState({ title: '', assignee: '', due_date: '', priority: '中' })
  // Task interaction in project detail
  const [selectedTask, setSelectedTask] = useState(null)
  const [addingTaskWfId, setAddingTaskWfId] = useState(null)
  const [addTaskForm, setAddTaskForm] = useState({ title: '', assignee: '', due_date: '' })
  const [addingDirectTask, setAddingDirectTask] = useState(false)
  const [directTaskForm, setDirectTaskForm] = useState({ title: '', assignee: '', due_date: '', priority: '中' })
  const [collapsedWfIds, setCollapsedWfIds] = useState(new Set())
  const toggleWf = (id) => setCollapsedWfIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [pRes, wRes, eRes, sRes, cRes, tplRes] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('workflow_instances').select('*').not('project_id', 'is', null).order('sort_order'),
      getEmployees(),
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('project_comments').select('*').order('created_at', { ascending: false }),
      supabase.from('project_templates').select('*').order('id'),
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
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!selected) return
    getProjectSections(selected.id).then(({ data }) => setSections(data || []))
    setDetailTab('overview')
  }, [selected?.id])

  const addSection = async () => {
    if (!newSection.trim()) return
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.sort_order || 0), 0)
    const { data } = await createProjectSection({
      project_id: selected.id, name: newSection.trim(),
      sort_order: maxOrder + 1, color: '#64748b',
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
    setPendingWfAttach([]); setPendingWfCreate([]); setInlineWfMode(null); setInlineWfAttachId(''); setInlineWfCreate({ template_name: '' })
    setPendingTasks([]); setInlineTaskMode(false); setInlineTask({ title: '', assignee: '', due_date: '', priority: '中' })
  }

  // CRUD
  const handleSubmit = async () => {
    if (!form.name) return
    const payload = {
      ...form,
      budget: form.budget ? Number(form.budget) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    }
    if (profile?.organization_id) payload.organization_id = profile.organization_id
    if (editingId) {
      const { data, error } = await supabase.from('projects').update(payload).eq('id', editingId).select().single()
      if (error) { toast.error('更新失敗，請稍後再試'); return }
      if (data) {
        setProjects(prev => prev.map(p => p.id === editingId ? data : p))
        if (selected?.id === editingId) setSelected(data)
      }
    } else {
      payload.owner = payload.owner || profile?.name || ''
      const { data, error } = await supabase.from('projects').insert(payload).select().single()
      if (error) { toast.error('建立失敗，請稍後再試'); return }
      if (data) {
        setProjects(prev => [data, ...prev])
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
    })
    setEditingId(p.id)
    setShowModal(true)
  }

  const handleDelete = async (id, e) => {
    e?.stopPropagation()
    if (!(await confirm({ message: '確定刪除此專案？資料會移入回收暫存區保留備份（可供復原）。' }))) return
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

  const handleAddTaskToWorkflow = async (wfId) => {
    if (!addTaskForm.title.trim()) return
    const instTasks = tasks.filter(t => t.workflow_instance_id === wfId)
    const maxOrder = instTasks.reduce((m, t) => Math.max(m, t.step_order || 0), 0)
    const wf = workflows.find(w => w.id === wfId)
    const { data } = await createTask({
      workflow_instance_id: wfId,
      project_id: selected?.id || null,
      title: addTaskForm.title.trim(),
      assignee: addTaskForm.assignee || null,
      due_date: addTaskForm.due_date || null,
      status: '待處理',
      step_order: maxOrder + 1,
      bucket: 'Workflow',
      category: 'Workflow',
      priority: '中',
    })
    if (data) {
      setTasks(prev => [...prev, data])
      setAddTaskForm({ title: '', assignee: '', due_date: '' })
      setAddingTaskWfId(null)
      if (data.assignee) notifyTaskAssignee(data.assignee, data.title, wf?.template_name || '', data.id, {
        dueDate: data.due_date, description: data.description, notes: data.notes, store: data.store,
        approvalRequired: data.status === '待簽核',
      }).catch(() => {})
    }
  }

  const handleAddDirectTask = async () => {
    if (!directTaskForm.title.trim() || !selected) return
    const directTasks = tasks.filter(t => t.project_id === selected.id && !t.workflow_instance_id)
    const maxOrder = directTasks.reduce((m, t) => Math.max(m, t.step_order || 0), 0)
    const { data } = await createTask({
      project_id: selected.id,
      title: directTaskForm.title.trim(),
      assignee: directTaskForm.assignee || null,
      due_date: directTaskForm.due_date || null,
      priority: directTaskForm.priority || '中',
      status: '待處理',
      step_order: maxOrder + 1,
      bucket: 'Project',
      category: 'Project',
    })
    if (data) {
      setTasks(prev => [...prev, data])
      setDirectTaskForm({ title: '', assignee: '', due_date: '', priority: '中' })
      setAddingDirectTask(false)
    }
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

  // Filter
  const activeStatuses = tab === 'active' ? ['規劃中', '進行中'] : tab === 'completed' ? ['已完成'] : ['暫停', '已取消']
  const filtered = projects.filter(p => {
    if (!activeStatuses.includes(p.status)) return false
    if (filterOwner && p.owner !== filterOwner) return false
    if (filterStore && p.store !== filterStore) return false
    return true
  })

  const activeCount = projects.filter(p => ['規劃中', '進行中'].includes(p.status)).length
  const completedCount = projects.filter(p => p.status === '已完成').length
  const archivedCount = projects.filter(p => ['暫停', '已取消'].includes(p.status)).length

  if (loading) return <LoadingSpinner />

  // Detail view
  if (selected) {
    const p = selected
    const stats = getStats(p.id)
    const pWorkflows = workflows.filter(w => w.project_id === p.id)
    const pComments = comments.filter(c => c.project_id === p.id)
    const sc = STATUS_MAP[p.status] || {}

    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-header-row">
            <div>
              <button className="btn btn-secondary" style={{ marginBottom: 8, fontSize: 12 }} onClick={() => setSelected(null)}>← 返回專案列表</button>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="header-icon">📁</span> {p.name}
                <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: sc.color, background: `color-mix(in srgb, ${sc.color} 15%, transparent)` }}>{p.status}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: PRIORITY_COLORS[p.priority] }}>{p.priority}</span>
              </h2>
              <p>{p.description || '無說明'}</p>
            </div>
            <button className="btn btn-secondary" onClick={(e) => openEdit(p, e)}><Edit3 size={14} /> 編輯</button>
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
          {p.start_date && <div><span style={{ color: 'var(--text-muted)' }}>期間</span> {p.start_date} ~ {p.end_date || '未定'}</div>}
          {p.budget && <div><span style={{ color: 'var(--text-muted)' }}>預算</span> {fmt(p.budget)}</div>}
        </div>

        {/* Detail tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 16 }}>
          {[
            { k: 'overview',  label: '總覽',     icon: FolderOpen },
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
              // Canonical source: task assignee_id FKs
              tasks.forEach(t => {
                if (wfIds.has(t.workflow_instance_id) && t.assignee_id) ids.add(t.assignee_id)
              })
              // Name fallbacks: skip if that name is already represented by an id in the set
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
          const wTasks = tasks.filter(t => t.workflow_instance_id === w.id)
          const wTotal = wTasks.length
          const wDone = wTasks.filter(t => t.status === '已完成').length
          const wInProgress = wTasks.filter(t => t.status === '進行中').length
          const wPending = wTotal - wDone - wInProgress
          const wPct = wTotal > 0 ? Math.round((wDone / wTotal) * 100) : 0
          const wColor = w.status === '已完成' ? 'var(--accent-green)' : w.status === '已退回' ? 'var(--accent-red)' : 'var(--accent-cyan)'

          const wCollapsed = collapsedWfIds.has(w.id)
          return (
            <div key={w.id} className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggleWf(w.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {wCollapsed
                    ? <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, transition: 'transform 0.2s' }} />
                    : <ChevronDown size={14} style={{ color: 'var(--accent-cyan)', flexShrink: 0, transition: 'transform 0.2s' }} />
                  }
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{w.template_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {w.started_by && `${w.started_by} · `}{w.started_at?.slice(0, 10)}
                      <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, color: wColor, background: `color-mix(in srgb, ${wColor} 15%, transparent)` }}>{w.status}</span>
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
                    onClick={e => { e.stopPropagation(); setAddingTaskWfId(addingTaskWfId === w.id ? null : w.id); setAddTaskForm({ title: '', assignee: '', due_date: '' }) }}
                  >
                    <Plus size={10} /> 新增任務
                  </button>
                </div>

                {wTasks.length === 0 && addingTaskWfId !== w.id && (
                  <div style={{ paddingLeft: 24, fontSize: 12, color: 'var(--text-muted)', paddingBottom: 4 }}>尚無步驟，點右側「新增任務」開始</div>
                )}

                {wTasks.map((t, idx) => {
                  const sc = TASK_STATUS_CONFIG[t.status] || TASK_STATUS_FALLBACK
                  return (
                    <div key={t.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px 5px 24px', fontSize: 13, borderRadius: 6, cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={() => setSelectedTask(t)}
                    >
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 18, textAlign: 'right', flexShrink: 0 }}>{idx + 1}</span>
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
                        style={{ fontSize: 11, fontWeight: 600, padding: '3px 6px', borderRadius: 6, border: `1px solid ${sc.color}`, background: sc.bg, color: sc.color, cursor: 'pointer', outline: 'none', minWidth: 72 }}
                      >
                        {TASK_STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )
                })}

                {addingTaskWfId === w.id && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 4px 4px 24px', flexWrap: 'wrap' }}>
                    <input
                      className="form-input"
                      style={{ flex: '1 1 160px', fontSize: 12 }}
                      placeholder="任務名稱 *"
                      autoFocus
                      value={addTaskForm.title}
                      onChange={e => setAddTaskForm(f => ({ ...f, title: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleAddTaskToWorkflow(w.id)}
                    />
                    <div style={{ flex: '0 0 130px' }}>
                      <SearchableSelect
                        value={addTaskForm.assignee}
                        onChange={(v) => setAddTaskForm(f => ({ ...f, assignee: v || '' }))}
                        options={empOptions(employees, { keyBy: 'name' })}
                        placeholder="負責人"
                      />
                    </div>
                    <input className="form-input" type="date" style={{ flex: '0 0 130px', fontSize: 12 }}
                      value={addTaskForm.due_date} onChange={e => setAddTaskForm(f => ({ ...f, due_date: e.target.value }))} />
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '5px 12px' }}
                      disabled={!addTaskForm.title.trim()} onClick={() => handleAddTaskToWorkflow(w.id)}>確認</button>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }}
                      onClick={() => setAddingTaskWfId(null)}>取消</button>
                  </div>
                )}
              </div>}
            </div>
          )
        })}

        {/* Direct project tasks (not inside any workflow) */}
        {(() => {
          const directTasks = tasks.filter(t => t.project_id === p.id && !t.workflow_instance_id)
          return (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                  <CheckSquare size={15} /> 獨立任務（{directTasks.length}）
                </span>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => { setAddingDirectTask(v => !v); setDirectTaskForm({ title: '', assignee: '', due_date: '', priority: '中' }) }}>
                  <Plus size={12} /> 新增任務
                </button>
              </div>
              <div className="card" style={{ padding: '8px 12px' }}>
                {directTasks.length === 0 && !addingDirectTask && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>尚無獨立任務。點「新增任務」直接加入專案。</div>
                )}
                {directTasks.map((t, idx) => {
                  const sc = TASK_STATUS_CONFIG[t.status] || TASK_STATUS_FALLBACK
                  return (
                    <div key={t.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 13, borderRadius: 6, cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={() => setSelectedTask(t)}
                    >
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 18, textAlign: 'right', flexShrink: 0 }}>{idx + 1}</span>
                      <span style={{ flex: 1, fontWeight: 500, lineHeight: 1.4, textDecoration: t.status === '已完成' ? 'line-through' : 'none', color: t.status === '已完成' ? 'var(--text-muted)' : 'var(--text-primary)' }}>{t.title}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: PRIORITY_COLORS[t.priority], minWidth: 20 }}>{t.priority}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 60 }}>{t.assignee || '—'}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 60 }}>{t.due_date || '—'}</span>
                      <select
                        value={t.status}
                        onClick={e => e.stopPropagation()}
                        onChange={e => { e.stopPropagation(); handleTaskStatusChange(t.id, e.target.value) }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '3px 6px', borderRadius: 6, border: `1px solid ${sc.color}`, background: sc.bg, color: sc.color, cursor: 'pointer', outline: 'none', minWidth: 72 }}
                      >
                        {TASK_STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )
                })}
                {addingDirectTask && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 4px 4px', flexWrap: 'wrap' }}>
                    <input
                      className="form-input" style={{ flex: '1 1 160px', fontSize: 12 }}
                      placeholder="任務名稱 *" autoFocus
                      value={directTaskForm.title}
                      onChange={e => setDirectTaskForm(f => ({ ...f, title: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleAddDirectTask()}
                    />
                    <div style={{ flex: '0 0 130px' }}>
                      <SearchableSelect
                        value={directTaskForm.assignee}
                        onChange={(v) => setDirectTaskForm(f => ({ ...f, assignee: v || '' }))}
                        options={empOptions(employees, { keyBy: 'name' })}
                        placeholder="負責人"
                      />
                    </div>
                    <input className="form-input" type="date" style={{ flex: '0 0 130px', fontSize: 12 }}
                      value={directTaskForm.due_date} onChange={e => setDirectTaskForm(f => ({ ...f, due_date: e.target.value }))} />
                    <select className="form-input" style={{ flex: '0 0 70px', fontSize: 12 }}
                      value={directTaskForm.priority} onChange={e => setDirectTaskForm(f => ({ ...f, priority: e.target.value }))}>
                      <option>高</option><option>中</option><option>低</option>
                    </select>
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '5px 12px' }}
                      disabled={!directTaskForm.title.trim()} onClick={handleAddDirectTask}>確認</button>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }}
                      onClick={() => setAddingDirectTask(false)}>取消</button>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Comments */}
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
          <MessageSquare size={15} /> 備註（{pComments.length}）
        </div>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, maxWidth: 500 }}>
            <input type="text" value={commentText} onChange={e => setCommentText(e.target.value)}
              placeholder="新增備註..." onKeyDown={e => e.key === 'Enter' && addComment(p.id)}
              style={{ flex: 1, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13 }} />
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

        {/* Task detail panel */}
        {selectedTask && (
          <TaskDetailPanel
            step={selectedTask}
            instance={pWorkflows.find(w => w.id === selectedTask.workflow_instance_id) || null}
            allSteps={selectedTask.workflow_instance_id
              ? tasks.filter(t => t.workflow_instance_id === selectedTask.workflow_instance_id)
              : [selectedTask]}
            employees={employees}
            stores={stores}
            checklists={[]}
            onUpdate={updated => {
              setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
              setSelectedTask(updated)
            }}
            onDelete={id => {
              setTasks(prev => prev.filter(t => t.id !== id))
              setSelectedTask(null)
            }}
            onClose={() => setSelectedTask(null)}
          />
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
                </div>
                <Field label="到期日">
                  <input className="form-input" type="date" style={{ width: '100%' }} value={newWfForm.due_date} onChange={e => setNewWfForm(f => ({ ...f, due_date: e.target.value }))} />
                </Field>
              </>
            )}
          </Modal>
        )}

        {/* Modal in detail view */}
        {showModal && (
          <Modal title={editingId ? '編輯專案' : '新增專案'} onClose={() => setShowModal(false)} onSubmit={handleSubmit} submitLabel={editingId ? '更新' : '建立'}>
            <Field label="專案名稱" required>
              <input className="form-input" style={{ width: '100%' }} value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="狀態">
                <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                  {Object.keys(STATUS_MAP).map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="優先級">
                <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
                  <option>高</option><option>中</option><option>低</option>
                </select>
              </Field>
              <Field label="預算">
                <input className="form-input" type="number" style={{ width: '100%' }} value={form.budget} onChange={e => set('budget', e.target.value)} placeholder="選填" />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="負責人">
                <SearchableSelect
                  value={form.owner}
                  onChange={(v) => set('owner', v || '')}
                  options={empOptions(employees, { keyBy: 'name' })}
                  placeholder="搜尋專案負責人..."
                />
              </Field>
              <Field label="門市">
                <select className="form-input" style={{ width: '100%' }} value={form.store} onChange={e => set('store', e.target.value)}>
                  <option value="">不指定</option>
                  {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="開始日期"><input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} /></Field>
              <Field label="結束日期"><input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} /></Field>
            </div>
            <Field label="說明">
              <textarea className="form-input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} />
            </Field>
          </Modal>
        )}
      </div>
    )
  }

  // List view
  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📁</span> 專案管理</h2>
            <p>Project → Workflow → Task 三層架構</p>
          </div>
          <button className="btn btn-primary" onClick={async () => {
            const { data } = await supabase.from('workflow_instances').select('id, template_name, status, started_by, started_at').is('project_id', null).order('started_at', { ascending: false })
            setFreeInstances(data || [])
            resetNewProjectState()
            setForm({ ...emptyForm, owner: profile?.name || '' }); setEditingId(null); setShowModal(true)
          }}>
            <Plus size={14} /> 新增專案
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          <FolderOpen size={14} /> 負責人
          <select value={filterOwner} onChange={e => setFilterOwner(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13, minWidth: 120 }}>
            <option value="">全部人員</option>
            {[...new Set(projects.map(p => p.owner).filter(Boolean))].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          🏪 門市
          <select value={filterStore} onChange={e => setFilterStore(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13, minWidth: 120 }}>
            <option value="">全部門市</option>
            {[...new Set(projects.map(p => p.store).filter(Boolean))].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {[
          { key: 'active', label: `進行中專案 (${activeCount})`, color: 'var(--accent-cyan)' },
          { key: 'templates', label: `專案模板 (${templates.length})`, color: 'var(--accent-purple)' },
          { key: 'completed', label: `已完成 (${completedCount})`, color: 'var(--accent-green)' },
          { key: 'archived', label: `封存 (${archivedCount})`, color: 'var(--accent-red)' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? t.color : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            border: tab === t.key ? 'none' : '1px solid var(--border-medium)',
          }}>
            {tab === t.key && '● '}{t.label}
          </button>
        ))}
      </div>

      {/* Templates tab */}
      {tab === 'templates' && (
        <div>
          {templates.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無專案模板</div>
          ) : templates.map(tpl => {
            const tplWorkflows = Array.isArray(tpl.workflows) ? tpl.workflows : JSON.parse(tpl.workflows || '[]')
            const totalTasks = tplWorkflows.reduce((s, w) => s + (w.tasks?.length || 0), 0)
            return (
              <div key={tpl.id} className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-purple-dim)', border: '1px solid var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📋</div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{tpl.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {tpl.category} · {tplWorkflows.length} 流程 · {totalTasks} 任務
                        {tpl.estimated_days && ` · 預估 ${tpl.estimated_days} 天`}
                        {tpl.estimated_budget && ` · 預算 NT$ ${Number(tpl.estimated_budget).toLocaleString()}`}
                      </div>
                    </div>
                  </div>
                  <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => openDeploy(tpl)}>
                    <Rocket size={14} /> 部署
                  </button>
                </div>
                {tpl.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>{tpl.description}</div>}
                {/* Workflow preview */}
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {tplWorkflows.map((w, i) => (
                    <div key={i} style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', fontSize: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>{w.name}</div>
                      {(w.tasks || []).map((t, j) => (
                        <div key={j} style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CheckSquare size={10} /> {t.title}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Deploy Modal */}
      {showDeployModal && deployTpl && (
        <Modal title={`部署專案 — ${deployTpl.name}`} onClose={() => setShowDeployModal(false)} onSubmit={handleDeploy} submitLabel={deploying ? '部署中...' : '🚀 部署'}>
          <Field label="專案名稱" required>
            <input className="form-input" style={{ width: '100%' }} value={deployForm.name} onChange={e => setDeployForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責人">
              <SearchableSelect
                value={deployForm.owner}
                onChange={(v) => setDeployForm(f => ({ ...f, owner: v || '' }))}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋負責人..."
              />
            </Field>
            <Field label="門市">
              <select className="form-input" style={{ width: '100%' }} value={deployForm.store} onChange={e => setDeployForm(f => ({ ...f, store: e.target.value }))}>
                <option value="">不指定</option>
                {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ background: 'var(--glass-light)', borderRadius: 8, padding: 12, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>將自動建立：</div>
            {(Array.isArray(deployTpl.workflows) ? deployTpl.workflows : JSON.parse(deployTpl.workflows || '[]')).map((w, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--accent-cyan)' }}>📂 {w.name}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({w.tasks?.length || 0} 任務)</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Project list */}
      {tab !== 'templates' && filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {tab === 'active' ? '目前沒有進行中的專案。點「新增專案」或從「專案模板」部署。' : '無資料'}
        </div>
      )}
      {tab !== 'templates' && filtered.map(p => {
        const stats = getStats(p.id)
        const sc = STATUS_MAP[p.status] || {}

        return (
          <div key={p.id} className="card" style={{ marginBottom: 10, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.2s' }}
            onClick={() => setSelected(p)}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</span>
                    <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, color: sc.color, background: `color-mix(in srgb, ${sc.color} 15%, transparent)` }}>{p.status}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: PRIORITY_COLORS[p.priority] }}>{p.priority}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {p.owner || '未指派'} · {p.start_date || '未定'}{p.end_date && ` ~ ${p.end_date}`}
                    {stats.workflows > 0 && ` · ${stats.workflows} 流程`}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ display: 'flex', gap: 10, fontSize: 12, whiteSpace: 'nowrap' }}>
                  <span>⬜ {stats.pending}</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>🔄 {stats.inProgress}</span>
                  <span style={{ color: 'var(--accent-green)' }}>✅ {stats.completed}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent-cyan)', lineHeight: 1 }}>{stats.pct}%</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stats.completed}/{stats.total}</div>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: `conic-gradient(var(--accent-cyan) ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{stats.pct}%</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-secondary" style={{ padding: '3px 7px' }} onClick={(e) => openEdit(p, e)}><Edit3 size={12} /></button>
                  <button className="btn btn-secondary" style={{ padding: '3px 7px', color: 'var(--accent-red)' }} onClick={(e) => handleDelete(p.id, e)}><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {/* Modal */}
      {showModal && (
        <Modal title={editingId ? '編輯專案' : '新增專案'} onClose={() => { setShowModal(false); setEditingId(null); resetNewProjectState() }} onSubmit={handleSubmit} submitLabel={editingId ? '更新' : '建立'}>
          <Field label="專案名稱" required>
            <input className="form-input" style={{ width: '100%' }} value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：南京門市裝潢翻新" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.keys(STATUS_MAP).map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="優先級">
              <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option>高</option><option>中</option><option>低</option>
              </select>
            </Field>
            <Field label="預算">
              <input className="form-input" type="number" style={{ width: '100%' }} value={form.budget} onChange={e => set('budget', e.target.value)} placeholder="選填" />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責人">
              <SearchableSelect
                value={form.owner}
                onChange={(v) => set('owner', v || '')}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋員工姓名/職稱..."
              />
            </Field>
            <Field label="門市">
              <select className="form-input" style={{ width: '100%' }} value={form.store} onChange={e => set('store', e.target.value)}>
                <option value="">不指定</option>
                {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="開始日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>
            <Field label="結束日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </Field>
          </div>
          <Field label="說明">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="專案描述..." />
          </Field>

          {!editingId && <>
            {/* Workflows */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Workflow size={13} /> 流程（選填）
              </div>
              {(pendingWfAttach.length > 0 || pendingWfCreate.length > 0) && (
                <div style={{ marginBottom: 8 }}>
                  {pendingWfAttach.map(id => {
                    const wf = freeInstances.find(w => w.id === id)
                    return wf ? (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 6, background: 'var(--glass-light)', marginBottom: 4, fontSize: 12 }}>
                        <Workflow size={11} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{wf.template_name} <span style={{ color: 'var(--text-muted)' }}>（連結現有）</span></span>
                        <button onClick={() => setPendingWfAttach(p => p.filter(x => x !== id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}><X size={12} /></button>
                      </div>
                    ) : null
                  })}
                  {pendingWfCreate.map((wf, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 6, background: 'var(--glass-light)', marginBottom: 4, fontSize: 12 }}>
                      <Plus size={11} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{wf.template_name} <span style={{ color: 'var(--text-muted)' }}>（新建）</span></span>
                      <button onClick={() => setPendingWfCreate(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {inlineWfMode === 'attach' && (
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', marginBottom: 8 }}>
                  {freeInstances.filter(w => !pendingWfAttach.includes(w.id)).length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>沒有未連結的流程實例</div>
                  ) : (
                    <select className="form-input" style={{ width: '100%', marginBottom: 8, fontSize: 13 }} value={inlineWfAttachId} onChange={e => setInlineWfAttachId(e.target.value)}>
                      <option value="">選擇現有流程…</option>
                      {freeInstances.filter(w => !pendingWfAttach.includes(w.id)).map(w => (
                        <option key={w.id} value={w.id}>{w.template_name} — {w.status}{w.started_by ? ` (${w.started_by})` : ''}</option>
                      ))}
                    </select>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={!inlineWfAttachId}
                      onClick={() => { if (inlineWfAttachId) { setPendingWfAttach(p => [...p, Number(inlineWfAttachId)]); setInlineWfAttachId(''); setInlineWfMode(null) } }}>確認</button>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => { setInlineWfMode(null); setInlineWfAttachId('') }}>取消</button>
                  </div>
                </div>
              )}
              {inlineWfMode === 'create' && (
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', marginBottom: 8 }}>
                  <input className="form-input" style={{ width: '100%', marginBottom: 8, fontSize: 13 }} placeholder="流程名稱 *"
                    value={inlineWfCreate.template_name} onChange={e => setInlineWfCreate(f => ({ ...f, template_name: e.target.value }))} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={!inlineWfCreate.template_name}
                      onClick={() => { if (inlineWfCreate.template_name) { setPendingWfCreate(p => [...p, { ...inlineWfCreate }]); setInlineWfCreate({ template_name: '' }); setInlineWfMode(null) } }}>確認</button>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => { setInlineWfMode(null); setInlineWfCreate({ template_name: '' }) }}>取消</button>
                  </div>
                </div>
              )}
              {!inlineWfMode && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => setInlineWfMode('attach')}><Workflow size={11} /> 連結現有流程</button>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => setInlineWfMode('create')}><Plus size={11} /> 建立新流程</button>
                </div>
              )}
            </div>

            {/* Tasks */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckSquare size={13} /> 任務（選填）
              </div>
              {pendingTasks.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {pendingTasks.map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 6, background: 'var(--glass-light)', marginBottom: 4, fontSize: 12 }}>
                      <CheckSquare size={11} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{t.title}{t.assignee && <span style={{ color: 'var(--text-muted)' }}> · {t.assignee}</span>}{t.due_date && <span style={{ color: 'var(--text-muted)' }}> · {t.due_date}</span>}</span>
                      <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--glass-light)', color: PRIORITY_COLORS[t.priority] }}>{t.priority}</span>
                      <button onClick={() => setPendingTasks(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {inlineTaskMode && (
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', marginBottom: 8 }}>
                  <input className="form-input" style={{ width: '100%', marginBottom: 8, fontSize: 13 }} placeholder="任務名稱 *"
                    value={inlineTask.title} onChange={e => setInlineTask(f => ({ ...f, title: e.target.value }))} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <SearchableSelect
                      value={inlineTask.assignee}
                      onChange={(v) => setInlineTask(f => ({ ...f, assignee: v || '' }))}
                      options={empOptions(employees, { keyBy: 'name' })}
                      placeholder="負責人"
                    />
                    <input className="form-input" type="date" style={{ fontSize: 13 }} value={inlineTask.due_date} onChange={e => setInlineTask(f => ({ ...f, due_date: e.target.value }))} />
                    <select className="form-input" style={{ fontSize: 13 }} value={inlineTask.priority} onChange={e => setInlineTask(f => ({ ...f, priority: e.target.value }))}>
                      <option>高</option><option>中</option><option>低</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={!inlineTask.title}
                      onClick={() => { if (inlineTask.title) { setPendingTasks(p => [...p, { ...inlineTask }]); setInlineTask({ title: '', assignee: '', due_date: '', priority: '中' }); setInlineTaskMode(false) } }}>確認</button>
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setInlineTaskMode(false)}>取消</button>
                  </div>
                </div>
              )}
              {!inlineTaskMode && (
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => setInlineTaskMode(true)}><Plus size={11} /> 新增任務</button>
              )}
            </div>
          </>}
        </Modal>
      )}
    </div>
  )
}
