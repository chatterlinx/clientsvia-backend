#!/bin/bash

# ClientsVia Enterprise Test Suite - Complete Test Runner
# Executes all enterprise feature tests and generates comprehensive reports

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Test configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_RESULTS_DIR="$PROJECT_ROOT/test-results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Create test results directory
mkdir -p "$TEST_RESULTS_DIR"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         🚀 CLIENTSVIA ENTERPRISE TEST SUITE v1.0             ║${NC}"
echo -e "${BLUE}║              Comprehensive Feature Validation                ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to run a test and capture results
run_test() {
    local test_name="$1"
    local test_command="$2"
    local test_file="$3"
    
    echo -e "${CYAN}🧪 Running $test_name...${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    local log_file="$TEST_RESULTS_DIR/${test_file}_${TIMESTAMP}.log"
    local result_file="$TEST_RESULTS_DIR/${test_file}_${TIMESTAMP}.json"
    
    if eval "$test_command" > "$log_file" 2>&1; then
        echo -e "${GREEN}✅ $test_name: PASSED${NC}"
        return 0
    else
        echo -e "${RED}❌ $test_name: FAILED${NC}"
        echo -e "${YELLOW}   📄 Log file: $log_file${NC}"
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${PURPLE}🔍 Checking Prerequisites...${NC}"
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js is not installed${NC}"
        exit 1
    fi
    
    # Check if npm packages are installed
    if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
        echo -e "${YELLOW}⚠️  Installing npm dependencies...${NC}"
        cd "$PROJECT_ROOT" && npm install
    fi
    
    # Check if server is running
    if ! curl -s http://localhost:3000/api/ai-agent-logic/test/health > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Server not running, attempting to start...${NC}"
        cd "$PROJECT_ROOT"
        npm start &
        SERVER_PID=$!
        sleep 5
        
        if ! curl -s http://localhost:3000/api/ai-agent-logic/test/health > /dev/null 2>&1; then
            echo -e "${RED}❌ Could not start server${NC}"
            exit 1
        fi
        echo -e "${GREEN}✅ Server started successfully${NC}"
    else
        echo -e "${GREEN}✅ Server is running${NC}"
    fi
    
    echo -e "${GREEN}✅ All prerequisites met${NC}"
    echo ""
}

# Function to run individual feature tests
run_feature_tests() {
    echo -e "${PURPLE}🎯 Running Individual Feature Tests...${NC}"
    echo ""
    
    local feature_tests=(
        "Analytics Dashboard:node $PROJECT_ROOT/tests/enterprise/analytics.test.js:analytics"
        "A/B Testing Framework:node $PROJECT_ROOT/tests/enterprise/ab-testing.test.js:ab_testing"
        "Personalization Engine:node $PROJECT_ROOT/tests/enterprise/personalization.test.js:personalization"
        "Flow Designer:node $PROJECT_ROOT/tests/enterprise/flow-designer.test.js:flow_designer"
    )
    
    local passed=0
    local failed=0
    
    for test_spec in "${feature_tests[@]}"; do
        IFS=':' read -r test_name test_command test_file <<< "$test_spec"
        
        if run_test "$test_name" "$test_command" "$test_file"; then
            ((passed++))
        else
            ((failed++))
        fi
        echo ""
    done
    
    echo -e "${CYAN}📊 Feature Tests Summary:${NC}"
    echo -e "   ✅ Passed: $passed"
    echo -e "   ❌ Failed: $failed"
    echo ""
    
    return $failed
}

# Function to run integration tests
run_integration_tests() {
    echo -e "${PURPLE}🔄 Running Integration Tests...${NC}"
    echo ""
    
    local integration_passed=0
    local integration_failed=0
    
    if run_test "Enterprise Integration" "node $PROJECT_ROOT/tests/enterprise/integration.test.js" "integration"; then
        ((integration_passed++))
    else
        ((integration_failed++))
    fi
    
    echo -e "${CYAN}📊 Integration Tests Summary:${NC}"
    echo -e "   ✅ Passed: $integration_passed"
    echo -e "   ❌ Failed: $integration_failed"
    echo ""
    
    return $integration_failed
}

