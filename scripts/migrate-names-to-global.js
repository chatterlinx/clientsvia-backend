#!/usr/bin/env node
/**
 * ============================================================================
 * MIGRATE COMMON FIRST NAMES TO GLOBAL AdminSettings
 * ============================================================================
 * 
 * PROBLEM: 
 *   Common first names (900+) exist in per-company frontDeskBehavior
 *   but AdminSettings.commonFirstNames is empty (never seeded).
 *   The V84 Global Settings tab reads from AdminSettings, so names show (0).
 *
 * SOLUTION:
 *   1. Scan ALL companies for commonFirstNames in frontDeskBehavior
 *   2. Merge into one deduplicated, sorted global list
 *   3. Save to AdminSettings.commonFirstNames (the single source of truth)
 *   4. Also migrate nameStopWords the same way
 *
 * RUN: node scripts/migrate-names-to-global.js
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Company = require('../models/v2Company');
const AdminSettings = require('../models/AdminSettings');

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // ═════════════════════════════════════════════════════════════
        // STEP 1: Check current AdminSettings state
        // ═════════════════════════════════════════════════════════════
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
        console.log(`  AdminSettings.commonFirstNames: ${(adminSettings.commonFirstNames || []).length} names`);
        console.log(`  AdminSettings.commonLastNames:   ${(adminSettings.commonLastNames || []).length} names`);
        console.log(`  AdminSettings.nameStopWords:     ${(adminSettings.nameStopWords || []).length} words`);
        console.log();

        // ═════════════════════════════════════════════════════════════
        // STEP 2: Scan all companies for names
        // ═════════════════════════════════════════════════════════════
        const companies = await Company.find({
            'aiAgentSettings.frontDeskBehavior.commonFirstNames': { $exists: true, $ne: [] }
        }).select('companyName aiAgentSettings.frontDeskBehavior.commonFirstNames aiAgentSettings.frontDeskBehavior.commonLastNames aiAgentSettings.frontDeskBehavior.nameStopWords').lean();

        console.log(`Found ${companies.length} companies with commonFirstNames data:\n`);

        const allFirstNames = new Set();
        const allLastNames = new Set();
        const allStopWords = new Set();

        for (const company of companies) {
            const fdb = company.aiAgentSettings?.frontDeskBehavior || {};
            const firstNames = fdb.commonFirstNames || [];
            const lastNames = fdb.commonLastNames || [];
            const stopWords = fdb.nameStopWords || [];

            console.log(`  📋 ${company.companyName || company._id}:`);
            console.log(`     First names: ${firstNames.length}, Last names: ${lastNames.length}, Stop words: ${Array.isArray(stopWords) ? stopWords.length : 'legacy format'}`);

            firstNames.forEach(n => allFirstNames.add(n.trim()));
            lastNames.forEach(n => allLastNames.add(n.trim()));
            
            if (Array.isArray(stopWords)) {
                stopWords.forEach(w => allStopWords.add(w.trim().toLowerCase()));
            } else if (stopWords && typeof stopWords === 'object' && Array.isArray(stopWords.custom)) {
                stopWords.custom.forEach(w => allStopWords.add(w.trim().toLowerCase()));
            }
        }

        console.log();
        console.log('═'.repeat(70));
        console.log('MERGED TOTALS (deduplicated):');
        console.log('═'.repeat(70));
        console.log(`  First names: ${allFirstNames.size}`);
        console.log(`  Last names:  ${allLastNames.size}`);
        console.log(`  Stop words:  ${allStopWords.size}`);
        console.log();

        // ═════════════════════════════════════════════════════════════
        // STEP 3: Only update if AdminSettings has fewer names
        // ═════════════════════════════════════════════════════════════
        let updated = false;

        // First names
        const existingFirstCount = (adminSettings.commonFirstNames || []).length;
        if (allFirstNames.size > existingFirstCount) {
            // Merge: keep existing + add new from companies
            const merged = new Set([...(adminSettings.commonFirstNames || []), ...allFirstNames]);
            adminSettings.commonFirstNames = [...merged].sort((a, b) => a.localeCompare(b));
            console.log(`✅ commonFirstNames: ${existingFirstCount} → ${adminSettings.commonFirstNames.length} (merged)`);
            updated = true;
        } else {
            console.log(`⏭️  commonFirstNames: ${existingFirstCount} already >= ${allFirstNames.size} from companies (skipped)`);
        }

        // Last names (only if AdminSettings is empty — Census data is loaded at runtime)
        const existingLastCount = (adminSettings.commonLastNames || []).length;
        if (allLastNames.size > 0 && existingLastCount === 0) {
            adminSettings.commonLastNames = [...allLastNames].sort((a, b) => a.localeCompare(b));
            console.log(`✅ commonLastNames: 0 → ${adminSettings.commonLastNames.length} (seeded from companies)`);
            updated = true;
        } else {
            console.log(`⏭️  commonLastNames: ${existingLastCount} already present (skipped)`);
        }

        // Stop words
        const existingStopCount = (adminSettings.nameStopWords || []).length;
        if (allStopWords.size > existingStopCount) {
            const merged = new Set([...(adminSettings.nameStopWords || []), ...allStopWords]);
            adminSettings.nameStopWords = [...merged].sort((a, b) => a.localeCompare(b));
            console.log(`✅ nameStopWords: ${existingStopCount} → ${adminSettings.nameStopWords.length} (merged)`);
            updated = true;
        } else {
            console.log(`⏭️  nameStopWords: ${existingStopCount} already >= ${allStopWords.size} from companies (skipped)`);
        }

        // ═════════════════════════════════════════════════════════════
        // STEP 4: Save
        // ═════════════════════════════════════════════════════════════
        if (updated) {
            adminSettings.lastUpdated = new Date();
            await adminSettings.save();
            console.log('\n✅ AdminSettings saved successfully!');
        } else {
            console.log('\n⏭️  No updates needed — AdminSettings already has all data.');
        }

        // ═════════════════════════════════════════════════════════════
        // STEP 5: Verify
        // ═════════════════════════════════════════════════════════════
        const verify = await AdminSettings.findOne().lean();
        console.log('\n═'.repeat(70));
        console.log('FINAL STATE:');
        console.log('═'.repeat(70));
        console.log(`  AdminSettings.commonFirstNames: ${(verify.commonFirstNames || []).length} names`);
        console.log(`  AdminSettings.commonLastNames:   ${(verify.commonLastNames || []).length} names`);
        console.log(`  AdminSettings.nameStopWords:     ${(verify.nameStopWords || []).length} words`);
        
        if ((verify.commonFirstNames || []).length > 0) {
            console.log(`\n  Sample first names: ${verify.commonFirstNames.slice(0, 15).join(', ')}...`);
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
