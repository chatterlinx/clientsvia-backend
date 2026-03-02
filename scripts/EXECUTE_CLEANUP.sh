#!/bin/bash

# ════════════════════════════════════════════════════════════════════════════
# NUCLEAR CLEANUP EXECUTION SCRIPT
# ════════════════════════════════════════════════════════════════════════════
# 
# This script helps you execute the nuclear cleanup by prompting for
# MongoDB URI if not already set.
# 
# USAGE:
#   chmod +x scripts/EXECUTE_CLEANUP.sh
#   ./scripts/EXECUTE_CLEANUP.sh
# 
# OR:
#   MONGODB_URI="mongodb+srv://..." ./scripts/EXECUTE_CLEANUP.sh
# 
# ════════════════════════════════════════════════════════════════════════════

set -e  # Exit on error

echo "════════════════════════════════════════════════════════════════════════════"
echo "☢️  NUCLEAR CLEANUP: Trigger System Sanitation"
echo "════════════════════════════════════════════════════════════════════════════"
echo ""

# Check if MONGODB_URI is set
if [ -z "$MONGODB_URI" ]; then
    echo "⚠️  MONGODB_URI not set in environment"
    echo ""
    echo "Get your MongoDB connection string from:"
    echo "  - Render.com dashboard → clientsvia-backend → Environment → MONGODB_URI"
    echo "  - OR from your local .env file"
    echo ""
    read -p "Enter MongoDB URI: " MONGODB_URI_INPUT
    export MONGODB_URI="$MONGODB_URI_INPUT"
fi

echo "✅ MongoDB URI is set"
echo ""

# Confirm before proceeding
echo "⚠️  THIS WILL:"
echo "   1. Backup all legacy/fake trigger data"
echo "   2. DELETE all legacy playbook.rules"
echo "   3. DELETE all CompanyLocalTrigger records"
echo "   4. Seed official 42-trigger library"
echo "   5. Assign to all companies"
echo "   6. Enable strict mode"
echo ""
read -p "Type 'NUKE' to proceed: " CONFIRM

if [ "$CONFIRM" != "NUKE" ]; then
    echo "❌ Aborted"
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "EXECUTING CLEANUP..."
echo "════════════════════════════════════════════════════════════════════════════"
echo ""

# Run the cleanup script
node scripts/nuclearCleanupTriggers.js

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "════════════════════════════════════════════════════════════════════════════"
    echo "✅ CLEANUP COMPLETE"
    echo "════════════════════════════════════════════════════════════════════════════"
    echo ""
    echo "NEXT STEPS:"
    echo "  1. Make a test call to Penguin Air"
    echo "  2. Check Call Console → TRIGGER_POOL_SOURCE event"
    echo "  3. Verify: total: 42, scopes: { GLOBAL: 42 }"
    echo "  4. Verify: ruleIdsByScope.UNKNOWN is empty []"
    echo ""
else
    echo ""
    echo "════════════════════════════════════════════════════════════════════════════"
    echo "❌ CLEANUP FAILED"
    echo "════════════════════════════════════════════════════════════════════════════"
    echo ""
    echo "Check error messages above and try again."
    echo ""
    exit $EXIT_CODE
fi
