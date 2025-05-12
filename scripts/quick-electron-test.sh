#!/usr/bin/env bash
# Simple script to verify Electron launch in Docker environment
# Run after building the Docker image with ./scripts/build-docker.sh

set -euo pipefail
echo "============================================================"
echo "🔍 QUICK ELECTRON LAUNCH TEST"
echo "============================================================"

echo "Running quick launch test in Docker..."
docker run --rm --platform linux/amd64 tangent-codex-tests bash -lc '
  set -x
  Xvfb :99 -screen 0 1280x720x24 -ac &
  export DISPLAY=:99
  sleep 1
  /repo/bin/electron --no-sandbox /repo/Tangent-main/apps/tangent-electron/__build/bundle/main.js &
  ELECTRON_PID=$!
  sleep 4
  if pgrep -x electron >/dev/null; then
    echo "✅ electron still alive"
    
    # Check for child processes (renderers)
    if pgrep -P $ELECTRON_PID >/dev/null; then
      echo "✅ Electron has spawned child processes (renderers)"
      pgrep -P $ELECTRON_PID
    else
      echo "⚠️ Electron is running but has no child processes"
    fi
    
    # Kill Electron to clean up
    kill $ELECTRON_PID || true
    exit 0
  else
    echo "❌ Electron process died!"
    # Check for error logs
    for file in /tmp/electron-*.txt; do
      if [ -f "$file" ]; then
        echo "========== $(basename "$file") =========="
        cat "$file"
      fi
    done
    exit 1
  fi
'

# Exit with the same status as the Docker command
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
  echo "============================================================"
  echo "✅ TEST PASSED: Electron launched successfully in Docker"
  echo "============================================================"
  echo "This indicates the Playwright 'Process failed to launch!' error"
  echo "should be resolved. Any remaining failures should be from actual"
  echo "test assertions, not infrastructure issues."
else
  echo "============================================================"
  echo "❌ TEST FAILED: Electron did not stay alive in Docker"
  echo "============================================================"
  echo "Please check the error logs and fix any remaining issues."
fi
exit $EXIT_CODE