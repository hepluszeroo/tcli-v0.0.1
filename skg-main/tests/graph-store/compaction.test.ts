/**
 * Unit tests for the GraphStore compaction functionality
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { GraphStore } from '../../src/graph-store';
import { metrics } from '../../src/metrics/metrics';
import { COMPACT_THRESHOLD, COMPACT_MB_LIMIT } from '../../src/graph-store/compactor';

// Mock the metrics module
jest.mock('../../src/metrics/metrics', () => ({
  metrics: {
    graphNodesTotal: { set: jest.fn() },
    graphEdgesTotal: { set: jest.fn() },
    graphUpdatesTotal: { inc: jest.fn() },
    aliasHitsTotal: { inc: jest.fn() },
    mergeConflictsTotal: { inc: jest.fn() },
    fragmentMergeTime: { startTimer: jest.fn().mockReturnValue(jest.fn()) },
    graphCompactionsTotal: { inc: jest.fn() },
    graphCompactionTimeSeconds: { observe: jest.fn() },
    globalGraphFileBytes: { set: jest.fn() },
    aliasMapReloadsTotal: { inc: jest.fn() },
    aliasMapReloadErrorsTotal: { inc: jest.fn() },
    aliasMapReloadTimeSeconds: { observe: jest.fn() },
    aliasMapSize: { set: jest.fn() },
  },
}));

// Mock environment variables to set very low compaction thresholds for testing
const originalEnv = { ...process.env };
process.env.COMPACT_THRESHOLD = '2';
process.env.COMPACT_MB_LIMIT = '0.001';

// Mock the logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GraphStore Compaction', () => {
  // Use temporary test directory and files
  const testDir = join(process.cwd(), 'tmp-test-compaction');
  const testGraphPath = join(testDir, 'global_graph.json');
  const testAliasPath = join(testDir, 'alias_map.yml');
  const testFragmentDir = join(testDir, 'fragments');
  
  let store: GraphStore;

  // Mock event emitter for testing
  const mockEventEmitter = jest.fn().mockResolvedValue(undefined);

  // Setup: create test directories
  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(testFragmentDir, { recursive: true });
  });

  // Cleanup: remove test directories and restore env vars
  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    process.env = originalEnv;
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

  it('should perform compaction when threshold is reached', async () => {
    // Force compaction
    const compacted = await store.maybeCompact(true);
    
    // Should have performed compaction
    expect(compacted).toBe(true);
    
    // Metrics should be updated
    expect(metrics.graphCompactionsTotal.inc).toHaveBeenCalled();
    expect(metrics.graphCompactionTimeSeconds.observe).toHaveBeenCalled();
  });

  it('should not perform compaction when threshold is not reached', async () => {
    // Reset threshold to a high value for this test
    const originalThreshold = process.env.COMPACT_THRESHOLD;
    process.env.COMPACT_THRESHOLD = '1000';
    
    // Attempt compaction
    const compacted = await store.maybeCompact(false);
    
    // Should not have performed compaction
    expect(compacted).toBe(false);
    
    // Metrics should not be updated
    expect(metrics.graphCompactionsTotal.inc).not.toHaveBeenCalled();
    
    // Restore threshold
    process.env.COMPACT_THRESHOLD = originalThreshold;
  });

  it('should protect against concurrent compaction operations', async () => {
    // Intentionally slow down the compaction process
    const originalSaveMethod = (store as any).saveGlobalGraph;
    (store as any).saveGlobalGraph = async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return originalSaveMethod.call(store);
    };

    // Launch two compaction operations simultaneously
    const results = await Promise.all([
      store.maybeCompact(true),
      store.maybeCompact(true)
    ]);

    // One operation should succeed, one should be skipped
    expect(results).toEqual([true, false]);

    // Metrics should be incremented exactly once
    expect(metrics.graphCompactionsTotal.inc).toHaveBeenCalledTimes(1);

    // compactRunning flag should be reset to false after completion
    expect((store as any).compactRunning).toBe(false);

    // Restore original save method
    (store as any).saveGlobalGraph = originalSaveMethod;
  });

  it('should update lastCompaction timestamp after compaction', async () => {
    // Save original timestamps
    const beforeCompactTime = (store as any).lastCompaction;
    const beforeCompactDate = (store as any).lastCompactionTime;
    
    // Perform compaction
    await store.maybeCompact(true);
    
    // Timestamps should be updated
    expect((store as any).lastCompaction).toBeGreaterThan(beforeCompactTime);
    expect((store as any).lastCompactionTime).not.toBe(beforeCompactDate);
    
    // stats should include the new timestamp
    expect(store.stats.lastCompactionMs).toBe((store as any).lastCompaction);
  });

  it('should reset the merge counter after compaction', async () => {
    // Set a non-zero merge count
    (store as any).mergeCount = 10;
    
    // Perform compaction
    await store.maybeCompact(true);
    
    // Merge count should be reset
    expect((store as any).mergeCount).toBe(0);
  });
});