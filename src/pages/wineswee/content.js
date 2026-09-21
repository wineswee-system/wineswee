// Wineswee 內容來源:優先讀 Supabase(後臺可改),讀不到就用打包的靜態 JSON 墊底。
// 效能:大檔改「動態 import」,不進首屏 render-blocking chunk——
//   · details(~434KB)只在 DB 沒有 details 時才當墊底載入(正常情況根本不下載)
//   · news 內文(~251KB)延後到「消息內頁」才載(首頁/列表只需 DB 的標題/封面)
import { supabase } from '../../lib/supabase'
import RAW from '../../data/wineswee-products.json'
import STORES_JSON from '../../data/stores.json'

export const STATIC = { products: RAW, details: {}, news: [], stores: STORES_JSON, site: {} }
export const store = { products: RAW, details: {}, news: [], stores: STORES_JSON, site: {} }

// 動態載入大檔墊底(各自只載一次)
let newsP = null, detailsP = null
export function ensureNews() {
  if (!newsP) newsP = import('../../data/news-details.json').then(m => { STATIC.news = m.default; return m.default })
  return newsP
}
export function ensureDetails() {
  if (!detailsP) detailsP = import('../../data/wineswee-details.json').then(m => { STATIC.details = m.default; return m.default })
  return detailsP
}

let loaded = false
const subs = new Set()
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn) }
function emit() { subs.forEach(f => { try { f() } catch { /* noop */ } }) }

// DB 缺「圖文內文」的子文章,用內建範本(NEWS_JSON)補上——不覆蓋已編輯 html 與菜單畫布。
export function backfillNews(dbNews, NEWS_JSON) {
  const byId = new Map((NEWS_JSON || []).map(c => [String(c.id), c]))
  return dbNews.map(cat => {
    const sc = byId.get(String(cat.id))
    if (!sc || !Array.isArray(cat.subs)) return cat
    return { ...cat, subs: cat.subs.map(sub => {
      if (sub.html != null || sub.board) return sub                 // 已有內文/畫布 → 不動
      const ss = (sc.subs || []).find(x => x.title === sub.title)
      return (ss && ss.html != null) ? { ...sub, html: ss.html } : sub
    }) }
  })
}

// 消息內頁專用:載入內文範本並補齊 store.news 的 html(首頁/列表不需呼叫)
export async function ensureNewsBodies() {
  const NEWS_JSON = await ensureNews()
  if (Array.isArray(store.news) && store.news.length) { store.news = backfillNews(store.news, NEWS_JSON); emit() }
}

export async function loadContent(force = false) {
  if (loaded && !force) return
  loaded = true
  try {
    const { data, error } = await supabase.rpc('get_wineswee_content')
    if (error || !data) { await fallbackBig(); return }
    if (Array.isArray(data.products) && data.products.length) store.products = data.products
    if (data.site && typeof data.site === 'object') store.site = data.site
    if (Array.isArray(data.stores) && data.stores.length) store.stores = data.stores
    if (data.details && typeof data.details === 'object' && Object.keys(data.details).length) store.details = data.details
    else store.details = await ensureDetails()                       // DB 沒 details 才載墊底
    if (Array.isArray(data.news) && data.news.length) store.news = data.news   // 先用 DB 原始(標題/封面),內文延後補
    else store.news = await ensureNews()
    emit()
  } catch { await fallbackBig() }
}
async function fallbackBig() {
  const [d, n] = await Promise.all([ensureDetails(), ensureNews()])
  store.details = d; store.news = n; emit()
}

// 後臺存檔後即時套用(免重整)
export function applyLocal(section, value) { store[section] = value; emit() }
