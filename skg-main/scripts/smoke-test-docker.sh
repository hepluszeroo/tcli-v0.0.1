#!/bin/bash
# Smoke test for Docker image
set -e

echo "Building Docker image..."
docker build -t skb:0.3.1-beta .

echo "Starting container with mock KGGen mode..."
docker run -d \
  --name skb-smoke-test \
  -e KGGEN_MODE=mock \
  -p 3000:3000 \
  skb:0.3.1-beta

echo "Waiting for container to start..."
sleep 5

echo "Testing health endpoint..."
curl -s http://localhost:3000/healthz | grep "status" || (echo "ERROR: Health check failed!" && exit 1)
echo "Health check passed!"

echo "Testing graph endpoint..."
curl -s http://localhost:3000/graph | grep "entities" || (echo "ERROR: Graph endpoint failed!" && exit 1)
echo "Graph endpoint check passed!"

echo "Stopping container..."
docker stop skb-smoke-test

echo "Cleaning up..."
docker rm skb-smoke-test

echo "Smoke test completed successfully!"