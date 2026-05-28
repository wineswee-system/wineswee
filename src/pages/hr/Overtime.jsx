import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useReturnNav } from '../../lib/useReturnNav'
import { Plus, Printer, Settings, Paperclip, Search, X as XIcon } from 'lucide-react'
import { getOvertimeRequests, createOvertimeRequest, updateOvertimeStatus } from '../../lib/db'
import { createApprovalWorkflow, getWorkflowForRecord, advanceWorkflow } from '../../lib/workflowIntegration'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import ExtraSignerControls from '../../components/ExtraSignerControls'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { printOvertimeSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildFormChainSteps } from '../../lib/buildChainSteps'
import { validateRequired, clearError } from '../../lib/formValidation'
import { uploadFormAttachments } from '../../lib/formAttachments'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { useChainGuard } from '../../lib/useChainGuard'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

// 算加班時數：依起訖時間 + 商店最小單位（step）
// 跨日：end < start 自動 +24h（例 22:00 -> 02:00 = 4 小時）
function computeOvertimeHours(start, end, step = 0.5) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) mins += 24 * 60
  const hours = mins / 60
  return Math.round(hours / step) * step
}

export default function Overtime() {
  const { profile, role, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const { canApprove } = usePendingApprovals()
  const chainGuard = useChainGuard({ formType: 'overtime', organizationId: profile?.organization_id })
  const navigate = useNavigate()
  const returnNav = useReturnNav()
  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ employee: '', date: '', start_time: '', end_time: '', hours: 0, reason: '', store: '' })
  const [stores, setStores] = useState([])
  const [error, setError] = useState(null)
  const [errors, setErrors] = useState({})

  // 各店的加班 step 設定 → {store_id: step}
  const [storeSteps, setStoreSteps] = useState({})
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  const [detailRow, setDetailRow] = useState(null)        // 點 row 開的明細 modal
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)  // 防 race condition：快速切 row 時丟棄舊 fetch
  // 附件（對齊 Leave）：上傳到 attachments bucket / overtime/ 子目錄
  const [attachFiles, setAttachFiles] = useState([])
  const [uploading, setUploading] = useState(false)

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || [])
    const newFiles = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    setAttachFiles(prev => [...prev, ...newFiles].slice(0, 5))
    e.target.value = ''
  }
  const removeAttach = (idx) => {
    setAttachFiles(prev => {
      try { URL.revokeObjectURL(prev[idx].preview) } catch {}
      return prev.filter((_, i) => i !== idx)
    })
  }
  const uploadAttachments = async (otId, empId) => {
    if (attachFiles.length === 0) return
    setUploading(true)
    try {
      await uploadFormAttachments({
        formType: 'overtime', formId: otId, files: attachFiles,
        organizationId: profile?.organization_id,
        uploaderEmpId: empId || profile?.id, uploaderName: profile?.name,
      })
    } finally {
      setUploading(false)
    }
  }

  // employees 多帶 store_id 進來，這樣選人後可查 step
  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getOvertimeRequests(),
      supabase.from('employees').select('id, name, dept, store_id, department_id, position, signature_url, departments!department_id(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('id, name, overtime_step_hours, organization_id').eq('organization_id', profile?.organization_id ?? -1).order('name'),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([r, e, d, s, orgRes]) => {
      const emps = e.data || []
      setRecords(r.data || [])
      setEmployees(emps)
      setDepartments(d.data || [])
      const steps = {}
      ;(s.data || []).forEach(st => { steps[st.id] = Number(st.overtime_step_hours) || 0.5 })
      setStoreSteps(steps)
      setStores(s.data || [])
      setOrganization(orgRes?.data || null)
      setForm(f => ({ ...f, employee: f.employee || profile?.name || emps[0]?.name || '' }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  // Dashboard ApprovalCenter 跳過來時 ?focus=ID 自動開明細
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !records.length) return
    const row = records.find(r => r.id === Number(focus))
    if (row) {
      openDetail(row)
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [records, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    try {
      if (!validateRequired(form, ['employee', 'date', 'store', 'start_time', 'end_time', 'reason'], setErrors)) return
      if (!form.hours || form.hours <= 0) { toast.error('加班時數計算為 0，請檢查起訖時間'); return }

      // ── 編輯重送路徑 ──
      if (editingId) {
        const { error: updErr } = await supabase.from('overtime_requests')
          .update({ ...form, status: '待審核', reject_reason: null })
          .eq('id', editingId)
        if (updErr) throw updErr
        try {
          await supabase.rpc('resume_workflow_for_request', { p_type: 'overtime', p_id: editingId })
        } catch (e) { console.error('[resume_workflow] failed:', e) }
        setRecords(prev => prev.map(r => r.id === editingId ? { ...r, ...form, status: '待審核', reject_reason: null } : r))
        setShowModal(false)
        setEditingId(null)
        setForm({ employee: profile?.name || employees[0]?.name || '', date: '', start_time: '', end_time: '', hours: 0, reason: '', store: '' })
        return
      }

      // ── 新增路徑 ──
      const { data, error } = await createOvertimeRequest({ ...form, status: '待審核' })
      if (error) throw error
      if (data) {
        const empRow = employees.find(em => em.name === form.employee)
        if (attachFiles.length > 0) {
          await uploadAttachments(data.id, empRow?.id)
          setAttachFiles([])
        }
        setRecords(prev => [...prev, data])
        setShowModal(false)
        setForm({ employee: profile?.name || employees[0]?.name || '', date: '', start_time: '', end_time: '', hours: 0, reason: '', store: '' })
        await createApprovalWorkflow('overtime', data, form.employee)
      }
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // Helper: write overtime hours to attendance_records
  const writeAttendance = async (rec) => {
    if (rec.employee && rec.date && rec.hours) {
      const { data: att } = await supabase.from('attendance_records')
        .select('id, hours')
        .eq(rec.employee_id ? 'employee_id' : 'employee', rec.employee_id || rec.employee)
        .eq('date', rec.date).maybeSingle()
      if (att) {
        await supabase.from('attendance_records').update({
          hours: (Number(att.hours) || 0) + Number(rec.hours),
        }).eq('id', att.id)
      } else {
        await supabase.from('attendance_records').insert({
          employee: rec.employee, date: rec.date,
          hours: Number(rec.hours), status: '加班',
        })
      }
    }
  }

  const handleApprove = async (id) => {
    try {
      const record = records.find(r => r.id === id)
      if (record) {
        const wf = await getWorkflowForRecord('加班簽核', record.employee)
        const pendingStep = wf?.workflow_steps?.find(s => s.status === '待處理')
        if (pendingStep) {
          const result = await advanceWorkflow(pendingStep.id, profile?.name || '主管', '核准')
          if (result.error) { toast.error('操作失敗：' + result.error); return }
          setRecords(prev => prev.map(r => r.id === id ? { ...r, status: '已核准' } : r))
          await writeAttendance(record)
          return
        }
      }
      // Fallback: no workflow running — use secure RPC (enforces org isolation + status guard)
      const { data, error } = await supabase.rpc('secure_update_overtime_status', {
        p_id: id, p_status: '已核准',
      })
      if (error) throw error
      if (data) {
        setRecords(prev => prev.map(r => r.id === id ? data : r))
        await writeAttendance(data)
      }
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleReject = async (id, reasonArg) => {
    const reason = reasonArg ?? prompt('請輸入駁回原因：')
    if (reason === null) return
    if (!reason.trim()) { toast.warning('請填寫駁回原因'); return }
    try {
      const record = records.find(r => r.id === id)
      if (record) {
        const wf = await getWorkflowForRecord('加班簽核', record.employee)
        const pendingStep = wf?.workflow_steps?.find(s => s.status === '待處理')
        if (pendingStep) {
          const result = await advanceWorkflow(pendingStep.id, profile?.name || '主管', '退回', reason.trim())
          if (result.error) { toast.error('操作失敗：' + result.error); return }
          setRecords(prev => prev.map(r => r.id === id ? { ...r, status: '已拒絕' } : r))
          return
        }
      }
      // Fallback: no workflow running — use secure RPC (enforces org isolation + status guard)
      const { data, error } = await supabase.rpc('secure_update_overtime_status', {
        p_id: id, p_status: '已駁回', p_reject_reason: reason.trim(),
      })
      if (error) throw error
      if (data) setRecords(prev => prev.map(r => r.id === id ? data : r))
    } catch (err) {
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // 點 row → 開明細 modal + 非同步抓 workflow chain
  const openDetail = async (row) => {
    detailRowIdRef.current = row.id
    setDetailRow(row)
    setLoadingChain(true)
    setDetailChainSteps([])
    const empRow = employees.find(e => e.name === row.employee)
    const steps = await buildFormChainSteps({
      formType: 'overtime',
      organizationId: profile?.organization_id,
      applicantName: row.employee,
      applicantId: empRow?.id,
      applicantCreatedAt: row.created_at,
      recordStatus: row.status,
      approverName: row.approver,
      approvedAt: row.approved_at,
      rejectReason: row.reject_reason,
    })
    if (detailRowIdRef.current !== row.id) return  // race guard
    setDetailChainSteps(steps)
    setLoadingChain(false)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''

  // 印簽呈統一邏輯：先 fetch 該單實際 chain → 把 chainSteps + approverMap 一起餵給 PDF
  // 這樣老闆改 chain（/system/approval-chains）後 PDF 會跟著動態更新欄數
  // 注意：window.open 必須在 click handler 同步呼叫，避免被 popup blocker 擋
  const printWithChain = async (row) => {
    if (!employees.length) { toast.error('員工清單載入中，請稍候'); return }
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      const empRow = employees.find(e => e.name === row.employee)
      const chainSteps = await buildFormChainSteps({
        formType: 'overtime',
        organizationId: profile?.organization_id,
        applicantName: row.employee,
        applicantId: empRow?.id,
        applicantCreatedAt: row.created_at,
        recordStatus: row.status,
        approverName: row.approver,
        approvedAt: row.approved_at,
        rejectReason: row.reject_reason,
      })
      const approverMap = {}
      chainSteps.forEach(s => { if (s.target_emp_id && s.name) approverMap[s.target_emp_id] = s.name })
      printOvertimeSignOff(row, {
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

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '移至最近刪除？可在 60 天內復原。' }))) return
    const { error } = await supabase.rpc('soft_delete_request', { p_table: 'overtime_requests', p_id: row.id, p_deleted_by: profile?.id ?? null })
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已移至最近刪除')
    setRecords(prev => prev.filter(x => x.id !== row.id))
  }

  const filtered = records.filter(r =>
    (deptFilter === '' || getEmpDept(r.employee) === deptFilter) &&
    (!search.trim() || String(r.id).includes(search.trim()))
  )


  const totalHours = filtered.filter(r => r.status === '已核准').reduce((s, r) => s + (r.hours || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🕐</span> 加班申請</h2>
            <p>加班時數申請與審核</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(role?.name === 'super_admin' || role?.name === 'admin') && (
              <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=overtime&label=加班')} title="設定加班簽核流程">
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
                setForm({ employee: profile?.name || employees[0]?.name || '', date: '', start_time: '', end_time: '', hours: 0, reason: '', store: '' })
                setErrors({})
                setShowModal(true)
              }}><Plus size={14} /> 新增加班</button>
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
          <div className="stat-card-value">{filtered.filter(r => r.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核准</div>
          <div className="stat-card-value">{filtered.filter(r => r.status === '已核准').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">核准總時數</div>
          <div className="stat-card-value">{totalHours}h</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 加班紀錄</div>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋單號" style={{ paddingLeft: 26, paddingRight: search ? 26 : 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 120 }} />
            {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><XIcon size={12} /></button>}
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th style={{ width: 55 }}>單號</th><th>員工</th><th>部門</th><th>日期</th><th>時數</th><th>原因</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無加班紀錄</td></tr>}
              {filtered.map(o => (
                <tr key={o.id} onClick={() => openDetail(o)} style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>#{o.id}</td>
                  <td style={{ fontWeight: 600 }}>{o.employee}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(o.employee) || '-'}</td>
                  <td>{o.date}</td>
                  <td>{o.hours}h</td>
                  <td>{o.reason}</td>
                  <td>
                    <span className={`badge ${o.status === '已核准' ? 'badge-success' : o.status === '已拒絕' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{o.status}
                    </span>
                    {o.reject_reason && (
                      <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>原因：{o.reject_reason}</div>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {o.status === '待審核' && canApprove('overtime_requests', o.id) && (
                        <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>點明細簽核</span>
                      )}
                      {['待審核','申請中','已拒絕','已駁回','已退回'].includes(o.status) && o.employee === profile?.name && (
                        <button className="btn btn-sm btn-primary" style={{ background: 'var(--accent-orange)' }} onClick={() => {
                          setEditingId(o.id)
                          setForm({ employee: o.employee, date: o.date || '', start_time: o.start_time || '', end_time: o.end_time || '', hours: o.hours || 0, reason: o.reason || '', store: o.store || '' })
                          setShowModal(true)
                        }}>✏️ {(['已拒絕','已駁回','已退回'].includes(o.status)) ? '編輯重送' : '編輯'}</button>
                      )}
                      <button className="btn btn-sm btn-secondary" title="下載簽呈"
                        onClick={() => printWithChain(o)}>
                        <Printer size={11} />
                      </button>
                      {canDeleteAll && (
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(o)} title="永久刪除">
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
          title={editingId ? '✏️ 編輯重送（駁回後修改）' : '新增加班申請'}
          onClose={() => { setShowModal(false); setErrors({}); setEditingId(null) }}
          onSubmit={handleSubmit}
          successMessage={editingId ? '已重新送審，主管會收到通知' : '加班申請已送出，等待主管簽核'}
        >
          <Field label="員工" required error={errors.employee} errorMsg="請選擇員工">
            <SearchableSelect
              value={form.employee}
              onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="搜尋員工姓名/職稱..."
            />
          </Field>
          <Field label="加班日期" required error={errors.date} errorMsg="請選日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => { set('date', e.target.value); clearError('date', setErrors) }} />
          </Field>
          <Field label="加班門市" required error={errors.store} errorMsg="請選門市">
            <select className="form-input" style={{ width: '100%' }} value={form.store || ''}
              onChange={e => { set('store', e.target.value); clearError('store', setErrors) }}>
              <option value="">— 選擇加班門市 —</option>
              {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              💡 跨門市加班請選實際支援門市
            </div>
          </Field>
          {(() => {
            const selectedEmp = employees.find(e => e.name === form.employee)
            const step = (selectedEmp && storeSteps[selectedEmp.store_id]) || 0.5
            const crossDay = form.start_time && form.end_time
              && (form.end_time <= form.start_time)

            // 勞基法 §32 軟提醒（不擋送單，僅警示）
            //   單日加班一般 4h、勞資會議同意 12h
            //   單月加班一般 46h、勞資會議同意 54h（每 3 個月 ≤ 138h）
            let monthUsed = 0
            if (form.employee && form.date && form.date.length >= 7) {
              const ym = form.date.slice(0, 7)
              monthUsed = records
                .filter(r => r.employee === form.employee)
                .filter(r => r.date && r.date.slice(0, 7) === ym)
                .filter(r => r.id !== editingId)
                .filter(r => ['已核准', '待審核', '申請中'].includes(r.status))
                .reduce((s, r) => s + (Number(r.hours) || 0), 0)
            }
            const monthTotal = monthUsed + (Number(form.hours) || 0)
            const dailyWarn = (Number(form.hours) || 0) > 4
            const monthOver46 = monthTotal > 46
            const monthOver54 = monthTotal > 54
            const hasWarn = dailyWarn || monthOver46

            return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="加班起時" required error={errors.start_time} errorMsg="請選起始時間">
                    <input className="form-input" type="time" style={{ width: '100%' }}
                      value={form.start_time || ''}
                      onChange={e => {
                        const v = e.target.value
                        setForm(f => ({ ...f, start_time: v, hours: computeOvertimeHours(v, f.end_time, step) }))
                        clearError('start_time', setErrors)
                      }} />
                  </Field>
                  <Field label="加班訖時" required error={errors.end_time} errorMsg="請選結束時間">
                    <input className="form-input" type="time" style={{ width: '100%' }}
                      value={form.end_time || ''}
                      onChange={e => {
                        const v = e.target.value
                        setForm(f => ({ ...f, end_time: v, hours: computeOvertimeHours(f.start_time, v, step) }))
                        clearError('end_time', setErrors)
                      }} />
                  </Field>
                </div>
                <Field label="總時數">
                  <div style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: form.hours > 0 ? 'var(--accent-cyan-dim)' : 'var(--glass-light)',
                    color: form.hours > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    fontWeight: 700, fontSize: 18,
                    border: '1px solid var(--border-subtle)',
                  }}>
                    {form.hours > 0 ? `${form.hours} 小時` : '請選擇起訖時間'}
                    {crossDay && <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 8, color: 'var(--accent-orange)' }}>（跨日）</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    本店加班最小單位 <b style={{ color: 'var(--accent-cyan)' }}>{step}</b> 小時 · 訖時 ≤ 起時自動視為跨日
                  </div>
                  {form.hours > 0 && form.date && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      本月已累計 <b style={{ color: monthOver46 ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>{monthTotal}h</b>
                      <span style={{ opacity: 0.7 }}>（含本筆，已核准+待審）</span>
                    </div>
                  )}
                  {hasWarn && (
                    <div style={{
                      marginTop: 8, padding: '8px 12px', borderRadius: 8,
                      background: monthOver54 ? 'var(--accent-red-dim)' : 'var(--accent-orange-dim)',
                      color: monthOver54 ? 'var(--accent-red)' : 'var(--accent-orange)',
                      fontSize: 12, lineHeight: 1.6,
                      border: `1px solid ${monthOver54 ? 'var(--accent-red)' : 'var(--accent-orange)'}`,
                    }}>
                      {dailyWarn && (
                        <div>⚠️ 單日加班 {form.hours}h 超過勞基法 §32 一般上限 4 小時</div>
                      )}
                      {monthOver46 && !monthOver54 && (
                        <div>⚠️ 本月加班 {monthTotal}h 超過勞基法 §32 一般月上限 46 小時，須有工會 / 勞資會議同意</div>
                      )}
                      {monthOver54 && (
                        <div>🚨 本月加班 {monthTotal}h 超過勞資會議同意上限 54 小時（季合計 ≤ 138h）</div>
                      )}
                      <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4, fontWeight: 400 }}>
                        ※ 僅提示，仍可送出，由主管裁量
                      </div>
                    </div>
                  )}
                </Field>
              </>
            )
          })()}
          <Field label="原因" required error={errors.reason} errorMsg="請填寫加班原因">
            <textarea className="form-input" rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="請輸入加班原因" value={form.reason} onChange={e => { set('reason', e.target.value); clearError('reason', setErrors) }} />
          </Field>
          <Field label="附件（最多 5 個）">
            <div>
              <input type="file" multiple accept="image/*,application/pdf"
                onChange={handleFileSelect}
                style={{ fontSize: 12 }}
              />
              {attachFiles.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {attachFiles.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                      <Paperclip size={11} />
                      <span style={{ flex: 1 }}>{a.file.name}</span>
                      <button type="button" onClick={() => removeAttach(i)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              {uploading && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>📤 附件上傳中…</div>}
            </div>
          </Field>
        </Modal>
      )}

      {/* ─── 明細 modal（點 row 開）─── */}
      {detailRow && (() => {
        const empRow = employees.find(e => e.name === detailRow.employee)
        return (
          <ApprovalDetailModal
            open={!!detailRow}
            onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
            docTitle={detailRow.is_pre_approval ? '預先加班申請' : '加班申請'}
            docNo={detailRow.id}
            status={detailRow.status}
            applicant={{
              name: detailRow.employee,
              name_en: empRow?.name_en,
              position: empRow?.position,
              dept: getEmpDept(detailRow.employee),
              status: empRow?.status,
              employee_no: empRow?.employee_no || (empRow?.id ? `ID ${empRow.id}` : undefined),
            }}
            fields={[
              { label: '加班類型', value: detailRow.is_pre_approval ? '預先申請' : '事後補登' },
              { label: '加班日期', value: detailRow.date },
              { label: '時數', value: `${detailRow.hours || 0} 小時` },
              { label: '事由', value: detailRow.reason, multiline: true },
              ...(detailRow.reject_reason
                ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }]
                : []),
            ]}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            requestType="overtime"
            requestId={detailRow.id}
            onPrint={() => printWithChain(detailRow)}
            actions={
              detailRow.status === '待審核' && canApprove('overtime_requests', detailRow.id) ? {
                sourceTable: 'overtime_requests',
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
