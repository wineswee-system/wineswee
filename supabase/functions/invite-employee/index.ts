import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const SITE_URL = Deno.env.get('SITE_URL') || 'https://sme-ops-system.vercel.app'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Invite Employee — HR sends invitation email
 * Creates Supabase Auth user + sends magic link email
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth: require valid JWT with admin or super_admin role ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: '未授權' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: '憑證無效' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: caller } = await supabase
      .from('employees').select('role').eq('email', user.email).maybeSingle()
    if (!caller || !['admin', 'super_admin'].includes(caller.role)) {
      return new Response(JSON.stringify({ error: '權限不足：僅管理員可邀請員工' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { email, name, redirectTo } = await req.json()

    if (!email) {
      return new Response(JSON.stringify({ error: '缺少 email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const siteUrl = redirectTo || SITE_URL

    // Check if auth user already exists
    const { data: { users } } = await supabase.auth.admin.listUsers()
    const existing = users?.find(u => u.email === email)

    if (existing) {
      // User exists — send magic link to reset/login
      const { error } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: siteUrl },
      })
      if (error) throw error

      return new Response(JSON.stringify({
        ok: true,
        message: '此帳號已存在，已重新發送登入連結',
        existed: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create new auth user + send invite
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name || '' },
      redirectTo: siteUrl,
    })

    if (error) throw error

    return new Response(JSON.stringify({
      ok: true,
      message: `邀請信已發送至 ${email}`,
      userId: data.user?.id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: (err as Error).message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
