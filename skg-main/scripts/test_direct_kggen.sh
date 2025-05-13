#!/bin/bash
# Shell script wrapper for testing KGGen directly via Python module

# Create fragment directory if it doesn't exist
FRAGMENT_DIR="./test-fragments"
mkdir -p $FRAGMENT_DIR

# Set environment variables
export FRAGMENT_DIR=$FRAGMENT_DIR
export KGGEN_MODEL="openai/gpt-4"

# Prompt for OpenAI API key if not set
if [ -z "$OPENAI_API_KEY" ]; then
  echo "Enter your OpenAI API key (starts with 'sk-'):"
  read -s OPENAI_API_KEY
  export OPENAI_API_KEY
fi

echo "Running direct KGGen test..."
echo "Using fragment directory: $FRAGMENT_DIR"

# Run the Python test script
python3 scripts/direct_kggen_test.py

# Show the resulting fragment files
echo ""
echo "Generated fragment files:"
ls -la $FRAGMENT_DIR

echo ""
echo "Test complete!"