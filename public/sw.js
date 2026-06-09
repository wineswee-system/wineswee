/**
 * Service Worker — Offline-first + Asset Caching
 *
 * Strategies:
 * - Static assets (JS/CSS/images): Cache-first with long TTL
 * - API calls (Supabase): Network-first with offline fallback
 * - POS transactions: Queue when offline, sync when back online
 * - HTML: Network-first (SPA — always serve index.html)
 */

// ★ 每次 build chunk 換 hash 時 bump 這個版本號，會自動清掉舊快取
//    避免「舊 index.html 引用的舊 chunk 找不到」造成 App crash
const CACHE_VERSION = 'sme-ops-v4'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const API_CACHE = `${CACHE_VERSION}-api`
const OFFLINE_QUEUE = 'sme-ops-offline-queue'

// 不再 precache index.html — 每次都要 network-first
// 否則離線安裝後，新 build 的 index.html 永遠拿不到，引用的 chunk 也找不到
const PRECACHE_URLS = []

// ── Install ──
self.addEventListener('install', () => {
  // 跳過等待，新 SW 立即接手（避免「下次開分頁才生效」）
  self.skipWaiting()
})

// ── Activate: clean ALL old caches + claim clients ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        // 清掉非當前版本的所有 cache（含舊版的 chunks）
        keys
          .filter(key => key.startsWith('sme-ops-') && key !== STATIC_CACHE && key !== API_CACHE && key !== OFFLINE_QUEUE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

// ── Fetch: routing strategies ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // LIFF pages need fresh code every load (build-time env vars).
  // Bypass SW entirely for the HTML route and its referenced chunks.
  if (url.pathname.startsWith('/liff/')) {
    return
  }

  // Skip non-GET requests for caching (POST/PUT/DELETE go to network)
  if (event.request.method !== 'GET') {
    // Queue offline mutations for POS
    if (!navigator.onLine && url.pathname.includes('supabase')) {
      event.respondWith(queueOfflineMutation(event.request))
      return
    }
    return
  }

  // Static assets: cache-first（hash-named chunks 永久不變所以 cache 安全）
  // 但加上 stale-build 偵測：JS 請求若拿到 HTML（404 fallback），通知 client 強制重整
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstWithStaleCheck(event.request, STATIC_CACHE))
    return
  }

  // Supabase API: network-first with cache fallback
  if (url.hostname.includes('supabase')) {
    event.respondWith(networkFirst(event.request, API_CACHE))
    return
  }

  // HTML/SPA routes: network-first, fallback to cached index.html
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHTML(event.request))
    return
  }

  // Default: network with cache fallback
  event.respondWith(networkFirst(event.request, STATIC_CACHE))
})

// ── Online: flush offline queue ──
self.addEventListener('message', (event) => {
  if (event.data?.type === 'FLUSH_OFFLINE_QUEUE') {
    flushOfflineQueue()
  }
})

// ── Strategies ──

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

// ★ 加強版：JS/CSS 請求若拿到 HTML（Vercel SPA fallback 對 404 的回應），
//    代表這個 chunk hash 已不存在於新 build → 通知 client 強制 reload 拿新 index.html
async function cacheFirstWithStaleCheck(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    const url = new URL(request.url)
    const isCodeRequest = /\.(js|mjs|css)$/.test(url.pathname)
    const contentType = response.headers.get('content-type') || ''

    // ★ 偵測 stale build：JS/CSS 拿到 HTML 表示舊 chunk 已不存在
    if (isCodeRequest && contentType.includes('text/html')) {
      const clients = await self.clients.matchAll({ includeUncontrolled: true })
      clients.forEach(c => c.postMessage({
        type: 'STALE_BUILD_DETECTED',
        url: request.url,
      }))
      // 不快取錯誤回應，回 404 讓 browser 自然走錯誤路徑
      return new Response('Stale chunk, please reload', { status: 404 })
    }

    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached || new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

async function networkFirstHTML(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE)
      cache.put('/', response.clone())
    }
    return response
  } catch {
    return caches.match('/index.html') || new Response('Offline', { status: 503 })
  }
}

// ── Offline Queue (for POS mutations) ──

async function queueOfflineMutation(request) {
  const body = await request.clone().text()
  const queueItem = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body,
    timestamp: Date.now(),
  }

  // Store in IndexedDB via simple key-value
  const queue = await getOfflineQueue()
  queue.push(queueItem)
  await saveOfflineQueue(queue)

  return new Response(JSON.stringify({
    queued: true,
    message: '離線模式 — 交易已暫存，上線後自動同步',
  }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function flushOfflineQueue() {
  const queue = await getOfflineQueue()
  if (queue.length === 0) return

  const failed = []
  for (const item of queue) {
    try {
      await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      })
    } catch {
      failed.push(item)
    }
  }

  await saveOfflineQueue(failed)

  // Notify clients
  const clients = await self.clients.matchAll()
  for (const client of clients) {
    client.postMessage({
      type: 'OFFLINE_QUEUE_FLUSHED',
      synced: queue.length - failed.length,
      failed: failed.length,
    })
  }
}

// Simple queue storage using Cache API (no IndexedDB dependency)
async function getOfflineQueue() {
  try {
    const cache = await caches.open(OFFLINE_QUEUE)
    const response = await cache.match('queue')
    if (response) return response.json()
  } catch { /* empty */ }
  return []
}

async function saveOfflineQueue(queue) {
  const cache = await caches.open(OFFLINE_QUEUE)
  await cache.put('queue', new Response(JSON.stringify(queue)))
}

// ── Helpers ──

function isStaticAsset(url) {
  return /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico)$/.test(url.pathname)
    || url.pathname.startsWith('/assets/')
}
