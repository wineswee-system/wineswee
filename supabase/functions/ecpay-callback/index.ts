// ecpay-callback — ECPay ReturnURL 付款結果通知接收端 (server-to-server)
// ECPay 以 application/x-www-form-urlencoded POST 通知；必須：
//   1. 重算並驗證 CheckMacValue（不符 → 400 拒絕）
//   2. RtnCode === '1' 時以 service role 更新 pos_payments（金流狀態變更一律走伺服器端）
//   3. 回應純文字 '1|OK'，否則 ECPay 會持續重送
// 此端點必須設定 verify_jwt = false（ECPay 不會帶 Supabase JWT）。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateCheckMacValue } from '../_shared/ecpay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  try {
    const text = await req.text()
    const form = new URLSearchParams(text)
    const data: Record<string, string> = {}
    for (const [k, v] of form.entries()) data[k] = v

    const hashKey = Deno.env.get('ECPAY_HASH_KEY')
    const hashIV = Deno.env.get('ECPAY_HASH_IV')
    if (!hashKey || !hashIV) {
      console.error(JSON.stringify({ level: 'error', fn: 'ecpay-callback', message: 'ECPay 憑證未設定' }))
      return text400('0|ECPay 憑證未設定')
    }

    const received = data.CheckMacValue
    if (!received) return text400('0|缺少 CheckMacValue')

    const expected = await generateCheckMacValue(data, hashKey, hashIV)
    if (expected !== received.toUpperCase()) {
      console.error(JSON.stringify({
        level: 'error', fn: 'ecpay-callback',
        message: 'CheckMacValue 驗證失敗',
        merchantTradeNo: data.MerchantTradeNo || null,
      }))
      return text400('0|CheckMacValue 驗證失敗')
    }

    const merchantTradeNo = data.MerchantTradeNo || ''
    const success = data.RtnCode === '1'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: rows, error: selErr } = await supabase
      .from('pos_payments')
      .select('id, status')
      .eq('merchant_trade_no', merchantTradeNo)
      .limit(1)

    if (selErr) {
      console.error(JSON.stringify({ level: 'error', fn: 'ecpay-callback', message: '查詢 pos_payments 失敗', error: selErr.message }))
      // 簽章已驗證通過 — 回 1|OK 避免 ECPay 無限重送，錯誤留待日誌追蹤
      return textOK()
    }

    const row = rows?.[0]
    if (!row) {
      console.warn(JSON.stringify({
        level: 'warn', fn: 'ecpay-callback',
        message: '找不到對應的 pos_payments 記錄', merchantTradeNo,
      }))
      return textOK()
    }

    // Idempotent：已確認過的付款直接回 1|OK
    if (row.status === 'confirmed') return textOK()

    const { error: updErr } = await supabase
      .from('pos_payments')
      .update({
        status: success ? 'confirmed' : 'failed',
        gateway_transaction_id: data.TradeNo || null,
      })
      .eq('id', row.id)

    if (updErr) {
      console.error(JSON.stringify({ level: 'error', fn: 'ecpay-callback', message: '更新 pos_payments 失敗', error: updErr.message }))
    }

    // 通知已成功接收並處理（含付款失敗通知）→ 一律回 1|OK
    return textOK()
  } catch (e) {
    const msg = e instanceof Error ? e.message : '伺服器錯誤'
    console.error(JSON.stringify({ level: 'error', fn: 'ecpay-callback', message: msg }))
    return new Response(`0|${msg}`, { status: 500, headers: { 'Content-Type': 'text/plain' } })
  }
})

// ECPay 要求成功回應的 body 必須是 '1|OK'
function textOK() {
  return new Response('1|OK', { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

function text400(msg: string) {
  return new Response(msg, { status: 400, headers: { 'Content-Type': 'text/plain' } })
}
