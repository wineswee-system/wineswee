// ── 桌台 QR 解析 ─────────────────────────────────────────────
// 桌卡 QR 內容為客人點餐連結：
//   https://<host>/menu/{storeId}/{tableId}?token=xxx
// 店員在 POS 掃描同一張桌卡時，解析出桌台資訊以跳轉結帳。
// 接受完整 URL 或純路徑，非桌台 QR 回傳 null。
export function parseTableQR(text) {
  if (!text) return null
  const raw = String(text).trim()

  let path, query
  try {
    const url = new URL(raw)
    path = url.pathname
    query = url.searchParams
  } catch {
    // 非完整 URL — 嘗試當作路徑處理
    if (!raw.startsWith('/menu/')) return null
    const [p, q = ''] = raw.split('?')
    path = p
    query = new URLSearchParams(q)
  }

  const m = path.match(/^\/menu\/([^/]+)\/([^/]+)\/?$/)
  if (!m) return null

  return { storeId: m[1], tableId: m[2], token: query.get('token') }
}
