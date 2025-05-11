#!/usr/bin/env bash
set -euo pipefail
set -x                          # verbose for CI

# Critical Node version check - abort immediately if not Node 20
if [[ "$(node -v)" != v20.* ]]; then
  echo "❌ FATAL ERROR: Node 20.x required inside test container, got $(node -v)"
  echo "This will cause Electron installation to fail silently."
  exit 1
fi

# 1. Enter correct working directory
cd /repo/Tangent-main/apps/tangent-electron

# 2. Sanity check
echo "Node  : $(node -v)"
echo "PW    : $(pnpm dlx playwright@1.52.0 --version)"

# 3. Run electron binary verification
echo '=== Running Electron binary verification ==='
/repo/verify_electron.sh

# 4. List tests (fail fast if none)
xvfb-run --server-num=99 --server-args='-screen 0 1280x720x24' \
  pnpm exec playwright test \
    --config=playwright.config.ts --project Tests --grep Codex --list

# 5. Run the suite
DEBUG=pw:api,pw:test,codex,main,mock-codex \
xvfb-run --server-num=99 --server-args='-screen 0 1280x720x24' \
  pnpm exec playwright test \
    --config=playwright.config.ts \
    --project Tests --grep Codex --workers 1 --reporter=list --timeout=60000