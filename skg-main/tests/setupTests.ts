/**
 * Global test setup and mocks
 */

// Silent logger in tests
jest.mock('../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  }
}));

// Mock config
jest.mock('../src/config', () => ({
  __esModule: true,
  default: {
    service: {
      name: 'skb-service-test',
      version: '0.1.0',
    },
    logging: {
      level: 'debug',
      prettyPrint: false,
    },
    broker: {
      url: 'nats://localhost:4222',
      timeout: 5000,
      reconnectAttempts: 10,
      reconnectTimeWait: 1000,
    },
    topics: {
      in: {
        newNote: 'events.tangent.notes.new.v1',
      },
      out: {
        noteIndexed: 'events.skb.indexing.status.v1',
      },
    },
    http: {
      port: 3000,
      host: '0.0.0.0',
    }
  }
}));