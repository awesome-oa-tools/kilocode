#!/bin/bash

##############################################################################
# OpenAI Assistant API - Bash Script Example
#
# This script demonstrates how to use the OpenAI Assistant API to interact
# with a configured assistant.
#
# Prerequisites:
#   - jq (JSON processor) - install with: brew install jq (macOS)
#   - curl command
#   - OpenAI API key with Assistant API access
#   - An existing Assistant ID
#
# Setup:
#   export API_KEY="your-openai-api-key"
#   export ASSISTANT_ID="your-assistant-id"
#   export INPUT_MSG="your message to the assistant"
#   export BASE_URL="https://api.openai.com/v1"  # Optional, defaults to OpenAI
#
# Usage:
#   ./openai-assistant-curl.sh
##############################################################################

# Configuration
BASE_URL="${BASE_URL:-https://api.openai.com/v1}"
API_KEY="${API_KEY:?Error: API_KEY environment variable not set}"
ASSISTANT_ID="${ASSISTANT_ID:?Error: ASSISTANT_ID environment variable not set}"
INPUT_MSG="${INPUT_MSG:?Error: INPUT_MSG environment variable not set}"

# Helper function for API calls
make_api_call() {
    local method=$1
    local endpoint=$2
    local data=$3

    curl -s --location --request "$method" "${BASE_URL}${endpoint}" \
        --header 'OpenAI-Beta: assistants=v2' \
        --header 'Content-Type: application/json' \
        --header "Authorization: Bearer ${API_KEY}" \
        ${data:+--data "$data"}
}

echo "Starting OpenAI Assistant API Example"
echo "======================================"
echo ""

# Step 1: Create a new thread
echo "Step 1: Creating a new thread..."
THREAD_RESPONSE=$(make_api_call "POST" "/threads" '{}')
THREAD_ID=$(echo "$THREAD_RESPONSE" | jq -r '.id')

if [ -z "$THREAD_ID" ] || [ "$THREAD_ID" = "null" ]; then
    echo "Failed to create thread"
    echo "Response: $THREAD_RESPONSE"
    exit 1
fi

echo "Thread created: $THREAD_ID"
echo ""

# Step 2: Add message to thread
echo "Step 2: Adding message to thread..."
MESSAGE_DATA=$(cat <<EOF
{
    "role": "user",
    "content": "$INPUT_MSG"
}
EOF
)

MESSAGE_RESPONSE=$(make_api_call "POST" "/threads/${THREAD_ID}/messages" "$MESSAGE_DATA")
MESSAGE_ID=$(echo "$MESSAGE_RESPONSE" | jq -r '.id')

if [ -z "$MESSAGE_ID" ] || [ "$MESSAGE_ID" = "null" ]; then
    echo "Failed to add message"
    echo "Response: $MESSAGE_RESPONSE"
    exit 1
fi

echo "Message added: $MESSAGE_ID"
echo ""

# Step 3: Run the assistant
echo "Step 3: Running the assistant..."
RUN_DATA=$(cat <<EOF
{
    "assistant_id": "$ASSISTANT_ID",
    "additional_instructions": "The current time is: $(date '+%Y-%m-%d %H:%M:%S')"
}
EOF
)

RUN_RESPONSE=$(make_api_call "POST" "/threads/${THREAD_ID}/runs" "$RUN_DATA")
RUN_ID=$(echo "$RUN_RESPONSE" | jq -r '.id')
RUN_STATUS=$(echo "$RUN_RESPONSE" | jq -r '.status')

if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
    echo "Failed to create run"
    echo "Response: $RUN_RESPONSE"
    exit 1
fi

echo "Run created: $RUN_ID (Status: $RUN_STATUS)"
echo ""

# Step 4: Poll for completion
echo "Step 4: Waiting for assistant to complete..."
MAX_WAIT=300  # 5 minutes
ELAPSED=0
POLL_INTERVAL=1

while [ "$RUN_STATUS" != "completed" ] && [ $ELAPSED -lt $MAX_WAIT ]; do
    sleep $POLL_INTERVAL
    ELAPSED=$((ELAPSED + POLL_INTERVAL))

    # Get run status
    RUN_STATUS_RESPONSE=$(make_api_call "GET" "/threads/${THREAD_ID}/runs/${RUN_ID}")
    RUN_STATUS=$(echo "$RUN_STATUS_RESPONSE" | jq -r '.status')
    REQUIRED_ACTION=$(echo "$RUN_STATUS_RESPONSE" | jq '.required_action')

    echo -ne "\rWaiting... Status: $RUN_STATUS (${ELAPSED}s)"

    # Handle tool calls if needed
    if [ "$RUN_STATUS" = "requires_action" ] && [ "$REQUIRED_ACTION" != "null" ]; then
        echo ""
        echo "Tool calls required (not implemented in this example)"

        TOOL_CALLS=$(echo "$REQUIRED_ACTION" | jq '.submit_tool_outputs.tool_calls')
        TOOL_COUNT=$(echo "$TOOL_CALLS" | jq 'length')

        TOOL_OUTPUTS='[]'
        for ((i=0; i<$TOOL_COUNT; i++)); do
            TOOL_ID=$(echo "$TOOL_CALLS" | jq -r ".[$i].id")
            TOOL_OUTPUT=$(cat <<EOF
{
    "tool_call_id": "$TOOL_ID",
    "output": "Tool execution not implemented"
}
EOF
)
            TOOL_OUTPUTS=$(echo "$TOOL_OUTPUTS" | jq --argjson obj "$TOOL_OUTPUT" '. += [$obj]')
        done

        SUBMIT_DATA=$(cat <<EOF
{
    "tool_outputs": $TOOL_OUTPUTS
}
EOF
)
        make_api_call "POST" "/threads/${THREAD_ID}/runs/${RUN_ID}/submit_tool_outputs" "$SUBMIT_DATA" > /dev/null
    fi
done

echo ""
echo ""

if [ "$RUN_STATUS" != "completed" ]; then
    echo "Assistant run timeout or failed"
    echo "Final status: $RUN_STATUS"
    exit 1
fi

echo "Assistant completed successfully"
echo ""

# Step 5: Get messages from thread
echo "Step 5: Retrieving messages..."
MESSAGES_RESPONSE=$(make_api_call "GET" "/threads/${THREAD_ID}/messages")
ASSISTANT_MESSAGES=$(echo "$MESSAGES_RESPONSE" | jq '.data | map(select(.role == "assistant"))')
LATEST_MESSAGE=$(echo "$ASSISTANT_MESSAGES" | jq '.[0]')

if [ -z "$LATEST_MESSAGE" ] || [ "$LATEST_MESSAGE" = "null" ]; then
    echo "No assistant response found"
    exit 1
fi

echo "Message retrieved"
echo ""

# Step 6: Display results
echo "======================================"
echo "CONVERSATION RESULT"
echo "======================================"
echo ""
echo "You: $INPUT_MSG"
echo ""
echo "Assistant:"

# Extract and display all text content
echo "$LATEST_MESSAGE" | jq -r '.content[] | select(.type == "text") | .text' | sed 's/^/   /'

echo ""
echo "======================================"
echo "Conversation completed successfully!"
echo ""
echo "Thread ID: $THREAD_ID"
echo "Run ID: $RUN_ID"
echo "Assistant ID: $ASSISTANT_ID"
echo ""
