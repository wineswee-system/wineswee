import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { getBusinessTrips, createBusinessTrip, updateBusinessTripStatus } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function BusinessTravel() {
  const [trips, setTrips] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ employee: '', destination: '', start_date: '', end_date: '', purpose: '', budget: '' })

  useEffect(() => {
    Promise.all([
      getBusinessTrips(),
      supabase.from('employees').select('id, name, department, position').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([t, e, d]) => {
      const emps = e.data || []
      setTrips(t.data || [])
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
    if (!form.destination || !form.start_date || !form.employee) return
    const { data } = await createBusinessTrip({ ...form, budget: Number(form.budget) || 0, status: '待審核' })
    if (data) {
      setTrips(prev => [...prev, data])
      setShowModal(false)
      setForm({ employee: employees[0]?.name || '', destination: '', start_date: '', end_date: '', purpose: '', budget: '' })
    }
  }

  const handleApprove = async (id) => {
    const { data } = await updateBusinessTripStatus(id, '已核准')
    if (data) setTrips(prev => prev.map(t => t.id === id ? data : t))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.department || ''

  const filtered = trips.filter(t =>
    deptFilter === '' || getEmpDept(t.employee) === deptFilter
  )

  const deptBtnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">✈️</span> 公出差旅</h2>
            <p>出差申請與核准管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增差旅</button>
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
          <div className="stat-card-value">{filtered.filter(t => t.status === '待審核').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已核准</div>
          <div className="stat-card-value">{filtered.filter(t => t.status === '已核准').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">預算合計</div>
          <div className="stat-card-value">NT$ {filtered.reduce((s, t) => s + Number(t.budget || 0), 0).toLocaleString()}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>員工</th><th>部門</th><th>目的地</th><th>出發日</th><th>回程日</th><th>事由</th><th>預算</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無差旅紀錄</td></tr>}
              {filtered.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.employee}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(t.employee) || '-'}</td>
                  <td>{t.destination}</td>
                  <td>{t.start_date}</td>
                  <td>{t.end_date}</td>
                  <td>{t.purpose}</td>
                  <td>NT$ {Number(t.budget).toLocaleString()}</td>
                  <td>
                    <span className={`badge ${t.status === '已核准' ? 'badge-success' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{t.status}
                    </span>
                  </td>
                  <td>
                    {t.status === '待審核' && (
                      <button className="btn btn-sm btn-primary" onClick={() => handleApprove(t.id)}>核准</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增差旅申請" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="員工 *">
            <select className="form-input" style={{ width: '100%' }} value={form.employee} onChange={e => set('employee', e.target.value)}>
              <option value="">請選擇員工</option>
              {departments.map(d => (
                <optgroup key={d.id} label={d.name}>
                  {employees.filter(e => e.department === d.name).map(e => (
                    <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="目的地">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：東京" value={form.destination} onChange={e => set('destination', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="出發日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>
            <Field label="回程日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </Field>
          </div>
          <Field label="事由">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：客戶拜訪" value={form.purpose} onChange={e => set('purpose', e.target.value)} />
          </Field>
          <Field label="預算 (NT$)">
            <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.budget} onChange={e => set('budget', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
