// Wineswee 內容來源:優先讀 Supabase(後臺可改),讀不到就用打包的靜態 JSON 墊底。
// data.js 全部改讀這裡的 store;後臺存檔後 applyLocal() 讓公開站即時反映。
import { supabase } from '../../lib/supabase'
import RAW from '../../data/wineswee-products.json'
import DETAILS_JSON from '../../data/wineswee-details.json'
import NEWS_JSON from '../../data/news-details.json'
import STORES_JSON from '../../data/stores.json'

export const STATIC = { products: RAW, details: DETAILS_JSON, news: NEWS_JSON, stores: STORES_JSON, site: {} }
export const store = { products: RAW, details: DETAILS_JSON, news: NEWS_JSON, stores: STORES_JSON, site: {} }

let loaded = false
const subs = new Set()
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn) }
function emit() { subs.forEach(f => { try { f() } catch { /* noop */ } }) }

export async function loadContent(force = false) {
  if (loaded && !force) return
  loaded = true
  try {
    const { data, error } = await supabase.rpc('get_wineswee_content')
    if (error || !data) return
    if (Array.isArray(data.products) && data.products.length) store.products = data.products
    if (data.details && typeof data.details === 'object' && Object.keys(data.details).length) store.details = data.details
    if (Array.isArray(data.news) && data.news.length) store.news = data.news
    if (Array.isArray(data.stores) && data.stores.length) store.stores = data.stores
    if (data.site && typeof data.site === 'object') store.site = data.site
    emit()
  } catch { /* 靜態墊底 */ }
}

// 後臺存檔後即時套用(免重整)
export function applyLocal(section, value) { store[section] = value; emit() }
