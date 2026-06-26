import { useState, useEffect } from 'react'
import { Plus, Edit2, Calculator, User, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'

const TYPE_LABEL = {
  annual: '特休', sick: '病假', personal: '事假', comp: '補休',
  menstrual: '生理假', marriage: '婚假', bereavement: '喪假',
  official: '公假', maternity: '產假', paternity: '陪產假',
  parental: '育嬰假', family_care: '家庭照顧假', mental_health: '心理假',
  occupational: '公傷病假', prenatal: '產檢假', unpaid: '無薪假',
}
const TYPE_CODE = Object.fromEntries(Object.entries(TYPE_LABEL).map(([k, v]) => [v, k]))

const LEGAL_LIMITS = {
  sick: 30, personal: 14, menstrual: 12,
  marriage: 8, bereavement: 8, mental_health: 3, family_care: 7,
  paternity: 7,
}

const DISPLAY_TYPES = [
  'annual', 'sick', 'personal', 'comp', 'menstrual',
  'marriage', 'bereavement', 'official', 'maternity', 'paternity', 'unpaid',
]
const ALL_TYPES = [...DISPLAY_TYPES, 'family_care', 'mental_health', 'occupational', 'prenatal', 'parental']

const TYPE_ICON = {
  annual: '🌴', sick: '🏥', personal: '🙋', comp: '🔄',
  menstrual: '💊', marriage: '💒', bereavement: '🕯️',
  official: '🏛️', maternity: '🤱', paternity: '👨‍👶',
  parental: '👶', family_care: '🏠', mental_health: '🧠',
  occupational: '🦺', prenatal: '🩺', unpaid: '📋',
}

export default function LeaveBalances() {
  const { profile, role } = useAuth()
  const userRole = role?.name || profile?.role || 'store_staff'
  const isStaff = userRole === 'store_staff'
  const currentYear = new Date().getFullYear()

  const [employees, setEmployees] = useState([])
  const [selectedEmpId, setSelectedEmpId] = useState(null)
  const [yearFilter, setYearFilter] = useState(currentYear)

  const [dbBalances, setDbBalances] = useState([])
  const [leaveRequests, setLeaveRequests] = useState([])
  const [empRows, setEmpRows] = useState([])      // computed rows for selected employee

  const [loading, setLoading] = useState(false)
  const [empLoading, setEmpLoading] = useState(true)

  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showCashoutModal, setShowCashoutModal] = useState(false)
  const [cashoutItems, setCashoutItems] = useState([])
  const [cashoutLoading, setCashoutLoading] = useState(false)
  const [cashoutSaving, setCashoutSaving] = useState(false)

  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkSelectedIds, setBulkSelectedIds] = useState([])
  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkLeaveType, setBulkLeaveType] = useState('annual')
  const [bulkDays, setBulkDays] = useState('')
  const [bulkYear, setBulkYear] = useState(currentYear)
  const [bulkSaving, setBulkSaving] = useState(false)

  const [form, setForm] = useState({
    employee_id: '', year: currentYear, leave_type: 'annual',
    total_days: '', used_days: 0, carry_over_days: '', expires_at: '',
  })

  const normalizeType = (t) => TYPE_CODE[t] || t

  const calcStatutoryLeave = (emp) => {
    if (!emp?.join_date) return null
    if (emp.employment_type === '兼職' && Number(emp.weekly_hours || 40) < 20) return null
    const now = new Date()
    const join = new Date(emp.join_date)
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

  const seniority = (emp) => {
    if (!emp?.join_date) return null
    const now = new Date()
    const join = new Date(emp.join_date)
    const months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth())
    const years = Math.floor(months / 12)
    const rem = months % 12
    return years > 0 ? `${years} 年 ${rem} 個月` : `${rem} 個月`
  }

  // load employee list once
  useEffect(() => {
    const load = async () => {
      setEmpLoading(true)
      const orgId = profile?.organization_id
      const { data, error } = await supabase.from('employees')
        .select('id, name, dept, store, status, employment_type, join_date, weekly_hours, gender')
        .eq('status', '在職').eq('organization_id', orgId).order('name')
      if (!error) {
        if (isStaff && profile?.id) {
          setEmployees(data.filter(e => e.id === profile.id))
          setSelectedEmpId(profile.id)
        } else {
          setEmployees(data || [])
        }
      }
      setEmpLoading(false)
    }
    if (profile?.organization_id) load()
  }, [profile?.organization_id])

  // load data when employee or year changes
  useEffect(() => {
    if (!selectedEmpId) { setEmpRows([]); return }
    const load = async () => {
      setLoading(true)
      const orgId = profile?.organization_id
      const yearStart = `${yearFilter}-01-01`
      const yearEnd   = `${yearFilter + 1}-01-01`
      const [balRes, lrRes] = await Promise.all([
        supabase.from('leave_balances')
          .select('*').eq('year', yearFilter).eq('organization_id', orgId).eq('employee_id', selectedEmpId),
        supabase.from('leave_requests')
          .select('employee_id, type, days, hours, start_date, status')
          .eq('organization_id', orgId).eq('employee_id', selectedEmpId)
          .in('status', ['已核准'])
          .gte('start_date', yearStart).lt('start_date', yearEnd),
      ])
      const bals = balRes.data || []
      const lrs  = lrRes.data  || []
      setDbBalances(bals)
      setLeaveRequests(lrs)
      const emp = employees.find(e => e.id === selectedEmpId)
      setEmpRows(buildRows(emp, bals, lrs))
      setLoading(false)
    }
    load()
  }, [selectedEmpId, yearFilter, employees])

  const buildRows = (emp, bals, lrs) => {
    if (!emp) return []
    const balByType = {}
    for (const b of bals) balByType[normalizeType(b.leave_type)] = b
    const usedByType = {}
    for (const lr of lrs) {
      const code = normalizeType(lr.type)
      usedByType[code] = (usedByType[code] || 0) + (Number(lr.days) || 0)
    }

    const gender = emp.gender  // '男' | '女' | null
    const visibleTypes = DISPLAY_TYPES.filter(t => {
      if (t === 'menstrual' && gender === '男') return false
      if (t === 'maternity' && gender === '男') return false
      if (t === 'paternity' && gender === '女') return false
      return true
    })

    return visibleTypes.map(type => {
      const dbBal = balByType[type]
      const dbTotal = Number(dbBal?.total_days || 0)
      let computedTotal = 0, statutory = null
      if (type === 'annual') { statutory = calcStatutoryLeave(emp); computedTotal = statutory ?? 0 }
      else if (type === 'maternity') {
        // 滿 6 個月 → 56 天（8週），未滿 6 個月 → 28 天（4週）
        if (emp.join_date) {
          const now = new Date(), join = new Date(emp.join_date)
          const months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth())
          computedTotal = months >= 6 ? 56 : 28
        } else computedTotal = 56
      }
      else computedTotal = LEGAL_LIMITS[type] ?? 0
      const effectiveTotal = dbTotal > 0 ? Math.max(dbTotal, computedTotal) : computedTotal
      const usedFromLr = usedByType[type] || 0
      const usedDays = Math.max(usedFromLr, Number(dbBal?.used_days || 0))
      const carryOver = Number(dbBal?.carry_over_days || 0)
      const total = effectiveTotal + carryOver
      const remaining = total - usedDays
      return {
        _key: type, _dbId: dbBal?.id, _statutory: statutory, _isManual: dbTotal > 0,
        leave_type: type, total_days: effectiveTotal, used_days: usedDays,
        carry_over_days: carryOver, expires_at: dbBal?.expires_at || null,
        total, remaining,
      }
    })
  }

  const openAdd = () => {
    setEditingId(null)
    setForm({ employee_id: selectedEmpId || '', year: yearFilter, leave_type: 'annual', total_days: '', used_days: 0, carry_over_days: '', expires_at: '' })
    setShowModal(true)
  }

  const openEdit = (r) => {
    setEditingId(r._dbId || null)
    const b = r._dbId ? dbBalances.find(b => b.id === r._dbId) || {} : {}
    setForm({
      employee_id: selectedEmpId,
      year: b.year || yearFilter,
      leave_type: r.leave_type,
      total_days: r._dbId ? (b.total_days ?? '') : r.total_days,
      used_days: b.used_days ?? r.used_days,
      carry_over_days: b.carry_over_days || '',
      expires_at: b.expires_at || '',
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!form.employee_id || form.total_days === '') { toast.warning('請填寫員工與總天數'); return }
    try {
      const payload = {
        employee_id: Number(form.employee_id), year: Number(form.year),
        leave_type: form.leave_type, total_days: Number(form.total_days),
        used_days: Number(form.used_days) || 0, carry_over_days: Number(form.carry_over_days) || 0,
        expires_at: form.expires_at || null, organization_id: profile?.organization_id,
      }
      if (editingId) {
        const { error } = await supabase.from('leave_balances').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('leave_balances').insert(payload)
        if (error) throw error
      }
      setShowModal(false)
      // re-trigger load
      setSelectedEmpId(v => { setTimeout(() => setSelectedEmpId(v), 0); return null })
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    }
  }

  const openBulk = () => {
    setBulkSelectedIds([])
    setBulkSearch('')
    setBulkLeaveType('annual')
    setBulkDays('')
    setBulkYear(currentYear)
    setShowBulkModal(true)
  }

  const handleBulkSubmit = async () => {
    if (!bulkSelectedIds.length) { toast.warning('請選擇員工'); return }
    if (bulkDays === '' || isNaN(Number(bulkDays))) { toast.warning('請輸入天數'); return }
    const days = Number(bulkDays)
    const orgId = profile?.organization_id
    try {
      setBulkSaving(true)
      // fetch existing records for selected employees
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

      toast.success(`已更新 ${bulkSelectedIds.length} 人的 ${TYPE_LABEL[bulkLeaveType]} (${days > 0 ? '+' : ''}${days} 天)`)
      setShowBulkModal(false)
      reloadEmpData()
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setBulkSaving(false)
    }
  }

  const openCashout = async () => {
    setCashoutLoading(true)
    setShowCashoutModal(true)
    try {
      const { data, error } = await supabase.rpc('cashout_annual_leave', {
        p_org: profile?.organization_id, p_year: yearFilter, p_dry_run: true,
      })
      if (error) throw error
      setCashoutItems((data?.items || []).map(it => ({
        bal: { id: it.balance_id, employee_id: it.employee_id },
        unused: Number(it.unused_days), dailyRate: Number(it.daily_rate),
        cashoutAmount: Number(it.amount), empName: it.name,
      })))
    } catch (err) {
      toast.error('結算資料載入失敗')
      setShowCashoutModal(false)
    } finally {
      setCashoutLoading(false)
    }
  }

  const handleCashoutConfirm = async () => {
    if (!cashoutItems.length) return
    try {
      setCashoutSaving(true)
      const { data, error } = await supabase.rpc('cashout_annual_leave', {
        p_org: profile?.organization_id, p_year: yearFilter, p_dry_run: false,
      })
      if (error) throw error
      toast.success(`已結清 ${data?.processed_count ?? 0} 人，共 NT$ ${Number(data?.total_amount || 0).toLocaleString()}`)
      setShowCashoutModal(false)
      setCashoutItems([])
    } catch (err) {
      toast.error('結算失敗：' + (err.message || '未知錯誤'))
    } finally {
      setCashoutSaving(false)
    }
  }

  const yearOptions = []
  for (let y = currentYear - 2; y <= currentYear + 1; y++) yearOptions.push(y)

  const selectedEmp = employees.find(e => e.id === selectedEmpId)

  // reload helper: toggle selectedEmpId to re-trigger useEffect
  const reloadEmpData = () => {
    const id = selectedEmpId
    setSelectedEmpId(null)
    setTimeout(() => setSelectedEmpId(id), 0)
  }

  const getRemainingColor = (remaining, total) => {
    if (total <= 0) return 'var(--text-muted)'
    const ratio = remaining / total
    if (ratio > 0.5)  return 'var(--accent-green)'
    if (ratio >= 0.2) return 'var(--accent-orange)'
    return 'var(--accent-red)'
  }

  if (empLoading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📊</span> 假別餘額</h2>
            <p>選擇員工查看剩餘假別天數</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isStaff && (
              <>
                <button className="btn btn-ghost" onClick={openBulk} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Users size={14} /> 批次調整天數
                </button>
                <button className="btn btn-ghost" onClick={openCashout} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calculator size={14} /> 特休結算
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Picker row */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        padding: '14px 16px', marginBottom: 20,
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 260px', minWidth: 220 }}>
          <User size={16} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
          {isStaff ? (
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{selectedEmp?.name}</span>
          ) : (
            <SearchableSelect
              value={selectedEmpId}
              onChange={v => setSelectedEmpId(v || null)}
              options={empOptions(employees, { keyBy: 'id' })}
              placeholder="選擇員工..."
              style={{ flex: 1 }}
            />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>年度</span>
          <select className="form-input" style={{ fontSize: 13, width: 90 }}
            value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {!isStaff && selectedEmpId && (
          <button className="btn btn-primary btn-sm" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> 新增假別
          </button>
        )}
      </div>

      {/* Empty state */}
      {!selectedEmpId && (
        <div style={{
          textAlign: 'center', padding: '64px 24px',
          color: 'var(--text-muted)', fontSize: 15,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👆</div>
          請先選擇一位員工
        </div>
      )}

      {/* Employee info + balances */}
      {selectedEmpId && selectedEmp && (
        <>
          {/* Employee card */}
          <div style={{
            padding: '14px 20px', marginBottom: 20,
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12,
            display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'var(--accent-cyan-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 700, color: 'var(--accent-cyan)',
              }}>
                {selectedEmp.name?.[0] || '?'}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{selectedEmp.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {selectedEmp.dept || '—'} · {selectedEmp.store || '—'} · {selectedEmp.employment_type || '全職'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>到職日</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                  {selectedEmp.join_date || '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>年資</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                  {seniority(selectedEmp) || '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>法定特休</div>
                <div style={{ fontSize: 13, color: 'var(--accent-cyan)', fontWeight: 600 }}>
                  {calcStatutoryLeave(selectedEmp) !== null ? `${calcStatutoryLeave(selectedEmp)} 天` : '兼職'}
                </div>
              </div>
            </div>
          </div>

          {/* Balance cards */}
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>載入中...</div>
          ) : empRows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              尚無假別記錄
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {empRows.map(r => {
                const label = TYPE_LABEL[r.leave_type] || r.leave_type
                const icon  = TYPE_ICON[r.leave_type] || '📋'
                const color = getRemainingColor(r.remaining, r.total)
                const pct   = r.total > 0 ? Math.max(0, Math.min(100, (r.remaining / r.total) * 100)) : 0
                const statutory = r._statutory
                const belowLegal = r.leave_type === 'annual' && statutory !== null && r.total_days < statutory
                return (
                  <div key={r._key} style={{
                    padding: '16px 18px',
                    background: 'var(--bg-card)',
                    border: `1px solid ${belowLegal ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
                    borderRadius: 12,
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    {/* top row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 18 }}>{icon}</span>
                        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{label}</span>
                        {!r._dbId && (
                          <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>估算</span>
                        )}
                        {belowLegal && (
                          <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}>低於法定</span>
                        )}
                      </div>
                      {!isStaff && (
                        <button className="btn btn-sm btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => openEdit(r)}>
                          <Edit2 size={11} /> {r._dbId ? '調整' : '設定'}
                        </button>
                      )}
                    </div>

                    {/* remaining big number */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{r.remaining}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>天剩餘</span>
                    </div>

                    {/* progress bar */}
                    <div style={{ height: 5, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .3s' }} />
                    </div>

                    {/* stats row */}
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                      <span>已用 <strong style={{ color: 'var(--text-secondary)' }}>{r.used_days}</strong></span>
                      <span>共 <strong style={{ color: 'var(--text-secondary)' }}>{r.total}</strong></span>
                      {r.carry_over_days > 0 && <span>遞延 <strong style={{ color: 'var(--accent-purple)' }}>{r.carry_over_days}</strong></span>}
                      {r.expires_at && <span>到期 <strong>{r.expires_at}</strong></span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

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

      {/* Bulk Modal */}
      {showBulkModal && (() => {
        const filteredEmps = employees.filter(e =>
          !bulkSearch || e.name.includes(bulkSearch) || (e.dept || '').includes(bulkSearch)
        )
        const allSelected = filteredEmps.length > 0 && filteredEmps.every(e => bulkSelectedIds.includes(e.id))
        const toggleAll = () => {
          if (allSelected) setBulkSelectedIds(ids => ids.filter(id => !filteredEmps.find(e => e.id === id)))
          else setBulkSelectedIds(ids => [...new Set([...ids, ...filteredEmps.map(e => e.id)])])
        }
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
                  {DISPLAY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
                </select>
              </Field>
              <Field label="新增天數" required>
                <input className="form-input" type="number" step="0.5" style={{ width: '100%' }} placeholder="正數加、負數扣"
                  value={bulkDays} onChange={e => setBulkDays(e.target.value)} />
              </Field>
            </div>
            <Field label={`選擇員工（已選 ${bulkSelectedIds.length} / ${employees.length}）`}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input className="form-input" placeholder="搜尋員工或部門..." value={bulkSearch}
                  onChange={e => setBulkSearch(e.target.value)} style={{ flex: 1, fontSize: 13 }} />
                <button className="btn btn-sm btn-ghost" onClick={toggleAll} style={{ whiteSpace: 'nowrap' }}>
                  {allSelected ? '取消全選' : '全選'}
                </button>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                {filteredEmps.length === 0 && (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>查無員工</div>
                )}
                {filteredEmps.map(e => (
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

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editingId ? '調整假別天數' : '設定假別天數'} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="員工">
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{selectedEmp?.name}</span>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="年度" required>
              <select className="form-input" style={{ width: '100%' }} value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="假別" required>
              <select className="form-input" style={{ width: '100%' }} value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))}>
                {DISPLAY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="總天數（手動覆蓋）" required>
              <input className="form-input" type="number" min="0" step="0.5" style={{ width: '100%' }} placeholder="例：7"
                value={form.total_days} onChange={e => setForm(f => ({ ...f, total_days: e.target.value }))} />
            </Field>
            <Field label="遞延天數">
              <input className="form-input" type="number" min="0" step="0.5" style={{ width: '100%' }} placeholder="0"
                value={form.carry_over_days} onChange={e => setForm(f => ({ ...f, carry_over_days: e.target.value }))} />
            </Field>
          </div>
          <Field label="到期日">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
