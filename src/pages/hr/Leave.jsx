import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { Plus, Search, Info, Paperclip, Printer, Settings } from 'lucide-react'
import { getLeaveRequests, createLeaveRequest, updateLeaveStatus, getActiveEmployees, getDepartments, getLeaveStepSettings } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { getSupervisor } from '../../lib/approval'
import { useAuth } from '../../contexts/AuthContext'
import { LEAVE_TYPES, getAnnualLeaveEntitlement, getLeaveTypeInfo, validateLeaveRequest } from '../../lib/leavePolicy'
import { getEffectiveBenefits, getStoreIdByName } from '../../lib/benefitPolicy'
import { createApprovalWorkflow, getWorkflowForRecord, advanceWorkflow } from '../../lib/workflowIntegration'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import ExtraSignerControls from '../../components/ExtraSignerControls'
import { empLabel } from '../../lib/empLabel'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { useVirtualList, VirtualRow } from '../../lib/useVirtualList.jsx'
import { getEventBus } from '../../lib/events/index.js'
import { printLeaveSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildWorkflowChainSteps, buildFormChainSteps } from '../../lib/buildChainSteps'
import { validateRequired, clearError } from '../../lib/formValidation'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { countWorkDays, snapToStep, diffHours, findDateOverlap } from '../../lib/leaveDaysCalc'
import LeaveFormModal from './components/LeaveFormModal'
import LeavePolicyModal from './components/LeavePolicyModal'

