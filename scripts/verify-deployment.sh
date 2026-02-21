#!/bin/bash

# ============================================================================
# DEPLOYMENT VERIFICATION SCRIPT
# ============================================================================
# Quick health check to verify the Gather fix is deployed
# Usage: bash scripts/verify-deployment.sh
# ============================================================================

echo "════════════════════════════════════════════════════════════════════════════════"
echo "🔍 DEPLOYMENT VERIFICATION - Twilio Gather Fix"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""

# Check 1: Git commit
echo "1️⃣  Checking current Git commit..."
CURRENT_COMMIT=$(git rev-parse --short HEAD)
TARGET_COMMIT="6e5d9485"

if [[ "$CURRENT_COMMIT" == "$TARGET_COMMIT"* ]]; then
    echo "   ✅ Current commit: $CURRENT_COMMIT (matches target)"
else
    echo "   ⚠️  Current commit: $CURRENT_COMMIT (expected $TARGET_COMMIT)"
    echo "   This may be a newer commit (which is fine)"
fi
echo ""

# Check 2: Verify actionOnEmptyResult exists in code
echo "2️⃣  Checking for actionOnEmptyResult in code..."
GATHER_COUNT=$(grep -c "actionOnEmptyResult: true" routes/v2twilio.js)

if [ "$GATHER_COUNT" -ge 10 ]; then
    echo "   ✅ Found $GATHER_COUNT instances of actionOnEmptyResult: true"
else
    echo "   ❌ Only found $GATHER_COUNT instances (expected 10+)"
    echo "   Code may not be deployed correctly"
fi
echo ""

# Check 3: Verify speechTimeout auto exists
echo "3️⃣  Checking for speechTimeout: 'auto' in code..."
AUTO_TIMEOUT_COUNT=$(grep -c "speechTimeout: 'auto'" routes/v2twilio.js)

if [ "$AUTO_TIMEOUT_COUNT" -ge 8 ]; then
    echo "   ✅ Found $AUTO_TIMEOUT_COUNT instances of speechTimeout: 'auto'"
else
    echo "   ⚠️  Only found $AUTO_TIMEOUT_COUNT instances"
fi
echo ""

# Check 4: Node.js version
echo "4️⃣  Checking Node.js version..."
NODE_VERSION=$(node --version)
echo "   ℹ️  Node.js: $NODE_VERSION"
echo ""

# Check 5: Environment check
echo "5️⃣  Checking critical environment variables..."
if [ -z "$MONGODB_URI" ]; then
    echo "   ❌ MONGODB_URI not set"
else
    echo "   ✅ MONGODB_URI is set"
fi

if [ -z "$OPENAI_API_KEY" ]; then
    echo "   ❌ OPENAI_API_KEY not set"
else
    echo "   ✅ OPENAI_API_KEY is set"
fi

if [ -z "$ELEVENLABS_API_KEY" ]; then
    echo "   ⚠️  ELEVENLABS_API_KEY not set (TTS may fall back to Twilio)"
else
    echo "   ✅ ELEVENLABS_API_KEY is set"
fi
echo ""

# Check 6: Audio directory (ephemeral storage check)
echo "6️⃣  Checking audio directory..."
if [ -d "public/audio" ]; then
    AUDIO_COUNT=$(find public/audio -name "*.mp3" 2>/dev/null | wc -l)
    echo "   ℹ️  Found $AUDIO_COUNT audio files in public/audio/"
    echo "   ⚠️  NOTE: These are EPHEMERAL - will be wiped on redeploy"
else
    echo "   ⚠️  public/audio directory not found (will be created on first use)"
fi
echo ""

# Check 7: Package.json check
echo "7️⃣  Checking package.json..."
if [ -f "package.json" ]; then
    echo "   ✅ package.json exists"
    START_COMMAND=$(grep -o '"start": "[^"]*"' package.json | cut -d'"' -f4)
    echo "   ℹ️  Start command: $START_COMMAND"
else
    echo "   ❌ package.json not found"
fi
echo ""

# Summary
echo "════════════════════════════════════════════════════════════════════════════════"
echo "📊 SUMMARY"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Deployment commit: $CURRENT_COMMIT"
echo "Gather fixes applied: $GATHER_COUNT instances"
echo "Auto speechTimeout: $AUTO_TIMEOUT_COUNT instances"
echo ""
echo "✅ Next steps:"
echo "   1. Make a test call and stay silent"
echo "   2. Check logs for: POST /api/twilio/v2-agent-respond/:companyId"
echo "   3. Verify no infinite loops"
echo "   4. Check Render dashboard for deployment status"
echo ""
echo "📝 Full documentation: docs/DEPLOYMENT-FIX-2026-02-20.md"
echo "════════════════════════════════════════════════════════════════════════════════"
