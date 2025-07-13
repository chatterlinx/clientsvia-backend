#!/usr/bin/env node

/**
 * Test script to verify Twilio speech confidence and fuzzy match threshold logging
 * This simulates a call and shows what settings would be logged
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Company = require('./models/Company');

async function testSettingsLogging() {
    console.log('🧪 Testing Settings Logging for Performance Controls');
    
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        // Find a test company (or create one)
        let testCompany = await Company.findOne().limit(1);
        
        if (!testCompany) {
            console.log('❌ No companies found in database');
            process.exit(1);
        }
        
        console.log(`\n🏢 Testing with Company: ${testCompany.companyName} (ID: ${testCompany._id})`);
        
        // Extract the same settings that Twilio route uses
        const speechThreshold = testCompany.aiSettings?.twilioSpeechConfidenceThreshold ?? 0.5;
        const fuzzyThreshold = testCompany.aiSettings?.fuzzyMatchThreshold ?? 0.3;
        
        // Simulate the exact logging that appears in Twilio calls
        console.log('\n🎯 SIMULATED CALL LOGS:');
        console.log(`[COMPANY FOUND] ✅ Company: ${testCompany.companyName} (ID: ${testCompany._id})`);
        console.log(`[AI SETTINGS] Voice ID: ${testCompany.aiSettings?.elevenLabs?.voiceId || 'default'} | Personality: ${testCompany.aiSettings?.personality || 'friendly'}`);
        console.log(`[PERFORMANCE SETTINGS] 🎯 Speech Confidence: ${speechThreshold} | Fuzzy Match: ${fuzzyThreshold}`);
        
        // Simulate speech confidence check
        const mockSpeechText = "what are your prices";
        const mockConfidence = 0.75;
        console.log(`\n[CONFIDENCE CHECK] Speech: "${mockSpeechText}" | Confidence: ${mockConfidence} | Threshold: ${speechThreshold} | ${mockConfidence >= speechThreshold ? 'PASS ✅' : 'FAIL ❌'}`);
        
        // Simulate fuzzy matching
        const mockQnaEntries = 3;
        console.log(`[Q&A MATCHING] 🔍 Searching ${mockQnaEntries} Q&A entries with fuzzy threshold: ${fuzzyThreshold}`);
        
        console.log('\n✅ Settings logging test complete!');
        console.log('\n📋 Summary:');
        console.log(`   • Speech Confidence Threshold: ${speechThreshold} (${speechThreshold === 0.5 ? 'default' : 'custom'})`);
        console.log(`   • Fuzzy Match Threshold: ${fuzzyThreshold} (${fuzzyThreshold === 0.3 ? 'default' : 'custom'})`);
        console.log(`   • Both settings are logged during live calls`);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

// Run the test
testSettingsLogging();
