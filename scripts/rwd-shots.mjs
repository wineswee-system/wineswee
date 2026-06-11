#!/usr/bin/env node
/**
 * RWD 自動截圖驗收 script
 *
 * 用途：commit 前一鍵掃出 6 種螢幕寬度 × N 個關鍵頁的截圖，看圖 diff 抓破版。
 *
 * 前置：先跑 `npm run dev`（port 5173）讓 app 跑著。
 *
 * 第一次（存登入狀態）：
 *   npm run rwd-shots:login
 *   → 開瀏覽器，你手動登入 → 按 Enter → 存 .playwright-state.json
 *
 * 平常用：
 *   npm run rwd-shots                       # 跑預設關鍵頁
 *   npm run rwd-shots -- /hr/schedule       # 指定單頁
 *   npm run rwd-shots -- /hr/schedule /hr/payroll  # 多頁
 *
 * 輸出：screenshots/rwd/{timestamp}/{viewport}_{page}.png
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const BASE = process.env.RWD_BASE || 'http://localhost:5173'
const STATE_PATH = path.resolve('.playwright-state.json')

// 6 種代表性 viewport — 涵蓋桌機/筆電/平板/手機
const VIEWPORTS = [
  { name: '1-desktop-2k',  width: 1920, height: 1080 },  // 27" 桌機
  { name: '2-laptop-fhd',  width: 1366, height: 768 },   // 14" 老筆電
  { name: '3-laptop-13',   width: 1280, height: 800 },   // 13" MBA
  { name: '4-tablet-land', width: 1024, height: 768 },   // iPad 橫
  { name: '5-tablet-port', width: 768,  height: 1024 },  // iPad 直
  { name: '6-mobile',      width: 390,  height: 844 },   // iPhone
]

// 預設掃這幾頁（高流量 + RWD 高風險）
const DEFAULT_PAGES = [
  '/',
  '/workflow/expenses',
  '/hr/schedule',
  '/hr/payroll',
  '/finance/journal-entries',
  '/wms/inventory',
]

const args = process.argv.slice(2)
const isLogin = args.includes('--login')
const pagesArg = args.filter(a => a.startsWith('/'))
const pages = pagesArg.length ? pagesArg : DEFAULT_PAGES

if (isLogin) {
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await ctx.newPage()
  await page.goto(BASE)
  console.log('\n→ 請在剛開的瀏覽器手動登入')
  console.log('→ 登入完成後回這裡按 Enter ...')
  await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.once('line', () => { rl.close(); resolve() })
  })
  await ctx.storageState({ path: STATE_PATH })
  console.log(`✓ 已存登入狀態到 ${STATE_PATH}`)
  await browser.close()
  process.exit(0)
}

if (!fs.existsSync(STATE_PATH)) {
  console.error('✗ 沒有登入狀態檔，先跑：npm run rwd-shots:login')
  process.exit(1)
}

// 確認 dev server 跑著
try {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 3000)
  await fetch(BASE, { signal: ctrl.signal })
} catch {
  console.error(`✗ ${BASE} 沒回應，先跑 npm run dev`)
  process.exit(1)
}

const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
const outDir = path.resolve('screenshots', 'rwd', ts)
fs.mkdirSync(outDir, { recursive: true })
console.log(`→ 截圖輸出：${outDir}\n`)

const browser = await chromium.launch({ headless: true })
let okCount = 0, failCount = 0

for (const vp of VIEWPORTS) {
  console.log(`\n=== ${vp.name} (${vp.width}×${vp.height}) ===`)
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    storageState: STATE_PATH,
    deviceScaleFactor: 1,
    // 手機模擬觸控
    isMobile: vp.width <= 480,
    hasTouch: vp.width <= 768,
  })
  for (const p of pages) {
    const page = await ctx.newPage()
    try {
      await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle', timeout: 20000 })
      await page.waitForTimeout(700) // 等動畫 settle
      const slug = p === '/' ? 'home' : p.slice(1).replace(/\//g, '_')
      const file = path.join(outDir, `${vp.name}_${slug}.png`)
      await page.screenshot({ path: file, fullPage: true })
      console.log(`  ✓ ${p}`)
      okCount++
    } catch (e) {
      console.error(`  ✗ ${p}: ${e.message.split('\n')[0]}`)
      failCount++
    } finally {
      await page.close()
    }
  }
  await ctx.close()
}

await browser.close()
console.log(`\n完成: ${okCount} 張 OK, ${failCount} 張失敗`)
console.log(`→ 打開 ${outDir} 用看圖軟體切換比對`)
