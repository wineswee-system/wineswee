import { useState, useEffect, useMemo } from 'react'
import { ArrowRightLeft, Plus, Search, Clock, DollarSign } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { updateEmployee } from '../../lib/db'
import { rotatePrimary } from '../../lib/assignments'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'

import { toast } from '../../lib/toast'
const fmt = (n) => n ? `NT$ ${(+n).toLocaleString()}` : '-'
const todayStr = () => new Date().toISOString().slice(0, 10)

const CHANGE_TYPES = ['調部門', '調店', '職位變更', '薪資調整', '職等調整']

// Derive change-type label by comparing a row against its preceding assignment (ascending order)
function labelChangeType(row, empRowsAsc) {
  const idx = empRowsAsc.findIndex(r => r.id === row.id)
  const prev = empRowsAsc[idx - 1] ?? null   // older record (lower index = earlier)
  if (!prev) return '到職'
  if (row.department_id !== prev.department_id) return '調部門'
  if (row.store_id !== prev.store_id) return '調店'
  if (row.position !== prev.position) return '職位變更'
  if (row.employment_type !== prev.employment_type) return '工時調整'
  if (row.job_grade !== prev.job_grade) return '職等調整'
  return '異動'
}

const BADGE_CLASS = {
  '到職':   'badge-success',
  '調部門': 'badge-info',
  '調店':   'badge-info',
  '職位變更': 'badge-warning',
  '工時調整': 'badge-warning',
  '職等調整': 'badge-warning',
  '異動':   'badge-info',
}

const TRANSFER_EMPTY = {
  employee_id: '',
  change_type: '調部門',
  department_id: '',
  store_id: '',
  position: '',
  job_grade: '',
  effective_date: todayStr(),
  reason: '',
  base_salary: '',
  role_allowance: '',
  meal_allowance: '',
  transport_allowance: '',
}

const SALARY_EMPTY = {
  employee_id: '',
  base_salary: '',
  role_allowance: '',
  meal_allowance: '',
  transport_allowance: '',
  effective_from: todayStr(),
  notes: '',
}

