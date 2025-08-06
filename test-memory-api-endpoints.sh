#!/bin/bash

# Memory Mode Save/Load API Endpoint Test
# Tests if the memory mode dropdown save and load functionality works correctly

echo "🔧 MEMORY MODE API ENDPOINT TEST"
echo "================================="

# Function to test if server is running
check_server() {
    echo "🔍 Checking if server is running..."
    if curl -s http://localhost:3000/api/company/companies > /dev/null 2>&1; then
        echo "✅ Server is running on localhost:3000"
        return 0
    else
        echo "❌ Server is NOT running or not accessible"
        echo "💡 Please start the server with: node server.js"
        return 1
    fi
}

# Function to test save endpoint
test_save_endpoint() {
    echo ""
    echo "📋 TESTING SAVE ENDPOINT..."
    
    # Test save endpoint with sample data
    local test_data='{
        "memoryMode": "persistent",
        "contextRetention": 60,
        "features": {
            "contextualMemory": true,
            "dynamicReasoning": true,
            "smartEscalation": false,
            "autoLearning": true,
            "realtimeOptimization": false
        }
    }'
    
    echo "POST /api/company/companies/test-company/ai-intelligence-settings"
    local response=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "$test_data" \
        http://localhost:3000/api/company/companies/test-company/ai-intelligence-settings \
        2>/dev/null)
    
    if echo "$response" | grep -q "success"; then
        echo "✅ Save endpoint responds successfully"
        echo "📄 Response: $response"
        return 0
    else
        echo "❌ Save endpoint failed"
        echo "📄 Response: $response"
        return 1
    fi
}

# Function to test load endpoint  
test_load_endpoint() {
    echo ""
    echo "📋 TESTING LOAD ENDPOINT..."
    
    echo "GET /api/company/companies/test-company/agent-settings"
    local response=$(curl -s -X GET \
        -H "Content-Type: application/json" \
        http://localhost:3000/api/company/companies/test-company/agent-settings \
        2>/dev/null)
    
    if echo "$response" | grep -q "success\|company"; then
        echo "✅ Load endpoint responds successfully"
        echo "📄 Response: $response"
        return 0
    else
        echo "❌ Load endpoint failed"  
        echo "📄 Response: $response"
        return 1
    fi
}

# Function to show endpoint summary
show_endpoint_summary() {
    echo ""
    echo "🎯 API ENDPOINT SUMMARY:"
    echo "========================"
    echo ""
    echo "FRONTEND ENDPOINTS (Fixed):"
    echo "- Save: POST /api/company/companies/{id}/ai-intelligence-settings"
    echo "- Load: GET /api/company/companies/{id}/agent-settings"
    echo ""
    echo "EXPECTED BACKEND ROUTES:"
    echo "- Save route in: routes/company/agentSettings.js"
    echo "- Load route in: routes/company/agentSettings.js"
    echo "- Base mount: /api/company (from app.js)"
    echo ""
    echo "MEMORY MODE VALUES SUPPORTED:"
    echo "- 'short' - Short Term (Single Response)"
    echo "- 'conversational' - Conversational (Session Memory) [DEFAULT]"
    echo "- 'persistent' - Persistent (Long-term Context)"
}

# Main test execution
echo "🚀 Starting API endpoint tests..."

if check_server; then
    echo ""
    echo "🧪 RUNNING ENDPOINT TESTS..."
    
    save_success=false
    load_success=false
    
    if test_save_endpoint; then
        save_success=true
    fi
    
    if test_load_endpoint; then
        load_success=true
    fi
    
    if $save_success && $load_success; then
        echo ""
        echo "🎉 ALL API TESTS PASSED!"
        echo "✅ Memory mode save/load endpoints are working"
    else
        echo ""
        echo "⚠️ SOME API TESTS FAILED"
        echo "- Save endpoint working: $save_success"
        echo "- Load endpoint working: $load_success"
    fi
    
    show_endpoint_summary
    
    echo ""
    echo "🔧 TROUBLESHOOTING:"
    echo "1. Check server logs for errors"
    echo "2. Verify route definitions in routes/company/agentSettings.js"
    echo "3. Ensure company exists in database"
    echo "4. Check if authentication is required"
    
else
    echo ""
    echo "⚠️ Cannot test endpoints - server not running"
    echo "Please start the server and run this test again"
fi
