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

/**
 * LINE Login OAuth — single OA.
 *
 * Endpoints:
 *   GET ?action=authorize → redirect to LINE Login
 *   GET ?action=callback&code=xxx → exchange, create/login Supabase user
 *
 * Required env vars:
 *   LINE_LOGIN_CHANNEL_ID
 *   LINE_LOGIN_CHANNEL_SECRET
 *
 * The channel row used for linking `employee_line_accounts` is the single
 * row in `line_channels` with `is_default = true` (or first active).
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const DEFAULT_SITE_URL = Deno.env.get('SITE_URL') || 'https://sme-ops-system.vercel.app'
  const LINE_CHANNEL_ID = Deno.env.get('LINE_LOGIN_CHANNEL_ID') || ''
  const LINE_CHANNEL_SECRET = Deno.env.get('LINE_LOGIN_CHANNEL_SECRET') || ''

  if (!LINE_CHANNEL_ID || !LINE_CHANNEL_SECRET) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${DEFAULT_SITE_URL}/login?line_error=${encodeURIComponent('LINE Login 憑證未設定 (LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET)')}`, ...corsHeaders },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Single login channel — default flagged row, else first active.
  const { data: channelRow } = await supabase
    .from('line_channels')
    .select('*')
    .eq('status', 'active')
    .order('is_default', { ascending: false })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!channelRow) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${DEFAULT_SITE_URL}/login?line_error=${encodeURIComponent('未設定 LINE 官方帳號')}`, ...corsHeaders },
    })
  }

  const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/line-login?action=callback`

  // ── Step 1: Redirect to LINE Login ──
  if (action === 'authorize') {
    // Embed the caller's origin in state so callback can redirect back to the right host
    const siteUrlParam = url.searchParams.get('site_url') || DEFAULT_SITE_URL
    const state = btoa(JSON.stringify({ nonce: crypto.randomUUID(), site_url: siteUrlParam }))
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?` +
      `response_type=code` +
      `&client_id=${LINE_CHANNEL_ID}` +
      `&redirect_uri=${encodeURIComponent(CALLBACK_URL)}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=profile%20openid%20email`

    return new Response(null, {
      status: 302,
      headers: { Location: lineAuthUrl, ...corsHeaders },
    })
  }

  // ── Step 2: Callback — exchange code for token ──
  if (action === 'callback') {
    const code = url.searchParams.get('code')
    const stateParam = url.searchParams.get('state') || ''
    // Recover the caller's origin from state; fall back to the env-configured SITE_URL
    let SITE_URL = DEFAULT_SITE_URL
    try {
      const stateData = JSON.parse(atob(stateParam))
      if (stateData.site_url) SITE_URL = stateData.site_url
    } catch { /* use DEFAULT_SITE_URL */ }

    if (!code) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${SITE_URL}/login?line_error=${encodeURIComponent('LINE 登入失敗：無授權碼')}`, ...corsHeaders },
      })
    }

    try {
      const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: CALLBACK_URL,
          client_id: LINE_CHANNEL_ID,
          client_secret: LINE_CHANNEL_SECRET,
        }),
      })

      if (!tokenRes.ok) {
        const err = await tokenRes.text()
        return new Response(null, {
          status: 302,
          headers: { Location: `${SITE_URL}/login?line_error=${encodeURIComponent(`LINE token 交換失敗：${err}`)}`, ...corsHeaders },
        })
      }

      const tokenData = await tokenRes.json()

      const profileRes = await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      const profile = await profileRes.json()

      let email = ''
      if (tokenData.id_token) {
        try {
          const payload = JSON.parse(atob(tokenData.id_token.split('.')[1]))
          email = payload.email || ''
        } catch { /* no email in token */ }
      }

      const lineUserId = profile.userId
      const displayName = profile.displayName || ''
      const pictureUrl = profile.pictureUrl || null

      // ── Find matching employee: prior link → email → display name ──
      let employee: any = null
      const { data: ela } = await supabase
        .from('employee_line_accounts')
        .select('employees:employee_id (*)')
        .eq('line_user_id', lineUserId)
        .limit(1)
        .maybeSingle()
      employee = ela?.employees || null

      if (!employee && email) {
        const { data } = await supabase.from('employees').select('*').eq('email', email).maybeSingle()
        employee = data
      }
      if (!employee) {
        const { data } = await supabase.from('employees').select('*').eq('name', displayName).maybeSingle()
        employee = data
      }
      if (!employee) {
        const { data } = await supabase.from('employees').select('*').eq('name_en', displayName).maybeSingle()
        employee = data
      }

      if (!employee) {
        // Save this LINE user so HR can discover and manually link them via the backtrack scan
        await supabase.from('line_users').upsert(
          { channel_id: channelRow.id, line_user_id: lineUserId, display_name: displayName, is_verified: false },
          { onConflict: 'channel_id,line_user_id' },
        ).catch(() => {})
        return new Response(null, {
          status: 302,
          headers: { Location: `${SITE_URL}/login?line_error=${encodeURIComponent(`找不到員工帳號（${displayName}），請聯繫HR`)}`, ...corsHeaders },
        })
      }

      // ── Link LINE identity to employee ──
      const now = new Date().toISOString()
      await supabase.from('employee_line_accounts').upsert(
        {
          employee_id: employee.id,
          channel_id: channelRow.id,
          line_user_id: lineUserId,
          display_name: displayName,
          picture_url: pictureUrl,
          is_primary: true,
          is_verified: true,
          linked_at: now,
          last_active_at: now,
        },
        { onConflict: 'channel_id,line_user_id' },
      )

      await supabase.from('line_users').upsert(
        {
          channel_id: channelRow.id,
          line_user_id: lineUserId,
          employee_id: employee.id,
          display_name: displayName,
          is_verified: true,
        },
        { onConflict: 'channel_id,line_user_id' },
      )

      // ── Create Supabase auth user (idempotent) then issue magic link ──
      const authEmail = employee.email || `line_${lineUserId}@sme-ops.local`

      const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
        email: authEmail,
        email_confirm: true,
        user_metadata: { full_name: employee.name, line_user_id: lineUserId },
      })
      if (createErr && !/already|registered|exists/i.test(createErr.message)) throw createErr

      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: authEmail,
        options: { redirectTo: `${SITE_URL}/` },
      })
      if (linkError || !linkData?.properties?.action_link) {
        throw new Error(linkError?.message || '無法產生登入連結')
      }

      // Write auth_user_id back so AuthContext can resolve the employee profile on every login.
      // generateLink returns the user object for both new and existing auth users.
      // Always sync when it differs — guards against stale UUIDs left by migrations.
      const authUserId = createData?.user?.id ?? (linkData as any)?.user?.id
      if (authUserId && employee.auth_user_id !== authUserId) {
        await supabase.from('employees').update({ auth_user_id: authUserId }).eq('id', employee.id)
      }

      return new Response(null, {
        status: 302,
        headers: { Location: linkData.properties.action_link, ...corsHeaders },
      })

    } catch (err) {
      const errMsg = encodeURIComponent((err as Error).message || 'unknown')
      return new Response(null, {
        status: 302,
        headers: { Location: `${SITE_URL}/login?line_error=${errMsg}`, ...corsHeaders },
      })
    }
  }

  return new Response(JSON.stringify({ error: 'Unknown action. Use ?action=authorize or ?action=callback' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
