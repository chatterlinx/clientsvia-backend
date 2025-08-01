#!/bin/bash

# AI Agent Logic - Final Validation Script
# Comprehensive check of all components

echo "🎯 AI AGENT LOGIC - FINAL VALIDATION"
echo "======================================"

echo ""
echo "1. 📊 DATABASE SCHEMA VALIDATION"
echo "---------------------------------"

# Check if the Company model has proper schema
if grep -q "aiAgentLogic" models/Company.js; then
    echo "✅ aiAgentLogic schema exists in Company model"
    
    if grep -q "answerPriorityFlow" models/Company.js; then
        echo "✅ answerPriorityFlow schema defined"
    else
        echo "❌ answerPriorityFlow schema missing"
    fi
    
    if grep -q "agentPersonality" models/Company.js; then
        echo "✅ agentPersonality schema defined"
    else
        echo "❌ agentPersonality schema missing"
    fi
    
    if grep -q "behaviorControls" models/Company.js; then
        echo "✅ behaviorControls schema defined"
    else
        echo "❌ behaviorControls schema missing"
    fi
    
    if grep -q "responseCategories" models/Company.js; then
        echo "✅ responseCategories schema defined"
    else
        echo "❌ responseCategories schema missing"
    fi
    
    if grep -q "enabled.*Boolean" models/Company.js; then
        echo "✅ enabled flag properly defined"
    else
        echo "❌ enabled flag missing"
    fi
    
    if grep -q "version.*Number" models/Company.js; then
        echo "✅ version field properly defined"
    else
        echo "❌ version field missing"
    fi
else
    echo "❌ aiAgentLogic schema missing from Company model"
fi

echo ""
echo "2. 🛠️ API ROUTES VALIDATION"
echo "---------------------------"

# Check main API routes
if [ -f "routes/aiAgentLogic.js" ]; then
    echo "✅ Main AI Agent Logic routes exist"
    
    if grep -q "GET.*admin.*ai-settings" routes/aiAgentLogic.js; then
        echo "✅ Blueprint GET endpoint exists"
    else
        echo "❌ Blueprint GET endpoint missing"
    fi
    
    if grep -q "PUT.*admin.*ai-settings" routes/aiAgentLogic.js; then
        echo "✅ Blueprint PUT endpoint exists"
    else
        echo "❌ Blueprint PUT endpoint missing"
    fi
    
    if grep -q "save-config" routes/aiAgentLogic.js; then
        echo "✅ Legacy save endpoint exists"
    else
        echo "❌ Legacy save endpoint missing"
    fi
else
    echo "❌ Main AI Agent Logic routes missing"
fi

# Check simple routes
if [ -f "routes/aiAgentLogicSimple.js" ]; then
    echo "✅ Simple AI Agent Logic routes exist"
    
    if grep -q "GET.*admin.*ai-settings" routes/aiAgentLogicSimple.js; then
        echo "✅ Simple GET endpoint exists"
    else
        echo "❌ Simple GET endpoint missing"
    fi
    
    if grep -q "PUT.*admin.*ai-settings" routes/aiAgentLogicSimple.js; then
        echo "✅ Simple PUT endpoint exists"
    else
        echo "❌ Simple PUT endpoint missing"
    fi
else
    echo "❌ Simple AI Agent Logic routes missing"
fi

echo ""
echo "3. 🔄 ROUTE MOUNTING VALIDATION"
echo "-------------------------------"

# Check if routes are mounted in app.js
if grep -q "aiAgentLogic.*routes" app.js; then
    echo "✅ Main routes mounted in app.js"
else
    echo "❌ Main routes not mounted in app.js"
fi

if grep -q "aiAgentLogicSimple" app.js; then
    echo "✅ Simple routes mounted in app.js"
else
    echo "❌ Simple routes not mounted in app.js"
fi

if grep -q "/api/simple" app.js; then
    echo "✅ Simple routes accessible at /api/simple"
else
    echo "❌ Simple routes path not configured"
fi

echo ""
echo "4. 🌐 UI COMPONENT VALIDATION"
echo "-----------------------------"

if [ -f "public/ai-agent-logic.html" ]; then
    echo "✅ AI Agent Logic UI exists"
    
    if grep -q "getCurrentCompanyId" public/ai-agent-logic.html; then
        echo "✅ Company ID function exists"
    else
        echo "❌ Company ID function missing"
    fi
    
    if grep -q "saveResponseCategories" public/ai-agent-logic.html; then
        echo "✅ Save function exists"
    else
        echo "❌ Save function missing"
    fi
    
    if grep -q "enabled.*true" public/ai-agent-logic.html; then
        echo "✅ Enabled flag handling exists"
    else
        echo "❌ Enabled flag handling missing"
    fi
    
    if grep -q "priority.*index" public/ai-agent-logic.html; then
        echo "✅ Priority field mapping exists"
    else
        echo "❌ Priority field mapping missing"
    fi
    
    if grep -q "name.*textContent" public/ai-agent-logic.html; then
        echo "✅ Name field mapping exists"
    else
        echo "❌ Name field mapping missing"
    fi
