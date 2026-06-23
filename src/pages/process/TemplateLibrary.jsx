import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Edit3, Rocket, Trash2, Search,
  Copy, Download, Upload, Filter, SortAsc, Lock, BarChart2, Play,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import LoadingSpinner from '../../components/LoadingSpinner'
import DeployWizard from './components/DeployWizard'
import TemplatePreviewModal from './components/TemplatePreviewModal'
import TemplateAnalyticsModal from './components/TemplateAnalyticsModal'
import ShadowDeployModal from './components/ShadowDeployModal'

const ALL_LABEL = '全部'

const SORT_OPTIONS = [
  { value: 'usage',   label: '使用次數' },
  { value: 'updated', label: '最近更新' },
  { value: 'name',    label: '名稱' },
  { value: 'steps',   label: '步驟數' },
]

const STATUS_BADGE = {
  draft:    { label: '草稿',   color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  archived: { label: '已封存', color: 'var(--text-muted)',    dim: 'var(--bg-secondary)' },
  // published: no badge shown
}

/**
 * Returns the fill color for a step dot based on which features the step has.
 * Priority: checklist > approval > forms > trigger > plain
 */
function stepDotColor(step) {
  if (step?.checklist_id)                          return 'var(--accent-green)'
  if (step?.approval_chain_id)                     return 'var(--accent-purple)'
  if (step?.required_forms?.length > 0)            return 'var(--accent-cyan)'
  if (step?.trigger_template_id)                   return 'var(--accent-orange)'
  return 'var(--border-medium)'
}

/**
 * Dot-row for step type visualization (up to 5 dots, then "+N更多" label).
 */
function StepDots({ steps }) {
  if (!steps || steps.length === 0) return null
  const visible = steps.slice(0, 5)
  const extra = steps.length - 5
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7 }}>
      {visible.map((step, i) => (
        <div
          key={i}
          title={step.title || `步驟 ${i + 1}`}
          style={{
            width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
            background: stepDotColor(step),
          }}
        />
      ))}
      {extra > 0 && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>
          +{extra}更多
        </span>
      )}
    </div>
  )
}

