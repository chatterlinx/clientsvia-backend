#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * IDENTIFY WORST SCENARIOS - Find scenarios not meeting enforcement minimums
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * USAGE:
 *   node scripts/identify-worst-scenarios.js [--count=N]
 * 
 * Default shows top 10 worst. Use --count=20 to see more.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

const TEMPLATE_ID = '68fb535130d19aec696d8123';

const MINIMUMS = {
    triggers: 8,
    negativeUserPhrases: 3,
    quickReplies: 7,
    fullReplies: 7
};

function scoreScenario(scenario) {
    const counts = {
        triggers: scenario.triggers?.length || 0,
        negativeUserPhrases: scenario.negativeUserPhrases?.length || 0,
        quickReplies: scenario.quickReplies?.length || 0,
        fullReplies: scenario.fullReplies?.length || 0
    };
    
    // Calculate deficits
    const deficits = {
        triggers: Math.max(0, MINIMUMS.triggers - counts.triggers),
        negativeUserPhrases: Math.max(0, MINIMUMS.negativeUserPhrases - counts.negativeUserPhrases),
        quickReplies: Math.max(0, MINIMUMS.quickReplies - counts.quickReplies),
        fullReplies: Math.max(0, MINIMUMS.fullReplies - counts.fullReplies)
    };
    
    const totalDeficit = deficits.triggers + deficits.negativeUserPhrases + 
                         deficits.quickReplies + deficits.fullReplies;
    
    const meetsMinimums = totalDeficit === 0;
    
    // Score: lower is worse (more work needed)
    const score = 100 - (totalDeficit * 5);
    
    return { counts, deficits, totalDeficit, meetsMinimums, score };
}

async function main() {
    const args = process.argv.slice(2);
    const countArg = args.find(a => a.startsWith('--count='));
    const showCount = countArg ? parseInt(countArg.split('=')[1]) : 10;
    
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('🔍 IDENTIFYING WORST SCENARIOS (Not Meeting Enforcement Minimums)');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Minimums: triggers≥${MINIMUMS.triggers}, negatives≥${MINIMUMS.negativeUserPhrases}, quickReplies≥${MINIMUMS.quickReplies}, fullReplies≥${MINIMUMS.fullReplies}`);
    console.log('');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not set');
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    try {
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID);
        if (!template) {
            console.error('❌ Template not found');
            process.exit(1);
        }

        console.log(`Template: ${template.name}`);
        console.log(`Categories: ${template.categories?.length || 0}\n`);

        // Analyze all scenarios
        const allScenarios = [];
        
        for (const cat of template.categories || []) {
            for (const scenario of cat.scenarios || []) {
                const analysis = scoreScenario(scenario);
                allScenarios.push({
                    scenarioId: scenario.scenarioId,
                    name: scenario.name,
                    categoryName: cat.name,
                    scenarioType: scenario.scenarioType || 'UNKNOWN',
                    ...analysis
                });
            }
        }

        // Separate into compliant and non-compliant
        const compliant = allScenarios.filter(s => s.meetsMinimums);
        const nonCompliant = allScenarios.filter(s => !s.meetsMinimums);
        
        // Sort non-compliant by deficit (worst first)
        nonCompliant.sort((a, b) => b.totalDeficit - a.totalDeficit);

        console.log('─────────────────────────────────────────────────────────────────────────────');
        console.log('📊 SUMMARY');
        console.log('─────────────────────────────────────────────────────────────────────────────');
        console.log(`Total scenarios: ${allScenarios.length}`);
        console.log(`✅ Meeting minimums: ${compliant.length}`);
        console.log(`❌ Below minimums: ${nonCompliant.length}`);
        console.log('');
        
        if (nonCompliant.length === 0) {
            console.log('🎉 ALL SCENARIOS MEET ENFORCEMENT MINIMUMS!');
        } else {
            console.log('─────────────────────────────────────────────────────────────────────────────');
            console.log(`📋 TOP ${Math.min(showCount, nonCompliant.length)} WORST SCENARIOS (highest deficit first)`);
            console.log('─────────────────────────────────────────────────────────────────────────────');
            
            const toShow = nonCompliant.slice(0, showCount);
            
            for (let i = 0; i < toShow.length; i++) {
                const s = toShow[i];
                console.log(`\n${i + 1}. ${s.name}`);
                console.log(`   ID: ${s.scenarioId}`);
                console.log(`   Category: ${s.categoryName}`);
                console.log(`   Type: ${s.scenarioType}`);
                console.log(`   Score: ${s.score}`);
                console.log(`   Deficit: ${s.totalDeficit} items needed`);
                console.log(`   Current → Needed:`);
                console.log(`     triggers: ${s.counts.triggers}/${MINIMUMS.triggers} (need +${s.deficits.triggers})`);
                console.log(`     negatives: ${s.counts.negativeUserPhrases}/${MINIMUMS.negativeUserPhrases} (need +${s.deficits.negativeUserPhrases})`);
                console.log(`     quickReplies: ${s.counts.quickReplies}/${MINIMUMS.quickReplies} (need +${s.deficits.quickReplies})`);
                console.log(`     fullReplies: ${s.counts.fullReplies}/${MINIMUMS.fullReplies} (need +${s.deficits.fullReplies})`);
            }
            
            // Output scenario IDs for easy copy
            console.log('\n─────────────────────────────────────────────────────────────────────────────');
            console.log('📋 SCENARIO IDs (for Phase 2 script)');
            console.log('─────────────────────────────────────────────────────────────────────────────');
            console.log('const BATCH_SCENARIOS = [');
            toShow.forEach(s => {
                console.log(`    '${s.scenarioId}',  // ${s.name}`);
            });
            console.log('];');
        }

        console.log('\n═══════════════════════════════════════════════════════════════════════════');
        
    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    }
}

main().catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});

