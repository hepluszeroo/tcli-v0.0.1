#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "Building the Docker image..."
echo "=========================================="
docker build -t tangent-codex-tests -f Dockerfile.playwright .

echo "=========================================="
echo "Running Electron test in headless environment..."
echo "=========================================="
docker run --rm --platform linux/amd64 tangent-codex-tests \
  bash -lc 'Xvfb :99 -screen 0 1280x720x24 -ac & export DISPLAY=:99; sleep 1; \
            /repo/bin/electron --no-sandbox /repo/Tangent-main/apps/tangent-electron/__build/bundle/main.js & \
            ELECTRON_PID=$!; \
            sleep 2; \
            if pgrep -P $ELECTRON_PID > /dev/null; then \
              echo "✅ Electron process $ELECTRON_PID is still alive with child processes"; \
              pgrep -P $ELECTRON_PID; \
            else \
              if ps -p $ELECTRON_PID > /dev/null; then \
                echo "⚠️ Electron process $ELECTRON_PID is still alive but has no child processes"; \
              else \
                echo "❌ Electron process has exited!"; \
                exit 1; \
              fi; \
            fi; \
            echo "📊 Process tree:"; \
            pstree -p $ELECTRON_PID || true; \
            echo "✅ Test passed - Electron stayed alive in headless environment"'