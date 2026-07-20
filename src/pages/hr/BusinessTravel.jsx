import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useReturnNav } from '../../lib/useReturnNav'
import { Plus, Printer, Settings, Search, X as XIcon } from 'lucide-react'
import { getBusinessTrips, createBusinessTrip, updateBusinessTripStatus } from '../../lib/db'
import { createApprovalWorkflow } from '../../lib/workflowIntegration'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import ExtraSignerControls from '../../components/ExtraSignerControls'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { printTripSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildFormChainSteps, mergeStepSignTimes } from '../../lib/buildChainSteps'
import { validateRequired, clearError } from '../../lib/formValidation'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { useChainGuard } from '../../lib/useChainGuard'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
export default function BusinessTravel() {
  const { profile, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const { canApprove } = usePendingApprovals()
  const chainGuard = useChainGuard({ formType: 'trip', organizationId: profile?.organization_id })
  const navigate = useNavigate()
  const returnNav = useReturnNav()
  const [trips, setTrips] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ employee: '', destination: '', start_date: '', end_date: '', purpose: '', budget: '' })
  const [errors, setErrors] = useState({})
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)

  const load = () => {
    const orgId = profile?.organization_id
    return Promise.all([
      getBusinessTrips(),
      supabase.from('employees').select('id, name, dept, department_id, position, signature_url, departments!department_id(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([t, e, d, orgRes]) => {
      const emps = e.data || []
      setTrips(t.data || [])
      setEmployees(emps)
      setDepartments(d.data || [])
      setOrganization(orgRes?.data || null)
      setForm(f => ({ ...f, employee: f.employee || profile?.name || emps[0]?.name || '' }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [])

  // Dashboard ApprovalCenter 跳過來時 ?focus=ID 自動開明細
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !trips.length) return
    const row = trips.find(t => t.id === Number(focus))
    if (row) {
      openDetail(row)
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [trips, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!validateRequired(form, ['employee', 'destination', 'start_date', 'end_date', 'purpose'], setErrors)) return
    // employee_id 一定要帶：NULL 會讓 can_see_request(NULL) 直接回 false（連 admin 都看不到），
    // 也讓自動套鏈解不出申請人 → 掉到預設 staff 鏈。
    const empId = employees.find(e => e.name === form.employee)?.id ?? null
    const payload = { ...form, employee_id: empId, budget: Number(form.budget) || 0 }

    // ── 編輯重送路徑 ──
    if (editingId) {
      const { error: updErr } = await supabase.from('business_trips')
        .update({ ...payload, status: '待審核', reject_reason: null })
        .eq('id', editingId)
      if (updErr) { toast.error('更新失敗：' + updErr.message); return }
      try {
        const { error: rpcErr } = await supabase.rpc('resume_workflow_for_request', { p_type: 'trip', p_id: editingId })
        if (rpcErr) {
          console.error('[resume_workflow] error:', rpcErr)
          toast.error('簽核流程重啟失敗：' + rpcErr.message)
        }
      } catch (e) {
        console.error('[resume_workflow] failed:', e)
        toast.error('簽核流程重啟失敗：' + (e.message || '未知錯誤'))
      }
      setTrips(prev => prev.map(t => t.id === editingId ? { ...t, ...payload, status: '待審核', reject_reason: null } : t))
      setShowModal(false)
      setEditingId(null)
      setForm({ employee: profile?.name || employees[0]?.name || '', destination: '', start_date: '', end_date: '', purpose: '', budget: '' })
      return
    }

    // ── 新增路徑 ──
    const { data } = await createBusinessTrip({ ...payload, status: '待審核', organization_id: profile?.organization_id ?? null })
    if (data) {
      setTrips(prev => [...prev, data])
      setShowModal(false)
      setForm({ employee: profile?.name || employees[0]?.name || '', destination: '', start_date: '', end_date: '', purpose: '', budget: '' })
      await createApprovalWorkflow('business_trip', data, form.employee)
    }
  }

  const handleApprove = async (id) => {
    const { data: result, error } = await supabase.rpc('web_advance_chain_request', {
      p_type: 'trip', p_id: id, p_action: 'approve',
    })
    if (error) { toast.error('操作失敗：' + error.message); return }
    if (!result?.ok) { toast.error('操作失敗：' + (result?.error || '未知')); return }
    setTrips(prev => prev.map(t => t.id === id ? { ...t, status: result.status } : t))
  }

  const handleReject = async (id, reasonArg) => {
    const reason = reasonArg ?? prompt('請輸入駁回原因：')
    if (reason === null) return
    if (!reason.trim()) { toast.warning('請填寫駁回原因'); return }
    const { data: result, error } = await supabase.rpc('web_advance_chain_request', {
      p_type: 'trip', p_id: id, p_action: 'reject', p_reason: reason.trim(),
    })
    if (error) { toast.error('操作失敗：' + error.message); return }
    if (!result?.ok) { toast.error('操作失敗：' + (result?.error || '未知')); return }
    setTrips(prev => prev.map(t => t.id === id ? { ...t, status: result.status } : t))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''

  const printWithChain = async (row) => {
    if (!employees.length) { toast.error('員工清單載入中，請稍候'); return }
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      const empRow = employees.find(e => e.name === row.employee)
      let chainSteps = await buildFormChainSteps({
        formType: 'trip',
        organizationId: profile?.organization_id,
        applicantName: row.employee,
        applicantId: empRow?.id,
        applicantCreatedAt: row.created_at,
        recordStatus: row.status,
        approverName: row.approver,
        approvedAt: row.approved_at,
        rejectReason: row.reject_reason,
        fallbackTail: ['人資/財務'],
        // ★ 標對駁回關 + 補每關簽核時間
        requestType: 'trip', requestId: row.id, currentStep: row.current_step,
      })
      chainSteps = await mergeStepSignTimes('trip', row.id, chainSteps)
      const approverMap = {}
      chainSteps.forEach(s => { if (s.target_emp_id && s.name) approverMap[s.target_emp_id] = s.name })
      printTripSignOff(row, {
        companyName: organization?.name, logoUrl: organization?.logo_url,
        dept: getEmpDept(row.employee),
        signatures: Object.fromEntries(employees.filter(e => e.signature_url).map(e => [e.name, e.signature_url])),
        chainSteps,
        approverMap,
        _win: win,
      })
    } catch (e) {
      win.close()
      toast.error('產生簽呈失敗：' + (e.message || '未知錯誤'))
    }
  }

  const openDetail = async (row) => {
    detailRowIdRef.current = row.id
    setDetailRow(row)
    setLoadingChain(true)
    setDetailChainSteps([])
    const empRow = employees.find(e => e.name === row.employee)
    const steps = await buildFormChainSteps({
      formType: 'trip',
      organizationId: profile?.organization_id,
      applicantName: row.employee,
      applicantId: empRow?.id,
      applicantCreatedAt: row.created_at,
      recordStatus: row.status,
      approverName: row.approver,
      approvedAt: row.approved_at,
      rejectReason: row.reject_reason,
      fallbackTail: ['人資/財務'],
      requestType: 'trip',
      requestId: row.id,
      currentStep: row.current_step,
    })
    if (detailRowIdRef.current !== row.id) return
    setDetailChainSteps(steps)
    setLoadingChain(false)
  }

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '移至最近刪除？可在 60 天內復原。' }))) return
    const { error } = await supabase.rpc('soft_delete_request', { p_table: 'business_trips', p_id: row.id, p_deleted_by: profile?.id ?? null })
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已移至最近刪除')
    setTrips(prev => prev.filter(x => x.id !== row.id))
  }

  const filtered = trips.filter(t =>
    (deptFilter === '' || getEmpDept(t.employee) === deptFilter) &&
    (!search.trim() || [String(t.id), t.employee, t.destination, t.purpose].some(f => (f||'').toLowerCase().includes(search.trim().toLowerCase())))
  )


  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">✈️</span> 公出差旅</h2>
            <p>出差申請與核准管理</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasPermission('approval_chain.edit') && (
              <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=trip&label=出差')} title="設定出差簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={chainGuard.blocked}
              title={chainGuard.blocked ? chainGuard.reason : undefined}
              onClick={() => {
                if (chainGuard.blocked) { toast.error(chainGuard.reason); return }
                setEditingId(null)
                setForm({ employee: profile?.name || employees[0]?.name || '', destination: '', start_date: '', end_date: '', purpose: '', budget: '' })
                setErrors({})
                setShowModal(true)
              }}><Plus size={14} /> 新增差旅</button>
          </div>
        </div>
      </div>

      {/* 部門篩選 */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏢 部門</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">全部部門</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待審核</div>
          <div className="stat-card-value">{filtered.filter(t => t.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核准</div>
          <div className="stat-card-value">{filtered.filter(t => t.status === '已核准').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">預算合計</div>
          <div className="stat-card-value">NT$ {filtered.reduce((s, t) => s + Number(t.budget || 0), 0).toLocaleString()}</div>
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
            <thead><tr><th style={{ width: 55 }}>單號</th><th>員工</th><th>部門</th><th>目的地</th><th>出發日</th><th>回程日</th><th>事由</th><th>預算</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無差旅紀錄</td></tr>}
              {filtered.map(t => (
                <tr key={t.id} onClick={() => openDetail(t)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細"
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>#{t.id}</td>
                  <td style={{ fontWeight: 600 }}>{t.employee}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(t.employee) || '-'}</td>
                  <td>{t.destination}</td>
                  <td>{t.start_date}</td>
                  <td>{t.end_date}</td>
                  <td>{t.purpose}</td>
                  <td>NT$ {Number(t.budget).toLocaleString()}</td>
                  <td>
                    <span className={`badge ${t.status === '已核准' ? 'badge-success' : t.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{t.status}
                    </span>
                    {t.reject_reason && (
                      <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>原因：{t.reject_reason}</div>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {t.status === '待審核' && canApprove('business_trips', t.id) && (
                        <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>點明細簽核</span>
                      )}
                      {['待審核','申請中','已駁回','已退回'].includes(t.status) && t.employee === profile?.name && (
                        <button className="btn btn-sm btn-primary" style={{ background: 'var(--accent-orange)' }} onClick={() => {
                          setEditingId(t.id)
                          setForm({
                            employee: t.employee,
                            destination: t.destination || '',
                            start_date: t.start_date || '',
                            end_date: t.end_date || '',
                            purpose: t.purpose || '',
                            budget: t.budget?.toString() || '',
                          })
                          setShowModal(true)
                        }}>✏️ {(t.status === '已駁回' || t.status === '已退回') ? '編輯重送' : '編輯'}</button>
                      )}
                      {t.employee === profile?.name && (
                        <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-cyan)' }} title="以這張為範本開一張全新申請（不動原單）" onClick={() => {
                          setEditingId(null)
                          setForm({
                            employee: t.employee,
                            destination: t.destination || '',
                            start_date: t.start_date || '',
                            end_date: t.end_date || '',
                            purpose: t.purpose || '',
                            budget: t.budget?.toString() || '',
                          })
                          setShowModal(true)
                        }}>📋 複製</button>
                      )}
                      <button className="btn btn-sm btn-secondary" title="下載簽呈"
                        onClick={() => printWithChain(t)}>
                        <Printer size={11} />
                      </button>
                      {canDeleteAll && (
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(t)} title="永久刪除">
                          刪除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal
          title={editingId ? '✏️ 編輯重送（駁回後修改）' : '新增差旅申請'}
          onClose={() => { setShowModal(false); setErrors({}); setEditingId(null) }}
          onSubmit={handleSubmit}
          successMessage={editingId ? '已重新送審，主管會收到通知' : '差旅申請已送出，等待主管簽核'}
        >
          <Field label="員工" required error={errors.employee} errorMsg="請選擇員工">
            <SearchableSelect
              value={form.employee}
              onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="搜尋員工姓名/職稱..."
            />
          </Field>
          <Field label="目的地" required error={errors.destination} errorMsg="請填寫目的地">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：東京" value={form.destination} onChange={e => { set('destination', e.target.value); clearError('destination', setErrors) }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="出發日" required error={errors.start_date} errorMsg="請選日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => { set('start_date', e.target.value); clearError('start_date', setErrors) }} />
            </Field>
            <Field label="回程日" required error={errors.end_date} errorMsg="請選回程日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => { set('end_date', e.target.value); clearError('end_date', setErrors) }} />
            </Field>
          </div>
          <Field label="事由" required error={errors.purpose} errorMsg="請填寫出差事由">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：客戶拜訪" value={form.purpose} onChange={e => { set('purpose', e.target.value); clearError('purpose', setErrors) }} />
          </Field>
          <Field label="預算 (NT$)">
            <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.budget} onChange={e => set('budget', e.target.value)} />
          </Field>
        </Modal>
      )}

      {detailRow && (() => {
        const empRow = employees.find(e => e.name === detailRow.employee)
        const period = detailRow.start_date === detailRow.end_date || !detailRow.end_date
          ? detailRow.start_date
          : `${detailRow.start_date} ~ ${detailRow.end_date}`
        return (
          <ApprovalDetailModal
            open={!!detailRow}
            onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
            docTitle="出差申請"
            docNo={detailRow.id}
            status={detailRow.status}
            applicant={{
              name: detailRow.employee,
              name_en: empRow?.name_en,
              position: empRow?.position,
              dept: getEmpDept(detailRow.employee),
              status: empRow?.status,
              employee_no: empRow?.employee_no,
            }}
            fields={[
              { label: '出差地點', value: detailRow.destination },
              { label: '期間', value: period },
              { label: '預估費用', value: `NT$ ${Number(detailRow.budget || 0).toLocaleString()}` },
              { label: '出差目的', value: detailRow.purpose, multiline: true },
              ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
            ]}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            requestType="trip"
            requestId={detailRow.id}
            onPrint={() => printWithChain(detailRow)}
            actions={
              detailRow.status === '待審核' && canApprove('business_trips', detailRow.id) ? {
                sourceTable: 'business_trips',
                row: detailRow,
                onApprove: async () => handleApprove(detailRow.id),
                onReject: async (_r, reason) => handleReject(detailRow.id, reason),
                onChanged: () => { load(); setDetailRow(null); returnNav() },
              } : null
            }
          />
        )
      })()}

    </div>
  )
}
