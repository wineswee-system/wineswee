import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ArrowRight, Settings, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'
import {
  findActiveChainByCategory, loadChainSteps,
  resolveFirstApprovers, approveChainStep, notifyApprovers,
} from '../../lib/hrChain'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildFormChainSteps } from '../../lib/buildChainSteps'
import { validateRequired, clearError } from '../../lib/formValidation'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { confirm } from '../../lib/confirm'
import { exportHeadcountRequestPdf } from '../../lib/exportPdf'

const JOB_TYPES = ['正職', '兼職', '約聘', '工讀', '實習']
const SALARY_TYPES = ['時薪', '月薪', '年薪', '日薪', '面議']

const STATUS_BADGE = {
  '申請中': { bg: 'rgba(99,102,241,0.12)', color: '#6366f1' },
  '已核准': { bg: 'rgba(34,197,94,0.12)',  color: 'var(--accent-green)' },
  '已駁回': { bg: 'rgba(239,68,68,0.12)',  color: 'var(--accent-red)' },
  '已取消': { bg: 'rgba(156,163,175,0.12)', color: 'var(--text-muted)' },
}

const EMPTY_FORM = {
  employee_id: '',
  applicant_dept_id: '',
  request_date: new Date().toISOString().slice(0, 10),
  need_dept_id: '',
  store_id: '',
  headcount: 1,
  new_reason: '',
  job_title: '',
  job_type: '正職',
  job_description: '',
  salary_type: '月薪',
  salary_range: '',
  management_resp: '',
  business_travel: '',
  work_shift: '',
  rest_policy: '',
  experience_required: '',
  education_required: '',
  major_required: '',
  tool_required: '',
  other_conditions: '',
}

