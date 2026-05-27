import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const SITE_URL = Deno.env.get('SITE_URL') || 'https://sme-ops-system.vercel.app'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_ROLES = ['admin', 'super_admin'] as const

// ── Mode catalog ─────────────────────────────────────────
//   normal     — 一般打卡，全規則
//   overtime   — 加班；bypass 時段，attach 或自建 overtime_requests
//   leave      — 因請假晚到/早退；免遲到罰、須在班別內，attach 或自建 leave_requests
//   shift_swap — 換班；bypass 時段，須有「已核准」shift_swap（不能臨建）
//   outing     — 外出/公出；bypass 時段 + 位置驗證，attach 或自建 business_trips
const VALID_MODES = ['normal', 'overtime', 'leave', 'shift_swap', 'outing'] as const
type ClockMode = typeof VALID_MODES[number]

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

const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

// ── Edge Function ────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const {
      employee_id, line_user_id, employee,
      action,
      lat, lng, accuracy,
      ip: clientIP,
      // 4-mode tag — replaces old is_overtime / is_leave_adjustment booleans
      clock_mode: rawMode = 'normal',
      // Optional attach to existing request rows
      overtime_request_id: attachOvertimeId = null,
      leave_request_id:    attachLeaveId    = null,
      shift_swap_id:       attachSwapId     = null,
      business_trip_id:    attachTripId     = null,
    } = body

    if (!action) return jsonResp({ error: '缺少必要參數 (action)' }, 400)
    if (!employee_id && !line_user_id && !employee) {
      return jsonResp({ error: '缺少必要參數 (employee_id, line_user_id, 或 employee)' }, 400)
    }

    const clockMode = (VALID_MODES.includes(rawMode) ? rawMode : 'normal') as ClockMode

    // ── JWT required for all non-LINE paths ─────────────────
    let jwtAuthEmp: any = null
    if (!line_user_id) {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) return jsonResp({ error: '未授權：請提供 Authorization header' }, 401)
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: authError } = await supabase.auth.getUser(token)
      if (authError || !user) return jsonResp({ error: '憑證無效' }, 401)
      const { data: ae } = await supabase
        .from('employees').select('id, role, roles(name)').eq('email', user.email).maybeSingle()
      jwtAuthEmp = ae
    }

    // ── Resolve employee ─────────────────────────────────
    let emp: any = null
    if (employee_id) {
      const { data } = await supabase.from('employees').select('*').eq('id', employee_id).maybeSingle()
      emp = data
    } else if (line_user_id) {
      const { data: ela } = await supabase
        .from('employee_line_accounts')
        .select('employee_id').eq('line_user_id', line_user_id).eq('is_verified', true)
        .limit(1).maybeSingle()
      if (ela?.employee_id) {
        const { data } = await supabase.from('employees').select('*').eq('id', ela.employee_id).maybeSingle()
        emp = data
      }
    } else if (employee) {
      const { data } = await supabase.from('employees').select('*').eq('name', employee).maybeSingle()
      emp = data
    }
    if (!emp) return jsonResp({ error: '找不到員工資料' }, 404)

    // Proxy guard — only admin/super_admin may clock in for someone else.
    if (jwtAuthEmp && jwtAuthEmp.id !== emp.id) {
      const authRole = (jwtAuthEmp?.roles as any)?.name ?? jwtAuthEmp?.role
      if (!ADMIN_ROLES.includes(authRole)) return jsonResp({ error: '無權代替他人打卡' }, 403)
    }

    // ── Store / location config ──────────────────────────
    let location: any = null
    if (emp.store_id) {
      const { data: store } = await supabase
        .from('stores')
        .select('id, name, lat, lng, clock_radius, allowed_wifi, clock_in_method, early_clock_minutes, has_office_hours, office_hours_start, office_hours_end, late_tolerance_minutes')
        .eq('id', emp.store_id).maybeSingle()
      location = store
    }

    const serverIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip') || clientIP
    const resolvedIP = serverIP || clientIP || null

    // ── GPS / WiFi validation (bypassed only for outing mode) ───
    const skipLocation = clockMode === 'outing'
    const hasGPSConfig = !!(location?.lat != null && location?.lng != null)
    const hasWifiConfig = !!(location?.allowed_wifi && location.allowed_wifi.length > 0)
    const GPS_ACCURACY_THRESHOLD = 200
    const requireGPSOnly = location?.clock_in_method === 'gps_required'

    let gpsPass = false
    let wifiPass = false
    let method: string = skipLocation ? 'bypass' : 'none'
    const reasons: string[] = []

    if (!skipLocation && location && (hasGPSConfig || hasWifiConfig)) {
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
        return jsonResp({
          error: '打卡失敗：此據點要求 GPS 驗證',
          reasons: ['此據點設定僅允許 GPS 打卡，WiFi 驗證不適用', ...reasons], ip: resolvedIP,
        }, 403)
      }
      if (!gpsPass && !wifiPass) {
        return jsonResp({ error: '打卡失敗：位置驗證未通過', reasons, ip: resolvedIP }, 403)
      }
      method = gpsPass ? 'gps' : 'wifi'
    }

    // ── Taiwan time ──────────────────────────────────────
    const now = new Date()
    const taiwanNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const dateStr = taiwanNow.toISOString().slice(0, 10)
    const hours24 = taiwanNow.getUTCHours()
    const minutes = taiwanNow.getUTCMinutes()
    const timeStr = `${String(hours24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    const currentMinutes = hours24 * 60 + minutes

    const { data: existingRecord } = await supabase
      .from('attendance_records').select('*')
      .eq('employee_id', emp.id).eq('date', dateStr).maybeSingle()

    // ── Shift / office-hours resolver ────────────────────
    const determineLateStatus = async (): Promise<{
      status: string
      isLate: boolean
      lateMinutes: number
      tooEarly: boolean
      tooEarlyMinutes: number
      resolvedEndMinutes: number | null
    }> => {
      const storeTolerance: number = location?.late_tolerance_minutes ?? 5
      const earlyWindow: number    = location?.early_clock_minutes    ?? 30

      const { data: schedule } = await supabase
        .from('schedules')
        .select('shift, actual_start')
        .eq('employee_id', emp.id).eq('date', dateStr).maybeSingle()

      let resolvedStartTime: string | null = null
      let resolvedEndTime:   string | null = null

      if (schedule?.actual_start) {
        resolvedStartTime = String(schedule.actual_start).slice(0, 5)
      } else if (schedule?.shift) {
        const { data: shiftDef } = await supabase
          .from('shift_definitions')
          .select('start_time, end_time')
          .eq('name', schedule.shift)
          .or(`store_id.eq.${emp.store_id ?? 0},store_id.is.null`)
          .order('store_id', { ascending: false, nullsFirst: false })
          .limit(1).maybeSingle()
        resolvedStartTime = shiftDef?.start_time?.slice(0, 5) ?? null
        resolvedEndTime   = shiftDef?.end_time?.slice(0, 5)   ?? null
      }

      const officeEndStr: string | null = (location?.has_office_hours && location?.office_hours_end)
        ? String(location.office_hours_end).slice(0, 5) : null
      const effectiveEndStr = resolvedEndTime ?? officeEndStr
      let resolvedEndMinutes: number | null = null
      if (effectiveEndStr) {
        const [eH, eM] = effectiveEndStr.split(':').map(Number)
        resolvedEndMinutes = eH * 60 + eM
      }

      if (resolvedStartTime) {
        const [startH, startM] = resolvedStartTime.split(':').map(Number)
        const shiftStartMinutes = startH * 60 + startM
        const minsUntilShift = shiftStartMinutes - currentMinutes
        if (minsUntilShift > earlyWindow) {
          return { status: '提早打卡', isLate: false, lateMinutes: 0, tooEarly: true, tooEarlyMinutes: minsUntilShift, resolvedEndMinutes }
        }
        let lateMinutes = currentMinutes - shiftStartMinutes
        if (lateMinutes < -720) lateMinutes += 1440
        if (lateMinutes > storeTolerance) {
          return { status: '遲到', isLate: true, lateMinutes, tooEarly: false, tooEarlyMinutes: 0, resolvedEndMinutes }
        }
        return { status: '正常', isLate: false, lateMinutes: 0, tooEarly: false, tooEarlyMinutes: 0, resolvedEndMinutes }
      }

      const officeStart: string | null = (location?.has_office_hours && location?.office_hours_start)
        ? String(location.office_hours_start).slice(0, 5) : null
      const [fbH, fbM] = officeStart ? officeStart.split(':').map(Number) : [9, 0]
      const shiftStartMinutes = fbH * 60 + fbM
      const minsUntilShift = shiftStartMinutes - currentMinutes
      if (minsUntilShift > earlyWindow) {
        return { status: '提早打卡', isLate: false, lateMinutes: 0, tooEarly: true, tooEarlyMinutes: minsUntilShift, resolvedEndMinutes }
      }
      const lateMinutes = currentMinutes - shiftStartMinutes
      if (lateMinutes > storeTolerance) {
        return { status: '遲到', isLate: true, lateMinutes, tooEarly: false, tooEarlyMinutes: 0, resolvedEndMinutes }
      }
      return { status: '正常', isLate: false, lateMinutes: 0, tooEarly: false, tooEarlyMinutes: 0, resolvedEndMinutes }
    }

    // ── Attach validators (for modes that accept existing request rows) ─
    const validateShiftSwap = async (swapId: number): Promise<string | null> => {
      const { data: swap } = await supabase
        .from('shift_swaps').select('id, requester_id, target_id, swap_date, status').eq('id', swapId).maybeSingle()
      if (!swap) return '找不到指定的換班單'
      if (swap.status !== '已核准')       return `換班單尚未核准（目前狀態：${swap.status}）`
      if (swap.swap_date !== dateStr)     return `換班單日期（${swap.swap_date}）與今日不符`
      if (swap.requester_id !== emp.id && swap.target_id !== emp.id) return '此換班單與你無關'
      return null
    }
    const validateLeaveRequest = async (lvId: number): Promise<string | null> => {
      const { data: lv } = await supabase
        .from('leave_requests').select('id, employee_id, start_date, end_date, status').eq('id', lvId).maybeSingle()
      if (!lv) return '找不到指定的請假單'
      if (lv.employee_id !== emp.id) return '此請假單與你無關'
      if (lv.start_date > dateStr || lv.end_date < dateStr) return `請假單期間（${lv.start_date} ~ ${lv.end_date}）不涵蓋今日`
      return null
    }
    const validateBusinessTrip = async (tripId: number): Promise<string | null> => {
      const { data: trip } = await supabase
        .from('business_trips').select('id, employee, start_date, end_date').eq('id', tripId).maybeSingle()
      if (!trip) return '找不到指定的公出單'
      if (trip.employee !== emp.name) return '此公出單與你無關'
      if (trip.start_date && trip.start_date > dateStr) return `公出單尚未開始（${trip.start_date}）`
      if (trip.end_date   && trip.end_date   < dateStr) return `公出單已結束（${trip.end_date}）`
      return null
    }

    // ──────────────────────────────────────────────────────
    //   CLOCK-IN
    // ──────────────────────────────────────────────────────
    let record: any
    if (action === 'clock_in') {
      if (existingRecord?.clock_in) return jsonResp({ error: '今日已打過上班卡' }, 409)

      let clockStatus  = '正常'
      let isLate       = false
      let lateMinutes  = 0
      let overtimeId   = attachOvertimeId
      let leaveId      = attachLeaveId
      let swapId       = attachSwapId
      let tripId       = attachTripId

      // ── Mode dispatch ──────────────────────────────────
      if (clockMode === 'overtime') {
        clockStatus = '加班'
        if (overtimeId) {
          const { data: ot } = await supabase
            .from('overtime_requests').select('id, employee_id, date').eq('id', overtimeId).maybeSingle()
          if (!ot || ot.employee_id !== emp.id || ot.date !== dateStr) {
            return jsonResp({ error: '指定的加班單無效或日期不符' }, 400)
          }
        } else {
          const { data: otReq, error: otErr } = await supabase
            .from('overtime_requests').insert({
              employee_id:     emp.id,
              employee:        emp.name,
              date:            dateStr,
              hours:           0,
              reason:          `打卡申請加班（上班 ${timeStr}，時數待確認）`,
              status:          '待審核',
              organization_id: (emp as any).organization_id || null,
              source:          'clock_in',
            }).select('id').single()
          if (otErr) throw otErr
          overtimeId = otReq.id
        }

      } else if (clockMode === 'shift_swap') {
        if (!swapId) return jsonResp({ error: '換班打卡須帶 shift_swap_id（未通過兩段確認的換班不能用此模式）' }, 400)
        const err = await validateShiftSwap(swapId)
        if (err) return jsonResp({ error: err }, 400)
        clockStatus = '正常'  // bypass time check entirely

      } else if (clockMode === 'outing') {
        clockStatus = '外出'
        if (tripId) {
          const err = await validateBusinessTrip(tripId)
          if (err) return jsonResp({ error: err }, 400)
        } else {
          const { data: trip, error: tripErr } = await supabase
            .from('business_trips').insert({
              employee:        emp.name,
              destination:     null,
              start_date:      dateStr,
              end_date:        dateStr,
              purpose:         `打卡申請外出（上班 ${timeStr}）`,
              status:          '待審核',
            }).select('id').single()
          if (tripErr) throw tripErr
          tripId = trip.id
        }

      } else if (clockMode === 'leave') {
        const result = await determineLateStatus()
        if (result.tooEarly) {
          return jsonResp({
            error: `打卡失敗：距上班時間尚有 ${result.tooEarlyMinutes} 分鐘，超出提前打卡容許範圍（${location?.early_clock_minutes ?? 30} 分鐘）`,
            tooEarlyMinutes: result.tooEarlyMinutes,
          }, 403)
        }
        if (result.resolvedEndMinutes !== null && currentMinutes > result.resolvedEndMinutes) {
          const endLabel = `${String(Math.floor(result.resolvedEndMinutes / 60)).padStart(2, '0')}:${String(result.resolvedEndMinutes % 60).padStart(2, '0')}`
          return jsonResp({
            error: `打卡失敗：打卡時間（${timeStr}）已超出班別結束時間（${endLabel}），請改用加班模式`,
          }, 403)
        }
        // Waive late penalty
        clockStatus = result.isLate ? '請假' : result.status

        if (leaveId) {
          const err = await validateLeaveRequest(leaveId)
          if (err) return jsonResp({ error: err }, 400)
        } else {
          const { data: lv, error: lvErr } = await supabase
            .from('leave_requests').insert({
              employee_id:     emp.id,
              employee:        emp.name,
              type:            '事假',
              start_date:      dateStr,
              end_date:        dateStr,
              days:            1,
              reason:          `打卡申請請假調整（上班 ${timeStr}，請至 HR 補件）`,
              status:          '待審核',
              organization_id: (emp as any).organization_id || null,
            }).select('id').single()
          if (lvErr) throw lvErr
          leaveId = lv.id
        }

      } else {
        // ── normal ──
        const result = await determineLateStatus()
        if (result.tooEarly) {
          return jsonResp({
            error: `打卡失敗：距上班時間尚有 ${result.tooEarlyMinutes} 分鐘，超出提前打卡容許範圍（${location?.early_clock_minutes ?? 30} 分鐘）`,
            tooEarlyMinutes: result.tooEarlyMinutes,
          }, 403)
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
        clock_in_mode:       clockMode,
        clock_out_mode:      'normal',
        overtime_request_id: overtimeId,
        leave_request_id:    leaveId,
        shift_swap_id:       swapId,
        business_trip_id:    tripId,
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

      if (error?.code === '23505') return jsonResp({ error: '今日已打過上班卡' }, 409)
      if (error) throw error
      record = data

      // Back-link the auto-created overtime request to this attendance row
      if (clockMode === 'overtime' && !attachOvertimeId && overtimeId && record?.id) {
        await supabase.from('overtime_requests')
          .update({ attendance_record_id: record.id }).eq('id', overtimeId)
      }

    // ──────────────────────────────────────────────────────
    //   CLOCK-OUT
    // ──────────────────────────────────────────────────────
    } else if (action === 'clock_out') {
      if (!existingRecord?.clock_in) return jsonResp({ error: '尚未打上班卡' }, 409)
      if (existingRecord.clock_out)  return jsonResp({ error: '今日已打過下班卡' }, 409)

      let overtimeId = existingRecord.overtime_request_id || attachOvertimeId
      let leaveId    = existingRecord.leave_request_id    || attachLeaveId
      let swapId     = existingRecord.shift_swap_id       || attachSwapId
      let tripId     = existingRecord.business_trip_id    || attachTripId

      // Mode-specific guards
      if (clockMode === 'shift_swap') {
        if (!swapId) return jsonResp({ error: '換班打卡須帶 shift_swap_id' }, 400)
        if (!existingRecord.shift_swap_id) {
          const err = await validateShiftSwap(swapId)
          if (err) return jsonResp({ error: err }, 400)
        }
      }

      if (clockMode === 'leave') {
        // clock_out for leave: must be >= shift/office start (didn't pre-clock out)
        const officeStartStr = (location?.has_office_hours && location?.office_hours_start)
          ? String(location.office_hours_start).slice(0, 5) : null
        if (officeStartStr) {
          const [osH, osM] = officeStartStr.split(':').map(Number)
          if (currentMinutes < osH * 60 + osM) {
            return jsonResp({ error: `打卡失敗：打卡時間（${timeStr}）早於辦公開始時間（${officeStartStr}）` }, 403)
          }
        }
        if (leaveId) {
          if (!existingRecord.leave_request_id) {
            const err = await validateLeaveRequest(leaveId)
            if (err) return jsonResp({ error: err }, 400)
          }
        } else {
          const { data: lv, error: lvErr } = await supabase
            .from('leave_requests').insert({
              employee_id:     emp.id,
              employee:        emp.name,
              type:            '事假',
              start_date:      dateStr,
              end_date:        dateStr,
              days:            1,
              reason:          `打卡申請請假調整（下班 ${timeStr}，請至 HR 補件）`,
              status:          '待審核',
              organization_id: (emp as any).organization_id || null,
            }).select('id').single()
          if (lvErr) throw lvErr
          leaveId = lv.id
        }
      }

      // Normal mode: 早退 check (skipped for overtime / leave / shift_swap / outing)
      if (clockMode === 'normal' && location?.has_office_hours && location?.office_hours_end) {
        const storeTolerance: number = location?.late_tolerance_minutes ?? 5
        const officeEndStr = String(location.office_hours_end).slice(0, 5)
        const [oeH, oeM] = officeEndStr.split(':').map(Number)
        const officeEndMinutes = oeH * 60 + oeM
        let earlyLeaveMinutes = officeEndMinutes - currentMinutes
        if (earlyLeaveMinutes < -720) earlyLeaveMinutes += 1440
        if (earlyLeaveMinutes > storeTolerance) {
          return jsonResp({
            error: `打卡失敗：距下班時間尚有 ${earlyLeaveMinutes} 分鐘（辦公時間至 ${officeEndStr}，容許提早 ${storeTolerance} 分鐘）`,
            earlyLeaveMinutes,
          }, 403)
        }
      }

      // Worked time (cross-midnight aware)
      const [inH, inM] = (existingRecord.clock_in as string).split(':').map(Number)
      let workedMinutes = currentMinutes - (inH * 60 + inM)
      if (workedMinutes < 0) workedMinutes += 1440

      const updatePayload: Record<string, unknown> = {
        clock_out:       timeStr,
        clock_out_time:  now.toISOString(),
        total_hours:     parseFloat((workedMinutes / 60).toFixed(2)),
        clock_out_mode:  clockMode,
      }

      // Mode-driven status / FK propagation
      if (clockMode === 'overtime') {
        updatePayload.status = '加班'
        const actualHours = parseFloat((workedMinutes / 60).toFixed(1))
        if (overtimeId) {
          await supabase.from('overtime_requests').update({
            hours:  actualHours,
            reason: `加班打卡（上班 ${existingRecord.clock_in} — 下班 ${timeStr}，時數 ${actualHours}h）`,
          }).eq('id', overtimeId)
        } else {
          const { data: otReq } = await supabase
            .from('overtime_requests').insert({
              employee_id:          emp.id,
              employee:             emp.name,
              date:                 dateStr,
              hours:                actualHours,
              reason:               `打卡申請加班（下班 ${timeStr}，時數 ${actualHours}h）`,
              status:               '待審核',
              organization_id:      (emp as any).organization_id || null,
              source:               'clock_out',
              attendance_record_id: existingRecord.id,
            }).select('id').single()
          if (otReq?.id) overtimeId = otReq.id
        }
      } else if (clockMode === 'outing') {
        updatePayload.status = '外出'
        if (!tripId) {
          const { data: trip, error: tripErr } = await supabase
            .from('business_trips').insert({
              employee:    emp.name,
              destination: null,
              start_date:  dateStr,
              end_date:    dateStr,
              purpose:     `打卡申請外出（下班 ${timeStr}）`,
              status:      '待審核',
            }).select('id').single()
          if (tripErr) throw tripErr
          tripId = trip.id
        }
      } else if (clockMode === 'leave') {
        // Don't override status if clock_in already wrote '請假' / time-check result
      }

      // Persist FKs (don't overwrite existing with null)
      if (overtimeId) updatePayload.overtime_request_id = overtimeId
      if (leaveId)    updatePayload.leave_request_id    = leaveId
      if (swapId)     updatePayload.shift_swap_id       = swapId
      if (tripId)     updatePayload.business_trip_id    = tripId

      const { data, error } = await supabase.from('attendance_records')
        .update(updatePayload).eq('id', existingRecord.id).select().single()
      if (error) throw error
      record = data

    } else {
      return jsonResp({ error: 'action 必須是 clock_in 或 clock_out' }, 400)
    }

    return jsonResp({
      success: true,
      record,
      method,
      locationName: location?.name || '未知',
      ip: resolvedIP,
      clock_mode: clockMode,
    })

  } catch (err) {
    return jsonResp({ error: (err as Error).message || '伺服器錯誤' }, 500)
  }
})
