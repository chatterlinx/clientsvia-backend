#!/usr/bin/env node

require('dotenv').config();
const { redisClient } = require('../db');

async function clearCache(companyId) {
    try {
        const cacheKey = `company:${companyId}`;
        
        console.log(`\n🗑️ Clearing cache for company: ${companyId}`);
        console.log(`   Cache key: ${cacheKey}\n`);
        
        const result = await redisClient.del(cacheKey);
        
        if (result === 1) {
            console.log(`✅ Cache cleared successfully!`);
        } else {
            console.log(`ℹ️  No cache found (already clear)`);
        }
        
        console.log(`\n💡 The next API call will fetch fresh data from MongoDB.\n`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

const companyId = process.argv[2];

if (!companyId) {
    console.error('Usage: node clear-company-cache.js <companyId>');
    process.exit(1);
}

clearCache(companyId);

