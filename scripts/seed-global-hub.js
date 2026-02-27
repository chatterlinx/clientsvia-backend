#!/usr/bin/env node
/**
 * ============================================================================
 * SEED GLOBAL HUB - Complete Dictionary Seeder
 * ============================================================================
 * 
 * Seeds both First Names and Last Names into AdminSettings.globalHub
 * 
 * Data Sources:
 * - First Names: ~4,000 from scripts/seed-first-names.js (SSA + international)
 * - Last Names: ~50,000 from data/seeds/censusLastNames.js (US Census 2010)
 * 
 * USAGE:
 *   node scripts/seed-global-hub.js
 * 
 * OUTPUT:
 *   - Populates AdminSettings.globalHub.dictionaries.firstNames
 *   - Populates AdminSettings.globalHub.dictionaries.lastNames
 *   - Server startup will load these into Redis automatically
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function seedGlobalHub() {
    console.log('🌐 Starting Global Hub Seeding...');
    console.log('━'.repeat(80));
    
    try {
        // Connect to MongoDB
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        const AdminSettings = require('../models/AdminSettings');
        
        // Get or create AdminSettings
        let settings = await AdminSettings.getSettings();
        if (!settings) {
            console.log('📄 Creating new AdminSettings document...');
            settings = new AdminSettings({});
        }
        
        console.log('━'.repeat(80));
        
        // ════════════════════════════════════════════════════════════════════════
        // SEED FIRST NAMES
        // ════════════════════════════════════════════════════════════════════════
        
        console.log('👤 Loading First Names...');
        const { FIRST_NAMES } = require('./seed-first-names');
        
        // Normalize and deduplicate
        const seen = new Set();
        const normalizedFirstNames = [];
        
        for (const name of FIRST_NAMES) {
            const trimmed = name.trim();
            if (!trimmed) continue;
            
            const titleCase = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
            const lowerKey = titleCase.toLowerCase();
            
            if (!seen.has(lowerKey)) {
                seen.add(lowerKey);
                normalizedFirstNames.push(titleCase);
            }
        }
        
        normalizedFirstNames.sort((a, b) => a.localeCompare(b));
        
        console.log(`📊 First Names: ${normalizedFirstNames.length.toLocaleString()} unique names`);
        console.log(`📋 Sample: ${normalizedFirstNames.slice(0, 10).join(', ')}...`);
        
        // ════════════════════════════════════════════════════════════════════════
        // SEED LAST NAMES
        // ════════════════════════════════════════════════════════════════════════
        
        console.log('\n🏷️  Loading Last Names...');
        const { CENSUS_TOP_50K_LAST_NAMES } = require('../data/seeds/censusLastNames');
        
        // Normalize to Title Case
        const normalizedLastNames = CENSUS_TOP_50K_LAST_NAMES
            .map(name => {
                const trimmed = name.trim();
                if (!trimmed) return null;
                return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
            })
            .filter(Boolean);
        
        console.log(`📊 Last Names: ${normalizedLastNames.length.toLocaleString()} surnames`);
        console.log(`📋 Sample: ${normalizedLastNames.slice(0, 10).join(', ')}...`);
        
        // ════════════════════════════════════════════════════════════════════════
        // SAVE TO MONGODB
        // ════════════════════════════════════════════════════════════════════════
        
        console.log('\n💾 Saving to MongoDB...');
        
        // Initialize globalHub structure
        if (!settings.globalHub) {
            settings.globalHub = {};
        }
        if (!settings.globalHub.dictionaries) {
            settings.globalHub.dictionaries = {};
        }
        
        // Save first names
        settings.globalHub.dictionaries.firstNames = normalizedFirstNames;
        settings.globalHub.dictionaries.firstNamesUpdatedAt = new Date();
        settings.globalHub.dictionaries.firstNamesUpdatedBy = 'seed-global-hub-script';
        
        // Save last names
        settings.globalHub.dictionaries.lastNames = normalizedLastNames;
        settings.globalHub.dictionaries.lastNamesUpdatedAt = new Date();
        settings.globalHub.dictionaries.lastNamesUpdatedBy = 'seed-global-hub-script';
        
        // Mark as modified and save
        settings.markModified('globalHub');
        await settings.save();
        
        console.log('✅ Data saved to MongoDB successfully!');
        
        console.log('\n━'.repeat(80));
        console.log('📊 SUMMARY');
        console.log('━'.repeat(80));
        console.log(`✅ First Names: ${normalizedFirstNames.length.toLocaleString()} names`);
        console.log(`✅ Last Names: ${normalizedLastNames.length.toLocaleString()} surnames`);
        console.log(`✅ Total: ${(normalizedFirstNames.length + normalizedLastNames.length).toLocaleString()} entries`);
        console.log('━'.repeat(80));
        
        console.log('\n🔄 Next: Restart server to load into Redis');
        console.log('   Server startup will automatically sync to Redis\n');
        
    } catch (error) {
        console.error('❌ Error seeding Global Hub:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    seedGlobalHub().then(() => {
        console.log('🎉 Seeding complete!');
        process.exit(0);
    });
}

module.exports = { seedGlobalHub };
