// Wineswee 官網資料層 — 全部改讀 content.js 的 store(後臺可改;讀不到用靜態墊底)
import { store } from './content'

// ── 品牌固定資訊(logo/社群;Phase 1 不開放後臺改) ────────────────────────────
export const SITE = {
  logo: '/wineswee-logo.svg',
  line: 'https://page.line.me/?accountId=wineswee01',
  fb: 'https://www.facebook.com/wineswee90370708/',
  ig: 'https://www.instagram.com/wineswee/',
  ytEmbed: 'https://www.youtube.com/embed/ZZccVDRoR2M?rel=0&loop=1&playlist=ZZccVDRoR2M&showinfo=0&controls=1',
  email: 'cs@wineswee.com',
}
const BANNERS_DEFAULT = [
  'https://www.wineswee.com/storage/upload/banner/image/2026-05-22/PnahdFdR82dbWjODiQmGdfEVeUbNe0xrGkYUlSZ4.jpg',
  'https://www.wineswee.com/storage/upload/banner/image/2026-05-08/JB0jvHwOiD3VqgHu37dhNflzkjEjcwqgx8MBGsa9.jpg',
  'https://www.wineswee.com/storage/upload/banner/image/2026-04-16/cmx82g7NBRrsOxFo0WZjFHd069ku19MWl48Ubu5A.jpg',
  'https://www.wineswee.com/storage/upload/banner/image/2025-01-17/76YcWU0PLnHZUp8FsZlMaXN7sEbMqHXojnA0md8C.jpg',
]
export function getBanners() { return store.site?.banners?.length ? store.site.banners : BANNERS_DEFAULT }

// ── 分類定義(固定) ─────────────────────────────────────────────────────────
export const CATEGORIES = [
  { key: 'red', label: '紅酒', en: 'Red Wine', test: n => /紅葡萄酒|紅酒/.test(n) },
  { key: 'white', label: '白酒', en: 'White Wine', test: n => /白葡萄酒|白酒/.test(n) },
  { key: 'sparkling', label: '氣泡・香檳', en: 'Sparkling', test: n => /氣泡|香檳/.test(n) },
  { key: 'rose', label: '粉紅酒', en: 'Rosé', test: n => /粉紅|玫瑰(?!堡)|ros[ée]/i.test(n) },
  { key: 'whisky', label: '威士忌', en: 'Whisky', test: n => /威士忌|whisky|whiskey/i.test(n) },
  { key: 'sake', label: '清酒', en: 'Sake', test: n => /吟釀|吟醸|純米|冷酒|原酒|清酒|日本酒/.test(n) },
  { key: 'spirit', label: '烈酒', en: 'Spirits', test: n => /龍舌蘭|白蘭地|蘭姆|grappa|琴酒|伏特加|威迪|利口|橘子酒|梅酒|水果酒|芒果酒/i.test(n) },
  { key: 'cheese', label: '乳酪', en: 'Cheese', test: n => /乳酪|起司|高達|cheese/i.test(n) },
  { key: 'ham', label: '肉品・火腿', en: 'Charcuterie', test: n => /火腿|伊比利|黑豬|臘腸|香腸/.test(n) },
  { key: 'ware', label: '酒器・禮盒', en: 'Wares & Gifts', test: n => /酒器|酒杯|水晶杯|杯具|[通用香檳白紅對]杯|載杯|杯\/|品飲杯|禮盒|開瓶|醒酒/.test(n) },
]
export const WINE_KEYS = ['red', 'white', 'sparkling', 'rose', 'whisky', 'sake', 'spirit']
export const FOOD_KEYS = ['cheese', 'ham', 'ware']
export const CAT_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]))
export const CAT_EN = Object.fromEntries(CATEGORIES.map(c => [c.key, c.en]))

const CLASSIFY_ORDER = ['ware', 'cheese', 'ham', 'whisky', 'sake', 'spirit', 'sparkling', 'rose', 'white', 'red']
function classify(name) {
  for (const k of CLASSIFY_ORDER) { const c = CATEGORIES.find(x => x.key === k); if (c && c.test(name)) return c.key }
  return 'other'
}

export const REGIONS = ['法國', '義大利', '西班牙', '葡萄牙', '德國', '希臘', '奧地利', '紐西蘭', '澳洲', '美國', '智利', '阿根廷', '南非', '日本', '喬治亞', '亞美尼亞', '摩爾多瓦']
export function regionOf(name) { for (const r of REGIONS) if (name.includes(r)) return r; return '其他' }

