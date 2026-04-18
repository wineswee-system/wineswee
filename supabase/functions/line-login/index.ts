import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * LINE Login OAuth for backend system
 *
 * Two endpoints:
 * 1. GET ?action=authorize → redirect to LINE Login
 * 2. GET ?action=callback&code=xxx → exchange code, create/login Supabase user
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  const LINE_CHANNEL_ID = Deno.env.get('LINE_LOGIN_CHANNEL_ID') || ''
  const LINE_CHANNEL_SECRET = Deno.env.get('LINE_LOGIN_CHANNEL_SECRET') || ''
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const SITE_URL = Deno.env.get('SITE_URL') || 'https://sme-ops-system.vercel.app'
  const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/line-login?action=callback`

  // ── Step 1: Redirect to LINE Login ──
  if (action === 'authorize') {
    const state = crypto.randomUUID()
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?` +
      `response_type=code` +
      `&client_id=${LINE_CHANNEL_ID}` +
      `&redirect_uri=${encodeURIComponent(CALLBACK_URL)}` +
      `&state=${state}` +
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
      // Exchange code for access token
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

      // Get user profile
      const profileRes = await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      const profile = await profileRes.json()

      // Try to get email from ID token (if available)
      let email = ''
      if (tokenData.id_token) {
        try {
          const payload = JSON.parse(atob(tokenData.id_token.split('.')[1]))
          email = payload.email || ''
        } catch { /* no email in token */ }
      }

      const lineUserId = profile.userId
      const displayName = profile.displayName || ''

      // ── Find matching employee ──
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

      // Try by line_user_id first
      let { data: employee } = await supabase
        .from('employees')
        .select('*')
        .eq('line_user_id', lineUserId)
        .maybeSingle()

      // Fallback: try by email
      if (!employee && email) {
        const { data } = await supabase
          .from('employees')
          .select('*')
          .eq('email', email)
          .maybeSingle()
        employee = data
      }

      // Fallback: try by name
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

      // Update employee's line_user_id if not set
      if (!employee.line_user_id) {
        await supabase.from('employees').update({ line_user_id: lineUserId }).eq('id', employee.id)
      }

      // ── Create or sign in Supabase auth user ──
      const authEmail = employee.email || `line_${lineUserId}@sme-ops.local`

      // Try to find existing auth user
      const { data: { users } } = await supabase.auth.admin.listUsers()
      const existingUser = users?.find(u => u.email === authEmail)

      if (!existingUser) {
        // Create new user (no password needed — we use magic link)
        const { error } = await supabase.auth.admin.createUser({
          email: authEmail,
          email_confirm: true,
          user_metadata: { full_name: employee.name, line_user_id: lineUserId },
        })
        if (error && !error.message.includes('already')) throw error
      }

      // Generate a magic link for secure auto-login (no password in URL)
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: authEmail,
        options: { redirectTo: `${SITE_URL}/` },
      })

      if (linkError || !linkData) {
        throw new Error(linkError?.message || '無法產生登入連結')
      }

      // Extract the token hash from the generated link and redirect
      // The generated link contains the full verification URL
      const magicLink = linkData.properties?.action_link
      if (magicLink) {
        return new Response(null, {
          status: 302,
          headers: { Location: magicLink, ...corsHeaders },
        })
      }

      // Fallback: redirect with token_hash and type for Supabase auth verification
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
