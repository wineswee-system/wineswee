import { useState, useEffect } from 'react'
import { Clock, MapPin, Wifi, Loader, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useErrorHandler } from '../../hooks/useErrorHandler'
import { supabase } from '../../lib/supabase'
import { serverClockIn } from '../../lib/db'
import { validateClockIn, haversineMetres, ipMatchesCIDR, getPublicIP, GPS_ACCURACY_THRESHOLD } from '../../lib/clockInValidator'
import { todayTW, nowTimeTW } from '../../lib/datetime'

export default function PortalHome() {
  const { profile, profileReady } = useAuth()
  const { handleError } = useErrorHandler('portal')
  const [todayAttendance, setTodayAttendance] = useState(null)
  const [recentAttendance, setRecentAttendance] = useState([])  // 最近 7 天打卡紀錄
  const [store, setStore] = useState(null)
  const [clockingIn, setClockingIn] = useState(false)
  const [clockMsg, setClockMsg] = useState(null)
  const [clockMode, setClockMode] = useState('normal')      // normal | outing (2026-05-28 簡化 5 → 2)
  const [confirmOut, setConfirmOut] = useState(false)       // 下班打卡 confirm modal
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

    // 最近 7 天打卡紀錄（含今天）
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10)
    supabase.from('attendance_records').select('date, clock_in, clock_out, hours, status, clock_in_mode, clock_out_mode, clock_in_location')
      .eq('employee_id', profile.id)
      .gte('date', sevenDaysAgoStr)
      .lte('date', today)
      .order('date', { ascending: false })
      .then(({ data }) => setRecentAttendance(data || []))

    // Load employee's store for clock-in validation
    supabase.from('employees').select('store_id').eq('id', profile.id).maybeSingle()
      .then(({ data }) => {
        if (data?.store_id) {
          supabase.from('stores').select('*').eq('id', data.store_id).maybeSingle()
            .then(({ data: s }) => setStore(s))
        }
      })
  }, [profileReady, profile?.id, today])

  const handleClock = async (confirmed = false) => {
    if (!profile?.name) return
    const action = (todayAttendance?.clock_in && !todayAttendance?.clock_out) ? 'clock_out' : 'clock_in'
    // ★ 下班打卡 — 加 confirm 防誤觸
    if (action === 'clock_out' && !confirmed) {
      setConfirmOut(true)
      return
    }
    setConfirmOut(false)
    setClockingIn(true)
    setClockMsg(null)
    try {
      // Client-side validation first (blocks if location check fails)
      const result = await validateClockIn(store)

      // Server-side validation + record write
      const data = await serverClockIn({
        employee_id: profile.id,
        action,
        lat: result.lat,
        lng: result.lng,
        accuracy: result.accuracy ?? null,   // ?? not || — 0 is a valid GPS accuracy
        ip: result.ip,
        clock_mode: clockMode,
      })

      setTodayAttendance(data.record)
      setClockMode('normal')   // reset after successful clock
      const timeStr = nowTimeTW()
      const base = action === 'clock_in'
        ? `上班打卡成功 ${timeStr} — ${data.locationName || ''}`
        : `下班打卡成功 ${timeStr}`
      setClockMsg({ type: 'success', text: base })
      // 後端 reminder 訊息（outing 模式提醒）— 1.5s 後切換顯示，停留 8s
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

  // Mode-driven button colour（2026-05-28 簡化：2 模式）
  const MODE_META = {
    normal: { label: '一般', color: 'var(--accent-cyan)',  dim: 'var(--accent-cyan-dim)',  icon: '🕒' },
    outing: { label: '外出', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)', icon: '✈️' },
  }
  const modeMeta = MODE_META[clockMode] || MODE_META.normal
  const btnBackground = clockMode === 'normal'
    ? (clockAction === '下班打卡' ? 'var(--accent-orange)' : 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))')
    : modeMeta.color
  const btnShadow = '0 4px 14px rgba(0,0,0,0.25)'

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
              onClick={() => handleClock()}
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

        {/* ── 2 模式打卡選擇（2026-05-28 簡化）── */}
        {clockAction && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 10 }}>
              {Object.entries(MODE_META).map(([key, m]) => {
                const active = clockMode === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setClockMode(key)}
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

            {/* ── 模式說明 ── */}
            <div style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 12,
              background: modeMeta.dim,
              border: `1px solid ${modeMeta.color}`,
              fontSize: 12, lineHeight: 1.5,
            }}>
              {clockMode === 'normal' && (
                <span style={{ color: 'var(--text-secondary)' }}>
                  🕒 一般打卡：須在店內網路或 GPS 範圍內。
                </span>
              )}
              {clockMode === 'outing' && (
                <span style={{ color: 'var(--accent-green)' }}>
                  ✈️ 外出打卡：免位置驗證，紀錄標籤為「外出」。
                </span>
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

      {/* 近期打卡紀錄 — 對齊 LIFF Clock，只放自己的紀錄 */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 14, padding: '20px 24px',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>
          近期打卡紀錄（最近 7 天）
        </h3>
        {recentAttendance.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
            尚無打卡紀錄
          </div>
        ) : recentAttendance.map(r => {
          const inMode = MODE_META[r.clock_in_mode]
          const outMode = MODE_META[r.clock_out_mode]
          const showInTag = r.clock_in_mode && r.clock_in_mode !== 'normal' && inMode
          const showOutTag = r.clock_out_mode && r.clock_out_mode !== 'normal' && outMode && r.clock_out_mode !== r.clock_in_mode
          const statusColor =
            r.status === '正常'   ? 'var(--accent-green)'
          : r.status === '遲到'   ? 'var(--accent-orange)'
          : r.status === '加班'   ? 'var(--accent-purple)'
          : r.status === '請假'   ? 'var(--accent-blue)'
          : r.status === '外出'   ? 'var(--accent-green)'
          : r.status === '補登'   ? 'var(--accent-cyan)'
          : 'var(--text-muted)'
          const statusDim =
            r.status === '正常'   ? 'var(--accent-green-dim)'
          : r.status === '遲到'   ? 'var(--accent-orange-dim)'
          : r.status === '加班'   ? 'var(--accent-purple-dim)'
          : r.status === '請假'   ? 'var(--accent-blue-dim)'
          : r.status === '外出'   ? 'var(--accent-green-dim)'
          : r.status === '補登'   ? 'var(--accent-cyan-dim)'
          : 'var(--bg-secondary)'
          return (
            <div key={r.date} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 0', borderBottom: '1px solid var(--border-subtle)', gap: 12,
            }}>
              <div style={{ minWidth: 80 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {r.date?.slice(5) /* MM-DD */}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {new Date(r.date).toLocaleDateString('zh-TW', { weekday: 'short' })}
                </div>
              </div>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>上 <strong style={{ color: r.clock_in ? 'var(--accent-green)' : 'var(--text-muted)' }}>{r.clock_in || '--:--'}</strong></span>
                <span>下 <strong style={{ color: r.clock_out ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>{r.clock_out || '--:--'}</strong></span>
                {r.hours != null && <span style={{ color: 'var(--text-muted)' }}>{r.hours}h</span>}
                {showInTag && (
                  <span style={{
                    padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                    background: inMode.dim, color: inMode.color,
                  }}>{inMode.icon} 上{inMode.label}</span>
                )}
                {showOutTag && (
                  <span style={{
                    padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                    background: outMode.dim, color: outMode.color,
                  }}>{outMode.icon} 下{outMode.label}</span>
                )}
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: statusDim, color: statusColor, flexShrink: 0,
              }}>{r.status || '—'}</span>
            </div>
          )
        })}
      </div>

      {/* 下班打卡 確認 modal — 防誤觸 */}
      {confirmOut && (
        <div
          onClick={() => setConfirmOut(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 400,
              background: 'var(--bg-card)', borderRadius: 16, padding: '28px 24px',
              textAlign: 'center', border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: 44, marginBottom: 10 }}>👋</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
              確認下班打卡？
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              已上班 {todayAttendance?.clock_in || '--:--'} → 現在 {nowTimeTW()}
            </div>
            <div style={{ fontSize: 12, color: 'var(--accent-orange)', marginBottom: 22 }}>
              ⚠️ 下班打卡後無法再修改，請確認真的要下班了再按
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmOut(false)}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10,
                  background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={() => handleClock(true)}
                disabled={clockingIn}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10,
                  background: 'var(--accent-orange)', color: '#fff', border: 'none',
                  fontSize: 14, fontWeight: 700, cursor: clockingIn ? 'not-allowed' : 'pointer',
                  opacity: clockingIn ? 0.6 : 1,
                }}
              >
                {clockingIn ? '處理中...' : '確認下班'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
