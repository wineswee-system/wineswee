/**
 * 薪資逐筆調整頁
 *
 * 目的：在草稿階段對單筆打卡/請假/加班做人工調整，不動原始紀錄；
 *      亦支援一次性紅包/扣項；皆只影響本次薪資結算。
 *
 * 流程：
 *   1. 進頁讀取該月 (org, month) 的 salary_records
 *   2. 沒資料 → 提示去主頁建草稿
 *   3. 只有 finalized → 顯示鎖住警告
 *   4. 有 draft → 顯示員工列表，可展開逐筆調整
 *   5. 編完按「重算」更新 net salary、按「確認入帳」鎖定
 *
 * 不動：generate_payroll / payroll.js 計算公式 / secure_upsert_salary_v2
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Calculator, Sparkles, Lock, Trash2, ArrowLeft, ChevronRight, ChevronDown, RotateCcw, AlertTriangle, CheckCircle, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import LoadingSpinner from '../../components/LoadingSpinner'
import { applyAdjustmentsToBatchItem, deriveHourlyRate, estimateAdjustmentImpact } from '../../lib/payrollAdjustments'
import { fmtNT as fmt } from '../../lib/currency'

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const LEAVE_BUCKET_OF = (type) => {
  if (['事假', '事', 'personal', '無薪假', 'unpaid'].includes(type)) return 'unpaid'
  if (['病假', '病', 'sick', '生理假', '生', 'menstrual'].includes(type)) return 'half'
  return 'paid'  // 特休等其他不影響薪資
}

const SOURCE_LABEL = {
  attendance:       '打卡',
  leave:            '請假',
  overtime:         '加班單',
  manual_bonus:     '一次性紅包',
  manual_backpay:   '補發前月差額',
  manual_deduction: '一次性扣項',
}

export default function SalaryAdjust() {
  const { profile, profileReady } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const month = searchParams.get('month') || currentMonth()
  const orgId = profile?.organization_id ?? null

  // ── State ─────────────────────────────────────────────────────────
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState('')
  const [salaryRecords, setSalaryRecords]   = useState([])
  const [employees, setEmployees]           = useState({})  // {id: emp}
  const [stores, setStores]                 = useState([])
  const [adjustments, setAdjustments]       = useState({})  // {salary_record_id: [adj]}
  const [sourceData, setSourceData]         = useState({})  // {emp_id: {attendance, leave, overtime}}
  const [expandedEmps, setExpandedEmps]     = useState(new Set())
  const [storeFilter, setStoreFilter]       = useState('all')
  const [search, setSearch]                 = useState('')
  const [recomputingIds, setRecomputingIds] = useState(new Set())
  const [busyAction, setBusyAction]         = useState('')

  // ── Loaders ───────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // 1. salary_records 該月
      const { data: records, error: e1 } = await supabase
        .from('salary_records')
        .select('*')
        .eq('organization_id', orgId)
        .eq('month', month)
      if (e1) throw e1

      // 2. employees lookup + salary_structures (給 recompute 用)
      const empIds = (records || []).map(r => r.employee_id).filter(Boolean)
      const { data: emps } = empIds.length ? await supabase
        .from('employees')
        .select('id, name, dept, store, store_id, department_id, position, salary_structures(salary_type, hourly_rate, base_salary, attendance_bonus)')
        .in('id', empIds)
      : { data: [] }
      const empMap = Object.fromEntries((emps || []).map(e => [e.id, e]))

      // 3. stores
      const { data: storeList } = await supabase
        .from('stores')
        .select('id, name')
        .eq('organization_id', orgId)
        .order('name')

      // 4. active adjustments for draft records
      const draftIds = (records || []).filter(r => r.status === 'draft').map(r => r.id)
      let adjMap = {}
      if (draftIds.length) {
        const { data: adjs } = await supabase
          .from('salary_adjustments')
          .select('*')
          .in('salary_record_id', draftIds)
          .is('superseded_at', null)
          .order('created_at')
        for (const a of (adjs || [])) {
          if (!adjMap[a.salary_record_id]) adjMap[a.salary_record_id] = []
          adjMap[a.salary_record_id].push(a)
        }
      }

      setSalaryRecords(records || [])
      setEmployees(empMap)
      setStores(storeList || [])
      setAdjustments(adjMap)
    } catch (err) {
      console.error('SalaryAdjust load failed:', err)
      setError(err.message || '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [orgId, month])

  useEffect(() => {
    if (!profileReady || !orgId) return
    loadAll()
  }, [profileReady, orgId, loadAll])

  const loadSourceData = useCallback(async (employeeId) => {
    if (sourceData[employeeId]) return
    const [yr, mo] = month.split('-').map(Number)
    const monthStart = new Date(yr, mo - 1, 1).toISOString().slice(0, 10)
    const monthEnd   = new Date(yr, mo, 0).toISOString().slice(0, 10)

    const [att, lv, ot] = await Promise.all([
      supabase.from('attendance_records')
        .select('id, date, clock_in, clock_out, late_minutes, total_hours, hours_overtime')
        .eq('employee_id', employeeId)
        .gte('date', monthStart).lte('date', monthEnd)
        .order('date'),
      supabase.from('leave_requests')
        .select('id, type, start_date, end_date, hours, days, reason, status')
        .eq('employee_id', employeeId)
        .lte('start_date', monthEnd).gte('end_date', monthStart)
        .eq('status', '已核准')
        .order('start_date'),
      supabase.from('overtime_requests')
        .select('id, request_date, ot_hours, ot_type, reason, status')
        .eq('employee_id', employeeId)
        .gte('request_date', monthStart).lte('request_date', monthEnd)
        .eq('status', '已核准')
        .order('request_date'),
    ])
    setSourceData(prev => ({
      ...prev,
      [employeeId]: { attendance: att.data || [], leave: lv.data || [], overtime: ot.data || [] }
    }))
  }, [month, sourceData])

  // ── Filters ──────────────────────────────────────────────────────
  const draftRecords = useMemo(() => salaryRecords.filter(r => r.status === 'draft'), [salaryRecords])

  const storesWithCount = useMemo(() => {
    const counts = {}
    for (const r of draftRecords) {
      const empStoreId = employees[r.employee_id]?.store_id || 0
      counts[empStoreId] = (counts[empStoreId] || 0) + 1
    }
    return stores.filter(s => counts[s.id]).map(s => ({ ...s, count: counts[s.id] }))
  }, [draftRecords, employees, stores])

  const filteredRecords = useMemo(() => {
    return draftRecords.filter(r => {
      const emp = employees[r.employee_id]
      if (!emp) return false
      if (storeFilter !== 'all' && emp.store_id !== Number(storeFilter)) return false
      if (search && !emp.name.includes(search) && !r.employee?.includes(search)) return false
      return true
    })
  }, [draftRecords, employees, storeFilter, search])

  // ── Adjustment helpers ────────────────────────────────────────────
  const adjustmentLookup = useCallback((recordId, sourceType, sourceId, field) => {
    const list = adjustments[recordId] || []
    return list.find(a => a.source_type === sourceType && a.source_id === sourceId && a.field === field)
  }, [adjustments])

  const saveAdjustment = useCallback(async (recordId, payload) => {
    const { data, error: e } = await supabase.rpc('save_salary_adjustment', {
      p_salary_record_id: recordId,
      p_source_type:      payload.source_type,
      p_source_id:        payload.source_id ?? null,
      p_field:            payload.field,
      p_original_value:   payload.original_value ?? null,
      p_new_value:        payload.new_value ?? null,
      p_reason:           payload.reason ?? null,
      p_created_by:       profile?.id ?? null,
      p_replace_id:       payload.replace_id ?? null,
    })
    if (e) { toast.error('儲存調整失敗：' + e.message); return null }
    // refresh adjustments for this record
    const { data: adjs } = await supabase
      .from('salary_adjustments')
      .select('*')
      .eq('salary_record_id', recordId)
      .is('superseded_at', null)
      .order('created_at')
    setAdjustments(prev => ({ ...prev, [recordId]: adjs || [] }))
    return data
  }, [profile?.id])

  const deleteAdjustment = useCallback(async (recordId, adjId) => {
    const { error: e } = await supabase.rpc('delete_salary_adjustment', { p_adjustment_id: adjId })
    if (e) { toast.error('還原失敗：' + e.message); return }
    setAdjustments(prev => ({
      ...prev,
      [recordId]: (prev[recordId] || []).filter(a => a.id !== adjId)
    }))
  }, [])

  // ── Recompute one employee's salary ──────────────────────────────
  const recomputeOne = useCallback(async (record) => {
    const emp = employees[record.employee_id]
    const ss  = emp?.salary_structures?.[0] || emp?.salary_structures || {}
    const adjs = adjustments[record.id] || []

    // 注入 context — 從 salary_structures 取
    const context = {
      hourlyRate:           Number(ss.hourly_rate) || deriveHourlyRate(record),
      salaryType:           ss.salary_type || 'monthly',
      attendanceBonusBase:  Number(ss.attendance_bonus) || record.attendance_bonus || 0,
    }

    const newItem = applyAdjustmentsToBatchItem(
      // 用 salary_records 列當輸入（補上 helper 欄位）
      {
        ...record,
        // payrollAdjustments.js 期望的欄位名（部分跟 salary_records 不同）
        lateMins:            record.late_minutes ?? 0,           // 註：salary_records 沒這欄，會 0；可從 sourceData 補
        otWeekday:           record.ot_hours_weekday ?? 0,        // 同上
        otHoliday:           record.ot_hours_holiday ?? 0,        // 同上
        unpaidHours:         0,                                    // 同上
        halfPayHours:        0,                                    // 同上
        regular_overtime_pay: record.overtime_pay,
        absenceDeduction:    record.absence_deduction,
        lateDeduction:       record.late_deduction,
        attendance_bonus:    record.attendance_bonus,
        // 既有金額沿用
        gross:               (record.base_salary || 0)
                             + (record.role_allowance || 0)
                             + (record.meal_allowance || 0)
                             + (record.transport_allowance || 0)
                             + (record.attendance_bonus || 0)
                             + (record.overtime_pay || 0)
                             + (record.bonus || 0),
        netSalary:           record.net_salary,
      },
      adjs,
      context,
    )

    // UPSERT 回 DB（status='draft'）
    const payload = {
      employee:             record.employee,
      month,
      base_salary:          record.base_salary,
      role_allowance:       record.role_allowance,
      meal_allowance:       record.meal_allowance,
      transport_allowance:  record.transport_allowance,
      attendance_bonus:     newItem.attendance_bonus,
      custom_allowances:    record.custom_allowances || [],
      overtime_pay:         newItem.overtimePay,
      bonus:                record.bonus,
      health_ins_dependents: record.health_ins_dependents,
      pension_self_pct:     record.pension_self_pct,
      absence_deduction:    newItem.absenceDeduction,
      late_deduction:       newItem.lateDeduction,
      other_deduction:      newItem._manualDeductionTotal,
      other_deduction_note: '逐筆調整',
      back_pay_adjustment:  newItem._manualBackpayTotal || 0,
      allowances_total:     (record.role_allowance || 0) + (record.meal_allowance || 0) + (record.transport_allowance || 0) + newItem.attendance_bonus,
      insurance:            (record.labor_insurance || 0) + (record.health_insurance || 0),
      deductions_total:     newItem.totalDeductions,
      net_salary:           newItem.netSalary,
    }
    const { data, error: e } = await supabase.rpc('secure_upsert_salary_v2_with_status', {
      p_data:   payload,
      p_status: 'draft',
    })
    if (e) { toast.error('重算失敗：' + e.message); return }

    // 更新本地
    setSalaryRecords(prev => prev.map(r => r.id === record.id ? { ...r, ...data } : r))
    toast.success(`${record.employee} 已重算（實領 ${fmt(newItem.netSalary)}）`)
  }, [employees, adjustments, month])

  const handleRecompute = useCallback(async (record) => {
    setRecomputingIds(prev => new Set([...prev, record.id]))
    try { await recomputeOne(record) }
    finally {
      setRecomputingIds(prev => { const s = new Set(prev); s.delete(record.id); return s })
    }
  }, [recomputeOne])

  // ── Global actions ───────────────────────────────────────────────
  const handleDeleteDraft = useCallback(async () => {
    if (!confirm(`確認刪掉 ${month} 整月草稿？所有調整將一併消失（共 ${draftRecords.length} 筆員工 + ${Object.values(adjustments).flat().length} 筆調整）`)) return
    setBusyAction('delete')
    try {
      const { data, error: e } = await supabase.rpc('delete_salary_draft_month', {
        p_organization_id: orgId,
        p_month:           month,
      })
      if (e) throw e
      toast.success(`已刪除 ${data} 筆草稿`)
      await loadAll()
    } catch (err) {
      toast.error('刪除失敗：' + err.message)
    } finally {
      setBusyAction('')
    }
  }, [month, orgId, draftRecords, adjustments, loadAll])

  const handleFinalize = useCallback(async () => {
    if (!confirm(`確認入帳 ${month} 全部 ${draftRecords.length} 位員工薪資？入帳後就不能再調整了。`)) return
    setBusyAction('finalize')
    try {
      const { data, error: e } = await supabase.rpc('finalize_salary_draft_month', {
        p_organization_id: orgId,
        p_month:           month,
        p_finalized_by:    profile?.id ?? null,
      })
      if (e) throw e
      toast.success(`已入帳 ${data} 筆`)
      await loadAll()
    } catch (err) {
      toast.error('入帳失敗：' + err.message)
    } finally {
      setBusyAction('')
    }
  }, [month, orgId, draftRecords, profile?.id, loadAll])

  // ── Render: page state ───────────────────────────────────────────
  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={loadAll} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const isEmpty           = salaryRecords.length === 0
  const allFinalized      = !isEmpty && draftRecords.length === 0
  const adjustmentCount   = Object.values(adjustments).flat().length

  return (
    <div className="fade-in" style={{ padding: 24 }}>
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">✏️</span> 薪資逐筆調整 — {month}</h2>
            <p>
              {isEmpty       && '本月還沒有薪資草稿'}
              {allFinalized  && '本月薪資已入帳，無法調整'}
              {!isEmpty && !allFinalized && (
                <>共 {draftRecords.length} 位員工 · 已調整 {adjustmentCount} 筆 · Draft</>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/hr/salary')}>
              <ArrowLeft size={14} /> 回主頁
            </button>
            {!isEmpty && !allFinalized && (
              <>
                <button className="btn btn-secondary" style={{ color: 'var(--accent-red)' }}
                  disabled={busyAction !== ''}
                  onClick={handleDeleteDraft}>
                  <Trash2 size={14} /> {busyAction === 'delete' ? '刪除中...' : '刪除整月草稿'}
                </button>
                <button className="btn btn-primary"
                  disabled={busyAction !== ''}
                  onClick={handleFinalize}>
                  <Lock size={14} /> {busyAction === 'finalize' ? '入帳中...' : '確認入帳'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <Sparkles size={48} style={{ color: 'var(--accent-cyan)', margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>本月還沒有薪資草稿</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
            請先回主頁按「批次計薪 {month}」並選「💾 儲存為草稿」<br />
            草稿建立後回到本頁即可逐筆調整。
          </p>
          <button className="btn btn-primary" onClick={() => navigate(`/hr/salary?openBatch=${month}`)}>
            <Calculator size={14} /> 前往批次計薪 →
          </button>
        </div>
      )}

      {/* ── All finalized warning ── */}
      {allFinalized && (
        <div className="card" style={{ padding: 32, textAlign: 'center', borderColor: 'var(--accent-orange)' }}>
          <Lock size={40} style={{ color: 'var(--accent-orange)', margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>本月薪資已入帳，無法調整</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            如需重做請先回主頁刪除入帳紀錄後重建批次。
          </p>
        </div>
      )}

      {/* ── Has drafts: filter bar + employee list ── */}
      {!isEmpty && !allFinalized && (
        <>
          {/* Store tabs */}
          {storesWithCount.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button
                className={`btn ${storeFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 12 }}
                onClick={() => setStoreFilter('all')}>
                全部 ({draftRecords.length})
              </button>
              {storesWithCount.map(s => (
                <button key={s.id}
                  className={`btn ${String(storeFilter) === String(s.id) ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 12 }}
                  onClick={() => setStoreFilter(s.id)}>
                  {s.name} ({s.count})
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          <div style={{ marginBottom: 12 }}>
            <input
              type="text"
              placeholder="🔍 搜尋員工姓名..."
              className="form-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ maxWidth: 280 }}
            />
          </div>

          {/* Employee accordion */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredRecords.length === 0 && (
              <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                找不到符合條件的員工
              </div>
            )}
            {filteredRecords.map(record => (
              <EmployeeRow
                key={record.id}
                record={record}
                employee={employees[record.employee_id]}
                adjustments={adjustments[record.id] || []}
                sourceData={sourceData[record.employee_id]}
                expanded={expandedEmps.has(record.id)}
                recomputing={recomputingIds.has(record.id)}
                onToggle={async () => {
                  setExpandedEmps(prev => {
                    const s = new Set(prev)
                    if (s.has(record.id)) s.delete(record.id)
                    else s.add(record.id)
                    return s
                  })
                  await loadSourceData(record.employee_id)
                }}
                onSaveAdjustment={(payload) => saveAdjustment(record.id, payload)}
                onDeleteAdjustment={(adjId) => deleteAdjustment(record.id, adjId)}
                onRecompute={() => handleRecompute(record)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// EmployeeRow — 單員工 accordion
// ════════════════════════════════════════════════════════════════════
function EmployeeRow({
  record, employee, adjustments, sourceData,
  expanded, recomputing,
  onToggle, onSaveAdjustment, onDeleteAdjustment, onRecompute,
}) {
  const hasAdjustments = adjustments.length > 0
  const empName        = employee?.name || record.employee || '?'

  return (
    <div className="card" style={{ padding: 0 }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', borderBottom: expanded ? '1px solid var(--border-subtle)' : 'none',
      }} onClick={onToggle}>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{empName}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {employee?.dept || '-'} · {employee?.store || '-'}
            {hasAdjustments && (
              <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                color: 'var(--accent-cyan)', background: 'var(--accent-cyan-dim)' }}>
                {adjustments.length} 筆調整
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>實領</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-green)' }}>{fmt(record.net_salary)}</div>
        </div>
        {expanded && (
          <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 10px' }}
            disabled={recomputing}
            onClick={(e) => { e.stopPropagation(); onRecompute() }}>
            <RotateCcw size={11} /> {recomputing ? '重算中...' : '重算'}
          </button>
        )}
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: 16, background: 'var(--bg-tertiary)' }}>
          {!sourceData && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>載入中...</div>}
          {sourceData && (
            <EmployeeAdjustmentBody
              record={record}
              sourceData={sourceData}
              adjustments={adjustments}
              onSave={onSaveAdjustment}
              onDelete={onDeleteAdjustment}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// EmployeeAdjustmentBody — 展開後的調整 UI
// ════════════════════════════════════════════════════════════════════
function EmployeeAdjustmentBody({ record, sourceData, adjustments, onSave, onDelete }) {
  const findAdj = (sourceType, sourceId, field) =>
    adjustments.find(a => a.source_type === sourceType && a.source_id === sourceId && a.field === field)

  // ─── Section: 打卡（遲到調整）───
  const lateRecords = (sourceData.attendance || []).filter(r => (r.late_minutes || 0) > 0)

  // ─── Section: 請假 ───
  const deductibleLeaves = (sourceData.leave || []).filter(l => {
    const b = LEAVE_BUCKET_OF(l.type)
    return b !== 'paid'
  })

  // ─── Section: 加班單 ───
  const otRecords = (sourceData.overtime || []).filter(o => o.ot_type === 'pay' || !o.ot_type)

  // ─── Section: manual entries ───
  const manualBonuses    = adjustments.filter(a => a.source_type === 'manual_bonus')
  const manualBackpays   = adjustments.filter(a => a.source_type === 'manual_backpay')
  const manualDeductions = adjustments.filter(a => a.source_type === 'manual_deduction')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12 }}>
      {/* 打卡 — 遲到 */}
      <SectionBox title="打卡 — 遲到分鐘" emptyMsg="本月無遲到記錄" rows={lateRecords}>
        {lateRecords.map(att => {
          const adj   = findAdj('attendance', att.id, 'late_minutes')
          const effVal = adj ? Number(adj.new_value?.value ?? att.late_minutes) : att.late_minutes
          return (
            <InlineEditRow
              key={att.id}
              label={`${att.date} 遲到 ${att.late_minutes} 分`}
              currentValue={effVal}
              originalValue={att.late_minutes}
              suffix="分"
              adjustment={adj}
              onSave={(newVal, reason) => onSave({
                source_type: 'attendance',
                source_id:   att.id,
                field:       'late_minutes',
                original_value: { value: att.late_minutes },
                new_value:      { value: Number(newVal) },
                reason,
                replace_id:  adj?.id ?? null,
              })}
              onRestore={adj ? () => onDelete(adj.id) : null}
            />
          )
        })}
      </SectionBox>

      {/* 請假 */}
      <SectionBox title="請假 — 扣薪計算" emptyMsg="本月無扣薪假" rows={deductibleLeaves}>
        {deductibleLeaves.map(lv => {
          const adj  = findAdj('leave', lv.id, 'leave_pay_mode')
          const currentMode = adj ? adj.new_value?.mode : LEAVE_BUCKET_OF(lv.type)
          const days = lv.days || (lv.hours ? lv.hours / 8 : 1)
          return (
            <div key={lv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ flex: 1 }}>
                <div>{lv.start_date}{lv.end_date !== lv.start_date ? ` ~ ${lv.end_date}` : ''} {lv.type} {days}天</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{lv.reason || '無原因'}</div>
              </div>
              <select
                className="form-input"
                style={{ fontSize: 12, padding: '4px 8px', width: 110 }}
                value={currentMode}
                onChange={e => {
                  const newMode = e.target.value
                  if (newMode === currentMode) return
                  onSave({
                    source_type: 'leave',
                    source_id:   lv.id,
                    field:       'leave_pay_mode',
                    original_value: { mode: LEAVE_BUCKET_OF(lv.type), days },
                    new_value:      { mode: newMode,                   days },
                    replace_id:  adj?.id ?? null,
                  })
                }}>
                <option value="unpaid">扣全薪</option>
                <option value="half">扣半薪</option>
                <option value="paid">不扣薪</option>
              </select>
              {adj && (
                <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() => onDelete(adj.id)}>
                  <RotateCcw size={10} /> 還原
                </button>
              )}
            </div>
          )
        })}
      </SectionBox>

      {/* 加班單 */}
      <SectionBox title="加班單 — 時數" emptyMsg="本月無加班申請" rows={otRecords}>
        {otRecords.map(ot => {
          const dow = new Date(ot.request_date).getDay()
          const isHoliday = (dow === 0 || dow === 6)
          const field     = isHoliday ? 'ot_hours_holiday' : 'ot_hours_weekday'
          const adj       = findAdj('overtime', ot.id, field)
          const effVal    = adj ? Number(adj.new_value?.value ?? ot.ot_hours) : ot.ot_hours
          return (
            <InlineEditRow
              key={ot.id}
              label={`${ot.request_date} ${isHoliday ? '假日' : '平日'} OT ${ot.ot_hours}h`}
              currentValue={effVal}
              originalValue={ot.ot_hours}
              suffix="h"
              step="0.5"
              adjustment={adj}
              onSave={(newVal, reason) => onSave({
                source_type: 'overtime',
                source_id:   ot.id,
                field,
                original_value: { value: Number(ot.ot_hours) },
                new_value:      { value: Number(newVal) },
                reason,
                replace_id:  adj?.id ?? null,
              })}
              onRestore={adj ? () => onDelete(adj.id) : null}
            />
          )
        })}
      </SectionBox>

      {/* 自由項：紅包/扣項 */}
      <SectionBox title="自由項 — 紅包 / 補發前月差額 / 扣項" emptyMsg={null} rows={[1]}>
        <ManualEntries
          existing={[...manualBonuses, ...manualBackpays, ...manualDeductions]}
          onAdd={(type, amount, label, reason) => onSave({
            source_type: type,  // 'manual_bonus' / 'manual_deduction'
            source_id:   null,
            field:       'amount',
            original_value: null,
            new_value:      { amount: Number(amount), label },
            reason,
          })}
          onRemove={(id) => onDelete(id)}
        />
      </SectionBox>
    </div>
  )
}

function SectionBox({ title, emptyMsg, rows, children }) {
  if ((!rows || rows.length === 0) && emptyMsg !== null) {
    return (
      <div>
        <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{title}</div>
        <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)' }}>{emptyMsg}</div>
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{title}</div>
      <div>{children}</div>
    </div>
  )
}

function InlineEditRow({ label, currentValue, originalValue, suffix, step, adjustment, onSave, onRestore }) {
  const [val, setVal] = useState(String(currentValue))
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => { setVal(String(currentValue)) }, [currentValue])

  const isChanged = adjustment != null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: 1 }}>{label}</div>
      <input
        type="number"
        step={step || '1'}
        value={val}
        onChange={e => { setVal(e.target.value); setEditing(true) }}
        onBlur={() => {
          if (editing && Number(val) !== Number(currentValue)) {
            onSave(val, reason || undefined)
            setEditing(false)
          }
        }}
        style={{
          width: 64, fontSize: 12, padding: '3px 6px',
          border: `1px solid ${isChanged ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
          borderRadius: 4, background: 'var(--bg-card)', color: 'var(--text-primary)',
          textAlign: 'right',
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{suffix}</span>
      {isChanged && (
        <>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            原 {originalValue}{suffix}{adjustment?.reason ? ` · ${adjustment.reason}` : ''}
          </span>
          {onRestore && (
            <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 6px' }} onClick={onRestore}>
              <RotateCcw size={10} /> 還原
            </button>
          )}
        </>
      )}
    </div>
  )
}

function ManualEntries({ existing, onAdd, onRemove }) {
  const [type, setType] = useState('manual_bonus')
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [reason, setReason] = useState('')

  const handleAdd = () => {
    if (!amount || Number(amount) <= 0) { toast.error('金額需大於 0'); return }
    onAdd(type, amount, label, reason || undefined)
    setAmount(''); setLabel(''); setReason('')
  }

  return (
    <div>
      {existing.map(e => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            color: e.source_type === 'manual_deduction' ? 'var(--accent-red)' : 'var(--accent-green)',
            background: e.source_type === 'manual_deduction' ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)' }}>
            {e.source_type === 'manual_bonus' ? '+ 紅包' : e.source_type === 'manual_backpay' ? '+ 補發' : '- 扣項'}
          </span>
          <span style={{ flex: 1 }}>
            {e.new_value?.label || '(無註記)'} {e.reason ? ` · ${e.reason}` : ''}
          </span>
          <span style={{ fontWeight: 600 }}>
            {fmt(Number(e.new_value?.amount || 0))}
          </span>
          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 6px' }}
            onClick={() => onRemove(e.id)}>
            <X size={10} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px', flexWrap: 'wrap' }}>
        <select className="form-input" style={{ fontSize: 12, padding: '4px 8px', width: 128 }}
          value={type} onChange={e => setType(e.target.value)}>
          <option value="manual_bonus">紅包</option>
          <option value="manual_backpay">補發前月差額</option>
          <option value="manual_deduction">扣項</option>
        </select>
        <input type="number" placeholder="金額"
          className="form-input"
          style={{ fontSize: 12, padding: '4px 8px', width: 90 }}
          value={amount} onChange={e => setAmount(e.target.value)} />
        <input type="text" placeholder="名目"
          className="form-input"
          style={{ fontSize: 12, padding: '4px 8px', width: 120 }}
          value={label} onChange={e => setLabel(e.target.value)} />
        <input type="text" placeholder="理由 (選填)"
          className="form-input"
          style={{ fontSize: 12, padding: '4px 8px', flex: 1, minWidth: 120 }}
          value={reason} onChange={e => setReason(e.target.value)} />
        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={handleAdd}>
          <Plus size={12} /> 加
        </button>
      </div>
    </div>
  )
}
