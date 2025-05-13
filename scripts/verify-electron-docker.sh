#!/usr/bin/env bash
# Complete troubleshooting script for Electron in Docker
# Run this after building the Docker image to verify all critical components

set -euo pipefail
echo "============================================================"
echo "🔍 COMPREHENSIVE ELECTRON DOCKER VERIFICATION"
echo "============================================================"

echo "Building Docker image..."
docker build -t tangent-codex-tests -f Dockerfile.playwright .

echo "Running verification steps..."
docker run --rm --platform linux/amd64 tangent-codex-tests bash -lc '
set -euxo pipefail

echo "============================================================"
echo "✅ A. ONE-MINUTE SANITY CHECK"
echo "============================================================"

echo "1. Verifying Electron binary and sandbox permissions..."
file -L /repo/bin/electron | grep "ELF 64-bit" && echo "✓ Electron binary is ELF"
if [ -f "/repo/vendor/electron/dist/chrome-sandbox" ]; then
  stat -c "%a %u:%g" /repo/vendor/electron/dist/chrome-sandbox | grep 4755 && echo "✓ Chrome sandbox has 4755 permissions"
else
  echo "❌ Chrome sandbox not found!"
  exit 1
fi

echo "2. Verifying preload and renderer HTML exist..."
PRELOAD_PATH="/repo/Tangent-main/apps/tangent-electron/__build/bundle/preload.js"
RENDERER_PATH="/repo/Tangent-main/apps/tangent-electron/__build/bundle/renderer.html"

if [ -s "$PRELOAD_PATH" ]; then
  echo "✓ preload.js exists and is not empty"
else
  echo "❌ preload.js missing or empty at $PRELOAD_PATH!"
  exit 1
fi

if [ -s "$RENDERER_PATH" ]; then
  echo "✓ renderer.html exists and is not empty"
else
  echo "❌ renderer.html missing or empty at $RENDERER_PATH!"
  exit 1
fi

echo "3. Testing quick headless Electron launch..."
Xvfb :99 -screen 0 1280x720x24 -ac &
export DISPLAY=:99
sleep 1

# Create exception handlers to capture errors
mkdir -p /tmp/electron-debug
cat > /tmp/electron-debug/exception-handlers.js << EOL
// Fatal exception handlers to capture errors that kill Electron
process.on("uncaughtException", (err) => {
  require("fs").writeFileSync("/tmp/electron-debug/uncaught.txt", err.stack, "utf8");
  console.error("[MAIN] FATAL: uncaughtException", err);
});
process.on("unhandledRejection", (err) => {
  require("fs").writeFileSync("/tmp/electron-debug/unhandled.txt", String(err), "utf8");
  console.error("[MAIN] FATAL: unhandledRejection", err);
});
// Add preload error handler
process.on("exit", (code) => {
  console.error("[MAIN] Process exiting with code:", code);
  require("fs").writeFileSync("/tmp/electron-debug/exit-code.txt", String(code), "utf8");
});
EOL

# Patch stub_main.js to include exception handlers
STUB_FILE="/repo/Tangent-main/apps/tangent-electron/__build/bundle/main.js"
sed -i "1r /tmp/electron-debug/exception-handlers.js" "$STUB_FILE"

# Run Electron with debug flags
echo "Running Electron with debug flags in headless environment..."
ELECTRON_ENABLE_LOGGING=1 DEBUG=electron*,electron:* /repo/bin/electron --no-sandbox "$STUB_FILE" &
ELECTRON_PID=$!
sleep 3

# Verify if Electron is still running
if pgrep -x electron >/dev/null; then
  echo "✓ Electron is still running after 3 seconds"
  # Check for child processes (renderers)
  if pgrep -P $ELECTRON_PID >/dev/null; then
    echo "✓ Electron has spawned child processes (renderers)"
    echo "Child processes:"
    pgrep -P $ELECTRON_PID
  else
    echo "⚠️ Electron is running but has no child processes"
  fi
  
  # Try to kill Electron cleanly
  kill $ELECTRON_PID || true
else
  echo "❌ Electron process died!"
  echo "Checking for error logs..."
  for file in /tmp/electron-debug/*.txt; do
    if [ -f "$file" ]; then
      echo "========== $(basename "$file") =========="
      cat "$file"
    fi
  done
  exit 1
fi

echo "============================================================"
echo "✅ B. HUMAN ERROR CHECKS"
echo "============================================================"

echo "1. Checking for CLI wrapper usage in Docker..."
grep -r "require.resolve(\"electron/cli.js\")" /repo/Tangent-main/apps/tangent-electron/tests-integration || echo "✓ No unwrapped CLI usage found"

echo "2. Checking for ELECTRON_RUN_AS_NODE leaks..."
grep -r "electronEnv.ELECTRON_RUN_AS_NODE = " /repo/Tangent-main/apps/tangent-electron/tests-integration || echo "✓ No ELECTRON_RUN_AS_NODE assignment found"
grep -r "delete electronEnv.ELECTRON_RUN_AS_NODE" /repo/Tangent-main/apps/tangent-electron/tests-integration && echo "✓ ELECTRON_RUN_AS_NODE deletion found"

echo "3. Checking BrowserWindow creation in stub_main.js..."
grep -A 5 "new BrowserWindow" "$STUB_FILE" | grep "show: !isDocker" && echo "✓ BrowserWindow created hidden in Docker"

echo "4. Checking for duplicate Xvfb starts and DISPLAY variable..."
grep -r "xvfb-run" /repo/scripts/docker-run-tests.sh || echo "✓ No xvfb-run in docker-run-tests.sh"
grep "export DISPLAY=:99" /repo/scripts/docker-run-tests.sh && echo "✓ DISPLAY=:99 exported"

echo "5. Verifying renderer.html path resolution..."
cat "$STUB_FILE" | grep -A 3 "loadFile" | grep "resolve" && echo "✓ renderer.html loaded with path.resolve"

echo "============================================================"
echo "✅ D. MANUAL PLAYWRIGHT REPRODUCTION"
echo "============================================================"
# Reset X server
pkill Xvfb || true
Xvfb :99 -screen 0 1280x720x24 -ac &
export DISPLAY=:99
sleep 1

echo "Running Electron with complete debugging..."
ELECTRON_ENABLE_LOGGING=1 DEBUG=electron*,electron:* PLAYWRIGHT_IN_DOCKER=1 \
/repo/bin/electron --no-sandbox --remote-debugging-port=0 "$STUB_FILE" &
ELECTRON_PID=$!
sleep 3

# Verify if Electron is still running
if pgrep -x electron >/dev/null; then
  echo "✓ Electron is still running with Playwright flags"
  # Show process tree
  echo "Process tree:"
  pstree -p $ELECTRON_PID || true
  # Try to kill Electron cleanly
  kill $ELECTRON_PID || true
else
  echo "❌ Electron process died with Playwright flags!"
  echo "Checking for error logs..."
  for file in /tmp/electron-debug/*.txt; do
    if [ -f "$file" ]; then
      echo "========== $(basename "$file") =========="
      cat "$file"
    fi
  done
  exit 1
fi

echo "============================================================"
echo "🎉 ALL VERIFICATION TESTS PASSED!"
echo "============================================================"
echo "Your Electron setup in Docker appears to be working correctly."
echo "If Playwright still fails, check the electronHarness.ts launch"
echo "arguments and make sure they match the manual test above."
'