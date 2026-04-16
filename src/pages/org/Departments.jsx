import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { getDepartments, createDepartment, updateDepartment, deleteDepartment, getEmployees } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const LEVELS = [
  { value: '董事長', label: '董事長室' },
  { value: '部', label: '部' },
  { value: '組', label: '組' },
  { value: '課', label: '課' },
]

export default function Departments() {
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingDept, setEditingDept] = useState(null)
  const [form, setForm] = useState({ name: '', manager_id: '', description: '', level: '部', parent_department_id: '' })

  useEffect(() => {
    Promise.all([getDepartments(), getEmployees()]).then(([d, e]) => {
      setDepartments(d.data || [])
      setEmployees(e.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditingDept(null)
    setForm({ name: '', manager_id: '', description: '', level: '部', parent_department_id: '' })
    setShowModal(true)
  }

  const openEdit = (d) => {
    setEditingDept(d)
    setForm({
      name: d.name || '',
      manager_id: d.manager_id || '',
      description: d.description || '',
      level: d.level || '部',
      parent_department_id: d.parent_department_id || '',
    })
    setShowModal(true)
  }

  const handleDelete = async (d) => {
    if (!confirm(`確定要刪除「${d.name}」嗎？`)) return
    try {
      await deleteDepartment(d.id)
      setDepartments(prev => prev.filter(x => x.id !== d.id))
    } catch (err) {
      alert('刪除失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleSubmit = async () => {
    if (!form.name) return
    const payload = {
      name: form.name,
      manager_id: form.manager_id ? parseInt(form.manager_id) : null,
      description: form.description,
      level: form.level,
      parent_department_id: form.parent_department_id ? parseInt(form.parent_department_id) : null,
    }
    try {
      if (editingDept) {
        const { data, error } = await updateDepartment(editingDept.id, payload)
        if (error) throw error
        if (data) setDepartments(prev => prev.map(d => d.id === data.id ? data : d))
      } else {
        const { data, error } = await createDepartment(payload)
        if (error) throw error
        if (data) setDepartments(prev => [...prev, data])
      }
      setShowModal(false)
      setEditingDept(null)
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const deptCount = (dept) => employees.filter(e => (e.department_id === dept.id || e.dept === dept.name) && e.status === '在職').length
  const totalMembers = departments.reduce((s, d) => s + deptCount(d.name), 0)

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🗂️</span> 部門</h2>
            <p>公司部門設定與管理</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={14} /> 新增部門</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">部門數</div>
          <div className="stat-card-value">{departments.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總人數</div>
          <div className="stat-card-value">{totalMembers}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">平均人數</div>
          <div className="stat-card-value">
            {departments.length ? Math.round(totalMembers / departments.length) : 0}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>部門名稱</th><th>層級</th><th>上級部門</th><th>部門主管</th><th>人數</th><th>描述</th><th>操作</th></tr>
            </thead>
            <tbody>
              {departments.map(d => {
                const manager = employees.find(e => e.id === d.manager_id)
                const parent = departments.find(p => p.id === d.parent_department_id)
                return (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.name}</td>
                  <td><span className="badge badge-cyan">{d.level || '部'}</span></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{parent?.name || '-'}</td>
                  <td>{manager?.name || d.head || '-'}</td>
                  <td>{deptCount(d)}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{d.description}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(d)}><Pencil size={12} /></button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(d)} style={{ color: 'var(--accent-red)' }}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editingDept ? `編輯部門 — ${editingDept.name}` : '新增部門'} onClose={() => { setShowModal(false); setEditingDept(null) }} onSubmit={handleSubmit} submitLabel={editingDept ? '儲存變更' : '新增'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：研發部" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="層級">
              <select className="form-input" style={{ width: '100%' }} value={form.level} onChange={e => set('level', e.target.value)}>
                {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="上級部門">
              <select className="form-input" style={{ width: '100%' }} value={form.parent_department_id} onChange={e => set('parent_department_id', e.target.value)}>
                <option value="">無（頂層部門）</option>
                {departments.filter(d => d.id !== editingDept?.id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="部門主管">
              <select className="form-input" style={{ width: '100%' }} value={form.manager_id} onChange={e => set('manager_id', e.target.value)}>
                <option value="">請選擇</option>
                {employees.filter(e => e.status === '在職').map(e => <option key={e.id} value={e.id}>{e.name}{e.position ? ` (${e.position})` : ''}</option>)}
              </select>
            </Field>
          </div>
          <Field label="部門描述">
            <textarea className="form-input" style={{ width: '100%', height: 80, resize: 'vertical' }} placeholder="部門職責說明" value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
