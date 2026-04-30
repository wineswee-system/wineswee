import { useState, useEffect } from 'react'
import { Plus, Search, List, Columns, Calendar as CalIcon, GitBranch } from 'lucide-react'
import { getTasks, createTask, updateTask, getTaskDependenciesByInstance, getCategories, getWorkflows } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import TaskKanban from '../../components/tasks/TaskKanban'
import TaskCalendar from '../../components/tasks/TaskCalendar'
import TaskTimeline from '../../components/tasks/TaskTimeline'
import TaskModal from '../../components/tasks/TaskModal'
import { useAuth } from '../../contexts/AuthContext'
import { empLabel } from '../../lib/empLabel'

export default function Tasks() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('all')
  const [view, setView] = useState(() => localStorage.getItem('tasks_view') || 'list')
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [projects, setProjects] = useState([])
  const [taskCategories, setTaskCategories] = useState([])
  const [dependencies, setDependencies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [search, setSearch] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [filterBucket, setFilterBucket] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterWorkflow, setFilterWorkflow] = useState('')
  const [workflowDefs, setWorkflowDefs] = useState([])
  const [form, setForm] = useState({ title: '', workflow: '', assignee: '', due_date: '', priority: '中', bucket: 'General' })

  const switchView = (v) => { setView(v); localStorage.setItem('tasks_view', v) }

  const refresh = () => {
    return Promise.all([
      getTasks(),
      supabase.from('employees').select('id, name, department_id, position, dept').eq('status', '在職').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('departments').select('id, name').order('name'),
      supabase.from('projects').select('id, name').order('name'),
      getCategories('task'),
      getWorkflows(),
    ]).then(([t, e, s, d, p, cat, wf]) => {
      const rows = t.data || []
      setTasks(rows)
      setEmployees(e.data || [])
      setStores(s.data || [])
      setDepartments(d.data || [])
      setProjects(p.data || [])
      setTaskCategories(cat.data || [])
      setWorkflowDefs(wf.data || [])
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

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleStatusChange = async (id, status) => {
    const completedAt = status === '已完成' ? new Date().toISOString() : null
    const { data } = await updateTask(id, { status, completed_at: completedAt })
    if (data) {
      setTasks(prev => prev.map(t => t.id === id ? data : t))
    }
  }

  const handleSubmit = async () => {
    if (!form.title) return
    const { data } = await createTask({ ...form, status: '未開始' })
    if (data) {
      setTasks(prev => [data, ...prev])
      setShowModal(false)
      setForm({ title: '', workflow: '', assignee: '', due_date: '', priority: '中', bucket: 'General' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  // Unified items — workflow tasks hidden until they become in-progress
  const allItems = tasks.filter(t => !(t.workflow_instance_id && t.status === '待處理')).map(t => ({
    id: t.id,
    title: t.title,
    assignee: t.assignee,
    workflow: t.workflow || '',
    projectName: projects.find(p => p.id === t.project_id)?.name || '',
    store: t.store || '',
    due_date: t.due_date,
    priority: t.priority || '中',
    status: t.status === '待處理' ? '未開始' : t.status,
    bucket: t.bucket || (t.workflow_instance_id ? 'Workflow' : 'General'),
  }))

  const workflows = [...new Set(allItems.map(t => t.workflow).filter(Boolean))].sort()

  // Filter
  const filtered = allItems.filter(t => {
    if (filterAssignee && t.assignee !== filterAssignee) return false
    if (filterStore && t.store !== filterStore) return false
    if (filterBucket && t.bucket !== filterBucket) return false
    if (filterProject && t.projectName !== filterProject) return false
    if (filterWorkflow && t.workflow !== filterWorkflow) return false
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase()) && !t.assignee?.toLowerCase().includes(search.toLowerCase())) return false
    if (tab === 'pending') return t.status === '未開始' || t.status === '待處理'
    if (tab === 'active') return t.status === '進行中'
    if (tab === 'done') return t.status === '已完成'
    return t.status !== '已完成'
  })

  const pendingCount = allItems.filter(t => t.status === '未開始' || t.status === '待處理').length
  const activeCount = allItems.filter(t => t.status === '進行中').length
  const doneCount = allItems.filter(t => t.status === '已完成').length

  const statusOpts = ['未開始', '進行中', '已完成', '已擱置']
  const buckets = [...new Set(allItems.map(t => t.bucket).filter(Boolean))]

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 任務管理</h2>
            <p>共 {allItems.length} 個任務，已顯示 {filtered.length} 個</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增任務</button>
        </div>
      </div>

      {/* View switcher */}
      <div style={{ display: 'flex', marginBottom: 12 }}>
        <div style={{ display: 'flex', border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden' }}>
          {[
            { k: 'list',     icon: List,    label: '列表' },
            { k: 'kanban',   icon: Columns, label: '看板' },
            { k: 'calendar', icon: CalIcon, label: '月曆' },
            { k: 'timeline', icon: GitBranch, label: '時程' },
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
        <select className="form-input" style={{ fontSize: 13, flex: '0 0 130px' }} value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="">全部人員</option>
          <optgroup label="員工">
            {employees.map(e => {
              const dept = departments.find(d => d.id === e.department_id)?.name || e.dept || ''
              const label = `${empLabel(e)}｜${e.position || ''}${dept ? `（${dept}）` : ''}`
              return <option key={e.id} value={e.name}>{label}</option>
            })}
          </optgroup>
        </select>
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


      {view === 'kanban' && (
        <TaskKanban
          tasks={filtered.map(t => tasks.find(x => x.id === t.id) || t)}
          sections={[]}
          onTaskClick={t => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
          onTaskMoved={t => setTasks(prev => prev.map(x => x.id === t.id ? t : x))}
        />
      )}

      {view === 'calendar' && (
        <TaskCalendar
          tasks={filtered.map(t => tasks.find(x => x.id === t.id) || t)}
          onTaskClick={t => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
        />
      )}

      {view === 'timeline' && (
        <TaskTimeline
          tasks={filtered.map(t => tasks.find(x => x.id === t.id) || t)}
          dependencies={dependencies}
          onTaskClick={t => setSelectedTask(tasks.find(x => x.id === t.id) || t)}
        />
      )}

      {view === 'list' && (
      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>任務名稱</th><th>所屬專案</th><th>所屬流程</th><th>負責人</th><th>門市</th><th>截止日期</th><th>優先度</th><th>分類</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無符合條件的任務</td></tr>}
              {filtered.map(t => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedTask(tasks.find(x => x.id === t.id) || t)}>
                  <td style={{ fontWeight: 600 }}>{t.title}</td>
                  <td>{t.projectName ? <span className="badge badge-neutral" style={{ color: 'var(--accent-purple)', background: 'var(--accent-purple-dim)' }}>{t.projectName}</span> : '—'}</td>
                  <td>{t.workflow ? <span className="badge badge-neutral">{t.workflow}</span> : '—'}</td>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{t.assignee || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.store || '—'}</td>
                  <td style={{ fontSize: 12 }}>{t.due_date || '—'}</td>
                  <td>
                    <span className={`badge ${t.priority === '高' ? 'badge-danger' : t.priority === '中' ? 'badge-warning' : 'badge-neutral'}`}>
                      {t.priority}
                    </span>
                  </td>
                  <td><span className="badge badge-neutral" style={{ fontSize: 11 }}>{t.bucket}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    <select className="form-input" style={{ padding: '2px 8px', fontSize: 12 }} value={t.status}
                      onChange={e => handleStatusChange(t.id, e.target.value === '未開始' ? '待處理' : e.target.value)}>
                      {statusOpts.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          employees={employees}
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
              alert('複製失敗：' + (error?.message || '未知錯誤'))
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
            alert(`已複製「${orig.title}」`)
          }}
        />
      )}

      {showModal && (
        <Modal title="新增任務" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="任務名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="任務名稱" value={form.title} onChange={e => set('title', e.target.value)} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="所屬流程">
              <select className="form-input" style={{ width: '100%' }} value={form.workflow} onChange={e => set('workflow', e.target.value)}>
                <option value="">— 選擇流程 —</option>
                {workflowDefs.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="負責人">
              <select className="form-input" style={{ width: '100%' }} value={form.assignee} onChange={e => set('assignee', e.target.value)}>
                <option value="">請選擇</option>
                <optgroup label="員工">
            {employees.map(e => {
              const dept = departments.find(d => d.id === e.department_id)?.name || e.dept || ''
              const label = `${empLabel(e)}｜${e.position || ''}${dept ? `（${dept}）` : ''}`
              return <option key={e.id} value={e.name}>{label}</option>
            })}
          </optgroup>
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="截止日期"><input className="form-input" type="date" style={{ width: '100%' }} value={form.due_date} onChange={e => set('due_date', e.target.value)} /></Field>
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
                  : ['General', 'Personal', 'Workflow'].map(b => <option key={b}>{b}</option>)}
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
