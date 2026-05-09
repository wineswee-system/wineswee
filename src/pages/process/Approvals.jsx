import { useState, useEffect } from 'react'
import { toast } from '../../lib/toast'
import {
  Plus, ArrowLeft, Check, CheckCircle2, XCircle, ChevronRight,
  User, ClipboardCheck,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import {
  getApprovalChains, updateApprovalForm, updateApprovalFormStep,
  createApprovalForm, createApprovalFormSteps,
} from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

// ── Color maps ─────────────────────────────────────────────
const STATUS_COLOR = {
  '待簽': 'var(--accent-orange)',
  '簽核中': 'var(--accent-cyan)',
  '已通過': 'var(--accent-green)',
  '已退回': 'var(--accent-red)',
}
const STATUS_BG = {
  '待簽': 'var(--accent-orange-dim)',
  '簽核中': 'var(--accent-cyan-dim)',
  '已通過': 'var(--accent-green-dim)',
  '已退回': 'var(--accent-red-dim)',
}
const PRIORITY_COLOR = { '低': 'var(--accent-green)', '中': 'var(--accent-orange)', '高': 'var(--accent-red)' }
const PRIORITY_BG = { '低': 'var(--accent-green-dim)', '中': 'var(--accent-orange-dim)', '高': 'var(--accent-red-dim)' }
const STEP_STATUS_COLOR = {
  '待簽': 'var(--accent-orange)',
  '已核准': 'var(--accent-green)',
  '已退回': 'var(--accent-red)',
  '等待中': 'var(--border-medium)',
}

function StatusBadge({ status }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
      background: STATUS_BG[status] || 'var(--bg-secondary)',
      color: STATUS_COLOR[status] || 'var(--text-muted)',
    }}>{status}</span>
  )
}

function PriorityBadge({ priority }) {
  if (!priority) return null
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: PRIORITY_BG[priority] || 'var(--bg-secondary)',
      color: PRIORITY_COLOR[priority] || 'var(--text-muted)',
    }}>{priority}</span>
  )
}

function StepsProgress({ steps }) {
  if (!steps.length) return null
  const done = steps.filter(s => s.status === '已核准').length
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {steps.map((s, i) => (
        <div key={i} style={{
          width: 20, height: 4, borderRadius: 2,
          background:
            s.status === '已核准' ? 'var(--accent-green)' :
            s.status === '已退回' ? 'var(--accent-red)' :
            s.status === '待簽' ? 'var(--accent-orange)' : 'var(--border-medium)',
        }} />
      ))}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>{done}/{steps.length}</span>
    </div>
  )
}

