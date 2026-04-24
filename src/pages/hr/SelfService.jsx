import { useState, useEffect, useMemo } from 'react'
import { User, Calendar, DollarSign, Clock, FileText, Bell, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { empLabel } from '../../lib/empLabel'

export default function SelfService() {
  const { profile, isSuperAdmin, isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [employee, setEmployee] = useState(null)
  const [employees, setEmployees] = useState([])
  const [selectedEmpName, setSelectedEmpName] = useState('')
  const [tab, setTab] = useState('profile')
  const [attendance, setAttendance] = useState([])
  const [leaves, setLeaves] = useState([])
  const [salaryRecords, setSalaryRecords] = useState([])
  const [leaveEntitlements, setLeaveEntitlements] = useState([])

  useEffect(() => {
    supabase.from('employees').select('*').eq('status', '在職').order('name')
      .then(({ data }) => {
        setEmployees(data || [])
        if (data?.length) {
          // Default to the logged-in user's record; fall back to first in list
          const self = profile?.name ? data.find(e => e.id === profile.id) : null
          const defaultEmp = self || data[0]
          setSelectedEmpName(defaultEmp.name)
          setEmployee(defaultEmp)
        }
      })
      .catch(() => setError('載入失敗'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  useEffect(() => {
    if (!selectedEmpName) return
    const emp = employees.find(e => e.name === selectedEmpName)
    setEmployee(emp || null)

    const thisMonth = new Date().toISOString().slice(0, 7)
    const thisYear = new Date().getFullYear()
    const last30 = new Date()
    last30.setDate(last30.getDate() - 30)

    Promise.all([
      supabase.from('attendance_records').select('*').eq('employee_id', emp?.id).gte('date', last30.toISOString().slice(0, 10)).order('date', { ascending: false }),
      supabase.from('leave_requests').select('*').eq('employee_id', emp?.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('salary_records').select('*').eq('employee_id', emp?.id).order('month', { ascending: false }).limit(12),
      supabase.from('leave_entitlements').select('*').eq('employee', emp?.name).eq('year', thisYear),
    ]).then(([a, l, s, le]) => {
      setAttendance(a.data || [])
      setLeaves(l.data || [])
      setSalaryRecords(s.data || [])
      setLeaveEntitlements(le.data || [])
    })
  }, [selectedEmpName, employees])

  const attendanceStats = useMemo(() => {
    const total = attendance.length
    const late = attendance.filter(a => a.status === '遲到' || a.late_flag).length
    const totalHours = attendance.reduce((s, a) => s + (a.hours || 0), 0)
    return { total, late, totalHours: Math.round(totalHours * 10) / 10 }
  }, [attendance])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👤</span> 員工自助服務</h2>
            <p>查看個人資料、出勤、薪資、請假紀錄</p>
          </div>
          {(isSuperAdmin || isAdmin) && (
            <div>
              <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={selectedEmpName} onChange={e => setSelectedEmpName(e.target.value)}>
                {employees.map(e => <option key={e.id} value={e.name}>{empLabel(e)} — {e.dept}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {employee && (
        <>
          {/* Profile card */}
          <div style={{
            display: 'flex', gap: 20, padding: 20, marginBottom: 20,
            background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: 'var(--accent-cyan)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#fff', fontWeight: 700,
            }}>
              {employee.name?.charAt(0)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{employee.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                {employee.dept} · {employee.position} · {employee.store || ''}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13 }}>
                <span>📧 {employee.email || '-'}</span>
                <span>📱 {employee.phone || '-'}</span>
                <span>📅 到職日 {employee.join_date || '-'}</span>
              </div>
            </div>
          </div>

          {/* Quick stat cards */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'rgba(6,182,212,0.12)' }}>
              <div className="stat-card-label">本月出勤天數</div>
              <div className="stat-card-value">{attendanceStats.total}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': attendanceStats.late > 0 ? 'var(--accent-red)' : 'var(--accent-green)', '--card-accent-dim': attendanceStats.late > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)' }}>
              <div className="stat-card-label">遲到次數</div>
              <div className="stat-card-value">{attendanceStats.late}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'rgba(16,185,129,0.12)' }}>
              <div className="stat-card-label">累計工時</div>
              <div className="stat-card-value">{attendanceStats.totalHours}h</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'rgba(245,158,11,0.12)' }}>
              <div className="stat-card-label">薪資紀錄</div>
              <div className="stat-card-value">{salaryRecords.length} 月</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
            {[['profile', '👤 個人資料'], ['attendance', '🕐 出勤紀錄'], ['leave', '📅 請假紀錄'], ['salary', '💰 薪資明細']].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                background: tab === key ? 'var(--accent-cyan)' : 'transparent',
                color: tab === key ? '#fff' : 'var(--text-muted)',
              }}>{label}</button>
            ))}
          </div>

          {/* Profile */}
          {tab === 'profile' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">👤</span> 個人資料</div>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px 24px' }}>
                  {[
                    ['姓名', employee.name],
                    ['英文名', employee.name_en || '-'],
                    ['部門', employee.dept || '-'],
                    ['職位', employee.position || '-'],
                    ['門市', employee.store || '-'],
                    ['狀態', employee.status],
                    ['信箱', employee.email || '-'],
                    ['電話', employee.phone || '-'],
                    ['到職日', employee.join_date || '-'],
                    ['主管', employee.supervisor || '-'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Leave Entitlements */}
                {leaveEntitlements.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>📅 假別額度（{new Date().getFullYear()}）</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                      {leaveEntitlements.map(le => {
                        const used = le.used_days || 0
                        const total = le.total_days || 0
                        const pct = total ? Math.round((used / total) * 100) : 0
                        return (
                          <div key={le.id} style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                              <span style={{ fontWeight: 600 }}>{le.leave_type}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{used}/{total} 天</span>
                            </div>
                            <div className="progress-track">
                              <div className="progress-fill" style={{
                                width: `${pct}%`,
                                background: pct >= 80 ? 'var(--accent-red)' : pct >= 50 ? 'var(--accent-orange)' : 'var(--accent-green)',
                              }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Attendance */}
          {tab === 'attendance' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">🕐</span> 近30天出勤紀錄</div>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>日期</th><th>上班</th><th>下班</th><th>時數</th><th>狀態</th><th>打卡地點</th></tr>
                  </thead>
                  <tbody>
                    {attendance.map(a => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 600 }}>{a.date}</td>
                        <td>{a.clock_in || '-'}</td>
                        <td>{a.clock_out || '-'}</td>
                        <td>{a.hours ? `${a.hours}h` : '-'}</td>
                        <td>
                          <span className={`badge ${a.status === '遲到' || a.late_flag ? 'badge-danger' : 'badge-success'}`}>
                            {a.status || (a.late_flag ? '遲到' : '正常')}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.clock_in_location || '-'}</td>
                      </tr>
                    ))}
                    {!attendance.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>無出勤紀錄</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Leave */}
          {tab === 'leave' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">📅</span> 請假紀錄</div>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>假別</th><th>開始</th><th>結束</th><th>天數</th><th>原因</th><th>狀態</th><th>審核人</th></tr>
                  </thead>
                  <tbody>
                    {leaves.map(l => (
                      <tr key={l.id}>
                        <td style={{ fontWeight: 600 }}>{l.type}</td>
                        <td>{l.start_date}</td>
                        <td>{l.end_date}</td>
                        <td>{l.days}</td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.reason || '-'}</td>
                        <td>
                          <span className={`badge ${l.status === '已核准' ? 'badge-success' : l.status === '已駁回' ? 'badge-danger' : 'badge-info'}`}>
                            {l.status}
                          </span>
                        </td>
                        <td>{l.approver || '-'}</td>
                      </tr>
                    ))}
                    {!leaves.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>無請假紀錄</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Salary */}
          {tab === 'salary' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">💰</span> 薪資明細（最近12個月）</div>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>月份</th><th>底薪</th><th>津貼</th><th>加班費</th><th>扣除</th><th>勞健保</th><th>實發</th></tr>
                  </thead>
                  <tbody>
                    {salaryRecords.map(s => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.month}</td>
                        <td>${(s.base_salary || 0).toLocaleString()}</td>
                        <td>${(s.allowance || 0).toLocaleString()}</td>
                        <td>${(s.overtime || 0).toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-red)' }}>-${(s.deductions || 0).toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-orange)' }}>-${(s.insurance || 0).toLocaleString()}</td>
                        <td style={{ fontWeight: 700, color: 'var(--accent-green)' }}>${(s.net_salary || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                    {!salaryRecords.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>無薪資紀錄</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
