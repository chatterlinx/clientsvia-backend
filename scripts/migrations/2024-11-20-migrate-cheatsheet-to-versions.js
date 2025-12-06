/**
 * ============================================================================
 * CHEATSHEET MIGRATION SCRIPT
 * ============================================================================
 * 
 * Migrates existing cheatSheet data from Company schema to CheatSheetVersion collection.
 * 
 * WHAT THIS DOES:
 * 1. Reads all companies with existing `aiAgentSettings.cheatSheet` data
 * 2. Creates CheatSheetVersion document for each (status='live')
 * 3. Updates Company.aiAgentSettings.cheatSheetMeta.liveVersionId
 * 4. Keeps old cheatSheet as backup (for safety)
 * 5. Generates detailed migration report
 * 
 * SAFETY FEATURES:
 * - Idempotent (safe to run multiple times)
 * - Dry-run mode (test without changes)
 * - Detailed logging per company
 * - Backup of old data
 * - Rollback instructions
 * - Results saved to JSON file
 * 
 * USAGE:
 *   # Dry run (test without changes)
 *   node scripts/migrations/2024-11-20-migrate-cheatsheet-to-versions.js --dry-run
 * 
 *   # Real migration
 *   node scripts/migrations/2024-11-20-migrate-cheatsheet-to-versions.js
 * 
 *   # Real migration with specific companies
 *   node scripts/migrations/2024-11-20-migrate-cheatsheet-to-versions.js --companyIds="id1,id2,id3"
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment
require('dotenv').config();

// Models
const Company = require('../../models/v2Company');
const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');
const CheatSheetAuditLog = require('../../models/cheatsheet/CheatSheetAuditLog');

// Logger
const logger = {
  info: (msg, data = {}) => console.log(`[INFO] ${msg}`, JSON.stringify(data, null, 2)),
  warn: (msg, data = {}) => console.warn(`[WARN] ${msg}`, JSON.stringify(data, null, 2)),
  error: (msg, data = {}) => console.error(`[ERROR] ${msg}`, JSON.stringify(data, null, 2)),
  success: (msg, data = {}) => console.log(`[SUCCESS] ✅ ${msg}`, JSON.stringify(data, null, 2))
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  dryRun: process.argv.includes('--dry-run'),
  companyIds: process.argv.find(arg => arg.startsWith('--companyIds'))?.split('=')[1]?.split(','),
  backupDir: path.join(__dirname, '../../logs/migrations'),
  resultFile: path.join(__dirname, `../../logs/migration-results-${Date.now()}.json`)
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate checksum for config
 */
function generateChecksum(config) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(config))
    .digest('hex')
    .substring(0, 16);
}

/**
 * Generate version ID
 */
function generateVersionId() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `version-migration-${timestamp}-${random}`;
}

/**
 * Validate config structure
 */
function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, reason: 'Config is not an object' };
  }
  
  // Check if config has any data
  const hasData = Object.keys(config).length > 0;
  if (!hasData) {
    return { valid: false, reason: 'Config is empty' };
  }
  
  // Check size
  const size = JSON.stringify(config).length;
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (size > maxSize) {
    return { valid: false, reason: `Config too large: ${(size / 1024 / 1024).toFixed(2)}MB` };
  }
  
  return { valid: true };
}

/**
 * Ensure config has required structure
 */
function normalizeConfig(config) {
  return {
    schemaVersion: config.schemaVersion || 1,
    triage: config.triage || {},
    frontlineIntel: config.frontlineIntel || {},
    transferRules: config.transferRules || {},
    edgeCases: config.edgeCases || {},
    behavior: config.behavior || {},
    guardrails: config.guardrails || {},
    bookingRules: config.bookingRules || [],
    companyContacts: config.companyContacts || [],
    links: config.links || [],
    calculators: config.calculators || []
  };
}

// ============================================================================
// MIGRATION LOGIC
// ============================================================================

/**
 * Migrate a single company
 */
