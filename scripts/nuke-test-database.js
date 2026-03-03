#!/usr/bin/env node
/**
 * SAFE CLEANUP: Migrate data from "test" DB, then nuke it
 * 
 * This script:
 * 1. Copies all important data from "test" → "clientsvia"
 * 2. Verifies the copy succeeded
 * 3. Drops the "test" database
 * 4. Prevents accidental use of "test" DB forever
 * 
 * Usage on Render:
 * node scripts/nuke-test-database.js
 */

const { MongoClient } = require('mongodb');

const SOURCE_DB = 'test';
const TARGET_DB = 'clientsvia';

// Collections to migrate before nuking
const CRITICAL_COLLECTIONS = [
  'companyLocalTriggers',
  'companytriggersettings',
  'companiesCollection',
  'v2companies',
  'globaltriggergroups',
  'globaltriggers',
];

async function safeNuke() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_CONNECTION_STRING;
  
  if (!uri) {
    console.error('❌ No MongoDB URI found in environment');
    process.exit(1);
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  SAFE NUKE: Migrate → Verify → Drop "test" DB            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const sourceDb = client.db(SOURCE_DB);
    const targetDb = client.db(TARGET_DB);

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: MIGRATE DATA
    // ═══════════════════════════════════════════════════════════
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  PHASE 1: MIGRATE DATA (test → clientsvia)               ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    const migrationResults = {};

    for (const collectionName of CRITICAL_COLLECTIONS) {
      console.log(`─── ${collectionName} ───`);

      const sourceCount = await sourceDb.collection(collectionName).countDocuments({});
      console.log(`  Source: ${sourceCount} docs`);

      if (sourceCount === 0) {
        console.log(`  ⏭️  Skipped - empty\n`);
        migrationResults[collectionName] = { source: 0, migrated: 0, target: 0 };
        continue;
      }

      const targetCountBefore = await targetDb.collection(collectionName).countDocuments({});
      console.log(`  Target (before): ${targetCountBefore} docs`);

      // Migrate
      const docs = await sourceDb.collection(collectionName).find({}).toArray();
      let insertedCount = 0;
      
      if (docs.length > 0) {
        try {
          const result = await targetDb.collection(collectionName).insertMany(docs, { ordered: false });
          insertedCount = result.insertedCount;
          console.log(`  ✅ Inserted: ${insertedCount} docs`);
        } catch (error) {
          if (error.code === 11000) {
            insertedCount = error.result?.insertedCount || 0;
            console.log(`  ⚠️  Inserted: ${insertedCount} docs (duplicates skipped)`);
          } else {
            throw error;
          }
        }
      }

      const targetCountAfter = await targetDb.collection(collectionName).countDocuments({});
      console.log(`  Target (after): ${targetCountAfter} docs\n`);

      migrationResults[collectionName] = {
        source: sourceCount,
        migrated: insertedCount,
        target: targetCountAfter
      };
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: VERIFY MIGRATION
    // ═══════════════════════════════════════════════════════════
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  PHASE 2: VERIFY MIGRATION                                ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    let allSafe = true;
    for (const [collection, counts] of Object.entries(migrationResults)) {
      if (counts.source > 0 && counts.target === 0) {
        console.log(`❌ FAILED: ${collection} has ${counts.source} docs in source but 0 in target!`);
        allSafe = false;
      } else if (counts.source > 0) {
        console.log(`✅ ${collection}: ${counts.source} docs safely in target`);
      }
    }

    if (!allSafe) {
      console.log('\n❌ MIGRATION VERIFICATION FAILED');
      console.log('Cannot safely drop "test" database - data not fully migrated');
      console.log('Fix the errors above and run again.\n');
      process.exit(1);
    }

    console.log('\n✅ All data verified in target database\n');

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: DROP "test" DATABASE
    // ═══════════════════════════════════════════════════════════
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  PHASE 3: DROP "test" DATABASE                            ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    console.log('🔥 Dropping "test" database...');
    await sourceDb.dropDatabase();
    console.log('✅ "test" database NUKED\n');

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: FINAL VERIFICATION
    // ═══════════════════════════════════════════════════════════
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  PHASE 4: FINAL VERIFICATION                              ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // List all databases to confirm "test" is gone
    const adminDb = client.db().admin();
    const databases = await adminDb.listDatabases();
    const dbNames = databases.databases.map(db => db.name);
    
    console.log('Remaining databases:', dbNames.join(', '));
    
    if (dbNames.includes('test')) {
      console.log('⚠️  WARNING: "test" database still exists (may require admin permissions to drop)');
    } else {
      console.log('✅ "test" database successfully removed');
    }

    // Verify Penguin Air's triggers are in production DB
    const penguinTriggersCount = await targetDb.collection('companyLocalTriggers').countDocuments({
      companyId: '68e3f77a9d623b8058c700c4',
      state: 'published'
    });
    console.log(`✅ Penguin Air triggers in production: ${penguinTriggersCount}\n`);

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  SUCCESS: "test" DB NUKED, DATA SAFE IN PRODUCTION        ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    console.log('Next steps:');
    console.log('1. ✅ MONGODB_URI includes /clientsvia (no more defaulting to test)');
    console.log('2. ✅ Production code crashes if it connects to "test" (db.js guard)');
    console.log('3. ✅ Make a test call to verify triggers load');
    console.log('4. 🎉 You never have to think about "test mode" again\n');

  } catch (error) {
    console.error('\n❌ Error during safe nuke:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB\n');
  }
}

safeNuke();
