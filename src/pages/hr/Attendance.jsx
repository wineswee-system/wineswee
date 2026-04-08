import { useState, useEffect } from 'react'
import { Search, Download, MapPin, Wifi, Clock } from 'lucide-react'
import { getAttendance, serverClockIn } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { exportAttendancePdf } from '../../lib/exportPdf'
import { validateClockIn } from '../../lib/clockInValidator'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function Attendance() {
  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [clockingIn, setClockingIn] = useState(false)
  const [clockMsg, setClockMsg] = useState(null)

  useEffect(() => {
    Promise.all([
      getAttendance(),
      supabase.from('employees').select('id, name, dept, position, store').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('*'),
    ]).then(([r, e, d, s]) => {
      setRecords(r.data || [])
      setEmployees(e.data || [])
      setDepartments(d.data || [])
      setStores(s.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const getEmpDept = (name) => employees.find(e => e.name === name)?.dept || ''
  const getEmpStore = (name) => employees.find(e => e.name === name)?.store || ''

  const filtered = records.filter(r =>
    (deptFilter === '' || getEmpDept(r.employee) === deptFilter) &&
    (storeFilter === '' || getEmpStore(r.employee) === storeFilter) &&
    (search === '' || r.employee?.includes(search))
  )

  const avgHours = filtered.filter(r => r.hours > 0).reduce((s, r) => s + Number(r.hours), 0) /
    (filtered.filter(r => r.hours > 0).length || 1)

  const handleClockIn = async (employeeName) => {
    setClockingIn(true)
    setClockMsg(null)
    try {
      const emp = employees.find(e => e.name === employeeName)
      const store = stores.find(s => s.name === emp?.store)

      // Client-side validation first (blocks if location check fails)
      const result = await validateClockIn(store)

      const dateStr = new Date().toISOString().slice(0, 10)
      const existing = records.find(r => r.employee === employeeName && r.date === dateStr)
      const action = (existing?.clock_in && !existing?.clock_out) ? 'clock_out' : 'clock_in'

      // Server-side validation + record write
      const data = await serverClockIn({
        employee: employeeName,
        action,
        lat: result.lat,
        lng: result.lng,
        accuracy: result.accuracy || null,
        ip: result.ip,
      })

      const now = new Date()
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      if (action === 'clock_out') {
        setRecords(prev => prev.map(r => r.id === data.record.id ? data.record : r))
        setClockMsg({ type: 'success', text: `${employeeName} 下班打卡成功 (${timeStr})` })
      } else {
        setRecords(prev => [...prev.filter(r => !(r.employee === employeeName && r.date === dateStr)), data.record])
        setClockMsg({ type: 'success', text: `${employeeName} 上班打卡成功 (${timeStr}) — ${data.locationName || data.method}` })
      }
    } catch (err) {
      setClockMsg({ type: 'error', text: err.message })
    }
    setClockingIn(false)
  }

  const deptBtnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  const locationBadge = (r) => {
    if (!r.clock_in_location) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>-</span>
    const isExternal = r.clock_in_location === '外部位置'
    return (
      <span className={`badge ${isExternal ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: 11 }}>
        <MapPin size={10} style={{ marginRight: 3 }} />
        {r.clock_in_location}
      </span>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⏰</span> 打卡追蹤</h2>
            <p>員工每日出缺勤即時追蹤（含 GPS 地點 / WiFi IP 驗證）</p>
          </div>
          <button className="btn btn-secondary" onClick={() => exportAttendancePdf(filtered, { dept: deptFilter })}><Download size={14} /> 匯出 PDF</button>
        </div>
      </div>

      {/* Clock-in message */}
      {clockMsg && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13,
          background: clockMsg.type === 'success' ? 'var(--accent-green-dim)' : clockMsg.type === 'error' ? 'var(--accent-red-dim)' : 'var(--accent-cyan-dim)',
          color: clockMsg.type === 'success' ? 'var(--accent-green)' : clockMsg.type === 'error' ? 'var(--accent-red)' : 'var(--accent-cyan)',
          border: `1px solid ${clockMsg.type === 'success' ? 'var(--accent-green)' : clockMsg.type === 'error' ? 'var(--accent-red)' : 'var(--accent-cyan)'}`,
        }}>
          {clockMsg.text}
          <button onClick={() => setClockMsg(null)} style={{ float: 'right', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* 門市篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={deptBtnStyle(storeFilter === '')} onClick={() => setStoreFilter('')}>全部門市</button>
        {stores.map(s => (
          <button key={s.id} style={deptBtnStyle(storeFilter === s.name)} onClick={() => setStoreFilter(s.name)}>{s.name}</button>
        ))}
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">正常</div>
          <div className="stat-card-value">{filtered.filter(r => r.status === '正常').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">遲到</div>
          <div className="stat-card-value">{filtered.filter(r => r.status === '遲到').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">未打卡</div>
          <div className="stat-card-value">{filtered.filter(r => r.status === '未打卡').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">平均工時</div>
          <div className="stat-card-value">{avgHours.toFixed(1)}h</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 出勤紀錄</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋員工..." className="form-input" style={{ paddingLeft: 38 }}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th><th>部門</th><th>日期</th><th>上班打卡</th><th>下班打卡</th>
                <th>工時</th><th>打卡地點</th><th>IP 位址</th><th>狀態</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無出勤紀錄</td></tr>}
              {filtered.map(r => {
                const today = new Date().toISOString().slice(0, 10)
                const isToday = r.date === today
                const canClockOut = isToday && r.clock_in && !r.clock_out
                const canClockIn = isToday && !r.clock_in
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.employee}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getEmpDept(r.employee) || '-'}</td>
                    <td>{r.date}</td>
                    <td>{r.clock_in || '-'}</td>
                    <td>{r.clock_out || '-'}</td>
                    <td>{r.hours > 0 ? `${r.hours}h` : '-'}</td>
                    <td>{locationBadge(r)}</td>
                    <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {r.clock_in_ip ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Wifi size={10} /> {r.clock_in_ip}
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      <span className={`badge ${r.status === '正常' ? 'badge-success' : r.status === '遲到' ? 'badge-warning' : 'badge-danger'}`}>
                        <span className="badge-dot"></span>{r.status}
                      </span>
                    </td>
                    <td>
                      {(canClockIn || canClockOut) && (
                        <button
                          className={`btn ${canClockOut ? 'btn-secondary' : 'btn-primary'}`}
                          style={{ fontSize: 11, padding: '3px 10px' }}
                          disabled={clockingIn}
                          onClick={() => handleClockIn(r.employee)}
                        >
                          <Clock size={10} /> {canClockOut ? '下班打卡' : '上班打卡'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {/* Quick clock-in for employees not yet in today's records */}
              {(() => {
                const today = new Date().toISOString().slice(0, 10)
                const todayEmployees = records.filter(r => r.date === today).map(r => r.employee)
                const notClocked = employees.filter(e =>
                  !todayEmployees.includes(e.name) &&
                  (deptFilter === '' || e.dept === deptFilter) &&
                  (search === '' || e.name.includes(search))
                )
                return notClocked.map(e => (
                  <tr key={`new-${e.id}`} style={{ opacity: 0.7 }}>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.dept || '-'}</td>
                    <td>{today}</td>
                    <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
                    <td><span className="badge badge-danger"><span className="badge-dot"></span>未打卡</span></td>
                    <td>
                      <button className="btn btn-primary" style={{ fontSize: 11, padding: '3px 10px' }}
                        disabled={clockingIn} onClick={() => handleClockIn(e.name)}>
                        <Clock size={10} /> 上班打卡
                      </button>
                    </td>
                  </tr>
                ))
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
