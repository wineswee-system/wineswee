// ═══════════════════════════════════════════════════════════════
// crm-line-send — CRM 會員 LINE 發送通道（org-aware）
//
// ⚠️ 會員（members）專用。員工 LINE 走 line-push / hr-notify，
//    使用不同的 channel token。此函式「只」讀 LINE_CHANNEL_ACCESS_TOKEN_CRM，
//    絕不回退到 LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW（員工頻道）。
//
// Input:
//   {
//     memberIds: number[],
//     template: { type: 'text'|'flex', text?, altText?, contents? },
//     context?: { campaignId?, surveyInvitationId?, kind? },
//     vars?: { [memberId]: { [key]: string } }   // per-member {{var}} 值（如 link）
//   }
// - 會員 LINE userId 只從 members.line_user_id 解析（member-app LIFF 綁定）
// - 未綁定者跳過並記為 skipped（status='skipped_no_binding'）
// - 純文字且無 {{var}} → multicast（每批 ≤500）；含個人化 → 逐一 push
// - 每位收件人寫一筆 message_logs
//
// Returns: { sent, failed, skipped }
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// @ts-ignore — Deno global available at runtime in Supabase Edge Functions
const SITE_URL = Deno.env.get('SITE_URL') || '*'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const LINE_API = 'https://api.line.me/v2/bot'

interface Template {
  type: 'text' | 'flex'
  text?: string
  altText?: string
  contents?: Record<string, unknown>
}

function renderVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{{${k}}}`))
}

function buildMessage(template: Template, vars: Record<string, string>) {
  if (template.type === 'flex') {
    return {
      type: 'flex',
      altText: template.altText || '您有一則新通知',
      contents: template.contents,
    }
  }
  return { type: 'text', text: renderVars(template.text || '', vars) }
}

async function lineFetch(path: string, token: string, body: unknown) {
  const res = await fetch(`${LINE_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`LINE API ${path} ${res.status}: ${JSON.stringify(err)}`)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── Auth：service-role 繞過 RLS，必須驗 JWT 並以呼叫者 org 限縮收件人 ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: '未授權' }, 401)

    // @ts-ignore — Deno global
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await db.auth.getUser(jwt)
    if (authError || !user) return json({ error: '憑證無效' }, 401)

    const { data: caller } = await db
      .from('employees').select('organization_id').eq('email', user.email).maybeSingle()
    if (!caller) return json({ error: '權限不足：僅內部員工可發送' }, 403)
    // null org = super_admin（org_visible 同義）→ 不限縮；否則鎖定呼叫者 org
    const callerOrgId: number | null = caller.organization_id ?? null

    const { memberIds, template, context = {}, vars = {} } = await req.json()

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return json({ error: 'memberIds 不得為空' }, 400)
    }
    if (!template || (template.type !== 'text' && template.type !== 'flex')) {
      return json({ error: 'template.type 必須為 text 或 flex' }, 400)
    }
    if (template.type === 'text' && !template.text) {
      return json({ error: 'template.text 不得為空' }, 400)
    }
    if (template.type === 'flex' && !template.contents) {
      return json({ error: 'template.contents 不得為空' }, 400)
    }

    // ⚠️ CRM 專用 token。刻意不回退到員工 WORKFLOW token。
    // @ts-ignore — Deno global
    const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN_CRM')
    if (!token) {
      return json({ error: 'CRM LINE 頻道尚未設定' }, 500)
    }

    // 會員 LINE 綁定「只」來自 members 表（member-app LIFF 綁定）
    // 非數字 id（如模擬資料）不進查詢，直接視為未綁定 skipped
    // 收件人一律限縮呼叫者 org — 跨組織 memberIds 視為不存在（skipped）
    const numericIds = memberIds.map((id: unknown) => Number(id)).filter((n: number) => Number.isInteger(n))
    let mQuery = db
      .from('members')
      .select('id, name, line_user_id, organization_id')
      .in('id', numericIds.length > 0 ? numericIds : [-1])
    if (callerOrgId != null) mQuery = mQuery.eq('organization_id', callerOrgId)
    const { data: members, error: mErr } = await mQuery
    if (mErr) return json({ error: `會員查詢失敗: ${mErr.message}` }, 500)

    const found = new Map<number, { id: number; name: string; line_user_id: string | null; organization_id: number | null }>(
      (members || []).map((m) => [m.id, m]),
    )

    const kind = context.kind || 'manual'
    const meta = {
      campaign_id: context.campaignId ?? null,
      survey_invitation_id: context.surveyInvitationId ?? null,
    }
    const templateSnapshot = { template, context }

    type LogRow = {
      channel: string; direction: string; recipient: string; subject: string; body: string
      status: string; error: string | null; meta: Record<string, unknown>
      organization_id: number | null; member_id: number | null; kind: string
      template_snapshot: Record<string, unknown>
    }
    const logs: LogRow[] = []
    const makeLog = (
      memberId: number | null, orgId: number | null, recipient: string,
      status: string, error: string | null, bodyText: string,
    ): LogRow => ({
      channel: 'line',
      direction: 'outbound',
      recipient,
      subject: template.altText || kind,
      body: bodyText,
      status,
      error,
      meta,
      organization_id: orgId,
      member_id: memberId,
      kind,
      template_snapshot: templateSnapshot,
    })

    let sent = 0
    let failed = 0
    let skipped = 0
    // per-member 結果（供呼叫端精準標記，如 survey_invitations）
    const results: { memberId: number | null; status: 'sent' | 'failed' | 'skipped_no_binding' }[] = []

    // 分流：未綁定 vs 可發送
    const bound: { id: number; name: string; lineUserId: string; orgId: number | null }[] = []
    for (const rawId of memberIds) {
      const m = found.get(Number(rawId))
      if (!m || !m.line_user_id) {
        skipped++
        logs.push(makeLog(m?.id ?? null, m?.organization_id ?? null, '', 'skipped_no_binding', '會員未綁定 LINE', ''))
        results.push({ memberId: m?.id ?? (Number(rawId) || null), status: 'skipped_no_binding' })
        continue
      }
      bound.push({ id: m.id, name: m.name || '', lineUserId: m.line_user_id, orgId: m.organization_id })
    }

    const hasPersonalization =
      Object.keys(vars).length > 0 ||
      (template.type === 'text' && /\{\{\w+\}\}/.test(template.text || ''))

    if (bound.length > 0) {
      if (hasPersonalization) {
        // 逐一 push（每位會員訊息不同）
        for (const m of bound) {
          const mVars = { name: m.name, ...(vars[m.id] || vars[String(m.id)] || {}) }
          const message = buildMessage(template, mVars)
          try {
            await lineFetch('/message/push', token, { to: m.lineUserId, messages: [message] })
            sent++
            logs.push(makeLog(m.id, m.orgId, m.lineUserId, 'sent', null,
              template.type === 'text' ? (message as { text: string }).text : (template.altText || '')))
            results.push({ memberId: m.id, status: 'sent' })
          } catch (err) {
            failed++
            logs.push(makeLog(m.id, m.orgId, m.lineUserId, 'failed', (err as Error).message,
              template.type === 'text' ? (template.text || '') : (template.altText || '')))
            results.push({ memberId: m.id, status: 'failed' })
          }
        }
      } else {
        // 相同訊息 → multicast，每批 ≤500
        const message = buildMessage(template, {})
        const bodyText = template.type === 'text' ? (template.text || '') : (template.altText || '')
        for (let i = 0; i < bound.length; i += 500) {
          const chunk = bound.slice(i, i + 500)
          try {
            await lineFetch('/message/multicast', token, {
              to: chunk.map((m) => m.lineUserId),
              messages: [message],
            })
            sent += chunk.length
            for (const m of chunk) {
              logs.push(makeLog(m.id, m.orgId, m.lineUserId, 'sent', null, bodyText))
              results.push({ memberId: m.id, status: 'sent' })
            }
          } catch (err) {
            failed += chunk.length
            for (const m of chunk) {
              logs.push(makeLog(m.id, m.orgId, m.lineUserId, 'failed', (err as Error).message, bodyText))
              results.push({ memberId: m.id, status: 'failed' })
            }
          }
        }
      }
    }

    // 每位收件人一筆紀錄（寫入失敗不阻斷回傳）
    if (logs.length > 0) {
      const { error: logErr } = await db.from('message_logs').insert(logs)
      if (logErr) console.error('[crm-line-send] message_logs insert failed:', logErr.message)
    }

    return json({ sent, failed, skipped, results })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
