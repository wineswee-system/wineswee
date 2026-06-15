import { useState, useEffect } from 'react'
import { Users, Clock, CalendarOff, DollarSign } from 'lucide-react'
import { getActiveEmployees, getAttendance, getLeaveRequests, getSalaryRecords } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function HRReport() {
  const { profile } = useAuth()
  const [employees, setEmployees] = useState([])
  const [attendance, setAttendance] = useState([])
  const [leaves, setLeaves] = useState([])
  const [salary, setSalary] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    // 出勤只取今日 + 只要 status 欄位（原本撈全表全欄只為算「今日遲到」，既慢又名實不符）
    const today = new Date().toLocaleDateString('en-CA')  // 本地 YYYY-MM-DD
    Promise.all([
      getActiveEmployees('id, dept, status', orgId),
      getAttendance(today, { orgId, columns: 'status' }),
      getLeaveRequests({ orgId }),
      getSalaryRecords(null, orgId),
    ]).then(([e, a, l, s]) => {
      setEmployees(e.data || [])
      setAttendance(a.data || [])
      setLeaves(l.data || [])
      setSalary(s.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [profile?.organization_id])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const activeCount = employees.filter(e => e.status === '在職').length
  const lateCount = attendance.filter(a => a.status === '遲到').length
  const pendingLeave = leaves.filter(l => l.status === '待審核').length
  const totalSalary = salary.reduce((s, r) => s + r.net_salary, 0)

  const deptCounts = employees.reduce((acc, e) => {
    if (e.status === '在職') acc[e.dept] = (acc[e.dept] || 0) + 1
    return acc
  }, {})
  const maxDept = Math.max(...Object.values(deptCounts), 1)

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">📊</span> HR 報表</h2>
        <p>人力資源綜合數據分析</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-icon"><Users size={16} /></div>
          <div className="stat-card-label">在職人數</div>
          <div className="stat-card-value">{activeCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-icon"><Clock size={16} /></div>
          <div className="stat-card-label">今日遲到</div>
          <div className="stat-card-value">{lateCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-icon"><CalendarOff size={16} /></div>
          <div className="stat-card-label">待審假單</div>
          <div className="stat-card-value">{pendingLeave}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-icon"><DollarSign size={16} /></div>
          <div className="stat-card-label">本月薪資總額</div>
          <div className="stat-card-value">{(totalSalary / 10000).toFixed(1)}萬</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">👥</span> 部門人數分佈</div>
          </div>
          <div className="card-body">
            <div className="chart-placeholder">
              {Object.entries(deptCounts).map(([dept, count], i) => {
                const colors = ['var(--accent-blue)', 'var(--accent-purple)', 'var(--accent-green)', 'var(--accent-pink)', 'var(--accent-yellow)', 'var(--accent-cyan)']
                return (
                  <div key={dept} className="chart-bar" style={{ height: `${Math.round(count / maxDept * 100)}%`, background: colors[i % colors.length] }}>
                    <span className="chart-bar-label">{dept.replace('部', '')}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📅</span> 出勤狀態分佈</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: '正常', count: attendance.filter(a => a.status === '正常').length, color: 'var(--accent-green)' },
              { label: '遲到', count: attendance.filter(a => a.status === '遲到').length, color: 'var(--accent-orange)' },
              { label: '未打卡', count: attendance.filter(a => a.status === '未打卡').length, color: 'var(--accent-red)' },
            ].map(item => (
              <div key={item.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 13 }}>{item.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.count} 人</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${attendance.length ? item.count / attendance.length * 100 : 0}%`, background: item.color }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
