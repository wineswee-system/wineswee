import { describe, it, expect } from 'vitest'
import {
  filterPostableEntries,
  generateJournalBook,
  generateGeneralLedger,
  generateCostOfGoodsSold,
  generateProfitLoss,
} from '../accounting.js'

// ─── Fixtures ────────────────────────────────────────────────
// 兩個月、跨日、含一張草稿傳票；entry_date 為 YYYY-MM-DD
const entries = [
  { id: 1, entry_number: 'JE-2026-002', entry_date: '2026-05-10', description: '銷貨', status: '已過帳' },
  { id: 2, entry_number: 'JE-2026-001', entry_date: '2026-05-10', description: '進貨', status: '已過帳' },
  { id: 3, entry_number: 'JE-2026-003', entry_date: '2026-05-20', description: '付租金', status: '已過帳' },
  { id: 4, entry_number: 'JE-2026-004', entry_date: '2026-06-05', description: '銷貨2', status: '已過帳' },
  { id: 5, entry_number: 'JE-2026-005', entry_date: '2026-06-15', description: '草稿銷貨', status: '草稿' },
  { id: 6, entry_number: 'JE-2026-000', entry_date: '2026-04-30', description: '期初前現金銷貨', status: '已過帳' },
]

const lines = [
  // JE-2026-002 (5/10)：借 現金 10000 / 貸 營業收入 10000
  { id: 11, entry_id: 1, account_code: '1100', account_name: '現金', debit: 10000, credit: 0, cost_center: 'CC-A' },
  { id: 12, entry_id: 1, account_code: '4100', account_name: '營業收入', debit: 0, credit: 10000, cost_center: 'CC-A' },
  // JE-2026-001 (5/10)：借 存貨 4000 / 貸 現金 4000
  { id: 13, entry_id: 2, account_code: '1150', account_name: '存貨', debit: 4000, credit: 0, cost_center: 'CC-B' },
  { id: 14, entry_id: 2, account_code: '1100', account_name: '現金', debit: 0, credit: 4000, cost_center: 'CC-B' },
  // JE-2026-003 (5/20)：借 租金費用 2000 / 貸 現金 2000
  { id: 15, entry_id: 3, account_code: '6200', account_name: '租金費用', debit: 2000, credit: 0, cost_center: 'CC-A' },
  { id: 16, entry_id: 3, account_code: '1100', account_name: '現金', debit: 0, credit: 2000, cost_center: 'CC-A' },
  // JE-2026-004 (6/5)：借 現金 5000 / 貸 營業收入 5000
  { id: 17, entry_id: 4, account_code: '1100', account_name: '現金', debit: 5000, credit: 0, cost_center: null },
  { id: 18, entry_id: 4, account_code: '4100', account_name: '營業收入', debit: 0, credit: 5000, cost_center: null },
  // JE-2026-005 (6/15 草稿)：借 現金 3000 / 貸 營業收入 3000
  { id: 19, entry_id: 5, account_code: '1100', account_name: '現金', debit: 3000, credit: 0, cost_center: null },
  { id: 20, entry_id: 5, account_code: '4100', account_name: '營業收入', debit: 0, credit: 3000, cost_center: null },
  // JE-2026-000 (4/30 期初前)：借 現金 1000 / 貸 營業收入 1000
  { id: 21, entry_id: 6, account_code: '1100', account_name: '現金', debit: 1000, credit: 0, cost_center: null },
  { id: 22, entry_id: 6, account_code: '4100', account_name: '營業收入', debit: 0, credit: 1000, cost_center: null },
]

// ═════════════════════════════════════════════════════════════
//  RPT-01 日記帳：分錄排序與日/月合計
// ═════════════════════════════════════════════════════════════

describe('generateJournalBook', () => {
  it('RPT-01: 依 entry_date + entry_number 排序，日合計/月合計/總計正確且平衡', () => {
    const book = generateJournalBook(entries, lines, { from: '2026-05-01', to: '2026-06-30' })

    // 排序：5/10 兩張中 JE-2026-001 應在 JE-2026-002 前（同日依傳票編號）
    expect(book.days.map(d => d.date)).toEqual(['2026-05-10', '2026-05-20', '2026-06-05'])
    const day510 = book.days[0]
    expect(day510.entries.map(e => e.entry_number)).toEqual(['JE-2026-001', 'JE-2026-002'])

    // 日合計：5/10 = 4000 + 10000 = 14000（借貸各）
    expect(day510.subtotalDebit).toBe(14000)
    expect(day510.subtotalCredit).toBe(14000)

    // 月合計：5月 = 16000，6月 = 5000（草稿不計）
    expect(book.months).toEqual([
      { month: '2026-05', totalDebit: 16000, totalCredit: 16000 },
      { month: '2026-06', totalDebit: 5000, totalCredit: 5000 },
    ])

    // 總計與平衡斷言
    expect(book.totalDebit).toBe(21000)
    expect(book.totalCredit).toBe(21000)
    expect(book.balanced).toBe(true)
    expect(book.entryCount).toBe(4)

    // 期初前（4/30）與草稿（6/15）不入帳
    const allNumbers = book.days.flatMap(d => d.entries.map(e => e.entry_number))
    expect(allNumbers).not.toContain('JE-2026-000')
    expect(allNumbers).not.toContain('JE-2026-005')
  })
})

