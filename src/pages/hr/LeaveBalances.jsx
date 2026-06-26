import { useState, useEffect } from 'react'
import { Plus, Edit2, Search, Calculator } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { empLabel } from '../../lib/empLabel'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { toast } from '../../lib/toast'

// DB 存英文 code，顯示用中文
const TYPE_LABEL = {
  annual: '特休', sick: '病假', personal: '事假', comp: '補休',
  menstrual: '生理假', marriage: '婚假', bereavement: '喪假',
  official: '公假', maternity: '產假', paternity: '陪產假',
  parental: '育嬰假', family_care: '家庭照顧假', mental_health: '心理假',
  occupational: '公傷病假', prenatal: '產檢假', unpaid: '無薪假',
}
// 中文 → code（歷史資料用）
const TYPE_CODE = Object.fromEntries(Object.entries(TYPE_LABEL).map(([k, v]) => [v, k]))

// 法定上限（calendar year，非年資制）
const LEGAL_LIMITS = {
  sick: 30, personal: 14, menstrual: 12,
  marriage: 8, bereavement: 8, mental_health: 3, family_care: 7,
}

const DISPLAY_TYPES = ['annual', 'sick', 'personal', 'comp', 'menstrual',
  'marriage', 'bereavement', 'official', 'maternity', 'paternity', 'unpaid']

const ALL_TYPES = [...DISPLAY_TYPES, 'family_care', 'mental_health', 'occupational', 'prenatal', 'parental']

