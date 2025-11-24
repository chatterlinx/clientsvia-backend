// scripts/migrateCheatSheetV1toV2.js
//
// PURPOSE:
//  - Migrate legacy V1 cheat sheet config from company.aiAgentSettings.cheatSheet
//    into CheatSheetVersion collection (V2).
//  - Create a live version per company if one does not exist.
//  - Backup legacy config into company.aiAgentSettings.cheatSheet_backup
//  - Set company.aiAgentSettings.cheatSheetMeta.liveVersionId
//  - Idempotent: safe to run multiple times.
//  - Supports DRY-RUN mode.
//
// USAGE:
//  DRY RUN:
//    NODE_ENV=production node scripts/migrateCheatSheetV1toV2.js --dry-run
//
//  REAL RUN:
//    NODE_ENV=production node scripts/migrateCheatSheetV1toV2.js
//

const mongoose = require('mongoose');

// Adapted paths for ClientsVia backend structure
const Company = require('../models/v2Company');
const CheatSheetVersion = require('../models/cheatsheet/CheatSheetVersion');
const logger = require('../utils/logger');

// Use existing db.js connection
require('../db');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  V1 → V2 CHEATSHEET MIGRATION SCRIPT');
  console.log('  DRY_RUN:', DRY_RUN);
  console.log('═══════════════════════════════════════════════');

  // Wait for DB connection (db.js handles connection)
  if (mongoose.connection.readyState === 0) {
    console.log('⏳ Waiting for database connection...');
    await new Promise((resolve) => {
      mongoose.connection.once('connected', resolve);
    });
  }
  
  console.log('✅ Database connected:', mongoose.connection.name);

  const stats = {
    totalCompanies: 0,
    withLegacy: 0,
    migratedNewLive: 0,
    usedExistingLive: 0,
    updatedMetaOnly: 0,
    skippedNoLegacy: 0,
    errors: 0
  };

  // Find all companies (we will filter in code)
  const companies = await Company.find({}).lean(false); // lean(false) = full mongoose docs
  stats.totalCompanies = companies.length;

  console.log(`🔍 Found ${companies.length} companies to inspect`);

  for (const company of companies) {
    try {
      const companyId = company._id.toString();
      const name = company.name || company.companyName || '(unknown)';
      const aiSettings = company.aiAgentSettings || {};

      const legacy = aiSettings.cheatSheet;
      if (!legacy) {
        stats.skippedNoLegacy++;
        continue;
      }

      stats.withLegacy++;
      console.log(`\n🏢 Company ${name} (${companyId}) has legacy cheatSheet`);

      // 1) BACKUP LEGACY IF NOT YET BACKED UP
      if (!aiSettings.cheatSheet_backup) {
        console.log('  📦 Creating backup aiAgentSettings.cheatSheet_backup');
        if (!DRY_RUN) {
          company.aiAgentSettings.cheatSheet_backup = {
            data: legacy,
            backedUpAt: new Date()
          };
        }
      } else {
        console.log('  📦 Backup already exists, skipping backup step');
      }

      // 2) FIND EXISTING LIVE V2 VERSION (if any)
      let liveVersionDoc = await CheatSheetVersion.findOne({
        companyId: company._id,
        status: 'live'
      }).sort({ activatedAt: -1 });

      if (liveVersionDoc) {
        console.log(
          `  ✅ Existing live V2 version found: ${liveVersionDoc._id.toString()} (${liveVersionDoc.name})`
        );
        stats.usedExistingLive++;
      } else {
        // 3) CREATE NEW LIVE VERSION FROM LEGACY
        console.log('  🆕 No live V2 version found, creating Imported Legacy Config');

        const config = {
          schemaVersion: 1,
          triage: legacy.triage || {},
          frontlineIntel: legacy.frontlineIntel || [],
          transferRules: legacy.transferRules || [],
          edgeCases: legacy.edgeCases || [],
          behavior: legacy.behavior || {},
          guardrails: legacy.guardrails || [],
          bookingRules: legacy.bookingRules || [],
          companyContacts: legacy.companyContacts || [],
          links: legacy.links || [],
          calculators: legacy.calculators || []
        };

        const now = new Date();
        const versionId = `live-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        liveVersionDoc = new CheatSheetVersion({
          companyId: company._id,
          versionId,
          name: 'Imported Legacy Config',
          notes: 'Auto-migrated from aiAgentSettings.cheatSheet by V1→V2 migration script',
          config,
          status: 'live',
          createdAt: now,
          updatedAt: now,
          activatedAt: now,
          createdBy: 'system:migration'
        });

        if (!DRY_RUN) {
          await liveVersionDoc.save();
          
          logger.info('CHEATSHEET_MIGRATION_CREATED_LIVE', {
            companyId,
            versionId,
            name: company.name
          });
        }

        console.log(
          `  ✅ Created new live V2 version: ${liveVersionDoc._id.toString()}`
        );
        stats.migratedNewLive++;
      }

      // 4) UPDATE liveVersionId POINTER IN COMPANY META
      const meta = company.aiAgentSettings.cheatSheetMeta || {};
      const liveId = liveVersionDoc._id;

      if (!meta.liveVersionId || meta.liveVersionId.toString() !== liveId.toString()) {
        console.log(
          `  🔗 Updating company.aiAgentSettings.cheatSheetMeta.liveVersionId → ${liveId.toString()}`
        );

        if (!DRY_RUN) {
          company.aiAgentSettings.cheatSheetMeta = {
            ...(company.aiAgentSettings.cheatSheetMeta || {}),
            liveVersionId: liveId,
            lastMigratedAt: new Date(),
            lastMigratedBy: 'system:migration'
          };
          
          // Mark parent as modified to ensure save
          company.markModified('aiAgentSettings');
          await company.save();
          
          logger.info('CHEATSHEET_MIGRATION_UPDATED_META', {
            companyId,
            liveVersionId: liveId.toString()
          });
        }

        stats.updatedMetaOnly++;
      } else {
        console.log('  🔗 liveVersionId already correctly set, no change needed');
      }
    } catch (err) {
      stats.errors++;
      console.error('  ❌ Error processing company', company._id, err.message);
      logger.error('CHEATSHEET_MIGRATION_ERROR', {
        companyId: company._id,
        error: err.message,
        stack: err.stack
      });
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  🧾 MIGRATION SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log('  Total companies          :', stats.totalCompanies);
  console.log('  With legacy cheatSheet   :', stats.withLegacy);
  console.log('  Migrated new live V2     :', stats.migratedNewLive);
  console.log('  Used existing live V2    :', stats.usedExistingLive);
  console.log('  Updated liveVersionId    :', stats.updatedMetaOnly);
  console.log('  Skipped (no legacy)      :', stats.skippedNoLegacy);
  console.log('  Errors                   :', stats.errors);
  console.log('  DRY_RUN                  :', DRY_RUN);
  console.log('═══════════════════════════════════════════════');
  
  if (!DRY_RUN) {
    logger.info('CHEATSHEET_MIGRATION_COMPLETE', stats);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Fatal migration error', err);
  logger.error('CHEATSHEET_MIGRATION_FATAL', {
    error: err.message,
    stack: err.stack
  });
  process.exit(1);
});