async function migrateCompany(company, session = null) {
  const companyId = company._id.toString();
  const result = {
    companyId,
    status: 'pending',
    error: null,
    versionId: null,
    skipped: false,
    reason: null
  };
  
  try {
    // Check if already migrated
    const existingLiveVersionId = company.aiAgentSettings?.cheatSheetMeta?.liveVersionId;
    if (existingLiveVersionId) {
      // Verify it exists
      const existingVersion = await CheatSheetVersion.findOne({
        companyId: company._id,
        versionId: existingLiveVersionId,
        status: 'live'
      });
      
      if (existingVersion) {
        result.status = 'skipped';
        result.skipped = true;
        result.reason = 'Already migrated (liveVersionId exists and valid)';
        result.versionId = existingLiveVersionId;
        logger.info(`Company ${companyId} already migrated`, { versionId: existingLiveVersionId });
        return result;
      } else {
        logger.warn(`Company ${companyId} has liveVersionId but no version found - will re-migrate`, {
          liveVersionId: existingLiveVersionId
        });
      }
    }
    
    // Get old cheatSheet data
    const oldCheatSheet = company.aiAgentSettings?.cheatSheet;
    
    if (!oldCheatSheet) {
      result.status = 'skipped';
      result.skipped = true;
      result.reason = 'No cheatSheet data to migrate';
      logger.info(`Company ${companyId} has no cheatSheet data - skipped`);
      return result;
    }
    
    // Validate config
    const validation = validateConfig(oldCheatSheet);
    if (!validation.valid) {
      result.status = 'skipped';
      result.skipped = true;
      result.reason = validation.reason;
      logger.warn(`Company ${companyId} has invalid cheatSheet - skipped`, { reason: validation.reason });
      return result;
    }
    
    // Normalize config
    const config = normalizeConfig(oldCheatSheet);
    
    // Generate version ID
    const versionId = generateVersionId();
    result.versionId = versionId;
    
    if (CONFIG.dryRun) {
      result.status = 'dry-run-success';
      logger.info(`[DRY RUN] Would migrate company ${companyId}`, {
        versionId,
        configSize: JSON.stringify(config).length
      });
      return result;
    }
    
    // Create CheatSheetVersion document
    const version = await CheatSheetVersion.create(
      [{
        companyId: company._id,
        status: 'live',
        versionId,
        name: 'Migrated from Legacy Config',
        createdBy: 'System Migration',
        activatedAt: new Date(),
        config,
        checksum: generateChecksum(config)
      }],
      { session }
    );
    
    logger.info(`Created CheatSheetVersion for company ${companyId}`, { versionId });
    
    // Update Company pointer
    await Company.updateOne(
      { _id: company._id },
      {
        $set: {
          'aiAgentSettings.cheatSheetMeta.liveVersionId': versionId
        }
        // DON'T remove old cheatSheet yet - keep as backup
      },
      { session }
    );
    
    logger.info(`Updated Company pointer for ${companyId}`, { versionId });
    
    // Audit log
    await CheatSheetAuditLog.logAction({
      companyId: company._id,
      versionId,
      action: 'create_draft', // Using existing enum
      actor: 'System Migration',
      metadata: {
        migration: true,
        migratedAt: new Date().toISOString()
      },
      success: true
    });
    
    result.status = 'success';
    logger.success(`Company ${companyId} migrated successfully`, { versionId });
    
    return result;
    
  } catch (err) {
    result.status = 'failed';
    result.error = err.message;
    logger.error(`Company ${companyId} migration failed`, {
      error: err.message,
      stack: err.stack
    });
    return result;
  }
}

/**
 * Main migration function
 */