export default function Leave() {
  const { profile, role, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const { canApprove } = usePendingApprovals()
  const navigate = useNavigate()
  const [leaves, setLeaves] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showPolicyModal, setShowPolicyModal] = useState(false)
  const [form, setForm] = useState({ employee: '', type: 'annual', start_date: '', end_date: '', start_time: '09:00', end_time: '18:00', unit: 'day', hours: 0, days: 1, reason: '' })
  const [validationMsg, setValidationMsg] = useState('')
  const [error, setError] = useState(null)
  const [errors, setErrors] = useState({})  // 必填欄位驗證
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)

  // 請假最小單位設定 → 用 Map: { storeKey: { leaveCode: {step, unit} } }
  // storeKey: 'all' = 全公司預設、其他 = store id
  const [stepSettings, setStepSettings] = useState({ all: {} })
  // 國定假日清單（給 countWorkDays 用，扣除週末+國假後算實際工作天）
  const [holidays, setHolidays] = useState([])
  // 附件（對齊 LIFF）：上傳到 Supabase Storage bucket `leave-attachments`
  const [attachFiles, setAttachFiles] = useState([])
  const [uploading, setUploading] = useState(false)

  // Dashboard ApprovalCenter 跳過來時 ?focus=ID 自動開明細
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !leaves.length) return
    const row = leaves.find(l => l.id === Number(focus))
    if (row) {
      openDetail(row)
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [leaves, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || [])
    const newFiles = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    setAttachFiles(prev => [...prev, ...newFiles].slice(0, 5))  // max 5
    e.target.value = ''
  }
  const removeAttach = (idx) => {
    setAttachFiles(prev => {
      try { URL.revokeObjectURL(prev[idx].preview) } catch {}
      return prev.filter((_, i) => i !== idx)
    })
  }
  const uploadAttachments = async (leaveId, empId) => {
    if (attachFiles.length === 0) return []
    setUploading(true)
    const urls = []
    try {
      for (const { file } of attachFiles) {
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
        const path = `emp-${empId || 'unknown'}/${leaveId}-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('leave-attachments').upload(path, file, {
          cacheControl: '3600', upsert: true,
        })
        if (error) {
          console.warn('upload fail:', error)
          continue
        }
        const { data } = supabase.storage.from('leave-attachments').getPublicUrl(path)
        if (data?.publicUrl) urls.push(data.publicUrl)
      }
      // ★ 修補：把 URL 寫回 leave_requests.attachments，不然審核人看不到
      if (urls.length > 0) {
        const { error: updErr } = await supabase.from('leave_requests')
          .update({ attachments: urls })
          .eq('id', leaveId)
        if (updErr) console.warn('attach urls update fail:', updErr)
      }
    } finally {
      setUploading(false)
    }
    return urls
  }
  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getLeaveRequests({ orgId }),
      getActiveEmployees('id, name, dept, store_id, department_id, position, join_date, phone, signature_url, departments!department_id(name)', orgId),
      getDepartments(orgId),
      getLeaveStepSettings(),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('holidays').select('date'),
    ]).then(([l, e, d, ls, orgRes, hd]) => {
      const emps = e.data || []
      setLeaves(l.data || [])
      setEmployees(emps)
      setDepartments(d.data || [])
      setOrganization(orgRes?.data || null)
      setHolidays((hd.data || []).map(h => h.date))
      // 整理 stepSettings
      const map = { all: {} }
      ;(ls.data || []).forEach(row => {
        const k = row.store_id || 'all'
        if (!map[k]) map[k] = {}
        map[k][row.leave_code] = { step: Number(row.step), unit: row.unit }
      })
      setStepSettings(map)
      setForm(f => ({ ...f, employee: f.employee || profile?.name || emps[0]?.name || '' }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setValidationMsg('')
  }

  const handleSubmit = async () => {
    try {
    // 必填：員工 / 假別 / 開始日 / 事由；以日為單位時 結束日也必填；以小時為單位時 起訖時間必填
    const requiredKeys = ['employee', 'type', 'start_date', 'reason']
    if (form.unit === 'day') requiredKeys.push('end_date')
    if (form.unit === 'hour') requiredKeys.push('start_time', 'end_time')
    if (!validateRequired(form, requiredKeys, setErrors)) return

    // 取此假別此員工的 step 設定（先看員工所屬店覆寫，沒有則全公司預設，再沒有用 leavePolicy.js）
    const empForStep = employees.find(em => em.name === form.employee)
    const storeKey = empForStep?.store_id || null
    const storeOverride = (storeKey && stepSettings[storeKey]?.[form.type]) || null
    const globalOverride = stepSettings.all?.[form.type] || null
    const stepCfg = storeOverride || globalOverride || { step: selectedPolicy?.minUnit || 0.5, unit: selectedPolicy?.unit || 'day' }

    // Calculate days/hours — 跟 LIFF 對齊：日 mode 扣週末+國假
    let days, hours
    if (form.unit === 'hour') {
      hours = Math.max(0.5, diffHours(form.start_time, form.end_time))
      if (stepCfg.unit === 'hour') hours = snapToStep(hours, stepCfg.step)
      days = Math.round(hours / 8 * 10) / 10
    } else {
      const workDays = countWorkDays(form.start_date, form.end_date || form.start_date, holidays)
      days = stepCfg.unit === 'day' ? snapToStep(workDays, stepCfg.step) : workDays
      hours = days * 8
    }

    // 日期衝突檢查（同申請人）— 跟 LIFF 對齊
    const overlap = findDateOverlap(form, leaves.filter(l => l.employee === form.employee), editingId)
    if (overlap) {
      toast.error(`日期與已申請的「${overlap.type}」(${overlap.start_date}${overlap.end_date && overlap.end_date !== overlap.start_date ? ' ~ ' + overlap.end_date : ''}) 重疊`)
      return
    }

    // Validate
    const usedThisYear = leaves
      .filter(l => l.employee === form.employee && (l.type === form.type || l.type === selectedPolicy?.shortName) && l.status !== '已拒絕')
      .reduce((s, l) => s + (l.days || 0), 0)

    // 查詢門市/員工的假別加給政策
    const emp = employees.find(e => e.name === form.employee)
    const storeId = await getStoreIdByName(emp?.store)
    const leaveBenefits = await getEffectiveBenefits(emp?.id || null, storeId, 'leave')
    const customPolicy = leaveBenefits[form.type] || null

    const result = validateLeaveRequest({
      type: form.type,
      days,
      hours,
      usedDays: usedThisYear,
      customPolicy,
      joinDate: emp?.join_date,
    })

    if (!result.valid) {
      setValidationMsg(result.error)
      return
    }

    // ★ 解析 employee_id（強型別 FK）+ org_id 多租戶
    const empRow = employees.find(e2 => e2.name === form.employee)
    const payload = {
      employee: form.employee,
      employee_id: empRow?.id || null,
      type: selectedPolicy?.shortName || form.type,
      start_date: form.start_date,
      end_date: form.end_date || form.start_date,
      start_time: form.unit === 'hour' ? form.start_time : null,
      end_time: form.unit === 'hour' ? form.end_time : null,
      days,
      hours,
      reason: form.reason,
      organization_id: profile?.organization_id || null,
    }

    // ── 編輯重送路徑 ──
    if (editingId) {
      const { error: updErr } = await supabase.from('leave_requests')
        .update({ ...payload, status: '待審核', reject_reason: null })
        .eq('id', editingId)
      if (updErr) { toast.error('更新失敗：' + updErr.message); return }
      try {
        await supabase.rpc('resume_workflow_for_request', { p_type: 'leave', p_id: editingId })
      } catch (e) { console.error('[resume_workflow] failed:', e) }
      setLeaves(prev => prev.map(l => l.id === editingId ? { ...l, ...payload, status: '待審核', reject_reason: null } : l))
      setShowModal(false)
      setEditingId(null)
      setForm({ employee: profile?.name || employees[0]?.name || '', type: 'annual', start_date: '', end_date: '', start_time: '09:00', end_time: '18:00', unit: 'day', hours: 0, days: 1, reason: '' })
      setValidationMsg('')
      return
    }

    // ── 新增路徑（原邏輯）──
    const { data } = await createLeaveRequest({ ...payload, status: '待審核', approver: '-' })
    if (data) {
      setLeaves(prev => [data, ...prev])
      // 附件上傳（與 LIFF 同 bucket / path 規則）
      if (attachFiles.length > 0) {
        await uploadAttachments(data.id, empRow?.id)
      }
      setShowModal(false)
      setAttachFiles([])
      setForm({ employee: profile?.name || employees[0]?.name || '', type: 'annual', start_date: '', end_date: '', start_time: '09:00', end_time: '18:00', unit: 'day', hours: 0, days: 1, reason: '' })
      setValidationMsg('')

      // 建立簽核流程（自動找主管 → 建 workflow_instance → 通知）
      await createApprovalWorkflow('leave', data, form.employee)
    }
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleApprove = async (id) => {
    const leave = leaves.find(l => l.id === id)
    if (leave) {
      const wf = await getWorkflowForRecord('請假簽核', leave.employee)
      const pendingStep = wf?.workflow_steps?.find(s => s.status === '待處理')
      if (pendingStep) {
        const result = await advanceWorkflow(pendingStep.id, profile?.name || '主管', '核准')
        if (result.error) { toast.error('操作失敗：' + result.error); return }
        setLeaves(prev => prev.map(l => l.id === id ? { ...l, status: '已核准' } : l))
        const bus = getEventBus()
        await bus.publish('hr.leave.approved', {
          leave_id: String(id),
          employee: leave.employee,
          employee_id: String(leave.employee_id || ''),
          type: leave.type,
          days: leave.days || 0,
          start_date: leave.start_date,
          end_date: leave.end_date || leave.start_date,
          approver: profile?.name || '',
        })
        // Write leave to schedule
        if (leave.start_date && leave.days) {
          const totalDays = Math.ceil(leave.days)
          for (let i = 0; i < totalDays; i++) {
            const d = new Date(leave.start_date)
            d.setDate(d.getDate() + i)
            await supabase.from('schedules').upsert(
              { employee: leave.employee, date: d.toISOString().slice(0, 10), shift: '休' },
              { onConflict: 'employee,date' }
            )
          }
        }
        return
      }
    }
    // Fallback: no workflow running — use secure RPC (enforces org isolation + status guard)
    const { data, error: rpcErr } = await supabase.rpc('secure_update_leave_status', {
      p_id: id, p_status: '已核准', p_approver: profile?.name || '',
    })
    if (rpcErr) { toast.error('操作失敗：' + rpcErr.message); return }
    if (data) {
      setLeaves(prev => prev.map(l => l.id === id ? data : l))
      const bus = getEventBus()
      await bus.publish('hr.leave.approved', {
        leave_id: String(id),
        employee: data.employee,
        employee_id: String(data.employee_id || ''),
        type: data.type,
        days: data.days || 0,
        start_date: data.start_date,
        end_date: data.end_date || data.start_date,
        approver: profile?.name || '',
      })
      if (data.start_date && data.days) {
        const totalDays = Math.ceil(data.days)
        for (let i = 0; i < totalDays; i++) {
          const d = new Date(data.start_date)
          d.setDate(d.getDate() + i)
          await supabase.from('schedules').upsert(
            { employee: data.employee, date: d.toISOString().slice(0, 10), shift: '休' },
            { onConflict: 'employee,date' }
          )
        }
      }
    }
  }
  const handleReject = async (id, reasonArg) => {
    // 從 ApprovalDetailModal 來的會帶 reason；舊路徑（保留相容）會 prompt
    const reason = reasonArg ?? prompt('請輸入拒絕原因：')
    if (reason === null) return
    if (!reason.trim()) { toast.warning('請填寫拒絕原因'); return }
    const leave = leaves.find(l => l.id === id)
    if (leave) {
      const wf = await getWorkflowForRecord('請假簽核', leave.employee)
      const pendingStep = wf?.workflow_steps?.find(s => s.status === '待處理')
      if (pendingStep) {
        const result = await advanceWorkflow(pendingStep.id, profile?.name || '主管', '退回', reason.trim())
        if (result.error) { toast.error('操作失敗：' + result.error); return }
        setLeaves(prev => prev.map(l => l.id === id ? { ...l, status: '已拒絕' } : l))
        return
      }
    }
    const { data, error: rpcErr } = await supabase.rpc('secure_update_leave_status', {
      p_id: id, p_status: '已駁回', p_approver: profile?.name || '', p_reject_reason: reason.trim(),
    })
    if (rpcErr) { toast.error('操作失敗：' + rpcErr.message); return }
    if (data) setLeaves(prev => prev.map(l => l.id === id ? data : l))
  }

  const getEmpDept = useCallback((name) => employees.find(e => e.name === name)?.dept || '', [employees])

  const printWithChain = async (row) => {
    if (!employees.length) { toast.error('員工清單載入中，請稍候'); return }
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      const empRow = employees.find(e => e.name === row.employee)
      // ★ 用 buildFormChainSteps：讀 form_chain_configs 的設定（admin 在 Leave 頁面設好的 chain）
      // 沒設定則 fallback 到舊的「申請人 + 直屬主管 + 人資核章」3 關
      const chainSteps = await buildFormChainSteps({
        formType: 'leave',
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
      printLeaveSignOff(row, {
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
    // ★ 跟 PDF 同源：buildFormChainSteps 讀 form_chain_configs 的設定
    const steps = await buildFormChainSteps({
      formType: 'leave',
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

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '確定永久刪除此申請？此操作無法復原。' }))) return
    const { error } = await supabase.from('leave_requests').delete().eq('id', row.id)
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已刪除')
    setLeaves(prev => prev.filter(x => x.id !== row.id))
  }

  const filtered = useMemo(() => leaves.filter(l =>
    (deptFilter === '' || getEmpDept(l.employee) === deptFilter) &&
    (search === '' || l.employee.includes(search) || String(l.id).includes(search))
  ), [leaves, deptFilter, search, getEmpDept])

  const { virtualItems, containerRef, containerStyle } = useVirtualList({ items: filtered, itemHeight: 52, overscan: 8 })

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>


  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏖️</span> 請假管理</h2>
            <p>依據勞基法、性平法完整假別管理</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowPolicyModal(true)}><Info size={14} /> 法規說明</button>
            {(role?.name === 'super_admin' || role?.name === 'admin') && (
              <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=leave&label=請假')} title="設定請假表單的簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            <button className="btn btn-primary" onClick={() => {
              setEditingId(null)
              setForm({ employee: profile?.name || employees[0]?.name || '', type: 'annual', start_date: '', end_date: '', start_time: '09:00', end_time: '18:00', unit: 'day', hours: 0, days: 1, reason: '' })
              setErrors({})
              setShowModal(true)
            }}><Plus size={14} /> 新增假單</button>
          </div>
        </div>
      </div>

      {/* Department filter */}
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

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待審核</div>
          <div className="stat-card-value">{filtered.filter(l => l.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核准</div>
          <div className="stat-card-value">{filtered.filter(l => l.status === '已核准').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">本月天數</div>
          <div className="stat-card-value">{filtered.reduce((s, l) => s + (l.days || 0), 0)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">假別數</div>
          <div className="stat-card-value">{LEAVE_TYPES.length}</div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 假單列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋員工..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div>
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>尚無假單</div>
          )}
          {/* Virtual table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '55px 110px 90px 90px 200px 90px 1fr 60px 110px 110px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            {['單號', '員工', '部門', '假別', '期間', '天數/時數', '事由', '附件', '狀態', '操作'].map(h => (
              <div key={h} style={{ padding: '10px 8px' }}>{h}</div>
            ))}
          </div>
          {/* Virtual scroll body */}
          <div ref={containerRef} style={{ height: 480, overflowY: 'auto', overflowX: 'hidden' }}>
            <div style={containerStyle}>
              {virtualItems.map(({ item: l, style }) => (
                <VirtualRow key={l.id}
                  onClick={() => openDetail(l)}
                  title="點擊查看簽核明細"
                  style={{ ...style, display: 'grid', gridTemplateColumns: '55px 110px 90px 90px 200px 90px 1fr 60px 110px 110px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                  <div style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>#{l.id}</div>
                  <div style={{ padding: '4px 8px', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.employee}</div>
                  <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(l.employee)}</div>
                  <div style={{ padding: '4px 8px' }}><span className="badge badge-info"><span className="badge-dot"></span>{l.type}</span></div>
                  <div style={{ padding: '4px 8px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.start_date}{l.start_time ? ` ${l.start_time}` : ''}
                    {l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''}
                    {l.end_time ? ` ${l.end_time}` : ''}
                  </div>
                  <div style={{ padding: '4px 8px', fontSize: 13 }}>{l.hours && l.hours < 8 ? `${l.hours}h` : `${l.days}天`}</div>
                  <div style={{ padding: '4px 8px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.reason}</div>
                  <div style={{ padding: '4px 8px' }}>
                    {l.attachments?.length > 0 ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {l.attachments.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', textDecoration: 'none' }}>
                            <Paperclip size={10} /> {i + 1}
                          </a>
                        ))}
                      </div>
                    ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
                  </div>
                  <div style={{ padding: '4px 8px' }}>
                    <span className={`badge ${l.status === '已核准' ? 'badge-success' : l.status === '已拒絕' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{l.status}
                    </span>
                    {l.reject_reason && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 2 }}>原因：{l.reject_reason}</div>}
                  </div>
                  <div style={{ padding: '4px 8px' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {l.status === '待審核' && canApprove('leave_requests', l.id) && (
                        <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>點明細簽核</span>
                      )}
                      {['待審核','申請中','已拒絕','已駁回','已退回'].includes(l.status) && l.employee === profile?.name && (
                        <button className="btn btn-sm btn-primary" style={{ background: 'var(--accent-orange)' }} onClick={() => {
                          setEditingId(l.id)
                          setForm({
                            employee: l.employee || '',
                            type: l.type || 'annual',
                            start_date: l.start_date || '',
                            end_date: l.end_date || '',
                            start_time: l.start_time || '09:00',
                            end_time: l.end_time || '18:00',
                            unit: l.start_time ? 'hour' : 'day',
                            hours: l.hours || 0,
                            days: l.days || 1,
                            reason: l.reason || '',
                          })
                          setShowModal(true)
                        }}>✏️ {(['已拒絕','已駁回','已退回'].includes(l.status)) ? '編輯重送' : '編輯'}</button>
                      )}
                      {l.status === '待審核' && l.employee === profile?.name && (
                        <AsyncButton className="btn btn-sm btn-secondary"
                          style={{ color: 'var(--accent-red)' }}
                          onClick={async () => {
                            if (!await confirm({ message: `確定撤回這筆「${l.type}」申請？` })) return
                            const { error } = await supabase.from('leave_requests').update({ status: '已取消' }).eq('id', l.id)
                            if (error) { toast.error('撤回失敗：' + error.message); return }
                            setLeaves(prev => prev.map(x => x.id === l.id ? { ...x, status: '已取消' } : x))
                            toast.success('已撤回')
                          }} busyLabel="處理中…">撤回</AsyncButton>
                      )}
                      <button className="btn btn-sm btn-secondary" title="下載簽呈"
                        onClick={() => printWithChain(l)}>
                        <Printer size={11} />
                      </button>
                      {canDeleteAll && (
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(l)} title="永久刪除">
                          刪除
                        </button>
                      )}
                    </div>
                  </div>
                </VirtualRow>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* New / Edit Leave Modal */}
      <LeaveFormModal
        open={showModal}
        onClose={() => { setShowModal(false); setValidationMsg(''); setErrors({}); setEditingId(null) }}
        form={form}
        setForm={setForm}
        employees={employees}
        departments={departments}
        stepSettings={stepSettings}
        onSubmit={handleSubmit}
        errors={errors}
        setErrors={setErrors}
        editingId={editingId}
        attachFiles={attachFiles}
        onFileSelect={handleFileSelect}
        removeAttach={removeAttach}
        validationMsg={validationMsg}
        uploading={uploading}
        leaves={leaves}
        holidays={holidays}
      />

      {/* Policy Reference Modal */}
      <LeavePolicyModal
        open={showPolicyModal}
        onClose={() => setShowPolicyModal(false)}
      />

      {/* ─── 明細 modal ─── */}
      {detailRow && (() => {
        const empRow = employees.find(e => e.name === detailRow.employee)
        const period = detailRow.start_date === detailRow.end_date || !detailRow.end_date
          ? `${detailRow.start_date}${detailRow.start_time ? ` ${detailRow.start_time}~${detailRow.end_time || ''}` : ''}`
          : `${detailRow.start_date} ~ ${detailRow.end_date}`
        const duration = detailRow.hours && detailRow.hours < 8 ? `${detailRow.hours} 小時` : `${detailRow.days || 0} 天`
        const atts = (detailRow.attachments || []).map((u, i) => typeof u === 'string'
          ? { url: u, name: u.split('?')[0].split('/').pop() || `附件 ${i+1}` }
          : u)
        return (
          <ApprovalDetailModal
            open={!!detailRow}
            onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
            docTitle="請假申請"
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
              { label: '假別', value: detailRow.type },
              { label: '期間', value: period },
              { label: '天/時數', value: duration },
              { label: '事由', value: detailRow.reason, multiline: true },
              ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
            ]}
            attachments={atts}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            requestType="leave"
            requestId={detailRow.id}
            onPrint={() => printWithChain(detailRow)}
            actions={
              detailRow.status === '待審核' && canApprove('leave_requests', detailRow.id) ? {
                sourceTable: 'leave_requests',
                row: detailRow,
                onApprove: async () => handleApprove(detailRow.id),
                onReject: async (_r, reason) => handleReject(detailRow.id, reason),
                onChanged: () => { load(); setDetailRow(null) },
                rejectLabel: '拒絕',
              } : null
            }
          />
        )
      })()}

    </div>
  )
}
