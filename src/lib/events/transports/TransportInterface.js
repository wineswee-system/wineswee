/**
 * Base class that all transports must implement.
 * Consumers never interact with transports directly — the EventBus does.
 */
export class TransportInterface {
  /**
   * Send an event envelope to matching subscribers.
   * @param {object} event - the full event envelope
   * @param {Map<string, Set<Function>>} subscribers - pattern → handler set
   * @returns {Promise<void>}
   */
  async send(event, subscribers) {
    throw new Error('Transport.send() must be implemented')
  }

  /** Clean up resources (connections, intervals, etc.) */
  async destroy() {}
}
