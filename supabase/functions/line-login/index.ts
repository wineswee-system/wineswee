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
      return new Response(redirectHtml(SITE_URL, 'LINE 登入失敗：無授權碼'), {
        headers: { 'Content-Type': 'text/html', ...corsHeaders },
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
        return new Response(redirectHtml(SITE_URL, `LINE token 交換失敗：${err}`), {
          headers: { 'Content-Type': 'text/html', ...corsHeaders },
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
        return new Response(redirectHtml(SITE_URL, `找不到員工帳號。LINE名稱：${displayName}，請聯繫HR設定。`), {
          headers: { 'Content-Type': 'text/html', ...corsHeaders },
        })
      }

      // Update employee's line_user_id if not set
      if (!employee.line_user_id) {
        await supabase.from('employees').update({ line_user_id: lineUserId }).eq('id', employee.id)
      }

      // ── Create or sign in Supabase auth user ──
      const authEmail = employee.email || `line_${lineUserId}@sme-ops.local`
      const linePassword = `LINE_${lineUserId}_${LINE_CHANNEL_SECRET.slice(0, 8)}`

      // Try to find existing auth user
      const { data: { users } } = await supabase.auth.admin.listUsers()
      const existingUser = users?.find(u => u.email === authEmail)

      if (!existingUser) {
        // Create new user with deterministic password
        const { error } = await supabase.auth.admin.createUser({
          email: authEmail,
          password: linePassword,
          email_confirm: true,
          user_metadata: { full_name: employee.name, line_user_id: lineUserId },
        })
        if (error && !error.message.includes('already')) throw error
      } else {
        // Update password to ensure it matches
        await supabase.auth.admin.updateUserById(existingUser.id, {
          password: linePassword,
        })
      }

      // Redirect to frontend with credentials for auto-login
      const redirectUrl = `${SITE_URL}/login?line_email=${encodeURIComponent(authEmail)}&line_pass=${encodeURIComponent(linePassword)}`
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl, ...corsHeaders },
      })

    } catch (err) {
      return new Response(redirectHtml(SITE_URL, `LINE 登入錯誤：${(err as Error).message}`), {
        headers: { 'Content-Type': 'text/html', ...corsHeaders },
      })
    }
  }

  return new Response(JSON.stringify({ error: 'Unknown action. Use ?action=authorize or ?action=callback' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

function redirectHtml(siteUrl: string, message: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<script>
  alert("${message.replace(/"/g, '\\"')}");
  window.location.href = "${siteUrl}";
</script>
</head><body></body></html>`
}
