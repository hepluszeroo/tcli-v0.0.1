#!/bin/bash
# Clean up the repository by removing internal venv and other non-tracked files
# WARNING: This will remove all untracked files in the repository!

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "=== Repository Cleanup ==="
echo "This script will remove:"
echo "- Internal Python virtual environment (venv-kggen)"
echo "- Test fragments directory"
echo "- Other untracked files not in .gitignore"
echo ""
echo "Working directory: $(pwd)"
echo ""

# Ask for confirmation
read -p "Are you sure you want to proceed? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cleanup aborted."
  exit 0
fi

# Remove internal venv if it exists
if [ -d "venv-kggen" ]; then
  echo "Removing internal venv-kggen directory..."
  rm -rf venv-kggen
fi

# Remove test fragments directory if it exists
if [ -d "test-fragments" ]; then
  echo "Removing test-fragments directory..."
  rm -rf test-fragments
fi

# Remove other untracked files using git clean
echo "Removing other untracked files..."
git clean -xdn  # Dry run first to show what will be deleted

read -p "Continue with removal of these files? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Git clean aborted."
  exit 0
fi

git clean -xdf

echo ""
echo "=== Cleanup Complete ==="
echo "Repository is now clean."
echo ""
echo "To set up an external virtual environment, run:"
echo "  ./scripts/setup-external-venv.sh ~/.venvs/kggen /path/to/kg_gen"
echo ""