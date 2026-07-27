// Wineswee 官網資料層（商品分類/新聞/門市）— 移植自 wineswee-site
import RAW from '../../data/wineswee-products.json'
import NEWS from '../../data/news.json'
import STORES from '../../data/stores.json'

export const SITE = {
  shop: 'https://www.wineswee.com/',
  logo: 'https://www.wineswee.com/resources/_img/layout/logo.svg',
  line: 'https://page.line.me/?accountId=wineswee01',
  fb: 'https://www.facebook.com/wineswee90370708/',
  ig: 'https://www.instagram.com/wineswee/',
  ytEmbed: 'https://www.youtube.com/embed/ZZccVDRoR2M?rel=0&loop=1&playlist=ZZccVDRoR2M&showinfo=0&controls=1',
  email: 'cs@wineswee.com',
}
export const BANNERS = [
  'https://www.wineswee.com/storage/upload/banner/image/2026-05-22/PnahdFdR82dbWjODiQmGdfEVeUbNe0xrGkYUlSZ4.jpg',
  'https://www.wineswee.com/storage/upload/banner/image/2026-05-08/JB0jvHwOiD3VqgHu37dhNflzkjEjcwqgx8MBGsa9.jpg',
  'https://www.wineswee.com/storage/upload/banner/image/2026-04-16/cmx82g7NBRrsOxFo0WZjFHd069ku19MWl48Ubu5A.jpg',
  'https://www.wineswee.com/storage/upload/banner/image/2025-01-17/76YcWU0PLnHZUp8FsZlMaXN7sEbMqHXojnA0md8C.jpg',
]
export { NEWS, STORES }

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
  { key: 'ware', label: '酒器・禮盒', en: 'Wares & Gifts', test: n => /酒器|酒杯|水晶杯|杯具|禮盒|開瓶|醒酒/.test(n) },
]
export const WINE_KEYS = ['red', 'white', 'sparkling', 'rose', 'whisky', 'sake', 'spirit']
export const FOOD_KEYS = ['cheese', 'ham', 'ware']
export const CAT_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]))
export const CAT_EN = Object.fromEntries(CATEGORIES.map(c => [c.key, c.en]))

function classify(name) { for (const c of CATEGORIES) if (c.test(name)) return c.key; return 'other' }

export const ALL = RAW
  .filter(p => p.name)
  .map(p => ({ ...p, cat: classify(p.name) }))
  .sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || (a.sold_out ? 1 : 0) - (b.sold_out ? 1 : 0))
  .map((p, i) => ({ ...p, id: i }))

export function byCategory() {
  const m = {}
  for (const p of ALL) (m[p.cat] ||= []).push(p)
  return m
}
export const getProduct = (id) => ALL[id]?.id === id ? ALL[id] : ALL.find(p => p.id === id)
export const related = (p, n = 12) => ALL.filter(x => x.cat === p.cat && x.id !== p.id).slice(0, n)
