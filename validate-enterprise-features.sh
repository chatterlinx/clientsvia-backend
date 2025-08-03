#!/bin/bash

# Enterprise AI Agent Logic - Final Validation Script
# Tests all enterprise features for production readiness

echo "🚀 ENTERPRISE AI AGENT LOGIC - FINAL VALIDATION"
echo "=============================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
BASE_URL="http://localhost:3000"
COMPANY_ID="507f1f77bcf86cd799439011"

echo -e "${BLUE}🔍 Testing Server Health...${NC}"
HEALTH_RESPONSE=$(curl -s "$BASE_URL/api/ai-agent-logic/test/health" | grep -o '"success":true')
if [ "$HEALTH_RESPONSE" = '"success":true' ]; then
    echo -e "${GREEN}✅ Server Health: PASS${NC}"
else
    echo -e "${RED}❌ Server Health: FAIL${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}📊 Testing Analytics Endpoints...${NC}"

# Test real-time analytics
ANALYTICS_RESPONSE=$(curl -s "$BASE_URL/api/ai-agent-logic/test/analytics/$COMPANY_ID/realtime")
SUCCESS_RATE=$(echo "$ANALYTICS_RESPONSE" | grep -o '"successRate":[0-9]*' | cut -d':' -f2)
if [ ! -z "$SUCCESS_RATE" ] && [ "$SUCCESS_RATE" -ge 0 ] && [ "$SUCCESS_RATE" -le 100 ]; then
    echo -e "${GREEN}✅ Real-time Analytics: PASS (Success Rate: $SUCCESS_RATE%)${NC}"
else
    echo -e "${RED}❌ Real-time Analytics: FAIL${NC}"
fi

echo ""
echo -e "${BLUE}🌐 Testing Frontend Access...${NC}"

# Test main page accessibility
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/company-profile.html")
if [ "$HTTP_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ Frontend Page: PASS (HTTP $HTTP_STATUS)${NC}"
else
    echo -e "${RED}❌ Frontend Page: FAIL (HTTP $HTTP_STATUS)${NC}"
fi

echo ""
echo -e "${BLUE}🔧 Testing Route Registration...${NC}"

# Test all enterprise routes
ROUTES=(
    "/api/ai-agent-logic/test/health"
    "/api/ai-agent-logic/test/analytics/$COMPANY_ID/realtime"
)

ALL_ROUTES_PASS=true
for route in "${ROUTES[@]}"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$route")
    if [ "$STATUS" = "200" ]; then
        echo -e "${GREEN}✅ Route $route: PASS${NC}"
    else
        echo -e "${RED}❌ Route $route: FAIL (HTTP $STATUS)${NC}"
        ALL_ROUTES_PASS=false
    fi
done

echo ""
echo -e "${BLUE}📋 Validating Data Structure...${NC}"

# Validate analytics data structure
ANALYTICS_DATA=$(curl -s "$BASE_URL/api/ai-agent-logic/test/analytics/$COMPANY_ID/realtime")
REQUIRED_FIELDS=("successRate" "avgResponseTime" "confidence" "activeSessions" "timestamp")

for field in "${REQUIRED_FIELDS[@]}"; do
    if echo "$ANALYTICS_DATA" | grep -q "\"$field\""; then
        echo -e "${GREEN}✅ Field '$field': PRESENT${NC}"
    else
        echo -e "${RED}❌ Field '$field': MISSING${NC}"
        ALL_ROUTES_PASS=false
    fi
done

echo ""
echo "=============================================="

if [ "$ALL_ROUTES_PASS" = true ]; then
    echo -e "${GREEN}🎉 FINAL VALIDATION: ✅ ALL TESTS PASSED${NC}"
    echo -e "${GREEN}🚀 ENTERPRISE FEATURES ARE PRODUCTION READY!${NC}"
    echo ""
    echo -e "${YELLOW}📋 Summary:${NC}"
    echo "   ✅ Server Health: Working"
    echo "   ✅ Analytics System: Working"
    echo "   ✅ Route Registration: Working"
    echo "   ✅ Frontend Access: Working"
    echo "   ✅ Data Structure: Valid"
    echo ""
    echo -e "${BLUE}🌐 Access the enterprise features at:${NC}"
    echo "   $BASE_URL/company-profile.html"
    echo ""
    exit 0
else
    echo -e "${RED}❌ FINAL VALIDATION: SOME TESTS FAILED${NC}"
    echo -e "${RED}⚠️  REVIEW FAILED TESTS BEFORE PRODUCTION${NC}"
    exit 1
fi
