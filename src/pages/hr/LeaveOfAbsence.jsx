import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ArrowRight, Settings, Search, X as XIcon } from 'lucide-react'
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

// 留職停薪原因類型（對齊 DB schema 註解）
const REASON_TYPES = ['產假', '育嬰留停', '兵役', '進修', '家庭因素', '其他']

const STATUS_BADGE = {
  '申請中': { bg: 'rgba(99,102,241,0.12)', color: '#6366f1' },
  '已核准': { bg: 'rgba(34,197,94,0.12)',  color: 'var(--accent-green)' },
  '已駁回': { bg: 'rgba(239,68,68,0.12)',  color: 'var(--accent-red)' },
  '已取消': { bg: 'rgba(156,163,175,0.12)', color: 'var(--text-muted)' },
}

export default function LeaveOfAbsence() {
  const { profile, role, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const { canApprove } = usePendingApprovals()
  const navigate = useNavigate()
  const isAdmin = ['super_admin','admin','manager'].includes(role?.name || profile?.role)
  const [list, setList] = useState([])
  const [search, setSearch] = useState('')
  const [employees, setEmployees] = useState([])
  const [chainSteps, setChainSteps] = useState({})
  const [activeChain, setActiveChain] = useState(null)
  const [errors, setErrors] = useState({})
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)

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

  const buildAndResolveChain = async (row) => {
    return buildFormChainSteps({
      formType: 'loa',
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

  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    employee_id: profile?.id || '',
    start_date: '',
    planned_end_date: '',
    reason_type: '產假',
    reason_detail: '',
  })
  const [reviewModal, setReviewModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editingId, setEditingId] = useState(null)

  const load = async () => {
    setLoading(true)
    let q = supabase.from('leave_of_absence_requests')
      .select('*, employee:employees(id,name,name_en,department_id,position), approver:employees!approver_id(id,name,signature_url)')
      .order('id', { ascending: false })
    if (!isAdmin && profile?.id) q = q.eq('employee_id', profile.id)
    const orgId = profile?.organization_id
    const [{ data: r }, { data: e }, chain] = await Promise.all([
      q,
      supabase.from('employees').select('id,name,name_en,position,dept,department_id,store,store_id,departments!department_id(name),stores!store_id(name)').eq('status','在職').order('name'),
      findActiveChainByCategory('留停', orgId),
    ])
    setList(r || [])
    setEmployees(e || [])
    setActiveChain(chain)

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

  // Dashboard ApprovalCenter 跳過來時 ?focus=ID 自動開明細
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
      ? { employee_id: empId, start_date: form.start_date, planned_end_date: form.planned_end_date, reason_type: form.reason_type }
      : { start_date: form.start_date, planned_end_date: form.planned_end_date, reason_type: form.reason_type }
    const validateKeys = isAdmin
      ? ['employee_id', 'start_date', 'planned_end_date', 'reason_type']
      : ['start_date', 'planned_end_date', 'reason_type']
    if (!validateRequired(validateForm, validateKeys, setErrors)) return

    const payload = {
      employee_id: Number(empId),
      start_date: form.start_date,
      planned_end_date: form.planned_end_date,
      reason_type: form.reason_type,
      reason_detail: form.reason_detail || null,
      organization_id: profile?.organization_id || 1,
      status: '申請中',
      approval_chain_id: activeChain?.id || null,
      current_step: 0,
    }

    if (editingId) {
      const { error: updErr } = await supabase.from('leave_of_absence_requests')
        .update({ ...payload, reject_reason: null }).eq('id', editingId)
      if (updErr) return toast.error('更新失敗：' + updErr.message)
      try {
        await supabase.rpc('resume_workflow_for_request', { p_type: 'loa', p_id: editingId })
      } catch (e) { console.error('[resume_workflow] failed:', e) }
      setShowForm(false); setEditingId(null)
      setForm({ employee_id: profile?.id || '', start_date: '', planned_end_date: '', reason_type: '產假', reason_detail: '' })
      load()
      return
    }

    const { data: inserted, error } = await supabase.from('leave_of_absence_requests').insert(payload).select().single()
    if (error) return toast.error('送出失敗：' + error.message)

    if (activeChain?.id && inserted) {
      const approvers = await resolveFirstApprovers('loa', inserted.id)
      if (approvers.length > 0) {
        const empName = employees.find(e => e.id === Number(empId))?.name || ''
        await notifyApprovers({
          approvers,
          title: `留職停薪申請待簽核 — ${empName}`,
          message: `期間：${form.start_date} ~ ${form.planned_end_date}・原因：${form.reason_type}`,
          type: 'form_submission',
          actionUrl: '/hr/forms/loa',
          organizationId: profile?.organization_id,
        })
      } else {
        toast.warning('已送出，但找不到對應的第一關簽核人', { description: '請確認簽核鏈設定' })
      }
    } else if (!activeChain) {
      toast.warning('已送出（目前無「留停」簽核鏈，admin 可直接核准）', {
        description: '建議到「簽核鏈設定」建立 category=留停 的鏈',
      })
    }

    setShowForm(false)
    setForm({ employee_id: profile?.id || '', start_date: '', planned_end_date: '', reason_type: '產假', reason_detail: '' })
    load()
  }

  const handleApprove = async (req) => {
    if (!(await confirm({ message: `核准 ${req.employee?.name} 的留職停薪申請？\n最後一關核准後會自動把員工狀態改為「留停」。` }))) return
    const res = await approveChainStep({
      table: 'loa', id: req.id,
      approverEmpId: profile?.id, action: 'approve',
    })
    if (!res?.ok) return toast.error('核准失敗：' + (res?.error || 'unknown'))

    if (res.event === 'advanced' && res.next_approvers?.length > 0) {
      await notifyApprovers({
        approvers: res.next_approvers,
        title: `留職停薪申請待簽核 — ${req.employee?.name}`,
        message: `已通過第 ${res.advanced_to_step} 關前的簽核，輪到您`,
        type: 'form_submission',
        actionUrl: '/hr/forms/loa',
        organizationId: profile?.organization_id,
      })
    }
    load()
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return toast.warning('請填駁回原因')
    const res = await approveChainStep({
      table: 'loa', id: reviewModal.id,
      approverEmpId: profile?.id, action: 'reject', reason: rejectReason,
    })
    if (!res?.ok) return toast.error('駁回失敗：' + (res?.error || 'unknown'))
    setReviewModal(null)
    setRejectReason('')
    load()
  }

  const handleCancel = async (req) => {
    if (!(await confirm({ message: '確定取消此申請？' }))) return
    await supabase.from('leave_of_absence_requests').update({ status: '已取消' }).eq('id', req.id)
    load()
  }

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '確定永久刪除此申請？此操作無法復原。' }))) return
    const { error } = await supabase.from('leave_of_absence_requests').delete().eq('id', row.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已刪除')
    load()
  }

  const formattedEmpOptions = useMemo(() => empOptions(employees), [employees])

  if (loading) return <LoadingSpinner />

  const canIApprove = (req) => canApprove('leave_of_absence_requests', req.id)
  const displayList = search.trim() ? list.filter(r => String(r.id).includes(search.trim())) : list

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>留職停薪申請</h2>
            <p>
              共 {list.length} 筆 · 申請中 {list.filter(r => r.status === '申請中').length} 筆
              {activeChain ? <span style={{ marginLeft: 8, color: 'var(--accent-cyan)', fontSize: 12 }}>· 簽核鏈：{activeChain.name}（{(chainSteps[activeChain.id] || []).length} 關）</span>
                : <span style={{ marginLeft: 8, color: 'var(--accent-orange)', fontSize: 12 }}>· ⚠ 無簽核鏈，admin 可直接核准</span>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(role?.name === 'super_admin' || role?.name === 'admin') && (
              <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=loa&label=留停')} title="設定留停簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> 新增申請</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' }}>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋單號" style={{ paddingLeft: 26, paddingRight: search ? 26 : 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 120 }} />
            {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><XIcon size={12} /></button>}
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 55 }}>單號</th>
                <th>員工</th>
                <th>起始日</th>
                <th>預計返回日</th>
                <th>原因</th>
                <th>申請日</th>
                <th>簽核進度</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {displayList.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無留職停薪申請</td></tr>
              )}
              {displayList.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                const steps = chainSteps[r.approval_chain_id] || []
                const myTurn = canIApprove(r)
                const canCancel = r.status === '申請中' && (r.employee_id === profile?.id || isAdmin)
                return (
                  <tr key={r.id} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細"
                    onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--bg-secondary)'}
                    onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>#{r.id}</td>
                    <td><b>{r.employee?.name}</b>{r.employee?.name_en ? ` ${r.employee.name_en}` : ''}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employee?.position}</div></td>
                    <td>{r.start_date}</td>
                    <td>{r.planned_end_date}{r.actual_return_date ? <div style={{ fontSize: 11, color: 'var(--accent-green)' }}>實際 {r.actual_return_date}</div> : null}</td>
                    <td>{r.reason_type}{r.reason_detail ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.reason_detail}</div> : null}</td>
                    <td style={{ fontSize: 12 }}>{r.created_at?.slice(0, 10)}</td>
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
                        {myTurn && (
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
                                start_date: r.start_date || '',
                                planned_end_date: r.planned_end_date || '',
                                reason_type: r.reason_type || '產假',
                                reason_detail: r.reason_detail || '',
                              })
                              setShowForm(true)
                            }}>✏️ {(['已駁回','已退回'].includes(r.status)) ? '編輯重送' : '編輯'}</button>
                        )}
                        {canDeleteAll && (
                          <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(r)} title="永久刪除">
                            刪除
                          </button>
                        )}
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
        <Modal title={editingId ? '✏️ 編輯留停申請' : '新增留停申請'} onClose={() => { setShowForm(false); setErrors({}); setEditingId(null) }} onSubmit={handleSubmit} submitLabel={editingId ? '更新送出' : '送出申請'}>
          <Field label={isAdmin ? '員工 *' : '員工'} error={errors.employee_id} errorMsg="請選擇員工">
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
          <Field label="起始日" required error={errors.start_date} errorMsg="請選日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => { setForm(f => ({ ...f, start_date: e.target.value })); clearError('start_date', setErrors) }} />
          </Field>
          <Field label="預計返回日" required error={errors.planned_end_date} errorMsg="請選日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.planned_end_date} onChange={e => { setForm(f => ({ ...f, planned_end_date: e.target.value })); clearError('planned_end_date', setErrors) }} />
          </Field>
          <Field label="原因類型" required error={errors.reason_type} errorMsg="請選原因">
            <select className="form-input" style={{ width: '100%' }} value={form.reason_type} onChange={e => setForm(f => ({ ...f, reason_type: e.target.value }))}>
              {REASON_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="原因說明（選填）">
            <textarea className="form-input" rows={3} style={{ width: '100%' }} placeholder="可補充說明背景或特殊安排" value={form.reason_detail} onChange={e => setForm(f => ({ ...f, reason_detail: e.target.value }))} />
          </Field>
          {activeChain && (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--glass-light)', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>送出後將進入簽核流程：{activeChain.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>申請人</span>
                {(chainSteps[activeChain.id] || []).map((st) => (
                  <span key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ArrowRight size={11} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border-medium)' }}>{st.label || st.role_name}</span>
                  </span>
                ))}
                <ArrowRight size={11} style={{ color: 'var(--text-muted)' }} />
                <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>✓ 員工狀態自動改為留停</span>
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
          docTitle="留職停薪申請"
          docNo={detailRow.id}
          status={detailRow.status}
          applicant={{
            name: detailRow.employee?.name || '',
            name_en: detailRow.employee?.name_en,
            position: detailRow.employee?.position,
            status: '在職',
          }}
          fields={[
            { label: '起始日', value: detailRow.start_date },
            { label: '預計返回日', value: detailRow.planned_end_date },
            ...(detailRow.actual_return_date ? [{ label: '實際返回日', value: detailRow.actual_return_date }] : []),
            { label: '原因類型', value: detailRow.reason_type },
            ...(detailRow.reason_detail ? [{ label: '原因說明', value: detailRow.reason_detail, multiline: true }] : []),
            ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
          ]}
          attachments={detailRow.attachment_url ? [{ url: detailRow.attachment_url, name: detailRow.attachment_url.split('/').pop() }] : []}
          createdAt={detailRow.created_at}
          chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
          actions={
            detailRow.status === '申請中' && canIApprove(detailRow) ? {
              sourceTable: 'leave_of_absence_requests',
              row: { ...detailRow, employee_id: detailRow.employee?.id },
              onApprove: async () => handleApprove(detailRow),
              onReject: async (_r, reason) => {
                const res = await approveChainStep({
                  table: 'loa', id: detailRow.id,
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
