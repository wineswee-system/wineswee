import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Calendar, DollarSign, GitBranch, MapPin, Wifi, Loader, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useErrorHandler } from '../../hooks/useErrorHandler'
import { supabase } from '../../lib/supabase'
import { serverClockIn } from '../../lib/db'
import { validateClockIn, haversineMetres, ipMatchesCIDR, getPublicIP, GPS_ACCURACY_THRESHOLD } from '../../lib/clockInValidator'
import { todayTW, nowTimeTW } from '../../lib/datetime'

const ALL_QUICK_ACTIONS = [
  { icon: Calendar, label: '請假', desc: '假單申請', path: '/hr/leave', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)' },
  { icon: DollarSign, label: '薪資', desc: '查看薪資單', path: '/hr/salary', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)', minRole: 'office_staff' },
  { icon: GitBranch, label: '流程', desc: '任務回報', path: '/process/tasks', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  { icon: Calendar, label: '出勤', desc: '出勤紀錄', path: '/hr/attendance', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
]

const ROLE_ORDER = ['store_staff', 'office_staff', 'manager', 'admin', 'super_admin']
const roleAtLeast = (userRole, minRole) => ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole)

export default function PortalHome() {
  const { profile, profileReady } = useAuth()
  const { handleError } = useErrorHandler('portal')
  const [todayAttendance, setTodayAttendance] = useState(null)
  const [pendingTasks, setPendingTasks] = useState(0)
  const [recentLeaves, setRecentLeaves] = useState([])
  const [store, setStore] = useState(null)
  const [clockingIn, setClockingIn] = useState(false)
  const [clockMsg, setClockMsg] = useState(null)
  const [clockMode, setClockMode] = useState('normal')      // normal | overtime | leave | shift_swap | outing
  const [approvedSwaps, setApprovedSwaps] = useState([])    // 已核准且 swap_date=今日 的換班單（換班模式必選）
  const [selectedSwapId, setSelectedSwapId] = useState(null)
  // ★ Live GPS / IP / WiFi 即時狀態（對齊 LIFF Clock.jsx 視覺 feedback）
  const [now, setNow] = useState(new Date())
  const [gpsLocation, setGpsLocation] = useState(null)      // { lat, lng }
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  const [gpsError, setGpsError] = useState('')
  const [gpsWeak, setGpsWeak] = useState(false)
  const [distance, setDistance] = useState(null)            // metres to store
  const [clientIp, setClientIp] = useState(null)
  const [wifiMatch, setWifiMatch] = useState(null)          // null=checking, true/false

  const today = todayTW()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安'

  // 即時時鐘（每秒走）
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // mount 時 poll 一次 GPS + IP
  useEffect(() => {
    if (!profileReady || !profile?.id) return

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords
          setGpsLocation({ lat: latitude, lng: longitude })
          setGpsAccuracy(Math.round(accuracy))
          if (accuracy > GPS_ACCURACY_THRESHOLD) {
            setGpsWeak(true)
            setGpsError(`GPS 精確度不足（${Math.round(accuracy)}m），定位結果僅供參考`)
          } else {
            setGpsWeak(false)
            setGpsError('')
          }
        },
        (err) => setGpsError(err.code === 1 ? '請開啟定位權限' : '無法取得定位'),
        { enableHighAccuracy: true, timeout: 15000 }
      )
    } else {
      setGpsError('此裝置不支援 GPS')
    }

    getPublicIP().then(ip => setClientIp(ip))
  }, [profileReady, profile?.id])

  // 計算距離（GPS + store 都備齊時）
  useEffect(() => {
    if (gpsLocation && store?.lat && store?.lng) {
      setDistance(Math.round(haversineMetres(gpsLocation.lat, gpsLocation.lng, store.lat, store.lng)))
    }
  }, [gpsLocation, store])

  // 檢查 WiFi IP 是否在白名單
  useEffect(() => {
    if (!clientIp || !store?.allowed_wifi?.length) { setWifiMatch(null); return }
    setWifiMatch(store.allowed_wifi.some(rule => ipMatchesCIDR(clientIp, rule)))
  }, [clientIp, store])

  useEffect(() => {
    // ★ 等 profile 完全載入完（含 organization_id）才查；避免「name 有但 id 還沒」的競態
    if (!profileReady || !profile?.id) return

    supabase.from('attendance_records').select('*')
      .eq('employee_id', profile.id).eq('date', today).maybeSingle()
      .then(({ data }) => setTodayAttendance(data))

    supabase.from('tasks').select('id', { count: 'exact', head: true })
      .eq('assignee_id', profile.id).in('status', ['未開始', '進行中'])
      .then(({ count }) => setPendingTasks(count || 0))

    supabase.from('leave_requests').select('*')
      .eq('employee_id', profile.id).order('id', { ascending: false }).limit(5)
      .then(({ data }) => setRecentLeaves(data || []))

    // 抓今天可用的「已核准」換班單 — 換班模式打卡必須對應一張
    supabase.from('shift_swaps').select('id, swap_date, requester_shift, target_shift, requester_id, target_id')
      .eq('status', '已核准').eq('swap_date', today)
      .or(`requester_id.eq.${profile.id},target_id.eq.${profile.id}`)
      .then(({ data }) => setApprovedSwaps(data || []))

    // Load employee's store for clock-in validation
    supabase.from('employees').select('store_id').eq('id', profile.id).maybeSingle()
      .then(({ data }) => {
        if (data?.store_id) {
          supabase.from('stores').select('*').eq('id', data.store_id).maybeSingle()
            .then(({ data: s }) => setStore(s))
        }
      })
  }, [profileReady, profile?.id, today])

  const handleClock = async () => {
    if (!profile?.name) return
    setClockingIn(true)
    setClockMsg(null)
    try {
      // Client-side validation first (blocks if location check fails)
      const result = await validateClockIn(store)

      const action = (todayAttendance?.clock_in && !todayAttendance?.clock_out) ? 'clock_out' : 'clock_in'

      // Server-side validation + record write
      const data = await serverClockIn({
        employee_id: profile.id,
        action,
        lat: result.lat,
        lng: result.lng,
        accuracy: result.accuracy ?? null,   // ?? not || — 0 is a valid GPS accuracy
        ip: result.ip,
        clock_mode: clockMode,
        shift_swap_id: clockMode === 'shift_swap' ? selectedSwapId : null,
      })

      setTodayAttendance(data.record)
      setClockMode('normal')   // reset after successful clock
      setSelectedSwapId(null)
      const timeStr = nowTimeTW()
      const base = action === 'clock_in'
        ? `上班打卡成功 ${timeStr} — ${data.locationName || ''}`
        : `下班打卡成功 ${timeStr}`
      setClockMsg({ type: 'success', text: base })
      // 後端 reminder 訊息（overtime / leave / outing 提醒另送申請單）— 1.5s 後切換顯示，停留 8s
      if (data.reminder) {
        setTimeout(() => setClockMsg({ type: 'warning', text: `⚠️ ${data.reminder}` }), 1500)
        setTimeout(() => setClockMsg(null), 9500)
      } else {
        setTimeout(() => setClockMsg(null), 5000)
      }
    } catch (err) {
      handleError(err, { component: 'PortalHome', errorCode: 'CLOCK_FAILED' })
      setClockMsg({ type: 'error', text: err.message })
    }
    setClockingIn(false)
  }

  const clockStatus = todayAttendance
    ? todayAttendance.clock_out ? '已下班' : '已上班'
    : '尚未打卡'
  const clockColor = todayAttendance
    ? todayAttendance.clock_out ? 'var(--accent-green)' : 'var(--accent-cyan)'
    : 'var(--accent-orange)'
  const clockAction = todayAttendance
    ? todayAttendance.clock_out ? null : '下班打卡'
    : '上班打卡'

  // Mode-driven button colour
  const MODE_META = {
    normal:     { label: '一般',  color: 'var(--accent-cyan)',   dim: 'var(--accent-cyan-dim)',   icon: '🕒' },
    overtime:   { label: '加班',  color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', icon: '⚡' },
    leave:      { label: '請假',  color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)',   icon: '🌴' },
    shift_swap: { label: '換班',  color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)', icon: '🔄' },
    outing:     { label: '外出',  color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)',  icon: '✈️' },
  }
  const modeMeta = MODE_META[clockMode] || MODE_META.normal
  const btnBackground = clockMode === 'normal'
    ? (clockAction === '下班打卡' ? 'var(--accent-orange)' : 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))')
    : modeMeta.color
  const btnShadow = '0 4px 14px rgba(0,0,0,0.25)'
  // shift_swap 換班打卡不再需要換班單（緊急換班亦可使用此模式）

  // ★ Live GPS / WiFi 驗證狀態（給 UI feedback；實際送出仍由 validateClockIn 把關）
  const radius = store?.clock_radius || 150
  const isInRange = distance !== null && distance <= radius && !gpsWeak
  const hasWifiRule = !!store?.allowed_wifi?.length
  const gpsOk = (isInRange || !store?.lat) && !gpsWeak
  const wifiOk = !hasWifiRule || wifiMatch === true
  const canClockByLocation = gpsLocation && (gpsOk || wifiOk)

  return (
    <div className="fade-in">
      {/* Welcome */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(34,211,238,0.08), rgba(59,130,246,0.08), rgba(167,139,250,0.08))',
        border: '1px solid rgba(34,211,238,0.15)',
        borderRadius: 20, padding: '28px 32px', marginBottom: 24,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px', color: 'var(--text-primary)' }}>
            {greeting}，{profile?.name}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            {profile?.dept}{profile?.position ? ` · ${profile.position}` : ''} — {new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>
        {/* 即時時鐘 — 對齊 LIFF Clock.jsx */}
        <div style={{
          fontSize: 32, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          color: 'var(--accent-cyan)', letterSpacing: 1,
        }}>
          {now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </div>
      </div>

      {/* Clock-in Card */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 16, padding: '24px 28px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: clockAction ? 10 : 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              <Clock size={16} style={{ verticalAlign: -3, marginRight: 6 }} /> 今日打卡
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: clockColor }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: clockColor }}>{clockStatus}</span>
              {todayAttendance?.clock_in && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {todayAttendance.clock_in}{todayAttendance.clock_out ? ` → ${todayAttendance.clock_out}` : ''}
                </span>
              )}
            </div>
            {todayAttendance?.clock_in_location && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={10} /> {todayAttendance.clock_in_location}
                {todayAttendance.clock_in_ip && (
                  <span style={{ marginLeft: 8 }}><Wifi size={10} /> {todayAttendance.clock_in_ip}</span>
                )}
              </div>
            )}
            {/* 模式 tag — 非 normal 才顯示（對齊 LIFF） */}
            {((todayAttendance?.clock_in_mode && todayAttendance.clock_in_mode !== 'normal')
              || (todayAttendance?.clock_out_mode && todayAttendance.clock_out_mode !== 'normal')) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {todayAttendance.clock_in_mode && todayAttendance.clock_in_mode !== 'normal' && MODE_META[todayAttendance.clock_in_mode] && (
                  <span style={{
                    padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: MODE_META[todayAttendance.clock_in_mode].dim,
                    color: MODE_META[todayAttendance.clock_in_mode].color,
                  }}>
                    {MODE_META[todayAttendance.clock_in_mode].icon} 上{MODE_META[todayAttendance.clock_in_mode].label}
                  </span>
                )}
                {todayAttendance.clock_out_mode && todayAttendance.clock_out_mode !== 'normal' && MODE_META[todayAttendance.clock_out_mode] && (
                  <span style={{
                    padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: MODE_META[todayAttendance.clock_out_mode].dim,
                    color: MODE_META[todayAttendance.clock_out_mode].color,
                  }}>
                    {MODE_META[todayAttendance.clock_out_mode].icon} 下{MODE_META[todayAttendance.clock_out_mode].label}
                  </span>
                )}
              </div>
            )}
          </div>
          {clockAction && (
            <button
              onClick={handleClock}
              disabled={clockingIn}
              style={{
                padding: '12px 28px', borderRadius: 12, border: 'none',
                background: btnBackground,
                color: '#fff', fontSize: 15, fontWeight: 700, cursor: clockingIn ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                opacity: clockingIn ? 0.6 : 1, transition: 'all 0.2s',
                boxShadow: btnShadow,
              }}
            >
              {clockingIn ? <Loader size={16} className="spin" /> : <Clock size={16} />}
              {clockingIn ? '定位中...' : clockMode === 'normal' ? clockAction : `${modeMeta.label}${clockAction}`}
            </button>
          )}
        </div>

        {/* ── GPS / WiFi 狀態卡（對齊 LIFF）── */}
        {clockAction && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 10,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <MapPin size={13} style={{ color: 'var(--accent-cyan)' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>定位狀態</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                門市：{store?.name || '—'} · 範圍 {radius}m
              </span>
            </div>

            {gpsError ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: gpsWeak ? 'var(--accent-orange)' : 'var(--accent-red)' }}>
                {gpsWeak ? <AlertTriangle size={14} /> : <XCircle size={14} />}
                <span>{gpsError}</span>
              </div>
            ) : !gpsLocation ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>📍 定位中...</div>
            ) : distance !== null && store?.lat ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 8,
                background: isInRange ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)',
              }}>
                {isInRange
                  ? <CheckCircle size={16} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                  : <AlertTriangle size={16} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isInRange ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {isInRange ? '在打卡範圍內' : '不在打卡範圍內'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    距離 {distance >= 1000 ? `${(distance / 1000).toFixed(1)}km` : `${distance}m`} · GPS 精度 {gpsAccuracy}m
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>📍 GPS OK（門市未設座標，跳過範圍檢查）</div>
            )}

            {hasWifiRule && (
              <div style={{
                marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                color: wifiMatch === true ? 'var(--accent-green)' : wifiMatch === false ? 'var(--accent-orange)' : 'var(--text-muted)',
              }}>
                <Wifi size={13} />
                {wifiMatch === null ? '檢查 IP 中...' : wifiMatch ? `WiFi 已連門市網路（${clientIp}）` : `IP（${clientIp}）不在白名單`}
              </div>
            )}

            {!canClockByLocation && gpsLocation && !gpsError && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--accent-orange)' }}>
                ⚠️ GPS 或 WiFi 至少一項要通過才能打卡
              </div>
            )}
          </div>
        )}

        {/* ── 4 模式打卡選擇 ── */}
        {clockAction && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 10 }}>
              {Object.entries(MODE_META).map(([key, m]) => {
                const active = clockMode === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setClockMode(key); if (key !== 'shift_swap') setSelectedSwapId(null) }}
                    style={{
                      padding: '10px 6px', borderRadius: 10, cursor: 'pointer',
                      background: active ? m.dim : 'var(--bg-secondary)',
                      border: `1px solid ${active ? m.color : 'transparent'}`,
                      color: active ? m.color : 'var(--text-secondary)',
                      fontSize: 12, fontWeight: 700, transition: 'all 0.15s',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{m.icon}</span>
                    {m.label}
                  </button>
                )
              })}
            </div>

            {/* ── 模式說明 + 換班單選擇器 ── */}
            <div style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 12,
              background: modeMeta.dim,
              border: `1px solid ${modeMeta.color}`,
              fontSize: 12, lineHeight: 1.5,
            }}>
              {clockMode === 'normal' && (
                <span style={{ color: 'var(--text-secondary)' }}>
                  依排班/辦公時間打卡，超出容許範圍會記遲到/早退。
                </span>
              )}
              {clockMode === 'overtime' && (
                <span style={{ color: 'var(--accent-orange)' }}>
                  ⚡ 加班模式：不受時段限制。打卡成功後請記得另外送出加班申請單。
                </span>
              )}
              {clockMode === 'leave' && (
                <span style={{ color: 'var(--accent-blue)' }}>
                  🌴 請假模式：遲到/早退不計罰，必須在班別時段內。打卡成功後請記得另外送出請假申請單。
                </span>
              )}
              {clockMode === 'outing' && (
                <span style={{ color: 'var(--accent-green)' }}>
                  ✈️ 外出模式：免位置驗證、免時段檢查。打卡成功後請記得另外送出公出申請單。
                </span>
              )}
              {clockMode === 'shift_swap' && (
                <div>
                  <div style={{ color: 'var(--accent-purple)', marginBottom: 8 }}>
                    🔄 換班模式：bypass 時段限制。若有已核准換班單可選填連結，緊急換班可直接打卡。
                  </div>
                  {approvedSwaps.length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                      今日無已核准換班單（緊急換班可直接打卡，之後補送換班申請）
                    </div>
                  ) : (
                    <select
                      value={selectedSwapId || ''}
                      onChange={e => setSelectedSwapId(e.target.value ? parseInt(e.target.value) : null)}
                      style={{
                        width: '100%', padding: '6px 10px', borderRadius: 6,
                        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)', fontSize: 12,
                      }}
                    >
                      <option value="">— 不連結換班單（緊急換班）—</option>
                      {approvedSwaps.map(s => (
                        <option key={s.id} value={s.id}>
                          #{s.id} {s.requester_id === profile.id ? `我${s.requester_shift} ↔ 對方${s.target_shift}` : `對方${s.requester_shift} ↔ 我${s.target_shift}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Clock message */}
        {clockMsg && (
          <div style={{
            padding: '8px 14px', borderRadius: 8, fontSize: 12,
            background: clockMsg.type === 'success' ? 'var(--accent-green-dim)'
              : clockMsg.type === 'error' ? 'var(--accent-red-dim)'
              : clockMsg.type === 'warning' ? 'var(--accent-orange-dim)'
              : 'var(--accent-cyan-dim)',
            color: clockMsg.type === 'success' ? 'var(--accent-green)'
              : clockMsg.type === 'error' ? 'var(--accent-red)'
              : clockMsg.type === 'warning' ? 'var(--accent-orange)'
              : 'var(--accent-cyan)',
          }}>
            {clockMsg.text}
          </div>
        )}
      </div>

      {/* Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 14, padding: '18px 20px',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>待辦任務</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: pendingTasks > 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>
            {pendingTasks}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>項未完成</div>
        </div>

        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 14, padding: '18px 20px',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>請假紀錄</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-blue)' }}>
            {recentLeaves.filter(l => l.status === '已核准').length}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>筆已核准</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>快速操作</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {ALL_QUICK_ACTIONS.filter(a => !a.minRole || roleAtLeast(profile?.role, a.minRole)).map(a => {
            const Icon = a.icon
            return (
              <Link key={a.path} to={a.path} style={{
                textDecoration: 'none',
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                transition: 'all 0.2s', cursor: 'pointer',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, margin: '0 auto 10px',
                  background: a.dim, color: a.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={20} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{a.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.desc}</div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Recent Leaves */}
      {recentLeaves.length > 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 14, padding: '20px 24px',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>近期請假</h3>
          {recentLeaves.map(l => (
            <div key={l.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 0', borderBottom: '1px solid var(--border-subtle)',
            }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{l.type || '假'}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{l.start_date}</span>
                {l.days && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>({l.days}天)</span>}
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: l.status === '已核准' ? 'var(--accent-green-dim)' : l.status === '待審核' ? 'var(--accent-orange-dim)' : 'var(--accent-red-dim)',
                color: l.status === '已核准' ? 'var(--accent-green)' : l.status === '待審核' ? 'var(--accent-orange)' : 'var(--accent-red)',
              }}>{l.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
