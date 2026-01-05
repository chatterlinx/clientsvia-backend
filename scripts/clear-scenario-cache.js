/**
 * ============================================================================
 * CLEAR SCENARIO POOL CACHE
 * ============================================================================
 * 
 * Clears the Redis cache for scenario pools, forcing fresh MongoDB loads.
 * 
 * Usage:
 *   node scripts/clear-scenario-cache.js                    # Clear for Penguin Air
 *   node scripts/clear-scenario-cache.js <companyId>        # Clear for specific company
 *   node scripts/clear-scenario-cache.js --all              # Clear ALL scenario caches
 * 
 * ============================================================================
 */

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';

async function clearCache() {
    const args = process.argv.slice(2);
    const clearAll = args.includes('--all');
    const companyId = args.find(a => !a.startsWith('--')) || PENGUIN_AIR_ID;
    
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('🗑️  CLEAR SCENARIO POOL CACHE');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    
    try {
        // Use the same Redis client as the app
        const redisFactory = require('../utils/redisFactory');
        const redis = redisFactory.getClient();
        
        if (!redis) {
            console.error('❌ Redis client not available');
            process.exit(1);
        }
        
        // Wait for connection
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (clearAll) {
            console.log('🔍 Finding all scenario-pool:* keys...');
            const keys = await redis.keys('scenario-pool:*');
            
            if (keys.length === 0) {
                console.log('✅ No scenario pool caches found');
            } else {
                console.log(`📋 Found ${keys.length} cached pools:`);
                for (const key of keys) {
                    console.log(`   • ${key}`);
                }
                
                // Delete all
                for (const key of keys) {
                    await redis.del(key);
                    console.log(`   ✅ Deleted: ${key}`);
                }
                console.log(`\n✅ Cleared ${keys.length} scenario pool caches`);
            }
        } else {
            const cacheKey = `scenario-pool:${companyId}`;
            console.log(`\n🔍 Checking for cache: ${cacheKey}`);
            
            const exists = await redis.exists(cacheKey);
            
            if (exists) {
                // Show what's cached before deleting
                const cached = await redis.get(cacheKey);
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        console.log(`📋 Current cached data:`);
                        console.log(`   • Scenarios: ${parsed.scenarios?.length || 0}`);
                        console.log(`   • Templates: ${parsed.templatesUsed?.length || 0}`);
                        console.log(`   • ECV: ${parsed.effectiveConfigVersion || 'null'}`);
                    } catch (e) {
                        console.log(`   (Unable to parse cached data)`);
                    }
                }
                
                await redis.del(cacheKey);
                console.log(`\n✅ Cache cleared for company: ${companyId}`);
            } else {
                console.log(`ℹ️  No cache found for company: ${companyId}`);
            }
        }
        
        console.log('\n📝 Next request will load fresh data from MongoDB');
        
        // Close Redis connection
        await redis.quit();
        console.log('✅ Done');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

clearCache();
