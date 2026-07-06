import { describe, it, expect } from 'vitest'
import {
  generateProfitLossByCostCenter,
  allocateCommonExpenses,
  COMMON_COLUMN,
} from '../accounting/costCenterReports.js'

// ─── Fixtures ────────────────────────────────────────────────
// 期間 2026-06；含一張草稿、一張期間外傳票
const entries = [
  { id: 1, entry_number: 'JE-001', entry_date: '2026-06-05', status: '已過帳' },
  { id: 2, entry_number: 'JE-002', entry_date: '2026-06-10', status: '已過帳' },
  { id: 3, entry_number: 'JE-003', entry_date: '2026-06-15', status: '草稿' },
  { id: 4, entry_number: 'JE-000', entry_date: '2026-05-01', status: '已過帳' }, // 期間外
]

const lines = [
  // CC-A：營收 10000、銷貨成本 4000、費用 1000
  { entry_id: 1, account_code: '4100', account_name: '營業收入', debit: 0, credit: 10000, cost_center: 'CC-A' },
  { entry_id: 1, account_code: '5100', account_name: '銷貨成本', debit: 4000, credit: 0, cost_center: 'CC-A' },
  { entry_id: 2, account_code: '6200', account_name: '租金費用', debit: 1000, credit: 0, cost_center: 'CC-A' },
  // CC-B：營收 5000、銷貨成本 2500
  { entry_id: 1, account_code: '4100', account_name: '營業收入', debit: 0, credit: 5000, cost_center: 'CC-B' },
  { entry_id: 2, account_code: '5100', account_name: '銷貨成本', debit: 2500, credit: 0, cost_center: 'CC-B' },
  // 未標記 → 共同：管理費用 3000
  { entry_id: 2, account_code: '6100', account_name: '管理費用', debit: 3000, credit: 0, cost_center: null },
  // 草稿（includeDraft 才計入）：CC-A 營收 999
  { entry_id: 3, account_code: '4100', account_name: '營業收入', debit: 0, credit: 999, cost_center: 'CC-A' },
  // 期間外（永不計入）
  { entry_id: 4, account_code: '4100', account_name: '營業收入', debit: 0, credit: 7777, cost_center: 'CC-A' },
]

const range = { from: '2026-06-01', to: '2026-06-30' }

// ═════════════════════════════════════════════════════════════
//  各中心欄位 + 共同欄 + 合計
// ═════════════════════════════════════════════════════════════

describe('generateProfitLossByCostCenter', () => {
  it('標記分錄依成本中心彙總；未標記歸「共同」；合計正確', () => {
    const r = generateProfitLossByCostCenter(entries, lines, range)

    expect(r.costCenters).toEqual(['CC-A', 'CC-B'])
    const ccA = r.columns.find(c => c.costCenter === 'CC-A')
    expect(ccA).toEqual({
      costCenter: 'CC-A', revenue: 10000, cogs: 4000, grossProfit: 6000,
      expenses: 1000, operatingIncome: 5000,
    })
    const ccB = r.columns.find(c => c.costCenter === 'CC-B')
    expect(ccB).toEqual({
      costCenter: 'CC-B', revenue: 5000, cogs: 2500, grossProfit: 2500,
      expenses: 0, operatingIncome: 2500,
    })

    // 未標記 → 共同欄
    expect(r.common.costCenter).toBe(COMMON_COLUMN)
    expect(r.common.expenses).toBe(3000)
    expect(r.common.revenue).toBe(0)

    // 合計 = 各中心 + 共同
    expect(r.total.revenue).toBe(15000)
    expect(r.total.cogs).toBe(6500)
    expect(r.total.grossProfit).toBe(8500)
    expect(r.total.expenses).toBe(4000)
    expect(r.total.operatingIncome).toBe(4500)

    // 期間外傳票（JE-000, 7777）不得混入
    expect(ccA.revenue).not.toBeGreaterThan(10000)
  })

  it('costCenters 篩選：只列指定中心欄，共同欄不受影響', () => {
    const r = generateProfitLossByCostCenter(entries, lines, { ...range, costCenters: ['CC-A'] })
    expect(r.costCenters).toEqual(['CC-A'])
    expect(r.columns).toHaveLength(1)
    expect(r.common.expenses).toBe(3000)
    // 合計只含入選中心 + 共同
    expect(r.total.revenue).toBe(10000)
  })

  it('includeDraft passthrough：true 時計入草稿、結果帶回旗標', () => {
    const off = generateProfitLossByCostCenter(entries, lines, range)
    const on = generateProfitLossByCostCenter(entries, lines, { ...range, includeDraft: true })

    expect(off.includeDraft).toBe(false)
    expect(on.includeDraft).toBe(true)

    const ccAOff = off.columns.find(c => c.costCenter === 'CC-A')
    const ccAOn = on.columns.find(c => c.costCenter === 'CC-A')
    expect(ccAOn.revenue).toBe(ccAOff.revenue + 999)
  })
})

