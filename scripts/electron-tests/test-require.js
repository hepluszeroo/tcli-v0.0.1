#!/usr/bin/env node

/**
 * Test script for Docker build: Test 2 - require('electron')
 * This tests if electron module can be required in the Docker container.
 */

try {
  console.log('🔍 Starting Test 2: require(\'electron\')');
  
  // Try to require the electron module
  let electronPath;
  try {
    electronPath = require('electron');
    console.log('✅ require(\'electron\') succeeded');
    console.log('• Returned value:', electronPath);
  } catch (requireErr) {
    console.error('❌ require(\'electron\') failed:');
    console.error(requireErr);
    process.exit(1);
  }
  
  // Check the type of the returned value
  console.log('• Type of returned value:', typeof electronPath);
  
  // If it's not a string, try to find the binary another way
  if (typeof electronPath !== 'string') {
    console.log('⚠️ Unexpected value type from require(\'electron\')');
    console.log('• Searching for alternative electron paths...');
    
    const fs = require('fs');
    const possiblePaths = [
      '/repo/node_modules/electron/dist/electron',
      '/repo/node_modules/.bin/electron',
      '/repo/node_modules/electron/electron'
    ];
    
    let foundAlternative = false;
    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        console.log('✅ Found alternative electron path:', path);
        electronPath = path;
        foundAlternative = true;
        break;
      } else {
        console.log(`• Path not found: ${path}`);
      }
    }
    
    if (!foundAlternative) {
      console.error('❌ Error: Could not find electron binary via alternative paths');
      process.exit(1);
    }
  }
  
  console.log('✅ Test passed.');
  process.exit(0);
} catch (err) {
  console.error('❌ Error during test:');
  console.error(err);
  process.exit(1);
}