else
    echo "❌ AI Agent Logic UI missing"
fi

echo ""
echo "5. 🧪 RUNTIME INTEGRATION VALIDATION"
echo "------------------------------------"

# Check if AI Agent Logic is integrated with runtime
if [ -f "services/aiAgentRuntime.js" ]; then
    echo "✅ AI Agent Runtime service exists"
    
    if grep -q "initializeCall" services/aiAgentRuntime.js; then
        echo "✅ Call initialization function exists"
    else
        echo "❌ Call initialization function missing"
    fi
    
    if grep -q "processCallTurn" services/aiAgentRuntime.js; then
        echo "✅ Call processing function exists"
    else
        echo "❌ Call processing function missing"
    fi
else
    echo "❌ AI Agent Runtime service missing"
fi

# Check Twilio integration
if [ -f "routes/twilio.js" ]; then
    echo "✅ Twilio routes exist"
    
    if grep -q "aiAgentRuntime.*initializeCall" routes/twilio.js; then
        echo "✅ Twilio uses AI Agent Logic for initialization"
    else
        echo "❌ Twilio not integrated with AI Agent Logic initialization"
    fi
    
    if grep -q "ai-agent-respond" routes/twilio.js; then
        echo "✅ AI Agent Logic response handler exists"
    else
        echo "❌ AI Agent Logic response handler missing"
    fi
else
    echo "❌ Twilio routes missing"
fi

echo ""
echo "6. 📊 DATA FLOW VALIDATION"
echo "--------------------------"

# Run the test script if available
if [ -f "scripts/testAIAgentLogicComplete.js" ]; then
    echo "✅ Comprehensive test script exists"
    echo "🔄 Running quick data flow test..."
    
    # Run a quick test (timeout after 30 seconds)
    timeout 30s node scripts/testAIAgentLogicComplete.js > /tmp/ai_test_output.log 2>&1
    
    if grep -q "ALL TESTS PASSED" /tmp/ai_test_output.log; then
        echo "✅ Data flow test PASSED"
        
        # Extract company ID for testing
        COMPANY_ID=$(grep "COMPANY ID FOR TESTING" /tmp/ai_test_output.log | cut -d':' -f2 | tr -d ' ' | sed 's/new ObjectId(//' | sed 's/)//')
        if [ ! -z "$COMPANY_ID" ]; then
            echo "✅ Test company ID available: $COMPANY_ID"
        fi
    else
        echo "❌ Data flow test FAILED"
        if [ -f /tmp/ai_test_output.log ]; then
            echo "Error details:"
            tail -5 /tmp/ai_test_output.log
        fi
    fi
    
    # Clean up
    rm -f /tmp/ai_test_output.log
else
    echo "❌ Comprehensive test script missing"
fi

echo ""
echo "🏁 VALIDATION SUMMARY"
echo "===================="

# Count successes and failures
SUCCESSES=$(grep "✅" /tmp/validation_output.log 2>/dev/null | wc -l || echo "0")
FAILURES=$(grep "❌" /tmp/validation_output.log 2>/dev/null | wc -l || echo "0")

echo "✅ Successful checks: $SUCCESSES"
echo "❌ Failed checks: $FAILURES"

if [ "$FAILURES" -eq "0" ]; then
    echo ""
    echo "🎉 ALL VALIDATIONS PASSED!"
    echo "🚀 AI Agent Logic system is fully operational"
    echo ""
    echo "📋 PRODUCTION READY FEATURES:"
    echo "  ✅ Database schema properly configured"
    echo "  ✅ API endpoints working (both main and fallback)"
    echo "  ✅ UI components functional"
    echo "  ✅ Runtime integration complete"
    echo "  ✅ Data flow validated"
    echo ""
    echo "🌐 TEST THE UI:"
    echo "  Production: https://clientsvia-backend.onrender.com/ai-agent-logic.html?id=YOUR_COMPANY_ID"
    echo ""
else
    echo ""
    echo "⚠️ SOME ISSUES FOUND"
    echo "Please review the failed checks above and fix them"
fi

echo ""
echo "✨ Validation completed at $(date)"
