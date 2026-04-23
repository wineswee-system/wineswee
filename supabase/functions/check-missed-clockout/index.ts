import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Check Missed Clock-Out
 *
 * Runs daily at 06:00 Taiwan time (22:00 UTC previous day).
 * Scans yesterday's attendance for employees who clocked in but didn't clock out.
 * Sends LINE push notification to remind them to submit a punch correction.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    // Taiwan time (UTC+8)
    const now = new Date()
    const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const yesterday = new Date(twNow)
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().slice(0, 10)

    // Allow overriding the date via request body (for manual testing)
    let targetDate = dateStr
    if (req.method === 'POST') {
      try {
        const body = await req.json()
        if (body.date) targetDate = body.date
      } catch { /* ignore parse errors */ }
    }

    // 1. Find attendance records with clock_in but no clock_out
    const { data: missed, error: missedErr } = await supabase
      .from('attendance_records')
      .select('id, employee_id, date, clock_in, employees(id, name)')
      .eq('date', targetDate)
      .not('clock_in', 'is', null)
      .is('clock_out', null)

    if (missedErr) {
      throw new Error(`Query error: ${missedErr.message}`)
    }
    type MissedRow = { id: number; employee_id: number; date: string; clock_in: string; employees: { id: number; name: string } | null }
    const missedRows = (missed || []) as unknown as MissedRow[]
    const employeeName = (m: MissedRow): string => m.employees?.name ?? `#${m.employee_id}`

    if (!missedRows.length) {
      return new Response(JSON.stringify({
        ok: true, date: targetDate, missed_count: 0, notified: [],
        message: '無未打下班卡的員工',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 2. Resolve LINE user IDs via multi-OA mapping (keyed by employee_id)
    const employeeIds = missedRows.map(m => m.employee_id).filter(Boolean)
    type LineRec = { line_user_id: string; channel_code: string }
    const lineMapById: Record<number, LineRec> = {}

    if (employeeIds.length > 0) {
      const { data: lineAccounts } = await supabase
        .from('v_employee_line_resolved')
        .select('employee_id, line_user_id, channel_code, is_primary')
        .in('employee_id', employeeIds)
        .order('is_primary', { ascending: false })

      if (lineAccounts) {
        for (const acc of lineAccounts as Array<{ employee_id: number; line_user_id: string; channel_code: string }>) {
          if (acc.line_user_id && !lineMapById[acc.employee_id]) {
            lineMapById[acc.employee_id] = { line_user_id: acc.line_user_id, channel_code: acc.channel_code }
          }
        }
      }
    }

    // 3. Send LINE notifications
    function resolveToken(channelCode: string | null): string | null {
      if (channelCode) {
        const suffix = channelCode.toUpperCase().replace(/-/g, '_')
        const primary = Deno.env.get(`LINE_CHANNEL_ACCESS_TOKEN_${suffix}`)
        if (primary) return primary
        const legacy = Deno.env.get(`LINE_CHANNEL_TOKEN_${suffix}`)
        if (legacy) return legacy
      }
      return Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || Deno.env.get('LINE_CHANNEL_TOKEN') || null
    }
    const notified: string[] = []
    const failed: string[] = []

    for (const record of missedRows) {
      const name = employeeName(record)
      const rec = lineMapById[record.employee_id]
      const lineUserId = rec?.line_user_id
      const lineToken = resolveToken(rec?.channel_code || null)
      if (!lineUserId || !lineToken) {
        failed.push(name)
        continue
      }

      const messages = [{
        type: 'flex',
        altText: `⏰ 提醒：${targetDate} 未打下班卡`,
        contents: {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box', layout: 'vertical',
            backgroundColor: '#f59e0b',
            paddingAll: '14px',
            contents: [{ type: 'text', text: '⏰ 未打卡提醒', color: '#ffffff', weight: 'bold', size: 'md' }],
          },
          body: {
            type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
            contents: [
              { type: 'text', text: `${name} 您好`, weight: 'bold', size: 'md' },
              { type: 'text', text: `系統偵測到您 ${targetDate} 有上班打卡（${record.clock_in}），但尚未打下班卡。`, size: 'sm', color: '#555555', wrap: true },
              { type: 'separator', margin: 'md' },
              { type: 'text', text: '請至系統提交補卡申請', size: 'sm', color: '#8c8c8c', margin: 'md' },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
            contents: [{
              type: 'button',
              action: { type: 'uri', label: '前往補卡', uri: `https://liff.line.me/${Deno.env.get('LIFF_ID') || ''}?to=${encodeURIComponent('/clock-correction')}` },
              style: 'primary', color: '#f59e0b', height: 'sm',
            }],
          },
        },
      }]

      try {
        const res = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${lineToken}`,
          },
          body: JSON.stringify({ to: lineUserId, messages }),
        })

        if (res.ok) {
          notified.push(name)
        } else {
          failed.push(name)
        }
      } catch {
        failed.push(name)
      }
    }

    // 4. Log results
    await supabase.from('message_logs').insert({
      channel: 'LINE',
      recipient: 'system',
      subject: `未打卡偵測 ${targetDate}`,
      body: JSON.stringify({ missed: missedRows.length, notified, failed }),
      status: 'sent',
    }).catch(() => {})

    return new Response(JSON.stringify({
      ok: true,
      date: targetDate,
      missed_count: missedRows.length,
      notified,
      failed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
