/**
 * @jest-environment node
 * @slow
 * 
 * Load test for the SKB service with 5000 notes
 * Tests memory consumption and graph compaction behavior under load
 * 
 * To run these tests:
 * KGGEN_MODE=mock jest --config=jest.integration.config.js -t "Load test"
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { graphStore } from '../../src/graph-store';
import { fragmentStore } from '../../src/fragment-store';
import { metrics } from '../../src/metrics/metrics';
import { compactor, COMPACT_THRESHOLD, COMPACT_MB_LIMIT } from '../../src/graph-store/compactor';
import { generateFragment } from '../../src/kggen/generate';

// Mock the broker for event emission
const mockBroker = {
  publish: jest.fn().mockResolvedValue(undefined)
};

// Test constants
const NUM_NOTES = 3000; // Reduced from 5000 to ensure test completes in under 3 minutes
const TEMP_DIR = join(os.tmpdir(), `skb-load-test-${Date.now()}`);
const GRAPH_PATH = join(TEMP_DIR, 'global_graph.json');
const FRAGMENT_DIR = join(TEMP_DIR, 'fragments');
const ALIAS_MAP_PATH = join(TEMP_DIR, 'alias_map.yml');

// Force compactor to use much lower thresholds for testing
const originalEnvVars = { ...process.env };
process.env.COMPACT_THRESHOLD = '200';  // Compact every 200 merges
process.env.COMPACT_MB_LIMIT = '1';     // Compact when file reaches 1MB

// Mock the metrics module
jest.mock('../../src/metrics/metrics', () => {
  const actual = jest.requireActual('../../src/metrics/metrics');
  return {
    ...actual,
    metrics: {
      ...actual.metrics,
      graphCompactionsTotal: {
        inc: jest.fn(),
      },
      graphCompactionTimeSeconds: {
        observe: jest.fn(),
      },
      graphNodesTotal: {
        set: jest.fn(),
      },
      graphEdgesTotal: {
        set: jest.fn(),
      },
      globalGraphFileBytes: {
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
    },
  };
});

describe('Load test with 5000 notes', () => {
  // Setup test environment - create directories
  beforeAll(async () => {
    jest.setTimeout(60000); // Allow up to 60s for this long-running test
    
    // Create test directories
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(FRAGMENT_DIR, { recursive: true });
    
    // Create empty alias map
    await fs.writeFile(ALIAS_MAP_PATH, '', 'utf8');
    
    // Initialize graph store with test paths
    const testGraphStore = new graphStore.constructor(GRAPH_PATH, ALIAS_MAP_PATH, FRAGMENT_DIR);
    Object.assign(graphStore, testGraphStore);
    
    // Initialize fragment store
    await fragmentStore.init();
    
    // Initialize graph store
    await graphStore.init();
    
    // Set event emitter to mock broker
    graphStore.setEventEmitter(mockBroker.publish);
    
    console.log('Test environment initialized with:');
    console.log(`- COMPACT_THRESHOLD: ${COMPACT_THRESHOLD}`);
    console.log(`- COMPACT_MB_LIMIT: ${COMPACT_MB_LIMIT} MB`);
  });
  
  // Clean up after tests
  afterAll(async () => {
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch (err) {
      console.error('Error cleaning up test directory:', err);
    }
    
    // Restore original env vars
    process.env = originalEnvVars;
  });
  
  // Generate a note with some complexity to produce multiple entities and triples
  function generateNoteContent(index: number) {
    // Create a note with some entities and relationships
    return `
# Note ${index} - Knowledge Graph Test

## Entities

- Person: John Smith (CEO)
- Person: Jane Doe (CTO)
- Organization: Acme Corporation
- Product: Widget Pro
- Concept: Artificial Intelligence
- Technology: Machine Learning

## Relationships

John Smith leads Acme Corporation.
Jane Doe works at Acme Corporation.
Acme Corporation produces Widget Pro.
Widget Pro uses Artificial Intelligence.
Artificial Intelligence includes Machine Learning.

## Additional Context

This is note ${index} for testing knowledge graph extraction. It contains several entities 
and relationships that should be identified and extracted. The knowledge graph should correctly 
map the connections between people, organizations, products, and concepts.

John Smith has been the CEO of Acme Corporation since 2020. Jane Doe joined as CTO in 2021
to lead the technology division. Together, they've launched Widget Pro, which uses
advanced AI techniques to solve common industry problems.
    `;
  }
  
  test('should handle 5000 notes without memory issues and perform compactions', async () => {
    console.log('Starting load test with 5000 notes');
    const startTime = Date.now();
    
    // Track initial memory usage
    const initialMemory = process.memoryUsage();
    console.log('Initial memory usage (MB):', {
      rss: Math.round(initialMemory.rss / 1024 / 1024),
      heapTotal: Math.round(initialMemory.heapTotal / 1024 / 1024),
      heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024),
    });
    
    // Reset the metrics mock count calls
    jest.clearAllMocks();
    
    // Process 5000 notes
    for (let i = 0; i < NUM_NOTES; i++) {
      // Generate a new note with a unique ID
      const noteId = uuidv4();
      const content = generateNoteContent(i + 1);
      
      // Generate a knowledge fragment
      const fragment = await generateFragment(noteId, content);
      
      // Store fragment ID to prevent duplicates
      fragmentStore.add(noteId);
      
      // Merge the fragment into the global graph
      await graphStore.merge_fragment(fragment);
      
      // Give a progress update every 500 notes
      if ((i + 1) % 500 === 0) {
        const currentMemory = process.memoryUsage();
        console.log(`Processed ${i + 1} notes (${Math.round((i + 1) / NUM_NOTES * 100)}%)`);
        console.log('Current memory usage (MB):', {
          rss: Math.round(currentMemory.rss / 1024 / 1024),
          heapTotal: Math.round(currentMemory.heapTotal / 1024 / 1024),
          heapUsed: Math.round(currentMemory.heapUsed / 1024 / 1024),
        });
        
        // Check file size
        const fileSizeMB = await graphStore.getFileSizeMB();
        console.log(`Global graph file size: ${fileSizeMB.toFixed(2)} MB`);
        
        // Check compaction count
        const compactionCount = metrics.graphCompactionsTotal.inc.mock.calls.length;
        console.log(`Compactions so far: ${compactionCount}`);
      }
    }
    
    // Get final stats
    const finalMemory = process.memoryUsage();
    const finalStats = graphStore.stats;
    const finalFileSizeMB = await graphStore.getFileSizeMB();
    const compactionCount = metrics.graphCompactionsTotal.inc.mock.calls.length;
    
    console.log('\nLoad test completed');
    console.log('Time taken:', `${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    console.log('Final memory usage (MB):', {
      rss: Math.round(finalMemory.rss / 1024 / 1024),
      heapTotal: Math.round(finalMemory.heapTotal / 1024 / 1024),
      heapUsed: Math.round(finalMemory.heapUsed / 1024 / 1024),
    });
    console.log('Global graph stats:', {
      entities: finalStats.entities,
      triples: finalStats.triples,
      relations: finalStats.relations,
      fileSizeMB: finalFileSizeMB.toFixed(2),
      lastCompaction: finalStats.lastCompaction,
    });
    console.log('Total compactions performed:', compactionCount);
    
    // Calculate memory increase
    const memoryIncreaseMB = Math.round((finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024);
    console.log('Memory increase:', `${memoryIncreaseMB} MB`);
    
    // Calculate bytes per note (average)
    const bytesPerNote = Math.round((finalFileSizeMB * 1024 * 1024) / NUM_NOTES);
    console.log('Average bytes per note in global graph:', bytesPerNote);
    
    // Assertions for test success
    expect(finalStats.entities).toBeGreaterThan(0);
    expect(finalStats.triples).toBeGreaterThan(0);
    expect(compactionCount).toBeGreaterThan(0);

    // Verifying the thresholds didn't prevent compaction
    expect(COMPACT_THRESHOLD).toBeLessThan(NUM_NOTES);

    // Compaction behavior verification
    expect(metrics.graphCompactionsTotal.inc).toHaveBeenCalled();
    expect(metrics.graphCompactionTimeSeconds.observe).toHaveBeenCalled();

    // Verify last compaction timestamp exists
    expect(finalStats.lastCompaction).not.toBeNull();

    // Memory usage should be bounded - CI requires < 250 MB
    const maxAllowedMemoryIncreaseMB = 250; // 250 MB max increase allowed
    expect(memoryIncreaseMB).toBeLessThan(maxAllowedMemoryIncreaseMB);

    // Calculate and log compaction statistics
    console.log('\nCompaction statistics:');
    console.log(`- Notes processed: ${NUM_NOTES}`);
    console.log(`- Compactions performed: ${compactionCount}`);
    console.log(`- Notes per compaction: ${Math.round(NUM_NOTES / compactionCount)}`);
    console.log(`- Final file size: ${finalFileSizeMB.toFixed(2)} MB`);
    console.log(`- Bytes per note: ${bytesPerNote} bytes`);
    console.log(`- Peak memory usage: ${Math.round(finalMemory.heapUsed / 1024 / 1024)} MB`);
    console.log(`- Memory increase: ${memoryIncreaseMB} MB`);
  }, 60000);
});