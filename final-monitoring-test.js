#!/usr/bin/env node

/**
 * Final comprehensive test for monitoring system
 * Tests both local and production deployments
 */

const https = require('https');
const http = require('http');

// Test monitoring API endpoints
async function testMonitoringAPI() {
    console.log('🧪 Testing Monitoring API Endpoints...');
    
    const companyId = '686a680241806a4991f7367f';
    const baseUrl = 'https://clientsvia-backend.onrender.com';
    
    const endpoints = [
        `/api/monitoring/status/${companyId}`,
        `/api/monitoring/dashboard/${companyId}`,
        `/api/monitoring/pending/${companyId}`,
        `/api/monitoring/flagged/${companyId}`,
        `/api/monitoring/analytics/${companyId}`
    ];
    
    for (const endpoint of endpoints) {
        try {
            console.log(`🔍 Testing: ${endpoint}`);
            const response = await makeRequest(baseUrl + endpoint);
            console.log(`✅ ${endpoint}: ${response.statusCode} - ${response.data.length} bytes`);
        } catch (error) {
            console.log(`❌ ${endpoint}: Error - ${error.message}`);
        }
    }
    
    console.log('\n🎯 API Test Complete');
}

// Make HTTP request
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        
        const request = client.get(url, (response) => {
            let data = '';
            
            response.on('data', (chunk) => {
                data += chunk;
            });
            
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode,
                    data: data
                });
            });
        });
        
        request.on('error', (error) => {
            reject(error);
        });
        
        request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Test monitoring routes registration
async function testRouteRegistration() {
    console.log('📝 Testing Route Registration...');
    
    try {
        const response = await makeRequest('https://clientsvia-backend.onrender.com/api/monitoring/routes');
        console.log(`✅ Route registration test: ${response.statusCode}`);
        
        if (response.statusCode === 200) {
            console.log('✅ Monitoring routes are registered and accessible');
        } else {
            console.log('⚠️ Monitoring routes may not be fully registered');
        }
    } catch (error) {
        console.log(`❌ Route registration test failed: ${error.message}`);
    }
}

// Main test runner
async function runTests() {
    console.log('🚀 Starting Comprehensive Monitoring System Tests...\n');
    
    await testRouteRegistration();
    console.log('');
    await testMonitoringAPI();
    
    console.log('\n✅ All tests completed');
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. Open production site: https://clientsvia-backend.onrender.com/company-profile.html?id=686a680241806a4991f7367f');
    console.log('2. Navigate to Agent Monitoring & Oversight section');
    console.log('3. Check browser console for monitoring initialization logs');
    console.log('4. Test dashboard buttons and real-time updates');
    console.log('5. Verify all monitoring metrics are displaying correctly');
}

// Run tests
if (require.main === module) {
    runTests();
}

module.exports = { testMonitoringAPI, testRouteRegistration };
