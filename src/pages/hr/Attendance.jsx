import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, Download, MapPin, Wifi, Clock, CalendarCheck } from 'lucide-react'
import { getAttendance, serverClockIn, getActiveEmployees, getDepartments, getStores } from '../../lib/db'
import { exportAttendancePdf } from '../../lib/exportPdf'
import { validateClockIn } from '../../lib/clockInValidator'
import { todayTW, monthStartTW } from '../../lib/datetime'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useVirtualList, VirtualRow } from '../../lib/useVirtualList.jsx'

export default function Attendance() {
  const { profile, role } = useAuth()
  const userRole = role?.name || profile?.role || 'store_staff'
  const isStaff = userRole === 'store_staff'
  const isManager = userRole === 'manager'

  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState(isManager ? (profile?.store || '') : '')
  const [search, setSearch] = useState(isStaff ? (profile?.name || '') : '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [clockingIn, setClockingIn] = useState(false)
  const [clockMsg, setClockMsg] = useState(null)
  const [tab, setTab] = useState('records') // records | hours

  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getAttendance(null, { orgId }),
      getActiveEmployees('id, name, dept, store, department_id, position, store_id, departments!department_id(name), stores!store_id(name)', orgId),
      getDepartments(orgId),
      getStores(),
    ]).then(([r, e, d, s]) => {
      let recs = r.data || []
      // store_staff: 只顯示自己的紀錄
      if (isStaff && profile?.name) recs = recs.filter(r => r.employee === profile.name)
      // manager: 只顯示自己門市
      if (isManager && profile?.store) recs = recs.filter(r => {
        const emp = (e.data || []).find(emp => emp.name === r.employee)
        return emp?.store === profile.store
      })
      setRecords(recs)
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

  const getEmpDept = useCallback((name) => employees.find(e => e.name === name)?.dept || '', [employees])
  const getEmpStore = useCallback((name) => employees.find(e => e.name === name)?.store || '', [employees])

  const today = todayTW()

  const filtered = useMemo(() => records.filter(r =>
    (deptFilter === '' || getEmpDept(r.employee) === deptFilter) &&
    (storeFilter === '' || getEmpStore(r.employee) === storeFilter) &&
    (search === '' || r.employee?.includes(search))
  ), [records, deptFilter, storeFilter, search, getEmpDept, getEmpStore])

  const avgHours = useMemo(() =>
    filtered.filter(r => r.hours > 0).reduce((s, r) => s + Number(r.hours), 0) /
    (filtered.filter(r => r.hours > 0).length || 1),
    [filtered]
  )

  const allRows = useMemo(() => {
    const todayEmpNames = new Set(records.filter(r => r.date === today).map(r => r.employee))
    const recordRows = filtered.map(r => ({ ...r, _rowType: 'record' }))
    const notClockedRows = employees
      .filter(e =>
        !todayEmpNames.has(e.name) &&
        (storeFilter === '' || e.store === storeFilter) &&
        (deptFilter === '' || e.dept === deptFilter) &&
        (search === '' || e.name.includes(search))
      )
      .map(e => ({ _rowType: 'notClocked', id: `nc-${e.id}`, employee: e.name, dept: e.dept, store: e.store, date: today }))
    return [...recordRows, ...notClockedRows]
  }, [filtered, records, employees, storeFilter, deptFilter, search, today])

  const { virtualItems, containerRef, containerStyle } = useVirtualList({ items: allRows, itemHeight: 48, overscan: 8 })

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const handleClockIn = async (employeeName) => {
    setClockingIn(true)
    setClockMsg(null)
    try {
      const emp = employees.find(e => e.name === employeeName)
      // [Fix 4] Match store by ID (INT FK), not text name — emp.store may be undefined
      const store = stores.find(s => s.id === emp?.store_id)

      // Client-side validation first (blocks if location check fails)
      const result = await validateClockIn(store)

      const dateStr = todayTW()
      const existing = records.find(r => r.employee === employeeName && r.date === dateStr)
      const action = (existing?.clock_in && !existing?.clock_out) ? 'clock_out' : 'clock_in'

      // Server-side validation + record write
      const data = await serverClockIn({
        employee_id: emp?.id,        // [Fix 4] pass ID so proxy guard activates server-side
        employee:    employeeName,   // keep as legacy fallback
        action,
        lat:      result.lat,
        lng:      result.lng,
        accuracy: result.accuracy ?? null,   // [Fix 5] ?? not || — 0 is a valid accuracy value
        ip:       result.ip,
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'records', label: '📋 打卡紀錄' },
          { key: 'hours', label: '⏱️ 工時統整' },
          { key: 'comparison', label: '📊 排班比對' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            border: tab === t.key ? 'none' : '1px solid var(--border-medium)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* 門市篩選 — store_staff 不顯示 */}
      {!isStaff && (
        <div style={{
          display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏪 門市</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
            disabled={isManager}>
            <option value="">全部門市</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      )}

      {tab === 'records' && <>
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
        <div>
          {allRows.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>尚無出勤紀錄</div>
          )}
          {/* Virtual table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 100px 100px 85px 85px 60px 120px 145px 85px 1fr', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            {['員工', '部門', '日期', '上班打卡', '下班打卡', '工時', '打卡地點', 'IP 位址', '狀態', '操作'].map(h => (
              <div key={h} style={{ padding: '10px 8px' }}>{h}</div>
            ))}
          </div>
          {/* Virtual scroll body */}
          <div ref={containerRef} style={{ height: 480, overflowY: 'auto', overflowX: 'hidden' }}>
            <div style={containerStyle}>
              {virtualItems.map(({ item: r, style }) => {
                const isToday = r.date === today
                const isNotClocked = r._rowType === 'notClocked'
                const canClockOut = !isNotClocked && isToday && r.clock_in && !r.clock_out
                const canClockIn = !isNotClocked && isToday && !r.clock_in
                return (
                  <VirtualRow key={r.id} style={{ ...style, display: 'grid', gridTemplateColumns: '140px 100px 100px 85px 85px 60px 120px 145px 85px 1fr', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', opacity: isNotClocked ? 0.75 : 1 }}>
                    <div style={{ padding: '4px 8px', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.employee}</div>
                    <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--text-muted)' }}>{isNotClocked ? (r.dept || '-') : (getEmpDept(r.employee) || '-')}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{r.date}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{r.clock_in || '-'}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{r.clock_out || '-'}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{!isNotClocked && r.hours > 0 ? `${r.hours}h` : '-'}</div>
                    <div style={{ padding: '4px 8px' }}>{isNotClocked ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>-</span> : locationBadge(r)}</div>
                    <div style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {!isNotClocked && r.clock_in_ip ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Wifi size={10} /> {r.clock_in_ip}</span> : '-'}
                    </div>
                    <div style={{ padding: '4px 8px' }}>
                      {isNotClocked
                        ? <span className="badge badge-danger"><span className="badge-dot"></span>未打卡</span>
                        : <span className={`badge ${r.status === '正常' ? 'badge-success' : r.status === '遲到' ? 'badge-warning' : 'badge-danger'}`}><span className="badge-dot"></span>{r.status}</span>
                      }
                    </div>
                    <div style={{ padding: '4px 8px' }}>
                      {(isNotClocked || canClockIn || canClockOut) && (
                        <button className={`btn ${canClockOut ? 'btn-secondary' : 'btn-primary'}`} style={{ fontSize: 11, padding: '3px 10px' }} disabled={clockingIn} onClick={() => handleClockIn(r.employee)}>
                          <Clock size={10} /> {canClockOut ? '下班打卡' : '上班打卡'}
                        </button>
                      )}
                    </div>
                  </VirtualRow>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      </>}

      {/* ══ Work Hours Summary Tab ══ */}
      {tab === 'hours' && (() => {
        // Group records by employee, compute totals
        const empMap = {}
        for (const r of filtered) {
          if (!r.employee) continue
          if (!empMap[r.employee]) empMap[r.employee] = { days: 0, hours: 0, late: 0, normal: 0, records: [] }
          empMap[r.employee].records.push(r)
          if (r.hours > 0) { empMap[r.employee].days++; empMap[r.employee].hours += Number(r.hours) }
          if (r.status === '遲到') empMap[r.employee].late++
          if (r.status === '正常') empMap[r.employee].normal++
        }
        const empList = Object.entries(empMap).map(([name, data]) => ({
          name, ...data,
          avg: data.days > 0 ? (data.hours / data.days) : 0,
          store: getEmpStore(name),
          dept: getEmpDept(name),
        })).sort((a, b) => b.hours - a.hours)

        const totalHours = empList.reduce((s, e) => s + e.hours, 0)
        const totalDays = empList.reduce((s, e) => s + e.days, 0)

        return (
          <>
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
                <div className="stat-card-label">總工時</div>
                <div className="stat-card-value">{totalHours.toFixed(1)}h</div>
              </div>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                <div className="stat-card-label">總出勤天數</div>
                <div className="stat-card-value">{totalDays}</div>
              </div>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
                <div className="stat-card-label">人員數</div>
                <div className="stat-card-value">{empList.length}</div>
              </div>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                <div className="stat-card-label">平均每人工時</div>
                <div className="stat-card-value">{empList.length > 0 ? (totalHours / empList.length).toFixed(1) : 0}h</div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">⏱️</span> 員工工時明細</div>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>員工</th><th>門市</th><th>出勤天數</th><th>總工時</th><th>平均工時</th>
                      <th>正常</th><th>遲到</th><th>工時分佈</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empList.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無資料</td></tr>}
                    {empList.map(e => {
                      const maxHours = Math.max(...empList.map(x => x.hours), 1)
                      const pct = (e.hours / maxHours) * 100
                      return (
                        <tr key={e.name}>
                          <td style={{ fontWeight: 600 }}>{e.name}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.store || e.dept || '—'}</td>
                          <td style={{ textAlign: 'center' }}>{e.days} 天</td>
                          <td style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{e.hours.toFixed(1)}h</td>
                          <td style={{ textAlign: 'center' }}>{e.avg.toFixed(1)}h</td>
                          <td style={{ textAlign: 'center', color: 'var(--accent-green)' }}>{e.normal}</td>
                          <td style={{ textAlign: 'center', color: e.late > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>{e.late}</td>
                          <td style={{ minWidth: 120 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--glass-light)', overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%', borderRadius: 4, width: `${pct}%`,
                                  background: e.avg >= 9 ? 'var(--accent-orange)' : e.avg >= 7 ? 'var(--accent-cyan)' : 'var(--accent-green)',
                                }} />
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 30 }}>{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      })()}

      {tab === 'comparison' && <ScheduleComparisonTab storeFilter={storeFilter} />}
    </div>
  )
}

// ── Schedule Comparison Tab ──
function ScheduleComparisonTab({ storeFilter }) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState(() => ({
    start: monthStartTW(),
    end: todayTW(),
  }))

  useEffect(() => {
    setLoading(true)
    import('../../lib/attendanceComparison').then(({ compareAttendanceWithSchedule }) => {
      compareAttendanceWithSchedule(dateRange.start, dateRange.end, storeFilter).then(data => {
        setResults(data)
        setLoading(false)
      })
    })
  }, [dateRange, storeFilter])

  const normal = results.filter(r => r.status === 'normal').length
  const late = results.filter(r => r.status === 'late').length
  const earlyLeave = results.filter(r => r.status === 'early_leave').length
  const noShow = results.filter(r => r.status === 'no_show').length

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>期間</label>
        <input className="form-input" type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} style={{ width: 150 }} />
        <span style={{ color: 'var(--text-muted)' }}>~</span>
        <input className="form-input" type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} style={{ width: 150 }} />
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>比對中...</div> : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">正常</div>
              <div className="stat-card-value">{normal}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">遲到</div>
              <div className="stat-card-value">{late}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-pink)', '--card-accent-dim': 'rgba(236,72,153,0.1)' }}>
              <div className="stat-card-label">早退</div>
              <div className="stat-card-value">{earlyLeave}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
              <div className="stat-card-label">未打卡</div>
              <div className="stat-card-value">{noShow}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><CalendarCheck size={16} /> 排班 vs 打卡比對</div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {results.length} 筆</span>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>員工</th>
                    <th>日期</th>
                    <th>班別</th>
                    <th style={{ textAlign: 'center' }}>排班時間</th>
                    <th style={{ textAlign: 'center' }}>實際打卡</th>
                    <th style={{ textAlign: 'center' }}>遲到</th>
                    <th style={{ textAlign: 'center' }}>早退</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無比對資料</td></tr>}
                  {results
                    .filter(r => r.status !== 'normal') // Only show anomalies by default
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((r, i) => (
                    <tr key={i} style={{ background: r.status === 'no_show' ? 'rgba(239,68,68,0.03)' : undefined }}>
                      <td style={{ fontWeight: 600 }}>{r.employee}</td>
                      <td>{r.date.slice(5)}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'var(--glass-light)' }}>
                          {r.shift}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 12 }}>
                        {r.scheduled_start}~{r.scheduled_end}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 12 }}>
                        {r.clock_in || '—'} ~ {r.clock_out || '—'}
                      </td>
                      <td style={{ textAlign: 'center', color: r.late_minutes > 0 ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: r.late_minutes > 0 ? 700 : 400 }}>
                        {r.late_minutes > 0 ? `${r.late_minutes}分` : '—'}
                      </td>
                      <td style={{ textAlign: 'center', color: r.early_leave_minutes > 0 ? '#ec4899' : 'var(--text-muted)', fontWeight: r.early_leave_minutes > 0 ? 700 : 400 }}>
                        {r.early_leave_minutes > 0 ? `${r.early_leave_minutes}分` : '—'}
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          background: r.status === 'normal' ? 'rgba(52,211,153,0.12)' : r.status === 'late' ? 'rgba(251,146,60,0.12)' : r.status === 'early_leave' ? 'rgba(236,72,153,0.12)' : 'rgba(239,68,68,0.12)',
                          color: r.status === 'normal' ? '#10b981' : r.status === 'late' ? '#f97316' : r.status === 'early_leave' ? '#ec4899' : '#ef4444',
                        }}>
                          {r.status === 'normal' ? '正常' : r.status === 'late' ? '遲到' : r.status === 'early_leave' ? '早退' : '未打卡'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {results.filter(r => r.status !== 'normal').length === 0 && results.length > 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--accent-green)', padding: 20, fontWeight: 600 }}>✓ 全部正常，無遲到/早退/未打卡</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}
