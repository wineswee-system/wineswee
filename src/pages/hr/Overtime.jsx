import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { getOvertimeRequests, createOvertimeRequest, updateOvertimeStatus } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Overtime() {
  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ employee: '', date: '', hours: 1, reason: '' })
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      getOvertimeRequests(),
      supabase.from('employees').select('id, name, dept, position').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([r, e, d]) => {
      const emps = e.data || []
      setRecords(r.data || [])
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
    try {
      if (!form.date || !form.employee) return
      const { data, error } = await createOvertimeRequest({ ...form, status: '待審核' })
      if (error) throw error
      if (data) {
        setRecords(prev => [...prev, data])
        setShowModal(false)
        setForm({ employee: employees[0]?.name || '', date: '', hours: 1, reason: '' })
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleApprove = async (id) => {
    try {
      const { data, error } = await updateOvertimeStatus(id, '已核准')
      if (error) throw error
      if (data) setRecords(prev => prev.map(r => r.id === id ? data : r))
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleReject = async (id) => {
    const reason = prompt('請輸入駁回原因：')
    if (reason === null) return
    if (!reason.trim()) { alert('請填寫駁回原因'); return }
    try {
      const { data, error } = await updateOvertimeStatus(id, '已拒絕', reason.trim())
      if (error) throw error
      if (data) setRecords(prev => prev.map(r => r.id === id ? data : r))
    } catch (err) {
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''

  const filtered = records.filter(r =>
    deptFilter === '' || getEmpDept(r.employee) === deptFilter
  )

  const deptBtnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  const totalHours = filtered.filter(r => r.status === '已核准').reduce((s, r) => s + (r.hours || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🕐</span> 加班申請</h2>
            <p>加班時數申請與審核</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增加班</button>
        </div>
      </div>

      {/* 部門篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={deptBtnStyle(deptFilter === '')} onClick={() => setDeptFilter('')}>全部部門</button>
        {departments.map(d => (
          <button key={d.id} style={deptBtnStyle(deptFilter === d.name)} onClick={() => setDeptFilter(d.name)}>{d.name}</button>
        ))}
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
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>員工</th><th>部門</th><th>日期</th><th>時數</th><th>原因</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無加班紀錄</td></tr>}
              {filtered.map(o => (
                <tr key={o.id}>
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
                  <td>
                    {o.status === '待審核' && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => handleApprove(o.id)}>核准</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleReject(o.id)}>駁回</button>
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
        <Modal title="新增加班申請" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="員工 *">
            <select className="form-input" style={{ width: '100%' }} value={form.employee} onChange={e => set('employee', e.target.value)}>
              <option value="">請選擇員工</option>
              {departments.map(d => (
                <optgroup key={d.id} label={d.name}>
                  {employees.filter(e => e.dept === d.name).map(e => (
                    <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="加班日期">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => set('date', e.target.value)} />
          </Field>
          <Field label="加班時數">
            <input className="form-input" type="number" min="0.5" step="0.5" style={{ width: '100%' }} value={form.hours} onChange={e => set('hours', Number(e.target.value))} />
          </Field>
          <Field label="原因">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="請輸入加班原因" value={form.reason} onChange={e => set('reason', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