export const PRICE_BANDS = [
  { key: 'a', label: 'NT$ 500 以下', min: 0, max: 500 },
  { key: 'b', label: 'NT$ 500–1,000', min: 500, max: 1000 },
  { key: 'c', label: 'NT$ 1,000–2,000', min: 1000, max: 2000 },
  { key: 'd', label: 'NT$ 2,000 以上', min: 2000, max: Infinity },
]

// ── 商品:從 store.products 現算(依 reference 快取) ──────────────────────────
let _allCache = null, _allSrc = null
export function getAll() {
  if (store.products === _allSrc && _allCache) return _allCache
  _allSrc = store.products
  _allCache = (store.products || []).filter(p => p.name)
    .map(p => ({ ...p, cat: classify(p.name) }))
    .sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || (a.sold_out ? 1 : 0) - (b.sold_out ? 1 : 0))
    .map((p, i) => ({ ...p, id: i }))
  return _allCache
}

export function byCategory() {
  const m = {}
  for (const p of getAll()) (m[p.cat] ||= []).push(p)
  return m
}

// ── 選購專區每類文案(store.site.catMeta 可覆寫) ──────────────────────────────
const CAT_META_DEFAULT = {
  red: '波爾多列級到里奧哈，單寧細緻、餘韻悠長',
  white: '清爽果香與俐落酸度，佐海鮮與前菜最相宜',
  sparkling: '細緻氣泡躍動杯中，慶祝與開胃的第一杯',
  rose: '介於紅白之間，冰鎮後果香清新迷人',
  whisky: '從煙燻到花果，值得靜靜品味的一杯',
  sake: '純米的細膩甘美，冷飲、溫熱各有風味',
  spirit: '龍舌蘭到梅酒，純飲或調製皆見層次',
  cheese: '歐陸陳年乳酪，鹹香濃郁、佐酒入菜',
  ham: '慢工熟成的頂級火腿，油脂如絲、佐酒經典',
  ware: '酒杯、醒酒器與禮盒，品飲致贈更顯講究',
}
export const CAT_META_KEYS = Object.keys(CAT_META_DEFAULT)
export function getCatMeta(key) { return store.site?.catMeta?.[key] ?? CAT_META_DEFAULT[key] }

export function catPriceFrom(key) {
  const ps = getAll().filter(p => p.cat === key && p.price).map(p => p.price)
  return ps.length ? Math.min(...ps) : null
}
export function catHeroImage(key) {
  const items = (byCategory()[key] || []).filter(p => p.image)
  return (items.find(p => !p.sold_out && p.price) || items[0])?.image
}
export const getProduct = (id) => { const A = getAll(); return A[id]?.id === id ? A[id] : A.find(p => p.id === id) }
export const related = (p, n = 12) => getAll().filter(x => x.cat === p.cat && x.id !== p.id).slice(0, n)

// ── 商品詳情 ────────────────────────────────────────────────────────────────
export const getDetail = (name) => store.details?.[name] || null
const SPEC_ORDER = ['年份', '產區', '葡萄品種', '酒精濃度', 'ml數', '建議試飲溫度', '容量']
export function specRows(detail, product) {
  if (!detail?.spec) return []
  const s = { ...detail.spec }
  if (!s['產區'] && product) { const r = regionOf(product.name); if (r !== '其他') s['產區'] = r }
  const keys = [...SPEC_ORDER.filter(k => k in s), ...Object.keys(s).filter(k => !SPEC_ORDER.includes(k))]
  const unit = { 酒精濃度: '% vol', ml數: ' ml', 建議試飲溫度: ' °C' }
  return keys.map(k => [k.replace('ml數', '容量'), s[k] ? `${s[k]}${unit[k] || ''}` : '—']).filter(r => r[1] !== '—')
}

// ── 最新消息 ────────────────────────────────────────────────────────────────
export function getNewsList() {
  return (store.news || []).map(n => ({ id: n.id, title: n.title, date: n.date, image: n.cover || (n.images && n.images[0]) || null }))
}
export function getNewsDetails() { return store.news || [] }
export const getNews = (id) => (store.news || []).find(n => String(n.id) === String(id))

// ── 門市 ────────────────────────────────────────────────────────────────────
export function getStores() { return store.stores || [] }
