// Wineswee 官網資料層 — 全部改讀 content.js 的 store(後臺可改;讀不到用靜態墊底)
import { store } from './content'

export const BANNERS_DEFAULT = [
  'https://www.wineswee.com/storage/upload/banner/image/2026-05-22/PnahdFdR82dbWjODiQmGdfEVeUbNe0xrGkYUlSZ4.jpg',
  'https://www.wineswee.com/storage/upload/banner/image/2026-05-08/JB0jvHwOiD3VqgHu37dhNflzkjEjcwqgx8MBGsa9.jpg',
  'https://www.wineswee.com/storage/upload/banner/image/2026-04-16/cmx82g7NBRrsOxFo0WZjFHd069ku19MWl48Ubu5A.jpg',
  'https://www.wineswee.com/storage/upload/banner/image/2025-01-17/76YcWU0PLnHZUp8FsZlMaXN7sEbMqHXojnA0md8C.jpg',
]

// ── 首頁版面(區塊順序 + 開關,後台可調) ──────────────────────────────────────
export const DEFAULT_LAYOUT = [
  { key: 'manifesto', on: true }, { key: 'category', on: true }, { key: 'occasions', on: true },
  { key: 'row', on: true }, { key: 'spotlight', on: true }, { key: 'concierge', on: true },
  { key: 'story', on: true }, { key: 'news', on: true }, { key: 'stores', on: true }, { key: 'cta', on: true },
]
export const SECTION_LABELS = {
  manifesto: '四大特點', category: '選購專區', occasions: '情境選酒', row: '本季紅酒精選',
  spotlight: '本季精選', concierge: '專人選酒服務', story: '品牌故事', news: '最新消息', stores: '門市', cta: 'LINE 行動呼籲',
}

