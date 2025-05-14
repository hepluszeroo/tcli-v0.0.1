/**
 * Integration tests for graph merging features
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { GraphStore } from '../../src/graph-store';
import { KnowledgeFragment } from '../../src/types/knowledge_fragment.v1';
import { main } from '../../src/worker/skb-worker';
import { metrics } from '../../src/metrics/metrics';

// Sample note content for testing
const sampleNoteContent = `
# Test Note

This is a test note with some entities:
- Entity One
- Entity Two

These entities are related in the following ways:
- Entity One is related to Entity Two
`;

// Mock the KGGen module to generate deterministic fragments
jest.mock('../../src/kggen/generate', () => {
  const originalModule = jest.requireActual('../../src/kggen/generate');
  
  return {
    ...originalModule,
    generateFragment: jest.fn().mockImplementation((noteId, content) => {
      // Create a simple deterministic fragment for testing
      return Promise.resolve({
        note_id: noteId,
        entities: [
          { id: 'e1', label: 'Entity One', type: 'Concept' },
          { id: 'e2', label: 'Entity Two', type: 'Concept' }
        ],
        relations: ['related_to'],
        triples: [
          { subject: 'e1', predicate: 'related_to', object: 'e2' }
        ]
      });
    })
  };
});

// Mock the broker adapter
jest.mock('../../src/broker/adapter', () => {
  // Create a mock broker with in-memory message handling
  const mockMessages: any = {};
  const mockEventCallbacks: Record<string, Function[]> = {};
  
  class MockBroker {
    static connect() {
      return Promise.resolve(new MockBroker());
    }
    
    subscribe(topic: string, callback: Function) {
      if (!mockEventCallbacks[topic]) {
        mockEventCallbacks[topic] = [];
      }
      mockEventCallbacks[topic].push(callback);
      return Promise.resolve();
    }
    
    publish(topic: string, message: any) {
      // Store the message
      if (!mockMessages[topic]) {
        mockMessages[topic] = [];
      }
      mockMessages[topic].push(message);
      
      // Call any subscribers
      if (mockEventCallbacks[topic]) {
        mockEventCallbacks[topic].forEach(callback => {
          callback(message, JSON.stringify(message), {});
        });
      }
      
      return Promise.resolve();
    }
    
    close() {
      return Promise.resolve();
    }
    
    // Helper methods for testing
    static getMessages(topic: string) {
      return mockMessages[topic] || [];
    }
    
    static clearMessages() {
      Object.keys(mockMessages).forEach(key => {
        mockMessages[key] = [];
      });
    }
  }
  
  return {
    BrokerAdapter: MockBroker
  };
});

// Mock the config object
jest.mock('../../src/config', () => ({
  service: {
    name: 'skb-test',
    version: '0.3.0-test',
  },
  broker: {
    url: 'mock://broker',
  },
  topics: {
    in: {
      newNote: 'events.tangent.notes.new.v1',
    },
    out: {
      noteIndexed: 'events.skb.indexing.status.v1',
      noteFragmented: 'events.skb.note.fragmented.v1',
      graphUpdated: 'events.skb.graph.updated.v1',
    },
    internal: {
      graphUpdated: 'internal.skb.graph.updated.v1',
    },
  },
  http: {
    port: 3000,
    host: 'localhost',
  },
}));

// Mock the health server
jest.mock('../../src/health/server', () => ({
  startHealthServer: jest.fn(),
}));

describe('Graph Merging Integration', () => {
  const testDir = join(process.cwd(), 'tmp-integration-test');
  const graphPath = join(testDir, 'global_graph.json');
  const fragmentDir = join(testDir, 'fragments');
  
  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(fragmentDir, { recursive: true });
    
    // Override environment variables for testing
    process.env.GLOBAL_GRAPH_PATH = graphPath;
    process.env.FRAGMENT_DIR = fragmentDir;
    process.env.KGGEN_MODE = 'mock'; // Use mock KGGen
  });
  
  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    
    // Reset environment variables
    delete process.env.GLOBAL_GRAPH_PATH;
    delete process.env.FRAGMENT_DIR;
    delete process.env.KGGEN_MODE;
  });
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Clear mock messages
    const MockBroker = require('../../src/broker/adapter').BrokerAdapter;
    MockBroker.clearMessages();
  });
  
  it('should merge fragments into the global graph when processing notes', async () => {
    // Create a sample note event
    const noteEvent = {
      note_id: '123e4567-e89b-12d3-a456-426614174000',
      content: sampleNoteContent,
      author_id: 'test-author',
      event_id: 'event-123',
      timestamp: new Date().toISOString()
    };
    
    // Start the worker
    const mainPromise = main();
    
    // Wait a moment for initialization
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Publish a new note event
    const MockBroker = require('../../src/broker/adapter').BrokerAdapter;
    await new MockBroker().publish('events.tangent.notes.new.v1', noteEvent);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Get the graph_updated events
    const graphUpdatedEvents = MockBroker.getMessages('events.skb.graph.updated.v1');
    
    // Should have at least one graph_updated event
    expect(graphUpdatedEvents.length).toBeGreaterThan(0);
    
    // The global graph should exist on disk
    const graphFileExists = await fs.access(graphPath).then(() => true).catch(() => false);
    expect(graphFileExists).toBe(true);
    
    // Read the global graph file to verify contents
    const graphContent = await fs.readFile(graphPath, 'utf8');
    expect(graphContent).toContain('Entity One');
    expect(graphContent).toContain('Entity Two');
    
    // Clean up
    process.exit = jest.fn() as any;
    process.emit('SIGTERM');
  });
});