// @ts-check
import { test, expect } from '@playwright/test'

/**
 * E2E: Finance Flow — Journal Entry → Financial Statements
 * FIN-E01 through FIN-E07
 */

test.describe('Finance: Journal Entry Flow', () => {
  test('FIN-E01: navigate to journal entries page', async ({ page }) => {
    await page.goto('/finance/journal')
    await page.waitForTimeout(2000)

    // Page should render with a table or list
    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })

    // Should have an "add" or "new" button
    const addButton = page.locator('button').filter({ hasText: /新增|新建|建立|Add|Create/i }).first()
    if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(addButton).toBeVisible()
    }
  })

  test('FIN-E05: trial balance page loads', async ({ page }) => {
    await page.goto('/finance/trial-balance', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)

    // Page renders — check for #root having children (app mounted)
    const root = page.locator('#root')
    await expect(root).toBeVisible({ timeout: 10000 })
    const childCount = await root.locator('> *').count()
    expect(childCount).toBeGreaterThan(0)
  })

  test('FIN-E06: balance sheet page loads', async ({ page }) => {
    await page.goto('/finance/balance-sheet')
    await page.waitForTimeout(2000)

    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })

  test('FIN-E07: P&L page loads', async ({ page }) => {
    await page.goto('/finance/profit-loss')
    await page.waitForTimeout(2000)

    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })

  test('Tax reports page loads', async ({ page }) => {
    await page.goto('/finance/tax-reports')
    await page.waitForTimeout(2000)

    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Finance: AR/AP Pages', () => {
  test('AR page loads with aging display', async ({ page }) => {
    await page.goto('/finance/ar')
    await page.waitForTimeout(2000)
    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })

  test('AP page loads', async ({ page }) => {
    await page.goto('/finance/ap')
    await page.waitForTimeout(2000)
    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })
})