export default function LeaveBalances() {
  const { profile, role } = useAuth()
  const userRole = role?.name || profile?.role || 'store_staff'
  const isStaff = userRole === 'store_staff'
  const currentYear = new Date().getFullYear()

  const [employees, setEmployees] = useState([])
  const [dbBalances, setDbBalances] = useState([])      // leave_balances table (carry_over, expires_at, comp total, manual override)
  const [leaveRequests, setLeaveRequests] = useState([]) // approved leave_requests for computing used
  const [rows, setRows] = useState([])                   // computed display rows

  const [yearFilter, setYearFilter] = useState(currentYear)
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showCashoutModal, setShowCashoutModal] = useState(false)
  const [cashoutItems, setCashoutItems] = useState([])
  const [cashoutLoading, setCashoutLoading] = useState(false)
  const [cashoutSaving, setCashoutSaving] = useState(false)

  const [form, setForm] = useState({
    employee_id: '', year: currentYear, leave_type: 'annual',
    total_days: '', used_days: 0, carry_over_days: '', expires_at: '',
  })

  // 勞基法 §38 依到職日計算（週工時<20 的兼職返回 null）
  const calcStatutoryLeave = (emp) => {
    if (!emp?.join_date) return null
    if (emp.employment_type === '兼職' && Number(emp.weekly_hours || 40) < 20) return null
    const months = (new Date().getFullYear() - new Date(emp.join_date).getFullYear()) * 12
      + (new Date().getMonth() - new Date(emp.join_date).getMonth())
    const years = Math.floor(months / 12)
    if (months < 6)  return 0
    if (months < 12) return 3
    if (years < 2)   return 7
    if (years < 3)   return 10
    if (years < 5)   return 14
    if (years < 10)  return 15
    return Math.min(15 + (years - 10), 30)
  }

  // 正規化 leave_request.type → code
  const normalizeType = (t) => TYPE_CODE[t] || t

  const fetchData = async () => {
    try {
      setLoading(true)
      const orgId = profile?.organization_id
      const yearStart = `${yearFilter}-01-01`
      const yearEnd   = `${yearFilter + 1}-01-01`

      const [empRes, balRes, lrRes] = await Promise.all([
        supabase.from('employees')
          .select('id, name, dept, store, status, employment_type, join_date, weekly_hours')
          .eq('status', '在職').eq('organization_id', orgId).order('name'),
        supabase.from('leave_balances')
          .select('*').eq('year', yearFilter).eq('organization_id', orgId),
        supabase.from('leave_requests')
          .select('employee_id, type, days, hours, start_date, status')
          .eq('organization_id', orgId)
          .in('status', ['已核准'])
          .gte('start_date', yearStart).lt('start_date', yearEnd),
      ])
      if (empRes.error) throw empRes.error
      if (balRes.error) throw balRes.error

      let emps = empRes.data || []
      let bals = balRes.data || []
      let lrs  = lrRes.data  || []

      if (isStaff && profile?.id) {
        emps = emps.filter(e => e.id === profile.id)
        bals = bals.filter(b => b.employee_id === profile.id)
        lrs  = lrs.filter(r => r.employee_id === profile.id)
      }

      setEmployees(emps)
      setDbBalances(bals)
      setLeaveRequests(lrs)
      setRows(buildRows(emps, bals, lrs))
    } catch (err) {
      console.error('Failed to load leave balances:', err)
      setError('資料載入失敗，請重新整理頁面')
    } finally {
      setLoading(false)
    }
  }

  const buildRows = (emps, bals, lrs) => {
    const balByEmpType = {}
    for (const b of bals) {
      const code = normalizeType(b.leave_type)
      balByEmpType[`${b.employee_id}-${code}`] = b
    }
    const usedByEmpType = {}
    for (const lr of lrs) {
      const code = normalizeType(lr.type)
      const key = `${lr.employee_id}-${code}`
      usedByEmpType[key] = (usedByEmpType[key] || 0) + (Number(lr.days) || 0)
    }

    const result = []
    for (const emp of emps) {
      // 確認這個員工有哪些假別（DB 有記錄 OR leave_requests 有用假）
      const empTypes = new Set(['annual'])
      for (const b of bals.filter(b => b.employee_id === emp.id))
        empTypes.add(normalizeType(b.leave_type))
      for (const lr of lrs.filter(r => r.employee_id === emp.id))
        empTypes.add(normalizeType(lr.type))

      for (const type of ALL_TYPES) {
        if (!empTypes.has(type)) continue
        const dbBal = balByEmpType[`${emp.id}-${type}`]
        const dbTotal = Number(dbBal?.total_days || 0)

        // effective total：DB 手動覆蓋 > 0 時優先；否則用計算值
        let computedTotal = 0
        let statutory = null
        if (type === 'annual') {
          statutory = calcStatutoryLeave(emp)
          computedTotal = statutory ?? 0
        } else {
          computedTotal = LEGAL_LIMITS[type] ?? 0
        }
        const effectiveTotal = dbTotal > 0 ? Math.max(dbTotal, computedTotal) : computedTotal

        // used：從 leave_requests 算（準確），若 DB 更高則取 DB（手動調整情況）
        const usedFromLr = usedByEmpType[`${emp.id}-${type}`] || 0
        const usedDays = Math.max(usedFromLr, Number(dbBal?.used_days || 0))

        const carryOver = Number(dbBal?.carry_over_days || 0)
        const total = effectiveTotal + carryOver
        const remaining = total - usedDays

        // 無資料（沒 DB 記錄、沒用過、又是非固定限額假別）就跳過
        if (!dbBal && usedDays === 0 && computedTotal === 0) continue

        result.push({
          _key:       `${emp.id}-${type}`,
          _dbId:      dbBal?.id,           // 有 DB 記錄才有 id，供 edit 用
          _statutory: statutory,
          _isManual:  dbTotal > 0,
          employee_id: emp.id,
          leave_type:  type,
          total_days:  effectiveTotal,
          used_days:   usedDays,
          carry_over_days: carryOver,
          expires_at:  dbBal?.expires_at || null,
          total,
          remaining,
        })
      }
    }
    return result
  }

  useEffect(() => { fetchData() }, [yearFilter, profile?.organization_id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const getEmpName = (id) => employees.find(e => e.id === id)?.name || `#${id}`
  const getEmpDept = (id) => employees.find(e => e.id === id)?.dept || ''
  const getEmp     = (id) => employees.find(e => e.id === id)

  const getRemainingColor = (remaining, total) => {
    if (total <= 0) return 'var(--text-muted)'
    const ratio = remaining / total
    if (ratio > 0.5)  return 'var(--accent-green)'
    if (ratio >= 0.2) return 'var(--accent-orange)'
    return 'var(--accent-red)'
  }

  const filtered = rows.filter(r =>
    (typeFilter === '' || r.leave_type === typeFilter || TYPE_LABEL[r.leave_type] === typeFilter) &&
    (search === '' || getEmpName(r.employee_id).includes(search))
  )

  const uniqueEmployees = new Set(filtered.map(r => r.employee_id)).size
  const avgUsageRate = filtered.length > 0
    ? Math.round(filtered.reduce((s, r) => s + (r.total > 0 ? (r.used_days / r.total) * 100 : 0), 0) / filtered.length)
    : 0

  // ── 特休結清（仍走 DB cashout RPC，讀 dbBalances）──────────────────────────
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
      console.error('[cashout] RPC failed:', err)
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
      fetchData()
    } catch (err) {
      console.error('Cashout failed:', err)
      toast.error('結算失敗：' + (err.message || '未知錯誤'))
    } finally {
      setCashoutSaving(false)
    }
  }

  const openAdd = () => {
    setEditingId(null)
    setForm({ employee_id: '', year: yearFilter, leave_type: 'annual', total_days: '', used_days: 0, carry_over_days: '', expires_at: '' })
    setShowModal(true)
  }

  const openEdit = (r) => {
    if (!r._dbId) {
      // 無 DB 記錄：先新增
      setEditingId(null)
      setForm({ employee_id: r.employee_id, year: yearFilter, leave_type: r.leave_type,
        total_days: r.total_days, used_days: r.used_days, carry_over_days: r.carry_over_days || '', expires_at: r.expires_at || '' })
    } else {
      setEditingId(r._dbId)
      const b = dbBalances.find(b => b.id === r._dbId) || {}
      setForm({ employee_id: b.employee_id, year: b.year || yearFilter, leave_type: normalizeType(b.leave_type),
        total_days: b.total_days, used_days: b.used_days, carry_over_days: b.carry_over_days || '', expires_at: b.expires_at || '' })
    }
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
      fetchData()
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const yearOptions = []
  for (let y = currentYear - 2; y <= currentYear + 1; y++) yearOptions.push(y)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📊</span> 假別餘額管理</h2>
            <p>查看與管理員工各類假別剩餘天數</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isStaff && (
              <button className="btn btn-ghost" onClick={openCashout} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calculator size={14} /> 特休結算
              </button>
            )}
            {!isStaff && <button className="btn btn-primary" onClick={openAdd}><Plus size={14} /> 新增餘額</button>}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📅 年度</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 100 }} value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏷️ 假別</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 120 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">全部假別</option>
          {DISPLAY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
        </select>
      </div>

      {/* Summary */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">員工人數</div>
          <div className="stat-card-value">{uniqueEmployees}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">平均使用率</div>
          <div className="stat-card-value">{avgUsageRate}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">餘額筆數</div>
          <div className="stat-card-value">{filtered.length}</div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 假別餘額列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋員工..." className="form-input" style={{ paddingLeft: 38 }}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>部門</th>
                <th>假別</th>
                <th>總天數</th>
                <th>已用天數</th>
                <th>遞延天數</th>
                <th>剩餘天數</th>
                <th>法定 §38</th>
                <th>到期日</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無餘額資料</td></tr>
              )}
              {filtered.map(r => {
                const color = getRemainingColor(r.remaining, r.total)
                const statutory = r._statutory
                const belowLegal = statutory !== null && r.total_days < statutory
                return (
                  <tr key={r._key}>
                    <td style={{ fontWeight: 600 }}>{getEmpName(r.employee_id)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(r.employee_id)}</td>
                    <td>
                      <span className="badge badge-info">
                        <span className="badge-dot"></span>
                        {TYPE_LABEL[r.leave_type] || r.leave_type}
                        {!r._dbId && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.6 }}>計算</span>}
                      </span>
                    </td>
                    <td>{r.total_days}</td>
                    <td>{r.used_days}</td>
                    <td>{r.carry_over_days || 0}</td>
                    <td>
                      <span style={{ fontWeight: 700, color }}>{r.remaining}</span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {statutory === null
                        ? <span style={{ color: 'var(--text-muted)' }}>另議</span>
                        : <span style={{ color: belowLegal ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: belowLegal ? 700 : 400 }}
                            title={belowLegal ? `帳上 ${r.total_days} 天低於法定 ${statutory} 天` : '符合§38'}>
                            {statutory} 天{belowLegal ? ' ⚠️' : ''}
                          </span>
                      }
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.expires_at || '—'}</td>
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(r)}>
                        <Edit2 size={12} /> {r._dbId ? '編輯' : '設定'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 特休結算 Modal */}
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

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editingId ? '編輯假別餘額' : '設定假別餘額'} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="員工" required>
            <SearchableSelect value={form.employee_id || null} onChange={v => set('employee_id', v || '')}
              options={empOptions(employees, { keyBy: 'id' })} placeholder="搜尋員工姓名/職稱..." disabled={!!editingId} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="年度" required>
              <select className="form-input" style={{ width: '100%' }} value={form.year} onChange={e => set('year', e.target.value)}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="假別" required>
              <select className="form-input" style={{ width: '100%' }} value={form.leave_type} onChange={e => set('leave_type', e.target.value)}>
                {DISPLAY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="總天數（手動覆蓋）" required>
              <input className="form-input" type="number" min="0" step="0.5" style={{ width: '100%' }} placeholder="例：7"
                value={form.total_days} onChange={e => set('total_days', e.target.value)} />
            </Field>
            <Field label="遞延天數">
              <input className="form-input" type="number" min="0" step="0.5" style={{ width: '100%' }} placeholder="0"
                value={form.carry_over_days} onChange={e => set('carry_over_days', e.target.value)} />
            </Field>
          </div>
          <Field label="到期日">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
