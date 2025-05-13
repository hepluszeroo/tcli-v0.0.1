#!/bin/bash
# Smoke test script for SKB service
# Publishes test events to NATS and monitors for responses

# Set NATS URL
NATS_URL=${NATS_URL:-nats://localhost:4222}
TOPIC_IN=${TOPIC_IN:-tangent.note.new}
TOPIC_OUT=${TOPIC_OUT:-tangent.note.indexed}

# Check if nats-cli is installed
if ! command -v nats &> /dev/null; then
    echo "nats-cli is required but not installed. Please install it first:"
    echo "  https://github.com/nats-io/natscli"
    exit 1
fi

echo "==== SKB Service Smoke Test ===="
echo "NATS URL: $NATS_URL"
echo "Input topic: $TOPIC_IN"
echo "Output topic: $TOPIC_OUT"
echo "==============================="
echo

# Generate a random UUID
generate_uuid() {
    if command -v uuidgen &> /dev/null; then
        uuidgen
    else
        # Fallback to node if uuidgen is not available
        node -e "console.log(require('crypto').randomUUID())"
    fi
}

# Start listening for responses in the background
echo "Starting listener for ACK messages..."
nats sub "$TOPIC_OUT" --json > ack_responses.log &
LISTENER_PID=$!

# Give listener time to connect
sleep 1

# Create a valid note event
NOTE_ID=$(generate_uuid)
EVENT_ID=$(generate_uuid)
AUTHOR_ID=$(generate_uuid)
WORKSPACE_ID=$(generate_uuid)

echo "Sending well-formed new_note event with ID: $NOTE_ID"
VALID_EVENT='{
  "note_id": "'$NOTE_ID'",
  "content": "This is a test note created by the smoke test script.",
  "author_id": "'$AUTHOR_ID'",
  "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
  "metadata": {
    "title": "Smoke Test Note",
    "tags": ["test", "smoke-test"],
    "workspace_id": "'$WORKSPACE_ID'",
    "path": "/tests/smoke-test"
  },
  "event_id": "'$EVENT_ID'"
}'

# Publish the valid note
nats pub "$TOPIC_IN" "$VALID_EVENT"
echo "Valid note sent."
echo

sleep 1

# Create an invalid note (missing required fields)
BAD_NOTE_ID=$(generate_uuid)
BAD_EVENT_ID=$(generate_uuid)

echo "Sending malformed new_note event with ID: $BAD_NOTE_ID"
INVALID_EVENT='{
  "note_id": "'$BAD_NOTE_ID'",
  "content": 123,
  "event_id": "'$BAD_EVENT_ID'"
}'

# Publish the invalid note
nats pub "$TOPIC_IN" "$INVALID_EVENT"
echo "Invalid note sent."
echo

# Wait for responses
echo "Waiting for responses (5 seconds)..."
sleep 5

# Stop the listener
kill $LISTENER_PID

echo
echo "==== Results ===="
echo "Checking for acknowledgments..."
VALID_ACK=$(grep -c "$NOTE_ID" ack_responses.log || true)
INVALID_ACK=$(grep -c "$BAD_NOTE_ID" ack_responses.log || true)

echo "Valid note acknowledgment: $VALID_ACK"
echo "Invalid note acknowledgment: $INVALID_ACK"

# Display the full response logs
echo
echo "==== Response Details ===="
cat ack_responses.log

# Clean up
rm ack_responses.log

echo
if [ "$VALID_ACK" -gt 0 ] && [ "$INVALID_ACK" -gt 0 ]; then
    echo "✅ Smoke test PASSED! Both valid and invalid notes received acknowledgments."
    exit 0
else
    echo "❌ Smoke test FAILED! Not all notes received acknowledgments."
    exit 1
fi