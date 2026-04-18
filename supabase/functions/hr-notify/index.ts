import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── LINE Push Helper ────────────────────────────────────────

async function pushLineMessage(lineUserId: string, messages: unknown[]) {
  const token = Deno.env.get('LINE_CHANNEL_TOKEN')
  if (!token) throw new Error('LINE_CHANNEL_TOKEN not configured')

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ to: lineUserId, messages }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`LINE push failed: ${res.status} ${JSON.stringify(err)}`)
  }
  return res
}

// ── Resolve LINE user ID from employee_id ───────────────────

async function getLineUserId(
  supabase: ReturnType<typeof createClient>,
  employeeId: number,
): Promise<string | null> {
  const { data } = await supabase
    .from('line_users')
    .select('line_user_id')
    .eq('employee_id', employeeId)
    .maybeSingle()
  return data?.line_user_id || null
}

// ── Flex Message Builders ───────────────────────────────────

function buildLeaveApprovalFlex(employeeName: string, leaveType: string, startDate: string, endDate: string, days: number, reason: string) {
  return {
    type: 'flex',
    altText: `📋 請假申請通知：${employeeName}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#3b82f6',
        paddingAll: '14px',
        contents: [{ type: 'text', text: '📋 請假審核通知', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: `${employeeName} 提交了請假申請`, weight: 'bold', size: 'md', wrap: true },
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md',
            contents: [
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '假別', size: 'sm', color: '#8c8c8c', flex: 2 },
                { type: 'text', text: leaveType, size: 'sm', flex: 4 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '日期', size: 'sm', color: '#8c8c8c', flex: 2 },
                { type: 'text', text: startDate === endDate ? startDate : `${startDate} ~ ${endDate}`, size: 'sm', flex: 4 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '天數', size: 'sm', color: '#8c8c8c', flex: 2 },
                { type: 'text', text: `${days} 天`, size: 'sm', flex: 4 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '事由', size: 'sm', color: '#8c8c8c', flex: 2 },
                { type: 'text', text: reason || '（未填寫）', size: 'sm', flex: 4, wrap: true },
              ]},
            ],
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '前往審核', uri: `https://liff.line.me/${Deno.env.get('LIFF_ID') || ''}/hr/leave` },
          style: 'primary', color: '#3b82f6', height: 'sm',
        }],
      },
    },
  }
}

function buildLeaveResultFlex(employeeName: string, leaveType: string, startDate: string, endDate: string, days: number, status: string, approverName: string) {
  const isApproved = status === '已核准'
  const color = isApproved ? '#22c55e' : '#ef4444'
  const emoji = isApproved ? '✅' : '❌'

  return {
    type: 'flex',
    altText: `${emoji} 請假${isApproved ? '已核准' : '已駁回'}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: color,
        paddingAll: '14px',
        contents: [{ type: 'text', text: `${emoji} 請假${isApproved ? '已核准' : '已駁回'}`, color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: `${employeeName}，您的請假申請${isApproved ? '已核准' : '已被駁回'}`, weight: 'bold', size: 'md', wrap: true },
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md',
            contents: [
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '假別', size: 'sm', color: '#8c8c8c', flex: 2 },
                { type: 'text', text: leaveType, size: 'sm', flex: 4 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '日期', size: 'sm', color: '#8c8c8c', flex: 2 },
                { type: 'text', text: startDate === endDate ? startDate : `${startDate} ~ ${endDate}`, size: 'sm', flex: 4 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '天數', size: 'sm', color: '#8c8c8c', flex: 2 },
                { type: 'text', text: `${days} 天`, size: 'sm', flex: 4 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '審核人', size: 'sm', color: '#8c8c8c', flex: 2 },
                { type: 'text', text: approverName, size: 'sm', flex: 4 },
              ]},
            ],
          },
        ],
      },
    },
  }
}

function buildAnnouncementFlex(title: string, content: string, sender: string) {
  return {
    type: 'flex',
    altText: `📢 公告：${title}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#8b5cf6',
        paddingAll: '14px',
        contents: [{ type: 'text', text: '📢 公司公告', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'md', wrap: true },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: content, size: 'sm', color: '#555555', wrap: true, margin: 'md' },
          { type: 'text', text: `發布者：${sender}`, size: 'xs', color: '#8c8c8c', margin: 'md' },
        ],
      },
    },
  }
}

function buildSchedulePublishFlex(employeeName: string, period: string, shiftCount: number) {
  return {
    type: 'flex',
    altText: `📅 排班表已發布：${period}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#f59e0b',
        paddingAll: '14px',
        contents: [{ type: 'text', text: '📅 排班表已發布', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: `${employeeName} 您好`, weight: 'bold', size: 'md' },
          { type: 'text', text: `${period} 的排班表已發布，您共有 ${shiftCount} 個班次。`, size: 'sm', color: '#555555', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '查看排班', uri: `https://liff.line.me/${Deno.env.get('LIFF_ID') || ''}/hr/schedule` },
          style: 'primary', color: '#f59e0b', height: 'sm',
        }],
      },
    },
  }
}

