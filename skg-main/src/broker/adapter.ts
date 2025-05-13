/**
 * BrokerAdapter - Wrapper around NATS client with reconnect logic
 */
import { connect, NatsConnection, Subscription, StringCodec, JetStreamClient } from 'nats';
import { EventEmitter } from 'events';
import Config from '../config';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Types for message handlers
export type MessageHandler<T> = (data: T, raw: Uint8Array, context?: MessageContext) => Promise<void> | void;

// Message context for handlers
export interface MessageContext {
  isDuplicate?: boolean;
  originalTimestamp?: string;
}

/**
 * BrokerAdapter - Wrapper around NATS client with reconnect logic
 */
export class BrokerAdapter extends EventEmitter {
  private connection: NatsConnection | null = null;
  private jetstream: JetStreamClient | null = null;
  private subscriptions: Map<string, Subscription> = new Map();
  private reconnectAttempts = 0;
  private stringCodec = StringCodec();
  private connectionStatus: 'disconnected' | 'connected' | 'connecting' = 'disconnected';
  private connectionPromise: Promise<NatsConnection> | null = null;

  // LRU cache for tracking seen event IDs to prevent duplicate processing
  // Keys: event_id, Values: { timestamp: ISO string, seen: count }
  private readonly processedEvents = new Map<string, { timestamp: string, seen: number }>();
  // Maximum size of the cache to prevent unbounded memory growth
  private readonly MAX_CACHE_SIZE = 10000;
  // Time window to track duplicates (5 minutes in ms)
  private readonly DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

  /**
   * Create a broker adapter instance
   * @param url NATS server URL
   */
  constructor(private url: string = Config.broker.url) {
    super();
  }

