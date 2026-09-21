import { describe, it, expect, vi } from 'vitest'
import {
  CHART_OF_ACCOUNTS,
  getAccountType,
  validateJournalEntry,
  postJournalEntry,
  generateTrialBalance,
  generateBalanceSheet,
  generateProfitLoss,
  calculateDepreciation,
} from '../accounting.js'

// ─── Helper: balanced journal lines ─────────────────────────
const balancedLines = [
  { account_code: '1100', account_name: '現金', debit: 10000, credit: 0 },
  { account_code: '4100', account_name: '營業收入', debit: 0, credit: 10000 },
]

const unbalancedLines = [
  { account_code: '1100', account_name: '現金', debit: 10000, credit: 0 },
  { account_code: '4100', account_name: '營業收入', debit: 0, credit: 5000 },
]

// ═════════════════════════════════════════════════════════════
//  CHART_OF_ACCOUNTS
// ═════════════════════════════════════════════════════════════

describe('CHART_OF_ACCOUNTS', () => {
  it('contains accounts with code, name, and type', () => {
    expect(CHART_OF_ACCOUNTS.length).toBeGreaterThan(10)
    for (const acct of CHART_OF_ACCOUNTS) {
      expect(acct).toHaveProperty('code')
      expect(acct).toHaveProperty('name')
      expect(acct).toHaveProperty('type')
      expect(acct.code).toMatch(/^\d{4}$/)
    }
  })
})

// ═════════════════════════════════════════════════════════════
//  getAccountType
// ═════════════════════════════════════════════════════════════

describe('getAccountType', () => {
  it('returns 資產 for code 1100', () => {
    expect(getAccountType('1100')).toBe('資產')
  })

  it('returns 負債 for code 2100', () => {
    expect(getAccountType('2100')).toBe('負債')
  })

  it('returns 權益 for code 3100', () => {
    expect(getAccountType('3100')).toBe('權益')
  })

  it('returns 收入 for code 4100', () => {
    expect(getAccountType('4100')).toBe('收入')
  })

  it('returns 營業費用 for code 6100', () => {
    expect(getAccountType('6100')).toBe('營業費用')
  })

  it('returns 未知 for invalid input', () => {
    expect(getAccountType('')).toBe('未知')
    expect(getAccountType(null)).toBe('未知')
    expect(getAccountType('9999')).toBe('未知')
  })
})

// ═════════════════════════════════════════════════════════════
//  validateJournalEntry
// ═════════════════════════════════════════════════════════════

