import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Edit3, Rocket, Trash2, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import LoadingSpinner from '../../components/LoadingSpinner'
import DeployWizard from './components/DeployWizard'

const ALL_LABEL = '全部'

/**
 * TemplateLibrary — Enhanced SOP template library.
 *
 * Route: /process/sop  (replaces SOPTemplates in ProcessModule)
 *
 * Features:
 *   - Stats row (template count, total steps, deploy count)
 *   - Search input + category tab strip
 *   - Card grid: name, category badge, description, step preview (first 3), usage count
 *   - [編輯] → /process/sop/:id/edit (TemplateStudio)
 *   - [部署] → DeployWizard portal modal
 *   - [+ 新增範本] → /process/sop/new (TemplateStudio)
 */
export default function TemplateLibrary() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([])
  const [usageCounts, setUsageCounts] = useState({}) // templateName → number
  const [stores, setStores] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])

  const [activeCategory, setActiveCategory] = useState(ALL_LABEL)
  const [query, setQuery] = useState('')
  const [deployTarget, setDeployTarget] = useState(null) // template being deployed in wizard

  // ── Load all data on mount ──
  useEffect(() => {
    const fetchAll = async () => {
      const [tplRes, instRes, storeRes, empRes, deptRes] = await Promise.allSettled([
        supabase.from('sop_templates').select('*').order('category').then(r => r.data || []),
        supabase.from('workflow_instances').select('template_name').then(r => r.data || []),
        supabase.from('stores').select('id, name').order('name').then(r => r.data || []),
        supabase.from('employees')
          .select('id, name, department_id, position, is_manager')
          .eq('status', '在職').order('name')
          .then(r => r.data || []),
        supabase.from('departments').select('id, name').order('name').then(r => r.data || []),
      ])

      if (tplRes.status === 'fulfilled') setTemplates(tplRes.value)
      if (instRes.status === 'fulfilled') {
        const counts = {}
        for (const row of instRes.value) {
          if (row.template_name) counts[row.template_name] = (counts[row.template_name] || 0) + 1
        }
        setUsageCounts(counts)
      }
      if (storeRes.status === 'fulfilled') setStores(storeRes.value)
      if (empRes.status === 'fulfilled') setEmployees(empRes.value)
      if (deptRes.status === 'fulfilled') setDepartments(deptRes.value)
      setLoading(false)
    }
    fetchAll()
  }, [])

  // ── Derived ──
  const categories = useMemo(
    () => [...new Set(templates.map(t => t.category).filter(Boolean))].sort(),
    [templates],
  )

  const filtered = useMemo(() => {
    let list = templates
    if (activeCategory !== ALL_LABEL) list = list.filter(t => t.category === activeCategory)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(t =>
        t.name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q),
      )
    }
    return list
  }, [templates, activeCategory, query])

  // ── Delete ──
  const handleDelete = async (tpl) => {
    if (!(await confirm({ message: `確定刪除範本「${tpl.name}」？此操作無法復原。` }))) return
    try {
      const { error } = await supabase.from('sop_templates').delete().eq('id', tpl.id)
      if (error) throw error
      setTemplates(prev => prev.filter(t => t.id !== tpl.id))
      toast.success(`範本「${tpl.name}」已刪除`)
    } catch (err) {
      toast.error('刪除失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />

  const totalSteps = templates.reduce((s, t) => s + (t.steps?.length || 0), 0)
  const totalDeployed = Object.values(usageCounts).reduce((s, n) => s + n, 0)

  return (
    <div className="fade-in">

      {/* ── Page header ── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📑</span> SOP 範本庫</h2>
            <p>標準作業流程範本，一鍵部署到新分店</p>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/process/sop/new')}>
            <Plus size={14} /> 新增範本
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">範本數</div>
          <div className="stat-card-value">{templates.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總步驟數</div>
          <div className="stat-card-value">{totalSteps}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">已部署次數</div>
          <div className="stat-card-value">{totalDeployed}</div>
        </div>
      </div>

      {/* ── Search + category tabs ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Search size={14} style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-muted)', pointerEvents: 'none',
          }} />
          <input
            className="form-input"
            type="text"
            placeholder="搜尋範本..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 32, width: 200, fontSize: 13 }}
          />
        </div>

        {/* Category tab strip */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: 1, paddingBottom: 2 }}>
          {[ALL_LABEL, ...categories].map(cat => {
            const isActive = activeCategory === cat
            const count = cat === ALL_LABEL ? templates.length : templates.filter(t => t.category === cat).length
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  border: isActive ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                  background: isActive ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                  color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}
              >
                {cat}
                <span style={{ marginLeft: 5, opacity: 0.65, fontWeight: 400 }}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Card grid ── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
          {query ? `找不到符合「${query}」的範本` : '此分類暫無範本'}
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={() => navigate('/process/sop/new')}>
              <Plus size={14} /> 新增範本
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16,
        }}>
          {filtered.map(tpl => {
            const steps = tpl.steps || []
            const usage = usageCounts[tpl.name] || 0
            const previewSteps = steps.slice(0, 3)
            return (
              <div
                key={tpl.id}
                className="card"
                style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                {/* Card header */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                      {tpl.name}
                    </div>
                    <span className="badge badge-cyan" style={{ flexShrink: 0 }}>
                      {tpl.category}
                    </span>
                  </div>
                  {tpl.description && (
                    <div style={{
                      fontSize: 12, color: 'var(--text-muted)', marginTop: 5,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {tpl.description}
                    </div>
                  )}
                </div>

                {/* Step preview */}
                <div style={{ flex: 1 }}>
                  {previewSteps.map((step, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--bg-secondary)', color: 'var(--text-muted)',
                        fontSize: 10, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {i + 1}
                      </div>
                      <div style={{
                        fontSize: 12, color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {step.title}
                      </div>
                    </div>
                  ))}
                  {steps.length > 3 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 25 }}>
                      ＋ {steps.length - 3} 個步驟
                    </div>
                  )}
                </div>

                {/* Card footer: stats + action buttons */}
                <div style={{
                  paddingTop: 10,
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      📋 {steps.length} 步
                    </span>
                    {usage > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>
                        ✓ 部署 {usage} 次
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={() => navigate(`/process/sop/${tpl.id}/edit`)}
                    >
                      <Edit3 size={12} /> 編輯
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={() => setDeployTarget(tpl)}
                    >
                      <Rocket size={12} /> 部署
                    </button>
                    <button
                      onClick={() => handleDelete(tpl)}
                      title="刪除範本"
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', padding: '4px 5px', borderRadius: 5,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── DeployWizard portal ── */}
      {deployTarget && (
        <DeployWizard
          template={deployTarget}
          stores={stores}
          employees={employees}
          departments={departments}
          onClose={() => setDeployTarget(null)}
          onSuccess={result => {
            toast.success(`已為「${result.location}」建立 ${result.taskCount} 個任務`)
            setUsageCounts(prev => ({
              ...prev,
              [deployTarget.name]: (prev[deployTarget.name] || 0) + 1,
            }))
          }}
        />
      )}
    </div>
  )
}
