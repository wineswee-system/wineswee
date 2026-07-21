import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useReturnNav } from '../../lib/useReturnNav'
import { Plus, Printer, Settings, Paperclip, Search, X as XIcon } from 'lucide-react'
import { getOvertimeRequests, createOvertimeRequest, updateOvertimeStatus } from '../../lib/db'
import { createApprovalWorkflow, getWorkflowForRecord, advanceWorkflow } from '../../lib/workflowIntegration'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import DateRangeField from '../../components/DateRangeField'
import { monthStartTW, todayTW } from '../../lib/datetime'
import Time24 from '../../components/Time24'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import ExtraSignerControls from '../../components/ExtraSignerControls'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { printOvertimeSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildFormChainSteps, mergeStepSignTimes } from '../../lib/buildChainSteps'
import { validateRequired, clearError } from '../../lib/formValidation'
import { uploadFormAttachments, cloneFormAttachments, loadCarriedFormAttachments } from '../../lib/formAttachments'
import CarriedAttachments from '../../components/CarriedAttachments'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { useChainGuard } from '../../lib/useChainGuard'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

// 加班應扣休息分鐘（沿用全系統階梯 = clock-in / scheduleUtils.getRestMinutes）：
//   毛時數 <5h → 0 · 5~9h → 30 · ≥9h → 60（上限）
function otRestMinutes(grossHours) {
  if (grossHours < 5) return 0
  if (grossHours < 9) return 30
  return 60
}

// 算加班時數：依起訖時間 + 商店最小單位（step），並自動扣休息時間（淨工時）
// 跨日：end <= start 自動 +24h（例 22:00 -> 02:00 = 4 小時）
// 扣休息後再湊 step；存進 hours→trigger 同步 ot_hours→計薪直接用淨值。
function computeOvertimeHours(start, end, step = 0.5) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) mins += 24 * 60
  const netMins = Math.max(0, mins - otRestMinutes(mins / 60))
  return Math.round(netMins / 60 / step) * step
}

