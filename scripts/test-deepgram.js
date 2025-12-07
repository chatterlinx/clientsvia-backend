#!/usr/bin/env node
/**
 * ============================================================================
 * DEEPGRAM CONNECTION TEST
 * ============================================================================
 * 
 * Run this to verify your Deepgram API key is working:
 *   node scripts/test-deepgram.js
 * 
 * Expected output:
 *   ✅ Deepgram API key is configured
 *   ✅ Deepgram API responded successfully
 *   📝 Test transcription: "This is a test..."
 * 
 * ============================================================================
 */

require('dotenv').config();
const axios = require('axios');

const DG_API_KEY = process.env.DEEPGRAM_API_KEY;

// Test audio URL (public sample)
const TEST_AUDIO_URL = 'https://static.deepgram.com/examples/interview_speech-analytics.wav';

async function testDeepgram() {
    console.log('\n🎯 DEEPGRAM CONNECTION TEST\n');
    console.log('─'.repeat(50));
    
    // Check 1: API Key exists
    if (!DG_API_KEY) {
        console.log('❌ DEEPGRAM_API_KEY not found in environment');
        console.log('   Add it to your .env file or Render env vars');
        process.exit(1);
    }
    console.log('✅ DEEPGRAM_API_KEY is configured');
    console.log(`   Key starts with: ${DG_API_KEY.substring(0, 8)}...`);
    
    // Check 2: Make actual API call
    console.log('\n📡 Testing Deepgram API connection...\n');
    
    try {
        const startTime = Date.now();
        
        const response = await axios({
            method: 'POST',
            url: 'https://api.deepgram.com/v1/listen',
            headers: {
                'Authorization': `Token ${DG_API_KEY}`,
                'Content-Type': 'application/json',
            },
            data: {
                url: TEST_AUDIO_URL,
                model: 'nova-2-phonecall',
                language: 'en-US',
                smart_format: true,
                punctuate: true,
            },
            timeout: 30000,
        });
        
        const duration = Date.now() - startTime;
        const result = response.data;
        
        if (result?.results?.channels?.[0]?.alternatives?.[0]) {
            const alt = result.results.channels[0].alternatives[0];
            const transcript = alt.transcript || '';
            const confidence = (alt.confidence * 100).toFixed(1);
            
            console.log('✅ Deepgram API responded successfully!');
            console.log(`   Response time: ${duration}ms`);
            console.log(`   Confidence: ${confidence}%`);
            console.log(`\n📝 Sample transcription (first 200 chars):`);
            console.log(`   "${transcript.substring(0, 200)}..."`);
            
            console.log('\n' + '─'.repeat(50));
            console.log('🎉 DEEPGRAM IS WORKING CORRECTLY!');
            console.log('   Your hybrid STT system is ready for production.');
            console.log('─'.repeat(50) + '\n');
        } else {
            console.log('⚠️ Deepgram responded but no transcript returned');
            console.log('   Response:', JSON.stringify(result, null, 2));
        }
        
    } catch (err) {
        console.log('❌ Deepgram API call failed');
        console.log(`   Error: ${err.message}`);
        
        if (err.response?.status === 401) {
            console.log('\n   🔑 API Key is invalid or expired');
            console.log('   Check your Deepgram dashboard for a valid key');
        } else if (err.response?.status === 402) {
            console.log('\n   💳 Payment required - check your Deepgram billing');
        } else if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
            console.log('\n   🌐 Network issue - check internet connection');
        }
        
        if (err.response?.data) {
            console.log('\n   API Response:', err.response.data);
        }
        
        process.exit(1);
    }
}

testDeepgram();

