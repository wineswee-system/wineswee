import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Resolve the LINE channel access token for a given channel code.
 * Convention (preferred): LINE_CHANNEL_ACCESS_TOKEN_{CODE}
 * Also accepts (legacy): LINE_CHANNEL_TOKEN_{CODE}
 * Suffix: uppercase, hyphens → underscores (e.g. "sme-ops" → SME_OPS)
 * Fallback: unsuffixed LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_TOKEN.
 */
function resolveToken(channelCode?: string): string | null {
  if (channelCode) {
    const suffix = channelCode.toUpperCase().replace(/-/g, '_')
    const primary = Deno.env.get(`LINE_CHANNEL_ACCESS_TOKEN_${suffix}`)
    if (primary) return primary
    const legacy = Deno.env.get(`LINE_CHANNEL_TOKEN_${suffix}`)
    if (legacy) return legacy
  }
  return Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') || Deno.env.get('LINE_CHANNEL_TOKEN') || null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, messages, channelCode } = await req.json()

    if (!to || !messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Missing "to" or "messages"' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = resolveToken(channelCode)
    if (!token) {
      const hint = channelCode
        ? `No token for channel "${channelCode}". Set LINE_CHANNEL_TOKEN_${channelCode.toUpperCase().replace(/-/g, '_')} or LINE_CHANNEL_TOKEN.`
        : 'LINE_CHANNEL_TOKEN not configured'
      return new Response(JSON.stringify({ error: hint }), {
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
    let body: Record<string, unknown> = { ok: res.ok, status, channelCode: channelCode || 'default' }
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
