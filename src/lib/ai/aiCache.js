/**
 * Simple in-memory AI response cache with TTL
 */

const cache = new Map()

export const TTL = {
  SHORT: 5 * 60 * 1000,      // 5 min
  MEDIUM: 30 * 60 * 1000,    // 30 min
  LONG: 60 * 60 * 1000,      // 1 hour
}

export function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    cache.delete(key)
    return null
  }
  return entry.value
}

export function setCache(key, value, ttl = TTL.MEDIUM) {
  cache.set(key, { value, expires: Date.now() + ttl })
}
