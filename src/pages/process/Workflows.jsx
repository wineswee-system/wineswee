import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from '../../lib/toast'
import {
  Plus, Pencil, ChevronRight, CheckCircle,
  Users, User, Play, Pause, Rocket, Archive,
  ClipboardList, Square, RotateCcw, Ban, ChevronDown, Search
} from 'lucide-react'
import { empLabel } from '../../lib/empLabel'
import {
  getWorkflows, createWorkflow, updateWorkflow, deleteWorkflow,
  getWorkflowInstances, updateWorkflowInstance,
  getTasks, getTasksByInstance, createTask, createTasksBatch, updateTask,
  getWorkflowCategories, createWorkflowCategory, deleteWorkflowCategory,
  getApprovalChains, drainEntity,
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import TaskDetailPanel from '../../components/TaskDetailPanel'
import { notifyTaskAssignee, notifyTaskConfirmationResult, notifyApproval } from '../../lib/lineNotify'
import { useAuth } from '../../contexts/AuthContext'

import InstanceDetailView from './components/InstanceDetailView'
import AiAssistantTab from './components/AiAssistantTab'
import DeployModal from './components/DeployModal'
import CreateTemplateModal from './components/CreateTemplateModal'
import ActiveInstancesList from './components/ActiveInstancesList'
import TemplatesList from './components/TemplatesList'
import ArchivedInstancesList from './components/ArchivedInstancesList'
import { generateFlowByRules } from './components/flowTemplates'
import BlankWorkflowModal from './components/BlankWorkflowModal'
import NewWorkflowMenu from './components/NewWorkflowMenu'
import WorkflowCategoriesModal from './components/WorkflowCategoriesModal'

import { confirm } from '../../lib/confirm'
import { HR_APPROVAL_TEMPLATE_NAMES } from '../../lib/workflowIntegration'

const TRIGGER_DEPTH_LIMIT = 5

export default function Workflows() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentUser = profile?.name || '管理員'
  const [tab, setTab] = useState('active')
  const [workflows, setWorkflows] = useState([])
  const [instances, setInstances] = useState([])
  const [tasks, setAllTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [checklists, setChecklists] = useState([])
  const [templates, setTemplates] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [projects, setProjects] = useState([])

  // Filters
  const [search, setSearch] = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')

  // Detail view
  const [selectedInstance, setSelectedInstance] = useState(null)
  const [selectedStep, setSelectedStep] = useState(null)

  // Modals
  const [showAddTaskModal, setShowAddTaskModal] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00', required_forms: [] })
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [notesStep, setNotesStep] = useState(null)
  const [notesText, setNotesText] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ assignee: '', groups: [], project_id: '' })
  const [lineGroups, setLineGroups] = useState([])

  // Create / Edit SOP template
  const [showCreateTplModal, setShowCreateTplModal] = useState(false)
  const [editingTplId, setEditingTplId] = useState(null)
  const [newTpl, setNewTpl] = useState({ name: '', category: '展店', description: '', steps: [{ title: '', role: '', priority: '中', description: '', checklist_id: '', approval_chain_id: '' }], approval_chain_id: '' })
  const [approvalChains, setApprovalChains] = useState([])

  // Workflow categories (流程分類)
  const [categories, setCategories] = useState([])
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  // AI assistant
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [aiMessages, setAiMessages] = useState([])
  const [aiPhase, setAiPhase] = useState('idle') // 'idle' | 'collecting' | 'done'
  const [aiStepIndex, setAiStepIndex] = useState(0)
  const [aiDraftSteps, setAiDraftSteps] = useState([])

  // New workflow menu
  const [showNewWorkflowMenu, setShowNewWorkflowMenu] = useState(false)
  const [showBlankWorkflowModal, setShowBlankWorkflowModal] = useState(false)
  const [blankWorkflowForm, setBlankWorkflowForm] = useState({ name: '', store: '', assignee: '', due_date: '', planned_start_date: '', planned_end_date: '', priority: '中', notes: '', completion_chain_id: '' })

  // SOP deploy
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployTemplate, setDeployTemplate] = useState(null)
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState(null)
  const [deployForm, setDeployForm] = useState({ location: '', assignees: {} })

  useEffect(() => {
    Promise.all([
      getWorkflows(),
      getWorkflowInstances({ excludeTemplates: HR_APPROVAL_TEMPLATE_NAMES }),
      getTasks(),
      supabase.from('employees').select('id, name, name_en, dept, position, department_id, store, store_id, departments!department_id(name), stores!store_id(name)').eq('status', '在職').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('checklists').select('*').order('id'),
      supabase.from('sop_templates').select('*').order('id'),
      supabase.from('departments').select('*').order('name'),
      getApprovalChains(),
      getWorkflowCategories(),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('line_groups').select('id, group_name').order('group_name'),
    ]).then(([w, inst, t, emp, loc, cl, tpl, dept, ac, cat, proj, lg]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setAllTasks(t.data || [])
      setEmployees(emp.data || [])
      setStores(loc.data || [])
      setChecklists(cl.data || [])
      setTemplates(tpl.data || [])
      setDepartments(dept.data || [])
      setApprovalChains(ac.data || [])
      setCategories(cat.data || [])
      setProjects(proj.data || [])
      setLineGroups(lg.data || [])
    }).catch(err => {
      console.error('Failed to load:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [])

  // Dashboard ApprovalCenter 跳過來時 ?focus=ID 自動展開流程明細
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !instances.length) return
    const inst = instances.find(i => i.id === Number(focus))
    if (inst) {
      setSelectedInstance(inst)
      setTab('active')
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [instances, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──
  const getInstanceTasks = (instId) => tasks.filter(t => t.workflow_instance_id === instId).sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
  const getStats = (instId) => {
    const s = getInstanceTasks(instId)
    const total = s.length
    const pending = s.filter(x => x.status === '待簽核').length
    const inProgress = s.filter(x => x.status === '進行中').length
    const completed = s.filter(x => x.status === '已完成').length
    const blocked = s.filter(x => x.status === '已擱置').length
    const pct = total > 0 ? Math.round(completed / total * 100) : 0
    return { total, pending, inProgress, completed, blocked, pct }
  }

  // ── Handlers ──
  const handleStatusChange = async (taskId, newStatus) => {
    // ★ 修正 2026-05-14：移除前端攔截「已完成 + 有 chain → 強塞 待簽核」邏輯
    //   trigger trg_task_intercept_complete_for_chain 會自動把
    //   「已完成 + 有 chain」攔截轉 '待確認' + 建 task_confirmations，
    //   前端不需要繞道，直接送 '已完成' 讓 DB 處理。
    const completedAt = newStatus === '已完成' ? new Date().toISOString() : null
    const { data, error } = await updateTask(taskId, { status: newStatus, completed_at: completedAt })
    if (error) { toast.error('更新失敗：' + error.message); return }
    if (data) {
      const updatedTasks = tasks.map(t => t.id === taskId ? data : t)
      setAllTasks(updatedTasks)

      // Notify assignee on any transition to 進行中
      if (newStatus === '進行中' && data.assignee) {
        const inst = instances.find(i => i.id === data.workflow_instance_id)
        notifyTaskAssignee(data.assignee, data.title, inst?.store || inst?.template_name, data.id, {
          dueDate: data.due_date, description: data.description, notes: data.notes, store: data.store,
          approvalRequired: data.status === '待簽核',
        }).catch(() => {})
      }

      // Auto-progression: when a task completes, check if dependent tasks can start
      let latestTasks = updatedTasks
      if (newStatus === '已完成') {
        latestTasks = await autoProgressDependents(data.id, data.workflow_instance_id, updatedTasks)

        // ★ 完成時觸發另一個 SOP（部署時可選）
        if (data.trigger_template_id_on_complete) {
          await triggerSopOnComplete(data.trigger_template_id_on_complete, data).catch(err => {
            console.warn('Trigger SOP on complete failed:', err)
          })
        }
      }

      // Check if entire instance is done
      const instId = data.workflow_instance_id
      if (instId) {
        const instTasks = latestTasks.filter(t => t.workflow_instance_id === instId)
        if (instTasks.length > 0 && instTasks.every(t => t.status === '已完成')) {
          const currentInst = instances.find(i => i.id === instId)
          if (currentInst?.completion_chain_id) {
            // start the completion chain — instance stays '待簽核' until chain approves
            await supabase.rpc('workflow_instance_start_chain', { p_instance_id: instId })
            const { data: inst } = await updateWorkflowInstance(instId, { status: '待簽核' })
            if (inst) setInstances(prev => prev.map(i => i.id === instId ? inst : i))
          } else {
            const { data: inst } = await updateWorkflowInstance(instId, { status: '已完成', completed_at: new Date().toISOString() })
            if (inst) setInstances(prev => prev.map(i => i.id === instId ? inst : i))
          }
        }
      }
    }
  }

  // ★ 任務完成時自動觸發另一個 SOP 範本
  //   來源：tasks.trigger_template_id_on_complete（部署時設定）
  //   行為：建一個新 workflow_instance + 對應 tasks，第 1 步進行中 + 通知
  //   防護：trigger_depth 上限 5，避免「A→B→A」無限迴圈把資料庫塞爆
  const triggerSopOnComplete = async (templateId, sourceTask) => {
    const tpl = templates.find(t => t.id === Number(templateId))
    if (!tpl) return
    const sourceInst = instances.find(i => i.id === sourceTask.workflow_instance_id)
    const parentDepth = Number(sourceInst?.trigger_depth || 0)
    if (parentDepth >= TRIGGER_DEPTH_LIMIT) {
      console.warn(`[triggerSopOnComplete] depth ${parentDepth} 已達上限 ${TRIGGER_DEPTH_LIMIT}，停止 cascade`)
      // 寫一筆通知讓管理員知道（避免悄悄停止）
      await supabase.from('notifications').insert({
        recipient_emp_id: sourceInst?.started_by_id ?? null,
        organization_id: sourceInst?.organization_id ?? null,
        type: '流程觸發中止',
        title: `「${tpl.name}」未自動觸發：cascade 深度已達 ${TRIGGER_DEPTH_LIMIT}，疑似觸發迴圈`,
        read: false,
      }).then(() => {}, () => {})
      return
    }
    const { data: newInst, error } = await supabase.from('workflow_instances').insert({
      template_name: tpl.name,
      store: sourceTask.store || sourceInst?.store || null,
      status: '進行中',
      started_by: sourceTask.assignee || profile?.name || '系統',
      started_at: new Date().toISOString(),
      organization_id: profile?.organization_id || null,
      target_employee_id: sourceInst?.target_employee_id || null,
      target_type: sourceInst?.target_type || null,
      notes: `由「${sourceInst?.template_name}」第 ${sourceTask.step_order} 步完成自動觸發（depth ${parentDepth + 1}）`,
      // ★ 防迴圈
      trigger_depth: parentDepth + 1,
      triggered_by_instance_id: sourceInst?.id || null,
    }).select().single()
    if (error || !newInst) return
    const tplSteps = Array.isArray(tpl.steps) ? tpl.steps : []
    if (tplSteps.length > 0) {
      const empByName = new Map((employees || []).map(e => [e.name, e.id]))
      const newRows = tplSteps.map((s, i) => {
        const an = i === 0 ? (sourceTask.assignee || null) : null
        return {
          workflow_instance_id: newInst.id, step_order: i + 1,
          title: s.title, description: s.description || null,
          role: s.role || null,
          assignee: an, assignee_id: an ? (empByName.get(an) || null) : null,
          store: sourceTask.store || null,
          // 第 1 步「進行中」直接開工；後面用「待處理」（等前一步），不要 '待簽核'（那是有 chain 才用）
          status: i === 0 ? '進行中' : '待處理',
          started_at: i === 0 ? new Date().toISOString() : null,
          bucket: 'Workflow', category: 'Workflow',
          priority: s.priority || '中',
          organization_id: profile?.organization_id || null,
        }
      })
      const { data: createdTasks } = await supabase.from('tasks').insert(newRows).select()
      if (createdTasks?.[0]?.assignee) {
        const t0 = createdTasks[0]
        notifyTaskAssignee(
          t0.assignee,
          `🚀 [自動觸發] ${t0.title}`,
          `由「${sourceInst?.template_name}」觸發`,
          t0.id,
          { dueDate: t0.due_date, description: t0.description, notes: t0.notes, store: t0.store, approvalRequired: t0.status === '待簽核' }
        ).catch(() => {})
      }
    }
    setInstances(prev => [newInst, ...prev])
  }

  // Auto-progress: find tasks that depend on the completed task, start them if all prerequisites met
  const autoProgressDependents = async (completedTaskId, instanceId, currentTasks) => {
    let result = [...currentTasks]
    const { data: deps } = await supabase.from('task_dependencies')
      .select('*').eq('depends_on_task_id', completedTaskId).eq('dep_type', 'prerequisite')
    if (!deps?.length) return result

    const instTasks = result.filter(t => t.workflow_instance_id === instanceId)

    for (const dep of deps) {
      const targetTask = instTasks.find(t => t.id === dep.task_id)
      if (!targetTask || targetTask.status !== '待處理') continue

      const { data: allPrereqs } = await supabase.from('task_dependencies')
        .select('depends_on_task_id').eq('task_id', dep.task_id).eq('dep_type', 'prerequisite')

      const allMet = (allPrereqs || []).every(p => {
        const prereqTask = result.find(t => t.id === p.depends_on_task_id)
        return prereqTask?.status === '已完成'
      })

      if (allMet) {
        const { data: started } = await updateTask(dep.task_id, { status: '進行中' })
        if (started) {
          result = result.map(t => t.id === started.id ? started : t)
          setAllTasks(prev => prev.map(t => t.id === started.id ? started : t))
          if (started.assignee) {
            const inst = instances.find(i => i.id === instanceId)
            notifyTaskAssignee(started.assignee, started.title, inst?.store || inst?.template_name, started.id, {
              dueDate: started.due_date, description: started.description, notes: started.notes, store: started.store,
              approvalRequired: started.status === '待簽核',
            }).catch(() => {})
          }
        }
      }
    }
    return result
  }

  const handleConfirmTask = async (taskId, action, reason = null) => {
    const now = new Date().toISOString()
    const { data } = await updateTask(taskId, {
      confirmation_required: true,
      confirmation_status: action,
      confirmation_responded_at: now,
      confirmed_by: currentUser,
      confirmed_at: now,
      confirmation_rejected_reason: action === 'rejected' ? reason : null,
    })
    if (data) {
      setAllTasks(prev => prev.map(t => t.id === taskId ? data : t))

      // ★ 推 LINE 給原執行人（核准 / 駁回都推，跟 LIFF TaskConfirmations.jsx 行為對齊）
      if (data.assignee) {
        notifyTaskConfirmationResult(data.assignee, data.title, action, reason, data.id).catch(() => {})
      }
    }
  }

  const handleChainApprove = async (instId, action, reason = null) => {
    const empId = profile?.id
    if (!empId) { toast.error('無法識別簽核人員'); return }
    const { data, error } = await supabase.rpc('workflow_instance_chain_approve', {
      p_instance_id: instId,
      p_approver_id: empId,
      p_action: action,
      p_reason: reason || null,
    })
    if (error) { toast.error('簽核失敗：' + error.message); return }
    if (!data?.ok) { toast.error(data?.error === 'NOT_YOUR_TURN' ? '您不是本關簽核人' : (data?.error || '簽核失敗')); return }
    // reload fresh instance row (chain columns updated in DB)
    const { data: freshInst } = await supabase.from('workflow_instances').select('*').eq('id', instId).single()
    if (freshInst) setInstances(prev => prev.map(i => i.id === instId ? freshInst : i))
    if (data.event === 'approved') toast.success('流程簽核完成，已核准！')
    else if (data.event === 'rejected') toast.error('已退回此流程')
    else toast.success(`已推進到第 ${(data.advanced_to_step || 0) + 1} 關（${data.next_step_label || ''}）`)
  }

  const handleSaveNotes = async () => {
    if (!notesStep) return
    const { data } = await updateTask(notesStep.id, { notes: notesText })
    if (data) setAllTasks(prev => prev.map(t => t.id === notesStep.id ? data : t))
    setShowNotesModal(false)
  }

  // 複製任務 — 把現有任務（含負責人/審批/簽核鏈/checklist/審批人員）複製一份，
  // 加到流程最後一步，自動掛 task_dependencies 跟前一步串接。
  const handleDuplicateTask = async (origTask) => {
    if (!origTask || !origTask.workflow_instance_id) return
    const instId = origTask.workflow_instance_id
    const instTasks = getInstanceTasks(instId)
    const maxOrder = instTasks.length > 0 ? Math.max(...instTasks.map(t => t.step_order || 0)) : 0

    // 1. 建新 task — 複製的 task 加在流程最後，依是否有簽核決定初始狀態
    //    有 chain / confirmation → '待簽核'；沒有 → '待處理'（會等前一步 cascade 過來）
    const cloneNeedsApproval = !!(origTask.approval_chain_id || origTask.confirmation_required)
    const { data: newTask, error } = await createTask({
      workflow_instance_id: instId,
      step_order: maxOrder + 1,
      title: `${origTask.title}（複本）`,
      description: origTask.description || null,
      assignee: origTask.assignee || null,
      assignee_id: origTask.assignee_id || null,
      store: origTask.store || null,
      planned_start: origTask.planned_start || null,
      due_date: origTask.due_date || null,
      due_time: origTask.due_time || '17:00',
      priority: origTask.priority || '中',
      role: origTask.role || null,
      status: cloneNeedsApproval ? '待簽核' : '待處理',
      bucket: origTask.bucket || 'Workflow',
      category: origTask.category || 'Workflow',
      organization_id: profile?.organization_id || null,
      approval_chain_id: origTask.approval_chain_id || null,
      confirmation_required: origTask.confirmation_required || false,
      confirmation_mode: origTask.confirmation_mode || null,
      trigger_template_id_on_complete: origTask.trigger_template_id_on_complete || null,
    })
    if (error || !newTask) {
      toast.error('複製失敗：' + (error?.message || '未知錯誤'))
      return
    }

    setAllTasks(prev => [...prev, newTask])

    // 2. 掛 task_dependencies — 依賴前一個 step
    if (instTasks.length > 0) {
      const prevTask = instTasks
        .filter(t => (t.step_order || 0) <= maxOrder)
        .sort((a, b) => (b.step_order || 0) - (a.step_order || 0))[0]
      if (prevTask) {
        await supabase.from('task_dependencies').insert({
          task_id: newTask.id,
          depends_on_task_id: prevTask.id,
          dep_type: 'prerequisite',
        })
      }
    }

    // 3. 複製 task_checklists
    const { data: srcChecklists } = await supabase.from('task_checklists')
      .select('checklist_id').eq('task_id', origTask.id)
    if (srcChecklists && srcChecklists.length > 0) {
      await supabase.from('task_checklists').insert(
        srcChecklists.map(c => ({ task_id: newTask.id, checklist_id: c.checklist_id }))
      )
    }

    // 4. 複製 task_confirmations（指定人員模式的審批人員清單）
    const { data: srcConfs } = await supabase.from('task_confirmations')
      .select('approver, step_order').eq('task_id', origTask.id)
    if (srcConfs && srcConfs.length > 0) {
      await supabase.from('task_confirmations').insert(
        srcConfs.map(c => ({
          task_id: newTask.id,
          approver: c.approver,
          step_order: c.step_order || 0,
          status: 'pending',
          organization_id: profile?.organization_id || null,
        }))
      )
    }

    toast.success(`已複製「${origTask.title}」為流程第 ${maxOrder + 1} 步。`)
  }

  const handleStepReorder = async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    const fromTask = tasks.find(t => t.id === fromId)
    if (!fromTask) return
    const instId = fromTask.workflow_instance_id
    const instTasks = getInstanceTasks(instId).sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
    const fromIdx = instTasks.findIndex(t => t.id === fromId)
    const toIdx = instTasks.findIndex(t => t.id === toId)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...instTasks]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    const updates = reordered.map((t, i) => ({ id: t.id, step_order: i + 1 }))
    setAllTasks(prev => prev.map(t => { const u = updates.find(u => u.id === t.id); return u ? { ...t, step_order: u.step_order } : t }))
    await Promise.all(updates.map(u => supabase.from('tasks').update({ step_order: u.step_order }).eq('id', u.id)))
  }

  const handleAddTask = async () => {
    if (!taskForm.title) { toast.warning('請填寫任務名稱'); return }
    if (!selectedInstance) { toast.error('找不到流程實例，請重新整理後再試'); return }
    const instTasks = getInstanceTasks(selectedInstance.id)
    const maxOrder = instTasks.length > 0 ? Math.max(...instTasks.map(t => t.step_order || 0)) : 0

    // ★ 修：assignee_id 必須填 — 否則 LIFF liff_get_task_detail / liff_list_my_tasks
    //   會用 assignee_id 過濾抓不到 → 員工看不到任務內的 checklist 等
    const empId = taskForm.assignee
      ? (employees.find(e => e.name === taskForm.assignee)?.id || null)
      : null

    const useChain   = taskForm.approval_mode === 'chain' && taskForm.approval_chain_id
    const usePeople  = taskForm.approval_mode === 'people' && (taskForm.confirmation_approvers || []).length > 0

    // 狀態規則（修正 2026-05-14 — 對齊使用者設計）：
    //   - 一律先看 step_order：第 1 步 '進行中'（執行人開工）、第 2+ 步 '待處理'（等前一步推進）
    //   - 有 chain / approvers 不影響初始狀態 — chain 在「執行人按完成」後才介入
    //     （trg_task_intercept_complete_for_chain 會把 '已完成' 攔截轉 '待確認' + 建 confirmations）
    const isFirstStep = instTasks.length === 0
    const initStatus = isFirstStep ? '進行中' : '待處理'

    const { data, error: taskError } = await createTask({
      workflow_instance_id: selectedInstance.id, step_order: maxOrder + 1,
      title: taskForm.title,
      description: taskForm.description || null,
      assignee: taskForm.assignee,
      assignee_id: empId,
      store: taskForm.store || selectedInstance.store,
      planned_start: taskForm.planned_start || null,
      due_date: taskForm.due_date || null,
      due_time: taskForm.due_time || '17:00',
      priority: taskForm.priority || '中',
      role: taskForm.role || null,
      status: initStatus,
      started_at: initStatus === '進行中' ? new Date().toISOString() : null,
      bucket: 'Workflow', category: 'Workflow',
      organization_id: profile?.organization_id || null,
      approval_chain_id: useChain ? Number(taskForm.approval_chain_id) : null,
      confirmation_required: !!(useChain || usePeople),
      confirmation_mode: usePeople ? (taskForm.confirmation_mode || 'parallel') : null,
    })
    if (taskError || !data) {
      toast.error(`新增任務失敗：${taskError?.message || '未知錯誤'}`)
      return
    }
    if (data) {
      setAllTasks(prev => [...prev, data])

      // ★ 自動掛 task_dependencies：依賴前一個 step（如果有）
      //   這樣第 1 步完成時，autoProgressDependents 才會把第 2 步從 '待簽核' 推進 '進行中' + 通知
      if (instTasks.length > 0) {
        const prevTask = instTasks
          .filter(t => (t.step_order || 0) < (maxOrder + 1))
          .sort((a, b) => (b.step_order || 0) - (a.step_order || 0))[0]
        if (prevTask) {
          await supabase.from('task_dependencies').insert({
            task_id: data.id,
            depends_on_task_id: prevTask.id,
            dep_type: 'prerequisite',
          })
        }
      }

      // ★ 掛清單
      const subFailures = []
      if (taskForm.checklist_id) {
        const { error } = await supabase.from('task_checklists').insert({
          task_id: data.id, checklist_id: Number(taskForm.checklist_id),
        })
        if (error) {
          console.error('[addTask] task_checklists 失敗:', error)
          subFailures.push(`清單未掛上：${error.message}`)
        }
      }
      // ★ 指定人員模式：掛 task_confirmations（chain 模式不掛，等執行人按完成時 RPC 自動建）
      if (usePeople) {
        const rows = (taskForm.confirmation_approvers || []).map(name => ({
          task_id: data.id,
          approver: name,
          status: 'pending',
          step_order: 0,
          organization_id: profile?.organization_id || null,
        }))
        const { error } = await supabase.from('task_confirmations').insert(rows)
        if (error) {
          console.error('[addTask] task_confirmations 失敗:', error)
          subFailures.push(`審批人員未掛上：${error.message}`)
        } else {
          for (const name of (taskForm.confirmation_approvers || [])) {
            notifyApproval(name, taskForm.title, '請求審批', { store: taskForm.store || null }).catch(() => {})
          }
        }
      }

      // 綁定表單
      for (const f of (taskForm.required_forms || [])) {
        await supabase.rpc('create_task_form_binding', {
          p_task_id: data.id, p_form_type: f.form_type, p_form_template_id: f.form_template_id || null,
        })
      }

      setShowAddTaskModal(false)
      setTaskForm({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00', required_forms: [] })

      if (subFailures.length > 0) {
        toast.error(`任務已建立，但有設定失敗：\n${subFailures.join('\n')}`)
      }

      // 只在「沒有未完成前置步驟」時才推 LINE
      // → 第一個任務（step 1）正常推；後續步驟要等前面完成才會由 cascade 推
      const hasIncompletePrev = instTasks.some(t =>
        (t.step_order || 0) < (maxOrder + 1) &&
        t.status !== '已完成' && t.status !== 'completed'
      )
      if (taskForm.assignee && !hasIncompletePrev) {
        notifyTaskAssignee(taskForm.assignee, taskForm.title, selectedInstance.store || selectedInstance.template_name, data.id, {
          dueDate: data.due_date, description: data.description, notes: data.notes, store: data.store,
          approvalRequired: data.status === '待簽核',
        }).catch(() => {})
      }
    }
  }

  const handleEditInstance = async () => {
    if (!selectedInstance) return
    const { data } = await updateWorkflowInstance(selectedInstance.id, {
      assignee: editForm.assignee || null,
      groups: editForm.groups.length > 0 ? editForm.groups : null,
      project_id: editForm.project_id ? Number(editForm.project_id) : null,
      completion_chain_id: editForm.completion_chain_id ? Number(editForm.completion_chain_id) : null,
      applicant_emp_id: profile?.id || null,
    })
    if (data) {
      setInstances(prev => prev.map(i => i.id === selectedInstance.id ? data : i))
      setSelectedInstance(data)
      setShowEditModal(false)
    }
  }

  // ── AI Assistant ──
  const handleAiGenerate = async (prompt) => {
    if (!prompt?.trim()) return
    const userMsg = prompt.trim()
    setAiPrompt('')
    setAiMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setAiLoading(true)
    setAiResult(null)
    setAiPhase('idle')

    // Simulate thinking delay
    await new Promise(r => setTimeout(r, 800 + Math.random() * 700))

    try {
      let json
      try {
        // Route through gemini-proxy edge function — API key stays server-side
        const { data: proxyData, error: proxyError } = await supabase.functions.invoke('gemini-proxy', {
          body: {
            action: 'chat',
            payload: {
              message: `你是流程設計專家。根據以下需求，設計一個標準作業流程（SOP）。\n需求：${userMsg}\n請以 JSON 格式回覆（不要 markdown code block）：\n{"name":"流程名稱","category":"分類","description":"流程說明","steps":[{"title":"步驟名稱","role":"負責角色","priority":"高/中/低","description":"步驟說明"}]}`,
              history: [],
            },
          },
        })
        if (proxyError) throw proxyError
        const text = proxyData?.data?.text ?? ''
        json = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      } catch {
        // Rule-based fallback if proxy unavailable
        json = generateFlowByRules(userMsg)
      }

      setAiResult(json)
      setAiDraftSteps(json.steps || [])
      setAiStepIndex(0)
      setAiPhase('collecting')
      setAiMessages(prev => [...prev, {
        role: 'ai',
        text: `已生成「${json.name}」，共 ${json.steps?.length || 0} 個步驟。請逐步確認每個步驟的細節：`,
        data: json,
      }])
    } catch (err) {
      setAiMessages(prev => [...prev, { role: 'ai', text: `❌ ${err.message}`, error: true }])
    }
    setAiLoading(false)
  }

  const handleAiStepConfirm = (stepIndex, updatedStep) => {
    const newSteps = aiDraftSteps.map((s, i) => i === stepIndex ? updatedStep : s)
    setAiDraftSteps(newSteps)
    if (stepIndex + 1 < aiDraftSteps.length) {
      setAiStepIndex(stepIndex + 1)
      setAiMessages(prev => [...prev, {
        role: 'ai',
        text: `✓ 第 ${stepIndex + 1} 步「${updatedStep.title}」已確認。請填寫第 ${stepIndex + 2} 步：`,
      }])
    } else {
      setAiResult(prev => ({ ...prev, steps: newSteps }))
      setAiPhase('done')
      setAiMessages(prev => [...prev, {
        role: 'ai',
        text: `✅ 所有 ${newSteps.length} 個步驟均已確認！點擊「儲存到流程範本」即可建立。`,
      }])
    }
  }

  const handleSaveAiResult = async () => {
    if (!aiResult) return
    const stepsToSave = aiDraftSteps.length > 0 ? aiDraftSteps : (aiResult.steps || [])
    const { data } = await supabase.from('sop_templates').insert({
      name: aiResult.name, category: aiResult.category || '營運',
      description: aiResult.description, steps: stepsToSave,
    }).select().single()
    if (data) {
      setTemplates(prev => [...prev, data])
      setAiResult(null)
      setAiPhase('idle')
      setAiDraftSteps([])
      setAiStepIndex(0)
      setAiMessages(prev => [...prev, { role: 'ai', text: `✅「${data.name}」已儲存到流程範本！` }])
    }
  }

  // ── Create / Update SOP Template ──
  const resetNewTpl = () => setNewTpl({
    name: '', category: '展店', description: '',
    steps: [{ title: '', role: '', priority: '中', description: '', checklist_id: '', approval_chain_id: '' }],
    approval_chain_id: '',
  })
  const closeTplModal = () => {
    setShowCreateTplModal(false)
    setEditingTplId(null)
    resetNewTpl()
  }
  const handleEditTemplate = (tpl) => {
    setEditingTplId(tpl.id)
    setNewTpl({
      name: tpl.name || '',
      category: tpl.category || '展店',
      description: tpl.description || '',
      steps: (tpl.steps && tpl.steps.length > 0)
        ? tpl.steps.map(s => ({
            title: s.title || '',
            role: s.role || '',
            priority: s.priority || '中',
            description: s.description || '',
            checklist_id: s.checklist_id || '',
            approval_chain_id: s.approval_chain_id || '',
            required_forms: s.required_forms || [],
          }))
        : [{ title: '', role: '', priority: '中', description: '', checklist_id: '', approval_chain_id: '', required_forms: [] }],
      approval_chain_id: tpl.approval_chain_id || '',
    })
    setShowCreateTplModal(true)
  }
  const handleCreateTpl = async () => {
    if (!newTpl.name?.trim()) {
      toast.warning('請填寫範本名稱')
      return
    }
    if (!newTpl.steps.some(s => s.title?.trim())) {
      toast.warning('至少需要填寫一個步驟名稱')
      return
    }
    const validSteps = newTpl.steps.filter(s => s.title?.trim()).map(s => ({
      ...s,
      checklist_id: s.checklist_id || null,
      approval_chain_id: s.approval_chain_id || null,
    }))
    const payload = {
      name: newTpl.name.trim(),
      category: newTpl.category,
      description: newTpl.description,
      steps: validSteps,
      approval_chain_id: newTpl.approval_chain_id || null,
    }

    if (editingTplId) {
      const { data, error } = await supabase.from('sop_templates').update(payload).eq('id', editingTplId).select().single()
      if (error) {
        toast.error('儲存失敗：' + error.message)
        console.error('sop_templates update error', error)
        return
      }
      if (data) {
        setTemplates(prev => prev.map(t => t.id === data.id ? data : t))
        toast.success(`範本「${data.name}」已更新`)
        closeTplModal()
      }
      return
    }

    const { data, error } = await supabase.from('sop_templates').insert(payload).select().single()
    if (error) {
      toast.error('建立失敗：' + error.message)
      console.error('sop_templates insert error', error)
      return
    }
    if (data) {
      setTemplates(prev => [...prev, data])
      closeTplModal()
    }
  }

  // ── Workflow Categories ──
  const handleAddCategory = async () => {
    const name = newCategoryName.trim()
    if (!name) return
    if (categories.some(c => c.name === name)) { setNewCategoryName(''); return }
    const nextOrder = (categories.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) || 0) + 10
    const { data, error } = await createWorkflowCategory({ name, sort_order: nextOrder })
    if (error) { toast.error('新增失敗：' + error.message); return }
    if (data) setCategories(prev => [...prev, data])
    setNewCategoryName('')
  }

  const handleDeleteCategory = async (cat) => {
    if (!(await confirm({ message: `確定刪除分類「${cat.name}」？` }))) return
    const { error } = await deleteWorkflowCategory(cat.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    setCategories(prev => prev.filter(c => c.id !== cat.id))
  }

  const handleDeleteTemplate = async (tpl) => {
    if (!(await confirm({ message: `確定刪除範本「${tpl.name}」？此操作無法復原。` }))) return
    const { error } = await deleteWorkflow(tpl.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    setTemplates(prev => prev.filter(t => t.id !== tpl.id))
  }

  // ── Blank Workflow ──
  const handleCreateBlankWorkflow = async () => {
    const name = blankWorkflowForm.name.trim()
    if (!name) { toast.warning('請填寫流程名稱'); return }
    const { data, error } = await supabase.from('workflow_instances').insert({
      template_name: name,
      store: blankWorkflowForm.store || null,
      assignee: blankWorkflowForm.assignee || null,
      due_date: blankWorkflowForm.due_date || null,
      planned_start_date: blankWorkflowForm.planned_start_date || null,
      planned_end_date: blankWorkflowForm.planned_end_date || null,
      priority: blankWorkflowForm.priority || '中',
      notes: blankWorkflowForm.notes || null,
      completion_chain_id: blankWorkflowForm.completion_chain_id ? Number(blankWorkflowForm.completion_chain_id) : null,
      applicant_emp_id: profile?.id || null,
      started_by: currentUser,
      status: '進行中',
      organization_id: profile?.organization_id || null,
    }).select().single()
    if (error) { toast.error('建立失敗：' + error.message); return }
    if (data) {
      setInstances(prev => [data, ...prev])
      setBlankWorkflowForm({ name: '', store: '', assignee: '', due_date: '', planned_start_date: '', planned_end_date: '', priority: '中', notes: '', completion_chain_id: '' })
      setShowBlankWorkflowModal(false)
      setSelectedInstance(data)
    }
  }

  // ── SOP Deploy ──
  const handleDeploy = async () => {
    if (!deployTemplate || !deployForm.location) return
    setDeploying(true)
    try {
      const tplSteps = deployTemplate.steps || []
      const loc = deployForm.location

      // ★ 偵測對象類型 + 解析 target employee
      const tname = deployTemplate.name || ''
      const targetType = /新人|到職|onboard|入職|報到|離職|offboard|退職|晉升|轉調|職務異動/.test(tname) ? 'employee' : null
      const targetEmpId = deployForm.target_employee_id ? Number(deployForm.target_employee_id) : null
      const targetEmp = targetEmpId ? employees.find(e => e.id === targetEmpId) : null

      // 計算每步 due_date：開始日 + step_offsets[i]
      const startDate = deployForm.planned_start_date || new Date().toISOString().slice(0, 10)
      const calcDueDate = (offsetDays) => {
        if (!offsetDays || offsetDays <= 0) return null
        return new Date(new Date(startDate).getTime() + offsetDays * 86400000).toISOString().slice(0, 10)
      }
      // 算提醒時間：依 preset (1hr/1day/09am/none) + 截止日時
      const calcReminderAt = (dueDate, dueTime, preset) => {
        if (!dueDate || !preset || preset === 'none') return null
        const due = new Date(`${dueDate}T${dueTime || '17:00'}:00`)
        if (isNaN(due.getTime())) return null
        if (preset === '1hr')  return new Date(due.getTime() - 3600000).toISOString()
        if (preset === '1day') return new Date(due.getTime() - 86400000).toISOString()
        if (preset === '09am') return new Date(`${dueDate}T09:00:00`).toISOString()
        return null
      }
      // 解析每步實際生效設定：override > batch default > 後備
      const batch = deployForm.batch_defaults || {}
      const overrides = deployForm.step_overrides || {}
      const resolveStepConfig = (i) => {
        const o = overrides[i] || {}
        return {
          due_time: o.due_time || batch.due_time || '17:00',
          reminder_preset: o.reminder_preset || batch.reminder_preset || '1hr',
          priority: o.priority || batch.priority || deployForm.priority || '中',
          notes: o.notes || null,
        }
      }

      const { data: instance } = await supabase.from('workflow_instances').insert({
        template_name: deployTemplate.name,
        store: loc,
        status: '進行中',
        started_by: currentUser,
        organization_id: profile?.organization_id || null,
        target_employee_id: targetType === 'employee' ? targetEmpId : null,
        target_type: targetType,
        planned_start_date: deployForm.planned_start_date || null,
        planned_end_date: deployForm.planned_end_date || null,
        priority: deployForm.priority || '中',
        notes: deployForm.notes || null,
        completion_chain_id: deployForm.completion_chain_id ? Number(deployForm.completion_chain_id) : null,
        applicant_emp_id: profile?.id || null,
      }).select().single()
      if (instance) {
        const empByName = new Map((employees || []).map(e => [e.name, e.id]))

        // ★ 取每步的「關聯與簽核」extras
        const stepExtras = deployForm.step_extras || {}
        const taskRows = tplSteps.map((step, i) => {
          // 廠商反映：admin 發起後 step 2/3 沒人。
          // UI 雖有驗證但仍可能漏，這邊加 fallback：
          // admin 沒填 → 從 step.title 反查（name / name_en，例：「Zoey 執行長」→ 陳虹）
          let assigneeName = deployForm.assignees[i] || ''
          if (!assigneeName && step.title) {
            const matched = (employees || []).find(e =>
              (e.name && step.title.includes(e.name)) ||
              (e.name_en && step.title.toLowerCase().includes(e.name_en.toLowerCase()))
            )
            if (matched) assigneeName = matched.name
          }
          const offset = deployForm.step_offsets?.[i] ?? (i + 1)
          // 第 1 步直接開工；後面用「待處理」等 cascade 推進來。
          // 有 chain / confirmation 的 step 由 cfg 判斷另外處理（後面 spread cfg 會覆蓋）
          const stepStatus = i === 0 ? '進行中' : '待處理'
          const titleWithTarget = targetEmp
            ? `${step.title}（${targetEmp.name}）`
            : step.title
          const cfg = resolveStepConfig(i)
          const dueDate = calcDueDate(offset)
          const reminderAt = calcReminderAt(dueDate, cfg.due_time, cfg.reminder_preset)
          const extras = stepExtras[i] || {}
          return {
            workflow_instance_id: instance.id, step_order: i + 1,
            title: titleWithTarget,
            description: step.description,
            role: step.role,
            assignee: assigneeName,
            assignee_id: assigneeName ? (empByName.get(assigneeName) || null) : null,
            store: loc, status: stepStatus,
            started_at: i === 0 ? new Date().toISOString() : null,
            due_date: dueDate,
            due_time: cfg.due_time,
            reminder_at: reminderAt,
            notes: cfg.notes || null,
            bucket: 'Workflow', category: 'Workflow',
            priority: cfg.priority,
            organization_id: profile?.organization_id || null,
            // ★ 關聯欄位
            approval_chain_id: extras.approval_chain_id || step.approval_chain_id || null,
            confirmation_mode: extras.confirmation_mode || 'parallel',
            trigger_template_id_on_complete: extras.trigger_template_id || null,
          }
        })
        const { data: insertedTasks, error: tasksErr } = await createTasksBatch(taskRows)
        if (tasksErr) {
          console.error('[deploy] task insert failed', tasksErr, 'rows=', taskRows)
          toast.error(`❌ 任務建立失敗：${tasksErr.message}\n\n部署中斷，請檢查 console。`)
          setDeploying(false)
          return
        }
        if (!insertedTasks || insertedTasks.length === 0) {
          console.error('[deploy] insertedTasks empty', taskRows)
          toast.error('❌ 任務沒有任何被建立（可能 RLS 擋住或欄位錯誤）。請看 console。')
          setDeploying(false)
          return
        }
        if (insertedTasks) {
          setAllTasks(prev => [...prev, ...insertedTasks])

          // ★ Bug 修：建 task_dependencies — 每步依賴上一步
          //   原本沒建 dep 導致第 1 步完成後第 2 步永遠停在「待簽核」、流程永遠到不了 100% 也不會自動封存
          if (insertedTasks.length > 1) {
            const depRows = []
            for (let i = 1; i < insertedTasks.length; i++) {
              depRows.push({
                task_id: insertedTasks[i].id,
                depends_on_task_id: insertedTasks[i - 1].id,
                dep_type: 'prerequisite',
              })
            }
            const { error: depErr } = await supabase.from('task_dependencies').insert(depRows)
            if (depErr) console.error('[deploy] task_dependencies 建立失敗:', depErr)
          }

          // ★ Bug 修：LINE 通知只發給第 1 步負責人
          //   原本所有 step 的負責人都會立即收到通知 → 老闆是第 N 步審批者，部署當下就被打擾
          //   修正後：第 1 步當下發；後續步驟由 autoProgressDependents 在前一步完成時接力發
          const firstStepAssignee = insertedTasks[0]?.assignee
          if (firstStepAssignee) {
            const totalSteps = insertedTasks.length
            const t0 = insertedTasks[0]
            const title = totalSteps > 1
              ? `🚀 [立即行動] ${t0.title}（流程共 ${totalSteps} 步，後續會接力通知）`
              : `🚀 [立即行動] ${t0.title}`
            notifyTaskAssignee(firstStepAssignee, title, loc || deployTemplate.name, t0.id, {
              dueDate: t0.due_date, description: t0.description, notes: t0.notes, store: t0.store,
              approvalRequired: t0.status === '待簽核',
            }).catch(() => {})
          }

          // ★ 掛查核清單 + 確認審批人員（部署時 extras > 範本內建）
          //   ※ 不再吞錯誤；累計失敗最後 alert，避免使用者「設定了卻沒生效」
          const subFailures = []
          for (let i = 0; i < tplSteps.length; i++) {
            if (!insertedTasks[i]) continue
            const taskId = insertedTasks[i].id
            const extras = stepExtras[i] || {}
            const checklistId = extras.checklist_id || tplSteps[i].checklist_id
            if (checklistId) {
              const { error } = await supabase.from('task_checklists').insert({
                task_id: taskId, checklist_id: checklistId,
              })
              if (error) {
                console.error(`[deploy] step ${i + 1} task_checklists 失敗:`, error)
                subFailures.push(`第 ${i + 1} 步「清單勾選」未建立：${error.message}`)
              }
            }
            const confs = extras.confirmations || []
            if (confs.length > 0) {
              const rows = confs.map(c => ({
                task_id: taskId,
                approver: c.approver,
                status: 'pending',
                organization_id: profile?.organization_id || null,
              }))
              const { error } = await supabase.from('task_confirmations').insert(rows)
              if (error) {
                console.error(`[deploy] step ${i + 1} task_confirmations 失敗:`, error)
                subFailures.push(`第 ${i + 1} 步「審批人員」未掛上：${error.message}`)
              }
            }
          }
          if (subFailures.length > 0) {
            toast.error(`流程已建立，但有 ${subFailures.length} 項子設定失敗：\n\n${subFailures.join('\n')}\n\n請到流程詳細頁手動補上。`)
          }

          // 流程範本層級簽核鏈（template.approval_chain_id）：
          // 改走新架構 — 不在 deploy 時建 approval_form。
          // 範本層級的 chain 會綁到「最後一個 task」上（task.approval_chain_id），
          // 由任務負責人完成最後一個任務時 web_complete_task RPC 會啟動 task_confirmations 流程。
          // 部署時若有 template chain：把它寫到最後一個 task 的 approval_chain_id（如果該 task 沒設）。
          const chainId = deployTemplate.approval_chain_id
          if (chainId && insertedTasks && insertedTasks.length > 0) {
            const lastTask = insertedTasks.reduce(
              (a, b) => (b.step_order || 0) > (a.step_order || 0) ? b : a
            )
            if (lastTask && !lastTask.approval_chain_id) {
              await supabase.from('tasks')
                .update({ approval_chain_id: chainId })
                .eq('id', lastTask.id)
            }
          }
        }
        setInstances(prev => [instance, ...prev])
        setDeployResult({
          location: loc,
          count: tplSteps.length,
          targetName: targetEmp?.name || null,
          instance,  // 給「查看流程」按鈕跳轉用
        })
      }
    } catch (err) {
      toast.error('部署失敗：' + (err.message || '未知錯誤'))
    }
    setDeploying(false)
  }

  // ── Archive / Delete instance ──
  const handleArchiveInstance = async (inst) => {
    if (!(await confirm({ message: `確定封存「${inst.template_name}」？封存後會從進行中清單移除，可從「封存流程」分頁查看。` }))) return
    const archivedAt = new Date().toISOString()
    const { data, error } = await supabase.from('workflow_instances')
      .update({
        status: '已完成',
        archived_at: archivedAt,
        completed_at: inst.completed_at || archivedAt,
      })
      .eq('id', inst.id).select().single()
    if (error) { toast.error('封存失敗：' + error.message); return }
    // cascade archive to all tasks belonging to this workflow instance
    await supabase.from('tasks').update({ archived_at: archivedAt }).eq('workflow_instance_id', inst.id)
    if (data) {
      setInstances(prev => prev.map(i => i.id === inst.id ? data : i))
      setAllTasks(prev => prev.map(t => t.workflow_instance_id === inst.id ? { ...t, archived_at: archivedAt } : t))
      setSelectedInstance(null)
    }
  }

  const handleDeleteInstance = async (inst) => {
    const stats = getStats(inst.id)
    const warning = stats.pct < 100
      ? `⚠️ 此流程僅完成 ${stats.pct}%，資料會移入回收暫存區保留備份（可供復原）。`
      : `資料會移入回收暫存區保留備份（可供復原）。建議改用「封存」保留進行中紀錄。`
    if (!(await confirm({ message: `確定刪除「${inst.template_name}」？\n\n${warning}\n\n仍要刪除？` }))) return

    const instTasks = getInstanceTasks(inst.id)
    const taskIds = instTasks.map(t => t.id)

    // Snapshot all related data before deletion
    const [deps, comments, attachments, chklists, chklItems, confirmations, approvalForms] = await Promise.all([
      taskIds.length ? supabase.from('task_dependencies').select('*').in('task_id', taskIds) : { data: [] },
      taskIds.length ? supabase.from('task_comments').select('*').in('task_id', taskIds) : { data: [] },
      taskIds.length ? supabase.from('task_attachments').select('*').in('task_id', taskIds) : { data: [] },
      taskIds.length ? supabase.from('task_checklists').select('*').in('task_id', taskIds) : { data: [] },
      taskIds.length ? supabase.from('task_checklist_items').select('*').in('task_id', taskIds) : { data: [] },
      taskIds.length ? supabase.from('task_confirmations').select('*').in('task_id', taskIds) : { data: [] },
      taskIds.length ? supabase.from('approval_forms').select('*').in('ref_task_id', taskIds) : { data: [] },
    ])

    try {
      await drainEntity({
        entityType: 'workflow_instance',
        entityId: inst.id,
        entityName: inst.template_name,
        payload: inst,
        relatedData: {
          tasks: instTasks,
          dependencies: deps.data || [],
          comments: comments.data || [],
          attachments: attachments.data || [],
          checklists: chklists.data || [],
          checklist_items: chklItems.data || [],
          confirmations: confirmations.data || [],
          approval_forms: approvalForms.data || [],
        },
        deletedBy: currentUser,
        organizationId: profile?.organization_id || null,
      })
    } catch (drainErr) {
      console.error('[deletion_drain] snapshot failed:', drainErr)
    }

    // Hard delete tasks first, then instance
    const { error: tasksErr } = await supabase.from('tasks').delete().eq('workflow_instance_id', inst.id)
    if (tasksErr) { toast.error('刪除任務失敗：' + tasksErr.message); return }
    const { error } = await supabase.from('workflow_instances').delete().eq('id', inst.id)
    if (error) { toast.error('刪除流程失敗：' + error.message); return }
    setInstances(prev => prev.filter(i => i.id !== inst.id))
    setAllTasks(prev => prev.filter(t => t.workflow_instance_id !== inst.id))
    setSelectedInstance(null)
  }

  // ── Filtered instances (HR 簽核由各 HR 模組頁面處理，此頁不顯示) ──
  const HR_TEMPLATE_SET = new Set(HR_APPROVAL_TEMPLATE_NAMES)
  const filteredInstances = instances.filter(i => {
    if (HR_TEMPLATE_SET.has(i.template_name)) return false
    if (search) { const s = search.toLowerCase(); if (!i.template_name?.toLowerCase().includes(s) && !`wf-${i.id}`.includes(s)) return false }
    if (filterStore && i.store !== filterStore) return false
    if (filterAssignee && i.assignee !== filterAssignee) return false
    return true
  })
  // ★ 進行中 = status='進行中' AND 未封存（archived_at IS NULL）
  const activeInstances = filteredInstances.filter(i => i.status === '進行中' && !i.archived_at)
  const notStartedInstances = filteredInstances.filter(i => i.status === '未開始' && !i.archived_at)
  const archivedInstances = filteredInstances.filter(i => i.status === '已完成' || i.archived_at)

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  // ════════════════════════════════════════════════════════════
  // ══ Instance Detail View ════════════════════════════════════
  // ════════════════════════════════════════════════════════════
  if (selectedInstance) {
    const inst = instances.find(i => i.id === selectedInstance.id) || selectedInstance
    const instTasks = getInstanceTasks(inst.id)
    const stats = getStats(inst.id)

    return (
      <InstanceDetailView
        inst={inst} instSteps={instTasks} stats={stats}
        employees={employees} stores={stores} checklists={checklists} projects={projects} lineGroups={lineGroups}
        approvalChains={approvalChains}
        currentUser={currentUser} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin}
        currentEmpId={profile?.id}
        onChainApprove={handleChainApprove}
        showNotesModal={showNotesModal} notesStep={notesStep} notesText={notesText}
        setNotesText={setNotesText} setShowNotesModal={setShowNotesModal} setNotesStep={setNotesStep}
        showAddTaskModal={showAddTaskModal} taskForm={taskForm} setTaskForm={setTaskForm} setShowAddTaskModal={setShowAddTaskModal}
        showEditModal={showEditModal} editForm={editForm} setEditForm={setEditForm} setShowEditModal={setShowEditModal}
        selectedStep={selectedStep} setSelectedStep={setSelectedStep}
        onClose={() => setSelectedInstance(null)}
        onStatusChange={handleStatusChange}
        onConfirmTask={handleConfirmTask}
        onSaveNotes={handleSaveNotes}
        onAddTask={handleAddTask}
        onEditInstance={handleEditInstance}
        onStepUpdate={d => { setAllTasks(prev => prev.map(t => t.id === d.id ? d : t)); setSelectedStep(d) }}
        onStepDelete={id => { setAllTasks(prev => prev.filter(t => t.id !== id)); setSelectedStep(null) }}
        onStepDuplicate={handleDuplicateTask}
        onStepReorder={handleStepReorder}
        onArchive={handleArchiveInstance}
        onDelete={handleDeleteInstance}
      />
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
          <div style={{ position: 'relative' }}>
            <button className="btn btn-primary" onClick={() => setShowNewWorkflowMenu(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={15} /> 新增流程
            </button>
          </div>
        </div>
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: 8,
          background: 'var(--accent-purple-dim)', fontSize: 12,
          color: 'var(--text-secondary)', lineHeight: 1.6,
        }}>
          💡 <strong>什麼是「流程」？</strong>由多個任務串接的可重用範本 — 適合「每次都要走相同步驟」的工作
          （例：員工到職入職流程、月底結帳流程）。一次性、單點工作請建「任務」。
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 20, padding: '14px 20px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div className="search-bar" style={{ minWidth: 200 }}>
          <Search className="search-icon" />
          <input type="text" placeholder="搜尋流程..." className="form-input" style={{ paddingLeft: 38, width: '100%' }} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🏪 門市</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
            <option value="">全部門市</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>👤 負責人</span>
          <div style={{ minWidth: 200 }}>
            <SearchableSelect
              value={filterAssignee}
              onChange={(v) => setFilterAssignee(v || '')}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="全部人員"
            />
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { key: 'active', label: `🟢 進行中流程 (${activeInstances.length})` },
          { key: 'notstarted', label: `⏳ 未開始 (${notStartedInstances.length})` },
          { key: 'templates', label: `📁 流程範本 (${templates.length})` },
          { key: 'ai', label: '🤖 AI 助手' },
          { key: 'archived', label: `📦 封存流程 (${archivedInstances.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            borderRadius: 8,
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            border: tab === t.key ? 'none' : '1px solid var(--border-medium)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══ Active Instances ══ */}
      {tab === 'active' && (
        <ActiveInstancesList
          instances={activeInstances}
          getStats={getStats}
          onSelect={setSelectedInstance}
          onArchive={handleArchiveInstance}
          onDelete={handleDeleteInstance}
          projects={projects}
          lineGroups={lineGroups}
        />
      )}

      {/* ══ Not Started Instances ══ */}
      {tab === 'notstarted' && (
        <ActiveInstancesList
          instances={notStartedInstances}
          getStats={getStats}
          onSelect={setSelectedInstance}
          onArchive={handleArchiveInstance}
          onDelete={handleDeleteInstance}
          projects={projects}
          lineGroups={lineGroups}
        />
      )}

      {/* ══ Templates (SOP) ══ */}
      {tab === 'templates' && (
        <TemplatesList
          templates={templates}
          onDeploy={tpl => { setDeployTemplate(tpl); setDeployForm({ location: '', assignees: {} }); setDeployResult(null); setShowDeployModal(true) }}
          onEdit={handleEditTemplate}
          onDelete={handleDeleteTemplate}
          onCreateNew={() => { setEditingTplId(null); resetNewTpl(); setShowCreateTplModal(true) }}
          onManageCategories={() => setShowCategoryModal(true)}
        />
      )}

      {/* ══ AI Assistant ══ */}
      {tab === 'ai' && (
        <AiAssistantTab
          aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
          aiLoading={aiLoading} aiMessages={aiMessages} aiResult={aiResult}
          onGenerate={handleAiGenerate}
          onSaveResult={handleSaveAiResult}
          onSkipResult={() => { setAiResult(null); setAiPhase('idle'); setAiDraftSteps([]); setAiStepIndex(0) }}
          aiPhase={aiPhase}
          aiStepIndex={aiStepIndex}
          aiDraftSteps={aiDraftSteps}
          onStepConfirm={handleAiStepConfirm}
          employees={employees}
        />
      )}

      {/* ══ Archived ══ */}
      {tab === 'archived' && (
        <ArchivedInstancesList instances={archivedInstances} getStats={getStats} onSelect={setSelectedInstance} onDelete={handleDeleteInstance} />
      )}

      {/* ══ Deploy Modal ══ */}
      {showDeployModal && deployTemplate && (
        <DeployModal
          deployTemplate={deployTemplate} deployForm={deployForm} setDeployForm={setDeployForm}
          deployResult={deployResult} deploying={deploying}
          stores={stores} employees={employees} departments={departments}
          checklists={checklists} approvalChains={approvalChains} templates={templates}
          onDeploy={handleDeploy}
          onClose={() => {
            // ★ 部署成功後關 modal → 直接跳轉到該流程的詳細視圖
            //   這樣使用者不會「部署完了不知道去哪看進度」
            const goToInstance = deployResult?.instance
            setShowDeployModal(false)
            setDeployResult(null)
            if (goToInstance) {
              setSelectedInstance(goToInstance)
              setTab('active')  // 切回進行中分頁
            }
          }}
        />
      )}

      {/* ══ Create / Edit Template Modal ══ */}
      {showCreateTplModal && (
        <CreateTemplateModal
          newTpl={newTpl} setNewTpl={setNewTpl}
          onClose={closeTplModal}
          onSubmit={handleCreateTpl}
          checklists={checklists}
          approvalChains={approvalChains}
          categories={categories}
          onManageCategories={() => setShowCategoryModal(true)}
          isEdit={!!editingTplId}
        />
      )}

      {/* ══ Blank Workflow Modal ══ */}
      {showBlankWorkflowModal && (
        <BlankWorkflowModal
          blankWorkflowForm={blankWorkflowForm}
          setBlankWorkflowForm={setBlankWorkflowForm}
          employees={employees}
          stores={stores}
          approvalChains={approvalChains}
          onClose={() => setShowBlankWorkflowModal(false)}
          onSubmit={handleCreateBlankWorkflow}
        />
      )}

      {/* ══ New Workflow Chooser Overlay ══ */}
      {showNewWorkflowMenu && (
        <NewWorkflowMenu
          onClose={() => setShowNewWorkflowMenu(false)}
          onBlank={() => { setShowNewWorkflowMenu(false); setShowBlankWorkflowModal(true) }}
          onFromTemplate={() => { setShowNewWorkflowMenu(false); setTab('templates') }}
          onAi={() => { setShowNewWorkflowMenu(false); setTab('ai') }}
        />
      )}

      {/* ══ Workflow Categories Modal ══ */}
      {showCategoryModal && (
        <WorkflowCategoriesModal
          categories={categories}
          newCategoryName={newCategoryName}
          setNewCategoryName={setNewCategoryName}
          onAdd={handleAddCategory}
          onDelete={handleDeleteCategory}
          onClose={() => setShowCategoryModal(false)}
        />
      )}
    </div>
  )
}
