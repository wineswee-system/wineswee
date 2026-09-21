export { EventBus, getEventBus, resetEventBus } from './EventBus.js'
export { EVENT_CATALOG } from './catalog/index.js'
export { queryEvents, replayEvents } from './store/EventStore.js'
export { registerAllHandlers } from './handlers/index.js'

// Kafka migration exports
export { KafkaTransport, KAFKA_TOPIC_CONFIG } from './transports/KafkaTransport.js'

// Enterprise middleware exports
export { idempotencyMiddleware, clearIdempotencyCache } from './middleware/idempotency.js'
export { retryMiddleware, createRetryMiddleware } from './middleware/retry.js'
export { sanitizerMiddleware } from './middleware/sanitizer.js'
export { rateLimitMiddleware, createRateLimitMiddleware, clearRateLimitCounters } from './middleware/rateLimit.js'
export { tracingMiddleware, querySpans, getTraceTree, getTracingMetrics, clearSpans } from './middleware/tracing.js'
export { outboxMiddleware, createOutboxWorker } from './middleware/outbox.js'
