// 電子發票作廢/折讓 (void-invoice)
// Input: { paymentId } — 對應 pos_payments.id
// 同日（UTC 日曆日）→ 作廢（F0501）；跨日 → 折讓（D0401）
// Provider 由 INVOICE_PROVIDER 決定：'mock'（預設，僅改 DB）| 'efirst'（e首發票，先打 API 再改 DB）
// 失敗傳播：provider 呼叫失敗時「不」翻轉 DB 狀態，直接回錯誤讓前端重試。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  getEfirstConfig,
  buildVoidPayload,
  buildAllowancePayload,
  callEfirst,
  type EfirstItem,
} from '../_shared/efirst.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  paymentId: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body: RequestBody = await req.json()
    const { paymentId } = body

    if (!paymentId) return json({ error: '缺少 paymentId' }, 400)

    const { data: payment, error: payErr } = await supabase
      .from('pos_payments')
      .select('id, invoice_number, invoice_status, paid_at, amount, payment_method')
      .eq('id', paymentId)
      .single()

    if (payErr || !payment) return json({ error: '找不到付款記錄' }, 404)

    // Idempotent: already voided
    if (payment.invoice_status === 'voided') {
      return json({ ok: true, voidType: 'already_voided', invoiceNumber: payment.invoice_number })
    }

    // Same calendar day (UTC) → 作廢; different day → 折讓 (credit note)
    const paidDay  = new Date(payment.paid_at).toISOString().slice(0, 10)
    const today    = new Date().toISOString().slice(0, 10)
    const voidType = paidDay === today ? 'void' : 'credit_note'

    // 發票主檔（issue-invoice 寫入；含 invoice_date / 品項 / provider_response）
    const { data: invoiceRow } = await supabase
      .from('pos_invoices')
      .select('id, invoice_number, invoice_date, sales_amount, tax_amount, buyer_tax_id, provider, provider_response')
      .eq('payment_id', paymentId)
      .maybeSingle()

    const provider = (Deno.env.get('INVOICE_PROVIDER') || 'mock').toLowerCase()
    const invoiceNumber = invoiceRow?.invoice_number || payment.invoice_number || null
    let providerResponse: Record<string, unknown> | null = null

    // ── Provider 呼叫（先打 API，成功才改 DB；失敗直接回錯，不留半套狀態）──
    if (provider === 'efirst' && invoiceNumber) {
      const cfg = getEfirstConfig()
      if (!cfg) {
        return json({ error: '尚未設定 e首發票憑證（EFIRST_API_KEY / EFIRST_SELLER_ID / EFIRST_ENDPOINT）' }, 501)
      }

      const invoiceDate = invoiceRow?.invoice_date || paidDay
      let res
      if (voidType === 'void') {
        // 同日作廢（F0501 對應）
        const payload = buildVoidPayload(cfg, {
          relateNumber: paymentId,
          invoiceNumber,
          invoiceDate,
          voidDate: today,
          reason: '交易作廢',
        })
        // TODO(efirst-mapping)：API 路徑待官方文件確認（暫定 {endpoint}/invoices/void）
        res = await callEfirst(`${cfg.endpoint}/invoices/void`, cfg.apiKey, payload)
      } else {
        // 跨日折讓（D0401 對應）— 全額折讓；品項取開立時存於 provider_response 的明細
        const total = Number(payment.amount) || 0
        const salesAmount = Number(invoiceRow?.sales_amount) || Math.round(total / 1.05)
        const taxAmount = Number(invoiceRow?.tax_amount) || (total - salesAmount)
        const storedItems = (invoiceRow?.provider_response as { items?: Array<{ name: string; quantity: number; unit_price: number }> } | null)?.items ?? []
        const items: EfirstItem[] = storedItems.length > 0
          ? storedItems.map((i) => ({
              description: i.name,
              quantity: Number(i.quantity),
              unitPrice: Number(i.unit_price),
              amount: Math.round(Number(i.quantity) * Number(i.unit_price)),
            }))
          : [{ description: '銷貨折讓', quantity: 1, unitPrice: salesAmount, amount: salesAmount }]

        const payload = buildAllowancePayload(cfg, {
          relateNumber: `${paymentId}:allowance`, // 冪等鍵
          originalInvoiceNumber: invoiceNumber,
          originalInvoiceDate: invoiceDate,
          allowanceDate: today,
          buyerId: invoiceRow?.buyer_tax_id ?? null,
          taxAmount,
          totalAmount: salesAmount,
          items,
          reason: '退貨折讓',
        })
        // TODO(efirst-mapping)：API 路徑待官方文件確認（暫定 {endpoint}/allowances/issue）
        res = await callEfirst(`${cfg.endpoint}/allowances/issue`, cfg.apiKey, payload)
      }

      // 失敗傳播：不翻轉 DB 狀態，付款維持 issued，前端可重試
      if (!res.ok) {
        return json({ error: res.error ?? 'e首發票作廢/折讓失敗', providerStatus: res.status }, 502)
      }
      providerResponse = res.data ?? {}
    }
    // 其餘 provider（mock / wenchung / ecpay 佔位）維持僅改 DB 之既有行為

    // ── Provider 成功後才翻轉 DB 狀態 ──
    if (invoiceRow) {
      const { error: invUpdErr } = await supabase
        .from('pos_invoices')
        .update({
          status: voidType === 'void' ? 'voided' : 'allowance',
          provider_response: {
            ...((invoiceRow.provider_response as Record<string, unknown> | null) ?? {}),
            [voidType === 'void' ? 'void' : 'allowance']: {
              provider,
              void_type: voidType,
              processed_at: new Date().toISOString(),
              ...(providerResponse ?? {}),
            },
          },
        })
        .eq('id', invoiceRow.id)
      if (invUpdErr) return json({ error: `發票狀態更新失敗：${invUpdErr.message}` }, 500)
    }

    const { error: payUpdErr } = await supabase
      .from('pos_payments')
      .update({ invoice_status: 'voided' })
      .eq('id', paymentId)
    if (payUpdErr) return json({ error: `付款狀態更新失敗：${payUpdErr.message}` }, 500)

    return json({ ok: true, voidType, invoiceNumber: payment.invoice_number, provider })
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
