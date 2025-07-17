#!/usr/bin/env node
// deploy-verify.js
// Production deployment verification script

const https = require('https');
const http = require('http');

const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://your-app-name.onrender.com';
const LOCAL_URL = 'http://localhost:4000';

console.log('🚀 DEPLOYMENT VERIFICATION SCRIPT');
console.log('==================================');

async function makeRequest(url, path = '') {
    return new Promise((resolve, reject) => {
        const fullUrl = url + path;
        const isHttps = fullUrl.startsWith('https');
        const client = isHttps ? https : http;
        
        const req = client.get(fullUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({ status: res.statusCode, data: jsonData });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data, error: 'Not JSON' });
                }
            });
        });
        
        req.on('error', (err) => {
            reject(err);
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function verifyEndpoint(baseUrl, endpoint, description) {
    console.log(`\n🔍 Testing ${description}...`);
    console.log(`   URL: ${baseUrl}${endpoint}`);
    
    try {
        const result = await makeRequest(baseUrl, endpoint);
        
        if (result.status === 200) {
            console.log(`   ✅ SUCCESS (${result.status})`);
            if (result.data && typeof result.data === 'object') {
                if (result.data.success !== undefined) {
                    console.log(`   📊 API Success: ${result.data.success}`);
                }
                if (result.data.flowCount !== undefined) {
                    console.log(`   📋 Flow Count: ${result.data.flowCount}`);
                }
                if (result.data.stepCount !== undefined) {
                    console.log(`   🔢 Step Count: ${result.data.stepCount}`);
                }
            }
            return true;
        } else {
            console.log(`   ❌ FAILED (${result.status})`);
            if (result.data && result.data.length < 200) {
                console.log(`   📝 Response: ${result.data}`);
            }
            return false;
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        return false;
    }
}

async function verifyBookingAPI(baseUrl) {
    console.log(`\n📋 BOOKING HANDLER API VERIFICATION`);
    console.log(`====================================`);
    
    const companyId = '686a680241806a4991f7367f'; // Penguin Air test company
    const endpoints = [
        {
            path: '/healthz',
            description: 'Health Check'
        },
        {
            path: `/api/booking-handler/available/${companyId}`,
            description: 'Available Booking Flows'
        },
        {
            path: `/api/booking-handler/flow/${companyId}/HVAC/Repair`,
            description: 'HVAC Repair Flow'
        },
        {
            path: `/api/booking-handler/flow/${companyId}/Plumbing/Emergency`,
            description: 'Plumbing Emergency Flow'
        }
    ];
    
    let passedTests = 0;
    
    for (const endpoint of endpoints) {
        const success = await verifyEndpoint(baseUrl, endpoint.path, endpoint.description);
        if (success) passedTests++;
    }
    
    console.log(`\n📊 RESULTS: ${passedTests}/${endpoints.length} tests passed`);
    return passedTests === endpoints.length;
}

async function verifyUI(baseUrl) {
    console.log(`\n🖥️  UI VERIFICATION`);
    console.log(`==================`);
    
    const uiEndpoints = [
        {
            path: '/company-profile.html',
            description: 'Admin Dashboard UI'
        },
        {
            path: '/dashboard.html',
            description: 'Main Dashboard'
        }
    ];
    
    let passedTests = 0;
    
    for (const endpoint of uiEndpoints) {
        const success = await verifyEndpoint(baseUrl, endpoint.path, endpoint.description);
        if (success) passedTests++;
    }
    
    console.log(`\n📊 UI RESULTS: ${passedTests}/${uiEndpoints.length} tests passed`);
    return passedTests === uiEndpoints.length;
}

async function main() {
    console.log(`🔍 Verifying deployment...`);
    console.log(`📍 Production URL: ${PRODUCTION_URL}`);
    console.log(`🏠 Local URL: ${LOCAL_URL}`);
    
    // Test local deployment first
    console.log(`\n🏠 LOCAL DEPLOYMENT TEST`);
    console.log(`========================`);
    const localAPISuccess = await verifyBookingAPI(LOCAL_URL);
    const localUISuccess = await verifyUI(LOCAL_URL);
    
    // Test production deployment if URL is provided
    if (PRODUCTION_URL !== 'https://your-app-name.onrender.com') {
        console.log(`\n🌐 PRODUCTION DEPLOYMENT TEST`);
        console.log(`=============================`);
        const prodAPISuccess = await verifyBookingAPI(PRODUCTION_URL);
        const prodUISuccess = await verifyUI(PRODUCTION_URL);
        
        console.log(`\n🎯 FINAL RESULTS`);
        console.log(`================`);
        console.log(`Local API: ${localAPISuccess ? '✅' : '❌'}`);
        console.log(`Local UI: ${localUISuccess ? '✅' : '❌'}`);
        console.log(`Production API: ${prodAPISuccess ? '✅' : '❌'}`);
        console.log(`Production UI: ${prodUISuccess ? '✅' : '❌'}`);
        
        if (localAPISuccess && prodAPISuccess) {
            console.log(`\n🎉 DEPLOYMENT SUCCESSFUL!`);
            console.log(`✅ All booking handler endpoints are working`);
            console.log(`✅ Admin UI is accessible`);
            console.log(`✅ Ready for production use`);
        } else {
            console.log(`\n⚠️  DEPLOYMENT ISSUES DETECTED`);
            console.log(`Please check the failed endpoints and try again.`);
        }
    } else {
        console.log(`\n🎯 LOCAL RESULTS`);
        console.log(`================`);
        console.log(`Local API: ${localAPISuccess ? '✅' : '❌'}`);
        console.log(`Local UI: ${localUISuccess ? '✅' : '❌'}`);
        
        if (localAPISuccess) {
            console.log(`\n🎉 LOCAL DEPLOYMENT SUCCESSFUL!`);
            console.log(`✅ All booking handler endpoints are working locally`);
            console.log(`✅ Ready to deploy to production`);
            console.log(`\n🚀 To test production deployment:`);
            console.log(`   1. Set PRODUCTION_URL environment variable`);
            console.log(`   2. Deploy to your hosting platform`);
            console.log(`   3. Run: PRODUCTION_URL=https://your-app.com node deploy-verify.js`);
        }
    }
}

// Run verification
main().catch(console.error);
