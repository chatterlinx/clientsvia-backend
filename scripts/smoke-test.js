#!/usr/bin/env node
/**
 * ============================================================================
 * POST-DEPLOY SMOKE TESTS
 * ============================================================================
 * Purpose: Verify critical endpoints work after deployment
 * 
 * This script tests that all critical API endpoints return expected status
 * codes and don't return 404. Run this after every Render deployment.
 * 
 * Usage:
 *   BASE_URL=https://clientsvia-backend.onrender.com node scripts/smoke-test.js
 *   npm run smoke-test
 * 
 * Environment Variables:
 *   BASE_URL - Base URL to test (default: production)
 *   ADMIN_TOKEN - JWT token for authenticated endpoints (optional)
 * 
 * Exit Codes:
 *   0 - All tests passed ✅
 *   1 - One or more tests failed ❌
 * ============================================================================
 */

const baseURL = process.env.BASE_URL || 'https://clientsvia-backend.onrender.com';
const adminToken = process.env.ADMIN_TOKEN || '';

console.log('🧪 [SMOKE TEST] Starting post-deploy validation...\n');
console.log(`🌐 Base URL: ${baseURL}\n`);

// ============================================================================
// TEST ENDPOINTS
// ============================================================================

const endpoints = [
    // Public endpoints (no auth)
    {
        path: '/healthz',
        method: 'GET',
        requiresAuth: false,
        expectedStatus: 200,
        description: 'Health check'
    },
    {
        path: '/api/health',
        method: 'GET',
        requiresAuth: false,
        expectedStatus: 200,
        description: 'System health'
    },
    
    // Admin endpoints (requires auth)
    {
        path: '/api/admin/notifications/status',
        method: 'GET',
        requiresAuth: true,
        expectedStatus: [200, 401], // 401 if no token provided
        description: 'Notification Center status'
    },
    {
        path: '/api/admin/data-center/summary',
        method: 'GET',
        requiresAuth: true,
        expectedStatus: [200, 401],
        description: 'Data Center summary'
    },
    {
        path: '/api/companies',
        method: 'GET',
        requiresAuth: true,
        expectedStatus: [200, 401],
        description: 'Companies list'
    },
    
    // Static files
    {
        path: '/index.html',
        method: 'GET',
        requiresAuth: false,
        expectedStatus: 200,
        description: 'Admin dashboard page'
    },
    {
        path: '/login.html',
        method: 'GET',
        requiresAuth: false,
        expectedStatus: 200,
        description: 'Login page'
    }
];

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runTests() {
    let passed = 0;
    let failed = 0;
    const failures = [];
    
    for (const endpoint of endpoints) {
        try {
            const url = `${baseURL}${endpoint.path}`;
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (endpoint.requiresAuth && adminToken) {
                headers.Authorization = `Bearer ${adminToken}`;
            }
            
            const response = await fetch(url, {
                method: endpoint.method,
                headers
            });
            
            const expectedStatuses = Array.isArray(endpoint.expectedStatus) 
                ? endpoint.expectedStatus 
                : [endpoint.expectedStatus];
            
            const isExpected = expectedStatuses.includes(response.status);
            
            // Check for 404 (always a failure)
            if (response.status === 404) {
                console.error(`❌ [404 NOT FOUND] ${endpoint.method} ${endpoint.path}`);
                console.error(`   ${endpoint.description}`);
                failed++;
                failures.push({
                    endpoint: endpoint.path,
                    error: '404 Not Found',
                    description: endpoint.description
                });
            } else if (isExpected) {
                console.log(`✅ [${response.status}] ${endpoint.method} ${endpoint.path} - ${endpoint.description}`);
                passed++;
            } else {
                console.error(`⚠️  [${response.status}] ${endpoint.method} ${endpoint.path} - Expected ${expectedStatuses.join(' or ')}`);
                console.error(`   ${endpoint.description}`);
                failed++;
                failures.push({
                    endpoint: endpoint.path,
                    error: `Unexpected status: ${response.status}`,
                    description: endpoint.description
                });
            }
            
        } catch (error) {
            console.error(`❌ [ERROR] ${endpoint.method} ${endpoint.path}`);
            console.error(`   ${error.message}`);
            failed++;
            failures.push({
                endpoint: endpoint.path,
                error: error.message,
                description: endpoint.description
            });
        }
    }
    
    // ========================================================================
    // SUMMARY
    // ========================================================================
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 SMOKE TEST RESULTS:`);
    console.log(`   ✅ Passed: ${passed}/${endpoints.length}`);
    console.log(`   ❌ Failed: ${failed}/${endpoints.length}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    if (failures.length > 0) {
        console.error('❌ FAILURES:\n');
        failures.forEach((f, i) => {
            console.error(`${i + 1}. ${f.endpoint}`);
            console.error(`   Description: ${f.description}`);
            console.error(`   Error: ${f.error}\n`);
        });
    }
    
    // ========================================================================
    // AUTH WARNING
    // ========================================================================
    
    if (!adminToken) {
        console.warn('⚠️  WARNING: No ADMIN_TOKEN provided');
        console.warn('   Some tests may show 401 (expected without auth)');
        console.warn('   To test authenticated endpoints, set ADMIN_TOKEN env var\n');
    }
    
    // ========================================================================
    // EXIT
    // ========================================================================
    
    if (failed > 0) {
        console.error('❌ SMOKE TEST FAILED: Deployment may have issues!\n');
        process.exit(1);
    }
    
    console.log('✅ SMOKE TEST PASSED: All critical endpoints working!\n');
    process.exit(0);
}

// Run tests
runTests().catch(error => {
    console.error('❌ SMOKE TEST CRASHED:', error);
    process.exit(1);
});

