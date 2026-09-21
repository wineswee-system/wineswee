import { supabase } from './supabase.js'
import { logger } from './logger.js'

const log = logger.forModule('dlq.monitor')

/**
 * Dead Letter Queue Monitor & Error Budget Tracker
 *
 * Monitors DLQ growth rate, tracks error budgets, and provides
 * alerting hooks for operational visibility.
 *
 * Error Budget concept:
 * - Define an acceptable error rate (e.g., 1% of events can fail)
 * - Track actual failure rate over a rolling window
 * - Alert when error budget is being consumed too quickly
 *
 * Usage:
 *   import { dlqMonitor } from './dlqMonitor'
 *   dlqMonitor.start()
 *   dlqMonitor.onAlert((alert) => { sendSlackNotification(alert) })
 */

const DEFAULT_CONFIG = {
  pollIntervalMs: 60_000,         // Check every 60 seconds
  errorBudgetPercent: 1.0,        // 1% error budget
  rollingWindowMinutes: 60,       // 1-hour rolling window
  alertThresholdPercent: 50,      // Alert when 50% of budget consumed
  maxDLQSize: 100,                // Alert when DLQ exceeds this size
}

let _timer = null
const _alertCallbacks = []
const _metrics = {
  snapshots: [],
  lastCheck: null,
  currentBudget: null,
}

/**
 * Get current DLQ statistics.
 */
export async function getDLQStats() {
  const { data: stats, error } = await supabase
    .from('dead_letter_queue')
    .select('status, event_type, created_at')

  if (error) {
    log.error('Failed to query DLQ', { error })
    return null
  }

  const now = new Date()
  const oneHourAgo = new Date(now - DEFAULT_CONFIG.rollingWindowMinutes * 60_000)

  const all = stats || []
  const pending = all.filter(e => e.status === 'pending')
  const recent = all.filter(e => new Date(e.created_at) > oneHourAgo)

  // Group by event type
  const byType = {}
  for (const entry of pending) {
    byType[entry.event_type] = (byType[entry.event_type] || 0) + 1
  }

  return {
    total: all.length,
    pending: pending.length,
    recent_1h: recent.length,
    by_type: byType,
    oldest_pending: pending.length > 0
      ? pending.reduce((min, e) => e.created_at < min ? e.created_at : min, pending[0].created_at)
      : null,
    timestamp: now.toISOString(),
  }
}

/**
 * Calculate error budget consumption.
 */
export async function getErrorBudget() {
  const windowStart = new Date(Date.now() - DEFAULT_CONFIG.rollingWindowMinutes * 60_000)

  // Count total events in window
  const { count: totalEvents } = await supabase
    .from('business_events')
    .select('*', { count: 'exact', head: true })
    .gte('timestamp', windowStart.toISOString())

  // Count failed events in window
  const { count: failedEvents } = await supabase
    .from('dead_letter_queue')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', windowStart.toISOString())

  const total = totalEvents || 0
  const failed = failedEvents || 0
  const errorRate = total > 0 ? (failed / total) * 100 : 0
  const budgetConsumed = total > 0
    ? (errorRate / DEFAULT_CONFIG.errorBudgetPercent) * 100
    : 0

  return {
    window_minutes: DEFAULT_CONFIG.rollingWindowMinutes,
    total_events: total,
    failed_events: failed,
    error_rate_percent: parseFloat(errorRate.toFixed(4)),
    budget_percent: DEFAULT_CONFIG.errorBudgetPercent,
    budget_consumed_percent: parseFloat(Math.min(100, budgetConsumed).toFixed(2)),
    budget_remaining_percent: parseFloat(Math.max(0, 100 - budgetConsumed).toFixed(2)),
    status: budgetConsumed >= 100 ? 'exhausted'
      : budgetConsumed >= DEFAULT_CONFIG.alertThresholdPercent ? 'warning'
      : 'healthy',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Run a single monitoring check.
 */
async function checkHealth() {
  try {
    const [dlqStats, errorBudget] = await Promise.all([
      getDLQStats(),
      getErrorBudget(),
    ])

    if (!dlqStats || !errorBudget) return

    _metrics.lastCheck = new Date().toISOString()
    _metrics.currentBudget = errorBudget
    _metrics.snapshots.push({ dlq: dlqStats, budget: errorBudget })
    if (_metrics.snapshots.length > 60) _metrics.snapshots.shift() // Keep 1 hour of snapshots

    // Check alert conditions
    const alerts = []

    if (errorBudget.status === 'exhausted') {
      alerts.push({
        severity: 'critical',
        type: 'error_budget_exhausted',
        message: `Error budget exhausted: ${errorBudget.error_rate_percent}% error rate (budget: ${errorBudget.budget_percent}%)`,
        data: errorBudget,
      })
    } else if (errorBudget.status === 'warning') {
      alerts.push({
        severity: 'warning',
        type: 'error_budget_warning',
        message: `Error budget ${errorBudget.budget_consumed_percent}% consumed`,
        data: errorBudget,
      })
    }

    if (dlqStats.pending > DEFAULT_CONFIG.maxDLQSize) {
      alerts.push({
        severity: 'warning',
        type: 'dlq_size',
        message: `DLQ has ${dlqStats.pending} pending events (threshold: ${DEFAULT_CONFIG.maxDLQSize})`,
        data: dlqStats,
      })
    }

    // Fire alert callbacks
    for (const alert of alerts) {
      log.warn(alert.message, { alert_type: alert.type, severity: alert.severity })
      for (const cb of _alertCallbacks) {
        try { cb(alert) } catch { /* ignore */ }
      }
    }
  } catch (err) {
    log.error('DLQ monitor check failed', { error: err })
  }
}

export const dlqMonitor = {
  start(config = {}) {
    Object.assign(DEFAULT_CONFIG, config)
    if (_timer) return
    log.info('DLQ monitor started', { pollIntervalMs: DEFAULT_CONFIG.pollIntervalMs })
    _timer = setInterval(checkHealth, DEFAULT_CONFIG.pollIntervalMs)
    checkHealth() // Initial check
  },

  stop() {
    if (_timer) {
      clearInterval(_timer)
      _timer = null
      log.info('DLQ monitor stopped')
    }
  },

  onAlert(callback) {
    _alertCallbacks.push(callback)
  },

  async getStatus() {
    return {
      running: _timer !== null,
      lastCheck: _metrics.lastCheck,
      currentBudget: _metrics.currentBudget,
      snapshotCount: _metrics.snapshots.length,
    }
  },

  getMetrics() {
    return { ..._metrics }
  },
}
