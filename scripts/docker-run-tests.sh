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

# ---------------------------------------------------------------------------
# 3. Defensive check – ensure the real Electron ELF binary is still present.
#    Some CI runners were observed to cache old layers which resulted in the
#    project-installed Electron being just a stub text file (created when the
#    postinstall download failed).  We copy the *known-good* binary that we
#    embedded during the Docker build (stored under /repo/vendor) back into the
#    node_modules location.  This is effectively a no-op when the binary is
#    already correct, but guarantees that the subsequent verification step and
#    the Playwright launcher will always see a valid ELF executable.
# ---------------------------------------------------------------------------

if [ -f "/repo/vendor/electron/dist/electron" ]; then
  echo "Ensuring /repo/bin/electron points to the real ELF binary…"
  # Re-copy the binary in case the node_modules file was overwritten by a stub
  # Copy the real binary into *every* electron/dist directory we can find in
  # the current project – pnpm creates versioned paths under
  #   node_modules/.pnpm/electron@35.2.1/node_modules/electron/dist
  # and a symlink at   node_modules/electron → ../../.pnpm/…/electron
  # We iterate through all matches to avoid subtle cache / symlink issues.
  while IFS= read -r -d '' distDir; do
    echo "Installing real Electron binary into $distDir"
    mkdir -p "$distDir" || true
    cp -f /repo/vendor/electron/dist/electron "$distDir/electron"
    chmod +x "$distDir/electron"
  done < <(find /repo/node_modules -path "*/electron/dist" -type d -print0)

  # Symlink for convenience
  ln -sf /repo/vendor/electron/dist/electron /repo/bin/electron
else
  echo "WARNING: /repo/vendor/electron/dist/electron missing – this should never happen"
fi

# 4. Run electron binary verification (fails fast if the binary is still wrong)
echo '=== Running Electron binary verification ==='
/repo/verify_electron.sh

# 5. List tests (fail fast if none)
xvfb-run --server-num=99 --server-args='-screen 0 1280x720x24' \
  pnpm exec playwright test \
    --config=playwright.config.ts --project Tests --grep Codex --list

# 6. Run the suite
DEBUG=pw:api,pw:test,codex,main,mock-codex \
xvfb-run --server-num=99 --server-args='-screen 0 1280x720x24' \
  pnpm exec playwright test \
    --config=playwright.config.ts \
    --project Tests --grep Codex --workers 1 --reporter=list --timeout=60000