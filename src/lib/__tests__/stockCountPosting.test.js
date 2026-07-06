import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock supabase（同鄰居測試模式）────────────────────────────
// rpc: in-memory secure_post_stock_count — 狀態守門 + 冪等（已調帳回既有結果）
vi.mock('../supabase.js', () => {
  const state = {
    counts: new Map(),   // id → { status, result }
    postCalls: 0,        // 實際入帳次數（冪等驗證）
    rpcCalls: [],
    reset() {
      this.counts.clear()
      this.postCalls = 0
      this.rpcCalls = []
    },
  }

  const supabase = {
    __state: state,
    rpc: async (fn, args) => {
      state.rpcCalls.push({ fn, args })
      if (fn !== 'secure_post_stock_count') {
        return { data: null, error: { message: `unknown rpc: ${fn}` } }
      }
      const row = state.counts.get(args.p_count_id)
      if (!row) return { data: null, error: { message: `找不到盤點單 #${args.p_count_id}` } }
      if (row.status === '已調帳') {
        return { data: { ...row.result, already_posted: true }, error: null }
      }
      if (row.status !== '已核對') {
        return { data: null, error: { message: `僅「已核對」狀態的盤點單可執行調帳過帳（目前狀態：${row.status}）` } }
      }
      state.postCalls += 1
      row.status = '已調帳'
      row.result = {
        count_id: args.p_count_id,
        shortage_total: 100,
        overage_total: 30,
        variance_amount: -70,
        adjustments: 2,
        vouchers: [
          { kind: 'loss', amount: 100, entry_number: 'JE-SC-0001' },
          { kind: 'gain', amount: 30, entry_number: 'JE-SC-0002' },
        ],
        already_posted: false,
      }
      return { data: row.result, error: null }
    },
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  }

  return { supabase }
})

import { supabase } from '../supabase.js'
import {
  deriveVariances,
  splitLossGain,
  canPostStockCount,
  postStockCount,
  POSTABLE_STATUS,
} from '../stockCountPosting.js'

beforeEach(() => {
  supabase.__state.reset()
})

// ─── 1. items JSONB 差異導出 ─────────────────────────────────────
describe('deriveVariances — 自 stock_counts.items 導出逐品項差異', () => {
  it('差異 = 實盤 − 系統；金額 = 數量差 × 單價', () => {
    const variances = deriveVariances([
      { sku: 'SKU-001', name: '品項A', system_qty: 10, counted_qty: 8, unit_cost: 50 },   // 盤虧 2 → -100
      { sku: 'SKU-002', name: '品項B', system_qty: 5, counted_qty: 8, unit_cost: 10 },    // 盤盈 3 → +30
      { sku: 'SKU-003', name: '品項C', system_qty: 7, counted_qty: 7, unit_cost: 99 },    // 相符 → 略過
    ])
    expect(variances).toHaveLength(2)
    expect(variances[0]).toMatchObject({ sku_code: 'SKU-001', variance: -2, amount: -100 })
    expect(variances[1]).toMatchObject({ sku_code: 'SKU-002', variance: 3, amount: 30 })
  })

  it('支援 sku_code/sku_name 鍵名別名；缺品號列略過', () => {
    const variances = deriveVariances([
      { sku_code: 'SKU-009', sku_name: '別名鍵', system_qty: 4, counted_qty: 1, unit_cost: 2 },
      { name: '沒有品號', system_qty: 1, counted_qty: 0, unit_cost: 5 },
    ])
    expect(variances).toHaveLength(1)
    expect(variances[0]).toMatchObject({ sku_code: 'SKU-009', sku_name: '別名鍵', variance: -3, amount: -6 })
  })

  it('counted_qty 缺漏視同未盤（= 系統量，無差異）；空/null 輸入回空陣列', () => {
    expect(deriveVariances([{ sku: 'SKU-001', system_qty: 10, unit_cost: 5 }])).toHaveLength(0)
    expect(deriveVariances([])).toEqual([])
    expect(deriveVariances(null)).toEqual([])
  })

  it('缺 unit_cost → 金額 0（不產生 NaN）', () => {
    const [v] = deriveVariances([{ sku: 'SKU-001', system_qty: 3, counted_qty: 1 }])
    expect(v.amount).toBe(0)
    expect(Number.isFinite(v.amount)).toBe(true)
  })
})

