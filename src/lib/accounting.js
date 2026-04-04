/**
 * 會計引擎 — 台灣中小企業 ERP 專用
 * 提供：分錄驗證、過帳、試算表、資產負債表、損益表、折舊計算
 * 科目代碼遵循台灣商業會計法標準
 */

import { supabase } from './supabase'

// ─── 台灣標準會計科目表 ───────────────────────────────────────

/** @type {Array<{code: string, name: string, type: string}>} */
export const CHART_OF_ACCOUNTS = [
  // 1xxx 資產
  { code: '1100', name: '現金',       type: '資產' },
  { code: '1102', name: '銀行存款',   type: '資產' },
  { code: '1130', name: '應收帳款',   type: '資產' },
  { code: '1141', name: '應收票據',   type: '資產' },
  { code: '1150', name: '存貨',       type: '資產' },
  { code: '1600', name: '固定資產',   type: '資產' },
  { code: '1610', name: '累計折舊',   type: '資產' },

  // 2xxx 負債
  { code: '2100', name: '應付帳款',   type: '負債' },
  { code: '2110', name: '應付票據',   type: '負債' },
  { code: '2200', name: '短期借款',   type: '負債' },
  { code: '2300', name: '長期借款',   type: '負債' },

  // 3xxx 權益
  { code: '3100', name: '股本',       type: '權益' },
  { code: '3200', name: '資本公積',   type: '權益' },
  { code: '3300', name: '保留盈餘',   type: '權益' },

  // 4xxx 收入
  { code: '4100', name: '營業收入',   type: '收入' },
  { code: '4200', name: '銷貨退回',   type: '收入' },

  // 5xxx 銷貨成本
  { code: '5100', name: '銷貨成本',   type: '銷貨成本' },

  // 6xxx 營業費用
  { code: '6100', name: '薪資費用',   type: '營業費用' },
  { code: '6200', name: '租金費用',   type: '營業費用' },
  { code: '6300', name: '折舊費用',   type: '營業費用' },
  { code: '6400', name: '水電費',     type: '營業費用' },
  { code: '6500', name: '保險費',     type: '營業費用' },
  { code: '6600', name: '交際費',     type: '營業費用' },
  { code: '6700', name: '文具用品',   type: '營業費用' },

  // 7xxx 營業外收入/支出
  { code: '7100', name: '利息收入',   type: '營業外收入/支出' },
  { code: '7200', name: '利息支出',   type: '營業外收入/支出' },
  { code: '7300', name: '匯兌損益',   type: '營業外收入/支出' },
]

// ─── 科目代碼 → 類型映射 ─────────────────────────────────────

/**
 * 依科目代碼取得科目類型
 * @param {string} code — 四碼科目代碼
 * @returns {string} 科目類型（資產/負債/權益/收入/銷貨成本/營業費用/營業外收入/支出）
 */
export function getAccountType(code) {
  if (!code || typeof code !== 'string') return '未知'
  const prefix = code.charAt(0)
  switch (prefix) {
    case '1': return '資產'
    case '2': return '負債'
    case '3': return '權益'
    case '4': return '收入'
    case '5': return '銷貨成本'
    case '6': return '營業費用'
    case '7': return '營業外收入/支出'
    default:  return '未知'
  }
}

// ─── 分錄驗證 ─────────────────────────────────────────────────

/**
 * 驗證傳票分錄是否借貸平衡
 * @param {Array<{account_code: string, account_name: string, debit: number, credit: number}>} lines — 分錄明細
 * @returns {{valid: boolean, totalDebit: number, totalCredit: number, difference: number, errors: string[]}}
 */
