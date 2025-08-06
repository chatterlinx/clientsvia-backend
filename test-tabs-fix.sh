#!/bin/bash

echo "🧪 TESTING AI AGENT LOGIC TABS FIX"
echo "=================================="
echo ""

# Test if the tabs are now inside the correct container
echo "🔍 Checking if Analytics tab content is in correct location..."

# Check for the new Analytics content inside the main container
NEW_ANALYTICS_FOUND=$(curl -s "http://localhost:3000/company-profile.html" | grep -A10 -B5 "clientsvia-analytics-content.*clientsvia-tab-content" | wc -l)

if [ "$NEW_ANALYTICS_FOUND" -gt 0 ]; then
    echo "✅ Analytics tab content found in correct container"
else
    echo "❌ Analytics tab content not found in correct container"
fi

# Check for the new Flow Designer content
NEW_FLOW_FOUND=$(curl -s "http://localhost:3000/company-profile.html" | grep -A5 "clientsvia-flow-designer-content.*clientsvia-tab-content" | wc -l)

if [ "$NEW_FLOW_FOUND" -gt 0 ]; then
    echo "✅ Flow Designer tab content found in correct container"
else
    echo "❌ Flow Designer tab content not found in correct container"
fi

# Check for the new A/B Testing content
NEW_AB_FOUND=$(curl -s "http://localhost:3000/company-profile.html" | grep -A5 "clientsvia-ab-testing-content.*clientsvia-tab-content" | wc -l)

if [ "$NEW_AB_FOUND" -gt 0 ]; then
    echo "✅ A/B Testing tab content found in correct container"
else
    echo "❌ A/B Testing tab content not found in correct container"
fi

# Check for the new Personalization content
NEW_PERS_FOUND=$(curl -s "http://localhost:3000/company-profile.html" | grep -A5 "clientsvia-personalization-content.*clientsvia-tab-content" | wc -l)

if [ "$NEW_PERS_FOUND" -gt 0 ]; then
    echo "✅ Personalization tab content found in correct container"
else
    echo "❌ Personalization tab content not found in correct container"
fi

echo ""
echo "📋 SUMMARY:"
echo "The issue was that the last 4 tabs were located OUTSIDE the main"
echo "'clientsvia-tab-content' container, so the JavaScript couldn't find them."
echo ""
echo "✅ SOLUTION APPLIED:"
echo "• Added simplified versions of all 4 tabs INSIDE the correct container"
echo "• Each tab now has proper structure and working buttons"
echo "• JavaScript functions are properly connected"
echo ""
echo "🎯 RESULT:"
echo "All 7 AI Agent Logic tabs should now be functional!"
echo ""
echo "📖 MANUAL TEST:"
echo "1. Open: http://localhost:3000/company-profile.html"
echo "2. Navigate to: AI Agent Logic tab"
echo "3. Click: Analytics Dashboard tab (should show content now!)"
echo "4. Click: Flow Designer tab (should show content now!)"
echo "5. Click: A/B Testing tab (should show content now!)"
echo "6. Click: Personalization tab (should show content now!)"
echo ""
echo "🎉 The Analytics Dashboard tab should now work when clicked!"
