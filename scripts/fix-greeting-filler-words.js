#!/usr/bin/env node
/**
 * V85: Fix Filler Words Migration (Global + Templates)
 * ══════════════════════════════════════════════════════════════════════════════
 * 
 * Problem: 
 * 1. Greetings like "hi", "hey", "hello" were incorrectly in fillerWords,
 *    causing "Hi, my name is Mark" → ", my name is mark" (BROKEN)
 * 2. Polite words like "please", "thanks" were incorrectly in TEMPLATE fillerWords,
 *    causing "Uh, yes, please" → ", yes, ." (BROKEN)
 * 
 * Fix: Remove ALL problematic words from BOTH:
 * - GlobalInstantResponseTemplate (global level)
 * - Individual trade templates (template level - nlpConfig.fillerWords)
 * 
 * Run: node scripts/fix-greeting-filler-words.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Words that should NEVER be stripped as fillers
const WORDS_TO_REMOVE = [
    // Greetings - these are polite, not fillers
    'hi', 'hey', 'hello', 'yo', 'good morning', 'good afternoon', 'good evening',
    // Polite words - carry meaning
    'please', 'thanks', 'thank you', 'thankyou',
    // Discourse markers that carry meaning
    'actually', 'basically', 'literally', 'honestly',
    // Time words - semantically critical
    'today', 'tomorrow', 'now', 'tonight', 'morning', 'afternoon', 'evening',
    // Urgency words - critical for triage
    'asap', 'urgent', 'emergency', 'right away', 'immediately',
    // Relationship words - break questions
    'like', 'you know', 'i mean', 'you guys'
];

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('V85: FIX FILLER WORDS MIGRATION (GLOBAL + TEMPLATES)');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('');
    console.log('Words to remove:', WORDS_TO_REMOVE.join(', '));
    console.log('');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not found in environment');
        process.exit(1);
    }
    
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected\n');
    
    let totalUpdated = 0;
    
    // ═══════════════════════════════════════════════════════════════════
    // PART 1: Fix GlobalInstantResponseTemplate (global fillerWords)
    // ═══════════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('PART 1: GlobalInstantResponseTemplate (global level)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    const GlobalInstantResponseTemplate = mongoose.connection.collection('globalinstantresponsetemplates');
    const globalTemplates = await GlobalInstantResponseTemplate.find({}).toArray();
    console.log(`📋 Found ${globalTemplates.length} global templates\n`);
    
    for (const template of globalTemplates) {
        const originalFillers = template.fillerWords || [];
        const filteredFillers = originalFillers.filter(word => {
            const lower = word.toLowerCase().trim();
            return !WORDS_TO_REMOVE.includes(lower);
        });
        
        const removed = originalFillers.length - filteredFillers.length;
        
        if (removed > 0) {
            console.log(`📝 Global Template: ${template.name || template._id}`);
            console.log(`   Fillers before (${originalFillers.length}): [${originalFillers.slice(0, 8).join(', ')}${originalFillers.length > 8 ? '...' : ''}]`);
            const removedWords = WORDS_TO_REMOVE.filter(g => originalFillers.map(f => f.toLowerCase()).includes(g));
            console.log(`   Removing (${removedWords.length}): ${removedWords.join(', ')}`);
            console.log(`   Fillers after (${filteredFillers.length}): [${filteredFillers.slice(0, 8).join(', ')}${filteredFillers.length > 8 ? '...' : ''}]`);
            
            await GlobalInstantResponseTemplate.updateOne(
                { _id: template._id },
                { $set: { fillerWords: filteredFillers } }
            );
            
            console.log(`   ✅ Updated\n`);
            totalUpdated++;
        }
        
        // Also check nlpConfig.fillerWords in global templates
        const nlpFillers = template.nlpConfig?.fillerWords || [];
        if (nlpFillers.length > 0) {
            const filteredNlpFillers = nlpFillers.filter(word => {
                const lower = word.toLowerCase().trim();
                return !WORDS_TO_REMOVE.includes(lower);
            });
            
            const nlpRemoved = nlpFillers.length - filteredNlpFillers.length;
            if (nlpRemoved > 0) {
                console.log(`📝 Global Template NLP: ${template.name || template._id}`);
                console.log(`   nlpConfig.fillerWords before (${nlpFillers.length}): [${nlpFillers.slice(0, 8).join(', ')}...]`);
                const removedNlpWords = WORDS_TO_REMOVE.filter(g => nlpFillers.map(f => f.toLowerCase()).includes(g));
                console.log(`   Removing (${removedNlpWords.length}): ${removedNlpWords.join(', ')}`);
                
                await GlobalInstantResponseTemplate.updateOne(
                    { _id: template._id },
                    { $set: { 'nlpConfig.fillerWords': filteredNlpFillers } }
                );
                
                console.log(`   ✅ Updated nlpConfig.fillerWords\n`);
                totalUpdated++;
            }
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // PART 2: Fix Company-level templates (instantResponse.nlpConfig.fillerWords)
    // ═══════════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('PART 2: Company Templates (template level - nlpConfig.fillerWords)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    const Companies = mongoose.connection.collection('companies');
    const companies = await Companies.find({}).toArray();
    console.log(`📋 Found ${companies.length} companies\n`);
    
    for (const company of companies) {
        const nlpFillers = company.instantResponse?.nlpConfig?.fillerWords || [];
        if (nlpFillers.length > 0) {
            const filteredFillers = nlpFillers.filter(word => {
                const lower = word.toLowerCase().trim();
                return !WORDS_TO_REMOVE.includes(lower);
            });
            
            const removed = nlpFillers.length - filteredFillers.length;
            if (removed > 0) {
                console.log(`📝 Company: ${company.name || company._id}`);
                console.log(`   nlpConfig.fillerWords before (${nlpFillers.length}): [${nlpFillers.slice(0, 8).join(', ')}...]`);
                const removedWords = WORDS_TO_REMOVE.filter(g => nlpFillers.map(f => f.toLowerCase()).includes(g));
                console.log(`   Removing (${removedWords.length}): ${removedWords.join(', ')}`);
                
                await Companies.updateOne(
                    { _id: company._id },
                    { $set: { 'instantResponse.nlpConfig.fillerWords': filteredFillers } }
                );
                
                console.log(`   ✅ Updated\n`);
                totalUpdated++;
            }
        }
    }
    
    // Also check companiesCollection
    const CompaniesCollection = mongoose.connection.collection('companiescollection');
    try {
        const companiesV2 = await CompaniesCollection.find({}).toArray();
        console.log(`📋 Found ${companiesV2.length} companiesCollection entries\n`);
        
        for (const company of companiesV2) {
            const nlpFillers = company.instantResponse?.nlpConfig?.fillerWords || [];
            if (nlpFillers.length > 0) {
                const filteredFillers = nlpFillers.filter(word => {
                    const lower = word.toLowerCase().trim();
                    return !WORDS_TO_REMOVE.includes(lower);
                });
                
                const removed = nlpFillers.length - filteredFillers.length;
                if (removed > 0) {
                    console.log(`📝 CompanyV2: ${company.name || company._id}`);
                    console.log(`   nlpConfig.fillerWords before (${nlpFillers.length}): [${nlpFillers.slice(0, 8).join(', ')}...]`);
                    
                    await CompaniesCollection.updateOne(
                        { _id: company._id },
                        { $set: { 'instantResponse.nlpConfig.fillerWords': filteredFillers } }
                    );
                    
                    console.log(`   ✅ Updated\n`);
                    totalUpdated++;
                }
            }
        }
    } catch (e) {
        console.log('   (companiesCollection not found or empty)\n');
    }
    
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`✅ MIGRATION COMPLETE: ${totalUpdated} total updates`);
    console.log('═══════════════════════════════════════════════════════════════════');
    
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
}

main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
