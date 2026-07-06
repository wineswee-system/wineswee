// linepay-confirm — LINE Pay v3 Confirm API（使用者授權後請款，完成交易）
// 機敏金鑰 (ChannelSecret) 只存在於 Edge Function secrets。
// 冪等性：LINE Pay 對已請款交易回 1169/1172 類錯誤碼，視為已完成不重複請款。
import { lineApiBase, lineHeaders, parseLinePayResponse } from '../_shared/linepay.ts'
import { verifyEmployeeCaller } from '../_shared/auth.ts'

const SITE_URL = Deno.env.get('SITE_URL') || '*'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  transactionId: string
  amount: number
  currency?: string
}

// 已請款/已處理過的 returnCode → 冪等成功（不可重複請款）
const ALREADY_CAPTURED_CODES = new Set(['1169', '1172', '1198'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // 請款操作限內部員工（POS 端已登入）— 防止匿名者以他組織的 transactionId 請款
    const caller = await verifyEmployeeCaller(req)
    if (!caller) return json({ error: '未授權：請款僅限內部員工' }, 401)

    const body: RequestBody = await req.json()
    const { transactionId, amount, currency } = body

    if (!transactionId) return json({ error: '缺少 transactionId' }, 400)
    const total = Math.round(Number(amount))
    if (!Number.isFinite(total) || total <= 0) return json({ error: '付款金額必須大於零' }, 400)

    const channelId = Deno.env.get('LINEPAY_CHANNEL_ID')
    const channelSecret = Deno.env.get('LINEPAY_CHANNEL_SECRET')

    // 未設定憑證 → 模擬模式（與 linepay-checkout 對稱）
    if (!channelId || !channelSecret) {
      return json({
        ok: true,
        simulated: true,
        transactionId,
        message: 'LINE Pay 憑證未設定，模擬請款成功',
      })
    }

    const sandbox = Deno.env.get('LINEPAY_SANDBOX') === '1'
    const uri = `/v3/payments/${transactionId}/confirm`
    const requestBody = JSON.stringify({ amount: total, currency: currency || 'TWD' })

    const headers = await lineHeaders(channelId, channelSecret, uri, requestBody)
    const res = await fetch(`${lineApiBase(sandbox)}${uri}`, {
      method: 'POST',
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(15000),
    })

    const data = parseLinePayResponse(await res.text())

    if (data.returnCode === '0000') {
      return json({
        ok: true,
        simulated: false,
        transactionId: String(data.info?.transactionId ?? transactionId),
        orderId: data.info?.orderId ?? null,
      })
    }

    if (ALREADY_CAPTURED_CODES.has(String(data.returnCode))) {
      return json({ ok: true, simulated: false, transactionId, alreadyCaptured: true })
    }

    return json({
      ok: false,
      returnCode: data.returnCode,
      message: `LINE Pay 請款失敗 (${data.returnCode}): ${data.returnMessage ?? ''}`,
    }, 502)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '伺服器錯誤'
    return json({ error: msg }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
