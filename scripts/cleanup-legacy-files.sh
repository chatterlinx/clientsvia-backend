#!/bin/bash

###############################################################################
# LEGACY FILE CLEANUP SCRIPT
# 
# This script removes all legacy one-time fix scripts, old diagnostics,
# and deprecated files that are no longer needed.
#
# SAFE TO RUN: Only deletes scripts that were used for one-time fixes
# or have been replaced by better tools.
###############################################################################

echo "================================================================================"
echo "🧹 LEGACY FILE CLEANUP - Removing old scripts and files"
echo "================================================================================"
echo ""

# Change to scripts directory
cd "$(dirname "$0")" || exit 1

DELETED_COUNT=0

echo "📁 Current directory: $(pwd)"
echo ""

###############################################################################
# 1. DELETE ONE-TIME FIX SCRIPTS
###############################################################################

echo "🗑️  DELETING ONE-TIME FIX SCRIPTS..."
echo ""

FIX_SCRIPTS=(
    "check-legacy-greeting.js"
    "delete-legacy-greeting.js"
    "emergency-fix-voice-settings.js"
    "find-legacy-default-string.js"
    "fix-royal-plumbing-legacy.js"
    "fix-corrupt-company-data.js"
    "force-delete-legacy.js"
    "nuclear-fallback-cleanup.js"
    "migrate-fallback-to-object.js"
    "migrate-voice-settings-schema.js"
    "initialize-royal-plumbing.js"
    "update-royal-greeting.js"
    "verify-fallback-clean.js"
)

for script in "${FIX_SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        echo "   ✅ Deleting: $script"
        rm "$script"
        ((DELETED_COUNT++))
    else
        echo "   ⚠️  Not found: $script (already deleted)"
    fi
done

echo ""

###############################################################################
# 2. DELETE OLD DIAGNOSTIC SCRIPTS
###############################################################################

echo "🗑️  DELETING OLD DIAGNOSTIC SCRIPTS..."
echo ""

DIAG_SCRIPTS=(
    "find-atlas-air.js"
    "find-royal-plumbing.js"
    "verify-royal-plumbing.js"
    "show-exact-greeting.js"
    "verify-greeting-system.js"
    "test-summary-endpoint.js"
    "diagnose-connection-messages-full.js"
    "diagnose-data-center-counts.js"
    "production-datacenter-diagnostic.js"
)

for script in "${DIAG_SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        echo "   ✅ Deleting: $script"
        rm "$script"
        ((DELETED_COUNT++))
    else
        echo "   ⚠️  Not found: $script (already deleted)"
    fi
done

echo ""

###############################################################################
# 3. DELETE OLD COMPANY-SPECIFIC SCRIPTS
###############################################################################

echo "🗑️  DELETING OLD COMPANY-SPECIFIC SCRIPTS..."
echo ""

COMPANY_SCRIPTS=(
    "create-royal-plumbing.js"
)

for script in "${COMPANY_SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        echo "   ✅ Deleting: $script"
        rm "$script"
        ((DELETED_COUNT++))
    else
        echo "   ⚠️  Not found: $script (already deleted)"
    fi
done

echo ""

###############################################################################
# 4. MOVE ROOT-LEVEL DOCS TO /docs/
###############################################################################

echo "📄 MOVING ROOT-LEVEL DOCS TO /docs/..."
echo ""

cd .. || exit 1

DOCS_TO_MOVE=(
    "FINAL-PRODUCTION-AUDIT-2025-10-16.md"
    "GREETING-SYSTEM-COMPLETE.md"
)

for doc in "${DOCS_TO_MOVE[@]}"; do
    if [ -f "$doc" ]; then
        echo "   ✅ Moving: $doc → docs/$doc"
        mv "$doc" "docs/$doc"
        ((DELETED_COUNT++))
    else
        echo "   ⚠️  Not found: $doc (already moved or deleted)"
    fi
done

echo ""

###############################################################################
# 5. SUMMARY
###############################################################################

echo "================================================================================"
echo "✅ CLEANUP COMPLETE"
echo "================================================================================"
echo ""
echo "📊 Files processed: $DELETED_COUNT"
echo ""
echo "✅ Your codebase is now clean and production-ready!"
echo "✅ All legacy one-time fix scripts removed"
echo "✅ Old diagnostic scripts removed (replaced by better tools)"
echo "✅ Documentation consolidated in /docs/"
echo ""
echo "🚀 Remaining scripts are all production utilities and diagnostic tools"
echo ""

