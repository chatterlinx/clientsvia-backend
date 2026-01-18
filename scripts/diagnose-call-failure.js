#!/usr/bin/env node
/**
 * ============================================================================
 * DIAGNOSE CALL FAILURE - Quick test for Penguin Air
 * ============================================================================
 * 
 * Tests the ConversationEngine with the same input that failed:
 * "yeah. being in my house several times and i'm not..."
 * 
 * Usage: node scripts/diagnose-call-failure.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PENGUIN_AIR_COMPANY_ID = '68e3f77a9d623b8058c700c4';

async function run() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔍 DIAGNOSE CALL FAILURE - Testing Penguin Air');
    console.log('═══════════════════════════════════════════════════════════════');
    
    try {
        // 1. Connect to MongoDB
        console.log('\n[1/5] Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB connected');
        
        // 2. Load company
        console.log('\n[2/5] Loading company...');
        const Company = require('../models/v2Company');
        const company = await Company.findById(PENGUIN_AIR_COMPANY_ID);
        
        if (!company) {
            console.error('❌ Company not found!');
            process.exit(1);
        }
        console.log('✅ Company loaded:', company.companyName);
        
        // 3. Check template references
        console.log('\n[3/5] Checking template references...');
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        console.log('Template references:', templateRefs.length);
        
        if (templateRefs.length === 0) {
            console.error('❌ NO TEMPLATE REFERENCES - This will cause scenarioCount=0!');
        } else {
            for (const ref of templateRefs) {
                console.log(`  - ${ref.templateId} (enabled: ${ref.enabled})`);
            }
        }
        
        // 4. Check Redis
        console.log('\n[4/5] Checking Redis connection...');
        try {
            const redisClient = require('../services/redisClientFactory');
            await redisClient.ping();
            console.log('✅ Redis connected');
            
            // Check scenario pool cache
            const cacheKey = `scenario-pool:${PENGUIN_AIR_COMPANY_ID}`;
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                console.log('✅ Scenario pool cached:', parsed.scenarios?.length || 0, 'scenarios');
            } else {
                console.log('⚠️ Scenario pool NOT cached - will be built on next call');
            }
        } catch (redisErr) {
            console.error('❌ Redis error:', redisErr.message);
        }
        
        // 5. Test ConversationEngine
        console.log('\n[5/5] Testing ConversationEngine with problematic input...');
        const ConversationEngine = require('../services/ConversationEngine');
        
        const testInputs = [
            "yes, good morning",
            "yeah. being in my house several times and i'm not happy",
            "I need AC repair"
        ];
        
        for (const input of testInputs) {
            console.log(`\n--- Testing: "${input.substring(0, 50)}..." ---`);
            
            try {
                const result = await ConversationEngine.processTurn({
                    companyId: PENGUIN_AIR_COMPANY_ID,
                    channel: 'test',
                    userText: input,
                    includeDebug: true,
                    forceNewSession: true
                });
                
                if (result.success) {
                    console.log('✅ SUCCESS');
                    console.log('   Reply:', result.reply?.substring(0, 100) + '...');
                    console.log('   Response Source:', result.debugSnapshot?.responseSource || 'unknown');
                    console.log('   Scenario Count:', result.debugSnapshot?.scenarios?.toolCount || 0);
                } else {
                    console.error('❌ FAILED');
                    console.error('   Error:', result.error);
                    console.error('   Last Checkpoint:', result.debug?.lastCheckpoint);
                }
            } catch (err) {
                console.error('❌ EXCEPTION:', err.message);
                console.error('   Stack:', err.stack?.split('\n').slice(0, 3).join('\n'));
            }
        }
        
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('✅ Diagnosis complete');
        console.log('═══════════════════════════════════════════════════════════════');
        
    } catch (err) {
        console.error('❌ FATAL ERROR:', err.message);
        console.error(err.stack);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

run();
