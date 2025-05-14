/**
 * Integration test for KGGen
 * 
 * This test verifies that the real KGGen CLI works correctly.
 * It should be run in CI with the proper environment setup.
 * 
 * Mark this test with @slow to exclude it from normal test runs.
 */

import { join } from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { generateFragment, runKggenCli } from '../../src/kggen/generate';

// This is a long-running test
jest.setTimeout(120000);

// Only run this test when explicitly enabled
const KGGEN_REAL_TESTS = process.env.KGGEN_REAL_TESTS === 'true';

// Skip test if no OpenAI API key is available
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Sample test note content about neural networks
const TEST_NOTE = `
# Neural Networks and Deep Learning

Neural networks are computational models inspired by the human brain. They consist of layers of interconnected nodes or "neurons" that can learn patterns from data.

## Key Components

1. Input Layer: Receives initial data
2. Hidden Layers: Process information using weights and activation functions
3. Output Layer: Produces the final prediction or classification

Deep learning refers to neural networks with multiple hidden layers that can learn hierarchical representations.

## Common Architectures

- Convolutional Neural Networks (CNNs): Used for image processing
- Recurrent Neural Networks (RNNs): Handle sequential data like text
- Transformers: State-of-the-art models for natural language processing

The backpropagation algorithm allows networks to learn by updating weights based on prediction errors.
`;

describe('KGGen Integration Test @slow', () => {
  // Use a temporary fragment directory for testing
  const fragmentDir = join(__dirname, '..', '..', 'temp-fragments');
  
  beforeAll(() => {
    // Create fragment directory if it doesn't exist
    if (!fs.existsSync(fragmentDir)) {
      fs.mkdirSync(fragmentDir, { recursive: true });
    }
    
    // Set environment variables for the test
    process.env.FRAGMENT_DIR = fragmentDir;
    process.env.KGGEN_MODE = 'real'; // CRITICAL: Force real mode

    console.log('KGGEN_MODE set to:', process.env.KGGEN_MODE);
    if (process.env.KGGEN_MODE !== 'real') {
      throw new Error('KGGEN_MODE must be set to "real" for integration tests');
    }
    
    // Add to skip flags as needed
    if (!KGGEN_REAL_TESTS) {
      console.log('Skipping KGGen integration tests. To enable, set KGGEN_REAL_TESTS=true');
    }
    
    if (!OPENAI_API_KEY) {
      console.log('Skipping KGGen integration tests. Missing OPENAI_API_KEY');
    }
  });
  
  afterAll(() => {
    // Optionally clean up the fragment directory
    // fs.rmSync(fragmentDir, { recursive: true, force: true });
  });
  
  it('should execute KGGen CLI and generate a fragment file', async () => {
    // Skip test unless explicitly enabled and OpenAI API key is available
    if (!KGGEN_REAL_TESTS || !OPENAI_API_KEY) {
      return;
    }
    
    // Create input and output file paths
    const inputPath = join(fragmentDir, `test-input-${uuidv4()}.txt`);
    const outputPath = join(fragmentDir, `test-output-${uuidv4()}.json`);
    
    // Write test content to input file
    fs.writeFileSync(inputPath, TEST_NOTE, 'utf8');
    
    try {
      // Call runKggenCli directly - this will throw if exit code is non-zero
      await runKggenCli(inputPath, outputPath);
      
      // Verify the output file exists
      expect(fs.existsSync(outputPath)).toBe(true);
      
      // Verify the output file contains valid JSON
      const outputContent = fs.readFileSync(outputPath, 'utf8');
      const fragment = JSON.parse(outputContent);
      
      // Verify the fragment has the expected structure
      expect(fragment).toHaveProperty('entities');
      expect(fragment).toHaveProperty('relations');
      expect(fragment).toHaveProperty('triples');
      
      // Verify we have some entities
      expect(Array.isArray(fragment.entities)).toBe(true);
      expect(fragment.entities.length).toBeGreaterThan(0);
      
    } finally {
      // Clean up test files
      if (fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
      }
      // Keeping output file for inspection if needed
    }
  });
  
  it('should reject with error when KGGen fails (simulate with invalid path)', async () => {
    // Skip test unless explicitly enabled and OpenAI API key is available
    if (!KGGEN_REAL_TESTS || !OPENAI_API_KEY) {
      return;
    }
    
    // Use a non-existent input file to cause an error
    const nonExistentPath = join(fragmentDir, 'this-file-does-not-exist.txt');
    const outputPath = join(fragmentDir, `test-output-${uuidv4()}.json`);
    
    // Expect the function to reject with an error
    await expect(runKggenCli(nonExistentPath, outputPath))
      .rejects.toThrow();
  });
  
  it('should generate a fragment using the main API', async () => {
    // Skip test unless explicitly enabled and OpenAI API key is available
    if (!KGGEN_REAL_TESTS || !OPENAI_API_KEY) {
      return;
    }
    
    // Generate a unique note ID
    const noteId = uuidv4();
    
    // Call the main generateFragment function
    const fragment = await generateFragment(noteId, TEST_NOTE);
    
    // Verify the output
    expect(fragment).toBeDefined();
    expect(fragment.note_id).toBe(noteId);
    expect(Array.isArray(fragment.entities)).toBe(true);
    expect(fragment.entities.length).toBeGreaterThan(0);
    
    // Check that the file was created
    const fragmentPath = join(fragmentDir, `${noteId}.json`);
    expect(fs.existsSync(fragmentPath)).toBe(true);
  });
});