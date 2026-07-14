import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from '../../lib/toast'
import { supabase } from '../../lib/supabase'
import { getEmployees, getDepartments, getProjectSections, createProjectSection, updateProjectSection, deleteProjectSection, createWorkflowInstance, updateTask, createTask, drainEntity } from '../../lib/db'
import { useRealtimeTasks, useRealtimeWorkflowInstances } from '../../lib/hooks/useRealtimeSync'
import { useAuth } from '../../contexts/AuthContext'
import { useAuditLog } from '../../lib/useAuditLog'
import { notifyTaskAssignee, notifyProjectMembers } from '../../lib/lineNotify'
import LoadingSpinner from '../../components/LoadingSpinner'
import { confirm } from '../../lib/confirm'
import ProjectDetailPanel from './components/ProjectDetailPanel'
import ProjectListView from './components/ProjectListView'
import SelfFillQueue from '../../components/tasks/SelfFillQueue'
import { createTaskBindings } from '../../lib/createTaskBindings'

const emptyForm = { name: '', description: '', status: '規劃中', priority: '中', owner: '', department: '', store: '', start_date: '', end_date: '', budget: '', template_id: '' }

const PROJECT_FIELD_LABELS = {
  name: '名稱', description: '描述', status: '狀態', priority: '優先', owner: '負責人',
  department: '部門', store: '門市', start_date: '開始日', end_date: '結束日', budget: '預算',
}

