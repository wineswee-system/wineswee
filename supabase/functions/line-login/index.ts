import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { resolveChannel, resolveEnv } from '../_shared/channel.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * LINE Login OAuth for backend system
 *
 * Endpoints:
 * 1. GET ?action=authorize[&channel=code] → redirect to LINE Login
 * 2. GET ?action=callback&code=xxx[&state=<channel>] → exchange, create/login Supabase user
 *
 * Multi-channel:
 *   LINE_LOGIN_CHANNEL_ID_{CODE} / LINE_LOGIN_CHANNEL_SECRET_{CODE}
 *   Fallback: LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const queryChannel = url.searchParams.get('channel')

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const SITE_URL = Deno.env.get('SITE_URL') || 'https://sme-ops-system.vercel.app'
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Resolve the channel for this request. For authorize, use ?channel query;
  // for callback, the channel is round-tripped via `state`.
  const stateParam = url.searchParams.get('state') || ''
  const [stateNonce, stateChannel] = stateParam.split(':')
  const channelHint = queryChannel || stateChannel || null

  const channelRow = await resolveChannel(supabase, { queryCode: channelHint })
  if (!channelRow) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${SITE_URL}/login?line_error=${encodeURIComponent('未設定任何 LINE 登入頻道')}`, ...corsHeaders },
    })
  }
  const channelCode = channelRow.code
  const LINE_CHANNEL_ID = resolveEnv('LINE_LOGIN_CHANNEL_ID', channelCode) || ''
  const LINE_CHANNEL_SECRET = resolveEnv('LINE_LOGIN_CHANNEL_SECRET', channelCode) || ''

  if (!LINE_CHANNEL_ID || !LINE_CHANNEL_SECRET) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${SITE_URL}/login?line_error=${encodeURIComponent(`頻道 ${channelCode} 尚未設定 LINE Login 憑證`)}`, ...corsHeaders },
    })
  }

  const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/line-login?action=callback`

  // ── Step 1: Redirect to LINE Login ──
  if (action === 'authorize') {
    const nonce = crypto.randomUUID()
    const state = `${nonce}:${channelCode}`
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

      // ── Find matching employee ──
      // 1. employee_line_accounts (this channel)
      let employee: any = null
      const { data: ela } = await supabase
        .from('employee_line_accounts')
        .select('employee_id, employees:employee_id (*)')
        .eq('channel_id', channelRow.id)
        .eq('line_user_id', lineUserId)
        .maybeSingle()
      if (ela?.employees) employee = ela.employees

      // 2. email
      if (!employee && email) {
        const { data } = await supabase
          .from('employees')
          .select('*')
          .eq('email', email)
          .maybeSingle()
        employee = data
      }

      // 3. name
      if (!employee) {
        const { data } = await supabase
          .from('employees')
          .select('*')
          .eq('name', displayName)
          .maybeSingle()
        employee = data
      }

      if (!employee) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${SITE_URL}/login?line_error=${encodeURIComponent(`找不到員工帳號（${displayName}），請聯繫HR`)}`, ...corsHeaders },
        })
      }

      // ── Upsert employee_line_accounts for this channel ──
      const { data: existingAny } = await supabase
        .from('employee_line_accounts')
        .select('id')
        .eq('employee_id', employee.id)
        .limit(1)
      const isPrimary = !existingAny || existingAny.length === 0
      const now = new Date().toISOString()
      await supabase.from('employee_line_accounts').upsert(
        {
          employee_id: employee.id,
          channel_id: channelRow.id,
          line_user_id: lineUserId,
          display_name: displayName,
          picture_url: pictureUrl,
          is_primary: isPrimary,
          is_verified: true,
          linked_at: now,
          last_active_at: now,
        },
        { onConflict: 'channel_id,line_user_id' },
      )

      // Also upsert line_users so webhook state (pending_action) works post-login.
      const { data: existingLu } = await supabase
        .from('line_users')
        .select('id')
        .eq('channel_id', channelRow.id)
        .eq('line_user_id', lineUserId)
        .maybeSingle()
      if (existingLu) {
        await supabase.from('line_users').update({
          employee_id: employee.id,
          is_verified: true,
          display_name: displayName,
        }).eq('id', existingLu.id)
      } else {
        await supabase.from('line_users').insert({
          channel_id: channelRow.id,
          line_user_id: lineUserId,
          display_name: displayName,
          employee_id: employee.id,
          is_verified: true,
        })
      }

      // ── Create or sign in Supabase auth user ──
      const authEmail = employee.email || `line_${lineUserId}@sme-ops.local`
      const { data: { users } } = await supabase.auth.admin.listUsers()
      const existingUser = users?.find((u) => u.email === authEmail)

      if (!existingUser) {
        const { error } = await supabase.auth.admin.createUser({
          email: authEmail,
          email_confirm: true,
          user_metadata: { full_name: employee.name, line_user_id: lineUserId, line_channel: channelCode },
        })
        if (error && !error.message.includes('already')) throw error
      }

      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: authEmail,
        options: { redirectTo: `${SITE_URL}/` },
      })

      if (linkError || !linkData) {
        throw new Error(linkError?.message || '無法產生登入連結')
      }

      const magicLink = linkData.properties?.action_link
      if (magicLink) {
        return new Response(null, {
          status: 302,
          headers: { Location: magicLink, ...corsHeaders },
        })
      }

      const verificationUrl = `${SUPABASE_URL}/auth/v1/verify?token=${linkData.properties?.hashed_token}&type=magiclink&redirect_to=${encodeURIComponent(`${SITE_URL}/`)}`
      return new Response(null, {
        status: 302,
        headers: { Location: verificationUrl, ...corsHeaders },
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
