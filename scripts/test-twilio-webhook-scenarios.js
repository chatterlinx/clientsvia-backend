#!/usr/bin/env node

/**
 * Test Different Twilio Webhook Scenarios
 * This will help identify what configuration is causing the issue
 */

const https = require('https');

const BASE_URL = 'https://clientsvia-backend.onrender.com';

const testScenarios = [
    {
        name: 'Main Voice Webhook',
        endpoint: '/api/twilio/voice',
        data: {
            CallSid: 'TEST-MAIN-WEBHOOK',
            From: '+15551234567',
            To: '+12395652202',
            CallStatus: 'ringing'
        }
    },
    {
        name: 'Company-Specific Webhook (Atlas Air)',
        endpoint: '/api/twilio/voice/68813026dd95f599c74e49c7',
        data: {
            CallSid: 'TEST-COMPANY-WEBHOOK',
            From: '+15551234567',
            To: '+12395652202',
            CallStatus: 'ringing'
        }
    },
    {
        name: 'Webhook Test Endpoint',
        endpoint: '/api/twilio/webhook-test',
        data: {
            CallSid: 'TEST-WEBHOOK-TEST',
            From: '+15551234567',
            To: '+12395652202',
            CallStatus: 'ringing'
        }
    }
];

async function testScenario(scenario) {
    return new Promise((resolve, reject) => {
        const url = `${BASE_URL}${scenario.endpoint}`;
        const postData = new URLSearchParams(scenario.data).toString();
        
        console.log(`\n🧪 Testing: ${scenario.name}`);
        console.log(`📍 URL: ${url}`);
        console.log(`📋 Data: ${JSON.stringify(scenario.data)}`);
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'Twilio-Test/1.0'
            }
        };
        
        const req = https.request(url, options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log(`✅ Status: ${res.statusCode}`);
                console.log(`📄 Response: ${data.substring(0, 100)}...`);
                resolve({
                    scenario: scenario.name,
                    status: res.statusCode,
                    success: res.statusCode < 400,
                    response: data
                });
            });
        });
        
        req.on('error', (error) => {
            console.log(`❌ Error: ${error.message}`);
            reject(error);
        });
        
        req.write(postData);
        req.end();
    });
}

async function runAllTests() {
    console.log('🚨 TWILIO WEBHOOK SCENARIO TESTING');
    console.log('='.repeat(60));
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('='.repeat(60));
    
    for (const scenario of testScenarios) {
        try {
            await testScenario(scenario);
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        } catch (error) {
            console.log(`❌ ${scenario.name} failed: ${error.message}`);
        }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🚨 ALL TESTS COMPLETE');
    console.log('📋 Check Render logs for these CallSids:');
    testScenarios.forEach(scenario => {
        console.log(`   - ${scenario.data.CallSid}`);
    });
    console.log('='.repeat(60));
}

if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = { runAllTests, testScenario };

