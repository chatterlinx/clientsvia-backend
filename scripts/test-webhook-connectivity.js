#!/usr/bin/env node

/**
 * Webhook Connectivity Test Script
 * Tests if Twilio webhooks are properly configured and reachable
 */

const https = require('https');
const http = require('http');

const BASE_URL = process.env.BASE_URL || 'https://clientsvia-backend.onrender.com';

const endpoints = [
    '/api/twilio/webhook-test',
    '/api/twilio/voice',
    '/api/twilio/voice/test-company-id'
];

async function testEndpoint(endpoint) {
    return new Promise((resolve, reject) => {
        const url = `${BASE_URL}${endpoint}`;
        const isHttps = url.startsWith('https');
        const client = isHttps ? https : http;
        
        console.log(`🧪 Testing: ${url}`);
        
        const postData = JSON.stringify({
            CallSid: 'test-call-sid-123',
            From: '+15551234567',
            To: '+12395652202',
            CallStatus: 'ringing'
        });
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'Twilio-Webhook-Test/1.0'
            }
        };
        
        const req = client.request(url, options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                resolve({
                    endpoint,
                    status: res.statusCode,
                    headers: res.headers,
                    body: data,
                    success: res.statusCode < 400
                });
            });
        });
        
        req.on('error', (error) => {
            reject({
                endpoint,
                error: error.message,
                success: false
            });
        });
        
        req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log('🚨 WEBHOOK CONNECTIVITY TEST STARTING');
    console.log('='.repeat(60));
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('='.repeat(60));
    
    for (const endpoint of endpoints) {
        try {
            const result = await testEndpoint(endpoint);
            
            console.log(`\n✅ ${endpoint}:`);
            console.log(`   Status: ${result.status}`);
            console.log(`   Success: ${result.success}`);
            console.log(`   Response Length: ${result.body.length} chars`);
            
            if (!result.success) {
                console.log(`   Response: ${result.body.substring(0, 200)}...`);
            }
            
        } catch (error) {
            console.log(`\n❌ ${endpoint}:`);
            console.log(`   Error: ${error.error || error.message}`);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🚨 WEBHOOK CONNECTIVITY TEST COMPLETE');
    console.log('='.repeat(60));
}

if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { testEndpoint, runTests };
