#\!/bin/bash
# Local test script to verify Docker build with the same settings as CI

set -euo pipefail

echo "Building Docker image with same settings as CI..."
docker build --progress=plain --no-cache \
  --build-arg CACHE_BUST="local-$(date +%s)" \
  --build-arg STUB_HASH="local-$(date +%s)" \
  -f Dockerfile.playwright -t tangent-codex-tests-local .

echo "=== Verifying Electron binary in the container ==="
docker run --rm tangent-codex-tests-local /repo/verify_electron.sh

echo
echo "=== Checking Electron version directly ==="
docker run --rm tangent-codex-tests-local bash -c "echo 'Node version: ' \$(node -v) && echo 'Electron version: ' \$(/repo/bin/electron --version 2>/dev/null || echo 'Failed\!')"

echo
echo "If both checks passed, the Docker image should work in CI."
