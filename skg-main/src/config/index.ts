/**
 * Configuration settings for the SKB service
 */
import { config } from 'dotenv';

// Load environment variables from .env file if present
config();

// Environment mapping for log levels
const LOG_LEVELS = {
  development: 'debug',
  test: 'debug',
  production: 'info',
} as const;

// Get the current node environment or default to development
const nodeEnv = (process.env.NODE_ENV || 'development') as keyof typeof LOG_LEVELS;

/**
 * Configuration object for the SKB service
 */
export const Config = {
  // Service info
  service: {
    name: 'skb-service',
    version: process.env.npm_package_version || '0.3.0',
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || LOG_LEVELS[nodeEnv] || 'info',
    prettyPrint: nodeEnv !== 'production',
  },
  
  // MCP Broker configuration
  broker: {
    url: process.env.BROKER_URL || 'nats://localhost:4222',
    timeout: parseInt(process.env.BROKER_TIMEOUT || '5000', 10),
    reconnectAttempts: parseInt(process.env.BROKER_RECONNECT_ATTEMPTS || '10', 10),
    reconnectTimeWait: parseInt(process.env.BROKER_RECONNECT_TIME_WAIT || '1000', 10), // ms
  },
  
  // Topic definitions
  topics: {
    // Input topics (subscribe)
    in: {
      newNote: process.env.TOPIC_IN_NEW_NOTE || 'events.tangent.notes.new.v1',
    },
    // Output topics (publish)
    out: {
      noteIndexed: process.env.TOPIC_OUT_NOTE_INDEXED || 'events.skb.indexing.status.v1',
      noteFragmented: process.env.TOPIC_OUT_NOTE_FRAGMENTED || 'events.skb.note.fragmented.v1',
      graphUpdated: process.env.TOPIC_OUT_GRAPH_UPDATED || 'events.skb.graph.updated.v1',
    },
    // Internal events (not exposed outside the service)
    internal: {
      graphUpdated: 'internal.skb.graph.updated.v1',
    },
  },
  
  // HTTP Server configuration (for healthcheck)
  http: {
    port: parseInt(process.env.HTTP_PORT || '3000', 10),
    host: process.env.HTTP_HOST || '0.0.0.0',
  },
};

// Export configuration as default
export default Config;