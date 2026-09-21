import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock supabase（同鄰居測試模式：postingEngine.test.js）──────────
// rpc: 以 p_period 為冪等鍵的 in-memory secure_run_monthly_depreciation，
//      以 p_asset_id 為鍵的 secure_dispose_fixed_asset
vi.mock('../supabase.js', () => {
  const state = {
    runs: new Map(),      // period → run
    disposed: new Map(),  // asset_id → result
    rpcCalls: [],
    rpcMode: 'ok',        // 'ok' | 'error'
    reset() {
      this.runs.clear()
      this.disposed.clear()
      this.rpcCalls = []
      this.rpcMode = 'ok'
    },
  }

  const supabase = {
    __state: state,
    rpc: async (fn, args) => {
      state.rpcCalls.push({ fn, args })
      if (state.rpcMode === 'error') {
        return { data: null, error: { message: '無法識別租戶：請確認登入狀態' } }
      }

      if (fn === 'secure_run_monthly_depreciation') {
        const period = args.p_period
        if (state.runs.has(period)) {
          const run = state.runs.get(period)
          // 冪等命中：回傳既有 run，不新建
          return {
            data: {
              run, lines: run._lines, journal_entry_id: run.journal_entry_id,
              total_amount: run.total_amount, already_exists: true, skipped: false,
            },
            error: null,
          }
        }
        const run = {
          id: `run-${state.runs.size + 1}`,
          period,
          status: 'posted',
          total_amount: 1800,
          journal_entry_id: 42,
          _lines: [{ asset_id: 1, asset_name: '測試資產', amount: 1800 }],
        }
        state.runs.set(period, run)
        return {
          data: {
            run, lines: run._lines, journal_entry_id: 42,
            total_amount: 1800, already_exists: false, skipped: false,
          },
          error: null,
        }
      }

      if (fn === 'secure_dispose_fixed_asset') {
        if (state.disposed.has(args.p_asset_id)) {
          return { data: null, error: { message: '資產已非使用中，不可重複處分（已處分）' } }
        }
        const result = {
          asset: { id: args.p_asset_id, status: args.p_disposal_type === '出售' ? '已處分' : '已報廢' },
          gain_loss: 0,
          journal_entry_id: 43,
        }
        state.disposed.set(args.p_asset_id, result)
        return { data: result, error: null }
      }

      return { data: null, error: { message: `unknown rpc: ${fn}` } }
    },
  }

  return { supabase }
})

import { supabase } from '../supabase.js'
import {
  findUsefulLife,
  monthDiffFromAcquisition,
  computeMonthlyDepreciationForPeriod,
  previewMonthlyDepreciation,
  computeDisposal,
  runMonthlyDepreciation,
  disposeAsset,
} from '../accounting/fixedAssetOps.js'

// 標準測試資產：可折舊 108,000 / 60 個月 → 直線法每月 1,800
const BASE_ASSET = {
  id: 1,
  name: '商用咖啡機',
  asset_code: 'FA-000001',
  category: '機器設備',
  cost: 120000,
  salvage_value: 12000,
  useful_life: 5,
  method: 'straight_line',
  acquired_date: '2025-01-10',
  status: '使用中',
}

// 與 migration 20260705150000 種子同形的耐用年數表樣本
const LIFE_TABLE = [
  { id: 'ul-1', category: '房屋建築', item_name: '鋼筋（骨）混凝土建造', useful_life_years: 50, source_ref: '行政院固定資產耐用年數表' },
  { id: 'ul-2', category: '房屋建築', item_name: '加強磚造',           useful_life_years: 35, source_ref: '行政院固定資產耐用年數表' },
  { id: 'ul-3', category: '辦公設備', item_name: '事務機器（影印/傳真機）', useful_life_years: 5, source_ref: '行政院固定資產耐用年數表' },
  { id: 'ul-4', category: '機械設備', item_name: '冷凍冷藏設備',       useful_life_years: 8,  source_ref: '行政院固定資產耐用年數表' },
]

beforeEach(() => {
  supabase.__state.reset()
})

// ═════════════════════════════════════════════════════════════
//  FA-01：依耐用年數表帶入法定年限（資料形狀 + 查找）
// ═════════════════════════════════════════════════════════════

