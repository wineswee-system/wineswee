import { logger } from '../../logger.js'

const log = logger.forModule('events.tracing')

/**
 * OpenTelemetry-Compatible Tracing Middleware
 *
 * Instruments event chains with distributed tracing spans.
 * Tracks event processing latency, handler durations, and error rates.
 *
 * In standalone mode: collects spans in-memory and logs them.
 * With OpenTelemetry SDK: export spans to Jaeger, Zipkin, Datadog, etc.
 *
 * Span structure follows OpenTelemetry conventions:
 * - traceId = correlation_id
 * - spanId = event.id
 * - parentSpanId = causation_id
 * - attributes = { event.type, event.domain, tenant_id }
 */

// In-memory span collector (replace with OTel exporter in production)
const _spans = []
const MAX_SPANS = 1000

/**
 * Create a trace span for an event.
 */
function createSpan(event) {
  return {
    traceId: event.metadata?.correlation_id || event.id,
    spanId: event.id,
    parentSpanId: event.metadata?.causation_id || null,
    operationName: `event.${event.type}`,
    startTime: Date.now(),
    endTime: null,
    duration_ms: null,
    status: 'OK',
    attributes: {
      'event.type': event.type,
      'event.domain': event.domain,
      'event.action': event.action,
      'event.version': event.version,
      'tenant.id': event.metadata?.organization_id || event.metadata?.tenant_id || 'unknown',
      'event.replay': event.metadata?._replay || false,
    },
    events: [], // Sub-span events (handler start/end, errors)
  }
}

export async function tracingMiddleware(event, next) {
  const span = createSpan(event)

  // Attach span to event for downstream access
  event._span = span

  try {
    await next()

    // Record handler errors as span events
    if (event._handlerErrors?.length > 0) {
      span.status = 'ERROR'
      for (const err of event._handlerErrors) {
        span.events.push({
          name: 'handler.error',
          timestamp: Date.now(),
          attributes: {
            'handler.name': err.handler,
            'error.message': err.error?.message || String(err.error),
          },
        })
      }
    }
  } catch (err) {
    span.status = 'ERROR'
    span.events.push({
      name: 'middleware.error',
      timestamp: Date.now(),
      attributes: { 'error.message': err.message },
    })
    throw err
  } finally {
    span.endTime = Date.now()
    span.duration_ms = span.endTime - span.startTime

    // Collect span
    _spans.push(span)
    if (_spans.length > MAX_SPANS) _spans.shift()

    // Log slow events
    if (span.duration_ms > 1000) {
      log.warn('Slow event processing', {
        event_type: event.type,
        duration_ms: span.duration_ms,
        correlation_id: span.traceId,
      })
    }

    // Debug log all spans in development
    if (!import.meta.env?.PROD) {
      log.debug(`Span: ${span.operationName}`, {
        duration_ms: span.duration_ms,
        status: span.status,
        correlation_id: span.traceId,
      })
    }
  }
}

/**
 * Query collected spans for debugging and monitoring.
 */
export function querySpans(filters = {}) {
  let result = [..._spans]

  if (filters.traceId) {
    result = result.filter(s => s.traceId === filters.traceId)
  }
  if (filters.operationName) {
    result = result.filter(s => s.operationName.includes(filters.operationName))
  }
  if (filters.status) {
    result = result.filter(s => s.status === filters.status)
  }
  if (filters.minDuration) {
    result = result.filter(s => s.duration_ms >= filters.minDuration)
  }
  if (filters.limit) {
    result = result.slice(-filters.limit)
  }

  return result
}

/**
 * Get trace tree for a correlation_id.
 * Returns spans ordered by parent-child relationship.
 */
export function getTraceTree(correlationId) {
  const spans = _spans.filter(s => s.traceId === correlationId)
  const root = spans.find(s => !s.parentSpanId)
  if (!root) return spans

  function buildTree(parentId) {
    const children = spans.filter(s => s.parentSpanId === parentId)
    return children.map(child => ({
      ...child,
      children: buildTree(child.spanId),
    }))
  }

  return {
    ...root,
    children: buildTree(root.spanId),
  }
}

/**
 * Get performance metrics summary.
 */
export function getTracingMetrics() {
  if (_spans.length === 0) return null

  const durations = _spans.map(s => s.duration_ms).filter(Boolean)
  const errors = _spans.filter(s => s.status === 'ERROR')
  const byDomain = {}

  for (const span of _spans) {
    const domain = span.attributes['event.domain']
    if (!byDomain[domain]) {
      byDomain[domain] = { count: 0, errors: 0, totalDuration: 0 }
    }
    byDomain[domain].count++
    byDomain[domain].totalDuration += span.duration_ms || 0
    if (span.status === 'ERROR') byDomain[domain].errors++
  }

  return {
    total_spans: _spans.length,
    error_count: errors.length,
    error_rate: (errors.length / _spans.length * 100).toFixed(2) + '%',
    avg_duration_ms: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    p95_duration_ms: percentile(durations, 95),
    p99_duration_ms: percentile(durations, 99),
    by_domain: Object.fromEntries(
      Object.entries(byDomain).map(([k, v]) => [k, {
        ...v,
        avg_duration_ms: Math.round(v.totalDuration / v.count),
      }])
    ),
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[index]
}

/** Clear spans (for testing) */
export function clearSpans() {
  _spans.length = 0
}
