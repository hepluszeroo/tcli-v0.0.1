#!/bin/bash
# Master script to run KGGen integration tests

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "===== KGGen Integration Test Suite ====="

# Check for OpenAI API key
if [ -z "$OPENAI_API_KEY" ]; then
  echo "Enter your OpenAI API key (starts with 'sk-'):"
  read -s OPENAI_API_KEY
  export OPENAI_API_KEY
fi

# Step 1: Setup environment
echo "Step 1: Setting up KGGen environment..."
"$SCRIPT_DIR/setup-kggen-env.sh"

# Step 2: Build the project
echo "Step 2: Building TypeScript code..."
cd "$PROJECT_ROOT" && npm run build

# Step 3: Test Python KGGen module directly
echo "Step 3: Testing KGGen Python module..."
"$SCRIPT_DIR/test_kg_gen_import.py"

# Step 4: Run full integration test
echo "Step 4: Running full integration test..."
node "$SCRIPT_DIR/test-kggen-integration.js"

echo "===== All tests completed successfully! ====="