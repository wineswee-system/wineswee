import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { getChecklists, createChecklist } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const CATEGORIES = ['HR', '財務', '業務', '行政', '研發', '客服', '安全']

export default function Checklists() {
  const [checklists, setChecklists] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', category: CATEGORIES[0], assignee: '', items: '', completed: '0' })

  useEffect(() => {
    Promise.all([
      getChecklists(),
      supabase.from('employees').select('id, name, dept, position').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
    ]).then(([c, e, d]) => {
      setChecklists(c.data || [])
      setEmployees(e.data || [])
      setDepartments(d.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name || !form.items) return
    const { data } = await createChecklist({
      name: form.name,
      category: form.category,
      assignee: form.assignee,
      items: Number(form.items),
      completed: 0,
    })
    if (data) {
      setChecklists(prev => [...prev, data])
      setShowModal(false)
      setForm({ name: '', category: CATEGORIES[0], assignee: '', items: '', completed: '0' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''

  const filtered = checklists.filter(c =>
    deptFilter === '' || getEmpDept(c.assignee) === deptFilter
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
            <h2><span className="header-icon">☑️</span> 查核清單</h2>
            <p>作業查核項目管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增清單</button>
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
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成清單</div>
          <div className="stat-card-value">{filtered.filter(c => c.items > 0 && c.completed === c.items).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">進行中清單</div>
          <div className="stat-card-value">{filtered.filter(c => c.completed > 0 && c.completed < c.items).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">未開始清單</div>
          <div className="stat-card-value">{filtered.filter(c => c.completed === 0).length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 查核清單</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>清單名稱</th><th>分類</th><th>負責人</th><th>部門</th><th>完成進度</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無查核清單</td></tr>}
              {filtered.map(c => {
                const pct = c.items > 0 ? Math.round(c.completed / c.items * 100) : 0
                const status = c.completed === c.items && c.items > 0 ? '已完成' : c.completed === 0 ? '未開始' : '進行中'
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td><span className="badge badge-cyan">{c.category}</span></td>
                    <td style={{ fontWeight: 600 }}>{c.assignee}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(c.assignee) || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="progress-track" style={{ flex: 1, height: 6 }}>
                          <div className="progress-fill" style={{
                            width: `${pct}%`,
                            background: pct === 100 ? 'var(--accent-green)' : pct > 50 ? 'var(--accent-cyan)' : 'var(--accent-orange)'
                          }}></div>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {c.completed}/{c.items}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${status === '已完成' ? 'badge-success' : status === '進行中' ? 'badge-info' : 'badge-warning'}`}>
                        <span className="badge-dot"></span>{status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增查核清單" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="清單名稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：新進員工入職清單" value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="負責人">
              <select className="form-input" style={{ width: '100%' }} value={form.assignee} onChange={e => set('assignee', e.target.value)}>
                <option value="">請選擇負責人</option>
                {departments.map(d => (
                  <optgroup key={d.id} label={d.name}>
                    {employees.filter(e => e.dept === d.name).map(e => (
                      <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          </div>
          <Field label="查核項目數 *">
            <input className="form-input" type="number" style={{ width: '100%' }} placeholder="例：10" min="1" value={form.items} onChange={e => set('items', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