  /**
   * Connect to the NATS server with automatic reconnect
   */
  public async connect(): Promise<NatsConnection> {
    if (this.connection && !this.connection.isClosed()) {
      return this.connection;
    }

    // If we're already trying to connect, return the existing promise
    if (this.connectionStatus === 'connecting' && this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionStatus = 'connecting';
    this.connectionPromise = this.attemptConnect();
    return this.connectionPromise;
  }

  /**
   * Connect to NATS server with retry logic
   * @private
   */
  private async attemptConnect(): Promise<NatsConnection> {
    try {
      logger.info({ url: this.url }, 'Connecting to NATS server');

      const nc = await connect({
        servers: this.url,
        maxReconnectAttempts: Config.broker.reconnectAttempts,
        reconnectTimeWait: Config.broker.reconnectTimeWait,
        timeout: Config.broker.timeout,
        reconnectDelayHandler: () => {
          // Exponential backoff with jitter
          const jitter = Math.random() * 100;
          const delay = Math.min(
            Config.broker.reconnectTimeWait * Math.pow(1.5, this.reconnectAttempts) + jitter,
            30000 // Max 30 seconds
          );
          this.reconnectAttempts++;
          return delay;
        }
      });

      // Reset reconnect attempts counter on successful connection
      this.reconnectAttempts = 0;
      this.connection = nc;
      this.jetstream = nc.jetstream();
      this.connectionStatus = 'connected';

      logger.info('Connected to NATS server');
      this.emit('connect');

      // Set up status listeners
      (async () => {
        for await (const status of nc.status()) {
          switch(status.type) {
            case 'reconnect':
              logger.warn({ attempts: this.reconnectAttempts }, 'Reconnecting to NATS');
              this.emit('reconnecting', this.reconnectAttempts);
              break;
            case 'disconnect':
              logger.warn('Disconnected from NATS');
              this.connectionStatus = 'disconnected';
              this.emit('disconnect');
              break;
            case 'update':
              logger.debug({ servers: status.data }, 'NATS servers updated');
              break;
            case 'ldm':
              logger.debug('NATS LDM mode enabled');
              break;
            default:
              logger.debug({ type: status.type }, 'NATS status update');
              break;
          }
        }
      })().catch(err => {
        logger.error({ error: err }, 'Error processing NATS status events');
      });

      // Handle connection closure
      nc.closed().then((err) => {
        if (err) {
          logger.error({ error: err }, 'NATS connection closed with error');
          this.emit('error', err);
        } else {
          logger.info('NATS connection closed gracefully');
        }
        this.connectionStatus = 'disconnected';
        this.connection = null;
        this.jetstream = null;
      });

      return nc;
    } catch (error) {
      logger.error({ error }, 'Failed to connect to NATS');
      this.connectionStatus = 'disconnected';
      this.connectionPromise = null;
      this.emit('error', error);
      
      throw error;
    }
  }

  /**
   * Subscribe to a subject with a message handler
   * @param subject The subject to subscribe to
   * @param handler The message handler callback
   */
  public async subscribe<T>(subject: string, handler: MessageHandler<T>): Promise<Subscription> {
    const nc = await this.connect();

    // Start cleanup interval for duplicate tracking cache
    this.startCacheCleanupInterval();

    // Create subscription
    const sub = nc.subscribe(subject, {
      queue: `skb-worker-${process.env.NODE_ENV || 'development'}`,
      callback: async (err, msg) => {
        if (err) {
          logger.error({ error: err, subject }, 'Error in subscription');
          return;
        }

        try {
          // Parse the message data
          const dataString = this.stringCodec.decode(msg.data);
          const data = JSON.parse(dataString) as T;

          // Check for duplicates only if the message has an event_id property
          const context: MessageContext = {};

          // @ts-ignore - We check if there's an event_id property
          if (data && typeof data === 'object' && data.event_id) {
            // @ts-ignore
            const eventId = data.event_id as string;
            const duplicateInfo = this.checkAndRecordEvent(eventId);

            if (duplicateInfo.isDuplicate) {
              // This is a duplicate, add context for the handler
              context.isDuplicate = true;
              context.originalTimestamp = duplicateInfo.originalTimestamp;
              logger.debug({
                eventId,
                originalTimestamp: duplicateInfo.originalTimestamp,
                seenCount: duplicateInfo.seenCount
              }, 'Detected duplicate event_id');
            }
          }

          // Call the handler with the duplicate context
          await handler(data, msg.data, context);
        } catch (error) {
          logger.error({ error, subject, data: this.stringCodec.decode(msg.data) },
            'Error processing message');
        }
      }
    });

    // Store subscription for cleanup
    this.subscriptions.set(subject, sub);
    logger.info({ subject }, 'Subscribed to subject');

    return sub;
  }

  /**
   * Check if event ID has been seen before and record it
   * @param eventId The event ID to check
   * @returns Information about whether this is a duplicate
   */
  private checkAndRecordEvent(eventId: string): {
    isDuplicate: boolean;
    originalTimestamp?: string;
    seenCount: number;
  } {
    const now = new Date().toISOString();
    const existingRecord = this.processedEvents.get(eventId);

    if (existingRecord) {
      // Update the record with a new seen count
      existingRecord.seen += 1;
      this.processedEvents.set(eventId, existingRecord);

      return {
        isDuplicate: true,
        originalTimestamp: existingRecord.timestamp,
        seenCount: existingRecord.seen
      };
    }

    // This is a new event, record it
    this.processedEvents.set(eventId, { timestamp: now, seen: 1 });

    // If the cache is too large, remove the oldest entries
    if (this.processedEvents.size > this.MAX_CACHE_SIZE) {
      this.cleanupOldEvents();
    }

    return { isDuplicate: false, seenCount: 1 };
  }

  /**
   * Start a background interval to clean up old events from the cache
   */
  private startCacheCleanupInterval(): void {
    // Run every minute
    const interval = setInterval(() => {
      this.cleanupOldEvents();

      // If we're disconnected, stop the interval
      if (this.connectionStatus === 'disconnected') {
        clearInterval(interval);
      }
    }, 60000);

    // Don't prevent the process from exiting
    interval.unref();
  }

  /**
   * Clean up old events from the cache that are outside the duplicate window
   */
  private cleanupOldEvents(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [eventId, record] of this.processedEvents.entries()) {
      const recordTime = new Date(record.timestamp).getTime();
      const age = now - recordTime;

      if (age > this.DUPLICATE_WINDOW_MS) {
        this.processedEvents.delete(eventId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.debug({
        removedCount,
        remainingCount: this.processedEvents.size
      }, 'Cleaned up old events from duplicate detection cache');
    }
  }

  /**
   * Publish a message to a subject
   * @param subject The subject to publish to
   * @param data The data to publish
   */
  public async publish<T>(subject: string, data: T): Promise<void> {
    const nc = await this.connect();
    
    try {
      // Convert data to string
      const dataString = JSON.stringify(data);
      const encoded = this.stringCodec.encode(dataString);
      
      // Publish the message
      nc.publish(subject, encoded);
      
      logger.debug({ subject }, 'Published message to subject');
    } catch (error) {
      logger.error({ error, subject }, 'Error publishing message');
      throw error;
    }
  }

  /**
   * Close the connection and all subscriptions
   */
  public async close(): Promise<void> {
    if (!this.connection || this.connection.isClosed()) {
      return;
    }

    // Drain all subscriptions
    logger.info('Closing broker connections and subscriptions');

    try {
      await this.connection.drain();
      this.subscriptions.clear();
      this.connection = null;
      this.jetstream = null;
      this.connectionStatus = 'disconnected';

      // Clear the event cache
      this.processedEvents.clear();

      logger.info('Broker connections and subscriptions closed');
    } catch (error) {
      logger.error({ error }, 'Error closing broker connection');
      throw error;
    }
  }

  /**
   * Create an instance of the BrokerAdapter singleton and connect
   * @param url Optional NATS server URL
   */
  public static async connect(url?: string): Promise<BrokerAdapter> {
    const broker = new BrokerAdapter(url);
    await broker.connect();
    return broker;
  }
}

// Export default singleton instance
export default BrokerAdapter;