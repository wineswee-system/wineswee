import { useState, useEffect } from 'react'
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
  const { profile } = useAuth()
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
  const [editForm, setEditForm] = useState({ assignee: '', groups: '' })

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
    ]).then(([w, inst, t, emp, loc, cl, tpl, dept, ac, cat]) => {
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

      // Auto-progression: when a task completes, check if dependent tasks can start
      let latestTasks = updatedTasks
      if (newStatus === '已完成') {
        latestTasks = await autoProgressDependents(data.id, data.workflow_instance_id, updatedTasks)
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

  const handleConfirmTask = async (taskId) => {
    const { data } = await updateTask(taskId, {
      confirmation_required: true,
      confirmation_status: 'approved',
      confirmation_responded_at: new Date().toISOString(),
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
    const groups = editForm.groups ? editForm.groups.split(',').map(g => g.trim()).filter(Boolean) : []
    const { data } = await updateWorkflowInstance(selectedInstance.id, {
      assignee: editForm.assignee || null,
      groups: groups.length > 0 ? groups : null,
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

  // ── SOP Deploy ──
  const handleDeploy = async () => {
    if (!deployTemplate || !deployForm.location) return
    setDeploying(true)
    try {
      const tplSteps = deployTemplate.steps || []
      const loc = deployForm.location
      const { data: instance } = await supabase.from('workflow_instances').insert({
        template_name: deployTemplate.name, store: loc,
        status: '進行中', started_by: currentUser,
      }).select().single()
      if (instance) {
        // 建一個 name → employee_id 的對照，讓任務 FK 正確寫入
        // （沒有 FK 的話 LIFF 的 liff_list_my_tasks 會找不到任務）
        const empByName = new Map((employees || []).map(e => [e.name, e.id]))

        const taskRows = tplSteps.map((step, i) => {
          const assigneeName = deployForm.assignees[i] || ''
          return {
            workflow_instance_id: instance.id, step_order: i + 1,
            title: step.title, description: step.description,
            role: step.role,
            assignee: assigneeName,
            assignee_id: assigneeName ? (empByName.get(assigneeName) || null) : null,
            store: loc, status: '待處理',
            bucket: 'Workflow', category: 'Workflow',
            priority: step.priority || '中',
          }
        })
        const { data: insertedTasks } = await createTasksBatch(taskRows)
        if (insertedTasks) {
          setAllTasks(prev => [...prev, ...insertedTasks])

          // LINE 推播任務指派（notifyTaskAssignee 內部會解 employee_line_accounts；
          // 沒綁 LINE 的員工會靜默 fail，不影響其他）
          insertedTasks.forEach(task => {
            if (task.assignee) {
              notifyTaskAssignee(task.assignee, task.title, loc || deployTemplate.name, task.id).catch(() => {})
            }
          })

          // 掛查核清單到任務
          for (let i = 0; i < tplSteps.length; i++) {
            if (tplSteps[i].checklist_id && insertedTasks[i]) {
              await supabase.from('task_checklists').insert({
                task_id: insertedTasks[i].id,
                checklist_id: tplSteps[i].checklist_id,
              })
            }
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
        setDeployResult({ location: loc, count: tplSteps.length })
      }
    } catch (err) {
      alert('部署失敗：' + (err.message || '未知錯誤'))
    }
    setDeploying(false)
  }

  // ── Filtered instances ──
  const filteredInstances = instances.filter(i => {
    if (filterStore && i.store !== filterStore) return false
    if (filterAssignee && i.assignee !== filterAssignee) return false
    return true
  })
  const activeInstances = filteredInstances.filter(i => i.status === '進行中')
  const archivedInstances = filteredInstances.filter(i => i.status === '已完成')

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
        employees={employees} stores={stores} checklists={checklists}
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
        <ActiveInstancesList instances={activeInstances} getStats={getStats} onSelect={setSelectedInstance} />
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
          onDeploy={handleDeploy}
          onClose={() => { setShowDeployModal(false); setDeployResult(null) }}
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
