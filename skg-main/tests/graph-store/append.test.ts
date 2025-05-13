/**
 * Unit tests for the GraphStore incremental append functionality
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { GraphStore } from '../../src/graph-store';
import { KnowledgeFragment } from '../../src/types/knowledge_fragment.v1';
import { metrics } from '../../src/metrics/metrics';

// Mock the metrics module
jest.mock('../../src/metrics/metrics', () => ({
  metrics: {
    graphNodesTotal: { set: jest.fn() },
    graphEdgesTotal: { set: jest.fn() },
    graphUpdatesTotal: { inc: jest.fn() },
    aliasHitsTotal: { inc: jest.fn() },
    mergeConflictsTotal: { inc: jest.fn() },
    fragmentMergeTime: { startTimer: jest.fn().mockReturnValue(jest.fn()) },
    globalGraphFileBytes: { set: jest.fn() },
    graphCompactionsTotal: { inc: jest.fn() },
    graphCompactionTimeSeconds: { observe: jest.fn() },
    aliasMapReloadsTotal: { inc: jest.fn() },
    aliasMapReloadErrorsTotal: { inc: jest.fn() },
    aliasMapReloadTimeSeconds: { observe: jest.fn() },
    aliasMapSize: { set: jest.fn() },
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

// Mock event emitter for testing
const mockEventEmitter = jest.fn().mockResolvedValue(undefined);

describe('GraphStore Incremental Append', () => {
  // Use temporary test directory and files
  const testDir = join(process.cwd(), 'tmp-test-append');
  const testGraphPath = join(testDir, 'global_graph.json');
  const testAliasPath = join(testDir, 'alias_map.yml');
  const testFragmentDir = join(testDir, 'fragments');
  
  let store: GraphStore;

  // Sample fragments for testing
  const fragment1: KnowledgeFragment = {
    note_id: '123e4567-e89b-12d3-a456-426614174000',
    entities: [
      { id: 'e1', label: 'Entity One', type: 'Concept' }
    ],
    relations: ['related_to'],
    triples: [
      { subject: 'e1', predicate: 'related_to', object: 'e1' }
    ]
  };

  const fragment2: KnowledgeFragment = {
    note_id: '223e4567-e89b-12d3-a456-426614174001',
    entities: [
      { id: 'e1', label: 'Entity Two', type: 'Concept' }
    ],
    relations: ['knows'],
    triples: [
      { subject: 'e1', predicate: 'knows', object: 'e1' }
    ]
  };

  // This fragment has the same entity as fragment2 (for testing deduplication)
  const fragment3: KnowledgeFragment = {
    note_id: '323e4567-e89b-12d3-a456-426614174002',
    entities: [
      { id: 'e1', label: 'Entity Two', type: 'Concept' }
    ],
    relations: ['knows'],
    triples: [
      { subject: 'e1', predicate: 'knows', object: 'e1' }
    ]
  };

  // Setup: create test directories
  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(testFragmentDir, { recursive: true });
  });

  // Cleanup: remove test directories
  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // Reset mocks and create fresh graph file before each test
  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Ensure test graph path is empty
    try {
      await fs.unlink(testGraphPath);
    } catch (e) {
      // Ignore if file doesn't exist
    }
    
    // Create a fresh GraphStore instance
    store = new GraphStore(testGraphPath, testAliasPath, testFragmentDir);
    await store.init();
    
    // Set up event emitter
    store.setEventEmitter(mockEventEmitter);
  });

  it('should append new entities and triples to the global graph file', async () => {
    // Merge first fragment
    await store.merge_fragment(fragment1);
    
    // Read file contents after first merge
    const fileContent1 = await fs.readFile(testGraphPath, 'utf8');
    const lines1 = fileContent1.trim().split('\n');
    
    // Should have 2 lines: 1 entity + 1 triple
    expect(lines1.length).toBe(2);
    expect(JSON.parse(lines1[0]).type).toBe('entity');
    expect(JSON.parse(lines1[1]).type).toBe('triple');
    
    // Merge second fragment
    await store.merge_fragment(fragment2);
    
    // Read file contents after second merge
    const fileContent2 = await fs.readFile(testGraphPath, 'utf8');
    const lines2 = fileContent2.trim().split('\n');
    
    // Should have 4 lines: 2 entities + 2 triples
    expect(lines2.length).toBe(4);
    
    // Count entity and triple records
    const entities = lines2.filter(l => JSON.parse(l).type === 'entity');
    const triples = lines2.filter(l => JSON.parse(l).type === 'triple');
    expect(entities.length).toBe(2);
    expect(triples.length).toBe(2);
  });

  it('should not append anything when merging a duplicate fragment', async () => {
    // Merge first and second fragments
    await store.merge_fragment(fragment1);
    await store.merge_fragment(fragment2);

    // Read file contents after second merge
    const fileContent1 = await fs.readFile(testGraphPath, 'utf8');
    const lines1 = fileContent1.trim().split('\n');

    // Merge third fragment (duplicate of second)
    await store.merge_fragment(fragment3);

    // Read file contents after third merge
    const fileContent2 = await fs.readFile(testGraphPath, 'utf8');
    const lines2 = fileContent2.trim().split('\n');

    // Should have the same number of lines
    expect(lines2.length).toBe(lines1.length);

    // The file content should be identical
    expect(fileContent2).toBe(fileContent1);
  });

  it('should not touch the file when merging a fragment with no new entities or triples', async () => {
    // Create a fragment that will produce no deltas (all entities will be duplicates)
    const emptyDeltaFragment: KnowledgeFragment = {
      note_id: 'empty-delta',
      entities: [], // No entities
      relations: [],
      triples: []   // No triples
    };

    // First make sure we have a file with some content
    await store.merge_fragment(fragment1);

    // Get file stats before merge
    const statsBefore = await fs.stat(testGraphPath);
    const modTimeBefore = statsBefore.mtime.getTime();

    // Wait a moment to ensure modification time would change if file is touched
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now merge the empty delta fragment
    await store.merge_fragment(emptyDeltaFragment);

    // Get file stats after merge
    const statsAfter = await fs.stat(testGraphPath);
    const modTimeAfter = statsAfter.mtime.getTime();

    // The file modification time should not change
    expect(modTimeAfter).toBe(modTimeBefore);
  });

  it('should track deltas correctly during multiple merges', async () => {
    // Create custom fragments to test delta tracking
    const testFragment1: KnowledgeFragment = {
      note_id: 'delta-test-1',
      entities: [
        { id: 'e1', label: 'Delta Test 1', type: 'Concept' }
      ],
      relations: ['test'],
      triples: [
        { subject: 'e1', predicate: 'test', object: 'e1' }
      ]
    };
    
    const testFragment2: KnowledgeFragment = {
      note_id: 'delta-test-2',
      entities: [
        { id: 'e1', label: 'Delta Test 2', type: 'Concept' }
      ],
      relations: ['test'],
      triples: [
        { subject: 'e1', predicate: 'test', object: 'e1' }
      ]
    };
    
    // Merge multiple fragments
    await store.merge_fragment(testFragment1);
    await store.merge_fragment(testFragment2);
    
    // Read the file and parse each line
    const fileContent = await fs.readFile(testGraphPath, 'utf8');
    const lines = fileContent.trim().split('\n');
    
    // Count the entities and triples
    const entities = lines.filter(l => JSON.parse(l).type === 'entity');
    const triples = lines.filter(l => JSON.parse(l).type === 'triple');
    
    // Each fragment should add 1 entity and 1 triple
    expect(entities.length).toBe(2);
    expect(triples.length).toBe(2);
    
    // Verify correct content
    const entityObjects = entities.map(e => JSON.parse(e).data);
    const entityLabels = entityObjects.map(e => e.label);
    expect(entityLabels).toContain('Delta Test 1');
    expect(entityLabels).toContain('Delta Test 2');
  });
});