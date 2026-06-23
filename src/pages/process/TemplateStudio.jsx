import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Shield, Save, History, Eye, Copy, X, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { Field } from '../../components/Modal'
import LoadingSpinner from '../../components/LoadingSpinner'
import StepCard from './components/StepCard'
import StepEditor from './components/StepEditor'
import TemplatePreviewModal from './components/TemplatePreviewModal'

const DEFAULT_CATEGORIES = ['HR', '營運', '採購', '展店', '倉管', '財務', '行銷', '客服']

const STATUS_OPTIONS = [
  { value: 'published', label: '已發布', color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  { value: 'draft',     label: '草稿',   color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  { value: 'archived',  label: '已封存', color: 'var(--text-muted)',    dim: 'var(--bg-secondary)' },
]

const emptyStep = () => ({
  title: '', role: '', assignee: '', priority: '中', description: '',
  checklist_id: '', approval_chain_id: '', required_forms: [],
  trigger_template_id: '',
  branch_on_approved: '', branch_on_rejected: '',
  notify_on_start: [],
  notify_on_complete: [],
  relative_due_days: null,
  preconditions: [],
})

/** Normalise a raw step from DB / version JSONB into the local editor shape. */
const normalizeStep = (s) => ({
  title: s.title || '',
  role: s.role || '',
  assignee: s.assignee || '',
  priority: s.priority || '中',
  description: s.description || '',
  checklist_id: s.checklist_id || '',
  approval_chain_id: s.approval_chain_id || '',
  required_forms: s.required_forms || [],
  trigger_template_id: s.trigger_template_id || '',
  branch_on_approved: s.branch_on_approved || '',
  branch_on_rejected: s.branch_on_rejected || '',
  notify_on_start: s.notify_on_start || [],
  notify_on_complete: s.notify_on_complete || [],
  relative_due_days: s.relative_due_days ?? null,
  preconditions: s.preconditions || [],
})

const emptyTpl = () => ({
  name: '', category: 'HR', description: '', approval_chain_id: '',
  tags: [], status: 'published',
  steps: [emptyStep()],
})

/**
 * TemplateStudio — Full-page two-panel SOP template builder.
 *
 * Routes:
 *   /process/sop/new        — create mode (id param absent)
 *   /process/sop/:id/edit   — edit mode (loads existing template by id)
 *
 * Layout:
 *   TopBar  [← 返回] [title] [預覽] [儲存]
 *   LeftPanel (280px) — metadata fields + step list (StepCard × n) + version history
 *   RightPanel (flex-1) — StepEditor for the selected step
 */
export default function TemplateStudio() {
  const { id } = useParams()  // undefined = create mode
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [tpl, setTpl] = useState(emptyTpl())
  const [selectedStep, setSelectedStep] = useState(0)
  const [isDirty, setIsDirty] = useState(false)

  // Reference data for pickers
  const [checklists, setChecklists] = useState([])
  const [approvalChains, setApprovalChains] = useState([])
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [otherTemplates, setOtherTemplates] = useState([])  // trigger picker (excludes self)
  const [departments, setDepartments] = useState([])

  // Version history state
  const [versions, setVersions] = useState([])
  const [showVersions, setShowVersions] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [diffVersion, setDiffVersion] = useState(null)  // version being diff-compared

  // Preview modal
  const [previewOpen, setPreviewOpen] = useState(false)

  // Tag input
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = useRef(null)

  // ── Load reference data + template (if editing) ──
  useEffect(() => {
    const fetchAll = async () => {
      const [clRes, acRes, tplsRes, catsRes, deptRes] = await Promise.allSettled([
        supabase.from('checklists').select('id, name, items').order('name'),
        supabase.from('approval_chains').select('id, name, approval_chain_steps(count)').order('name'),
        supabase.from('sop_templates').select('id, name').order('name'),
        supabase.from('workflow_categories').select('id, name').eq('scope', 'workflow').order('name'),
        supabase.from('departments').select('id, name').order('name'),
      ])

      if (clRes.status === 'fulfilled' && clRes.value.data) {
        setChecklists(clRes.value.data)
      }
      if (acRes.status === 'fulfilled' && acRes.value.data) {
        setApprovalChains(acRes.value.data.map(c => ({
          ...c,
          steps: c.approval_chain_steps?.[0]?.count ?? 0,
        })))
      }
      if (tplsRes.status === 'fulfilled' && tplsRes.value.data) {
        const all = tplsRes.value.data
        setOtherTemplates(id ? all.filter(t => String(t.id) !== String(id)) : all)
      }
      if (catsRes.status === 'fulfilled' && catsRes.value.data?.length > 0) {
        setCategories(catsRes.value.data.map(c => c.name))
      }
      if (deptRes.status === 'fulfilled' && deptRes.value.data) {
        setDepartments(deptRes.value.data)
      }

      // Load existing template in edit mode
      if (id) {
        const { data, error } = await supabase
          .from('sop_templates').select('*').eq('id', id).single()
        if (error || !data) {
          toast.error('找不到此範本')
          navigate('/process/sop')
          return
        }
        setTpl({
          name: data.name || '',
          category: data.category || 'HR',
          description: data.description || '',
          approval_chain_id: data.approval_chain_id || '',
          tags: Array.isArray(data.tags) ? data.tags : [],
          status: data.status || 'published',
          steps: (data.steps?.length > 0) ? data.steps.map(normalizeStep) : [emptyStep()],
        })
      }
      setLoading(false)
    }
    fetchAll()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Version history: single fetch function used by both the lazy-load effect and post-save refresh ──
  const refreshVersions = useCallback(() => {
    if (!id) return
    setLoadingVersions(true)
    supabase.from('sop_template_versions')
      .select('*').eq('template_id', id)
      .order('version_number', { ascending: false })
      .then(({ data }) => { setVersions(data || []); setLoadingVersions(false) })
  }, [id])

  useEffect(() => {
    if (!showVersions) return
    refreshVersions()
  }, [showVersions, refreshVersions])

  // ── Template state helper (marks dirty) ──
  const updateTpl = useCallback(updater => {
    setTpl(updater)
    setIsDirty(true)
  }, [])

  // ── Step operations ──
  const addStep = () => {
    const newSteps = [...tpl.steps, emptyStep()]
    updateTpl(t => ({ ...t, steps: newSteps }))
    setSelectedStep(newSteps.length - 1)
  }

  const updateStep = (i, updated) => {
    updateTpl(t => ({
      ...t,
      steps: t.steps.map((s, j) => j === i ? updated : s),
    }))
  }

  const removeStep = async (i) => {
    if (tpl.steps.length <= 1) { toast.error('至少保留一個步驟'); return }
    const stepTitle = tpl.steps[i]?.title || '（未命名）'
    const ok = await confirm({ message: `確定刪除步驟 ${i + 1}「${stepTitle}」？` })
    if (!ok) return
    updateTpl(t => ({ ...t, steps: t.steps.filter((_, j) => j !== i) }))
    setSelectedStep(prev => Math.max(0, Math.min(prev, tpl.steps.length - 2)))
  }

  const duplicateStep = (i) => {
    const src = tpl.steps[i]
    const copy = { ...src, title: src.title ? `${src.title}（副本）` : '（副本）' }
    const steps = [...tpl.steps]
    steps.splice(i + 1, 0, copy)
    updateTpl(t => ({ ...t, steps }))
    setSelectedStep(i + 1)
  }

  const moveStep = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= tpl.steps.length) return
    updateTpl(t => {
      const steps = [...t.steps]
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...t, steps }
    })
    setSelectedStep(j)
  }

  // ── Tag operations ──
  const commitTag = () => {
    const raw = tagInput.trim().replace(/,+$/, '').trim()
    if (!raw) { setTagInput(''); return }
    const newTags = raw.split(/[,，]+/).map(t => t.trim()).filter(Boolean)
    updateTpl(t => {
      const existing = t.tags || []
      const merged = [...existing, ...newTags.filter(tag => !existing.includes(tag))]
      return { ...t, tags: merged }
    })
    setTagInput('')
  }

  const removeTag = (tag) => {
    updateTpl(t => ({ ...t, tags: (t.tags || []).filter(tg => tg !== tag) }))
  }

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTag()
    } else if (e.key === 'Backspace' && tagInput === '' && tpl.tags?.length > 0) {
      removeTag(tpl.tags[tpl.tags.length - 1])
    }
  }

  // ── Restore a version ──
  const handleRestore = async (v) => {
    const ok = await confirm({ message: `還原至版本 ${v.version_number}「${v.name}」？目前變更將被取代。` })
    if (!ok) return
    setTpl(prev => ({
      name: v.name || '',
      category: prev.category,
      description: v.description || '',
      approval_chain_id: prev.approval_chain_id,
      tags: prev.tags,
      status: prev.status,
      steps: (v.steps?.length > 0) ? v.steps.map(normalizeStep) : [emptyStep()],
    }))
    setIsDirty(true)
    setDiffVersion(null)
    toast.success(`已還原至版本 ${v.version_number}，請儲存以套用`)
  }

  // ── Diff helpers ──
  const computeDiff = (versionSteps, currentSteps) => {
    const vList = versionSteps || []
    const cList = currentSteps || []
    const vTitles = vList.map(s => s.title || '').filter(Boolean)
    const cTitles = cList.map(s => s.title || '').filter(Boolean)
    const added   = cTitles.filter(t => !vTitles.includes(t))
    const removed = vTitles.filter(t => !cTitles.includes(t))
    const changed = vTitles.filter(t => {
      if (!cTitles.includes(t)) return false
      const vs = vList.find(s => s.title === t)
      const cs = cList.find(s => s.title === t)
      if (!vs || !cs) return false
      return (
        vs.role !== cs.role ||
        vs.assignee !== cs.assignee ||
        vs.priority !== cs.priority ||
        vs.description !== cs.description
      )
    })
    return { added, removed, changed }
  }

  // ── Save ──
  const handleSave = async () => {
    if (!tpl.name.trim()) { toast.error('請填寫範本名稱'); return }
    if (!tpl.steps.some(s => s.title.trim())) { toast.error('至少需要一個有名稱的步驟'); return }
    if (tpl.status === 'published') {
      const ok = await confirm({
        message: '此範本已發布。儲存將覆蓋已發布版本，建議先改為草稿再修改。確定繼續儲存？',
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      const cleanSteps = tpl.steps.filter(s => s.title.trim()).map(s => ({
        title: s.title.trim(),
        role: s.role?.trim() || null,
        assignee: s.assignee?.trim() || null,
        priority: s.priority || '中',
        description: s.description?.trim() || null,
        checklist_id: s.checklist_id || null,
        approval_chain_id: s.approval_chain_id || null,
        required_forms: s.required_forms?.length > 0 ? s.required_forms : null,
        trigger_template_id: s.trigger_template_id || null,
        branch_on_approved: s.branch_on_approved || null,
        branch_on_rejected: s.branch_on_rejected || null,
        notify_on_start: s.notify_on_start?.length > 0 ? s.notify_on_start : null,
        notify_on_complete: s.notify_on_complete?.length > 0 ? s.notify_on_complete : null,
        relative_due_days: s.relative_due_days ?? null,
      }))
      const payload = {
        name: tpl.name.trim(),
        category: tpl.category,
        description: tpl.description?.trim() || null,
        approval_chain_id: tpl.approval_chain_id || null,
        tags: tpl.tags?.length > 0 ? tpl.tags : null,
        status: tpl.status || 'published',
        steps: cleanSteps,
        organization_id: profile?.organization_id || null,
      }

      if (id) {
        // Fetch snapshot data + count existing versions in parallel (independent queries)
        const [{ data: current }, { count }] = await Promise.all([
          supabase.from('sop_templates').select('*').eq('id', id).maybeSingle(),
          supabase.from('sop_template_versions').select('id', { count: 'exact', head: true }).eq('template_id', id),
        ])

        // Version snapshot + template update are independent — run in parallel
        const versionInsert = current
          ? supabase.from('sop_template_versions').insert({
              template_id: Number(id),
              version_number: (count || 0) + 1,
              name: current.name,
              description: current.description,
              steps: current.steps,
              changed_by: profile?.name || '系統',
              // changed_at omitted — DB DEFAULT now() handles it
            })
          : Promise.resolve({ error: null })

        const [, { data, error }] = await Promise.all([
          versionInsert,
          supabase.from('sop_templates').update(payload).eq('id', id).select().single(),
        ])
        if (error) throw error
        toast.success(`範本「${data.name}」已更新`)
        setIsDirty(false)
        if (showVersions) refreshVersions()
      } else {
        const { data, error } = await supabase
          .from('sop_templates').insert(payload).select().single()
        if (error) throw error
        toast.success(`範本「${data.name}」已建立`)
        setIsDirty(false)
        navigate(`/process/sop/${data.id}/edit`, { replace: true })
      }
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  const handleBack = async () => {
    if (isDirty) {
      const ok = await confirm({
        title: '有未儲存的變更',
        message: '離開後，未儲存的變更將遺失。',
        confirmLabel: '離開',
        cancelLabel: '繼續編輯',
        danger: true,
      })
      if (!ok) return
    }
    navigate('/process/sop')
  }

  // Build preview template object from current tpl state
  const previewTemplate = {
    id: id || null,
    name: tpl.name || '（未命名）',
    category: tpl.category,
    description: tpl.description,
    tags: tpl.tags,
    status: tpl.status,
    approval_chain_id: tpl.approval_chain_id || null,
    steps: tpl.steps,
  }

  if (loading) return <LoadingSpinner />

  const steps = tpl.steps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)' }}>

      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-primary)', flexShrink: 0,
      }}>
        <button
          onClick={handleBack}
          style={{
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 13,
            padding: '5px 8px', borderRadius: 6,
          }}
        >
          <ArrowLeft size={15} /> 返回範本庫
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 6 }}>
            {id ? `編輯：${tpl.name || '（未命名）'}` : '新增流程範本'}
            {tpl.status === 'published' && (
              <Lock size={13} style={{ color: 'var(--accent-orange)', flexShrink: 0 }} title="已發布版本" />
            )}
          </div>
          {isDirty && (
            <div style={{ fontSize: 11, color: 'var(--accent-orange)' }}>● 有未儲存的變更</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {steps.length} 個步驟
          </span>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 13,
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
            }}
          >
            <Eye size={14} /> 預覽
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Save size={14} /> {saving ? '儲存中...' : '儲存範本'}
          </button>
        </div>
      </div>

      {/* ── Two-panel body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left panel: metadata + step list ── */}
        <div style={{
          width: 280, flexShrink: 0,
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Template metadata */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
            }}>
              範本資訊
            </div>

            <Field label="範本名稱" required>
              <input
                className="form-input"
                type="text"
                style={{ width: '100%', fontSize: 13 }}
                placeholder="例：新店開幕 SOP"
                value={tpl.name}
                onChange={e => updateTpl(t => ({ ...t, name: e.target.value }))}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <Field label="分類">
                <select
                  className="form-input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={tpl.category}
                  onChange={e => updateTpl(t => ({ ...t, category: e.target.value }))}
                >
                  {categories.map(c => <option key={c}>{c}</option>)}
                  {tpl.category && !categories.includes(tpl.category) && (
                    <option value={tpl.category}>{tpl.category}</option>
                  )}
                </select>
              </Field>
              <Field label={
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Shield size={11} style={{ color: 'var(--accent-purple)' }} />完成簽核
                </span>
              }>
                <select
                  className="form-input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={tpl.approval_chain_id || ''}
                  onChange={e => updateTpl(t => ({
                    ...t,
                    approval_chain_id: e.target.value ? Number(e.target.value) : '',
                  }))}
                >
                  <option value="">不需要</option>
                  {approvalChains.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div style={{ marginTop: 8 }}>
              <Field label="說明">
                <input
                  className="form-input"
                  type="text"
                  style={{ width: '100%', fontSize: 12 }}
                  placeholder="範本用途說明"
                  value={tpl.description}
                  onChange={e => updateTpl(t => ({ ...t, description: e.target.value }))}
                />
              </Field>
            </div>

            {/* Tags field */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
                標籤
              </div>
              <div
                onClick={() => tagInputRef.current?.focus()}
                style={{
                  display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center',
                  minHeight: 32, padding: '4px 8px', borderRadius: 6,
                  border: '1px solid var(--border-medium)', background: 'var(--bg-card)',
                  cursor: 'text',
                }}
              >
                {(tpl.tags || []).map(tag => (
                  <span
                    key={tag}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                      borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600,
                    }}
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); removeTag(tag) }}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center',
                        lineHeight: 1,
                      }}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  ref={tagInputRef}
                  type="text"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={commitTag}
                  placeholder={(tpl.tags || []).length === 0 ? '輸入標籤，Enter 確認' : ''}
                  style={{
                    border: 'none', outline: 'none', background: 'transparent',
                    fontSize: 11, color: 'var(--text-primary)', flex: 1, minWidth: 60,
                    padding: '1px 2px',
                  }}
                />
              </div>
            </div>

            {/* Status field */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
                狀態
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateTpl(t => ({ ...t, status: opt.value }))}
                    style={{
                      flex: 1, padding: '4px 0', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', border: '1.5px solid',
                      borderColor: tpl.status === opt.value ? opt.color : 'var(--border-subtle)',
                      background: tpl.status === opt.value ? opt.dim : 'var(--bg-card)',
                      color: tpl.status === opt.value ? opt.color : 'var(--text-muted)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Step list */}
          <div style={{ flex: 1, padding: '12px 16px', overflowY: 'auto' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 0.6,
              }}>
                步驟
              </span>
              <span style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>{steps.length} 個</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {steps.map((step, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <StepCard
                    step={step}
                    index={i}
                    total={steps.length}
                    isActive={selectedStep === i}
                    onClick={() => setSelectedStep(i)}
                    onMoveUp={() => moveStep(i, -1)}
                    onMoveDown={() => moveStep(i, 1)}
                    onRemove={removeStep}
                  />
                  {/* Duplicate button: sits next to the remove button inside the card row */}
                  <button
                    type="button"
                    title="複製步驟"
                    onClick={e => { e.stopPropagation(); duplicateStep(i) }}
                    style={{
                      position: 'absolute', top: 5, right: 28,
                      background: 'none', border: 'none', padding: '2px 3px',
                      cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 4,
                      display: 'flex', alignItems: 'center', lineHeight: 1,
                      zIndex: 1,
                    }}
                  >
                    <Copy size={11} />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addStep}
              style={{
                width: '100%', marginTop: 8, padding: '8px',
                borderRadius: 8, border: '1.5px dashed var(--border-medium)',
                background: 'none', color: 'var(--text-muted)', fontSize: 12,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}
            >
              <Plus size={13} /> 新增步驟
            </button>

            {/* ── Version history ── */}
            {id && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowVersions(v => !v)}
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11,
                    fontWeight: 700, color: 'var(--text-muted)', background: 'none',
                    border: '1px solid var(--border-subtle)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <History size={12} /> 版本記錄
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{showVersions ? '▲' : '▼'}</span>
                </button>

                {showVersions && (
                  <div style={{ marginTop: 8 }}>
                    {loadingVersions ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 4px' }}>載入中...</div>
                    ) : versions.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 4px' }}>尚無版本記錄</div>
                    ) : (
                      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                        {versions.map(v => (
                          <div key={v.id} style={{
                            padding: '8px 10px', borderRadius: 8, marginBottom: 5,
                            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
                                  v{v.version_number}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                                  {v.changed_by} · {new Date(v.changed_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                                  {(v.steps?.length || 0)} 步驟
                                </div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => handleRestore(v)}
                                  style={{
                                    fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 600,
                                    border: '1px solid var(--accent-orange)', background: 'var(--accent-orange-dim)',
                                    color: 'var(--accent-orange)', cursor: 'pointer',
                                  }}
                                >
                                  還原
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDiffVersion(prev => prev?.id === v.id ? null : v)}
                                  style={{
                                    fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 600,
                                    border: '1px solid var(--accent-blue)',
                                    background: diffVersion?.id === v.id ? 'var(--accent-blue)' : 'var(--accent-blue-dim)',
                                    color: diffVersion?.id === v.id ? '#fff' : 'var(--accent-blue)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  差異
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Diff panel — shown below version list when a version is selected */}
                    {diffVersion && (() => {
                      const { added, removed, changed } = computeDiff(diffVersion.steps, tpl.steps)
                      const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0
                      return (
                        <div style={{
                          marginTop: 8, padding: '10px 12px', borderRadius: 8,
                          background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
                        }}>
                          <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            marginBottom: 8,
                          }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                              差異：v{diffVersion.version_number} → 目前
                            </div>
                            <button
                              type="button"
                              onClick={() => setDiffVersion(null)}
                              style={{
                                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                          {!hasChanges ? (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>與目前版本相同</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {added.map(title => (
                                <div key={'a-' + title} style={{
                                  fontSize: 11, color: 'var(--accent-green)',
                                  display: 'flex', alignItems: 'baseline', gap: 5,
                                }}>
                                  <span style={{ fontWeight: 700, flexShrink: 0 }}>+</span>
                                  <span>{title}</span>
                                </div>
                              ))}
                              {removed.map(title => (
                                <div key={'r-' + title} style={{
                                  fontSize: 11, color: 'var(--accent-red)',
                                  display: 'flex', alignItems: 'baseline', gap: 5,
                                }}>
                                  <span style={{ fontWeight: 700, flexShrink: 0 }}>−</span>
                                  <span style={{ textDecoration: 'line-through', opacity: 0.8 }}>{title}</span>
                                </div>
                              ))}
                              {changed.map(title => (
                                <div key={'c-' + title} style={{
                                  fontSize: 11, color: 'var(--accent-orange)',
                                  display: 'flex', alignItems: 'baseline', gap: 5,
                                }}>
                                  <span style={{ fontWeight: 700, flexShrink: 0 }}>≠</span>
                                  <span>{title}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: step detail editor ── */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          overflow: 'hidden', background: 'var(--bg-primary)',
        }}>
          {steps[selectedStep] ? (
            <>
              {/* Archived read-only banner */}
              {tpl.status === 'archived' && (
                <div style={{
                  padding: '8px 24px', flexShrink: 0,
                  background: 'var(--bg-secondary)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  color: 'var(--text-muted)', fontSize: 13,
                }}>
                  <Lock size={14} style={{ flexShrink: 0 }} />
                  此範本已封存，無法編輯。請先將狀態改為草稿。
                </div>
              )}

              {/* Step header bar */}
              <div style={{
                padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--accent-cyan)', color: '#fff',
                  fontSize: 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {selectedStep + 1}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 0 }}>
                  {steps[selectedStep].title || '（未命名步驟）'}
                </div>
              </div>

              <StepEditor
                step={steps[selectedStep]}
                onChange={updated => updateStep(selectedStep, updated)}
                checklists={checklists}
                approvalChains={approvalChains}
                templates={otherTemplates}
                steps={steps}
                stepIndex={selectedStep}
                departments={departments}
                disabled={tpl.status === 'archived'}
              />
            </>
          ) : (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 10, color: 'var(--text-muted)',
            }}>
              <div style={{ fontSize: 44 }}>✏️</div>
              <div style={{ fontSize: 14 }}>點選左側步驟以編輯詳細內容</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Preview modal ── */}
      {previewOpen && (
        <TemplatePreviewModal
          template={previewTemplate}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  )
}
