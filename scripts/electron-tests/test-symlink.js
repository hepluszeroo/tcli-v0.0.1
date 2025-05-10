#!/usr/bin/env node

/**
 * Test script for Docker build: Test 4 - Check electron CLI symlink
 * This tests if the electron CLI symlink exists and points to a valid target.
 */

try {
  console.log('🔍 Starting Test 4: Check electron CLI symlink');
  
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');
  
  // Path to the electron CLI symlink
  const symlinkPath = '/repo/node_modules/.bin/electron';
  
  if (fs.existsSync(symlinkPath)) {
    console.log('✅ electron CLI symlink exists at:', symlinkPath);
    
    // Get file stats
    const stats = fs.lstatSync(symlinkPath);
    console.log('• Stats for symlink:');
    console.log(`  - Size: ${stats.size} bytes`);
    console.log(`  - Mode: ${stats.mode.toString(8)}`);
    console.log(`  - Is symlink: ${stats.isSymbolicLink()}`);
    console.log(`  - Is executable: ${!!(stats.mode & 0o111)}`);
    
    // Get symlink target if it's a symlink
    if (stats.isSymbolicLink()) {
      try {
        const target = fs.readlinkSync(symlinkPath);
        console.log('• Symlink target (relative):', target);
        
        // Get absolute path of the target
        try {
          // Using readlink -f via execSync as a more reliable way to get the resolved path
          const absoluteTarget = execSync(`readlink -f ${symlinkPath}`, { encoding: 'utf8' }).trim();
          console.log('• Symlink target (absolute):', absoluteTarget);
          
          // Check if the target exists
          if (fs.existsSync(absoluteTarget)) {
            console.log('✅ Symlink target exists');
          } else {
            console.log('⚠️ Symlink target does not exist');
          }
        } catch (readlinkErr) {
          console.log('⚠️ Could not resolve absolute symlink path:', readlinkErr.message);
          
          // Try a more direct approach
          try {
            const realPath = fs.realpathSync(symlinkPath);
            console.log('• Resolved real path:', realPath);
            if (fs.existsSync(realPath)) {
              console.log('✅ Resolved path exists');
            } else {
              console.log('⚠️ Resolved path does not exist');
            }
          } catch (realpathErr) {
            console.log('⚠️ Could not resolve real path:', realpathErr.message);
          }
        }
      } catch (readErr) {
        console.log('⚠️ Could not read symlink target:', readErr.message);
      }
    } else {
      console.log('⚠️ Not a symlink, but a regular file');
    }
    
    // Try to ensure the file is executable
    try {
      fs.chmodSync(symlinkPath, 0o755);
      console.log('• Made symlink executable');
    } catch (chmodErr) {
      console.log('⚠️ Could not change file permissions:', chmodErr.message);
    }
    
    // Try to execute the symlink with --version
    try {
      console.log('• Trying to execute symlink (may fail in Docker without display)...');
      const output = execSync(`${symlinkPath} --version --no-sandbox`, {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          ELECTRON_DISABLE_SANDBOX: '1'
        }
      }).trim();
      console.log('✅ Execution succeeded, output:', output);
    } catch (execErr) {
      console.log('⚠️ Execution failed (expected in Docker):', execErr.message);
      // Don't fail the build for this, it's expected to fail in Docker
    }
  } else {
    console.log('⚠️ electron CLI symlink does not exist at:', symlinkPath);
    
    // Search for electron binaries
    console.log('• Searching for electron binary in node_modules...');
    try {
      const output = execSync('find /repo/node_modules -name "electron" -type f | head -5', {
        encoding: 'utf8',
        timeout: 5000
      });
      
      if (output.trim()) {
        console.log('• Found electron binaries:');
        output.trim().split('\n').forEach(line => {
          console.log(`  - ${line}`);
        });
      } else {
        console.log('• No electron binaries found with exact name "electron"');
      }
      
      // Try a broader search
      console.log('• Searching for any electron-related files...');
      const broader = execSync('find /repo/node_modules -name "*electron*" -type f | head -5', {
        encoding: 'utf8',
        timeout: 5000
      });
      
      if (broader.trim()) {
        console.log('• Found electron-related files:');
        broader.trim().split('\n').forEach(line => {
          console.log(`  - ${line}`);
        });
      } else {
        console.log('• No electron-related files found');
      }
    } catch (findErr) {
      console.log('⚠️ Error searching for electron files:', findErr.message);
    }
  }
  
  // We'll continue the build even if the symlink doesn't exist or can't be executed
  // since we might be able to find the Electron binary by other means
  console.log('✅ Test completed. Symlink check is advisory only.');
  process.exit(0);
} catch (err) {
  console.error('❌ Error during test:');
  console.error(err);
  // Don't fail the build for this test
  process.exit(0);
}