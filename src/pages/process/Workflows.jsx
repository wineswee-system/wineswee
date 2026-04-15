import { useState, useEffect } from 'react'
import {
  Plus, Pencil, Trash2, ChevronRight, CheckCircle,
  X, Users, User, Play, Pause, Rocket, Archive,
  ClipboardList, Square, RotateCcw, Ban, ChevronDown
} from 'lucide-react'
import {
  getWorkflows, createWorkflow, updateWorkflow,
  getWorkflowInstances, updateWorkflowInstance,
  getWorkflowSteps, createWorkflowStep, updateWorkflowStep
} from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import TaskDetailPanel from '../../components/TaskDetailPanel'
import { notifyTaskAssignee } from '../../lib/lineNotify'
import { GoogleGenerativeAI } from '@google/generative-ai'

import InstanceDetailView from './components/InstanceDetailView'
import AiAssistantTab from './components/AiAssistantTab'
import DeployModal from './components/DeployModal'
import CreateTemplateModal from './components/CreateTemplateModal'
import ActiveInstancesList from './components/ActiveInstancesList'
import TemplatesList from './components/TemplatesList'
import ArchivedInstancesList from './components/ArchivedInstancesList'
import { generateFlowByRules } from './components/flowTemplates'

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY

export default function Workflows() {
  const [tab, setTab] = useState('active')
  const [workflows, setWorkflows] = useState([])
  const [instances, setInstances] = useState([])
  const [steps, setSteps] = useState([])
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
      getWorkflowSteps(),
      supabase.from('employees').select('id, name, dept, position').eq('status', '在職').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('checklists').select('*').order('id'),
      supabase.from('sop_templates').select('*').order('id'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('approval_chains').select('*').order('id'),
    ]).then(([w, inst, st, emp, loc, cl, tpl, dept, ac]) => {
      setWorkflows(w.data || [])
      setInstances(inst.data || [])
      setSteps(st.data || [])
      setEmployees(emp.data || [])
      setStores(loc.data || [])
      setChecklists(cl.data || [])
      setTemplates(tpl.data || [])
      setDepartments(dept.data || [])
      setApprovalChains(ac.data || [])
    }).catch(err => {
      console.error('Failed to load:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [])

  // ── Helpers ──
  const getInstanceSteps = (instId) => steps.filter(s => s.instance_id === instId).sort((a, b) => a.step_order - b.step_order)
  const getStats = (instId) => {
    const s = getInstanceSteps(instId)
    const total = s.length
    const pending = s.filter(x => x.status === '待處理').length
    const inProgress = s.filter(x => x.status === '進行中').length
    const completed = s.filter(x => x.status === '已完成').length
    const blocked = s.filter(x => x.status === '已擱置').length
    const pct = total > 0 ? Math.round(completed / total * 100) : 0
    return { total, pending, inProgress, completed, blocked, pct }
  }

  // ── Handlers ──
  const handleStatusChange = async (stepId, newStatus) => {
    const completedAt = newStatus === '已完成' ? new Date().toISOString() : null
    const { data } = await updateWorkflowStep(stepId, { status: newStatus, completed_at: completedAt })
    if (data) {
      const updatedSteps = steps.map(s => s.id === stepId ? data : s)
      setSteps(updatedSteps)

      // Auto-progression: when a step completes, check if dependent steps can start
      let latestSteps = updatedSteps
      if (newStatus === '已完成') {
        latestSteps = await autoProgressDependents(data.id, data.instance_id, updatedSteps)
      }

      // Check if entire instance is done (use latestSteps to include auto-progressed)
      const instId = data.instance_id
      const instSteps = latestSteps.filter(s => s.instance_id === instId)
      if (instSteps.length > 0 && instSteps.every(s => s.status === '已完成')) {
        const { data: inst } = await updateWorkflowInstance(instId, { status: '已完成', completed_at: new Date().toISOString() })
        if (inst) setInstances(prev => prev.map(i => i.id === instId ? inst : i))
      }
    }
  }

  // Auto-progress: find steps that depend on the completed step, start them if all prerequisites met
  // Returns the latest steps array after any auto-progressions
  const autoProgressDependents = async (completedStepId, instanceId, currentSteps) => {
    let result = [...currentSteps]
    const { data: deps } = await supabase.from('workflow_step_dependencies')
      .select('*').eq('depends_on_step_id', completedStepId).eq('dep_type', 'prerequisite')
    if (!deps?.length) return result

    const instSteps = result.filter(s => s.instance_id === instanceId)

    for (const dep of deps) {
      const targetStep = instSteps.find(s => s.id === dep.step_id)
      if (!targetStep || targetStep.status !== '待處理') continue

      const { data: allPrereqs } = await supabase.from('workflow_step_dependencies')
        .select('depends_on_step_id').eq('step_id', dep.step_id).eq('dep_type', 'prerequisite')

      const allMet = (allPrereqs || []).every(p => {
        const prereqStep = result.find(s => s.id === p.depends_on_step_id)
        return prereqStep?.status === '已完成'
      })

      if (allMet) {
        const { data: started } = await updateWorkflowStep(dep.step_id, { status: '進行中' })
        if (started) {
          result = result.map(s => s.id === started.id ? started : s)
          setSteps(prev => prev.map(s => s.id === started.id ? started : s))
          if (started.assignee) {
            const inst = instances.find(i => i.id === instanceId)
            notifyTaskAssignee(started.assignee, started.title, inst?.store || inst?.template_name, started.id)
          }
        }
      }
    }
    return result
  }

  const handleConfirmTask = async (stepId) => {
    const { data } = await updateWorkflowStep(stepId, { confirmed: true, confirmed_at: new Date().toISOString() })
    if (data) setSteps(prev => prev.map(s => s.id === stepId ? data : s))
  }

  const handleSaveNotes = async () => {
    if (!notesStep) return
    const { data } = await updateWorkflowStep(notesStep.id, { notes: notesText })
    if (data) setSteps(prev => prev.map(s => s.id === notesStep.id ? data : s))
    setShowNotesModal(false)
  }

  const handleAddTask = async () => {
    if (!taskForm.title || !selectedInstance) return
    const instSteps = getInstanceSteps(selectedInstance.id)
    const maxOrder = instSteps.length > 0 ? Math.max(...instSteps.map(s => s.step_order)) : 0
    const { data } = await createWorkflowStep({
      instance_id: selectedInstance.id, step_order: maxOrder + 1,
      title: taskForm.title, assignee: taskForm.assignee,
      store: taskForm.store || selectedInstance.store,
      planned_start: taskForm.planned_start || null,
      due_date: taskForm.due_date || null, due_time: taskForm.due_time || '17:00',
      status: '待處理',
    })
    if (data) {
      setSteps(prev => [...prev, data])
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
      const useRealAi = GEMINI_KEY && GEMINI_KEY !== 'your_gemini_api_key_here'

      if (useRealAi) {
        // Real AI mode
        const genAI = new GoogleGenerativeAI(GEMINI_KEY)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
        const result = await model.generateContent(`你是流程設計專家。根據以下需求，設計一個標準作業流程（SOP）。
需求：${userMsg}
請以 JSON 格式回覆（不要 markdown code block）：
{"name":"流程名稱","category":"分類","description":"流程說明","steps":[{"title":"步驟名稱","role":"負責角色","priority":"高/中/低","description":"步驟說明"}]}`)
        const text = result.response.text()
        json = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      } else {
        // Smart rule-based fallback
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
    if (!newTpl.name || !newTpl.steps.some(s => s.title)) return
    const validSteps = newTpl.steps.filter(s => s.title).map(s => ({
      ...s,
      checklist_id: s.checklist_id || null,
      approval_chain_id: s.approval_chain_id || null,
    }))
    const { data } = await supabase.from('sop_templates').insert({
      name: newTpl.name, category: newTpl.category,
      description: newTpl.description, steps: validSteps,
      approval_chain_id: newTpl.approval_chain_id || null,
    }).select().single()
    if (data) {
      setTemplates(prev => [...prev, data])
      setShowCreateTplModal(false)
      setNewTpl({ name: '', category: '展店', description: '', steps: [{ title: '', role: '', priority: '中', description: '', checklist_id: '', approval_chain_id: '' }], approval_chain_id: '' })
    }
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
        status: '進行中', started_by: employees[0]?.name || '系統',
      }).select().single()
      if (instance) {
        const stepRows = tplSteps.map((step, i) => ({
          instance_id: instance.id, step_order: i + 1,
          title: step.title, description: step.description,
          role: step.role, assignee: deployForm.assignees[i] || '',
          store: loc, status: '待處理',
        }))
        const { data: insertedSteps } = await supabase.from('workflow_steps').insert(stepRows).select()
        if (insertedSteps) {
          setSteps(prev => [...prev, ...insertedSteps])

          // 掛查核清單到步驟
          for (let i = 0; i < tplSteps.length; i++) {
            if (tplSteps[i].checklist_id && insertedSteps[i]) {
              await supabase.from('workflow_step_checklists').insert({
                step_id: insertedSteps[i].id,
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
                notes: `流程部署自動建立`,
              }).select().single()
              if (form && chain.steps) {
                const formSteps = chain.steps.map((s, idx) => ({
                  form_id: form.id, step_order: idx + 1,
                  role: s.role, label: s.label, status: '待簽',
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
    const instSteps = getInstanceSteps(inst.id)
    const stats = getStats(inst.id)

    return (
      <InstanceDetailView
        inst={inst} instSteps={instSteps} stats={stats}
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
        onStepUpdate={d => { setSteps(prev => prev.map(s => s.id === d.id ? d : s)); setSelectedStep(d) }}
        onStepDelete={id => { setSteps(prev => prev.filter(s => s.id !== id)); setSelectedStep(null) }}
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
            {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
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
            padding: '8px 20px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
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
        />
      )}
    </div>
  )
}
