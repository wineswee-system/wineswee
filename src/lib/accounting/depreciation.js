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
