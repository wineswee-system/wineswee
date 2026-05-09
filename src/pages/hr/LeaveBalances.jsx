import { useState, useEffect } from 'react'
import { Plus, Edit2, Search, Calculator } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { empLabel } from '../../lib/empLabel'

import { toast } from '../../lib/toast'
const LEAVE_TYPES = ['特休', '病假', '事假', '喪假', '婚假', '產假', '陪產假', '無薪假']

export default function LeaveBalances() {
  const { profile, role } = useAuth()
  const userRole = role?.name || profile?.role || 'store_staff'
  const isStaff = userRole === 'store_staff'
  const currentYear = new Date().getFullYear()
  const [balances, setBalances] = useState([])
  const [employees, setEmployees] = useState([])
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
    employee_id: '',
    year: currentYear,
    leave_type: '特休',
    total_days: '',
    used_days: 0,
    carry_over_days: '',
    expires_at: '',
  })

  const fetchData = async () => {
    try {
      setLoading(true)
      const orgId = profile?.organization_id
      const [balRes, empRes] = await Promise.all([
        supabase
          .from('leave_balances')
          .select('*')
          .eq('year', yearFilter)
          .eq('organization_id', orgId)
          .order('id', { ascending: false }),
        supabase
          .from('employees')
          .select('id, name, dept, store, status')
          .eq('status', '在職')
          .eq('organization_id', orgId)
          .order('name'),
      ])
      if (balRes.error) throw balRes.error
      if (empRes.error) throw empRes.error
      let bals = balRes.data || []
      // store_staff: 只看自己的假別餘額
      if (isStaff && profile?.id) bals = bals.filter(b => b.employee_id === profile.id)
      setBalances(bals)
      setEmployees(empRes.data || [])
    } catch (err) {
      console.error('Failed to load leave balances:', err)
      setError('資料載入失敗，請重新整理頁面')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [yearFilter])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const getEmpName = (empId) => employees.find(e => e.id === empId)?.name || `#${empId}`
  const getEmpDept = (empId) => employees.find(e => e.id === empId)?.dept || ''

  const filtered = balances.filter(b =>
    (typeFilter === '' || b.leave_type === typeFilter) &&
    (search === '' || getEmpName(b.employee_id).includes(search))
  )

  // Summary stats
  const uniqueEmployees = new Set(filtered.map(b => b.employee_id)).size
  const avgUsageRate = filtered.length > 0
    ? Math.round(
        filtered.reduce((sum, b) => {
          const total = Number(b.total_days) + Number(b.carry_over_days || 0)
          return sum + (total > 0 ? (Number(b.used_days) / total) * 100 : 0)
        }, 0) / filtered.length
      )
    : 0

  const getRemainingColor = (remaining, total) => {
    if (total <= 0) return 'var(--text-muted)'
    const ratio = remaining / total
    if (ratio > 0.5) return 'var(--accent-green)'
    if (ratio >= 0.2) return 'var(--accent-orange)'
    return 'var(--accent-red)'
  }

  const openCashout = async () => {
    try {
      setCashoutLoading(true)
      setShowCashoutModal(true)
      // Filter balances for 特休 with remaining days > 0
      const annualBals = balances.filter(b =>
        b.leave_type === '特休' &&
        (Number(b.total_days) + Number(b.carry_over_days || 0) - Number(b.used_days)) > 0
      )
      const uniqueEmpIds = [...new Set(annualBals.map(b => b.employee_id))]
      let empSalaryMap = {}
      if (uniqueEmpIds.length > 0) {
        const { data: empData } = await supabase
          .from('employees')
          .select('id, name, base_salary')
          .in('id', uniqueEmpIds)
        if (empData) {
          empData.forEach(e => { empSalaryMap[e.id] = e })
        }
      }
      const items = annualBals.map(b => {
        const unused = Number(b.total_days) + Number(b.carry_over_days || 0) - Number(b.used_days)
        const emp = empSalaryMap[b.employee_id] || {}
        const baseSalary = Number(emp.base_salary) || 0
        const dailyRate = baseSalary > 0 ? baseSalary / 30 : 0
        const cashoutAmount = Math.round(unused * dailyRate)
        return { bal: b, unused, dailyRate, cashoutAmount, empName: emp.name || getEmpName(b.employee_id) }
      })
      setCashoutItems(items)
    } catch (err) {
      console.error('Failed to prepare cashout:', err)
      toast.error('結算資料載入失敗：' + (err.message || '未知錯誤'))
      setShowCashoutModal(false)
    } finally {
      setCashoutLoading(false)
    }
  }

  const handleCashoutConfirm = async () => {
    if (!cashoutItems.length) return
    try {
      setCashoutSaving(true)
      const today = new Date().toISOString().split('T')[0]
      const currentYear = new Date().getFullYear()
      await Promise.all(
        cashoutItems.map(async ({ bal, unused, cashoutAmount }) => {
          // Create bonus record
          const { error: bonusErr } = await supabase.from('bonus_records').insert({
            employee_id: bal.employee_id,
            category: '特休結清',
            amount: cashoutAmount,
            note: `特休結清 ${currentYear}`,
            date: today,
            organization_id: profile?.organization_id,
          })
          if (bonusErr) throw bonusErr
          // Mark leave balance as fully used
          const newUsed = Number(bal.total_days) + Number(bal.carry_over_days || 0)
          await supabase
            .from('leave_balances')
            .update({ used_days: newUsed })
            .eq('id', bal.id)
        })
      )
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
    setForm({
      employee_id: '',
      year: yearFilter,
      leave_type: '特休',
      total_days: '',
      used_days: 0,
      carry_over_days: '',
      expires_at: '',
    })
    setShowModal(true)
  }

  const openEdit = (b) => {
    setEditingId(b.id)
    setForm({
      employee_id: b.employee_id,
      year: b.year,
      leave_type: b.leave_type,
      total_days: b.total_days,
      used_days: b.used_days,
      carry_over_days: b.carry_over_days || '',
      expires_at: b.expires_at || '',
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    try {
      if (!form.employee_id || !form.total_days) {
        toast.warning('請填寫員工與總天數')
        return
      }
      const payload = {
        employee_id: Number(form.employee_id),
        year: Number(form.year),
        leave_type: form.leave_type,
        total_days: Number(form.total_days),
        used_days: Number(form.used_days) || 0,
        carry_over_days: Number(form.carry_over_days) || 0,
        expires_at: form.expires_at || null,
      }
      if (editingId) {
        const { error } = await supabase
          .from('leave_balances')
          .update(payload)
          .eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('leave_balances')
          .insert(payload)
        if (error) throw error
      }
      setShowModal(false)
      fetchData()
    } catch (err) {
      console.error('Save failed:', err)
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

  // Year options: current year +/- 2
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
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📅 年度</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 100 }} value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏷️ 假別</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 120 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">全部假別</option>
          {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Summary Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">有餘額員工數</div>
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
            <input type="text" placeholder="搜尋員工..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
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
                <th>到期日</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無餘額資料</td></tr>
              )}
              {filtered.map(b => {
                const total = Number(b.total_days) + Number(b.carry_over_days || 0)
                const remaining = total - Number(b.used_days)
                const color = getRemainingColor(remaining, total)
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{getEmpName(b.employee_id)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(b.employee_id)}</td>
                    <td>
                      <span className="badge badge-info"><span className="badge-dot"></span>{b.leave_type}</span>
                    </td>
                    <td>{b.total_days}</td>
                    <td>{b.used_days}</td>
                    <td>{b.carry_over_days || 0}</td>
                    <td>
                      <span style={{ fontWeight: 700, color }}>{remaining}</span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.expires_at || '—'}</td>
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(b)}>
                        <Edit2 size={12} /> 編輯
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
        <Modal
          title="特休結算 — 未休年假結清"
          onClose={() => setShowCashoutModal(false)}
          onSubmit={handleCashoutConfirm}
          submitLabel={cashoutSaving ? '結算中...' : '確認結算'}
          submitDisabled={cashoutSaving || cashoutLoading || cashoutItems.length === 0}
        >
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
                  <thead>
                    <tr>
                      <th>員工</th>
                      <th>未休天數</th>
                      <th>日薪</th>
                      <th>應結清金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashoutItems.map(({ bal, unused, dailyRate, cashoutAmount, empName }) => (
                      <tr key={bal.id}>
                        <td style={{ fontWeight: 600 }}>{empName}</td>
                        <td>
                          <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>{unused} 天</span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                          {dailyRate > 0 ? `NT$ ${Math.round(dailyRate).toLocaleString()}` : '—'}
                        </td>
                        <td>
                          <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>
                            {cashoutAmount > 0 ? `NT$ ${cashoutAmount.toLocaleString()}` : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'var(--accent-orange-dim)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}>
                結算後各員工特休餘額將設為 0，此操作無法復原，請確認後再送出。
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editingId ? '編輯假別餘額' : '新增假別餘額'} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="員工 *">
            <select className="form-input" style={{ width: '100%' }} value={form.employee_id} onChange={e => set('employee_id', e.target.value)} disabled={!!editingId}>
              <option value="">請選擇</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{empLabel(e)}（{e.dept || '無部門'}）</option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="年度 *">
              <select className="form-input" style={{ width: '100%' }} value={form.year} onChange={e => set('year', e.target.value)}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="假別 *">
              <select className="form-input" style={{ width: '100%' }} value={form.leave_type} onChange={e => set('leave_type', e.target.value)}>
                {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="總天數 *">
              <input className="form-input" type="number" min="0" step="0.5" style={{ width: '100%' }} placeholder="例：7" value={form.total_days} onChange={e => set('total_days', e.target.value)} />
            </Field>
            <Field label="遞延天數">
              <input className="form-input" type="number" min="0" step="0.5" style={{ width: '100%' }} placeholder="0" value={form.carry_over_days} onChange={e => set('carry_over_days', e.target.value)} />
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
