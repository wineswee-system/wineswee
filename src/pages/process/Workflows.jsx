import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, Pencil, Trash2, ChevronRight, CheckCircle,
  X, Users, User, Play, Pause, Rocket, Archive,
  ClipboardList, Square, RotateCcw, Ban, ChevronDown
} from 'lucide-react'
import { empLabel } from '../../lib/empLabel'
import {
  getWorkflows, createWorkflow, updateWorkflow,
  getWorkflowInstances, updateWorkflowInstance,
  getTasks, getTasksByInstance, createTask, createTasksBatch, updateTask,
  getWorkflowCategories, createWorkflowCategory, deleteWorkflowCategory,
  getApprovalChains,
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import TaskDetailPanel from '../../components/TaskDetailPanel'
import { notifyTaskAssignee } from '../../lib/lineNotify'
import { useAuth } from '../../contexts/AuthContext'

import InstanceDetailView from './components/InstanceDetailView'
import AiAssistantTab from './components/AiAssistantTab'
import DeployModal from './components/DeployModal'
import CreateTemplateModal from './components/CreateTemplateModal'
import ActiveInstancesList from './components/ActiveInstancesList'
import TemplatesList from './components/TemplatesList'
import ArchivedInstancesList from './components/ArchivedInstancesList'
import { generateFlowByRules } from './components/flowTemplates'

export default function Workflows() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
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
  const [filterStore, setFilterStore] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')

  // Detail view
  const [selectedInstance, setSelectedInstance] = useState(null)
  const [selectedStep, setSelectedStep] = useState(null)

  // Modals
  const [showAddTaskModal, setShowAddTaskModal] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00' })
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [notesStep, setNotesStep] = useState(null)
  const [notesText, setNotesText] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ assignee: '', groups: [], project_id: '' })
  const [lineGroups, setLineGroups] = useState([])

  // Create SOP template
  const [showCreateTplModal, setShowCreateTplModal] = useState(false)
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

  // New workflow menu
  const [showNewWorkflowMenu, setShowNewWorkflowMenu] = useState(false)
  const [showBlankWorkflowModal, setShowBlankWorkflowModal] = useState(false)
  const [blankWorkflowForm, setBlankWorkflowForm] = useState({ name: '', store: '', assignee: '', due_date: '' })

  // SOP deploy
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployTemplate, setDeployTemplate] = useState(null)
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState(null)
  const [deployForm, setDeployForm] = useState({ location: '', assignees: {} })

  useEffect(() => {
    Promise.all([
      getWorkflows(),
      getWorkflowInstances(),
      getTasks(),
      supabase.from('employees').select('id, name, dept, position, department_id').eq('status', '在職').order('name'),
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

  // ── Helpers ──
  const getInstanceTasks = (instId) => tasks.filter(t => t.workflow_instance_id === instId).sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
  const getStats = (instId) => {
    const s = getInstanceTasks(instId)
    const total = s.length
    const pending = s.filter(x => x.status === '待處理').length
    const inProgress = s.filter(x => x.status === '進行中').length
    const completed = s.filter(x => x.status === '已完成').length
    const blocked = s.filter(x => x.status === '已擱置').length
    const pct = total > 0 ? Math.round(completed / total * 100) : 0
    return { total, pending, inProgress, completed, blocked, pct }
  }

  // ── Handlers ──
  const handleStatusChange = async (taskId, newStatus) => {
    const completedAt = newStatus === '已完成' ? new Date().toISOString() : null
    const { data } = await updateTask(taskId, { status: newStatus, completed_at: completedAt })
    if (data) {
      const updatedTasks = tasks.map(t => t.id === taskId ? data : t)
      setAllTasks(updatedTasks)

      // Notify assignee on any transition to 進行中
      if (newStatus === '進行中' && data.assignee) {
        const inst = instances.find(i => i.id === data.workflow_instance_id)
        notifyTaskAssignee(data.assignee, data.title, inst?.store || inst?.template_name, data.id).catch(() => {})
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
          const { data: inst } = await updateWorkflowInstance(instId, { status: '已完成', completed_at: new Date().toISOString() })
          if (inst) setInstances(prev => prev.map(i => i.id === instId ? inst : i))
        }
      }
    }
  }

  // ★ 任務完成時自動觸發另一個 SOP 範本
  //   來源：tasks.trigger_template_id_on_complete（部署時設定）
  //   行為：建一個新 workflow_instance + 對應 tasks，第 1 步進行中 + 通知
  //   防護：trigger_depth 上限 5，避免「A→B→A」無限迴圈把資料庫塞爆
  const TRIGGER_DEPTH_LIMIT = 5
  const triggerSopOnComplete = async (templateId, sourceTask) => {
    const tpl = templates.find(t => t.id === Number(templateId))
    if (!tpl) return
    const sourceInst = instances.find(i => i.id === sourceTask.workflow_instance_id)
    const parentDepth = Number(sourceInst?.trigger_depth || 0)
    if (parentDepth >= TRIGGER_DEPTH_LIMIT) {
      console.warn(`[triggerSopOnComplete] depth ${parentDepth} 已達上限 ${TRIGGER_DEPTH_LIMIT}，停止 cascade`)
      // 寫一筆通知讓管理員知道（避免悄悄停止）
      await supabase.from('notifications').insert({
        recipient: sourceInst?.started_by || '系統',
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
          status: i === 0 ? '進行中' : '待處理',
          started_at: i === 0 ? new Date().toISOString() : null,
          bucket: 'Workflow', category: 'Workflow',
          priority: s.priority || '中',
          organization_id: profile?.organization_id || null,
        }
      })
      const { data: createdTasks } = await supabase.from('tasks').insert(newRows).select()
      if (createdTasks?.[0]?.assignee) {
        notifyTaskAssignee(
          createdTasks[0].assignee,
          `🚀 [自動觸發] ${createdTasks[0].title}`,
          `由「${sourceInst?.template_name}」觸發`,
          createdTasks[0].id
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
            notifyTaskAssignee(started.assignee, started.title, inst?.store || inst?.template_name, started.id)
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
    if (data) setAllTasks(prev => prev.map(t => t.id === taskId ? data : t))
  }

  const handleSaveNotes = async () => {
    if (!notesStep) return
    const { data } = await updateTask(notesStep.id, { notes: notesText })
    if (data) setAllTasks(prev => prev.map(t => t.id === notesStep.id ? data : t))
    setShowNotesModal(false)
  }

  const handleAddTask = async () => {
    if (!taskForm.title || !selectedInstance) return
    const instTasks = getInstanceTasks(selectedInstance.id)
    const maxOrder = instTasks.length > 0 ? Math.max(...instTasks.map(t => t.step_order || 0)) : 0
    const { data } = await createTask({
      workflow_instance_id: selectedInstance.id, step_order: maxOrder + 1,
      title: taskForm.title, assignee: taskForm.assignee,
      store: taskForm.store || selectedInstance.store,
      planned_start: taskForm.planned_start || null,
      due_date: taskForm.due_date || null, due_time: taskForm.due_time || '17:00',
      status: '待處理', bucket: 'Workflow', category: 'Workflow',
    })
    if (data) {
      setAllTasks(prev => [...prev, data])
      setShowAddTaskModal(false)
      setTaskForm({ title: '', assignee: '', store: '', planned_start: '', due_date: '', due_time: '17:00' })
      if (taskForm.assignee) notifyTaskAssignee(taskForm.assignee, taskForm.title, selectedInstance.store || selectedInstance.template_name, data.id)
    }
  }

  const handleEditInstance = async () => {
    if (!selectedInstance) return
    const { data } = await updateWorkflowInstance(selectedInstance.id, {
      assignee: editForm.assignee || null,
      groups: editForm.groups.length > 0 ? editForm.groups : null,
      project_id: editForm.project_id ? Number(editForm.project_id) : null,
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
      setAiMessages(prev => [...prev, { role: 'ai', text: `已生成「${json.name}」，共 ${json.steps?.length || 0} 個步驟`, data: json }])
    } catch (err) {
      setAiMessages(prev => [...prev, { role: 'ai', text: `❌ ${err.message}`, error: true }])
    }
    setAiLoading(false)
  }

  const handleSaveAiResult = async () => {
    if (!aiResult) return
    const { data } = await supabase.from('sop_templates').insert({
      name: aiResult.name, category: aiResult.category || '營運',
      description: aiResult.description, steps: aiResult.steps || [],
    }).select().single()
    if (data) {
      setTemplates(prev => [...prev, data])
      setAiResult(null)
      setAiMessages(prev => [...prev, { role: 'ai', text: `✅「${data.name}」已儲存到流程範本！` }])
    }
  }

  // ── Create SOP Template ──
  const handleCreateTpl = async () => {
    if (!newTpl.name?.trim()) {
      alert('請填寫範本名稱')
      return
    }
    if (!newTpl.steps.some(s => s.title?.trim())) {
      alert('至少需要填寫一個步驟名稱')
      return
    }
    const validSteps = newTpl.steps.filter(s => s.title?.trim()).map(s => ({
      ...s,
      checklist_id: s.checklist_id || null,
      approval_chain_id: s.approval_chain_id || null,
    }))
    const { data, error } = await supabase.from('sop_templates').insert({
      name: newTpl.name.trim(),
      category: newTpl.category,
      description: newTpl.description,
      steps: validSteps,
      approval_chain_id: newTpl.approval_chain_id || null,
    }).select().single()
    if (error) {
      alert('建立失敗：' + error.message)
      console.error('sop_templates insert error', error)
      return
    }
    if (data) {
      setTemplates(prev => [...prev, data])
      setShowCreateTplModal(false)
      setNewTpl({ name: '', category: '展店', description: '', steps: [{ title: '', role: '', priority: '中', description: '', checklist_id: '', approval_chain_id: '' }], approval_chain_id: '' })
    }
  }

  // ── Workflow Categories ──
  const handleAddCategory = async () => {
    const name = newCategoryName.trim()
    if (!name) return
    if (categories.some(c => c.name === name)) { setNewCategoryName(''); return }
    const nextOrder = (categories.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) || 0) + 10
    const { data, error } = await createWorkflowCategory({ name, sort_order: nextOrder })
    if (error) { alert('新增失敗：' + error.message); return }
    if (data) setCategories(prev => [...prev, data])
    setNewCategoryName('')
  }

  const handleDeleteCategory = async (cat) => {
    if (!confirm(`確定刪除分類「${cat.name}」？`)) return
    const { error } = await deleteWorkflowCategory(cat.id)
    if (error) { alert('刪除失敗：' + error.message); return }
    setCategories(prev => prev.filter(c => c.id !== cat.id))
  }

  // ── Blank Workflow ──
  const handleCreateBlankWorkflow = async () => {
    const name = blankWorkflowForm.name.trim()
    if (!name) { alert('請填寫流程名稱'); return }
    const { data, error } = await supabase.from('workflow_instances').insert({
      template_name: name,
      store: blankWorkflowForm.store || null,
      assignee: blankWorkflowForm.assignee || null,
      due_date: blankWorkflowForm.due_date || null,
      started_by: currentUser,
      status: '進行中',
      organization_id: profile?.organization_id || null,
    }).select().single()
    if (error) { alert('建立失敗：' + error.message); return }
    if (data) {
      setInstances(prev => [data, ...prev])
      setBlankWorkflowForm({ name: '', store: '', assignee: '', due_date: '' })
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
      }).select().single()
      if (instance) {
        const empByName = new Map((employees || []).map(e => [e.name, e.id]))

        // ★ 取每步的「關聯與簽核」extras
        const stepExtras = deployForm.step_extras || {}
        const taskRows = tplSteps.map((step, i) => {
          const assigneeName = deployForm.assignees[i] || ''
          const offset = deployForm.step_offsets?.[i] ?? (i + 1)
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
        const { data: insertedTasks } = await createTasksBatch(taskRows)
        if (insertedTasks) {
          setAllTasks(prev => [...prev, ...insertedTasks])

          // ★ Bug 修：建 task_dependencies — 每步依賴上一步
          //   原本沒建 dep 導致第 1 步完成後第 2 步永遠停在「待處理」、流程永遠到不了 100% 也不會自動封存
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
            const title = totalSteps > 1
              ? `🚀 [立即行動] ${insertedTasks[0].title}（流程共 ${totalSteps} 步，後續會接力通知）`
              : `🚀 [立即行動] ${insertedTasks[0].title}`
            notifyTaskAssignee(firstStepAssignee, title, loc || deployTemplate.name, insertedTasks[0].id).catch(() => {})
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
            alert(`流程已建立，但有 ${subFailures.length} 項子設定失敗：\n\n${subFailures.join('\n')}\n\n請到流程詳細頁手動補上。`)
          }

          // 建立流程結束簽核（如果範本有設定 approval_chain_id）
          const chainId = deployTemplate.approval_chain_id
          if (chainId) {
            const chain = approvalChains.find(c => c.id === chainId)
            if (chain) {
              const { data: form } = await supabase.from('approval_forms').insert({
                chain_id: chainId,
                title: `${deployTemplate.name} — ${loc}`,
                store: loc,
                status: '待簽',
                applicant: profile?.name || null,
                form_data: { notes: `流程部署自動建立` },
              }).select().single()
              if (form && chain.steps) {
                const formSteps = chain.steps.map((s, idx) => ({
                  form_id: form.id, step_order: idx + 1,
                  role: s.role, status: '待簽',
                }))
                await supabase.from('approval_form_steps').insert(formSteps)
              }
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
      alert('部署失敗：' + (err.message || '未知錯誤'))
    }
    setDeploying(false)
  }

  // ── Archive / Delete instance ──
  const handleArchiveInstance = async (inst) => {
    if (!confirm(`確定封存「${inst.template_name}」？封存後會從進行中清單移除，可從「封存流程」分頁查看。`)) return
    const { data, error } = await supabase.from('workflow_instances')
      .update({
        status: '已完成',
        archived_at: new Date().toISOString(),
        completed_at: inst.completed_at || new Date().toISOString(),
      })
      .eq('id', inst.id).select().single()
    if (error) { alert('封存失敗：' + error.message); return }
    if (data) setInstances(prev => prev.map(i => i.id === inst.id ? data : i))
  }

  const handleDeleteInstance = async (inst) => {
    const stats = getStats(inst.id)
    const warning = stats.pct < 100
      ? `⚠️ 此流程僅完成 ${stats.pct}%，刪除後無法復原（連同 ${stats.total} 筆任務一併刪除）。`
      : `刪除後無法復原（連同 ${stats.total} 筆任務一併刪除）。建議改用「封存」保留紀錄。`
    if (!confirm(`確定刪除「${inst.template_name}」？\n\n${warning}\n\n仍要刪除？`)) return
    // 先刪 tasks（task_dependencies / task_checklists / task_confirmations 都 ON DELETE CASCADE）
    await supabase.from('tasks').delete().eq('workflow_instance_id', inst.id)
    const { error } = await supabase.from('workflow_instances').delete().eq('id', inst.id)
    if (error) { alert('刪除失敗：' + error.message); return }
    setInstances(prev => prev.filter(i => i.id !== inst.id))
    setAllTasks(prev => prev.filter(t => t.workflow_instance_id !== inst.id))
  }

  // ── Filtered instances ──
  const filteredInstances = instances.filter(i => {
    if (filterStore && i.store !== filterStore) return false
    if (filterAssignee && i.assignee !== filterAssignee) return false
    return true
  })
  // ★ 進行中 = status='進行中' AND 未封存（archived_at IS NULL）
  const activeInstances = filteredInstances.filter(i => i.status === '進行中' && !i.archived_at)
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
        currentUser={currentUser} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin}
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
      </div>

      {/* ── Filters ── */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 20, padding: '14px 20px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🏪 門市</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
            <option value="">全部門市</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>👤 負責人</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
            <option value="">全部人員</option>
            {employees.map(e => <option key={e.id} value={e.name}>{empLabel(e)}</option>)}
          </select>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { key: 'active', label: `🟢 進行中流程 (${activeInstances.length})` },
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

      {/* ══ Templates (SOP) ══ */}
      {tab === 'templates' && (
        <TemplatesList
          templates={templates}
          onDeploy={tpl => { setDeployTemplate(tpl); setDeployForm({ location: '', assignees: {} }); setDeployResult(null); setShowDeployModal(true) }}
          onCreateNew={() => setShowCreateTplModal(true)}
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
          onSkipResult={() => setAiResult(null)}
        />
      )}

      {/* ══ Archived ══ */}
      {tab === 'archived' && (
        <ArchivedInstancesList instances={archivedInstances} getStats={getStats} onSelect={setSelectedInstance} />
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

      {/* ══ Create Template Modal ══ */}
      {showCreateTplModal && (
        <CreateTemplateModal
          newTpl={newTpl} setNewTpl={setNewTpl}
          onClose={() => setShowCreateTplModal(false)}
          onSubmit={handleCreateTpl}
          checklists={checklists}
          approvalChains={approvalChains}
          categories={categories}
          onManageCategories={() => setShowCategoryModal(true)}
        />
      )}

      {/* ══ Blank Workflow Modal ══ */}
      {showBlankWorkflowModal && (
        <Modal
          title="建立空白流程"
          onClose={() => setShowBlankWorkflowModal(false)}
          onSubmit={handleCreateBlankWorkflow}
          submitLabel="建立"
        >
          <Field label="流程名稱 *">
            <input className="form-input" placeholder="例：新店開幕準備" autoFocus
              value={blankWorkflowForm.name}
              onChange={e => setBlankWorkflowForm(p => ({ ...p, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateBlankWorkflow() } }}
            />
          </Field>
          <Field label="門市／地點">
            <select className="form-input" value={blankWorkflowForm.store} onChange={e => setBlankWorkflowForm(p => ({ ...p, store: e.target.value }))}>
              <option value="">— 選擇門市 —</option>
              {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="負責人">
            <select className="form-input" value={blankWorkflowForm.assignee} onChange={e => setBlankWorkflowForm(p => ({ ...p, assignee: e.target.value }))}>
              <option value="">— 選擇人員 —</option>
              {employees.map(e => <option key={e.id} value={e.name}>{empLabel(e)}</option>)}
            </select>
          </Field>
          <Field label="截止日期">
            <input className="form-input" type="date"
              value={blankWorkflowForm.due_date}
              onChange={e => setBlankWorkflowForm(p => ({ ...p, due_date: e.target.value }))}
            />
          </Field>
        </Modal>
      )}

      {/* ══ New Workflow Chooser Overlay ══ */}
      {showNewWorkflowMenu && createPortal(
        <div
          onClick={() => setShowNewWorkflowMenu(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.55)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
              borderRadius: 16, padding: 32, width: 420, maxWidth: '92vw',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>新增流程</h3>
              <button onClick={() => setShowNewWorkflowMenu(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                {
                  icon: '📄',
                  label: '建立空白流程',
                  desc: '從頭手動填寫步驟與設定',
                  action: () => { setShowNewWorkflowMenu(false); setShowBlankWorkflowModal(true) },
                },
                {
                  icon: '📁',
                  label: '從範本建立',
                  desc: '選擇現有 SOP 範本快速部署',
                  action: () => { setShowNewWorkflowMenu(false); setTab('templates') },
                },
                {
                  icon: '🤖',
                  label: 'AI 助手建立',
                  desc: '描述需求，讓 AI 自動生成流程',
                  action: () => { setShowNewWorkflowMenu(false); setTab('ai') },
                },
              ].map(opt => (
                <button
                  key={opt.label}
                  onClick={opt.action}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '16px 20px', borderRadius: 12, cursor: 'pointer',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                    textAlign: 'left', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                >
                  <span style={{ fontSize: 28, lineHeight: 1 }}>{opt.icon}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══ Workflow Categories Modal ══ */}
      {showCategoryModal && (
        <Modal title="管理流程分類" onClose={() => setShowCategoryModal(false)} onSubmit={() => setShowCategoryModal(false)} submitLabel="完成">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input className="form-input" type="text" placeholder="新分類名稱" style={{ flex: 1 }}
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory() } }} />
            <button className="btn btn-primary" onClick={handleAddCategory} style={{ fontSize: 13 }}>
              <Plus size={13} /> 新增
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {categories.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>尚無分類</div>
            ) : categories.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 8,
                background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
              }}>
                <span style={{ fontSize: 13 }}>{c.name}</span>
                <button onClick={() => handleDeleteCategory(c)} style={{
                  background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: 4,
                }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
