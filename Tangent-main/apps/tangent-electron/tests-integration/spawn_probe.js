/**
 * Spawn probe - Test script to verify CodexProcessManager.launchCodex
 */

// Centralize paths for integration tests
const { MOCK_CODEX_PATH } = require('./pathHelpers');

// Set environment variables
process.env.MOCK_CODEX_PATH = MOCK_CODEX_PATH;
process.env.E2E_TEST = '1';
process.env.CODEX_TEST_MODE = '1';

console.log('MOCK_CODEX_PATH =', process.env.MOCK_CODEX_PATH);
console.log('File exists:', require('fs').existsSync(process.env.MOCK_CODEX_PATH));
console.log('File permissions:', require('fs').statSync(process.env.MOCK_CODEX_PATH).mode.toString(8));

// Try to import the module
try {
  console.log('Attempting to require CodexProcessManager...');
  const CodexProcessManagerPath = require.resolve('../src/main/codex_process_manager');
  console.log('CodexProcessManager path:', CodexProcessManagerPath);
  
  // Monkey patch child_process.spawn to log arguments
  const childProcess = require('child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function(cmd, args, options) {
    console.log('spawn called with:', { cmd, args, cwd: options?.cwd });
    return originalSpawn(cmd, args, options);
  };
  
  // Patch the module to expose more debug info
  const fs = require('fs');
  let moduleContent = fs.readFileSync(CodexProcessManagerPath, 'utf-8');
  
  // Add error logging in catch blocks
  moduleContent = moduleContent.replace(
    /catch\s*\([^)]*\)\s*{/g, 
    'catch (err) { console.error("launchCodex error:", err);'
  );
  
  // Make sure we always return the child process
  moduleContent = moduleContent.replace(
    /return\s+child;/g,
    'console.log("Returning child process with PID:", child?.pid); return child;'
  );
  
  // Write back the patched module
  const patchedPath = path.join(__dirname, 'patched_codex_manager.js');
  fs.writeFileSync(patchedPath, moduleContent);
  
  // Require the patched module
  console.log('Loading patched module...');
  const { launchCodex } = require(patchedPath);
  
  // Try to launch Codex
  console.log('Attempting to launch Codex...');
  launchCodex({ 
    headless: true,
    workspacePath: '/tmp/test-workspace'
  }).then(child => {
    console.log('Spawned child process:', child ? `PID ${child.pid}` : 'undefined');
    if (child) {
      // Listen for output
      child.stdout.on('data', data => {
        console.log(`Codex stdout: ${data}`);
      });
      child.stderr.on('data', data => {
        console.log(`Codex stderr: ${data}`);
      });
      
      // Kill after a short time
      setTimeout(() => {
        console.log('Killing child process...');
        child.kill();
        console.log('Test complete - launch successful');
        process.exit(0);
      }, 2000);
    } else {
      console.error('Failed to get child process handle');
      process.exit(1);
    }
  }).catch(err => {
    console.error('Launch failed with error:', err);
    process.exit(1);
  });
  
} catch (err) {
  console.error('Failed to load or run CodexProcessManager:', err);
  process.exit(1);
}