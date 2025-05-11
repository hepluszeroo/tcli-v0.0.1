# Troubleshooting Guide: Tangent-Codex Integration

This document provides solutions to common issues you might encounter when working with the Tangent-Codex integration.

## Common Issues and Solutions

### Codex Process Not Starting

**Symptoms:**
- No Codex output appears in the sidebar
- Console shows no Codex process activity

**Potential Causes & Solutions:**

1. **Feature flag not enabled:**
   - Check that `enableCodexIntegration` is set to `true` in settings
   - Toggle the flag with: `window.api.settings.patch({ enableCodexIntegration: true })`

2. **Path resolution issue:**
   - Ensure the Codex CLI is installed correctly
   - If in development, check that `require.resolve('codex-cli/bin/codex.js')` works

3. **Crash throttling activated:**
   - If Codex crashed more than 2 times within 60 seconds, it will be disabled for the session
   - Restart the Tangent application to reset the crash counter

### NDJSON Parsing Errors

**Symptoms:**
- Codex process starts but no messages appear
- Console shows JSON parsing errors

**Solutions:**

1. **Check the Codex output format:**
   - Ensure Codex is running with the `--headless-json` flag
   - Verify that the output is valid NDJSON with one JSON object per line

2. **Buffer or line size issues:**
   - Oversized lines (>1MB) are dropped with an error; check if messages are extremely large
   - If a single object is large, consider breaking it into smaller chunks in the Codex CLI

### Resource Leaks

**Symptoms:**
- Application performance degrades over time
- Increased memory usage
- Application fails to exit cleanly

**Solutions:**

1. **Check process cleanup:**
   - Ensure `stop()` is called when windows are closed
   - Verify that no duplicate Codex processes are spawned

2. **Debug stream cleanup:**
   - Add `DEBUG=codex*` environment variable to see stream lifecycle logs
   - Check that stdin/stdout/stderr streams are being properly closed and unreferenced

### Integration Tests Failing

**Symptoms:**
- Playwright tests fail or timeout
- Inconsistent test results between environments

**Solutions:**

1. **Docker environment issues:**
   - Use `PLAYWRIGHT_IN_DOCKER=1` environment variable when running in containers
   - Ensure the mock Codex script path is correctly resolved in the test environment

2. **Race conditions:**
   - Increase timeouts for slow test environments (CI)
   - Use `await expect.poll()` rather than direct assertions for async operations

3. **Missing event handlers:**
   - Check that all event handlers (stdout, stderr, exit) are properly set up
   - Verify IPC channels are registered before the test begins checking for messages

## Debugging Tools

### Environment Variables

- `DEBUG=codex*`: Enable verbose logging for all Codex integration components
- `MOCK_CODEX_PATH`: Path to a mock Codex script for testing
- `MOCK_CODEX_ARGS`: Arguments to pass to the mock Codex script
- `INTEGRATION_TEST=1`: Enable special handling for integration test environments

### Common Commands

```bash
# Run unit tests for the parser
pnpm test

# Run just the Codex integration tests
pnpm test:codex-quick

# Run a specific test with debugging
DEBUG=codex* pnpm test:codex-quick codex_happy_path.test.ts

# Build and run in Docker
docker build --no-cache --build-arg STUB_HASH=$(git rev-parse HEAD) -f Dockerfile.playwright -t tangent-codex-tests .
docker run --rm -e PLAYWRIGHT_IN_DOCKER=1 tangent-codex-tests pnpm exec playwright test tests-integration/codex_*
```

## Common Error Messages and Their Meanings

| Error Message | Meaning | Solution |
|---------------|---------|----------|
| "Codex disabled – repeated crashes" | Crash throttle activated | Restart Tangent application |
| "Failed to spawn Codex CLI" | Path resolution or execution problem | Check MOCK_CODEX_PATH variable and file permissions |
| "Malformed JSON line" | Parser couldn't parse NDJSON | Check the output format of Codex CLI |
| "NDJSON buffer exceeded X bytes" | Message too large without newlines | Add newlines to break up output or increase buffer size |
| "Dropped oversized NDJSON line" | Single line too large | Reduce message size or increase maxLineBytes |
| "Codex did not start correctly (no data after 4s)" | First JSON timeout | Check if Codex is producing any output |

## CI Failure Cheatsheet 

| CI Failure | Typical Cause | Quick Fix |
|------------|---------------|-----------|
| `quick-codex` job red – Playwright times out after 30 s | Leaked child process keeps Electron alive | Run the suite locally; most likely a new assertion waits for a message that never arrives. Fix the logic or extend the timeout. |
| `quick-codex` red – missing `codex_ready` / out-of-order messages | Changed mock args but not expectations | Align the Playwright `expect()` lines. |
| Local run fails with `ENOENT Electron` | Electron binary not downloaded (post-install skipped) | Run `pnpm run electron:ensure` or just rerun `pnpm test:codex-quick` – the guard downloads it automatically. |
| Docker image still uses old `stub_main.js` | Forgot `--no-cache` / `STUB_HASH` arg | Re-run `build_and_run.sh` or `docker build --no-cache --build-arg STUB_HASH=$(git rev-parse HEAD)` |
| `EADDRINUSE` when Playwright launches | Previous Electron crashed but sockets linger | `pkill Electron` locally or restart Docker VM, then re-run. |
| Husky pre-push blocks you | Urgent WIP push | `git push --no-verify` (escape hatch) |