describe('FA-01: 耐用年數表自動帶入', () => {
  it('依類別 + 細目查得法定年限（鋼筋混凝土 50 年）', () => {
    const row = findUsefulLife(LIFE_TABLE, '房屋建築', '鋼筋（骨）混凝土建造')
    expect(row).not.toBeNull()
    expect(row.useful_life_years).toBe(50)
    expect(row.source_ref).toBe('行政院固定資產耐用年數表')
  })

  it('加強磚造 35 年、冷凍冷藏設備 8 年', () => {
    expect(findUsefulLife(LIFE_TABLE, '房屋建築', '加強磚造').useful_life_years).toBe(35)
    expect(findUsefulLife(LIFE_TABLE, '機械設備', '冷凍冷藏設備').useful_life_years).toBe(8)
  })

  it('每列具備 UI 帶入所需欄位（id/category/item_name/useful_life_years）', () => {
    for (const row of LIFE_TABLE) {
      expect(row).toHaveProperty('id')
      expect(row).toHaveProperty('category')
      expect(row).toHaveProperty('item_name')
      expect(typeof row.useful_life_years).toBe('number')
      expect(row.useful_life_years).toBeGreaterThan(0)
    }
  })

  it('查無對應細目 → null（UI 不帶入、不掛參考）', () => {
    expect(findUsefulLife(LIFE_TABLE, '房屋建築', '不存在的細目')).toBeNull()
    expect(findUsefulLife([], '房屋建築', '加強磚造')).toBeNull()
    expect(findUsefulLife(null, '房屋建築', '加強磚造')).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════
//  FA-02：月提列金額（平均法預設 + 稅法殘值式）
// ═════════════════════════════════════════════════════════════

describe('FA-02: 月提列金額計算', () => {
  it('直線法含殘值：(120000−12000)/60 = 每月 1800', () => {
    expect(computeMonthlyDepreciationForPeriod(BASE_ASSET, '2026-03')).toBe(1800)
  })

  it('未指定 method → 預設平均法（直線法），與明示 straight_line 相同', () => {
    const noMethod = { ...BASE_ASSET, method: undefined }
    expect(computeMonthlyDepreciationForPeriod(noMethod, '2026-03'))
      .toBe(computeMonthlyDepreciationForPeriod(BASE_ASSET, '2026-03'))
  })

  it('無殘值：120000/60 = 每月 2000（殘值降低每月折舊）', () => {
    const noSalvage = { ...BASE_ASSET, salvage_value: 0 }
    expect(computeMonthlyDepreciationForPeriod(noSalvage, '2026-03')).toBe(2000)
  })

  it('超過耐用年限 → 0（累計封頂於可折舊金額）', () => {
    const old = { ...BASE_ASSET, acquired_date: '2020-01-10' } // 5 年年限早已期滿
    expect(computeMonthlyDepreciationForPeriod(old, '2026-03')).toBe(0)
  })

  it('土地不折舊 → 0', () => {
    const land = { ...BASE_ASSET, category: '土地' }
    expect(computeMonthlyDepreciationForPeriod(land, '2026-03')).toBe(0)
  })

  it('整個年限提列合計 ≈ 可折舊金額（取得月按比例，尾期封頂）', () => {
    let sum = 0
    // 2025-01（取得當月，按比例）起連續掃 62 期
    for (let i = 0; i <= 61; i++) {
      const y = 2025 + Math.floor(i / 12)
      const m = (i % 12) + 1
      sum += computeMonthlyDepreciationForPeriod(BASE_ASSET, `${y}-${String(m).padStart(2, '0')}`)
    }
    expect(sum).toBeLessThanOrEqual(108000)
    expect(sum).toBeGreaterThan(106000)
  })

  it('previewMonthlyDepreciation 彙總：跳過土地與非使用中，合計正確', () => {
    const assets = [
      BASE_ASSET,
      { ...BASE_ASSET, id: 2, name: '土地一筆', category: '土地' },
      { ...BASE_ASSET, id: 3, name: '已報廢設備', status: '已報廢' },
      { ...BASE_ASSET, id: 4, name: '無殘值設備', salvage_value: 0 },
    ]
    const { lines, total } = previewMonthlyDepreciation(assets, '2026-03')
    expect(lines).toHaveLength(2)
    expect(lines.map(l => l.asset_id)).toEqual([1, 4])
    expect(total).toBe(1800 + 2000)
  })
})

// ═════════════════════════════════════════════════════════════
//  FA-03：同資產同期重跑冪等（mocked RPC 契約）
// ═════════════════════════════════════════════════════════════

describe('FA-03: 提列冪等契約', () => {
  it('同期重跑 → 回傳既有 run（already_exists=true），不重複建批次', async () => {
    const first = await runMonthlyDepreciation('2026-06')
    expect(first.already_exists).toBe(false)
    expect(first.run.id).toBe('run-1')
    expect(first.total_amount).toBe(1800)

    const second = await runMonthlyDepreciation('2026-06')
    expect(second.already_exists).toBe(true)
    expect(second.run.id).toBe('run-1')           // 同一批次
    expect(supabase.__state.runs.size).toBe(1)    // DB 只有一筆 run
    expect(supabase.__state.rpcCalls).toHaveLength(2)
  })

  it('不同期別各自建批次', async () => {
    await runMonthlyDepreciation('2026-06')
    const r7 = await runMonthlyDepreciation('2026-07')
    expect(r7.already_exists).toBe(false)
    expect(supabase.__state.runs.size).toBe(2)
  })

  it('RPC 錯誤 → 拋出（不吞錯），訊息含期別', async () => {
    supabase.__state.rpcMode = 'error'
    await expect(runMonthlyDepreciation('2026-06')).rejects.toThrow(/2026-06/)
  })
})

// ═════════════════════════════════════════════════════════════
//  FA-04：期中取得按月比例
// ═════════════════════════════════════════════════════════════

describe('FA-04: 期中取得比例提列', () => {
  const midMonthAsset = { ...BASE_ASSET, acquired_date: '2026-07-16' }

  it('取得當月按剩餘日數比例：7/16 取得 → 1800 × 16/31', () => {
    // 7 月 31 天，7/16（含）起 16 天
    expect(computeMonthlyDepreciationForPeriod(midMonthAsset, '2026-07'))
      .toBe(Math.round(1800 * 16 / 31 * 100) / 100) // 929.03
  })

  it('月初（1 日）取得 → 當月足額', () => {
    const firstDay = { ...BASE_ASSET, acquired_date: '2026-07-01' }
    expect(computeMonthlyDepreciationForPeriod(firstDay, '2026-07')).toBe(1800)
  })

  it('取得前的期別 → 0', () => {
    expect(monthDiffFromAcquisition('2026-06', '2026-07-16')).toBe(-1)
    expect(computeMonthlyDepreciationForPeriod(midMonthAsset, '2026-06')).toBe(0)
  })

  it('取得次月起恢復足額提列', () => {
    expect(computeMonthlyDepreciationForPeriod(midMonthAsset, '2026-08')).toBe(1800)
  })
})

// ═════════════════════════════════════════════════════════════
//  FA-05：處分損益（售價 vs 帳面價值，雙向）
// ═════════════════════════════════════════════════════════════

describe('FA-05: 處分損益計算', () => {
  // 取得 2024-01-10，處分 2026-07-15 → 月差 30 → 累計 1800×30 = 54000，帳面 66000
  const asset = { ...BASE_ASSET, acquired_date: '2024-01-10' }

  it('累計折舊提至處分月前一月底：帳面價值 = 66000', () => {
    const { accumulatedDepreciation, bookValue } = computeDisposal(asset, { proceeds: 0, disposalDate: '2026-07-15' })
    expect(accumulatedDepreciation).toBe(54000)
    expect(bookValue).toBe(66000)
  })

  it('出售價 > 帳面 → 處分利益（80000 − 66000 = +14000）', () => {
    const { gainLoss } = computeDisposal(asset, { proceeds: 80000, disposalDate: '2026-07-15' })
    expect(gainLoss).toBe(14000)
  })

  it('出售價 < 帳面 → 處分損失（50000 − 66000 = −16000）', () => {
    const { gainLoss } = computeDisposal(asset, { proceeds: 50000, disposalDate: '2026-07-15' })
    expect(gainLoss).toBe(-16000)
  })

  it('報廢（價款 0）→ 損失 = 全額帳面價值', () => {
    const { gainLoss, bookValue } = computeDisposal(asset, { proceeds: 0, disposalDate: '2026-07-15' })
    expect(gainLoss).toBe(-bookValue)
  })

  it('土地：不折舊，帳面 = 成本', () => {
    const land = { ...asset, category: '土地' }
    const { accumulatedDepreciation, bookValue } = computeDisposal(land, { proceeds: 0, disposalDate: '2026-07-15' })
    expect(accumulatedDepreciation).toBe(0)
    expect(bookValue).toBe(120000)
  })

  it('disposeAsset RPC 契約：成功回傳處分結果；重複處分被拒', async () => {
    const result = await disposeAsset(1, '出售', 80000, '2026-07-15')
    expect(result.asset.status).toBe('已處分')
    expect(result.journal_entry_id).toBe(43)

    await expect(disposeAsset(1, '出售', 80000, '2026-07-15'))
      .rejects.toThrow(/不可重複處分/)
  })
})
