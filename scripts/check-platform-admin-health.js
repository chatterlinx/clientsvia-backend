/**
 * PLATFORM ADMIN HEALTH CHECK
 * 
 * Purpose: Monitor and detect Platform Admin multiplicity issues
 * 
 * Usage:
 * - Run manually: node scripts/check-platform-admin-health.js
 * - Add to cron: Run daily/hourly to catch issues early
 * - Add to CI/CD: Run after deployments
 * 
 * Exit codes:
 * - 0: Healthy (exactly 1 Platform Admin)
 * - 1: Critical (0 or multiple Platform Admins found)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const User = require('../models/v2User');

const logger = {
  info: (...args) => console.log('ℹ️ ', ...args),
  success: (...args) => console.log('✅', ...args),
  warning: (...args) => console.log('⚠️ ', ...args),
  error: (...args) => console.error('❌', ...args),
  critical: (...args) => console.error('🚨', ...args),
  debug: (...args) => console.log('🔍', ...args)
};

async function checkPlatformAdminHealth() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Find all Platform Admin companies
    const platformAdminCompanies = await Company.find({
      $or: [
        { companyName: 'Platform Admin' },
        { businessName: 'Platform Admin' },
        { 'metadata.isPlatformAdmin': true }
      ]
    }).sort({ createdAt: 1 });

    const count = platformAdminCompanies.length;

    // Header
    console.log('\n========================================');
    console.log('🏥 PLATFORM ADMIN HEALTH CHECK');
    console.log('========================================\n');
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    // Check 1: Platform Admin Count
    if (count === 0) {
      logger.critical('CRITICAL: No Platform Admin company found!');
      logger.error('   Expected: 1, Found: 0');
      logger.error('   Action: Platform Admin company needs to be created\n');
      
      // Check for orphaned admin users
      const orphanAdmins = await User.find({ 
        role: 'admin',
        $or: [
          { companyId: { $exists: false } },
          { companyId: null }
        ]
      });
      
      if (orphanAdmins.length > 0) {
        logger.error(`   Found ${orphanAdmins.length} admin users without company:`);
        orphanAdmins.forEach(admin => {
          logger.error(`     • ${admin.email} (ID: ${admin._id})`);
        });
      }
      
      await mongoose.disconnect();
      process.exit(1);
    }

    if (count === 1) {
      logger.success('✅ HEALTHY: Exactly 1 Platform Admin company exists\n');
      
      const platformAdmin = platformAdminCompanies[0];
      logger.info('Platform Admin Details:');
      logger.info(`  • ID: ${platformAdmin._id}`);
      logger.info(`  • Name: ${platformAdmin.companyName || platformAdmin.businessName}`);
      logger.info(`  • Status: ${platformAdmin.accountStatus?.status || 'unknown'}`);
      logger.info(`  • Created: ${platformAdmin.createdAt}`);
      logger.info(`  • Is Platform Admin: ${platformAdmin.metadata?.isPlatformAdmin || false}`);
      logger.info('');
      
      // Check users assigned
      const assignedUsers = await User.find({ companyId: platformAdmin._id });
      logger.info(`Users Assigned: ${assignedUsers.length}`);
      if (assignedUsers.length > 0) {
        assignedUsers.forEach(user => {
          logger.info(`  • ${user.email} (${user.role})`);
        });
      }
      logger.info('');
      
      // Check for orphaned admins
      const orphanAdmins = await User.find({ 
        role: 'admin',
        $or: [
          { companyId: { $exists: false } },
          { companyId: null }
        ]
      });
      
      if (orphanAdmins.length > 0) {
        logger.warning(`⚠️  WARNING: ${orphanAdmins.length} admin users without company:`);
        orphanAdmins.forEach(admin => {
          logger.warning(`     • ${admin.email} (ID: ${admin._id})`);
        });
        logger.warning('     These users will be auto-fixed on next login.\n');
      }
      
      // Check indexes
      const indexes = await Company.collection.getIndexes();
      const hasUniqueIndex = Object.keys(indexes).some(
        name => name.includes('metadata.isPlatformAdmin') || name.includes('unique_platform_admin')
      );
      
      if (hasUniqueIndex) {
        logger.success('✅ Database Protection: Unique index is active');
      } else {
        logger.warning('⚠️  Database Protection: No unique index found');
        logger.warning('   Recommendation: Run add-platform-admin-unique-index.js');
      }
      logger.info('');
      
      console.log('========================================');
      logger.success('🎉 ALL CHECKS PASSED!');
      console.log('========================================\n');
      
      await mongoose.disconnect();
      process.exit(0);
    }

    // Multiple Platform Admins found
    logger.critical(`CRITICAL: MULTIPLICITY DETECTED - ${count} Platform Admin companies found!\n`);
    logger.error('   Expected: 1');
    logger.error(`   Found: ${count}\n`);
    
    logger.error('Platform Admin Companies:');
    platformAdminCompanies.forEach((company, index) => {
      logger.error(`\n  ${index + 1}. ID: ${company._id}`);
      logger.error(`     Name: ${company.companyName || company.businessName}`);
      logger.error(`     Created: ${company.createdAt}`);
      logger.error(`     Status: ${company.accountStatus?.status || 'unknown'}`);
      
      // Count users on this duplicate
      User.countDocuments({ companyId: company._id }).then(userCount => {
        logger.error(`     Users: ${userCount}`);
      });
    });
    
    logger.error('\n========================================');
    logger.critical('🚨 ACTION REQUIRED: Run Deduplication Script');
    logger.error('========================================\n');
    logger.error('Fix this issue by running:');
    logger.error('  node scripts/deduplicate-platform-admin.js\n');
    
    await mongoose.disconnect();
    process.exit(1);
    
  } catch (error) {
    logger.error('Health check failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the health check
checkPlatformAdminHealth();


