/**
 * 信用卡請款批次（F-D1 中國信託收單）資料層
 *
 * - 批次列表 / 未歸批卡收明細查詢
 * - 建立今日批次：把未歸批的 ctbc_edc / ctbc_online 卡收付款掛入批次
 *   （settlement_batch_id 指派為一般資料層 update；金額彙總回寫批次）
 * - 結算批次：狀態轉換 + 金額計算一律走 secure_close_settlement_batch RPC
 * - 結算後發布 finance.settlement.fee 事件（鬆耦合 — 拋轉引擎 F-A2 並行開發中，
 *   由其訂閱後產「借 手續費支出 / 貸 應收卡款」傳票）
 */
import { supabase } from '../supabase'
import { logger } from '../logger'
import { getEventBus } from '../events/index.js'

/** 中信卡收 gateway 值（店內 EDC 登錄 / 線上收單回寫） */
export const CARD_GATEWAYS = ['ctbc_edc', 'ctbc_online']

/** 淨額 = 總額 − 手續費（UI 試算與 RPC 同一公式） */
export function computeSettlementNet(grossAmount, feeAmount) {
  const gross = Number(grossAmount)
  const fee = Number(feeAmount)
  if (!Number.isFinite(gross) || gross < 0) throw new Error('批次總額無效')
  if (!Number.isFinite(fee) || fee < 0) throw new Error('手續費不可為負')
  if (fee > gross) throw new Error('手續費不可大於批次總額')
  return Math.round((gross - fee) * 100) / 100
}

/** 卡收明細合計（批次總額 = 明細金額合計） */
export function sumPaymentAmounts(payments = []) {
  return (payments ?? []).reduce((sum, p) => sum + (Number(p?.amount) || 0), 0)
}

/** 批次列表（新到舊） */
export const getSettlementBatches = (orgId) => {
  let q = supabase
    .from('settlement_batches')
    .select('*')
    .order('batch_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

/** 未歸批的中信卡收付款（gateway = ctbc_edc / ctbc_online、settlement_batch_id 為空） */
export const getUnassignedCardPayments = (orgId) => {
  let q = supabase
    .from('pos_payments')
    .select('id, amount, paid_at, card_brand, card_last4, auth_code, store_id')
    .in('gateway', CARD_GATEWAYS)
    .is('settlement_batch_id', null)
    .order('paid_at', { ascending: true })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

/**
 * 建立（或補入）今日請款批次：
 * 1. 撈未歸批卡收 → 2. upsert 今日批次（org+acquirer+batch_number 唯一）
 * 3. 指派 settlement_batch_id → 4. 以「已掛入明細合計」回寫批次 gross_amount
 * @returns {Promise<{batch: Object|null, assigned: number, message?: string}>}
 */
export async function createTodayBatch({ organizationId, storeId = null, acquirer = 'CTBC' } = {}) {
  if (!organizationId) throw new Error('缺少 organization_id')

  const today = new Date().toISOString().slice(0, 10)
  const batchNumber = `${acquirer}-${today.replace(/-/g, '')}`

  const { data: payments, error: payErr } = await getUnassignedCardPayments(organizationId)
  if (payErr) throw new Error(payErr.message || '無法載入未歸批卡收明細')
  if (!payments || payments.length === 0) {
    return { batch: null, assigned: 0, message: '目前沒有未歸批的卡收付款' }
  }

  // upsert 今日批次（同日重複點擊 → 補入同一批次）
  const { data: batch, error: batchErr } = await supabase
    .from('settlement_batches')
    .upsert(
      {
        organization_id: organizationId,
        store_id: storeId,
        acquirer,
        batch_number: batchNumber,
        batch_date: today,
        status: 'open',
      },
      { onConflict: 'organization_id,acquirer,batch_number' },
    )
    .select()
    .single()
  if (batchErr) throw new Error(batchErr.message || '建立請款批次失敗')

  if (batch.status === 'settled') throw new Error('今日批次已結算，不可再掛入付款')

  // 指派 settlement_batch_id
  const ids = payments.map((p) => p.id)
  const { error: assignErr } = await supabase
    .from('pos_payments')
    .update({ settlement_batch_id: batch.id })
    .in('id', ids)
  if (assignErr) throw new Error(assignErr.message || '卡收明細歸批失敗')

  // 批次總額 = 目前掛入本批次的全部明細合計（含先前已掛入者）
  const { data: linked, error: linkedErr } = await supabase
    .from('pos_payments')
    .select('amount')
    .eq('settlement_batch_id', batch.id)
  if (linkedErr) throw new Error(linkedErr.message || '無法彙總批次明細')

  const gross = sumPaymentAmounts(linked)
  const { data: updated, error: grossErr } = await supabase
    .from('settlement_batches')
    .update({ gross_amount: gross })
    .eq('id', batch.id)
    .select()
    .single()
  if (grossErr) throw new Error(grossErr.message || '回寫批次總額失敗')

  logger.info('Settlement batch created/updated', {
    module: 'finance', batch_id: batch.id, batch_number: batchNumber,
    assigned: ids.length, gross_amount: gross,
  })

  return { batch: updated ?? { ...batch, gross_amount: gross }, assigned: ids.length }
}

/**
 * 結算批次（狀態轉換 → secure RPC；驗證 gross = 明細合計、net = gross − fee）
 * 成功後發布 finance.settlement.fee 事件供拋轉引擎認列手續費。
 * @returns {Promise<Object>} 結算後的批次列
 */
export async function closeSettlementBatch({ batchId, feeAmount, depositDate = null } = {}) {
  if (!batchId) throw new Error('缺少批次編號')
  const fee = Number(feeAmount)
  if (!Number.isFinite(fee) || fee < 0) throw new Error('手續費不可為負')

  const { data, error } = await supabase.rpc('secure_close_settlement_batch', {
    p_batch_id: batchId,
    p_fee_amount: fee,
    p_deposit_date: depositDate,
  })
  if (error) throw new Error(error.message || '批次結算失敗')

  const batch = Array.isArray(data) ? data[0] : data

  // 手續費認列 → 發事件（鬆耦合：拋轉引擎訂閱後產傳票；發布失敗不影響結算結果）
  try {
    const bus = getEventBus()
    await bus.publish('finance.settlement.fee', {
      batch_id: String(batchId),
      fee_amount: fee,
      gross_amount: Number(batch?.gross_amount ?? 0),
      net_amount: Number(batch?.net_amount ?? 0),
      batch_number: batch?.batch_number ?? null,
      acquirer: batch?.acquirer ?? 'CTBC',
      deposit_date: batch?.deposit_date ?? depositDate ?? null,
    })
  } catch (e) {
    logger.warn('finance.settlement.fee event publish failed', {
      module: 'finance', batch_id: batchId, reason: e?.message,
    })
  }

  logger.info('Settlement batch closed', {
    module: 'finance', batch_id: batchId,
    fee_amount: fee, net_amount: batch?.net_amount,
  })

  return batch
}
