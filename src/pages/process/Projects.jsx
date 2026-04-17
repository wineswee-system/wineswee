import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { Plus, X, ChevronRight, ChevronDown, Check, Clock, Pause, Ban, Play, MessageSquare, Workflow, CheckSquare, Edit3, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getEmployees } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

const STATUS_MAP = {
  '規劃中': { color: 'var(--accent-blue)', icon: Clock },
  '進行中': { color: 'var(--accent-green)', icon: Play },
  '已完成': { color: 'var(--accent-cyan)', icon: Check },
  '暫停':   { color: 'var(--accent-yellow)', icon: Pause },
  '已取消': { color: 'var(--accent-red)', icon: Ban },
}

const PRIORITY_COLORS = { '高': 'var(--accent-red)', '中': 'var(--accent-yellow)', '低': 'var(--accent-green)' }

const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '-'

const emptyForm = { name: '', description: '', status: '規劃中', priority: '中', owner: '', department: '', store: '', start_date: '', end_date: '', budget: '' }

export default function Projects() {
  const { profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [workflows, setWorkflows] = useState([])
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [tab, setTab] = useState('all')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [pRes, wRes, tRes, eRes, cRes] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('workflow_instances').select('*').not('project_id', 'is', null).order('sort_order'),
      supabase.from('tasks').select('*').order('step_order'),
      getEmployees(),
      supabase.from('project_comments').select('*').order('created_at', { ascending: false }),
    ])
    setProjects(pRes.data || [])
    setWorkflows(wRes.data || [])
    setTasks(tRes.data || [])
    setEmployees((eRes.data || []).filter(e => e.status === '在職'))
    setComments(cRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Project CRUD
  const handleSubmit = async () => {
    if (!form.name) return
    const payload = { ...form, budget: form.budget ? Number(form.budget) : null, organization_id: 1 }
    if (editingId) {
      const { data } = await supabase.from('projects').update(payload).eq('id', editingId).select().single()
      if (data) setProjects(prev => prev.map(p => p.id === editingId ? data : p))
    } else {
      payload.owner = payload.owner || profile?.name || ''
      const { data } = await supabase.from('projects').insert(payload).select().single()
      if (data) setProjects(prev => [data, ...prev])
    }
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
  }

  const openEdit = (p) => {
    setForm({
      name: p.name, description: p.description || '', status: p.status, priority: p.priority || '中',
      owner: p.owner || '', department: p.department || '', store: p.store || '',
      start_date: p.start_date || '', end_date: p.end_date || '', budget: p.budget || '',
    })
    setEditingId(p.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('確定刪除此專案？')) return
    await supabase.from('projects').delete().eq('id', id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  // Add comment
  const addComment = async (projectId) => {
    if (!commentText.trim()) return
    const { data } = await supabase.from('project_comments').insert({
      project_id: projectId, author: profile?.name || '系統', content: commentText,
    }).select().single()
    if (data) setComments(prev => [data, ...prev])
    setCommentText('')
  }

  // Calculate progress
  const getProgress = (projectId) => {
    const pWorkflows = workflows.filter(w => w.project_id === projectId)
    if (pWorkflows.length === 0) return 0
    const completed = pWorkflows.filter(w => w.status === '已完成').length
    return Math.round((completed / pWorkflows.length) * 100)
  }

  // Get workflows for a project
  const getProjectWorkflows = (projectId) => workflows.filter(w => w.project_id === projectId)
  const getWorkflowTasks = (instanceId) => tasks.filter(t => t.workflow_instance_id === instanceId)
  const getProjectComments = (projectId) => comments.filter(c => c.project_id === projectId)

  // Filter
  const filtered = projects.filter(p => tab === 'all' || p.status === tab)

  const counts = {}
  projects.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1 })

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📁</span> 專案管理</h2>
            <p>Project → Workflow → Task 三層架構</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增專案
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 20 }}>
        {Object.entries(STATUS_MAP).map(([status, { color }]) => (
          <div key={status} className="card" style={{ padding: '12px 16px', cursor: 'pointer', border: tab === status ? `2px solid ${color}` : undefined }}
            onClick={() => setTab(tab === status ? 'all' : status)}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{status}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{counts[status] || 0}</div>
          </div>
        ))}
      </div>

      {/* Project List */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          尚無專案，點「新增專案」開始
        </div>
      ) : filtered.map(p => {
        const isExp = expanded === p.id
        const pWorkflows = getProjectWorkflows(p.id)
        const progress = getProgress(p.id)
        const sc = STATUS_MAP[p.status] || {}
        const StatusIcon = sc.icon || Clock

        return (
          <div key={p.id} className="card" style={{ marginBottom: 12 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '4px 0' }}
              onClick={() => setExpanded(isExp ? null : p.id)}>
              {isExp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: sc.color, background: `color-mix(in srgb, ${sc.color} 15%, transparent)` }}>
                    <StatusIcon size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{p.status}
                  </span>
                  <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: PRIORITY_COLORS[p.priority] }}>
                    {p.priority}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {p.owner && `負責人：${p.owner}`}
                  {p.department && ` · ${p.department}`}
                  {p.start_date && ` · ${p.start_date}`}
                  {p.end_date && ` ~ ${p.end_date}`}
                  {pWorkflows.length > 0 && ` · ${pWorkflows.length} 流程`}
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ width: 80, textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: sc.color }}>{progress}%</div>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--border-medium)', marginTop: 4 }}>
                  <div style={{ height: '100%', borderRadius: 2, width: `${progress}%`, background: sc.color, transition: 'width 0.3s' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => openEdit(p)}><Edit3 size={13} /></button>
                <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(p.id)}><Trash2 size={13} /></button>
              </div>
            </div>

            {/* Expanded: Workflows + Tasks */}
            {isExp && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                {p.description && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>{p.description}</div>}

                {p.budget && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    預算：{fmt(p.budget)}{p.spent > 0 && ` · 已用：${fmt(p.spent)}`}
                  </div>
                )}

                {/* Workflows */}
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Workflow size={14} /> 流程（{pWorkflows.length}）
                </div>
                {pWorkflows.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--glass-light)', borderRadius: 8 }}>
                    尚無流程。到「流程管理」建立流程時可指定專案。
                  </div>
                ) : pWorkflows.map(w => {
                  const wTasks = getWorkflowTasks(w.id)
                  const wDone = wTasks.filter(t => t.status === '已完成').length
                  const wColor = w.status === '已完成' ? 'var(--accent-green)' : w.status === '已退回' ? 'var(--accent-red)' : 'var(--accent-blue)'
                  return (
                    <div key={w.id} style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{w.template_name}</span>
                          <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: wColor, background: `color-mix(in srgb, ${wColor} 15%, transparent)` }}>
                            {w.status}
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {wTasks.length > 0 ? `${wDone}/${wTasks.length} 任務` : '無任務'}
                        </span>
                      </div>
                      {/* Tasks under this workflow */}
                      {wTasks.length > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {wTasks.map(t => (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 0' }}>
                              <CheckSquare size={12} color={t.status === '已完成' ? 'var(--accent-green)' : 'var(--text-muted)'} />
                              <span style={{ flex: 1, textDecoration: t.status === '已完成' ? 'line-through' : 'none', color: t.status === '已完成' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                                {t.title}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.assignee || t.assigned_to || '-'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Comments */}
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MessageSquare size={14} /> 備註（{getProjectComments(p.id).length}）
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input type="text" value={commentText} onChange={e => setCommentText(e.target.value)}
                    placeholder="新增備註..." onKeyDown={e => e.key === 'Enter' && addComment(p.id)}
                    style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 12 }} />
                  <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => addComment(p.id)}>送出</button>
                </div>
                {getProjectComments(p.id).slice(0, 5).map(c => (
                  <div key={c.id} style={{ fontSize: 12, padding: '4px 0', color: 'var(--text-secondary)' }}>
                    <strong>{c.author}</strong>：{c.content}
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{c.created_at?.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* New/Edit Modal */}
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 520, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯專案' : '新增專案'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>專案名稱 *</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：南京門市裝潢翻新"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>狀態</label>
                  <select value={form.status} onChange={e => set('status', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {Object.keys(STATUS_MAP).map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>優先級</label>
                  <select value={form.priority} onChange={e => set('priority', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    <option>高</option><option>中</option><option>低</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>預算</label>
                  <input type="number" value={form.budget} onChange={e => set('budget', e.target.value)} placeholder="選填"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>負責人</label>
                  <select value={form.owner} onChange={e => set('owner', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    <option value="">請選擇</option>
                    {employees.map(e => <option key={e.id} value={e.name}>{e.name}（{e.dept || e.position}）</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>部門</label>
                  <input type="text" value={form.department} onChange={e => set('department', e.target.value)} placeholder="選填"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>開始日期</label>
                  <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>結束日期</label>
                  <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>說明</label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="專案描述..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', minHeight: 60, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit}>{editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
