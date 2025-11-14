/**
 * Production test for Triage Builder endpoint
 * 
 * Usage: 
 *   ADMIN_JWT="your_jwt_token" node scripts/test-triage-builder-production.js
 * 
 * Tests the deployed /api/admin/triage-builder/generate endpoint
 */

const https = require('https');

const BACKEND_URL = 'clientsvia-backend.onrender.com';
const ADMIN_JWT = process.env.ADMIN_JWT;

if (!ADMIN_JWT) {
    console.error('❌ Missing ADMIN_JWT environment variable');
    console.error('Usage: ADMIN_JWT="your_token" node scripts/test-triage-builder-production.js');
    process.exit(1);
}

const payload = JSON.stringify({
    trade: 'HVAC',
    situation: 'Customer wants a cheap maintenance special even though AC is not cooling.',
    serviceTypes: ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'OTHER']
});

const options = {
    hostname: BACKEND_URL,
    port: 443,
    path: '/api/admin/triage-builder/generate',
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${ADMIN_JWT}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
};

console.log('🧪 [PRODUCTION TEST] Starting...\n');
console.log(`📡 Target: https://${BACKEND_URL}${options.path}`);
console.log(`🔐 Auth: Bearer ${ADMIN_JWT.substring(0, 20)}...`);
console.log(`📋 Payload: ${payload}\n`);

const req = https.request(options, (res) => {
    console.log(`📊 HTTP Status: ${res.statusCode}`);
    console.log(`📋 Headers: ${JSON.stringify(res.headers, null, 2)}\n`);

    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('RAW RESPONSE:');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(data);
        console.log('\n');

        try {
            const json = JSON.parse(data);
            
            if (res.statusCode === 200 && json.success) {
                console.log('✅ SUCCESS!\n');
                
                console.log('═══════════════════════════════════════════════════════════════');
                console.log('FRONTLINE_INTEL_SECTION:');
                console.log('═══════════════════════════════════════════════════════════════');
                console.log(json.frontlineIntelSection);
                console.log('\n');
                
                console.log('═══════════════════════════════════════════════════════════════');
                console.log('CHEAT_SHEET_TRIAGE_MAP:');
                console.log('═══════════════════════════════════════════════════════════════');
                console.log(json.cheatSheetTriageMap);
                console.log('\n');
                
                console.log('═══════════════════════════════════════════════════════════════');
                console.log(`RESPONSE_LIBRARY (${json.responseLibrary.length} responses):`);
                console.log('═══════════════════════════════════════════════════════════════');
                json.responseLibrary.forEach((response, index) => {
                    console.log(`${index + 1}. ${response}`);
                });
                console.log('\n');
                
                console.log('📊 Statistics:');
                console.log(`  - Frontline-Intel length: ${json.frontlineIntelSection.length} chars`);
                console.log(`  - Cheat Sheet length: ${json.cheatSheetTriageMap.length} chars`);
                console.log(`  - Response count: ${json.responseLibrary.length}`);
                
                process.exit(0);
            } else {
                console.error('❌ FAILED\n');
                console.error('Error:', json.error || 'Unknown error');
                process.exit(1);
            }
        } catch (e) {
            console.error('❌ Failed to parse JSON response:', e.message);
            process.exit(1);
        }
    });
});

req.on('error', (e) => {
    console.error('❌ Request failed:', e.message);
    process.exit(1);
});

req.write(payload);
req.end();

