// linepay-checkout — LINE Pay v3 Request API（建立付款請求，取得付款頁 URL）
// 機敏金鑰 (ChannelSecret) 只存在於 Edge Function secrets，絕不進入前端 bundle。
// 前端取得 { paymentUrl, transactionId } 後導向 LINE Pay 付款頁，
// 使用者完成授權後由前端呼叫 linepay-confirm 請款。
import { lineApiBase, lineHeaders, parseLinePayResponse } from '../_shared/linepay.ts'
import { verifyEmployeeCaller } from '../_shared/auth.ts'

// Restrict CORS to the app's own origin in production.
// Set SITE_URL via: supabase secrets set SITE_URL=https://your-domain.com
const SITE_URL = Deno.env.get('SITE_URL') || '*'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  orderId: string
  amount: number
  currency?: string
  productName?: string
  confirmUrl?: string
  cancelUrl?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // 建立付款請求限內部員工（POS 端已登入）— 防止匿名 orderId 枚舉
    const caller = await verifyEmployeeCaller(req)
    if (!caller) return json({ error: '未授權：付款請求僅限內部員工' }, 401)

    const body: RequestBody = await req.json()
    const { orderId, amount, currency, productName, confirmUrl, cancelUrl } = body

    if (!orderId) return json({ error: '缺少 orderId' }, 400)
    const total = Math.round(Number(amount))
    if (!Number.isFinite(total) || total <= 0) return json({ error: '付款金額必須大於零' }, 400)

    const channelId = Deno.env.get('LINEPAY_CHANNEL_ID')
    const channelSecret = Deno.env.get('LINEPAY_CHANNEL_SECRET')

    // 未設定 LINE Pay 憑證 → 模擬模式，讓開發/測試流程照常運作
    if (!channelId || !channelSecret) {
      return json({
        simulated: true,
        transactionId: null,
        paymentUrl: null,
        orderId,
        message: 'LINE Pay 憑證未設定，使用模擬模式',
      })
    }

    const sandbox = Deno.env.get('LINEPAY_SANDBOX') === '1'
    const fallbackUrl = SITE_URL !== '*' ? SITE_URL : 'https://example.invalid/pos'

    const uri = '/v3/payments/request'
    const requestBody = JSON.stringify({
      amount: total,
      currency: currency || 'TWD',
      orderId,
      packages: [
        {
          id: orderId,
          amount: total,
          name: productName || 'POS 銷售',
          products: [{ name: productName || 'POS 銷售', quantity: 1, price: total }],
        },
      ],
      redirectUrls: {
        confirmUrl: confirmUrl || fallbackUrl,
        cancelUrl: cancelUrl || fallbackUrl,
      },
    })

    const headers = await lineHeaders(channelId, channelSecret, uri, requestBody)
    const res = await fetch(`${lineApiBase(sandbox)}${uri}`, {
      method: 'POST',
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(15000),
    })

    const data = parseLinePayResponse(await res.text())

    if (data.returnCode !== '0000') {
      return json({
        error: `LINE Pay 建立付款失敗 (${data.returnCode}): ${data.returnMessage ?? ''}`,
        returnCode: data.returnCode,
      }, 502)
    }

    return json({
      simulated: false,
      transactionId: String(data.info?.transactionId ?? ''),
      paymentUrl: data.info?.paymentUrl?.web ?? null,
      paymentUrlApp: data.info?.paymentUrl?.app ?? null,
      orderId,
    })
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
