/**
 * POS Offline Queue — IndexedDB-backed queue for offline POS transactions.
 * When the network is unavailable, transactions are stored locally and
 * synced automatically when connectivity is restored.
 */

const DB_NAME = 'sme_ops_offline'
const DB_VERSION = 1
const STORE_NAME = 'pending_transactions'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Queue a POS transaction for later sync */
export async function queueTransaction(transaction) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const record = {
      ...transaction,
      queued_at: new Date().toISOString(),
      synced: false,
    }
    const req = store.add(record)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Get all pending (unsynced) transactions */
export async function getPendingTransactions() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => resolve((req.result || []).filter(r => !r.synced))
    req.onerror = () => reject(req.error)
  })
}

/** Mark a transaction as synced */
export async function markSynced(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const record = getReq.result
      if (record) {
        record.synced = true
        record.synced_at = new Date().toISOString()
        const putReq = store.put(record)
        putReq.onsuccess = () => resolve()
        putReq.onerror = () => reject(putReq.error)
      } else {
        resolve()
      }
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

/** Clear all synced transactions from IndexedDB */
export async function clearSyncedTransactions() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => {
      const synced = (req.result || []).filter(r => r.synced)
      for (const record of synced) {
        store.delete(record.id)
      }
      resolve(synced.length)
    }
    req.onerror = () => reject(req.error)
  })
}

/** Get the count of pending transactions */
export async function getPendingCount() {
  const pending = await getPendingTransactions()
  return pending.length
}

/** Check if the browser is online */
export function isOnline() {
  return navigator.onLine
}

/**
 * Sync all pending transactions to Supabase.
 * Call this when connectivity is restored.
 * @param {Function} createFn — async function to create a POS transaction in Supabase
 * @returns {Promise<{synced: number, failed: number}>}
 */
export async function syncPendingTransactions(createFn) {
  const pending = await getPendingTransactions()
  let synced = 0
  let failed = 0

  for (const tx of pending) {
    try {
      const { queued_at, synced: _, synced_at, id, ...payload } = tx
      const { error } = await createFn(payload)
      if (!error) {
        await markSynced(id)
        synced++
      } else {
        failed++
      }
    } catch {
      failed++
    }
  }

  // Clean up synced records
  if (synced > 0) {
    await clearSyncedTransactions()
  }

  return { synced, failed }
}

// Auto-sync when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    // Dispatch custom event that POS components can listen to
    window.dispatchEvent(new CustomEvent('pos-online-restore'))
  })
}
