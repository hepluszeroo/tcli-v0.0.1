# KGGen Integration Test

This directory contains scripts to test the integration with the real KGGen CLI.

## Prerequisites

1. Make sure KGGen is installed:
   ```bash
   pip install kg-gen==0.4.3
   ```

2. Verify KGGen is working:
   ```bash
   kg_gen --help
   ```

3. You need an OpenAI API key for the test

## Running the Test

The simplest way to run the test is using the shell script:

```bash
./scripts/test_kggen.sh
```

This will:
1. Build the project
2. Create a test fragments directory
3. Prompt for your OpenAI API key if not set
4. Run the test script with the real KGGen

## Manual Testing

You can also run the test manually with custom configuration:

```bash
# Build the project first
npm run build

# Set environment variables
export FRAGMENT_DIR="./test-fragments"
export KGGEN_MODE=real
export KGGEN_MODEL="openai/gpt-4"
export OPENAI_API_KEY="your-api-key"

# Run test script
node scripts/test_real_kggen.js
```

## Troubleshooting

If the test fails, check the following:

1. **Verify KGGen Installation**:
   Use this command to check if KGGen is installed:
   ```bash
   pip list | grep kg-gen
   ```

   If not found, install it:
   ```bash
   pip install kg-gen==0.4.3
   ```

2. **Try Module Mode** (recommended):
   Even if KGGen is installed, the executable might not be in your PATH.
   Module mode is more reliable:
   ```bash
   export KGGEN_MODE=module
   ```

   This will use `python -m kg_gen` rather than looking for a `kg_gen` executable.

3. **Verify OpenAI API Key**:
   Make sure your API key is valid and has proper permissions.
   ```bash
   # Test with a simple request
   curl -s -XPOST https://api.openai.com/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $OPENAI_API_KEY" \
     -d '{"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "Hello"}]}' | grep -q "content"

   if [ $? -eq 0 ]; then echo "API key works"; else echo "API key problem"; fi
   ```

4. **Custom Python Path**:
   If you need to use a specific Python installation:
   ```bash
   export KGGEN_BIN="/path/to/python3"
   export KGGEN_MODE=module
   ```

5. **Increase Timeout**:
   The default timeout is 2 minutes. If the model is slow, increase it:
   ```bash
   export KGGEN_TIMEOUT=300000  # 5 minutes
   ```

6. **Check Error Messages**:
   - "No such file or directory" - KGGen executable not found, try module mode
   - "API key not authorized" - OpenAI API key issue
   - "must match format uuid" - The note ID format is incorrect
   - "Connection error" - Network issues reaching OpenAI

## What to Expect

A successful test will:
1. Generate a knowledge graph fragment for a test note about neural networks
2. Show the generated entities, relations, and triples
3. Save the fragment to the configured FRAGMENT_DIR
4. Display stats about the generation process

The output should include multiple entities related to neural networks, relationships between them, and at least a few triples.

## Next Steps

Once you've verified the integration works:

1. Check the generated fragment for quality and completeness
2. Test with your own note content by modifying the TEST_NOTE in the test script
3. Configure the SKB service to use the real KGGen in your environment