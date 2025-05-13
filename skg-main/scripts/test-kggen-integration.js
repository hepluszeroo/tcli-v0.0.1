#!/usr/bin/env node
/**
 * Integration test for KGGen
 * 
 * This script tests the complete KGGen workflow:
 * 1. Sets up the environment
 * 2. Builds the TypeScript code
 * 3. Calls generateFragment with a sample note
 * 4. Displays the results
 * 
 * Usage:
 *   OPENAI_API_KEY=your-api-key node scripts/test-kggen-integration.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Import the generateFragment function from the built code
async function importGenerateFragment() {
  try {
    const { generateFragment } = require('../dist/kggen/generate');
    return generateFragment;
  } catch (error) {
    console.error(`Error importing generateFragment: ${error.message}`);
    process.exit(1);
  }
}

// Test note content about neural networks
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

async function runTest() {
  try {
    // Step 1: Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('Error: OPENAI_API_KEY environment variable is required.');
      process.exit(1);
    }

    // Set up KGGen environment if not already done
    console.log('Setting up KGGen environment...');
    try {
      execSync('./scripts/setup-kggen-env.sh', { stdio: 'inherit' });
    } catch (error) {
      console.error(`Error setting up KGGen environment: ${error.message}`);
      process.exit(1);
    }

    // Build the TypeScript code if needed
    console.log('Building TypeScript code...');
    try {
      execSync('npm run build', { stdio: 'inherit' });
    } catch (error) {
      console.error(`Error building code: ${error.message}`);
      process.exit(1);
    }

    // Create a test fragment directory if it doesn't exist
    const fragmentDir = process.env.FRAGMENT_DIR || './test-fragments';
    if (!fs.existsSync(fragmentDir)) {
      fs.mkdirSync(fragmentDir, { recursive: true });
    }

    // Generate a unique note ID
    const noteId = uuidv4();
    console.log(`Test note ID: ${noteId}`);

    // Import the generate function
    const generateFragment = await importGenerateFragment();

    console.log('========== INTEGRATION TEST ==========');
    console.log(`Using KGGEN_MODE: ${process.env.KGGEN_MODE || 'undefined (default: real)'}`);
    console.log(`Using KGGEN_BIN: ${process.env.KGGEN_BIN || 'undefined (default: python3)'}`);
    console.log(`Using KGGEN_SCRIPT: ${process.env.KGGEN_SCRIPT || 'undefined'}`);
    console.log('======================================');

    console.log('\nGenerating knowledge fragment...');
    console.log('This may take a minute or two depending on the model...\n');

    // Measure execution time
    const startTime = Date.now();

    // Generate the fragment
    const fragment = await generateFragment(noteId, TEST_NOTE);
    
    const duration = Date.now() - startTime;
    
    // Display the results
    console.log(`\n✓ Fragment generated successfully in ${duration}ms!`);
    console.log('\nFragment contents:');
    console.log(JSON.stringify(fragment, null, 2));

    // Output some stats
    console.log('\nStats:');
    console.log(`- Entities: ${fragment.entities.length}`);
    console.log(`- Relations: ${fragment.relations.length}`);
    console.log(`- Triples: ${fragment.triples.length}`);

    console.log('\n======================================');
    console.log('     INTEGRATION TEST SUCCESSFUL      ');
    console.log('======================================');

  } catch (error) {
    console.error('\nINTEGRATION TEST FAILED:');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
runTest();