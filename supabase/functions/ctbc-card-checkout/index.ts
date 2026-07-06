// ctbc-card-checkout — 建立中國信託網路收單授權請求參數（含伺服器端押碼 MAC）
// F-D1 線上收單（外送/預購連結付款）。機敏金鑰 (CTBC_MAC_KEY 等) 只存在於
// Edge Function secrets，絕不進入前端 bundle。
// 前端取得 { action, params } 後以表單 POST 導向中信授權頁（同 ecpay-checkout 模式）。
// 授權結果由 ctbc-card-callback（server-to-server）寫回 pos_payments。
//
// ⚠️ Contract-first skeleton：實際欄位名/押碼演算法待中信 API 文件（見 _shared/ctbc.ts TODO）。
import { buildAuthRequest, toCtbcOrderNo } from '../_shared/ctbc.ts'
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
  itemName?: string
  returnURL?: string // 付款完成後瀏覽器返回的頁面
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // 建立授權請求限內部員工（POS 端已登入）— 防止匿名 orderId 枚舉
    const caller = await verifyEmployeeCaller(req)
    if (!caller) return json({ error: '未授權：付款請求僅限內部員工' }, 401)

    const body: RequestBody = await req.json()
    const { orderId, amount, returnURL } = body

    if (!orderId) return json({ error: '缺少 orderId' }, 400)
    const total = Math.round(Number(amount))
    if (!Number.isFinite(total) || total <= 0) return json({ error: '付款金額必須大於零' }, 400)

    const merchantId = Deno.env.get('CTBC_MERCHANT_ID')
    const terminalId = Deno.env.get('CTBC_TERMINAL_ID')
    const macKey = Deno.env.get('CTBC_MAC_KEY')
    const endpoint = Deno.env.get('CTBC_ENDPOINT')

    const merchantTradeNo = toCtbcOrderNo(orderId)

    // 未設定中信憑證 → 模擬模式，讓開發/測試流程照常運作
    if (!merchantId || !terminalId || !macKey || !endpoint) {
      return json({
        simulated: true,
        merchantTradeNo,
        action: null,
        params: null,
        message: '中信網路收單憑證未設定，使用模擬模式',
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const clientBackURL = returnURL || (SITE_URL !== '*' ? SITE_URL : '')

    const params = await buildAuthRequest({
      merchantId,
      terminalId,
      orderNo: merchantTradeNo,
      amount: total,
      callbackUrl: `${supabaseUrl}/functions/v1/ctbc-card-callback`, // server-to-server 授權結果通知
      clientBackUrl: clientBackURL || undefined,
    }, macKey)

    return json({ action: endpoint, params, merchantTradeNo })
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