function TriToggle({ label, value, onChange }) {
  const opts = [
    { v: 'all', l: '全部' },
    { v: 'yes', l: '有' },
    { v: 'no',  l: '無' },
  ]
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {opts.map(o => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            style={{
              padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              cursor: 'pointer',
              border: value === o.v ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
              background: value === o.v ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
              color: value === o.v ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * TemplateLibrary — Enhanced SOP template library.
 *
 * Route: /process/sop  (replaces SOPTemplates in ProcessModule)
 *
 * Features:
 *   - Stats row (template count, total steps, deploy count)
 *   - Search input + sort dropdown + filter panel toggle + export/import toolbar
 *   - Collapsible filter panel (left sidebar): approval chain / forms / created_by
 *   - Category tab strip + draft/archived toggle
 *   - Card grid: name, category badge, status badge, lock icon (published), description,
 *     colored step-type dot row + text step preview, tag pills, usage count
 *   - [預覽] → TemplatePreviewModal
 *   - [編輯] → /process/sop/:id/edit (TemplateStudio)
 *   - [部署] → DeployWizard portal modal
 *   - [複製] icon button → duplicate as draft
 *   - [+ 新增範本] → /process/sop/new (TemplateStudio)
 *   - Export filtered list as JSON
 *   - Import JSON file of templates (skip duplicates by name)
 */
export default function TemplateLibrary() {
  const navigate = useNavigate()
  const importInputRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([])
  const [usageCounts, setUsageCounts] = useState({}) // templateName → number
  const [stores, setStores] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])

  const [listTemplates, setListTemplates] = useState([])
  const [formTemplates, setFormTemplates] = useState([])
  const [checklists, setChecklists] = useState([])
  const [approvalChains, setApprovalChains] = useState([])

  const [activeType, setActiveType] = useState('workflow')
  const [activeCategory, setActiveCategory] = useState(ALL_LABEL)
  const switchType = (t) => { setActiveType(t); setActiveCategory(ALL_LABEL) }
  const [query, setQuery] = useState('')
  const [deployTarget, setDeployTarget] = useState(null) // template being deployed in wizard

  // New state
  const [previewTarget, setPreviewTarget] = useState(null)    // template for preview modal
  const [analyticsTarget, setAnalyticsTarget] = useState(null) // template for analytics modal
  const [shadowTarget, setShadowTarget] = useState(null)       // template for shadow/dry-run modal
  const [sortBy, setSortBy] = useState('usage')             // 'usage'|'updated'|'name'|'steps'
  const [showDraftArchived, setShowDraftArchived] = useState(false)

  // ── Filter panel state ──
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [filterApproval, setFilterApproval] = useState('all')   // 'all' | 'yes' | 'no'
  const [filterForms, setFilterForms] = useState('all')          // 'all' | 'yes' | 'no'
  const [filterCreatedBy, setFilterCreatedBy] = useState('')     // free text

  // ── Load all data on mount ──
  useEffect(() => {
    const fetchAll = async () => {
      const [tplRes, instRes, storeRes, empRes, deptRes, listRes, formRes, clRes, acRes] = await Promise.allSettled([
        supabase.from('sop_templates').select('*').order('category').then(r => r.data || []),
        supabase.from('workflow_instances').select('template_name').then(r => r.data || []),
        supabase.from('stores').select('id, name').order('name').then(r => r.data || []),
        supabase.from('employees')
          .select('id, name, department_id, position, is_manager')
          .eq('status', '在職').order('name')
          .then(r => r.data || []),
        supabase.from('departments').select('id, name').order('name').then(r => r.data || []),
        supabase.from('list_templates').select('*').order('name').then(r => r.data || []),
        supabase.from('form_templates').select('*').order('name').then(r => r.data || []),
        supabase.from('checklists').select('id, name, items:checklist_items(count)').then(r => r.data || []),
        supabase.from('approval_chains').select('id, name').order('name').then(r => r.data || []),
      ])

      if (tplRes.status === 'fulfilled') setTemplates(tplRes.value)
      if (listRes.status === 'fulfilled') setListTemplates(listRes.value)
      if (formRes.status === 'fulfilled') setFormTemplates(formRes.value)
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
      if (clRes.status === 'fulfilled') setChecklists(clRes.value.map(cl => ({ ...cl, items: cl.items?.[0]?.count ?? 0 })))
      if (acRes.status === 'fulfilled') setApprovalChains(acRes.value)
      setLoading(false)
    }
    fetchAll()
  }, [])

  // ── Derived ──
  const byType = useMemo(() => {
    if (activeType === 'list') return listTemplates
    if (activeType === 'form') return formTemplates
    return templates.filter(t => (t.type || 'workflow') === activeType)
  }, [templates, listTemplates, formTemplates, activeType])

  const categories = useMemo(
    () => [...new Set(byType.map(t => t.category).filter(Boolean))].sort(),
    [byType],
  )

  const filtered = useMemo(() => {
    let list = byType

    // Status filter: default shows published + null/undefined; toggle adds draft + archived
    if (!showDraftArchived) {
      list = list.filter(t => !t.status || t.status === 'published')
    }

    if (activeCategory !== ALL_LABEL) list = list.filter(t => t.category === activeCategory)

    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(t =>
        t.name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(q)),
      )
    }

    // ── Filter panel filters ──
    if (filterApproval !== 'all') {
      list = list.filter(t => {
        const hasApproval = (t.steps || []).some(s => s?.approval_chain_id)
        return filterApproval === 'yes' ? hasApproval : !hasApproval
      })
    }

    if (filterForms !== 'all') {
      list = list.filter(t => {
        const hasForms = (t.steps || []).some(s => s?.required_forms?.length > 0)
        return filterForms === 'yes' ? hasForms : !hasForms
      })
    }

    if (filterCreatedBy.trim()) {
      const cb = filterCreatedBy.trim().toLowerCase()
      list = list.filter(t =>
        t.created_by?.toLowerCase().includes(cb),
      )
    }

    // Sort
    list = [...list].sort((a, b) => {
      if (sortBy === 'usage') {
        return (usageCounts[b.name] || 0) - (usageCounts[a.name] || 0)
      }
      if (sortBy === 'updated') {
        return (
          new Date(b.updated_at || b.created_at || 0) -
          new Date(a.updated_at || a.created_at || 0)
        )
      }
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '', 'zh-TW')
      }
      if (sortBy === 'steps') {
        return (b.steps?.length || 0) - (a.steps?.length || 0)
      }
      return 0
    })

    return list
  }, [byType, activeCategory, query, sortBy, showDraftArchived, usageCounts,
      filterApproval, filterForms, filterCreatedBy])

  const hasActiveFilters =
    filterApproval !== 'all' || filterForms !== 'all' || filterCreatedBy.trim() !== ''

  const clearFilters = () => {
    setFilterApproval('all')
    setFilterForms('all')
    setFilterCreatedBy('')
  }

  // ── Delete ──
  const handleDelete = async (tpl) => {
    if (!(await confirm({ message: `確定刪除範本「${tpl.name}」？此操作無法復原。` }))) return
    try {
      const table = activeType === 'list' ? 'list_templates'
                  : activeType === 'form' ? 'form_templates'
                  : 'sop_templates'
      const { error } = await supabase.from(table).delete().eq('id', tpl.id)
      if (error) throw error
      if (activeType === 'list') setListTemplates(prev => prev.filter(t => t.id !== tpl.id))
      else if (activeType === 'form') setFormTemplates(prev => prev.filter(t => t.id !== tpl.id))
      else setTemplates(prev => prev.filter(t => t.id !== tpl.id))
      toast.success(`範本「${tpl.name}」已刪除`)
    } catch (err) {
      toast.error('刪除失敗：' + (err.message || '未知錯誤'))
    }
  }

  // ── Duplicate ──
  const handleDuplicate = async (tpl) => {
    try {
      // eslint-disable-next-line no-unused-vars
      const { id, created_at, updated_at, ...rest } = tpl
      const newTpl = { ...rest, name: tpl.name + ' (副本)', status: 'draft' }
      const table = activeType === 'list' ? 'list_templates'
                  : activeType === 'form' ? 'form_templates'
                  : 'sop_templates'
      const { data, error } = await supabase
        .from(table)
        .insert(newTpl)
        .select()
        .single()
      if (error) throw error
      if (activeType === 'list') setListTemplates(prev => [...prev, data])
      else if (activeType === 'form') setFormTemplates(prev => [...prev, data])
      else setTemplates(prev => [...prev, data])
      toast.success(`已複製範本「${tpl.name}」為草稿`)
    } catch (err) {
      toast.error('複製失敗：' + (err.message || '未知錯誤'))
    }
  }

  // ── Export filtered list as JSON ──
  const handleExport = () => {
    const blob = new Blob(
      [JSON.stringify(filtered, null, 2)],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sop-templates-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已匯出 ${filtered.length} 筆範本`)
  }

  // ── Import JSON ──
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset so same file can be re-selected
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) {
        toast.error('匯入失敗：檔案必須為範本陣列 (JSON array)')
        return
      }
      const existingNames = new Set(templates.map(t => t.name))
      let skipped = 0
      const toInsert = []
      for (const item of parsed) {
        if (!item.name) continue
        if (existingNames.has(item.name)) { skipped++; continue }
        // eslint-disable-next-line no-unused-vars
        const { id, created_at, updated_at, ...rest } = item
        toInsert.push(rest)
      }
      if (toInsert.length === 0) {
        toast.error(`所有範本名稱已存在，略過 ${skipped} 筆`)
        return
      }
      const { data, error } = await supabase
        .from('sop_templates')
        .insert(toInsert)
        .select()
      if (error) throw error
      setTemplates(prev => [...prev, ...(data || [])])
      toast.success(
        `匯入成功：新增 ${toInsert.length} 筆${skipped ? `，略過重複 ${skipped} 筆` : ''}`,
      )
    } catch (err) {
      toast.error('匯入失敗：' + (err.message || '無法解析檔案'))
    }
  }

  if (loading) return <LoadingSpinner />

  const totalSteps = templates.reduce((s, t) => s + (t.steps?.length || 0), 0)
  const totalDeployed = Object.values(usageCounts).reduce((s, n) => s + n, 0)
  const workflowCount = templates.filter(t => (t.type || 'workflow') === 'workflow').length
  const projectCount = templates.filter(t => t.type === 'project').length
  const listCount = listTemplates.length
  const formCount = formTemplates.length

  return (
    <div className="fade-in">

      {/* ── Page header ── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📑</span> SOP 範本庫</h2>
            <p>標準作業流程範本，一鍵部署到新分店</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Export */}
            <button
              className="btn btn-secondary"
              onClick={handleExport}
              title="匯出目前篩選結果為 JSON"
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}
            >
              <Download size={14} /> 匯出
            </button>
            {/* Import trigger */}
            <button
              className="btn btn-secondary"
              onClick={() => importInputRef.current?.click()}
              title="從 JSON 檔案匯入範本"
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}
            >
              <Upload size={14} /> 匯入
            </button>
            {/* Hidden file input */}
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
            {activeType === 'workflow' && (
              <button className="btn btn-primary" onClick={() => navigate('/process/sop/new')}>
                <Plus size={14} /> 新增流程範本
              </button>
            )}
            {activeType === 'project' && (
              <button className="btn btn-primary" onClick={() => navigate('/process/sop/new?type=project')}>
                <Plus size={14} /> 新增專案範本
              </button>
            )}
            {activeType === 'list' && (
              <button className="btn btn-primary" onClick={() => navigate('/process/sop/list/new')}>
                <Plus size={14} /> 新增清單範本
              </button>
            )}
            {activeType === 'form' && (
              <button className="btn btn-primary" onClick={() => navigate('/process/sop/form/new')}>
                <Plus size={14} /> 新增表單範本
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">流程範本</div>
          <div className="stat-card-value">{workflowCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">專案範本</div>
          <div className="stat-card-value">{projectCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總步驟數</div>
          <div className="stat-card-value">{totalSteps}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">已部署次數</div>
          <div className="stat-card-value">{totalDeployed}</div>
        </div>
      </div>

      {/* ── Type switcher ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[
          { value: 'workflow', label: '📋 流程範本', count: workflowCount },
          { value: 'project',  label: '🗂 專案範本', count: projectCount },
          { value: 'list',     label: '☑ 清單範本',  count: listCount },
          { value: 'form',     label: '📝 表單範本',  count: formCount },
        ].map(opt => {
          const active = activeType === opt.value
          return (
            <button key={opt.value} onClick={() => switchType(opt.value)} style={{
              padding: '8px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700,
              cursor: 'pointer',
              border: active ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
              background: active ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
              color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}>
              {opt.label}
              <span style={{ marginLeft: 6, opacity: 0.65, fontWeight: 400 }}>{opt.count}</span>
            </button>
          )
        })}
      </div>

      {/* ── Search bar row: search + sort + filter panel toggle + draft-toggle ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
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

        {/* Sort dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <SortAsc size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <select
            className="form-input"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ fontSize: 13, paddingLeft: 8, paddingRight: 24, height: 34, cursor: 'pointer' }}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Filter panel toggle */}
        <button
          onClick={() => setShowFilterPanel(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', flexShrink: 0,
            border: (showFilterPanel || hasActiveFilters)
              ? '1.5px solid var(--accent-cyan)'
              : '1px solid var(--border-subtle)',
            background: (showFilterPanel || hasActiveFilters) ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
            color: (showFilterPanel || hasActiveFilters) ? 'var(--accent-cyan)' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}
        >
          <Filter size={12} />
          篩選
          {hasActiveFilters && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent-cyan)', flexShrink: 0,
            }} />
          )}
        </button>

        {/* Draft / archived toggle */}
        <button
          onClick={() => setShowDraftArchived(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', flexShrink: 0,
            border: showDraftArchived
              ? '1.5px solid var(--accent-orange)'
              : '1px solid var(--border-subtle)',
            background: showDraftArchived ? 'var(--accent-orange-dim)' : 'var(--bg-secondary)',
            color: showDraftArchived ? 'var(--accent-orange)' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}
        >
          <Filter size={12} />
          顯示草稿/封存
        </button>
      </div>

      {/* ── Category tab strip ── */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 18, paddingBottom: 2 }}>
        {[ALL_LABEL, ...categories].map(cat => {
          const isActive = activeCategory === cat
          // Count respects the current showDraftArchived setting
          const base = showDraftArchived
            ? byType
            : byType.filter(t => !t.status || t.status === 'published')
          const count = cat === ALL_LABEL
            ? base.length
            : base.filter(t => t.category === cat).length
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

      {/* ── Main body: filter panel + card grid ── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* ── Collapsible filter panel ── */}
        {showFilterPanel && (
          <div style={{
            width: 200, flexShrink: 0,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12, padding: '14px 14px',
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            {/* Panel header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                篩選條件
              </span>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  style={{
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    background: 'none', border: 'none',
                    color: 'var(--accent-orange)', padding: 0,
                  }}
                >
                  清除篩選
                </button>
              )}
            </div>

            {/* Has approval chain */}
            <TriToggle
              label="核准流程"
              value={filterApproval}
              onChange={setFilterApproval}
            />

            {/* Has forms */}
            <TriToggle
              label="表單填寫"
              value={filterForms}
              onChange={setFilterForms}
            />

            {/* Created by */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>
                建立者
              </div>
              <input
                className="form-input"
                type="text"
                placeholder="輸入建立者..."
                value={filterCreatedBy}
                onChange={e => setFilterCreatedBy(e.target.value)}
                style={{ fontSize: 12, width: '100%', padding: '5px 9px' }}
              />
            </div>

            {/* Legend */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 7 }}>
                步驟類型圖例
              </div>
              {[
                { color: 'var(--accent-green)',  label: '清單' },
                { color: 'var(--accent-purple)', label: '核准' },
                { color: 'var(--accent-cyan)',   label: '表單' },
                { color: 'var(--accent-orange)', label: '觸發' },
                { color: 'var(--border-medium)', label: '一般' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: item.color,
                  }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Card grid ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
              {query ? `找不到符合「${query}」的範本` : '此分類暫無範本'}
              <div style={{ marginTop: 14 }}>
                {activeType === 'list' ? (
                  <button className="btn btn-primary" onClick={() => navigate('/process/sop/list/new')}>
                    <Plus size={14} /> 新增清單範本
                  </button>
                ) : activeType === 'form' ? (
                  <button className="btn btn-primary" onClick={() => navigate('/process/sop/form/new')}>
                    <Plus size={14} /> 新增表單範本
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => navigate('/process/sop/new')}>
                    <Plus size={14} /> 新增範本
                  </button>
                )}
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
                const tags = tpl.tags || []
                const visibleTags = tags.slice(0, 3)
                const extraTags = tags.length - 3
                const statusBadge = STATUS_BADGE[tpl.status] // undefined for published / null
                // A template is "published" when status is 'published' OR null/undefined
                const isPublished = !tpl.status || tpl.status === 'published'
                // For list/form types, item count comes from columns/fields
                const isListType = activeType === 'list'
                const isFormType = activeType === 'form'
                const isSpecialType = isListType || isFormType
                const itemCount = isListType
                  ? (tpl.columns?.length || 0)
                  : isFormType
                    ? (tpl.fields?.length || 0)
                    : steps.length
                const itemLabel = isListType ? '欄' : isFormType ? '欄位' : '步'

                return (
                  <div
                    key={tpl.id}
                    className="card"
                    style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}
                  >
                    {/* ── Card header ── */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{
                          fontWeight: 700, fontSize: 15, color: 'var(--text-primary)',
                          lineHeight: 1.3, flex: 1, minWidth: 0,
                        }}>
                          {tpl.name}
                        </div>
                        <div style={{
                          display: 'flex', gap: 5, flexShrink: 0,
                          alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end',
                        }}>
                          {/* Status badge — only shown for non-published */}
                          {statusBadge && (
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                              background: statusBadge.dim,
                              color: statusBadge.color,
                              border: `1px solid ${statusBadge.color}`,
                              whiteSpace: 'nowrap',
                            }}>
                              {statusBadge.label}
                            </span>
                          )}
                          <span className="badge badge-cyan" style={{ flexShrink: 0 }}>
                            {tpl.category}
                          </span>
                          {/* Lock icon — shown only for published templates */}
                          {isPublished && (
                            <Lock
                              size={11}
                              title="已發布 — 編輯需先改為草稿"
                              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                            />
                          )}
                        </div>
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

                    {/* ── Step preview (workflow/project only) ── */}
                    {!isSpecialType && (
                      <div style={{ flex: 1 }}>
                        {/* Colored dot row */}
                        <StepDots steps={steps} />

                        {/* Text step list (kept alongside dots) */}
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
                    )}

                    {/* ── Tag pills ── */}
                    {tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                        {visibleTags.map(tag => (
                          <span key={tag} style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                            background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)',
                            border: '1px solid var(--accent-purple)',
                          }}>
                            {tag}
                          </span>
                        ))}
                        {extraTags > 0 && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>
                            +{extraTags} 更多
                          </span>
                        )}
                      </div>
                    )}

                    {/* ── Card footer: stats + action buttons ── */}
                    <div style={{
                      paddingTop: 10,
                      borderTop: '1px solid var(--border-subtle)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      {/* Stats */}
                      <div style={{ display: 'flex', gap: 12 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          📋 {itemCount} {itemLabel}
                        </span>
                        {usage > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>
                            ✓ 部署 {usage} 次
                          </span>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {/* Preview — only for workflow/project */}
                        {!isSpecialType && (
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={() => setPreviewTarget(tpl)}
                          >
                            預覽
                          </button>
                        )}
                        {/* Edit */}
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => {
                            if (isListType) navigate(`/process/sop/list/${tpl.id}/edit`)
                            else if (isFormType) navigate(`/process/sop/form/${tpl.id}/edit`)
                            else navigate(`/process/sop/${tpl.id}/edit`)
                          }}
                        >
                          <Edit3 size={12} /> 編輯
                        </button>
                        {/* Deploy — only for workflow/project */}
                        {!isSpecialType && (
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={() => setDeployTarget(tpl)}
                          >
                            <Rocket size={12} /> 部署
                          </button>
                        )}
                        {/* Duplicate (icon-only) */}
                        <button
                          onClick={() => handleDuplicate(tpl)}
                          title="複製範本"
                          style={{
                            background: 'none', border: 'none', color: 'var(--text-muted)',
                            cursor: 'pointer', padding: '4px 5px', borderRadius: 5,
                            display: 'flex', alignItems: 'center', transition: 'color 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-cyan)' }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                        >
                          <Copy size={13} />
                        </button>
                        {/* Dry-run / shadow deploy (workflow only) */}
                        {!isSpecialType && (
                          <button
                            onClick={() => setShadowTarget(tpl)}
                            title="模擬部署"
                            style={{
                              background: 'none', border: 'none', color: 'var(--text-muted)',
                              cursor: 'pointer', padding: '4px 5px', borderRadius: 5,
                              display: 'flex', alignItems: 'center', transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-cyan)' }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                          >
                            <Play size={13} />
                          </button>
                        )}
                        {/* Analytics (icon-only, workflow/project only) */}
                        {!isSpecialType && (
                          <button
                            onClick={() => setAnalyticsTarget(tpl)}
                            title="使用分析"
                            style={{
                              background: 'none', border: 'none', color: 'var(--text-muted)',
                              cursor: 'pointer', padding: '4px 5px', borderRadius: 5,
                              display: 'flex', alignItems: 'center', transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-purple)' }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                          >
                            <BarChart2 size={13} />
                          </button>
                        )}
                        {/* Delete (icon-only) */}
                        <button
                          onClick={() => handleDelete(tpl)}
                          title="刪除範本"
                          style={{
                            background: 'none', border: 'none', color: 'var(--text-muted)',
                            cursor: 'pointer', padding: '4px 5px', borderRadius: 5,
                            display: 'flex', alignItems: 'center', transition: 'color 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-red)' }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
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
        </div>
      </div>

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

      {/* ── TemplatePreviewModal ── */}
      {previewTarget && (
        <TemplatePreviewModal
          template={previewTarget}
          usageCount={usageCounts[previewTarget.name] || 0}
          checklists={checklists}
          approvalChains={approvalChains}
          onClose={() => setPreviewTarget(null)}
          onEdit={() => { setPreviewTarget(null); navigate(`/process/sop/${previewTarget.id}/edit`) }}
          onDuplicate={async () => { await handleDuplicate(previewTarget); setPreviewTarget(null) }}
          onDeploy={() => { setDeployTarget(previewTarget); setPreviewTarget(null) }}
        />
      )}
      {analyticsTarget && (
        <TemplateAnalyticsModal
          template={analyticsTarget}
          usageCount={usageCounts[analyticsTarget.name] || 0}
          onClose={() => setAnalyticsTarget(null)}
        />
      )}
      {shadowTarget && (
        <ShadowDeployModal
          template={shadowTarget}
          checklists={checklists}
          approvalChains={approvalChains}
          onClose={() => setShadowTarget(null)}
        />
      )}
    </div>
  )
}