export function validateJournalEntry(lines) {
  const errors = []

  if (!Array.isArray(lines) || lines.length === 0) {
    errors.push('分錄明細不可為空')
    return { valid: false, totalDebit: 0, totalCredit: 0, difference: 0, errors }
  }

  if (lines.length < 2) {
    errors.push('分錄至少需要兩筆明細（一借一貸）')
  }

  let totalDebit = 0
  let totalCredit = 0

  lines.forEach((line, i) => {
    const idx = i + 1

    if (!line.account_code) {
      errors.push(`第 ${idx} 筆缺少科目代碼`)
    }

    if (!line.account_name) {
      errors.push(`第 ${idx} 筆缺少科目名稱`)
    }

    const debit = Number(line.debit) || 0
    const credit = Number(line.credit) || 0

    if (debit < 0) errors.push(`第 ${idx} 筆借方金額不可為負數`)
    if (credit < 0) errors.push(`第 ${idx} 筆貸方金額不可為負數`)

    if (debit === 0 && credit === 0) {
      errors.push(`第 ${idx} 筆借方與貸方皆為零`)
    }

    if (debit > 0 && credit > 0) {
      errors.push(`第 ${idx} 筆不可同時有借方與貸方金額`)
    }

    totalDebit += debit
    totalCredit += credit
  })

  // 使用 toFixed 避免浮點數精度問題
  totalDebit = Math.round(totalDebit * 100) / 100
  totalCredit = Math.round(totalCredit * 100) / 100
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100

  if (difference !== 0) {
    errors.push(`借貸不平衡：借方合計 ${totalDebit}，貸方合計 ${totalCredit}，差額 ${difference}`)
  }

  return {
    valid: errors.length === 0,
    totalDebit,
    totalCredit,
    difference,
    errors,
  }
}

// ─── 過帳 ─────────────────────────────────────────────────────

/**
 * 將草稿傳票過帳：驗證 → 更新狀態 → 更新科目餘額
 * @param {string} entryId — 傳票 ID
 * @param {Array<{account_code: string, account_name: string, debit: number, credit: number}>} lines — 分錄明細
 * @param {object} supabase — Supabase client instance
 * @returns {Promise<{success: boolean, errors: string[]}>}
 */
export async function postJournalEntry(entryId, lines, supabase) {
  const errors = []

  // 1. 驗證借貸平衡
  const validation = validateJournalEntry(lines)
  if (!validation.valid) {
    return { success: false, errors: validation.errors }
  }

  try {
    // 2. 更新傳票狀態為「已過帳」
    const { error: statusError } = await supabase
      .from('journal_entries')
      .update({ status: '已過帳', posted_at: new Date().toISOString() })
      .eq('id', entryId)

    if (statusError) {
      errors.push(`更新傳票狀態失敗：${statusError.message}`)
      return { success: false, errors }
    }

    // 3. 逐筆更新科目餘額
    for (const line of lines) {
      const debit = Number(line.debit) || 0
      const credit = Number(line.credit) || 0
      const type = getAccountType(line.account_code)

      // 資產、費用類科目：借增貸減；負債、權益、收入類科目：貸增借減
      let balanceChange = 0
      if (['資產', '營業費用', '銷貨成本'].includes(type)) {
        balanceChange = debit - credit
      } else {
        balanceChange = credit - debit
      }

      const { error: balanceError } = await supabase.rpc('update_account_balance', {
        p_account_code: line.account_code,
        p_amount: balanceChange,
      })

      if (balanceError) {
        errors.push(`更新科目 ${line.account_code} ${line.account_name} 餘額失敗：${balanceError.message}`)
      }
    }

    if (errors.length > 0) {
      return { success: false, errors }
    }

    return { success: true, errors: [] }
  } catch (err) {
    errors.push(`過帳時發生例外：${err.message}`)
    return { success: false, errors }
  }
}

// ─── 試算表 ───────────────────────────────────────────────────

/**
 * 產生試算表（Trial Balance）
 * @param {Array<{code: string, name: string, type: string}>} accounts — 科目清單
 * @param {Array<{account_code: string, debit: number, credit: number}>} journalLines — 所有已過帳分錄明細
 * @returns {Array<{account_code: string, account_name: string, type: string, debit_balance: number, credit_balance: number}>}
 */
