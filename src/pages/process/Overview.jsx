import { useState, useEffect } from 'react'
import { Workflow, ListChecks, CheckSquare, TrendingUp } from 'lucide-react'
import { getWorkflows, getTasks, getChecklists } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function ProcessOverview() {
  const [workflows, setWorkflows] = useState([])
  const [tasks, setTasks] = useState([])
  const [checklists, setChecklists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([getWorkflows(), getTasks(), getChecklists()]).then(([w, t, c]) => {
      setWorkflows(w.data || [])
      setTasks(t.data || [])
      setChecklists(c.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const activeInstances = workflows.reduce((s, w) => s + w.active_instances, 0)
  const completedTasks = tasks.filter(t => t.status === '已完成').length
  const checklistProgress = checklists.reduce((s, c) => s + c.completed, 0)
  const checklistTotal = checklists.reduce((s, c) => s + c.items, 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">👁️</span> 流程總覽</h2>
        <p>所有流程、任務與查核清單的即時狀態</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-icon"><Workflow size={16} /></div>
          <div className="stat-card-label">進行中流程</div>
          <div className="stat-card-value">{activeInstances}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-icon"><ListChecks size={16} /></div>
          <div className="stat-card-label">進行中任務</div>
          <div className="stat-card-value">{tasks.filter(t => t.status === '進行中').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-icon"><CheckSquare size={16} /></div>
          <div className="stat-card-label">已完成任務</div>
          <div className="stat-card-value">{completedTasks}</div>
          <div className="stat-card-sub">完成率 {tasks.length ? Math.round(completedTasks / tasks.length * 100) : 0}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-icon"><TrendingUp size={16} /></div>
          <div className="stat-card-label">查核進度</div>
          <div className="stat-card-value">{checklistProgress}/{checklistTotal}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🔄</span> 流程狀態</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>流程名稱</th><th>步驟數</th><th>執行中</th><th>狀態</th></tr></thead>
              <tbody>
                {workflows.map(w => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td>{w.steps}</td>
                    <td style={{ fontWeight: 600, color: w.active_instances > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>{w.active_instances}</td>
                    <td><span className={`badge ${w.status === '已啟用' ? 'badge-success' : 'badge-warning'}`}><span className="badge-dot"></span>{w.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">✅</span> 查核清單進度</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {checklists.map(c => {
              const pct = c.items ? Math.round(c.completed / c.items * 100) : 0
              return (
                <div key={c.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.completed}/{c.items}</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--accent-green)' : pct > 50 ? 'var(--accent-cyan)' : 'var(--accent-orange)' }}></div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{c.assignee} · {c.category}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
