import { test, expect } from '@playwright/test';
import { launchElectron } from './electronHarness';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Safety rail test to ensure we're not passing problematic Electron binary paths
 * to Playwright. This test fails if we ever regress back to trying to use vendor
 * paths or CLI wrappers outside of explicit FORCE_PROJECT_ELECTRON mode.
 */
test('electron binary resolution follows best practices', async () => {
  // Save original FORCE_PROJECT_ELECTRON value
  const originalForceValue = process.env.FORCE_PROJECT_ELECTRON;
  
  try {
    // Remove any FORCE_PROJECT_ELECTRON setting for this test
    delete process.env.FORCE_PROJECT_ELECTRON;
    
    // Spy on _electron.launch by creating a temporary implementation
    let capturedPath: string | undefined;
    
    // Only care about the executablePath in the launch options
    const mockElectronLaunch = (options: any) => {
      capturedPath = options.executablePath;
      
      // Return a minimal mock with firstWindow, context, etc.
      return {
        firstWindow: async () => ({}),
        context: () => ({ pages: () => [] }),
        evaluate: async () => ({}),
        close: async () => {}
      };
    };
    
    // Patch the module temporarily
    const oldLaunch = (await import('@playwright/test'))._electron.launch;
    (await import('@playwright/test'))._electron.launch = mockElectronLaunch;
    
    try {
      // Create minimal build dir for testing
      const testDir = path.join(__dirname, '../__test_build');
      const testBundleDir = path.join(testDir, 'bundle');
      
      if (!fs.existsSync(testBundleDir)) {
        fs.mkdirSync(testBundleDir, { recursive: true });
      }
      
      // Create minimal test file
      const mainJsPath = path.join(testBundleDir, 'main.js');
      if (!fs.existsSync(mainJsPath)) {
        fs.writeFileSync(mainJsPath, 'module.exports = {}');
      }
      
      // Call launchElectron with test args
      await launchElectron({
        electronBinary: '/some/path/to/electron', // Should be ignored in default mode
        buildDir: testDir,
        mainEntry: mainJsPath,
        env: process.env
      });
      
      // CRITICAL ASSERTIONS - ensure we're not using any problematic paths
      
      // Verify we're not passing any executablePath at all (Playwright decides)
      expect(capturedPath).toBeUndefined();
      
      // Test with FORCE_PROJECT_ELECTRON=1 to check that path passthrough works
      process.env.FORCE_PROJECT_ELECTRON = '1';
      
      await launchElectron({
        electronBinary: '/some/path/to/electron',
        buildDir: testDir,
        mainEntry: mainJsPath,
        env: process.env
      });
      
      // In FORCE mode, the path should be passed through
      expect(capturedPath).toBe('/some/path/to/electron');
      
    } finally {
      // Restore original _electron.launch
      (await import('@playwright/test'))._electron.launch = oldLaunch;
    }
  } finally {
    // Restore original FORCE_PROJECT_ELECTRON value
    if (originalForceValue !== undefined) {
      process.env.FORCE_PROJECT_ELECTRON = originalForceValue;
    } else {
      delete process.env.FORCE_PROJECT_ELECTRON;
    }
  }
});