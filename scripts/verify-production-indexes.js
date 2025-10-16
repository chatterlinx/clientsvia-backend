#!/usr/bin/env node

// ============================================================================
// DATABASE INDEX VERIFICATION SCRIPT - PRODUCTION READINESS
// ============================================================================
// Purpose: Verify all critical MongoDB indexes are in place
// Usage: node scripts/verify-production-indexes.js
// ============================================================================

require('dotenv').config();
const mongoose = require('mongoose');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// ============================================================================
// REQUIRED INDEXES FOR PRODUCTION
// ============================================================================

const REQUIRED_INDEXES = {
  companiesCollection: [
    { name: '_id_', keys: { _id: 1 }, unique: true },
    { name: 'twilioConfig.phoneNumber_1', keys: { 'twilioConfig.phoneNumber': 1 } },
    { name: 'accountStatus.status_1', keys: { 'accountStatus.status': 1 } },
    { name: 'tradeCategories_1', keys: { tradeCategories: 1 } },
    { name: 'isDeleted_1_createdAt_-1', keys: { isDeleted: 1, createdAt: -1 } }
  ],
  
  v2users: [
    { name: '_id_', keys: { _id: 1 }, unique: true },
    { name: 'email_1', keys: { email: 1 }, unique: true },
    { name: 'companyId_1', keys: { companyId: 1 } },
    { name: 'status_1', keys: { status: 1 } }
  ],
  
  companyqnacategories: [
    { name: '_id_', keys: { _id: 1 }, unique: true },
    { name: 'companyId_1_isActive_1', keys: { companyId: 1, isActive: 1 } },
    { name: 'companyId_1_name_1', keys: { companyId: 1, name: 1 } }
  ],
  
  v2aiagentcalllogs: [
    { name: '_id_', keys: { _id: 1 }, unique: true },
    { name: 'companyId_1_createdAt_-1', keys: { companyId: 1, createdAt: -1 } },
    { name: 'callSid_1', keys: { callSid: 1 } }
  ],
  
  v2tradecategories: [
    { name: '_id_', keys: { _id: 1 }, unique: true },
    { name: 'v2_company_name_unique', keys: { companyId: 1, name: 1 }, unique: true },
    { name: 'companyId_1', keys: { companyId: 1 } }
  ],
  
  globalinstantresponsetemplates: [
    { name: '_id_', keys: { _id: 1 }, unique: true },
    { name: 'name_1', keys: { name: 1 }, unique: true },
    { name: 'isPublished_1', keys: { isPublished: 1 } }
  ]
};

// ============================================================================
// INDEX VERIFICATION FUNCTIONS
// ============================================================================

/**
 * Connect to MongoDB
 */
async function connectDatabase() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  
  if (!mongoUri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }
  
  console.log(`${colors.cyan}Connecting to MongoDB...${colors.reset}`);
  await mongoose.connect(mongoUri);
  console.log(`${colors.green}✅ Connected to MongoDB${colors.reset}\n`);
}

/**
 * Get existing indexes for a collection
 */
async function getExistingIndexes(collectionName) {
  try {
    const collection = mongoose.connection.db.collection(collectionName);
    const indexes = await collection.indexes();
    return indexes;
  } catch (error) {
    console.error(`${colors.red}Error getting indexes for ${collectionName}:${colors.reset}`, error.message);
    return [];
  }
}

/**
 * Check if an index exists
 */
function indexExists(existingIndexes, requiredIndex) {
  return existingIndexes.some(existing => {
    // Compare index keys
    const existingKeys = JSON.stringify(existing.key);
    const requiredKeys = JSON.stringify(requiredIndex.keys);
    return existingKeys === requiredKeys;
  });
}

/**
 * Create missing index
 */
async function createIndex(collectionName, indexSpec) {
  try {
    const collection = mongoose.connection.db.collection(collectionName);
    const options = { name: indexSpec.name };
    
    if (indexSpec.unique) {
      options.unique = true;
    }
    
    await collection.createIndex(indexSpec.keys, options);
    return true;
  } catch (error) {
    console.error(`${colors.red}Error creating index:${colors.reset}`, error.message);
    return false;
  }
}

/**
 * Verify and fix indexes for all collections
 */
