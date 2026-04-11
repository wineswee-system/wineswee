import { logger } from '../../logger.js'

const log = logger.forModule('events.sanitizer')

/**
 * Input Sanitization Middleware
 *
 * Validates and sanitizes event payloads at the system boundary.
 * Prevents XSS, SQL injection patterns, and malformed data from
 * entering the event pipeline.
 *
 * Runs early in the middleware chain (after tenant context, before validator).
 */

// Patterns that indicate potential injection attacks
const DANGEROUS_PATTERNS = [
  /<script\b[^>]*>/i,                          // XSS script tags
  /javascript:/i,                               // XSS javascript: protocol
  /on\w+\s*=/i,                                 // XSS event handlers (onclick=, etc.)
  /UNION\s+(?:ALL\s+)?SELECT/i,                // SQL UNION injection
  /;\s*DROP\s+TABLE/i,                          // SQL DROP injection
  /;\s*DELETE\s+FROM/i,                         // SQL DELETE injection
  /'\s*OR\s+'?\d*'?\s*=\s*'?\d*'?/i,           // SQL OR 1=1 injection
  /--\s*$/,                                      // SQL comment termination
  /\/\*.*\*\//,                                  // SQL block comments
]

// Fields that should be positive numbers
const NUMERIC_POSITIVE_FIELDS = [
  'amount', 'total_amount', 'total', 'price', 'qty', 'quantity',
  'net_salary', 'gross_salary', 'days', 'hours',
]

// Fields that should be non-empty strings
const REQUIRED_STRING_FIELDS = [
  'customer', 'supplier', 'employee', 'name',
]

/**
 * Sanitize a string value — strip dangerous content.
 */
function sanitizeString(value) {
  if (typeof value !== 'string') return value
  // Strip HTML tags
  let clean = value.replace(/<[^>]*>/g, '')
  // Strip null bytes
  clean = clean.replace(/\0/g, '')
  // Trim whitespace
  clean = clean.trim()
  return clean
}

/**
 * Deep-sanitize an object's string values.
 */
function sanitizePayload(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return sanitizeString(obj)
  if (typeof obj === 'number') return obj
  if (typeof obj === 'boolean') return obj

  if (Array.isArray(obj)) {
    return obj.map(sanitizePayload)
  }

  if (typeof obj === 'object') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      result[sanitizeString(key)] = sanitizePayload(value)
    }
    return result
  }

  return obj
}

/**
 * Check for dangerous patterns in string values.
 */
function detectInjection(value, fieldPath) {
  if (typeof value !== 'string') return null

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(value)) {
      return {
        field: fieldPath,
        pattern: pattern.source,
        value: value.slice(0, 100), // Truncate for logging
      }
    }
  }
  return null
}

/**
 * Recursively scan object for injection patterns.
 */
function scanForInjection(obj, path = '') {
  const violations = []

  if (typeof obj === 'string') {
    const v = detectInjection(obj, path)
    if (v) violations.push(v)
    return violations
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      violations.push(...scanForInjection(item, `${path}[${i}]`))
    })
    return violations
  }

  if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      violations.push(...scanForInjection(value, path ? `${path}.${key}` : key))
    }
  }

  return violations
}

export async function sanitizerMiddleware(event, next) {
  // 1. Scan for injection patterns
  const violations = scanForInjection(event.payload)
  if (violations.length > 0) {
    log.warn('Injection patterns detected in event payload', {
      event_type: event.type,
      event_id: event.id,
      violations,
    })
    // Sanitize rather than block (defense-in-depth)
  }

  // 2. Sanitize all string values in payload
  event.payload = sanitizePayload(event.payload)

  // 3. Validate numeric fields are positive
  for (const field of NUMERIC_POSITIVE_FIELDS) {
    if (field in event.payload) {
      const val = Number(event.payload[field])
      if (isNaN(val) || val < 0) {
        log.warn('Invalid numeric field in event', {
          event_type: event.type,
          field,
          value: event.payload[field],
        })
        event.payload[field] = 0
      } else {
        event.payload[field] = val
      }
    }
  }

  // 4. Validate required string fields are non-empty
  for (const field of REQUIRED_STRING_FIELDS) {
    if (field in event.payload && (!event.payload[field] || typeof event.payload[field] !== 'string')) {
      log.warn('Empty required string field in event', {
        event_type: event.type,
        field,
      })
    }
  }

  // 5. Sanitize metadata strings
  if (event.metadata) {
    if (event.metadata.source) event.metadata.source = sanitizeString(event.metadata.source)
    if (event.metadata.user_id) event.metadata.user_id = sanitizeString(String(event.metadata.user_id))
  }

  return next()
}
