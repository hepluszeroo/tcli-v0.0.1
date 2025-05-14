/**
 * Unit tests for the GraphStore class
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { GraphStore } from '../../src/graph-store';
import { KnowledgeFragment } from '../../src/types/knowledge_fragment.v1';
import { metrics } from '../../src/metrics/metrics';

// Mock the metrics module
jest.mock('../../src/metrics/metrics', () => ({
  metrics: {
    graphNodesTotal: {
      set: jest.fn(),
    },
    graphEdgesTotal: {
      set: jest.fn(),
    },
    graphUpdatesTotal: {
      inc: jest.fn(),
    },
    aliasHitsTotal: {
      inc: jest.fn(),
    },
    mergeConflictsTotal: {
      inc: jest.fn(),
    },
    fragmentMergeTime: {
      startTimer: jest.fn().mockReturnValue(jest.fn()),
    },
    graphCompactionsTotal: {
      inc: jest.fn(),
    },
    globalGraphFileBytes: {
      set: jest.fn(),
    },
    graphCompactionTimeSeconds: {
      observe: jest.fn(),
    },
    aliasMapReloadsTotal: {
      inc: jest.fn(),
    },
    aliasMapReloadErrorsTotal: {
      inc: jest.fn(),
    },
    aliasMapReloadTimeSeconds: {
      observe: jest.fn(),
    },
    aliasMapSize: {
      set: jest.fn(),
    },
  },
}));

// Mock the logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GraphStore', () => {
  // Use temporary directories for tests
  const testDir = join(process.cwd(), 'tmp-test-graph');
  const testGraphPath = join(testDir, 'global_graph.json');
  const testAliasPath = join(testDir, 'alias_map.yml');
  const testFragmentDir = join(testDir, 'fragments');
  
  let store: GraphStore;

  // Create test fragments for merging tests
  const testFragments: KnowledgeFragment[] = [
    {
      note_id: '123e4567-e89b-12d3-a456-426614174000',
      entities: [
        { id: 'e1', label: 'Test Entity 1', type: 'Concept' },
        { id: 'e2', label: 'Test Entity 2', type: 'Concept' }
      ],
      relations: ['related_to'],
      triples: [
        { subject: 'e1', predicate: 'related_to', object: 'e2' }
      ]
    },
    {
      note_id: '223e4567-e89b-12d3-a456-426614174001',
      entities: [
        { id: 'e1', label: 'Test Entity 1', type: 'Concept' },  // Duplicate entity with same label
        { id: 'e3', label: 'Test Entity 3', type: 'Person' }
      ],
      relations: ['knows'],
      triples: [
        { subject: 'e1', predicate: 'knows', object: 'e3' }
      ]
    },
    {
      note_id: '323e4567-e89b-12d3-a456-426614174002',
      entities: [
        { id: 'e4', label: 'Test Alias', type: 'Concept' },  // Will be aliased
        { id: 'e5', label: 'Test Entity 5', type: 'Location' }
      ],
      relations: ['located_in'],
      triples: [
        { subject: 'e4', predicate: 'located_in', object: 'e5' }
      ]
    }
  ];

  // Setup: create test directory and files
  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(testFragmentDir, { recursive: true });

    // Create test fragment files
    for (const fragment of testFragments) {
      await fs.writeFile(
        join(testFragmentDir, `${fragment.note_id}.json`),
        JSON.stringify(fragment),
        'utf8'
      );
    }

    // Create a test alias map
    const aliasMap = {
      'test alias': 'test entity 1'  // Maps "Test Alias" to "Test Entity 1" after normalization
    };
    await fs.writeFile(testAliasPath, 'test alias: test entity 1', 'utf8');
  });

  // Cleanup: remove test directory and files
  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // Reset mocks between tests
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Tests
  it('should initialize with empty data structures', () => {
    store = new GraphStore(testGraphPath, testAliasPath, testFragmentDir);
    expect(store.stats.entities).toBe(0);
    expect(store.stats.triples).toBe(0);
    expect(store.stats.relations).toBe(0);
  });

  it('should load the alias map', async () => {
    store = new GraphStore(testGraphPath, testAliasPath, testFragmentDir);
    await store.init();
    
    // Mock event emitter for testing
    const mockEventEmitter = jest.fn();
    store.setEventEmitter(mockEventEmitter);

    // Ensure the event emitter has been set
    expect((store as any).eventEmitter).toBeDefined();
    
    // Test alias resolution during fragment merge
    const fragment = testFragments[2]; // Fragment with "Test Alias" entity
    await store.merge_fragment(fragment);
    
    // Expect alias hit metric to be incremented
    expect(metrics.aliasHitsTotal.inc).toHaveBeenCalled();
  });

  it('should reconstruct from fragments if global graph is missing', async () => {
    // Make sure global graph doesn't exist yet
    try {
      await fs.unlink(testGraphPath);
    } catch (err) {
      // Ignore if file doesn't exist
    }
    
    store = new GraphStore(testGraphPath, testAliasPath, testFragmentDir);
    await store.init();
    
    // Should have reconstructed from the 3 fragments
    expect(store.stats.entities).toBeGreaterThan(0);
    expect(store.stats.triples).toBeGreaterThan(0);
    
    // Verify metrics were updated
    expect(metrics.graphNodesTotal.set).toHaveBeenCalled();
    expect(metrics.graphEdgesTotal.set).toHaveBeenCalled();
  });

  it('should merge fragments with deduplication', async () => {
    store = new GraphStore(testGraphPath, testAliasPath, testFragmentDir);
    await store.init();
    
    // Clear the store to start fresh
    await fs.writeFile(testGraphPath, '', 'utf8');
    await store.init();
    
    // Mock event emitter
    const mockEventEmitter = jest.fn();
    store.setEventEmitter(mockEventEmitter);
    // Ensure the emitter was properly registered
    expect((store as any).eventEmitter).toBe(mockEventEmitter);
    // Merge first fragment
    const stats1 = await store.merge_fragment(testFragments[0]);
    
    // First fragment should add all entities and triples
    expect(stats1.addedEntities).toBe(2);
    expect(stats1.addedTriples).toBe(1);
    expect(stats1.mergedEntities).toBe(0);
    
    // Merge second fragment with duplicate entity
    const stats2 = await store.merge_fragment(testFragments[1]);
    
    // Should merge the duplicate entity and add the new one
    expect(stats2.addedEntities).toBe(1);  // Only e3 is new
    expect(stats2.mergedEntities).toBe(1); // e1 is merged
    expect(stats2.addedTriples).toBe(1);   // New triple added
    
    // Event emitter should have been called for both merges
    expect(mockEventEmitter).toHaveBeenCalledTimes(4); // 2 internal + 2 external events
  });

  it('should handle merge conflicts gracefully', async () => {
    store = new GraphStore(testGraphPath, testAliasPath, testFragmentDir);
    await store.init();
    
    // Create a fragment with a bad triple reference
    const badFragment: KnowledgeFragment = {
      note_id: 'bad-fragment',
      entities: [
        { id: 'e1', label: 'Test Entity 1', type: 'Concept' }
      ],
      relations: ['connects_to'],
      triples: [
        { subject: 'e1', predicate: 'connects_to', object: 'e999' } // e999 doesn't exist
      ]
    };
    
    // Merge the fragment
    const stats = await store.merge_fragment(badFragment);
    
    // Should have one conflict and the conflict metric should be incremented
    expect(stats.conflicts).toBe(1);
    expect(metrics.mergeConflictsTotal.inc).toHaveBeenCalled();
  });
});