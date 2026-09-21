/**
 * AI Cache — test suite
 *
 * Covers: getCached, setCache, invalidate, clearAll, TTL presets
 */
import { getCached, setCache, invalidate, clearAll, TTL } from '../ai/aiCache'

beforeEach(() => {
  clearAll()
})

describe('AI-CACHE-01: Basic Cache Operations', () => {
  test('setCache + getCached returns value', () => {
    setCache('key1', { score: 80 }, 60000)
    expect(getCached('key1')).toEqual({ score: 80 })
  })

  test('getCached returns null for missing key', () => {
    expect(getCached('nonexistent')).toBeNull()
  })

  test('expired entries return null', () => {
    setCache('exp', 'val', 1) // 1ms TTL
    // Force expiration
    vi.useFakeTimers()
    vi.advanceTimersByTime(10)
    expect(getCached('exp')).toBeNull()
    vi.useRealTimers()
  })

  test('clearAll empties the cache', () => {
    setCache('a', 1)
    setCache('b', 2)
    clearAll()
    expect(getCached('a')).toBeNull()
    expect(getCached('b')).toBeNull()
  })
})

describe('AI-CACHE-02: Invalidation by Prefix', () => {
  test('invalidate removes matching keys', () => {
    setCache('lead_score:c1', 80)
    setCache('lead_score:c2', 90)
    setCache('campaign:x', 'hello')
    invalidate('lead_score:')
    expect(getCached('lead_score:c1')).toBeNull()
    expect(getCached('lead_score:c2')).toBeNull()
    expect(getCached('campaign:x')).toBe('hello')
  })

  test('invalidate with non-matching prefix does nothing', () => {
    setCache('abc', 123)
    invalidate('xyz')
    expect(getCached('abc')).toBe(123)
  })
})

describe('AI-CACHE-03: TTL Presets', () => {
  test('LEAD_SCORE TTL is 24 hours', () => {
    expect(TTL.LEAD_SCORE).toBe(24 * 60 * 60 * 1000)
  })

  test('CAMPAIGN_COPY TTL is 0 (no cache)', () => {
    expect(TTL.CAMPAIGN_COPY).toBe(0)
  })

  test('SEGMENT_NL TTL is 5 minutes', () => {
    expect(TTL.SEGMENT_NL).toBe(5 * 60 * 1000)
  })
})
