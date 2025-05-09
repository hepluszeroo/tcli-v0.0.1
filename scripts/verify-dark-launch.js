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

// Configuration
const TANGENT_DIR = path.join(__dirname, '..', 'Tangent-main', 'apps', 'tangent-electron');
const COMMON_SETTINGS_PATH = path.join(TANGENT_DIR, 'src', 'common', 'settings', 'Settings.ts');
const WORKSPACE_PATH = path.join(TANGENT_DIR, 'src', 'main', 'Workspace.ts');
const SETTINGS_PATH = path.join(TANGENT_DIR, 'src', 'main', 'settings.ts');

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