export default function Transfer() {
  const { user, profile } = useAuth()
  const [activeTab, setActiveTab] = useState('transfers')

  // ── Reference data ───────────────────────────────────────────
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])

  // ── Tab 1: Assignment history ────────────────────────────────
  const [assignments, setAssignments] = useState([])
  const [loadingAssign, setLoadingAssign] = useState(true)
  const [assignError, setAssignError] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferForm, setTransferForm] = useState(TRANSFER_EMPTY)
  const [submitting, setSubmitting] = useState(false)

  // ── Tab 2: Salary history ────────────────────────────────────
  const [salaryRecords, setSalaryRecords] = useState([])
  const [loadingSalary, setLoadingSalary] = useState(true)
  const [salaryError, setSalaryError] = useState(null)
  const [showSalaryModal, setShowSalaryModal] = useState(false)
  const [salaryForm, setSalaryForm] = useState(SALARY_EMPTY)
  const [salarySubmitting, setSalarySubmitting] = useState(false)

  // ── Load reference data ──────────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase
        .from('employees')
        .select('id, name, dept, store, department_id, store_id, position, job_grade')
        .eq('status', '在職')
        .eq('organization_id', profile?.organization_id)
        .order('name'),
      supabase.from('departments').select('id, name').eq('organization_id', profile?.organization_id).order('name'),
      supabase.from('stores').select('id, name').eq('organization_id', profile?.organization_id).order('name'),
    ]).then(([e, d, s]) => {
      setEmployees(e.data || [])
      setDepartments(d.data || [])
      setStores(s.data || [])
    }).catch(err => console.error('Failed to load reference data:', err))
  }, [])

  // ── Load assignment records ──────────────────────────────────
  const loadAssignments = () => {
    setLoadingAssign(true)
    setAssignError(null)
    supabase
      .from('employee_assignments')
      .select('*, departments(name), stores(name), employees!employee_id(name, dept, store)')
      .eq('organization_id', profile?.organization_id)
      .order('start_date', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) { setAssignError('異動紀錄載入失敗'); console.error(error) }
        else setAssignments(data || [])
      })
      .finally(() => setLoadingAssign(false))
  }

  // ── Load salary records ──────────────────────────────────────
  const loadSalaryRecords = () => {
    setLoadingSalary(true)
    setSalaryError(null)
    supabase
      .from('salary_structures')
      .select('*, employees!employee_id(name, dept, store, status)')
      .eq('organization_id', profile?.organization_id)
      .order('effective_from', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setSalaryError('薪資調整紀錄載入失敗'); console.error(error) }
        else setSalaryRecords(data || [])
      })
      .finally(() => setLoadingSalary(false))
  }

  useEffect(() => { loadAssignments() }, [])
  useEffect(() => { loadSalaryRecords() }, [])

  // ── Per-employee ascending assignment map ────────────────────
  // assignments state is DESC; we reverse to get ASC per employee
  const assignmentsByEmpAsc = useMemo(() => {
    const map = {}
    ;[...assignments].reverse().forEach(row => {
      const eid = row.employee_id
      if (!map[eid]) map[eid] = []
      map[eid].push(row)
    })
    return map
  }, [assignments])

  // ── Filtered assignments ─────────────────────────────────────
  const filteredAssignments = useMemo(() => {
    return assignments.filter(row => {
      if (searchText) {
        const name = row.employees?.name || ''
        if (!name.includes(searchText)) return false
      }
      if (yearFilter && (row.start_date || '').slice(0, 4) !== yearFilter) return false
      if (typeFilter) {
        const empAsc = assignmentsByEmpAsc[row.employee_id] || []
        if (labelChangeType(row, empAsc) !== typeFilter) return false
      }
      return true
    })
  }, [assignments, searchText, yearFilter, typeFilter, assignmentsByEmpAsc])

  const availableYears = useMemo(() => {
    const s = new Set(assignments.map(r => (r.start_date || '').slice(0, 4)).filter(Boolean))
    return [...s].sort().reverse()
  }, [assignments])

  // ── Transfer form helpers ────────────────────────────────────
  const setTF = (k, v) => setTransferForm(f => ({ ...f, [k]: v }))

  const selectedEmp = useMemo(
    () => employees.find(e => String(e.id) === String(transferForm.employee_id)) ?? null,
    [employees, transferForm.employee_id]
  )

  const handleTransferSubmit = async () => {
    if (!transferForm.employee_id) return toast.warning('請選擇員工')
    if (!transferForm.effective_date) return toast.warning('請填寫生效日')
    if (transferForm.change_type === '薪資調整' && !transferForm.base_salary) return toast.warning('請填寫新基本薪資')
    setSubmitting(true)
    try {
      const empId = Number(transferForm.employee_id)

      if (transferForm.change_type === '薪資調整') {
        const { error } = await supabase.from('salary_structures').insert({
          employee_id: empId,
          base_salary: Number(transferForm.base_salary) || 0,
          role_allowance: Number(transferForm.role_allowance) || 0,
          meal_allowance: Number(transferForm.meal_allowance) || 0,
          transport_allowance: Number(transferForm.transport_allowance) || 0,
          effective_from: transferForm.effective_date,
          salary_type: 'monthly',
          notes: transferForm.reason || '',
          organization_id: profile?.organization_id,
        })
        if (error) throw error
        loadSalaryRecords()
      } else {
        const next = {
          start_date: transferForm.effective_date,
          department_id: transferForm.department_id
            ? Number(transferForm.department_id)
            : (selectedEmp?.department_id ?? null),
          store_id: transferForm.store_id
            ? Number(transferForm.store_id)
            : (selectedEmp?.store_id ?? null),
          position: transferForm.position || selectedEmp?.position || null,
          job_grade: transferForm.job_grade || selectedEmp?.job_grade || null,
        }

        const { error: rotateErr } = await rotatePrimary(empId, next, user?.id ?? null)
        if (rotateErr) throw rotateErr

        const patch = {}
        if (transferForm.department_id) patch.department_id = Number(transferForm.department_id)
        if (transferForm.store_id) patch.store_id = Number(transferForm.store_id)
        if (transferForm.position) patch.position = transferForm.position
        if (transferForm.job_grade) patch.job_grade = transferForm.job_grade
        if (Object.keys(patch).length > 0) {
          const { error: empErr } = await updateEmployee(empId, patch)
          if (empErr) throw empErr
        }

        loadAssignments()
      }

      setShowTransferModal(false)
      setTransferForm(TRANSFER_EMPTY)
    } catch (err) {
      console.error('Transfer submit failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Salary form helpers ──────────────────────────────────────
  const setSF = (k, v) => setSalaryForm(f => ({ ...f, [k]: v }))

  const handleSalarySubmit = async () => {
    if (!salaryForm.employee_id) return toast.warning('請選擇員工')
    if (!salaryForm.base_salary) return toast.warning('請填寫新基本薪資')
    setSalarySubmitting(true)
    try {
      const { error } = await supabase.from('salary_structures').insert({
        employee_id: Number(salaryForm.employee_id),
        base_salary: Number(salaryForm.base_salary) || 0,
        role_allowance: Number(salaryForm.role_allowance) || 0,
        meal_allowance: Number(salaryForm.meal_allowance) || 0,
        transport_allowance: Number(salaryForm.transport_allowance) || 0,
        effective_from: salaryForm.effective_from,
        salary_type: 'monthly',
        notes: salaryForm.notes || '',
        organization_id: profile?.organization_id,
      })
      if (error) throw error
      loadSalaryRecords()
      setShowSalaryModal(false)
      setSalaryForm(SALARY_EMPTY)
    } catch (err) {
      console.error('Salary adjust failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSalarySubmitting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="fade-in">
      {/* Page header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowRightLeft size={20} style={{ color: 'var(--accent-cyan)' }} />
              人事異動
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              員工調部門、調店、職位變更及薪資調整記錄
            </p>
          </div>
          {activeTab === 'transfers' ? (
            <button
              className="btn btn-primary"
              onClick={() => { setTransferForm(TRANSFER_EMPTY); setShowTransferModal(true) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={16} /> 新增異動
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => { setSalaryForm(SALARY_EMPTY); setShowSalaryModal(true) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={16} /> 薪資調整
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 20,
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        {[
          { key: 'transfers', label: '異動紀錄',    icon: <ArrowRightLeft size={14} /> },
          { key: 'salary',    label: '薪資調整紀錄', icon: <DollarSign size={14} /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 20px',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 14,
              fontWeight: activeTab === tab.key ? 700 : 400,
              color: activeTab === tab.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.key
                ? '2px solid var(--accent-cyan)'
                : '2px solid transparent',
              marginBottom: -1,
              transition: 'color 0.15s',
            }}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ══ Tab 1: Transfer / Assignment History ══ */}
      {activeTab === 'transfers' && (
        <>
          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{
                position: 'absolute', left: 10, top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)', pointerEvents: 'none',
              }} />
              <input
                className="form-input"
                placeholder="搜尋員工姓名..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                style={{ paddingLeft: 30, width: 180 }}
              />
            </div>

            <select
              className="form-input"
              value={yearFilter}
              onChange={e => setYearFilter(e.target.value)}
              style={{ width: 110 }}
            >
              <option value="">全部年份</option>
              {availableYears.map(y => <option key={y} value={y}>{y} 年</option>)}
            </select>

            <select
              className="form-input"
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              style={{ width: 130 }}
            >
              <option value="">全部類型</option>
              {['到職', '調部門', '調店', '職位變更', '工時調整', '職等調整', '異動'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            {(searchText || yearFilter || typeFilter) && (
              <button
                onClick={() => { setSearchText(''); setYearFilter(''); setTypeFilter('') }}
                style={{
                  background: 'none', border: '1px solid var(--border-subtle)',
                  borderRadius: 6, padding: '5px 10px',
                  fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer',
                }}
              >
                清除篩選
              </button>
            )}

            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
              共 {filteredAssignments.length} 筆
            </span>
          </div>

          {loadingAssign ? (
            <LoadingSpinner />
          ) : assignError ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--accent-red)' }}>
              <p>{assignError}</p>
              <button className="btn btn-primary" onClick={loadAssignments} style={{ marginTop: 12 }}>重試</button>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>員工姓名</th>
                      <th>異動類型</th>
                      <th>原部門 / 原門市</th>
                      <th>新部門 / 新門市</th>
                      <th>職稱</th>
                      <th>生效日</th>
                      <th>結束日</th>
                      <th>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssignments.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                          {searchText || yearFilter || typeFilter ? '沒有符合條件的記錄' : '尚無異動記錄'}
                        </td>
                      </tr>
                    ) : filteredAssignments.map(row => {
                      const empAsc = assignmentsByEmpAsc[row.employee_id] || []
                      const changeType = labelChangeType(row, empAsc)

                      // Previous row (ascending): the one before this in empAsc
                      const ascIdx = empAsc.findIndex(r => r.id === row.id)
                      const prevRow = ascIdx > 0 ? empAsc[ascIdx - 1] : null

                      const prevDept  = prevRow?.departments?.name || ''
                      const prevStore = prevRow?.stores?.name || ''
                      const fromLabel = [prevDept, prevStore].filter(Boolean).join(' / ') || '—'

                      const newDept  = row.departments?.name || ''
                      const newStore = row.stores?.name || ''
                      const toLabel  = [newDept, newStore].filter(Boolean).join(' / ') || '—'

                      return (
                        <tr key={row.id}>
                          <td style={{ fontWeight: 600 }}>
                            {row.employees?.name || `#${row.employee_id}`}
                          </td>
                          <td>
                            <span className={`badge ${BADGE_CLASS[changeType] ?? 'badge-info'}`}>
                              {changeType}
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                            {changeType === '到職' ? '—' : fromLabel}
                          </td>
                          <td style={{ color: 'var(--accent-cyan)', fontSize: 13 }}>
                            {toLabel}
                          </td>
                          <td>{row.position || '—'}</td>
                          <td>{row.start_date || '—'}</td>
                          <td>{row.end_date || '—'}</td>
                          <td>
                            {row.is_active ? (
                              <span className="badge badge-success">
                                <span className="badge-dot"></span>進行中
                              </span>
                            ) : (
                              <span className="badge">已結束</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ Tab 2: Salary Adjustment History ══ */}
      {activeTab === 'salary' && (
        <>
          {loadingSalary ? (
            <LoadingSpinner />
          ) : salaryError ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--accent-red)' }}>
              <p>{salaryError}</p>
              <button className="btn btn-primary" onClick={loadSalaryRecords} style={{ marginTop: 12 }}>重試</button>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>員工</th>
                      <th>部門 / 門市</th>
                      <th>基本薪資</th>
                      <th>職務津貼</th>
                      <th>餐補</th>
                      <th>交通津貼</th>
                      <th>生效日</th>
                      <th>備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salaryRecords.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                          尚無薪資調整記錄
                        </td>
                      </tr>
                    ) : salaryRecords.map(row => {
                      const emp = row.employees
                      const unit = [emp?.dept, emp?.store].filter(Boolean).join(' / ') || '—'
                      const noteText = row.notes || ''
                      return (
                        <tr key={row.id}>
                          <td style={{ fontWeight: 600 }}>{emp?.name || `#${row.employee_id}`}</td>
                          <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{unit}</td>
                          <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{fmt(row.base_salary)}</td>
                          <td>{fmt(row.role_allowance)}</td>
                          <td>{fmt(row.meal_allowance)}</td>
                          <td>{fmt(row.transport_allowance)}</td>
                          <td>{row.effective_from || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 200 }}>
                            <span title={noteText}>
                              {noteText.length > 40 ? noteText.slice(0, 40) + '…' : (noteText || '—')}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ New Transfer Modal ══ */}
      {showTransferModal && (
        <Modal
          title="新增人事異動"
          onClose={() => setShowTransferModal(false)}
          onSubmit={handleTransferSubmit}
          submitLabel={submitting ? '處理中…' : '確認異動'}
          submitDisabled={submitting}
        >
          <Field label="選擇員工 *">
            <select
              className="form-input"
              value={transferForm.employee_id}
              onChange={e => setTF('employee_id', e.target.value)}
            >
              <option value="">請選擇員工</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}（{e.dept || '-'} / {e.store || '-'}）
                </option>
              ))}
            </select>
          </Field>

          <Field label="異動類型 *">
            <select
              className="form-input"
              value={transferForm.change_type}
              onChange={e => setTF('change_type', e.target.value)}
            >
              {CHANGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          {transferForm.change_type !== '薪資調整' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="新部門">
                  <select
                    className="form-input"
                    value={transferForm.department_id}
                    onChange={e => setTF('department_id', e.target.value)}
                  >
                    <option value="">— 不變更 —</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="新門市">
                  <select
                    className="form-input"
                    value={transferForm.store_id}
                    onChange={e => setTF('store_id', e.target.value)}
                  >
                    <option value="">— 不變更 —</option>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="新職稱">
                  <input
                    className="form-input"
                    type="text"
                    placeholder={selectedEmp?.position || '職稱（選填）'}
                    value={transferForm.position}
                    onChange={e => setTF('position', e.target.value)}
                  />
                </Field>
                <Field label="新職等">
                  <input
                    className="form-input"
                    type="text"
                    placeholder={selectedEmp?.job_grade || '職等（選填）'}
                    value={transferForm.job_grade}
                    onChange={e => setTF('job_grade', e.target.value)}
                  />
                </Field>
              </div>
            </>
          )}

          {transferForm.change_type === '薪資調整' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="新基本薪資 *">
                <input
                  className="form-input"
                  type="number"
                  placeholder="0"
                  value={transferForm.base_salary}
                  onChange={e => setTF('base_salary', e.target.value)}
                />
              </Field>
              <Field label="職務津貼">
                <input
                  className="form-input"
                  type="number"
                  placeholder="0"
                  value={transferForm.role_allowance}
                  onChange={e => setTF('role_allowance', e.target.value)}
                />
              </Field>
              <Field label="餐補">
                <input
                  className="form-input"
                  type="number"
                  placeholder="0"
                  value={transferForm.meal_allowance}
                  onChange={e => setTF('meal_allowance', e.target.value)}
                />
              </Field>
              <Field label="交通津貼">
                <input
                  className="form-input"
                  type="number"
                  placeholder="0"
                  value={transferForm.transport_allowance}
                  onChange={e => setTF('transport_allowance', e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field label="生效日 *">
            <input
              className="form-input"
              type="date"
              value={transferForm.effective_date}
              onChange={e => setTF('effective_date', e.target.value)}
            />
          </Field>

          <Field label="備註">
            <textarea
              className="form-input"
              rows={2}
              placeholder="異動原因或說明..."
              value={transferForm.reason}
              onChange={e => setTF('reason', e.target.value)}
            />
          </Field>
        </Modal>
      )}

      {/* ══ Salary Adjustment Modal ══ */}
      {showSalaryModal && (
        <Modal
          title="薪資調整"
          onClose={() => setShowSalaryModal(false)}
          onSubmit={handleSalarySubmit}
          submitLabel={salarySubmitting ? '處理中…' : '確認調整'}
          submitDisabled={salarySubmitting}
        >
          <Field label="選擇員工 *">
            <select
              className="form-input"
              value={salaryForm.employee_id}
              onChange={e => setSF('employee_id', e.target.value)}
            >
              <option value="">請選擇員工</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}（{e.dept || '-'} / {e.store || '-'}）
                </option>
              ))}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="新基本薪資 *">
              <input
                className="form-input"
                type="number"
                placeholder="0"
                value={salaryForm.base_salary}
                onChange={e => setSF('base_salary', e.target.value)}
              />
            </Field>
            <Field label="職務津貼">
              <input
                className="form-input"
                type="number"
                placeholder="0"
                value={salaryForm.role_allowance}
                onChange={e => setSF('role_allowance', e.target.value)}
              />
            </Field>
            <Field label="餐補">
              <input
                className="form-input"
                type="number"
                placeholder="0"
                value={salaryForm.meal_allowance}
                onChange={e => setSF('meal_allowance', e.target.value)}
              />
            </Field>
            <Field label="交通津貼">
              <input
                className="form-input"
                type="number"
                placeholder="0"
                value={salaryForm.transport_allowance}
                onChange={e => setSF('transport_allowance', e.target.value)}
              />
            </Field>
          </div>

          <Field label="生效日 *">
            <input
              className="form-input"
              type="date"
              value={salaryForm.effective_from}
              onChange={e => setSF('effective_from', e.target.value)}
            />
          </Field>

          <Field label="備註">
            <textarea
              className="form-input"
              rows={2}
              placeholder="調薪原因或說明..."
              value={salaryForm.notes}
              onChange={e => setSF('notes', e.target.value)}
            />
          </Field>
        </Modal>
      )}
    </div>
  )
}
