import { useState, useEffect, useRef } from 'react'
import { Plus, Search, List, Columns, Calendar as CalIcon, GitBranch, Users, Pencil, Trash2, ShieldCheck, X as XIcon, Download, Upload, Loader2, AlignJustify } from 'lucide-react'
import { exportToCsv, fmtDate } from '../../lib/exportCsv'
import { todayTW } from '../../lib/datetime'
import { getTasks, createTask, updateTask, deleteTask, getTaskDependenciesByInstance, getCategories, getWorkflows, getApprovalChains, createTaskAttachment } from '../../lib/db'
import { safeStorageName } from '../../lib/storageSanitize'
import { supabase } from '../../lib/supabase'
import { notifyTaskAssignee } from '../../lib/lineNotify'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import TaskKanban from '../../components/tasks/TaskKanban'
import TaskCalendar from '../../components/tasks/TaskCalendar'
import TaskTimeline from '../../components/tasks/TaskTimeline'
import TaskModal from '../../components/tasks/TaskModal'
import TaskWorkloadView from '../../components/tasks/TaskWorkloadView'
import FormBindingsPicker from '../../components/FormBindingsPicker'
import TaskContextMenu from '../../components/ui/TaskContextMenu'
import { useAuth } from '../../contexts/AuthContext'
import { useAuditLog } from '../../lib/useAuditLog'
import { useRealtimeTasks } from '../../lib/hooks/useRealtimeSync'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

// Normalise legacy English bucket values → Traditional Chinese display names.
// Module-level so the lookup object isn't recreated on every render.
const normBucket = b => ({ General: '一般工作', Personal: '私人工作', Workflow: '工作流程', Project: '專案' }[b] || b || '一般工作')

