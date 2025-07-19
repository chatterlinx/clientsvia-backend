#!/bin/bash
# test-hard-fix.sh - Final validation of the hard fixes

echo "🔧 HARD FIX VALIDATION TEST"
echo "============================="
echo ""

# Test 1: Positive case - should return full answer
echo "📋 Test 1: Blank thermostat (should show 100% match)"
echo "Query: 'i have a blank thermostat'"
echo ""

response1=$(curl -s -X POST http://localhost:4000/api/ai-agent/test-custom-kb-trace \
  -H "Content-Type: application/json" \
  -d '{"query": "i have a blank thermostat", "companyId": "686a680241806a4991f7367f"}')

success1=$(echo "$response1" | jq -r '.success')
result1=$(echo "$response1" | jq -r '.result')
confidence1=$(echo "$response1" | jq -r '.trace.selectedConfidence')

echo "✅ Success: $success1"
echo "✅ Confidence: $confidence1%"
echo "✅ Result length: ${#result1} characters"
echo "✅ Result preview: $(echo "$result1" | cut -c1-50)..."
echo ""

# Test 2: Negative case - should return no match
echo "📋 Test 2: Fix my kite (should show 0% match)"
echo "Query: 'fix my kite'"
echo ""

response2=$(curl -s -X POST http://localhost:4000/api/ai-agent/test-custom-kb-trace \
  -H "Content-Type: application/json" \
  -d '{"query": "fix my kite", "companyId": "686a680241806a4991f7367f"}')

success2=$(echo "$response2" | jq -r '.success')
result2=$(echo "$response2" | jq -r '.result')
confidence2=$(echo "$response2" | jq -r '.trace.selectedConfidence')

echo "✅ Success: $success2"
echo "✅ Confidence: $confidence2%"
echo "✅ Result: $result2"
echo ""

# Summary
echo "🎯 HARD FIX VALIDATION SUMMARY"
echo "=============================="
if [ "$success1" = "true" ] && [ "$confidence1" = "100" ] && [ ${#result1} -gt 50 ]; then
    echo "✅ Test 1 PASSED: 100% match returns full answer"
else
    echo "❌ Test 1 FAILED: Expected 100% match with full answer"
fi

if [ "$success2" = "true" ] && [ "$confidence2" = "0" ] && [ "$result2" = "null" ]; then
    echo "✅ Test 2 PASSED: No match returns null result"
else
    echo "❌ Test 2 FAILED: Expected 0% match with null result"
fi

echo ""
echo "🚀 Next: Test the UI at http://localhost:4000/company-profile.html?companyId=686a680241806a4991f7367f"
echo "   Input 'i have a blank thermostat' - should show the full answer and trace."
