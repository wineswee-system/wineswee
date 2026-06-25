import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    await supabase
      .from('pos_payments')
      .update({ invoice_status: 'voided' })
      .eq('id', paymentId)

    // TODO: When 文中 CERP credentials are available (Blockers B1-B5):
    // - voidType === 'void'        → POST 文中 API: 作廢 this invoice
    // - voidType === 'credit_note' → POST 文中 API: issue 折讓 against invoice_number
    // - Store 文中 response (new credit-note number) back to pos_payments

    return json({ ok: true, voidType, invoiceNumber: payment.invoice_number })
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
