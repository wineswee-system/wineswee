import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import Modal, { Field } from '../../components/Modal'
import {
  Plus, X, ChevronRight, ChevronDown, Check, Clock, Pause, Ban, Play,
  MessageSquare, Workflow, CheckSquare, Edit3, Trash2, FolderOpen, Filter
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getEmployees } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

const STATUS_MAP = {
  '規劃中': { color: 'var(--accent-blue)', icon: Clock },
  '進行中': { color: 'var(--accent-cyan)', icon: Play },
  '已完成': { color: 'var(--accent-green)', icon: Check },
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
  const [stores, setStores] = useState([])
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [tab, setTab] = useState('active')
  const [filterOwner, setFilterOwner] = useState('')
  const [filterStore, setFilterStore] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [pRes, wRes, tRes, eRes, sRes, cRes] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('workflow_instances').select('*').not('project_id', 'is', null).order('sort_order'),
      supabase.from('tasks').select('*').order('step_order'),
      getEmployees(),
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('project_comments').select('*').order('created_at', { ascending: false }),
    ])
    setProjects(pRes.data || [])
    setWorkflows(wRes.data || [])
    setTasks(tRes.data || [])
    setEmployees((eRes.data || []).filter(e => e.status === '在職'))
    setStores(sRes.data || [])
    setComments(cRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Stats
  const getStats = (projectId) => {
    const pWorkflows = workflows.filter(w => w.project_id === projectId)
    const pTasks = pWorkflows.flatMap(w => tasks.filter(t => t.workflow_instance_id === w.id))
    const total = pTasks.length
    const completed = pTasks.filter(t => t.status === '已完成').length
    const inProgress = pTasks.filter(t => t.status === '進行中').length
    const pending = total - completed - inProgress
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, inProgress, pending, pct, workflows: pWorkflows.length }
  }

  // CRUD
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
    if (!confirm('確定刪除此專案？')) return
    await supabase.from('projects').delete().eq('id', id)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const addComment = async (projectId) => {
    if (!commentText.trim()) return
    const { data } = await supabase.from('project_comments').insert({
      project_id: projectId, author: profile?.name || '系統', content: commentText,
    }).select().single()
    if (data) setComments(prev => [data, ...prev])
    setCommentText('')
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

        {/* Stats cards */}
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
            <div className="stat-card-label">流程</div><div className="stat-card-value">{stats.workflows}</div>
          </div>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
            <div className="stat-card-label">總任務</div><div className="stat-card-value">{stats.total}</div>
          </div>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
            <div className="stat-card-label">已完成</div><div className="stat-card-value">{stats.completed}</div>
          </div>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
            <div className="stat-card-label">進行中</div><div className="stat-card-value">{stats.inProgress}</div>
          </div>
          <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
            <div className="stat-card-label">進度</div><div className="stat-card-value">{stats.pct}%</div>
          </div>
        </div>

        {/* Meta info */}
        <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
          {p.owner && <div><span style={{ color: 'var(--text-muted)' }}>負責人：</span><strong>{p.owner}</strong></div>}
          {p.department && <div><span style={{ color: 'var(--text-muted)' }}>部門：</span>{p.department}</div>}
          {p.store && <div><span style={{ color: 'var(--text-muted)' }}>門市：</span>{p.store}</div>}
          {p.start_date && <div><span style={{ color: 'var(--text-muted)' }}>期間：</span>{p.start_date} ~ {p.end_date || '未定'}</div>}
          {p.budget && <div><span style={{ color: 'var(--text-muted)' }}>預算：</span>{fmt(p.budget)}</div>}
        </div>

        {/* Workflows list (same style as ActiveInstancesList) */}
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Workflow size={16} /> 流程（{pWorkflows.length}）
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

          return (
            <div key={w.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{w.template_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {w.started_by && `${w.started_by} · `}{w.started_at?.slice(0, 10)}
                      <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: wColor, background: `color-mix(in srgb, ${wColor} 15%, transparent)` }}>{w.status}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
                    <span>⬜ {wPending}</span>
                    <span style={{ color: 'var(--accent-cyan)' }}>🔄 {wInProgress}</span>
                    <span style={{ color: 'var(--accent-green)' }}>✅ {wDone}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-cyan)' }}>{wPct}%</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{wDone}/{wTotal}</div>
                    </div>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: `conic-gradient(var(--accent-cyan) ${wPct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{wPct}%</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tasks under workflow */}
              {wTasks.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                  {wTasks.map(t => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0 5px 28px', fontSize: 13 }}>
                      <CheckSquare size={14} color={t.status === '已完成' ? 'var(--accent-green)' : t.status === '進行中' ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
                      <span style={{ flex: 1, textDecoration: t.status === '已完成' ? 'line-through' : 'none', color: t.status === '已完成' ? 'var(--text-muted)' : 'inherit' }}>
                        {t.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.assignee || t.assigned_to || ''}</span>
                      {t.due_date && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.due_date}</span>}
                      <span style={{
                        padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        color: t.status === '已完成' ? 'var(--accent-green)' : t.status === '進行中' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                        background: t.status === '已完成' ? 'var(--accent-green-dim)' : t.status === '進行中' ? 'var(--accent-cyan-dim)' : 'var(--glass-light)',
                      }}>{t.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Comments */}
        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <MessageSquare size={16} /> 備註（{pComments.length}）
        </div>
        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input type="text" value={commentText} onChange={e => setCommentText(e.target.value)}
              placeholder="新增備註..." onKeyDown={e => e.key === 'Enter' && addComment(p.id)}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13 }} />
            <button className="btn btn-primary" onClick={() => addComment(p.id)}>送出</button>
          </div>
          {pComments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>尚無備註</div>
          ) : pComments.map(c => (
            <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
              <strong style={{ color: 'var(--accent-cyan)' }}>{c.author}</strong>
              <span style={{ marginLeft: 8 }}>{c.content}</span>
              <span style={{ marginLeft: 12, fontSize: 11, color: 'var(--text-muted)' }}>{c.created_at?.slice(0, 16).replace('T', ' ')}</span>
            </div>
          ))}
        </div>
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
          <button className="btn btn-primary" onClick={() => { setForm({ ...emptyForm, owner: profile?.name || '' }); setEditingId(null); setShowModal(true) }}>
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

      {/* Project list */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {tab === 'active' ? '目前沒有進行中的專案。點「新增專案」開始。' : '無資料'}
        </div>
      ) : filtered.map(p => {
        const stats = getStats(p.id)
        const sc = STATUS_MAP[p.status] || {}

        return (
          <div key={p.id} className="card" style={{ marginBottom: 12, cursor: 'pointer', transition: 'border-color 0.2s' }}
            onClick={() => setSelected(p)}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: sc.color, background: `color-mix(in srgb, ${sc.color} 15%, transparent)` }}>{p.status}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: PRIORITY_COLORS[p.priority] }}>{p.priority}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {p.owner || '未指派'} · {p.start_date || '未定'}{p.end_date && ` ~ ${p.end_date}`}
                    {stats.workflows > 0 && ` · ${stats.workflows} 流程`}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
                  <span>⬜ {stats.pending}</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>🔄 {stats.inProgress}</span>
                  <span style={{ color: 'var(--accent-green)' }}>✅ {stats.completed}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-cyan)' }}>{stats.pct}%</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stats.completed}/{stats.total}</div>
                  </div>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: `conic-gradient(var(--accent-cyan) ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{stats.pct}%</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={(e) => openEdit(p, e)}><Edit3 size={13} /></button>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={(e) => handleDelete(p.id, e)}><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {/* Modal */}
      {showModal && (
        <Modal title={editingId ? '編輯專案' : '新增專案'} onClose={() => setShowModal(false)} onSubmit={handleSubmit} submitLabel={editingId ? '更新' : '建立'}>
          <Field label="專案名稱 *">
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
              <select className="form-input" style={{ width: '100%' }} value={form.owner} onChange={e => set('owner', e.target.value)}>
                <option value="">請選擇</option>
                {employees.map(e => <option key={e.id} value={e.name}>{e.name}（{e.dept || e.position}）</option>)}
              </select>
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
        </Modal>
      )}
    </div>
  )
}
