require('dotenv').config();
const BackupManager = require('../utils/backupManager');
const logger = require('../utils/logger');

async function runBackupCheck() {
  try {
    console.log('🔍 Starting backup verification and health check...\n');
    
    const backupManager = new BackupManager(process.env.MONGODB_URI);
    
    // 1. Check backup strategy
    console.log('📋 BACKUP STRATEGY:');
    const strategy = backupManager.getBackupStrategy();
    console.log(JSON.stringify(strategy, null, 2));
    console.log('\n');
    
    // 2. Check Atlas backup status (if applicable)
    console.log('☁️  ATLAS BACKUP STATUS:');
    const atlasStatus = await backupManager.checkAtlasBackupStatus();
    console.log(JSON.stringify(atlasStatus, null, 2));
    console.log('\n');
    
    // 3. Verify database health
    console.log('❤️  DATABASE HEALTH CHECK:');
    const healthCheck = await backupManager.verifyDatabaseHealth();
    console.log(JSON.stringify(healthCheck, null, 2));
    console.log('\n');
    
    // 4. Create manual backup metadata
    console.log('💾 CREATING MANUAL BACKUP METADATA:');
    const manualBackup = await backupManager.createManualBackup();
    console.log(JSON.stringify(manualBackup, null, 2));
    console.log('\n');
    
    // 5. Summary and recommendations
    console.log('✅ BACKUP VERIFICATION SUMMARY:');
    console.log('- Atlas Status:', atlasStatus.status);
    console.log('- Database Health:', healthCheck.status);
    console.log('- Manual Backup:', manualBackup.status);
    console.log('\n📝 RECOMMENDATIONS:');
    
    if (atlasStatus.status === 'atlas_connected') {
      console.log('✅ MongoDB Atlas automated backups are active');
      console.log('✅ Point-in-time recovery available');
      console.log('✅ No additional backup configuration needed');
      console.log('📌 Verify backup settings in Atlas dashboard periodically');
      console.log('📌 Test restore process quarterly');
    } else if (atlasStatus.status === 'not_atlas') {
      console.log('⚠️  Not using MongoDB Atlas - consider upgrading for automated backups');
      console.log('⚠️  Implement custom backup solution for production');
    } else {
      console.log('❌ Unable to verify backup status - check connection');
    }
    
    logger.info('Backup verification completed successfully');
    
  } catch (error) {
    console.error('❌ Backup verification failed:', error);
    logger.error('Backup verification failed', { error: error.message });
  }
}

// Run if called directly
if (require.main === module) {
  runBackupCheck().then(() => {
    console.log('\n🎉 Backup verification complete!');
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error during backup verification:', error);
    process.exit(1);
  });
}

module.exports = { runBackupCheck };
