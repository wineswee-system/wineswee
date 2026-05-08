import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Plus, Search, Info, Paperclip, Printer, Settings } from 'lucide-react'
import { getLeaveRequests, createLeaveRequest, updateLeaveStatus, getActiveEmployees, getDepartments, getLeaveStepSettings } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { getSupervisor } from '../../lib/approval'
import { useAuth } from '../../contexts/AuthContext'
import { LEAVE_TYPES, getAnnualLeaveEntitlement, getLeaveTypeInfo, validateLeaveRequest } from '../../lib/leavePolicy'
import { getEffectiveBenefits, getStoreIdByName } from '../../lib/benefitPolicy'
import { createApprovalWorkflow, getWorkflowForRecord, advanceWorkflow } from '../../lib/workflowIntegration'
import LoadingSpinner from '../../components/LoadingSpinner'
import { empLabel } from '../../lib/empLabel'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import ChainConfigModal from '../../components/ChainConfigModal'
import { useVirtualList, VirtualRow } from '../../lib/useVirtualList.jsx'
import { getEventBus } from '../../lib/events/index.js'
import { printLeaveSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildWorkflowChainSteps, buildFormChainSteps } from '../../lib/buildChainSteps'
import { validateRequired, clearError } from '../../lib/formValidation'

export default function Leave() {
  const { profile, role } = useAuth()
  const [showChainModal, setShowChainModal] = useState(false)
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
  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getLeaveRequests({ orgId }),
      getActiveEmployees('id, name, dept, store_id, department_id, position, join_date, phone, signature_url, departments!department_id(name)', orgId),
      getDepartments(orgId),
      getLeaveStepSettings(),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([l, e, d, ls, orgRes]) => {
      const emps = e.data || []
      setLeaves(l.data || [])
      setEmployees(emps)
      setDepartments(d.data || [])
      setOrganization(orgRes?.data || null)
      // 整理 stepSettings
      const map = { all: {} }
      ;(ls.data || []).forEach(row => {
        const k = row.store_id || 'all'
        if (!map[k]) map[k] = {}
        map[k][row.leave_code] = { step: Number(row.step), unit: row.unit }
      })
      setStepSettings(map)
      setForm(f => ({ ...f, employee: emps[0]?.name || '' }))
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

  const selectedPolicy = getLeaveTypeInfo(form.type)

  const handleSubmit = async () => {
    try {
    if (!validateRequired(form, ['employee', 'start_date'], setErrors)) return

    // 取此假別此員工的 step 設定（先看員工所屬店覆寫，沒有則全公司預設，再沒有用 leavePolicy.js）
    const empForStep = employees.find(em => em.name === form.employee)
    const storeKey = empForStep?.store_id || null
    const storeOverride = (storeKey && stepSettings[storeKey]?.[form.type]) || null
    const globalOverride = stepSettings.all?.[form.type] || null
    const stepCfg = storeOverride || globalOverride || { step: selectedPolicy?.minUnit || 0.5, unit: selectedPolicy?.unit || 'day' }

    // Calculate days/hours
    let days, hours
    if (form.unit === 'hour') {
      const [sh, sm] = form.start_time.split(':').map(Number)
      const [eh, em] = form.end_time.split(':').map(Number)
      hours = Math.max(0.5, (eh + em / 60) - (sh + sm / 60))
      // 對齊 step（小時模式）
      if (stepCfg.unit === 'hour') hours = Math.ceil(hours / stepCfg.step - 1e-9) * stepCfg.step
      days = Math.round(hours / 8 * 10) / 10
    } else {
      const start = new Date(form.start_date)
      const end = new Date(form.end_date || form.start_date)
      days = Math.max(1, Math.ceil((end - start) / 86400000) + 1)
      // 對齊 step（天模式）
      if (stepCfg.unit === 'day') days = Math.ceil(days / stepCfg.step - 1e-9) * stepCfg.step
      hours = days * 8
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
      if (updErr) { alert('更新失敗：' + updErr.message); return }
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
      setShowModal(false)
      setForm({ employee: profile?.name || employees[0]?.name || '', type: 'annual', start_date: '', end_date: '', start_time: '09:00', end_time: '18:00', unit: 'day', hours: 0, days: 1, reason: '' })
      setValidationMsg('')

      // 建立簽核流程（自動找主管 → 建 workflow_instance → 通知）
      await createApprovalWorkflow('leave', data, form.employee)
    }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleApprove = async (id) => {
    const leave = leaves.find(l => l.id === id)
    if (leave) {
      const wf = await getWorkflowForRecord('請假簽核', leave.employee)
      const pendingStep = wf?.workflow_steps?.find(s => s.status === '待處理')
      if (pendingStep) {
        const result = await advanceWorkflow(pendingStep.id, profile?.name || '主管', '核准')
        if (result.error) { alert('操作失敗：' + result.error); return }
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
    if (rpcErr) { alert('操作失敗：' + rpcErr.message); return }
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
  const handleReject = async (id) => {
    const reason = prompt('請輸入拒絕原因：')
    if (reason === null) return
    if (!reason.trim()) { alert('請填寫拒絕原因'); return }
    const leave = leaves.find(l => l.id === id)
    if (leave) {
      const wf = await getWorkflowForRecord('請假簽核', leave.employee)
      const pendingStep = wf?.workflow_steps?.find(s => s.status === '待處理')
      if (pendingStep) {
        const result = await advanceWorkflow(pendingStep.id, profile?.name || '主管', '退回', reason.trim())
        if (result.error) { alert('操作失敗：' + result.error); return }
        setLeaves(prev => prev.map(l => l.id === id ? { ...l, status: '已拒絕' } : l))
        return
      }
    }
    const { data, error: rpcErr } = await supabase.rpc('secure_update_leave_status', {
      p_id: id, p_status: '已駁回', p_approver: profile?.name || '', p_reject_reason: reason.trim(),
    })
    if (rpcErr) { alert('操作失敗：' + rpcErr.message); return }
    if (data) setLeaves(prev => prev.map(l => l.id === id ? data : l))
  }

  const getEmpDept = useCallback((name) => employees.find(e => e.name === name)?.dept || '', [employees])

  const printWithChain = async (row) => {
    if (!employees.length) { alert('員工清單載入中，請稍候'); return }
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { alert('請允許彈出視窗才能列印簽呈'); return }
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
      alert('產生簽呈失敗：' + (e.message || '未知錯誤'))
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

  const filtered = useMemo(() => leaves.filter(l =>
    (deptFilter === '' || getEmpDept(l.employee) === deptFilter) &&
    (search === '' || l.employee.includes(search))
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
              <button className="btn btn-secondary" onClick={() => setShowChainModal(true)} title="設定請假表單的簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            <button className="btn btn-primary" onClick={() => { setEditingId(null); setShowModal(true) }}><Plus size={14} /> 新增假單</button>
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
          <div style={{ display: 'grid', gridTemplateColumns: '110px 90px 90px 200px 90px 1fr 60px 110px 110px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            {['員工', '部門', '假別', '期間', '天數/時數', '事由', '附件', '狀態', '操作'].map(h => (
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
                  style={{ ...style, display: 'grid', gridTemplateColumns: '110px 90px 90px 200px 90px 1fr 60px 110px 110px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
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
                      {l.status === '待審核' && (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={() => handleApprove(l.id)}>核准</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => handleReject(l.id)}>拒絕</button>
                        </>
                      )}
                      {(l.status === '已拒絕' || l.status === '已退回') && l.employee === profile?.name && (
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
                        }}>✏️ 編輯重送</button>
                      )}
                      <button className="btn btn-sm btn-secondary" title="下載簽呈"
                        onClick={() => printWithChain(l)}>
                        <Printer size={11} />
                      </button>
                    </div>
                  </div>
                </VirtualRow>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* New Leave Modal */}
      {showModal && (
        <Modal title={editingId ? '✏️ 編輯重送（駁回後修改）' : '新增假單'} onClose={() => { setShowModal(false); setValidationMsg(''); setErrors({}); setEditingId(null) }} onSubmit={handleSubmit}>
          <Field label="員工 *" error={errors.employee} errorMsg="請選擇員工">
            <SearchableSelect
              value={form.employee}
              onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="搜尋員工姓名/職稱..."
            />
          </Field>
          <Field label="假別 *">
            <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
              {LEAVE_TYPES.map(t => (
                <option key={t.code} value={t.code}>{t.shortName}（{t.law}）</option>
              ))}
            </select>
          </Field>
          {/* Policy info */}
          {selectedPolicy && (
            <div style={{
              padding: '10px 14px', borderRadius: 10, fontSize: 12, marginBottom: 12,
              background: 'var(--accent-cyan-dim)', border: '1px solid rgba(34,211,238,0.15)',
              color: 'var(--text-secondary)', lineHeight: 1.7,
            }}>
              <div><strong style={{ color: 'var(--accent-cyan)' }}>法源：</strong>{selectedPolicy.law}</div>
              <div><strong style={{ color: 'var(--accent-cyan)' }}>薪資：</strong>{selectedPolicy.salary}</div>
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>{selectedPolicy.description}</div>
              {(() => {
                const empSel = employees.find(em => em.name === form.employee)
                const sk = empSel?.store_id || null
                const cfg = (sk && stepSettings[sk]?.[form.type]) || stepSettings.all?.[form.type]
                if (!cfg) return null
                return (
                  <div style={{ fontSize: 11, marginTop: 6, paddingTop: 6, borderTop: '1px dashed rgba(34,211,238,0.2)' }}>
                    <strong style={{ color: 'var(--accent-purple)' }}>廠商設定：</strong>
                    最小單位 {cfg.step} {cfg.unit === 'day' ? '天' : '小時'}
                    （在「工時/假別單位」設定）· 不滿一個單位會自動進位
                  </div>
                )
              })()}
            </div>
          )}
          {/* Unit toggle */}
          {selectedPolicy?.allowHourly && (
            <Field label="請假單位">
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ v: 'day', l: '整天' }, { v: 'hour', l: '時數' }].map(u => (
                  <button key={u.v} type="button" onClick={() => set('unit', u.v)} style={{
                    flex: 1, padding: '8px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none',
                    background: form.unit === u.v ? 'var(--accent-cyan)' : 'var(--bg-card)',
                    color: form.unit === u.v ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer', outline: `1px solid ${form.unit === u.v ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                  }}>{u.l}</button>
                ))}
              </div>
            </Field>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: form.unit === 'hour' ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Field label={form.unit === 'hour' ? '日期 *' : '開始日期 *'} error={errors.start_date} errorMsg="請選日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => { set('start_date', e.target.value); clearError('start_date', setErrors) }} />
            </Field>
            {form.unit === 'day' && (
              <Field label="結束日期">
                <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
              </Field>
            )}
          </div>
          {form.unit === 'hour' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="開始時間">
                <input className="form-input" type="time" style={{ width: '100%' }} value={form.start_time} onChange={e => set('start_time', e.target.value)} />
              </Field>
              <Field label="結束時間">
                <input className="form-input" type="time" style={{ width: '100%' }} value={form.end_time} onChange={e => set('end_time', e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="事由">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="請輸入請假事由" value={form.reason} onChange={e => set('reason', e.target.value)} />
          </Field>
          {validationMsg && (
            <div style={{ padding: '10px', borderRadius: 8, background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 13, fontWeight: 600 }}>
              {validationMsg}
            </div>
          )}
        </Modal>
      )}

      {/* Policy Reference Modal */}
      {showPolicyModal && (
        <Modal title="假別法規參照" onClose={() => setShowPolicyModal(false)} onSubmit={() => setShowPolicyModal(false)} submitLabel="關閉">
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {LEAVE_TYPES.map(t => (
              <div key={t.code} style={{
                padding: '14px 0', borderBottom: '1px solid var(--border-subtle)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t.name}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>{t.law}</span>
                  {t.paid ? (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>有薪</span>
                  ) : (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}>無薪</span>
                  )}
                  {t.gender && (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-pink-dim)', color: 'var(--accent-pink)' }}>{t.gender === 'female' ? '限女性' : '限男性'}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 4 }}>{t.description}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  <strong>薪資：</strong>{t.salary}
                  {t.maxDays && <span> · <strong>上限：</strong>{t.maxDays} 天/年</span>}
                  {t.allowHourly && <span> · 可按小時請假</span>}
                </div>
                {t.conditions && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {t.conditions.map((c, i) => (
                      <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>
                        • {c.desc}：<strong>{c.days} 天</strong>{c.salary ? `（${c.salary}）` : ''}
                      </div>
                    ))}
                  </div>
                )}
                {t.settlement && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>⚠ {t.settlement}</div>}
                {t.note && <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4 }}>💡 {t.note}</div>}
                {t.note2026 && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4, padding: '6px 10px', borderRadius: 6, background: 'var(--accent-orange-dim)' }}>🆕 {t.note2026}</div>}
              </div>
            ))}
          </div>
        </Modal>
      )}

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
            onPrint={() => printWithChain(detailRow)}
          />
        )
      })()}

      {/* 簽核鏈設定 modal — 只 admin 看得到入口 */}
      <ChainConfigModal
        open={showChainModal}
        onClose={() => setShowChainModal(false)}
        formType="leave"
        formLabel="請假"
        organizationId={profile?.organization_id}
      />
    </div>
  )
}
