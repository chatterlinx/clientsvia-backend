#!/usr/bin/env node
/**
 * V83 Migration: Fix dotted keys in bookingPromptsMap
 * 
 * PROBLEM: Mongoose Maps don't support keys with dots (.)
 * SOLUTION: Convert all dotted keys to colon-separated keys
 * 
 * Example:
 *   "booking.universal.guardrails.missing_prompt_fallback"
 *   becomes
 *   "booking:universal:guardrails:missing_prompt_fallback"
 * 
 * Usage: node scripts/fix-dotted-keys-migration.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function runMigration() {
    console.log('🔧 V83 Migration: Fixing dotted keys in bookingPromptsMap...\n');
    
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MONGODB_URI not found in environment');
        }
        
        console.log('📡 Connecting to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');
        
        // Get raw collection access (bypass Mongoose schema validation)
        const db = mongoose.connection.db;
        const companiesCollection = db.collection('v2companies');
        
        // Find all companies with bookingPromptsMap
        const companies = await companiesCollection.find({
            'frontDeskBehavior.bookingPromptsMap': { $exists: true }
        }).toArray();
        
        console.log(`📋 Found ${companies.length} companies with bookingPromptsMap\n`);
        
        let migratedCount = 0;
        let keysFixedTotal = 0;
        
        for (const company of companies) {
            const companyId = company._id.toString();
            const companyName = company.companyInfo?.companyName || 'Unknown';
            const promptsMap = company.frontDeskBehavior?.bookingPromptsMap;
            
            if (!promptsMap) {
                console.log(`⏭️  [${companyName}] No bookingPromptsMap, skipping...`);
                continue;
            }
            
            // Check if any keys have dots
            const oldKeys = Object.keys(promptsMap);
            const keysWithDots = oldKeys.filter(k => k.includes('.'));
            
            if (keysWithDots.length === 0) {
                console.log(`✅ [${companyName}] No dotted keys found, already migrated`);
                continue;
            }
            
            console.log(`🔄 [${companyName}] Found ${keysWithDots.length} dotted keys to fix:`);
            
            // Build new map with fixed keys
            const newPromptsMap = {};
            let keysFixed = 0;
            
            for (const [key, value] of Object.entries(promptsMap)) {
                if (key.includes('.')) {
                    const newKey = key.replace(/\./g, ':');
                    newPromptsMap[newKey] = value;
                    console.log(`   📝 "${key}" → "${newKey}"`);
                    keysFixed++;
                } else {
                    newPromptsMap[key] = value;
                }
            }
            
            // Update the document directly (bypass Mongoose validation)
            await companiesCollection.updateOne(
                { _id: company._id },
                { $set: { 'frontDeskBehavior.bookingPromptsMap': newPromptsMap } }
            );
            
            console.log(`   ✅ Fixed ${keysFixed} keys for ${companyName}\n`);
            migratedCount++;
            keysFixedTotal += keysFixed;
        }
        
        // Also fix promptGuards.missingPromptFallbackKey if it has dots
        const companiesWithPromptGuards = await companiesCollection.find({
            'frontDeskBehavior.promptGuards.missingPromptFallbackKey': { $regex: /\./ }
        }).toArray();
        
        console.log(`\n📋 Found ${companiesWithPromptGuards.length} companies with dotted missingPromptFallbackKey\n`);
        
        for (const company of companiesWithPromptGuards) {
            const companyName = company.companyInfo?.companyName || 'Unknown';
            const oldKey = company.frontDeskBehavior?.promptGuards?.missingPromptFallbackKey;
            const newKey = oldKey.replace(/\./g, ':');
            
            await companiesCollection.updateOne(
                { _id: company._id },
                { $set: { 'frontDeskBehavior.promptGuards.missingPromptFallbackKey': newKey } }
            );
            
            console.log(`🔄 [${companyName}] Fixed missingPromptFallbackKey: "${oldKey}" → "${newKey}"`);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 MIGRATION SUMMARY');
        console.log('='.repeat(60));
        console.log(`Companies with promptsMap migrated: ${migratedCount}`);
        console.log(`Total keys fixed: ${keysFixedTotal}`);
        console.log(`Companies with fallbackKey fixed: ${companiesWithPromptGuards.length}`);
        console.log('='.repeat(60));
        console.log('\n✅ Migration complete!\n');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('📡 Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    runMigration().then(() => process.exit(0));
}

module.exports = { runMigration };