// ─── 2. 盤盈/盤虧拆分 ────────────────────────────────────────────
describe('splitLossGain — 盤盈虧金額拆分（對應 default / overage 兩張傳票）', () => {
  it('盤虧、盤盈各自加總為正數金額，netAmount = 盈 − 虧', () => {
    const variances = deriveVariances([
      { sku: 'SKU-001', system_qty: 10, counted_qty: 8, unit_cost: 50 },  // 虧 100
      { sku: 'SKU-002', system_qty: 5, counted_qty: 8, unit_cost: 10 },   // 盈 30
      { sku: 'SKU-003', system_qty: 6, counted_qty: 5, unit_cost: 20 },   // 虧 20
    ])
    const split = splitLossGain(variances)
    expect(split.shortageTotal).toBe(120)
    expect(split.overageTotal).toBe(30)
    expect(split.netAmount).toBe(-90)
    expect(split.lossItems).toHaveLength(2)
    expect(split.gainItems).toHaveLength(1)
  })

  it('單向差異（只有盤虧）→ 盤盈 0', () => {
    const split = splitLossGain(deriveVariances([
      { sku: 'SKU-001', system_qty: 10, counted_qty: 9, unit_cost: 33.5 },
    ]))
    expect(split.shortageTotal).toBe(33.5)
    expect(split.overageTotal).toBe(0)
    expect(split.netAmount).toBe(-33.5)
  })

  it('空輸入 → 全 0', () => {
    const split = splitLossGain([])
    expect(split).toMatchObject({ shortageTotal: 0, overageTotal: 0, netAmount: 0 })
  })
})

// ─── 3. 狀態守門 ─────────────────────────────────────────────────
describe('status guard — 僅「已核對」可過帳', () => {
  it('canPostStockCount 僅接受 已核對', () => {
    expect(POSTABLE_STATUS).toBe('已核對')
    expect(canPostStockCount('已核對')).toBe(true)
    for (const s of ['盤點中', '已完成', '已調帳', '', null, undefined]) {
      expect(canPostStockCount(s)).toBe(false)
    }
  })

  it('postStockCount 對非「已核對」盤點單直接拒絕，不打 RPC', async () => {
    await expect(postStockCount({ id: 1, status: '盤點中' }))
      .rejects.toThrow(/僅「已核對」/)
    expect(supabase.__state.rpcCalls).toHaveLength(0)
  })

  it('SQL 端守門同樣拒絕（僅帶 id 呼叫時錯誤自 RPC 浮出）', async () => {
    supabase.__state.counts.set(7, { status: '盤點中', result: null })
    await expect(postStockCount(7)).rejects.toThrow(/僅「已核對」/)
    expect(supabase.__state.postCalls).toBe(0)
  })
})

// ─── 4. 過帳與冪等 ───────────────────────────────────────────────
describe('postStockCount — 已核對 → 已調帳（RPC）', () => {
  it('已核對 → 過帳成功，回傳盤盈虧金額與傳票（loss/gain 兩張）', async () => {
    supabase.__state.counts.set(3, { status: '已核對', result: null })
    const res = await postStockCount({ id: 3, status: '已核對' })
    expect(res.shortage_total).toBe(100)
    expect(res.overage_total).toBe(30)
    expect(res.variance_amount).toBe(-70)
    expect(res.vouchers.map(v => v.kind)).toEqual(['loss', 'gain'])
    expect(supabase.__state.postCalls).toBe(1)
  })

  it('重複過帳（已調帳）→ 回既有結果，不重複入帳（冪等）', async () => {
    supabase.__state.counts.set(3, { status: '已核對', result: null })
    const first = await postStockCount(3)
    const second = await postStockCount(3)
    expect(supabase.__state.postCalls).toBe(1)
    expect(second.already_posted).toBe(true)
    expect(second.vouchers).toEqual(first.vouchers)
  })
})
