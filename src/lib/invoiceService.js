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
import { getEventBus } from './events/index.js'
import { getTenantOrgId } from './events/middleware/tenantContext.js'

/**
 * 發票生命週期事件（F-B3 進銷項憑證彙入用；發布失敗不影響開立/作廢結果）
 * @param {string} type - finance.invoice.issued | voided | allowance
 */
async function publishInvoiceEvent(type, payload) {
  try {
    const bus = getEventBus()
    await bus.publish(type, payload)
  } catch (e) {
    logger.warn(`${type} event publish failed`, {
      module: 'finance', payment_id: payload?.payment_id, reason: e?.message,
    })
  }
}

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

    // F-B3：開立成功 → 發事件（vatHandlers 訂閱後彙入銷項憑證檔；冪等，重試不重複計入）
    await publishInvoiceEvent('finance.invoice.issued', {
      payment_id: String(paymentId),
      invoice_number: data?.invoiceNumber ?? '',
      provider: data?.provider ?? null,
      already_issued: !!data?.alreadyIssued,
    })

    return {
      ok: true,
      invoiceNumber: data?.invoiceNumber,
      alreadyIssued: !!data?.alreadyIssued,
      provider: data?.provider,
      // 證明聯列印所需欄位（舊版 edge function 未回傳時為 null）
      randomCode:  data?.randomCode  ?? null,
      salesAmount: data?.salesAmount ?? null,
      taxAmount:   data?.taxAmount   ?? null,
      invoiceDate: data?.invoiceDate ?? null,
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
 * 作廢/折讓發票（同日 → 作廢 F0501；跨日 → 折讓 D0401，由 void-invoice edge function 判斷）
 * 成功後發布對應事件，vatHandlers 同步進銷項憑證檔（F-B3）。
 * @param {string} paymentId - pos_payments.id
 * @returns {Promise<{ok: boolean, voidType?: string, invoiceNumber?: string, error?: string}>}
 */
export async function voidInvoice(paymentId) {
  if (!paymentId) return { ok: false, error: '缺少付款編號' }

  try {
    const { data, error } = await supabase.functions.invoke('void-invoice', {
      body: { paymentId },
    })

    if (error || data?.error) {
      const reason = data?.error || error?.message
      logger.warn('E-invoice void/allowance failed', {
        module: 'finance', payment_id: paymentId, reason,
      })
      return { ok: false, error: reason || '發票作廢/折讓失敗，可稍後重試' }
    }

    // voidType：'void' 同日作廢 / 'credit_note' 跨日折讓 / 'already_voided' 冪等命中（不重發事件）
    if (data?.voidType === 'void') {
      await publishInvoiceEvent('finance.invoice.voided', {
        payment_id: String(paymentId),
        invoice_number: data?.invoiceNumber ?? null,
        provider: data?.provider ?? null,
      })
    } else if (data?.voidType === 'credit_note') {
      await publishInvoiceEvent('finance.invoice.allowance', {
        payment_id: String(paymentId),
        invoice_number: data?.invoiceNumber ?? null,
        provider: data?.provider ?? null,
      })
    }

    return { ok: true, voidType: data?.voidType, invoiceNumber: data?.invoiceNumber }
  } catch (e) {
    logger.error('E-invoice void edge function unreachable', {
      module: 'finance', payment_id: paymentId, reason: e?.message,
    })
    return { ok: false, error: '發票服務暫時無法連線，請稍後重試' }
  }
}

/**
 * 補開所有待開立發票（invoice_status='pending'）
 * 供發票查詢頁手動按鈕或未來排程（cron）呼叫。
 * @param {{storeId?: number|string, limit?: number}} [opts]
 * @returns {Promise<{ok: boolean, total: number, issued: number, failed: number, errors: Array, error?: string}>}
 */
export async function retryPendingInvoices({ storeId = null, limit = 50 } = {}) {
  const orgId = getTenantOrgId()
  let q = supabase
    .from('pos_payments')
    .select('id')
    .eq('invoice_status', 'pending')
    .order('paid_at', { ascending: true })
    .limit(limit)
  if (orgId) q = q.eq('organization_id', orgId)
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