export default function Tasks() {
  const { profile, isSuperAdmin } = useAuth()
  const { logAction, logFieldChange } = useAuditLog()
  const [tab, setTab] = useState('all')
  const [view, setView] = useState(() => localStorage.getItem('tasks_view') || 'list')
  const [swimlaneGroup, setSwimlaneGroup] = useState(() => localStorage.getItem('tasks_swimlane_group') || 'assignee')
  const [ctxMenu, setCtxMenu] = useState(null) // { task, x, y }
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [projects, setProjects] = useState([])
  const [taskCategories, setTaskCategories] = useState([])
  const [approvalChains, setApprovalChains] = useState([])
  const [dependencies, setDependencies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [formErrors, setFormErrors] = useState({})
  const [selectedTask, setSelectedTask] = useState(null)
  const [search, setSearch] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [filterBucket, setFilterBucket] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterWorkflow, setFilterWorkflow] = useState('')
  const [workflowDefs, setWorkflowDefs] = useState([])
  const [formSections, setFormSections] = useState([])
  const [form, setForm] = useState({ title: '', workflow: '', assignee: '', due_date: '', planned_start: '', store: '', role: '', priority: '中', bucket: '一般工作', task_type: 'task', project_id: '', section_id: '', description: '', approval_mode: 'none', approval_chain_id: '', confirmation_approvers: [], confirmation_mode: 'parallel', required_forms: [] })
  const [pendingFiles, setPendingFiles] = useState([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const newTaskFileRef = useRef(null)

  const [portfolioMode, setPortfolioMode] = useState(() => localStorage.getItem('tasks_portfolio_mode') === '1')

  const switchView = (v) => { setView(v); localStorage.setItem('tasks_view', v) }

  const handleExport = () => {
    exportToCsv(`tasks_${todayTW()}.csv`, filtered, [
      { label: 'ID',     value: r => `TK-${r.id}` },
      { label: '任務名稱', value: 'title' },
      { label: '狀態',   value: 'status' },
      { label: '優先級', value: 'priority' },
      { label: '類型',   value: 'bucket' },
      { label: '負責人', value: 'assignee' },
      { label: '門市',   value: 'store' },
      { label: '專案',   value: 'projectName' },
      { label: '所屬流程', value: 'workflow' },
      { label: '計畫開始', value: r => fmtDate(r.planned_start) },
      { label: '截止日',  value: r => fmtDate(r.due_date) },
    ])
  }

  const refresh = () => {
    return Promise.all([
      getTasks(),
      supabase.from('employees').select('id, name, department_id, position, dept').eq('status', '在職').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('departments').select('id, name').order('name'),
      supabase.from('projects').select('id, name').order('name'),
      getCategories('task'),
      getWorkflows(),
      getApprovalChains(),
    ]).then(([t, e, s, d, p, cat, wf, ac]) => {
      const rows = t.data || []
      setTasks(rows)
      setEmployees(e.data || [])
      setStores(s.data || [])
      setDepartments(d.data || [])
      setProjects(p.data || [])
      setTaskCategories(cat.data || [])
      setWorkflowDefs(wf.data || [])
      setApprovalChains(ac.data || [])
      const ids = rows.map(r => r.id)
      if (ids.length) {
        getTaskDependenciesByInstance(ids).then(({ data }) => setDependencies(data || []))
      }
    })
  }

  useEffect(() => {
    refresh()
      .catch(err => { console.error('Failed to load:', err); setError('資料載入失敗') })
      .finally(() => setLoading(false))
  }, [])

  // Live-sync: reflect DB changes made by other users or tabs without a full refresh
  useRealtimeTasks(setTasks)

  // Load sections for the selected project in the create form
  useEffect(() => {
    if (!form.project_id) { setFormSections([]); return }
    supabase.from('project_sections').select('id, name').eq('project_id', form.project_id).order('sort_order')
      .then(({ data }) => setFormSections(data || []))
  }, [form.project_id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleStatusChange = async (id, status) => {
    const oldTask = tasks.find(t => t.id === id)
    const completedAt = status === '已完成' ? new Date().toISOString() : null
    const { data, error } = await updateTask(id, { status, completed_at: completedAt })
    if (error) { toast.error('更新失敗：' + error.message); return }
    if (data) {
      setTasks(prev => prev.map(t => t.id === id ? data : t))
      if (oldTask) {
        logFieldChange('tasks', id, '狀態', oldTask.status, data.status, oldTask.title)
        if (data.completed_at !== oldTask.completed_at)
          logFieldChange('tasks', id, '實際完成日', oldTask.completed_at, data.completed_at, oldTask.title)
      }
    }
  }

  const handleDeleteTask = async (id) => {
    if (!(await confirm({ message: '確定刪除此任務？' }))) return
    const oldTask = tasks.find(t => t.id === id)
    const { error } = await deleteTask(id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    setTasks(prev => prev.filter(t => t.id !== id))
    logAction('刪除', 'tasks', id, oldTask?.title)
  }

  const handleProjectChange = async (id, projectId) => {
    const oldTask = tasks.find(t => t.id === id)
    const { data } = await updateTask(id, { project_id: projectId ? Number(projectId) : null })
    if (data) {
      setTasks(prev => prev.map(t => t.id === id ? data : t))
      if (oldTask) logFieldChange('tasks', id, '專案', oldTask.project_id, data.project_id, oldTask.title)
    }
  }

  const handleWorkflowChange = async (id, workflowName) => {
    const oldTask = tasks.find(t => t.id === id)
    const { data } = await updateTask(id, { workflow: workflowName || null })
    if (data) {
      setTasks(prev => prev.map(t => t.id === id ? data : t))
      if (oldTask) logFieldChange('tasks', id, '工作流', oldTask.workflow, data.workflow, oldTask.title)
    }
  }

  const handleSubmit = async () => {
    const errs = {}
    if (!form.title) errs.title = '任務名稱為必填'
    if (!form.due_date) errs.due_date = '截止日期為必填'
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return false }
    setFormErrors({})
    const chainId = form.approval_mode === 'chain' && form.approval_chain_id ? Number(form.approval_chain_id) : null

    // 解析 assignee_id：從 employees 找名字匹配的 id（跟 Projects.jsx 一致）
    const assigneeName = (form.assignee || '').trim()
    const empId = assigneeName
      ? (employees.find(e => e.name === assigneeName)?.id || null)
      : null
    if (assigneeName && empId === null && employees.length > 0) {
      console.warn('[Tasks] assignee 找不到對應員工，可能名字不符', { assigneeName, employees_count: employees.length })
    }

    const { data } = await createTask({
      title: form.title,
      workflow: form.workflow || null,
      assignee: assigneeName || null,
      assignee_id: empId,
      due_date: form.due_date || null,
      planned_start: form.planned_start || null,
      store: form.store || null,
      role: form.role || null,
      priority: form.priority,
      bucket: form.bucket || null,
      task_type: form.task_type || 'task',
      project_id: form.project_id ? Number(form.project_id) : null,
      section_id: form.section_id ? Number(form.section_id) : null,
      description: form.description || null,
      approval_chain_id: chainId,
      confirmation_mode: form.approval_mode === 'people' ? (form.confirmation_mode || 'parallel') : null,
      status: '待處理',
      organization_id: profile?.organization_id || null,
    })
    if (data) {
      // 指定人員模式 → 寫 task_confirmations
      if (form.approval_mode === 'people' && form.confirmation_approvers.length > 0) {
        await supabase.from('task_confirmations').insert(
          form.confirmation_approvers.map((approver, idx) => ({
            task_id: data.id,
            approver,
            step_order: idx,
            status: 'pending',
            organization_id: profile?.organization_id || null,
          }))
        )
      }
      // 綁定表單 → 建 task_form_bindings
      for (const f of (form.required_forms || [])) {
        await supabase.rpc('create_task_form_binding', {
          p_task_id: data.id,
          p_form_type: f.form_type,
          p_form_template_id: f.form_template_id || null,
        })
      }
      // 上傳附件
      if (pendingFiles.length > 0) {
        setUploadingFiles(true)
        for (const file of pendingFiles) {
          try {
            const sanitizedFileName = safeStorageName(file.name)
            const storagePath = `${data.id}/${Date.now()}_${sanitizedFileName}`
            const { error: uploadError } = await supabase.storage
              .from('task-attachments')
              .upload(storagePath, file, { upsert: false })
            if (!uploadError) {
              await createTaskAttachment({
                task_id: data.id,
                file_name: sanitizedFileName,
                storage_path: storagePath,
                uploaded_by: profile?.name || '使用者',
                kind: 'initiator',
              })
            }
          } catch {
            // non-blocking — task already created
          }
        }
        setUploadingFiles(false)
        setPendingFiles([])
      }
      // Send LINE notification after attachments are saved (DB trigger skips INSERT)
      if (data.assignee) {
        notifyTaskAssignee(data.assignee, data.title, '', data.id, {
          dueDate: data.due_date, description: data.description,
          notes: data.notes, store: data.store, priority: data.priority,
        }).catch(() => {})
      }
      setTasks(prev => [data, ...prev])
      setShowModal(false)
      setForm({ title: '', workflow: '', assignee: '', due_date: '', planned_start: '', store: '', role: '', priority: '中', bucket: '一般工作', task_type: 'task', project_id: '', section_id: '', description: '', approval_mode: 'none', approval_chain_id: '', confirmation_approvers: [], confirmation_mode: 'parallel', required_forms: [] })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  // Pre-build a project lookup map to avoid O(n²) .find() inside .map()
  const projectMap = new Map(projects.map(p => [p.id, p.name]))

  // Unified items — workflow tasks hidden until they become in-progress
  const allItems = tasks.filter(t => !(t.workflow_instance_id && t.status === '待簽核')).map(t => ({
    id: t.id,
    title: t.title,
    assignee: t.assignee,
    assignee_id: t.assignee_id,
    workflow: t.workflow || '',
    project_id: t.project_id || null,
    projectName: projectMap.get(t.project_id) || '',
    store: t.store || '',
    planned_start: t.planned_start || null,
    due_date: t.due_date,
    priority: t.priority || '中',
    status: t.status,
    bucket: normBucket(t.bucket || (t.workflow_instance_id ? 'Workflow' : 'General')),
  }))

  const workflows = [...new Set(allItems.map(t => t.workflow).filter(Boolean))].sort()

  // Filter
  const filtered = allItems.filter(t => {
    // 私人工作：只有本人或 super_admin 可見
    if (t.bucket === '私人工作' && !isSuperAdmin && t.assignee_id !== profile?.id && t.assignee !== profile?.name) return false
    if (filterAssignee && t.assignee !== filterAssignee) return false
    if (filterStore && t.store !== filterStore) return false
    if (filterBucket && t.bucket !== filterBucket) return false
    if (filterProject && t.projectName !== filterProject) return false
    if (filterWorkflow && t.workflow !== filterWorkflow) return false
    if (search) { const s = search.toLowerCase(); if (!t.title?.toLowerCase().includes(s) && !t.assignee?.toLowerCase().includes(s) && !`tk-${t.id}`.includes(s)) return false }
    if (tab === 'pending') return t.status === '未開始' || t.status === '待簽核'
    if (tab === 'active') return t.status === '進行中'
    if (tab === 'done') return t.status === '已完成'
    return t.status !== '已完成'
  })

  const activeCount = allItems.filter(t => t.status === '進行中').length
  const doneCount = allItems.filter(t => t.status === '已完成').length

  const statusOpts = ['未開始', '待簽核', '進行中', '已完成', '已擱置']
  const buckets = [...new Set(allItems.map(t => t.bucket).filter(Boolean))]

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 任務管理</h2>
            <p>共 {allItems.length} 個任務，已顯示 {filtered.length} 個</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleExport} title="匯出 CSV" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Download size={14} /> 匯出
            </button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增任務</button>
          </div>
        </div>
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: 8,
          background: 'var(--accent-cyan-dim)', fontSize: 12,
          color: 'var(--text-secondary)', lineHeight: 1.6,
        }}>
          💡 <strong>什麼是「任務」？</strong>單一待辦事項 — 一個人在期限前要完成的具體工作（例：「明天前盤點 A 區商品」）。
          需要多步驟、跨人協作的工作請建「流程」。
        </div>
      </div>

      {/* View switcher */}
      <div style={{ display: 'flex', marginBottom: 12 }}>
        <div style={{ display: 'flex', border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden' }}>
          {[
            { k: 'list',      icon: List,          label: '列表' },
            { k: 'kanban',    icon: Columns,       label: '看板' },
            { k: 'swimlane',  icon: AlignJustify,  label: '泳道' },
            { k: 'calendar',  icon: CalIcon,       label: '月曆' },
            { k: 'timeline',  icon: GitBranch,     label: '時程' },
            { k: 'workload',  icon: Users,         label: '工作量' },
          ].map(v => {
            const Icon = v.icon
            const active = view === v.k
            return (
              <button key={v.k} onClick={() => switchView(v.k)} title={v.label} style={{
                padding: '6px 10px', border: 'none',
                background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
                color: active ? '#fff' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>
                <Icon size={13} />{v.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
        {[
          { key: 'all', label: `📋 待辦任務` },
          { key: 'active', label: `🔄 進行中 (${activeCount})` },
          { key: 'done', label: `✅ 已完成 (${doneCount})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '10px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Filters — row 1 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto' }}>
        <div className="search-bar" style={{ minWidth: 180, flex: '0 0 180px' }}>
          <Search className="search-icon" />
          <input type="text" placeholder="搜尋任務..." className="form-input" style={{ paddingLeft: 38, width: '100%' }} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ flex: '0 0 180px' }}>
          <SearchableSelect
            value={filterAssignee}
            onChange={(v) => setFilterAssignee(v || '')}
            options={empOptions(employees, { keyBy: 'name' })}
            placeholder="🔍 篩選人員..."
          />
        </div>
        <select className="form-input" style={{ fontSize: 13, flex: '0 0 120px' }} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
          <option value="">全部門市</option>
          {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <select className="form-input" style={{ fontSize: 13, flex: '0 0 120px' }} value={filterBucket} onChange={e => setFilterBucket(e.target.value)}>
          <option value="">全部分類</option>
          {taskCategories.length > 0
            ? taskCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)
            : buckets.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="form-input" style={{ fontSize: 13, flex: '0 0 130px' }} value={filterProject} onChange={e => setFilterProject(e.target.value)}>
          <option value="">全部專案</option>
          {projects.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
        <select className="form-input" style={{ fontSize: 13, flex: '0 0 130px' }} value={filterWorkflow} onChange={e => setFilterWorkflow(e.target.value)}>
          <option value="">全部流程</option>
          {workflows.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>


      {view === 'workload' && (
        <TaskWorkloadView
          tasks={tasks.filter(t => !(t.bucket === '私人工作' && !isSuperAdmin && t.assignee_id !== profile?.id && t.assignee !== profile?.name))}
          employees={employees}
          onTaskClick={t => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
        />
      )}

      {view === 'kanban' && (
        <TaskKanban
          tasks={filtered.map(t => tasks.find(x => x.id === t.id) || t)}
          sections={[]}
          onTaskClick={t => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
          onTaskMoved={t => setTasks(prev => prev.map(x => x.id === t.id ? t : x))}
        />
      )}

      {view === 'swimlane' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>分組依照：</span>
            {[
              { v: 'assignee', l: '負責人' },
              { v: 'priority', l: '優先度' },
              { v: 'workflow', l: '工作流程' },
            ].map(opt => (
              <button key={opt.v} onClick={() => { setSwimlaneGroup(opt.v); localStorage.setItem('tasks_swimlane_group', opt.v) }} style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: swimlaneGroup === opt.v ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
                background: swimlaneGroup === opt.v ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                color: swimlaneGroup === opt.v ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              }}>{opt.l}</button>
            ))}
          </div>
          <TaskKanban
            tasks={filtered.map(t => tasks.find(x => x.id === t.id) || t)}
            sections={[]}
            groupBy={swimlaneGroup}
            onTaskClick={t => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
            onTaskMoved={t => setTasks(prev => prev.map(x => x.id === t.id ? t : x))}
          />
        </>
      )}

      {view === 'calendar' && (
        <TaskCalendar
          tasks={filtered.map(t => tasks.find(x => x.id === t.id) || t)}
          onTaskClick={t => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
        />
      )}

      {view === 'timeline' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              onClick={() => setPortfolioMode(v => { const next = !v; localStorage.setItem('tasks_portfolio_mode', next ? '1' : '0'); return next })}
              style={{
                fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid var(--border-medium)',
                background: portfolioMode ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                color: portfolioMode ? 'var(--accent-cyan)' : 'var(--text-muted)',
                fontWeight: portfolioMode ? 700 : 400,
              }}
            >
              📁 Portfolio 模式（依專案分組）
            </button>
          </div>
          <TaskTimeline
            tasks={filtered.map(t => tasks.find(x => x.id === t.id) || t)}
            dependencies={dependencies}
            onTaskClick={t => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
            groupByProject={portfolioMode}
            projects={projects}
          />
        </>
      )}

      {view === 'list' && (
      <div>
        {filtered.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>無符合條件的任務</div>
        )}
        {filtered.map(t => {
          const emp = employees.find(e => e.name === t.assignee)
          const dept = emp ? (departments.find(d => d.id === emp.department_id)?.name || emp.dept || '') : ''
          const iconBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 6, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }
          return (
            <div key={t.id} className="card" style={{ marginBottom: 10, padding: '12px 16px', cursor: 'pointer' }}
              onClick={() => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
              onContextMenu={e => { e.preventDefault(); setCtxMenu({ task: tasks.find(x => x.id === t.id) || t, x: e.clientX, y: e.clientY }) }}
              title="點擊編輯 · 右鍵更多操作">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>

                {/* Col 1: task info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>tk-{t.id}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.title}
                    </span>
                  </div>
                  {(t.assignee || dept || t.store) && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
                      {t.assignee && <span>負責人：{t.assignee}</span>}
                      {(dept || t.store) && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {t.assignee ? '　' : ''}{[dept, t.store].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5 }}>
                    <span className={`badge ${t.priority === '高' ? 'badge-danger' : t.priority === '中' ? 'badge-warning' : 'badge-neutral'}`}>
                      {t.priority}
                    </span>
                    {t.bucket && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, background: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                        {t.bucket}
                      </span>
                    )}
                  </div>
                </div>

                {/* Col 2: controls — stopPropagation 避免觸發外層 row 點擊編輯 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
                  onClick={e => e.stopPropagation()}>
                  <select className="form-input" style={{ padding: '2px 6px', fontSize: 12, minWidth: 0, maxWidth: 110 }}
                    value={t.project_id || ''}
                    onChange={e => handleProjectChange(t.id, e.target.value)}>
                    <option value="">— 專案 —</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select className="form-input" style={{ padding: '2px 6px', fontSize: 12, minWidth: 0, maxWidth: 110 }}
                    value={t.workflow}
                    onChange={e => handleWorkflowChange(t.id, e.target.value)}>
                    <option value="">— 流程 —</option>
                    {workflowDefs.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                  </select>
                  <select className="form-input" style={{ padding: '2px 6px', fontSize: 12, minWidth: 0 }}
                    value={t.status}
                    onChange={e => handleStatusChange(t.id, e.target.value)}>
                    {statusOpts.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <button title="編輯" style={iconBtnStyle}
                    onClick={() => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--accent-cyan)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}>
                    <Pencil size={14} />
                  </button>
                  <button title="刪除" style={iconBtnStyle}
                    onClick={() => handleDeleteTask(t.id)}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-red-dim)'; e.currentTarget.style.color = 'var(--accent-red)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>

              </div>
            </div>
          )
        })}
      </div>
      )}

      {ctxMenu && (
        <TaskContextMenu
          task={ctxMenu.task}
          x={ctxMenu.x} y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onEdit={t => setSelectedTask(t)}
          onDuplicate={async t => {
            const { data } = await import('../../lib/db').then(m => m.createTask({
              ...t, id: undefined, title: `${t.title} (複製)`, created_at: undefined, updated_at: undefined,
            }))
            if (data) setTasks(prev => [...prev, data])
          }}
          onStatusChange={async (id, status) => {
            const { updateTask } = await import('../../lib/db')
            const { data } = await updateTask(id, { status })
            if (data) setTasks(prev => prev.map(x => x.id === id ? data : x))
          }}
          onDelete={async id => {
            const { deleteTask } = await import('../../lib/db')
            await deleteTask(id)
            setTasks(prev => prev.filter(x => x.id !== id))
          }}
          assigneeOptions={employees.map(e => e.name)}
          onAssign={async (id, name) => {
            const { updateTask } = await import('../../lib/db')
            const { data } = await updateTask(id, { assignee: name })
            if (data) setTasks(prev => prev.map(x => x.id === id ? data : x))
          }}
        />
      )}

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          employees={employees}
          stores={stores}
          approvalChains={approvalChains}
          categoryOptions={taskCategories.map(c => c.name)}
          currentUser={profile}
          onClose={() => setSelectedTask(null)}
          onChange={(updated) => {
            setTasks(prev => prev.map(x => x.id === updated.id ? updated : x))
            setSelectedTask(updated)
          }}
          onDelete={(id) => setTasks(prev => prev.filter(x => x.id !== id))}
          onDuplicate={async (orig) => {
            // 複製任務（一般任務或專案/流程任務都行）
            const { data: dup, error } = await createTask({
              workflow_instance_id: orig.workflow_instance_id || null,
              project_id: orig.project_id || null,
              section_id: orig.section_id || null,
              step_order: orig.step_order ? (orig.step_order + 100) : null, // 排到最後
              title: `${orig.title}（複本）`,
              description: orig.description || null,
              assignee: orig.assignee || null,
              assignee_id: orig.assignee_id || null,
              store: orig.store || null,
              planned_start: orig.planned_start || null,
              due_date: orig.due_date || null,
              due_time: orig.due_time || '17:00',
              priority: orig.priority || '中',
              role: orig.role || null,
              status: '待處理',
              bucket: orig.bucket || null,
              category: orig.category || null,
              workflow: orig.workflow || null,
              recurrence_rule: orig.recurrence_rule || null,
              organization_id: profile?.organization_id || null,
              approval_chain_id: orig.approval_chain_id || null,
              confirmation_required: orig.confirmation_required || false,
              confirmation_mode: orig.confirmation_mode || null,
              trigger_template_id_on_complete: orig.trigger_template_id_on_complete || null,
            })
            if (error || !dup) {
              toast.error('複製失敗：' + (error?.message || '未知錯誤'))
              return
            }
            // 複製 task_checklists
            const { data: cls } = await supabase.from('task_checklists').select('checklist_id').eq('task_id', orig.id)
            if (cls && cls.length > 0) {
              await supabase.from('task_checklists').insert(cls.map(c => ({ task_id: dup.id, checklist_id: c.checklist_id })))
            }
            // 複製 task_confirmations
            const { data: confs } = await supabase.from('task_confirmations').select('approver, step_order').eq('task_id', orig.id)
            if (confs && confs.length > 0) {
              await supabase.from('task_confirmations').insert(confs.map(c => ({
                task_id: dup.id, approver: c.approver, step_order: c.step_order || 0,
                status: 'pending', organization_id: profile?.organization_id || null,
              })))
            }
            setTasks(prev => [...prev, dup])
            toast.success(`已複製「${orig.title}」`)
          }}
        />
      )}

      {showModal && (
        <Modal title="新增任務" onClose={() => { setShowModal(false); setFormErrors({}); setPendingFiles([]) }} onSubmit={handleSubmit}>
          <Field label="任務名稱" required error={!!formErrors.title} errorMsg={formErrors.title}>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="任務名稱" value={form.title}
              onChange={e => { set('title', e.target.value); if (formErrors.title) setFormErrors(f => ({ ...f, title: undefined })) }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責人">
              <SearchableSelect
                value={form.assignee}
                onChange={(v) => set('assignee', v || '')}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋員工姓名/職稱..."
              />
            </Field>
            <Field label="門市">
              <select className="form-input" style={{ width: '100%' }} value={form.store} onChange={e => set('store', e.target.value)}>
                <option value="">— 選擇門市 —</option>
                {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="計畫開始">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.planned_start} onChange={e => set('planned_start', e.target.value)} />
            </Field>
            <Field label="截止日期" required error={!!formErrors.due_date} errorMsg={formErrors.due_date}>
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.due_date}
                onChange={e => { set('due_date', e.target.value); if (formErrors.due_date) setFormErrors(f => ({ ...f, due_date: undefined })) }} />
            </Field>
            <Field label="優先度">
              <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option>高</option><option>中</option><option>低</option>
              </select>
            </Field>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={form.bucket} onChange={e => set('bucket', e.target.value)}>
                <option value="">— 選擇分類 —</option>
                {taskCategories.length > 0
                  ? taskCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)
                  : ['一般工作', '私人工作', '工作流程'].map(b => <option key={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="任務類型">
              <select className="form-input" style={{ width: '100%' }} value={form.task_type} onChange={e => set('task_type', e.target.value)}>
                <option value="task">一般任務</option>
                <option value="milestone">里程碑</option>
                <option value="approval">審批</option>
                <option value="process_step">SOP 步驟</option>
              </select>
            </Field>
            <Field label="角色">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：店長、主管..." value={form.role} onChange={e => set('role', e.target.value)} />
            </Field>
            <Field label="所屬專案">
              <select className="form-input" style={{ width: '100%' }} value={form.project_id}
                onChange={e => { set('project_id', e.target.value); set('section_id', '') }}>
                <option value="">— 選擇專案 —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="區段">
              <select className="form-input" style={{ width: '100%' }} value={form.section_id}
                onChange={e => set('section_id', e.target.value)}
                disabled={!form.project_id || formSections.length === 0}>
                <option value="">— 選擇區段 —</option>
                {formSections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="所屬流程">
              <select className="form-input" style={{ width: '100%' }} value={form.workflow} onChange={e => set('workflow', e.target.value)}>
                <option value="">— 選擇流程 —</option>
                {workflowDefs.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
              </select>
            </Field>
          </div>
          {/* 審批人員設定 */}
          <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>🔧 審批設定（選填）</div>
            <Field label="簽核方式">
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { v: 'none',   l: '不需簽核' },
                  { v: 'people', l: '指定人員' },
                  { v: 'chain',  l: '套用簽核鏈' },
                ].map(opt => {
                  const active = form.approval_mode === opt.v
                  return (
                    <button type="button" key={opt.v}
                      onClick={() => set('approval_mode', opt.v)}
                      style={{
                        flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 12, fontWeight: 600,
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
            {form.approval_mode === 'people' && (
              <>
                <Field label="加入審批人員">
                  <SearchableSelect
                    value=""
                    onChange={(name) => {
                      if (!name) return
                      set('confirmation_approvers', [...(form.confirmation_approvers || []).filter(x => x !== name), name])
                    }}
                    options={empOptions(employees.filter(e => !(form.confirmation_approvers || []).includes(e.name)), { keyBy: 'name' })}
                    placeholder="🔍 搜尋姓名 / 職稱..."
                  />
                </Field>
                {(form.confirmation_approvers || []).length > 0 && (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {form.confirmation_approvers.map(name => (
                        <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 14, fontSize: 12, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', border: '1px solid var(--accent-purple)' }}>
                          <ShieldCheck size={11} /> {name}
                          <button type="button" onClick={() => set('confirmation_approvers', form.confirmation_approvers.filter(x => x !== name))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-purple)', padding: 0, lineHeight: 1 }}>
                            <XIcon size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                    {form.confirmation_approvers.length > 1 && (
                      <Field label="多人簽核模式">
                        <select className="form-input" style={{ width: '100%' }} value={form.confirmation_mode} onChange={e => set('confirmation_mode', e.target.value)}>
                          <option value="parallel">並簽（任一人通過即可）</option>
                          <option value="sequential">會簽（每個人都要通過）</option>
                        </select>
                      </Field>
                    )}
                  </>
                )}
              </>
            )}
            {form.approval_mode === 'chain' && (
              <Field label="選擇簽核鏈">
                <select className="form-input" style={{ width: '100%' }} value={form.approval_chain_id} onChange={e => set('approval_chain_id', e.target.value)}>
                  <option value="">— 請選擇 —</option>
                  {approvalChains.map(c => (
                    <option key={c.id} value={c.id}>{c.name}（{c.steps?.length || 0} 關）</option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          {/* 綁定表單 — 任務完成前需填完這些表單 */}
          <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>📋 綁定表單（選填）</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              員工開任務後要填完選定的表單，全部核准才能完成任務
            </div>
            <FormBindingsPicker
              value={form.required_forms || []}
              onChange={v => set('required_forms', v)}
            />
          </div>

          {/* 附件（選填） */}
          <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>📎 附件（選填）</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              任務建立後自動上傳，單檔上限 10 MB，不支援執行檔
            </div>
            <input
              ref={newTaskFileRef}
              type="file"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                const ext = file.name.split('.').pop()?.toLowerCase()
                const BLOCKED = ['exe', 'bat', 'sh', 'cmd', 'ps1', 'scr', 'vbs', 'msi', 'com']
                if (BLOCKED.includes(ext)) { toast.error('不允許上傳可執行檔案'); return }
                if (file.size > 10 * 1024 * 1024) { toast.error('檔案超過 10 MB 限制'); return }
                setPendingFiles(prev => [...prev, file])
              }}
            />
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => newTaskFileRef.current?.click()}
              disabled={uploadingFiles}
            >
              {uploadingFiles
                ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> 上傳中...</>
                : <><Upload size={11} /> 選擇檔案</>}
            </button>
            {pendingFiles.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {pendingFiles.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '4px 10px', borderRadius: 6, fontSize: 12,
                    background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
                  }}>
                    <span style={{ color: 'var(--text-secondary)' }}>📄 {f.name}</span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Field label="說明（選填）">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} placeholder="任務說明、注意事項..." value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
