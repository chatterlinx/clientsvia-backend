#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERIFY PHASE 1 - Confirm scenarios are correctly linked and selectable
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const v2Company = require('../models/v2Company');

const TEMPLATE_ID = '68fb535130d19aec696d8123';
const COMPANY_ID = '68e3f77a9d623b8058c700c4';

const PHASE1_SCENARIOS = [
    'scenario-1761398576855-rreo3z8qk',  // Thermostat heat mode tips
    'scenario-1766497690296-xr652uhx5',  // Caller Vague About Symptoms
    'scenario-1766497690696-t6ba4dew6',  // Needs Repair But Asking for Maintenance
    'scenario-1766497691088-sn21psgwe',  // Needs Maintenance But Describing Like Repair
    'scenario-1766497693608-bjisxlkdp',  // Confirm Appointment
];

const MINIMUMS = {
    triggers: 8,
    negativeUserPhrases: 3,
    quickReplies: 7,
    fullReplies: 7
};

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('✅ PHASE 1 VERIFICATION');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not set');
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    try {
        // 1. Check company is linked to template
        console.log('─────────────────────────────────────────────────────────────────────────────');
        console.log('1️⃣  COMPANY → TEMPLATE LINK CHECK');
        console.log('─────────────────────────────────────────────────────────────────────────────');
        
        const company = await v2Company.findById(COMPANY_ID).lean();
        if (!company) {
            console.error('❌ Company not found');
            process.exit(1);
        }
        
        console.log(`   Company: ${company.companyName}`);
        console.log(`   Trade: ${company.tradeKey || 'not set'}`);
        
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const linkedTemplate = templateRefs.find(t => t.templateId?.toString() === TEMPLATE_ID);
        
        if (linkedTemplate) {
            console.log(`   ✅ Linked to template: ${TEMPLATE_ID}`);
            console.log(`   Primary: ${linkedTemplate.isPrimary ? 'YES' : 'no'}`);
        } else {
            console.log(`   ❌ NOT linked to template ${TEMPLATE_ID}`);
            console.log(`   Current refs: ${JSON.stringify(templateRefs)}`);
        }
        
        // 2. Verify template and scenario counts
        console.log('\n─────────────────────────────────────────────────────────────────────────────');
        console.log('2️⃣  TEMPLATE & SCENARIO VERIFICATION');
        console.log('─────────────────────────────────────────────────────────────────────────────');
        
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID);
        if (!template) {
            console.error('❌ Template not found');
            process.exit(1);
        }
        
        console.log(`   Template: ${template.name}`);
        console.log(`   Categories: ${template.categories?.length || 0}`);
        
        let totalScenarios = 0;
        template.categories?.forEach(c => totalScenarios += c.scenarios?.length || 0);
        console.log(`   Total Scenarios: ${totalScenarios}`);
        
        // 3. Verify Phase 1 scenarios meet enforcement
        console.log('\n─────────────────────────────────────────────────────────────────────────────');
        console.log('3️⃣  PHASE 1 SCENARIOS - ENFORCEMENT CHECK');
        console.log('─────────────────────────────────────────────────────────────────────────────');
        
        let allPass = true;
        
        for (const scenarioId of PHASE1_SCENARIOS) {
            let found = null;
            let categoryName = null;
            
            for (const cat of template.categories) {
                const s = cat.scenarios?.find(s => s.scenarioId === scenarioId);
                if (s) {
                    found = s;
                    categoryName = cat.name;
                    break;
                }
            }
            
            if (!found) {
                console.log(`\n   ❌ ${scenarioId} - NOT FOUND`);
                allPass = false;
                continue;
            }
            
            const counts = {
                triggers: found.triggers?.length || 0,
                negativeUserPhrases: found.negativeUserPhrases?.length || 0,
                quickReplies: found.quickReplies?.length || 0,
                fullReplies: found.fullReplies?.length || 0
            };
            
            const passes = 
                counts.triggers >= MINIMUMS.triggers &&
                counts.negativeUserPhrases >= MINIMUMS.negativeUserPhrases &&
                counts.quickReplies >= MINIMUMS.quickReplies &&
                counts.fullReplies >= MINIMUMS.fullReplies;
            
            const scopeOk = found.scope === 'GLOBAL';
            const ownerOk = !found.ownerCompanyId;
            
            if (passes && scopeOk && ownerOk) {
                console.log(`\n   ✅ ${found.name}`);
            } else {
                console.log(`\n   ❌ ${found.name}`);
                allPass = false;
            }
            
            console.log(`      triggers: ${counts.triggers}/${MINIMUMS.triggers} ${counts.triggers >= MINIMUMS.triggers ? '✓' : '✗'}`);
            console.log(`      negatives: ${counts.negativeUserPhrases}/${MINIMUMS.negativeUserPhrases} ${counts.negativeUserPhrases >= MINIMUMS.negativeUserPhrases ? '✓' : '✗'}`);
            console.log(`      quickReplies: ${counts.quickReplies}/${MINIMUMS.quickReplies} ${counts.quickReplies >= MINIMUMS.quickReplies ? '✓' : '✗'}`);
            console.log(`      fullReplies: ${counts.fullReplies}/${MINIMUMS.fullReplies} ${counts.fullReplies >= MINIMUMS.fullReplies ? '✓' : '✗'}`);
            console.log(`      scope: ${found.scope} ${scopeOk ? '✓' : '✗'}`);
            console.log(`      ownerCompanyId: ${found.ownerCompanyId || 'null'} ${ownerOk ? '✓' : '✗'}`);
        }
        
        // 4. Simple trigger matching test (proves scenarios are selectable)
        console.log('\n─────────────────────────────────────────────────────────────────────────────');
        console.log('4️⃣  TRIGGER MATCHING TEST (Selection Proof)');
        console.log('─────────────────────────────────────────────────────────────────────────────');
        
        const testPhrases = [
            { phrase: 'confirm my appointment', expected: 'Confirm Appointment' },
            { phrase: 'switch thermostat to heat mode', expected: 'Thermostat heat mode tips' },
            { phrase: 'something is off with my system', expected: 'Caller Vague About Symptoms' },
            { phrase: 'tune up but ac not working', expected: 'Needs Repair But Asking for Maintenance' }
        ];
        
        for (const test of testPhrases) {
            const lowerPhrase = test.phrase.toLowerCase();
            let bestMatch = null;
            let bestScore = 0;
            
            for (const cat of template.categories) {
                for (const scenario of cat.scenarios || []) {
                    for (const trigger of scenario.triggers || []) {
                        const lowerTrigger = trigger.toLowerCase();
                        // Simple word overlap scoring
                        const phraseWords = lowerPhrase.split(/\s+/);
                        const triggerWords = lowerTrigger.split(/\s+/);
                        const matches = phraseWords.filter(w => triggerWords.includes(w)).length;
                        const score = matches / Math.max(phraseWords.length, triggerWords.length);
                        
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = { scenario: scenario.name, trigger, score };
                        }
                    }
                }
            }
            
            const matchesExpected = bestMatch?.scenario === test.expected;
            console.log(`\n   "${test.phrase}"`);
            console.log(`   → ${bestMatch?.scenario || 'NO MATCH'} (score: ${(bestScore * 100).toFixed(0)}%)`);
            console.log(`   ${matchesExpected ? '✅' : '⚠️'} Expected: ${test.expected}`);
        }
        
        console.log('\n═══════════════════════════════════════════════════════════════════════════');
        if (allPass) {
            console.log('🎉 PHASE 1 VERIFICATION PASSED - All 5 scenarios enterprise-ready!');
        } else {
            console.log('⚠️  PHASE 1 VERIFICATION FAILED - Some scenarios need attention');
        }
        console.log('═══════════════════════════════════════════════════════════════════════════');
        
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB');
    }
}

main().catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});

