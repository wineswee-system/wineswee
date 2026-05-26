import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const SITE_URL = Deno.env.get('SITE_URL') || 'https://sme-ops-system.vercel.app'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Helpers ──────────────────────────────────────────────

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function ipMatchesCIDR(ip: string, cidr: string): boolean {
  const trimmed = cidr.trim()
  if (!trimmed) return false
  const ipToNum = (s: string): number | null => {
    const parts = s.split('.')
    if (parts.length !== 4) return null
    let num = 0
    for (const p of parts) {
      const n = parseInt(p, 10)
      if (isNaN(n) || n < 0 || n > 255) return null
      num = (num << 8) + n
    }
    return num >>> 0
  }
  const ipNum = ipToNum(ip)
  if (ipNum === null) return false
  if (trimmed.includes('/')) {
    const [network, bitsStr] = trimmed.split('/')
    const bits = parseInt(bitsStr, 10)
    if (isNaN(bits) || bits < 0 || bits > 32) return false
    const netNum = ipToNum(network)
    if (netNum === null) return false
    const mask = bits === 0 ? 0 : ~((1 << (32 - bits)) - 1) >>> 0
    return (ipNum & mask) === (netNum & mask)
  }
  return ip === trimmed
}

// ── Edge Function ────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const {
      employee_id,     // employee id (INT) — primary lookup
      line_user_id,    // LINE user ID — lookup via line_users table
      employee,        // employee name (string) — legacy fallback
      action,
      lat, lng, accuracy,
      ip: clientIP,
    } = body

    if (!action) {
      return new Response(JSON.stringify({ error: '缺少必要參數 (action)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!employee_id && !line_user_id && !employee) {
      return new Response(JSON.stringify({ error: '缺少必要參數 (employee_id, line_user_id, 或 employee)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── JWT required for all non-LINE paths ─────────────────
    if (!line_user_id) {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        return new Response(JSON.stringify({ error: '未授權：請提供 Authorization header' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: authError } = await supabase.auth.getUser(token)
      if (authError || !user) {
        return new Response(JSON.stringify({ error: '憑證無效' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // Proxy clock-in: only admin/super_admin may clock in for another employee
      if (employee_id) {
        const { data: authEmp } = await supabase
          .from('employees').select('id, role, roles(name)').eq('email', user.email).maybeSingle()
        const authRole = (authEmp?.roles as any)?.name ?? authEmp?.role
        if (authEmp && authEmp.id !== employee_id && !['admin', 'super_admin'].includes(authRole)) {
          return new Response(JSON.stringify({ error: '無權代替他人打卡' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }
    }

    // ── Resolve employee (id is INT) ─────────────────────
    let emp: any = null

    if (employee_id) {
      const { data } = await supabase
        .from('employees').select('*').eq('id', employee_id).maybeSingle()
      emp = data
    } else if (line_user_id) {
      // Lookup via multi-OA mapping: employee_line_accounts → employees
      const { data: ela } = await supabase
        .from('employee_line_accounts')
        .select('employee_id')
        .eq('line_user_id', line_user_id)
        .eq('is_verified', true)
        .limit(1)
        .maybeSingle()

      if (ela?.employee_id) {
        const { data } = await supabase
          .from('employees').select('*').eq('id', ela.employee_id).maybeSingle()
        emp = data
      }
    } else if (employee) {
      const { data } = await supabase
        .from('employees').select('*').eq('name', employee).maybeSingle()
      emp = data
    }

    if (!emp) {
      return new Response(JSON.stringify({ error: '找不到員工資料' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Get location config (stores table) ──
    // [Fix 4, 5] Fetch clock_in_method and early_clock_minutes in addition to existing cols
    let location: any = null
    let empStoreName: string | null = null

    if (emp.store_id) {
      const { data: store } = await supabase
        .from('stores')
        .select('id, name, lat, lng, clock_radius, allowed_wifi, clock_in_method, early_clock_minutes, has_office_hours, office_hours_start, late_tolerance_minutes')
        .eq('id', emp.store_id)
        .maybeSingle()
      empStoreName = store?.name ?? null
      location = store
    }

    // Resolve IP: prefer server-detected IP, fallback to client-reported
    const serverIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || clientIP
    const resolvedIP = serverIP || clientIP || null

    // ── GPS / WiFi Validation ────────────────────────────
    const hasGPSConfig = !!(location?.lat != null && location?.lng != null)
    const hasWifiConfig = !!(location?.allowed_wifi && location.allowed_wifi.length > 0)
    const GPS_ACCURACY_THRESHOLD = 200
    // [Fix 4] Read clock_in_method to enforce GPS-only policy
    const requireGPSOnly = location?.clock_in_method === 'gps_required'

    let gpsPass = false
    let wifiPass = false
    let method = 'none'
    const reasons: string[] = []

    if (location && (hasGPSConfig || hasWifiConfig)) {
      // GPS check
      if (hasGPSConfig) {
        if (lat != null && lng != null && accuracy != null && accuracy <= GPS_ACCURACY_THRESHOLD) {
          const dist = haversineMetres(lat, lng, Number(location.lat), Number(location.lng))
          const radius = location.clock_radius || 200
          gpsPass = dist <= radius
          if (!gpsPass) {
            reasons.push(`GPS 距離超出範圍（${Math.round(dist)}m / 限 ${radius}m）`)
          }
        } else if (accuracy != null && accuracy > GPS_ACCURACY_THRESHOLD) {
          reasons.push(`GPS 精確度不足（${Math.round(accuracy)}m）`)
        } else {
          reasons.push('未提供 GPS 資料')
        }
      }

      // WiFi check
      if (hasWifiConfig) {
        if (resolvedIP) {
          wifiPass = location.allowed_wifi.some((cidr: string) => ipMatchesCIDR(resolvedIP, cidr))
          if (!wifiPass) {
            reasons.push(`IP（${resolvedIP}）不在 WiFi 白名單`)
          }
        } else {
          reasons.push('無法取得網路 IP')
        }
      }

      // [Fix 4] Enforce gps_required: WiFi-only pass is not acceptable
      if (requireGPSOnly && !gpsPass) {
        return new Response(JSON.stringify({
          error: '打卡失敗：此據點要求 GPS 驗證',
          reasons: ['此據點設定僅允許 GPS 打卡，WiFi 驗證不適用', ...reasons],
          ip: resolvedIP,
        }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!gpsPass && !wifiPass) {
        return new Response(JSON.stringify({
          error: '打卡失敗：位置驗證未通過',
          reasons,
          ip: resolvedIP,
        }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      method = gpsPass ? 'gps' : 'wifi'
    }

    // ── Write attendance record (Taiwan time UTC+8) ─────
    const now = new Date()
    const taiwanNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const dateStr = taiwanNow.toISOString().slice(0, 10)
    const hours24 = taiwanNow.getUTCHours()
    const minutes = taiwanNow.getUTCMinutes()
    const timeStr = `${String(hours24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    const currentMinutes = hours24 * 60 + minutes

    // Check existing record for today (used for duplicate guard and clock_out reference)
    const { data: existingRecord } = await supabase
      .from('attendance_records').select('*')
      .eq('employee_id', emp.id).eq('date', dateStr).maybeSingle()

    // ── Determine late status + early-clock-in check ──────────────────
    // [Fix 3] Uses store late_tolerance_minutes in both schedule and fallback paths.
    // [Fix 5] Returns tooEarly flag when employee clocks in before allowed window.
    const determineLateStatus = async (): Promise<{
      status: string
      isLate: boolean
      lateMinutes: number
      tooEarly: boolean
      tooEarlyMinutes: number
    }> => {
      const storeTolerance: number = location?.late_tolerance_minutes ?? 5
      const earlyWindow: number    = location?.early_clock_minutes    ?? 30

      const { data: schedule } = await supabase
        .from('schedules')
        .select('shift_type, start_time')
        .eq('employee_id', emp.id)
        .eq('date', dateStr)
        .maybeSingle()

      if (schedule?.start_time) {
        const [startH, startM] = (schedule.start_time as string).split(':').map(Number)
        const shiftStartMinutes = startH * 60 + startM

        // [Fix 5] Early clock-in check (with cross-midnight correction for night shifts)
        let minsUntilShift = shiftStartMinutes - currentMinutes
        if (minsUntilShift > 720)  minsUntilShift -= 1440  // shift is yesterday
        if (minsUntilShift < -720) minsUntilShift += 1440  // shift is tomorrow
        if (minsUntilShift > earlyWindow) {
          return { status: '提早打卡', isLate: false, lateMinutes: 0, tooEarly: true, tooEarlyMinutes: minsUntilShift }
        }

        // [Fix 3] Use storeTolerance (was hardcoded 5)
        let lateMinutes = currentMinutes - shiftStartMinutes
        if (lateMinutes < -720) lateMinutes += 1440  // cross-midnight night shift
        if (lateMinutes > storeTolerance) {
          return { status: '遲到', isLate: true, lateMinutes, tooEarly: false, tooEarlyMinutes: 0 }
        }
        return { status: '正常', isLate: false, lateMinutes: 0, tooEarly: false, tooEarlyMinutes: 0 }
      }

      // Fallback: use store's office hours start if configured, else 09:00
      const officeStart: string | null = (location?.has_office_hours && location?.office_hours_start)
        ? String(location.office_hours_start).slice(0, 5)
        : null
      const [fbH, fbM] = officeStart ? officeStart.split(':').map(Number) : [9, 0]
      const shiftStartMinutes = fbH * 60 + fbM

      // [Fix 5] Early clock-in check for office-hours fallback
      const minsUntilShift = shiftStartMinutes - currentMinutes
      if (minsUntilShift > earlyWindow) {
        return { status: '提早打卡', isLate: false, lateMinutes: 0, tooEarly: true, tooEarlyMinutes: minsUntilShift }
      }

      const lateMinutes = currentMinutes - shiftStartMinutes
      if (lateMinutes > storeTolerance) {
        return { status: '遲到', isLate: true, lateMinutes, tooEarly: false, tooEarlyMinutes: 0 }
      }
      return { status: '正常', isLate: false, lateMinutes: 0, tooEarly: false, tooEarlyMinutes: 0 }
    }

    let record
    if (action === 'clock_in') {
      if (existingRecord?.clock_in) {
        return new Response(JSON.stringify({ error: '今日已打過上班卡' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { status, isLate, lateMinutes, tooEarly, tooEarlyMinutes } = await determineLateStatus()

      // [Fix 5] Reject early clock-in that exceeds the allowed window
      if (tooEarly) {
        return new Response(JSON.stringify({
          error: `打卡失敗：距上班時間尚有 ${tooEarlyMinutes} 分鐘，超出提前打卡容許範圍（${location?.early_clock_minutes ?? 30} 分鐘）`,
          tooEarlyMinutes,
        }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // [Fix 7] Use insert (not upsert) — unique constraint att_records_emp_date_uniq
      // catches any concurrent duplicate that slips past the existingRecord check above.
      const { data, error } = await supabase.from('attendance_records').insert({
        employee_id: emp.id,
        date: dateStr,
        clock_in: timeStr,
        status,
        total_hours: 0,
        is_late: isLate,
        late_minutes: lateMinutes,
        clock_in_lat: lat || null,
        clock_in_lng: lng || null,
        clock_in_distance_m: method === 'gps' && lat && lng && location?.lat != null
          ? Math.round(haversineMetres(lat, lng, Number(location.lat), Number(location.lng)))
          : null,
        clock_in_method: method,
        organization_id: (emp as any).organization_id || null,
      }).select().single()

      if (error?.code === '23505') {
        // Unique violation — concurrent double clock-in
        return new Response(JSON.stringify({ error: '今日已打過上班卡' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (error) throw error
      record = data

    } else if (action === 'clock_out') {
      if (!existingRecord?.clock_in) {
        return new Response(JSON.stringify({ error: '尚未打上班卡' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (existingRecord.clock_out) {
        return new Response(JSON.stringify({ error: '今日已打過下班卡' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // [Fix 1] Cross-midnight correction: e.g. clock_in=22:00 clock_out=06:00 → 8h not -16h
      const [inH, inM] = (existingRecord.clock_in as string).split(':').map(Number)
      let workedMinutes = currentMinutes - (inH * 60 + inM)
      if (workedMinutes < 0) workedMinutes += 1440

      const { data, error } = await supabase.from('attendance_records')
        .update({
          clock_out: timeStr,
          clock_out_time: now.toISOString(),
          total_hours: parseFloat((workedMinutes / 60).toFixed(2)),
        })
        .eq('id', existingRecord.id)
        .select().single()
      if (error) throw error
      record = data

    } else {
      return new Response(JSON.stringify({ error: 'action 必須是 clock_in 或 clock_out' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({
      success: true,
      record,
      method,
      locationName: location?.name || '未知',
      ip: resolvedIP,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message || '伺服器錯誤' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