// ═════════════════════════════════════════════════════════════
//  共同費用分攤
// ═════════════════════════════════════════════════════════════

describe('allocateCommonExpenses', () => {
  const base = generateProfitLossByCostCenter(entries, lines, range)

  it('按營收比分攤：比例正確、分攤後總額守恆', () => {
    const r = allocateCommonExpenses(base.columns, base.common, { method: 'revenue' })

    // CC-A 10000/15000 → 2000；CC-B 5000/15000 → 1000
    expect(r.allocations).toEqual([
      { costCenter: 'CC-A', base: 10000, ratio: 0.6667, allocated: 2000 },
      { costCenter: 'CC-B', base: 5000, ratio: 0.3333, allocated: 1000 },
    ])
    expect(r.totalAllocated).toBe(3000)
    expect(r.fallbackEqual).toBe(false)

    const ccA = r.columns.find(c => c.costCenter === 'CC-A')
    const ccB = r.columns.find(c => c.costCenter === 'CC-B')
    expect(ccA.expenses).toBe(3000)          // 1000 + 2000
    expect(ccA.operatingIncome).toBe(3000)   // 6000 - 3000
    expect(ccB.expenses).toBe(1000)
    expect(ccB.operatingIncome).toBe(1500)

    // 守恆：分攤後各中心費用合計 = 分攤前各中心費用 + 共同費用
    const totalExpAfter = r.columns.reduce((s, c) => s + c.expenses, 0) + r.common.expenses
    expect(totalExpAfter).toBe(4000)
    // 營業利益合計不變
    const totalOpAfter = r.columns.reduce((s, c) => s + c.operatingIncome, 0)
    expect(totalOpAfter).toBe(base.total.operatingIncome)
    expect(r.common.expenses).toBe(0)
    expect(r.common.allocatedOut).toBe(3000)
  })

  it('零營收防護：單一中心營收 0 → 分攤 0；全部為 0 → 退回平均分攤', () => {
    // 單一中心 0：CC-B 營收清 0
    const cols = base.columns.map(c => c.costCenter === 'CC-B' ? { ...c, revenue: 0 } : c)
    const r1 = allocateCommonExpenses(cols, base.common, { method: 'revenue' })
    expect(r1.allocations.find(a => a.costCenter === 'CC-B').allocated).toBe(0)
    expect(r1.allocations.find(a => a.costCenter === 'CC-A').allocated).toBe(3000)
    expect(r1.fallbackEqual).toBe(false)

    // 全部 0：不得 NaN/Infinity，退回平均分攤
    const zeroCols = base.columns.map(c => ({ ...c, revenue: 0 }))
    const r2 = allocateCommonExpenses(zeroCols, base.common, { method: 'revenue' })
    expect(r2.fallbackEqual).toBe(true)
    expect(r2.allocations.map(a => a.allocated)).toEqual([1500, 1500])
    for (const c of r2.columns) {
      expect(Number.isFinite(c.expenses)).toBe(true)
      expect(Number.isFinite(c.operatingIncome)).toBe(true)
    }
  })

  it('按人數比（自訂權數）分攤；權數和為 0 時退回平均', () => {
    const r = allocateCommonExpenses(base.columns, base.common, {
      method: 'headcount', weights: { 'CC-A': 2, 'CC-B': 3 },
    })
    expect(r.allocations.find(a => a.costCenter === 'CC-A').allocated).toBe(1200)
    expect(r.allocations.find(a => a.costCenter === 'CC-B').allocated).toBe(1800)

    const rZero = allocateCommonExpenses(base.columns, base.common, {
      method: 'headcount', weights: {},
    })
    expect(rZero.fallbackEqual).toBe(true)
    expect(rZero.allocations.map(a => a.allocated)).toEqual([1500, 1500])
  })

  it('共同費用為 0 或無中心欄：原樣返回、不產生分攤列', () => {
    const r = allocateCommonExpenses(base.columns, { ...base.common, expenses: 0 })
    expect(r.allocations).toEqual([])
    expect(r.columns).toEqual(base.columns)

    const r2 = allocateCommonExpenses([], base.common)
    expect(r2.allocations).toEqual([])
    expect(r2.totalAllocated).toBe(0)
  })
})
