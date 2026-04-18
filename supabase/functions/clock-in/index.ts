import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
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

    // ── Resolve employee (id is INT) ─────────────────────
    let emp: any = null

    if (employee_id) {
      const { data } = await supabase
        .from('employees').select('*').eq('id', employee_id).maybeSingle()
      emp = data
    } else if (line_user_id) {
      // Lookup via line_users table → employee_id
      const { data: lineUser } = await supabase
        .from('line_users')
        .select('employee_id')
        .eq('line_user_id', line_user_id)
        .eq('is_verified', true)
        .maybeSingle()

      if (lineUser?.employee_id) {
        const { data } = await supabase
          .from('employees').select('*').eq('id', lineUser.employee_id).maybeSingle()
        emp = data
      }

      // Fallback: check employees.line_user_id directly
      if (!emp) {
        const { data } = await supabase
          .from('employees').select('*').eq('line_user_id', line_user_id).maybeSingle()
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

    // ── Get location config (locations table with GPS columns) ──
    // Try employee's location_id first, then fall back to store name lookup
    let location: any = null

    if (emp.store) {
      const { data } = await supabase
        .from('locations').select('*').eq('name', emp.store).maybeSingle()
      location = data
    }

    // Resolve IP: prefer server-detected IP, fallback to client-reported
    const serverIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || clientIP
    const resolvedIP = serverIP || clientIP || null

    // ── GPS / WiFi Validation ────────────────────────────
    // locations table uses: gps_lat, gps_lng, gps_radius_m, wifi_allowed_ips
    const hasGPSConfig = !!(location?.gps_lat && location?.gps_lng)
    const hasWifiConfig = !!(location?.wifi_allowed_ips && location.wifi_allowed_ips.length > 0)
    const GPS_ACCURACY_THRESHOLD = 200

    let gpsPass = false
    let wifiPass = false
    let method = 'none'
    const reasons: string[] = []

    if (location && (hasGPSConfig || hasWifiConfig)) {
      // GPS check
      if (hasGPSConfig) {
        if (lat != null && lng != null && accuracy != null && accuracy <= GPS_ACCURACY_THRESHOLD) {
          const dist = haversineMetres(lat, lng, Number(location.gps_lat), Number(location.gps_lng))
          const radius = location.gps_radius_m || 200
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
          wifiPass = location.wifi_allowed_ips.some((cidr: string) => ipMatchesCIDR(resolvedIP, cidr))
          if (!wifiPass) {
            reasons.push(`IP（${resolvedIP}）不在 WiFi 白名單`)
          }
        } else {
          reasons.push('無法取得網路 IP')
        }
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

    // Check existing record for today
    const { data: existing } = await supabase
      .from('attendance_records').select('*')
      .eq('employee_id', emp.id).eq('date', dateStr).maybeSingle()

    // Also try by name for legacy records without employee_id
    let existingRecord = existing
    if (!existingRecord) {
      const { data: legacyExisting } = await supabase
        .from('attendance_records').select('*')
        .eq('employee', emp.name).eq('date', dateStr).maybeSingle()
      existingRecord = legacyExisting
    }

    // ── Determine late status from schedules table ──────
    // schedules has: employee_id (INT), employee (TEXT), date, shift_type, start_time, end_time
    const determineLateStatus = async (): Promise<{ status: string; isLate: boolean; lateMinutes: number }> => {
      // Look up today's schedule — try by employee_id first, then name
      let schedule: any = null
      const { data: s1 } = await supabase
        .from('schedules')
        .select('shift_type, start_time')
        .eq('employee_id', emp.id)
        .eq('date', dateStr)
        .maybeSingle()
      schedule = s1

      if (!schedule) {
        const { data: s2 } = await supabase
          .from('schedules')
          .select('shift_type, start_time')
          .eq('employee', emp.name)
          .eq('date', dateStr)
          .maybeSingle()
        schedule = s2
      }

      if (schedule?.start_time) {
        const [startH, startM] = (schedule.start_time as string).split(':').map(Number)
        const lateMinutes = (hours24 * 60 + minutes) - (startH * 60 + startM)
        if (lateMinutes > 5) { // 5 分鐘寬限
          return { status: '遲到', isLate: true, lateMinutes }
        }
        return { status: '正常', isLate: false, lateMinutes: 0 }
      }

      // Fallback: default 09:00 threshold
      const lateMinutes = (hours24 * 60 + minutes) - (9 * 60)
      if (lateMinutes > 5) {
        return { status: '遲到', isLate: true, lateMinutes }
      }
      return { status: '正常', isLate: false, lateMinutes: 0 }
    }

    let record
    if (action === 'clock_in') {
      if (existingRecord?.clock_in) {
        return new Response(JSON.stringify({ error: '今日已打過上班卡' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { status, isLate, lateMinutes } = await determineLateStatus()

      const { data, error } = await supabase.from('attendance_records').upsert({
        employee: emp.name,
        employee_id: emp.id,
        date: dateStr,
        clock_in: timeStr,
        status,
        total_hours: 0,
        is_late: isLate,
        late_minutes: lateMinutes,
        clock_in_lat: lat || null,
        clock_in_lng: lng || null,
        clock_in_distance_m: method === 'gps' && lat && lng && location?.gps_lat ? Math.round(haversineMetres(lat, lng, Number(location.gps_lat), Number(location.gps_lng))) : null,
        clock_in_method: method,
      }).select().single()
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
      // Calculate hours using Taiwan time (minutes-based, no timezone issues)
      const [inH, inM] = (existingRecord.clock_in as string).split(':').map(Number)
      const workedHours = ((hours24 * 60 + minutes) - (inH * 60 + inM)) / 60
      const { data, error } = await supabase.from('attendance_records')
        .update({
          clock_out: timeStr,
          clock_out_time: now.toISOString(),
          total_hours: parseFloat(workedHours.toFixed(2)),
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
