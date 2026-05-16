import { supabase } from '../supabase'
import { CHART_OF_ACCOUNTS, getAccountType } from './constants'
import { validateJournalEntry } from './validation'

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

      // update_account_balance RPC 尚未建立，改 read-then-write（高併發下有 race risk，
      // 建議未來補一個 SQL 原子遞增函式）
      const { data: acct, error: readErr } = await supabase
        .from('accounts').select('balance').eq('code', line.account_code).maybeSingle()
      if (readErr) {
        errors.push(`讀取科目 ${line.account_code} ${line.account_name} 餘額失敗：${readErr.message}`)
        continue
      }
      const newBalance = Number(acct?.balance || 0) + balanceChange
      const { error: balanceError } = await supabase
        .from('accounts').update({ balance: newBalance }).eq('code', line.account_code)
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

// ─── 傳票沖銷（迴轉分錄）──────────────────────────────────────────

/**
 * 產生迴轉分錄（將原始傳票的借貸方互換）
 * @param {{id: string, entry_date: string, description: string, lines: Array<{account_code: string, account_name: string, debit: number, credit: number}>}} originalEntry — 原始傳票
 * @returns {{original_entry_id: string, description: string, lines: Array<{account_code: string, account_name: string, debit: number, credit: number}>}}
 */
export function reverseJournalEntry(originalEntry) {
  const reversedLines = originalEntry.lines.map(line => ({
    account_code: line.account_code,
    account_name: line.account_name,
    debit: Math.round((Number(line.credit) || 0) * 100) / 100,
    credit: Math.round((Number(line.debit) || 0) * 100) / 100,
  }))

  return {
    original_entry_id: originalEntry.id,
    description: `沖銷 - ${originalEntry.description || originalEntry.id}`,
    lines: reversedLines,
  }
}

// ─── 循環分錄產生器 ──────────────────────────────────────────────

/**
 * 依範本與頻率產生循環分錄
 * @param {{description: string, lines: Array<{account_code: string, account_name: string, debit: number, credit: number}>}} template — 分錄範本
 * @param {string} startDate — 起始日期（YYYY-MM-DD）
 * @param {string} endDate — 結束日期（YYYY-MM-DD）
 * @param {'monthly'|'quarterly'|'yearly'} frequency — 頻率
 * @returns {Array<{entry_date: string, description: string, lines: Array<{account_code: string, account_name: string, debit: number, credit: number}>}>}
 */
export function generateRecurringEntries(template, startDate, endDate, frequency) {
  const entries = []
  const end = new Date(endDate)
  let current = new Date(startDate)

  while (current <= end) {
    const entryDate = current.toISOString().slice(0, 10)

    // 複製範本分錄明細，確保金額精度
    const lines = template.lines.map(line => ({
      account_code: line.account_code,
      account_name: line.account_name,
      debit: Math.round((Number(line.debit) || 0) * 100) / 100,
      credit: Math.round((Number(line.credit) || 0) * 100) / 100,
    }))

    entries.push({
      entry_date: entryDate,
      description: template.description,
      lines,
    })

    // 遞增日期
    switch (frequency) {
      case 'monthly':
        current.setMonth(current.getMonth() + 1)
        break
      case 'quarterly':
        current.setMonth(current.getMonth() + 3)
        break
      case 'yearly':
        current.setFullYear(current.getFullYear() + 1)
        break
      default:
        throw new Error(`不支援的頻率：${frequency}（支援：monthly, quarterly, yearly）`)
    }
  }

  return entries
}

// ─── 期間關帳 ────────────────────────────────────────────────────

/**
 * 關閉會計期間，回傳關帳紀錄
 * @param {{period: string, closed_by: string}} period — 要關閉的期間資料（period 格式如 '2026-03'）
 * @returns {{period: string, closed_at: string, closed_by: string, status: '已關帳'}}
 */
export function closePeriod(period) {
  return {
    period: period.period,
    closed_at: new Date().toISOString(),
    closed_by: period.closed_by,
    status: '已關帳',
  }
}

/**
 * 檢查指定期間是否已關帳（用於阻擋過帳）
 * @param {string} period — 要檢查的期間（格式如 '2026-03'）
 * @param {Array<{period: string, status: string}>} closedPeriods — 已關帳期間清單
 * @returns {boolean} true 表示已關帳，不可再過帳
 */
export function isPeriodClosed(period, closedPeriods) {
  return closedPeriods.some(
    cp => cp.period === period && cp.status === '已關帳'
  )
}

// ─── 收款分配 ────────────────────────────────────────────────────

/**
 * 將收到的款項依 FIFO（先到期先沖銷）分配至未結發票
 * @param {{amount: number, date: string, reference?: string}} payment — 收到的款項
 * @param {Array<{id: string, amount: number, due_date: string, balance: number}>} openInvoices — 未結發票（需有 balance 欄位表示尚欠金額）
 * @returns {{allocations: Array<{invoice_id: string, allocated_amount: number, remaining_balance: number}>, unallocated: number}}
 */
