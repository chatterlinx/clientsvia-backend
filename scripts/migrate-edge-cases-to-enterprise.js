#!/usr/bin/env node

/**
 * ============================================================================
 * EDGE CASES MIGRATION SCRIPT
 * ============================================================================
 * 
 * PURPOSE: Migrate edge cases from legacy Object format to enterprise Array
 * 
 * WHAT IT DOES:
 * 1. Finds all CheatSheetVersions with edgeCases as Object
 * 2. Converts to new Array format with enterprise schema
 * 3. Preserves all existing behavior (backward compatible)
 * 4. Adds stable IDs, audit metadata
 * 5. Invalidates Redis cache
 * 
 * SAFE TO RUN MULTIPLE TIMES: Idempotent (skips already migrated)
 * 
 * Usage:
 *   node scripts/migrate-edge-cases-to-enterprise.js [--dry-run] [--companyId=XXX]
 * 
 * Options:
 *   --dry-run      Show what would be changed without saving
 *   --companyId    Migrate only specific company (for testing)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const CheatSheetVersion = require('../models/cheatsheet/CheatSheetVersion');
const { getRedisClient } = require('../config/redis');

// ============================================================================
// MIGRATION LOGIC
// ============================================================================

/**
 * Check if edge cases need migration
 */
function needsMigration(config) {
  // If edgeCases is empty or already an array, no migration needed
  if (!config.edgeCases) return false;
  if (Array.isArray(config.edgeCases)) return false;
  
  // If it's an Object with keys, needs migration
  return Object.keys(config.edgeCases).length > 0;
}

/**
 * Generate stable ID from name
 */
function generateEdgeCaseId(name) {
  const timestamp = Date.now().toString(36);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `ec-${slug}-${timestamp}`;
}

/**
 * Migrate single edge case from legacy to enterprise format
 */
function migrateEdgeCase(legacyEdgeCase, index) {
  // Legacy format detection (various structures seen in production)
  const name = legacyEdgeCase.name || `Edge Case ${index + 1}`;
  const triggerPatterns = legacyEdgeCase.triggerPatterns || 
                          legacyEdgeCase.patterns || 
                          [];
  const responseText = legacyEdgeCase.responseText || 
                       legacyEdgeCase.response || 
                       '';
  
  // Build enterprise format
  const enterpriseEdgeCase = {
    // Identity
    id: legacyEdgeCase.id || generateEdgeCaseId(name),
    name: name,
    description: legacyEdgeCase.description || '',
    
    // Control
    enabled: legacyEdgeCase.enabled !== false, // Default true
    priority: legacyEdgeCase.priority || 10,
    
    // Legacy fields (keep for double compatibility)
    triggerPatterns: triggerPatterns,
    responseText: responseText,
    
    // Enterprise action (map from legacy)
    action: {
      type: 'override_response',  // Legacy only supported override
      inlineResponse: responseText,
      responseTemplateId: '',
      transferTarget: '',
      transferMessage: '',
      hangupMessage: ''
    },
    
    // Side effects (check if auto-blacklist was configured)
    sideEffects: {
      autoBlacklist: false,  // TODO: Check if company has auto-blacklist enabled for this edge case
      autoTag: legacyEdgeCase.tags || [],
      notifyContacts: [],
      logSeverity: 'info'
    },
    
    // Audit metadata
    auditMeta: {
      createdBy: legacyEdgeCase.createdBy || 'Migration Script',
      createdAt: legacyEdgeCase.createdAt || new Date(),
      updatedBy: 'Migration Script',
      updatedAt: new Date()
    }
  };
  
  return enterpriseEdgeCase;
}

/**
 * Convert legacy Object to enterprise Array
 */
function convertEdgeCasesToArray(legacyEdgeCases) {
  // Handle various legacy formats:
  // 1. Array (already correct) - return as-is
  if (Array.isArray(legacyEdgeCases)) {
    return legacyEdgeCases;
  }
  
  // 2. Object with numeric keys (array-like) - convert to array
  if (typeof legacyEdgeCases === 'object' && legacyEdgeCases !== null) {
    const keys = Object.keys(legacyEdgeCases);
    
    // If all keys are numeric indices
    if (keys.every(k => /^\d+$/.test(k))) {
      const arr = keys
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(k => legacyEdgeCases[k]);
      return arr.map((ec, i) => migrateEdgeCase(ec, i));
    }
    
    // 3. Object with named keys - convert to array
    const arr = Object.entries(legacyEdgeCases).map(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        // Use key as name if no name field
        return { ...value, name: value.name || key };
      }
      return value;
    });
    return arr.map((ec, i) => migrateEdgeCase(ec, i));
  }
  
  // 4. Empty or invalid - return empty array
  return [];
}

