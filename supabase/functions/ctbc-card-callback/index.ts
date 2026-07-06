// ctbc-card-callback — 中國信託網路收單授權結果通知接收端 (server-to-server)
// 流程完全鏡射 ecpay-callback：
//   1. 驗證押碼 MAC（不符 → 400 拒絕，防偽造回呼）
//   2. 授權成功時以 service role 更新 pos_payments（金流狀態變更一律走伺服器端）
//   3. 回應成功字樣，否則收單行會持續重送
// 此端點必須設定 verify_jwt = false（中信不會帶 Supabase JWT）。
//
// ⚠️ Contract-first skeleton：回呼的 content-type / 欄位名 / 成功回應字樣
// 待中信正式 API 文件確認（見 _shared/ctbc.ts TODO）。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isAuthSuccess, verifyCallbackMac } from '../_shared/ctbc.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  try {
    // TODO: 確認回呼 content-type — 暫同時支援 form-urlencoded 與 JSON
    const contentType = req.headers.get('content-type') || ''
    const data: Record<string, string> = {}
    if (contentType.includes('application/json')) {
      const body = await req.json()
      for (const [k, v] of Object.entries(body)) data[k] = String(v)
    } else {
      const form = new URLSearchParams(await req.text())
      for (const [k, v] of form.entries()) data[k] = v
    }

    const macKey = Deno.env.get('CTBC_MAC_KEY')
    if (!macKey) {
      console.error(JSON.stringify({ level: 'error', fn: 'ctbc-card-callback', message: '中信憑證未設定' }))
      return text400('中信憑證未設定')
    }

    const ok = await verifyCallbackMac(data, macKey)
    if (!ok) {
      console.error(JSON.stringify({
        level: 'error', fn: 'ctbc-card-callback',
        message: 'MAC 驗證失敗',
        merchantTradeNo: data.lidm || null, // TODO: 確認訂單編號欄位名
      }))
      return text400('MAC 驗證失敗')
    }

    // TODO: 確認訂單編號欄位名（lidm？）與授權碼/卡號欄位名
    const merchantTradeNo = data.lidm || data.orderNo || ''
    const success = isAuthSuccess(data)

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
      console.error(JSON.stringify({ level: 'error', fn: 'ctbc-card-callback', message: '查詢 pos_payments 失敗', error: selErr.message }))
      // 押碼已驗證通過 — 回成功避免收單行無限重送，錯誤留待日誌追蹤
      return textOK()
    }

    const row = rows?.[0]
    if (!row) {
      console.warn(JSON.stringify({
        level: 'warn', fn: 'ctbc-card-callback',
        message: '找不到對應的 pos_payments 記錄', merchantTradeNo,
      }))
      return textOK()
    }

    // Idempotent：已確認過的付款直接回成功
    if (row.status === 'confirmed') return textOK()

    const update: Record<string, string | null> = {
      status: success ? 'confirmed' : 'failed',
      gateway: 'ctbc_online',
      acquirer: 'CTBC',
      // TODO: 確認交易序號欄位名（xid？authRRN？）
      gateway_transaction_id: data.xid || data.authRRN || null,
    }
    // TODO: 確認授權碼欄位名（authCode？）與末四碼欄位名（Last4digitPAN？）
    if (data.authCode) update.auth_code = data.authCode
    if (data.Last4digitPAN) update.card_last4 = data.Last4digitPAN

    const { error: updErr } = await supabase
      .from('pos_payments')
      .update(update)
      .eq('id', row.id)

    if (updErr) {
      console.error(JSON.stringify({ level: 'error', fn: 'ctbc-card-callback', message: '更新 pos_payments 失敗', error: updErr.message }))
    }

    // 通知已成功接收並處理（含授權失敗通知）→ 一律回成功
    return textOK()
  } catch (e) {
    const msg = e instanceof Error ? e.message : '伺服器錯誤'
    console.error(JSON.stringify({ level: 'error', fn: 'ctbc-card-callback', message: msg }))
    return new Response(msg, { status: 500, headers: { 'Content-Type': 'text/plain' } })
  }
})

// TODO: 確認中信要求的成功回應 body（暫回 'OK'）
function textOK() {
  return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

function text400(msg: string) {
  return new Response(msg, { status: 400, headers: { 'Content-Type': 'text/plain' } })
}
