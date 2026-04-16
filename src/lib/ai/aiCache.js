/**
 * AI Cache Layer
 *
 * Simple in-memory cache with TTL to reduce redundant Gemini API calls.
 * Lead scores cache for 24h, campaign copy for 1h, etc.
 */

const cache = new Map()

export const TTL = {
  SHORT: 5 * 60 * 1000,             // 5 min
  MEDIUM: 30 * 60 * 1000,           // 30 min
  LONG: 60 * 60 * 1000,             // 1 hour
  LEAD_SCORE: 24 * 60 * 60 * 1000,  // 24 hours
  CAMPAIGN_COPY: 0,                  // no cache (always fresh)
  SMART_REPLY: 0,                    // no cache
  SEGMENT_NL: 5 * 60 * 1000,        // 5 minutes
}

export function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.value
}

export function setCache(key, value, ttlMs = TTL.MEDIUM) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export function invalidate(keyPrefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(keyPrefix)) cache.delete(key)
  }
}

export function clearAll() {
  cache.clear()
}
