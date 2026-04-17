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
      .select('id, employee, employee_id, date, clock_in')
      .eq('date', targetDate)
      .not('clock_in', 'is', null)
      .is('clock_out', null)

    if (missedErr) {
      throw new Error(`Query error: ${missedErr.message}`)
    }

    if (!missed || missed.length === 0) {
      return new Response(JSON.stringify({
        ok: true, date: targetDate, missed_count: 0, notified: [],
        message: '無未打下班卡的員工',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 2. Get LINE user IDs for these employees
    const employeeNames = missed.map(m => m.employee).filter(Boolean)
    const employeeIds = missed.map(m => m.employee_id).filter(Boolean)

    // Try v_employee_line_resolved view first, fallback to employees table
    let lineMap: Record<string, string> = {} // employee name → line_user_id

    if (employeeIds.length > 0) {
      const { data: lineAccounts } = await supabase
        .from('v_employee_line_resolved')
        .select('employee_name, line_user_id')
        .in('employee_id', employeeIds)

      if (lineAccounts) {
        for (const acc of lineAccounts) {
          if (acc.line_user_id) lineMap[acc.employee_name] = acc.line_user_id
        }
      }
    }

    // Fallback for those not found
    const missingNames = employeeNames.filter(n => !lineMap[n])
    if (missingNames.length > 0) {
      const { data: emps } = await supabase
        .from('employees')
        .select('name, line_user_id')
        .in('name', missingNames)
        .not('line_user_id', 'is', null)

      if (emps) {
        for (const e of emps) {
          if (e.line_user_id && !lineMap[e.name]) lineMap[e.name] = e.line_user_id
        }
      }
    }

    // 3. Send LINE notifications
    const lineToken = Deno.env.get('LINE_CHANNEL_TOKEN')
    const notified: string[] = []
    const failed: string[] = []

    for (const record of missed) {
      const lineUserId = lineMap[record.employee]
      if (!lineUserId || !lineToken) {
        failed.push(record.employee)
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
              { type: 'text', text: `${record.employee} 您好`, weight: 'bold', size: 'md' },
              { type: 'text', text: `系統偵測到您 ${targetDate} 有上班打卡（${record.clock_in}），但尚未打下班卡。`, size: 'sm', color: '#555555', wrap: true },
              { type: 'separator', margin: 'md' },
              { type: 'text', text: '請至系統提交補卡申請', size: 'sm', color: '#8c8c8c', margin: 'md' },
            ],
          },
          footer: {
            type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
            contents: [{
              type: 'button',
              action: { type: 'uri', label: '前往補卡', uri: `https://liff.line.me/${Deno.env.get('LIFF_ID') || ''}/hr/punch-correction` },
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
          notified.push(record.employee)
        } else {
          failed.push(record.employee)
        }
      } catch {
        failed.push(record.employee)
      }
    }

    // 4. Log results
    await supabase.from('message_logs').insert({
      channel: 'LINE',
      recipient: 'system',
      subject: `未打卡偵測 ${targetDate}`,
      body: JSON.stringify({ missed: missed.length, notified, failed }),
      status: 'sent',
    }).catch(() => {})

    return new Response(JSON.stringify({
      ok: true,
      date: targetDate,
      missed_count: missed.length,
      notified,
      failed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
