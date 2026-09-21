// ecpay-checkout — 建立 ECPay AioCheckOut 訂單參數（含伺服器端產生的 CheckMacValue）
// 機敏金鑰 (HashKey/HashIV) 只存在於 Edge Function secrets，絕不進入前端 bundle。
// 前端取得 { action, params } 後以表單 POST 導向 ECPay 付款頁。
import { ecpayGatewayUrl, formatTradeDate, generateCheckMacValue, toMerchantTradeNo } from '../_shared/ecpay.ts'

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
  tradeDesc?: string
  returnURL?: string // ClientBackURL — 付款完成後瀏覽器返回的頁面
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body: RequestBody = await req.json()
    const { orderId, amount, itemName, tradeDesc, returnURL } = body

    if (!orderId) return json({ error: '缺少 orderId' }, 400)
    const total = Math.round(Number(amount))
    if (!Number.isFinite(total) || total <= 0) return json({ error: '付款金額必須大於零' }, 400)

    const merchantId = Deno.env.get('ECPAY_MERCHANT_ID')
    const hashKey = Deno.env.get('ECPAY_HASH_KEY')
    const hashIV = Deno.env.get('ECPAY_HASH_IV')

    const merchantTradeNo = toMerchantTradeNo(orderId)

    // 未設定 ECPay 憑證 → 模擬模式，讓開發/測試流程照常運作
    if (!merchantId || !hashKey || !hashIV) {
      return json({
        simulated: true,
        merchantTradeNo,
        action: null,
        params: null,
        message: 'ECPay 憑證未設定，使用模擬模式',
      })
    }

    const stage = Deno.env.get('ECPAY_STAGE') === '1'
    const action = ecpayGatewayUrl(stage)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''

    const params: Record<string, string> = {
      MerchantID: merchantId,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: formatTradeDate(),
      PaymentType: 'aio',
      TotalAmount: String(total),
      TradeDesc: tradeDesc || '訂單付款',
      ItemName: itemName || '商品',
      ReturnURL: `${supabaseUrl}/functions/v1/ecpay-callback`, // server-to-server 付款結果通知
      ChoosePayment: 'Credit',
      EncryptType: '1',
    }

    const clientBackURL = returnURL || (SITE_URL !== '*' ? SITE_URL : '')
    if (clientBackURL) params.ClientBackURL = clientBackURL

    params.CheckMacValue = await generateCheckMacValue(params, hashKey, hashIV)

    return json({ action, params, merchantTradeNo })
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
