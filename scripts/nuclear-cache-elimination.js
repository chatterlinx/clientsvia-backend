/**
 * ☢️ NUCLEAR CACHE ELIMINATION
 * ============================
 * 
 * MISSION: Clear ALL caches that might be serving legacy Q&A data
 * TARGET: Redis cache, API response cache, and force browser refresh
 */

const { redisClient } = require('../clients');

async function nuclearCacheElimination() {
    console.log('☢️ NUCLEAR CACHE ELIMINATION');
    console.log('============================');
    console.log('🎯 TARGET: All caches serving legacy Q&A data');
    console.log('');

    try {
        // Clear Redis cache
        if (redisClient && redisClient.isReady) {
            console.log('🔥 CLEARING REDIS CACHE...');
            
            // Clear all company-related cache keys
            const companyId = '68813026dd95f599c74e49c7';
            const cacheKeys = [
                `company:${companyId}`,
                `company:${companyId}:*`,
                `knowledge:company:${companyId}:*`,
                `qna:company:${companyId}:*`,
                `trade:company:${companyId}:*`
            ];
            
            for (const keyPattern of cacheKeys) {
                try {
                    if (keyPattern.includes('*')) {
                        // Use SCAN to find matching keys
                        const keys = await redisClient.keys(keyPattern);
                        if (keys.length > 0) {
                            await redisClient.del(keys);
                            console.log(`✅ CLEARED ${keys.length} cache keys matching: ${keyPattern}`);
                        } else {
                            console.log(`ℹ️  No keys found for pattern: ${keyPattern}`);
                        }
                    } else {
                        // Direct key deletion
                        const result = await redisClient.del(keyPattern);
                        if (result > 0) {
                            console.log(`✅ CLEARED cache key: ${keyPattern}`);
                        } else {
                            console.log(`ℹ️  Key not found: ${keyPattern}`);
                        }
                    }
                } catch (error) {
                    console.log(`❌ Error clearing ${keyPattern}: ${error.message}`);
                }
            }
            
            // Nuclear option - clear ALL Redis cache
            console.log('☢️ NUCLEAR OPTION: Clearing ALL Redis cache...');
            await redisClient.flushAll();
            console.log('✅ ALL REDIS CACHE ELIMINATED');
            
        } else {
            console.log('ℹ️  Redis not available - skipping cache clear');
        }

        console.log('\n✅ NUCLEAR CACHE ELIMINATION COMPLETE');
        console.log('=====================================');
        console.log('🎯 All server-side caches cleared');
        console.log('🔄 Browser cache must be cleared manually');
        console.log('');
        console.log('📋 NEXT STEPS FOR USER:');
        console.log('1. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)');
        console.log('2. Clear browser cache completely');
        console.log('3. Open browser dev tools > Application > Storage > Clear site data');
        console.log('4. Refresh the Company Q&A page');

    } catch (error) {
        console.error('❌ Error during nuclear cache elimination:', error);
    }
}

// Run the nuclear cache elimination
nuclearCacheElimination().catch(console.error);
