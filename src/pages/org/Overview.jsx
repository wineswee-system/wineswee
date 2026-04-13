import { useState, useEffect } from 'react'
import { Building, MapPin, Users, ClipboardList } from 'lucide-react'
import { getCompanies, getStores, getDepartments, getEmployees } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function OrgOverview() {
  const [companies, setCompanies] = useState([])
  const [stores, setStores] = useState([])
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([getCompanies(), getStores(), getDepartments(), getEmployees()]).then(([c, s, d, e]) => {
      setCompanies(c.data || [])
      setStores(s.data || [])
      setDepartments(d.data || [])
      setEmployees(e.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const deptCount = (deptName) => employees.filter(e => e.dept === deptName && e.status === '在職').length
  const maxCount = Math.max(...departments.map(d => deptCount(d.name)), 1)

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">🏢</span> 組織總覽</h2>
        <p>公司、門市、部門與員工概覽</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-icon"><Building size={16} /></div>
          <div className="stat-card-label">公司數</div>
          <div className="stat-card-value">{companies.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-icon"><MapPin size={16} /></div>
          <div className="stat-card-label">門市數</div>
          <div className="stat-card-value">{stores.filter(s => s.status === '營運中').length} / {stores.length}</div>
          <div className="stat-card-sub">營運中 / 總計</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-icon"><ClipboardList size={16} /></div>
          <div className="stat-card-label">部門數</div>
          <div className="stat-card-value">{departments.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-icon"><Users size={16} /></div>
          <div className="stat-card-label">在職人數</div>
          <div className="stat-card-value">{employees.filter(e => e.status === '在職').length}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🏪</span> 門市狀態</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>門市</th><th>負責人</th><th>員工數</th><th>狀態</th></tr></thead>
              <tbody>
                {stores.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                    <td>{s.manager}</td>
                    <td>{employees.filter(e => e.store === s.name && e.status === '在職').length}</td>
                    <td><span className={`badge ${s.status === '營運中' ? 'badge-success' : 'badge-warning'}`}><span className="badge-dot"></span>{s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">👥</span> 部門人數</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {departments.map(d => (
              <div key={d.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 13 }}>{d.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{deptCount(d.name)} 人</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.round(deptCount(d.name) / maxCount * 100)}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
