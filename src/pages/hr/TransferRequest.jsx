import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useReturnNav } from '../../lib/useReturnNav'
import { Plus, CheckCircle, XCircle, ArrowRight, Printer, Settings, Pencil, Search, X as XIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import ExtraSignerControls from '../../components/ExtraSignerControls'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'
import {
  findFormChainByApplicantType, loadChainStepsBatch, approveChainStep, notifyApprovers,
} from '../../lib/hrChain'
import { printTransferSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildFormChainSteps } from '../../lib/buildChainSteps'
import { validateRequired, clearError } from '../../lib/formValidation'
import { usePendingApprovals } from '../../lib/usePendingApprovals'

import { confirm } from '../../lib/confirm'
const TRANSFER_TYPES = ['調職', '升遷', '降調', '部門調動', '跨店調動', '調薪']

const STATUS_BADGE = {
  '申請中': { bg: 'rgba(99,102,241,0.12)', color: '#6366f1' },
  '已核准': { bg: 'rgba(34,197,94,0.12)',  color: 'var(--accent-green)' },
  '已駁回': { bg: 'rgba(239,68,68,0.12)',  color: 'var(--accent-red)' },
  '已取消': { bg: 'rgba(156,163,175,0.12)', color: 'var(--text-muted)' },
}

export default function TransferRequest() {
  const { profile, isManagerOrAbove, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const { canApprove } = usePendingApprovals()
  const navigate = useNavigate()
  const returnNav = useReturnNav()
  const [list, setList] = useState([])
  const [search, setSearch] = useState('')
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [chainSteps, setChainSteps] = useState({})
  const [activeChain, setActiveChain] = useState(null)
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const [errors, setErrors] = useState({})
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

  // ★ 改走 buildFormChainSteps：讀 form_chain_configs（admin 在異動頁面設定的 chain）
  const buildAndResolveChain = async (row) => {
    return buildFormChainSteps({
      formType: 'transfer',
      organizationId: profile?.organization_id,
      applicantName: row.employee?.name || '',
      applicantId: row.employee_id || row.employee?.id || null,
      applicantCreatedAt: row.created_at,
      recordStatus: row.status,
      approverName: row.approver?.name || row.approver,
      approvedAt: row.approved_at,
      rejectReason: row.reject_reason,
      requestType: 'transfer',
      requestId: row.id,
      currentStep: row.current_step,
    })
  }

  const printWithChain = async (row) => {
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      const builtSteps = await buildAndResolveChain(row)
      const approverMap = {}
      builtSteps.forEach(s => { if (s.target_emp_id && s.name) approverMap[s.target_emp_id] = s.name })
      printTransferSignOff(row, {
        companyName: organization?.name,
        logoUrl: organization?.logo_url,
        chainSteps: builtSteps,
        approverMap,
        signatures: Object.fromEntries(employees.filter(e => e.signature_url).map(e => [e.name, e.signature_url])),
        _win: win,
      })
    } catch (e) {
      win.close()
      toast.error('產生簽呈失敗：' + (e.message || '未知錯誤'))
    }
  }
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [reviewModal, setReviewModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editingId, setEditingId] = useState(null)

  const openEdit = (r) => {
    setEditingId(r.id)
    setForm({
      employee_id: r.employee_id || '',
      transfer_type: r.transfer_type || '調職',
      effective_date: r.effective_date || '',
      new_department_id: r.new_department_id || '',
      new_store_id: r.new_store_id || '',
      new_position: r.new_position || '',
      new_base_salary: r.new_base_salary || '',
      reason: r.reason || '',
    })
    setErrors({})
    setShowForm(true)
  }

  // 複製：以舊單為範本開全新單（不動原單）
  const openClone = (r) => { openEdit(r); setEditingId(null) }

  function emptyForm() {
    return {
      employee_id: '',
      transfer_type: '調職',
      effective_date: '',
      new_department_id: '',
      new_store_id: '',
      new_position: '',
      new_base_salary: '',
      reason: '',
    }
  }

  const load = async () => {
    setLoading(true)
    let q = supabase.from('personnel_transfer_requests')
      .select(`*,
        employee:employees(id,name,name_en,department_id,store_id,position,role),
        approver:employees!approver_id(id,name,signature_url),
        old_dept:departments!old_department_id(id,name),
        new_dept:departments!new_department_id(id,name),
        old_store:stores!old_store_id(id,name),
        new_store:stores!new_store_id(id,name)`)
      .order('id', { ascending: false })
    if (!isManagerOrAbove && profile?.id) q = q.eq('employee_id', profile.id)
    const orgId = profile?.organization_id
    const [{ data: r }, { data: e }, { data: d }, { data: s }, chain, orgRes] = await Promise.all([
      q,
      supabase.from('employees').select('id,name,name_en,position,department_id,store_id,role,dept,store,signature_url,departments!department_id(name),stores!store_id(name)').eq('status','在職').order('name'),
      supabase.from('departments').select('id,name').order('name'),
      supabase.from('stores').select('id,name').eq('is_active', true).order('name'),
      findFormChainByApplicantType('transfer', orgId, profile?.id),
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
    setChainSteps(await loadChainStepsBatch([...new Set(uniqChainIds)]))
    setLoading(false)
  }
  useEffect(() => { load() }, [profile?.id, isManagerOrAbove, profile?.organization_id])

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

  const selectedEmp = employees.find(e => String(e.id) === String(form.employee_id))
  const formattedEmpOptions = useMemo(() => empOptions(employees), [employees])

  const handleSubmit = async () => {
    const empId = isManagerOrAbove ? form.employee_id : profile?.id
    // 必填：員工 / 異動類型 / 生效日 / 異動原因
    const validateForm = isManagerOrAbove
      ? { employee_id: empId, transfer_type: form.transfer_type, effective_date: form.effective_date, reason: form.reason }
      : { transfer_type: form.transfer_type, effective_date: form.effective_date, reason: form.reason }
    const validateKeys = isManagerOrAbove
      ? ['employee_id', 'transfer_type', 'effective_date', 'reason']
      : ['transfer_type', 'effective_date', 'reason']
    if (!validateRequired(validateForm, validateKeys, setErrors)) return
    const payload = {
      employee_id: Number(empId),
      organization_id: profile?.organization_id || 1,
      transfer_type: form.transfer_type,
      effective_date: form.effective_date,
      old_department_id: selectedEmp?.department_id || null,
      old_store_id: selectedEmp?.store_id || null,
      old_position: selectedEmp?.position || null,
      old_role: selectedEmp?.role || null,
      new_department_id: form.new_department_id ? Number(form.new_department_id) : null,
      new_store_id: form.new_store_id ? Number(form.new_store_id) : null,
      new_position: form.new_position || null,
      new_base_salary: form.new_base_salary ? Number(form.new_base_salary) : null,
      reason: form.reason || null,
      status: '申請中',
      current_step: 0,
    }

    // ── 編輯路徑 ──
    if (editingId) {
      const { error: updErr } = await supabase.from('personnel_transfer_requests')
        .update({ ...payload, reject_reason: null }).eq('id', editingId)
      if (updErr) return toast.error('更新失敗：' + updErr.message)
      try {
        const { error: rpcErr } = await supabase.rpc('resume_workflow_for_request', { p_type: 'transfer', p_id: editingId })
        if (rpcErr) {
          console.error('[resume_workflow] error:', rpcErr)
          toast.error('簽核流程重啟失敗：' + rpcErr.message)
        }
      } catch (e) {
        console.error('[resume_workflow] failed:', e)
        toast.error('簽核流程重啟失敗：' + (e.message || '未知錯誤'))
      }
      setShowForm(false); setEditingId(null)
      setForm(emptyForm())
      load()
      return
    }

    const { error } = await supabase.from('personnel_transfer_requests').insert(payload)
    if (error) return toast.error('送出失敗：' + error.message)

    setShowForm(false)
    setForm(emptyForm())
    load()
  }

  const handleApprove = async (req) => {
    if (!(await confirm({ message: `核准 ${req.employee?.name} 的異動申請？\n最後一關核准後 DB 會自動寫 position_history 並更新員工資料。` }))) return
    const res = await approveChainStep({
      table: 'transfer', id: req.id,
      approverEmpId: profile?.id, action: 'approve',
    })
    if (!res?.ok) return toast.error('核准失敗：' + (res?.error || 'unknown'))
    if (res.event === 'advanced' && res.next_approvers?.length > 0) {
      await notifyApprovers({
        approvers: res.next_approvers,
        title: `人事異動申請待簽核 — ${req.employee?.name}`,
        message: `已通過第 ${res.advanced_to_step} 關前的簽核，輪到您`,
        type: 'form_submission',
        actionUrl: '/hr/forms/transfer',
        organizationId: profile?.organization_id,
      })
    }
    load()
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return toast.warning('請填駁回原因')
    const res = await approveChainStep({
      table: 'transfer', id: reviewModal.id,
      approverEmpId: profile?.id, action: 'reject', reason: rejectReason,
    })
    if (!res?.ok) return toast.error('駁回失敗：' + (res?.error || 'unknown'))
    setReviewModal(null); setRejectReason('')
    load()
  }

  const handleCancel = async (req) => {
    if (!(await confirm({ message: '確定取消此申請？' }))) return
    await supabase.from('personnel_transfer_requests').update({ status: '已取消' }).eq('id', req.id)
    load()
  }

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '確定永久刪除此申請？此操作無法復原。' }))) return
    const { error } = await supabase.from('personnel_transfer_requests').delete().eq('id', row.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已刪除')
    load()
  }

  if (loading) return <LoadingSpinner />

  // 改走 web_list_my_pending_approval_ids RPC（chain step 動態解人 + 自己不能簽自己）
  const canIApprove = (req) => canApprove('personnel_transfer_requests', req.id)
  const displayList = search.trim() ? list.filter(r => [String(r.id), r.employee?.name, r.transfer_type, r.new_position, r.reason].some(f => (f||'').toLowerCase().includes(search.trim().toLowerCase()))) : list

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>人事異動申請</h2>
            <p>
              共 {list.length} 筆 · 申請中 {list.filter(r => r.status === '申請中').length} 筆
              {activeChain ? <span style={{ marginLeft: 8, color: 'var(--accent-cyan)', fontSize: 12 }}>· 簽核鏈：{activeChain.name}（{(chainSteps[activeChain.id] || []).length} 關）</span>
                : <span style={{ marginLeft: 8, color: 'var(--accent-orange)', fontSize: 12 }}>· ⚠ 無簽核鏈，admin 可直接核准</span>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasPermission('approval_chain.edit') && (
              <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=transfer&label=人事異動')} title="設定人事異動簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            <button className="btn btn-primary" onClick={() => {
              setEditingId(null)
              setForm({ ...emptyForm(), employee_id: profile?.id || '' })
              setErrors({})
              setShowForm(true)
            }}><Plus size={14} /> 新增異動</button>
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
                <th>類型</th>
                <th>異動內容</th>
                <th>生效日</th>
                <th>原因</th>
                <th>簽核進度</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {displayList.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無異動申請</td></tr>
              )}
              {displayList.map(r => {
                const s = STATUS_BADGE[r.status] || {}
                const steps = chainSteps[r.approval_chain_id] || []
                const myTurn = canIApprove(r)
                const canCancel = r.status === '申請中' && (r.employee_id === profile?.id || isManagerOrAbove)
                const canEdit = ['申請中','已駁回','已退回'].includes(r.status) && r.employee_id === profile?.id
                return (
                  <tr key={r.id} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細"
                    onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--bg-secondary)'}
                    onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>#{r.id}</td>
                    <td><b>{r.employee?.name}</b>{r.employee?.name_en ? ` ${r.employee.name_en}` : ''}</td>
                    <td><span style={{ padding: '2px 6px', fontSize: 11, fontWeight: 600, borderRadius: 4, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)' }}>{r.transfer_type}</span></td>
                    <td style={{ fontSize: 12 }}>
                      <DiffRow label="部門" old={r.old_dept?.name} cur={r.new_dept?.name} />
                      <DiffRow label="門市" old={r.old_store?.name} cur={r.new_store?.name} />
                      <DiffRow label="職位" old={r.old_position} cur={r.new_position} />
                      {r.new_base_salary && <DiffRow label="薪資" old={r.old_base_salary || '—'} cur={`${r.new_base_salary}`} />}
                    </td>
                    <td>{r.effective_date}</td>
                    <td style={{ fontSize: 12, maxWidth: 180 }}>{r.reason || '—'}</td>
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
                        {canEdit && (
                          <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-cyan)' }} onClick={() => openEdit(r)}>
                            <Pencil size={11} /> {['已駁回','已退回'].includes(r.status) ? '編輯重送' : '編輯'}
                          </button>
                        )}
                        {r.employee_id === profile?.id && (
                          <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-cyan)' }} title="以這張為範本開一張全新申請（不動原單）" onClick={() => openClone(r)}>
                            📋 複製
                          </button>
                        )}
                        {canCancel && (
                          <AsyncButton className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleCancel(r)} busyLabel="處理中…">取消</AsyncButton>
                        )}
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} title="下載簽呈"
                          onClick={() => printWithChain(r)}>
                          <Printer size={11} />
                        </button>
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
        <Modal title={editingId ? '✏️ 編輯人事異動申請' : '新增人事異動申請'} onClose={() => { setShowForm(false); setEditingId(null); setForm(emptyForm()); setErrors({}) }} onSubmit={handleSubmit} submitLabel={editingId ? '更新送出' : '送出申請'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工" required error={errors.employee_id} errorMsg="請選擇員工">
              <SearchableSelect
                value={form.employee_id}
                onChange={(v) => { setForm(f => ({ ...f, employee_id: v || '' })); clearError('employee_id', setErrors) }}
                options={formattedEmpOptions}
                placeholder="搜尋員工姓名/職稱..."
              />
            </Field>
            <Field label="異動類型">
              <select className="form-input" style={{ width: '100%' }} value={form.transfer_type} onChange={e => setForm(f => ({ ...f, transfer_type: e.target.value }))}>
                {TRANSFER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="生效日" required error={errors.effective_date} errorMsg="請選日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.effective_date} onChange={e => { setForm(f => ({ ...f, effective_date: e.target.value })); clearError('effective_date', setErrors) }} />
          </Field>
          {selectedEmp && (
            <div style={{ padding: 10, background: 'var(--glass-light)', borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>異動前資料</div>
              <div>部門：{departments.find(d => d.id === selectedEmp.department_id)?.name || '—'}</div>
              <div>門市：{stores.find(s => s.id === selectedEmp.store_id)?.name || '—'}</div>
              <div>職位：{selectedEmp.position || '—'}</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="新部門（可空）">
              <SearchableSelect
                value={form.new_department_id}
                onChange={(v) => setForm(f => ({ ...f, new_department_id: v || '' }))}
                options={departments.map(d => ({ value: d.id, label: d.name }))}
                placeholder="不變"
              />
            </Field>
            <Field label="新門市（可空）">
              <SearchableSelect
                value={form.new_store_id}
                onChange={(v) => setForm(f => ({ ...f, new_store_id: v || '' }))}
                options={stores.map(s => ({ value: s.id, label: s.name }))}
                placeholder="不變"
              />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="新職位（可空）">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：店長 / 督導 / 部門主管" value={form.new_position} onChange={e => setForm(f => ({ ...f, new_position: e.target.value }))} />
            </Field>
            <Field label="新基本薪資（可空）">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="例：45000" value={form.new_base_salary} onChange={e => setForm(f => ({ ...f, new_base_salary: e.target.value }))} />
            </Field>
          </div>
          <Field label="異動原因">
            <textarea className="form-input" rows={3} style={{ width: '100%' }} placeholder="例：擴編、員工輪調、績效升遷..." value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
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
                <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>✓ 自動寫入異動軌跡 + 員工資料</span>
              </div>
            </div>
          )}
        </Modal>
      )}

      {reviewModal && (
        <Modal title={`駁回 — ${reviewModal.employee?.name}`} onClose={() => { setReviewModal(null); setRejectReason('') }} onSubmit={handleReject} submitLabel="確認駁回">
          <Field label="駁回原因">
            <textarea className="form-input" rows={3} style={{ width: '100%' }} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </Field>
        </Modal>
      )}

      {detailRow && (() => {
        const changes = []
        if (detailRow.old_dept?.name !== detailRow.new_dept?.name && detailRow.new_dept?.name)
          changes.push(`部門：${detailRow.old_dept?.name || '—'} → ${detailRow.new_dept?.name}`)
        if (detailRow.old_store?.name !== detailRow.new_store?.name && detailRow.new_store?.name)
          changes.push(`門市：${detailRow.old_store?.name || '—'} → ${detailRow.new_store?.name}`)
        if (detailRow.new_position)
          changes.push(`職位：${detailRow.old_position || '—'} → ${detailRow.new_position}`)
        if (detailRow.new_base_salary != null)
          changes.push(`底薪：${detailRow.old_base_salary || '—'} → NT$ ${Number(detailRow.new_base_salary).toLocaleString()}`)
        return (
          <ApprovalDetailModal
            open={!!detailRow}
            onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
            docTitle="人事異動申請"
            docNo={detailRow.id}
            status={detailRow.status}
            applicant={{
              name: detailRow.employee?.name || '',
              name_en: detailRow.employee?.name_en,
              position: detailRow.employee?.position,
              status: '在職',
            }}
            fields={[
              { label: '異動類型', value: detailRow.transfer_type },
              { label: '生效日期', value: detailRow.effective_date },
              { label: '異動內容', value: changes.join('\n') || '—', multiline: true },
              ...(detailRow.reason ? [{ label: '異動原因', value: detailRow.reason, multiline: true }] : []),
              ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
            ]}
            attachments={detailRow.attachment_url ? [{ url: detailRow.attachment_url, name: detailRow.attachment_url.split('/').pop() }] : []}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            onPrint={() => printWithChain(detailRow)}
            actions={
              detailRow.status === '申請中' && canIApprove(detailRow) ? {
                sourceTable: 'personnel_transfer_requests',
                row: { ...detailRow, employee_id: detailRow.employee?.id },
                onApprove: async () => handleApprove(detailRow),
                onReject: async (_r, reason) => {
                  const res = await approveChainStep({
                    table: 'transfer', id: detailRow.id,
                    approverEmpId: profile?.id, action: 'reject', reason,
                  })
                  if (!res?.ok) toast.error('駁回失敗：' + (res?.error || 'unknown'))
                },
                onChanged: () => { load(); setDetailRow(null); returnNav() },
                rejectLabel: '駁回',
              } : null
            }
          />
        )
      })()}

    </div>
  )
}

function DiffRow({ label, old, cur }) {
  if (!cur || cur === old) {
    return <div style={{ color: 'var(--text-muted)' }}>{label}：{old || '—'}{cur === old && <span style={{ marginLeft: 4 }}>（不變）</span>}</div>
  }
  return (
    <div>
      <span style={{ color: 'var(--text-muted)' }}>{label}：</span>
      <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{old || '—'}</span>
      <ArrowRight size={11} style={{ display: 'inline', margin: '0 4px', color: 'var(--accent-cyan)' }} />
      <b style={{ color: 'var(--accent-cyan)' }}>{cur}</b>
    </div>
  )
}
