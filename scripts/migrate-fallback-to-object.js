/**
 * ================================================================
 * ONE-TIME MIGRATION: Convert Old Fallback String to New Object
 * ================================================================
 * 
 * PURPOSE: Clean up legacy fallback format in all companies
 * 
 * OLD FORMAT: voice.fallback = 'default' | 'silent'
 * NEW FORMAT: voice.fallback = { enabled, voiceMessage, smsEnabled, ... }
 * 
 * This script will:
 * 1. Find all companies with old string fallback
 * 2. Convert to new object format
 * 3. Save to database
 * 4. Report results
 * 
 * SAFE TO RUN MULTIPLE TIMES (idempotent)
 * ================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function migrateFallbackFormat() {
    console.log('🚀 Starting Fallback Format Migration...\n');

    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find all companies with old fallback format
        const companies = await Company.find({
            'aiAgentLogic.connectionMessages.voice.fallback': { $type: 'string' }
        });

        console.log(`📊 Found ${companies.length} companies with old fallback format\n`);

        if (companies.length === 0) {
            console.log('✅ All companies already using new format! Nothing to migrate.\n');
            process.exit(0);
        }

        let successCount = 0;
        let errorCount = 0;

        for (const company of companies) {
            try {
                const oldFallback = company.aiAgentLogic.connectionMessages.voice.fallback;
                
                console.log(`🔄 Migrating: ${company.companyName} (${company._id})`);
                console.log(`   Old: "${oldFallback}" (string)`);

                // Convert to new object format
                company.aiAgentLogic.connectionMessages.voice.fallback = {
                    enabled: true,
                    voiceMessage: "We're experiencing technical difficulties. Please hold while we connect you to our team.",
                    smsEnabled: true,
                    smsMessage: "Sorry, our voice system missed your call. How can we help you?",
                    notifyAdmin: true,
                    adminNotificationMethod: 'sms',
                    adminPhone: null,
                    adminEmail: null,
                    adminSmsMessage: "⚠️ FALLBACK ALERT: Greeting fallback occurred in {companyname} ({companyid}). Please check the Messages & Greetings settings immediately."
                };

                await company.save();
                
                console.log(`   ✅ New: Object with ${Object.keys(company.aiAgentLogic.connectionMessages.voice.fallback).length} properties`);
                console.log(`   💾 Saved to database\n`);
                
                successCount++;
            } catch (error) {
                console.error(`   ❌ Error migrating ${company.companyName}:`, error.message);
                console.error(`   Stack:`, error.stack);
                console.log('');
                errorCount++;
            }
        }

        // Summary
        console.log('========================================');
        console.log('📊 MIGRATION SUMMARY');
        console.log('========================================');
        console.log(`✅ Successful: ${successCount}`);
        console.log(`❌ Failed: ${errorCount}`);
        console.log(`📈 Total: ${companies.length}`);
        console.log('========================================\n');

        if (errorCount === 0) {
            console.log('🎉 Migration completed successfully!');
            console.log('🧹 All companies now using clean, modern fallback format.');
            console.log('☢️ NO LEGACY CODE REMAINS!\n');
        } else {
            console.log('⚠️ Migration completed with errors. Please review above.\n');
        }

    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Disconnected from MongoDB');
        process.exit(0);
    }
}

// Run migration
migrateFallbackFormat();

