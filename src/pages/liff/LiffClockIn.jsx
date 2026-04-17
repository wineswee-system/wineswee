import { useState, useEffect } from 'react'
import { Clock, MapPin, Wifi, CheckCircle, XCircle, Loader } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { serverClockIn } from '../../lib/db'
import { validateClockIn } from '../../lib/clockInValidator'

export default function LiffClockIn() {
  const [employee, setEmployee] = useState(null)
  const [store, setStore] = useState(null)
  const [todayRecord, setTodayRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [clockingIn, setClockingIn] = useState(false)
  const [result, setResult] = useState(null)
  const [liffReady, setLiffReady] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  const today = new Date().toISOString().slice(0, 10)
  const now = currentTime
  const timeDisplay = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })

  useEffect(() => { initLiff() }, [])
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  async function initLiff() {
    try {
      if (window.liff) {
        const liffId = import.meta.env.VITE_LIFF_ID
        if (liffId) {
          await window.liff.init({ liffId })
          setLiffReady(true)
          if (!window.liff.isLoggedIn()) { window.liff.login(); return }
          const profile = await window.liff.getProfile()
          const { data: emp } = await supabase.from('employees')
            .select('*').eq('line_user_id', profile.userId).maybeSingle()
          if (emp) { await loadEmployeeData(emp); return }
        }
      }
      const params = new URLSearchParams(window.location.search)
      const empName = params.get('employee')
      if (empName) {
        const { data: emp } = await supabase.from('employees')
          .select('*').eq('name', empName).maybeSingle()
        if (emp) { await loadEmployeeData(emp); return }
      }
      setLoading(false)
    } catch (err) {
      console.error('LIFF init error:', err)
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
      emp.store_id ? supabase.from('stores').select('*').eq('id', emp.store_id).maybeSingle()
        : emp.store ? supabase.from('stores').select('*').eq('name', emp.store).maybeSingle() : { data: null },
      supabase.from('attendance_records').select('*').eq('employee_id', emp.id).eq('date', today).maybeSingle(),
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
      const validation = await validateClockIn(store)
      const data = await serverClockIn({
        employee: employee.name, action,
        lat: validation.lat, lng: validation.lng,
        accuracy: validation.accuracy || null, ip: validation.ip,
      })
      setTodayRecord(data.record)
      const nowTime = new Date()
      const timeStr = `${String(nowTime.getHours()).padStart(2, '0')}:${String(nowTime.getMinutes()).padStart(2, '0')}`

      // Show success animation
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 2500)

      if (action === 'clock_in') {
        setResult({ success: true, type: 'in', time: timeStr, location: data.locationName, ip: data.ip, late: nowTime.getHours() >= 9 && nowTime.getMinutes() > 0 })
      } else {
        setResult({ success: true, type: 'out', time: timeStr, location: data.locationName, ip: data.ip, hours: data.record?.hours })
      }
    } catch (err) {
      const msg = err.code === 'VALIDATION_FAILED' ? err.message : `打卡失敗：${err.message}`
      setResult({ success: false, error: msg })
    }
    setClockingIn(false)
  }

  const closeLiff = () => {
    if (window.liff?.isInClient()) window.liff.closeWindow()
    else window.close()
  }

  const isClockOut = todayRecord?.clock_in && !todayRecord?.clock_out
  const isDone = todayRecord?.clock_in && todayRecord?.clock_out

  // ── Success Overlay ──
  if (showSuccess) {
    return (
      <div style={S.container}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <div style={{ animation: 'successPop 0.5s ease', fontSize: 80 }}>✅</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#059669', marginTop: 16, animation: 'fadeUp 0.6s ease' }}>
            {result?.type === 'in' ? '上班打卡成功' : '下班打卡成功'}
          </div>
          <div style={{ fontSize: 48, fontWeight: 800, color: '#1e293b', marginTop: 8 }}>{result?.time}</div>
          {result?.location && (
            <div style={{ fontSize: 14, color: '#64748b', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <MapPin size={14} /> {result.location}
            </div>
          )}
          {result?.ip && (
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wifi size={13} /> {result.ip}
            </div>
          )}
          {result?.hours && (
            <div style={{ fontSize: 16, fontWeight: 700, color: '#06b6d4', marginTop: 12 }}>
              今日工時：{result.hours.toFixed(1)} 小時
            </div>
          )}
          {result?.late && (
            <div style={{ marginTop: 12, padding: '6px 16px', borderRadius: 20, background: '#fef3c7', color: '#92400e', fontSize: 13, fontWeight: 600 }}>
              遲到
            </div>
          )}
        </div>
        <style>{`
          @keyframes successPop { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.3); } 100% { transform: scale(1); opacity: 1; } }
          @keyframes fadeUp { 0% { transform: translateY(20px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        `}</style>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={S.container}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
          <Loader size={32} style={{ animation: 'spin 1s linear infinite', color: '#06b6d4' }} />
          <p style={{ color: '#94a3b8', marginTop: 16 }}>載入中...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (!employee) {
    return (
      <div style={S.container}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
          <XCircle size={48} style={{ color: '#ef4444' }} />
          <h2 style={{ color: '#1e293b', marginTop: 16 }}>無法識別員工</h2>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>請透過 LINE 開啟此頁面</p>
        </div>
      </div>
    )
  }

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logo}>S</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>SME OPS</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>打卡系統</div>
        </div>
        {liffReady && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#ecfdf5', color: '#059669', marginLeft: 'auto' }}>LINE</span>}
      </div>

      {/* Employee info */}
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 700, color: '#fff',
          }}>{employee.name?.[0]}</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>{employee.name}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{employee.dept} · {employee.position}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
          <MapPin size={12} /> {employee.store || '未指定門市'}
        </div>
      </div>

      {/* Time */}
      <div style={{ textAlign: 'center', margin: '28px 0' }}>
        <div style={{ fontSize: 52, fontWeight: 800, color: '#1e293b', letterSpacing: 2 }}>{timeDisplay}</div>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>{now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
      </div>

      {/* Today record */}
      {todayRecord?.clock_in && (
        <div style={{ ...S.card, marginBottom: 16, background: '#f8fafc' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 8 }}>今日紀錄</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#06b6d4' }}>{todayRecord.clock_in}</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}> 上班</span>
            </div>
            {todayRecord.clock_out && (
              <div>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>{todayRecord.clock_out}</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}> 下班</span>
              </div>
            )}
            {todayRecord.hours > 0 && (
              <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>{todayRecord.hours}h</span>
            )}
          </div>
          {(todayRecord.clock_in_location || todayRecord.clock_in_ip) && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, display: 'flex', gap: 12 }}>
              {todayRecord.clock_in_location && <span><MapPin size={10} style={{ verticalAlign: -1 }} /> {todayRecord.clock_in_location}</span>}
              {todayRecord.clock_in_ip && <span><Wifi size={10} style={{ verticalAlign: -1 }} /> {todayRecord.clock_in_ip}</span>}
            </div>
          )}
        </div>
      )}

      {/* Clock button */}
      {!isDone ? (
        <button onClick={handleClock} disabled={clockingIn} style={{
          ...S.clockBtn,
          background: isClockOut
            ? 'linear-gradient(135deg, #f59e0b, #f97316)'
            : 'linear-gradient(135deg, #06b6d4, #3b82f6)',
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
          <CheckCircle size={40} style={{ color: '#059669' }} />
          <p style={{ color: '#059669', fontWeight: 700, marginTop: 8 }}>今日打卡已完成</p>
        </div>
      )}

      {/* Result */}
      {result && !showSuccess && (
        <div style={{
          ...S.card, marginTop: 16,
          borderColor: result.success ? '#d1fae5' : '#fecaca',
          background: result.success ? '#f0fdf4' : '#fef2f2',
        }}>
          {result.success ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <CheckCircle size={18} style={{ color: '#059669' }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
                  {result.type === 'in' ? '上班' : '下班'}打卡成功
                </span>
                {result.late && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#fef3c7', color: '#92400e' }}>遲到</span>}
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                <div>時間：{result.time}</div>
                {result.location && <div><MapPin size={11} style={{ verticalAlign: -1 }} /> {result.location}</div>}
                {result.ip && <div><Wifi size={11} style={{ verticalAlign: -1 }} /> {result.ip}</div>}
                {result.hours && <div>工時：{result.hours.toFixed(2)} 小時</div>}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <XCircle size={18} style={{ color: '#ef4444' }} />
              <span style={{ fontSize: 13, color: '#ef4444' }}>{result.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Close */}
      {(liffReady || result) && (
        <button onClick={closeLiff} style={{
          display: 'block', margin: '20px auto 0', padding: '8px 24px',
          borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff',
          color: '#64748b', fontSize: 13, cursor: 'pointer',
        }}>
          關閉
        </button>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const S = {
  container: {
    minHeight: '100vh', background: '#ffffff', padding: '0 20px 40px',
    fontFamily: "'Noto Sans TC', -apple-system, sans-serif",
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '16px 0', borderBottom: '1px solid #f1f5f9',
  },
  logo: {
    width: 32, height: 32, borderRadius: 8,
    background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 800, color: '#fff',
  },
  card: {
    background: '#fff', border: '1px solid #e2e8f0',
    borderRadius: 14, padding: '18px 20px', marginTop: 16,
  },
  clockBtn: {
    width: '100%', padding: '18px', borderRadius: 16, border: 'none',
    color: '#fff', fontSize: 18, fontWeight: 800, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    boxShadow: '0 4px 16px rgba(0,0,0,0.1)', transition: 'all 0.2s',
  },
}
