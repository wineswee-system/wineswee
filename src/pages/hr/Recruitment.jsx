import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { getRecruitmentJobs, createRecruitmentJob, updateRecruitmentJob } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Recruitment() {
  const [jobs, setJobs] = useState([])
  const [departments, setDepartments] = useState([])
  const [locations, setLocations] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ title: '', dept: '', location: '', type: '全職' })
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      getRecruitmentJobs(),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
    ]).then(([j, d, l]) => {
      const depts = d.data || []
      const locs = l.data || []
      setJobs(j.data || [])
      setDepartments(depts)
      setLocations(locs)
      setForm(f => ({ ...f, dept: depts[0]?.name || '', location: locs[0]?.name || '' }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.title) return
    const { data } = await createRecruitmentJob({ ...form, applicants: 0, status: '招募中' })
    if (data) {
      setJobs(prev => [...prev, data])
      setShowModal(false)
      setForm({ title: '', dept: departments[0]?.name || '', location: locations[0]?.name || '', type: '全職' })
    }
  }

  const handleClose = async (id) => {
    const { data } = await updateRecruitmentJob(id, { status: '已關閉' })
    if (data) setJobs(prev => prev.map(j => j.id === id ? data : j))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = jobs.filter(j => deptFilter === '' || j.dept === deptFilter)


  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔍</span> 招募管理</h2>
            <p>職缺管理與應徵者追蹤</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增職缺</button>
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
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">招募中職缺</div>
          <div className="stat-card-value">{filtered.filter(j => j.status === '招募中').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">總應徵者</div>
          <div className="stat-card-value">{filtered.reduce((s, j) => s + (j.applicants || 0), 0)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已關閉</div>
          <div className="stat-card-value">{filtered.filter(j => j.status === '已關閉').length}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>職稱</th><th>部門</th><th>地點</th><th>類型</th><th>應徵人數</th><th>刊登日</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無職缺</td></tr>}
              {filtered.map(j => (
                <tr key={j.id}>
                  <td style={{ fontWeight: 600 }}>{j.title}</td>
                  <td>{j.dept}</td>
                  <td>{j.location}</td>
                  <td><span className={`badge ${j.type === '全職' ? 'badge-info' : 'badge-purple'}`}>{j.type}</span></td>
                  <td style={{ fontWeight: 600 }}>{j.applicants}</td>
                  <td>{j.posted}</td>
                  <td>
                    <span className={`badge ${j.status === '招募中' ? 'badge-success' : 'badge-neutral'}`}>
                      <span className="badge-dot"></span>{j.status}
                    </span>
                  </td>
                  <td>
                    {j.status === '招募中' && (
                      <button className="btn btn-sm btn-secondary" onClick={() => handleClose(j.id)}>關閉</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增職缺" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="職稱 *">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：資深前端工程師" value={form.title} onChange={e => set('title', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門">
              <select className="form-input" style={{ width: '100%' }} value={form.dept} onChange={e => set('dept', e.target.value)}>
                <option value="">請選擇部門</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="地點">
              <select className="form-input" style={{ width: '100%' }} value={form.location} onChange={e => set('location', e.target.value)}>
                <option value="">請選擇地點</option>
                {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="類型">
            <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
              <option>全職</option>
              <option>兼職</option>
              <option>約聘</option>
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