// ═════════════════════════════════════════════════════════════
//  RPT-02 總分類帳：期初 + Σ逐筆 = 期末（連續性）
// ═════════════════════════════════════════════════════════════

describe('generateGeneralLedger', () => {
  it('RPT-02: 期初餘額 + 逐筆增減 = 期末餘額（含 from 之前分錄推算期初）', () => {
    const gl = generateGeneralLedger(entries, lines, { from: '2026-05-01', to: '2026-06-30' })
    const cash = gl.accounts.find(a => a.account_code === '1100')

    // 期初 = 4/30 的借 1000（資產借餘為正）
    expect(cash.openingBalance).toBe(1000)
    expect(cash.normal_side).toBe('debit')

    // 逐筆餘額連續性：每筆 balance = 前筆 balance ± 本筆
    let running = cash.openingBalance
    for (const p of cash.postings) {
      running = Math.round((running + p.debit - p.credit) * 100) / 100
      expect(p.balance).toBe(running)
    }
    // 期末 = 期初 + Σ(借-貸) = 1000 + (10000-4000-2000+5000) = 10000
    expect(cash.closingBalance).toBe(10000)
    expect(cash.closingBalance).toBe(
      Math.round((cash.openingBalance + cash.totalDebit - cash.totalCredit) * 100) / 100
    )

    // 貸餘科目（收入）：期初 1000、期末 1000 + 10000 + 5000 = 16000
    const revenue = gl.accounts.find(a => a.account_code === '4100')
    expect(revenue.normal_side).toBe('credit')
    expect(revenue.openingBalance).toBe(1000)
    expect(revenue.closingBalance).toBe(16000)
  })

  it('RPT-02b: 外部提供 openingBalances 時優先採用', () => {
    const gl = generateGeneralLedger(entries, lines, {
      accountCodes: ['1100'],
      from: '2026-05-01',
      to: '2026-06-30',
      openingBalances: { 1100: 500 },
    })
    const cash = gl.accounts[0]
    expect(cash.openingBalance).toBe(500)
    expect(cash.closingBalance).toBe(500 + 10000 - 4000 - 2000 + 5000)
  })

  it('RPT-03: 明細帳 cost_center 過濾 — 僅計入該成本中心分錄', () => {
    const gl = generateGeneralLedger(entries, lines, {
      accountCodes: ['1100'],
      from: '2026-05-01',
      to: '2026-06-30',
      costCenter: 'CC-A',
    })
    const cash = gl.accounts[0]
    // CC-A 的現金分錄：5/10 借 10000、5/20 貸 2000；期初前無 CC-A → 期初 0
    expect(cash.openingBalance).toBe(0)
    expect(cash.postings).toHaveLength(2)
    expect(cash.postings.every(p => p.cost_center === 'CC-A')).toBe(true)
    expect(cash.totalDebit).toBe(10000)
    expect(cash.totalCredit).toBe(2000)
    expect(cash.closingBalance).toBe(8000)
  })
})

// ═════════════════════════════════════════════════════════════
//  RPT-04 營業成本表：期初 + 進貨 − 退出折讓 − 期末 = 銷貨成本
// ═════════════════════════════════════════════════════════════

