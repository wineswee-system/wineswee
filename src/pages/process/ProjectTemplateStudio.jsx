import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { Field } from '../../components/Modal'
import LoadingSpinner from '../../components/LoadingSpinner'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = ['HR', '營運', '採購', '展店', '倉管', '財務', '行銷', '客服']

const STATUS_OPTIONS = [
  { value: 'published', label: '已發布', color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  { value: 'draft',     label: '草稿',   color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  { value: 'archived',  label: '已封存', color: 'var(--text-muted)',    dim: 'var(--bg-secondary)' },
]

const PRIORITY_OPTIONS = ['高', '中', '低']

// ─── Factories ────────────────────────────────────────────────────────────────

const newLocalId = () => crypto.randomUUID()

const emptyStep = () => ({
  title: '', role: '', assignee: '', priority: '中', description: '',
  checklist_id: '', approval_chain_id: '', required_forms: [],
  trigger_template_id: '',
  branch_on_approved: '', branch_on_rejected: '',
  notify_on_start: [],
  notify_on_complete: [],
  relative_due_days: null,
})

const emptyWorkflow = () => ({
  id: newLocalId(),
  name: '',
  steps: [emptyStep()],
  depends_on: [],  // array of sibling workflow indices (0-based)
})

const emptyMilestone = () => ({ name: '', day_offset: 0 })

const emptyProject = () => ({
  name: '',
  category: 'HR',
  description: '',
  status: 'draft',
  estimated_days: 30,
  required_roles: [],
  workflows: [emptyWorkflow()],
  milestones: [],
})

// ─── Mini inline step list editor ─────────────────────────────────────────────

function MiniStepList({ steps, onStepsChange }) {
  const addStep = () => onStepsChange([...steps, emptyStep()])

  const updateStep = (i, field, value) => {
    onStepsChange(steps.map((s, j) => j === i ? { ...s, [field]: value } : s))
  }

  const removeStep = async (i) => {
    if (steps.length <= 1) { toast.error('至少保留一個步驟'); return }
    const title = steps[i]?.title || '（未命名）'
    const ok = await confirm({ message: `確定刪除步驟「${title}」？` })
    if (!ok) return
    onStepsChange(steps.filter((_, j) => j !== i))
  }

  const moveStep = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    onStepsChange(next)
  }

  return (
    <div>
      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '20px 1fr 96px 52px 28px',
        gap: 6,
        padding: '0 0 5px',
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}>
        <span>#</span>
        <span>步驟名稱</span>
        <span>角色</span>
        <span>優先</span>
        <span></span>
      </div>

      {steps.map((step, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '20px 1fr 96px 52px 28px',
            gap: 6,
            alignItems: 'start',
            marginBottom: 6,
          }}
        >
          {/* Up/Down order buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 5 }}>
            <button
              type="button"
              onClick={() => moveStep(i, -1)}
              disabled={i === 0}
              style={{
                background: 'none', border: 'none', padding: '1px',
                color: i === 0 ? 'var(--border-subtle)' : 'var(--text-muted)',
                cursor: i === 0 ? 'default' : 'pointer', fontSize: 9, lineHeight: 1,
              }}
              title="上移"
            >▲</button>
            <button
              type="button"
              onClick={() => moveStep(i, 1)}
              disabled={i === steps.length - 1}
              style={{
                background: 'none', border: 'none', padding: '1px',
                color: i === steps.length - 1 ? 'var(--border-subtle)' : 'var(--text-muted)',
                cursor: i === steps.length - 1 ? 'default' : 'pointer', fontSize: 9, lineHeight: 1,
              }}
              title="下移"
            >▼</button>
          </div>

          {/* Name + description stacked */}
          <div>
            <input
              className="form-input"
              type="text"
              placeholder={`步驟 ${i + 1} 名稱`}
              value={step.title}
              onChange={e => updateStep(i, 'title', e.target.value)}
              style={{ width: '100%', fontSize: 12 }}
            />
            <input
              className="form-input"
              type="text"
              placeholder="說明（選填）"
              value={step.description || ''}
              onChange={e => updateStep(i, 'description', e.target.value)}
              style={{ width: '100%', fontSize: 11, marginTop: 3, color: 'var(--text-muted)' }}
            />
          </div>

          <input
            className="form-input"
            type="text"
            placeholder="角色"
            value={step.role || ''}
            onChange={e => updateStep(i, 'role', e.target.value)}
            style={{ width: '100%', fontSize: 12 }}
          />

          <select
            className="form-input"
            value={step.priority || '中'}
            onChange={e => updateStep(i, 'priority', e.target.value)}
            style={{ width: '100%', fontSize: 11 }}
          >
            {PRIORITY_OPTIONS.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => removeStep(i)}
            style={{
              background: 'none', border: 'none', padding: '4px',
              color: 'var(--accent-red)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              paddingTop: 7,
            }}
            title="刪除步驟"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addStep}
        style={{
          width: '100%', marginTop: 4, padding: '6px',
          borderRadius: 6, border: '1.5px dashed var(--border-medium)',
          background: 'none', color: 'var(--text-muted)', fontSize: 11,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}
      >
        <Plus size={12} /> 新增步驟
      </button>
    </div>
  )
}

// ─── Workflow row (right panel — expandable) ──────────────────────────────────

function WorkflowRow({ wf, index, allWorkflows, onUpdate, onRemove, isExpanded, onToggleExpand }) {
  const dependsOnLabel = (wf.depends_on || [])
    .map(idx => allWorkflows[idx] ? `${idx + 1}. ${allWorkflows[idx].name || '（未命名）'}` : null)
    .filter(Boolean)
    .join('、') || '無'

  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--border-subtle)', marginBottom: 8, overflow: 'hidden' }}>
      {/* Row header — click to toggle */}
      <div
        onClick={onToggleExpand}
        style={{
          display: 'grid',
          gridTemplateColumns: '32px 1fr 72px 28px 28px',
          gap: 8,
          alignItems: 'center',
          padding: '10px 12px',
          background: 'var(--bg-secondary)',
          cursor: 'pointer',
        }}
      >
        {/* Number circle */}
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
          fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {index + 1}
        </div>

        {/* Name + meta */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
            {wf.name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>（未命名工作流程）</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            {wf.steps.length} 步驟 · 依賴: {dependsOnLabel}
          </div>
        </div>

        {/* Step count pill */}
        <div style={{
          fontSize: 11, color: 'var(--accent-purple)', fontWeight: 600,
          background: 'var(--accent-purple-dim)', padding: '2px 8px', borderRadius: 10,
          textAlign: 'center',
        }}>
          {wf.steps.length} 步
        </div>

        {/* Delete */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onRemove(index) }}
          style={{
            background: 'none', border: 'none', padding: 4, cursor: 'pointer',
            color: 'var(--accent-red)', display: 'flex', alignItems: 'center',
          }}
          title="刪除此工作流程"
        >
          <Trash2 size={13} />
        </button>

        {/* Chevron */}
        <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </div>
      </div>

      {/* Expanded editor area */}
      {isExpanded && (
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
          {/* Name field */}
          <Field label="工作流程名稱" required>
            <input
              className="form-input"
              type="text"
              placeholder="例：場地取得"
              value={wf.name}
              onChange={e => onUpdate({ ...wf, name: e.target.value })}
              style={{ width: '100%', fontSize: 13 }}
            />
          </Field>

          {/* Depends-on selector */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>
              依賴關係（需等哪些流程完成後才啟動）
            </div>
            {allWorkflows.filter((_, j) => j !== index).length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                尚無其他工作流程可設定依賴
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {allWorkflows.map((other, j) => {
                  if (j === index) return null
                  const checked = (wf.depends_on || []).includes(j)
                  return (
                    <label
                      key={j}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        cursor: 'pointer', userSelect: 'none', border: '1.5px solid',
                        borderColor: checked ? 'var(--accent-cyan)' : 'var(--border-subtle)',
                        background: checked ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                        color: checked ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...(wf.depends_on || []), j]
                            : (wf.depends_on || []).filter(x => x !== j)
                          onUpdate({ ...wf, depends_on: next })
                        }}
                        style={{ display: 'none' }}
                      />
                      {j + 1}. {other.name || '（未命名）'}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* Inline step list */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border-subtle)' }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
            }}>
              步驟
            </div>
            <MiniStepList
              steps={wf.steps}
              onStepsChange={nextSteps => onUpdate({ ...wf, steps: nextSteps })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * ProjectTemplateStudio — Full-page two-panel project template builder.
 *
 * Routes (with ?type=project query param):
 *   /process/sop/new?type=project        — create mode (id param absent)
 *   /process/sop/:id/edit?type=project   — edit mode (loads by id)
 *
 * Layout:
 *   TopBar  [← 返回] [title] [儲存]
 *   LeftPanel (260px) — basic settings + workflow outline list
 *   RightPanel (tabs) — 工作流程 | 里程碑 | 成員角色
 *
 * Storage: sop_templates with type='project', steps=[], and all project
 *   structure stored in permissions->project (JSONB workaround).
 */
export default function ProjectTemplateStudio() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [proj, setProj] = useState(emptyProject())

  // Right-panel tab: 'workflows' | 'milestones' | 'roles'
  const [activeTab, setActiveTab] = useState('workflows')

  // Which workflow row is expanded in the right panel
  const [expandedWfIdx, setExpandedWfIdx] = useState(null)

  // DB-driven category list
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)

  // Textarea text for required_roles (one per line)
  const [rolesText, setRolesText] = useState('')

  // ── Load reference data + template (edit mode) ──────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      const [catsRes] = await Promise.allSettled([
        supabase.from('workflow_categories').select('name').eq('scope', 'workflow').order('name'),
      ])
      if (catsRes.status === 'fulfilled' && catsRes.value.data?.length > 0) {
        setCategories(catsRes.value.data.map(c => c.name))
      }

      if (id) {
        const { data, error } = await supabase
          .from('sop_templates').select('*').eq('id', id).single()
        if (error || !data) {
          toast.error('找不到此範本')
          navigate('/process/sop')
          return
        }
        const pd = data.permissions?.project || {}
        const loaded = {
          name: data.name || '',
          category: data.category || 'HR',
          description: data.description || '',
          status: data.status || 'draft',
          estimated_days: pd.estimated_days ?? 30,
          required_roles: Array.isArray(pd.required_roles) ? pd.required_roles : [],
          workflows: Array.isArray(pd.workflows) && pd.workflows.length > 0
            ? pd.workflows.map(wf => ({
                id: wf.id || newLocalId(),
                name: wf.name || '',
                steps: Array.isArray(wf.steps) && wf.steps.length > 0 ? wf.steps : [emptyStep()],
                depends_on: Array.isArray(wf.depends_on) ? wf.depends_on : [],
              }))
            : [emptyWorkflow()],
          milestones: Array.isArray(pd.milestones) ? pd.milestones : [],
        }
        setProj(loaded)
        setRolesText((loaded.required_roles || []).join('\n'))
      }
      setLoading(false)
    }
    fetchAll()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── State helper ─────────────────────────────────────────────────────────────
  const updateProj = useCallback(updater => {
    setProj(updater)
    setIsDirty(true)
  }, [])

  // ── Workflow operations ───────────────────────────────────────────────────────
  const addWorkflow = () => {
    const next = [...proj.workflows, emptyWorkflow()]
    updateProj(p => ({ ...p, workflows: next }))
    setExpandedWfIdx(next.length - 1)
    setActiveTab('workflows')
  }

  const updateWorkflow = (i, updated) => {
    updateProj(p => ({ ...p, workflows: p.workflows.map((w, j) => j === i ? updated : w) }))
  }

  const removeWorkflow = async (i) => {
    const name = proj.workflows[i]?.name || '（未命名）'
    const ok = await confirm({ message: `確定刪除工作流程「${name}」？此操作無法復原。` })
    if (!ok) return
    updateProj(p => {
      // Re-map depends_on: remove reference to deleted index, shift higher indices down
      const nextWfs = p.workflows
        .filter((_, j) => j !== i)
        .map(wf => ({
          ...wf,
          depends_on: (wf.depends_on || [])
            .filter(dep => dep !== i)
            .map(dep => dep > i ? dep - 1 : dep),
        }))
      return { ...p, workflows: nextWfs }
    })
    if (expandedWfIdx === i) setExpandedWfIdx(null)
    else if (expandedWfIdx !== null && expandedWfIdx > i) setExpandedWfIdx(x => x - 1)
  }

  // ── Milestone operations ──────────────────────────────────────────────────────
  const addMilestone = () => {
    updateProj(p => ({ ...p, milestones: [...p.milestones, emptyMilestone()] }))
    setActiveTab('milestones')
  }

  const updateMilestone = (i, field, value) => {
    updateProj(p => ({
      ...p,
      milestones: p.milestones.map((m, j) => j === i ? { ...m, [field]: value } : m),
    }))
  }

  const removeMilestone = (i) => {
    updateProj(p => ({ ...p, milestones: p.milestones.filter((_, j) => j !== i) }))
  }

  // ── Roles textarea ────────────────────────────────────────────────────────────
  const handleRolesText = (text) => {
    setRolesText(text)
    const roles = text.split('\n').map(r => r.trim()).filter(Boolean)
    updateProj(p => ({ ...p, required_roles: roles }))
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!proj.name.trim()) { toast.error('請填寫專案範本名稱'); return }
    if (!proj.workflows.some(w => w.name.trim())) {
      toast.error('至少需要一個有名稱的工作流程'); return
    }

    setSaving(true)
    try {
      const cleanWorkflows = proj.workflows.map(wf => ({
        id: wf.id,
        name: wf.name.trim(),
        depends_on: wf.depends_on || [],
        steps: (wf.steps || []).filter(s => s.title?.trim()).map(s => ({
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
        })),
      }))

      const projectData = {
        estimated_days: Number(proj.estimated_days) || 0,
        required_roles: proj.required_roles || [],
        workflows: cleanWorkflows,
        milestones: (proj.milestones || [])
          .map(m => ({ name: m.name.trim(), day_offset: Number(m.day_offset) || 0 }))
          .filter(m => m.name),
      }

      const payload = {
        type: 'project',
        name: proj.name.trim(),
        category: proj.category,
        description: proj.description?.trim() || null,
        status: proj.status || 'draft',
        tags: [],
        steps: [],  // project templates use permissions->project, not steps[]
        // Store all project structure in permissions column (no migration needed)
        permissions: { project: projectData },
        organization_id: profile?.organization_id || null,
      }

      if (id) {
        const { data, error } = await supabase
          .from('sop_templates').update(payload).eq('id', id).select().single()
        if (error) throw error
        toast.success(`專案範本「${data.name}」已更新`)
        setIsDirty(false)
      } else {
        const { data, error } = await supabase
          .from('sop_templates').insert(payload).select().single()
        if (error) throw error
        toast.success(`專案範本「${data.name}」已建立`)
        setIsDirty(false)
        navigate(`/process/sop/${data.id}/edit?type=project`, { replace: true })
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

  // ── Tabs ──────────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'workflows', label: '工作流程', count: proj.workflows.length },
    { id: 'milestones', label: '里程碑',   count: proj.milestones.length },
    { id: 'roles',      label: '成員角色', count: proj.required_roles.length },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
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
            {id ? `編輯：${proj.name || '（未命名）'}` : '新增專案範本'}
          </div>
          {isDirty && (
            <div style={{ fontSize: 11, color: 'var(--accent-orange)' }}>● 有未儲存的變更</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {proj.workflows.length} 個工作流程 · {proj.milestones.length} 個里程碑
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

      {/* ── Two-panel body ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left panel: basic settings + workflow outline ─────────────────── */}
        <div style={{
          width: 260, flexShrink: 0,
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}>
          {/* Basic settings block */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
            }}>
              專案設定
            </div>

            <Field label="專案範本名稱" required>
              <input
                className="form-input"
                type="text"
                style={{ width: '100%', fontSize: 13 }}
                placeholder="例：新店開幕計畫"
                value={proj.name}
                onChange={e => updateProj(p => ({ ...p, name: e.target.value }))}
              />
            </Field>

            <div style={{ marginTop: 8 }}>
              <Field label="分類">
                <select
                  className="form-input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={proj.category}
                  onChange={e => updateProj(p => ({ ...p, category: e.target.value }))}
                >
                  {categories.map(c => <option key={c}>{c}</option>)}
                  {proj.category && !categories.includes(proj.category) && (
                    <option value={proj.category}>{proj.category}</option>
                  )}
                </select>
              </Field>
            </div>

            <div style={{ marginTop: 8 }}>
              <Field label="說明">
                <textarea
                  className="form-input"
                  style={{ width: '100%', fontSize: 12, resize: 'vertical', minHeight: 58 }}
                  placeholder="專案範本用途說明"
                  value={proj.description}
                  onChange={e => updateProj(p => ({ ...p, description: e.target.value }))}
                />
              </Field>
            </div>

            <div style={{ marginTop: 8 }}>
              <Field label="預計天數">
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  style={{ width: '100%', fontSize: 12 }}
                  placeholder="30"
                  value={proj.estimated_days}
                  onChange={e => updateProj(p => ({ ...p, estimated_days: e.target.value }))}
                />
              </Field>
            </div>

            {/* Status toggle buttons */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
                狀態
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateProj(p => ({ ...p, status: opt.value }))}
                    style={{
                      flex: 1, padding: '4px 0', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', border: '1.5px solid',
                      borderColor: proj.status === opt.value ? opt.color : 'var(--border-subtle)',
                      background: proj.status === opt.value ? opt.dim : 'var(--bg-card)',
                      color: proj.status === opt.value ? opt.color : 'var(--text-muted)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Workflow outline list */}
          <div style={{ flex: 1, padding: '12px 16px' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 0.6,
              }}>
                工作流程
              </span>
              <span style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>{proj.workflows.length} 個</span>
            </div>

            {proj.workflows.map((wf, i) => {
              const isActive = expandedWfIdx === i && activeTab === 'workflows'
              return (
                <div
                  key={wf.id}
                  onClick={() => { setActiveTab('workflows'); setExpandedWfIdx(x => x === i ? null : i) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8, marginBottom: 5, cursor: 'pointer',
                    border: isActive ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                    background: isActive ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: isActive ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
                    color: isActive ? '#fff' : 'var(--text-muted)',
                    fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {wf.name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>（未命名）</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{wf.steps.length} 步驟</div>
                  </div>
                  {isActive
                    ? <ChevronDown size={13} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
                    : <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  }
                </div>
              )
            })}

            <button
              type="button"
              onClick={addWorkflow}
              style={{
                width: '100%', marginTop: 6, padding: '8px',
                borderRadius: 8, border: '1.5px dashed var(--border-medium)',
                background: 'none', color: 'var(--text-muted)', fontSize: 12,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}
            >
              <Plus size={13} /> 新增工作流程
            </button>
          </div>
        </div>

        {/* ── Right panel: tabbed content ──────────────────────────────────── */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          overflow: 'hidden', background: 'var(--bg-primary)',
        }}>
          {/* Tab bar */}
          <div style={{
            display: 'flex', gap: 0,
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
            flexShrink: 0,
          }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '10px 22px', border: 'none', borderBottom: '2.5px solid',
                  borderBottomColor: activeTab === tab.id ? 'var(--accent-cyan)' : 'transparent',
                  background: 'none', fontSize: 13,
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  color: activeTab === tab.id ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'color 0.15s, border-color 0.15s',
                }}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    background: activeTab === tab.id ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                    color: activeTab === tab.id ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    padding: '1px 6px', borderRadius: 10,
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Scrollable tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

            {/* ── 工作流程 tab ─────────────────────────────────────────────── */}
            {activeTab === 'workflows' && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                    工作流程列表
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    點選列表展開以編輯步驟與依賴關係，也可點選左欄流程名稱快速展開
                  </div>
                </div>

                {proj.workflows.length === 0 ? (
                  <div style={{
                    padding: '48px 0', textAlign: 'center',
                    color: 'var(--text-muted)', fontSize: 14,
                  }}>
                    尚無工作流程 — 點擊左側「+ 新增工作流程」開始建立
                  </div>
                ) : (
                  proj.workflows.map((wf, i) => (
                    <WorkflowRow
                      key={wf.id}
                      wf={wf}
                      index={i}
                      allWorkflows={proj.workflows}
                      onUpdate={updated => updateWorkflow(i, updated)}
                      onRemove={removeWorkflow}
                      isExpanded={expandedWfIdx === i}
                      onToggleExpand={() => setExpandedWfIdx(x => x === i ? null : i)}
                    />
                  ))
                )}

                <button
                  type="button"
                  onClick={addWorkflow}
                  style={{
                    marginTop: 8, padding: '9px 18px',
                    borderRadius: 8, border: '1.5px dashed var(--border-medium)',
                    background: 'none', color: 'var(--text-muted)', fontSize: 13,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <Plus size={14} /> 新增工作流程
                </button>
              </div>
            )}

            {/* ── 里程碑 tab ───────────────────────────────────────────────── */}
            {activeTab === 'milestones' && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                    里程碑
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    以專案開始日（第 0 天）為基準，填入各里程碑的預計達成天數
                  </div>
                </div>

                {/* Column headers */}
                {proj.milestones.length > 0 && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 140px 36px',
                    gap: 8, padding: '4px 0 8px',
                    fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: 0.4,
                  }}>
                    <span>里程碑名稱</span>
                    <span>第幾天</span>
                    <span></span>
                  </div>
                )}

                {proj.milestones.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 140px 36px',
                      gap: 8, alignItems: 'center', marginBottom: 8,
                    }}
                  >
                    <input
                      className="form-input"
                      type="text"
                      placeholder="例：裝修完成"
                      value={m.name}
                      onChange={e => updateMilestone(i, 'name', e.target.value)}
                      style={{ width: '100%', fontSize: 13 }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>第</span>
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        placeholder="0"
                        value={m.day_offset}
                        onChange={e => updateMilestone(i, 'day_offset', Number(e.target.value))}
                        style={{ width: '100%', fontSize: 13, textAlign: 'right' }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>天</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMilestone(i)}
                      style={{
                        background: 'none', border: 'none', padding: '4px',
                        color: 'var(--accent-red)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      title="刪除里程碑"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addMilestone}
                  style={{
                    marginTop: proj.milestones.length > 0 ? 4 : 0,
                    padding: '9px 18px',
                    borderRadius: 8, border: '1.5px dashed var(--border-medium)',
                    background: 'none', color: 'var(--text-muted)', fontSize: 13,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <Plus size={14} /> 新增里程碑
                </button>

                {/* Timeline preview */}
                {proj.milestones.length > 0 && (
                  <div style={{
                    marginTop: 24, padding: '14px 16px', borderRadius: 8,
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
                    }}>
                      時間軸預覽
                    </div>
                    {[...proj.milestones]
                      .sort((a, b) => a.day_offset - b.day_offset)
                      .map((m, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <div style={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            background: 'var(--accent-cyan)',
                            boxShadow: '0 0 0 2px var(--accent-cyan-dim)',
                          }} />
                          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {m.name || '（未命名）'}
                          </div>
                          <span style={{
                            fontSize: 11, fontWeight: 600, color: 'var(--accent-cyan)',
                            background: 'var(--accent-cyan-dim)', padding: '2px 10px', borderRadius: 10,
                          }}>
                            第 {m.day_offset} 天
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* ── 成員角色 tab ─────────────────────────────────────────────── */}
            {activeTab === 'roles' && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                    必要角色
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    部署此專案範本時，系統將提示指派這些角色。每行填入一個角色名稱。
                  </div>
                </div>

                <textarea
                  className="form-input"
                  rows={14}
                  placeholder={'例：\n展店督導\n法務主管\n採購部\n工程督導\n人資部'}
                  value={rolesText}
                  onChange={e => handleRolesText(e.target.value)}
                  style={{ width: '100%', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 }}
                />

                {proj.required_roles.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      共 {proj.required_roles.length} 個角色：
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {proj.required_roles.map((role, i) => (
                        <span
                          key={i}
                          style={{
                            padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                            background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)',
                          }}
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
