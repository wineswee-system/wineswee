const CACHE_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

const KEYS = {
  products: (storeId) => `pos_cache_products_${storeId}`,
  menuItems: (storeId) => `pos_cache_menu_items_${storeId}`,
  txQueue: 'pos_tx_queue',
}

// ─── Products ────────────────────────────────────────────────────────────────

export function cacheProducts(storeId, products) {
  const entry = {
    data: products,
    cachedAt: new Date().toISOString(),
    storeId,
  }
  try {
    localStorage.setItem(KEYS.products(storeId), JSON.stringify(entry))
  } catch (_) {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}

export function getCachedProducts(storeId) {
  try {
    const raw = localStorage.getItem(KEYS.products(storeId))
    if (!raw) return []
    const entry = JSON.parse(raw)
    if (Date.now() - new Date(entry.cachedAt).getTime() > CACHE_TTL_MS) return []
    return entry.data ?? []
  } catch (_) {
    return []
  }
}

// ─── Menu Items ──────────────────────────────────────────────────────────────

export function cacheMenuItems(storeId, menuItems) {
  const entry = {
    data: menuItems,
    cachedAt: new Date().toISOString(),
    storeId,
  }
  try {
    localStorage.setItem(KEYS.menuItems(storeId), JSON.stringify(entry))
  } catch (_) {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}

export function getCachedMenuItems(storeId) {
  try {
    const raw = localStorage.getItem(KEYS.menuItems(storeId))
    if (!raw) return []
    const entry = JSON.parse(raw)
    if (Date.now() - new Date(entry.cachedAt).getTime() > CACHE_TTL_MS) return []
    return entry.data ?? []
  } catch (_) {
    return []
  }
}

// ─── Transaction Queue (offline sync) ────────────────────────────────────────

export function queueTransaction(txnData) {
  const pending = getPendingTransactions()
  const entry = {
    localId: crypto.randomUUID(),
    ...txnData,
    queuedAt: new Date().toISOString(),
  }
  pending.push(entry)
  try {
    localStorage.setItem(KEYS.txQueue, JSON.stringify(pending))
  } catch (_) {
    // localStorage quota exceeded or unavailable — silently ignore
  }
  return entry.localId
}

export function getPendingTransactions() {
  try {
    const raw = localStorage.getItem(KEYS.txQueue)
    if (!raw) return []
    return JSON.parse(raw) ?? []
  } catch (_) {
    return []
  }
}

export function markTransactionSynced(localId) {
  const pending = getPendingTransactions()
  const updated = pending.filter((tx) => tx.localId !== localId)
  try {
    localStorage.setItem(KEYS.txQueue, JSON.stringify(updated))
  } catch (_) {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}

// ─── Network status ───────────────────────────────────────────────────────────

export function isOnline() {
  return navigator.onLine
}
