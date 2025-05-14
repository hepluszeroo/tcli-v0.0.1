# Tangent ↔ Codex Integration – Developer Guide

This repository brings the headless **@openai/codex** CLI into the Tangent Electron app.

The **quick-suite** (five Playwright specs) is our safety-net; it runs in Docker on every pull-request and locally in seconds.

## Architecture Compatibility Note

When running on arm64 hosts (like Apple Silicon Macs), the amd64 Electron binary may not work reliably in Docker. We've implemented an architecture detection and bypass mechanism to handle this case.

**If you're on Apple Silicon (M1/M2/M3):**
```bash
# Use the architecture-aware test runner
./scripts/run-arch-aware-tests.sh
```

For details, see [Architecture Compatibility](docs/ARCHITECTURE_COMPATIBILITY.md).

## Known Issues and Workarounds

### Electron/Playwright Child Process Stdio Issue

When running Playwright tests that launch Electron, there's a known issue on macOS where child processes spawned by Electron have undefined stdout pipes (child.stdout.fd === undefined). This causes communication failures between the Electron app and child processes that rely on stdout for IPC.

**Workaround Implemented:**
- Added file-based transport for IPC communications
- Enhanced error handling and diagnostics
- Modified tests to be more resilient

For detailed information about this issue and the solution, see:
- [M2.3.1_TestRegression_Solution.md](./dev_log/M2.3.1_TestRegression_Solution.md)
- [electron_stdio_minimal_reproducer.js](./scripts/electron_stdio_minimal_reproducer.js) - A minimal reproducer for the issue

## Running the quick suite locally

```
# Architecture-aware test runner (recommended for Apple Silicon)
./scripts/run-arch-aware-tests.sh

# Traditional approach (works on Intel/AMD)
./build_and_run.sh

# or via PNPM script / VS Code task
pnpm test:codex-quick      # identical to what CI executes (automatically downloads the Electron binary if missing)
```

Behind the scenes the script 

1. builds the E2E bundle (`pnpm --filter tangent_electron run build:test-e2e`),
2. builds a fresh Docker image **without cached layers** and passes a cache-busting argument `STUB_HASH=$(git rev-parse HEAD)`,
3. copies the latest `stub_main.js` / `stub_preload.js` into the container, and
4. runs `playwright test tests-integration/codex_*` with one worker.

> **Why the `--no-cache` build flag?**
>  Docker layer-caching can hide an updated stub.  The `STUB_HASH` build arg forces the final COPY layer to rebuild whenever the Git commit changes.

## Pre-push guard-rail

If you have Husky installed the quick-suite will run automatically when you `git push`.  Bypass with `git push --no-verify` in an emergency.

## Packing & asar note

When Tangent is packaged with `electron-builder`, Codex's child binary must live in `app.asar.unpacked`.  The helper `getCodexBinPath()` (added in M2.4) will handle this automatically.  For dev & test builds no action is required.

## Troubleshooting

If you encounter issues with Electron/Playwright tests in Docker:

- See [Troubleshooting Electron](docs/TROUBLESHOOTING_Electron.md) for synthetic banner and bundling issues
- See [Architecture Compatibility](docs/ARCHITECTURE_COMPATIBILITY.md) for arm64 host issues