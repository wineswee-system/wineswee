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
    if (saved) {
      const parsed = JSON.parse(saved)
      return parsed?.organization_id ?? parsed?.id ?? null
    }
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

// ── PII redaction ──
// Sensitive key denylist (case-insensitive substring match). Any data field
// whose key contains one of these gets its value replaced with '[REDACTED]'.
// Applies in BOTH dev and prod output — logs must never carry PII/credentials.
// (src/lib/dataMasking.js has per-format display masks; not reused here because
// redaction is key-driven and recursive, not format-driven.)
const SENSITIVE_KEY_SUBSTRINGS = [
  'password', 'token', 'secret', 'api_key', 'apikey', 'authorization',
  'salary', 'net_salary', 'base_salary', 'bank_account', 'id_number',
  'national_id', 'phone', 'email', 'address', 'credentials',
]

function isSensitiveKey(key) {
  const k = String(key).toLowerCase()
  return SENSITIVE_KEY_SUBSTRINGS.some(s => k.includes(s))
}

const REDACT_MAX_DEPTH = 4

/** Recursively redact sensitive keys. Returns a new structure — never mutates input. */
function redactPII(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value
  if (depth >= REDACT_MAX_DEPTH) return value
  if (Array.isArray(value)) return value.map(v => redactPII(v, depth + 1))
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? '[REDACTED]' : redactPII(v, depth + 1)
  }
  return out
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
    // Include remaining data fields (PII-redacted, both dev and prod)
    data: redactPII(Object.fromEntries(
      Object.entries(data).filter(([k]) => !['module', 'correlation_id', 'tenant_id', 'user_id', 'error'].includes(k))
    )),
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
