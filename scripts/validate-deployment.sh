#!/bin/bash
# DEPLOYMENT VALIDATION SCRIPT
# Run this BEFORE every deploy to catch configuration issues
#
# Usage: ./scripts/validate-deployment.sh https://cv-backend-va.onrender.com

set -e

BACKEND_URL="${1:-https://cv-backend-va.onrender.com}"

echo ""
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║  DEPLOYMENT VALIDATION - PRE-FLIGHT CHECKS                        ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""
echo "Backend URL: $BACKEND_URL"
echo ""

# ═══════════════════════════════════════════════════════════════════════
# CHECK 1: Server is responding
# ═══════════════════════════════════════════════════════════════════════
echo "─── Check 1: Server Health ───"
HEALTH_RESPONSE=$(curl -s "$BACKEND_URL/api/health" || echo "FAILED")

if [ "$HEALTH_RESPONSE" = "FAILED" ]; then
  echo "❌ Server not responding"
  echo "   Check if deployment succeeded"
  exit 1
fi

echo "✅ Server responding"
echo ""

# ═══════════════════════════════════════════════════════════════════════
# CHECK 2: Database name is CORRECT
# ═══════════════════════════════════════════════════════════════════════
echo "─── Check 2: Database Name ───"
DB_NAME=$(echo "$HEALTH_RESPONSE" | jq -r '.details.mongodb.database' 2>/dev/null || echo "UNKNOWN")

if [ "$DB_NAME" = "UNKNOWN" ]; then
  echo "⚠️  Could not parse database name from health response"
  echo "   Response: $HEALTH_RESPONSE"
elif [ "$DB_NAME" = "test" ]; then
  echo "❌ CRITICAL: Connected to 'test' database!"
  echo "   This should be IMPOSSIBLE - server should have crashed"
  echo "   Fix MONGODB_URI in Render to include /clientsvia"
  exit 1
elif [ "$DB_NAME" = "clientsvia" ]; then
  echo "✅ Database: $DB_NAME (CORRECT)"
else
  echo "⚠️  Unexpected database: $DB_NAME"
  echo "   Expected: clientsvia"
  echo "   This might be intentional for staging, but verify it's correct"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════
# CHECK 3: MongoDB connection status
# ═══════════════════════════════════════════════════════════════════════
echo "─── Check 3: MongoDB Status ───"
MONGO_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.systems.mongodb' 2>/dev/null || echo "UNKNOWN")

if [ "$MONGO_STATUS" = "ok" ]; then
  echo "✅ MongoDB: Connected"
else
  echo "❌ MongoDB: $MONGO_STATUS"
  exit 1
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════
# CHECK 4: Overall system status
# ═══════════════════════════════════════════════════════════════════════
echo "─── Check 4: System Status ───"
OVERALL_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "UNKNOWN")

if [ "$OVERALL_STATUS" = "ok" ]; then
  echo "✅ Overall status: OK"
elif [ "$OVERALL_STATUS" = "degraded" ]; then
  echo "⚠️  Overall status: DEGRADED"
  echo "   Check health response for details"
else
  echo "❌ Overall status: $OVERALL_STATUS"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║  VALIDATION SUMMARY                                               ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo "  Database:       $DB_NAME"
echo "  MongoDB:        $MONGO_STATUS"
echo "  Overall:        $OVERALL_STATUS"
echo ""

if [ "$DB_NAME" = "clientsvia" ] && [ "$MONGO_STATUS" = "ok" ]; then
  echo "✅ ALL CHECKS PASSED - Safe to test"
  echo ""
  exit 0
else
  echo "❌ VALIDATION FAILED - Fix issues before testing"
  echo ""
  exit 1
fi
