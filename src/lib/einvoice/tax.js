/**
 * 電子發票稅額計算
 */
import { TAX_RATES } from './constants.js'

/**
 * 計算發票稅額
 * @param {Array} items   - 品項 [{description, qty, unitPrice}]
 * @param {string} taxType - '應稅' | '零稅率' | '免稅'
 * @returns {{ subtotal: number, taxAmount: number, total: number, taxRate: number, items_with_tax: Array }}
 */
export function calculateInvoiceTax(items, taxType = '應稅') {
  const taxRate = TAX_RATES[taxType] ?? 0.05

  let subtotal = 0
  const items_with_tax = items.map(item => {
    const amount = Math.round(item.qty * item.unitPrice)
    const tax = Math.round(amount * taxRate)
    subtotal += amount
    return {
      description: item.description,
      qty: item.qty,
      unit_price: item.unitPrice,
      amount,
      tax,
    }
  })

  const taxAmount = Math.round(subtotal * taxRate)
  const total = subtotal + taxAmount

  return { subtotal, taxAmount, total, taxRate, items_with_tax }
}
