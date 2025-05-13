#!/bin/bash
# Shell script wrapper for testing KGGen integration

# Check if KGGen is installed
echo "Checking KGGen installation..."
if ! pip list | grep -q kg-gen; then
  echo "KGGen not found. Installing KGGen..."
  pip install kg-gen==0.4.3
fi

# Ensure dist files are built
echo "Building project..."
npm run build

# Create fragment directory if it doesn't exist
FRAGMENT_DIR="./test-fragments"
mkdir -p $FRAGMENT_DIR

# Set environment variables
export FRAGMENT_DIR=$FRAGMENT_DIR
export KGGEN_MODE=module
export KGGEN_TIMEOUT=120000

# Prompt for OpenAI API key if not set
if [ -z "$OPENAI_API_KEY" ]; then
  echo "Enter your OpenAI API key (starts with 'sk-'):"
  read -s OPENAI_API_KEY
  export OPENAI_API_KEY
fi

echo "Running test with real KGGen CLI..."
echo "Using fragment directory: $FRAGMENT_DIR"

# Run the test script
node scripts/test_real_kggen.js

# Show the resulting fragment files
echo ""
echo "Generated fragment files:"
ls -la $FRAGMENT_DIR

echo ""
echo "Test complete!"