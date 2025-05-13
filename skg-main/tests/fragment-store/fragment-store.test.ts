/**
 * Unit tests for the FragmentStore class
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { FragmentStore } from '../../src/fragment-store';
import { metrics } from '../../src/metrics/metrics';

// Mock the metrics module
jest.mock('../../src/metrics/metrics', () => ({
  metrics: {
    fragmentsLoaded: {
      set: jest.fn(),
    },
    eventCacheSize: {
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

describe('FragmentStore', () => {
  // Use a temporary directory for tests
  const testDir = join(process.cwd(), 'tmp-test-fragments');
  let store: FragmentStore;

  // Create test fragments for loading tests
  const testFragments = [
    {
      note_id: '123e4567-e89b-12d3-a456-426614174000',
      entities: [{ id: 'e1', label: 'Entity 1', type: 'Concept' }],
      relations: ['is_related_to'],
      triples: [
        { subject: 'e1', predicate: 'is_related_to', object: 'e1' },
      ],
    },
    {
      note_id: '223e4567-e89b-12d3-a456-426614174001',
      entities: [{ id: 'e2', label: 'Entity 2', type: 'Person' }],
      relations: ['knows'],
      triples: [
        { subject: 'e2', predicate: 'knows', object: 'e2' },
      ],
    },
    // Invalid fragment (missing note_id)
    {
      entities: [{ id: 'e3', label: 'Entity 3', type: 'Location' }],
      relations: ['located_in'],
      triples: [
        { subject: 'e3', predicate: 'located_in', object: 'e3' },
      ],
    },
  ];

  // Setup: create test directory and files
  beforeAll(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });

    // Create test fragment files
    await fs.writeFile(
      join(testDir, `${testFragments[0].note_id}.json`),
      JSON.stringify(testFragments[0]),
      'utf8'
    );
    await fs.writeFile(
      join(testDir, `${testFragments[1].note_id}.json`),
      JSON.stringify(testFragments[1]),
      'utf8'
    );
    await fs.writeFile(
      join(testDir, 'invalid.json'),
      JSON.stringify(testFragments[2]),
      'utf8'
    );
    await fs.writeFile(
      join(testDir, 'not-json.txt'),
      'This is not a JSON file',
      'utf8'
    );
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
  it('should initialize with an empty set', () => {
    store = new FragmentStore(testDir);
    expect(store.size).toBe(0);
  });

  it('should load fragments from disk on init', async () => {
    store = new FragmentStore(testDir);
    await store.init();

    // Should have loaded the two valid fragments
    expect(store.size).toBe(2);
    expect(store.has(testFragments[0].note_id)).toBe(true);
    expect(store.has(testFragments[1].note_id)).toBe(true);
    expect(store.has('nonexistent')).toBe(false);

    // Should have updated the metrics
    expect(metrics.fragmentsLoaded.set).toHaveBeenCalledWith(2);
  });

  it('should handle errors for invalid fragments', async () => {
    store = new FragmentStore(testDir);
    await store.init();

    // The invalid fragment should be skipped, only the two valid ones are loaded
    expect(store.size).toBe(2);
  });

  it('should create directory if it does not exist', async () => {
    const nonExistentDir = join(testDir, 'nonexistent');
    store = new FragmentStore(nonExistentDir);
    await store.init();

    // Directory should be created
    const stat = await fs.stat(nonExistentDir);
    expect(stat.isDirectory()).toBe(true);

    // Store should be empty
    expect(store.size).toBe(0);
  });

  it('should track fragments with add() and has()', () => {
    store = new FragmentStore(testDir);
    expect(store.has('new-note-id')).toBe(false);
    
    store.add('new-note-id');
    expect(store.has('new-note-id')).toBe(true);
    expect(store.size).toBe(1);
    
    // Adding again should not increase size
    store.add('new-note-id');
    expect(store.size).toBe(1);

    // Should update metrics when adding
    expect(metrics.eventCacheSize.set).toHaveBeenCalledWith(1);
  });
});