export function allocatePayment(payment, openInvoices) {
  let remaining = Math.round((Number(payment.amount) || 0) * 100) / 100

  // 依到期日排序（FIFO：最早到期先沖）
  const sorted = [...openInvoices].sort(
    (a, b) => new Date(a.due_date) - new Date(b.due_date)
  )

  const allocations = []

  for (const inv of sorted) {
    if (remaining <= 0) break

    const invoiceBalance = Math.round((Number(inv.balance) || 0) * 100) / 100
    if (invoiceBalance <= 0) continue

    const allocated = Math.min(remaining, invoiceBalance)
    const allocatedRounded = Math.round(allocated * 100) / 100
    const remainingBalance = Math.round((invoiceBalance - allocatedRounded) * 100) / 100

    allocations.push({
      invoice_id: inv.id,
      allocated_amount: allocatedRounded,
      remaining_balance: remainingBalance,
    })

    remaining = Math.round((remaining - allocatedRounded) * 100) / 100
  }

  return {
    allocations,
    unallocated: Math.round(remaining * 100) / 100,
  }
}

// ─── 折讓單（Credit Note）──────────────────────────────────────────

/**
 * 建立折讓單（銷貨退回/折讓），產生反向分錄明細
 * @param {{id: string, entry_date: string, lines: Array<{account_code: string, account_name: string, debit: number, credit: number}>}} originalInvoice — 原始發票傳票
 * @param {Array<{account_code: string, account_name: string, amount: number, reason?: string}>} creditLines — 折讓明細（金額為正數）
 * @returns {{credit_note_lines: Array<{account_code: string, account_name: string, debit: number, credit: number, description: string}>, total_credit: number, original_invoice_id: string}}
 */
export function createCreditNote(originalInvoice, creditLines) {
  const credit_note_lines = []
  let total_credit = 0

  for (const cl of creditLines) {
    const amount = Math.round((Number(cl.amount) || 0) * 100) / 100
    if (amount <= 0) continue

    total_credit = Math.round((total_credit + amount) * 100) / 100
    const reason = cl.reason || '折讓'

    // 找原始分錄中對應科目的借貸方向，產生反向
    const originalLine = originalInvoice.lines.find(l => l.account_code === cl.account_code)
    if (originalLine && (Number(originalLine.debit) || 0) > 0) {
      // 原為借方 → 折讓轉貸方
      credit_note_lines.push({
        account_code: cl.account_code,
        account_name: cl.account_name,
        debit: 0,
        credit: amount,
        description: `折讓 - ${reason}`,
      })
    } else {
      // 原為貸方 → 折讓轉借方
      credit_note_lines.push({
        account_code: cl.account_code,
        account_name: cl.account_name,
        debit: amount,
        credit: 0,
        description: `折讓 - ${reason}`,
      })
    }
  }

  return {
    credit_note_lines,
    total_credit,
    original_invoice_id: originalInvoice.id,
  }
}

// ─── 銀行對帳 ────────────────────────────────────────────────────

/**
 * 自動比對銀行交易與帳簿交易（依金額 + 日期配對）
 * @param {Array<{id: string, date: string, amount: number, description?: string}>} bankTransactions — 銀行端交易
 * @param {Array<{id: string, date: string, amount: number, description?: string}>} bookTransactions — 帳簿端交易
 * @returns {{matched: Array<{bank_id: string, book_id: string, amount: number, date: string}>, unmatchedBank: Array<{id: string, date: string, amount: number, description?: string}>, unmatchedBook: Array<{id: string, date: string, amount: number, description?: string}>}}
 */
export function reconcileBankStatement(bankTransactions, bookTransactions) {
  const matched = []
  const usedBookIds = new Set()
  const usedBankIds = new Set()

  // 依金額與日期完全相符進行配對
  for (const bt of bankTransactions) {
    const btAmount = Math.round((Number(bt.amount) || 0) * 100) / 100

    for (const bk of bookTransactions) {
      if (usedBookIds.has(bk.id)) continue

      const bkAmount = Math.round((Number(bk.amount) || 0) * 100) / 100

      if (btAmount === bkAmount && bt.date === bk.date) {
        matched.push({
          bank_id: bt.id,
          book_id: bk.id,
          amount: btAmount,
          date: bt.date,
        })
        usedBankIds.add(bt.id)
        usedBookIds.add(bk.id)
        break
      }
    }
  }

  const unmatchedBank = bankTransactions.filter(bt => !usedBankIds.has(bt.id))
  const unmatchedBook = bookTransactions.filter(bk => !usedBookIds.has(bk.id))

  return { matched, unmatchedBank, unmatchedBook }
}
