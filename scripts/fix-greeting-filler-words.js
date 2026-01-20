#!/usr/bin/env node
/**
 * V84: Fix Greeting Filler Words Migration
 * ══════════════════════════════════════════════════════════════════════════════
 * 
 * Problem: Greetings like "hi", "hey", "hello" were incorrectly in fillerWords,
 * causing "Hi, my name is Mark" → ", my name is mark" (BROKEN)
 * 
 * Fix: Remove greeting words from fillerWords - they're not fillers!
 * 
 * Run: node scripts/fix-greeting-filler-words.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const GREETINGS_TO_REMOVE = ['hi', 'hey', 'hello', 'yo', 'good morning', 'good afternoon', 'good evening'];

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('V84: FIX GREETING FILLER WORDS MIGRATION');
    console.log('═══════════════════════════════════════════════════════════════════');
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
    
    // Get the GlobalInstantResponseTemplate collection
    const GlobalInstantResponseTemplate = mongoose.connection.collection('globalinstantresponsetemplates');
    
    // Find all templates
    const templates = await GlobalInstantResponseTemplate.find({}).toArray();
    console.log(`📋 Found ${templates.length} templates\n`);
    
    let updatedCount = 0;
    
    for (const template of templates) {
        const originalFillers = template.fillerWords || [];
        const filteredFillers = originalFillers.filter(word => {
            const lower = word.toLowerCase().trim();
            return !GREETINGS_TO_REMOVE.includes(lower);
        });
        
        const removed = originalFillers.length - filteredFillers.length;
        
        if (removed > 0) {
            console.log(`📝 Template: ${template.name || template._id}`);
            console.log(`   Before: [${originalFillers.slice(0, 10).join(', ')}${originalFillers.length > 10 ? '...' : ''}]`);
            console.log(`   Removing: ${GREETINGS_TO_REMOVE.filter(g => originalFillers.map(f => f.toLowerCase()).includes(g)).join(', ')}`);
            console.log(`   After: [${filteredFillers.slice(0, 10).join(', ')}${filteredFillers.length > 10 ? '...' : ''}]`);
            
            await GlobalInstantResponseTemplate.updateOne(
                { _id: template._id },
                { $set: { fillerWords: filteredFillers } }
            );
            
            console.log(`   ✅ Updated\n`);
            updatedCount++;
        }
    }
    
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`✅ Migration complete: ${updatedCount} templates updated`);
    console.log('═══════════════════════════════════════════════════════════════════');
    
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
}

main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
