#!/usr/bin/env node
/**
 * ============================================================================
 * MIGRATION: Fix Filler Words in Existing Templates
 * ============================================================================
 * 
 * ISSUE: Templates in MongoDB have aggressive filler words that destroy
 * caller messages. Most critically, "today" is being stripped, losing
 * scheduling intent:
 *   "Can someone come out today?" → "Can someone come out ?"
 * 
 * THIS SCRIPT:
 * 1. Finds all GlobalInstantResponseTemplate documents
 * 2. Removes dangerous filler words: today, there, question words, verbs
 * 3. Keeps only safe fillers: um, uh, hi, hello, please, etc.
 * 
 * RUN: node scripts/fix-filler-words-migration.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

// Words that should NEVER be filler words (they carry meaning)
const DANGEROUS_FILLERS = [
    // Time-related (scheduling intent!)
    'today', 'tomorrow', 'now', 'asap', 'morning', 'afternoon', 'evening',
    // Question words
    'what', 'when', 'where', 'who', 'how', 'why',
    // Essential verbs
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must',
    // Articles that change meaning mid-sentence
    'the', 'a', 'an',
    // Conjunctions that affect meaning
    'and', 'or', 'but',
    // Other contextual words
    'there', 'yes', 'no', 'yeah', 'yep', 'nope',
    // Words that often carry intent
    'so', 'well', 'okay', 'alright', 'right', 'basically', 'actually',
    'i', 'mean', 'you', 'know'
];

// Safe filler words (pure noise, no meaning)
const SAFE_FILLERS = [
    'um', 'uh', 'erm', 'er', 'hmm', 'mm',
    'like', 'you know', 'i mean',
    'hi', 'hey', 'hello', 'yo',
    'please', 'thanks', 'thank you',
    'you guys'
];

async function run() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔧 FILLER WORDS MIGRATION');
    console.log('═══════════════════════════════════════════════════════════════');
    
    // Connect to MongoDB
    console.log('[1/4] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[1/4] ✅ Connected');
    
    // Find all templates
    console.log('[2/4] Finding templates...');
    const templates = await GlobalInstantResponseTemplate.find({});
    console.log(`[2/4] ✅ Found ${templates.length} templates`);
    
    if (templates.length === 0) {
        console.log('No templates to update.');
        await mongoose.disconnect();
        return;
    }
    
    // Update each template
    console.log('[3/4] Updating filler words...');
    let updated = 0;
    let errors = 0;
    
    for (const template of templates) {
        try {
            const currentFillers = template.fillerWords || [];
            const originalCount = currentFillers.length;
            
            // Remove dangerous fillers
            const cleanedFillers = currentFillers.filter(word => {
                const normalized = word.toLowerCase().trim();
                return !DANGEROUS_FILLERS.includes(normalized);
            });
            
            // Ensure safe fillers are present
            for (const safeFiller of SAFE_FILLERS) {
                if (!cleanedFillers.includes(safeFiller)) {
                    cleanedFillers.push(safeFiller);
                }
            }
            
            const removed = currentFillers.filter(f => !cleanedFillers.includes(f));
            
            if (removed.length > 0 || cleanedFillers.length !== originalCount) {
                template.fillerWords = cleanedFillers;
                await template.save();
                
                console.log(`   ✅ ${template.name || template._id}`);
                console.log(`      Removed: ${removed.join(', ') || 'none'}`);
                console.log(`      Before: ${originalCount} → After: ${cleanedFillers.length}`);
                updated++;
            } else {
                console.log(`   ⏭️ ${template.name || template._id} - No changes needed`);
            }
        } catch (err) {
            console.error(`   ❌ ${template.name || template._id}: ${err.message}`);
            errors++;
        }
    }
    
    // Summary
    console.log('[4/4] Migration complete!');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`   Templates processed: ${templates.length}`);
    console.log(`   Templates updated: ${updated}`);
    console.log(`   Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════════════════');
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
}

run().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
