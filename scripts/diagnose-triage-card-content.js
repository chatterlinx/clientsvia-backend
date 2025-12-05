#!/usr/bin/env node
/**
 * Diagnostic: Check TriageCard response content
 * 
 * This script examines all TriageCards for a company to see
 * which response fields are populated and which are empty.
 * 
 * Usage: node scripts/diagnose-triage-card-content.js [companyId]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const TriageCard = require('../models/TriageCard');

const COMPANY_ID = process.argv[2] || '68e3f77a9d623b8058c700c4';

async function diagnose() {
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('  TRIAGE CARD CONTENT DIAGNOSTIC');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log(`Company ID: ${COMPANY_ID}`);
    console.log('');
    
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const cards = await TriageCard.find({ 
            companyId: COMPANY_ID,
            isActive: true 
        }).lean();
        
        console.log(`Found ${cards.length} active TriageCards\n`);
        
        if (cards.length === 0) {
            console.log('❌ No active TriageCards found!');
            console.log('   Make sure cards are set to isActive: true');
            return;
        }
        
        // Analyze each card
        const analysis = {
            withContent: [],
            withoutContent: [],
            contentSources: {}
        };
        
        for (const card of cards) {
            const sources = [];
            
            // Check all possible response sources
            const checks = [
                { field: 'frontlinePlaybook.openingLines[0]', value: card.frontlinePlaybook?.openingLines?.[0] },
                { field: 'frontlinePlaybook.openingLine', value: card.frontlinePlaybook?.openingLine },
                { field: 'frontlinePlaybook.frontlineGoal', value: card.frontlinePlaybook?.frontlineGoal },
                { field: 'quickRuleConfig.explanation', value: card.quickRuleConfig?.explanation },
                { field: 'quickRuleConfig.acknowledgment', value: card.quickRuleConfig?.acknowledgment },
                { field: 'actionPlaybooks.explainAndPush.explanationLines[0]', value: card.actionPlaybooks?.explainAndPush?.explanationLines?.[0] },
                { field: 'actionPlaybooks.takeMessage.introLines[0]', value: card.actionPlaybooks?.takeMessage?.introLines?.[0] },
                { field: 'actionPlaybooks.escalateToHuman.preTransferLines[0]', value: card.actionPlaybooks?.escalateToHuman?.preTransferLines?.[0] },
                { field: 'response', value: card.response },
            ];
            
            for (const check of checks) {
                if (check.value && check.value.trim()) {
                    sources.push({
                        field: check.field,
                        preview: check.value.substring(0, 60) + (check.value.length > 60 ? '...' : '')
                    });
                    analysis.contentSources[check.field] = (analysis.contentSources[check.field] || 0) + 1;
                }
            }
            
            const cardInfo = {
                triageLabel: card.triageLabel,
                displayName: card.displayName,
                action: card.quickRuleConfig?.action,
                sources
            };
            
            if (sources.length > 0) {
                analysis.withContent.push(cardInfo);
            } else {
                analysis.withoutContent.push(cardInfo);
            }
        }
        
        // Print results
        console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
        console.log('║  CARDS WITH RESPONSE CONTENT                                                  ║');
        console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
        
        if (analysis.withContent.length === 0) {
            console.log('  ❌ NONE - No cards have response content configured!\n');
        } else {
            for (const card of analysis.withContent) {
                console.log(`\n  📋 ${card.displayName || card.triageLabel}`);
                console.log(`     Label: ${card.triageLabel}`);
                console.log(`     Action: ${card.action}`);
                for (const src of card.sources) {
                    console.log(`     ✅ ${src.field}:`);
                    console.log(`        "${src.preview}"`);
                }
            }
        }
        
        console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
        console.log('║  CARDS WITHOUT RESPONSE CONTENT (WILL USE GENERIC FALLBACK)                   ║');
        console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
        
        if (analysis.withoutContent.length === 0) {
            console.log('  ✅ All cards have content!\n');
        } else {
            for (const card of analysis.withoutContent) {
                console.log(`\n  ⚠️  ${card.displayName || card.triageLabel}`);
                console.log(`     Label: ${card.triageLabel}`);
                console.log(`     Action: ${card.action}`);
                console.log(`     → MISSING: frontlinePlaybook.openingLines OR quickRuleConfig.explanation`);
            }
        }
        
        console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
        console.log('║  CONTENT SOURCE SUMMARY                                                       ║');
        console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
        console.log(`\n  Total Active Cards: ${cards.length}`);
        console.log(`  Cards WITH content: ${analysis.withContent.length}`);
        console.log(`  Cards WITHOUT content: ${analysis.withoutContent.length}`);
        console.log('\n  Content sources used:');
        for (const [field, count] of Object.entries(analysis.contentSources).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${field}: ${count} cards`);
        }
        
        if (analysis.withoutContent.length > 0) {
            console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
            console.log('║  ⚠️  RECOMMENDED FIX                                                           ║');
            console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
            console.log('\n  For each card without content, add one of these:');
            console.log('    1. frontlinePlaybook.openingLines = ["Your response here"]');
            console.log('    2. quickRuleConfig.explanation = "Your response here"');
            console.log('\n  You can do this via:');
            console.log('    - Triage Command Center UI');
            console.log('    - MongoDB Compass');
            console.log('    - API PATCH to /api/admin/triage-cards/:cardId');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB');
    }
}

diagnose();

