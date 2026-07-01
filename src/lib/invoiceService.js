/**
 * 電子發票服務（client wrapper）
 *
 * 發票號碼配號、稅額計算、供應商串接一律在 server-side edge function
 * (supabase/functions/issue-invoice) 完成 — 前端只負責觸發與重試。
 *
 * 失敗容錯：edge function 不可達時「交易仍視為成功」，付款維持
 * invoice_status='pending'，之後由 retryPendingInvoices()（手動按鈕或排程）補開。
 */
import { supabase } from './supabase'
import { logger } from './logger'

/**
 * 開立單筆發票（冪等 — 已開立會回傳既有號碼）
 * @param {string} paymentId - pos_payments.id
 * @returns {Promise<{ok: boolean, invoiceNumber?: string, alreadyIssued?: boolean, pending?: boolean, error?: string}>}
 *   ok=false 時不會 throw：付款維持 pending，可稍後重試
 */
export async function issueInvoice(paymentId) {
  if (!paymentId) return { ok: false, error: '缺少付款編號' }

  try {
    const { data, error } = await supabase.functions.invoke('issue-invoice', {
      body: { paymentId },
    })

    if (error) {
      logger.warn('E-invoice issuance failed, payment stays pending for retry', {
        module: 'pos', payment_id: paymentId, reason: error.message,
      })
      return { ok: false, pending: true, error: '發票開立失敗，付款已完成，可稍後補開' }
    }

    if (data?.error) {
      logger.warn('E-invoice provider rejected issuance', {
        module: 'pos', payment_id: paymentId, reason: data.error,
      })
      return { ok: false, pending: true, error: data.error }
    }

    return {
      ok: true,
      invoiceNumber: data?.invoiceNumber,
      alreadyIssued: !!data?.alreadyIssued,
      provider: data?.provider,
    }
  } catch (e) {
    // 網路層失敗（edge function 不可達）— 交易不受影響
    logger.error('E-invoice edge function unreachable', {
      module: 'pos', payment_id: paymentId, reason: e?.message,
    })
    return { ok: false, pending: true, error: '發票服務暫時無法連線，交易已完成，發票將稍後補開' }
  }
}

/**
 * 補開所有待開立發票（invoice_status='pending'）
 * 供發票查詢頁手動按鈕或未來排程（cron）呼叫。
 * @param {{storeId?: number|string, limit?: number}} [opts]
 * @returns {Promise<{ok: boolean, total: number, issued: number, failed: number, errors: Array, error?: string}>}
 */
export async function retryPendingInvoices({ storeId = null, limit = 50 } = {}) {
  let q = supabase
    .from('pos_payments')
    .select('id')
    .eq('invoice_status', 'pending')
    .order('paid_at', { ascending: true })
    .limit(limit)
  if (storeId) q = q.eq('store_id', storeId)

  const { data: rows, error } = await q
  if (error) {
    logger.error('Failed to load pending invoices for retry', { module: 'pos', reason: error.message })
    return { ok: false, total: 0, issued: 0, failed: 0, errors: [], error: '無法載入待開立清單' }
  }

  let issued = 0
  let failed = 0
  const errors = []

  // 逐筆開立（配號需依序，避免同時打爆供應商 API）
  for (const row of rows ?? []) {
    const res = await issueInvoice(row.id)
    if (res.ok) {
      issued++
    } else {
      failed++
      errors.push({ paymentId: row.id, error: res.error })
    }
  }

  return { ok: true, total: rows?.length ?? 0, issued, failed, errors }
}
