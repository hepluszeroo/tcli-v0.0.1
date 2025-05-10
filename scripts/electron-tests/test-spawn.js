#!/usr/bin/env node

/**
 * Test script for Docker build: Test 3 - Binary execution with spawn
 * This tests if the electron binary can be executed in the Docker container.
 */

try {
  console.log('🔍 Starting Test 3: Electron binary execution with spawn');
  
  // First get the electron binary path 
  let electronPath;
  try {
    electronPath = require('electron');
    console.log('• Electron path from require:', electronPath);
  } catch (requireErr) {
    console.log('⚠️ Could not require electron, using fallback paths');
    // Fallback to common paths for electron binary
    electronPath = null;
  }
  
  // Check if the path exists or try fallbacks
  const fs = require('fs');
  const path = require('path');
  
  // List of possible locations for the electron binary
  const possiblePaths = [
    electronPath,
    '/repo/node_modules/electron/dist/electron',
    '/repo/node_modules/.bin/electron', 
    path.join(process.cwd(), 'node_modules/electron/dist/electron'),
    path.join(process.cwd(), 'node_modules/.bin/electron')
  ].filter(Boolean); // Remove any null/undefined values
  
  // Find the first path that exists
  let foundPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      foundPath = p;
      console.log('✅ Found existing electron binary at:', foundPath);
      break;
    } else {
      console.log(`• Electron not found at: ${p}`);
    }
  }
  
  if (!foundPath) {
    console.error('❌ Error: Could not find electron binary at any expected location');
    // List what's in node_modules to help debug
    try {
      const nodeModulesPath = path.join(process.cwd(), 'node_modules');
      if (fs.existsSync(nodeModulesPath)) {
        console.log('• Contents of node_modules:');
        fs.readdirSync(nodeModulesPath).forEach(file => {
          console.log(`  - ${file}`);
        });
        
        const electronDir = path.join(nodeModulesPath, 'electron');
        if (fs.existsSync(electronDir)) {
          console.log('• Contents of node_modules/electron:');
          fs.readdirSync(electronDir).forEach(file => {
            console.log(`  - ${file}`);
          });
        }
      }
    } catch (lsErr) {
      console.error('• Error listing node_modules:', lsErr.message);
    }
    
    process.exit(1);
  }
  
  // Now try to execute the binary using spawnSync
  console.log('• Running spawnSync with Electron binary:', foundPath);
  const { spawnSync } = require('child_process');
  const args = ['--version', '--no-sandbox'];
  console.log(`• Executing: ${foundPath} ${args.join(' ')}`);
  
  try {
    const result = spawnSync(foundPath, args, {
      encoding: 'utf8',
      timeout: 10000,
      env: { 
        ...process.env,
        ELECTRON_DISABLE_SANDBOX: '1'
      }
    });
    
    console.log('• Spawn result:');
    console.log(`  - Status: ${result.status}`);
    console.log(`  - Stdout: ${result.stdout?.trim() || '(empty)'}`);
    console.log(`  - Stderr: ${result.stderr?.trim() || '(empty)'}`);
    
    if (result.error) {
      console.error('• Spawn error:', result.error);
    }
    
    if (result.status !== 0) {
      console.error('❌ Error: Electron execution failed');
      process.exit(1);
    } else {
      console.log('✅ Success! Electron version:', result.stdout.trim());
    }
  } catch (spawnErr) {
    console.error('❌ Error during spawn execution:');
    console.error(spawnErr);
    process.exit(1);
  }
  
  console.log('✅ Test passed.');
  process.exit(0);
} catch (err) {
  console.error('❌ Error during test:');
  console.error(err);
  process.exit(1);
}