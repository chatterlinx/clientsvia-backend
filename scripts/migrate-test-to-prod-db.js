#!/usr/bin/env node
/**
 * ONE-TIME MIGRATION: Copy data from "test" DB to production DB
 * 
 * This fixes the database name mismatch issue where data was accidentally
 * stored in "test" database instead of the intended production database.
 * 
 * Usage on Render:
 * node scripts/migrate-test-to-prod-db.js
 */

const { MongoClient } = require('mongodb');

const COLLECTIONS_TO_MIGRATE = [
  'companyLocalTriggers',
  'companytriggersettings',
  'companiesCollection',
  // Add any other collections that need migration
];

const SOURCE_DB = 'test';
const TARGET_DB = 'clientsvia'; // Production database name

async function migrate() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_CONNECTION_STRING;
  
  if (!uri) {
    console.error('❌ No MongoDB URI found in environment');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔄 DATABASE MIGRATION: test → clientsvia');
  console.log('═══════════════════════════════════════════════════════════\n');

  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const sourceDb = client.db(SOURCE_DB);
    const targetDb = client.db(TARGET_DB);

    for (const collectionName of COLLECTIONS_TO_MIGRATE) {
      console.log(`─────────────────────────────────────────────────────────`);
      console.log(`Migrating: ${collectionName}`);
      console.log(`─────────────────────────────────────────────────────────`);

      // Check if source collection exists and has data
      const sourceCount = await sourceDb.collection(collectionName).countDocuments({});
      console.log(`Source (test): ${sourceCount} documents`);

      if (sourceCount === 0) {
        console.log(`⏭️  Skipped - no data in source\n`);
        continue;
      }

      // Check target collection
      const targetCount = await targetDb.collection(collectionName).countDocuments({});
      console.log(`Target (clientsvia): ${targetCount} documents (before migration)`);

      // Copy all documents
      const docs = await sourceDb.collection(collectionName).find({}).toArray();
      
      if (docs.length > 0) {
        // Use insertMany with ordered:false to continue on duplicate key errors
        try {
          const result = await targetDb.collection(collectionName).insertMany(docs, { ordered: false });
          console.log(`✅ Inserted: ${result.insertedCount} documents`);
        } catch (error) {
          // Handle duplicate key errors gracefully
          if (error.code === 11000) {
            const insertedCount = error.result?.insertedCount || 0;
            console.log(`⚠️  Inserted: ${insertedCount} documents (some duplicates skipped)`);
          } else {
            throw error;
          }
        }
      }

      const finalCount = await targetDb.collection(collectionName).countDocuments({});
      console.log(`Target (clientsvia): ${finalCount} documents (after migration)`);
      console.log(`✅ Migration complete for ${collectionName}\n`);
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ MIGRATION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('Next steps:');
    console.log('1. Verify data in production DB');
    console.log('2. Make a test call to verify triggers load');
    console.log('3. Once confirmed working, you can drop the "test" database\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB\n');
  }
}

migrate();
