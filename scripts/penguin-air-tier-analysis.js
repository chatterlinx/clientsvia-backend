/**
 * GET REAL TIER 3 FALLTHROUGH DATA FOR PENGUIN AIR
 * 
 * Run this to get actual production calls with tier usage data
 */

const mongoose = require('mongoose');
require('dotenv').config();

const BlackBoxRecording = require('../models/BlackBoxRecording');

const companyId = '68e3f77a9d623b8058c700c4'; // Penguin Air

async function analyze() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('═'.repeat(80));
        console.log('PENGUIN AIR - TIER 3 FALLTHROUGH ANALYSIS');
        console.log('═'.repeat(80));
        console.log();

        // Get last 50 calls with actual conversation turns
        const calls = await BlackBoxRecording.find({ 
            companyId,
            'events.type': { $in: [
                'TIER3_FAST_MATCH',
                'TIER3_EMBEDDING_MATCH', 
                'TIER3_LLM_FALLBACK_CALLED',
                'SCENARIO_POOL_LOADED',
                'MATCHING_PIPELINE'
            ]}
        })
        .sort({ startedAt: -1 })
        .limit(50)
        .lean();

        console.log(`Found ${calls.length} calls with tier/matching events\n`);

        if (calls.length === 0) {
            console.log('❌ No calls with tier events found.');
            console.log('💡 This might mean:');
            console.log('   1. No production calls yet');
            console.log('   2. BlackBox logging not working');
            console.log('   3. Intelligence system not enabled\n');
            process.exit(0);
        }

        let tier1Count = 0;
        let tier2Count = 0;
        let tier3Count = 0;
        
        const callSummaries = [];

        for (const call of calls.slice(0, 20)) {
            const events = call.events || [];
            
            // Find tier events
            const tier1Event = events.find(e => e.type === 'TIER3_FAST_MATCH');
            const tier2Event = events.find(e => e.type === 'TIER3_EMBEDDING_MATCH');
            const tier3Event = events.find(e => e.type === 'TIER3_LLM_FALLBACK_CALLED');
            
            // Find scenario pool event
            const poolEvent = events.find(e => e.type === 'SCENARIO_POOL_LOADED');
            const matchingEvent = events.find(e => e.type === 'MATCHING_PIPELINE');
            
            let tierUsed = 'unknown';
            let tierData = null;
            
            if (tier1Event) {
                tier1Count++;
                tierUsed = 'TIER 1';
                tierData = tier1Event.data;
            } else if (tier2Event) {
                tier2Count++;
                tierUsed = 'TIER 2';
                tierData = tier2Event.data;
            } else if (tier3Event) {
                tier3Count++;
                tierUsed = 'TIER 3';
                tierData = tier3Event.data;
            }
            
            callSummaries.push({
                callId: call.callId,
                startedAt: call.startedAt,
                tierUsed,
                latencyMs: tierData?.ms || null,
                costUsd: tierData?.costUsd || 0,
                scenarioPoolCount: poolEvent?.data?.enabledCount || 0,
                topCandidate: matchingEvent?.data?.matching?.selected || null,
                matchDecision: matchingEvent?.data?.matching?.decision || null
            });
        }

        const total = tier1Count + tier2Count + tier3Count;

        console.log('📊 TIER USAGE BREAKDOWN (Last 20 calls):');
        console.log('─'.repeat(80));
        console.log(`Tier 1 (Rule-based, FREE, <100ms): ${tier1Count}/${total} (${((tier1Count/total)*100).toFixed(1)}%)`);
        console.log(`Tier 2 (Semantic, FREE, <300ms):   ${tier2Count}/${total} (${((tier2Count/total)*100).toFixed(1)}%)`);
        console.log(`Tier 3 (LLM, $0.04, ~1200ms):      ${tier3Count}/${total} (${((tier3Count/total)*100).toFixed(1)}%) ${tier3Count > total * 0.2 ? '⚠️ HIGH!' : ''}`);
        console.log();

        if (tier3Count > total * 0.5) {
            console.log('🚨 CRITICAL: >50% of calls hitting Tier 3!');
            console.log('💰 Cost Impact: $' + (tier3Count * 0.04).toFixed(2) + ' for these 20 calls alone');
            console.log('⏱️  Latency Impact: ~1200ms per call (vs 100ms for Tier 1)');
            console.log();
        }

        console.log('═'.repeat(80));
        console.log('CALL DETAILS (Most Recent 10):');
        console.log('═'.repeat(80));
        console.log();

        callSummaries.slice(0, 10).forEach((call, i) => {
            const emoji = call.tierUsed === 'TIER 1' ? '⚡' : 
                         call.tierUsed === 'TIER 2' ? '🧠' : 
                         call.tierUsed === 'TIER 3' ? '🐌' : '❓';
            
            console.log(`${i + 1}. ${emoji} ${call.tierUsed}`);
            console.log(`   Call ID: ${call.callId}`);
            console.log(`   Time: ${new Date(call.startedAt).toLocaleString()}`);
            console.log(`   Latency: ${call.latencyMs || 'N/A'}ms`);
            console.log(`   Cost: $${call.costUsd?.toFixed(4) || '0.00'}`);
            console.log(`   Scenarios Available: ${call.scenarioPoolCount}`);
            if (call.topCandidate) {
                console.log(`   Top Match: ${call.topCandidate}`);
                console.log(`   Decision: ${call.matchDecision}`);
            }
            console.log();
        });

        console.log('═'.repeat(80));
        console.log('DIAGNOSTIC COMPLETE');
        console.log('═'.repeat(80));

    } catch (error) {
        console.error('❌ Analysis failed:', error);
        console.error(error.stack);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
}

analyze();