export default function Projects() {
  const { profile } = useAuth()
  const { logAction, logFieldChange } = useAuditLog()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState([])
  const [workflows, setWorkflows] = useState([])
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [templates, setTemplates] = useState([])
  const [approvalChains, setApprovalChains] = useState([])
  const [checklists, setChecklists] = useState([])
  const [departments, setDepartments] = useState([])
  const [comments, setComments] = useState([])
  const [selfFillQueue, setSelfFillQueue] = useState(null)  // 建立任務後自己填表單跳出佇列
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployTpl, setDeployTpl] = useState(null)
  const [deployForm, setDeployForm] = useState({ name: '', store: '', owner: '', start_date: '', end_date: '', workflows: [] })
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
  const [newWfForm, setNewWfForm] = useState({ template_name: '', assignee: '', store: '', due_date: '', planned_start_date: '', planned_end_date: '', priority: '中', completion_chain_id: '', notes: '' })
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
  // Budget actuals
  const [expenses, setExpenses] = useState([])

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
    if (!(await confirm({ message: `確定刪除流程「${w.template_name}」？底下的步驟任務會一併刪除，此操作無法復原。`, danger: true }))) return
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

  // Budget actuals: single handler — pass null as projectId to unlink
  const setExpenseProject = useCallback(async (expenseId, projectId) => {
    const { error } = await supabase.from('expense_requests').update({ project_id: projectId ?? null }).eq('id', expenseId)
    if (error) { toast.error((projectId ? '連結' : '取消連結') + '失敗：' + error.message); return }
    setExpenses(prev => prev.map(e => e.id === expenseId ? { ...e, project_id: projectId ?? null } : e))
  }, [])

  // 把專案裡的任務「指派給其他部門」→ 建跨部門工單雙向綁定(工單完成→任務自動完成)
  const handleTaskToWorkOrder = async (taskId, { target_department_id, expected_due_date, priority }) => {
    const { data, error } = await supabase.rpc('create_work_order_for_task', {
      p_task_id: taskId,
      p_target_department_id: Number(target_department_id),
      p_expected_due_date: expected_due_date || null,
      p_priority: priority || null,
    })
    if (error) { toast.error('開工單失敗：' + error.message); return false }
    if (!data?.ok) { toast.error('開工單失敗：' + (data?.error === 'ALREADY_LINKED' ? '此任務已開過工單' : data?.error === 'TASK_DONE' ? '任務已完成' : data?.error)); return false }
    toast.success('已為此任務開跨部門工單，對方完成後任務自動關閉')
    load()
    return true
  }

  // 從工單「轉專案」跳來(?link_work_order=N) → 開新增專案 modal(one-shot,取消不重開;建了才綁)
  const woLinkOpenedRef = useRef(false)
  useEffect(() => {
    if (searchParams.get('link_work_order') && !woLinkOpenedRef.current) {
      woLinkOpenedRef.current = true
      setEditingId(null); setForm(emptyForm); setShowModal(true)
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    const orgId = profile?.organization_id
    if (!orgId) return // Auth not ready; re-triggered when profile resolves (see useEffect below)
    setLoading(true)
    const [pRes, wRes, eRes, sRes, cRes, tplRes, acRes, expRes, dRes, clRes] = await Promise.all([
      supabase.from('projects').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('workflow_instances').select('*').eq('organization_id', orgId).not('project_id', 'is', null).order('sort_order'),
      getEmployees(),
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('project_comments').select('*').order('created_at', { ascending: false }),
      supabase.from('project_templates').select('*').order('id'),
      supabase.from('approval_chains').select('id, name, steps:approval_chain_steps(id)').order('name'),
      supabase.from('expense_requests')
        .select('id, title, employee, estimated_amount, actual_amount, status, project_id, account_name, store, created_at')
        .order('created_at', { ascending: false }),
      getDepartments(orgId),
      supabase.from('checklists').select('id, name, items').order('name'),
    ])
    // Load tasks that either carry project_id directly OR belong to a project's workflow instance.
    // Two separate queries avoids URL-length overflow: the old .or() with wIds.join(',') breaks
    // when there are 200+ workflow instances (each UUID is 36 chars → 7KB+ query string).
    const wIds = (wRes.data || []).map(w => w.id)
    const [directRes, wfTaskRes] = await Promise.all([
      supabase.from('tasks').select('*').eq('organization_id', orgId).not('project_id', 'is', null).order('step_order'),
      wIds.length > 0
        ? supabase.from('tasks').select('*').eq('organization_id', orgId).in('workflow_instance_id', wIds).order('step_order')
        : Promise.resolve({ data: [] }),
    ])
    // Deduplicate: a task may have both project_id and workflow_instance_id set
    const taskMap = new Map()
    for (const t of [...(directRes.data || []), ...(wfTaskRes.data || [])]) {
      if (!taskMap.has(t.id)) taskMap.set(t.id, t)
    }
    const allProjects = pRes.data || []
    setProjects(allProjects)
    setWorkflows(wRes.data || [])
    setTasks([...taskMap.values()].sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0)))
    setEmployees((eRes.data || []).filter(e => e.status === '在職'))
    setStores(sRes.data || [])
    setComments(cRes.data || [])
    setTemplates(tplRes.data || [])
    setApprovalChains(acRes.data || [])
    setExpenses(expRes.data || [])
    setDepartments(dRes.data || [])
    setChecklists(clRes.data || [])
    setLoading(false)

    // 從 ?project=id 自動展開專案（儀表板點任務導過來）
    const focusProjId = searchParams.get('project')
    if (focusProjId) {
      const proj = allProjects.find(p => p.id === Number(focusProjId))
      if (proj) setSelected(proj)
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('project'); return x }, { replace: true })
    }
  }

  // Re-run when auth profile resolves (avoids race where load() fires before profile is ready)
  useEffect(() => { if (profile?.organization_id) load() }, [profile?.organization_id])

  // Live-sync: reflect task & workflow-instance changes from other users/tabs
  useRealtimeTasks(setTasks)
  useRealtimeWorkflowInstances(setWorkflows)

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
      // ★ 必設 owner_id：projects_sel RLS 靠 owner_id=current_employee_id() 讓非 admin 讀回自己建的專案
      //   （少了它 → insert 過但 select 讀不回 → .single() 噴錯，office_staff 建立失敗）
      payload.owner_id = payload.owner_id || profile?.id || null
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
          const { data: newWf } = await createWorkflowInstance({
            template_name: wf.name || wf.template_name || '',
            status: '進行中',
            // workflow_instances_sel RLS 要 started_by_id/applicant_emp_id=本人 才讀得回（非 admin）
            started_by_id: profile?.id || null,
            applicant_emp_id: profile?.id || null,
            started_by: wf.assignee || payload.owner,
            assignee: wf.assignee || null,
            store: wf.store || payload.store || null,
            planned_start_date: wf.planned_start_date || null,
            planned_end_date: wf.planned_end_date || null,
            priority: wf.priority || '中',
            due_date: wf.due_date || payload.end_date || null,
            completion_chain_id: wf.completion_chain_id ? Number(wf.completion_chain_id) : null,
            notes: wf.notes || null,
            project_id: data.id, sort_order: sortOrder++,
            started_at: new Date().toISOString(),
            organization_id: profile?.organization_id || null,
          })
          // 該流程底下的任務（含簽核 + 綁定表單，對齊其他建任務路徑）
          if (newWf && (wf.tasks || []).length > 0) {
            const wfTaskRows = wf.tasks.map((t, ti) => ({
              workflow_instance_id: newWf.id, project_id: data.id,
              title: t.title, description: t.description || null,
              assignee: t.assignee || null,
              assignee_id: t.assignee ? (employees.find(e => e.name === t.assignee)?.id || null) : null,
              store: t.store || null, planned_start: t.planned_start || null,
              due_date: t.due_date || null, role: t.role || null,
              priority: t.priority || '中',
              status: ti === 0 ? '進行中' : '待處理',
              started_at: ti === 0 ? new Date().toISOString() : null,
              step_order: ti + 1, bucket: '工作流程', category: '工作流程',
              approval_chain_id: t.approval_mode === 'chain' && t.approval_chain_id ? Number(t.approval_chain_id) : null,
              confirmation_mode: t.approval_mode === 'people' ? (t.confirmation_mode || 'parallel') : null,
              organization_id: profile?.organization_id || null,
              created_by_emp_id: profile?.id || null,   // tasks_ins RLS：指派給別人時靠建立者過
            }))
            const { data: insertedWfTasks } = await supabase.from('tasks').insert(wfTaskRows).select()
            for (let ti = 0; ti < (insertedWfTasks?.length || 0); ti++) {
              const t = wf.tasks[ti], row = insertedWfTasks[ti]
              if (t.approval_mode === 'people' && (t.confirmation_approvers || []).length > 0) {
                await supabase.from('task_confirmations').insert(
                  t.confirmation_approvers.map((approver, idx) => ({
                    task_id: row.id, approver, step_order: idx, status: 'pending',
                    organization_id: profile?.organization_id || null,
                  }))
                )
              }
              await createTaskBindings(row.id, t.required_forms, profile)
              // 第一步（進行中）才推；未開始的後續步驟等 cascade 由 DB trigger 推
              if (row.status === '進行中' && row.assignee) {
                notifyTaskAssignee(row.assignee, row.title, wf.name || wf.template_name || '', row.id, {
                  dueDate: row.due_date, description: row.description, notes: row.notes, store: row.store,
                  approvalRequired: row.status === '待簽核', priority: row.priority,
                }).catch(() => {})
              }
            }
          }
        }
        if (pendingTasks.length > 0) {
          const taskRows = pendingTasks.map((t, i) => ({
            title: t.title, project_id: data.id,
            assignee: t.assignee || null,
            assignee_id: t.assignee ? (employees.find(e => e.name === t.assignee)?.id || null) : null,
            due_date: t.due_date || null,
            planned_start: t.planned_start || null,
            description: t.description || null,
            role: t.role || null,
            priority: t.priority || '中',
            // step 1 直接開工 進行中、step 2+ 待處理（等前一步 trigger 自動 advance）
            status: i === 0 ? '進行中' : '待處理',
            started_at: i === 0 ? new Date().toISOString() : null,
            step_order: i + 1, bucket: 'Project', category: 'Project',
            store: t.store || payload.store || null,
            approval_chain_id: t.approval_mode === 'chain' && t.approval_chain_id ? Number(t.approval_chain_id) : null,
            confirmation_mode: t.approval_mode === 'people' ? (t.confirmation_mode || 'parallel') : null,
            organization_id: profile?.organization_id || null,
            created_by_emp_id: profile?.id || null,   // tasks_ins RLS：指派給別人時靠建立者過
          }))
          const { data: insertedTasks } = await supabase.from('tasks').insert(taskRows).select()
          // 指定人員簽核 → task_confirmations；綁定表單 → create_task_form_binding（對齊其他建任務路徑）
          for (let i = 0; i < (insertedTasks?.length || 0); i++) {
            const t = pendingTasks[i], row = insertedTasks[i]
            if (t.approval_mode === 'people' && (t.confirmation_approvers || []).length > 0) {
              await supabase.from('task_confirmations').insert(
                t.confirmation_approvers.map((approver, idx) => ({
                  task_id: row.id, approver, step_order: idx, status: 'pending',
                  organization_id: profile?.organization_id || null,
                }))
              )
            }
            await createTaskBindings(row.id, t.required_forms, profile)
          }
        }
        if (pendingWfAttach.length > 0 || pendingWfCreate.length > 0 || pendingTasks.length > 0) load()
        // 從工單「轉專案」跳來 → 建完專案後綁定工單(工單完成改由專案任務全完成連動)
        const linkWoId = searchParams.get('link_work_order')
        if (linkWoId) {
          const { data: lk } = await supabase.rpc('link_work_order_project', { p_id: Number(linkWoId), p_project_id: data.id })
          if (lk?.ok) toast.success(`已綁定工單 #${linkWoId}，專案任務全完成後工單自動結案`)
          else toast.error('工單綁定失敗：' + (lk?.error || '未知'))
          setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('link_work_order'); return x }, { replace: true })
        }
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

  const handleMoveToTop = (id, e) => {
    e?.stopPropagation()
    setProjects(prev => {
      const idx = prev.findIndex(p => p.id === id)
      if (idx <= 0) return prev
      const next = [...prev]
      next.unshift(next.splice(idx, 1)[0])
      return next
    })
    setProjMenuId(null)
  }

  const handleDelete = async (id, e) => {
    e?.stopPropagation()
    if (!(await confirm({ title: '刪除專案', message: `確定刪除此專案？所有相關流程與任務的連結將解除，資料會移入回收暫存區備份（可供復原）。此操作無法立即復原。`, confirmLabel: '確認刪除', danger: true }))) return
    const proj = projects.find(p => p.id === id)
    if (proj) {
      // 回收桶備份為盡力而為（deletion_drain 可能限 admin 寫）——失敗不擋刪除
      try { await drainEntity({
        entityType: 'project',
        entityId: id,
        entityName: proj.name,
        payload: proj,
        relatedData: null,
        deletedBy: profile?.name || '管理員',
        organizationId: profile?.organization_id || null,
      }) } catch { /* best-effort backup */ }
    }
    const { error: delErr } = await supabase.from('projects').delete().eq('id', id)
    if (delErr) { toast.error('刪除失敗：' + delErr.message); return }
    if (proj) await logAction('刪除', 'projects', id, `pj-${String(id).padStart(6, '0')} ${proj.name}`)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const openWorkflowModal = async (proj) => {
    const { data } = await supabase.from('workflow_instances').select('id, template_name, status, started_by, started_at').is('project_id', null).order('started_at', { ascending: false })
    setFreeInstances(data || [])
    setSelectedAttachId('')
    setNewWfForm({ template_name: '', assignee: proj.owner || profile?.name || '', store: proj.store || '', due_date: proj.end_date || '', planned_start_date: proj.start_date || '', planned_end_date: proj.end_date || '', priority: '中', completion_chain_id: '', notes: '' })
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
      // workflow_instances_sel RLS 要 started_by_id/applicant_emp_id=本人 非 admin 才讀得回
      started_by_id: profile?.id || null,
      applicant_emp_id: profile?.id || null,
      started_by: newWfForm.assignee || profile?.name || '',
      assignee: newWfForm.assignee || null,
      store: newWfForm.store || null,
      planned_start_date: newWfForm.planned_start_date || null,
      planned_end_date: newWfForm.planned_end_date || null,
      priority: newWfForm.priority || '中',
      due_date: newWfForm.due_date || null,
      completion_chain_id: newWfForm.completion_chain_id ? Number(newWfForm.completion_chain_id) : null,
      notes: newWfForm.notes || null,
      project_id: selected.id,
      sort_order: maxOrder + 1,
      started_at: new Date().toISOString(),
      organization_id: profile?.organization_id || null,
    })
    if (error) { toast.error('建立失敗，請稍後再試'); setWorkflowSaving(false); return }
    if (newWf) setWorkflows(prev => [...prev, newWf])
    setShowWorkflowModal(false)
    setWorkflowSaving(false)
  }

  const handleTaskStatusChange = async (taskId, newStatus) => {
    const { data } = await updateTask(taskId, {
      status: newStatus,
      completed_at: newStatus === '已完成' ? new Date().toISOString() : null,
    })
    if (data) {
      setTasks(prev => prev.map(t => t.id === taskId ? data : t))
      // 「進行中」通知由 DB trigger trg_task_enqueue_started_notify 統一推（前端不再推，避免雙推）
    }
  }

  // 可從 inline form (使用 state addTaskForm) 或 modal (傳 formData) 呼叫
  const handleAddTaskToWorkflow = async (wfId, formData) => {
    const fd = formData || addTaskForm
    if (!fd.title?.trim()) return false
    const instTasks = tasks.filter(t => t.workflow_instance_id === wfId)
    const maxOrder = instTasks.reduce((m, t) => Math.max(m, t.step_order || 0), 0)
    const empId = fd.assignee
      ? (employees.find(e => e.name === fd.assignee)?.id || null)
      : null
    const isFirstStep = instTasks.length === 0
    const chainId = fd.approval_mode === 'chain' && fd.approval_chain_id ? Number(fd.approval_chain_id) : null
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
      approval_chain_id: chainId,
      confirmation_mode: fd.approval_mode === 'people' ? (fd.confirmation_mode || 'parallel') : null,
      organization_id: profile?.organization_id || null,
      created_by_emp_id: profile?.id || null,   // tasks_ins RLS：指派給別人時靠建立者過
    })
    if (!data) return false
    // 指定人員簽核 → 建 task_confirmations（對齊獨立任務頁）
    if (fd.approval_mode === 'people' && (fd.confirmation_approvers || []).length > 0) {
      await supabase.from('task_confirmations').insert(
        fd.confirmation_approvers.map((approver, idx) => ({
          task_id: data.id, approver, step_order: idx, status: 'pending',
          organization_id: profile?.organization_id || null,
        }))
      )
    }
    // 綁定表單（自己填/他人填 + 暫存落地）+ 取得建立後待跳出佇列
    {
      const q = await createTaskBindings(data.id, fd.required_forms, profile, {
        onDraftError: (f, e) => toast.error(`「${f.label}」表單送出失敗：` + (e.message || '未知錯誤')),
      })
      if (q) setSelfFillQueue(q)
    }
    setTasks(prev => [...prev, data])
    if (!formData) {
      // inline path: 清空 state
      setAddTaskForm({ title: '', assignee: '', due_date: '', required_forms: [] })
      setAddingTaskWfId(null)
    }
    // 第一步（進行中）才推 LINE；未開始的後續步驟等 cascade 由 DB trigger 推（不在前端誤推）
    if (data.status === '進行中' && data.assignee) {
      notifyTaskAssignee(data.assignee, data.title, workflows.find(w => w.id === wfId)?.template_name || '', data.id, {
        dueDate: data.due_date, description: data.description, notes: data.notes, store: data.store,
        approvalRequired: data.status === '待簽核', priority: data.priority,
      }).catch(() => {})
    }
    return true
  }

  const handleAddDirectTask = async (formData) => {
    const fd = formData || directTaskForm
    if (!fd.title?.trim() || !selected) return false
    const directTasks = tasks.filter(t => t.project_id === selected.id && !t.workflow_instance_id)
    const maxOrder = directTasks.reduce((m, t) => Math.max(m, t.step_order || 0), 0)
    const empId = fd.assignee ? (employees.find(e => e.name === fd.assignee)?.id || null) : null
    const chainId = fd.approval_mode === 'chain' && fd.approval_chain_id ? Number(fd.approval_chain_id) : null
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
      approval_chain_id: chainId,
      confirmation_mode: fd.approval_mode === 'people' ? (fd.confirmation_mode || 'parallel') : null,
      organization_id: profile?.organization_id || null,
      created_by_emp_id: profile?.id || null,   // tasks_ins RLS：指派給別人時靠建立者過
    })
    if (!data) return false
    // 指定人員簽核 → 建 task_confirmations（對齊獨立任務頁）
    if (fd.approval_mode === 'people' && (fd.confirmation_approvers || []).length > 0) {
      await supabase.from('task_confirmations').insert(
        fd.confirmation_approvers.map((approver, idx) => ({
          task_id: data.id, approver, step_order: idx, status: 'pending',
          organization_id: profile?.organization_id || null,
        }))
      )
    }
    // 綁定表單（自己填/他人填 + 暫存落地）+ 取得建立後待跳出佇列
    {
      const q = await createTaskBindings(data.id, fd.required_forms, profile, {
        onDraftError: (f, e) => toast.error(`「${f.label}」表單送出失敗：` + (e.message || '未知錯誤')),
      })
      if (q) setSelfFillQueue(q)
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
      const today = deployForm.start_date || new Date().toISOString().slice(0, 10)
      const endDate = deployForm.end_date ||
        (tpl.estimated_days ? new Date(Date.now() + tpl.estimated_days * 86400000).toISOString().slice(0, 10) : null)

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

      // 2. Create workflows + tasks — prefer per-workflow overrides from deployForm
      //    進階欄位（綁表單/簽核鏈/查核清單/說明）一律取自「範本」tplWfs，避免 deployForm 覆寫時遺失
      const tplWfs = Array.isArray(tpl.workflows) ? tpl.workflows : JSON.parse(tpl.workflows || '[]')
      const deployWfs = deployForm.workflows?.length
        ? deployForm.workflows
        : tplWfs.map(w => ({
            name: w.name, owner: '', store: '', due_date: '',
            tasks: (w.tasks || []).map(t => ({ ...t, assignee: '', due_date: '' })),
          }))

      for (let i = 0; i < deployWfs.length; i++) {
        const wf = deployWfs[i]
        const tplWf = tplWfs[i] || { tasks: [] }
        // Fallback chain: wf-override → project-level → profile
        const wfOwner   = wf.owner   || deployForm.owner   || profile?.name || ''
        const wfStore   = wf.store   || deployForm.store   || null
        const wfDueDate = wf.due_date || endDate || null

        const { data: instance } = await supabase.from('workflow_instances').insert({
          template_name: wf.name,
          status: '進行中',
          started_by: wfOwner,
          started_by_id: profile?.id || null,
          applicant_emp_id: profile?.id || null,
          store: wfStore,
          due_date: wfDueDate,
          project_id: project.id,
          organization_id: orgId,  // ★ 補 org_id，否則 org-scoped 查詢會漏
          sort_order: i + 1,
          started_at: new Date().toISOString(),
        }).select().single()

        if (instance && wf.tasks?.length > 0) {
          const taskRows = wf.tasks.map((t, j) => {
            const rt = tplWf.tasks?.[j] || t   // 範本任務 = 進階欄位來源
            return {
              title: t.title,
              description: rt.description || null,
              approval_chain_id: rt.approval_chain_id || null,   // 任務完成後掛簽核鏈
              workflow_instance_id: instance.id,
              project_id: project.id,
              organization_id: orgId,  // ★ 補 org_id
              // step 1 直接開工 進行中、step 2+ 待處理（等 trg_task_advance_next_step 推進）
              // trigger:'manual' 的任務維持 待處理，需人工啟動
              status: j === 0 && t.trigger !== 'manual' ? '進行中' : '待處理',
              started_at: j === 0 && t.trigger !== 'manual' ? new Date().toISOString() : null,
              role: t.role || null,
              step_order: j + 1,
              priority: t.priority || '中',
              // Fallback chain: task-override → wf-override → project-level
              assignee: t.assignee || wfOwner || null,
              due_date: t.due_date || wfDueDate,
              store: wfStore,
              bucket: 'Project',
              category: wf.name || null,
              created_by_emp_id: profile?.id || null,   // tasks_ins RLS：指派給別人時靠建立者過
            }
          })
          // insert 帶 .select() 取回 id → 逐任務建綁表單 + 掛查核清單（比照流程範本部署）
          const { data: insertedTasks } = await supabase.from('tasks').insert(taskRows).select('id')
          if (insertedTasks) {
            for (let j = 0; j < insertedTasks.length; j++) {
              const rt = tplWf.tasks?.[j] || wf.tasks[j] || {}
              const taskId = insertedTasks[j].id
              for (const f of (rt.required_forms || [])) {
                await supabase.rpc('create_task_form_binding', {
                  p_task_id: taskId,
                  p_form_type: f.form_type,
                  p_form_template_id: f.form_template_id || null,
                  p_fill_mode: f.fill_mode || 'self',
                  p_assignee_id: f.fill_mode === 'other' ? (f.assignee_id || null) : null,
                })
              }
              if (rt.checklist_id) {
                await supabase.from('task_checklists').insert({ task_id: taskId, checklist_id: rt.checklist_id })
              }
            }
          }
        }
      }

      // LINE notify project owner
      if (deployForm.owner) {
        notifyTaskAssignee(deployForm.owner, `專案「${deployForm.name}」已建立`, '專案部署', null).catch(() => {})
      }

      // 通知專案成員：凡在此專案任一流程被指派任務者，各發一則彙總（聚合/去重/站內通知由 RPC 處理）
      notifyProjectMembers({ id: project.id, name: project.name, store: project.store }).catch(() => {})

      setShowDeployModal(false)
      setDeployTpl(null)
      load()
    } catch (err) {
      toast.error('部署失敗，請稍後再試')
    }
    setDeploying(false)
  }

  const openDeploy = (tpl) => {
    const tplWorkflows = Array.isArray(tpl.workflows)
      ? tpl.workflows
      : JSON.parse(tpl.workflows || '[]')
    const today = new Date().toISOString().slice(0, 10)
    const endDate = tpl.estimated_days
      ? new Date(Date.now() + tpl.estimated_days * 86400000).toISOString().slice(0, 10)
      : ''
    setDeployTpl(tpl)
    setDeployForm({
      name: tpl.name,
      store: '',
      owner: profile?.name || '',
      start_date: today,
      end_date: endDate,
      workflows: tplWorkflows.map(w => ({
        name:     w.name || '',
        owner:    '',
        store:    '',
        due_date: '',
        tasks: (w.tasks || []).map(t => ({
          title:    t.title    || '',
          role:     t.role     || '',
          priority: t.priority || '中',
          trigger:  t.trigger  || 'auto',
          assignee: '',
          due_date: '',
        })),
      })),
    })
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

  const handleCreateTemplate = async (payload) => {
    setTplSaving(true)
    const { data, error } = await supabase
      .from('project_templates')
      .insert(payload)
      .select()
      .single()
    if (error) {
      toast.error('建立失敗：' + error.message)
    } else if (data) {
      setTemplates(prev => [...prev, data])
      toast.success('模板已建立')
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

  const activeStatuses = tab === 'completed' ? ['已完成'] : ['規劃中', '進行中']
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
      <>
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
        departments={departments}
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
        allExpenses={expenses}
        onLinkExpense={setExpenseProject}
        onUnlinkExpense={(id) => setExpenseProject(id, null)}
        onTaskWorkOrder={handleTaskToWorkOrder}
      />
      {selfFillQueue && (
        <SelfFillQueue bindings={selfFillQueue.bindings} allBindings={selfFillQueue.all} onDone={() => setSelfFillQueue(null)} />
      )}
      </>
    )
  }

  // List view
  return (
    <>
    <ProjectListView
      projects={projects}
      templates={templates}
      employees={employees}
      stores={stores}
      approvalChains={approvalChains}
      checklists={checklists}
      departments={departments}
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
      handleMoveToTop={handleMoveToTop}
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
      onCreateTemplate={handleCreateTemplate}
      tplSaving={tplSaving}
    />
      {selfFillQueue && (
        <SelfFillQueue bindings={selfFillQueue.bindings} allBindings={selfFillQueue.all} onDone={() => setSelfFillQueue(null)} />
      )}
    </>
  )
}
