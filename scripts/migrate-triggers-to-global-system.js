#!/usr/bin/env node
/**
 * ============================================================================
 * MIGRATION: Legacy Triggers to Global/Local System
 * ============================================================================
 *
 * This script migrates existing trigger cards from the legacy embedded format
 * (company.aiAgentSettings.agent2.discovery.playbook.rules[]) to the new
 * separate collections system.
 *
 * WHAT IT DOES:
 * 1. Creates a default global trigger group (if specified)
 * 2. For each company with existing triggers:
 *    - Creates CompanyTriggerSettings if not exists
 *    - Migrates triggers to CompanyLocalTrigger collection
 *    - Dedupes by ruleId (keeps highest priority or latest)
 *    - Logs all changes to audit file
 *
 * SAFETY:
 * - Dry-run mode by default (--execute to apply)
 * - Full audit log of all changes
 * - Does NOT delete legacy data (can run migration multiple times)
 *
 * USAGE:
 *   node scripts/migrate-triggers-to-global-system.js --dry-run
 *   node scripts/migrate-triggers-to-global-system.js --execute
 *   node scripts/migrate-triggers-to-global-system.js --execute --create-hvac-group
 *
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');

const v2Company = require('../models/v2Company');
const GlobalTriggerGroup = require('../models/GlobalTriggerGroup');
const GlobalTrigger = require('../models/GlobalTrigger');
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
const CompanyTriggerSettings = require('../models/CompanyTriggerSettings');

// ════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const CREATE_HVAC_GROUP = args.includes('--create-hvac-group');
const VERBOSE = args.includes('--verbose');

const MIGRATION_USER = 'system:migration';
const AUDIT_LOG = [];

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function log(message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    ...data
  };
  AUDIT_LOG.push(entry);
  
  if (VERBOSE || data.level === 'error' || data.level === 'warn') {
    console.log(`[${entry.timestamp}] ${message}`, Object.keys(data).length > 1 ? data : '');
  }
}

function generateRuleId(trigger, index) {
  if (trigger.id && /^[a-z0-9_.]+$/.test(trigger.id)) {
    return trigger.id;
  }
  
  const label = (trigger.label || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
  
  return label || `legacy_${index}`;
}

function normalizeTrigger(trigger, companyId, index) {
  const ruleId = generateRuleId(trigger, index);
  
  return {
    companyId,
    ruleId,
    triggerId: `${companyId}::${ruleId}`,
    label: trigger.label || `Trigger ${index + 1}`,
    description: '',
    enabled: trigger.enabled !== false,
    priority: typeof trigger.priority === 'number' ? trigger.priority : 50 + index,
    keywords: Array.isArray(trigger.match?.keywords) ? trigger.match.keywords : [],
    phrases: Array.isArray(trigger.match?.phrases) ? trigger.match.phrases : [],
    negativeKeywords: Array.isArray(trigger.match?.negativeKeywords) ? trigger.match.negativeKeywords : [],
    answerText: trigger.answer?.answerText || '',
    audioUrl: trigger.answer?.audioUrl || '',
    followUpQuestion: trigger.followUp?.question || '',
    followUpNextAction: trigger.followUp?.nextAction || '',
    scenarioTypeAllowlist: Array.isArray(trigger.match?.scenarioTypeAllowlist) ? trigger.match.scenarioTypeAllowlist : [],
    isOverride: false,
    overrideOfTriggerId: null,
    overrideType: null,
    createdBy: MIGRATION_USER,
    createdAt: new Date(),
    updatedBy: MIGRATION_USER,
    updatedAt: new Date()
  };
}

/**
 * DEDUPE RULE: Keep "latest edited" as the primary truth.
 * Priority is a behavior attribute, not authorship truth.
 * If two docs exist, it's already broken — prefer "most recently updated" for safety.
 * 
 * SOFT DELETE: Removed duplicates are marked with `_deleted: true` and reason
 * rather than physically removed. This allows auditing and rollback.
 */
