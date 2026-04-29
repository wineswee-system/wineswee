import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, messages } = await req.json()

    if (!to || !messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Missing "to" or "messages"' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW')
    if (!token) {
      return new Response(JSON.stringify({ error: 'LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ to, messages }),
    })

    const status = res.status
    let body: Record<string, unknown> = { ok: res.ok, status }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      body = { ...body, error: err }
    }

    return new Response(JSON.stringify(body), {
      status: res.ok ? 200 : status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
