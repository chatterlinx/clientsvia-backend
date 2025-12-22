#!/usr/bin/env node
/**
 * ============================================================================
 * HARD MIGRATION SCRIPT: Force Convergence to Canonical Config
 * ============================================================================
 * 
 * PURPOSE: One-time migration that:
 *   1. Detects legacy booking slots and copies to canonical
 *   2. Normalizes all placeholders to {{camelCase}} format
 *   3. Migrates greeting to canonical location
 *   4. Logs all changes per companyId
 * 
 * USAGE:
 *   node scripts/migrateToCanonicalConfig.js [--dry-run] [--company=ID]
 * 
 * OPTIONS:
 *   --dry-run   Preview changes without saving
 *   --company   Migrate specific company only
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { migratePlaceholders, DEFAULT_HVAC_BOOKING_SLOTS } = require('../utils/configUnifier');

// Parse command line args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const companyArg = args.find(a => a.startsWith('--company='));
const targetCompanyId = companyArg ? companyArg.split('=')[1] : null;

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// Migration stats
const stats = {
    companiesProcessed: 0,
    companiesMigrated: 0,
    bookingSlotsMigrated: 0,
    greetingsMigrated: 0,
    placeholdersMigrated: 0,
    errors: [],
    details: []
};

async function migrateCompany(company) {
    const changes = [];
    let needsSave = false;
    
    const companyId = company._id.toString();
    const companyName = company.companyName || 'Unknown';
    
    console.log(`\n📦 Processing: ${companyName} (${companyId})`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // 1. MIGRATE BOOKING SLOTS TO CANONICAL
    // ═══════════════════════════════════════════════════════════════════════
    const canonicalSlots = company.frontDeskBehavior?.bookingSlots || [];
    
    if (canonicalSlots.length === 0) {
        // Check legacy sources
        const legacySources = [
            { path: 'aiAgentSettings.bookingSlots', value: company.aiAgentSettings?.bookingSlots },
            { path: 'booking.slots', value: company.booking?.slots },
            { path: 'bookingSlots', value: company.bookingSlots }
        ];
        
        for (const source of legacySources) {
            if (source.value && source.value.length > 0) {
                // Initialize frontDeskBehavior if needed
                if (!company.frontDeskBehavior) company.frontDeskBehavior = {};
                
                // Copy to canonical
                company.frontDeskBehavior.bookingSlots = source.value;
                
                changes.push({
                    type: 'BOOKING_SLOTS_MIGRATED',
                    from: source.path,
                    to: 'frontDeskBehavior.bookingSlots',
                    count: source.value.length
                });
                
                console.log(`  ✅ Migrated ${source.value.length} booking slots from ${source.path}`);
                stats.bookingSlotsMigrated++;
                needsSave = true;
                break;
            }
        }
    } else {
        console.log(`  ℹ️  Booking slots already in canonical location (${canonicalSlots.length} slots)`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // 2. MIGRATE GREETING TO CANONICAL
    // ═══════════════════════════════════════════════════════════════════════
    const canonicalGreeting = company.connectionMessages?.voice?.text;
    
    if (!canonicalGreeting) {
        // Check legacy sources
        const legacyGreetings = [
            { path: 'connectionMessages.voice.realtime.text', value: company.connectionMessages?.voice?.realtime?.text },
            { path: 'frontDeskBehavior.greeting', value: company.frontDeskBehavior?.greeting },
            { path: 'aiAgentSettings.greeting', value: company.aiAgentSettings?.greeting }
        ];
        
        for (const source of legacyGreetings) {
            if (source.value) {
                // Initialize path
                if (!company.connectionMessages) company.connectionMessages = {};
                if (!company.connectionMessages.voice) company.connectionMessages.voice = {};
                
                // Migrate with placeholder standardization
                const migratedGreeting = migratePlaceholders(source.value);
                company.connectionMessages.voice.text = migratedGreeting;
                
                changes.push({
                    type: 'GREETING_MIGRATED',
                    from: source.path,
                    to: 'connectionMessages.voice.text',
                    original: source.value,
                    migrated: migratedGreeting,
                    placeholdersMigrated: source.value !== migratedGreeting
                });
                
                console.log(`  ✅ Migrated greeting from ${source.path}`);
                if (source.value !== migratedGreeting) {
                    console.log(`     📝 Placeholders standardized`);
                    stats.placeholdersMigrated++;
                }
                stats.greetingsMigrated++;
                needsSave = true;
                break;
            }
        }
    } else {
        // Check if existing greeting needs placeholder migration
        const migratedGreeting = migratePlaceholders(canonicalGreeting);
        if (canonicalGreeting !== migratedGreeting) {
            company.connectionMessages.voice.text = migratedGreeting;
            changes.push({
                type: 'GREETING_PLACEHOLDERS_MIGRATED',
                path: 'connectionMessages.voice.text',
                original: canonicalGreeting,
                migrated: migratedGreeting
            });
            console.log(`  ✅ Standardized greeting placeholders`);
            stats.placeholdersMigrated++;
            needsSave = true;
        } else {
            console.log(`  ℹ️  Greeting already in canonical location`);
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // 3. MIGRATE CONVERSATION STYLE TO PERSONALITY NESTED
    // ═══════════════════════════════════════════════════════════════════════
    const rootConversationStyle = company.frontDeskBehavior?.conversationStyle;
    const nestedConversationStyle = company.frontDeskBehavior?.personality?.conversationStyle;
    
    if (rootConversationStyle && !nestedConversationStyle) {
        if (!company.frontDeskBehavior.personality) company.frontDeskBehavior.personality = {};
        company.frontDeskBehavior.personality.conversationStyle = rootConversationStyle;
        
        changes.push({
            type: 'CONVERSATION_STYLE_MIGRATED',
            from: 'frontDeskBehavior.conversationStyle',
            to: 'frontDeskBehavior.personality.conversationStyle',
            value: rootConversationStyle
        });
        
        console.log(`  ✅ Migrated conversationStyle to personality nested path`);
        needsSave = true;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // 4. MIGRATE BOOKING ENABLED
    // ═══════════════════════════════════════════════════════════════════════
    const canonicalBookingEnabled = company.frontDeskBehavior?.bookingEnabled;
    
    if (canonicalBookingEnabled === undefined) {
        const legacyEnabled = company.aiAgentSettings?.bookingEnabled;
        if (legacyEnabled !== undefined) {
            if (!company.frontDeskBehavior) company.frontDeskBehavior = {};
            company.frontDeskBehavior.bookingEnabled = legacyEnabled;
            
            changes.push({
                type: 'BOOKING_ENABLED_MIGRATED',
                from: 'aiAgentSettings.bookingEnabled',
                to: 'frontDeskBehavior.bookingEnabled',
                value: legacyEnabled
            });
            
            console.log(`  ✅ Migrated bookingEnabled from aiAgentSettings`);
            needsSave = true;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SAVE OR PREVIEW
    // ═══════════════════════════════════════════════════════════════════════
    if (needsSave) {
        if (dryRun) {
            console.log(`  🔍 DRY RUN - Would save ${changes.length} changes`);
        } else {
            await company.save();
            console.log(`  💾 Saved ${changes.length} changes`);
        }
        
        stats.companiesMigrated++;
        stats.details.push({
            companyId,
            companyName,
            changes
        });
    } else {
        console.log(`  ✨ No migration needed`);
    }
    
    stats.companiesProcessed++;
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(' CANONICAL CONFIG MIGRATION');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes saved)' : '💾 LIVE (changes will be saved)'}`);
    console.log(`Target: ${targetCompanyId || 'ALL COMPANIES'}`);
    console.log('═══════════════════════════════════════════════════════════════════════');
    
    try {
        // Connect to MongoDB
        console.log('\n📡 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        // Get Company model
        const Company = require('../models/v2Company');
        
        // Build query
        const query = targetCompanyId ? { _id: targetCompanyId } : {};
        
        // Get companies
        const companies = await Company.find(query);
        console.log(`\n📊 Found ${companies.length} companies to process`);
        
        // Process each company
        for (const company of companies) {
            try {
                await migrateCompany(company);
            } catch (error) {
                console.error(`  ❌ Error processing ${company._id}: ${error.message}`);
                stats.errors.push({
                    companyId: company._id.toString(),
                    error: error.message
                });
            }
        }
        
        // Print summary
        console.log('\n═══════════════════════════════════════════════════════════════════════');
        console.log(' MIGRATION SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════════════');
        console.log(`Companies Processed:    ${stats.companiesProcessed}`);
        console.log(`Companies Migrated:     ${stats.companiesMigrated}`);
        console.log(`Booking Slots Migrated: ${stats.bookingSlotsMigrated}`);
        console.log(`Greetings Migrated:     ${stats.greetingsMigrated}`);
        console.log(`Placeholders Migrated:  ${stats.placeholdersMigrated}`);
        console.log(`Errors:                 ${stats.errors.length}`);
        
        if (stats.errors.length > 0) {
            console.log('\n❌ ERRORS:');
            stats.errors.forEach(e => console.log(`   - ${e.companyId}: ${e.error}`));
        }
        
        if (dryRun) {
            console.log('\n🔍 DRY RUN COMPLETE - No changes were saved');
            console.log('   Run without --dry-run to apply changes');
        }
        
        // Write detailed log
        const fs = require('fs');
        const logPath = `./logs/migration-${Date.now()}.json`;
        fs.mkdirSync('./logs', { recursive: true });
        fs.writeFileSync(logPath, JSON.stringify(stats, null, 2));
        console.log(`\n📄 Detailed log saved to: ${logPath}`);
        
    } catch (error) {
        console.error('\n❌ FATAL ERROR:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n👋 Disconnected from MongoDB');
    }
}

main();