function deduplicateTriggers(triggers) {
  const seen = new Map();
  const duplicatesRemoved = [];
  
  // Sort by updatedAt descending (latest first), fallback to createdAt
  const sorted = [...triggers].sort((a, b) => {
    const aTime = a.updatedAt?.getTime() || a.createdAt?.getTime() || 0;
    const bTime = b.updatedAt?.getTime() || b.createdAt?.getTime() || 0;
    return bTime - aTime; // Descending - latest first
  });
  
  for (const trigger of sorted) {
    const existing = seen.get(trigger.ruleId);
    
    if (existing) {
      // We already have a newer version - this one is a duplicate to remove
      duplicatesRemoved.push({
        ruleId: trigger.ruleId,
        kept: existing.triggerId,
        removed: trigger.triggerId,
        reason: 'DEDUPED_MIGRATION_LATEST_WINS',
        removedUpdatedAt: trigger.updatedAt,
        keptUpdatedAt: existing.updatedAt,
        // Soft delete data
        _deleted: true,
        _deletedReason: 'DEDUPED_MIGRATION',
        _deletedAt: new Date()
      });
    } else {
      seen.set(trigger.ruleId, trigger);
    }
  }
  
  return {
    triggers: Array.from(seen.values()),
    duplicatesRemoved
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MIGRATION FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

async function createDefaultHVACGroup() {
  log('Creating default HVAC trigger group...', { level: 'info' });
  
  const exists = await GlobalTriggerGroup.groupIdExists('hvac');
  if (exists) {
    log('HVAC group already exists, skipping', { level: 'info' });
    return null;
  }
  
  if (DRY_RUN) {
    log('[DRY RUN] Would create HVAC group', { level: 'info' });
    return null;
  }
  
  const group = await GlobalTriggerGroup.create({
    groupId: 'hvac',
    name: 'HVAC Triggers',
    icon: '❄️',
    description: 'Standard trigger cards for HVAC service companies',
    industry: 'hvac',
    createdBy: MIGRATION_USER
  });
  
  const defaultTriggers = [
    {
      ruleId: 'pricing.service_call',
      label: 'Service call pricing',
      priority: 10,
      keywords: ['service call', 'diagnostic fee', 'trip charge'],
      phrases: ['how much is', 'what does it cost'],
      negativeKeywords: ['cancel', 'refund'],
      answerText: 'Our service call is $89, which includes the diagnostic. If we do the repair, the diagnostic fee is waived.',
      followUpQuestion: 'Would you like to schedule a repair visit, or were you looking for a maintenance tune-up?'
    },
    {
      ruleId: 'problem.not_cooling',
      label: 'AC not cooling',
      priority: 12,
      keywords: ['not cooling', 'not cold', 'blowing warm', 'warm air', 'hot air'],
      phrases: ['running but not cooling', 'blowing but not cold'],
      answerText: 'If your system is running but not cooling, it could be a refrigerant issue, a dirty filter, or a problem with the compressor.',
      followUpQuestion: 'When did you last change the filter?'
    },
    {
      ruleId: 'problem.water_leak',
      label: 'Water leak / dripping',
      priority: 15,
      keywords: ['water leak', 'leaking water', 'dripping', 'puddle'],
      phrases: ['water coming from', 'dripping from'],
      answerText: 'Water leaking from an AC unit is often caused by a clogged drain line or a frozen evaporator coil. If you see a lot of water, turn the system off to prevent damage.',
      followUpQuestion: 'Is the water actively dripping right now, or have you noticed it pooling over time?'
    }
  ];
  
  for (const t of defaultTriggers) {
    await GlobalTrigger.create({
      groupId: 'hvac',
      ruleId: t.ruleId,
      triggerId: `hvac::${t.ruleId}`,
      label: t.label,
      priority: t.priority,
      keywords: t.keywords || [],
      phrases: t.phrases || [],
      negativeKeywords: t.negativeKeywords || [],
      answerText: t.answerText,
      audioUrl: '',
      followUpQuestion: t.followUpQuestion || '',
      followUpNextAction: '',
      createdBy: MIGRATION_USER
    });
  }
  
  group.triggerCount = defaultTriggers.length;
  group.addAuditEntry('GROUP_CREATED', MIGRATION_USER, { 
    source: 'migration', 
    triggerCount: defaultTriggers.length 
  });
  await group.save();
  
  log('HVAC group created with default triggers', { 
    level: 'info',
    triggerCount: defaultTriggers.length 
  });
  
  return group;
}

async function migrateCompanyTriggers(company) {
  const companyId = company._id.toString();
  const companyName = company.companyName || 'Unknown';
  
  const legacyRules = company.aiAgentSettings?.agent2?.discovery?.playbook?.rules || [];
  
  if (legacyRules.length === 0) {
    log(`Skipping company (no legacy triggers)`, { 
      companyId, 
      companyName,
      level: 'debug'
    });
    return { skipped: true, reason: 'no_legacy_triggers' };
  }
  
  log(`Processing company`, { 
    companyId, 
    companyName, 
    legacyTriggerCount: legacyRules.length,
    level: 'info'
  });
  
  const existingLocalCount = await CompanyLocalTrigger.countByCompanyId(companyId);
  if (existingLocalCount > 0) {
    log(`Company already has local triggers, skipping`, {
      companyId,
      companyName,
      existingCount: existingLocalCount,
      level: 'warn'
    });
    return { skipped: true, reason: 'already_migrated', existingCount: existingLocalCount };
  }
  
  const normalizedTriggers = legacyRules.map((t, i) => normalizeTrigger(t, companyId, i));
  
  const { triggers: dedupedTriggers, duplicatesRemoved } = deduplicateTriggers(normalizedTriggers);
  
  if (duplicatesRemoved.length > 0) {
    log(`Removed ${duplicatesRemoved.length} duplicates`, {
      companyId,
      companyName,
      duplicates: duplicatesRemoved,
      level: 'warn'
    });
  }
  
  if (DRY_RUN) {
    log(`[DRY RUN] Would create ${dedupedTriggers.length} local triggers`, {
      companyId,
      companyName,
      originalCount: legacyRules.length,
      dedupedCount: dedupedTriggers.length,
      level: 'info'
    });
    return {
      dryRun: true,
      originalCount: legacyRules.length,
      dedupedCount: dedupedTriggers.length,
      duplicatesRemoved: duplicatesRemoved.length
    };
  }
  
  const insertedTriggers = [];
  const errors = [];
  
  for (const trigger of dedupedTriggers) {
    try {
      const created = await CompanyLocalTrigger.create(trigger);
      insertedTriggers.push(created.triggerId);
    } catch (err) {
      if (err.code === 11000) {
        log(`Duplicate trigger skipped`, {
          companyId,
          triggerId: trigger.triggerId,
          level: 'warn'
        });
      } else {
        errors.push({ triggerId: trigger.triggerId, error: err.message });
        log(`Failed to create trigger`, {
          companyId,
          triggerId: trigger.triggerId,
          error: err.message,
          level: 'error'
        });
      }
    }
  }
  
  await CompanyTriggerSettings.findOneAndUpdate(
    { companyId },
    {
      $set: {
        migratedFromLegacy: true,
        legacyMigrationDate: new Date(),
        legacyTriggerCount: legacyRules.length,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  
  log(`Migration complete for company`, {
    companyId,
    companyName,
    originalCount: legacyRules.length,
    insertedCount: insertedTriggers.length,
    duplicatesRemoved: duplicatesRemoved.length,
    errors: errors.length,
    level: 'info'
  });
  
  return {
    success: true,
    originalCount: legacyRules.length,
    insertedCount: insertedTriggers.length,
    duplicatesRemoved: duplicatesRemoved.length,
    errors
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  TRIGGER MIGRATION: Legacy → Global/Local System');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'EXECUTE'}`);
  console.log(`  Create HVAC Group: ${CREATE_HVAC_GROUP ? 'Yes' : 'No'}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  log('Connected to MongoDB', { level: 'info' });
  
  const stats = {
    totalCompanies: 0,
    skipped: 0,
    migrated: 0,
    errors: 0,
    totalTriggersOriginal: 0,
    totalTriggersMigrated: 0,
    totalDuplicatesRemoved: 0
  };
  
  try {
    if (CREATE_HVAC_GROUP) {
      await createDefaultHVACGroup();
    }
    
    const companies = await v2Company.find({
      'aiAgentSettings.agent2.discovery.playbook.rules.0': { $exists: true }
    }).select('_id companyName aiAgentSettings.agent2.discovery.playbook.rules').lean();
    
    stats.totalCompanies = companies.length;
    log(`Found ${companies.length} companies with legacy triggers`, { level: 'info' });
    
    for (const company of companies) {
      try {
        const result = await migrateCompanyTriggers(company);
        
        if (result.skipped) {
          stats.skipped++;
        } else if (result.dryRun || result.success) {
          stats.migrated++;
          stats.totalTriggersOriginal += result.originalCount || 0;
          stats.totalTriggersMigrated += result.insertedCount || result.dedupedCount || 0;
          stats.totalDuplicatesRemoved += result.duplicatesRemoved || 0;
        }
        
        if (result.errors && result.errors.length > 0) {
          stats.errors += result.errors.length;
        }
      } catch (err) {
        stats.errors++;
        log(`Failed to migrate company`, {
          companyId: company._id.toString(),
          error: err.message,
          level: 'error'
        });
      }
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('  MIGRATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`  Total companies processed: ${stats.totalCompanies}`);
    console.log(`  Companies migrated: ${stats.migrated}`);
    console.log(`  Companies skipped: ${stats.skipped}`);
    console.log(`  Original triggers: ${stats.totalTriggersOriginal}`);
    console.log(`  Triggers migrated: ${stats.totalTriggersMigrated}`);
    console.log(`  Duplicates removed: ${stats.totalDuplicatesRemoved}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    const auditFilename = `migration-triggers-${Date.now()}.json`;
    const auditPath = path.join(__dirname, '..', 'logs', auditFilename);
    
    try {
      await fs.mkdir(path.dirname(auditPath), { recursive: true });
      await fs.writeFile(auditPath, JSON.stringify({
        stats,
        dryRun: DRY_RUN,
        timestamp: new Date().toISOString(),
        entries: AUDIT_LOG
      }, null, 2));
      console.log(`Audit log written to: ${auditPath}`);
    } catch (err) {
      console.error(`Failed to write audit log: ${err.message}`);
    }
    
  } finally {
    await mongoose.disconnect();
    log('Disconnected from MongoDB', { level: 'info' });
  }
  
  if (DRY_RUN) {
    console.log('\n⚠️  This was a DRY RUN. No changes were made.');
    console.log('    Run with --execute to apply changes.\n');
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
