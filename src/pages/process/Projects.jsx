import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import Modal, { Field } from '../../components/Modal'
import {
  Plus, X, ChevronRight, ChevronDown, Check, Clock, Pause, Ban, Play,
  MessageSquare, Workflow, CheckSquare, Edit3, Trash2, FolderOpen, Filter, Rocket, Copy,
  Users, Settings, Columns
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getEmployees, getProjectSections, createProjectSection, updateProjectSection, deleteProjectSection } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import { notifyTaskAssignee } from '../../lib/lineNotify'
import LoadingSpinner from '../../components/LoadingSpinner'
import ProjectMembers from '../../components/tasks/ProjectMembers'
import { ProjectCustomFieldsAdmin } from '../../components/tasks/CustomFieldsEditor'

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
  const [templates, setTemplates] = useState([])
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployTpl, setDeployTpl] = useState(null)
  const [deployForm, setDeployForm] = useState({ name: '', store: '', owner: '' })
  const [deploying, setDeploying] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [tab, setTab] = useState('active')
  const [detailTab, setDetailTab] = useState('overview')
  const [filterOwner, setFilterOwner] = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [sections, setSections] = useState([])
  const [newSection, setNewSection] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [pRes, wRes, tRes, eRes, sRes, cRes, tplRes] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('workflow_instances').select('*').not('project_id', 'is', null).order('sort_order'),
      supabase.from('tasks').select('*').order('step_order'),
      getEmployees(),
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('project_comments').select('*').order('created_at', { ascending: false }),
      supabase.from('project_templates').select('*').order('id'),
    ])
    setProjects(pRes.data || [])
    setWorkflows(wRes.data || [])
    setTasks(tRes.data || [])
    setEmployees((eRes.data || []).filter(e => e.status === '在職'))
    setStores(sRes.data || [])
    setComments(cRes.data || [])
    setTemplates(tplRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!selected) return
    getProjectSections(selected.id).then(({ data }) => setSections(data || []))
    setDetailTab('overview')
  }, [selected?.id])

  const addSection = async () => {
    if (!newSection.trim()) return
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.sort_order || 0), 0)
    const { data } = await createProjectSection({
      project_id: selected.id, name: newSection.trim(),
      sort_order: maxOrder + 1, color: '#64748b',
    })
    if (data) setSections(prev => [...prev, data])
    setNewSection('')
  }

  const removeSection = async (id) => {
    if (!confirm('刪除此欄位？任務不會刪除但會脫離欄位。')) return
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
      if (data) {
        setProjects(prev => prev.map(p => p.id === editingId ? data : p))
        if (selected?.id === editingId) setSelected(data)
      }
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

  // Deploy template → create project + workflows + tasks
  const handleDeploy = async () => {
    if (!deployTpl || !deployForm.name) return
    setDeploying(true)
    try {
      const tpl = deployTpl
      const today = new Date().toISOString().slice(0, 10)
      const endDate = tpl.estimated_days ? new Date(Date.now() + tpl.estimated_days * 86400000).toISOString().slice(0, 10) : null

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
        organization_id: 1,
      }).select().single()

      if (!project) throw new Error('建立專案失敗')

      // 2. Create workflows + tasks
      const tplWorkflows = Array.isArray(tpl.workflows) ? tpl.workflows : JSON.parse(tpl.workflows || '[]')
      for (let i = 0; i < tplWorkflows.length; i++) {
        const wf = tplWorkflows[i]
        const { data: instance } = await supabase.from('workflow_instances').insert({
          template_name: wf.name,
          status: '進行中',
          started_by: deployForm.owner || profile?.name || '',
          store: deployForm.store || null,
          project_id: project.id,
          sort_order: i + 1,
          started_at: new Date().toISOString(),
        }).select().single()

        if (instance && wf.tasks?.length > 0) {
          const taskRows = wf.tasks.map((t, j) => ({
            title: t.title,
            workflow_instance_id: instance.id,
            status: '未開始',
            role: t.role || null,
            step_order: j + 1,
            priority: t.priority || '中',
            due_date: endDate,
          }))
          await supabase.from('tasks').insert(taskRows)
        }
      }

      // LINE notify project owner
      if (deployForm.owner) {
        notifyTaskAssignee(deployForm.owner, `專案「${deployForm.name}」已建立`, '專案部署', null).catch(() => {})
      }

      setShowDeployModal(false)
      setDeployTpl(null)
      load()
    } catch (err) {
      alert('部署失敗：' + err.message)
    }
    setDeploying(false)
  }

  const openDeploy = (tpl) => {
    setDeployTpl(tpl)
    setDeployForm({ name: tpl.name, store: '', owner: profile?.name || '' })
    setShowDeployModal(true)
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

        {/* Stats + Progress */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 1.5fr', gap: 10, marginBottom: 16 }}>
          {[
            { label: '流程', value: stats.workflows, color: 'var(--accent-cyan)' },
            { label: '總任務', value: stats.total, color: 'var(--accent-blue)' },
            { label: '已完成', value: stats.completed, color: 'var(--accent-green)' },
            { label: '進行中', value: stats.inProgress, color: 'var(--accent-orange)' },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
          <div className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: `conic-gradient(var(--accent-cyan) ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>{stats.pct}%</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>整體進度</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-cyan)' }}>{stats.pct}%</div>
              <div style={{ height: 3, borderRadius: 2, background: 'var(--border-medium)', marginTop: 4, width: 80 }}>
                <div style={{ height: '100%', borderRadius: 2, width: `${stats.pct}%`, background: 'var(--accent-cyan)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Meta info */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, padding: '10px 14px', background: 'var(--glass-light)', borderRadius: 10 }}>
          {p.owner && <div><span style={{ color: 'var(--text-muted)' }}>負責人</span> <strong style={{ color: 'var(--text-primary)' }}>{p.owner}</strong></div>}
          {p.department && <div><span style={{ color: 'var(--text-muted)' }}>部門</span> {p.department}</div>}
          {p.store && <div><span style={{ color: 'var(--text-muted)' }}>門市</span> {p.store}</div>}
          {p.start_date && <div><span style={{ color: 'var(--text-muted)' }}>期間</span> {p.start_date} ~ {p.end_date || '未定'}</div>}
          {p.budget && <div><span style={{ color: 'var(--text-muted)' }}>預算</span> {fmt(p.budget)}</div>}
        </div>

        {/* Detail tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 16 }}>
          {[
            { k: 'overview', label: '總覽',      icon: FolderOpen },
            { k: 'members',  label: '成員',      icon: Users },
            { k: 'sections', label: '欄位',      icon: Columns },
            { k: 'fields',   label: '自訂欄位',  icon: Settings },
          ].map(t => {
            const Icon = t.icon
            const active = detailTab === t.k
            return (
              <button key={t.k} onClick={() => setDetailTab(t.k)} style={{
                padding: '8px 14px', border: 'none', background: 'transparent',
                borderBottom: active ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                color: active ? 'var(--accent-cyan)' : 'var(--text-muted)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <Icon size={13} />{t.label}
              </button>
            )
          })}
        </div>

        {detailTab === 'members' && (
          <ProjectMembers projectId={p.id} employees={employees} currentUser={profile} />
        )}

        {detailTab === 'fields' && (
          <ProjectCustomFieldsAdmin projectId={p.id} />
        )}

        {detailTab === 'sections' && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <Columns size={14} /> 看板欄位 ({sections.length})
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input
                className="form-input" style={{ flex: 1, fontSize: 13 }}
                placeholder="新欄位名稱，例：審核中"
                value={newSection} onChange={e => setNewSection(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSection()}
              />
              <button className="btn btn-primary" onClick={addSection} disabled={!newSection.trim()}>
                <Plus size={13} /> 新增
              </button>
            </div>
            {sections.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
                尚無自訂欄位。看板會使用預設狀態欄位。
              </div>
            ) : sections.map(s => (
              <div key={s.id} className="card" style={{ padding: '8px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: s.color }} />
                <input
                  defaultValue={s.name}
                  onBlur={e => e.target.value !== s.name && renameSection(s.id, e.target.value)}
                  style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, fontWeight: 600, outline: 'none' }}
                />
                <button
                  className="btn btn-secondary"
                  style={{ padding: '3px 7px', color: 'var(--accent-red)' }}
                  onClick={() => removeSection(s.id)}
                ><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}

        {detailTab === 'overview' && <>

        {/* Workflows */}
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
          <Workflow size={15} /> 流程（{pWorkflows.length}）
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
            <div key={w.id} className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{w.template_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {w.started_by && `${w.started_by} · `}{w.started_at?.slice(0, 10)}
                      <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, color: wColor, background: `color-mix(in srgb, ${wColor} 15%, transparent)` }}>{w.status}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ display: 'flex', gap: 10, fontSize: 12, whiteSpace: 'nowrap' }}>
                    <span>⬜ {wPending}</span>
                    <span style={{ color: 'var(--accent-cyan)' }}>🔄 {wInProgress}</span>
                    <span style={{ color: 'var(--accent-green)' }}>✅ {wDone}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: wPct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)', lineHeight: 1 }}>{wPct}%</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{wDone}/{wTotal}</div>
                    </div>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: `conic-gradient(${wPct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)'} ${wPct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{wPct}%</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tasks */}
              {wTasks.length > 0 && (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
                  {wTasks.map(t => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 6px 24px', fontSize: 13 }}>
                      <CheckSquare size={13} style={{ flexShrink: 0 }} color={t.status === '已完成' ? 'var(--accent-green)' : t.status === '進行中' ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
                      <span style={{ flex: 1, textDecoration: t.status === '已完成' ? 'line-through' : 'none', color: t.status === '已完成' ? 'var(--text-muted)' : 'inherit', lineHeight: 1.4 }}>
                        {t.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t.assignee || t.assigned_to || ''}</span>
                      {t.due_date && <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t.due_date}</span>}
                      <span style={{
                        padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
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
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
          <MessageSquare size={15} /> 備註（{pComments.length}）
        </div>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, maxWidth: 500 }}>
            <input type="text" value={commentText} onChange={e => setCommentText(e.target.value)}
              placeholder="新增備註..." onKeyDown={e => e.key === 'Enter' && addComment(p.id)}
              style={{ flex: 1, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13 }} />
            <button className="btn btn-primary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={() => addComment(p.id)}>送出</button>
          </div>
          {pComments.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>尚無備註</div>
          ) : pComments.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
              <strong style={{ color: 'var(--accent-cyan)', fontSize: 12, flexShrink: 0 }}>{c.author}</strong>
              <span style={{ flex: 1 }}>{c.content}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{c.created_at?.slice(0, 16).replace('T', ' ')}</span>
            </div>
          ))}
        </div>

        </>}

        {/* Modal in detail view */}
        {showModal && (
          <Modal title={editingId ? '編輯專案' : '新增專案'} onClose={() => setShowModal(false)} onSubmit={handleSubmit} submitLabel={editingId ? '更新' : '建立'}>
            <Field label="專案名稱 *">
              <input className="form-input" style={{ width: '100%' }} value={form.name} onChange={e => set('name', e.target.value)} />
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
              <Field label="開始日期"><input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} /></Field>
              <Field label="結束日期"><input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} /></Field>
            </div>
            <Field label="說明">
              <textarea className="form-input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} />
            </Field>
          </Modal>
        )}
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
          { key: 'templates', label: `專案模板 (${templates.length})`, color: 'var(--accent-purple)' },
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

      {/* Templates tab */}
      {tab === 'templates' && (
        <div>
          {templates.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無專案模板</div>
          ) : templates.map(tpl => {
            const tplWorkflows = Array.isArray(tpl.workflows) ? tpl.workflows : JSON.parse(tpl.workflows || '[]')
            const totalTasks = tplWorkflows.reduce((s, w) => s + (w.tasks?.length || 0), 0)
            return (
              <div key={tpl.id} className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-purple-dim)', border: '1px solid var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📋</div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{tpl.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {tpl.category} · {tplWorkflows.length} 流程 · {totalTasks} 任務
                        {tpl.estimated_days && ` · 預估 ${tpl.estimated_days} 天`}
                        {tpl.estimated_budget && ` · 預算 NT$ ${Number(tpl.estimated_budget).toLocaleString()}`}
                      </div>
                    </div>
                  </div>
                  <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => openDeploy(tpl)}>
                    <Rocket size={14} /> 部署
                  </button>
                </div>
                {tpl.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>{tpl.description}</div>}
                {/* Workflow preview */}
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {tplWorkflows.map((w, i) => (
                    <div key={i} style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', fontSize: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>{w.name}</div>
                      {(w.tasks || []).map((t, j) => (
                        <div key={j} style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CheckSquare size={10} /> {t.title}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Deploy Modal */}
      {showDeployModal && deployTpl && (
        <Modal title={`部署專案 — ${deployTpl.name}`} onClose={() => setShowDeployModal(false)} onSubmit={handleDeploy} submitLabel={deploying ? '部署中...' : '🚀 部署'}>
          <Field label="專案名稱 *">
            <input className="form-input" style={{ width: '100%' }} value={deployForm.name} onChange={e => setDeployForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責人">
              <select className="form-input" style={{ width: '100%' }} value={deployForm.owner} onChange={e => setDeployForm(f => ({ ...f, owner: e.target.value }))}>
                <option value="">請選擇</option>
                {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="門市">
              <select className="form-input" style={{ width: '100%' }} value={deployForm.store} onChange={e => setDeployForm(f => ({ ...f, store: e.target.value }))}>
                <option value="">不指定</option>
                {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ background: 'var(--glass-light)', borderRadius: 8, padding: 12, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>將自動建立：</div>
            {(Array.isArray(deployTpl.workflows) ? deployTpl.workflows : JSON.parse(deployTpl.workflows || '[]')).map((w, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--accent-cyan)' }}>📂 {w.name}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({w.tasks?.length || 0} 任務)</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Project list */}
      {tab !== 'templates' && filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {tab === 'active' ? '目前沒有進行中的專案。點「新增專案」或從「專案模板」部署。' : '無資料'}
        </div>
      )}
      {tab !== 'templates' && filtered.map(p => {
        const stats = getStats(p.id)
        const sc = STATUS_MAP[p.status] || {}

        return (
          <div key={p.id} className="card" style={{ marginBottom: 10, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.2s' }}
            onClick={() => setSelected(p)}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</span>
                    <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, color: sc.color, background: `color-mix(in srgb, ${sc.color} 15%, transparent)` }}>{p.status}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: PRIORITY_COLORS[p.priority] }}>{p.priority}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {p.owner || '未指派'} · {p.start_date || '未定'}{p.end_date && ` ~ ${p.end_date}`}
                    {stats.workflows > 0 && ` · ${stats.workflows} 流程`}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ display: 'flex', gap: 10, fontSize: 12, whiteSpace: 'nowrap' }}>
                  <span>⬜ {stats.pending}</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>🔄 {stats.inProgress}</span>
                  <span style={{ color: 'var(--accent-green)' }}>✅ {stats.completed}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent-cyan)', lineHeight: 1 }}>{stats.pct}%</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stats.completed}/{stats.total}</div>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: `conic-gradient(var(--accent-cyan) ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{stats.pct}%</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-secondary" style={{ padding: '3px 7px' }} onClick={(e) => openEdit(p, e)}><Edit3 size={12} /></button>
                  <button className="btn btn-secondary" style={{ padding: '3px 7px', color: 'var(--accent-red)' }} onClick={(e) => handleDelete(p.id, e)}><Trash2 size={12} /></button>
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