// ── Edge Function ────────────────────────────────────────────

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
    const { type } = body

    if (!type) {
      return new Response(JSON.stringify({ error: '缺少通知類型 (type)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: { employee_id: number; success: boolean; error?: string }[] = []

    // ── Leave Approval Request → notify supervisor ──────────
    if (type === 'leave_approval_request') {
      const { employee_id, leave_type, start_date, end_date, days, reason } = body

      if (!employee_id) {
        return new Response(JSON.stringify({ error: '缺少 employee_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Get the employee's name and supervisor
      const { data: emp } = await supabase
        .from('employees')
        .select('id, name, reporting_to')
        .eq('id', employee_id)
        .single()

      if (!emp) {
        return new Response(JSON.stringify({ error: '找不到員工資料' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Find supervisor to notify
      let supervisorId = emp.reporting_to
      if (!supervisorId) {
        // Fallback: find admins / managers
        const { data: admins } = await supabase
          .from('employees')
          .select('id')
          .eq('is_manager', true)
          .eq('status', '在職')
          .limit(5)
        if (admins && admins.length > 0) {
          for (const admin of admins) {
            const lineId = await getLineUserId(supabase, admin.id)
            if (lineId) {
              try {
                await pushLineMessage(lineId, [
                  buildLeaveApprovalFlex(emp.name, leave_type, start_date, end_date, days, reason),
                ])
                results.push({ employee_id: admin.id, success: true })
              } catch (e) {
                results.push({ employee_id: admin.id, success: false, error: (e as Error).message })
              }
            }
          }
        }
      } else {
        const lineId = await getLineUserId(supabase, supervisorId)
        if (lineId) {
          try {
            await pushLineMessage(lineId, [
              buildLeaveApprovalFlex(emp.name, leave_type, start_date, end_date, days, reason),
            ])
            results.push({ employee_id: supervisorId, success: true })
          } catch (e) {
            results.push({ employee_id: supervisorId, success: false, error: (e as Error).message })
          }
        } else {
          results.push({ employee_id: supervisorId, success: false, error: 'No LINE account linked' })
        }
      }
    }

    // ── Leave Result → notify the applicant ─────────────────
    else if (type === 'leave_result') {
      const { employee_id, leave_type, start_date, end_date, days, status, approver_name } = body

      if (!employee_id) {
        return new Response(JSON.stringify({ error: '缺少 employee_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: emp } = await supabase
        .from('employees')
        .select('id, name')
        .eq('id', employee_id)
        .single()

      if (!emp) {
        return new Response(JSON.stringify({ error: '找不到員工資料' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const lineId = await getLineUserId(supabase, emp.id)
      if (lineId) {
        try {
          await pushLineMessage(lineId, [
            buildLeaveResultFlex(emp.name, leave_type, start_date, end_date, days, status, approver_name || '主管'),
          ])
          results.push({ employee_id: emp.id, success: true })
        } catch (e) {
          results.push({ employee_id: emp.id, success: false, error: (e as Error).message })
        }
      } else {
        results.push({ employee_id: emp.id, success: false, error: 'No LINE account linked' })
      }
    }

    // ── Announcement → notify all active employees ──────────
    else if (type === 'announcement') {
      const { title, content, sender } = body

      if (!title || !content) {
        return new Response(JSON.stringify({ error: '缺少 title 或 content' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Get all active employees with LINE accounts
      const { data: lineAccounts } = await supabase
        .from('line_users')
        .select('line_user_id, employee_id')
        .not('employee_id', 'is', null)

      if (lineAccounts) {
        for (const acc of lineAccounts) {
          try {
            await pushLineMessage(acc.line_user_id, [
              buildAnnouncementFlex(title, content, sender || '系統'),
            ])
            results.push({ employee_id: acc.employee_id, success: true })
          } catch (e) {
            results.push({ employee_id: acc.employee_id, success: false, error: (e as Error).message })
          }
        }
      }
    }

    // ── Schedule Published → notify each assigned employee ──
    else if (type === 'schedule_published') {
      const { period, employee_ids } = body

      if (!period || !employee_ids || !Array.isArray(employee_ids)) {
        return new Response(JSON.stringify({ error: '缺少 period 或 employee_ids' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      for (const empId of employee_ids as number[]) {
        const { data: emp } = await supabase
          .from('employees')
          .select('id, name')
          .eq('id', empId)
          .single()

        if (!emp) continue

        // Count shifts for this employee in the period
        const [startDate, endDate] = period.split('~').map((s: string) => s.trim())
        const { count } = await supabase
          .from('schedules')
          .select('id', { count: 'exact', head: true })
          .eq('employee', emp.name)
          .gte('date', startDate)
          .lte('date', endDate)

        const lineId = await getLineUserId(supabase, emp.id)
        if (lineId) {
          try {
            await pushLineMessage(lineId, [
              buildSchedulePublishFlex(emp.name, period, count || 0),
            ])
            results.push({ employee_id: emp.id, success: true })
          } catch (e) {
            results.push({ employee_id: emp.id, success: false, error: (e as Error).message })
          }
        } else {
          results.push({ employee_id: emp.id, success: false, error: 'No LINE account linked' })
        }
      }
    }

    // ── Unknown type ────────────────────────────────────────
    else {
      return new Response(JSON.stringify({ error: `不支援的通知類型：${type}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Log notification result
    console.log(`[hr-notify] type=${type}, results=${JSON.stringify(results)}`)

    return new Response(JSON.stringify({ ok: true, type, results }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
