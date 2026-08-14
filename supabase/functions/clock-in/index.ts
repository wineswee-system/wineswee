import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// 允許主系統 + LIFF 兩個 origin（都部署在 Vercel）
const ALLOWED_ORIGINS = [
  Deno.env.get('SITE_URL')         || 'https://sme-ops-system.vercel.app',
  Deno.env.get('LIFF_ORIGIN')      || 'https://sme-ops-liff.vercel.app',
]
function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

const ADMIN_ROLES = ['admin', 'super_admin'] as const

// ── Mode catalog（2026-05-28 簡化）─────────────────────
//   normal — 一般打卡，鎖 GPS/WiFi；不查班表（不需要排班也能打）
//   outing — 外出打卡，bypass GPS/WiFi；不查班表；status 標籤 '外出'
// 舊模式 overtime / leave / shift_swap 已移除，跟廠商討論後決定簡化。
const VALID_MODES = ['normal', 'outing'] as const
type ClockMode = typeof VALID_MODES[number]

// ── Helpers ──────────────────────────────────────────────

/**
 * 依班次毛時數推算休息分鐘（公司政策階梯）：
 *   gross < 5h  → 0 分
 *   5 ≤ gross < 9h → 30 分
 *   gross ≥ 9h → 60 分（上限）
 * 跟前端 src/lib/scheduleUtils.js#getRestMinutes 同公式。
 */
function getRestMinutes(grossHours: number, isAdmin = false): number {
  if (isAdmin) return 60   // 行政午休固定 1 小時（不套門市階梯；早走/短班也一樣）
  if (grossHours <= 0) return 0
  if (grossHours < 5) return 0
  if (grossHours < 9) return 30
  return 60
}

/**
 * 淨工時（小時）：優先走後端 net_work_hours（休息窗 ∩ 打卡；休息落打卡外不扣，
 *   如 13:15 打卡不扣中午 12-13 午休）。RPC 失敗/未部署 → 退回 getRestMinutes 舊公式，不會壞。
 */
async function computeNetHours(
  supabase: any, empId: number, dateStr: string,
  clockIn: string, clockOut: string, workedMinutes: number, isAdmin: boolean,
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('net_work_hours', {
      p_emp_id: empId, p_date: dateStr, p_clock_in: clockIn, p_clock_out: clockOut,
    })
    if (!error && data != null) return parseFloat(Number(data).toFixed(2))
  } catch (_e) { /* fall through to legacy formula */ }
  return parseFloat((Math.max(0, workedMinutes - getRestMinutes(workedMinutes / 60, isAdmin)) / 60).toFixed(2))
}