// ============================================================================
// MAIN MIGRATION
// ============================================================================

async function runMigration(options = {}) {
  const { dryRun = false, companyId = null } = options;
  
  logger.info('[EDGE CASES MIGRATION] Starting...', { dryRun, companyId });
  
  try {
    // Connect to DB if not already connected
    if (mongoose.connection.readyState !== 1) {
      await require('../db');
      logger.info('[EDGE CASES MIGRATION] Connected to MongoDB');
    }
    
    // Build query
    const query = {};
    if (companyId) {
      query.companyId = companyId;
    }
    
    // Find all CheatSheetVersions
    const versions = await CheatSheetVersion.find(query).lean();
    logger.info('[EDGE CASES MIGRATION] Found versions', { 
      total: versions.length,
      companyId: companyId || 'ALL'
    });
    
    // Stats
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    
    // Process each version
    for (const version of versions) {
      try {
        // Check if needs migration
        if (!needsMigration(version.config)) {
          skipped++;
          logger.debug('[EDGE CASES MIGRATION] Skipping (already array or empty)', {
            versionId: version._id,
            companyId: version.companyId,
            status: version.status
          });
          continue;
        }
        
        // Convert to array
        const newEdgeCases = convertEdgeCasesToArray(version.config.edgeCases);
        
        logger.info('[EDGE CASES MIGRATION] Converting', {
          versionId: version._id,
          companyId: version.companyId,
          status: version.status,
          oldFormat: typeof version.config.edgeCases,
          oldKeys: Object.keys(version.config.edgeCases || {}),
          newCount: newEdgeCases.length,
          dryRun
        });
        
        if (dryRun) {
          logger.info('[EDGE CASES MIGRATION] [DRY RUN] Would update:', {
            versionId: version._id,
            edgeCases: newEdgeCases.map(ec => ({
              id: ec.id,
              name: ec.name,
              actionType: ec.action.type
            }))
          });
          migrated++;
          continue;
        }
        
        // Update in database
        await CheatSheetVersion.updateOne(
          { _id: version._id },
          { 
            $set: { 
              'config.edgeCases': newEdgeCases,
              'metadata.migratedAt': new Date(),
              'metadata.migratedBy': 'Migration Script'
            }
          }
        );
        
        // Invalidate Redis cache if this is the live version
        if (version.status === 'live') {
          try {
            const redis = getRedisClient();
            if (redis && redis.isOpen) {
              const cacheKey = `cheatsheet:live:${version.companyId}`;
              await redis.del(cacheKey);
              logger.info('[EDGE CASES MIGRATION] Invalidated Redis cache', {
                companyId: version.companyId,
                cacheKey
              });
            }
          } catch (redisError) {
            logger.warn('[EDGE CASES MIGRATION] Redis cache invalidation failed (non-critical)', {
              error: redisError.message,
              companyId: version.companyId
            });
          }
        }
        
        migrated++;
        logger.info('[EDGE CASES MIGRATION] ✅ Migrated', {
          versionId: version._id,
          companyId: version.companyId,
          edgeCaseCount: newEdgeCases.length
        });
        
      } catch (versionError) {
        errors++;
        logger.error('[EDGE CASES MIGRATION] ❌ Version migration failed', {
          versionId: version._id,
          companyId: version.companyId,
          error: versionError.message,
          stack: versionError.stack
        });
      }
    }
    
    // Final stats
    logger.info('[EDGE CASES MIGRATION] ✅ Complete', {
      total: versions.length,
      migrated,
      skipped,
      errors,
      dryRun
    });
    
    return { success: true, migrated, skipped, errors };
    
  } catch (error) {
    logger.error('[EDGE CASES MIGRATION] ❌ Fatal error', {
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: error.message };
  }
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

if (require.main === module) {
  // Parse CLI args
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    companyId: args.find(a => a.startsWith('--companyId='))?.split('=')[1] || null
  };
  
  logger.info('[EDGE CASES MIGRATION] CLI execution started', options);
  
  runMigration(options)
    .then(result => {
      if (result.success) {
        logger.info('[EDGE CASES MIGRATION] ✅ SUCCESS', result);
        process.exit(0);
      } else {
        logger.error('[EDGE CASES MIGRATION] ❌ FAILED', result);
        process.exit(1);
      }
    })
    .catch(error => {
      logger.error('[EDGE CASES MIGRATION] ❌ UNEXPECTED ERROR', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

// ============================================================================
// EXPORTS (For programmatic use)
// ============================================================================

module.exports = {
  runMigration,
  needsMigration,
  convertEdgeCasesToArray,
  migrateEdgeCase
};

