import { postFromDocument } from '../../accounting/postingEngine.js'
import { logger } from '../../logger.js'

/**
 * F-A2 傳票自動拋轉 handlers。
 *
 * 規則表（posting_rules）驅動的單據→傳票拋轉，取代 financeHandlers 內
 * 硬寫科目的傳票路徑：
 *   - wms.shipment.completed        → 銷貨出貨（借 應收 / 貸 銷貨收入+銷項稅額）
 *   - purchase.goods_receipt.completed → 進貨驗收（借 存貨+進項稅額 / 貸 應付）
 *   - finance.payment.recorded      → 收款 / 付款
 *
 * 防雙重入帳（與 legacy financeHandlers 並存）：
 *   1. financeHandlers 的傳票段以 hasActiveRule() 讓位 — 有啟用規則就跳過硬寫路徑
 *   2. DB 冪等鍵：journal_entries (organization_id, source_type, source_ref)
 *      partial unique index — RPC 撞鍵直接回傳既有傳票
 *   3. EventBus 冪等 middleware 擋同一事件重播
 *
 * 拋轉失敗一律 throw：讓 EventBus 的 DLQ middleware 接手，不吞錯。
 */
export function registerPostingHandlers(bus) {
  // ── 銷貨出貨 → 傳票 ──
  bus.subscribe('wms.shipment.completed', async function onShipmentAutoPost(event) {
    const { shipment_id, customer, total_amount, tax, store_id } = event.payload

    const entry = await postFromDocument('sales_shipment', 'wms.shipment', shipment_id, {
      total: total_amount,
      tax: tax ?? 0,
      store_id,
      description: `銷貨出貨自動拋轉 - ${customer ?? ''} (${shipment_id})`,
    })

    await publishAutoPosted(bus, event, entry, 'sales_shipment', 'wms.shipment', shipment_id, total_amount)
  })

  // ── 進貨驗收 → 傳票 ──
  bus.subscribe('purchase.goods_receipt.completed', async function onGoodsReceiptAutoPost(event) {
    const { receipt_id, po_id, po_number, supplier, total_amount, tax, shipping, warehouse_id } = event.payload
    const total = (total_amount || 0) + (tax || 0) + (shipping || 0)
    const sourceId = receipt_id ?? po_id

    const entry = await postFromDocument('purchase_receipt', 'purchase.goods_receipt', sourceId, {
      total,
      tax: tax ?? 0,
      warehouse_id,
      description: `進貨驗收自動拋轉 - ${supplier ?? ''} (${po_number ?? sourceId})`,
    })

    await publishAutoPosted(bus, event, entry, 'purchase_receipt', 'purchase.goods_receipt', sourceId, total)
  })

  // ── 收款 / 付款 → 傳票 ──
  bus.subscribe('finance.payment.recorded', async function onPaymentAutoPost(event) {
    const { payment_id, type, amount, reference_id } = event.payload
    // type 慣例：'付款'（對供應商）→ payment_made；其餘（收款）→ payment_received
    const docType = String(type || '').includes('付') ? 'payment_made' : 'payment_received'

    const entry = await postFromDocument(docType, 'finance.payment', payment_id, {
      amount,
      description: `${docType === 'payment_made' ? '付款' : '收款'}自動拋轉 (${reference_id ?? payment_id})`,
    })

    await publishAutoPosted(bus, event, entry, docType, 'finance.payment', payment_id, amount)
  })
}

/** 拋轉成功 → 發 finance.voucher.auto_posted 下游事件（規則停用 entry=null 則略過） */
async function publishAutoPosted(bus, causeEvent, entry, docType, sourceType, sourceId, totalAmount) {
  if (!entry) return // 規則停用，postingEngine 已記 log

  logger.info('[postingHandlers] 傳票自動拋轉完成', {
    docType, sourceType, sourceId: String(sourceId), entryId: entry.id,
  })

  await bus.publish('finance.voucher.auto_posted', {
    entry_id: String(entry.id),
    entry_number: entry.entry_number,
    doc_type: docType,
    source_type: sourceType,
    source_id: String(sourceId),
    total_amount: totalAmount,
  }, {
    causation_id: causeEvent.id,
    correlation_id: causeEvent.metadata?.correlation_id,
  })
}
