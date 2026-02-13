#!/usr/bin/env node
/**
 * ============================================================================
 * SEED / MIGRATE GLOBAL NAME LISTS TO AdminSettings
 * ============================================================================
 * 
 * WHAT THIS DOES:
 *   Ensures AdminSettings has comprehensive, deduplicated name lists sourced
 *   from US Government public domain data:
 *
 *   - commonFirstNames: SSA Baby Names (data/seeds/ssaFirstNames.js)
 *       → 10,000 names, 96.7% US population coverage
 *       → Source: US Social Security Administration (1880–present)
 *
 *   - commonLastNames: US Census Surnames (data/seeds/censusLastNames.js)
 *       → 50,000 names, ~83% US population coverage
 *       → Source: US Census Bureau 2010 Decennial Census
 *
 *   - nameStopWords: Merges any existing per-company custom stop words
 *       → Words that should NEVER be accepted as caller names
 *
 * STRATEGY:
 *   1. Load seed files (SSA first names + Census last names)
 *   2. Merge with any existing AdminSettings data (preserves admin additions)
 *   3. Merge any per-company legacy data that isn't in the seed
 *   4. Save the deduplicated, sorted result to AdminSettings
 *
 * AdminSettings is the SINGLE SOURCE OF TRUTH. All companies share it.
 * Runtime reads via AWConfigReader (cached, 5-min TTL).
 *
 * RUN: node scripts/migrate-names-to-global.js
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Company = require('../models/v2Company');
const AdminSettings = require('../models/AdminSettings');

// ═══════════════════════════════════════════════════════════════════════════
// SEED DATA — US Government Public Domain
// ═══════════════════════════════════════════════════════════════════════════
let SSA_FIRST_NAMES = [];
let CENSUS_LAST_NAMES = [];

try {
    SSA_FIRST_NAMES = require('../data/seeds/ssaFirstNames');
    console.log(`✅ Loaded SSA first names seed: ${SSA_FIRST_NAMES.length.toLocaleString()} names`);
} catch (e) {
    console.error('❌ Failed to load data/seeds/ssaFirstNames.js:', e.message);
    process.exit(1);
}

try {
    CENSUS_LAST_NAMES = require('../data/seeds/censusLastNames');
    console.log(`✅ Loaded Census last names seed: ${CENSUS_LAST_NAMES.length.toLocaleString()} names`);
} catch (e) {
    console.error('❌ Failed to load data/seeds/censusLastNames.js:', e.message);
    process.exit(1);
}

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('\n✅ Connected to MongoDB\n');

        // ═════════════════════════════════════════════════════════════════
        // STEP 1: Check current AdminSettings state
        // ═════════════════════════════════════════════════════════════════
        let adminSettings = await AdminSettings.findOne();
        
        if (!adminSettings) {
            console.log('⚠️  No AdminSettings found — creating one...');
            adminSettings = new AdminSettings({});
            await adminSettings.save();
            console.log('✅ Created AdminSettings document\n');
        }

        console.log('═'.repeat(70));
        console.log('CURRENT STATE:');
        console.log('═'.repeat(70));
        console.log(`  AdminSettings.commonFirstNames: ${(adminSettings.commonFirstNames || []).length.toLocaleString()} names`);
        console.log(`  AdminSettings.commonLastNames:   ${(adminSettings.commonLastNames || []).length.toLocaleString()} names`);
        console.log(`  AdminSettings.nameStopWords:     ${(adminSettings.nameStopWords || []).length} words`);
        console.log();

        // ═════════════════════════════════════════════════════════════════
        // STEP 2: Scan all companies for any per-company names to merge
        // ═════════════════════════════════════════════════════════════════
        const companies = await Company.find({
            $or: [
                { 'aiAgentSettings.frontDeskBehavior.commonFirstNames': { $exists: true, $ne: [] } },
                { 'aiAgentSettings.frontDeskBehavior.commonLastNames': { $exists: true, $ne: [] } },
                { 'aiAgentSettings.frontDeskBehavior.nameStopWords': { $exists: true, $ne: [] } }
            ]
        }).select('companyName aiAgentSettings.frontDeskBehavior.commonFirstNames aiAgentSettings.frontDeskBehavior.commonLastNames aiAgentSettings.frontDeskBehavior.nameStopWords').lean();

        console.log(`Found ${companies.length} companies with per-company name data:\n`);

        const companyFirstNames = new Set();
        const companyLastNames = new Set();
        const companyStopWords = new Set();

        for (const company of companies) {
            const fdb = company.aiAgentSettings?.frontDeskBehavior || {};
            const firstNames = fdb.commonFirstNames || [];
            const lastNames = fdb.commonLastNames || [];
            const stopWords = fdb.nameStopWords || [];

            console.log(`  📋 ${company.companyName || company._id}:`);
            console.log(`     First: ${firstNames.length}, Last: ${lastNames.length}, Stop: ${Array.isArray(stopWords) ? stopWords.length : 'legacy format'}`);

            firstNames.forEach(n => { if (n?.trim()) companyFirstNames.add(n.trim().toLowerCase()); });
            lastNames.forEach(n => { if (n?.trim()) companyLastNames.add(n.trim().toLowerCase()); });
            
            if (Array.isArray(stopWords)) {
                stopWords.forEach(w => { if (w?.trim()) companyStopWords.add(w.trim().toLowerCase()); });
            } else if (stopWords && typeof stopWords === 'object' && Array.isArray(stopWords.custom)) {
                stopWords.custom.forEach(w => { if (w?.trim()) companyStopWords.add(w.trim().toLowerCase()); });
            }
        }

        // ═════════════════════════════════════════════════════════════════
        // STEP 3: Merge all sources → deduplicate → sort
        // ═════════════════════════════════════════════════════════════════
        // Priority: Seed files (SSA/Census) are the base.
        //           Existing AdminSettings names are preserved (admin additions).
        //           Per-company names are merged (legacy migration).
        
        console.log('\n' + '═'.repeat(70));
        console.log('MERGING:');
        console.log('═'.repeat(70));
        
        // First names: SSA seed + existing AdminSettings + per-company
        const mergedFirstNames = new Set([
            ...SSA_FIRST_NAMES.map(n => n.toLowerCase()),
            ...(adminSettings.commonFirstNames || []).map(n => n.toLowerCase()),
            ...companyFirstNames
        ]);
        
        // Last names: Census seed + existing AdminSettings + per-company
        const mergedLastNames = new Set([
            ...CENSUS_LAST_NAMES.map(n => n.toLowerCase()),
            ...(adminSettings.commonLastNames || []).map(n => n.toLowerCase()),
            ...companyLastNames
        ]);
        
        // Stop words: existing AdminSettings + per-company
        const mergedStopWords = new Set([
            ...(adminSettings.nameStopWords || []).map(w => w.toLowerCase()),
            ...companyStopWords
        ]);
        
        const finalFirstNames = [...mergedFirstNames].sort();
        const finalLastNames = [...mergedLastNames].sort();
        const finalStopWords = [...mergedStopWords].sort();
        
        console.log(`  First names: SSA(${SSA_FIRST_NAMES.length.toLocaleString()}) + AdminSettings(${(adminSettings.commonFirstNames || []).length.toLocaleString()}) + Companies(${companyFirstNames.size.toLocaleString()}) → ${finalFirstNames.length.toLocaleString()} merged`);
        console.log(`  Last names:  Census(${CENSUS_LAST_NAMES.length.toLocaleString()}) + AdminSettings(${(adminSettings.commonLastNames || []).length.toLocaleString()}) + Companies(${companyLastNames.size.toLocaleString()}) → ${finalLastNames.length.toLocaleString()} merged`);
        console.log(`  Stop words:  AdminSettings(${(adminSettings.nameStopWords || []).length}) + Companies(${companyStopWords.size}) → ${finalStopWords.length} merged`);

        // ═════════════════════════════════════════════════════════════════
        // STEP 4: Save to AdminSettings
        // ═════════════════════════════════════════════════════════════════
        adminSettings.commonFirstNames = finalFirstNames;
        adminSettings.commonLastNames = finalLastNames;
        adminSettings.nameStopWords = finalStopWords;
        adminSettings.lastUpdated = new Date();
        
        await adminSettings.save();
        console.log('\n✅ AdminSettings saved successfully!');

        // ═════════════════════════════════════════════════════════════════
        // STEP 5: Verify
        // ═════════════════════════════════════════════════════════════════
        const verify = await AdminSettings.findOne().lean();
        console.log('\n' + '═'.repeat(70));
        console.log('FINAL STATE:');
        console.log('═'.repeat(70));
        console.log(`  AdminSettings.commonFirstNames: ${(verify.commonFirstNames || []).length.toLocaleString()} names`);
        console.log(`  AdminSettings.commonLastNames:   ${(verify.commonLastNames || []).length.toLocaleString()} names`);
        console.log(`  AdminSettings.nameStopWords:     ${(verify.nameStopWords || []).length} words`);
        
        if ((verify.commonFirstNames || []).length > 0) {
            console.log(`\n  Sample first names: ${verify.commonFirstNames.slice(0, 15).join(', ')}...`);
        }
        if ((verify.commonLastNames || []).length > 0) {
            console.log(`  Sample last names:  ${verify.commonLastNames.slice(0, 15).join(', ')}...`);
        }

    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        console.error(err.stack);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MongoDB');
    }
}

migrate();
