#!/usr/bin/env node
/**
 * ============================================================================
 * TRIAGE MATCHING DIAGNOSTIC
 * ============================================================================
 * 
 * PURPOSE: Debug why "I need AC service" is NOT matching any triage cards
 * 
 * Usage:
 *   node scripts/diagnose-triage-matching.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Test phrases that SHOULD match
const TEST_PHRASES = [
    "I need AC service",
    "my air conditioner is not cooling",
    "AC not working",
    "need to schedule appointment",
    "I want to book a technician",
    "my heater is broken"
];

async function run() {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 TRIAGE MATCHING DIAGNOSTIC');
    console.log('='.repeat(80) + '\n');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not set');
        process.exit(1);
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    // Target company
    const COMPANY_ID = process.env.TEST_COMPANY_ID || '68e3f77a9d623b8058c700c4';
    console.log(`📍 Target Company: ${COMPANY_ID}\n`);
    
    // Load company
    const Company = require('../models/v2Company');
    const company = await Company.findById(COMPANY_ID).lean();
    
    if (!company) {
        console.error(`❌ Company not found: ${COMPANY_ID}`);
        process.exit(1);
    }
    
    console.log(`✅ Company: ${company.companyName}`);
    console.log(`   Trade: ${company.trade || 'not set'}\n`);
    
    // Load TriageCards from database
    const TriageCard = require('../models/TriageCard');
    const triageCards = await TriageCard.find({
        companyId: COMPANY_ID,
        isActive: { $ne: false }
    }).lean();
    
    console.log('='.repeat(80));
    console.log('📋 TRIAGE CARDS IN DATABASE');
    console.log('='.repeat(80) + '\n');
    
    if (triageCards.length === 0) {
        console.log('❌ NO TRIAGE CARDS FOUND! This is your problem.');
        console.log('   → Create triage cards with keywords like "AC", "air conditioning", "service"\n');
    } else {
        console.log(`Found ${triageCards.length} Triage Cards:\n`);
        
        triageCards.forEach((card, i) => {
            const keywords = card.quickRuleConfig?.keywordsMustHave || [];
            const synonyms = card.generatedSynonyms || [];
            const openingLine = card.frontlinePlaybook?.openingLines?.[0] || '(none)';
            
            console.log(`${i + 1}. ${card.triageLabel || card.displayName}`);
            console.log(`   ID: ${card._id}`);
            console.log(`   Keywords: ${keywords.length > 0 ? keywords.join(', ') : '❌ NONE'}`);
            console.log(`   Synonyms: ${synonyms.length > 0 ? synonyms.slice(0, 5).join(', ') : '(none)'}`);
            console.log(`   Opening Line: ${openingLine.substring(0, 60)}...`);
            console.log(`   Action: ${card.quickRuleConfig?.action || 'unknown'}`);
            console.log('');
        });
    }
    
    // Now test matching
    console.log('='.repeat(80));
    console.log('🎯 TESTING PHRASE MATCHING');
    console.log('='.repeat(80) + '\n');
    
    for (const phrase of TEST_PHRASES) {
        console.log(`Testing: "${phrase}"`);
        
        const lowerPhrase = phrase.toLowerCase();
        let matchFound = false;
        
        for (const card of triageCards) {
            const keywords = card.quickRuleConfig?.keywordsMustHave || [];
            const synonyms = card.generatedSynonyms || [];
            
            // Check keywords
            for (const keyword of keywords) {
                if (lowerPhrase.includes(keyword.toLowerCase())) {
                    console.log(`   ✅ MATCH via keyword "${keyword}" → ${card.triageLabel}`);
                    matchFound = true;
                    break;
                }
            }
            
            if (!matchFound) {
                // Check synonyms
                for (const synonym of synonyms) {
                    if (lowerPhrase.includes(synonym.toLowerCase())) {
                        console.log(`   ✅ MATCH via synonym "${synonym}" → ${card.triageLabel}`);
                        matchFound = true;
                        break;
                    }
                }
            }
            
            if (matchFound) break;
        }
        
        if (!matchFound) {
            console.log(`   ❌ NO MATCH - will fall through to LLM (SLOW!)`);
        }
        console.log('');
    }
    
    // Summary
    console.log('='.repeat(80));
    console.log('📊 DIAGNOSIS SUMMARY');
    console.log('='.repeat(80) + '\n');
    
    const allKeywords = [];
    triageCards.forEach(card => {
        const keywords = card.quickRuleConfig?.keywordsMustHave || [];
        allKeywords.push(...keywords);
    });
    
    console.log(`Total Triage Cards: ${triageCards.length}`);
    console.log(`Total Keywords: ${allKeywords.length}`);
    console.log(`Unique Keywords: ${[...new Set(allKeywords.map(k => k.toLowerCase()))].length}`);
    
    // Check for common HVAC keywords
    const hvacKeywords = ['ac', 'air conditioning', 'cooling', 'heating', 'hvac', 'thermostat', 
                          'furnace', 'heat pump', 'service', 'repair', 'maintenance'];
    
    console.log('\n🔥 MISSING CRITICAL KEYWORDS:');
    hvacKeywords.forEach(kw => {
        const hasIt = allKeywords.some(k => k.toLowerCase().includes(kw));
        if (!hasIt) {
            console.log(`   ❌ "${kw}" - ADD THIS to a triage card!`);
        }
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('💡 FIX: Add keywords to your Triage Cards in the Control Plane');
    console.log('   → Go to AI Agent Logic → Triage Cards');
    console.log('   → Add triggers like: "AC", "air conditioning", "service", etc.');
    console.log('='.repeat(80) + '\n');
    
    await mongoose.disconnect();
    console.log('✅ Done\n');
}

run().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});