// ── 全站文案預設(後台可覆寫;*字*→金色斜體) ─────────────────────────────────
export const SITE_DEFAULTS = {
  layout: DEFAULT_LAYOUT,
  logo: '/wineswee-logo.svg',
  contact: {
    line: 'https://page.line.me/?accountId=wineswee01',
    fb: 'https://www.facebook.com/wineswee90370708/',
    ig: 'https://www.instagram.com/wineswee/',
    yt: 'https://m.youtube.com/@wineswee241',
    email: 'cs@wineswee.com',
    ytEmbed: 'https://www.youtube.com/embed/ZZccVDRoR2M?rel=0&loop=1&playlist=ZZccVDRoR2M&showinfo=0&controls=1',
  },
  announce: '威士威酒食超市　·　全台 11 家門市　·　線上宅配到府　·　未滿十八歲禁止飲酒',
  legal: '禁止酒駕　　飲酒過量，有害健康　　未滿十八歲禁止飲酒',
  // 導覽選單:drop=分類下拉(wine/food);to 可為 站內路徑、@line、@email、或 http 網址
  nav: [
    { label: '關於我們', to: '/wineswee/about' },
    { drop: 'wine', label: '酒類專區' },
    { drop: 'food', label: '美食／酒器' },
    { label: '主題活動', to: '/wineswee/news' },
    { label: '酒品知識', to: '/wineswee/news/6' },
    { label: '門市資訊', to: '/wineswee/stores' },
    { label: '加入會員', to: '@line' },
    { label: '訂單查詢', to: '@line' },
    { label: '加盟專區', to: '@email' },
  ],
  hero: {
    kicker: 'Wine · Whisky · Gourmet',
    title1: '為每一次相聚，', title2: '斟一杯剛剛好的*講究*。',
    sub: '嚴選世界餐酒與佐餐美食——從波爾多列級到里奧哈、伊比利火腿到歐陸乳酪，一站備齊你的餐桌。',
    cta1: '開始選酒', cta2: '探索選品',
  },
  manifesto: [
    { n: '01', title: '全球嚴選', sub: '法國・西班牙・義大利・南非・紐西蘭' },
    { n: '02', title: '酒食一次備齊', sub: '火腿・乳酪・肉品・海鮮' },
    { n: '03', title: '宅配到府', sub: '線上下單・全台配送' },
    { n: '04', title: '十一家門市', sub: '現場試味・專人選酒' },
  ],
  home: {
    shopKicker: 'Shop by Category', shopTitle: '選購專區',
    rowTitle: '本季紅酒精選', rowEn: 'Red Wine',
    spotKicker: 'Curated Nº 01', spotTitle: '本季精選，值得為它*開一瓶*',
    spotDesc: '從波爾多列級酒莊到單一麥芽威士忌、荷蘭陳年高達乳酪——這幾支是我們最想與你分享的味道。', spotCta: '看全部選品',
    storyKicker: 'The House of Wineswee', storyTitle: '把餐桌上的美好，*一次備齊*',
    storyBody: '從法國波爾多、西班牙里奧哈到南非與紐西蘭，我們嚴選世界各地的紅白葡萄酒、威士忌與清酒，再備上伊比利火腿與歐陸乳酪——佐酒的一切，都在同一個超市。',
    statPrice: 'NT$79', statPriceLabel: '入手價起', storyLink: '認識威士威',
    ctaTitle: '加入 LINE，*讓我們為你選酒*', ctaDesc: '新品到貨、限時優惠與選酒建議，第一手都在 LINE。', ctaBtn: '加入 LINE 官方帳號',
  },
  about: {
    kicker: 'About Wineswee', title: '把餐桌上的美好，一次備齊',
    lead: '威士威酒食超市——不只是賣酒，而是幫你把每一次相聚、每一頓講究的餐桌，準備到剛剛好。',
    storyTitle: '從一杯酒，到*一整桌的講究*',
    storyBody: '我們相信，好的相聚值得一支對味的酒，也值得佐它的那塊乳酪、那片火腿。於是威士威把世界各地的紅白葡萄酒、威士忌與清酒，連同歐陸的乳酪火腿、新鮮的肉品海鮮，都收進同一個超市——讓你不必東奔西跑，一站就能備齊整桌的美好。',
    values: [
      ['01', '全球直選', '法國波爾多、西班牙里奧哈、義大利、南非到紐西蘭——世界各地的餐酒，我們一站為你備齊。'],
      ['02', '酒食一次到位', '伊比利火腿、荷蘭高達乳酪、新鮮肉品與海鮮——佐酒的一切，都在同一個超市。'],
      ['03', '專人選酒', '11 家門市現場試味、專人推薦；不知道配什麼，交給我們就對了。'],
      ['04', '送禮體面', '酒器水晶杯與禮盒組，逢年過節、宴客送禮，都拿得出手。'],
    ],
    filmTitle: '看見威士威的酒食日常', filmBody: '一支酒、一塊乳酪、一段相聚——這就是我們想帶給你的生活風景。', filmCta: '開始選酒',
    ctaTitle: '來門市，*讓我們為你選一支酒*', ctaBody: '全台 11 家門市，或線上宅配到府。', ctaBtn: '查看門市',
  },
  newsCta: { title: '不錯過任何一檔活動', desc: '加入 LINE，新品與優惠第一時間通知你。', btn: '加入 LINE 官方帳號' },
  // 情境選酒(整合 City9 情境磚概念,Wineswee 版)
  occasions: {
    kicker: 'By Occasion', title: '今晚，為哪個場合*斟一杯*',
    lead: '不用懂酒，先想場合——我們幫你把對味的那一支挑出來。',
    items: [
      { title: '宴客佐餐', en: 'With the Meal', desc: '波爾多紅酒配伊比利火腿與歐陸乳酪，備齊整桌的講究。', to: '/wineswee/category/red', image: '' },
      { title: '三五小酌', en: 'For Gatherings', desc: '氣泡與清爽白酒，為每一次相聚添一分雀躍。', to: '/wineswee/category/sparkling', image: '' },
      { title: '一人獨酌', en: 'A Quiet Night', desc: '單一麥芽威士忌與純米清酒，靜靜品味的一杯。', to: '/wineswee/category/whisky', image: '' },
      { title: '送禮體面', en: 'For Gifting', desc: '酒器水晶杯與禮盒組，逢年過節、宴客致贈都拿得出手。', to: '/wineswee/category/ware', image: '' },
    ],
  },
  // 專人選酒服務(整合 Plus9 侍酒師服務 + 會員鉤子,Wineswee 版)
  concierge: {
    kicker: 'Personal Sommelier', title: '不知道挑什麼？*交給我們*',
    desc: '11 家門市現場試味、專人推薦；或加 LINE，由選酒顧問依你的餐桌、預算與場合，配一支剛剛好的酒。',
    perk: '新朋友加入 LINE，即享一對一選酒建議與新品搶先報。',
    btn: '加 LINE 專人選酒',
  },
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v) }
function deepMerge(def, over) {
  if (!isObj(def)) return over === undefined ? def : over
  const out = Array.isArray(def) ? [...def] : { ...def }
  for (const k of Object.keys(over || {})) {
    if (Array.isArray(over[k])) out[k] = over[k]
    else if (isObj(over[k]) && isObj(def[k])) out[k] = deepMerge(def[k], over[k])
    else if (over[k] !== undefined && over[k] !== '') out[k] = over[k]
  }
  return out
}

// 合併預設 + 覆寫(後台預覽用)
export function mergeSite(over) { return deepMerge(SITE_DEFAULTS, over || {}) }
// 合併後的整站文案(store.site 覆寫預設)
export function getSite() { return mergeSite(store.site) }
// 相容:多數元件仍引用 SITE(logo/social 靜態預設);社群改用 getSite().contact
export const SITE = { logo: SITE_DEFAULTS.logo, ...SITE_DEFAULTS.contact }

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
export const classifyName = classify

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
    // 置頂(top)優先 → 有圖 → 未售完
    .sort((a, b) => (b.top ? 1 : 0) - (a.top ? 1 : 0) || (b.image ? 1 : 0) - (a.image ? 1 : 0) || (a.sold_out ? 1 : 0) - (b.sold_out ? 1 : 0))
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
