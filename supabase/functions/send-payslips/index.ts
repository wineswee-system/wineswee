import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// Restrict CORS to the app's own origin in production.
// Set SITE_URL via: supabase secrets set SITE_URL=https://your-domain.com
// @ts-ignore — Deno global available at runtime in Supabase Edge Functions
const SITE_URL = Deno.env.get('SITE_URL') || '*'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── LINE Push Helper ────────────────────────────────────────

function resolveToken(channelCode?: string | null): string | null {
  if (channelCode) {
    const suffix = channelCode.toUpperCase().replace(/-/g, '_')
    const primary = Deno.env.get(`LINE_CHANNEL_ACCESS_TOKEN_${suffix}`)
    if (primary) return primary
    const legacy = Deno.env.get(`LINE_CHANNEL_TOKEN_${suffix}`)
    if (legacy) return legacy
  }
  return Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW') || null
}

async function pushLineMessage(lineUserId: string, messages: unknown[], channelCode?: string | null) {
  const token = resolveToken(channelCode)
  if (!token) throw new Error(`No LINE token for channel=${channelCode || 'default'}`)

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ to: lineUserId, messages }),
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`LINE push failed: ${res.status} ${JSON.stringify(err)}`)
  }
  return res
}

// ── Payslip Flex Message ────────────────────────────────────

