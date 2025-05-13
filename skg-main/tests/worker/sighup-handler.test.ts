/**
 * Tests for worker SIGHUP signal handling
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { graphStore } from '../../src/graph-store';
import { logger } from '../../src/utils/logger';

// Mock the graph store
jest.mock('../../src/graph-store', () => ({
  graphStore: {
    reloadAliasMap: jest.fn().mockResolvedValue(true),
    // Include any other methods that might be called during tests
    init: jest.fn().mockResolvedValue(undefined),
    stats: { entities: 0, triples: 0, relations: 0, aliasMapEntries: 0 },
    setEventEmitter: jest.fn(),
    maybeCompact: jest.fn().mockResolvedValue(true),
  },
}));

// Mock the logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  },
}));

// Mock the broker adapter
jest.mock('../../src/broker/adapter', () => ({
  BrokerAdapter: {
    connect: jest.fn().mockResolvedValue({
      subscribe: jest.fn(),
      publish: jest.fn(),
      close: jest.fn(),
    }),
  },
}));

describe('Worker SIGHUP Handler', () => {
  // Store original process.on implementation
  const originalProcessOn = process.on;
  const originalProcessRemoveListener = process.removeListener;
  let sighupHandler: Function | null = null;
  
  beforeAll(() => {
    // Replace process.on to capture the SIGHUP handler
    process.on = jest.fn((signal, handler) => {
      if (signal === 'SIGHUP') {
        sighupHandler = handler;
      }
      return process as any;
    });
  });
  
  afterAll(() => {
    // Restore original process.on
    process.on = originalProcessOn;
    process.removeListener = originalProcessRemoveListener;
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should register a SIGHUP handler when the worker is initialized', async () => {
    // Import the main function from the worker
    const { main } = require('../../src/worker/skb-worker');
    
    // Initialize the worker (this will set up signal handlers)
    const mainPromise = main();
    
    // We need to wait a bit for the handlers to be registered
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check that process.on was called with SIGHUP
    expect(process.on).toHaveBeenCalledWith('SIGHUP', expect.any(Function));
    
    // Verify that the SIGHUP handler was captured
    expect(sighupHandler).not.toBeNull();
    
    // Clean up
    process.emit('SIGTERM', 'SIGTERM');
    await mainPromise;
  });
  
  it('should call graphStore.reloadAliasMap when SIGHUP is received', async () => {
    // Skip the test if no handler was captured
    if (!sighupHandler) {
      console.warn('SIGHUP handler was not captured, skipping test');
      return;
    }
    
    // Call the SIGHUP handler
    await sighupHandler();
    
    // Verify that reloadAliasMap was called
    expect(graphStore.reloadAliasMap).toHaveBeenCalled();
    
    // Verify that appropriate log messages were written
    expect(logger.info).toHaveBeenCalledWith('Received SIGHUP signal, reloading alias map');
    expect(logger.info).toHaveBeenCalledWith('Alias map reloaded successfully on SIGHUP');
  });
  
  it('should handle errors during alias map reload', async () => {
    // Skip the test if no handler was captured
    if (!sighupHandler) {
      console.warn('SIGHUP handler was not captured, skipping test');
      return;
    }
    
    // Make reloadAliasMap fail
    (graphStore.reloadAliasMap as jest.Mock).mockRejectedValueOnce(new Error('Test error'));
    
    // Call the SIGHUP handler
    await sighupHandler();
    
    // Verify that the error was logged
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Error handling SIGHUP for alias map reload'
    );
  });
  
  it('should log a warning when reload returns false', async () => {
    // Skip the test if no handler was captured
    if (!sighupHandler) {
      console.warn('SIGHUP handler was not captured, skipping test');
      return;
    }
    
    // Make reloadAliasMap return false (skipped or failed)
    (graphStore.reloadAliasMap as jest.Mock).mockResolvedValueOnce(false);
    
    // Call the SIGHUP handler
    await sighupHandler();
    
    // Verify that the warning was logged
    expect(logger.warn).toHaveBeenCalledWith('Alias map reload was skipped or failed on SIGHUP');
  });
});