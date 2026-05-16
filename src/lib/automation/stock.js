import { supabase } from '../supabase'

// ── 1. CRM → WMS → 採購建議 ──
// 當 CRM 建立銷售訂單時，檢查 WMS 庫存，不足則自動產生採購申請
export async function checkStockAndCreatePR(orderItems, requester = '系統') {
  const shortages = []

  for (const item of orderItems) {
    // 查 WMS 庫存：stock_levels 只有 sku_code，先由 skus 表以品名查到 code
    const { data: sku } = await supabase.from('skus')
      .select('code, unit, unit_cost').eq('name', item.name).maybeSingle()
    const { data: stock } = sku?.code
      ? await supabase.from('stock_levels').select('*').eq('sku_code', sku.code).maybeSingle()
      : { data: null }

    const available = stock?.quantity || 0
    const needed = item.qty || 0

    if (available < needed) {
      shortages.push({
        name: item.name,
        current_stock: available,
        needed: needed,
        shortage: needed - available,
        // 建議採購量 = 缺少量 × 1.5 (安全係數)
        suggested_qty: Math.ceil((needed - available) * 1.5),
        unit: sku?.unit || item.unit || '個',
        price: sku?.unit_cost || item.price || 0,
      })
    }
  }

  if (shortages.length === 0) return { ok: true, shortages: [], pr: null }

  // 自動產生採購申請
  const prItems = shortages.map(s => ({
    name: s.name,
    qty: s.suggested_qty,
    unit: s.unit,
    price: s.price,
  }))
  const totalAmount = prItems.reduce((sum, i) => sum + i.qty * i.price, 0)

  const prNumber = `PR-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`

  const { data: pr, error } = await supabase.from('purchase_requests').insert({
    pr_number: prNumber,
    requester,
    department: '系統自動',
    items: prItems,
    total_amount: totalAmount,
    reason: `庫存不足自動產生（${shortages.map(s => s.name).join('、')}）`,
    status: '待審核',
  }).select().single()

  if (error) return { ok: false, error: error.message }

  return { ok: true, shortages, pr }
}
