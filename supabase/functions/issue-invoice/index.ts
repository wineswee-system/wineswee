// 電子發票開立 (issue-invoice)
// Input: { paymentId } — 對應 pos_payments.id（拆帳時每筆付款各開一張發票）
// Provider 由 INVOICE_PROVIDER 環境變數決定：'mock'（預設）| 'wenchung'（文中 CERP）| 'ecpay'
// 冪等：已開立直接回傳既有號碼；併發時靠 pos_invoices.payment_id 唯一索引擋重複。

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  paymentId: string
}

interface ProviderResult {
  invoiceNumber: string
  response: Record<string, unknown>
}

const MOBILE_BARCODE_RE = /^\/[0-9A-Z+\-.]{7}$/ // 手機條碼載具：/ 開頭 + 7 碼
const TAX_ID_RE = /^\d{8}$/                     // 統一編號 8 碼

// 發票期別：雙月一期，取奇數月 YYYYMM（例 2026/07、2026/08 → '202607'）
function invoicePeriod(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const odd = m % 2 === 1 ? m : m - 1
  return `${y}${String(odd).padStart(2, '0')}`
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

    // ── 1. 載入付款記錄 ──
    const { data: payment, error: payErr } = await supabase
      .from('pos_payments')
      .select('id, organization_id, store_id, order_id, amount, payment_method, carrier_type, carrier_number, invoice_number, invoice_status, paid_at')
      .eq('id', paymentId)
      .single()

    if (payErr || !payment) return json({ error: '找不到付款記錄' }, 404)

    // 冪等：已開立直接回傳既有號碼
    if (payment.invoice_status === 'issued' && payment.invoice_number) {
      return json({ ok: true, alreadyIssued: true, invoiceNumber: payment.invoice_number })
    }
    if (payment.invoice_status === 'voided') {
      return json({ error: '此付款之發票已作廢，無法重新開立' }, 409)
    }

    const total = Number(payment.amount)
    if (!Number.isFinite(total) || total <= 0) {
      return json({ error: '付款金額異常，無法開立發票' }, 400)
    }

    // ── 2. 載入訂單（買受人資訊）與明細 ──
    const { data: order } = await supabase
      .from('pos_orders')
      .select('id, order_number, buyer_tax_id, buyer_company, carrier_type, carrier_id')
      .eq('id', payment.order_id)
      .maybeSingle()

    const { data: items } = await supabase
      .from('pos_order_items')
      .select('name, quantity, unit_price')
      .eq('order_id', payment.order_id)

    // ── 3. 載具 / 統編驗證 ──
    const carrierType = payment.carrier_type || order?.carrier_type || null
    let carrierNumber = payment.carrier_number || order?.carrier_id || null
    // 手機條碼載具（pos_payments 用財政部代碼 '3J0002'，pos_orders 用 'mobile'）
    if (carrierType === '3J0002' || carrierType === 'mobile') {
      carrierNumber = (carrierNumber || '').trim().toUpperCase()
      if (!MOBILE_BARCODE_RE.test(carrierNumber)) {
        return json({ error: '手機條碼載具格式錯誤（應為 / 開頭共 8 碼）' }, 400)
      }
    }

    // 統一編號 → B2B 發票（打統編）
    const buyerTaxId = order?.buyer_tax_id?.trim() || null
    if (buyerTaxId && !TAX_ID_RE.test(buyerTaxId)) {
      return json({ error: '統一編號格式錯誤（應為 8 位數字）' }, 400)
    }
    const buyerCompany = buyerTaxId ? (order?.buyer_company || null) : null

    // ── 4. 稅額計算（應稅 5%，內含稅）──
    const salesAmount = Math.round(total / 1.05)
    const taxAmount = Number((total - salesAmount).toFixed(2))

    // ── 5. Provider adapter ──
    const provider = (Deno.env.get('INVOICE_PROVIDER') || 'mock').toLowerCase()
    let result: ProviderResult

    if (provider === 'mock') {
      result = await issueMock(supabase, payment.organization_id, payment.paid_at)
    } else if (provider === 'wenchung') {
      // ── TODO(文中 CERP)：待業主提供憑證後實作（Blockers B1-B5，同 void-invoice）──
      // 所需環境變數：WENCHUNG_API_KEY / WENCHUNG_API_SECRET / WENCHUNG_SELLER_ID（營業人統編）/ WENCHUNG_ENDPOINT
      // 預期請求形狀（POST {WENCHUNG_ENDPOINT}/invoice/issue）：
      //   {
      //     sellerId:    WENCHUNG_SELLER_ID,
      //     buyerId:     buyerTaxId ?? '0000000000',  // B2C 無統編填 0000000000
      //     buyerName:   buyerCompany ?? '一般消費者',
      //     invoiceDate: 'YYYYMMDD',
      //     carrierType: carrierType,                 // '3J0002' 手機條碼等
      //     carrierId:   carrierNumber,
      //     salesAmount, taxAmount, totalAmount: total,
      //     items: (items ?? []).map(i => ({ description: i.name, quantity: i.quantity, unitPrice: i.unit_price })),
      //   }
      // 回應：{ invoiceNumber, randomNumber, ... } → 寫入 provider_response 並回填號碼
      if (!Deno.env.get('WENCHUNG_API_KEY') || !Deno.env.get('WENCHUNG_SELLER_ID')) {
        return json({ error: '尚未設定電子發票供應商憑證' }, 501)
      }
      return json({ error: '文中 CERP 串接尚未實作，請暫時使用 INVOICE_PROVIDER=mock' }, 501)
    } else if (provider === 'ecpay') {
      // ── TODO(綠界 ECPay)：待業主提供憑證後實作 ──
      // 所需環境變數：ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV / ECPAY_ENDPOINT
      // 預期請求形狀（POST {ECPAY_ENDPOINT}/B2CInvoice/Issue，Data 欄位需 AES-128-CBC 加密）：
      //   {
      //     MerchantID: ECPAY_MERCHANT_ID,
      //     RqHeader: { Timestamp },
      //     Data: encrypt({
      //       RelateNumber: paymentId,               // 冪等鍵
      //       CustomerIdentifier: buyerTaxId ?? '',
      //       CarrierType: carrierType === '3J0002' ? '3' : '',
      //       CarrierNum: carrierNumber ?? '',
      //       SalesAmount: total, TaxType: '1',
      //       Items: (items ?? []).map(i => ({ ItemName: i.name, ItemCount: i.quantity, ItemPrice: i.unit_price })),
      //     }),
      //   }
      // 回應：{ InvoiceNo, InvoiceDate, RandomNumber, ... } → 寫入 provider_response 並回填號碼
      if (!Deno.env.get('ECPAY_MERCHANT_ID') || !Deno.env.get('ECPAY_HASH_KEY') || !Deno.env.get('ECPAY_HASH_IV')) {
        return json({ error: '尚未設定電子發票供應商憑證' }, 501)
      }
      return json({ error: '綠界 ECPay 串接尚未實作，請暫時使用 INVOICE_PROVIDER=mock' }, 501)
    } else {
      return json({ error: `不支援的發票供應商：${provider}` }, 400)
    }

    const { invoiceNumber, response: providerResponse } = result
    const invoiceDate = new Date().toISOString().slice(0, 10)

    // ── 6. 寫入發票記錄 ──
    const { error: invErr } = await supabase.from('pos_invoices').insert({
      organization_id: payment.organization_id,
      store_id:        payment.store_id,
      order_id:        payment.order_id,
      payment_id:      payment.id,
      invoice_number:  invoiceNumber,
      invoice_date:    invoiceDate,
      sales_amount:    salesAmount,
      tax_amount:      taxAmount,
      carrier_type:    carrierType,
      carrier_id:      carrierNumber,
      buyer_tax_id:    buyerTaxId,
      buyer_company:   buyerCompany,
      status:          'issued',
      provider,
      provider_response: {
        ...providerResponse,
        items: (items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unit_price: i.unit_price })),
      },
    })

    if (invErr) {
      // 併發開立：另一請求已先寫入（payment_id 唯一索引）→ 回傳既有發票
      if (invErr.code === '23505') {
        const { data: existing } = await supabase
          .from('pos_invoices')
          .select('invoice_number')
          .eq('payment_id', payment.id)
          .maybeSingle()
        if (existing) return json({ ok: true, alreadyIssued: true, invoiceNumber: existing.invoice_number })
      }
      return json({ error: `發票記錄寫入失敗：${invErr.message}` }, 500)
    }

    // ── 7. 回填付款狀態 ──
    const { error: updErr } = await supabase
      .from('pos_payments')
      .update({ invoice_status: 'issued', invoice_number: invoiceNumber })
      .eq('id', paymentId)
    if (updErr) return json({ error: `付款狀態更新失敗：${updErr.message}` }, 500)

    return json({ ok: true, invoiceNumber, provider, salesAmount, taxAmount, invoiceDate })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '伺服器錯誤'
    return json({ error: msg }, 500)
  }
})

// ── mock provider：從 invoice_number_sequences 原子性配號（模擬真實字軌行為）──
async function issueMock(
  supabase: SupabaseClient,
  organizationId: number,
  paidAt: string | null,
): Promise<ProviderResult> {
  const track = (Deno.env.get('MOCK_INVOICE_TRACK') || 'AB').toUpperCase()
  const period = invoicePeriod(paidAt ? new Date(paidAt) : new Date())

  const { data: seq, error: seqErr } = await supabase.rpc('allocate_invoice_number', {
    p_org_id: organizationId,
    p_period: period,
    p_track:  track,
  })
  if (seqErr || seq === null || seq === undefined) {
    throw new Error(`發票號碼配號失敗：${seqErr?.message ?? '未知錯誤'}`)
  }

  const n = Number(seq) // rpc 回傳 BIGINT；範圍 ≤ 99999999，Number 安全
  return {
    invoiceNumber: `${track}${String(n).padStart(8, '0')}`,
    response: {
      provider: 'mock',
      period,
      track,
      sequence: n,
      note: '模擬開立（未上傳財政部，正式環境請設定 INVOICE_PROVIDER）',
    },
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
