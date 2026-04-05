import { useState, useEffect } from 'react'
import { Plus, Search, UserMinus, UserPlus, Pencil } from 'lucide-react'
import { getEmployees, createEmployee, updateEmployee } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import MaskedText from '../../components/MaskedText'
import Modal, { Field } from '../../components/Modal'

const AVATARS = ['#3b82f6', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#22d3ee', '#f87171', '#fbbf24']

export default function Employees() {
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('在職')
  const [showModal, setShowModal] = useState(false)
  const [showResignModal, setShowResignModal] = useState(false)
  const [showRehireModal, setShowRehireModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [resignDate, setResignDate] = useState('')
  const [resignReason, setResignReason] = useState('')
  const [editForm, setEditForm] = useState({})
  const [form, setForm] = useState({ name: '', name_en: '', dept: '', position: '', store: '', email: '', phone: '', join_date: '', status: '在職' })

  useEffect(() => {
    Promise.all([
      getEmployees(),
      supabase.from('departments').select('*').order('name'),
      supabase.from('locations').select('*').order('name'),
    ]).then(([e, d, l]) => {
      const depts = d.data || []
      const locs = l.data || []
      setEmployees(e.data || [])
      setDepartments(depts)
      setLocations(locs)
      setForm(f => ({ ...f, dept: depts[0]?.name || '', store: locs[0]?.name || '' }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // 新增員工
  const handleSubmit = async () => {
    if (!form.name || !form.email) return
    try {
      const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)]
      const { data, error } = await createEmployee({ ...form, avatar })
      if (error) throw error
      if (data) {
        setEmployees(prev => [...prev, data])
        setShowModal(false)
        setForm({ name: '', name_en: '', dept: departments[0]?.name || '', position: '', store: locations[0]?.name || '', email: '', phone: '', join_date: '', status: '在職' })
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // 離職
  const openResign = (emp) => {
    setSelectedEmp(emp)
    setResignDate(new Date().toISOString().slice(0, 10))
    setResignReason('')
    setShowResignModal(true)
  }
  const handleResign = async () => {
    if (!selectedEmp) return
    try {
      const { data, error } = await updateEmployee(selectedEmp.id, {
        status: '離職',
        resign_date: resignDate,
        resign_reason: resignReason,
      })
      if (error) throw error
      if (data) {
        setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? data : e))
        setShowResignModal(false)
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // 編輯
  const openEdit = (emp) => {
    setSelectedEmp(emp)
    setEditForm({
      name: emp.name || '', name_en: emp.name_en || '',
      dept: emp.dept || '', position: emp.position || '',
      store: emp.store || '', email: emp.email || '',
      phone: emp.phone || '', join_date: emp.join_date || '',
    })
    setShowEditModal(true)
  }
  const setE = (k, v) => setEditForm(f => ({ ...f, [k]: v }))
  const handleEdit = async () => {
    if (!selectedEmp) return
    try {
      const { data, error } = await updateEmployee(selectedEmp.id, editForm)
      if (error) throw error
      if (data) {
        setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? data : e))
        setShowEditModal(false)
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // 復職
  const openRehire = (emp) => { setSelectedEmp(emp); setShowRehireModal(true) }
  const handleRehire = async () => {
    if (!selectedEmp) return
    try {
      const { data, error } = await updateEmployee(selectedEmp.id, {
        status: '在職',
        resign_date: null,
        resign_reason: null,
      })
      if (error) throw error
      if (data) {
        setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? data : e))
        setShowRehireModal(false)
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = employees.filter(e =>
    (statusFilter === '' || e.status === statusFilter) &&
    (storeFilter === '' || e.store === storeFilter) &&
    (deptFilter === '' || e.dept === deptFilter) &&
    (search === '' || e.name?.includes(search) || e.name_en?.toLowerCase().includes(search.toLowerCase()) || e.email?.includes(search))
  )

  const btnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👤</span> 員工</h2>
            <p>員工基本資料管理（到職 / 離職）</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增員工（到職）</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">在職</div>
          <div className="stat-card-value">{employees.filter(e => e.status === '在職').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">離職</div>
          <div className="stat-card-value">{employees.filter(e => e.status === '離職').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總計</div>
          <div className="stat-card-value">{employees.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">篩選結果</div>
          <div className="stat-card-value">{filtered.length}</div>
        </div>
      </div>

      {/* 狀態篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: '28px', marginRight: 4 }}>狀態</span>
        <button style={btnStyle(statusFilter === '')} onClick={() => setStatusFilter('')}>全部</button>
        <button style={btnStyle(statusFilter === '在職')} onClick={() => setStatusFilter('在職')}>在職</button>
        <button style={btnStyle(statusFilter === '離職')} onClick={() => setStatusFilter('離職')}>離職</button>
      </div>

      {/* 門市篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: '28px', marginRight: 4 }}>門市</span>
        <button style={btnStyle(storeFilter === '')} onClick={() => setStoreFilter('')}>全部門市</button>
        {locations.map(l => (
          <button key={l.id} style={btnStyle(storeFilter === l.name)} onClick={() => setStoreFilter(l.name)}>{l.name}</button>
        ))}
      </div>

      {/* 部門篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: '28px', marginRight: 4 }}>部門</span>
        <button style={btnStyle(deptFilter === '')} onClick={() => setDeptFilter('')}>全部部門</button>
        {departments.map(d => (
          <button key={d.id} style={btnStyle(deptFilter === d.name)} onClick={() => setDeptFilter(d.name)}>{d.name}</button>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 員工列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋姓名、Email..." className="form-input" style={{ paddingLeft: 38 }}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>姓名</th><th>部門</th><th>職稱</th><th>門市</th><th>Email</th><th>手機</th><th>到職日</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無符合條件的員工</td></tr>}
              {filtered.map(e => (
                <tr key={e.id} style={{ opacity: e.status === '離職' ? 0.55 : 1 }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: e.avatar, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {e.name?.[0]}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{e.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.name_en}</div>
                      </div>
                    </div>
                  </td>
                  <td>{e.dept}</td>
                  <td>{e.position}</td>
                  <td>{e.store}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}><MaskedText value={e.email} type="email" canReveal={true} /></td>
                  <td style={{ fontSize: 12 }}><MaskedText value={e.phone} type="phone" canReveal={true} /></td>
                  <td style={{ fontSize: 12 }}>
                    {e.join_date}
                    {e.resign_date && (
                      <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>離職：{e.resign_date}</div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${e.status === '在職' ? 'badge-success' : 'badge-danger'}`}>
                      <span className="badge-dot"></span>{e.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 10px', fontSize: 11 }}
                        onClick={() => openEdit(e)}>
                        <Pencil size={12} /> 編輯
                      </button>
                      {e.status === '在職' ? (
                        <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 10px', fontSize: 11, color: 'var(--accent-red)' }}
                          onClick={() => openResign(e)}>
                          <UserMinus size={12} /> 離職
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 10px', fontSize: 11, color: 'var(--accent-green)' }}
                          onClick={() => openRehire(e)}>
                          <UserPlus size={12} /> 復職
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增員工 Modal */}
      {showModal && (
        <Modal title="新增員工（到職）" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="姓名 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="王小明" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="英文姓名">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="Xiaoming Wang" value={form.name_en} onChange={e => set('name_en', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門">
              <select className="form-input" style={{ width: '100%' }} value={form.dept} onChange={e => set('dept', e.target.value)}>
                <option value="">請選擇</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="職稱">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="工程師" value={form.position} onChange={e => set('position', e.target.value)} />
            </Field>
          </div>
          <Field label="門市 / 分店">
            <select className="form-input" style={{ width: '100%' }} value={form.store} onChange={e => set('store', e.target.value)}>
              <option value="">請選擇</option>
              {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Email *">
            <input className="form-input" type="email" style={{ width: '100%' }} placeholder="example@company.com" value={form.email} onChange={e => set('email', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="手機">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="0912-345-678" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
            <Field label="到職日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.join_date} onChange={e => set('join_date', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}

      {/* 離職 Modal */}
      {showResignModal && selectedEmp && (
        <Modal title={`員工離職 — ${selectedEmp.name}`} onClose={() => setShowResignModal(false)} onSubmit={handleResign} submitText="確認離職">
          <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--accent-red-dim)', border: '1px solid var(--accent-red)', fontSize: 13, color: 'var(--accent-red)', marginBottom: 12 }}>
            將 <b>{selectedEmp.name}</b>（{selectedEmp.dept} · {selectedEmp.position}）設為離職狀態
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="離職日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={resignDate} onChange={e => setResignDate(e.target.value)} />
            </Field>
            <Field label="到職日">
              <input className="form-input" type="text" style={{ width: '100%' }} value={selectedEmp.join_date || '-'} readOnly />
            </Field>
          </div>
          <Field label="離職原因">
            <textarea className="form-input" style={{ width: '100%', height: 80, resize: 'vertical' }} placeholder="自願離職 / 合約到期 / 資遣 / 退休..."
              value={resignReason} onChange={e => setResignReason(e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* 復職 Modal */}
      {showRehireModal && selectedEmp && (
        <Modal title={`員工復職 — ${selectedEmp.name}`} onClose={() => setShowRehireModal(false)} onSubmit={handleRehire} submitText="確認復職">
          <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', fontSize: 13, color: 'var(--accent-green)' }}>
            將 <b>{selectedEmp.name}</b> 恢復為在職狀態
          </div>
          {selectedEmp.resign_date && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
              離職日期：{selectedEmp.resign_date}<br />
              離職原因：{selectedEmp.resign_reason || '-'}
            </div>
          )}
        </Modal>
      )}
      {/* 編輯員工 Modal */}
      {showEditModal && selectedEmp && (
        <Modal title={`編輯員工 — ${selectedEmp.name}`} onClose={() => setShowEditModal(false)} onSubmit={handleEdit} submitText="儲存變更">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="姓名">
              <input className="form-input" type="text" style={{ width: '100%' }} value={editForm.name} onChange={e => setE('name', e.target.value)} />
            </Field>
            <Field label="英文姓名">
              <input className="form-input" type="text" style={{ width: '100%' }} value={editForm.name_en} onChange={e => setE('name_en', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門">
              <select className="form-input" style={{ width: '100%' }} value={editForm.dept} onChange={e => setE('dept', e.target.value)}>
                <option value="">請選擇</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="職稱">
              <input className="form-input" type="text" style={{ width: '100%' }} value={editForm.position} onChange={e => setE('position', e.target.value)} />
            </Field>
          </div>
          <Field label="門市 / 分店">
            <select className="form-input" style={{ width: '100%' }} value={editForm.store} onChange={e => setE('store', e.target.value)}>
              <option value="">請選擇</option>
              {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Email">
            <input className="form-input" type="email" style={{ width: '100%' }} value={editForm.email} onChange={e => setE('email', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="手機">
              <input className="form-input" type="text" style={{ width: '100%' }} value={editForm.phone} onChange={e => setE('phone', e.target.value)} />
            </Field>
            <Field label="到職日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={editForm.join_date} onChange={e => setE('join_date', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
