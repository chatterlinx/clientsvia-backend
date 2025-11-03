/**
 * CLEAR LIVE SCENARIOS CACHE
 * 
 * Purpose: Clear Redis cache for live-scenarios after fixing the .enabled bug
 * 
 * Run: node scripts/clear-live-scenarios-cache.js
 */

require('dotenv').config();
const { redisClient } = require('../db');

const logger = {
  info: (...args) => console.log('ℹ️ ', ...args),
  success: (...args) => console.log('✅', ...args),
  error: (...args) => console.error('❌', ...args)
};

async function clearCache() {
  try {
    logger.info('========================================');
    logger.info('CLEAR LIVE SCENARIOS CACHE');
    logger.info('========================================\n');

    // Royal Plumbing company ID
    const companyId = '68e3f77a9d623b8058c700c4';
    const cacheKey = `live-scenarios:${companyId}`;
    
    logger.info(`Clearing cache key: ${cacheKey}`);
    
    const result = await redisClient.del(cacheKey);
    
    if (result === 1) {
      logger.success('✅ Cache cleared successfully!');
      logger.info('Next API call will fetch fresh data from MongoDB.\n');
    } else {
      logger.info('⚪ No cache found (might have expired already).\n');
    }
    
    logger.info('========================================');
    logger.success('DONE');
    logger.info('========================================\n');
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Failed to clear cache:', error);
    process.exit(1);
  }
}

clearCache();


