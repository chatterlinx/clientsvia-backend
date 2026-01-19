#!/usr/bin/env node
/**
 * V38 FIX: Remove problematic filler words from templates
 * =====================================================
 * 
 * Problem: "you know", "like", "i mean" were in default filler words
 * but they BREAK questions when removed:
 *   - "Do you know my name?" → "do my name?" (BROKEN!)
 *   - "I'd like to schedule" → "i'd to schedule" (BROKEN!)
 * 
 * This script removes these words from:
 *   1. GlobalInstantResponseTemplate.fillerWords
 *   2. STTProfile filler words
 *   3. Any company-specific template fillers
 * 
 * Run: node scripts/fix-filler-words-v38.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { MONGODB_URI } = process.env;

// Words that should NEVER be fillers (they break sentence meaning)
const DANGEROUS_FILLERS = ['you know', 'like', 'i mean', 'actually', 'basically'];

async function main() {
    if (!MONGODB_URI) {
        console.error('❌ MONGODB_URI not found in environment');
        process.exit(1);
    }

    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    
    // ════════════════════════════════════════════════════════════════
    // 1. Fix GlobalInstantResponseTemplate
    // ════════════════════════════════════════════════════════════════
    console.log('\n📋 Checking GlobalInstantResponseTemplate...');
    const templatesCollection = db.collection('globalinstantresponsetemplates');
    const templates = await templatesCollection.find({}).toArray();
    
    let templatesFixed = 0;
    for (const template of templates) {
        if (template.fillerWords && Array.isArray(template.fillerWords)) {
            const originalFillers = [...template.fillerWords];
            const cleanedFillers = template.fillerWords.filter(
                filler => !DANGEROUS_FILLERS.includes(filler.toLowerCase())
            );
            
            if (cleanedFillers.length !== originalFillers.length) {
                const removed = originalFillers.filter(f => !cleanedFillers.includes(f));
                await templatesCollection.updateOne(
                    { _id: template._id },
                    { $set: { fillerWords: cleanedFillers } }
                );
                console.log(`  ✅ Template "${template.name || template.version}" - removed: ${removed.join(', ')}`);
                templatesFixed++;
            }
        }
    }
    console.log(`   ${templatesFixed} templates fixed`);

    // ════════════════════════════════════════════════════════════════
    // 2. Fix STTProfiles
    // ════════════════════════════════════════════════════════════════
    console.log('\n📋 Checking STTProfiles...');
    const sttProfilesCollection = db.collection('sttprofiles');
    const sttProfiles = await sttProfilesCollection.find({}).toArray();
    
    let sttFixed = 0;
    for (const profile of sttProfiles) {
        if (profile.fillers && Array.isArray(profile.fillers)) {
            const originalFillers = [...profile.fillers];
            const cleanedFillers = profile.fillers.filter(
                filler => {
                    const phrase = (filler.phrase || filler).toLowerCase();
                    return !DANGEROUS_FILLERS.includes(phrase);
                }
            );
            
            if (cleanedFillers.length !== originalFillers.length) {
                const removed = originalFillers
                    .filter(f => !cleanedFillers.includes(f))
                    .map(f => f.phrase || f);
                await sttProfilesCollection.updateOne(
                    { _id: profile._id },
                    { $set: { fillers: cleanedFillers } }
                );
                console.log(`  ✅ STTProfile "${profile.name || profile._id}" - removed: ${removed.join(', ')}`);
                sttFixed++;
            }
        }
    }
    console.log(`   ${sttFixed} STT profiles fixed`);

    // ════════════════════════════════════════════════════════════════
    // 3. Summary
    // ════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════');
    console.log('V38 FILLER FIX COMPLETE');
    console.log('═══════════════════════════════════════════════════');
    console.log(`Templates fixed: ${templatesFixed}`);
    console.log(`STT Profiles fixed: ${sttFixed}`);
    console.log('');
    console.log('REMOVED (dangerous fillers that break questions):');
    DANGEROUS_FILLERS.forEach(f => console.log(`  - "${f}"`));
    console.log('');
    console.log('Deploy the backend to apply schema defaults.');
    console.log('═══════════════════════════════════════════════════');

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
}

main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
