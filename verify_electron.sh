#\!/bin/bash
# Quick verification script for Electron binary

echo "=== Electron Binary Verification ==="
echo "1. Check if binary exists:"
if [ -f "/repo/bin/electron" ]; then
  echo "✅ /repo/bin/electron exists"
else
  echo "❌ /repo/bin/electron MISSING"
  exit 1
fi

echo "2. File info:"
file /repo/bin/electron

echo "3. File permissions:"
ls -la /repo/bin/electron

echo "4. Version check:"
/repo/bin/electron --version || echo "electron version check failed with code: $?"

echo "5. Target of symlink:"
readlink -f /repo/bin/electron

echo "6. Node version:"
node --version
