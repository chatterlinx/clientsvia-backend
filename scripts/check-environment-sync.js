#!/usr/bin/env node
/**
 * ============================================================================
 * ENVIRONMENT SYNC CHECKER
 * ============================================================================
 * 
 * PURPOSE:
 * Quick script to check if local database is in sync with production
 * Prevents mistakes like checking wrong database during troubleshooting
 * 
 * USAGE:
 * node scripts/check-environment-sync.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const EnvironmentMismatchDetector = require('../services/EnvironmentMismatchDetector');
const logger = require('../utils/logger');

async function checkSync() {
    console.log('🔍 ENVIRONMENT SYNC CHECK');
    console.log('═'.repeat(60));
    console.log('');

    // Show environment info
    const envInfo = EnvironmentMismatchDetector.getEnvironmentInfo();
    console.log('📊 ENVIRONMENT INFO:');
    console.log(`   Environment: ${envInfo.environment}`);
    console.log(`   Is Local: ${envInfo.isLocal}`);
    console.log(`   Database: ${envInfo.databaseUrl}`);
    console.log(`   Production URL: ${envInfo.productionUrl}`);
    console.log('');

    // Run sync check
    console.log('🔄 CHECKING DATABASE SYNC...');
    console.log('');

    const results = await EnvironmentMismatchDetector.runFullCheck();

    // Display results
    console.log('📊 SYNC RESULTS:');
    console.log('═'.repeat(60));
    console.log('');

    results.forEach(result => {
        if (result.error) {
            console.log(`❌ ${result.collection}: Error - ${result.error}`);
            return;
        }

        const status = result.isSignificant ? '🔴 MISMATCH' : 
                      result.isMismatch ? '⚠️  MINOR DIFF' : '✅ IN SYNC';

        console.log(`${status} ${result.collection}:`);
        console.log(`   Production: ${result.productionCount}`);
        console.log(`   Local:      ${result.localCount}`);
        console.log(`   Difference: ${result.difference} (${result.percentDiff.toFixed(1)}%)`);
        console.log('');
    });

    // Summary and recommendations
    const hasSignificant = results.some(r => r.isSignificant);
    const hasMismatch = results.some(r => r.isMismatch);

    console.log('═'.repeat(60));
    console.log('');

    if (hasSignificant) {
        console.log('🔴 SIGNIFICANT MISMATCH DETECTED');
        console.log('');
        console.log('⚠️  WARNING: Your local database differs significantly from production.');
        console.log('');
        console.log('RECOMMENDATIONS:');
        console.log('   1. Use production database for testing: Update MONGODB_URI in .env');
        console.log('   2. Sync local from production: node scripts/sync-from-production.js');
        console.log('   3. Be aware which database you\'re querying when troubleshooting');
        console.log('');
        console.log('💡 TIP: Check Notification Center for detailed alert');
    } else if (hasMismatch) {
        console.log('⚠️  MINOR DIFFERENCES DETECTED');
        console.log('');
        console.log('Your local database has minor differences from production.');
        console.log('This is normal for development, but be aware when troubleshooting.');
    } else {
        console.log('✅ ALL IN SYNC');
        console.log('');
        console.log('Your local and production databases are in sync!');
    }

    console.log('');
    console.log('═'.repeat(60));
    process.exit(hasSignificant ? 1 : 0);
}

checkSync().catch(error => {
    console.error('❌ Sync check failed:', error);
    process.exit(1);
});

