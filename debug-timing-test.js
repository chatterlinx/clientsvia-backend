#!/usr/bin/env node

/**
 * Debug Timing Test Script
 * This script simulates the exact flow that happens during a Twilio call
 * to identify where the 12-second delay is occurring.
 */

const axios = require('axios');
const { performance } = require('perf_hooks');

const SERVER_URL = 'http://localhost:4000'; // Adjust if your server runs on different port
const TEST_PHONE_NUMBER = '+12059152301'; // Replace with your actual Twilio number

async function testEndpointTiming(endpoint, data, description) {
  const start = performance.now();
  try {
    console.log(`\n🚀 Testing: ${description}`);
    console.log(`⏱️  Start time: ${new Date().toISOString()}`);
    
    const response = await axios.post(`${SERVER_URL}${endpoint}`, data, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 15000 // 15 second timeout
    });
    
    const end = performance.now();
    const duration = Math.round(end - start);
    
    console.log(`✅ ${description} completed in: ${duration}ms`);
    console.log(`⏱️  End time: ${new Date().toISOString()}`);
    
    if (duration > 5000) {
      console.log(`🐌 SLOW RESPONSE DETECTED: ${duration}ms > 5000ms`);
    }
    
    return { duration, success: true, response: response.data };
    
  } catch (error) {
    const end = performance.now();
    const duration = Math.round(end - start);
    
    console.log(`❌ ${description} failed after: ${duration}ms`);
    console.log(`Error: ${error.message}`);
    
    return { duration, success: false, error: error.message };
  }
}

async function runTimingTests() {
  console.log('🔍 TWILIO VOICE PIPELINE TIMING TEST');
  console.log('====================================');
  console.log(`Testing server at: ${SERVER_URL}`);
  console.log(`Using phone number: ${TEST_PHONE_NUMBER}`);
  
  // Test 1: Initial voice call
  const voiceResult = await testEndpointTiming('/api/twilio/voice', {
    To: TEST_PHONE_NUMBER,
    From: '+15551234567',
    CallSid: 'test-call-sid-' + Date.now()
  }, 'Initial Voice Call');
  
  if (!voiceResult.success) {
    console.log('❌ Initial voice call failed, stopping tests');
    return;
  }
  
  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Speech handling (this is where the delay likely occurs)
  const speechResult = await testEndpointTiming('/api/twilio/handle-speech', {
    To: TEST_PHONE_NUMBER,
    From: '+15551234567',
    CallSid: 'test-call-sid-' + Date.now(),
    SpeechResult: 'Hello, I need help with my account',
    Confidence: '0.95'
  }, 'Speech Processing (MAIN TEST)');
  
  // Wait for async processing
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 3: AI response processing
  const aiResponseResult = await testEndpointTiming('/api/twilio/process-ai-response', {
    CallSid: 'test-call-sid-' + Date.now()
  }, 'AI Response Processing');
  
  console.log('\n📊 TIMING SUMMARY');
  console.log('================');
  console.log(`Voice Call: ${voiceResult.duration}ms`);
  console.log(`Speech Processing: ${speechResult.duration}ms ${speechResult.duration > 5000 ? '🐌 SLOW!' : '✅'}`);
  console.log(`AI Response: ${aiResponseResult.duration}ms`);
  
  if (speechResult.duration > 5000) {
    console.log('\n🎯 BOTTLENECK IDENTIFIED:');
    console.log('The speech processing endpoint is taking longer than 5 seconds.');
    console.log('Check your server logs for the detailed timing breakdown.');
  }
}

// Make sure the server is running
async function checkServerHealth() {
  try {
    const response = await axios.get(`${SERVER_URL}/health`, { timeout: 5000 });
    return true;
  } catch (error) {
    try {
      // Try index page if health endpoint doesn't exist
      const response = await axios.get(`${SERVER_URL}/`, { timeout: 5000 });
      return true;
    } catch (error2) {
      console.log('❌ Server not responding. Make sure your server is running on', SERVER_URL);
      return false;
    }
  }
}

async function main() {
  console.log('Checking server health...');
  const serverRunning = await checkServerHealth();
  
  if (!serverRunning) {
    process.exit(1);
  }
  
  console.log('✅ Server is running');
  await runTimingTests();
}

main().catch(console.error);
