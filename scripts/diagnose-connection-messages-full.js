#!/usr/bin/env node
/**
 * ============================================================================
 * FULL CONNECTION MESSAGES DIAGNOSTIC
 * ============================================================================
 * Complete deep audit of connection messages system:
 * - Database schema structure
 * - Company data validation
 * - Field type verification
 * - Save/load flow analysis
 * ============================================================================
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');
require('dotenv').config();

async function fullDiagnostic() {
    try {
        console.log('🔍 FULL CONNECTION MESSAGES DIAGNOSTIC\n');
        console.log('='.repeat(80));

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Get Royal Plumbing company
        const companyId = '68eeaf924e989145e9d46c12';
        console.log(`📋 Analyzing Company ID: ${companyId}\n`);

        // Load company with lean() first (raw data)
        const companyRaw = await Company.findById(companyId).lean();
        
        if (!companyRaw) {
            console.log('❌ Company not found!');
            process.exit(1);
        }

        console.log('1️⃣ RAW DATABASE DATA (lean - no schema processing)');
        console.log('='.repeat(80));
        console.log('Company Name:', companyRaw.companyName);
        console.log('\naiAgentLogic exists?', !!companyRaw.aiAgentLogic);
        console.log('connectionMessages exists?', !!companyRaw.aiAgentLogic?.connectionMessages);
        
        if (companyRaw.aiAgentLogic?.connectionMessages) {
            const cm = companyRaw.aiAgentLogic.connectionMessages;
            console.log('\n--- Connection Messages Structure ---');
            console.log('voice exists?', !!cm.voice);
            
            if (cm.voice) {
                console.log('\n  voice.mode:', cm.voice.mode);
                console.log('  voice.text:', cm.voice.text || '(null)');
                console.log('  voice.realtime:', cm.voice.realtime);
                console.log('  voice.fallback TYPE:', typeof cm.voice.fallback);
                console.log('  voice.fallback VALUE:', JSON.stringify(cm.voice.fallback, null, 2));
                
                if (typeof cm.voice.fallback === 'string') {
                    console.log('\n  ❌ PROBLEM FOUND: fallback is a STRING, should be OBJECT!');
                    console.log('  String value:', cm.voice.fallback);
                } else if (typeof cm.voice.fallback === 'object' && cm.voice.fallback !== null) {
                    console.log('\n  ✅ fallback is correctly an OBJECT');
                    console.log('  fallback.enabled:', cm.voice.fallback.enabled);
                    console.log('  fallback.voiceMessage:', cm.voice.fallback.voiceMessage);
                    console.log('  fallback.adminPhone:', cm.voice.fallback.adminPhone);
                    console.log('  fallback.adminEmail:', cm.voice.fallback.adminEmail);
                    console.log('  fallback.adminSmsMessage:', cm.voice.fallback.adminSmsMessage);
                }
            }
        }

        console.log('\n\n2️⃣ MONGOOSE PROCESSED DATA (with schema)');
        console.log('='.repeat(80));
        
        // Now load with Mongoose schema processing
        const company = await Company.findById(companyId);
        
        console.log('Company loaded with Mongoose schema');
        console.log('aiAgentLogic exists?', !!company.aiAgentLogic);
        console.log('connectionMessages exists?', !!company.aiAgentLogic?.connectionMessages);
        
        if (company.aiAgentLogic?.connectionMessages?.voice) {
            const voice = company.aiAgentLogic.connectionMessages.voice;
            console.log('\n--- Voice Configuration ---');
            console.log('mode:', voice.mode);
            console.log('text:', voice.text || '(null)');
            console.log('realtime.text:', voice.realtime?.text || '(null)');
            console.log('fallback TYPE:', typeof voice.fallback);
            
            if (typeof voice.fallback === 'object' && voice.fallback !== null) {
                console.log('fallback.enabled:', voice.fallback.enabled);
                console.log('fallback.voiceMessage:', voice.fallback.voiceMessage);
                console.log('fallback.smsEnabled:', voice.fallback.smsEnabled);
                console.log('fallback.smsMessage:', voice.fallback.smsMessage);
                console.log('fallback.notifyAdmin:', voice.fallback.notifyAdmin);
                console.log('fallback.adminNotificationMethod:', voice.fallback.adminNotificationMethod);
                console.log('fallback.adminPhone:', voice.fallback.adminPhone || '(null)');
                console.log('fallback.adminEmail:', voice.fallback.adminEmail || '(null)');
                console.log('fallback.adminSmsMessage:', voice.fallback.adminSmsMessage);
            }
        }

        console.log('\n\n3️⃣ SCHEMA VALIDATION TEST');
        console.log('='.repeat(80));
        
        try {
            // Try to validate the company document
            await company.validate();
            console.log('✅ Document passes Mongoose validation');
        } catch (validationError) {
            console.log('❌ Mongoose validation FAILED:');
            console.log(validationError.message);
            if (validationError.errors) {
                Object.keys(validationError.errors).forEach(key => {
                    console.log(`  - ${key}: ${validationError.errors[key].message}`);
                });
            }
        }

        console.log('\n\n4️⃣ SAVE TEST');
        console.log('='.repeat(80));
        
        try {
            // Try a no-op save to see if it works
            company.aiAgentLogic.connectionMessages.lastUpdated = new Date();
            await company.save();
            console.log('✅ Save successful');
        } catch (saveError) {
            console.log('❌ Save FAILED:');
            console.log('Error name:', saveError.name);
            console.log('Error message:', saveError.message);
            console.log('Error stack:', saveError.stack);
            
            if (saveError.errors) {
                console.log('\nValidation errors:');
                Object.keys(saveError.errors).forEach(key => {
                    console.log(`  - ${key}:`, saveError.errors[key]);
                });
            }
        }

        console.log('\n\n5️⃣ FIELD TYPE ANALYSIS');
        console.log('='.repeat(80));
        
        // Check schema definition
        const connectionMessagesSchemaPath = company.schema.path('aiAgentLogic.connectionMessages');
        console.log('connectionMessages schema type:', connectionMessagesSchemaPath?.instance || 'NOT FOUND');
        
        const fallbackSchemaPath = company.schema.path('aiAgentLogic.connectionMessages.voice.fallback');
        console.log('voice.fallback schema type:', fallbackSchemaPath?.instance || 'NOT FOUND');
        
        if (fallbackSchemaPath) {
            console.log('voice.fallback is required?', fallbackSchemaPath.isRequired);
            console.log('voice.fallback default:', fallbackSchemaPath.defaultValue);
        }

        console.log('\n\n6️⃣ RECOMMENDATIONS');
        console.log('='.repeat(80));
        
        const rawFallback = companyRaw.aiAgentLogic?.connectionMessages?.voice?.fallback;
        const mongooseFallback = company.aiAgentLogic?.connectionMessages?.voice?.fallback;
        
        if (typeof rawFallback === 'string') {
            console.log('❌ CRITICAL: Database contains string fallback value');
            console.log('   This must be converted to object before Mongoose can process it');
            console.log('   Run: node scripts/nuclear-fallback-cleanup.js');
        } else if (typeof rawFallback === 'object') {
            console.log('✅ Database fallback format is correct (object)');
        }
        
        if (typeof mongooseFallback === 'object') {
            console.log('✅ Mongoose processed fallback correctly');
        } else {
            console.log('❌ Mongoose failed to process fallback');
        }

        console.log('\n' + '='.repeat(80));
        console.log('DIAGNOSTIC COMPLETE');
        console.log('='.repeat(80) + '\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ DIAGNOSTIC FAILED:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

fullDiagnostic();