describe('validateJournalEntry', () => {
  it('FIN-U01: balanced JE passes validation', () => {
    const result = validateJournalEntry(balancedLines)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.totalDebit).toBe(10000)
    expect(result.totalCredit).toBe(10000)
    expect(result.difference).toBe(0)
  })

  it('FIN-U02: unbalanced JE fails validation', () => {
    const result = validateJournalEntry(unbalancedLines)
    expect(result.valid).toBe(false)
    expect(result.difference).toBe(5000)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('FIN-U03: zero-amount lines rejected', () => {
    const zeroLines = [
      { account_code: '1100', account_name: '現金', debit: 0, credit: 0 },
      { account_code: '4100', account_name: '營業收入', debit: 0, credit: 0 },
    ]
    const result = validateJournalEntry(zeroLines)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('皆為零'))).toBe(true)
  })

  it('rejects empty array', () => {
    const result = validateJournalEntry([])
    expect(result.valid).toBe(false)
  })

  it('rejects single line', () => {
    const result = validateJournalEntry([
      { account_code: '1100', account_name: '現金', debit: 1000, credit: 0 },
    ])
    expect(result.valid).toBe(false)
  })

  it('rejects line with both debit and credit', () => {
    const result = validateJournalEntry([
      { account_code: '1100', account_name: '現金', debit: 1000, credit: 500 },
      { account_code: '4100', account_name: '營業收入', debit: 0, credit: 500 },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('同時有借方與貸方'))).toBe(true)
  })

  it('handles floating-point precision', () => {
    const lines = [
      { account_code: '1100', account_name: '現金', debit: 33.33, credit: 0 },
      { account_code: '1102', account_name: '銀行存款', debit: 33.33, credit: 0 },
      { account_code: '1130', account_name: '應收帳款', debit: 33.34, credit: 0 },
      { account_code: '4100', account_name: '營業收入', debit: 0, credit: 100 },
    ]
    const result = validateJournalEntry(lines)
    expect(result.valid).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════
//  postJournalEntry
// ═════════════════════════════════════════════════════════════

describe('postJournalEntry', () => {
  const createMockSupabase = (updateError = null, rpcError = null) => ({
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve({ error: updateError }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { balance: 0 }, error: rpcError }),
        }),
      }),
    }),
    rpc: () => Promise.resolve({ error: rpcError }),
  })

  it('FIN-U04: posts valid JE successfully', async () => {
    const supabase = createMockSupabase()
    const result = await postJournalEntry('entry-1', balancedLines, supabase)
    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('FIN-U05: rejects unbalanced JE before posting', async () => {
    const supabase = createMockSupabase()
    const result = await postJournalEntry('entry-1', unbalancedLines, supabase)
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('handles Supabase update error', async () => {
    const supabase = createMockSupabase({ message: 'DB error' })
    const result = await postJournalEntry('entry-1', balancedLines, supabase)
    expect(result.success).toBe(false)
    expect(result.errors.some(e => e.includes('更新傳票狀態失敗'))).toBe(true)
  })

  it('handles Supabase RPC error', async () => {
    const supabase = createMockSupabase(null, { message: 'RPC error' })
    const result = await postJournalEntry('entry-1', balancedLines, supabase)
    expect(result.success).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════
//  generateTrialBalance
// ═════════════════════════════════════════════════════════════

describe('generateTrialBalance', () => {
  const accounts = [
    { code: '1100', name: '現金', type: '資產' },
    { code: '4100', name: '營業收入', type: '收入' },
    { code: '6100', name: '薪資費用', type: '營業費用' },
  ]

  const journalLines = [
    // JE1: Cash 10000 Dr, Revenue 10000 Cr
    { account_code: '1100', debit: 10000, credit: 0 },
    { account_code: '4100', debit: 0, credit: 10000 },
    // JE2: Salary 3000 Dr, Cash 3000 Cr
    { account_code: '6100', debit: 3000, credit: 0 },
    { account_code: '1100', debit: 0, credit: 3000 },
  ]

  it('FIN-U06: trial balance debits = credits', () => {
    const tb = generateTrialBalance(accounts, journalLines)
    const totalDebit = tb.reduce((s, r) => s + r.debit_balance, 0)
    const totalCredit = tb.reduce((s, r) => s + r.credit_balance, 0)
    expect(totalDebit).toBe(totalCredit)
  })

  it('FIN-U07: excludes accounts with no transactions', () => {
    const extendedAccounts = [
      ...accounts,
      { code: '2100', name: '應付帳款', type: '負債' },
    ]
    const tb = generateTrialBalance(extendedAccounts, journalLines)
    expect(tb.find(r => r.account_code === '2100')).toBeUndefined()
  })

  it('calculates correct balances per account', () => {
    const tb = generateTrialBalance(accounts, journalLines)
    const cash = tb.find(r => r.account_code === '1100')
    expect(cash.debit_balance).toBe(7000) // 10000 - 3000
    const revenue = tb.find(r => r.account_code === '4100')
    expect(revenue.credit_balance).toBe(10000)
    const salary = tb.find(r => r.account_code === '6100')
    expect(salary.debit_balance).toBe(3000)
  })
})

// ═════════════════════════════════════════════════════════════
//  generateBalanceSheet
// ═════════════════════════════════════════════════════════════

describe('generateBalanceSheet', () => {
  it('FIN-U08: Assets = Liabilities + Equity', () => {
    const trialBalance = [
      { account_code: '1100', account_name: '現金', type: '資產', debit_balance: 50000, credit_balance: 0 },
      { account_code: '2100', account_name: '應付帳款', type: '負債', debit_balance: 0, credit_balance: 20000 },
      { account_code: '3100', account_name: '股本', type: '權益', debit_balance: 0, credit_balance: 30000 },
    ]
    const bs = generateBalanceSheet(trialBalance, '2026-03')
    expect(bs.totalAssets).toBe(50000)
    expect(bs.totalLiabilities).toBe(20000)
    expect(bs.totalEquity).toBe(30000)
    expect(bs.balanced).toBe(true)
    expect(bs.period).toBe('2026-03')
  })

  it('detects imbalance', () => {
    const trialBalance = [
      { account_code: '1100', account_name: '現金', type: '資產', debit_balance: 50000, credit_balance: 0 },
      { account_code: '2100', account_name: '應付帳款', type: '負債', debit_balance: 0, credit_balance: 10000 },
      { account_code: '3100', account_name: '股本', type: '權益', debit_balance: 0, credit_balance: 10000 },
    ]
    const bs = generateBalanceSheet(trialBalance, '2026-03')
    expect(bs.balanced).toBe(false)
  })

  it('excludes income/expense accounts', () => {
    const trialBalance = [
      { account_code: '1100', account_name: '現金', type: '資產', debit_balance: 10000, credit_balance: 0 },
      { account_code: '4100', account_name: '營業收入', type: '收入', debit_balance: 0, credit_balance: 10000 },
    ]
    const bs = generateBalanceSheet(trialBalance, '2026-03')
    expect(bs.totalAssets).toBe(10000)
    // Revenue not included in BS
    expect(bs.totalLiabilities).toBe(0)
    expect(bs.totalEquity).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
//  generateProfitLoss
// ═════════════════════════════════════════════════════════════

describe('generateProfitLoss', () => {
  it('FIN-U09: Revenue − Expenses = Net Income', () => {
    const trialBalance = [
      { account_code: '4100', account_name: '營業收入', type: '收入', debit_balance: 0, credit_balance: 100000 },
      { account_code: '5100', account_name: '銷貨成本', type: '銷貨成本', debit_balance: 40000, credit_balance: 0 },
      { account_code: '6100', account_name: '薪資費用', type: '營業費用', debit_balance: 20000, credit_balance: 0 },
      { account_code: '7100', account_name: '利息收入', type: '營業外收入/支出', debit_balance: 0, credit_balance: 5000 },
      { account_code: '7200', account_name: '利息支出', type: '營業外收入/支出', debit_balance: 3000, credit_balance: 0 },
    ]
    const pl = generateProfitLoss(trialBalance, '2026-03')

    expect(pl.grossProfit).toBe(60000)         // 100000 - 40000
    expect(pl.operatingIncome).toBe(40000)     // 60000 - 20000
    expect(pl.netIncome).toBe(42000)           // 40000 + 5000 - 3000
    expect(pl.period).toBe('2026-03')
    expect(pl.revenue).toHaveLength(1)
    expect(pl.costOfGoodsSold).toHaveLength(1)
    expect(pl.operatingExpenses).toHaveLength(1)
    expect(pl.otherIncome).toHaveLength(1)
    expect(pl.otherExpenses).toHaveLength(1)
  })

  it('handles zero revenue', () => {
    const pl = generateProfitLoss([], '2026-03')
    expect(pl.netIncome).toBe(0)
    expect(pl.grossProfit).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateDepreciation
// ═════════════════════════════════════════════════════════════

describe('calculateDepreciation', () => {
  it('FIN-U12: straight-line depreciation', () => {
    const result = calculateDepreciation({
      cost: 100000,
      salvage_value: 10000,
      useful_life_years: 5,
      method: 'straight_line',
      acquired_date: '2025-01-01',
      current_date: '2026-01-01',
    })
    // Depreciable = 90000, monthly = 90000/60 = 1500
    expect(result.monthly_depreciation).toBe(1500)
    // After 12 months: 1500 * 12 = 18000
    expect(result.accumulated_depreciation).toBe(18000)
    expect(result.book_value).toBe(82000) // 100000 - 18000
  })

  it('FIN-U13: partial year (pro-rata)', () => {
    const result = calculateDepreciation({
      cost: 100000,
      salvage_value: 10000,
      useful_life_years: 5,
      method: 'straight_line',
      acquired_date: '2025-07-01',
      current_date: '2026-01-01',
    })
    // 6 months elapsed: 1500 * 6 = 9000
    expect(result.accumulated_depreciation).toBe(9000)
    expect(result.book_value).toBe(91000)
  })

  it('caps depreciation at depreciable amount', () => {
    const result = calculateDepreciation({
      cost: 100000,
      salvage_value: 10000,
      useful_life_years: 5,
      method: 'straight_line',
      acquired_date: '2015-01-01',
      current_date: '2026-01-01',
    })
    // After 11 years, should be capped at 90000
    expect(result.accumulated_depreciation).toBe(90000)
    expect(result.book_value).toBe(10000) // = salvage value
  })

  it('throws for unsupported method', () => {
    expect(() => calculateDepreciation({
      cost: 100000,
      salvage_value: 10000,
      useful_life_years: 5,
      method: 'invalid_method',
      acquired_date: '2025-01-01',
      current_date: '2026-01-01',
    })).toThrow('不支援的折舊方法')
  })

  it('declining balance method works', () => {
    const result = calculateDepreciation({
      cost: 100000,
      salvage_value: 10000,
      useful_life_years: 5,
      method: 'declining_balance',
      acquired_date: '2025-01-01',
      current_date: '2026-01-01',
    })
    expect(result.accumulated_depreciation).toBeGreaterThan(0)
    expect(result.book_value).toBeLessThan(100000)
    expect(result.book_value).toBeGreaterThanOrEqual(10000)
  })

  it('sum of years method works', () => {
    const result = calculateDepreciation({
      cost: 100000,
      salvage_value: 10000,
      useful_life_years: 5,
      method: 'sum_of_years',
      acquired_date: '2025-01-01',
      current_date: '2026-01-01',
    })
    expect(result.accumulated_depreciation).toBeGreaterThan(0)
    expect(result.book_value).toBeLessThan(100000)
  })
})
