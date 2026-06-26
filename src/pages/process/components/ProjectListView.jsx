import { useState } from 'react'
import { Plus, ChevronRight, FolderOpen, Rocket, CheckSquare, Edit3, Trash2, MoreVertical, Search, Download } from 'lucide-react'
import { exportToCsv, fmtDate } from '../../../lib/exportCsv'
import { todayTW } from '../../../lib/datetime'
import { supabase } from '../../../lib/supabase'
import ProjectDeployModal from './ProjectDeployModal'
import ProjectFormModal from './ProjectFormModal'
import ProjectTemplateModal from './ProjectTemplateModal'

const STATUS_MAP = {
  '規劃中': { color: 'var(--accent-blue)',   bg: 'var(--accent-blue-dim)' },
  '進行中': { color: 'var(--accent-cyan)',   bg: 'var(--accent-cyan-dim)' },
  '已完成': { color: 'var(--accent-green)',  bg: 'var(--accent-green-dim)' },
  '暫停':   { color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
  '已取消': { color: 'var(--accent-red)',    bg: 'var(--accent-red-dim)' },
}

const PRIORITY_COLORS = { '高': 'var(--accent-red)', '中': 'var(--accent-yellow)', '低': 'var(--accent-green)' }

export default function ProjectListView({
  // data
  projects,
  templates,
  employees,
  stores,
  approvalChains,
  departments = [],
  filtered,
  tab,
  setTab,
  activeCount,
  completedCount,
  archivedCount,
  search,
  setSearch,
  filterOwner,
  setFilterOwner,
  filterStore,
  setFilterStore,
  // stats
  getStats,
  // project actions
  setSelected,
  openEdit,
  handleDelete,
  handleMoveToTop,
  projMenuId,
  setProjMenuId,
  // form modal
  showModal,
  setShowModal,
  editingId,
  setEditingId,
  form,
  setForm,
  handleSubmit,
  freeInstances,
  setFreeInstances,
  pendingWfAttach,
  setPendingWfAttach,
  pendingWfCreate,
  setPendingWfCreate,
  pendingTasks,
  setPendingTasks,
  resetNewProjectState,
  profile,
  // deploy modal
  showDeployModal,
  setShowDeployModal,
  deployForm,
  setDeployForm,
  deploying,
  handleDeploy,
  openDeploy,
  deployTpl,
  // template edit/delete
  onEditTemplate,
  onDeleteTemplate,
  tplSaving = false,
}) {
  const [editingTpl, setEditingTpl] = useState(null)

  const handleExport = () => {
    exportToCsv(`projects_${todayTW()}.csv`, filtered, [
      { label: 'ID',     value: r => `PJ-${r.id}` },
      { label: '專案名稱', value: 'name' },
      { label: '狀態',   value: 'status' },
      { label: '優先',   value: 'priority' },
      { label: '負責人', value: 'owner' },
      { label: '部門',   value: 'department' },
      { label: '門市',   value: 'store' },
      { label: '開始日', value: r => fmtDate(r.start_date) },
      { label: '結束日', value: r => fmtDate(r.end_date) },
      { label: '預算',   value: r => r.budget ? String(r.budget) : '' },
      { label: '說明',   value: 'description' },
    ])
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📁</span> 專案管理</h2>
            <p>Project → Workflow → Task 三層架構</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleExport} title="匯出 CSV"
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Download size={14} /> 匯出
            </button>
            <button className="btn btn-primary" onClick={async () => {
              const { data } = await supabase.from('workflow_instances').select('id, template_name, status, started_by, started_at').is('project_id', null).order('started_at', { ascending: false })
              setFreeInstances(data || [])
              resetNewProjectState()
              setForm(f => ({ ...f, owner: profile?.name || '' }))
              setEditingId(null)
              setShowModal(true)
            }}>
              <Plus size={14} /> 新增專案
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ minWidth: 200 }}>
          <Search className="search-icon" />
          <input type="text" placeholder="搜尋專案..." className="form-input" style={{ paddingLeft: 38, width: '100%' }} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          <FolderOpen size={14} /> 負責人
          <select className="form-input" value={filterOwner} onChange={e => setFilterOwner(e.target.value)}
            style={{ fontSize: 13, minWidth: 120 }}>
            <option value="">全部人員</option>
            {[...new Set(projects.map(p => p.owner).filter(Boolean))].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          🏪 門市
          <select className="form-input" value={filterStore} onChange={e => setFilterStore(e.target.value)}
            style={{ fontSize: 13, minWidth: 120 }}>
            <option value="">全部門市</option>
            {[...new Set(projects.map(p => p.store).filter(Boolean))].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {[
          { key: 'active',     label: `進行中專案 (${activeCount})`,    color: 'var(--accent-cyan)' },
          { key: 'templates',  label: `專案模板 (${templates.length})`, color: 'var(--accent-purple)' },
          { key: 'completed',  label: `已完成 (${completedCount})`,     color: 'var(--accent-green)' },
          { key: 'archived',   label: `封存 (${archivedCount})`,        color: 'var(--accent-red)' },
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
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-secondary"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                      title="編輯模板"
                      onClick={() => setEditingTpl(tpl)}>
                      <Edit3 size={13} /> 編輯
                    </button>
                    <button className="btn btn-secondary"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--accent-red)' }}
                      title="刪除模板"
                      onClick={() => onDeleteTemplate(tpl)}>
                      <Trash2 size={13} />
                    </button>
                    <button className="btn btn-primary"
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={() => openDeploy(tpl)}>
                      <Rocket size={14} /> 部署
                    </button>
                  </div>
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

      {/* Template Edit Modal */}
      {editingTpl && (
        <ProjectTemplateModal
          tpl={editingTpl}
          saving={tplSaving}
          onClose={() => setEditingTpl(null)}
          onSubmit={async (payload) => {
            await onEditTemplate(editingTpl.id, payload)
            setEditingTpl(null)
          }}
        />
      )}

      {/* Deploy Modal */}
      {showDeployModal && (
        <ProjectDeployModal
          deployTpl={deployTpl}
          deployForm={deployForm}
          setDeployForm={setDeployForm}
          deploying={deploying}
          employees={employees}
          stores={stores}
          onClose={() => setShowDeployModal(false)}
          onSubmit={handleDeploy}
        />
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
          <div key={p.id} className="card" style={{ marginBottom: 10, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.2s', overflow: projMenuId === p.id ? 'visible' : 'hidden', position: 'relative', zIndex: projMenuId === p.id ? 10 : 'auto' }}
            onClick={() => setSelected(p)}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>pj-{p.id}</span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</span>
                    <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, color: sc.color, background: sc.bg }}>{p.status}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: PRIORITY_COLORS[p.priority] }}>{p.priority}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {p.owner || '未指派'} · {p.start_date || '未定'}{p.end_date && ` ~ ${p.end_date}`}
                    {p.department && ` · ${p.department}`}
                    {p.store && ` · ${p.store}`}
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
                <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-secondary" style={{ padding: '3px 6px' }} onClick={() => setProjMenuId(projMenuId === p.id ? null : p.id)}>
                    <MoreVertical size={13} />
                  </button>
                  {projMenuId === p.id && (
                    <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', zIndex: 50, minWidth: 130 }}>
                      <button
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', borderRadius: '8px 8px 0 0' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        onClick={(e) => { setProjMenuId(null); openEdit(p, e) }}
                      ><Edit3 size={13} /> 編輯專案</button>
                      <button
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', color: 'var(--accent-red)', fontSize: 13, cursor: 'pointer', borderRadius: '0 0 8px 8px' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        onClick={(e) => { setProjMenuId(null); handleDelete(p.id, e) }}
                      ><Trash2 size={13} /> 刪除專案</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {/* Form Modal */}
      {showModal && (
        <ProjectFormModal
          editingId={editingId}
          form={form}
          setForm={setForm}
          onClose={() => { setShowModal(false); setEditingId(null); resetNewProjectState() }}
          onSubmit={handleSubmit}
          employees={employees}
          stores={stores}
          templates={templates}
          approvalChains={approvalChains}
          departments={departments}
          freeInstances={freeInstances}
          pendingWfAttach={pendingWfAttach}
          setPendingWfAttach={setPendingWfAttach}
          pendingWfCreate={pendingWfCreate}
          setPendingWfCreate={setPendingWfCreate}
          pendingTasks={pendingTasks}
          setPendingTasks={setPendingTasks}
        />
      )}
    </div>
  )
}
