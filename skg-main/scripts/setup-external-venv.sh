#!/bin/bash
# Set up external KGGen virtual environment
# This script creates a virtual environment outside the repository

set -e

# Get script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default virtual environment location
DEFAULT_VENV_PATH="${HOME}/.venvs/kggen"
VENV_PATH=${1:-$DEFAULT_VENV_PATH}

# KGGen repository path (prompt if not provided)
if [ -z "$2" ]; then
  echo "Enter the path to the KGGen repository (or press Enter to skip KGGen installation):"
  read KGGEN_PATH
else
  KGGEN_PATH="$2"
fi

echo "=== Setting up KGGen in external virtual environment ==="
echo "Virtual environment path: $VENV_PATH"
if [ -n "$KGGEN_PATH" ]; then
  echo "KGGen repository path:  $KGGEN_PATH"
fi

# Create the virtual environment
echo -e "\nCreating Python virtual environment..."
python3 -m venv "$VENV_PATH"

# Activate the virtual environment
echo "Activating virtual environment..."
source "$VENV_PATH/bin/activate"

# Update pip first
echo "Updating pip..."
pip install --upgrade pip

# Install dependencies with constraints
echo "Installing dependencies with constraints..."
pip install -r "$PROJECT_ROOT/pip-constraints.txt"

# Install KGGen if path was provided
if [ -n "$KGGEN_PATH" ]; then
  echo "Installing KGGen from $KGGEN_PATH..."
  pip install -c "$PROJECT_ROOT/pip-constraints.txt" -e "$KGGEN_PATH"

  # Test importing KGGen
  echo "Testing KGGen import..."
  if python -c "import kg_gen; print('KGGen import successful')"; then
    echo "✅ KGGen imported successfully"
  else
    echo "❌ Failed to import KGGen"
    echo "Continuing anyway - you may need to manually install KGGen"
  fi
else
  echo "No KGGen path provided. Setup of dependencies complete."
  echo "To use KGGen, you'll need to either:"
  echo "1. Install the KGGen package manually with the right version"
  echo "2. Run this script again with the path to a KGGen repository"
fi

# Print setup instructions
cat << EOF

=== Setup Complete ===

To use this environment:

1. Activate the virtual environment:
   source "$VENV_PATH/bin/activate"

2. Set environment variables:
   export KGGEN_BIN="$VENV_PATH/bin/python"
   export KGGEN_SCRIPT="$PROJECT_ROOT/scripts/kg_gen_cli.py"
   export KGGEN_MODE=real

3. Run the service or tests:
   npm run start
   npm run test:kggen

You can add these to your .env file:
KGGEN_BIN=$VENV_PATH/bin/python
KGGEN_SCRIPT=$PROJECT_ROOT/scripts/kg_gen_cli.py
KGGEN_MODE=real

EOF