export function generateTrialBalance(accounts, journalLines) {
  // 彙總每個科目的借貸合計
  const balanceMap = {}

  for (const line of journalLines) {
    const code = line.account_code
    if (!balanceMap[code]) {
      balanceMap[code] = { totalDebit: 0, totalCredit: 0 }
    }
    balanceMap[code].totalDebit += Number(line.debit) || 0
    balanceMap[code].totalCredit += Number(line.credit) || 0
  }

  const result = []

  for (const acct of accounts) {
    const bal = balanceMap[acct.code]
    if (!bal) continue // 無交易的科目不列入

    const type = acct.type || getAccountType(acct.code)
    const netDebit = Math.round(bal.totalDebit * 100) / 100
    const netCredit = Math.round(bal.totalCredit * 100) / 100

    // 資產/費用/成本類：餘額在借方；負債/權益/收入類：餘額在貸方
    let debit_balance = 0
    let credit_balance = 0

    if (['資產', '營業費用', '銷貨成本'].includes(type)) {
      const net = netDebit - netCredit
      if (net >= 0) {
        debit_balance = Math.round(net * 100) / 100
      } else {
        credit_balance = Math.round(Math.abs(net) * 100) / 100
      }
    } else {
      const net = netCredit - netDebit
      if (net >= 0) {
        credit_balance = Math.round(net * 100) / 100
      } else {
        debit_balance = Math.round(Math.abs(net) * 100) / 100
      }
    }

    result.push({
      account_code: acct.code,
      account_name: acct.name,
      type,
      debit_balance,
      credit_balance,
    })
  }

  // 依科目代碼排序
  result.sort((a, b) => a.account_code.localeCompare(b.account_code))

  return result
}

// ─── 資產負債表 ───────────────────────────────────────────────

/**
 * 從試算表產生資產負債表
 * @param {Array<{account_code: string, account_name: string, type: string, debit_balance: number, credit_balance: number}>} trialBalance
 * @param {string} period — 報表期間，例如 '2026-03'
 * @returns {{assets: Array, liabilities: Array, equity: Array, totalAssets: number, totalLiabilities: number, totalEquity: number, balanced: boolean, period: string}}
 */
export function generateBalanceSheet(trialBalance, period) {
  const assetItems = []
  const liabilityItems = []
  const equityItems = []

  for (const row of trialBalance) {
    const balance = row.debit_balance - row.credit_balance
    const entry = { account_code: row.account_code, account_name: row.account_name, amount: 0 }

    if (row.type === '資產') {
      // 資產正常餘額在借方
      entry.amount = Math.round((row.debit_balance - row.credit_balance) * 100) / 100
      assetItems.push(entry)
    } else if (row.type === '負債') {
      entry.amount = Math.round((row.credit_balance - row.debit_balance) * 100) / 100
      liabilityItems.push(entry)
    } else if (row.type === '權益') {
      entry.amount = Math.round((row.credit_balance - row.debit_balance) * 100) / 100
      equityItems.push(entry)
    }
    // 收入/費用/成本類不列入資產負債表（屬損益表）
  }

  // 分類彙總
  const categorize = (items, categories) => {
    const result = []
    for (const cat of categories) {
      const matched = items.filter(it => it.account_code.startsWith(cat.prefix))
      if (matched.length > 0) {
        const subtotal = Math.round(matched.reduce((s, it) => s + it.amount, 0) * 100) / 100
        result.push({
          category: cat.label,
          items: matched,
          subtotal,
        })
      }
    }
    return result
  }

  const assets = categorize(assetItems, [
    { prefix: '11', label: '流動資產' },
    { prefix: '12', label: '基金及投資' },
    { prefix: '13', label: '固定資產' },
    { prefix: '14', label: '無形資產' },
    { prefix: '15', label: '其他資產' },
    { prefix: '16', label: '固定資產' },
  ])

  const liabilities = categorize(liabilityItems, [
    { prefix: '21', label: '流動負債' },
    { prefix: '22', label: '短期借款' },
    { prefix: '23', label: '長期負債' },
    { prefix: '24', label: '其他負債' },
  ])

  const equity = categorize(equityItems, [
    { prefix: '31', label: '股本' },
    { prefix: '32', label: '資本公積' },
    { prefix: '33', label: '保留盈餘' },
    { prefix: '34', label: '其他權益' },
  ])

  const totalAssets = Math.round(assetItems.reduce((s, it) => s + it.amount, 0) * 100) / 100
  const totalLiabilities = Math.round(liabilityItems.reduce((s, it) => s + it.amount, 0) * 100) / 100
  const totalEquity = Math.round(equityItems.reduce((s, it) => s + it.amount, 0) * 100) / 100
  const balanced = Math.round((totalAssets - totalLiabilities - totalEquity) * 100) / 100 === 0

  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced,
    period,
  }
}

