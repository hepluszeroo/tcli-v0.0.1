/* Generated from JSON schema - do not edit manually */

/**
 * Common envelope structure for all events
 */
export interface EventEnvelope {
  /**
   * Unique identifier for this event
   */
  event_id: string;
  /**
   * Type of the event
   */
  event_type: string;
  /**
   * ISO 8601 timestamp of when the event was generated
   */
  timestamp: string;
  /**
   * Name of the service that generated this event
   */
  source_service: string;
  /**
   * Optional ID to correlate events in a sequence
   */
  correlation_id?: string;
}
