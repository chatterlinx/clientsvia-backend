#!/bin/bash

# AI Agent Logic System - Comprehensive Audit and Fix Script
# This script identifies and fixes all issues in the AI Agent Logic tab

echo "🔍 AI AGENT LOGIC COMPREHENSIVE AUDIT"
echo "===================================="

echo "1. 📋 CHECKING HTML UI STRUCTURE..."

# Check if the HTML file exists and has proper structure
if [ -f "public/ai-agent-logic.html" ]; then
    echo "✅ HTML file exists"
    
    # Check for required elements
    if grep -q "saveResponseCategories" public/ai-agent-logic.html; then
        echo "✅ Save function exists in HTML"
    else
        echo "❌ Save function missing in HTML"
    fi
    
    if grep -q "getCurrentCompanyId" public/ai-agent-logic.html; then
        echo "✅ Company ID function exists"
    else
        echo "❌ Company ID function missing"
    fi
else
    echo "❌ HTML file missing"
fi

echo ""
echo "2. 🛠️ CHECKING API ROUTES..."

# Check if API routes exist
if [ -f "routes/aiAgentLogic.js" ]; then
    echo "✅ API routes file exists"
    
    if grep -q "save-config" routes/aiAgentLogic.js; then
        echo "✅ Save config route exists"
    else
        echo "❌ Save config route missing"
    fi
    
    if grep -q "verify-config" routes/aiAgentLogic.js; then
        echo "✅ Verify config route exists"
    else
        echo "❌ Verify config route missing"
    fi
else
    echo "❌ API routes file missing"
fi

echo ""
echo "3. 📊 CHECKING DATABASE SCHEMA..."

# Check Company model
if [ -f "models/Company.js" ]; then
    echo "✅ Company model exists"
    
    if grep -q "aiAgentLogic" models/Company.js; then
        echo "✅ aiAgentLogic schema exists"
    else
        echo "❌ aiAgentLogic schema missing"
    fi
else
    echo "❌ Company model missing"
fi

echo ""
echo "4. 🔄 CHECKING ROUTE MOUNTING..."

# Check if routes are properly mounted
if grep -q "aiAgentLogic" app.js || grep -q "aiAgentLogic" index.js; then
    echo "✅ Routes appear to be mounted"
else
    echo "❌ Routes may not be mounted properly"
fi

echo ""
echo "🏁 AUDIT COMPLETE"
echo "=================="
echo "Next: Run fixes based on findings above"
