import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const SITE_URL = Deno.env.get('SITE_URL') || 'https://sme-ops-system.vercel.app'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_ROLES = ['admin', 'super_admin'] as const

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
      is_overtime = false,   // 加班模式：bypass tolerance windows, auto-create overtime_requests
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
    let jwtAuthEmp: any = null

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
      // Fetch the requesting user's employee record — used for proxy guard below.
      const { data: ae } = await supabase
        .from('employees').select('id, role, roles(name)').eq('email', user.email).maybeSingle()
      jwtAuthEmp = ae
    }

    // ── Resolve employee (id is INT) ─────────────────────
    let emp: any = null

    if (employee_id) {
      const { data } = await supabase
        .from('employees').select('*').eq('id', employee_id).maybeSingle()
      emp = data
    } else if (line_user_id) {
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

    // Proxy guard — covers all identifier forms (employee_id INT, line_user_id, name).
    // Only admin/super_admin may clock in on behalf of another employee.
    if (jwtAuthEmp && jwtAuthEmp.id !== emp.id) {
      const authRole = (jwtAuthEmp?.roles as any)?.name ?? jwtAuthEmp?.role
      if (!ADMIN_ROLES.includes(authRole)) {
        return new Response(JSON.stringify({ error: '無權代替他人打卡' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // ── Get location config (stores table) ──
    let location: any = null

    if (emp.store_id) {
      const { data: store } = await supabase
        .from('stores')
        .select('id, name, lat, lng, clock_radius, allowed_wifi, clock_in_method, early_clock_minutes, has_office_hours, office_hours_start, office_hours_end, late_tolerance_minutes')
        .eq('id', emp.store_id)
        .maybeSingle()
      location = store
    }

    // Resolve IP
    const serverIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || clientIP
    const resolvedIP = serverIP || clientIP || null

    // ── GPS / WiFi Validation ────────────────────────────
    // GPS/WiFi always enforced — overtime only bypasses TIME windows, not location.
    const hasGPSConfig = !!(location?.lat != null && location?.lng != null)
    const hasWifiConfig = !!(location?.allowed_wifi && location.allowed_wifi.length > 0)
    const GPS_ACCURACY_THRESHOLD = 200
    const requireGPSOnly = location?.clock_in_method === 'gps_required'

    let gpsPass = false
    let wifiPass = false
    let method = 'none'
    const reasons: string[] = []

    if (location && (hasGPSConfig || hasWifiConfig)) {
      if (hasGPSConfig) {
        if (lat != null && lng != null && accuracy != null && accuracy <= GPS_ACCURACY_THRESHOLD) {
          const dist = haversineMetres(lat, lng, Number(location.lat), Number(location.lng))
          const radius = location.clock_radius || 200
          gpsPass = dist <= radius
          if (!gpsPass) reasons.push(`GPS 距離超出範圍（${Math.round(dist)}m / 限 ${radius}m）`)
        } else if (accuracy != null && accuracy > GPS_ACCURACY_THRESHOLD) {
          reasons.push(`GPS 精確度不足（${Math.round(accuracy)}m）`)
        } else {
          reasons.push('未提供 GPS 資料')
        }
      }

      if (hasWifiConfig) {
        if (resolvedIP) {
          wifiPass = location.allowed_wifi.some((cidr: string) => ipMatchesCIDR(resolvedIP, cidr))
          if (!wifiPass) reasons.push(`IP（${resolvedIP}）不在 WiFi 白名單`)
        } else {
          reasons.push('無法取得網路 IP')
        }
      }

      if (requireGPSOnly && !gpsPass) {
        return new Response(JSON.stringify({
          error: '打卡失敗：此據點要求 GPS 驗證',
          reasons: ['此據點設定僅允許 GPS 打卡，WiFi 驗證不適用', ...reasons],
          ip: resolvedIP,
        }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      if (!gpsPass && !wifiPass) {
        return new Response(JSON.stringify({
          error: '打卡失敗：位置驗證未通過',
          reasons,
          ip: resolvedIP,
        }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      method = gpsPass ? 'gps' : 'wifi'
    }

    // ── Taiwan time ─────────────────────────────────────
    const now = new Date()
    const taiwanNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const dateStr = taiwanNow.toISOString().slice(0, 10)
    const hours24 = taiwanNow.getUTCHours()
    const minutes = taiwanNow.getUTCMinutes()
    const timeStr = `${String(hours24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    const currentMinutes = hours24 * 60 + minutes

    // Existing record (duplicate guard + clock_out reference)
    const { data: existingRecord } = await supabase
      .from('attendance_records').select('*')
      .eq('employee_id', emp.id).eq('date', dateStr).maybeSingle()

    // ── Late / early-clock check (skipped in overtime mode) ───────────────────
    const determineLateStatus = async (): Promise<{
      status: string
      isLate: boolean
      lateMinutes: number
      tooEarly: boolean
      tooEarlyMinutes: number
    }> => {
      const storeTolerance: number = location?.late_tolerance_minutes ?? 5
      const earlyWindow: number    = location?.early_clock_minutes    ?? 30

      // `shift` = shift name, `actual_start` = per-day override.
      // shift_type / start_time do NOT exist on schedules — they live on shift_definitions.
      const { data: schedule } = await supabase
        .from('schedules')
        .select('shift, actual_start')
        .eq('employee_id', emp.id)
        .eq('date', dateStr)
        .maybeSingle()

      // Resolve the effective shift start: actual_start override → shift_definitions lookup
      let resolvedStartTime: string | null = null
      if (schedule?.actual_start) {
        resolvedStartTime = String(schedule.actual_start).slice(0, 5)
      } else if (schedule?.shift) {
        const { data: shiftDef } = await supabase
          .from('shift_definitions')
          .select('start_time')
          .eq('name', schedule.shift)
          .or(`store_id.eq.${emp.store_id ?? 0},store_id.is.null`)
          .order('store_id', { ascending: false, nullsFirst: false })  // prefer store-specific over global
          .limit(1)
          .maybeSingle()
        resolvedStartTime = shiftDef?.start_time?.slice(0, 5) ?? null
      }

      if (resolvedStartTime) {
        const [startH, startM] = resolvedStartTime.split(':').map(Number)
        const shiftStartMinutes = startH * 60 + startM

        // Early check — no cross-midnight correction needed (schedule is date-scoped)
        const minsUntilShift = shiftStartMinutes - currentMinutes
        if (minsUntilShift > earlyWindow) {
          return { status: '提早打卡', isLate: false, lateMinutes: 0, tooEarly: true, tooEarlyMinutes: minsUntilShift }
        }

        // Late check
        let lateMinutes = currentMinutes - shiftStartMinutes
        if (lateMinutes < -720) lateMinutes += 1440  // cross-midnight night shift
        if (lateMinutes > storeTolerance) {
          return { status: '遲到', isLate: true, lateMinutes, tooEarly: false, tooEarlyMinutes: 0 }
        }
        return { status: '正常', isLate: false, lateMinutes: 0, tooEarly: false, tooEarlyMinutes: 0 }
      }

      // Fallback: store office hours start, else 09:00
      const officeStart: string | null = (location?.has_office_hours && location?.office_hours_start)
        ? String(location.office_hours_start).slice(0, 5)
        : null
      const [fbH, fbM] = officeStart ? officeStart.split(':').map(Number) : [9, 0]
      const shiftStartMinutes = fbH * 60 + fbM

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

    // ── clock_in ─────────────────────────────────────────
    let record: any
    if (action === 'clock_in') {
      if (existingRecord?.clock_in) {
        return new Response(JSON.stringify({ error: '今日已打過上班卡' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let clockStatus = '正常'
      let isLate = false
      let lateMinutes = 0
      let overtimeRequestId: number | null = null

      if (is_overtime) {
        // ── Overtime mode: skip all time-window checks ──────────────────────
        // Auto-create a pending overtime_requests row; hours filled at clock_out.
        clockStatus = '加班'

        const { data: otReq, error: otErr } = await supabase
          .from('overtime_requests')
          .insert({
            employee_id:     emp.id,
            employee:        emp.name,
            date:            dateStr,
            hours:           0,          // placeholder — updated at clock_out
            reason:          `打卡申請加班（上班 ${timeStr}，時數待確認）`,
            status:          '待審核',
            organization_id: (emp as any).organization_id || null,
            source:          'clock_in',
          })
          .select('id')
          .single()

        if (otErr) throw otErr
        overtimeRequestId = otReq.id

      } else {
        // ── Normal mode: enforce time windows ──────────────────────────────
        const result = await determineLateStatus()

        if (result.tooEarly) {
          return new Response(JSON.stringify({
            error: `打卡失敗：距上班時間尚有 ${result.tooEarlyMinutes} 分鐘，超出提前打卡容許範圍（${location?.early_clock_minutes ?? 30} 分鐘）`,
            tooEarlyMinutes: result.tooEarlyMinutes,
          }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        clockStatus  = result.status
        isLate       = result.isLate
        lateMinutes  = result.lateMinutes
      }

      const { data, error } = await supabase.from('attendance_records').insert({
        employee_id:         emp.id,
        store_id:            (emp as any).store_id || null,
        date:                dateStr,
        clock_in:            timeStr,
        status:              clockStatus,
        total_hours:         0,
        is_late:             isLate,
        late_minutes:        lateMinutes,
        is_overtime:         is_overtime,
        overtime_request_id: overtimeRequestId,
        clock_in_lat:        lat || null,
        clock_in_lng:        lng || null,
        clock_in_distance_m: method === 'gps' && lat && lng && location?.lat != null
          ? Math.round(haversineMetres(lat, lng, Number(location.lat), Number(location.lng)))
          : null,
        clock_in_method:     method,
        clock_in_location:   location?.name || null,
        clock_in_ip:         resolvedIP || null,
        organization_id:     (emp as any).organization_id || null,
      }).select().single()

      if (error?.code === '23505') {
        return new Response(JSON.stringify({ error: '今日已打過上班卡' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (error) throw error
      record = data

      // Back-link: stamp attendance_record_id onto the overtime request
      if (overtimeRequestId && record?.id) {
        await supabase.from('overtime_requests')
          .update({ attendance_record_id: record.id })
          .eq('id', overtimeRequestId)
      }

    // ── clock_out ────────────────────────────────────────
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

      // Early-leave check against office hours end (symmetric with late-arrival tolerance).
      if (!is_overtime && location?.has_office_hours && location?.office_hours_end) {
        const storeTolerance: number = location?.late_tolerance_minutes ?? 5
        const officeEndStr = String(location.office_hours_end).slice(0, 5)
        const [oeH, oeM] = officeEndStr.split(':').map(Number)
        const officeEndMinutes = oeH * 60 + oeM
        // Mirror the pattern used in determineLateStatus: compute raw diff and only
        // apply +1440 when the result is impossibly negative (office ends past midnight).
        // The dual-pivot approach (< 9*60 on both) was broken for daytime offices —
        // clocking out at 08:45 against a 17:00 end incorrectly skipped the block.
        let earlyLeaveMinutes = officeEndMinutes - currentMinutes
        if (earlyLeaveMinutes < -720) earlyLeaveMinutes += 1440   // office spans midnight
        if (earlyLeaveMinutes > storeTolerance) {
          return new Response(JSON.stringify({
            error: `打卡失敗：距下班時間尚有 ${earlyLeaveMinutes} 分鐘（辦公時間至 ${officeEndStr}，容許提早 ${storeTolerance} 分鐘）`,
            earlyLeaveMinutes,
          }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
      }

      // Cross-midnight correction: 22:00 in → 06:00 out = +8h not −16h
      const [inH, inM] = (existingRecord.clock_in as string).split(':').map(Number)
      let workedMinutes = currentMinutes - (inH * 60 + inM)
      if (workedMinutes < 0) workedMinutes += 1440

      const updatePayload: Record<string, unknown> = {
        clock_out:       timeStr,
        clock_out_time:  now.toISOString(),
        total_hours:     parseFloat((workedMinutes / 60).toFixed(2)),
      }

      if (is_overtime) {
        // Mark attendance as overtime regardless of whether clock_in was also overtime
        updatePayload.is_overtime = true

        const actualHours = parseFloat((workedMinutes / 60).toFixed(1))

        if (existingRecord.overtime_request_id) {
          // Clock_in was already overtime — update the existing request with real hours
          await supabase.from('overtime_requests')
            .update({
              hours:  actualHours,
              reason: `加班打卡（上班 ${existingRecord.clock_in} — 下班 ${timeStr}，時數 ${actualHours}h）`,
            })
            .eq('id', existingRecord.overtime_request_id)
        } else {
          // Clock_out overtime only — create a new overtime request now
          const { data: otReq } = await supabase
            .from('overtime_requests')
            .insert({
              employee_id:          emp.id,
              employee:             emp.name,
              date:                 dateStr,
              hours:                actualHours,
              reason:               `打卡申請加班（下班 ${timeStr}，時數 ${actualHours}h）`,
              status:               '待審核',
              organization_id:      (emp as any).organization_id || null,
              source:               'clock_out',
              attendance_record_id: existingRecord.id,
            })
            .select('id')
            .single()

          if (otReq?.id) {
            updatePayload.overtime_request_id = otReq.id
          }
        }
      }

      const { data, error } = await supabase.from('attendance_records')
        .update(updatePayload)
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
      is_overtime,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message || '伺服器錯誤' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
