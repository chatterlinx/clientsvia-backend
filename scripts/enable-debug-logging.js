#!/usr/bin/env node
/**
 * Enable V92 Debug Logging for a Company
 * 
 * Usage: node scripts/enable-debug-logging.js [companyId] [true|false]
 * Default: Penguin Air (68e3f77a9d623b8058c700c4), enabled
 * 
 * This enables enhanced diagnostic logging at consent/booking checkpoints.
 * Logs will appear in BlackBox with "V92:" prefix.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../db');
const Company = require('../models/v2Company');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';

async function enableDebugLogging() {
    const companyId = process.argv[2] || PENGUIN_AIR_ID;
    const enable = process.argv[3] !== 'false'; // Default true
    
    console.log(`\n🔧 V92 Debug Logging Configuration`);
    console.log(`   Company ID: ${companyId}`);
    console.log(`   Enable: ${enable}`);
    console.log('');
    
    try {
        await connectDB();
        console.log('✅ Connected to MongoDB');
        
        // Find the company first
        const company = await Company.findById(companyId);
        if (!company) {
            console.error(`❌ Company not found: ${companyId}`);
            process.exit(1);
        }
        
        console.log(`📍 Found company: ${company.name}`);
        
        // Check current value
        const currentValue = company.aiAgentSettings?.frontDeskBehavior?.debugLogging;
        console.log(`   Current debugLogging: ${currentValue ?? 'not set'}`);
        
        if (currentValue === enable) {
            console.log(`\n✅ Already set to ${enable}. No changes needed.`);
            process.exit(0);
        }
        
        // Update the setting
        const result = await Company.updateOne(
            { _id: companyId },
            { 
                $set: { 
                    'aiAgentSettings.frontDeskBehavior.debugLogging': enable 
                } 
            }
        );
        
        if (result.modifiedCount === 1) {
            console.log(`\n✅ SUCCESS: debugLogging set to ${enable}`);
            console.log('');
            console.log('📋 What happens now:');
            console.log('   - Consent check logs: 🔍 V92: ENTERING CONSENT CHECK');
            console.log('   - Consent detected: ✅ V92: CONSENT DETECTED!');
            console.log('   - No consent: ❌ V92: NO CONSENT DETECTED');
            console.log('   - Booking trigger: 🎯 V92: BOOKING TRIGGERED');
            console.log('   - Booking snap: 📋 V92: BOOKING SNAP SUCCESS');
            console.log('   - Failures: ⚠️ V92: POTENTIAL CONSENT→BOOKING FAILURE');
            console.log('');
            console.log('🔍 To view logs, search BlackBox for: "V92:"');
        } else {
            console.log(`\n⚠️ No changes made. Result: ${JSON.stringify(result)}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('\n✅ Database connection closed');
    }
}

enableDebugLogging();
