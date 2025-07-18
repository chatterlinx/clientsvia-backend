/**
 * Agent Monitoring System - Line by Line Test Script
 * Tests each function individually to verify implementation
 */

// Test configuration
const TEST_COMPANY_ID = '686a680241806a4991f7367f'; // Real company ID from database
const BASE_URL = 'https://clientsvia-backend.onrender.com';

// Test 1: Test monitoring dashboard endpoint
async function testMonitoringDashboard() {
    console.log('🧪 [TEST 1] Testing monitoring dashboard endpoint...');
    
    try {
        const response = await fetch(`${BASE_URL}/api/monitoring/dashboard/${TEST_COMPANY_ID}`);
        console.log('📡 Response status:', response.status);
        console.log('📡 Response headers:', [...response.headers.entries()]);
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ [TEST 1] Dashboard endpoint working:', data);
            return true;
        } else {
            const errorText = await response.text();
            console.error('❌ [TEST 1] Dashboard endpoint failed:', response.status, errorText);
            return false;
        }
    } catch (error) {
        console.error('💥 [TEST 1] Dashboard endpoint error:', error);
        return false;
    }
}

// Test 2: Test health check endpoint
async function testHealthCheck() {
    console.log('🧪 [TEST 2] Testing health check endpoint...');
    
    try {
        const response = await fetch(`${BASE_URL}/healthz`);
        const data = await response.json();
        console.log('✅ [TEST 2] Health check:', data);
        return data.ok === true;
    } catch (error) {
        console.error('💥 [TEST 2] Health check error:', error);
        return false;
    }
}

// Test 3: Test company endpoint
async function testCompanyEndpoint() {
    console.log('🧪 [TEST 3] Testing company endpoint...');
    
    try {
        const response = await fetch(`${BASE_URL}/api/companies`);
        const data = await response.json();
        console.log('✅ [TEST 3] Companies endpoint working, found', data.length, 'companies');
        return data.length > 0;
    } catch (error) {
        console.error('💥 [TEST 3] Company endpoint error:', error);
        return false;
    }
}

// Test 4: Test if monitoring routes are loaded
async function testMonitoringRoutes() {
    console.log('🧪 [TEST 4] Testing monitoring routes availability...');
    
    const endpoints = [
        '/api/monitoring/dashboard/' + TEST_COMPANY_ID,
        '/api/monitoring/pending/' + TEST_COMPANY_ID,
        '/api/monitoring/flagged/' + TEST_COMPANY_ID,
        '/api/monitoring/config/' + TEST_COMPANY_ID
    ];
    
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(BASE_URL + endpoint);
            console.log(`📡 ${endpoint}: ${response.status} ${response.statusText}`);
            
            if (response.status === 404) {
                console.error(`❌ [TEST 4] Route not found: ${endpoint}`);
                return false;
            }
        } catch (error) {
            console.error(`💥 [TEST 4] Error testing ${endpoint}:`, error);
            return false;
        }
    }
    
    console.log('✅ [TEST 4] All monitoring routes respond (no 404s)');
    return true;
}

// Main test runner
async function runAllTests() {
    console.log('🚀 Agent Monitoring System - Line by Line Tests');
    console.log('=' .repeat(50));
    
    const results = {
        healthCheck: await testHealthCheck(),
        companyEndpoint: await testCompanyEndpoint(),
        monitoringRoutes: await testMonitoringRoutes(),
        monitoringDashboard: await testMonitoringDashboard()
    };
    
    console.log('\n📊 Test Results:');
    console.log('=' .repeat(50));
    Object.entries(results).forEach(([test, passed]) => {
        console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASSED' : 'FAILED'}`);
    });
    
    const allPassed = Object.values(results).every(Boolean);
    console.log(`\n🎯 Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
    
    if (!allPassed) {
        console.log('\n🔧 Debugging Information:');
        console.log('- Server URL:', BASE_URL);
        console.log('- Test Company ID:', TEST_COMPANY_ID);
        console.log('- Check if server is running and monitoring routes are registered');
    }
    
    return allPassed;
}

// Export for use in browser or Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runAllTests, testMonitoringDashboard };
} else {
    // Browser context - make tests available globally
    window.monitoringTests = { runAllTests, testMonitoringDashboard };
}

// Auto-run if this is the main script
if (typeof window !== 'undefined' && window.location) {
    console.log('🌐 Browser context detected - tests available via window.monitoringTests');
} else if (require.main === module) {
    runAllTests();
}
