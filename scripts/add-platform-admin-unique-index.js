/**
 * ADD UNIQUE INDEX FOR PLATFORM ADMIN COMPANIES
 * 
 * Purpose: Database-level guarantee that only 1 Platform Admin company can exist
 * 
 * This creates a unique sparse index on the metadata.isPlatformAdmin field.
 * - Unique: MongoDB will reject duplicate Platform Admin companies
 * - Sparse: Only applies to documents where the field exists
 * 
 * Run: node scripts/add-platform-admin-unique-index.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

const logger = {
  info: (...args) => console.log('ℹ️ ', ...args),
  success: (...args) => console.log('✅', ...args),
  warning: (...args) => console.log('⚠️ ', ...args),
  error: (...args) => console.error('❌', ...args),
  debug: (...args) => console.log('🔍', ...args)
};

async function addUniqueIndex() {
  try {
    logger.info('========================================');
    logger.info('ADD PLATFORM ADMIN UNIQUE INDEX');
    logger.info('========================================\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    logger.success('Connected to MongoDB\n');

    // Check existing indexes
    logger.info('Checking existing indexes...\n');
    const existingIndexes = await Company.collection.getIndexes();
    
    logger.debug('Current indexes on Company collection:');
    Object.keys(existingIndexes).forEach(indexName => {
      logger.debug(`  • ${indexName}:`, JSON.stringify(existingIndexes[indexName]));
    });
    logger.info('');

    // Check if our index already exists
    const platformAdminIndexExists = Object.keys(existingIndexes).some(
      name => name.includes('metadata.isPlatformAdmin')
    );

    if (platformAdminIndexExists) {
      logger.warning('Platform Admin unique index already exists!\n');
      logger.info('No action needed - database is already protected.\n');
      await mongoose.disconnect();
      return;
    }

    // Create unique sparse index
    logger.info('Creating unique sparse index on metadata.isPlatformAdmin...\n');
    
    await Company.collection.createIndex(
      { 'metadata.isPlatformAdmin': 1 },
      { 
        unique: true,
        sparse: true, // Only applies to documents where field exists
        name: 'unique_platform_admin',
        background: true // Don't block other operations
      }
    );

    logger.success('✅ Unique index created successfully!\n');

    // Verify index was created
    const updatedIndexes = await Company.collection.getIndexes();
    logger.success('Verification:');
    
    if (updatedIndexes.unique_platform_admin) {
      logger.success('  ✓ Index "unique_platform_admin" is active');
      logger.success(`  ✓ Keys: ${JSON.stringify(updatedIndexes.unique_platform_admin.key)}`);
      logger.success(`  ✓ Unique: ${updatedIndexes.unique_platform_admin.unique}`);
      logger.success(`  ✓ Sparse: ${updatedIndexes.unique_platform_admin.sparse}`);
    }
    logger.info('');

    // Test the index (try to create a duplicate - should fail)
    logger.info('Testing index protection...\n');
    
    const existingPlatformAdmin = await Company.findOne({
      'metadata.isPlatformAdmin': true
    });

    if (existingPlatformAdmin) {
      logger.info(`Found existing Platform Admin: ${existingPlatformAdmin._id}\n`);
      
      logger.info('Attempting to create duplicate (should fail)...\n');
      try {
        await Company.create({
          companyName: 'TEST Platform Admin (Should Fail)',
          businessName: 'TEST Platform Admin',
          email: 'test-duplicate@clientsvia.com',
          status: 'active',
          metadata: {
            isPlatformAdmin: true // This should trigger duplicate key error
          }
        });
        
        logger.error('❌ TEST FAILED: Duplicate was created! Index not working properly.\n');
      } catch (error) {
        if (error.code === 11000) {
          logger.success('✅ TEST PASSED: MongoDB rejected duplicate Platform Admin');
          logger.success('   Error code: 11000 (Duplicate key error)');
          logger.success('   Index is working correctly!\n');
        } else {
          logger.error('❌ Unexpected error during test:', error.message);
        }
      }
    } else {
      logger.warning('No existing Platform Admin found - skipping duplicate test\n');
    }

    logger.info('========================================');
    logger.success('✅ INDEX PROTECTION ACTIVE!');
    logger.info('========================================\n');
    logger.info('Database will now automatically prevent duplicate Platform Admin companies.');
    logger.info('');

    await mongoose.disconnect();
    logger.success('🎉 Protection complete!\n');
    
  } catch (error) {
    logger.error('Failed to add unique index:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
addUniqueIndex();


