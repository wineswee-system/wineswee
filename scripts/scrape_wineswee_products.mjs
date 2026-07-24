// 一鍵重爬 wineswee.com 公開商品 → src/data/wineswee-products.json
// 用法: node scripts/scrape_wineswee_products.mjs
// 原理: 讀官網 sitemap.xml 全部 /product、/commodity 列表頁 → 抽 .pro-item 商品卡
//       (名稱/價格/圖) → 依商品名去重 → 寫 JSON。圖存的是官網 CDN 絕對網址。
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const BASE = 'https://www.wineswee.com'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'wineswee-products.json')
const CONC = 5

async function get(u) {
  try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }); return r.ok ? await r.text() : '' }
  catch { return '' }
}

function parseCards(html) {
  const out = []
  for (const c of html.split(/class="pro-item/).slice(1)) {
    const seg = c.slice(0, 1400)
    const name = (seg.match(/class="fs-16 title[^"]*"[^>]*>([^<]+)</) || seg.match(/class="title[^"]*"[^>]*>([^<]+)</) || [])[1]?.trim()
    const priceRaw = (seg.match(/class="price-box[^"]*"[^>]*>\s*([^<]+)/) || [])[1]
    const num = priceRaw && (priceRaw.match(/([0-9,]+)/) || [])[1]?.replace(/,/g, '')
    const img = (seg.match(/upload\/product\/image\/[^\s"'?)]+\.(?:jpg|jpeg|png|webp)/i) || [])[0]
    const sold = /sold-out/.test(c.slice(0, 40))
    if (name) out.push({ name, price: num ? +num : null, image: img ? `${BASE}/${img}` : null, sold_out: sold })
  }
  return out
}

const sm = await get(`${BASE}/sitemap.xml`)
const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
  .filter(u => /\/(product|commodity)\//.test(u) && !/price_range|\?/.test(u))
console.log(`列表頁: ${urls.length}`)

const seen = new Map()
let done = 0
async function worker(list) {
  for (const u of list) {
    const html = await get(u)
    const cat = (html.match(/<title>([^<|]+)/) || [])[1]?.trim()
    for (const p of parseCards(html)) if (!seen.has(p.name)) seen.set(p.name, { ...p, category: cat })
    if (++done % 40 === 0) console.log(`  ...${done}/${urls.length} 頁, 累積 ${seen.size} 商品`)
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(urls.filter((_, j) => j % CONC === i))))

const products = [...seen.values()]
writeFileSync(OUT, JSON.stringify(products, null, 1))
console.log(`\n完成! ${products.length} 商品 (${products.filter(p => p.image).length} 有圖, ${products.filter(p => p.price).length} 有價) → ${OUT}`)
