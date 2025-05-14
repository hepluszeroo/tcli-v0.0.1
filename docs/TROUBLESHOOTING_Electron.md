# Troubleshooting Electron/Playwright Integration

This document covers solutions for common issues with Electron/Playwright integration, particularly in the Docker CI environment.

## Synthetic Banner Issue

Starting with Electron 35 (Chromium 121), the DevTools banner that Playwright relies on to detect Electron startup is no longer emitted. We've implemented multiple fixes to address this issue.

### Problem: Malformed Banner Strings

The most common issue is that Electron fails to launch in the Docker CI environment due to malformed banner strings in the bundled `main.js` file. The error typically looks like:

```
electron.launch: Process failed to launch!
App threw an error during load
SyntaxError: Invalid or unexpected token at line 4825 in /repo/Tangent-main/apps/tangent-electron/__build/bundle/main.js
process.stderr.write('Debugger listening on ws://127.0.0.1:9222/synthetic_forced
```

This occurs when the bundler incorrectly handles template literals (`` `string` ``) during TypeScript compilation, resulting in malformed JavaScript.

### Solution 1: Fix the main.js Bundle (Recommended)

We've provided a script `scripts/fix-main-bundle.js` that automatically detects and fixes malformed banner strings in the bundled main.js file. This script:

1. Scans for malformed banner patterns
2. Creates a backup of the original main.js
3. Removes malformed patterns
4. Adds correctly-formatted banners at the top of the file

This script is automatically run by `docker-run-tests.sh` and should resolve the issue in most cases.

### Solution 2: Use Double Quotes Instead of Template Literals

To prevent the issue, we've updated the source code in `e2e_stub/main.ts` to use double quotes instead of template literals:

```typescript
// AVOID this format (can break during bundling):
process.stderr.write(`Debugger listening on ws://127.0.0.1:${port}/synthetic_forced\n`);

// USE this format instead (safer):
process.stderr.write("Debugger listening on ws://127.0.0.1:9222/synthetic_forced\n");
```

### Solution 3: Use the Ultra-Safe Stub

If other solutions fail, the script will attempt two fallback approaches:
1. Replacing the main.js with a simplified stub
2. Replacing the main.js with an ultra-safe direct JavaScript stub

You can also manually enable the ultra-safe stub by running:

```bash
# In Docker container
cp /repo/Tangent-main/apps/tangent-electron/src/testing/e2e_stub/main.ts.safe /repo/Tangent-main/apps/tangent-electron/src/testing/e2e_stub/main.ts
# Then rebuild and run tests
```

## General Electron/Playwright Troubleshooting

### Electron Not Starting in Docker

1. Verify Electron binary permissions:
   ```bash
   ls -l /repo/vendor/electron/dist/electron
   ```
   It should be executable (chmod +x)

2. Check for missing dependencies:
   ```bash
   ldd /repo/vendor/electron/dist/electron
   ```

3. Verify Xvfb is running:
   ```bash
   xdpyinfo
   ```

4. Check the electron.log file after a failure:
   ```bash
   cat /tmp/electron-debug.log
   ```

### Diagnosing Banner Issues

1. Use the diagnostic scripts:
   ```bash
   node /repo/scripts/check-malformed-banner.js /repo/Tangent-main/apps/tangent-electron/__build/bundle/main.js
   ```

2. Manually add banners to the beginning of main.js:
   ```bash
   echo 'process.stderr.write("Debugger listening on ws://127.0.0.1:9222/synthetic_forced\\n");' > temp.js
   cat /repo/Tangent-main/apps/tangent-electron/__build/bundle/main.js >> temp.js
   mv temp.js /repo/Tangent-main/apps/tangent-electron/__build/bundle/main.js
   ```

## Permanent Solutions

1. Replace all template literals in e2e_stub/main.ts with double-quoted strings
2. Add synthetic banners as early as possible in the file
3. Use a fixed port number (9222) instead of dynamic port assignment
4. Add a builder step that verifies the bundled main.js has properly formatted synthetic banners