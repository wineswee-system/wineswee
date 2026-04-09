import { useState, useEffect } from 'react'
import { Plus, Search } from 'lucide-react'
import { getTasks, createTask, updateTask } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Tasks() {
  const [tab, setTab] = useState('all')
  const [tasks, setTasks] = useState([])         // legacy tasks
  const [wfSteps, setWfSteps] = useState([])      // workflow_steps
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [form, setForm] = useState({ title: '', workflow: '', assignee: '', due_date: '', priority: '中' })

  useEffect(() => {
    Promise.all([
      getTasks(),
      supabase.from('workflow_steps')
        .select('*, workflow_instances(template_name, store)')
        .order('step_order'),
      supabase.from('employees').select('id, name, dept, position').eq('status', '在職').order('name'),
      supabase.from('stores').select('*').order('name'),
    ]).then(([t, wf, e, s]) => {
      setTasks(t.data || [])
      setWfSteps(wf.data || [])
      setEmployees(e.data || [])
      setStores(s.data || [])
    }).catch(err => {
      console.error('Failed to load:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleStatusChange = async (id, status) => {
    const { data } = await updateTask(id, { status })
    if (data) setTasks(prev => prev.map(t => t.id === id ? data : t))
  }

  const handleWfStatusChange = async (id, status) => {
    const completedAt = status === '已完成' ? new Date().toISOString() : null
    const { data } = await supabase.from('workflow_steps')
      .update({ status, completed_at: completedAt }).eq('id', id).select().single()
    if (data) setWfSteps(prev => prev.map(s => s.id === id ? data : s))
  }

  const handleSubmit = async () => {
    if (!form.title) return
    const { data } = await createTask({ ...form, status: '未開始' })
    if (data) {
      setTasks(prev => [...prev, data])
      setShowModal(false)
      setForm({ title: '', workflow: '', assignee: '', due_date: '', priority: '中' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  // Combine all items for unified view
  const allItems = [
    ...wfSteps.map(s => ({
      id: `wf-${s.id}`, _type: 'wf', _id: s.id,
      title: s.title, assignee: s.assignee,
      workflow: s.workflow_instances?.store || s.workflow_instances?.template_name || '',
      store: s.store || s.workflow_instances?.store || '',
      due_date: s.due_date, priority: s.priority || '中',
      status: s.status === '待處理' ? '未開始' : s.status,
    })),
    ...tasks.map(t => ({
      id: `t-${t.id}`, _type: 'task', _id: t.id,
      title: t.title, assignee: t.assignee,
      workflow: t.workflow || '', store: '',
      due_date: t.due_date, priority: t.priority || '中',
      status: t.status,
    })),
  ]

  // Filter
  const filtered = allItems.filter(t => {
    if (filterAssignee && t.assignee !== filterAssignee) return false
    if (filterStore && t.store !== filterStore) return false
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase()) && !t.assignee?.toLowerCase().includes(search.toLowerCase())) return false
    if (tab === 'pending') return t.status === '未開始' || t.status === '待處理'
    if (tab === 'active') return t.status === '進行中'
    if (tab === 'done') return t.status === '已完成'
    return true
  })

  const pendingCount = allItems.filter(t => t.status === '未開始' || t.status === '待處理').length
  const activeCount = allItems.filter(t => t.status === '進行中').length
  const doneCount = allItems.filter(t => t.status === '已完成').length

  const statusOpts = ['未開始', '進行中', '已完成', '已擱置']

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

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <Search className="search-icon" />
          <input type="text" placeholder="搜尋任務..." className="form-input" style={{ paddingLeft: 38, width: '100%' }} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-input" style={{ fontSize: 13, minWidth: 130 }} value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="">全部人員</option>
          {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
        </select>
        <select className="form-input" style={{ fontSize: 13, minWidth: 130 }} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
          <option value="">全部門市</option>
          {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>任務名稱</th><th>所屬流程</th><th>負責人</th><th>門市</th><th>截止日期</th><th>優先度</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無符合條件的任務</td></tr>}
              {filtered.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.title}</td>
                  <td>{t.workflow ? <span className="badge badge-neutral">{t.workflow}</span> : '—'}</td>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{t.assignee || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.store || '—'}</td>
                  <td style={{ fontSize: 12 }}>{t.due_date || '—'}</td>
                  <td>
                    <span className={`badge ${t.priority === '高' ? 'badge-danger' : t.priority === '中' ? 'badge-warning' : 'badge-neutral'}`}>
                      {t.priority}
                    </span>
                  </td>
                  <td>
                    <select className="form-input" style={{ padding: '2px 8px', fontSize: 12 }} value={t.status}
                      onChange={e => {
                        if (t._type === 'wf') handleWfStatusChange(t._id, e.target.value === '未開始' ? '待處理' : e.target.value)
                        else handleStatusChange(t._id, e.target.value)
                      }}>
                      {statusOpts.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增任務" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="任務名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="任務名稱" value={form.title} onChange={e => set('title', e.target.value)} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="所屬流程"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="流程名稱" value={form.workflow} onChange={e => set('workflow', e.target.value)} /></Field>
            <Field label="負責人">
              <select className="form-input" style={{ width: '100%' }} value={form.assignee} onChange={e => set('assignee', e.target.value)}>
                <option value="">請選擇</option>
                {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="截止日期"><input className="form-input" type="date" style={{ width: '100%' }} value={form.due_date} onChange={e => set('due_date', e.target.value)} /></Field>
            <Field label="優先度">
              <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option>高</option><option>中</option><option>低</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
