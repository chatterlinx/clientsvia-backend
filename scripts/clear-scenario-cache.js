#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🧹 CLEAR SCENARIO POOL CACHE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Clear Redis cache for scenario pools to force fresh load
 * WHEN TO USE:
 *   - After template changes in Global AI Brain
 *   - After fixing bugs in ScenarioPoolService
 *   - After changing company template references
 *   - When testing to ensure fresh data
 * 
 * USAGE:
 *   node scripts/clear-scenario-cache.js [companyId]
 *   node scripts/clear-scenario-cache.js 68e3f77a9d623b8058c700c4  (Royal Plumbing)
 *   node scripts/clear-scenario-cache.js --all  (Clear ALL company caches)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const { connectDB, redisClient } = require('../db');
const Company = require('../models/v2Company');

const CACHE_KEY_PREFIX = 'scenario-pool:';

async function clearScenarioCache(companyId) {
    try {
        console.log(`\n🔍 Clearing scenario cache for company: ${companyId}`);
        
        // Load company name for better logging
        const company = await Company.findById(companyId).select('companyName businessName');
        const companyName = company?.companyName || company?.businessName || companyId;
        
        // Clear scenario pool cache
        const scenarioKey = `${CACHE_KEY_PREFIX}${companyId}`;
        const deleted = await redisClient.del(scenarioKey);
        
        if (deleted > 0) {
            console.log(`✅ Cleared scenario cache for: ${companyName}`);
            console.log(`   Key: ${scenarioKey}`);
        } else {
            console.log(`⚠️  No cache found for: ${companyName}`);
            console.log(`   Key: ${scenarioKey}`);
        }
        
        // Also clear company cache (contains template references)
        const companyKey = `company:${companyId}`;
        const companyDeleted = await redisClient.del(companyKey);
        
        if (companyDeleted > 0) {
            console.log(`✅ Cleared company cache: ${companyKey}`);
        }
        
        // Also clear company-phone cache (if exists)
        if (company?.twilioConfig?.phoneNumbers?.length > 0) {
            const phone = company.twilioConfig.phoneNumbers[0].phoneNumber;
            const phoneKey = `company-phone:${phone}`;
            const phoneDeleted = await redisClient.del(phoneKey);
            
            if (phoneDeleted > 0) {
                console.log(`✅ Cleared phone cache: ${phoneKey}`);
            }
        }
        
        console.log(`\n✨ Cache cleared! Next call will load fresh data from MongoDB.\n`);
        
        return true;
    } catch (error) {
        console.error(`❌ Error clearing cache for ${companyId}:`, error.message);
        return false;
    }
}

async function clearAllScenarioCaches() {
    try {
        console.log(`\n🔍 Searching for ALL scenario pool cache keys...`);
        
        // Get all scenario-pool: keys
        const keys = await redisClient.keys(`${CACHE_KEY_PREFIX}*`);
        
        if (keys.length === 0) {
            console.log(`⚠️  No scenario pool caches found.`);
            return true;
        }
        
        console.log(`\n📋 Found ${keys.length} scenario pool cache(s):`);
        keys.forEach((key, index) => {
            console.log(`   ${index + 1}. ${key}`);
        });
        
        console.log(`\n🧹 Clearing all ${keys.length} cache(s)...`);
        
        // Delete all keys
        const deleted = await redisClient.del(...keys);
        
        console.log(`✅ Cleared ${deleted} cache key(s)`);
        console.log(`\n✨ All scenario caches cleared! Next calls will load fresh data from MongoDB.\n`);
        
        return true;
    } catch (error) {
        console.error(`❌ Error clearing all caches:`, error.message);
        return false;
    }
}

async function main() {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🧹 SCENARIO POOL CACHE CLEANER`);
    console.log(`${'═'.repeat(80)}\n`);
    
    try {
        // Connect to MongoDB and Redis
        console.log(`📡 Connecting to MongoDB and Redis...`);
        await connectDB();
        
        if (!redisClient || !redisClient.isReady) {
            throw new Error('Redis client not ready');
        }
        
        console.log(`✅ Connected!\n`);
        
        // Parse arguments
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.log(`❌ ERROR: No arguments provided!\n`);
            console.log(`USAGE:`);
            console.log(`  node scripts/clear-scenario-cache.js <companyId>`);
            console.log(`  node scripts/clear-scenario-cache.js 68e3f77a9d623b8058c700c4`);
            console.log(`  node scripts/clear-scenario-cache.js --all\n`);
            process.exit(1);
        }
        
        if (args[0] === '--all' || args[0] === '-a') {
            await clearAllScenarioCaches();
        } else {
            const companyId = args[0];
            
            // Validate companyId format
            if (!/^[a-f0-9]{24}$/i.test(companyId)) {
                console.log(`❌ ERROR: Invalid company ID format: ${companyId}`);
                console.log(`Expected 24-character hex string (MongoDB ObjectId)\n`);
                process.exit(1);
            }
            
            await clearScenarioCache(companyId);
        }
        
        console.log(`${'═'.repeat(80)}`);
        console.log(`✅ DONE!`);
        console.log(`${'═'.repeat(80)}\n`);
        
        process.exit(0);
        
    } catch (error) {
        console.error(`\n❌ FATAL ERROR:`, error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { clearScenarioCache, clearAllScenarioCaches };