async function verifyAndFixIndexes() {
  let totalChecked = 0;
  let totalMissing = 0;
  let totalCreated = 0;
  let totalErrors = 0;
  
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.blue}DATABASE INDEX VERIFICATION${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}\n`);
  
  for (const [collectionName, requiredIndexes] of Object.entries(REQUIRED_INDEXES)) {
    console.log(`${colors.cyan}Checking collection: ${collectionName}${colors.reset}`);
    
    // Get existing indexes
    const existingIndexes = await getExistingIndexes(collectionName);
    
    if (existingIndexes.length === 0) {
      console.log(`  ${colors.yellow}⚠️  Collection does not exist or has no indexes${colors.reset}`);
      continue;
    }
    
    console.log(`  Found ${existingIndexes.length} existing indexes`);
    
    // Check each required index
    for (const requiredIndex of requiredIndexes) {
      totalChecked++;
      
      if (indexExists(existingIndexes, requiredIndex)) {
        console.log(`  ${colors.green}✅ ${requiredIndex.name}${colors.reset}`);
      } else {
        totalMissing++;
        console.log(`  ${colors.red}❌ ${requiredIndex.name} (MISSING)${colors.reset}`);
        
        // Attempt to create the missing index
        console.log(`  ${colors.yellow}   Creating index...${colors.reset}`);
        const created = await createIndex(collectionName, requiredIndex);
        
        if (created) {
          totalCreated++;
          console.log(`  ${colors.green}   ✅ Index created successfully${colors.reset}`);
        } else {
          totalErrors++;
          console.log(`  ${colors.red}   ❌ Failed to create index${colors.reset}`);
        }
      }
    }
    
    console.log(); // Blank line between collections
  }
  
  // ============================================================================
  // SUMMARY REPORT
  // ============================================================================
  
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.blue}VERIFICATION SUMMARY${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}`);
  console.log(`Total indexes checked:   ${totalChecked}`);
  console.log(`${colors.green}Existing indexes:        ${totalChecked - totalMissing}${colors.reset}`);
  console.log(`${colors.yellow}Missing indexes:         ${totalMissing}${colors.reset}`);
  console.log(`${colors.green}Indexes created:         ${totalCreated}${colors.reset}`);
  console.log(`${colors.red}Errors:                  ${totalErrors}${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}\n`);
  
  if (totalMissing === 0) {
    console.log(`${colors.green}🎉 All required indexes are in place!${colors.reset}`);
    console.log(`${colors.green}✅ Database is production-ready${colors.reset}\n`);
    return true;
  } else if (totalCreated === totalMissing) {
    console.log(`${colors.green}✅ All missing indexes have been created${colors.reset}`);
    console.log(`${colors.green}🎉 Database is now production-ready${colors.reset}\n`);
    return true;
  } else {
    console.log(`${colors.red}⚠️  Some indexes could not be created${colors.reset}`);
    console.log(`${colors.yellow}Please review the errors above and create indexes manually${colors.reset}\n`);
    return false;
  }
}

/**
 * List all indexes in the database (for debugging)
 */
async function listAllIndexes() {
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.blue}ALL DATABASE INDEXES${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}\n`);
  
  const collections = await mongoose.connection.db.listCollections().toArray();
  
  for (const collectionInfo of collections) {
    const collectionName = collectionInfo.name;
    console.log(`${colors.cyan}${collectionName}:${colors.reset}`);
    
    const indexes = await getExistingIndexes(collectionName);
    indexes.forEach(index => {
      const unique = index.unique ? ' (UNIQUE)' : '';
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)}${unique}`);
    });
    
    console.log();
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const listAll = args.includes('--list-all');
    
    // Connect to database
    await connectDatabase();
    
    if (listAll) {
      // List all indexes in the database
      await listAllIndexes();
    } else {
      // Verify and fix required indexes
      const success = await verifyAndFixIndexes();
      
      if (!success) {
        process.exit(1);
      }
    }
    
    // Close database connection
    await mongoose.connection.close();
    console.log(`${colors.cyan}Database connection closed${colors.reset}\n`);
    
    process.exit(0);
    
  } catch (error) {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error.message);
    console.error(error.stack);
    
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  verifyAndFixIndexes,
  listAllIndexes
};