# Function to run performance tests
run_performance_tests() {
    echo -e "${PURPLE}🏃 Running Performance Benchmarks...${NC}"
    echo ""
    
    local perf_log="$TEST_RESULTS_DIR/performance_${TIMESTAMP}.log"
    
    echo "Running performance benchmarks..." > "$perf_log"
    
    # Test API response times
    for i in {1..10}; do
        local start_time=$(date +%s%3N)
        curl -s http://localhost:3000/api/ai-agent-logic/test/health > /dev/null
        local end_time=$(date +%s%3N)
        local response_time=$((end_time - start_time))
        echo "Health check $i: ${response_time}ms" >> "$perf_log"
    done
    
    # Test analytics endpoint
    for i in {1..5}; do
        local start_time=$(date +%s%3N)
        curl -s "http://localhost:3000/api/ai-agent-logic/test/analytics/507f1f77bcf86cd799439011/realtime" > /dev/null
        local end_time=$(date +%s%3N)
        local response_time=$((end_time - start_time))
        echo "Analytics $i: ${response_time}ms" >> "$perf_log"
    done
    
    echo -e "${GREEN}✅ Performance benchmarks completed${NC}"
    echo -e "${YELLOW}   📄 Results saved to: $perf_log${NC}"
    echo ""
}

# Function to generate final report
generate_final_report() {
    local total_failed=$1
    
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                    📊 FINAL TEST REPORT                     ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    local report_file="$TEST_RESULTS_DIR/final_report_${TIMESTAMP}.md"
    
    cat > "$report_file" << EOF
# 🚀 ClientsVia Enterprise Test Suite Report

**Date:** $(date)
**Test Suite Version:** 1.0.0
**Total Execution Time:** $(date)

## 📊 Test Results Summary

- **Overall Status:** $([ $total_failed -eq 0 ] && echo "✅ PASSED" || echo "❌ FAILED")
- **Failed Tests:** $total_failed
- **Test Results Directory:** $TEST_RESULTS_DIR

## 🧪 Test Categories Executed

1. **Analytics Dashboard Tests**
2. **A/B Testing Framework Tests**
3. **Personalization Engine Tests**
4. **Flow Designer Tests**
5. **Integration Tests**
6. **Performance Benchmarks**

## 📁 Generated Files

$(ls -la "$TEST_RESULTS_DIR"/*${TIMESTAMP}* | sed 's/^/- /')

## 🚀 Production Readiness

$([ $total_failed -eq 0 ] && echo "✅ **READY FOR PRODUCTION**" || echo "⚠️ **REQUIRES ATTENTION**")

$([ $total_failed -eq 0 ] && echo "All enterprise features are functioning correctly and ready for deployment." || echo "Some tests failed. Review the logs above before proceeding to production.")

---
*Generated by ClientsVia Enterprise Test Suite*
EOF

    echo -e "${CYAN}📋 Test Execution Summary:${NC}"
    echo -e "   🕒 Timestamp: $TIMESTAMP"
    echo -e "   📁 Results Directory: $TEST_RESULTS_DIR"
    echo -e "   📄 Final Report: $report_file"
    echo ""
    
    if [ $total_failed -eq 0 ]; then
        echo -e "${GREEN}🎉 ALL TESTS PASSED! Enterprise features are production ready! 🚀${NC}"
        echo -e "${GREEN}   ✅ Analytics Dashboard: Ready${NC}"
        echo -e "${GREEN}   ✅ A/B Testing Framework: Ready${NC}"
        echo -e "${GREEN}   ✅ Personalization Engine: Ready${NC}"
        echo -e "${GREEN}   ✅ Flow Designer: Ready${NC}"
        echo -e "${GREEN}   ✅ Integration: Complete${NC}"
    else
        echo -e "${RED}⚠️  $total_failed TEST(S) FAILED${NC}"
        echo -e "${YELLOW}   Please review the log files for details${NC}"
        echo -e "${YELLOW}   Fix issues before deploying to production${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}🌐 Access the enterprise features at:${NC}"
    echo -e "${CYAN}   http://localhost:3000/company-profile.html${NC}"
}

# Main execution
main() {
    local total_failed=0
    
    # Check prerequisites
    check_prerequisites
    
    # Run feature tests
    run_feature_tests
    feature_failed=$?
    total_failed=$((total_failed + feature_failed))
    
    # Run integration tests
    run_integration_tests
    integration_failed=$?
    total_failed=$((total_failed + integration_failed))
    
    # Run performance tests
    run_performance_tests
    
    # Generate final report
    generate_final_report $total_failed
    
    # Clean up (kill server if we started it)
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
    fi
    
    exit $total_failed
}

# Handle script interruption
trap 'echo -e "\n${RED}Test suite interrupted${NC}"; exit 130' INT TERM

# Run main function
main "$@"
