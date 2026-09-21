import { TransportInterface } from './TransportInterface.js'

/**
 * Kafka transport placeholder.
 * Drop-in replacement for InMemoryTransport when migrating to Kafka.
 *
 * Migration steps:
 * 1. Install kafkajs: `npm install kafkajs`
 * 2. Uncomment the Kafka client code below
 * 3. Swap transport in EventBus.js: `new KafkaTransport(config)` instead of `new InMemoryTransport()`
 *
 * The EventBus, middleware chain, event catalog, and all handlers remain unchanged.
 * Only the transport layer changes — this is the entire migration surface.
 *
 * @example
 * // In EventBus.js createDefaultBus():
 * const transport = new KafkaTransport({
 *   brokers: ['kafka-1:9092', 'kafka-2:9092'],
 *   clientId: 'sme-ops',
 *   groupId: 'sme-ops-consumers',
 * })
 */
export class KafkaTransport extends TransportInterface {
  constructor(config = {}) {
    super()
    this._config = {
      brokers: config.brokers || ['localhost:9092'],
      clientId: config.clientId || 'sme-ops',
      groupId: config.groupId || 'sme-ops-consumers',
      topicPrefix: config.topicPrefix || 'sme-ops.',
    }
    this._producer = null
    this._consumer = null
    this._connected = false

    // Topic mapping: event domain → Kafka topic
    // e.g., 'wms.shipment.completed' → 'sme-ops.wms'
    this._getTopicForEvent = (event) =>
      `${this._config.topicPrefix}${event.domain}`
  }

  /**
   * Initialize Kafka producer and consumer.
   * Call once before publishing/subscribing.
   *
   * Uncomment when kafkajs is installed:
   *
   * async connect() {
   *   const { Kafka } = await import('kafkajs')
   *   const kafka = new Kafka({
   *     clientId: this._config.clientId,
   *     brokers: this._config.brokers,
   *   })
   *
   *   this._producer = kafka.producer()
   *   this._consumer = kafka.consumer({ groupId: this._config.groupId })
   *
   *   await this._producer.connect()
   *   await this._consumer.connect()
   *   this._connected = true
   * }
   */
  async connect() {
    console.warn('[KafkaTransport] Kafka not configured — using placeholder. Install kafkajs and configure brokers to enable.')
    this._connected = false
  }

  /**
   * Send an event to Kafka topic, then deliver to local subscribers.
   *
   * In production Kafka mode:
   * 1. Serialize event → produce to Kafka topic (partitioned by tenant_id)
   * 2. Consumer receives message → deserialize → invoke matching handlers
   *
   * Current placeholder: falls back to in-memory delivery (same as InMemoryTransport).
   */
  async send(event, subscribers) {
    // ── Kafka producer path (uncomment when kafkajs is installed) ──
    //
    // if (this._connected && this._producer) {
    //   const topic = this._getTopicForEvent(event)
    //   await this._producer.send({
    //     topic,
    //     messages: [{
    //       key: event.metadata.tenant_id || event.id,
    //       value: JSON.stringify(event),
    //       headers: {
    //         'event-type': event.type,
    //         'event-id': event.id,
    //         'correlation-id': event.metadata.correlation_id || '',
    //         'causation-id': event.metadata.causation_id || '',
    //       },
    //     }],
    //   })
    //   return // Consumer group handles delivery
    // }

    // ── Fallback: in-memory delivery (same as InMemoryTransport) ──
    const errors = []
    for (const [pattern, handlers] of subscribers) {
      if (!matchPattern(pattern, event.type)) continue
      for (const handler of handlers) {
        try {
          await handler(event)
        } catch (err) {
          errors.push({ handler: handler.name || 'anonymous', error: err })
        }
      }
    }
    if (errors.length > 0) {
      event._handlerErrors = errors
    }
  }

  /**
   * Subscribe consumer to Kafka topics.
   *
   * Uncomment when kafkajs is installed:
   *
   * async startConsuming(subscribers) {
   *   const topics = [...new Set(
   *     Array.from(subscribers.keys()).map(pattern => {
   *       const domain = pattern.split('.')[0]
   *       return domain === '*' ? null : `${this._config.topicPrefix}${domain}`
   *     }).filter(Boolean)
   *   )]
   *
   *   for (const topic of topics) {
   *     await this._consumer.subscribe({ topic, fromBeginning: false })
   *   }
   *
   *   await this._consumer.run({
   *     eachMessage: async ({ message }) => {
   *       const event = JSON.parse(message.value.toString())
   *       for (const [pattern, handlers] of subscribers) {
   *         if (!matchPattern(pattern, event.type)) continue
   *         for (const handler of handlers) {
   *           try {
   *             await handler(event)
   *           } catch (err) {
   *             event._handlerErrors = event._handlerErrors || []
   *             event._handlerErrors.push({ handler: handler.name, error: err })
   *           }
   *         }
   *       }
   *     },
   *   })
   * }
   */

  async destroy() {
    // if (this._producer) await this._producer.disconnect()
    // if (this._consumer) await this._consumer.disconnect()
    this._connected = false
  }
}

/**
 * Topic configuration for Kafka.
 * Each domain maps to one Kafka topic with configurable partitions.
 *
 * Recommended partition strategy:
 * - Partition key = tenant_id (ensures ordering per tenant)
 * - 3-6 partitions per topic for SME scale
 * - Replication factor = 3 for production
 */
export const KAFKA_TOPIC_CONFIG = {
  'sme-ops.sales':         { partitions: 6, replicationFactor: 3 },
  'sme-ops.purchase':      { partitions: 3, replicationFactor: 3 },
  'sme-ops.wms':           { partitions: 6, replicationFactor: 3 },
  'sme-ops.finance':       { partitions: 3, replicationFactor: 3 },
  'sme-ops.manufacturing': { partitions: 3, replicationFactor: 3 },
  'sme-ops.hr':            { partitions: 3, replicationFactor: 3 },
  'sme-ops.crm':           { partitions: 6, replicationFactor: 3 },
  'sme-ops.pos':           { partitions: 6, replicationFactor: 3 },
}

function matchPattern(pattern, type) {
  if (pattern === '*') return true
  if (pattern === type) return true
  if (pattern.endsWith('.*')) {
    return type.startsWith(pattern.slice(0, -2) + '.')
  }
  return false
}
