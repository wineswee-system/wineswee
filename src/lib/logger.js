/**
 * Structured Logger
 *
 * Replaces console.warn/error with structured JSON logging.
 * Includes correlation_id, tenant_id, timestamps, and log levels.
 *
 * In development: pretty-prints to console.
 * In production: outputs structured JSON (ready for log aggregation: ELK, Datadog, CloudWatch).
 *
 * Usage:
 *   import { logger } from './logger'
 *   logger.info('Order created', { module: 'sales', order_id: '123' })
 *   logger.error('Payment failed', { module: 'pos', error: err })
 *   logger.withContext({ correlation_id: 'abc' }).info('Processing...')
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
}

const MIN_LEVEL = import.meta.env?.PROD ? LOG_LEVELS.info : LOG_LEVELS.debug
const IS_PROD = import.meta.env?.PROD ?? false

function getTenantId() {
  try {
    const saved = localStorage.getItem('sme_tenant')
    if (saved) return JSON.parse(saved)?.id || null
  } catch { /* SSR / test */ }
  return null
}

function getUserId() {
  try {
    const saved = localStorage.getItem('sme_user')
    if (saved) return JSON.parse(saved)?.id || null
  } catch { /* SSR / test */ }
  return null
}

function createLogEntry(level, message, data = {}, context = {}) {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    module: data.module || context.module || undefined,
    correlation_id: data.correlation_id || context.correlation_id || undefined,
    tenant_id: data.tenant_id || context.tenant_id || getTenantId(),
    user_id: data.user_id || context.user_id || getUserId(),
    // Flatten error objects
    ...(data.error instanceof Error ? {
      error_name: data.error.name,
      error_message: data.error.message,
      error_stack: IS_PROD ? undefined : data.error.stack,
    } : {}),
    // Include remaining data fields
    data: Object.fromEntries(
      Object.entries(data).filter(([k]) => !['module', 'correlation_id', 'tenant_id', 'user_id', 'error'].includes(k))
    ),
  }
}

function emit(level, entry) {
  if (LOG_LEVELS[level] < MIN_LEVEL) return

  if (IS_PROD) {
    // Structured JSON output for log aggregation
    const json = JSON.stringify(entry)
    if (level === 'error' || level === 'fatal') {
      console.error(json)
    } else if (level === 'warn') {
      console.warn(json)
    } else {
      console.log(json)
    }
  } else {
    // Pretty dev output
    const prefix = `[${entry.timestamp.slice(11, 23)}] [${level.toUpperCase()}]`
    const module = entry.module ? ` [${entry.module}]` : ''
    const corr = entry.correlation_id ? ` corr=${entry.correlation_id}` : ''
    const msg = `${prefix}${module}${corr} ${entry.message}`

    const extra = { ...entry.data }
    if (entry.error_message) extra.error = entry.error_message
    if (entry.error_stack) extra.stack = entry.error_stack

    const hasExtra = Object.keys(extra).length > 0

    if (level === 'error' || level === 'fatal') {
      hasExtra ? console.error(msg, extra) : console.error(msg)
    } else if (level === 'warn') {
      hasExtra ? console.warn(msg, extra) : console.warn(msg)
    } else if (level === 'debug') {
      hasExtra ? console.debug(msg, extra) : console.debug(msg)
    } else {
      hasExtra ? console.log(msg, extra) : console.log(msg)
    }
  }
}

function createLogger(context = {}) {
  const log = (level) => (message, data = {}) => {
    const entry = createLogEntry(level, message, data, context)
    emit(level, entry)
    return entry
  }

  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    fatal: log('fatal'),

    /**
     * Create a child logger with additional context.
     * Context is inherited by all log entries from the child.
     *
     * @param {object} childContext - e.g. { correlation_id, module, tenant_id }
     * @returns {Logger}
     */
    withContext(childContext) {
      return createLogger({ ...context, ...childContext })
    },

    /**
     * Create a child logger scoped to a module.
     * Shorthand for withContext({ module }).
     */
    forModule(module) {
      return createLogger({ ...context, module })
    },
  }
}

/** Singleton root logger */
export const logger = createLogger()

/**
 * Module-specific logger factories (pre-scoped).
 * Usage: import { loggers } from './logger'; const log = loggers.finance
 */
export const loggers = {
  sales: createLogger({ module: 'sales' }),
  purchase: createLogger({ module: 'purchase' }),
  wms: createLogger({ module: 'wms' }),
  finance: createLogger({ module: 'finance' }),
  manufacturing: createLogger({ module: 'manufacturing' }),
  hr: createLogger({ module: 'hr' }),
  crm: createLogger({ module: 'crm' }),
  pos: createLogger({ module: 'pos' }),
  analytics: createLogger({ module: 'analytics' }),
  events: createLogger({ module: 'events' }),
  system: createLogger({ module: 'system' }),
  auth: createLogger({ module: 'auth' }),
}

/** Re-export createLogger for custom contexts */
export { createLogger }
