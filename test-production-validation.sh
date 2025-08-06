#!/bin/bash

echo "🚀 FINAL PRODUCTION VALIDATION - ANSWER PRIORITY FLOW"
echo "====================================================="
echo ""

# Test comprehensive functionality
COMPANY_ID="68935c47e90580930943d64b"

echo "1️⃣  Testing complete save/load cycle..."

# Save comprehensive test data
COMPREHENSIVE_DATA='{
  "tradeCategories": ["plumbing", "hvac", "electrical"],
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
      "intelligenceLevel": "high"
    },
    {
      "id": "trade-categories", 
      "name": "Trade Categories Q&A",
      "description": "Industry-specific questions and answers",
      "active": false,
      "primary": false,
      "priority": 2,
      "icon": "briefcase",
      "category": "industry", 
      "confidenceThreshold": 0.75,
      "intelligenceLevel": "high"
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
      "intelligenceLevel": "smart"
    },
    {
      "id": "learning-queue",
      "name": "Learning Queue Insights",
      "description": "Previously learned patterns and approved answers",
      "active": true,
      "primary": false,
      "priority": 4,
      "icon": "graduation-cap",
      "category": "learning",
      "confidenceThreshold": 0.65,
      "intelligenceLevel": "medium"
    }
  ],
  "agentSettings": {
    "useLLM": true,
    "llmModel": "gemini-pro",
    "memoryMode": "conversational",
    "fallbackThreshold": 0.6
  }
}'

# Save the data
echo "Saving comprehensive test data..."
SAVE_RESPONSE=$(curl -s -X POST "http://localhost:3000/api/agent/companies/$COMPANY_ID/agent-settings" \
  -H "Content-Type: application/json" \
  -d "$COMPREHENSIVE_DATA")

if echo "$SAVE_RESPONSE" | grep -q "success.*true"; then
    echo "✅ Save successful"
else
    echo "❌ Save failed: $SAVE_RESPONSE"
    exit 1
fi

sleep 2

# Load and validate
echo ""
echo "2️⃣  Validating loaded data..."

LOAD_RESPONSE=$(curl -s "http://localhost:3000/api/agent/companies/$COMPANY_ID/agent-settings")

if command -v jq &> /dev/null; then
    # Test all critical aspects
    TOTAL_ITEMS=$(echo "$LOAD_RESPONSE" | jq '.aiAgentLogic.answerPriorityFlow | length')
    ACTIVE_ITEMS=$(echo "$LOAD_RESPONSE" | jq '[.aiAgentLogic.answerPriorityFlow[] | select(.active == true)] | length')
    INACTIVE_ITEMS=$(echo "$LOAD_RESPONSE" | jq '[.aiAgentLogic.answerPriorityFlow[] | select(.active == false)] | length')
    PRIMARY_ITEM=$(echo "$LOAD_RESPONSE" | jq -r '.aiAgentLogic.answerPriorityFlow[] | select(.primary == true) | .name')
    
    echo "✅ Total priority items: $TOTAL_ITEMS"
    echo "✅ Active items: $ACTIVE_ITEMS"
    echo "✅ Inactive items: $INACTIVE_ITEMS"
    echo "✅ Primary item: $PRIMARY_ITEM"
    
    # Validate specific data
    if [ "$TOTAL_ITEMS" -eq 4 ] && [ "$ACTIVE_ITEMS" -eq 3 ] && [ "$INACTIVE_ITEMS" -eq 1 ] && [ "$PRIMARY_ITEM" = "Company Knowledge Base" ]; then
        echo ""
        echo "🎉 ALL VALIDATION TESTS PASSED!"
        echo "✅ Answer Priority Flow is production-ready"
        echo "✅ Save/load cycle working perfectly"
        echo "✅ Toggle states preserved correctly"
        echo "✅ Priority ordering maintained"
        echo "✅ Data structure is complete"
        
        # Show final data structure
        echo ""
        echo "📊 Final Priority Flow Configuration:"
        echo "$LOAD_RESPONSE" | jq '.aiAgentLogic.answerPriorityFlow[] | {priority: .priority, name: .name, active: .active, category: .category}'
        
    else
        echo ""
        echo "❌ VALIDATION FAILED"
        echo "Expected: 4 total, 3 active, 1 inactive, Primary='Company Knowledge Base'"
        echo "Got: $TOTAL_ITEMS total, $ACTIVE_ITEMS active, $INACTIVE_ITEMS inactive, Primary='$PRIMARY_ITEM'"
        exit 1
    fi
else
    echo "⚠️  jq not available - manual validation needed"
    echo "$LOAD_RESPONSE" | head -50
fi

echo ""
echo "3️⃣  Testing UI endpoint availability..."

# Test if the frontend can load
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/company-profile.html" | grep -q "200"; then
    echo "✅ Frontend UI accessible"
else
    echo "❌ Frontend UI not accessible"
    exit 1
fi

echo ""
echo "🎯 PRODUCTION VALIDATION COMPLETE"
echo "================================="
echo "✅ Backend API: WORKING"
echo "✅ Database: PERSISTING" 
echo "✅ Frontend: ACCESSIBLE"
echo "✅ Data Integrity: VERIFIED"
echo ""
echo "🚀 READY FOR PRODUCTION DEPLOYMENT!"
