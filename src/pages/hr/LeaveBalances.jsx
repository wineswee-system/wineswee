import { useState, useEffect } from 'react'
import { Calculator, Users, Search, Edit2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from '../../lib/toast'

const TYPE_LABEL = {
  annual: '特休假', '補休': '補休', sick: '病假', personal: '事假',
  menstrual: '生理假', marriage: '婚假', bereavement: '喪假',
  official: '公假', maternity: '產假', paternity: '陪產假',
  parental: '育嬰假', family_care: '家庭照顧假',
  occupational: '公傷病假', prenatal: '產檢假', unpaid: '無薪假',
}
const TYPE_CODE = Object.fromEntries(Object.entries(TYPE_LABEL).map(([k, v]) => [v, k]))

// legal limits in DAYS (per year, except menstrual which is per month)
const LEGAL_LIMITS = {
  sick: 30, personal: 14, menstrual: 1,  // 1 day/month × 12 months
  marriage: 8, bereavement: 8, family_care: 7,
  paternity: 7, prenatal: 7,  // 產檢假 2022 修法 5→7 天（性平法 §15）
}
// 這些假別沒有固定年度天數，只在有資料時才顯示
const EVENT_BASED = new Set(['official', 'maternity', 'parental', 'occupational', 'unpaid'])

const ANNUAL_TYPES = [
  'annual', '補休', 'sick', 'personal', 'menstrual',
  'marriage', 'bereavement', 'official', 'maternity', 'paternity', 'unpaid',
  'family_care', 'occupational', 'prenatal', 'parental',
]

const daysToHours = (d) => Math.round(Number(d || 0) * 8)
const hoursToHours = (h) => Math.round(Number(h || 0))
const _todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

export default function LeaveBalances() {
  const { profile, isAdmin } = useAuth()
  // 假別餘額權限：只有 admin/super_admin 可看全部 + 批次調整/結算；
  // 其餘角色（manager/office_staff/store_staff）只看自己、唯讀。
  const currentYear = new Date().getFullYear()

  const [employees, setEmployees]     = useState([])
  const [selectedEmpId, setSelectedEmpId] = useState(null)
  const [yearFilter, setYearFilter]   = useState(currentYear)
  const [statusFilter, setStatusFilter] = useState('在職')
  const [nameSearch, setNameSearch]   = useState('')
  const [activeTab, setActiveTab]     = useState('annual')

  const [dbBalances, setDbBalances]     = useState([])
  const [leaveRequests, setLeaveRequests] = useState([])
  const [pendingRequests, setPendingRequests] = useState([])
  const [tableRows, setTableRows]       = useState([])

  const [empLoading, setEmpLoading]   = useState(true)
  const [dataLoading, setDataLoading] = useState(false)

  // bulk adjust modal
  const [showBulkModal, setShowBulkModal]   = useState(false)
  const [bulkSelectedIds, setBulkSelectedIds] = useState([])
  const [bulkSearch, setBulkSearch]         = useState('')
  const [bulkLeaveType, setBulkLeaveType]   = useState('annual')
  const [bulkDays, setBulkDays]             = useState('')
  const [bulkUnit, setBulkUnit]             = useState('day')   // 'day' | 'hour'
  const [bulkYear, setBulkYear]             = useState(currentYear)
  const [bulkSaving, setBulkSaving]         = useState(false)

  // single-employee edit modal
  const [editRow, setEditRow]       = useState(null)  // { type, label, dbId, totalDays, carryOverDays, expiresAt }
  const [editTotalDays, setEditTotalDays]   = useState('')
  const [editCarryOver, setEditCarryOver]   = useState('')
  const [editExpiresAt, setEditExpiresAt]   = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // cashout modal
  const [showCashoutModal, setShowCashoutModal] = useState(false)
  const [cashoutItems, setCashoutItems]   = useState([])
  const [cashoutLoading, setCashoutLoading] = useState(false)
  const [cashoutSaving, setCashoutSaving] = useState(false)

  // 特休多種寫法（annual / 特休假 / 特休 / 特別休假）統一歸 annual
  const ANNUAL_ALIASES = new Set(['annual', '特休假', '特休', '特別休假'])
  const normalizeType = (t) => (ANNUAL_ALIASES.has(t) ? 'annual' : (TYPE_CODE[t] || t))

  const calcStatutoryLeave = (emp) => {
    if (!emp?.join_date) return null
    if (emp.employment_type === '兼職' && Number(emp.weekly_hours || 40) < 20) return null
    const now = new Date(), join = new Date(emp.join_date)
    const months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth())
    const years = Math.floor(months / 12)
    if (months < 6)  return 0
    if (months < 12) return 3
    if (years < 2)   return 7
    if (years < 3)   return 10
    if (years < 5)   return 14
    if (years < 10)  return 15
    return Math.min(15 + (years - 10), 30)
  }

  const calcMaternityDays = (emp) => {
    if (!emp?.join_date) return 56
    const now = new Date(), join = new Date(emp.join_date)
    const months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth())
    return months >= 6 ? 56 : 28
  }

  // ── load employee list ────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setEmpLoading(true)
      const orgId = profile?.organization_id
      const { data } = await supabase.from('employees')
        .select('id, name, employee_number, dept, store, status, employment_type, join_date, weekly_hours, gender')
        .eq('organization_id', orgId).order('name')
      let emps = data || []
      if (!isAdmin && profile?.id) {
        emps = emps.filter(e => e.id === profile.id)
        setSelectedEmpId(profile.id)
      }
      setEmployees(emps)
      setEmpLoading(false)
    }
    if (profile?.organization_id) load()
  }, [profile?.organization_id])

  // ── load data when employee or year changes ───────────────────────────────
  useEffect(() => {
    if (!selectedEmpId) { setTableRows([]); return }
    const load = async () => {
      setDataLoading(true)
      const orgId = profile?.organization_id
      const yearStart = `${yearFilter}-01-01`
      const yearEnd   = `${yearFilter + 1}-01-01`
      const [balRes, lrRes, pendRes, compRes] = await Promise.all([
        supabase.from('leave_balances').select('*')
          .eq('year', yearFilter).eq('organization_id', orgId).eq('employee_id', selectedEmpId),
        supabase.from('leave_requests').select('employee_id,type,days,hours,start_date,status')
          .eq('organization_id', orgId).eq('employee_id', selectedEmpId)
          .in('status', ['已核准']).gte('start_date', yearStart).lt('start_date', yearEnd),
        supabase.from('leave_requests').select('employee_id,type,days,hours,start_date,status')
          .eq('organization_id', orgId).eq('employee_id', selectedEmpId)
          .eq('status', '申請中').gte('start_date', yearStart).lt('start_date', yearEnd),
        // 補休：改讀 comp_time_ledger（與補休管理 tab / 104 同源，不用 leave_balances 那套髒的）
        supabase.from('comp_time_ledger').select('hours,hours_used,status')
          .eq('employee_id', selectedEmpId).eq('status', 'active'),
      ])
      const bals    = balRes.data  || []
      const lrs     = lrRes.data   || []
      const pending = pendRes.data || []
      const comp    = compRes.data || []
      setDbBalances(bals)
      setLeaveRequests(lrs)
      setPendingRequests(pending)
      const emp = employees.find(e => e.id === selectedEmpId)
      setTableRows(buildRows(emp, bals, lrs, pending, comp))
      setDataLoading(false)
    }
    load()
  }, [selectedEmpId, yearFilter, employees])

  // ── build table rows ──────────────────────────────────────────────────────
  const buildRows = (emp, bals, lrs, pending, comp = []) => {
    if (!emp) return []
    // 補休：以 comp_time_ledger 為準（可休=sum(hours)、已休=sum(hours_used)）
    const compTotal = comp.reduce((s, c) => s + Number(c.hours || 0), 0)
    const compUsed  = comp.reduce((s, c) => s + Number(c.hours_used || 0), 0)
    const balByType = {}
    for (const b of bals) balByType[normalizeType(b.leave_type)] = b

    const usedByType   = {}    // type → hours used
    const pendByType   = {}    // type → hours pending
    const usedByTypeMonth = {} // 'menstrual-MM' → hours used

    for (const lr of lrs) {
      const code = normalizeType(lr.type)
      const h = lr.hours ? hoursToHours(lr.hours) : daysToHours(lr.days)
      usedByType[code] = (usedByType[code] || 0) + h
      if (code === 'menstrual' && lr.start_date) {
        const mm = lr.start_date.slice(5, 7)
        const key = `menstrual-${mm}`
        usedByTypeMonth[key] = (usedByTypeMonth[key] || 0) + h
      }
    }
    for (const lr of pending) {
      const code = normalizeType(lr.type)
      const h = lr.hours ? hoursToHours(lr.hours) : daysToHours(lr.days)
      pendByType[code] = (pendByType[code] || 0) + h
    }

    const gender = emp.gender
    const rows = []

    for (const type of ANNUAL_TYPES) {
      if (type === 'menstrual' && gender === '男') continue
      if (type === 'maternity' && gender === '男') continue
      if (type === 'paternity' && gender === '女') continue

      const dbBal  = balByType[type]
      const dbTotal = Number(dbBal?.total_days || 0)
      let computedDays = 0

      if (type === 'annual') computedDays = calcStatutoryLeave(emp) ?? 0
      else if (type === 'maternity') computedDays = calcMaternityDays(emp)
      else if (type === 'menstrual') computedDays = 12  // annual total (12 × 1 day)
      else computedDays = LEGAL_LIMITS[type] ?? 0

      // 有 DB 餘額(104 匯入為準) → 直接用；否則用法定計算值
      // 可休期間起日 > 今天(未生效，如新人特休尚未滿6月)→ 可休算 0，只看當下能休的
      const notStarted     = dbBal?.period_start && dbBal.period_start > _todayStr
      const effectiveDays  = notStarted ? 0 : (dbTotal > 0 ? dbTotal : computedDays)
      const carryOverDays  = notStarted ? 0 : Number(dbBal?.carry_over_days || 0)
      // 補休：可休直接用 comp_time_ledger 加總（小時，不經 days 換算）
      const totalHours     = type === '補休' ? compTotal : daysToHours(effectiveDays + carryOverDays)

      // annual period
      let rangeStr = `${yearFilter}/01/01 ～ ${yearFilter}/12/31`
      let periodLabel = `${yearFilter} 年`

      let annualStartStr = null, annualEndStr = null
      if (type === 'annual') {
        if (emp.join_date) {
          const join = new Date(emp.join_date)
          const startYear = new Date(yearFilter, join.getMonth(), join.getDate())
          const endYear   = new Date(yearFilter + 1, join.getMonth(), join.getDate() - 1)
          const pad2 = (n) => String(n).padStart(2, '0')
          const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`
          annualStartStr = iso(startYear)
          annualEndStr   = iso(endYear)
          rangeStr = `${annualStartStr.replace(/-/g,'/')} ～ ${annualEndStr.replace(/-/g,'/')}`
        }
        periodLabel = `${yearFilter} 年`
      }

      // 有 104 匯入的可休期間 → 顯示它的起迄（優先於前端自算）
      if (dbBal?.period_start && dbBal?.expires_at) {
        rangeStr = `${dbBal.period_start.replace(/-/g, '/')} ～ ${dbBal.expires_at.replace(/-/g, '/')}`
      }

      if (type === 'menstrual') {
        // expand into 12 monthly rows
        for (let m = 1; m <= 12; m++) {
          const mm  = String(m).padStart(2, '0')
          const key = `menstrual-${mm}`
          const daysInMonth = new Date(yearFilter, m, 0).getDate()
          const usedH   = usedByTypeMonth[key]   || 0
          const pendH   = 0  // per-month pending would need date range filter; simplify to 0
          const totalH  = 8  // 1 day per month = 8 hours
          const remH    = totalH - usedH
          const canApply = Math.max(0, remH - pendH)
          rows.push({
            _key: key, type, isMonthly: true,
            label: '生理假',
            period: `${yearFilter}年${mm}月`,
            range: `${yearFilter}/${mm}/01 ～ ${yearFilter}/${mm}/${String(daysInMonth).padStart(2,'0')}`,
            totalHours: totalH, usedHours: usedH, remainingHours: remH,
            pendingHours: pendH, canApplyHours: canApply,
            dbId: dbBal?.id, isManual: dbTotal > 0,
          })
        }
        continue
      }

      // 特休：已休/簽核中只算落在「可休區間」內的（避免把上一週年年度的特休算進本期）
      const inAnnual = (lr) => normalizeType(lr.type) === 'annual'
        && lr.start_date && lr.start_date >= annualStartStr && lr.start_date <= annualEndStr
      const sumH = (arr) => arr.reduce((s, lr) => s + (lr.hours ? hoursToHours(lr.hours) : daysToHours(lr.days)), 0)
      // 已休：補休→comp_time_ledger；有 104 leave_balance→讀 used_days；否則從請假單算
      const usedH    = type === '補休'
        ? compUsed
        : (dbBal
          ? daysToHours(Number(dbBal.used_days || 0))
          : ((type === 'annual' && annualStartStr) ? sumH(lrs.filter(inAnnual)) : (usedByType[type] || 0)))
      const pendH    = (type === 'annual' && annualStartStr) ? sumH(pending.filter(inAnnual)) : (pendByType[type] || 0)
      const remH     = totalHours - usedH
      const canApply = Math.max(0, remH - pendH)

      // 事件制假別（無固定天數）：沒有 DB 記錄且沒有用過就不顯示
      if (EVENT_BASED.has(type) && !dbBal && usedH === 0) continue

      rows.push({
        _key: type, type, isMonthly: false,
        label: TYPE_LABEL[type] || type,
        period: periodLabel,
        range: rangeStr,
        totalHours, usedHours: usedH, remainingHours: remH,
        pendingHours: pendH, canApplyHours: canApply,
        dbId: dbBal?.id, isManual: dbTotal > 0,
      })
    }

    // 殘骸/非標準假別（104 舊系統結算等，不在 ANNUAL_TYPES）→ 直接以 leave_balances 顯示
    const standardSet = new Set(ANNUAL_TYPES)
    for (const [lt, b] of Object.entries(balByType)) {
      if (standardSet.has(lt)) continue
      const notStarted = b.period_start && b.period_start > _todayStr
      const total = notStarted ? 0 : daysToHours(Number(b.total_days || 0) + Number(b.carry_over_days || 0))
      const used  = daysToHours(Number(b.used_days || 0))
      if (total === 0 && used === 0) continue
      const rng = b.period_start && b.expires_at
        ? `${b.period_start.replace(/-/g, '/')} ～ ${b.expires_at.replace(/-/g, '/')}`
        : (b.expires_at ? `～ ${String(b.expires_at).replace(/-/g, '/')}` : `${yearFilter}/01/01 ～ ${yearFilter}/12/31`)
      rows.push({
        _key: lt, type: lt, isMonthly: false,
        label: TYPE_LABEL[lt] || lt,
        period: `${yearFilter} 年`,
        range: rng,
        totalHours: total, usedHours: used, remainingHours: total - used,
        pendingHours: 0, canApplyHours: Math.max(0, total - used),
        dbId: b.id, isManual: true,
      })
    }

    return rows
  }

  // ── bulk submit ───────────────────────────────────────────────────────────
  const openEditRow = (r) => {
    const dbBal = dbBalances.find(b => b.id === r.dbId)
    setEditRow(r)
    setEditTotalDays(dbBal ? String(dbBal.total_days ?? '') : '')
    setEditCarryOver(dbBal ? String(dbBal.carry_over_days ?? '') : '')
    setEditExpiresAt(dbBal?.expires_at || '')
  }

  const handleEditSubmit = async () => {
    if (editTotalDays === '') { toast.warning('請輸入總天數'); return }
    try {
      setEditSaving(true)
      const payload = {
        employee_id: selectedEmpId, year: yearFilter,
        leave_type: editRow.type,
        total_days: Number(editTotalDays),
        carry_over_days: Number(editCarryOver) || 0,
        expires_at: editExpiresAt || null,
        organization_id: profile?.organization_id,
      }
      if (editRow.dbId) {
        const { error } = await supabase.from('leave_balances').update(payload).eq('id', editRow.dbId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('leave_balances').insert({ ...payload, used_days: 0 })
        if (error) throw error
      }
      toast.success('已儲存')
      setEditRow(null)
      const id = selectedEmpId
      setSelectedEmpId(null); setTimeout(() => setSelectedEmpId(id), 0)
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setEditSaving(false)
    }
  }

  const handleBulkSubmit = async () => {
    if (!bulkSelectedIds.length) { toast.warning('請選擇員工'); return }
    if (bulkDays === '' || isNaN(Number(bulkDays))) { toast.warning(bulkUnit === 'hour' ? '請輸入小時數' : '請輸入天數'); return }
    // 小時模式存 total_days 時除以 8
    const days = bulkUnit === 'hour' ? Number(bulkDays) / 8 : Number(bulkDays)
    const orgId = profile?.organization_id
    try {
      setBulkSaving(true)
      const { data: existing } = await supabase.from('leave_balances')
        .select('id, employee_id, total_days')
        .eq('year', bulkYear).eq('leave_type', bulkLeaveType).eq('organization_id', orgId)
        .in('employee_id', bulkSelectedIds)
      const existingMap = {}
      for (const r of existing || []) existingMap[r.employee_id] = r

      const toUpdate = [], toInsert = []
      for (const empId of bulkSelectedIds) {
        if (existingMap[empId]) {
          toUpdate.push({ id: existingMap[empId].id, total_days: Number(existingMap[empId].total_days || 0) + days })
        } else {
          toInsert.push({ employee_id: empId, year: bulkYear, leave_type: bulkLeaveType, total_days: Math.max(0, days), used_days: 0, organization_id: orgId })
        }
      }
      for (const r of toUpdate) {
        const { error } = await supabase.from('leave_balances').update({ total_days: r.total_days }).eq('id', r.id)
        if (error) throw error
      }
      if (toInsert.length) {
        const { error } = await supabase.from('leave_balances').insert(toInsert)
        if (error) throw error
      }
      const displayVal = Number(bulkDays)
      const unit = bulkUnit === 'hour' ? '小時' : '天'
      toast.success(`已更新 ${bulkSelectedIds.length} 人的 ${TYPE_LABEL[bulkLeaveType]} (${displayVal > 0 ? '+' : ''}${displayVal} ${unit})`)
      setShowBulkModal(false)
      // reload
      const id = selectedEmpId
      setSelectedEmpId(null)
      setTimeout(() => setSelectedEmpId(id), 0)
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setBulkSaving(false)
    }
  }

  // ── cashout ───────────────────────────────────────────────────────────────
  const openCashout = async () => {
    setCashoutLoading(true); setShowCashoutModal(true)
    try {
      const { data, error } = await supabase.rpc('cashout_annual_leave', { p_org: profile?.organization_id, p_year: yearFilter, p_dry_run: true })
      if (error) throw error
      setCashoutItems((data?.items || []).map(it => ({
        bal: { id: it.balance_id, employee_id: it.employee_id },
        unused: Number(it.unused_days), dailyRate: Number(it.daily_rate),
        cashoutAmount: Number(it.amount), empName: it.name,
      })))
    } catch { toast.error('結算資料載入失敗'); setShowCashoutModal(false) }
    finally { setCashoutLoading(false) }
  }

  const handleCashoutConfirm = async () => {
    try {
      setCashoutSaving(true)
      const { data, error } = await supabase.rpc('cashout_annual_leave', { p_org: profile?.organization_id, p_year: yearFilter, p_dry_run: false })
      if (error) throw error
      toast.success(`已結清 ${data?.processed_count ?? 0} 人，共 NT$ ${Number(data?.total_amount || 0).toLocaleString()}`)
      setShowCashoutModal(false); setCashoutItems([])
    } catch (err) { toast.error('結算失敗：' + (err.message || '未知錯誤')) }
    finally { setCashoutSaving(false) }
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const yearOptions = []
  for (let y = currentYear - 2; y <= currentYear + 1; y++) yearOptions.push(y)

  const selectedEmp = employees.find(e => e.id === selectedEmpId)

  const filteredEmployees = employees.filter(e => {
    if (statusFilter && e.status !== statusFilter) return false
    if (nameSearch) {
      const q = nameSearch.toLowerCase()
      return e.name?.toLowerCase().includes(q) || (e.employee_number || '').toLowerCase().includes(q)
    }
    return true
  })

  const annualRows = tableRows.filter(r => r.type !== 'comp')
  const compRows   = tableRows.filter(r => r.type === 'comp')

  if (empLoading) return <LoadingSpinner />

  const cellStyle = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }
  const numCell   = (h, color) => (
    <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 600, color: color || 'var(--text-primary)' }}>
      {h > 0 ? `${h}小時` : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>0小時</span>}
    </td>
  )

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📊</span> 假勤明細</h2>
          </div>
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => {
                setBulkSelectedIds([]); setBulkSearch(''); setBulkLeaveType('annual')
                setBulkDays(''); setBulkUnit('day'); setBulkYear(currentYear); setShowBulkModal(true)
              }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} /> 批次調整天數
              </button>
              <button className="btn btn-ghost" onClick={openCashout} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calculator size={14} /> 特休結算
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        padding: '10px 14px', marginBottom: 12,
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
      }}>
        <select className="form-input" style={{ fontSize: 13, width: 90 }}
          value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {isAdmin && (
          <>
            <select className="form-input" style={{ fontSize: 13, width: 100 }}
              value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="在職">在職</option>
              <option value="離職">離職</option>
              <option value="">全部</option>
            </select>
            <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 260 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" placeholder="姓名或員編" style={{ paddingLeft: 32, fontSize: 13, width: '100%' }}
                value={nameSearch} onChange={e => setNameSearch(e.target.value)} />
            </div>
          </>
        )}
      </div>

      {/* Main split panel */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', border: '1px solid var(--border-medium)', borderRadius: 12, background: 'var(--bg-card)', minHeight: 0 }}>

        {/* Left: employee list */}
        {isAdmin && (
          <div style={{ width: 176, flexShrink: 0, borderRight: '1px solid var(--border-medium)', overflowY: 'auto' }}>
            {filteredEmployees.length === 0 && (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>無員工</div>
            )}
            {filteredEmployees.map(emp => {
              const selected = emp.id === selectedEmpId
              return (
                <div key={emp.id}
                  onClick={() => setSelectedEmpId(emp.id)}
                  style={{
                    padding: '11px 14px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border-subtle)',
                    borderLeft: selected ? '3px solid var(--accent-cyan)' : '3px solid transparent',
                    background: selected ? 'var(--accent-cyan-dim)' : 'transparent',
                    transition: 'background .15s',
                  }}>
                  <div style={{ fontWeight: selected ? 700 : 500, fontSize: 13, color: selected ? 'var(--accent-cyan)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp.name}
                    {emp.employee_number && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>({emp.employee_number})</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.dept || emp.store || '—'}</div>
                </div>
              )
            })}
          </div>
        )}

        {/* Right: tabs + table */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {!selectedEmpId ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 36 }}>👈</div>
              <div style={{ fontSize: 14 }}>請從左側選擇員工</div>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border-medium)', padding: '0 20px', flexShrink: 0 }}>
                {[['annual', '年度假勤'], ['comp', '補休管理']].map(([key, label]) => (
                  <button key={key} onClick={() => setActiveTab(key)} style={{
                    padding: '12px 20px', fontSize: 14, fontWeight: activeTab === key ? 700 : 400,
                    color: activeTab === key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    borderBottom: activeTab === key ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                    background: 'none', border: 'none', borderRadius: 0, cursor: 'pointer',
                    marginBottom: -1,
                  }}>{label}</button>
                ))}
              </div>

              {/* Table */}
              {dataLoading ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>載入中...</div>
              ) : (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {activeTab === 'annual' && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                          {['假勤項目','假勤年/月/日','可休區間','可休','已休','剩餘','簽核中','可申請', ...(isAdmin ? [''] : [])].map((h, i) => (
                            <th key={i} style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textAlign: h === '假勤項目' ? 'left' : 'center', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-medium)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {annualRows.length === 0 && (
                          <tr><td colSpan={8} style={{ ...cellStyle, textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>尚無假勤記錄</td></tr>
                        )}
                        {annualRows.map((r, idx) => {
                          const remColor = r.remainingHours > 0 ? 'var(--accent-green)' : r.remainingHours < 0 ? 'var(--accent-red)' : 'var(--text-muted)'
                          return (
                            <tr key={r._key} style={{ background: idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                              <td style={{ ...cellStyle, fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</td>
                              <td style={{ ...cellStyle, textAlign: 'center' }}>{r.period}</td>
                              <td style={{ ...cellStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{r.range}</td>
                              {numCell(r.totalHours)}
                              {numCell(r.usedHours, r.usedHours > 0 ? 'var(--accent-orange)' : null)}
                              <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 700, color: remColor }}>
                                {r.remainingHours > 0 ? `${r.remainingHours}小時` : r.remainingHours < 0 ? `${r.remainingHours}小時` : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>0小時</span>}
                              </td>
                              {numCell(r.pendingHours, r.pendingHours > 0 ? 'var(--accent-purple)' : null)}
                              {numCell(r.canApplyHours, 'var(--accent-cyan)')}
                              {isAdmin && !r.isMonthly && (
                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                  <button className="btn btn-sm btn-ghost" style={{ padding: '2px 10px', fontSize: 12 }}
                                    onClick={() => openEditRow(r)}>
                                    <Edit2 size={11} style={{ marginRight: 3 }} />調整
                                  </button>
                                </td>
                              )}
                              {isAdmin && r.isMonthly && <td style={cellStyle} />}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}

                  {activeTab === 'comp' && (
                    <div style={{ padding: 24 }}>
                      {compRows.length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
                          尚無補休記錄
                        </div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-secondary)' }}>
                              {['假勤項目','可休區間','可休','已休','剩餘','簽核中','可申請'].map(h => (
                                <th key={h} style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textAlign: h === '假勤項目' ? 'left' : 'center', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-medium)' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {compRows.map(r => (
                              <tr key={r._key}>
                                <td style={{ ...cellStyle, fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</td>
                                <td style={{ ...cellStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{r.range}</td>
                                {numCell(r.totalHours)}
                                {numCell(r.usedHours, r.usedHours > 0 ? 'var(--accent-orange)' : null)}
                                <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 700, color: r.remainingHours > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                  {r.remainingHours}小時
                                </td>
                                {numCell(r.pendingHours, r.pendingHours > 0 ? 'var(--accent-purple)' : null)}
                                {numCell(r.canApplyHours, 'var(--accent-cyan)')}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Single row edit modal */}
      {editRow && (
        <Modal title={`調整假別天數 — ${selectedEmp?.name} · ${editRow.label}`}
          onClose={() => setEditRow(null)} onSubmit={handleEditSubmit}
          submitLabel={editSaving ? '儲存中...' : '儲存'} submitDisabled={editSaving}>
          <div style={{ padding: '8px 12px', marginBottom: 12, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)' }}>
            目前法定：{editRow.totalHours} 小時（{editRow.totalHours / 8} 天）· 已休：{editRow.usedHours} 小時
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="總天數（手動覆蓋）" required>
              <input className="form-input" type="number" min="0" step="0.5" style={{ width: '100%' }}
                placeholder={String(editRow.totalHours / 8)}
                value={editTotalDays} onChange={e => setEditTotalDays(e.target.value)} />
            </Field>
            <Field label="遞延天數">
              <input className="form-input" type="number" min="0" step="0.5" style={{ width: '100%' }} placeholder="0"
                value={editCarryOver} onChange={e => setEditCarryOver(e.target.value)} />
            </Field>
          </div>
          <Field label="到期日">
            <input className="form-input" type="date" style={{ width: '100%' }}
              value={editExpiresAt} onChange={e => setEditExpiresAt(e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* Bulk Modal */}
      {showBulkModal && (() => {
        const filtEmps = employees.filter(e =>
          !bulkSearch || e.name.includes(bulkSearch) || (e.dept || '').includes(bulkSearch)
        )
        const allSel = filtEmps.length > 0 && filtEmps.every(e => bulkSelectedIds.includes(e.id))
        const toggleAll = () => allSel
          ? setBulkSelectedIds(ids => ids.filter(id => !filtEmps.find(e => e.id === id)))
          : setBulkSelectedIds(ids => [...new Set([...ids, ...filtEmps.map(e => e.id)])])
        const toggleOne = (id) => setBulkSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])
        return (
          <Modal title="批次調整假別天數" onClose={() => setShowBulkModal(false)}
            onSubmit={handleBulkSubmit}
            submitLabel={bulkSaving ? '儲存中...' : `確認套用（${bulkSelectedIds.length} 人）`}
            submitDisabled={bulkSaving || !bulkSelectedIds.length || bulkDays === ''}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <Field label="年度" required>
                <select className="form-input" style={{ width: '100%' }} value={bulkYear} onChange={e => setBulkYear(Number(e.target.value))}>
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
              <Field label="假別" required>
                <select className="form-input" style={{ width: '100%' }} value={bulkLeaveType} onChange={e => setBulkLeaveType(e.target.value)}>
                  {ANNUAL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
                </select>
              </Field>
              <Field label="調整數量" required>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="form-input" type="number" step={bulkUnit === 'hour' ? 1 : 0.5}
                    style={{ flex: 1 }} placeholder="正數加、負數扣"
                    value={bulkDays} onChange={e => setBulkDays(e.target.value)} />
                  <select className="form-input" style={{ width: 72 }} value={bulkUnit} onChange={e => setBulkUnit(e.target.value)}>
                    <option value="day">天</option>
                    <option value="hour">小時</option>
                  </select>
                </div>
              </Field>
            </div>
            <Field label={`選擇員工（已選 ${bulkSelectedIds.length} / ${employees.length}）`}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input className="form-input" placeholder="搜尋員工或部門..." value={bulkSearch}
                  onChange={e => setBulkSearch(e.target.value)} style={{ flex: 1, fontSize: 13 }} />
                <button className="btn btn-sm btn-ghost" onClick={toggleAll} style={{ whiteSpace: 'nowrap' }}>
                  {allSel ? '取消全選' : '全選'}
                </button>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                {filtEmps.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>查無員工</div>}
                {filtEmps.map(e => (
                  <label key={e.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: bulkSelectedIds.includes(e.id) ? 'var(--accent-cyan-dim)' : 'transparent',
                  }}>
                    <input type="checkbox" checked={bulkSelectedIds.includes(e.id)} onChange={() => toggleOne(e.id)} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{e.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.dept || '—'} · {e.store || '—'}</div>
                    </div>
                  </label>
                ))}
              </div>
            </Field>
          </Modal>
        )
      })()}

      {/* Cashout Modal */}
      {showCashoutModal && (
        <Modal title="特休結算 — 未休年假結清" onClose={() => setShowCashoutModal(false)}
          onSubmit={handleCashoutConfirm}
          submitLabel={cashoutSaving ? '結算中...' : '確認結算'}
          submitDisabled={cashoutSaving || cashoutLoading || cashoutItems.length === 0}>
          {cashoutLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>載入結算資料中...</div>
          ) : cashoutItems.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>目前無員工有未使用特休天數</div>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                以下員工有未使用特休，確認後將依日薪計算結清金額並寫入獎金紀錄，同時將特休餘額歸零。
              </p>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>員工</th><th>未休天數</th><th>日薪</th><th>應結清金額</th></tr></thead>
                  <tbody>
                    {cashoutItems.map(({ bal, unused, dailyRate, cashoutAmount, empName }) => (
                      <tr key={bal.id}>
                        <td style={{ fontWeight: 600 }}>{empName}</td>
                        <td><span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>{unused} 天</span></td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                          {dailyRate > 0 ? `NT$ ${Math.round(dailyRate).toLocaleString()}` : '—'}
                        </td>
                        <td><span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>
                          {cashoutAmount > 0 ? `NT$ ${cashoutAmount.toLocaleString()}` : '—'}
                        </span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--accent-orange-dim)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                結算後各員工特休餘額將設為 0，此操作無法復原，請確認後再送出。
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
