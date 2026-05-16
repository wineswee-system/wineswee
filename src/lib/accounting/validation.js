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
