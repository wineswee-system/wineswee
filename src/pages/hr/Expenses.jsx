import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { getExpenses, createExpense, updateExpenseStatus } from '../../lib/db'
import { createApprovalWorkflow } from '../../lib/workflowIntegration'
import { supabase } from '../../lib/supabase'
import { getEventBus } from '../../lib/events/index.js'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { empLabel } from '../../lib/empLabel'

const CATEGORIES = ['交通', '住宿', '餐飲', '設備', '其他']

export default function Expenses() {
  const { profile } = useAuth()
  const [expenses, setExpenses] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ employee: '', category: CATEGORIES[0], amount: '', date: '', description: '', receipt: true })

  useEffect(() => {
    Promise.all([
      getExpenses(),
      supabase.from('employees').select('id, name, dept, department_id, position, departments!department_id(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([ex, e, d]) => {
      const emps = e.data || []
      setExpenses(ex.data || [])
      setEmployees(emps)
      setDepartments(d.data || [])
      setForm(f => ({ ...f, employee: emps[0]?.name || '' }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.amount || !form.date || !form.employee) return
    const { data } = await createExpense({ ...form, amount: Number(form.amount), status: '待審核' })
    if (data) {
      setExpenses(prev => [...prev, data])
      setShowModal(false)
      setForm({ employee: profile?.name || employees[0]?.name || '', category: CATEGORIES[0], amount: '', date: '', description: '', receipt: true })
      await createApprovalWorkflow('expense', data, form.employee)
    }
  }

  const handleApprove = async (id) => {
    const { data } = await updateExpenseStatus(id, '已核銷')
    if (data) {
      setExpenses(prev => prev.map(e => e.id === id ? data : e))
      getEventBus().publish('hr.expense.approved', {
        expense_id: data.id,
        employee: data.employee,
        category: data.category,
        amount: data.amount,
        description: data.description,
        date: data.date,
      }, { source: 'Expenses.jsx' })
      alert('已核銷並發送費用核准事件')
    }
  }

  const handleReject = async (id) => {
    const reason = prompt('請輸入駁回原因：')
    if (reason === null) return
    if (!reason.trim()) { alert('請填寫駁回原因'); return }
    const { data } = await updateExpenseStatus(id, '已駁回', reason.trim())
    if (data) setExpenses(prev => prev.map(e => e.id === id ? data : e))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''

  const filtered = expenses.filter(e =>
    deptFilter === '' || getEmpDept(e.employee) === deptFilter
  )


  const totalPending = filtered.filter(e => e.status === '待審核').reduce((s, e) => s + Number(e.amount), 0)
  const totalApproved = filtered.filter(e => e.status === '已核銷').reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🧾</span> 費用核銷</h2>
            <p>報銷申請與審核</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增報銷</button>
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
          <div className="stat-card-value">{filtered.filter(e => e.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核銷金額</div>
          <div className="stat-card-value">NT$ {totalApproved.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">待核銷金額</div>
          <div className="stat-card-value">NT$ {totalPending.toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>員工</th><th>部門</th><th>類別</th><th>金額</th><th>日期</th><th>說明</th><th>收據</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無報銷申請</td></tr>}
              {filtered.map(e => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>{e.employee}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(e.employee) || '-'}</td>
                  <td><span className="badge badge-info">{e.category}</span></td>
                  <td style={{ fontWeight: 600 }}>NT$ {Number(e.amount).toLocaleString()}</td>
                  <td>{e.date}</td>
                  <td>{e.description}</td>
                  <td>{e.receipt ? <span className="badge badge-success">✓ 有</span> : <span className="badge badge-danger">✗ 無</span>}</td>
                  <td>
                    <span className={`badge ${e.status === '已核銷' ? 'badge-success' : e.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{e.status}
                    </span>
                    {e.reject_reason && (
                      <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>原因：{e.reject_reason}</div>
                    )}
                  </td>
                  <td>
                    {e.status === '待審核' && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => handleApprove(e.id)}>核銷</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleReject(e.id)}>駁回</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增報銷申請" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="員工 *">
            <select className="form-input" style={{ width: '100%' }} value={form.employee} onChange={e => set('employee', e.target.value)}>
              <option value="">請選擇員工</option>
              {departments.map(d => (
                <optgroup key={d.id} label={d.name}>
                  {employees.filter(e => e.dept === d.name).map(e => (
                    <option key={e.id} value={e.name}>{empLabel(e)}｜{e.position}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="類別">
              <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="金額 (NT$)">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.amount} onChange={e => set('amount', e.target.value)} />
            </Field>
          </div>
          <Field label="日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => set('date', e.target.value)} />
          </Field>
          <Field label="說明">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="費用說明" value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
          <Field label="收據">
            <select className="form-input" style={{ width: '100%' }} value={form.receipt} onChange={e => set('receipt', e.target.value === 'true')}>
              <option value="true">有收據</option>
              <option value="false">無收據</option>
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
