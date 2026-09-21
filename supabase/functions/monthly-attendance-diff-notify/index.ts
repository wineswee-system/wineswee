import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// @ts-ignore — Deno global
const SITE_URL = Deno.env.get('SITE_URL') || '*'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Monthly Attendance Diff Notification
 *
 * 由 pg_cron 每月 1 號中午 12:00 (Asia/Taipei) 觸發。
 * 比對上個月每位在職員工的「排班 vs 打卡」差異，發 LINE 提醒。
 *
 * 排除已申請覆蓋的天（leave / overtime / clock_correction / business_trip）。
 *
 * 可手動觸發指定月份：POST body { year_month: '2026-05', employee_ids?: [1,2,3] }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    // 預設處理「上個月」(Asia/Taipei)
    const now = new Date()
    const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const lastMonth = new Date(Date.UTC(twNow.getUTCFullYear(), twNow.getUTCMonth() - 1, 1))
    const defaultYM = `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, '0')}`

    let targetYM = defaultYM
    let forceEmpIds: number[] | null = null
    let orgId: number | null = null
    if (req.method === 'POST') {
      try {
        const body = await req.json()
        if (body.year_month) targetYM = body.year_month
        if (Array.isArray(body.employee_ids)) forceEmpIds = body.employee_ids
        if (body.organization_id) orgId = Number(body.organization_id)
      } catch { /* ignore */ }
    }

    // Resolve org scope — default to single org in DB (single-tenant safe)
    if (!orgId) {
      const { data: orgRow } = await supabase.from('organizations').select('id').limit(1).maybeSingle()
      orgId = orgRow?.id ?? null
    }

    // 1. 抓所有在職員工
    let empQuery = supabase
      .from('employees')
      .select('id, name, store_id, organization_id')
      .eq('status', '在職')
    if (forceEmpIds) {
      empQuery = empQuery.in('id', forceEmpIds)
    } else if (orgId) {
      empQuery = empQuery.eq('organization_id', orgId)
    }
    const { data: employees, error: empErr } = await empQuery
    if (empErr) throw new Error(`抓員工失敗: ${empErr.message}`)

    const empList = (employees || []) as Array<{ id: number; name: string; store_id: number | null; organization_id: number | null }>
    if (!empList.length) {
      return jsonResp({ ok: true, message: '無在職員工', year_month: targetYM, notified: 0 })
    }

    // 2. LINE 帳號 mapping
    const empIds = empList.map(e => e.id)
    type LineRec = { employee_id: number; line_user_id: string; channel_code: string | null }
    const lineMap: Record<number, LineRec> = {}
    const { data: lineAccounts } = await supabase
      .from('v_employee_line_resolved')
      .select('employee_id, line_user_id, channel_code, is_primary')
      .in('employee_id', empIds)
      .order('is_primary', { ascending: false })
    for (const a of (lineAccounts || []) as LineRec[]) {
      if (a.line_user_id && !lineMap[a.employee_id]) lineMap[a.employee_id] = a
    }

    // 3. Store 名稱 map (給卡片顯示)
    const storeIds = [...new Set(empList.map(e => e.store_id).filter((x): x is number => x != null))]
    const storeNameMap: Record<number, string> = {}
    if (storeIds.length > 0) {
      const { data: stores } = await supabase.from('stores').select('id, name').in('id', storeIds)
      for (const s of (stores || []) as Array<{ id: number; name: string }>) {
        storeNameMap[s.id] = s.name
      }
    }

    const LIFF_ID = Deno.env.get('LIFF_ID') || ''
    function resolveToken(channelCode: string | null): string | null {
      if (channelCode) {
        const suffix = channelCode.toUpperCase().replace(/-/g, '_')
        const primary = Deno.env.get(`LINE_CHANNEL_ACCESS_TOKEN_${suffix}`)
        if (primary) return primary
        const legacy = Deno.env.get(`LINE_CHANNEL_TOKEN_${suffix}`)
        if (legacy) return legacy
      }
      return Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW') || null
    }

    // 顏色 by diff_type
    const TYPE_COLOR: Record<string, string> = {
      MISSING: '#EF4444',     // 紅 — 沒打卡
      LATE: '#F97316',        // 橘 — 遲到
      EARLY_LEAVE: '#F97316',
      UNSCHEDULED: '#10B981', // 綠 — 加班
      OVERWORK: '#10B981',
      UNDERTIME: '#F59E0B',   // 黃 — 時數不足
    }
    const TYPE_EMOJI: Record<string, string> = {
      MISSING: '⚠️',
      LATE: '⏰',
      EARLY_LEAVE: '⏰',
      UNSCHEDULED: '✨',
      OVERWORK: '✨',
      UNDERTIME: '🔻',
    }

    // 4. 逐員工跑 diff + 推送
    const notifiedNames: string[] = []
    const skippedNoDiff: string[] = []
    const skippedNoLine: string[] = []
    const failed: Array<{ name: string; error: string }> = []

    for (const emp of empList) {
      try {
        // 跑 RPC
        const { data: diffs, error: diffErr } = await supabase
          .rpc('monthly_attendance_diff', { p_employee_id: emp.id, p_year_month: targetYM })
        if (diffErr) {
          failed.push({ name: emp.name, error: `RPC: ${diffErr.message}` })
          continue
        }

        type Diff = {
          diff_date: string; diff_type: string | null;
          expected_shift: string | null; expected_start: string | null; expected_end: string | null;
          expected_hours: number | null; actual_clock_in: string | null;
          actual_clock_out: string | null; actual_hours: number | null;
          diff_value: number | null; message: string;
        }
        const allDiffs = (diffs || []) as Diff[]
        const validDiffs = allDiffs.filter(d => d.diff_type !== null)

        if (validDiffs.length === 0) {
          skippedNoDiff.push(emp.name)
          continue
        }

        // 沒綁 LINE → 跳過
        const line = lineMap[emp.id]
        const lineUserId = line?.line_user_id
        const lineToken = resolveToken(line?.channel_code || null)
        if (!lineUserId || !lineToken) {
          skippedNoLine.push(emp.name)
          // 仍記錄 notification 表（diff_count > 0 但 didn't notify）
          await supabase.from('attendance_diff_notifications').upsert({
            employee_id: emp.id,
            year_month: targetYM,
            diff_count: validDiffs.length,
            details: validDiffs,
          }, { onConflict: 'employee_id,year_month' })
          continue
        }

        // 組 flex card
        const storeName = emp.store_id ? (storeNameMap[emp.store_id] || '') : ''
        const ymLabel = targetYM.replace(/^\d{4}-/, '') + ' 月'

        // 上限 10 筆顯示，超過用「等 X 筆」
        const showDiffs = validDiffs.slice(0, 10)
        const moreCount = validDiffs.length - showDiffs.length

        const diffBodies = showDiffs.map(d => ({
          type: 'box', layout: 'baseline', margin: 'sm', contents: [
            { type: 'text', text: `${TYPE_EMOJI[d.diff_type!] || '•'}`, size: 'sm', flex: 0, color: TYPE_COLOR[d.diff_type!] || '#444' },
            { type: 'text', text: d.message, size: 'sm', wrap: true, color: '#333333', flex: 10, margin: 'sm' },
          ],
        }))
        if (moreCount > 0) {
          diffBodies.push({
            type: 'box', layout: 'baseline', margin: 'sm', contents: [
              { type: 'text', text: '⋯', size: 'sm', flex: 0, color: '#888888' },
              { type: 'text', text: `還有 ${moreCount} 筆，請進補件中心查看`, size: 'sm', color: '#888888', flex: 10, margin: 'sm', wrap: true },
            ],
          })
        }

        const liffUrl = LIFF_ID
          ? `https://liff.line.me/${LIFF_ID}?to=${encodeURIComponent('/attendance-issues?ym=' + targetYM)}`
          : 'https://liff.line.me/'

        const flex = {
          type: 'flex',
          altText: `${ymLabel}打卡核對通知（${validDiffs.length} 筆）`,
          contents: {
            type: 'bubble',
            header: {
              type: 'box', layout: 'vertical', backgroundColor: '#0E7490',
              paddingAll: '12px',
              contents: [
                { type: 'text', text: `📋 ${ymLabel} 打卡核對通知`, color: '#FFFFFF', weight: 'bold', size: 'md' },
                { type: 'text', text: storeName || '—', color: '#A5F3FC', size: 'xs', margin: 'xs' },
              ],
            },
            body: {
              type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
              contents: [
                { type: 'text', text: `${emp.name} 您好`, weight: 'bold', size: 'md', color: '#222222' },
                {
                  type: 'text', size: 'sm', color: '#555555', wrap: true,
                  text: `上月有 ${validDiffs.length} 筆打卡與排班有出入，請務必送出對應申請單作為當月薪資結算依據：`,
                },
                { type: 'separator', margin: 'md' },
                ...diffBodies,
              ],
            },
            footer: {
              type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
              contents: [
                {
                  type: 'button', style: 'primary', color: '#0E7490', height: 'sm',
                  action: { type: 'uri', label: '進補件中心', uri: liffUrl },
                },
                {
                  type: 'text', size: 'xxs', color: '#888888', align: 'center', margin: 'sm', wrap: true,
                  text: '⚠️ 已申請過的天不會出現在這',
                },
              ],
            },
          },
        }

        // 推送
        const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${lineToken}`,
          },
          body: JSON.stringify({ to: lineUserId, messages: [flex] }),
        })

        if (!lineRes.ok) {
          const errText = await lineRes.text()
          failed.push({ name: emp.name, error: `LINE push: ${lineRes.status} ${errText.slice(0, 200)}` })
          continue
        }

        // 記錄通知
        await supabase.from('attendance_diff_notifications').upsert({
          employee_id: emp.id,
          year_month: targetYM,
          diff_count: validDiffs.length,
          details: validDiffs,
        }, { onConflict: 'employee_id,year_month' })

        notifiedNames.push(emp.name)
      } catch (e) {
        failed.push({ name: emp.name, error: (e as Error).message })
      }
    }

    return jsonResp({
      ok: true,
      year_month: targetYM,
      total_employees: empList.length,
      notified: notifiedNames.length,
      no_diff: skippedNoDiff.length,
      no_line: skippedNoLine.length,
      failed: failed.length,
      notified_names: notifiedNames,
      failed_details: failed,
    })
  } catch (e) {
    return jsonResp({ ok: false, error: (e as Error).message }, 500)
  }
})

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
