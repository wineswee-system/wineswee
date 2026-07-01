const CACHE_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

const KEYS = {
  products: (storeId) => `pos_cache_products_${storeId}`,
  menuItems: (storeId) => `pos_cache_menu_items_${storeId}`,
  txQueue: 'pos_tx_queue',
  txFailed: 'pos_tx_failed',
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
    // 冪等鍵：補送/重試都帶同一個 client_tx_id，後端據此去重（不可重新產生）
    client_tx_id: txnData.client_tx_id ?? crypto.randomUUID(),
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

// ─── Dead-letter list（同步時被後端業務規則拒絕的交易）──────────────────────────

export function getFailedTransactions() {
  try {
    const raw = localStorage.getItem(KEYS.txFailed)
    if (!raw) return []
    return JSON.parse(raw) ?? []
  } catch (_) {
    return []
  }
}

/** 從待同步佇列移到失敗清單（保留完整交易內容與錯誤訊息，不可默默丟棄） */
export function addFailedTransaction(entry, errorMessage) {
  const failed = getFailedTransactions()
  failed.push({ ...entry, failedAt: new Date().toISOString(), error: errorMessage ?? '未知錯誤' })
  try {
    localStorage.setItem(KEYS.txFailed, JSON.stringify(failed))
  } catch (_) {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}

/** 手動重試：把失敗清單全部搬回待同步佇列（維持原順序，冪等鍵不變） */
export function requeueFailedTransactions() {
  const failed = getFailedTransactions()
  if (failed.length === 0) return 0
  const pending = getPendingTransactions()
  for (const { failedAt: _f, error: _e, ...entry } of failed) {
    pending.push(entry)
  }
  try {
    localStorage.setItem(KEYS.txQueue, JSON.stringify(pending))
    localStorage.setItem(KEYS.txFailed, JSON.stringify([]))
  } catch (_) {
    // localStorage quota exceeded or unavailable — silently ignore
  }
  return failed.length
}

// ─── Network status ───────────────────────────────────────────────────────────

export function isOnline() {
  return navigator.onLine
}
