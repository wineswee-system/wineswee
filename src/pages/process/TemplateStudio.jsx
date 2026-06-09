import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Shield, Save, History } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { Field } from '../../components/Modal'
import LoadingSpinner from '../../components/LoadingSpinner'
import StepCard from './components/StepCard'
import StepEditor from './components/StepEditor'

const DEFAULT_CATEGORIES = ['HR', '營運', '採購', '展店', '倉管', '財務', '行銷', '客服']

const emptyStep = () => ({
  title: '', role: '', assignee: '', priority: '中', description: '',
  checklist_id: '', approval_chain_id: '', required_forms: [],
  trigger_template_id: '',
  branch_on_approved: '', branch_on_rejected: '',
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
})

const emptyTpl = () => ({
  name: '', category: 'HR', description: '', approval_chain_id: '',
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
 *   TopBar  [← 返回] [title] [儲存]
 *   LeftPanel (280px) — metadata fields + step list (StepCard × n)
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
    setTpl(prev => {
      const newSteps = [...prev.steps, emptyStep()]
      setSelectedStep(newSteps.length - 1)
      setIsDirty(true)
      return { ...prev, steps: newSteps }
    })
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

  // ── Restore a version ──
  const handleRestore = async (v) => {
    const ok = await confirm({ message: `還原至版本 ${v.version_number}「${v.name}」？目前變更將被取代。` })
    if (!ok) return
    setTpl({
      name: v.name || '',
      category: tpl.category,         // keep current category
      description: v.description || '',
      approval_chain_id: tpl.approval_chain_id,  // keep current
      steps: (v.steps?.length > 0) ? v.steps.map(normalizeStep) : [emptyStep()],
    })
    setIsDirty(true)
    toast.success(`已還原至版本 ${v.version_number}，請儲存以套用`)
  }

  // ── Save ──
  const handleSave = async () => {
    if (!tpl.name.trim()) { toast.error('請填寫範本名稱'); return }
    if (!tpl.steps.some(s => s.title.trim())) { toast.error('至少需要一個有名稱的步驟'); return }
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
      }))
      const payload = {
        name: tpl.name.trim(),
        category: tpl.category,
        description: tpl.description?.trim() || null,
        approval_chain_id: tpl.approval_chain_id || null,
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
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {id ? `編輯：${tpl.name || '（未命名）'}` : '新增流程範本'}
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
                <StepCard
                  key={i}
                  step={step}
                  index={i}
                  total={steps.length}
                  isActive={selectedStep === i}
                  onClick={() => setSelectedStep(i)}
                  onMoveUp={() => moveStep(i, -1)}
                  onMoveDown={() => moveStep(i, 1)}
                  onRemove={removeStep}
                />
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
                  <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                    {loadingVersions ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 4px' }}>載入中...</div>
                    ) : versions.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 4px' }}>尚無版本記錄</div>
                    ) : versions.map(v => (
                      <div key={v.id} style={{
                        padding: '8px 10px', borderRadius: 8, marginBottom: 5,
                        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                          <div>
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
                          <button
                            type="button"
                            onClick={() => handleRestore(v)}
                            style={{
                              fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 600,
                              border: '1px solid var(--accent-orange)', background: 'var(--accent-orange-dim)',
                              color: 'var(--accent-orange)', cursor: 'pointer', flexShrink: 0,
                            }}
                          >
                            還原
                          </button>
                        </div>
                      </div>
                    ))}
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
    </div>
  )
}
