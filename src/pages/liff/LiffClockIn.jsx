import { useState, useEffect } from 'react'
import { Clock, MapPin, Wifi, CheckCircle, XCircle, Loader, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { serverClockIn } from '../../lib/db'
import { validateClockIn } from '../../lib/clockInValidator'

/**
 * LIFF Clock-In page — opens inside LINE's in-app browser.
 * Standalone, no sidebar/nav — mobile-first full-screen layout.
 * Initializes LIFF SDK if available, falls back to URL params for employee identity.
 */
export default function LiffClockIn() {
  const [employee, setEmployee] = useState(null)
  const [store, setStore] = useState(null)
  const [todayRecord, setTodayRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [clockingIn, setClockingIn] = useState(false)
  const [result, setResult] = useState(null)
  const [liffReady, setLiffReady] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()
  const timeDisplay = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })

  // Initialize LIFF + load employee
  useEffect(() => {
    initLiff()
  }, [])

  async function initLiff() {
    try {
      // Try LIFF SDK
      if (window.liff) {
        const liffId = import.meta.env.VITE_LIFF_ID
        if (liffId) {
          await window.liff.init({ liffId })
          setLiffReady(true)
          if (!window.liff.isLoggedIn()) {
            window.liff.login()
            return
          }
          const profile = await window.liff.getProfile()
          // Look up employee by LINE userId
          const { data: emp } = await supabase.from('employees')
            .select('*').eq('line_user_id', profile.userId).maybeSingle()
          if (emp) {
            await loadEmployeeData(emp)
            return
          }
        }
      }

      // Fallback: URL param ?employee=NAME
      const params = new URLSearchParams(window.location.search)
      const empName = params.get('employee')
      if (empName) {
        const { data: emp } = await supabase.from('employees')
          .select('*').eq('name', empName).maybeSingle()
        if (emp) {
          await loadEmployeeData(emp)
          return
        }
      }

      // No employee found
      setLoading(false)
    } catch (err) {
      console.error('LIFF init error:', err)
      // Still try URL param fallback
      const params = new URLSearchParams(window.location.search)
      const empName = params.get('employee')
      if (empName) {
        const { data: emp } = await supabase.from('employees')
          .select('*').eq('name', empName).maybeSingle()
        if (emp) await loadEmployeeData(emp)
      }
      setLoading(false)
    }
  }

  async function loadEmployeeData(emp) {
    setEmployee(emp)
    const [{ data: storeData }, { data: attendance }] = await Promise.all([
      emp.store ? supabase.from('stores').select('*').eq('name', emp.store).maybeSingle() : { data: null },
      supabase.from('attendance_records').select('*').eq('employee', emp.name).eq('date', today).maybeSingle(),
    ])
    setStore(storeData)
    setTodayRecord(attendance)
    setLoading(false)
  }

  async function handleClock() {
    if (!employee) return
    setClockingIn(true)
    setResult(null)

    const action = (todayRecord?.clock_in && !todayRecord?.clock_out) ? 'clock_out' : 'clock_in'

    try {
      // Step 1: Client-side validation (blocks UI if location check fails)
      const validation = await validateClockIn(store)

      // Step 2: Call Edge Function for server-side validation + record write
      const data = await serverClockIn({
        employee: employee.name,
        action,
        lat: validation.lat,
        lng: validation.lng,
        accuracy: validation.accuracy || null,
        ip: validation.ip,
      })

      // Success
      setTodayRecord(data.record)
      const now = new Date()
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      if (action === 'clock_in') {
        setResult({
          success: true,
          type: 'in',
          time: timeStr,
          location: data.locationName,
          ip: data.ip,
          late: now.getHours() >= 9 && now.getMinutes() > 0,
        })
      } else {
        setResult({
          success: true,
          type: 'out',
          time: timeStr,
          location: data.locationName,
          ip: data.ip,
          hours: data.record?.hours,
        })
      }
    } catch (err) {
      // Client validation failed (thrown error) or network error
      const msg = err.code === 'VALIDATION_FAILED'
        ? err.message
        : `打卡失敗：${err.message}`
      setResult({ success: false, error: msg })
    }
    setClockingIn(false)
  }

  // Close LIFF window
  const closeLiff = () => {
    if (window.liff?.isInClient()) {
      window.liff.closeWindow()
    } else {
      window.close()
    }
  }

  const isClockOut = todayRecord?.clock_in && !todayRecord?.clock_out
  const isDone = todayRecord?.clock_in && todayRecord?.clock_out

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.center}>
          <Loader size={32} style={{ animation: 'spin 1s linear infinite', color: '#22d3ee' }} />
          <p style={{ color: '#94a3b8', marginTop: 16 }}>載入中...</p>
        </div>
      </div>
    )
  }

  if (!employee) {
    return (
      <div style={styles.container}>
        <div style={styles.center}>
          <XCircle size={48} style={{ color: '#f87171' }} />
          <h2 style={{ color: '#f1f5f9', marginTop: 16 }}>無法識別員工</h2>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>請透過 LINE 開啟此頁面，或使用 ?employee=姓名 參數</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>S</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>SME OPS</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>打卡系統</div>
        </div>
        {liffReady && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(34,211,238,0.15)', color: '#22d3ee', marginLeft: 'auto' }}>LINE</span>}
      </div>

      {/* Employee info */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: employee.avatar || '#22d3ee',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 700, color: '#fff',
          }}>{employee.name?.[0]}</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9' }}>{employee.name}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{employee.dept} · {employee.position}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
          <MapPin size={12} /> {employee.store || '未指定門市'}
        </div>
      </div>

      {/* Time display */}
      <div style={{ textAlign: 'center', margin: '24px 0' }}>
        <div style={{ fontSize: 48, fontWeight: 800, color: '#f1f5f9', letterSpacing: 2 }}>{timeDisplay}</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>{new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
      </div>

      {/* Today's status */}
      {todayRecord?.clock_in && (
        <div style={{ ...styles.card, marginBottom: 16, background: 'rgba(30,41,59,0.8)' }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 8 }}>今日紀錄</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#22d3ee' }}>{todayRecord.clock_in}</span>
              <span style={{ fontSize: 12, color: '#64748b' }}> 上班</span>
            </div>
            {todayRecord.clock_out && (
              <div>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#fb923c' }}>{todayRecord.clock_out}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}> 下班</span>
              </div>
            )}
            {todayRecord.hours > 0 && (
              <span style={{ fontSize: 13, fontWeight: 700, color: '#34d399' }}>{todayRecord.hours}h</span>
            )}
          </div>
          {todayRecord.clock_in_location && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={10} /> {todayRecord.clock_in_location}
              {todayRecord.clock_in_ip && <span style={{ marginLeft: 8 }}><Wifi size={10} /> {todayRecord.clock_in_ip}</span>}
            </div>
          )}
        </div>
      )}

      {/* Clock button */}
      {!isDone ? (
        <button onClick={handleClock} disabled={clockingIn} style={{
          ...styles.clockBtn,
          background: isClockOut
            ? 'linear-gradient(135deg, #fb923c, #f59e0b)'
            : 'linear-gradient(135deg, #22d3ee, #3b82f6)',
          opacity: clockingIn ? 0.7 : 1,
        }}>
          {clockingIn ? (
            <><Loader size={22} style={{ animation: 'spin 1s linear infinite' }} /> GPS 定位中...</>
          ) : (
            <><Clock size={22} /> {isClockOut ? '下班打卡' : '上班打卡'}</>
          )}
        </button>
      ) : (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <CheckCircle size={40} style={{ color: '#34d399' }} />
          <p style={{ color: '#34d399', fontWeight: 700, marginTop: 8 }}>今日打卡已完成</p>
        </div>
      )}

      {/* Result message */}
      {result && (
        <div style={{
          ...styles.card, marginTop: 16,
          borderColor: result.success ? (result.warning ? '#fb923c' : '#34d399') : '#f87171',
        }}>
          {result.success ? (
            result.type === 'done' ? (
              <div style={{ textAlign: 'center', color: '#94a3b8' }}>今日已完成打卡</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <CheckCircle size={18} style={{ color: '#34d399' }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
                    {result.type === 'in' ? '上班' : '下班'}打卡成功
                  </span>
                  {result.late && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}>遲到</span>}
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>
                  <div>時間：{result.time}</div>
                  {result.location && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={11} /> {result.location}</div>}
                  {result.ip && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Wifi size={11} /> {result.ip}</div>}
                  {result.hours && <div>工時：{result.hours.toFixed(2)} 小時</div>}
                </div>
                {result.warning && (
                  <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, fontSize: 11, background: 'rgba(251,146,60,0.1)', color: '#fb923c', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertTriangle size={12} /> {result.warning}
                  </div>
                )}
              </>
            )
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <XCircle size={18} style={{ color: '#f87171' }} />
              <span style={{ fontSize: 13, color: '#f87171' }}>{result.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Close button for LIFF */}
      {(liffReady || result) && (
        <button onClick={closeLiff} style={{
          display: 'block', margin: '20px auto 0', padding: '8px 24px',
          borderRadius: 8, border: '1px solid #334155', background: 'transparent',
          color: '#94a3b8', fontSize: 13, cursor: 'pointer',
        }}>
          關閉
        </button>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh', background: '#0f172a', padding: '0 20px 40px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '16px 0', borderBottom: '1px solid #1e293b',
  },
  logo: {
    width: 32, height: 32, borderRadius: 8,
    background: 'linear-gradient(135deg, #22d3ee, #3b82f6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 800, color: '#fff',
  },
  card: {
    background: 'rgba(30,41,59,0.5)', border: '1px solid #1e293b',
    borderRadius: 14, padding: '18px 20px', marginTop: 16,
  },
  clockBtn: {
    width: '100%', padding: '18px', borderRadius: 16, border: 'none',
    color: '#fff', fontSize: 18, fontWeight: 800, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,0.3)', transition: 'all 0.2s',
  },
}
