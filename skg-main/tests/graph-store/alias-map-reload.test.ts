/**
 * Unit tests for the GraphStore alias map reload functionality
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { GraphStore } from '../../src/graph-store';
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
    graphCompactionsTotal: { inc: jest.fn() },
    graphCompactionTimeSeconds: { observe: jest.fn() },
    globalGraphFileBytes: { set: jest.fn() },
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

describe('GraphStore Alias Map Reload', () => {
  // Use temporary directories for tests
  const testDir = join(process.cwd(), 'tmp-test-alias-reload');
  const testGraphPath = join(testDir, 'global_graph.json');
  const testAliasPath = join(testDir, 'alias_map.yml');
  const testFragmentDir = join(testDir, 'fragments');
  
  let store: GraphStore;

  // Setup: create test directories
  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(testFragmentDir, { recursive: true });
    
    // Create initial alias map
    await fs.writeFile(testAliasPath, 'test alias: test canonical\nold alias: old canonical', 'utf8');
  });

  // Cleanup: remove test directories
  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // Reset mocks between tests
  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Create a fresh GraphStore instance
    store = new GraphStore(testGraphPath, testAliasPath, testFragmentDir);
    await store.init();
  });

  it('should load the alias map during initialization', async () => {
    // Check that the alias map is loaded during init()
    expect(store.stats.aliasMapEntries).toBe(2);
  });

  it('should reload the alias map when requested', async () => {
    // Change the alias map file
    await fs.writeFile(testAliasPath, 'test alias: test canonical\nnew alias: new canonical', 'utf8');
    
    // Reload the alias map
    const result = await store.reloadAliasMap();
    
    // Should have succeeded
    expect(result).toBe(true);
    
    // Alias count should still be 2 (but with different entries)
    expect(store.stats.aliasMapEntries).toBe(2);
    
    // Metrics should be updated
    expect(metrics.aliasMapReloadsTotal.inc).toHaveBeenCalled();
    expect(metrics.aliasMapReloadTimeSeconds.observe).toHaveBeenCalled();
  });

  it('should handle failures when reloading the alias map', async () => {
    // Create a mocked implementation that throws an error
    const originalLoadAliasMap = (store as any).loadAliasMap;
    (store as any).loadAliasMap = jest.fn().mockRejectedValueOnce(new Error('Simulated error'));

    // Attempt to reload the alias map
    const result = await store.reloadAliasMap();

    // Should have failed
    expect(result).toBe(false);

    // Metrics should be updated, even on failure
    expect(metrics.aliasMapReloadTimeSeconds.observe).toHaveBeenCalled();

    // Restore original function
    (store as any).loadAliasMap = originalLoadAliasMap;
  });

  it('should protect against concurrent alias map reloads', async () => {
    // Create a slow reload function
    const originalLoadAliasMap = (store as any).loadAliasMap;
    (store as any).loadAliasMap = async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return originalLoadAliasMap.call(store);
    };
    
    // Launch two reload operations simultaneously
    const results = await Promise.all([
      store.reloadAliasMap(),
      store.reloadAliasMap()
    ]);
    
    // One operation should succeed, one should be skipped
    expect(results).toEqual([true, false]);
    
    // Metrics should be incremented exactly once
    expect(metrics.aliasMapReloadsTotal.inc).toHaveBeenCalledTimes(1);
    
    // aliasMapReloading flag should be reset to false after completion
    expect((store as any).aliasMapReloading).toBe(false);
    
    // Restore original function
    (store as any).loadAliasMap = originalLoadAliasMap;
  });
  
  it('should update alias map entries correctly', async () => {
    // Create initial alias map
    await fs.writeFile(testAliasPath, 'test alias: test canonical\nold alias: old canonical', 'utf8');

    // Force reload to ensure we have the right starting state
    await store.reloadAliasMap();

    // Initial alias map should have 2 entries
    expect(store.stats.aliasMapEntries).toBe(2);

    // Update alias map with more entries
    await fs.writeFile(testAliasPath, 'test alias: test canonical\nold alias: old canonical\nnew alias: new canonical\nfourth alias: fourth canonical', 'utf8');

    // Reload the alias map
    await store.reloadAliasMap();

    // Should now have 4
    expect(store.stats.aliasMapEntries).toBe(4);

    // Update with fewer entries
    await fs.writeFile(testAliasPath, 'single alias: single canonical', 'utf8');

    // Reload the alias map
    await store.reloadAliasMap();

    // Should now have 1
    expect(store.stats.aliasMapEntries).toBe(1);
  });
  
  it('should use updated aliases after reload', async () => {
    // Create a simplified test that directly calls the private resolveAlias method
    // rather than using the merge_fragment method which would be more complex to test

    // Set up a specific alias map
    await fs.writeFile(testAliasPath, 'test alias: canonical form', 'utf8');
    await store.reloadAliasMap();

    // Access the private resolveAlias method using type casting
    const resolveAlias = (store as any).resolveAlias.bind(store);

    // Test resolving a known alias
    const result1 = resolveAlias('test alias');
    expect(result1).toBe('canonical form');

    // Change the alias map
    await fs.writeFile(testAliasPath, 'new alias: new canonical', 'utf8');
    await store.reloadAliasMap();

    // The old alias should no longer work
    const result2 = resolveAlias('test alias');
    expect(result2).toBe('test alias'); // Returns the input when no alias is found

    // The new alias should work
    const result3 = resolveAlias('new alias');
    expect(result3).toBe('new canonical');
  });
});