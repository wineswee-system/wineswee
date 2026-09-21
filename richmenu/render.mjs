import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 2500, height: 1686 },
  deviceScaleFactor: 1,
})
await page.goto('file://' + join(here, 'menu.html').replace(/\\/g, '/'))
await page.waitForTimeout(300)
await page.screenshot({
  path: join(here, 'richmenu-hr.png'),
  clip: { x: 0, y: 0, width: 2500, height: 1686 },
})
await browser.close()
console.log('✅ 出圖完成 → richmenu/richmenu-hr.png (2500x1686)')