// ─── 損益表 ───────────────────────────────────────────────────

/**
 * 從試算表產生損益表（Profit & Loss Statement）
 * @param {Array<{account_code: string, account_name: string, type: string, debit_balance: number, credit_balance: number}>} trialBalance
 * @param {string} period — 報表期間，例如 '2026-03'
 * @returns {{revenue: Array, costOfGoodsSold: Array, grossProfit: number, operatingExpenses: Array, operatingIncome: number, otherIncome: Array, otherExpenses: Array, netIncome: number, period: string}}
 */
export function generateProfitLoss(trialBalance, period) {
  const revenue = []
  const costOfGoodsSold = []
  const operatingExpenses = []
  const otherIncome = []
  const otherExpenses = []

  for (const row of trialBalance) {
    const entry = { item: row.account_name, amount: 0 }

    if (row.type === '收入') {
      // 收入正常餘額在貸方；銷貨退回(4200)為借方減項
      entry.amount = Math.round((row.credit_balance - row.debit_balance) * 100) / 100
      revenue.push(entry)
    } else if (row.type === '銷貨成本') {
      entry.amount = Math.round((row.debit_balance - row.credit_balance) * 100) / 100
      costOfGoodsSold.push(entry)
    } else if (row.type === '營業費用') {
      entry.amount = Math.round((row.debit_balance - row.credit_balance) * 100) / 100
      operatingExpenses.push(entry)
    } else if (row.type === '營業外收入/支出') {
      // 7xxx: 判斷是收入還是支出
      const net = row.credit_balance - row.debit_balance
      if (net >= 0) {
        entry.amount = Math.round(net * 100) / 100
        otherIncome.push(entry)
      } else {
        entry.amount = Math.round(Math.abs(net) * 100) / 100
        otherExpenses.push(entry)
      }
    }
  }

  const totalRevenue = Math.round(revenue.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const totalCOGS = Math.round(costOfGoodsSold.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const grossProfit = Math.round((totalRevenue - totalCOGS) * 100) / 100

  const totalOpex = Math.round(operatingExpenses.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const operatingIncome = Math.round((grossProfit - totalOpex) * 100) / 100

  const totalOtherIncome = Math.round(otherIncome.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const totalOtherExpenses = Math.round(otherExpenses.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const netIncome = Math.round((operatingIncome + totalOtherIncome - totalOtherExpenses) * 100) / 100

  return {
    revenue,
    costOfGoodsSold,
    grossProfit,
    operatingExpenses,
    operatingIncome,
    otherIncome,
    otherExpenses,
    netIncome,
    period,
  }
}

// ─── 簡易借貸平衡驗證 ────────────────────────────────────────────

/**
 * 快速驗證分錄借貸是否平衡（不做科目等完整驗證）
 * @param {Array<{debit: number|string, credit: number|string}>} lines
 * @returns {{balanced: boolean, totalDebit: number, totalCredit: number}}
 */
export function validateJournalBalance(lines) {
  const totalDebit = Math.round(
    lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0) * 100
  ) / 100
  const totalCredit = Math.round(
    lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0) * 100
  ) / 100
  return {
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
    totalDebit,
    totalCredit,
  }
}

// ─── 科目餘額查詢 ────────────────────────────────────────────────

/**
 * 取得單一科目餘額（已過帳分錄的借方合計 - 貸方合計）
 * 資產/費用/成本類：借方餘額為正；負債/權益/收入類：貸方餘額為正
 * @param {string} accountCode — 科目代碼
 * @param {object} supabaseClient — Supabase client instance
 * @returns {Promise<{accountCode: string, accountName: string, type: string, balance: number, totalDebit: number, totalCredit: number}>}
 */
export async function getAccountBalance(accountCode, supabaseClient) {
  // 取得所有已過帳傳票的 ID
  const { data: postedEntries } = await supabaseClient
    .from('journal_entries')
    .select('id')
    .eq('status', '已過帳')

  const entryIds = (postedEntries || []).map(e => e.id)
  if (entryIds.length === 0) {
    const acct = CHART_OF_ACCOUNTS.find(a => a.code === accountCode)
    return {
      accountCode,
      accountName: acct?.name || '未知科目',
      type: getAccountType(accountCode),
      balance: 0,
      totalDebit: 0,
      totalCredit: 0,
    }
  }

  const { data: journalLines } = await supabaseClient
    .from('journal_lines')
    .select('debit, credit')
    .eq('account_code', accountCode)
    .in('entry_id', entryIds)

  const totalDebit = Math.round(
    (journalLines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0) * 100
  ) / 100
  const totalCredit = Math.round(
    (journalLines || []).reduce((s, l) => s + (Number(l.credit) || 0), 0) * 100
  ) / 100

  const type = getAccountType(accountCode)
  const acct = CHART_OF_ACCOUNTS.find(a => a.code === accountCode)

  // 資產/費用/成本類：正常餘額在借方；負債/權益/收入類：正常餘額在貸方
  let balance
  if (['資產', '營業費用', '銷貨成本'].includes(type)) {
    balance = Math.round((totalDebit - totalCredit) * 100) / 100
  } else {
    balance = Math.round((totalCredit - totalDebit) * 100) / 100
  }

  return {
    accountCode,
    accountName: acct?.name || '未知科目',
    type,
    balance,
    totalDebit,
    totalCredit,
  }
}

/**
 * 取得所有有交易的科目餘額，依科目類型分組
 * @param {object} supabaseClient — Supabase client instance
 * @returns {Promise<Record<string, Array<{accountCode: string, accountName: string, balance: number, totalDebit: number, totalCredit: number}>>>}
 */
export async function getAccountBalances(supabaseClient) {
  // 取得所有已過帳傳票 ID
  const { data: postedEntries } = await supabaseClient
    .from('journal_entries')
    .select('id')
    .eq('status', '已過帳')

  const entryIds = (postedEntries || []).map(e => e.id)
  if (entryIds.length === 0) return {}

  // 取得所有已過帳傳票的分錄
  const { data: allLines } = await supabaseClient
    .from('journal_lines')
    .select('account_code, account_name, debit, credit')
    .in('entry_id', entryIds)

  if (!allLines || allLines.length === 0) return {}

  // 依科目彙總
  const accountMap = {}
  for (const line of allLines) {
    const code = line.account_code
    if (!accountMap[code]) {
      accountMap[code] = {
        accountCode: code,
        accountName: line.account_name || CHART_OF_ACCOUNTS.find(a => a.code === code)?.name || '未知',
        totalDebit: 0,
        totalCredit: 0,
      }
    }
    accountMap[code].totalDebit += Number(line.debit) || 0
    accountMap[code].totalCredit += Number(line.credit) || 0
  }

  // 計算餘額並依類型分組
  const grouped = {}
  for (const [code, acct] of Object.entries(accountMap)) {
    const type = getAccountType(code)
    acct.totalDebit = Math.round(acct.totalDebit * 100) / 100
    acct.totalCredit = Math.round(acct.totalCredit * 100) / 100

    if (['資產', '營業費用', '銷貨成本'].includes(type)) {
      acct.balance = Math.round((acct.totalDebit - acct.totalCredit) * 100) / 100
    } else {
      acct.balance = Math.round((acct.totalCredit - acct.totalDebit) * 100) / 100
    }

    if (!grouped[type]) grouped[type] = []
    grouped[type].push(acct)
  }

  // 各組內依科目代碼排序
  for (const type of Object.keys(grouped)) {
    grouped[type].sort((a, b) => a.accountCode.localeCompare(b.accountCode))
  }

  return grouped
}

// ─── 折舊計算 ─────────────────────────────────────────────────

/**
 * 計算固定資產折舊
 * @param {{cost: number, salvage_value: number, useful_life_years: number, method: 'straight_line'|'declining_balance'|'sum_of_years', acquired_date: string, current_date: string}} asset
 * @returns {{monthly_depreciation: number, accumulated_depreciation: number, book_value: number}}
 */
export function calculateDepreciation(asset) {
  const {
    cost,
    salvage_value = 0,
    useful_life_years,
    method = 'straight_line',
    acquired_date,
    current_date,
  } = asset

  const depreciableAmount = cost - salvage_value
  const acquired = new Date(acquired_date)
  const current = new Date(current_date)

  // 計算已使用月數
  let monthsElapsed =
    (current.getFullYear() - acquired.getFullYear()) * 12 +
    (current.getMonth() - acquired.getMonth())
  if (monthsElapsed < 0) monthsElapsed = 0

  const totalMonths = useful_life_years * 12

  // 不超過耐用年限
  const cappedMonths = Math.min(monthsElapsed, totalMonths)
  // 目前在第幾年（從 1 開始）
  const currentYear = Math.min(Math.floor(monthsElapsed / 12) + 1, useful_life_years)

  let monthly_depreciation = 0
  let accumulated_depreciation = 0

  switch (method) {
    // 直線法：每月折舊 = 可折舊金額 / 總月數
    case 'straight_line': {
      monthly_depreciation = Math.round((depreciableAmount / totalMonths) * 100) / 100
      accumulated_depreciation = Math.round(monthly_depreciation * cappedMonths * 100) / 100
      break
    }

    // 定率遞減法：折舊率 = 1 - (殘值/成本)^(1/耐用年限)
    case 'declining_balance': {
      const rate = salvage_value > 0
        ? 1 - Math.pow(salvage_value / cost, 1 / useful_life_years)
        : 2 / useful_life_years // 若無殘值，使用雙倍餘額遞減

      accumulated_depreciation = 0
      let remainingValue = cost

      for (let year = 1; year <= currentYear && year <= useful_life_years; year++) {
        const monthsInThisYear = year < currentYear
          ? 12
          : cappedMonths - (year - 1) * 12

        if (monthsInThisYear <= 0) break

        const yearlyDep = Math.round(remainingValue * rate * 100) / 100
        const monthlyDep = Math.round((yearlyDep / 12) * 100) / 100

        if (year === currentYear) {
          monthly_depreciation = monthlyDep
        }

        accumulated_depreciation += Math.round(monthlyDep * monthsInThisYear * 100) / 100
        if (year < currentYear) {
          remainingValue -= yearlyDep
        }
      }

      // 帳面價值不低於殘值
      if (cost - accumulated_depreciation < salvage_value) {
        accumulated_depreciation = depreciableAmount
      }

      accumulated_depreciation = Math.round(accumulated_depreciation * 100) / 100
      break
    }

    // 年數合計法：第 n 年折舊 = 可折舊金額 × (剩餘年限 / 年數合計)
    case 'sum_of_years': {
      const sumOfYears = (useful_life_years * (useful_life_years + 1)) / 2
      accumulated_depreciation = 0

      for (let year = 1; year <= currentYear && year <= useful_life_years; year++) {
        const remainingLife = useful_life_years - year + 1
        const yearlyDep = Math.round((depreciableAmount * remainingLife / sumOfYears) * 100) / 100
        const monthlyDep = Math.round((yearlyDep / 12) * 100) / 100

        const monthsInThisYear = year < currentYear
          ? 12
          : cappedMonths - (year - 1) * 12

        if (monthsInThisYear <= 0) break

        if (year === currentYear) {
          monthly_depreciation = monthlyDep
        }

        accumulated_depreciation += Math.round(monthlyDep * monthsInThisYear * 100) / 100
      }

      accumulated_depreciation = Math.round(accumulated_depreciation * 100) / 100
      break
    }

    default:
      throw new Error(`不支援的折舊方法：${method}（支援：straight_line, declining_balance, sum_of_years）`)
  }

  // 確保累計折舊不超過可折舊金額
  if (accumulated_depreciation > depreciableAmount) {
    accumulated_depreciation = depreciableAmount
  }

  const book_value = Math.round((cost - accumulated_depreciation) * 100) / 100

  return {
    monthly_depreciation,
    accumulated_depreciation,
    book_value,
  }
}

// ─── 報表資料擷取（Supabase 查詢）──────────────────────────────

/**
 * 取得已過帳傳票的所有分錄（可選日期範圍篩選）
 * @param {string} [asOfDate] — 截止日期 (YYYY-MM-DD)，不傳則取全部
 * @param {string} [startDate] — 起始日期 (YYYY-MM-DD)
 * @returns {Promise<{accounts: Array, lines: Array}>}
 */
async function fetchPostedData(asOfDate, startDate) {
  // 取得已過帳的傳票
  let entryQuery = supabase
    .from('journal_entries')
    .select('id, entry_date')
    .eq('status', '已過帳')

  if (asOfDate) {
    entryQuery = entryQuery.lte('entry_date', asOfDate)
  }
  if (startDate) {
    entryQuery = entryQuery.gte('entry_date', startDate)
  }

  const [entriesRes, accountsRes] = await Promise.all([
    entryQuery,
    supabase.from('accounts').select('*').order('code'),
  ])

  const entries = entriesRes.data || []
  const accounts = accountsRes.data || []
  const entryIds = entries.map(e => e.id)

  if (entryIds.length === 0) {
    return { accounts, lines: [] }
  }

  // Supabase .in() 有上限，分批查詢
  const batchSize = 100
  let allLines = []
  for (let i = 0; i < entryIds.length; i += batchSize) {
    const batch = entryIds.slice(i, i + batchSize)
    const { data } = await supabase
      .from('journal_lines')
      .select('*')
      .in('entry_id', batch)
    if (data) allLines = allLines.concat(data)
  }

  return { accounts, lines: allLines }
}

/**
 * 取得試算表資料（僅已過帳傳票）
 * @param {string} [asOfDate] — 截止日期
 * @returns {Promise<Array<{account_code, account_name, type, debit_balance, credit_balance}>>}
 */
export async function getTrialBalance(asOfDate) {
  const { accounts, lines } = await fetchPostedData(asOfDate)
  return generateTrialBalance(accounts.length > 0 ? accounts : CHART_OF_ACCOUNTS, lines)
}

/**
 * 取得資產負債表資料（僅已過帳傳票）
 * @param {string} [asOfDate] — 截止日期
 * @returns {Promise<{assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, balanced}>}
 */
export async function getBalanceSheetData(asOfDate) {
  const trialBalance = await getTrialBalance(asOfDate)
  const period = asOfDate || new Date().toISOString().slice(0, 10)
  return generateBalanceSheet(trialBalance, period)
}

/**
 * 取得損益表資料（僅已過帳傳票，指定日期範圍）
 * @param {string} startDate — 起始日期
 * @param {string} endDate — 結束日期
 * @returns {Promise<{revenue, costOfGoodsSold, grossProfit, operatingExpenses, operatingIncome, otherIncome, otherExpenses, netIncome}>}
 */
export async function getIncomeStatement(startDate, endDate) {
  const { accounts, lines } = await fetchPostedData(endDate, startDate)
  const trialBalance = generateTrialBalance(accounts.length > 0 ? accounts : CHART_OF_ACCOUNTS, lines)
  const period = `${startDate} ~ ${endDate}`
  return generateProfitLoss(trialBalance, period)
}
