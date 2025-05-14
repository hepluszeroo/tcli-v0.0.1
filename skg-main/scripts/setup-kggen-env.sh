#!/bin/bash
# Setup KGGen environment
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_ROOT/venv-kggen"
KGGEN_PATH="/Users/jialinhe/Desktop/codebase/test-KG-LLM/kg-gen"

echo "Setting up KGGen environment in $VENV_DIR"

# Create Python virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

# Activate the virtual environment
source "$VENV_DIR/bin/activate"

# Install dependencies with constraints
echo "Installing dependencies..."
pip install -r "$PROJECT_ROOT/pip-constraints.txt"

# Install KGGen in development mode with constraints
echo "Installing KGGen..."
pip install -c "$PROJECT_ROOT/pip-constraints.txt" -e "$KGGEN_PATH"

# Test importing KGGen
echo "Testing KGGen import..."
python -c "from kg_gen.kg_gen import KGGen; print('KGGen import successful')"

# Create .env file with KGGen configuration if it doesn't exist
ENV_FILE="$PROJECT_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Creating .env file with KGGen configuration..."
  cat > "$ENV_FILE" << EOF
# KGGen configuration - PRODUCTION SETTINGS
KGGEN_BIN=$(which python3)
KGGEN_SCRIPT=$PROJECT_ROOT/scripts/kg_gen_cli.py
# CRITICAL: Always use real mode in production
KGGEN_MODE=real
KGGEN_MODEL=openai/gpt-4
KGGEN_TIMEOUT=120000
# OPENAI_API_KEY must be set in the environment
EOF
fi

echo "KGGen environment setup complete!"
echo "Run 'source $VENV_DIR/bin/activate' to activate the Python environment"
echo "Verify .env file at $ENV_FILE for KGGen configuration"