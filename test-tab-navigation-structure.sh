#!/bin/bash

echo "🔍 Testing AI Agent Logic Tab Navigation Fix"
echo "=============================================="

# Check if tab navigation container exists and is properly structured
echo "1. Checking tab navigation container..."
if grep -q "Tab Navigation - Fixed Responsive Design" /Users/marc/MyProjects/clientsvia-backend/public/company-profile.html; then
    echo "   ✅ Found fixed responsive navigation"
else
    echo "   ❌ Fixed navigation not found"
fi

# Check for the 7 tab buttons
echo "2. Checking for all 7 tab buttons..."
tab_buttons=(
    "clientsvia-tab-priority"
    "clientsvia-tab-knowledge" 
    "clientsvia-tab-personality"
    "clientsvia-tab-analytics"
    "clientsvia-tab-flow-designer"
    "clientsvia-tab-ab-testing"
    "clientsvia-tab-personalization"
)

for tab in "${tab_buttons[@]}"; do
    if grep -q "id=\"$tab\"" /Users/marc/MyProjects/clientsvia-backend/public/company-profile.html; then
        echo "   ✅ Found tab button: $tab"
    else
        echo "   ❌ Missing tab button: $tab"
    fi
done

# Check for corresponding tab content
echo "3. Checking for all 7 tab content sections..."
tab_contents=(
    "clientsvia-priority-content"
    "clientsvia-knowledge-content"
    "clientsvia-personality-content" 
    "clientsvia-analytics-content"
    "clientsvia-flow-designer-content"
    "clientsvia-ab-testing-content"
    "clientsvia-personalization-content"
)

for content in "${tab_contents[@]}"; do
    if grep -q "id=\"$content\"" /Users/marc/MyProjects/clientsvia-backend/public/company-profile.html; then
        echo "   ✅ Found tab content: $content"
    else
        echo "   ❌ Missing tab content: $content"
    fi
done

# Check for proper tab container structure
echo "4. Checking tab container structure..."
if grep -q "clientsvia-tab-content" /Users/marc/MyProjects/clientsvia-backend/public/company-profile.html; then
    container_count=$(grep -c "clientsvia-tab-content" /Users/marc/MyProjects/clientsvia-backend/public/company-profile.html)
    echo "   ✅ Found clientsvia-tab-content references: $container_count"
else
    echo "   ❌ Tab container structure issue"
fi

# Check for duplicates (this should find fewer instances after cleanup)
echo "5. Checking for duplicate sections..."
duplicate_analytics=$(grep -c "Real-time Analytics Dashboard" /Users/marc/MyProjects/clientsvia-backend/public/company-profile.html || true)
duplicate_flow=$(grep -c "Conversation Flow Designer" /Users/marc/MyProjects/clientsvia-backend/public/company-profile.html || true)
duplicate_ab=$(grep -c "A/B Testing Framework" /Users/marc/MyProjects/clientsvia-backend/public/company-profile.html || true)
duplicate_personal=$(grep -c "Advanced Personalization Engine" /Users/marc/MyProjects/clientsvia-backend/public/company-profile.html || true)

echo "   📊 Analytics Dashboard mentions: $duplicate_analytics (should be 1-2)"
echo "   🎨 Flow Designer mentions: $duplicate_flow (should be 1-2)"  
echo "   🧪 A/B Testing mentions: $duplicate_ab (should be 1-2)"
echo "   🤖 Personalization mentions: $duplicate_personal (should be 1-2)"

if [ $duplicate_analytics -gt 2 ] || [ $duplicate_flow -gt 2 ] || [ $duplicate_ab -gt 2 ] || [ $duplicate_personal -gt 2 ]; then
    echo "   ⚠️  Still has duplicate content that needs cleanup"
else
    echo "   ✅ Duplicate content levels acceptable"
fi

echo ""
echo "🚀 Tab Navigation Fix Test Complete!"
echo "=============================================="
