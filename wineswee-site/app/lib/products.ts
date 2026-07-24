import raw from '../data/products.json'

export type Product = {
  name: string
  price: number | null
  image: string | null
  sold_out: boolean
  category?: string
  cat: CategoryKey
}

export type CategoryKey =
  | 'red' | 'white' | 'sparkling' | 'rose' | 'whisky'
  | 'sake' | 'spirit' | 'cheese' | 'ham' | 'ware' | 'other'

export type CategoryDef = { key: CategoryKey; label: string; en: string; test: (n: string) => boolean }

export const CATEGORIES: CategoryDef[] = [
  { key: 'red',       label: '紅酒',      en: 'Red Wine',     test: n => /紅葡萄酒|紅酒/.test(n) },
  { key: 'white',     label: '白酒',      en: 'White Wine',   test: n => /白葡萄酒|白酒/.test(n) },
  { key: 'sparkling', label: '氣泡・香檳', en: 'Sparkling',    test: n => /氣泡|香檳/.test(n) },
  { key: 'rose',      label: '粉紅酒',    en: 'Rosé',         test: n => /粉紅|玫瑰(?!堡)|ros[ée]/i.test(n) },
  { key: 'whisky',    label: '威士忌',    en: 'Whisky',       test: n => /威士忌|whisky|whiskey/i.test(n) },
  { key: 'sake',      label: '清酒',      en: 'Sake',         test: n => /吟釀|吟醸|純米|冷酒|原酒|清酒|日本酒/.test(n) },
  { key: 'spirit',    label: '烈酒',      en: 'Spirits',      test: n => /龍舌蘭|白蘭地|蘭姆|grappa|琴酒|伏特加|威迪|利口|橘子酒|梅酒|水果酒|芒果酒/i.test(n) },
  { key: 'cheese',    label: '乳酪',      en: 'Cheese',       test: n => /乳酪|起司|高達|cheese/i.test(n) },
  { key: 'ham',       label: '肉品・火腿', en: 'Charcuterie',  test: n => /火腿|伊比利|黑豬|臘腸|香腸/.test(n) },
  { key: 'ware',      label: '酒器・禮盒', en: 'Wares & Gifts', test: n => /酒器|酒杯|水晶杯|杯具|禮盒|開瓶|醒酒/.test(n) },
]

function classify(name: string): CategoryKey {
  for (const c of CATEGORIES) if (c.test(name)) return c.key
  return 'other'
}

type RawProduct = { name: string; price: number | null; image: string | null; sold_out: boolean; category?: string }

// 排序:有圖優先、未售完優先
function rank(a: Product, b: Product) {
  return (b.image ? 1 : 0) - (a.image ? 1 : 0) || (a.sold_out ? 1 : 0) - (b.sold_out ? 1 : 0)
}

export const ALL: Product[] = (raw as RawProduct[])
  .filter(p => p.name)
  .map(p => ({ ...p, cat: classify(p.name) }))
  .sort(rank)

export function byCategory(): Record<CategoryKey, Product[]> {
  const m = {} as Record<CategoryKey, Product[]>
  for (const p of ALL) (m[p.cat] ||= []).push(p)
  return m
}

export const CATEGORY_LABEL: Record<string, string> =
  Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]))
