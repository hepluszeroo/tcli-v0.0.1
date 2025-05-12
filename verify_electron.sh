#!/bin/bash
# Quick verification script for Electron binary
set -euo pipefail

echo "=== Electron Binary Verification ==="
echo "1. Node version check (CRITICAL):"
NODE_VER=$(node --version)
echo "   Node: $NODE_VER"
if [[ "$NODE_VER" != v20.* ]]; then
  echo "❌ FATAL ERROR: Node 20.x required for Electron 35, but got $NODE_VER"
  exit 1
else
  echo "✅ Using compatible Node.js version"
fi

echo "2. Check if binary exists:"
if [ -f "/repo/bin/electron" ]; then
  echo "✅ /repo/bin/electron exists"
else
  echo "❌ /repo/bin/electron MISSING"
  exit 1
fi

echo "3. File info:"
# We must follow symlinks when checking the binary type. Using plain `file` on
# the symlink itself only reports "symbolic link to ..." which fails the ELF
# pattern match even though the target is correct.  `file -L` dereferences.

FILE_TYPE=$(file -L /repo/bin/electron)
echo "   $FILE_TYPE"

if [[ "$FILE_TYPE" == *"ELF 64-bit"* ]]; then
  echo "✅ Electron binary is a proper ELF executable (target inspected)"
else
  echo "❌ Electron binary is NOT an ELF executable!"
  echo "   This suggests the Electron installation failed to download the actual binary or the symlink target is wrong"
  exit 1
fi

echo "4. File permissions:"
ls -la /repo/bin/electron

echo "5. Target of symlink:"
SYMLINK_TARGET=$(readlink -f /repo/bin/electron)
echo "   $SYMLINK_TARGET"

echo "6. Version check:"
ELECTRON_VERSION=$(/repo/bin/electron --no-sandbox --version 2>/dev/null || echo "Failed with code: $?")
echo "   $ELECTRON_VERSION"
if [[ "$ELECTRON_VERSION" == v35* ]]; then
  echo "✅ Electron version $ELECTRON_VERSION is compatible with Node $NODE_VER"
else
  echo "❌ Expected Electron v35.x.y but got: $ELECTRON_VERSION"
  exit 1
fi

echo "✅ ALL ELECTRON VERIFICATION CHECKS PASSED"