function FormListItem({ form, onSelect }) {
  const steps = form.steps || []
  return (
    <div
      className="card"
      style={{ marginBottom: 10, padding: '14px 16px', cursor: 'pointer' }}
      onClick={() => onSelect(form)}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = ''}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {form.title}
            </span>
            <StatusBadge status={form.status} />
            <PriorityBadge priority={form.priority} />
            {form.ref_task_id && (
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 4,
                background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', fontWeight: 600,
              }}>任務關聯</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            {form.applicant && <span>申請人：{form.applicant}</span>}
            {form.store && <span>門市：{form.store}</span>}
            <span>{form.created_at?.slice(0, 10)}</span>
          </div>
        </div>
        {steps.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <StepsProgress steps={steps} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────
export default function Approvals() {
  const { profile, isAdmin, isSuperAdmin } = useAuth()
  const currentUser = profile?.name || ''
  const currentPosition = profile?.position || ''

  const [forms, setForms] = useState([])
  const [approvalChains, setApprovalChains] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('pending')
  const [selectedForm, setSelectedForm] = useState(null)

  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createFormData, setCreateFormData] = useState({ title: '', chain_id: '', priority: '中', mode: 'sequential', store: '', notes: '' })
  const [creating, setCreating] = useState(false)

  const [actionStepId, setActionStepId] = useState(null)
  const [actionComment, setActionComment] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const orgId = profile?.organization_id || null

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [formsRes, stepsRes, chainsRes, storesRes] = await Promise.all([
        supabase.from('approval_forms').select('*').order('created_at', { ascending: false }),
        supabase.from('approval_form_steps').select('*').order('step_order'),
        getApprovalChains(orgId),
        supabase.from('stores').select('id, name').order('name'),
      ])
      if (formsRes.error) throw formsRes.error
      if (stepsRes.error) throw stepsRes.error
      const stepsMap = {}
      for (const s of (stepsRes.data || [])) {
        if (!stepsMap[s.form_id]) stepsMap[s.form_id] = []
        stepsMap[s.form_id].push(s)
      }
      const rawForms = (formsRes.data || []).map(f => ({
        ...f,
        steps: (stepsMap[f.id] || []).sort((a, b) => (a.step_order || 0) - (b.step_order || 0)),
      }))
      setForms(rawForms)
      setApprovalChains(chainsRes.data || [])
      setStores(storesRes.data || [])
    } catch (err) {
      setError('資料載入失敗：' + (err?.message || err?.code || '未知錯誤'))
    } finally {
      setLoading(false)
    }
  }

  // ── Tab buckets ────────────────────────────────────────
  const pendingForms = forms.filter(f => {
    if (f.status !== '待簽' && f.status !== '簽核中') return false
    if (isAdmin || isSuperAdmin) return true
    return (f.steps || []).some(s =>
      s.status === '待簽' &&
      (s.role === currentPosition || s.role === currentUser || s.approver === currentUser)
    )
  })
  const mineForms = forms.filter(f => f.applicant === currentUser)
  const completedForms = forms.filter(f => f.status === '已通過' || f.status === '已退回')

  const getTabForms = () => {
    let base = tab === 'pending' ? pendingForms
      : tab === 'mine' ? mineForms
      : tab === 'completed' ? completedForms
      : forms
    if (filterStatus) base = base.filter(f => f.status === filterStatus)
    if (filterPriority) base = base.filter(f => f.priority === filterPriority)
    return base
  }

  // ── Create ─────────────────────────────────────────────
  const handleCreate = async () => {
    if (!createFormData.title.trim()) { toast.warning('請填寫簽核主旨'); return }
    if (!createFormData.chain_id) { toast.warning('請選擇簽核鏈'); return }
    setCreating(true)
    try {
      const chain = approvalChains.find(c => c.id === Number(createFormData.chain_id))
      const { data: form, error: formErr } = await createApprovalForm({
        title: createFormData.title.trim(),
        applicant: currentUser || null,
        chain_id: Number(createFormData.chain_id),
        store: createFormData.store || null,
        status: '待簽',
        priority: createFormData.priority,
        mode: createFormData.mode,
        form_data: { notes: createFormData.notes || null },
        organization_id: orgId,
        current_step: 1,
      })
      if (formErr) throw formErr
      if (form && chain?.steps?.length) {
        const stepRows = chain.steps.map((s, i) => ({
          form_id: form.id,
          step_order: i + 1,
          role: s.label || s.role || '',
          status: i === 0 ? '待簽' : (createFormData.mode === 'parallel' ? '待簽' : '等待中'),
        }))
        await createApprovalFormSteps(stepRows)
      }
      setShowCreateModal(false)
      setCreateFormData({ title: '', chain_id: '', priority: '中', mode: 'sequential', store: '', notes: '' })
      await loadData()
    } catch (err) {
      toast.error('建立失敗：' + (err.message || '未知'))
    } finally {
      setCreating(false)
    }
  }

  // ── Approve / Reject ───────────────────────────────────
  const handleApproveStep = async (formId, stepId, action, comment) => {
    setActionLoading(true)
    try {
      const newStatus = action === 'approve' ? '已核准' : '已退回'
      await updateApprovalFormStep(stepId, {
        status: newStatus,
        approver: currentUser,
        comment: comment || null,
        acted_at: new Date().toISOString(),
      })

      const form = forms.find(f => f.id === formId)
      const updatedSteps = (form?.steps || []).map(s =>
        s.id === stepId ? { ...s, status: newStatus } : s
      )

      if (action === 'reject') {
        await updateApprovalForm(formId, { status: '已退回', completed_at: new Date().toISOString() })
        if (form?.ref_task_id) {
          await supabase.from('tasks').update({ status: '進行中', completed_at: null }).eq('id', form.ref_task_id)
        }
      } else {
        const mode = form?.mode || 'sequential'
        if (mode === 'parallel') {
          if (updatedSteps.every(s => s.status === '已核准')) {
            await updateApprovalForm(formId, { status: '已通過', completed_at: new Date().toISOString() })
            if (form?.ref_task_id) {
              await supabase.from('tasks').update({ status: '已完成', completed_at: new Date().toISOString() }).eq('id', form.ref_task_id)
            }
          }
        } else {
          const sorted = [...updatedSteps].sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
          const nextStep = sorted.find(s => s.status === '等待中')
          if (nextStep) {
            await updateApprovalFormStep(nextStep.id, { status: '待簽' })
            await updateApprovalForm(formId, { status: '簽核中', current_step: nextStep.step_order })
          } else {
            const allApproved = sorted.every(s => s.status === '已核准')
            await updateApprovalForm(formId, {
              status: allApproved ? '已通過' : '已退回',
              completed_at: new Date().toISOString(),
            })
            if (form?.ref_task_id) {
              if (allApproved) {
                await supabase.from('tasks').update({ status: '已完成', completed_at: new Date().toISOString() }).eq('id', form.ref_task_id)
              } else {
                await supabase.from('tasks').update({ status: '進行中', completed_at: null }).eq('id', form.ref_task_id)
              }
            }
          }
        }
      }

      setActionStepId(null)
      setActionComment('')
      await loadData()
    } catch (err) {
      toast.error('操作失敗：' + (err.message || '未知'))
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  // ══ Detail View ═══════════════════════════════════════════
  if (selectedForm) {
    const form = forms.find(f => f.id === selectedForm.id) || selectedForm
    const steps = form.steps || []
    const chain = approvalChains.find(c => c.id === form.chain_id)

    const canActStep = (step) => {
      if (step.status !== '待簽') return false
      if (form.status === '已通過' || form.status === '已退回') return false
      return (
        step.role === currentPosition ||
        step.role === currentUser ||
        isAdmin || isSuperAdmin
      )
    }

    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-header-row">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button
                onClick={() => setSelectedForm(null)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                  fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', marginBottom: 4,
                }}
              >
                <ArrowLeft size={14} /> 返回簽核管理
              </button>
              <h2>
                <span className="header-icon">
                  <ClipboardCheck size={20} style={{ display: 'inline', verticalAlign: 'middle' }} />
                </span>{' '}
                {form.title}
              </h2>
              <p style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {chain?.name && <span style={{ color: 'var(--text-muted)' }}>{chain.name}</span>}
                <StatusBadge status={form.status} />
                <PriorityBadge priority={form.priority} />
                {form.mode === 'parallel' && (
                  <span style={{
                    fontSize: 11, padding: '2px 7px', borderRadius: 4,
                    background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', fontWeight: 600,
                  }}>平行審核</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 13, padding: '14px 20px' }}>
          {form.applicant && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>申請人</div>
              <div style={{ fontWeight: 600 }}>{form.applicant}</div>
            </div>
          )}
          {form.store && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>門市</div>
              <div style={{ fontWeight: 600 }}>{form.store}</div>
            </div>
          )}
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>建立時間</div>
            <div style={{ fontWeight: 600 }}>{form.created_at?.slice(0, 16).replace('T', ' ')}</div>
          </div>
          {form.completed_at && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>完成時間</div>
              <div style={{ fontWeight: 600 }}>{form.completed_at.slice(0, 16).replace('T', ' ')}</div>
            </div>
          )}
          {form.form_data?.notes && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>備註</div>
              <div style={{ fontWeight: 600 }}>{form.form_data.notes}</div>
            </div>
          )}
          {form.ref_task_id && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>關聯任務</div>
              <div style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>任務 #{form.ref_task_id}</div>
            </div>
          )}
        </div>

        {/* Steps timeline */}
        <div className="card" style={{ padding: '20px 24px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 20, color: 'var(--text-secondary)' }}>簽核流程</h3>
          {steps.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>此簽核單尚無步驟記錄。</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {steps.map((step, idx) => {
                const isActive = canActStep(step)
                const isActing = actionStepId === step.id
                const statusColor = STEP_STATUS_COLOR[step.status] || 'var(--text-muted)'

                return (
                  <div key={step.id} style={{ display: 'flex', gap: 16 }}>
                    {/* Circle + connector line */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32, flexShrink: 0 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background:
                          step.status === '已核准' ? 'var(--accent-green-dim)' :
                          step.status === '已退回' ? 'var(--accent-red-dim)' :
                          step.status === '待簽' ? 'var(--accent-orange-dim)' : 'var(--bg-secondary)',
                        border: `2px solid ${statusColor}`,
                        fontSize: 12, fontWeight: 800, color: statusColor,
                      }}>
                        {step.status === '已核准' ? '✓' : step.status === '已退回' ? '✕' : step.step_order}
                      </div>
                      {idx < steps.length - 1 && (
                        <div style={{ width: 2, flex: 1, minHeight: 24, background: 'var(--border-subtle)', margin: '2px 0' }} />
                      )}
                    </div>

                    {/* Step content */}
                    <div style={{ flex: 1, paddingBottom: idx < steps.length - 1 ? 20 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{step.role || `第 ${step.step_order} 關`}</span>
                        <span style={{
                          fontSize: 11, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                          background:
                            step.status === '已核准' ? 'var(--accent-green-dim)' :
                            step.status === '已退回' ? 'var(--accent-red-dim)' :
                            step.status === '待簽' ? 'var(--accent-orange-dim)' : 'var(--bg-secondary)',
                          color: statusColor,
                        }}>{step.status}</span>
                        {isActive && !isActing && (
                          <span style={{
                            fontSize: 11, padding: '2px 7px', borderRadius: 4,
                            background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 700,
                          }}>待您審核</span>
                        )}
                      </div>

                      {step.approver && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <User size={11} />
                          {step.approver}
                          {step.acted_at && ` · ${step.acted_at.slice(0, 10)}`}
                        </div>
                      )}

                      {step.comment && (
                        <div style={{
                          fontSize: 12, color: 'var(--text-secondary)', padding: '8px 12px',
                          background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: 8, fontStyle: 'italic',
                        }}>
                          「{step.comment}」
                        </div>
                      )}

                      {isActive && !isActing && (
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 12, padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}
                          onClick={() => setActionStepId(step.id)}
                        >
                          <Check size={13} /> 審核此步驟
                        </button>
                      )}

                      {isActing && (
                        <div style={{
                          marginTop: 8, padding: '14px 16px',
                          background: 'var(--bg-secondary)', borderRadius: 8,
                          border: '1px solid var(--border-medium)',
                        }}>
                          <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                              審核意見（選填）
                            </label>
                            <textarea
                              value={actionComment}
                              onChange={e => setActionComment(e.target.value)}
                              rows={2}
                              className="form-input"
                              style={{ width: '100%', fontSize: 13 }}
                              placeholder="輸入核准 / 退回的說明..."
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                              disabled={actionLoading}
                              onClick={() => handleApproveStep(form.id, step.id, 'approve', actionComment)}
                            >
                              <CheckCircle2 size={13} /> 核准
                            </button>
                            <button
                              disabled={actionLoading}
                              onClick={() => handleApproveStep(form.id, step.id, 'reject', actionComment)}
                              style={{
                                fontSize: 12, padding: '6px 14px', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 6, borderRadius: 6,
                                background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
                                border: '1px solid var(--accent-red)', fontWeight: 600,
                              }}
                            >
                              <XCircle size={13} /> 退回
                            </button>
                            <button
                              onClick={() => { setActionStepId(null); setActionComment('') }}
                              style={{
                                fontSize: 12, padding: '6px 14px', cursor: 'pointer',
                                borderRadius: 6, background: 'none',
                                border: '1px solid var(--border-medium)', color: 'var(--text-muted)',
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ══ List View ═════════════════════════════════════════════
  const tabForms = getTabForms()

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">✍️</span> 簽核管理</h2>
            <p>管理簽核表單及審核流程</p>
          </div>
          <button
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={15} /> 新增簽核單
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 20, padding: '14px 20px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>狀態</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 130 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">全部狀態</option>
            {['待簽', '簽核中', '已通過', '已退回'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>優先級</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 100 }} value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
            <option value="">全部</option>
            {['低', '中', '高'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { key: 'pending', label: `🔔 待我簽核 (${pendingForms.length})` },
          { key: 'mine', label: `📋 我發起的 (${mineForms.length})` },
          { key: 'completed', label: `✅ 已完成 (${completedForms.length})` },
          { key: 'all', label: `📄 全部 (${forms.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 8,
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            border: tab === t.key ? 'none' : '1px solid var(--border-medium)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* List */}
      {tabForms.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {tab === 'pending' && '目前沒有待您審核的簽核單。'}
          {tab === 'mine' && '您尚未發起任何簽核單。'}
          {tab === 'completed' && '尚無已完成的簽核單。'}
          {tab === 'all' && '尚無任何簽核單。點擊「新增簽核單」開始建立。'}
        </div>
      ) : (
        tabForms.map(form => (
          <FormListItem key={form.id} form={form} onSelect={setSelectedForm} />
        ))
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20,
          }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-card)', borderRadius: 12, padding: '28px 32px',
              width: '100%', maxWidth: 520, border: '1px solid var(--border-medium)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: 20, fontSize: 16, fontWeight: 700 }}>新增簽核單</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>主旨 *</label>
                <input
                  className="form-input" style={{ width: '100%' }}
                  value={createFormData.title}
                  onChange={e => setCreateFormData(f => ({ ...f, title: e.target.value }))}
                  placeholder="請輸入簽核主旨"
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>簽核鏈 *</label>
                <select
                  className="form-input" style={{ width: '100%' }}
                  value={createFormData.chain_id}
                  onChange={e => setCreateFormData(f => ({ ...f, chain_id: e.target.value }))}
                >
                  <option value="">請選擇簽核鏈</option>
                  {approvalChains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>優先級</label>
                  <select
                    className="form-input" style={{ width: '100%' }}
                    value={createFormData.priority}
                    onChange={e => setCreateFormData(f => ({ ...f, priority: e.target.value }))}
                  >
                    {['低', '中', '高'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>審核模式</label>
                  <select
                    className="form-input" style={{ width: '100%' }}
                    value={createFormData.mode}
                    onChange={e => setCreateFormData(f => ({ ...f, mode: e.target.value }))}
                  >
                    <option value="sequential">逐步審核</option>
                    <option value="parallel">平行審核</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>門市</label>
                <select
                  className="form-input" style={{ width: '100%' }}
                  value={createFormData.store}
                  onChange={e => setCreateFormData(f => ({ ...f, store: e.target.value }))}
                >
                  <option value="">不指定</option>
                  {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>備註</label>
                <textarea
                  className="form-input" style={{ width: '100%' }} rows={2}
                  value={createFormData.notes}
                  onChange={e => setCreateFormData(f => ({ ...f, notes: e.target.value }))}
                  placeholder="選填"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button
                style={{
                  padding: '8px 18px', borderRadius: 7, background: 'none',
                  border: '1px solid var(--border-medium)', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 13,
                }}
                onClick={() => setShowCreateModal(false)}
              >
                取消
              </button>
              <button className="btn btn-primary" disabled={creating} onClick={handleCreate}>
                {creating ? '建立中...' : '建立簽核單'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
