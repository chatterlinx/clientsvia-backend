#!/bin/bash

# Quick Status Check for AI Assistant Context
# Run this to quickly understand the current state of the test suite

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}🤖 AI Assistant Context: ClientsVia Test Suite Status${NC}"
echo "=================================================="

cd "$TEST_DIR"

echo -e "${BLUE}📍 Location:${NC} $TEST_DIR"
echo -e "${BLUE}📅 Date:${NC} $(date)"
echo

# Check key files exist
echo -e "${BLUE}📁 Key Files Status:${NC}"
echo "─────────────────────"

check_file() {
    if [ -f "$1" ]; then
        echo -e "✅ $1"
    else
        echo -e "❌ $1 (missing)"
    fi
}

check_file "AI_ASSISTANT_CONTEXT.md"
check_file "README.md"
check_file "DOCUMENTATION_INDEX.md"
check_file "package.json"
check_file "TestRunner.js"
echo

# Check dependencies
echo -e "${BLUE}📦 Dependencies:${NC}"
echo "─────────────────"
if [ -d "node_modules" ]; then
    echo -e "✅ Dependencies installed"
else
    echo -e "⚠️  Dependencies not installed (run: npm install)"
fi
echo

# Check latest results
echo -e "${BLUE}📊 Latest Test Results:${NC}"
echo "──────────────────────"
if [ -f "test-results/latest-report.txt" ]; then
    echo -e "✅ Latest results available"
    echo "Recent results summary:"
    head -15 test-results/latest-report.txt | tail -8
else
    echo -e "⚠️  No recent test results (run: npm run test:all)"
fi
echo

# Check archives
echo -e "${BLUE}💾 Archives Status:${NC}"
echo "──────────────────"
if [ -d "../archives" ]; then
    archive_count=$(ls -1 ../archives/*.tar.gz 2>/dev/null | wc -l || echo 0)
    if [ "$archive_count" -gt 0 ]; then
        echo -e "✅ $archive_count archive(s) available in ../archives/"
        echo "Latest archive:"
        ls -t ../archives/*.tar.gz | head -1 | xargs basename
    else
        echo -e "⚠️  No archives found"
    fi
else
    echo -e "⚠️  Archives directory not found"
fi
echo

# Available commands
echo -e "${BLUE}🎯 Quick Commands:${NC}"
echo "─────────────────"
echo "npm run health          # Health check"
echo "npm run test:all        # Run all tests"  
echo "npm run validate        # Production validation"
echo "cat AI_ASSISTANT_CONTEXT.md  # Read AI context"
echo

# Quick health check
echo -e "${BLUE}🏥 Quick Health Check:${NC}"
echo "─────────────────────"
if command -v node >/dev/null 2>&1; then
    echo -e "✅ Node.js available"
    if [ -f "package.json" ]; then
        echo -e "✅ Package.json found"
        if npm run health >/dev/null 2>&1; then
            echo -e "✅ Health check passed"
        else
            echo -e "⚠️  Health check issues detected"
        fi
    else
        echo -e "❌ Package.json missing"
    fi
else
    echo -e "❌ Node.js not available"
fi

echo
echo -e "${GREEN}💡 To help AI understand this project:${NC}"
echo "1. Share the location: $TEST_DIR"
echo "2. Ask AI to read: AI_ASSISTANT_CONTEXT.md"
echo "3. Run: npm run health"
echo
echo -e "${YELLOW}🚀 Ready to assist with ClientsVia Enterprise Testing!${NC}"
