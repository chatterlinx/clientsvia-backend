#!/usr/bin/env node
/**
 * ============================================================================
 * FIX: Remove "today" from filler words in all templates
 * ============================================================================
 * 
 * Problem: "today" was being stripped from caller input, destroying scheduling intent
 * Example: "I need someone to come out here today" → "I need someone to come out here"
 * 
 * This script removes "today" from:
 * - GlobalInstantResponseTemplate.fillerWords
 * - GlobalInstantResponseTemplate.categories.fillerWords
 * 
 * Run: node scripts/fix-today-filler-word.js
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

const WORDS_TO_REMOVE = [
    'today',
    'tomorrow',
    'now',
    'asap',
    'urgent',
    'emergency',
    'right away',
    'immediately',
    'tonight',
    'morning',
    'afternoon',
    'evening'
];

async function fixFillerWords() {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('FIX: Removing time-related words from filler words');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('Words to remove:', WORDS_TO_REMOVE.join(', '));
    console.log('');
    
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
        
        // Find all templates
        const templates = await GlobalInstantResponseTemplate.find({});
        console.log(`Found ${templates.length} templates to check`);
        
        let totalUpdated = 0;
        
        for (const template of templates) {
            let templateModified = false;
            const changes = [];
            
            // Check template-level fillerWords
            if (template.fillerWords && template.fillerWords.length > 0) {
                const originalCount = template.fillerWords.length;
                const filtered = template.fillerWords.filter(word => 
                    !WORDS_TO_REMOVE.includes(word.toLowerCase())
                );
                const removedCount = originalCount - filtered.length;
                
                if (removedCount > 0) {
                    const removed = template.fillerWords.filter(word => 
                        WORDS_TO_REMOVE.includes(word.toLowerCase())
                    );
                    changes.push(`Template-level: removed ${removedCount} words (${removed.join(', ')})`);
                    template.fillerWords = filtered;
                    templateModified = true;
                }
            }
            
            // Check category-level fillerWords
            if (template.categories && template.categories.length > 0) {
                for (const category of template.categories) {
                    if (category.fillerWords && category.fillerWords.length > 0) {
                        const originalCount = category.fillerWords.length;
                        const filtered = category.fillerWords.filter(word =>
                            !WORDS_TO_REMOVE.includes(word.toLowerCase())
                        );
                        const removedCount = originalCount - filtered.length;
                        
                        if (removedCount > 0) {
                            const removed = category.fillerWords.filter(word =>
                                WORDS_TO_REMOVE.includes(word.toLowerCase())
                            );
                            changes.push(`Category "${category.name || category.categoryId}": removed ${removedCount} words (${removed.join(', ')})`);
                            category.fillerWords = filtered;
                            templateModified = true;
                        }
                    }
                }
            }
            
            if (templateModified) {
                await template.save();
                totalUpdated++;
                console.log(`\n📝 UPDATED: ${template.name || template._id}`);
                changes.forEach(c => console.log(`   - ${c}`));
            }
        }
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        console.log(`✅ COMPLETE: Updated ${totalUpdated} templates`);
        console.log('═══════════════════════════════════════════════════════════════════════════');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

fixFillerWords();
