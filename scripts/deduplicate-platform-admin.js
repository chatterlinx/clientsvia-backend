/**
 * PLATFORM ADMIN DEDUPLICATION SCRIPT
 * 
 * Purpose: Fixes multiplicity bug where multiple "Platform Admin" companies were created
 * 
 * What it does:
 * 1. Finds all Platform Admin companies
 * 2. Keeps the oldest/first one (canonical)
 * 3. Reassigns all users from duplicates to canonical
 * 4. Deletes duplicate Platform Admin companies
 * 
 * Run: node scripts/deduplicate-platform-admin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const User = require('../models/User');

const logger = {
  info: (...args) => console.log('ℹ️ ', ...args),
  success: (...args) => console.log('✅', ...args),
  warning: (...args) => console.log('⚠️ ', ...args),
  error: (...args) => console.error('❌', ...args),
  debug: (...args) => console.log('🔍', ...args)
};

async function deduplicatePlatformAdmin() {
  try {
    logger.info('========================================');
    logger.info('PLATFORM ADMIN DEDUPLICATION');
    logger.info('========================================\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    logger.success('Connected to MongoDB\n');

    // 1. Find ALL Platform Admin companies
    const platformAdminCompanies = await Company.find({
      $or: [
        { companyName: 'Platform Admin' },
        { businessName: 'Platform Admin' },
        { 'metadata.isPlatformAdmin': true }
      ]
    }).sort({ createdAt: 1 }); // Oldest first

    logger.info(`Found ${platformAdminCompanies.length} Platform Admin companies:\n`);
    
    platformAdminCompanies.forEach((company, index) => {
      logger.debug(`  ${index + 1}. ID: ${company._id}`);
      logger.debug(`     Name: ${company.companyName || company.businessName}`);
      logger.debug(`     Created: ${company.createdAt}`);
      logger.debug(`     Status: ${company.accountStatus?.status || 'unknown'}\n`);
    });

    // 2. If only one exists, no problem!
    if (platformAdminCompanies.length === 0) {
      logger.warning('No Platform Admin companies found! Creating one...\n');
      
      const newPlatformAdmin = await Company.create({
        companyName: 'Platform Admin',
        businessName: 'Platform Admin',
        email: 'admin@clientsvia.com',
        status: 'active',
        accountStatus: {
          status: 'active',
          lastChanged: new Date()
        },
        metadata: {
          isPlatformAdmin: true,
          purpose: 'Default company for platform administrators',
          createdBy: 'deduplicate-script',
          setupAt: new Date()
        }
      });
      
      logger.success(`Created Platform Admin company: ${newPlatformAdmin._id}\n`);
      
      // Check for admin users without companyId
      const orphanAdmins = await User.find({ 
        role: 'admin',
        $or: [
          { companyId: { $exists: false } },
          { companyId: null }
        ]
      });
      
      if (orphanAdmins.length > 0) {
        logger.info(`Found ${orphanAdmins.length} admin users without companyId, assigning them...\n`);
        
        for (const admin of orphanAdmins) {
          admin.companyId = newPlatformAdmin._id;
          await admin.save();
          logger.success(`  ✓ Assigned ${admin.email} to Platform Admin`);
        }
      }
      
      logger.success('\n✅ DEDUPLICATION COMPLETE!\n');
      await mongoose.disconnect();
      return;
    }

    if (platformAdminCompanies.length === 1) {
      logger.success('Only one Platform Admin company exists - no deduplication needed!\n');
      logger.info(`Canonical Platform Admin: ${platformAdminCompanies[0]._id}\n`);
      
      // Still check for orphan admins
      const orphanAdmins = await User.find({ 
        role: 'admin',
        $or: [
          { companyId: { $exists: false } },
          { companyId: null }
        ]
      });
      
      if (orphanAdmins.length > 0) {
        logger.info(`Found ${orphanAdmins.length} admin users without companyId, assigning them...\n`);
        
        for (const admin of orphanAdmins) {
          admin.companyId = platformAdminCompanies[0]._id;
          await admin.save();
          logger.success(`  ✓ Assigned ${admin.email} to Platform Admin`);
        }
      }
      
      logger.success('✅ CLEANUP COMPLETE!\n');
      await mongoose.disconnect();
      return;
    }

    // 3. Multiple Platform Admins found - DEDUPLICATE!
    logger.warning(`⚠️  MULTIPLICITY DETECTED: ${platformAdminCompanies.length} Platform Admin companies!\n`);
    
    const canonicalPlatformAdmin = platformAdminCompanies[0]; // Keep the oldest
    const duplicates = platformAdminCompanies.slice(1); // Delete the rest
    
    logger.success(`📌 CANONICAL Platform Admin: ${canonicalPlatformAdmin._id}`);
    logger.success(`   Created: ${canonicalPlatformAdmin.createdAt}\n`);
    
    logger.warning(`🗑️  DUPLICATES to be deleted (${duplicates.length}):`);
    duplicates.forEach((dup, index) => {
      logger.warning(`   ${index + 1}. ${dup._id} (Created: ${dup.createdAt})`);
    });
    logger.warning('');

    // 4. Reassign all users from duplicates to canonical
    let totalUsersReassigned = 0;
    
    for (const duplicate of duplicates) {
      const usersOnDuplicate = await User.find({ companyId: duplicate._id });
      
      if (usersOnDuplicate.length > 0) {
        logger.info(`Found ${usersOnDuplicate.length} users on duplicate ${duplicate._id}:`);
        
        for (const user of usersOnDuplicate) {
          logger.info(`  • Reassigning ${user.email} (${user.role}) → Canonical Platform Admin`);
          user.companyId = canonicalPlatformAdmin._id;
          await user.save();
          totalUsersReassigned++;
        }
        logger.success(`  ✓ Reassigned ${usersOnDuplicate.length} users\n`);
      } else {
        logger.debug(`No users found on duplicate ${duplicate._id}\n`);
      }
    }

    // 5. Delete duplicate Platform Admin companies
    logger.info('Deleting duplicate Platform Admin companies...\n');
    
    for (const duplicate of duplicates) {
      await Company.findByIdAndDelete(duplicate._id);
      logger.success(`  ✓ Deleted duplicate: ${duplicate._id}`);
    }

    // 6. Summary
    logger.info('\n========================================');
    logger.success('✅ DEDUPLICATION COMPLETE!');
    logger.info('========================================\n');
    logger.info(`📊 Summary:`);
    logger.info(`   • Platform Admin companies found: ${platformAdminCompanies.length}`);
    logger.info(`   • Canonical Platform Admin: ${canonicalPlatformAdmin._id}`);
    logger.info(`   • Duplicates deleted: ${duplicates.length}`);
    logger.info(`   • Users reassigned: ${totalUsersReassigned}`);
    logger.info('');

    // 7. Verify final state
    const remainingPlatformAdmins = await Company.find({
      $or: [
        { companyName: 'Platform Admin' },
        { businessName: 'Platform Admin' },
        { 'metadata.isPlatformAdmin': true }
      ]
    });
    
    const usersOnPlatformAdmin = await User.find({ companyId: canonicalPlatformAdmin._id });
    
    logger.success(`✅ Final State:`);
    logger.success(`   • Platform Admin companies: ${remainingPlatformAdmins.length} (should be 1)`);
    logger.success(`   • Users assigned to Platform Admin: ${usersOnPlatformAdmin.length}`);
    logger.info('');
    
    if (usersOnPlatformAdmin.length > 0) {
      logger.info(`   Users on Platform Admin:`);
      usersOnPlatformAdmin.forEach(user => {
        logger.info(`     • ${user.email} (${user.role})`);
      });
      logger.info('');
    }

    await mongoose.disconnect();
    logger.success('🎉 Platform Admin deduplication complete! Your directory should now show only 1 Platform Admin.\n');
    
  } catch (error) {
    logger.error('Deduplication failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the deduplication
deduplicatePlatformAdmin();

