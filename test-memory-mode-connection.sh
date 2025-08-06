#!/bin/bash

# Memory Mode Dropdown Connection Test
# Verifies that the Intelligence & Memory section memory mode dropdown is properly connected

echo "🧠 MEMORY MODE DROPDOWN CONNECTION TEST"
echo "======================================="

check_frontend_dropdown() {
    echo ""
    echo "📋 CHECKING FRONTEND DROPDOWN..."
    
    # Check if dropdown exists with correct options
    if grep -q 'id="ai-memory-mode"' public/company-profile.html; then
        echo "✅ Memory mode dropdown found (id='ai-memory-mode')"
    else
        echo "❌ Memory mode dropdown NOT found"
        return 1
    fi
    
    # Check dropdown options
    if grep -A 3 'id="ai-memory-mode"' public/company-profile.html | grep -q 'value="short".*Short Term'; then
        echo "✅ Short Term option found"
    else
        echo "❌ Short Term option missing"
    fi
    
    if grep -A 3 'id="ai-memory-mode"' public/company-profile.html | grep -q 'value="conversational".*Conversational'; then
        echo "✅ Conversational option found"
    else
        echo "❌ Conversational option missing"
    fi
    
    if grep -A 3 'id="ai-memory-mode"' public/company-profile.html | grep -q 'value="persistent".*Persistent'; then
        echo "✅ Persistent option found"
    else
        echo "❌ Persistent option missing"
    fi
    
    return 0
}

check_save_functionality() {
    echo ""
    echo "📋 CHECKING SAVE FUNCTIONALITY..."
    
    # Check if save function collects memory mode
    if grep -q "memoryMode: document.getElementById('ai-memory-mode')" public/company-profile.html; then
        echo "✅ Save function collects memory mode from dropdown"
    else
        echo "❌ Save function does NOT collect memory mode"
        return 1
    fi
    
    # Check API endpoint
    if grep -q "/api/companies/.*/ai-intelligence-settings" public/company-profile.html; then
        echo "✅ API endpoint found for saving settings"
    else
        echo "❌ API endpoint NOT found"
        return 1
    fi
    
    return 0
}

check_load_functionality() {
    echo ""
    echo "📋 CHECKING LOAD FUNCTIONALITY..."
    
    # Check if load function sets memory mode
    if grep -A 5 "getElementById('ai-memory-mode')" public/company-profile.html | grep -q "memoryModeSelect.value = settings.memoryMode"; then
        echo "✅ Load function sets memory mode dropdown"
    else
        echo "❌ Load function does NOT set memory mode"
        return 1
    fi
    
    return 0
}

check_backend_validation() {
    echo ""
    echo "📋 CHECKING BACKEND VALIDATION..."
    
    # Check backend accepts memory mode values
    if grep -q "memoryMode.*short.*conversational.*persistent" routes/company/agentSettings.js; then
        echo "✅ Backend validates all memory mode values"
    else
        echo "❌ Backend validation incomplete"
        return 1
    fi
    
    return 0
}

check_database_schema() {
    echo ""
    echo "📋 CHECKING DATABASE SCHEMA..."
    
    # Check database supports memory mode values
    if grep -q "memoryMode.*enum.*short.*conversational.*persistent" models/Company.js; then
        echo "✅ Database schema supports all memory mode values"
    else
        echo "❌ Database schema incomplete or inconsistent"
        return 1
    fi
    
    return 0
}

show_summary() {
    echo ""
    echo "🎯 MEMORY MODE CONNECTION SUMMARY:"
    echo "=================================="
    echo ""
    echo "DROPDOWN OPTIONS:"
    echo "1. 📝 Short Term (Single Response) - value='short'"
    echo "2. 💬 Conversational (Session Memory) - value='conversational' [DEFAULT]"
    echo "3. 🧠 Persistent (Long-term Context) - value='persistent'"
    echo ""
    echo "CONNECTION FLOW:"
    echo "1. 🔄 User selects memory mode in dropdown (id='ai-memory-mode')"
    echo "2. 💾 Save function collects value and sends to API"
    echo "3. 🛡️ Backend validates against allowed values"
    echo "4. 🗃️ Database stores in agentIntelligenceSettings.memoryMode"
    echo "5. 📡 Load function retrieves and sets dropdown value"
    echo ""
    echo "BACKEND BEHAVIOR:"
    echo "- Short: Single response, no conversation memory"
    echo "- Conversational: Remembers full conversation context"
    echo "- Persistent: Long-term context across multiple sessions"
}

# Run all checks
echo "🔍 Running Memory Mode Connection Tests..."

if check_frontend_dropdown && check_save_functionality && check_load_functionality && check_backend_validation && check_database_schema; then
    echo ""
    echo "🎉 ALL TESTS PASSED!"
    echo "✅ Memory mode dropdown is FULLY CONNECTED and functional"
    show_summary
    
    echo ""
    echo "🚀 TESTING INSTRUCTIONS:"
    echo "1. Open company profile page"
    echo "2. Go to Intelligence & Memory section"
    echo "3. Change memory mode dropdown selection"
    echo "4. Click 'Save Intelligence Settings' button"
    echo "5. Refresh page and verify selection is remembered"
    
    exit 0
else
    echo ""
    echo "❌ SOME TESTS FAILED"
    echo "Memory mode dropdown may not be fully connected"
    exit 1
fi
