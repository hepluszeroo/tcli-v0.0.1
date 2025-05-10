#!/usr/bin/env node

/**
 * Test script for Docker build: Test 1 - require.resolve('electron')
 * This tests if electron can be resolved by Node.js in the Docker container.
 */

try {
  console.log('🔍 Starting Test 1: require.resolve(\'electron\')');
  console.log('• Node.js version:', process.version);
  console.log('• Current working directory:', process.cwd());
  console.log('• Module search paths:');
  
  // Print module paths in a more readable format
  module.paths.forEach((path, index) => {
    console.log(`  - [${index}] ${path}`);
  });
  
  // Try to resolve the electron module
  const electronPath = require.resolve('electron');
  console.log('✅ Success! Electron resolved at:', electronPath);
  
  // Verify the resolved path actually exists
  const fs = require('fs');
  if (!fs.existsSync(electronPath)) {
    console.error('❌ Error: Resolved path does not exist on filesystem:', electronPath);
    process.exit(1);
  }
  
  console.log('✅ Path existence verified. Test passed.');
  process.exit(0);
} catch (err) {
  console.error('❌ Error: Electron require.resolve failed:');
  console.error(err);
  process.exit(1); // Exit with error to fail the Docker build
}