describe('generateCostOfGoodsSold', () => {
  it('RPT-04: COGS 公式與快照輸入一致', () => {
    // 模擬 inventory_valuations 月結快照：期初 = 上月末 total_value 合計、期末 = 本月末
    const openingSnapshot = [
      { sku_id: 1, valuation_date: '2026-05-31', total_value: 6000 },
      { sku_id: 2, valuation_date: '2026-05-31', total_value: 4000 },
    ]
    const closingSnapshot = [
      { sku_id: 1, valuation_date: '2026-06-30', total_value: 5000 },
      { sku_id: 2, valuation_date: '2026-06-30', total_value: 3000 },
    ]
    const openingInventory = openingSnapshot.reduce((s, r) => s + r.total_value, 0) // 10000
    const closingInventory = closingSnapshot.reduce((s, r) => s + r.total_value, 0) // 8000

    const stmt = generateCostOfGoodsSold({
      openingInventory,
      purchases: 50000,
      purchaseReturnsAllowances: 2000,
      closingInventory,
      period: '2026-06',
    })

    expect(stmt.netPurchases).toBe(48000)          // 50000 - 2000
    expect(stmt.goodsAvailable).toBe(58000)        // 10000 + 48000
    expect(stmt.costOfGoodsSold).toBe(50000)       // 58000 - 8000
    expect(stmt.period).toBe('2026-06')

    // 報表列與計算值一致
    const rowOf = (label) => stmt.rows.find(r => r.label === label)
    expect(rowOf('期初存貨').amount).toBe(10000)
    expect(rowOf('本期進貨').amount).toBe(50000)
    expect(rowOf('減：進貨退出及折讓').amount).toBe(-2000)
    expect(rowOf('進貨淨額').amount).toBe(48000)
    expect(rowOf('可供銷售商品成本').amount).toBe(58000)
    expect(rowOf('減：期末存貨').amount).toBe(-8000)
    expect(rowOf('銷貨成本').amount).toBe(50000)
  })
})

// ═════════════════════════════════════════════════════════════
//  RPT-05 includeDraft：含/不含草稿差異
// ═════════════════════════════════════════════════════════════

describe('includeDraft（免過帳即時報表）', () => {
  it('RPT-05: filterPostableEntries 預設僅已過帳，includeDraft 加計草稿', () => {
    expect(filterPostableEntries(entries)).toHaveLength(5)
    expect(filterPostableEntries(entries, { includeDraft: true })).toHaveLength(6)
  })

  it('RPT-05b: 日記帳/總分類帳含草稿與不含草稿的金額差 = 草稿傳票金額', () => {
    const opts = { from: '2026-06-01', to: '2026-06-30' }
    const withoutDraft = generateJournalBook(entries, lines, opts)
    const withDraft = generateJournalBook(entries, lines, { ...opts, includeDraft: true })
    expect(withoutDraft.totalDebit).toBe(5000)
    expect(withDraft.totalDebit).toBe(8000) // + 草稿 3000
    expect(withDraft.entryCount - withoutDraft.entryCount).toBe(1)
    expect(withDraft.includeDraft).toBe(true)

    const glWithout = generateGeneralLedger(entries, lines, { ...opts, accountCodes: ['1100'] })
    const glWith = generateGeneralLedger(entries, lines, { ...opts, accountCodes: ['1100'], includeDraft: true })
    expect(glWith.accounts[0].closingBalance - glWithout.accounts[0].closingBalance).toBe(3000)
  })
})

// ═════════════════════════════════════════════════════════════
//  RPT-06 綜合損益表：銷貨退回及折讓為收入減項
// ═════════════════════════════════════════════════════════════

describe('generateProfitLoss（綜合損益表擴充）', () => {
  it('RPT-06: 銷貨退回及折讓列收入減項；otherComprehensiveIncome 預設 0', () => {
    const trialBalance = [
      { account_code: '4100', account_name: '營業收入', type: '收入', debit_balance: 0, credit_balance: 100000 },
      { account_code: '4200', account_name: '銷貨退回', type: '收入', debit_balance: 5000, credit_balance: 0 },
      { account_code: '5100', account_name: '銷貨成本', type: '銷貨成本', debit_balance: 40000, credit_balance: 0 },
    ]
    const pl = generateProfitLoss(trialBalance, '2026-06')

    // 收入減項揭露
    expect(pl.grossRevenue).toBe(100000)
    expect(pl.salesReturnsAndAllowances).toBe(5000)
    expect(pl.netRevenue).toBe(95000)

    // 毛利以淨額計：95000 - 40000
    expect(pl.grossProfit).toBe(55000)

    // 其他綜合損益段（SME 預設 0）；綜合損益 = 本期淨利
    expect(pl.totalOtherComprehensiveIncome).toBe(0)
    expect(pl.otherComprehensiveIncome).toEqual([])
    expect(pl.comprehensiveIncome).toBe(pl.netIncome)

    // 既有欄位行為不變（additive）：revenue 段仍含兩列，退回為負值
    expect(pl.revenue).toHaveLength(2)
    const contra = pl.revenue.find(r => r.item === '銷貨退回')
    expect(contra.amount).toBe(-5000)
  })
})
