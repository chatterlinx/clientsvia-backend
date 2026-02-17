#!/usr/bin/env node
/**
 * ============================================================================
 * S4A DEPLOYMENT VALIDATION SCRIPT
 * ============================================================================
 * 
 * Run this after deploying V116 to validate S4A is working correctly.
 * 
 * Usage:
 *   node scripts/validate-s4a-deployment.js
 * 
 * Checks:
 * 1. S4A events exist in rawEvents
 * 2. matchSource distribution (TRIAGE vs DISCOVERY)
 * 3. Performance metrics (latency)
 * 4. Error rates
 * 5. Pending slot events
 * 6. Detection trigger events
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';

async function validateS4ADeployment() {
    console.log('🔍 S4A Deployment Validation Starting...\n');
    
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const db = mongoose.connection.db;
        const oneHourAgo = new Date(Date.now() - 3600000);
        
        // ═══════════════════════════════════════════════════════════════════
        // CHECK 1: Are S4A Events Appearing?
        // ═══════════════════════════════════════════════════════════════════
        console.log('📊 CHECK 1: S4A Event Counts (last hour)');
        console.log('─'.repeat(60));
        
        const eventCounts = await db.collection('rawEvents').aggregate([
            { $match: { 
                type: { $regex: /S4A|S4B|S3_5/ },
                timestamp: { $gte: oneHourAgo }
            }},
            { $group: { _id: '$type', count: { $sum: 1 } }},
            { $sort: { count: -1 } }
        ]).toArray();
        
        if (eventCounts.length === 0) {
            console.log('❌ NO S4A EVENTS FOUND');
            console.log('   → S4A may not be running');
            console.log('   → Check: Is _experimentalS4A feature flag enabled?');
            console.log('   → Check: Are there any discovery turns in last hour?\n');
        } else {
            eventCounts.forEach(e => {
                const checkmark = e.count > 0 ? '✅' : '❌';
                console.log(`${checkmark} ${e._id}: ${e.count}`);
            });
            console.log();
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // CHECK 2: matchSource Distribution
        // ═══════════════════════════════════════════════════════════════════
        console.log('📊 CHECK 2: matchSource Distribution (last hour)');
        console.log('─'.repeat(60));
        
        const matchSources = await db.collection('rawEvents').aggregate([
            { $match: { 
                type: 'SECTION_S4B_DISCOVERY_OWNER_SELECTED',
                timestamp: { $gte: oneHourAgo }
            }},
            { $group: { _id: '$data.owner', count: { $sum: 1 } }},
            { $sort: { count: -1 } }
        ]).toArray();
        
        if (matchSources.length === 0) {
            console.log('❌ NO OWNER DECISION EVENTS');
            console.log('   → S4B events not appearing\n');
        } else {
            const total = matchSources.reduce((sum, m) => sum + m.count, 0);
            matchSources.forEach(m => {
                const pct = ((m.count / total) * 100).toFixed(1);
                const bar = '█'.repeat(Math.floor(pct / 2));
                console.log(`${m._id}:`);
                console.log(`  ${m.count} calls (${pct}%) ${bar}`);
            });
            console.log();
            
            // Interpret results
            const triageCount = matchSources.find(m => m._id === 'TRIAGE_SCENARIO_PIPELINE')?.count || 0;
            const triagePct = (triageCount / total) * 100;
            
            if (triagePct === 0) {
                console.log('⚠️  WARNING: 0% TRIAGE_SCENARIO_PIPELINE');
                console.log('   → Scenarios may not be matching');
                console.log('   → Check: Are scenarios in database?');
                console.log('   → Check: Is confidence threshold too high?\n');
            } else if (triagePct < 20) {
                console.log('⚠️  LOW TRIAGE RATE (<20%)');
                console.log('   → Most calls falling back to discovery');
                console.log('   → Check scenario quality and thresholds\n');
            } else if (triagePct >= 40) {
                console.log('✅ HEALTHY TRIAGE RATE (>=40%)');
                console.log('   → S4A is working as expected\n');
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // CHECK 3: Performance Metrics
        // ═══════════════════════════════════════════════════════════════════
        console.log('📊 CHECK 3: Performance Metrics (last hour)');
        console.log('─'.repeat(60));
        
        const perfMetrics = await db.collection('rawEvents').aggregate([
            { $match: { 
                type: { $in: ['SECTION_S4A_1_TRIAGE_SIGNALS', 'SECTION_S4A_2_SCENARIO_MATCH'] },
                timestamp: { $gte: oneHourAgo }
            }},
            { $group: {
                _id: '$type',
                avgDuration: { $avg: '$data.durationMs' },
                maxDuration: { $max: '$data.durationMs' },
                count: { $sum: 1 }
            }}
        ]).toArray();
        
        if (perfMetrics.length === 0) {
            console.log('❌ NO PERFORMANCE DATA\n');
        } else {
            perfMetrics.forEach(m => {
                const section = m._id === 'SECTION_S4A_1_TRIAGE_SIGNALS' ? 'S4A-1 (Triage)' : 'S4A-2 (Scenario)';
                const status = m.avgDuration < 100 ? '✅' : m.avgDuration < 200 ? '⚠️' : '❌';
                console.log(`${status} ${section}:`);
                console.log(`   Average: ${m.avgDuration.toFixed(1)}ms`);
                console.log(`   Max: ${m.maxDuration.toFixed(1)}ms`);
                console.log(`   Count: ${m.count}`);
            });
            console.log();
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // CHECK 4: Error Rates
        // ═══════════════════════════════════════════════════════════════════
        console.log('📊 CHECK 4: Error Rates (last hour)');
        console.log('─'.repeat(60));
        
        const errorCount = await db.collection('rawEvents').countDocuments({
            type: { $in: ['S4A_TRIAGE_ERROR', 'S4A_SCENARIO_ERROR', 'S4A_PERFORMANCE_WARNING'] },
            timestamp: { $gte: oneHourAgo }
        });
        
        const totalS4AAttempts = await db.collection('rawEvents').countDocuments({
            type: 'SECTION_S4A_1_TRIAGE_SIGNALS',
            'data.attempted': true,
            timestamp: { $gte: oneHourAgo }
        });
        
        if (totalS4AAttempts === 0) {
            console.log('ℹ️  No S4A attempts (no discovery turns?)\n');
        } else {
            const errorRate = (errorCount / totalS4AAttempts) * 100;
            const status = errorRate < 0.1 ? '✅' : errorRate < 1 ? '⚠️' : '❌';
            console.log(`${status} Error Rate: ${errorRate.toFixed(2)}% (${errorCount}/${totalS4AAttempts})`);
            
            if (errorRate < 0.1) {
                console.log('   Excellent - error rate <0.1%\n');
            } else if (errorRate < 1) {
                console.log('   Acceptable - error rate <1%\n');
            } else {
                console.log('   ❌ HIGH ERROR RATE - investigate immediately\n');
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // CHECK 5: Pending Slot Events
        // ═══════════════════════════════════════════════════════════════════
        console.log('📊 CHECK 5: Pending Slot Events (last hour)');
        console.log('─'.repeat(60));
        
        const pendingSlotCount = await db.collection('rawEvents').countDocuments({
            type: 'SECTION_S3_PENDING_SLOTS_STORED',
            timestamp: { $gte: oneHourAgo }
        });
        
        console.log(`✅ Pending slot events: ${pendingSlotCount}`);
        console.log(`   (Occurs when callers volunteer info)\n`);
        
        // ═══════════════════════════════════════════════════════════════════
        // CHECK 6: Detection Trigger Events
        // ═══════════════════════════════════════════════════════════════════
        console.log('📊 CHECK 6: Detection Trigger Events (last hour)');
        console.log('─'.repeat(60));
        
        const triggerCounts = await db.collection('rawEvents').aggregate([
            { $match: { 
                type: { $regex: /SECTION_S3_5/ },
                timestamp: { $gte: oneHourAgo }
            }},
            { $group: { _id: '$type', count: { $sum: 1 } }}
        ]).toArray();
        
        if (triggerCounts.length === 0) {
            console.log('ℹ️  No detection triggers fired\n');
        } else {
            triggerCounts.forEach(t => {
                console.log(`✅ ${t._id}: ${t.count}`);
            });
            console.log();
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // FINAL VERDICT
        // ═══════════════════════════════════════════════════════════════════
        console.log('═'.repeat(60));
        console.log('FINAL VERDICT');
        console.log('═'.repeat(60));
        
        const hasS4AEvents = eventCounts.length > 0;
        const hasOwnerDecisions = matchSources.length > 0;
        const performanceGood = perfMetrics.every(m => m.avgDuration < 200);
        const errorRateGood = (errorCount / (totalS4AAttempts || 1)) < 0.01;
        
        if (hasS4AEvents && hasOwnerDecisions && performanceGood && errorRateGood) {
            console.log('✅ S4A DEPLOYMENT VALIDATED');
            console.log('   All checks passed. S4A is working correctly.');
        } else {
            console.log('⚠️  S4A DEPLOYMENT HAS ISSUES');
            if (!hasS4AEvents) console.log('   - S4A events missing');
            if (!hasOwnerDecisions) console.log('   - Owner decisions missing');
            if (!performanceGood) console.log('   - Performance degraded');
            if (!errorRateGood) console.log('   - Error rate too high');
        }
        console.log();
        
    } catch (error) {
        console.error('❌ Validation failed:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('Validation complete.');
    }
}

// Run validation
validateS4ADeployment().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
