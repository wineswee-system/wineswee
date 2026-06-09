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
function getRestMinutes(grossHours: number): number {
  if (grossHours <= 0) return 0
  if (grossHours < 5) return 0
  if (grossHours < 9) return 30
  return 60
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
      // 全局：GPS 精確度太差 → 不用試各家了
      if (lat != null && lng != null && accuracy != null && accuracy > GPS_ACCURACY_THRESHOLD) {
        return jsonResp({
          error: '打卡失敗：GPS 精確度不足',
          reasons: [`GPS 精確度 ${Math.round(accuracy)}m（限 ${GPS_ACCURACY_THRESHOLD}m）`],
          ip: resolvedIP,
        }, 403)
      }

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

    // ── status 規則（2026-05-28 簡化：不查班表、不檢查時段）──
    //   normal → '正常'
    //   outing → '外出'
    const statusForMode = clockMode === 'outing' ? '外出' : '正常'

    // ──────────────────────────────────────────────────────
    //   CLOCK-IN
    // ──────────────────────────────────────────────────────
    let record: any
    if (action === 'clock_in') {
      if (existingRecord?.clock_in) return jsonResp({ error: '今日已打過上班卡' }, 409)

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

      if (!clockOutRecord?.clock_in) return jsonResp({ error: '尚未打上班卡' }, 409)
      if (clockOutRecord.clock_out)  return jsonResp({ error: '今日已打過下班卡' }, 409)

      // 工時計算（跨午夜處理 + 自動扣休息）
      const [inH, inM] = (clockOutRecord.clock_in as string).split(':').map(Number)
      let workedMinutes = currentMinutes - (inH * 60 + inM)
      if (workedMinutes < 0) workedMinutes += 1440
      const grossHours = workedMinutes / 60
      const netMinutes = workedMinutes - getRestMinutes(grossHours)

      const updatePayload: Record<string, unknown> = {
        clock_out:       timeStr,
        clock_out_time:  now.toISOString(),
        total_hours:     parseFloat((netMinutes / 60).toFixed(2)),
        clock_out_mode:  clockMode,
        // outing 下班才覆寫 status，normal 不動 clock_in 寫入的 status
        ...(clockMode === 'outing' ? { status: '外出' } : {}),
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
