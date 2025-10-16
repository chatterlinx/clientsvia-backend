#!/usr/bin/env node

/**
 * 🚨 EMERGENCY DATABASE REPAIR SCRIPT
 * 
 * Purpose: Fix corrupt voiceSettings data that prevents Mongoose from loading documents
 * Issue: voiceSettings is stored as string "default" instead of object, causing:
 *        "Cannot create property 'enabled' on string 'default'"
 * 
 * This script bypasses Mongoose validation and fixes the data directly in MongoDB.
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Connect directly to MongoDB (bypass Mongoose models to avoid validation)
async function fixVoiceSettings() {
    try {
        console.log('\n🚨 EMERGENCY DATABASE REPAIR - Voice Settings Corruption');
        console.log('═'.repeat(80));
        
        // Connect to MongoDB
        console.log('\n📡 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        // Get direct access to the companies collection (bypass Mongoose models)
        const db = mongoose.connection.db;
        const companiesCollection = db.collection('v2companies');
        
        console.log('\n🔍 Scanning for corrupted voiceSettings...');
        
        // Find ALL companies with corrupt voiceSettings
        const companies = await companiesCollection.find({
            'aiAgentLogic.voiceSettings': { $type: 'string' } // Find where it's a string
        }).toArray();
        
        console.log(`\n📊 Found ${companies.length} companies with corrupt voiceSettings`);
        
        if (companies.length === 0) {
            console.log('✅ No corruption found! All voiceSettings are valid.');
            await mongoose.disconnect();
            return;
        }
        
        // Show what we found
        console.log('\n🔍 Corrupt Companies:');
        companies.forEach((company, index) => {
            console.log(`${index + 1}. ${company.companyName} (${company._id})`);
            console.log(`   Current voiceSettings:`, company.aiAgentLogic?.voiceSettings);
        });
        
        // Fix each company
        console.log('\n🔧 Starting repair process...');
        let successCount = 0;
        let errorCount = 0;
        
        for (const company of companies) {
            try {
                console.log(`\n🔧 Fixing: ${company.companyName} (${company._id})`);
                console.log(`   Current value: "${company.aiAgentLogic?.voiceSettings}"`);
                
                // Use MongoDB's native update to bypass Mongoose validation
                const result = await companiesCollection.updateOne(
                    { _id: company._id },
                    {
                        $set: {
                            'aiAgentLogic.voiceSettings': {
                                // V2 Default Settings
                                apiSource: 'clientsvia',
                                apiKey: null,
                                voiceId: null,
                                
                                // Voice Quality Controls
                                stability: 0.5,
                                similarityBoost: 0.7,
                                styleExaggeration: 0.0,
                                
                                // Performance & Output
                                speakerBoost: true,
                                aiModel: 'eleven_turbo_v2_5',
                                outputFormat: 'mp3_44100_128',
                                streamingLatency: 0,
                                
                                // V2 Features
                                enabled: true,
                                lastUpdated: new Date(),
                                version: '2.0'
                            }
                        }
                    }
                );
                
                if (result.modifiedCount === 1) {
                    console.log(`   ✅ FIXED`);
                    successCount++;
                } else {
                    console.log(`   ⚠️ No changes made (might already be fixed)`);
                }
                
            } catch (error) {
                console.error(`   ❌ FAILED:`, error.message);
                errorCount++;
            }
        }
        
        // Summary
        console.log('\n' + '═'.repeat(80));
        console.log('📊 REPAIR SUMMARY');
        console.log('═'.repeat(80));
        console.log(`Total companies found:     ${companies.length}`);
        console.log(`Successfully repaired:     ${successCount} ✅`);
        console.log(`Failed:                    ${errorCount} ❌`);
        
        // Verify the fixes
        console.log('\n🔍 Verifying repairs...');
        const stillCorrupt = await companiesCollection.find({
            'aiAgentLogic.voiceSettings': { $type: 'string' }
        }).toArray();
        
        if (stillCorrupt.length === 0) {
            console.log('✅ ALL REPAIRS SUCCESSFUL! No corrupt data remaining.');
        } else {
            console.log(`⚠️ WARNING: ${stillCorrupt.length} companies still have corrupt data:`);
            stillCorrupt.forEach(company => {
                console.log(`   - ${company.companyName} (${company._id})`);
            });
        }
        
        console.log('\n🔌 Disconnecting from MongoDB...');
        await mongoose.disconnect();
        console.log('✅ Disconnected');
        
        console.log('\n' + '═'.repeat(80));
        console.log('🚀 REPAIR COMPLETE!');
        console.log('═'.repeat(80));
        console.log('\nYou can now:');
        console.log('1. Refresh the company profile page');
        console.log('2. Try saving voice settings again');
        console.log('3. All voiceSettings should now work correctly\n');
        
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ FATAL ERROR:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run the repair
fixVoiceSettings();

