#!/usr/bin/env node
/**
 * ============================================================================
 * NUCLEAR FALLBACK CLEANUP
 * ============================================================================
 * PERMANENTLY removes all legacy string-based fallback values from the database.
 * This is a one-time cleanup to ensure NO legacy data remains.
 * 
 * Run: node scripts/nuclear-fallback-cleanup.js
 * ============================================================================
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');
require('dotenv').config();

async function nuclearCleanup() {
    try {
        console.log('🚀 Starting NUCLEAR FALLBACK CLEANUP...\n');

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find ALL companies with ANY fallback field (string or object)
        const companies = await Company.find({
            'aiAgentLogic.connectionMessages.voice.fallback': { $exists: true }
        });

        console.log(`📊 Found ${companies.length} companies with fallback config\n`);

        let migratedCount = 0;
        let alreadyObjectCount = 0;

        for (const company of companies) {
            const fallback = company.aiAgentLogic?.connectionMessages?.voice?.fallback;

            if (typeof fallback === 'string') {
                console.log(`❌ LEGACY DETECTED: ${company.companyName} (${company._id})`);
                console.log(`   Old value: "${fallback}"`);

                // NUKE IT: Replace with proper object structure
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
                console.log(`   ✅ NUKED and replaced with object structure\n`);
                migratedCount++;
            } else if (typeof fallback === 'object' && fallback !== null) {
                console.log(`✅ Already clean: ${company.companyName} (${company._id})`);
                alreadyObjectCount++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('CLEANUP COMPLETE');
        console.log('='.repeat(60));
        console.log(`✅ Companies with clean object structure: ${alreadyObjectCount}`);
        console.log(`🔥 Companies NUKED and migrated: ${migratedCount}`);
        console.log(`📊 Total processed: ${companies.length}`);
        console.log('='.repeat(60) + '\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ NUCLEAR CLEANUP FAILED:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

nuclearCleanup();

