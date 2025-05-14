#!/bin/bash
# Start the SKB service locally

# Set default environment variables if not already set
export NODE_ENV=${NODE_ENV:-development}
export LOG_LEVEL=${LOG_LEVEL:-debug}
export NATS_URL=${NATS_URL:-nats://localhost:4222}
export HEALTH_PORT=${HEALTH_PORT:-3000}
export SHUTDOWN_TIMEOUT=${SHUTDOWN_TIMEOUT:-5000}
export MAX_CONTENT_SIZE_BYTES=${MAX_CONTENT_SIZE_BYTES:-1048576}

# Build the project if dist directory doesn't exist
if [ ! -d "dist" ]; then
  echo "Building the project..."
  pnpm run build
fi

# Start the service
echo "Starting SKB service with the following configuration:"
echo "NODE_ENV: $NODE_ENV"
echo "LOG_LEVEL: $LOG_LEVEL"
echo "NATS_URL: $NATS_URL"
echo "HEALTH_PORT: $HEALTH_PORT"
echo "SHUTDOWN_TIMEOUT: $SHUTDOWN_TIMEOUT"
echo "MAX_CONTENT_SIZE_BYTES: $MAX_CONTENT_SIZE_BYTES"
echo ""

node dist/index.js