export default function Overtime() {
  const { profile, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const { canApprove } = usePendingApprovals()
  const chainGuard = useChainGuard({ formType: 'overtime', organizationId: profile?.organization_id })
  const navigate = useNavigate()
  const returnNav = useReturnNav()
  const [records, setRecords] = useState([])
  const [signedIds, setSignedIds] = useState(new Set())  // 已有人簽過的 OT request id（編輯/撤回鎖用）
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [startDate, setStartDate] = useState(() => monthStartTW())  // 日期區間，預設本月1號~今天
  const [endDate, setEndDate] = useState(() => todayTW())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [cloneSourceId, setCloneSourceId] = useState(null)  // 複製重送：來源單 id（送出後複製其附件）
  const [carriedAtts, setCarriedAtts] = useState([])  // 編輯/複製帶入的舊附件（彈窗內可看/可刪）
  const removeCarriedAtt = (idx) => setCarriedAtts(prev => prev.filter((_, i) => i !== idx))
  const originalEditAttIdsRef = useRef([])
  const [form, setForm] = useState({ employee: '', date: '', start_time: '', end_time: '', hours: 0, reason: '', store: '', ot_type: 'pay' })
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
  const load = () => {
    const orgId = profile?.organization_id
    return Promise.all([
      getOvertimeRequests({ from: startDate, to: endDate }),
      supabase.from('employees').select('id, name, dept, store_id, department_id, position, signature_url, departments!department_id(name), salary_structures(salary_type)').eq('status', '在職').order('name'),
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
  }

  useEffect(() => { load() }, [startDate, endDate, profile?.organization_id])

  // 抓「已有人 approved 過」的 OT id（駁回不算）— 用來鎖編輯/撤回
  // 走 SECURITY DEFINER RPC 繞 approval_step_history 的 RLS
  useEffect(() => {
    if (!records.length) { setSignedIds(new Set()); return }
    const ids = records.map(r => r.id).filter(Boolean)
    if (!ids.length) return
    supabase.rpc('list_request_ids_with_approved_step', {
      p_request_type: 'overtime',
      p_request_ids: ids,
    }).then(({ data }) => {
      setSignedIds(new Set((data || []).map(r => typeof r === 'number' ? r : r.list_request_ids_with_approved_step)))
    })
  }, [records])

  // 表單選好員工 + 日期 → 自動分類 ot_category（給 FT 例假 UI 鎖用）
  const [otCategory, setOtCategory] = useState(null)
  useEffect(() => {
    const emp = employees.find(e => e.name === form.employee)
    if (!form.date || !emp?.id) { setOtCategory(null); return }
    supabase.rpc('classify_ot_category_safe', {
      p_date: form.date,
      p_employee_id: emp.id,
    }).then(({ data }) => setOtCategory(data))
  }, [form.date, form.employee, employees])

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

      // ── 單筆時數 sanity（對齊 DB：四週變形工時，單筆上限 12h；合規由排班檢查把關）──
      if (Number(form.hours) > 12) {
        toast.error(`⛔ 單筆加班時數異常（最多 12 小時），本次 ${form.hours} 小時，請確認起訖時間`)
        return
      }

      // ── 本月加班上限 46h 硬擋（特例匯入不受此限；DB trigger 也會擋）──
      const ym = form.date?.slice(0, 7)
      const monthUsed = records
        .filter(r => r.employee === form.employee && r.id !== editingId
          && r.date?.slice(0, 7) === ym
          && ['已核准', '待審核', '申請中'].includes(r.status)
          && !r.is_exception)
        .reduce((s, r) => s + (Number(r.hours) || 0), 0)
      if (monthUsed + Number(form.hours) > 46) {
        toast.error(`⛔ 本月加班已達上限（46 小時）。當月已 ${monthUsed} 小時，本次 ${form.hours} 小時，合計 ${monthUsed + Number(form.hours)}`)
        return
      }

      // ── 同日時段重疊才擋（同日不同時段的加班可各自請；對齊 LIFF）──
      const toMin = t => { const [h, m] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
      const dup = records.find(r => r.id !== editingId && r.employee === form.employee && r.date === form.date
        && !['已駁回', '已退回', '已拒絕', '已取消'].includes(r.status)
        && toMin(form.start_time) < toMin(r.end_time) && toMin(form.end_time) > toMin(r.start_time))
      if (dup) { toast.error(`${form.date} ${dup.start_time}~${dup.end_time} 已有加班（時段重疊）`); return }

      // ── 編輯重送路徑 ──
      if (editingId) {
        const { error: updErr } = await supabase.from('overtime_requests')
          .update({ ...form, status: '待審核', reject_reason: null })
          .eq('id', editingId)
        if (updErr) throw updErr
        // 刪除被移除的附件
        if (originalEditAttIdsRef.current.length > 0) {
          const keptIds = new Set(carriedAtts.map(a => a.id).filter(Boolean))
          const toDelete = originalEditAttIdsRef.current.filter(id => !keptIds.has(id))
          if (toDelete.length > 0) await supabase.from('form_attachments').delete().in('id', toDelete)
          originalEditAttIdsRef.current = []
        }
        // 上傳新增的附件
        if (attachFiles.length > 0) {
          const empRow = employees.find(em => em.name === form.employee)
          await uploadFormAttachments({ formType: 'overtime', formId: editingId, files: attachFiles, organizationId: profile?.organization_id, uploaderEmpId: empRow?.id, uploaderName: form.employee })
          setAttachFiles([])
        }
        try {
          const { error: rpcErr } = await supabase.rpc('resume_workflow_for_request', { p_type: 'overtime', p_id: editingId })
          if (rpcErr) {
            console.error('[resume_workflow] error:', rpcErr)
            toast.error('簽核流程重啟失敗：' + rpcErr.message)
          }
        } catch (e) {
          console.error('[resume_workflow] failed:', e)
          toast.error('簽核流程重啟失敗：' + (e.message || '未知錯誤'))
        }
        setRecords(prev => prev.map(r => r.id === editingId ? { ...r, ...form, status: '待審核', reject_reason: null } : r))
        setShowModal(false)
        setEditingId(null)
        setCarriedAtts([])
        setForm({ employee: profile?.name || employees[0]?.name || '', date: '', start_time: '', end_time: '', hours: 0, reason: '', store: '', ot_type: 'pay' })
        return
      }

      // ── 新增路徑（走 create_overtime_request RPC：淨工時後端算、單一寫入路徑）──
      const empRow = employees.find(em => em.name === form.employee)
      const { data, error } = await supabase.rpc('create_overtime_request', {
        p_employee_id: empRow?.id ?? null,
        p_date: form.date,
        p_start_time: form.start_time,
        p_end_time: form.end_time,
        p_ot_type: form.ot_type || 'pay',
        p_reason: form.reason,
        p_store: form.store,
        p_is_pre_approval: form.is_pre_approval || false,
      })
      if (error) throw error
      if (data) {
        if (attachFiles.length > 0) {
          await uploadAttachments(data.id, empRow?.id)
          setAttachFiles([])
        }
        // 複製重送：把彈窗裡「留下的」舊附件複製到新單（含 storage 檔，獨立）
        if (cloneSourceId) {
          if (carriedAtts.length) {
            await cloneFormAttachments({ formType: 'overtime', toFormId: data.id, organizationId: profile?.organization_id, uploaderEmpId: empRow?.id, uploaderName: form.employee, atts: carriedAtts })
          }
          setCloneSourceId(null)
          setCarriedAtts([])
        }
        setRecords(prev => [...prev, data])
        setShowModal(false)
        setForm({ employee: profile?.name || employees[0]?.name || '', date: '', start_time: '', end_time: '', hours: 0, reason: '', store: '', ot_type: 'pay' })
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
      const { data: result, error } = await supabase.rpc('web_advance_chain_request', {
        p_type: 'overtime', p_id: id, p_action: 'approve',
      })
      if (error) throw error
      if (!result?.ok) { toast.error('操作失敗：' + (result?.error || '未知')); return }
      if (result.event === 'approved' && record) await writeAttendance(record)
      setRecords(prev => prev.map(r => r.id === id ? { ...r, status: result.status } : r))
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
      const { data: result, error } = await supabase.rpc('web_advance_chain_request', {
        p_type: 'overtime', p_id: id, p_action: 'reject', p_reason: reason.trim(),
      })
      if (error) throw error
      if (!result?.ok) { toast.error('操作失敗：' + (result?.error || '未知')); return }
      setRecords(prev => prev.map(r => r.id === id ? { ...r, status: result.status } : r))
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
      requestType: 'overtime_request',
      requestId: row.id,
      currentStep: row.current_step,
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
      let chainSteps = await buildFormChainSteps({
        formType: 'overtime',
        organizationId: profile?.organization_id,
        applicantName: row.employee,
        applicantId: empRow?.id,
        applicantCreatedAt: row.created_at,
        recordStatus: row.status,
        approverName: row.approver,
        approvedAt: row.approved_at,
        rejectReason: row.reject_reason,
        // ★ 標對駁回關 + 補每關簽核時間
        requestType: 'overtime_request', requestId: row.id, currentStep: row.current_step,
      })
      chainSteps = await mergeStepSignTimes('overtime', row.id, chainSteps)
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
    (storeFilter === '' || r.store === storeFilter) &&
    (!search.trim() || [String(r.id), r.employee_name, r.reason, r.store].some(f => (f||'').toLowerCase().includes(search.trim().toLowerCase())))
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
            {hasPermission('approval_chain.edit') && (
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
                setForm({ employee: profile?.name || employees[0]?.name || '', date: '', start_time: '', end_time: '', hours: 0, reason: '', store: '', ot_type: 'pay' })
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
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📅 日期</span>
        <DateRangeField start={startDate} end={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e) }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏢 部門</span>
        <SearchableSelect
          value={deptFilter || ''}
          onChange={(v) => setDeptFilter(v || '')}
          options={[
            { value: '', label: '全部部門' },
            ...departments.map(d => ({ value: d.name, label: d.name })),
          ]}
          placeholder="全部部門"
          style={{ minWidth: 180 }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏪 門市</span>
        <SearchableSelect
          value={storeFilter || ''}
          onChange={(v) => setStoreFilter(v || '')}
          options={[
            { value: '', label: '全部門市' },
            ...stores.map(s => ({ value: s.name, label: s.name })),
          ]}
          placeholder="全部門市"
          style={{ minWidth: 180 }}
        />
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
                      {/* 編輯規則：rejected 系列永遠可編輯重送；待審核/申請中 必須沒人簽過 */}
                      {(() => {
                        const isRejected = ['已拒絕','已駁回','已退回'].includes(o.status)
                        const isPending = ['待審核','申請中'].includes(o.status)
                        const hasSigned = signedIds.has(o.id)
                        const canEdit = o.employee === profile?.name && (isRejected || (isPending && !hasSigned))
                        if (!canEdit) {
                          if (isPending && hasSigned && o.employee === profile?.name) {
                            return <span style={{ fontSize: 11, color: 'var(--text-muted)' }} title="已有人簽核，無法編輯">🔒 簽核中</span>
                          }
                          return null
                        }
                        return (
                          <button className="btn btn-sm btn-primary" style={{ background: 'var(--accent-orange)' }} onClick={() => {
                            setEditingId(o.id)
                            setForm({ employee: o.employee, date: o.date || '', start_time: o.start_time || '', end_time: o.end_time || '', hours: o.hours || 0, reason: o.reason || '', store: o.store || '', ot_type: o.ot_type || 'pay' })
                            loadCarriedFormAttachments('overtime', o.id).then(atts => {
                              setCarriedAtts(atts)
                              originalEditAttIdsRef.current = atts.map(a => a.id).filter(Boolean)
                            })
                            setShowModal(true)
                          }}>✏️ {isRejected ? '編輯重送' : '編輯'}</button>
                        )
                      })()}
                      {o.employee === profile?.name && (
                        <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-cyan)' }} title="以這張為範本開一張全新申請（含附件，不動原單）" onClick={() => {
                          setEditingId(null)
                          setCloneSourceId(o.id)
                          loadCarriedFormAttachments('overtime', o.id).then(setCarriedAtts)
                          setForm({ employee: o.employee, date: o.date || '', start_time: o.start_time || '', end_time: o.end_time || '', hours: o.hours || 0, reason: o.reason || '', store: o.store || '', ot_type: o.ot_type || 'pay' })
                          setShowModal(true)
                        }}>📋 複製</button>
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
          onClose={() => { setShowModal(false); setErrors({}); setEditingId(null); setCloneSourceId(null); setCarriedAtts([]) }}
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

            // 本月加班累計（中性顯示；四週變形工時無 4h/46h 週制框架，合規由排班檢查把關）
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

            return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="加班起時" required error={errors.start_time} errorMsg="請選起始時間">
                    <Time24 value={form.start_time || ''}
                      onChange={v => {
                        setForm(f => ({ ...f, start_time: v, hours: computeOvertimeHours(v, f.end_time, step) }))
                        clearError('start_time', setErrors)
                      }} />
                  </Field>
                  <Field label="加班訖時" required error={errors.end_time} errorMsg="請選結束時間">
                    <Time24 value={form.end_time || ''}
                      onChange={v => {
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
                  {(() => {
                    if (!form.start_time || !form.end_time) return null
                    const toM = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
                    let g = toM(form.end_time) - toM(form.start_time); if (g <= 0) g += 1440
                    const rest = g < 300 ? 0 : g < 540 ? 30 : 60
                    if (rest === 0) return null
                    return (
                      <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>
                        ⏱ 毛時數 {(g / 60).toFixed(1)}h，已自動扣休息 {rest} 分
                      </div>
                    )
                  })()}
                  {form.hours > 0 && form.date && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      本月已累計 <b style={{ color: 'var(--text-secondary)' }}>{monthTotal}h</b>
                      <span style={{ opacity: 0.7 }}>（含本筆，已核准+待審）</span>
                    </div>
                  )}
                </Field>
              </>
            )
          })()}
          {(() => {
            // FT 例假偵測：靠 PG classify_ot_category_safe RPC（吃排班 shift '例假' / 國定假日 / DOW fallback）
            const selEmp = employees.find(e => e.name === form.employee)
            const empSalaryType = selEmp?.salary_structures?.[0]?.salary_type
              || selEmp?.salary_structures?.salary_type
              || 'monthly'
            const isFT = empSalaryType === 'monthly'
            const isFTWeeklyOff = isFT && otCategory === 'weekly_off'
            // 強制設 pay（避免員工已選 comp_time）
            if (isFTWeeklyOff && (form.ot_type || 'pay') !== 'pay') {
              setTimeout(() => set('ot_type', 'pay'), 0)
            }
            return (
              <Field label="加班結算方式" required>
                {isFTWeeklyOff ? (
                  <div style={{
                    padding: '12px 16px', borderRadius: 10,
                    background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)',
                    color: 'var(--accent-orange)', fontSize: 13, fontWeight: 600, lineHeight: 1.5,
                  }}>
                    🔒 正職員工例假上班 → 自動「加班費 ×2 + 補休（時數同 OT）」
                    <div style={{ fontSize: 11, fontWeight: 400, marginTop: 4, color: 'var(--text-secondary)' }}>
                      系統強制套用，無法選擇純補休
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {[
                        { v: 'pay',       label: '💰 加班費',   hint: '當月薪資領取' },
                        { v: 'comp_time', label: '🕐 補休',     hint: '同時數補休（1 年內有效，未用自動換加班費）' },
                      ].map(opt => {
                        const selected = (form.ot_type || 'pay') === opt.v
                        return (
                          <label key={opt.v} style={{
                            flex: '1 1 200px', cursor: 'pointer',
                            padding: '10px 14px', borderRadius: 8,
                            background: selected ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                            border: `2px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                            transition: 'all 0.15s',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="radio" name="ot_type" value={opt.v} checked={selected}
                                onChange={() => set('ot_type', opt.v)} style={{ accentColor: 'var(--accent-cyan)' }} />
                              <span style={{ fontWeight: 600, fontSize: 14, color: selected ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>{opt.label}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginLeft: 24 }}>{opt.hint}</div>
                          </label>
                        )
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      💡 補休送出後不能改成加班費；補休沒用完到期前一個月會提醒，過期自動兌現
                    </div>
                  </>
                )}
              </Field>
            )
          })()}
          <Field label="原因" required error={errors.reason} errorMsg="請填寫加班原因">
            <textarea className="form-input" rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="請輸入加班原因" value={form.reason} onChange={e => { set('reason', e.target.value); clearError('reason', setErrors) }} />
          </Field>
          <Field label="附件（最多 5 個）">
            <div>
              <CarriedAttachments atts={carriedAtts} onRemove={removeCarriedAtt} />
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
              { label: '加班時間', value: (detailRow.start_time || detailRow.end_time)
                  ? `${String(detailRow.start_time || '').slice(0, 5)}–${String(detailRow.end_time || '').slice(0, 5)}` : '—' },
              { label: '時數', value: `${detailRow.hours || 0} 小時` },
              { label: '事由', value: detailRow.reason, multiline: true },
              ...(detailRow.reject_reason
                ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }]
                : []),
            ]}
            attachments={(detailRow.attachments || []).map(url => ({
              url,
              name: decodeURIComponent(url.split('?')[0].split('/').pop() || '附件'),
            }))}
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