export default function HeadcountRequest() {
  const { profile, role } = useAuth()
  const { canApprove } = usePendingApprovals()
  const navigate = useNavigate()
  const isAdmin = ['super_admin','admin','manager'].includes(role?.name || profile?.role)

  const [list, setList] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [chainSteps, setChainSteps] = useState({})
  const [activeChain, setActiveChain] = useState(null)
  const [organization, setOrganization] = useState(null)
  const [errors, setErrors] = useState({})
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM, employee_id: profile?.id || '' })
  const [reviewModal, setReviewModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editingId, setEditingId] = useState(null)

  const buildAndResolveChain = async (row) => {
    return buildFormChainSteps({
      formType: 'headcount',
      organizationId: profile?.organization_id,
      applicantName: row.employee?.name || '',
      applicantId: row.employee_id || row.employee?.id || null,
      applicantCreatedAt: row.created_at,
      recordStatus: row.status,
      approverName: row.approver?.name || row.approver,
      approvedAt: row.approved_at,
      rejectReason: row.reject_reason,
    })
  }

  const openDetail = async (row) => {
    detailRowIdRef.current = row.id
    setDetailRow(row)
    setLoadingChain(true)
    setDetailChainSteps([])
    const steps = await buildAndResolveChain(row)
    if (detailRowIdRef.current !== row.id) return
    setDetailChainSteps(steps)
    setLoadingChain(false)
  }

  const printWithChain = async (row) => {
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      const builtSteps = await buildAndResolveChain(row)
      const approverMap = {}
      builtSteps.forEach(s => { if (s.target_emp_id && s.name) approverMap[s.target_emp_id] = s.name })
      // 簽章 url 從 employees signature_url 帶入
      const signatures = Object.fromEntries(
        employees.filter(e => e.signature_url).map(e => [e.name, e.signature_url])
      )
      exportHeadcountRequestPdf(row, {
        companyName: organization?.name,
        logoUrl: organization?.logo_url,
        chainSteps: builtSteps,
        approverMap,
        signatures,
        _win: win,
      })
    } catch (e) {
      win.close()
      toast.error('產生簽呈失敗：' + (e.message || '未知錯誤'))
    }
  }

  const load = async () => {
    setLoading(true)
    let q = supabase.from('headcount_requests')
      .select('*, employee:employees!employee_id(id,name,name_en,department_id,position), approver:employees!approver_id(id,name,signature_url), need_dept:departments!need_dept_id(id,name), applicant_dept:departments!applicant_dept_id(id,name), store:stores!store_id(id,name)')
      .order('id', { ascending: false })
    if (!isAdmin && profile?.id) q = q.eq('employee_id', profile.id)
    const orgId = profile?.organization_id
    const [{ data: r }, { data: e }, { data: d }, { data: s }, chain, orgRes] = await Promise.all([
      q,
      supabase.from('employees').select('id,name,name_en,position,department_id,store_id,signature_url,departments!department_id(name)').eq('status','在職').order('name'),
      supabase.from('departments').select('id,name').eq('organization_id', orgId || 0).order('name'),
      supabase.from('stores').select('id,name').eq('organization_id', orgId || 0).order('name'),
      findActiveChainByCategory('人力需求', orgId),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setList(r || [])
    setEmployees(e || [])
    setDepartments(d || [])
    setStores(s || [])
    setActiveChain(chain)
    setOrganization(orgRes?.data || null)

    const uniqChainIds = [...new Set((r || []).map(x => x.approval_chain_id).filter(Boolean))]
    if (chain?.id) uniqChainIds.push(chain.id)
    const stepMap = {}
    await Promise.all([...new Set(uniqChainIds)].map(async (cid) => {
      stepMap[cid] = await loadChainSteps(cid)
    }))
    setChainSteps(stepMap)
    setLoading(false)
  }
  useEffect(() => { load() }, [profile?.id, isAdmin, profile?.organization_id])

  // Dashboard 跳轉 ?focus=ID 自動開明細
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !list.length) return
    const row = list.find(r => r.id === Number(focus))
    if (row) {
      openDetail(row)
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [list, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    const empId = isAdmin ? form.employee_id : profile?.id
    const validateForm = isAdmin
      ? { employee_id: empId, job_title: form.job_title, headcount: form.headcount }
      : { job_title: form.job_title, headcount: form.headcount }
    const validateKeys = isAdmin
      ? ['employee_id', 'job_title', 'headcount']
      : ['job_title', 'headcount']
    if (!validateRequired(validateForm, validateKeys, setErrors)) return

    const payload = {
      organization_id: profile?.organization_id || 1,
      employee_id: Number(empId),
      applicant_dept_id: form.applicant_dept_id ? Number(form.applicant_dept_id) : null,
      request_date: form.request_date || new Date().toISOString().slice(0, 10),
      need_dept_id: form.need_dept_id ? Number(form.need_dept_id) : null,
      store_id: form.store_id ? Number(form.store_id) : null,
      headcount: Number(form.headcount) || 1,
      new_reason: form.new_reason || null,
      job_title: form.job_title,
      job_type: form.job_type || null,
      job_description: form.job_description || null,
      salary_type: form.salary_type || null,
      salary_range: form.salary_range || null,
      management_resp: form.management_resp || null,
      business_travel: form.business_travel || null,
      work_shift: form.work_shift || null,
      rest_policy: form.rest_policy || null,
      experience_required: form.experience_required || null,
      education_required: form.education_required || null,
      major_required: form.major_required || null,
      tool_required: form.tool_required || null,
      other_conditions: form.other_conditions || null,
      status: '申請中',
      approval_chain_id: activeChain?.id || null,
      current_step: 0,
    }

    if (editingId) {
      const { error } = await supabase.from('headcount_requests')
        .update({ ...payload, reject_reason: null }).eq('id', editingId)
      if (error) return toast.error('更新失敗：' + error.message)
      setShowForm(false); setEditingId(null)
      setForm({ ...EMPTY_FORM, employee_id: profile?.id || '' })
      load()
      return
    }

    const { data: inserted, error } = await supabase.from('headcount_requests').insert(payload).select().single()
    if (error) return toast.error('送出失敗：' + error.message)

    if (activeChain?.id && inserted) {
      const approvers = await resolveFirstApprovers('headcount', inserted.id)
      if (approvers.length > 0) {
        const empName = employees.find(e => e.id === Number(empId))?.name || ''
        await notifyApprovers({
          approvers,
          title: `人力需求申請待簽核 — ${empName}`,
          message: `職務：${form.job_title}（${form.headcount} 人）`,
          type: 'form_submission',
          actionUrl: '/hr/forms/headcount',
          organizationId: profile?.organization_id,
        })
      } else {
        toast.warning('已送出，但找不到第一關簽核人', { description: '請確認簽核鏈設定' })
      }
    } else if (!activeChain) {
      toast.warning('已送出（目前無「人力需求」簽核鏈，admin 可直接核准）', {
        description: '建議到「簽核鏈設定」建立 category=人力需求 的鏈',
      })
    }

    setShowForm(false)
    setForm({ ...EMPTY_FORM, employee_id: profile?.id || '' })
    load()
  }

  const handleApprove = async (req) => {
    if (!(await confirm({ message: `核准「${req.job_title} × ${req.headcount}」這張人力需求？` }))) return
    const res = await approveChainStep({
      table: 'headcount', id: req.id,
      approverEmpId: profile?.id, action: 'approve',
    })
    if (!res?.ok) return toast.error('核准失敗：' + (res?.error || 'unknown'))
    if (res.event === 'advanced' && res.next_approvers?.length > 0) {
      await notifyApprovers({
        approvers: res.next_approvers,
        title: `人力需求申請待簽核 — ${req.employee?.name}`,
        message: `已通過第 ${res.advanced_to_step} 關前的簽核，輪到您`,
        type: 'form_submission',
        actionUrl: '/hr/forms/headcount',
        organizationId: profile?.organization_id,
      })
    }
    load()
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return toast.warning('請填駁回原因')
    const res = await approveChainStep({
      table: 'headcount', id: reviewModal.id,
      approverEmpId: profile?.id, action: 'reject', reason: rejectReason,
    })
    if (!res?.ok) return toast.error('駁回失敗：' + (res?.error || 'unknown'))
    setReviewModal(null)
    setRejectReason('')
    load()
  }

  const handleCancel = async (req) => {
    if (!(await confirm({ message: '確定取消此申請？' }))) return
    await supabase.from('headcount_requests').update({ status: '已取消' }).eq('id', req.id)
    load()
  }

  const formattedEmpOptions = useMemo(() => empOptions(employees), [employees])

  if (loading) return <LoadingSpinner />

  const canIApprove = (req) => canApprove('headcount_requests', req.id)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>人力需求申請</h2>
            <p>
              共 {list.length} 筆 · 申請中 {list.filter(r => r.status === '申請中').length} 筆
              {activeChain
                ? <span style={{ marginLeft: 8, color: 'var(--accent-cyan)', fontSize: 12 }}>· 簽核鏈：{activeChain.name}（{(chainSteps[activeChain.id] || []).length} 關）</span>
                : <span style={{ marginLeft: 8, color: 'var(--accent-orange)', fontSize: 12 }}>· ⚠ 無簽核鏈，admin 可直接核准</span>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(role?.name === 'super_admin' || role?.name === 'admin') && (
              <button className="btn btn-secondary"
                onClick={() => navigate('/process/settings/chains/edit?formType=headcount&label=人力需求')}
                title="設定人力需求簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> 新增申請</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>表單編號</th>
                <th>申請人</th>
                <th>需求部門</th>
                <th>需求門市</th>
                <th>職務 / 性質</th>
                <th>需求人數</th>
                <th>申請日</th>
                <th>簽核進度</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無人力需求申請</td></tr>
              )}
              {list.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                const steps = chainSteps[r.approval_chain_id] || []
                const canCancel = r.status === '申請中' && (r.employee_id === profile?.id || isAdmin)
                return (
                  <tr key={r.id} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細"
                    onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--bg-secondary)'}
                    onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.form_no || `#${r.id}`}</td>
                    <td><b>{r.employee?.name}</b>{r.employee?.name_en ? ` ${r.employee.name_en}` : ''}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.applicant_dept?.name || '—'}</div></td>
                    <td>{r.need_dept?.name || '—'}</td>
                    <td>{r.store?.name || '—'}</td>
                    <td>{r.job_title}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.job_type || '—'}</div></td>
                    <td style={{ textAlign: 'center' }}>{r.headcount} 人</td>
                    <td style={{ fontSize: 12 }}>{r.request_date || r.created_at?.slice(0, 10)}</td>
                    <td>
                      {steps.length === 0 ? (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>無鏈</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                          {steps.map((st, idx) => (
                            <span key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              {idx > 0 && <ArrowRight size={9} style={{ color: 'var(--text-muted)' }} />}
                              <span style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                                background: idx < (r.current_step || 0) ? 'var(--accent-green-dim)' :
                                            idx === (r.current_step || 0) && r.status === '申請中' ? 'var(--accent-orange-dim)' :
                                            'var(--glass-light)',
                                color: idx < (r.current_step || 0) ? 'var(--accent-green)' :
                                       idx === (r.current_step || 0) && r.status === '申請中' ? 'var(--accent-orange)' :
                                       'var(--text-muted)',
                              }} title={st.role_name || ''}>
                                {st.label || `第${idx + 1}關`}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td><span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{r.status}</span>{r.reject_reason && <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>{r.reject_reason}</div>}</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canIApprove(r) && (
                          <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>點明細簽核</span>
                        )}
                        {canCancel && (
                          <AsyncButton className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleCancel(r)} busyLabel="處理中…">取消</AsyncButton>
                        )}
                        {['申請中','已駁回','已退回'].includes(r.status) && r.employee_id === profile?.id && (
                          <button className="btn btn-sm btn-primary" style={{ fontSize: 11, padding: '3px 8px', background: 'var(--accent-orange)' }}
                            onClick={() => {
                              setEditingId(r.id)
                              setForm({
                                employee_id: r.employee_id,
                                applicant_dept_id: r.applicant_dept_id || '',
                                request_date: r.request_date || new Date().toISOString().slice(0, 10),
                                need_dept_id: r.need_dept_id || '',
                                store_id: r.store_id || '',
                                headcount: r.headcount || 1,
                                new_reason: r.new_reason || '',
                                job_title: r.job_title || '',
                                job_type: r.job_type || '正職',
                                job_description: r.job_description || '',
                                salary_type: r.salary_type || '月薪',
                                salary_range: r.salary_range || '',
                                management_resp: r.management_resp || '',
                                business_travel: r.business_travel || '',
                                work_shift: r.work_shift || '',
                                rest_policy: r.rest_policy || '',
                                experience_required: r.experience_required || '',
                                education_required: r.education_required || '',
                                major_required: r.major_required || '',
                                tool_required: r.tool_required || '',
                                other_conditions: r.other_conditions || '',
                              })
                              setShowForm(true)
                            }}>✏️ {['已駁回','已退回'].includes(r.status) ? '編輯重送' : '編輯'}</button>
                        )}
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} title="下載簽呈"
                          onClick={() => printWithChain(r)}>
                          <Printer size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal
          title={editingId ? '✏️ 編輯人力需求申請' : '新增人力需求申請'}
          onClose={() => { setShowForm(false); setErrors({}); setEditingId(null) }}
          onSubmit={handleSubmit}
          submitLabel={editingId ? '更新送出' : '送出申請'}
          maxWidth={760}
        >
          {/* 區塊 1：基本資訊 */}
          <SectionTitle>📋 基本資訊</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label={isAdmin ? '申請人 *' : '申請人'} error={errors.employee_id} errorMsg="請選擇員工">
              {isAdmin ? (
                <SearchableSelect
                  value={form.employee_id}
                  onChange={(v) => { setForm(f => ({ ...f, employee_id: v || '' })); clearError('employee_id', setErrors) }}
                  options={formattedEmpOptions}
                  placeholder="搜尋員工姓名/職稱..."
                />
              ) : (
                <input className="form-input" style={{ width: '100%' }} value={`${profile?.name || ''}${profile?.name_en ? ' ' + profile.name_en : ''}`} disabled />
              )}
            </Field>
            <Field label="申請日期">
              <input className="form-input" type="date" style={{ width: '100%' }}
                value={form.request_date}
                onChange={e => setForm(f => ({ ...f, request_date: e.target.value }))} />
            </Field>
            <Field label="申請人部門">
              <select className="form-input" style={{ width: '100%' }}
                value={form.applicant_dept_id}
                onChange={e => setForm(f => ({ ...f, applicant_dept_id: e.target.value }))}>
                <option value="">—</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="需求部門">
              <select className="form-input" style={{ width: '100%' }}
                value={form.need_dept_id}
                onChange={e => setForm(f => ({ ...f, need_dept_id: e.target.value }))}>
                <option value="">—</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="需求門市">
              <select className="form-input" style={{ width: '100%' }}
                value={form.store_id}
                onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))}>
                <option value="">—（後勤需求不指定）</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="需求人數 *" required error={errors.headcount} errorMsg="請填寫人數">
              <input className="form-input" type="number" min="1" style={{ width: '100%' }}
                value={form.headcount}
                onChange={e => { setForm(f => ({ ...f, headcount: e.target.value })); clearError('headcount', setErrors) }} />
            </Field>
            <Field label="新增人力原因" wide>
              <textarea className="form-input" rows={2} style={{ width: '100%' }}
                placeholder="例：六張犁店人員流動需補人"
                value={form.new_reason}
                onChange={e => setForm(f => ({ ...f, new_reason: e.target.value }))} />
            </Field>
          </div>

          {/* 區塊 2：職務資訊 */}
          <SectionTitle>💼 職務資訊</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="職務名稱 *" required error={errors.job_title} errorMsg="請填寫職務名稱">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：PT / 業務助理 / 工程師"
                value={form.job_title}
                onChange={e => { setForm(f => ({ ...f, job_title: e.target.value })); clearError('job_title', setErrors) }} />
            </Field>
            <Field label="職務性質">
              <select className="form-input" style={{ width: '100%' }}
                value={form.job_type}
                onChange={e => setForm(f => ({ ...f, job_type: e.target.value }))}>
                {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="職務說明">
              <textarea className="form-input" rows={2} style={{ width: '100%' }}
                placeholder="工作內容、職責範圍..."
                value={form.job_description}
                onChange={e => setForm(f => ({ ...f, job_description: e.target.value }))} />
            </Field>
            <Field label="管理責任">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：不需負擔管理責任 / 帶 3 人團隊"
                value={form.management_resp}
                onChange={e => setForm(f => ({ ...f, management_resp: e.target.value }))} />
            </Field>
            <Field label="出差外派">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：無 / 偶爾出差 / 常駐外派"
                value={form.business_travel}
                onChange={e => setForm(f => ({ ...f, business_travel: e.target.value }))} />
            </Field>
          </div>

          {/* 區塊 3：待遇 */}
          <SectionTitle>💰 待遇</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="工作待遇">
              <select className="form-input" style={{ width: '100%' }}
                value={form.salary_type}
                onChange={e => setForm(f => ({ ...f, salary_type: e.target.value }))}>
                {SALARY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="金額區間">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：220 / 35000~45000 / 面議"
                value={form.salary_range}
                onChange={e => setForm(f => ({ ...f, salary_range: e.target.value }))} />
            </Field>
          </div>

          {/* 區塊 4：班別 */}
          <SectionTitle>🕐 班別</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="上班時段">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：排班 / 09:00-18:00"
                value={form.work_shift}
                onChange={e => setForm(f => ({ ...f, work_shift: e.target.value }))} />
            </Field>
            <Field label="休假制度">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：排休 / 週休二日"
                value={form.rest_policy}
                onChange={e => setForm(f => ({ ...f, rest_policy: e.target.value }))} />
            </Field>
          </div>

          {/* 區塊 5：求職條件 */}
          <SectionTitle>📌 求職條件</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="工作經驗">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：不拘 / 3 年以上"
                value={form.experience_required}
                onChange={e => setForm(f => ({ ...f, experience_required: e.target.value }))} />
            </Field>
            <Field label="學歷要求">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：不拘 / 大學以上"
                value={form.education_required}
                onChange={e => setForm(f => ({ ...f, education_required: e.target.value }))} />
            </Field>
            <Field label="科系要求">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：不限 / 商管科系"
                value={form.major_required}
                onChange={e => setForm(f => ({ ...f, major_required: e.target.value }))} />
            </Field>
            <Field label="擅長工具">
              <input className="form-input" type="text" style={{ width: '100%' }}
                placeholder="例：Excel / PhotoShop / Python"
                value={form.tool_required}
                onChange={e => setForm(f => ({ ...f, tool_required: e.target.value }))} />
            </Field>
          </div>
          <Field label="其他條件">
            <textarea className="form-input" rows={3} style={{ width: '100%' }}
              placeholder="例：早班 PT 11-15 或 18／晚班 PT 18 或 19-00 或 01／各 1"
              value={form.other_conditions}
              onChange={e => setForm(f => ({ ...f, other_conditions: e.target.value }))} />
          </Field>

          {activeChain && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>送出後將進入簽核流程：{activeChain.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>申請人</span>
                {(chainSteps[activeChain.id] || []).map((st) => (
                  <span key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ArrowRight size={11} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border-medium)' }}>{st.label || st.role_name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}

      {reviewModal && (
        <Modal title={`駁回 — ${reviewModal.employee?.name}`} onClose={() => { setReviewModal(null); setRejectReason('') }} onSubmit={handleReject} submitLabel="確認駁回">
          <Field label="駁回原因">
            <textarea className="form-input" rows={3} style={{ width: '100%' }} placeholder="請說明駁回原因（員工會收到）" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </Field>
        </Modal>
      )}

      {detailRow && (
        <ApprovalDetailModal
          open={!!detailRow}
          onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
          docTitle="人力需求申請"
          docNo={detailRow.form_no || detailRow.id}
          status={detailRow.status}
          applicant={{
            name: detailRow.employee?.name || '',
            name_en: detailRow.employee?.name_en,
            position: detailRow.employee?.position,
            dept: detailRow.applicant_dept?.name,
            status: '在職',
          }}
          fields={[
            { label: '需求部門', value: detailRow.need_dept?.name || '—' },
            { label: '需求門市', value: detailRow.store?.name || '—' },
            { label: '需求人數', value: `${detailRow.headcount} 人` },
            { label: '職務名稱', value: detailRow.job_title },
            { label: '職務性質', value: detailRow.job_type || '—' },
            { label: '職務說明', value: detailRow.job_description, multiline: true },
            { label: '新增人力原因', value: detailRow.new_reason, multiline: true },
            { label: '工作待遇', value: detailRow.salary_type ? `${detailRow.salary_type}　${detailRow.salary_range || ''}` : '—' },
            { label: '管理責任', value: detailRow.management_resp || '—' },
            { label: '出差外派', value: detailRow.business_travel || '—' },
            { label: '上班時段', value: detailRow.work_shift || '—' },
            { label: '休假制度', value: detailRow.rest_policy || '—' },
            { label: '工作經驗', value: detailRow.experience_required || '—' },
            { label: '學歷要求', value: detailRow.education_required || '—' },
            { label: '科系要求', value: detailRow.major_required || '—' },
            { label: '擅長工具', value: detailRow.tool_required || '—' },
            { label: '其他條件', value: detailRow.other_conditions, multiline: true },
            ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
          ].filter(f => f.value)}
          attachments={detailRow.attachment_url ? [{ url: detailRow.attachment_url, name: detailRow.attachment_url.split('/').pop() }] : []}
          createdAt={detailRow.created_at}
          chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
          onPrint={() => printWithChain(detailRow)}
          actions={
            detailRow.status === '申請中' && canIApprove(detailRow) ? {
              sourceTable: 'headcount_requests',
              row: { ...detailRow, employee_id: detailRow.employee?.id || detailRow.employee_id },
              onApprove: async () => handleApprove(detailRow),
              onReject: async (_r, reason) => {
                const res = await approveChainStep({
                  table: 'headcount', id: detailRow.id,
                  approverEmpId: profile?.id, action: 'reject', reason,
                })
                if (!res?.ok) toast.error('駁回失敗：' + (res?.error || 'unknown'))
              },
              onChanged: () => { load(); setDetailRow(null) },
              rejectLabel: '駁回',
            } : null
          }
        />
      )}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{
      marginTop: 16, marginBottom: 8,
      fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)',
      borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4,
    }}>{children}</div>
  )
}
