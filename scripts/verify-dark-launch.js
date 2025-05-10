#!/usr/bin/env node
/**
 * Dark Launch Verification Script
 *
 * This script checks that Codex integration doesn't activate when
 * enableCodexIntegration is set to false (the default), which
 * is critical for the dark launch feature.
 *
 * It manually inspects the relevant files and verifies that:
 * 1. The default setting is properly configured as 'false'
 * 2. The code properly checks this flag before spawning the process
 */

const fs = require('fs');
const path = require('path');

// Configuration - Adding debug info for CI
console.log('Current directory:', process.cwd());
console.log('Script directory:', __dirname);

// Try both relative and absolute paths for more robustness
const REPO_ROOT = process.env.GITHUB_WORKSPACE || path.resolve(__dirname, '..');
console.log('Repository root:', REPO_ROOT);

// Enhanced path resolution with fallbacks
let TANGENT_DIR;
// First try the expected relative path (development environment)
const relPath = path.join(__dirname, '..', 'Tangent-main', 'apps', 'tangent-electron');
// Then try direct from repo root (CI environment)
const ciPath = path.join(REPO_ROOT, 'Tangent-main', 'apps', 'tangent-electron');

// Check which path exists
if (fs.existsSync(path.join(relPath, 'src'))) {
  TANGENT_DIR = relPath;
  console.log('Using relative path to Tangent directory:', TANGENT_DIR);
} else if (fs.existsSync(path.join(ciPath, 'src'))) {
  TANGENT_DIR = ciPath;
  console.log('Using CI path to Tangent directory:', TANGENT_DIR);
} else {
  console.log('WARNING: Could not find Tangent directory at expected paths');
  console.log('Checking for Tangent-main directory in repo root...');
  const rootPath = path.join(REPO_ROOT, 'Tangent-main');
  if (fs.existsSync(rootPath)) {
    console.log('Found Tangent-main at:', rootPath);
    console.log('Directory contents:', fs.readdirSync(rootPath));
    if (fs.existsSync(path.join(rootPath, 'apps'))) {
      console.log('apps directory contents:', fs.readdirSync(path.join(rootPath, 'apps')));
    }
  }
  // Default to the original path for backward compatibility
  TANGENT_DIR = relPath;
}

const COMMON_SETTINGS_PATH = path.join(TANGENT_DIR, 'src', 'common', 'settings', 'Settings.ts');
const WORKSPACE_PATH = path.join(TANGENT_DIR, 'src', 'main', 'Workspace.ts');
const SETTINGS_PATH = path.join(TANGENT_DIR, 'src', 'main', 'settings.ts');

console.log('Path to Settings.ts:', COMMON_SETTINGS_PATH);
console.log('Path to Workspace.ts:', WORKSPACE_PATH);
console.log('Path to settings.ts:', SETTINGS_PATH);

console.log('Verifying Dark Launch configuration...');

// Check 1: Verify Settings.ts defines enableCodexIntegration with default value = false
let defaultSettingsOk = false;
try {
  if (fs.existsSync(COMMON_SETTINGS_PATH)) {
    const settingsContent = fs.readFileSync(COMMON_SETTINGS_PATH, 'utf8');

    // Look for the enableCodexIntegration definition
    const definitionRegex = /enableCodexIntegration\s*=\s*new\s*Setting<boolean>\(\{[\s\S]*?defaultValue:\s*(false|true)[\s\S]*?\}\)/;
    const match = settingsContent.match(definitionRegex);

    if (match && match[1] === 'false') {
      console.log('✅ Settings.ts defines enableCodexIntegration with defaultValue: false');
      defaultSettingsOk = true;
    } else if (match) {
      console.log('❌ Settings.ts defines enableCodexIntegration with defaultValue:', match[1]);
    } else {
      console.log('❌ Could not find enableCodexIntegration definition in Settings.ts');
    }
  } else {
    console.log('❌ Settings.ts file not found at', COMMON_SETTINGS_PATH);
  }
} catch (error) {
  console.error('❌ Error checking Settings.ts:', error.message);
}

// Check 2: Verify Workspace.ts respects the flag
let workspaceChecksOk = false;
try {
  if (fs.existsSync(WORKSPACE_PATH)) {
    const workspaceContent = fs.readFileSync(WORKSPACE_PATH, 'utf8');

    // Look for the enableCodexIntegration subscription
    if (workspaceContent.includes('settings.enableCodexIntegration.subscribe')) {
      console.log('✅ Workspace.ts subscribes to enableCodexIntegration changes');

      // Look for conditional Codex activation based on the flag
      if (workspaceContent.includes('if (enabled)') &&
          workspaceContent.includes('this.codexManager = new CodexProcessManager')) {
        console.log('✅ Workspace.ts conditionally creates CodexProcessManager based on flag');
        workspaceChecksOk = true;
      } else {
        console.log('❌ Could not confirm Workspace.ts conditionally creates CodexProcessManager');
      }
    } else {
      console.log('❌ Could not find enableCodexIntegration subscription in Workspace.ts');
    }
  } else {
    console.log('❌ Workspace.ts not found at', WORKSPACE_PATH);
  }
} catch (error) {
  console.error('❌ Error checking Workspace.ts:', error.message);
}

// Check 3: Verify settings.ts loads and applies the flag
let settingsOk = false;
try {
  if (fs.existsSync(SETTINGS_PATH)) {
    const settingsContent = fs.readFileSync(SETTINGS_PATH, 'utf8');

    // Check if settings are loaded and saved properly
    if (settingsContent.includes('settings.applyPatch') &&
        settingsContent.includes('getRawValues')) {
      console.log('✅ settings.ts properly loads and saves settings');
      settingsOk = true;
    } else {
      console.log('❌ Could not confirm settings.ts loads and saves settings properly');
    }
  } else {
    console.log('❌ settings.ts not found at', SETTINGS_PATH);
  }
} catch (error) {
  console.error('❌ Error checking settings.ts:', error.message);
}

// Summary
console.log('\nDark Launch Verification Summary:');
console.log(`Default value check: ${defaultSettingsOk ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Workspace guard check: ${workspaceChecksOk ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Settings loading check: ${settingsOk ? '✅ PASS' : '❌ FAIL'}`);

const overallResult = defaultSettingsOk && workspaceChecksOk && settingsOk;
console.log(`\nOverall Dark Launch verification: ${overallResult ? '✅ PASSED' : '❌ FAILED'}`);

if (!overallResult) {
  process.exit(1);
}