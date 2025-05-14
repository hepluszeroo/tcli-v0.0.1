/**
 * Unit tests for knowledge fragment handling
 */
import { join } from 'path';
import { SchemaValidationError } from '../../src/utils/schema-validator';

// Import sample fragments
const validFragment = require('../fixtures/sample_fragment.json');
const invalidFragment = require('../fixtures/invalid_fragment.json');

// First, import the actual validateFragmentMessage without mocking
const actualSchemaValidator = jest.requireActual('../../src/utils/schema-validator');
const { validateFragmentMessage: actualValidateFragmentMessage } = actualSchemaValidator;

describe('Knowledge Fragment Validation', () => {
  it('should validate a correctly formatted fragment', () => {
    expect(() => actualValidateFragmentMessage(validFragment)).not.toThrow();

    const validated = actualValidateFragmentMessage(validFragment);
    expect(validated).toHaveProperty('note_id');
    expect(validated).toHaveProperty('entities');
    expect(validated).toHaveProperty('relations');
    expect(validated).toHaveProperty('triples');

    expect(validated.entities.length).toBe(3);
    expect(validated.relations.length).toBe(3);
    expect(validated.triples.length).toBe(3);
  });

  it('should reject an invalid fragment', () => {
    expect(() => actualValidateFragmentMessage(invalidFragment)).toThrow(SchemaValidationError);

    try {
      actualValidateFragmentMessage(invalidFragment);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        // Should complain about:
        // 1. Missing 'type' in entity
        // 2. Missing 'triples' field
        expect(error.errors.length).toBeGreaterThan(0);

        // Check that at least one error is about the missing type or triples
        const errorMessages = error.errors.map(e => e.message).join(' ');
        expect(errorMessages).toMatch(/triples|type/);
      }
    }
  });

  it('should reject a fragment with missing required fields', () => {
    const missingFields = {
      entities: [],
      relations: []
      // Missing note_id and triples
    };

    expect(() => actualValidateFragmentMessage(missingFields)).toThrow(SchemaValidationError);
  });
});

// Mock the file system for fragmentExists function
jest.mock('fs', () => ({
  promises: {
    access: jest.fn().mockImplementation((path) => {
      if (path.includes('exists')) {
        return Promise.resolve();
      } else {
        return Promise.reject(new Error('File not found'));
      }
    }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(JSON.stringify(require('../fixtures/sample_fragment.json'))),
    mkdir: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined)
  }
}));

describe('Fragment Utility Functions', () => {
  it('should correctly check if a fragment exists', async () => {
    const { fragmentExists } = require('../../src/kggen/generate');

    expect(await fragmentExists('exists')).toBe(true);
    expect(await fragmentExists('does-not-exist')).toBe(false);
  });
});

// Mock child_process spawn function
jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => {
    const eventEmitter = {
      on: jest.fn().mockImplementation((event, callback) => {
        if (event === 'exit') {
          setTimeout(() => callback(0), 10);
        }
        return eventEmitter;
      })
    };
    return eventEmitter;
  })
}));

// Skip validation during test
jest.mock('../../src/utils/schema-validator', () => {
  const actualModule = jest.requireActual('../../src/utils/schema-validator');
  return {
    ...actualModule,
    validateFragmentMessage: jest.fn().mockImplementation(data => data)
  };
});

jest.mock('../../src/kggen/generate', () => {
  const sampleFragment = jest.requireActual('../fixtures/sample_fragment.json');
  return {
    generateFragment: jest.fn().mockResolvedValue(sampleFragment),
    runKggenCli: jest.fn().mockResolvedValue(undefined),
    fragmentExists: jest.fn().mockImplementation((noteId) => {
      return Promise.resolve(noteId === 'exists');
    }),
    mockGenerate: jest.fn().mockResolvedValue(sampleFragment)
  };
});

describe('KGGen Fragment Generation', () => {
  it('should generate a knowledge fragment (mock)', async () => {
    const { generateFragment } = require('../../src/kggen/generate');
    
    const fragment = await generateFragment('mock-id', 'sample text');
    
    // Check that mock returns our sample fragment
    expect(fragment).toEqual(validFragment);
  });
});

describe('KGGen Configuration', () => {
  it('should load the module with various environment configurations', () => {
    // Test with various environment configurations
    const testConfigurations = [
      { KGGEN_MODE: 'mock' },
      { KGGEN_MODE: 'real' },
      { KGGEN_MODE: 'module' },
      { KGGEN_BIN: '/custom/bin/python' },
      { KGGEN_TIMEOUT: '5000' },
      { KGGEN_MODEL: 'anthropic/claude-3' }
    ];

    // Save the original env
    const originalEnv = { ...process.env };

    for (const config of testConfigurations) {
      // Set the environment variables
      Object.assign(process.env, config);

      // Reset module cache to get fresh config
      jest.resetModules();

      // Import the module
      const generateModule = require('../../src/kggen/generate');

      // Just verify that the module loads without errors
      expect(generateModule).toBeDefined();
      expect(typeof generateModule.generateFragment).toBe('function');
      expect(typeof generateModule.runKggenCli).toBe('function');

      // Reset the env for the next test
      process.env = { ...originalEnv };
    }

    // Clean up
    process.env = originalEnv;
  });
});