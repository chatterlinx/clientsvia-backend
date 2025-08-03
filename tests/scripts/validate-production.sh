#!/bin/bash

# Production Readiness Validation Script
# Quick validation for production deployment

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BASE_URL="${TEST_BASE_URL:-http://localhost:3000}"
COMPANY_ID="${TEST_COMPANY_ID:-507f1f77bcf86cd799439011}"

echo -e "${BLUE}🚀 PRODUCTION READINESS VALIDATION${NC}"
echo "=================================="
echo ""

# Critical production checks
CHECKS=(
    "Server Health:GET:/api/ai-agent-logic/test/health"
    "Analytics API:GET:/api/ai-agent-logic/test/analytics/$COMPANY_ID/realtime"
    "Frontend Access:GET:/company-profile.html"
)

PASSED=0
FAILED=0

for check in "${CHECKS[@]}"; do
    IFS=':' read -r name method endpoint <<< "$check"
    
    echo -e "${BLUE}🔍 Testing $name...${NC}"
    
    if [ "$method" = "GET" ]; then
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint")
    else
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$endpoint")
    fi
    
    if [ "$STATUS" = "200" ]; then
        echo -e "${GREEN}✅ $name: PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ $name: FAIL (HTTP $STATUS)${NC}"
        ((FAILED++))
    fi
done

echo ""
echo "=================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 PRODUCTION VALIDATION: ✅ PASSED${NC}"
    echo -e "${GREEN}🚀 Ready for production deployment!${NC}"
    exit 0
else
    echo -e "${RED}❌ PRODUCTION VALIDATION: FAILED${NC}"
    echo -e "${RED}⚠️  Fix $FAILED issue(s) before deployment${NC}"
    exit 1
fi