function buildPayslipFlex(
  employeeName: string,
  payPeriod: string,
  record: Record<string, unknown>,
) {
  const num = (v: unknown) => Number(v) || 0
  const fmt = (v: unknown) => num(v).toLocaleString('zh-TW')
  const R = record as Record<string, unknown>
  // 相容引擎(_compute_payroll_for_employee)與舊 payroll_records 兩種欄位名
  const base      = num(R.base_salary)
  const role      = num(R.role_allowance)
  const meal      = num(R.meal_allowance)
  const transport = num(R.transport_allowance)
  const attBonus  = num(R.attendance_bonus ?? R.attendance_bonus_earned)
  const ot        = num(R.overtimePay ?? R.overtime_pay)
  const gross     = num(R.gross ?? R.gross_salary)
  const laborIns  = num(R.laborInsurance ?? R.labor_ins_employee)
  const healthIns = num(R.healthInsurance ?? R.health_ins_employee)
  const pension   = num(R.pension ?? R.labor_pension_employee)
  const leaveDed  = num(R.absenceDeduction) + num(R.unpaidDeduction) + num(R.halfPayDeduction) + num(R.leave_deduction)
  const lateDed   = num(R.lateDeduction ?? R.late_deduction)
  const totalDed  = num(R.totalDeductions ?? R.total_deductions)
  const net       = num(R.netSalary ?? R.net_salary)

  return {
    type: 'flex',
    altText: `💰 ${payPeriod} 薪資單`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#22c55e',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '💰 薪資單通知', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: `${payPeriod}`, color: '#dcfce7', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: `${employeeName} 您好`, weight: 'bold', size: 'md' },
          { type: 'separator', margin: 'md' },
          // ── 收入 ──
          { type: 'text', text: '【收入】', weight: 'bold', size: 'sm', color: '#22c55e', margin: 'md' },
          {
            type: 'box', layout: 'vertical', spacing: 'xs', margin: 'sm',
            contents: [
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '底薪', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `$${fmt(base)}`, size: 'sm', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '職務加給', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `$${fmt(role)}`, size: 'sm', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '伙食津貼', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `$${fmt(meal)}`, size: 'sm', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '交通津貼', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `$${fmt(transport)}`, size: 'sm', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '全勤獎金', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `$${fmt(attBonus)}`, size: 'sm', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '加班費', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `$${fmt(ot)}`, size: 'sm', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '應發合計', size: 'sm', weight: 'bold', flex: 4 },
                { type: 'text', text: `$${fmt(gross)}`, size: 'sm', weight: 'bold', align: 'end', flex: 3 },
              ]},
            ],
          },
          { type: 'separator', margin: 'md' },
          // ── 扣除 ──
          { type: 'text', text: '【扣除】', weight: 'bold', size: 'sm', color: '#ef4444', margin: 'md' },
          {
            type: 'box', layout: 'vertical', spacing: 'xs', margin: 'sm',
            contents: [
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '勞保（個人）', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `-$${fmt(laborIns)}`, size: 'sm', color: '#ef4444', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '健保（個人）', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `-$${fmt(healthIns)}`, size: 'sm', color: '#ef4444', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '勞退自提', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `-$${fmt(pension)}`, size: 'sm', color: '#ef4444', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '請假扣款', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `-$${fmt(leaveDed)}`, size: 'sm', color: '#ef4444', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '遲到扣款', size: 'sm', color: '#555555', flex: 4 },
                { type: 'text', text: `-$${fmt(lateDed)}`, size: 'sm', color: '#ef4444', align: 'end', flex: 3 },
              ]},
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '扣除合計', size: 'sm', weight: 'bold', flex: 4 },
                { type: 'text', text: `-$${fmt(totalDed)}`, size: 'sm', weight: 'bold', color: '#ef4444', align: 'end', flex: 3 },
              ]},
            ],
          },
          { type: 'separator', margin: 'md' },
          // ── 實發 ──
          {
            type: 'box', layout: 'horizontal', margin: 'md',
            contents: [
              { type: 'text', text: '實發金額', weight: 'bold', size: 'md', flex: 4 },
              { type: 'text', text: `$${fmt(net)}`, weight: 'bold', size: 'md', color: '#22c55e', align: 'end', flex: 3 },
            ],
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [
          { type: 'text', text: '如有疑問請洽人資部門', size: 'xs', color: '#8c8c8c', align: 'center' },
        ],
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

    // ── Auth check: require service_role key or admin JWT ──
    const authHeader = req.headers.get('Authorization')
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (token !== serviceKey) {
        const { data: { user } } = await supabase.auth.getUser(token)
        if (!user) {
          return new Response(JSON.stringify({ error: '未授權' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        const { data: emp } = await supabase.from('employees').select('role').eq('email', user.email).single()
        if (!emp || !['admin', 'super_admin', 'manager'].includes(emp.role)) {
          return new Response(JSON.stringify({ error: '權限不足' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }
    }

    const body = await req.json()
    const { payroll_run_id, pay_period, organization_id: bodyOrgId } = body

    if (!payroll_run_id && !pay_period) {
      return new Response(JSON.stringify({ error: '請提供 payroll_run_id 或 pay_period' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Resolve org scope — caller may pass organization_id; fallback to single org
    let orgId: number | null = bodyOrgId ? Number(bodyOrgId) : null
    if (!orgId) {
      const { data: orgRow } = await supabase.from('organizations').select('id').limit(1).maybeSingle()
      orgId = orgRow?.id ?? null
    }

    // 建立發送名單 targets：{ employee_id, name, period, payload(給卡片用) }
    // 優先 pay_period → 從 salary_records 取該月的人，逐人用批次同款引擎重算（方案 B）。
    // 舊路徑 payroll_run_id → 沿用 payroll_records。
    type Target = { employee_id: number; name: string; period: string; payload: Record<string, unknown> }
    const targets: Target[] = []

    if (pay_period) {
      let sq = supabase.from('salary_records')
        .select('employee_id, employee, month')
        .eq('month', pay_period)
      if (orgId) sq = sq.eq('organization_id', orgId)
      const { data: srRows, error: srErr } = await sq
      if (srErr) throw new Error(`查詢薪資記錄失敗: ${srErr.message}`)

      const seen = new Set<number>()
      for (const sr of (srRows || [])) {
        const eid = sr.employee_id as number | null
        if (!eid || seen.has(eid)) continue
        seen.add(eid)
        // 批次同款引擎重算完整明細（與薪資頁展開明細一致）
        const { data: detail, error: cErr } = await supabase.rpc('_compute_payroll_for_employee', { p_emp_id: eid, p_period: pay_period })
        if (cErr || !detail) continue
        targets.push({ employee_id: eid, name: (detail as any).employee || sr.employee || `員工 #${eid}`, period: pay_period, payload: detail as Record<string, unknown> })
      }
    } else {
      let query = supabase.from('payroll_records').select('*').eq('payroll_run_id', payroll_run_id)
      if (orgId) query = query.eq('organization_id', orgId)
      const { data: records, error: fetchErr } = await query
      if (fetchErr) throw new Error(`查詢薪資記錄失敗: ${fetchErr.message}`)
      for (const record of (records || [])) {
        const eid = record.employee_id as number | null
        if (!eid) continue
        const { data: empData } = await supabase.from('employees').select('name').eq('id', eid).maybeSingle()
        targets.push({ employee_id: eid, name: empData?.name || `員工 #${eid}`, period: record.pay_period, payload: record })
      }
    }

    if (targets.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: '無薪資記錄' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: { employee_id: number; name: string; success: boolean; error?: string }[] = []

    for (const t of targets) {
      // Resolve primary LINE account across all OAs
      const { data: lineAcc } = await supabase
        .from('v_employee_line_resolved')
        .select('line_user_id, channel_code')
        .eq('employee_id', t.employee_id)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!lineAcc?.line_user_id) {
        results.push({ employee_id: t.employee_id, name: t.name, success: false, error: 'No LINE account linked' })
        continue
      }

      try {
        await pushLineMessage(lineAcc.line_user_id, [
          buildPayslipFlex(t.name, t.period, t.payload),
        ], lineAcc.channel_code)
        results.push({ employee_id: t.employee_id, name: t.name, success: true })
      } catch (e) {
        results.push({ employee_id: t.employee_id, name: t.name, success: false, error: (e as Error).message })
      }
    }

    const sentCount = results.filter(r => r.success).length

    console.log(`[send-payslips] total=${targets.length}, sent=${sentCount}`)

    return new Response(JSON.stringify({
      ok: true,
      total: targets.length,
      sent: sentCount,
      failed: results.length - sentCount,
      results,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
