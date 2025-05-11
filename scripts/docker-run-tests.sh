#!/usr/bin/env bash
set -euo pipefail
set -x                          # verbose for CI

# 1. Enter correct working directory
cd /repo/Tangent-main/apps/tangent-electron

# 2. Sanity check
echo "Node  : $(node -v)"
echo "PW    : $(pnpm dlx playwright@1.52.0 --version)"

# 3. List tests (fail fast if none)
xvfb-run --server-num=99 --server-args='-screen 0 1280x720x24' \
  pnpm exec playwright test \
    --config=playwright.config.ts --project Tests --grep Codex --list

# 4. Run the suite
DEBUG=pw:api,pw:test,codex,main,mock-codex \
xvfb-run --server-num=99 --server-args='-screen 0 1280x720x24' \
  pnpm exec playwright test \
    --config=playwright.config.ts \
    --project Tests --grep Codex --workers 1 --reporter=list --timeout=60000