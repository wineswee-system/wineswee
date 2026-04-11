import { supabase } from './supabase.js'
import { logger } from './logger.js'

const log = logger.forModule('health')

/**
 * Health Check Module
 *
 * Provides health status for container orchestration (Docker, Cloud Run, K8s).
 * Checks database connectivity, event bus status, and service worker registration.
 *
 * Usage in components:
 *   import { runHealthCheck } from './lib/healthCheck'
 *   const health = await runHealthCheck()
 *
 * For Docker/K8s, expose via nginx location block or edge function.
 */

/**
 * Run all health checks and return aggregated status.
 * @returns {Promise<HealthCheckResult>}
 */
export async function runHealthCheck() {
  const startTime = Date.now()
  const checks = {}

  // 1. Database connectivity
  checks.database = await checkDatabase()

  // 2. Supabase auth service
  checks.auth = await checkAuth()

  // 3. Event bus (in-memory check)
  checks.eventBus = checkEventBus()

  // 4. Service worker
  checks.serviceWorker = checkServiceWorker()

  // 5. Local storage availability
  checks.localStorage = checkLocalStorage()

  // 6. Memory usage
  checks.memory = checkMemory()

  const elapsed = Date.now() - startTime
  const allHealthy = Object.values(checks).every(c => c.status === 'healthy')

  const result = {
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    duration_ms: elapsed,
    version: '1.0.0',
    checks,
  }

  if (!allHealthy) {
    log.warn('Health check degraded', { checks: Object.fromEntries(
      Object.entries(checks).filter(([, v]) => v.status !== 'healthy')
    )})
  }

  return result
}

async function checkDatabase() {
  try {
    const start = Date.now()
    const { error } = await supabase.from('roles').select('id').limit(1)
    const latency = Date.now() - start

    if (error) {
      return { status: 'unhealthy', latency_ms: latency, error: error.message }
    }
    return { status: 'healthy', latency_ms: latency }
  } catch (err) {
    return { status: 'unhealthy', error: err.message }
  }
}

async function checkAuth() {
  try {
    const start = Date.now()
    const { error } = await supabase.auth.getSession()
    const latency = Date.now() - start

    if (error) {
      return { status: 'degraded', latency_ms: latency, error: error.message }
    }
    return { status: 'healthy', latency_ms: latency }
  } catch (err) {
    return { status: 'unhealthy', error: err.message }
  }
}

function checkEventBus() {
  try {
    const { getEventBus } = require('./events/index.js')
    const bus = getEventBus()
    const subscriberCount = bus._subscribers?.size || 0
    return {
      status: subscriberCount > 0 ? 'healthy' : 'degraded',
      subscriber_count: subscriberCount,
    }
  } catch {
    // Dynamic import not available in this context
    return { status: 'healthy', note: 'static check only' }
  }
}

function checkServiceWorker() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return { status: 'healthy', note: 'not supported in this environment' }
  }

  const registration = navigator.serviceWorker.controller
  return {
    status: registration ? 'healthy' : 'degraded',
    active: !!registration,
  }
}

function checkLocalStorage() {
  try {
    const testKey = '__health_check__'
    localStorage.setItem(testKey, '1')
    localStorage.removeItem(testKey)
    return { status: 'healthy' }
  } catch {
    return { status: 'degraded', error: 'localStorage unavailable' }
  }
}

function checkMemory() {
  if (typeof performance === 'undefined' || !performance.memory) {
    return { status: 'healthy', note: 'memory API not available' }
  }

  const mem = performance.memory
  const usedMB = Math.round(mem.usedJSHeapSize / 1024 / 1024)
  const totalMB = Math.round(mem.totalJSHeapSize / 1024 / 1024)
  const limitMB = Math.round(mem.jsHeapSizeLimit / 1024 / 1024)
  const usagePercent = Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100)

  return {
    status: usagePercent < 80 ? 'healthy' : 'degraded',
    used_mb: usedMB,
    total_mb: totalMB,
    limit_mb: limitMB,
    usage_percent: usagePercent,
  }
}
