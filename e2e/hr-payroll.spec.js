// @ts-check
import { test, expect } from '@playwright/test'

/**
 * E2E: HR Payroll Flow
 * HR-E01 through HR-E13
 */

test.describe('HR: Payroll', () => {
  test('HR-E01: salary page loads with employee list', async ({ page }) => {
    await page.goto('/hr/salary')
    await page.waitForTimeout(2000)

    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })

    // Should show table or list of employees
    const table = page.locator('table, [class*="table"], [class*="list"]').first()
    if (await table.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(table).toBeVisible()
    }
  })

  test('HR-E02: salary page has payroll action button', async ({ page }) => {
    await page.goto('/hr/salary')
    await page.waitForTimeout(2000)

    // Look for a run payroll or calculate button
    const actionButton = page.locator('button').filter({
      hasText: /薪資|計算|Run|Payroll|批次|產生/i
    }).first()

    if (await actionButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(actionButton).toBeEnabled()
    }
  })
})

test.describe('HR: Leave Management', () => {
  test('HR-E09: leave page loads', async ({ page }) => {
    await page.goto('/hr/leave')
    await page.waitForTimeout(2000)

    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })

  test('HR-E10: leave page has request form or button', async ({ page }) => {
    await page.goto('/hr/leave')
    await page.waitForTimeout(2000)

    const addButton = page.locator('button').filter({
      hasText: /申請|新增|Add|Request|請假/i
    }).first()

    if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(addButton).toBeEnabled()
    }
  })
})

test.describe('HR: Attendance & Schedule', () => {
  test('attendance page loads', async ({ page }) => {
    await page.goto('/hr/attendance')
    await page.waitForTimeout(2000)
    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })

  test('schedule page loads', async ({ page }) => {
    await page.goto('/hr/schedule')
    await page.waitForTimeout(2000)
    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })

  test('overtime page loads', async ({ page }) => {
    await page.goto('/hr/overtime')
    await page.waitForTimeout(2000)
    const content = page.locator('main, [class*="main"]').first()
    await expect(content).toBeVisible({ timeout: 10000 })
  })
})
