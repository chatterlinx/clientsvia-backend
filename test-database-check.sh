#!/bin/bash

# Simple test to check if Answer Priority Flow data is being saved to database
echo "🔍 DIRECT DATABASE CHECK FOR ANSWER PRIORITY FLOW"
echo "================================================="

COMPANY_ID="68935c47e90580930943d64b"

# First, let's save some data
echo "1️⃣  Saving Answer Priority Flow data..."

SAVE_DATA='{
  "tradeCategories": ["plumbing"],
  "answerPriorityFlow": [
    {
      "id": "company-knowledge",
      "name": "Company Knowledge Base",
      "active": true,
      "priority": 1
    }
  ]
}'

curl -s -X POST "http://localhost:3000/api/agent/companies/$COMPANY_ID/agent-settings" \
  -H "Content-Type: application/json" \
  -d "$SAVE_DATA" > /dev/null

echo "✅ Save request sent"

# Wait a moment
sleep 2

# Now check what was actually saved by making a direct API call and checking the structure
echo ""
echo "2️⃣  Checking saved data structure..."

RESPONSE=$(curl -s "http://localhost:3000/api/agent/companies/$COMPANY_ID/agent-settings")

echo "Full response:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"

# Check specific fields
echo ""
echo "3️⃣  Field-by-field analysis:"
echo "Has answerPriorityFlow field: $(echo "$RESPONSE" | jq 'has("answerPriorityFlow")' 2>/dev/null || echo "jq not available")"
echo "Has aiAgentLogic field: $(echo "$RESPONSE" | jq 'has("aiAgentLogic")' 2>/dev/null || echo "jq not available")"

if command -v jq &> /dev/null; then
    PRIORITY_FLOW_COUNT=$(echo "$RESPONSE" | jq '.answerPriorityFlow | length' 2>/dev/null || echo "0")
    echo "answerPriorityFlow count: $PRIORITY_FLOW_COUNT"
    
    AI_LOGIC_KEYS=$(echo "$RESPONSE" | jq -r '.aiAgentLogic | keys[]' 2>/dev/null || echo "none")
    echo "aiAgentLogic keys: $AI_LOGIC_KEYS"
fi

echo ""
echo "🔍 ANALYSIS COMPLETE"