async function migrate() {
  logger.info('MIGRATION START', {
    dryRun: CONFIG.dryRun,
    companyIds: CONFIG.companyIds || 'ALL',
    timestamp: new Date().toISOString()
  });
  
  const results = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    companies: [],
    startTime: new Date(),
    endTime: null,
    duration: null
  };
  
  try {
    // Build query
    const query = {};
    if (CONFIG.companyIds) {
      query._id = { $in: CONFIG.companyIds.map(id => new mongoose.Types.ObjectId(id)) };
    }
    
    // Fetch companies
    const companies = await Company.find(query).lean();
    results.total = companies.length;
    
    logger.info(`Found ${companies.length} companies to process`);
    
    if (companies.length === 0) {
      logger.warn('No companies found matching criteria');
      return results;
    }
    
    // Process each company
    for (const company of companies) {
      const result = await migrateCompany(company);
      results.companies.push(result);
      
      if (result.status === 'success' || result.status === 'dry-run-success') {
        results.success++;
      } else if (result.status === 'failed') {
        results.failed++;
      } else if (result.status === 'skipped') {
        results.skipped++;
      }
    }
    
    results.endTime = new Date();
    results.duration = results.endTime - results.startTime;
    
    // Save results to file
    fs.mkdirSync(path.dirname(CONFIG.resultFile), { recursive: true });
    fs.writeFileSync(CONFIG.resultFile, JSON.stringify(results, null, 2));
    
    logger.success('MIGRATION COMPLETE', {
      total: results.total,
      success: results.success,
      failed: results.failed,
      skipped: results.skipped,
      duration: `${(results.duration / 1000).toFixed(2)}s`,
      resultFile: CONFIG.resultFile
    });
    
    // Show failed companies
    if (results.failed > 0) {
      logger.error('FAILED COMPANIES', {
        count: results.failed,
        companies: results.companies.filter(c => c.status === 'failed').map(c => ({
          companyId: c.companyId,
          error: c.error
        }))
      });
    }
    
    return results;
    
  } catch (err) {
    logger.error('MIGRATION FATAL ERROR', {
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}

// ============================================================================
// ROLLBACK FUNCTION
// ============================================================================

/**
 * Rollback migration for specific companies
 * 
 * Usage:
 *   node scripts/migrations/2024-11-20-migrate-cheatsheet-to-versions.js --rollback --companyIds="id1,id2"
 */
async function rollback() {
  logger.warn('ROLLBACK START', {
    companyIds: CONFIG.companyIds || 'NONE'
  });
  
  if (!CONFIG.companyIds) {
    throw new Error('--companyIds required for rollback');
  }
  
  const results = {
    total: CONFIG.companyIds.length,
    success: 0,
    failed: 0,
    companies: []
  };
  
  for (const companyIdStr of CONFIG.companyIds) {
    try {
      const companyId = new mongoose.Types.ObjectId(companyIdStr);
      
      // Remove version
      await CheatSheetVersion.deleteMany({ companyId });
      
      // Clear company pointer
      await Company.updateOne(
        { _id: companyId },
        {
          $unset: {
            'aiAgentSettings.cheatSheetMeta.liveVersionId': ''
          }
        }
      );
      
      results.success++;
      results.companies.push({ companyId: companyIdStr, status: 'rolled-back' });
      logger.success(`Rolled back company ${companyIdStr}`);
      
    } catch (err) {
      results.failed++;
      results.companies.push({
        companyId: companyIdStr,
        status: 'failed',
        error: err.message
      });
      logger.error(`Rollback failed for company ${companyIdStr}`, { error: err.message });
    }
  }
  
  logger.warn('ROLLBACK COMPLETE', results);
  return results;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

if (require.main === module) {
  const isRollback = process.argv.includes('--rollback');
  
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia')
    .then(() => {
      logger.info('Connected to MongoDB');
      
      if (isRollback) {
        return rollback();
      } else {
        return migrate();
      }
    })
    .then((results) => {
      logger.success('Script completed', {
        successRate: `${((results.success / results.total) * 100).toFixed(2)}%`
      });
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Script failed', {
        error: err.message,
        stack: err.stack
      });
      process.exit(1);
    });
}

// ============================================================================
// EXPORTS (for testing)
// ============================================================================

module.exports = {
  migrate,
  rollback,
  migrateCompany
};