// ── B: 清晨打卡歸「昨天的跨午夜班」───────────────────────────
//   忘打上班卡的夜班,午夜後才打卡 → 現有邏輯(找昨天已開卡)接不到 → 會開成錯天的孤兒紀錄。
//   規則(用班表當裁判,對齊「11小時班距→午夜後不會有新班上班」):
//     凌晨(hours24 < dayBoundary) + 今天沒排清晨班(actual_start < dayBoundary,世足這種例外)
//     + 昨天有排跨午夜班(actual_end <= actual_start,收在午夜或之後) + 昨天完全沒打卡紀錄
//   → 在昨天建一筆:clock_out=現在、clock_in 空、status='異常'(缺上班卡),回 { record, yStr };不符回 null。
async function tryYesterdayNightClockOut(
  supabase: any, emp: any, taiwanNow: Date, dayBoundary: number,
  hours24: number, timeStr: string, now: Date,
  location: any, lat: number | null, lng: number | null, resolvedIP: string | null, clockMode: string,
): Promise<{ record: any; yStr: string } | null> {
  if (hours24 >= dayBoundary) return null
  const todayStr = taiwanNow.toISOString().slice(0, 10)
  const yStr = new Date(taiwanNow.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const boundStr = `${String(dayBoundary).padStart(2, '0')}:00:00`
  // 今天有排清晨班(start < dayBoundary)→ 世足這種,當今天的打卡,不歸昨天
  const { data: todayEarly } = await supabase.from('schedules')
    .select('id').eq('employee_id', emp.id).eq('date', todayStr)
    .not('actual_start', 'is', null).lt('actual_start', boundStr).limit(1).maybeSingle()
  if (todayEarly) return null
  // 昨天有排跨午夜班(結束 <= 開始,收在午夜或之後)
  const { data: ySched } = await supabase.from('schedules')
    .select('actual_start, actual_end').eq('employee_id', emp.id).eq('date', yStr)
    .not('actual_start', 'is', null).not('actual_end', 'is', null).limit(1).maybeSingle()
  if (!ySched || !(ySched.actual_end <= ySched.actual_start)) return null
  // 昨天完全沒打卡紀錄(有紀錄就別亂建第二筆,交給現有邏輯/人工)
  const { data: yAny } = await supabase.from('attendance_records')
    .select('id').eq('employee_id', emp.id).eq('date', yStr).limit(1).maybeSingle()
  if (yAny) return null
  // 建昨天的下班紀錄:缺上班卡 → status 異常,提醒補上班卡
  const { data: yNew, error } = await supabase.from('attendance_records').insert({
    employee_id:     emp.id,
    store_id:        location?.id ?? emp.store_id ?? null,
    date:            yStr,
    clock_out:       timeStr,
    clock_out_time:  now.toISOString(),
    status:          '異常',
    total_hours:     0,
    clock_out_mode:  clockMode,
    clock_out_lat:   lat ?? null,
    clock_out_lng:   lng ?? null,
    clock_out_ip:    resolvedIP ?? null,
    organization_id: emp.organization_id ?? null,
  }).select().single()
  if (error) throw error
  return { record: yNew, yStr }
}

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
  const corsHeaders = getCorsHeaders(req)
  const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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
      clock_mode: rawMode = 'normal',
      force_weak_gps = false,   // 前端「GPS 不穩確定畫面」按確定 → true：照打、標 gps_weak
      organization_id: bodyOrgId,
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
      let nameQ = supabase.from('employees').select('*').eq('name', employee)
      if (bodyOrgId) nameQ = nameQ.eq('organization_id', Number(bodyOrgId))
      const { data } = await nameQ.maybeSingle()
      emp = data
    }
    if (!emp) return jsonResp({ error: '找不到員工資料' }, 404)

    // Proxy guard — only admin/super_admin may clock in for someone else.
    if (jwtAuthEmp && jwtAuthEmp.id !== emp.id) {
      const authRole = (jwtAuthEmp?.roles as any)?.name ?? jwtAuthEmp?.role
      if (!ADMIN_ROLES.includes(authRole)) return jsonResp({ error: '無權代替他人打卡' }, 403)
    }

    // ── 行政(admin)午休固定 1 小時 → getRestMinutes 傳 isAdmin ──
    const { data: empSalary } = await supabase.from('salary_structures')
      .select('employment_category').eq('employee_id', emp.id).maybeSingle()
    const isAdminEmp = empSalary?.employment_category === 'admin'

    // ── 候選門市清單：主要店 + employees.additional_stores（跨店打卡支援）──
    const STORE_SELECT = 'id, name, lat, lng, clock_radius, allowed_wifi, clock_in_method'
    const candidateStores: any[] = []
    if (emp.store_id) {
      const { data: primary } = await supabase
        .from('stores').select(STORE_SELECT).eq('id', emp.store_id).maybeSingle()
      if (primary) candidateStores.push(primary)
    }
    const additionalNames: string[] = Array.isArray((emp as any).additional_stores)
      ? (emp as any).additional_stores : []
    if (additionalNames.length > 0) {
      const { data: extras } = await supabase
        .from('stores').select(STORE_SELECT).in('name', additionalNames)
      for (const s of (extras || [])) {
        if (!candidateStores.find(c => c.id === s.id)) candidateStores.push(s)
      }
    }

    const serverIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip') || clientIP
    const resolvedIP = serverIP || clientIP || null

    // ── GPS / WiFi 驗證：loop 各候選店找「員工在範圍內」的那家 ──
    const skipLocation = clockMode === 'outing'
    const GPS_ACCURACY_THRESHOLD = 200
    let location: any = null   // 最終 match 到的店（寫進 attendance.store_id）
    let method: string = skipLocation ? 'bypass' : 'none'

    if (!skipLocation) {
      // GPS 精確度太差：
      //   未確認 → 回 403(帶 gps_weak:true)，前端跳「確定畫面」告知 GPS 不穩
      //   已確認(force_weak_gps) → 照打，method='gps_weak'(位置僅參考)、不驗證範圍。時間照樣記錄。
      if (lat != null && lng != null && accuracy != null && accuracy > GPS_ACCURACY_THRESHOLD) {
        if (!force_weak_gps) {
          return jsonResp({
            error: '打卡失敗：GPS 精確度不足',
            reasons: [`GPS 精確度 ${Math.round(accuracy)}m（限 ${GPS_ACCURACY_THRESHOLD}m）`],
            gps_weak: true,
            ip: resolvedIP,
          }, 403)
        }
        location = candidateStores[0] || null
        method = 'gps_weak'
      }

      if (!location) {
        const matchAttempts: string[] = []
        for (const cand of candidateStores) {
          const hasGPS = cand.lat != null && cand.lng != null
          const hasWifi = cand.allowed_wifi && cand.allowed_wifi.length > 0
          if (!hasGPS && !hasWifi) { matchAttempts.push(`${cand.name}：未設定 GPS/WiFi`); continue }

          let gpsMatch = false
          let wifiMatch = false

          if (hasGPS && lat != null && lng != null) {
            const dist = haversineMetres(lat, lng, Number(cand.lat), Number(cand.lng))
            const radius = cand.clock_radius || 200
            gpsMatch = dist <= radius
            if (!gpsMatch) matchAttempts.push(`${cand.name}：GPS 距離 ${Math.round(dist)}m / 限 ${radius}m`)
          }
          if (hasWifi && resolvedIP && !gpsMatch) {
            wifiMatch = cand.allowed_wifi.some((cidr: string) => ipMatchesCIDR(resolvedIP, cidr))
            if (!wifiMatch) matchAttempts.push(`${cand.name}：IP ${resolvedIP} 不在 WiFi 白名單`)
          }

          // 此店要求 GPS-only 但沒過 → 跳過試下一家
          if (cand.clock_in_method === 'gps_required' && !gpsMatch) continue

          if (gpsMatch || wifiMatch) {
            location = cand
            method = gpsMatch ? 'gps' : 'wifi'
            break
          }
        }

        if (!location) {
          return jsonResp({
            error: candidateStores.length === 0
              ? '打卡失敗：員工未指派任何門市'
              : '打卡失敗：你不在任何授權門市的範圍內',
            reasons: matchAttempts.length > 0 ? matchAttempts : ['請確認 GPS 已開啟、或已在授權門市內'],
            authorized_stores: candidateStores.map(s => s.name),
            ip: resolvedIP,
          }, 403)
        }
      }
    } else {
      // outing 模式 bypass 驗證；store_id 預設用主要店記錄
      location = candidateStores[0] || null
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

    // 換天時間(dayBoundary,浮動):讀 organizations.settings.day_boundary_hour(預設 6,0~12)。
    //   clock_in 跨午夜容錯 + clock_out/清晨打卡歸昨天(B) 都用它 → 提到分支前統一計算。
    let dayBoundary = 6
    {
      const { data: orgRow } = await supabase.from('organizations')
        .select('settings').eq('id', (emp as any).organization_id).maybeSingle()
      const b = parseInt((orgRow?.settings as any)?.day_boundary_hour, 10)
      if (!isNaN(b) && b >= 0 && b <= 12) dayBoundary = b
    }

    // ── status 規則（2026-05-28 簡化：不查班表、不檢查時段）──
    //   normal → '正常'
    //   outing → '外出'
    const statusForMode = clockMode === 'outing' ? '外出' : '正常'

    // ── 防呆(一般人會狂按):清晨時,今天沒上班卡、但昨天已有「只有下班、缺上班卡」的紀錄 ──
    //   (多半是剛剛 B 幫你把夜班下班記到昨天了)→ 再按上班/下班都只提示「去補上班卡」,
    //   不重複建、不噴「尚未打上班卡」這種難懂的錯,也不會亂生今天的空上班。
    if (hours24 < dayBoundary && !existingRecord?.clock_in) {
      // 今天有排清晨班(世足這種 start<換天時間)→ 是今天的正常打卡,不套防呆(免誤擋)
      const { data: todayEarlyGuard } = await supabase.from('schedules')
        .select('id').eq('employee_id', emp.id).eq('date', dateStr)
        .not('actual_start', 'is', null)
        .lt('actual_start', `${String(dayBoundary).padStart(2, '0')}:00:00`)
        .limit(1).maybeSingle()
      if (!todayEarlyGuard) {
        const yGhostStr = new Date(taiwanNow.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const { data: yGhost } = await supabase.from('attendance_records')
          .select('*').eq('employee_id', emp.id).eq('date', yGhostStr)
          .is('clock_in', null).not('clock_out', 'is', null).limit(1).maybeSingle()
        if (yGhost) {
          return jsonResp({
            success: true,
            record: yGhost,
            reminder: `你昨天(${yGhostStr})那班的下班已經記錄了(${yGhost.clock_out}),只差上班卡 → 請去「補打卡」補上班卡,不用再打卡囉。`,
          })
        }
      }
    }

    // ──────────────────────────────────────────────────────
    //   CLOCK-IN
    // ──────────────────────────────────────────────────────
    let record: any
    if (action === 'clock_in') {
      if (existingRecord?.clock_in) return jsonResp({ error: '今日已打過上班卡' }, 409)

      // ★ 跨午夜容錯（後端根治，不靠前端版本/快取）：
      //   若「昨天」有一筆已上班、未下班的班 → 這次打卡其實是要打下班（夜班跨午夜）。
      //   轉成前一班的下班，不開新上班。避免舊快取跨午夜誤顯示「上班」→
      //   把昨天的班丟成孤兒(0h) + 今天又生一筆空上班。
      //
      //   ★★ 關鍵守衛：只在「凌晨換日線之前」才這樣做（對齊補打卡的換天時間設定）。
      //   換天點後打卡 = 新的一天上班，絕不能誤轉成昨天下班 —— 否則「昨天忘打下班、
      //   今天早上正常上班」的人會被吃掉今天的上班、工時還算成 0/24h。
      //   換天時間(dayBoundary)已於分支前統一計算。
      const yesterdayStr0 = new Date(taiwanNow.getTime() - 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10)
      const { data: yOpen } = hours24 < dayBoundary
        ? await supabase
            .from('attendance_records').select('*')
            .eq('employee_id', emp.id).eq('date', yesterdayStr0)
            .not('clock_in', 'is', null).is('clock_out', null)
            // 取最新一筆 — 昨天若有多筆未下班孤兒，maybeSingle 會 throw → 退回開新上班
            // 又生一筆。改 order+limit(1) 確保永遠只補一筆、不會漏轉。
            .order('id', { ascending: false }).limit(1)
            .maybeSingle()
        : { data: null }
      if (yOpen) {
        const [yInH, yInM] = (yOpen.clock_in as string).split(':').map(Number)
        let yWorked = currentMinutes - (yInH * 60 + yInM)
        if (yWorked < 0) yWorked += 1440
        // sanity：正常夜班跨午夜工時應在合理範圍。> 16h 視為異常（多半是昨天
        //   一早上班就忘了打下班），不自動補下班以免算出離譜工時 —— 跳過、讓它
        //   走下方正常開新上班，昨天孤兒留給人工/報表處理。
        if (yWorked <= 16 * 60) {
          const yNetHours = await computeNetHours(supabase, emp.id, yesterdayStr0, yOpen.clock_in, timeStr, yWorked, isAdminEmp)
          const { data: yData, error: yErr } = await supabase.from('attendance_records')
            .update({
              clock_out:      timeStr,
              clock_out_time: now.toISOString(),
              total_hours:    yNetHours,
              clock_out_mode: clockMode,
              ...(clockMode === 'outing' ? { status: '外出' } : {}),
            }).eq('id', yOpen.id).select().single()
          if (yErr) throw yErr
          return jsonResp({
            success: true,
            record: yData,
            // 前端只讀 reminder 欄 → 借它顯示提示
            reminder: `偵測到 ${yesterdayStr0} 尚未打下班，已為你補打下班（${timeStr}）`,
          })
        }
      }

      // B: 昨天有排跨午夜班卻完全沒打卡(忘打上班卡)→ 這次清晨打卡歸昨天(補記下班,缺上班卡),不開今天的新上班
      const yNight = await tryYesterdayNightClockOut(supabase, emp, taiwanNow, dayBoundary, hours24, timeStr, now, location, lat, lng, resolvedIP, clockMode)
      if (yNight) {
        return jsonResp({
          success: true,
          record: yNight.record,
          reminder: `偵測到你昨天(${yNight.yStr})的夜班沒打上班卡,已記下這次為那班的下班(${timeStr}),請補打上班卡。`,
        })
      }

      const { data, error } = await supabase.from('attendance_records').insert({
        employee_id:         emp.id,
        // store_id：matched 跨店打卡的那家；fallback emp.store_id（outing 已預設）
        store_id:            location?.id ?? (emp as any).store_id ?? null,
        date:                dateStr,
        clock_in:            timeStr,
        status:              statusForMode,
        total_hours:         0,
        is_late:             false,
        late_minutes:        0,
        clock_in_mode:       clockMode,
        clock_out_mode:      'normal',
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

    // ──────────────────────────────────────────────────────
    //   CLOCK-OUT
    // ──────────────────────────────────────────────────────
    } else if (action === 'clock_out') {
      let clockOutRecord = existingRecord

      // 跨日打下班：今天沒有 clock_in → 往前查昨天有無未打下班的紀錄
      if (!existingRecord?.clock_in) {
        const yesterdayStr = new Date(taiwanNow.getTime() - 24 * 60 * 60 * 1000)
          .toISOString().slice(0, 10)
        const { data: yRec } = await supabase
          .from('attendance_records').select('*')
          .eq('employee_id', emp.id).eq('date', yesterdayStr).maybeSingle()
        if (yRec?.clock_in && !yRec.clock_out) clockOutRecord = yRec
      }

      if (!clockOutRecord?.clock_in) {
        // B: 昨天有排跨午夜班卻完全沒打卡 → 這次清晨下班打卡歸昨天(補記下班,缺上班卡)
        const yNight = await tryYesterdayNightClockOut(supabase, emp, taiwanNow, dayBoundary, hours24, timeStr, now, location, lat, lng, resolvedIP, clockMode)
        if (yNight) {
          return jsonResp({
            success: true,
            record: yNight.record,
            reminder: `偵測到你昨天(${yNight.yStr})的夜班沒打上班卡,已記下這次為那班的下班(${timeStr}),請補打上班卡。`,
          })
        }
        return jsonResp({ error: '尚未打上班卡' }, 409)
      }
      if (clockOutRecord.clock_out)  return jsonResp({ error: '今日已打過下班卡' }, 409)

      // 工時計算（跨午夜處理 + 自動扣休息）
      const [inH, inM] = (clockOutRecord.clock_in as string).split(':').map(Number)
      let workedMinutes = currentMinutes - (inH * 60 + inM)
      if (workedMinutes < 0) workedMinutes += 1440
      const netHours = await computeNetHours(supabase, emp.id, clockOutRecord.date, clockOutRecord.clock_in as string, timeStr, workedMinutes, isAdminEmp)

      // 上下班同一時間(in==out)也視為異常(工時=0 的明確壞紀錄,如跨午夜忘打上班卡後亂打的)
      const isZeroWork = netHours <= 0 || clockOutRecord.clock_in === timeStr
      const updatePayload: Record<string, unknown> = {
        clock_out:       timeStr,
        clock_out_time:  now.toISOString(),
        total_hours:     netHours,
        clock_out_mode:  clockMode,
        // 狀態:outing→外出;normal 工時<=0 → 標「異常」讓後台看得見(不再一律偽裝正常);其餘不動(維持 clock_in 寫入的正常)
        ...(clockMode === 'outing'
          ? { status: '外出' }
          : (isZeroWork ? { status: '異常' } : {})),
      }

      const { data, error } = await supabase.from('attendance_records')
        .update(updatePayload).eq('id', clockOutRecord.id).select().single()
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
      reminder: clockMode === 'outing' ? '外出打卡已紀錄' : null,
    })

  } catch (err) {
    return jsonResp({ error: (err as Error).message || '伺服器錯誤' }, 500)
  }
})
