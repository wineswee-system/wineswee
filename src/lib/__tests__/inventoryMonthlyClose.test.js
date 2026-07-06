import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock supabase（同鄰居測試模式）────────────────────────────
// rpc: in-memory secure_run_inventory_close 狀態機 —
//   draft 重算（計數 draftComputes）、confirm 拋傳票（計數 vouchersPosted）
//   + 寫快照（state.snapshots）、confirmed 期間一律回既有結果（鎖定/冪等）
vi.mock('../supabase.js', () => {
  const FIXTURE_LINES = [
    {
      id: 11, sku_id: 1, sku_code: 'SKU-001', sku_name: '品項A', warehouse_id: 1,
      opening_qty: 10, opening_value: 100,
      receipt_qty: 20, receipt_value: 300, // 20×12 + 60 landed cost（含分攤費用）
      monthly_avg_cost: 13.3333,
      issued_qty: 12, issued_value_recalc: 160, issued_value_original: 150,
      adjustment: 10,
    },
    {
      id: 12, sku_id: 2, sku_code: 'SKU-002', sku_name: '品項B', warehouse_id: 1,
      opening_qty: 5, opening_value: 250,
      receipt_qty: 0, receipt_value: 0,
      monthly_avg_cost: 50,
      issued_qty: 2, issued_value_recalc: 100, issued_value_original: 104,
      adjustment: -4,
    },
  ]

  const periodEnd = (period) => {
    const [y, m] = period.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    return `${period}-${String(last).padStart(2, '0')}`
  }

  const state = {
    runs: new Map(),        // period → run（含 lines）
    nextRunId: 1,
    draftComputes: 0,       // draft 重算次數（鎖定合約：confirmed 不得增加）
    vouchersPosted: 0,      // 傳票拋轉次數（冪等：同期只 1 次）
    snapshots: [],          // inventory_valuations 快照寫入
    rpcCalls: [],
    fixtureLines: FIXTURE_LINES,
    reset() {
      this.runs.clear()
      this.nextRunId = 1
      this.draftComputes = 0
      this.vouchersPosted = 0
      this.snapshots = []
      this.rpcCalls = []
    },
  }

  const supabase = {
    __state: state,
    rpc: async (fn, args) => {
      state.rpcCalls.push({ fn, args })
      if (fn !== 'secure_run_inventory_close') {
        return { data: null, error: { message: `unknown rpc: ${fn}` } }
      }
      const period = args.p_period
      let run = state.runs.get(period)

      // 已確認 → 鎖定：不重算不重拋，回既有結果
      if (run && run.status === 'confirmed') {
        return {
          data: {
            run, lines: run.lines,
            voucher_number: run.voucher_number, already_confirmed: true,
          },
          error: null,
        }
      }

      if (args.p_confirm) {
        if (!run) return { data: null, error: { message: `期間 ${period} 尚未試算，請先執行試算再確認月結` } }
        state.vouchersPosted += 1
        run.status = 'confirmed'
        run.voucher_number = `JE-TEST-${String(state.vouchersPosted).padStart(4, '0')}`
        const end = periodEnd(period)
        for (const l of run.lines) {
          state.snapshots.push({
            sku_id: l.sku_id,
            valuation_date: end,
            costing_method: 'monthly_weighted_average',
          })
        }
        return {
          data: {
            run, lines: run.lines, voucher_number: run.voucher_number,
            snapshot_count: run.lines.length, already_confirmed: false,
          },
          error: null,
        }
      }

      // draft：重算
      state.draftComputes += 1
      run = {
        id: run?.id ?? state.nextRunId++,
        period,
        status: 'draft',
        total_adjustment: state.fixtureLines.reduce((s, l) => s + l.adjustment, 0),
        lines: state.fixtureLines,
        voucher_number: null,
      }
      state.runs.set(period, run)
      return {
        data: { run, lines: run.lines, voucher_number: null, already_confirmed: false },
        error: null,
      }
    },
    from: (table) => ({
      select: () => ({
        order: () => Promise.resolve(
          table === 'inventory_close_runs'
            ? { data: [...state.runs.values()], error: null }
            : { data: [], error: null }
        ),
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  }

  return { supabase }
})

import { supabase } from '../supabase.js'
import {
  computeMonthlyAvg,
  recalcIssuedValue,
  deriveAdjustment,
  runInventoryClose,
  getCloseRuns,
} from '../inventoryMonthlyClose.js'

beforeEach(() => {
  supabase.__state.reset()
})

// ─── MC-01 月加權平均數學（receipt_value 含 landed cost）───────────
describe('MC-01 computeMonthlyAvg — 月加權單價（進貨值含 landed cost）', () => {
  it('（期初值＋進貨值含費用）÷（期初量＋進貨量）', () => {
    // 進貨 20 件 × $12 = $240，另 landed cost 分攤 $60 → receiptValue = 300
    const { avgCost, usedFallback } = computeMonthlyAvg({
      openingQty: 10, openingValue: 100,
      receiptQty: 20, receiptValue: 20 * 12 + 60,
    })
    expect(usedFallback).toBe(false)
    expect(avgCost).toBeCloseTo((100 + 300) / 30, 4) // 13.3333
  })

  it('landed cost 改變單價（不含費用時單價較低 — 佐證費用有算進去）', () => {
    const withLanded = computeMonthlyAvg({ openingQty: 0, openingValue: 0, receiptQty: 20, receiptValue: 300 })
    const withoutLanded = computeMonthlyAvg({ openingQty: 0, openingValue: 0, receiptQty: 20, receiptValue: 240 })
    expect(withLanded.avgCost).toBe(15)
    expect(withoutLanded.avgCost).toBe(12)
  })
})

// ─── MC-02 差額 = 重算 − 原值 ─────────────────────────────────────
describe('MC-02 deriveAdjustment — adjustment = issued_value_recalc − issued_value_original', () => {
  it('彙總逐 SKU 差額（正=補提成本、負=回沖）', () => {
    const { totalAdjustment, totalRecalc, totalOriginal } = deriveAdjustment([
      { issued_value_recalc: 160, issued_value_original: 150, adjustment: 10 },
      { issued_value_recalc: 100, issued_value_original: 104, adjustment: -4 },
    ])
    expect(totalRecalc).toBe(260)
    expect(totalOriginal).toBe(254)
    expect(totalAdjustment).toBe(6)
  })

  it('缺 adjustment 欄時以 recalc − original 推導', () => {
    const { totalAdjustment } = deriveAdjustment([
      { issued_value_recalc: 133.33, issued_value_original: 120 },
    ])
    expect(totalAdjustment).toBe(13.33)
  })

  it('recalcIssuedValue = 出庫量 × 月加權單價（四捨五入 2 位）', () => {
    expect(recalcIssuedValue({ issuedQty: 12, avgCost: 13.3333 })).toBe(160)
    expect(recalcIssuedValue({ issuedQty: 3, avgCost: 13.3333 })).toBe(40)
  })
})

// ─── MC-03 已確認期間鎖定合約 ─────────────────────────────────────
describe('MC-03 confirmed-period lock — 已確認期間不重算', () => {
  it('confirm 後再跑 draft → 回既有結果（already_confirmed），重算次數不增加', async () => {
    await runInventoryClose('2026-06')                        // draft（重算 1 次）
    await runInventoryClose('2026-06', { confirm: true })     // confirm
    expect(supabase.__state.draftComputes).toBe(1)

    const again = await runInventoryClose('2026-06')          // 鎖定後試算
    expect(again.already_confirmed).toBe(true)
    expect(again.run.status).toBe('confirmed')
    expect(supabase.__state.draftComputes).toBe(1)            // 沒有再重算
  })

  it('未試算就 confirm → 錯誤浮出（僅允許由 draft 確認）', async () => {
    await expect(runInventoryClose('2026-07', { confirm: true }))
      .rejects.toThrow(/尚未試算/)
  })
})

// ─── MC-04 冪等重跑 ──────────────────────────────────────────────
describe('MC-04 idempotent rerun — 重複 confirm 不重複入帳', () => {
  it('confirm 兩次 → 傳票只拋 1 次，回傳同一張傳票號', async () => {
    await runInventoryClose('2026-06')
    const first = await runInventoryClose('2026-06', { confirm: true })
    const second = await runInventoryClose('2026-06', { confirm: true })

    expect(supabase.__state.vouchersPosted).toBe(1)
    expect(second.already_confirmed).toBe(true)
    expect(second.voucher_number).toBe(first.voucher_number)
    expect(second.run.id).toBe(first.run.id)
  })
})

// ─── MC-05 期末快照寫入 ──────────────────────────────────────────
describe('MC-05 snapshot write — confirm 時寫 inventory_valuations 快照', () => {
  it('confirm → 逐 SKU 寫入 period end 快照（monthly_weighted_average）', async () => {
    await runInventoryClose('2026-06')
    const res = await runInventoryClose('2026-06', { confirm: true })

    expect(res.snapshot_count).toBe(2)
    expect(supabase.__state.snapshots).toHaveLength(2)
    for (const snap of supabase.__state.snapshots) {
      expect(snap.valuation_date).toBe('2026-06-30')
      expect(snap.costing_method).toBe('monthly_weighted_average')
    }

    // 冪等重跑不重寫快照
    await runInventoryClose('2026-06', { confirm: true })
    expect(supabase.__state.snapshots).toHaveLength(2)
  })
})

// ─── MC-06 零除守門 ──────────────────────────────────────────────
describe('MC-06 zero guards — 分母為 0 沿用最近成本', () => {
  it('期初量＋進貨量 = 0 → 沿用 lastCost（usedFallback）', () => {
    const { avgCost, usedFallback } = computeMonthlyAvg({
      openingQty: 0, openingValue: 0, receiptQty: 0, receiptValue: 0, lastCost: 7.5,
    })
    expect(usedFallback).toBe(true)
    expect(avgCost).toBe(7.5)
  })

  it('無 lastCost → 0（不產生 NaN/Infinity）', () => {
    const { avgCost } = computeMonthlyAvg({})
    expect(avgCost).toBe(0)
    expect(Number.isFinite(avgCost)).toBe(true)
  })

  it('負量守門：分母 ≤ 0 一律走 fallback', () => {
    const { usedFallback } = computeMonthlyAvg({ openingQty: -5, receiptQty: 3, lastCost: 2 })
    expect(usedFallback).toBe(true)
  })

  it('出庫量 0 → 重算成本 0、空明細差額 0', () => {
    expect(recalcIssuedValue({ issuedQty: 0, avgCost: 99 })).toBe(0)
    expect(deriveAdjustment([]).totalAdjustment).toBe(0)
    expect(deriveAdjustment(null).totalAdjustment).toBe(0)
  })
})

// ─── 補充：歷史查詢 ──────────────────────────────────────────────
describe('getCloseRuns — 月結歷史', () => {
  it('回傳 run 列表（含狀態）', async () => {
    await runInventoryClose('2026-06')
    const runs = await getCloseRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].period).toBe('2026-06')
    expect(runs[0].status).toBe('draft')
  })
})
