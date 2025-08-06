#!/bin/bash

# Answer Priority Flow - Complete Integration Test
# Tests save/load functionality for Answer Priority Flow

echo "🎯 ANSWER PRIORITY FLOW INTEGRATION TEST"
echo "========================================"

# Get the first company ID for testing
COMPANY_ID="68935c47e90580930943d64b"
BASE_URL="http://localhost:3000"

echo "📋 Testing Company ID: $COMPANY_ID"

# Test Answer Priority Flow Save
echo ""
echo "1️⃣  Testing Answer Priority Flow Save..."

# Create comprehensive test data matching the frontend structure
SAVE_DATA='{
  "tradeCategories": ["plumbing", "hvac"],
  "agentIntelligenceSettings": {
    "useLLM": true,
    "llmModel": "gemini-pro",
    "memoryMode": "conversational",
    "fallbackThreshold": 0.7
  },
  "answerPriorityFlow": [
    {
      "id": "company-knowledge",
      "name": "Company Knowledge Base",
      "description": "Company-specific Q&A and internal documentation",
      "active": true,
      "primary": true,
      "priority": 1,
      "icon": "building",
      "category": "primary",
      "confidenceThreshold": 0.8,
      "intelligenceLevel": "high",
      "performance": {
        "successRate": 0,
        "avgConfidence": 0,
        "usageCount": 0
      }
    },
    {
      "id": "trade-categories",
      "name": "Trade Categories Q&A",
      "description": "Industry-specific questions and answers",
      "active": true,
      "primary": false,
      "priority": 2,
      "icon": "briefcase",
      "category": "industry",
      "confidenceThreshold": 0.75,
      "intelligenceLevel": "high",
      "performance": {
        "successRate": 0,
        "avgConfidence": 0,
        "usageCount": 0
      }
    },
    {
      "id": "template-intelligence",
      "name": "Template Intelligence",
      "description": "Smart templates and conversation patterns",
      "active": true,
      "primary": false,
      "priority": 3,
      "icon": "magic",
      "category": "smart",
      "confidenceThreshold": 0.7,
      "intelligenceLevel": "smart",
      "performance": {
        "successRate": 0,
        "avgConfidence": 0,
        "usageCount": 0
      }
    }
  ],
  "aiAgentLogic": {
    "answerPriority": ["companyKB", "tradeQA", "templates"],
    "thresholds": {
      "companyKB": 0.8,
      "tradeQA": 0.75,
      "vector": 0.7,
      "llmFallback": 0.5
    },
    "memory": {
      "mode": "conversational",
      "retentionMinutes": 30
    }
  }
}'

echo "Sending save request..."
SAVE_RESPONSE=$(curl -s -w "HTTP_STATUS:%{http_code}" \
  -X POST "$BASE_URL/api/agent/companies/$COMPANY_ID/agent-settings" \
  -H "Content-Type: application/json" \
  -d "$SAVE_DATA")

HTTP_STATUS=$(echo $SAVE_RESPONSE | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')
SAVE_BODY=$(echo $SAVE_RESPONSE | sed -e 's/HTTP_STATUS:.*//g')

if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "✅ Save successful (HTTP 200)"
    echo "Response: $SAVE_BODY" | jq . 2>/dev/null || echo "Response: $SAVE_BODY"
else
    echo "❌ Save failed (HTTP $HTTP_STATUS)"
    echo "Response: $SAVE_BODY"
    exit 1
fi

# Wait a moment for database to update
sleep 2

echo ""
echo "2️⃣  Testing Answer Priority Flow Load..."

# Test loading the saved configuration
LOAD_RESPONSE=$(curl -s -w "HTTP_STATUS:%{http_code}" \
  -X GET "$BASE_URL/api/agent/companies/$COMPANY_ID/agent-settings")

HTTP_STATUS=$(echo $LOAD_RESPONSE | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')
LOAD_BODY=$(echo $LOAD_RESPONSE | sed -e 's/HTTP_STATUS:.*//g')

if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "✅ Load successful (HTTP 200)"
    
    # Parse and validate the response
    if command -v jq &> /dev/null; then
        echo ""
        echo "📊 Validating Answer Priority Flow data..."
        
        # Check if answerPriorityFlow exists in response
        PRIORITY_FLOW_COUNT=$(echo "$LOAD_BODY" | jq '.aiAgentLogic.answerPriorityFlow | length' 2>/dev/null || echo "0")
        
        if [ "$PRIORITY_FLOW_COUNT" -gt 0 ]; then
            echo "✅ Answer Priority Flow found: $PRIORITY_FLOW_COUNT items"
            
            # Show the priority flow data
            echo ""
            echo "🎯 Answer Priority Flow Data:"
            echo "$LOAD_BODY" | jq '.aiAgentLogic.answerPriorityFlow[] | {id: .id, name: .name, active: .active, priority: .priority}' 2>/dev/null || echo "Could not parse priority flow data"
            
        else
            echo "❌ No Answer Priority Flow data found in response"
            echo "Full response:"
            echo "$LOAD_BODY" | jq . 2>/dev/null || echo "$LOAD_BODY"
        fi
    else
        echo "Response: $LOAD_BODY"
        echo "⚠️  jq not available - install for JSON parsing"
    fi
else
    echo "❌ Load failed (HTTP $HTTP_STATUS)"
    echo "Response: $LOAD_BODY"
    exit 1
fi

echo ""
echo "3️⃣  Testing Data Persistence..."

# Check if the data matches what we saved
if command -v jq &> /dev/null; then
    # Extract key fields for comparison
    SAVED_FIRST_ITEM_ID="company-knowledge"
    LOADED_FIRST_ITEM_ID=$(echo "$LOAD_BODY" | jq -r '.aiAgentLogic.answerPriorityFlow[0].id' 2>/dev/null || echo "null")
    
    if [ "$LOADED_FIRST_ITEM_ID" = "$SAVED_FIRST_ITEM_ID" ]; then
        echo "✅ Data persistence verified: First priority item ID matches"
    else
        echo "❌ Data persistence failed: Expected '$SAVED_FIRST_ITEM_ID', got '$LOADED_FIRST_ITEM_ID'"
    fi
    
    # Check active status
    SAVED_FIRST_ACTIVE="true"
    LOADED_FIRST_ACTIVE=$(echo "$LOAD_BODY" | jq -r '.aiAgentLogic.answerPriorityFlow[0].active' 2>/dev/null || echo "null")
    
    if [ "$LOADED_FIRST_ACTIVE" = "$SAVED_FIRST_ACTIVE" ]; then
        echo "✅ Toggle state verified: First priority item is active"
    else
        echo "❌ Toggle state failed: Expected '$SAVED_FIRST_ACTIVE', got '$LOADED_FIRST_ACTIVE'"
    fi
fi

echo ""
echo "🎯 ANSWER PRIORITY FLOW TEST COMPLETE"
echo "====================================="
echo ""

# Check if server is running
if curl -s "$BASE_URL/api/health" > /dev/null 2>&1; then
    echo "✅ Server is running on $BASE_URL"
else
    echo "❌ Server not accessible on $BASE_URL"
fi

echo "📝 Next steps:"
echo "1. Open browser to test UI drag & drop"
echo "2. Verify priority numbers update correctly" 
echo "3. Test save/reload cycle in browser"
echo "4. Check console for any JavaScript errors"
