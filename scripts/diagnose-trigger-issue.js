#!/usr/bin/env node
/**
 * Comprehensive Trigger Diagnostic Tool
 * 
 * Checks EVERYTHING that could cause triggers to not match:
 * - Database connection
 * - Trigger state (published vs draft vs null)
 * - Trigger structure (keywords, match object)
 * - Cache state
 * - Company settings
 * 
 * Usage:
 *   node scripts/diagnose-trigger-issue.js <companyId>
 */

require('../config/db-connection');
const mongoose = require('mongoose');
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
const CompanyTriggerSettings = require('../models/CompanyTriggerSettings');
const GlobalTriggerGroup = require('../models/GlobalTriggerGroup');
const GlobalTrigger = require('../models/GlobalTrigger');
const { TriggerCardMatcher } = require('../services/engine/agent2/TriggerCardMatcher');
const TriggerService = require('../services/engine/agent2/TriggerService');

async function diagnose(companyId) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 COMPREHENSIVE TRIGGER DIAGNOSTIC');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log(`Company ID: ${companyId}\n`);
  
  const issues = [];
  const warnings = [];
  const info = [];
  
  // ──────────────────────────────────────────────────────────────────────
  // 1. DATABASE CONNECTION
  // ──────────────────────────────────────────────────────────────────────
  console.log('1️⃣  DATABASE CONNECTION');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   Database Name: ${mongoose.connection.name}`);
  console.log(`   Host: ${mongoose.connection.host}`);
  console.log(`   Ready State: ${mongoose.connection.readyState} (${
    mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Not Connected'
  })\n`);
  
  if (mongoose.connection.readyState !== 1) {
    issues.push('Database not connected!');
  }
  
  // ──────────────────────────────────────────────────────────────────────
  // 2. TRIGGER SETTINGS
  // ──────────────────────────────────────────────────────────────────────
  console.log('2️⃣  COMPANY TRIGGER SETTINGS');
  console.log('─────────────────────────────────────────────────────────────────');
  
  const settings = await CompanyTriggerSettings.findByCompanyId(companyId);
  
  if (!settings) {
    console.log('   ⚠️  No CompanyTriggerSettings document found');
    warnings.push('No trigger settings document - will use defaults');
  } else {
    console.log(`   Active Group ID: ${settings.activeGroupId || 'NONE'}`);
    console.log(`   Strict Mode: ${settings.strictMode !== false ? 'YES' : 'NO'}`);
    
    if (!settings.activeGroupId) {
      warnings.push('No global trigger group assigned - using local triggers only');
    }
  }
  console.log('');
  
  // ──────────────────────────────────────────────────────────────────────
  // 3. GLOBAL TRIGGERS (if group assigned)
  // ──────────────────────────────────────────────────────────────────────
  console.log('3️⃣  GLOBAL TRIGGER GROUP');
  console.log('─────────────────────────────────────────────────────────────────');
  
  if (settings?.activeGroupId) {
    const group = await GlobalTriggerGroup.findByGroupId(settings.activeGroupId);
    
    if (!group) {
      console.log(`   ❌ Group not found: ${settings.activeGroupId}`);
      issues.push(`Active group ${settings.activeGroupId} does not exist`);
    } else {
      console.log(`   Group Name: ${group.name}`);
      console.log(`   Published Version: ${group.publishedVersion}`);
      console.log(`   Is Draft: ${group.isDraft ? 'YES' : 'NO'}`);
      console.log(`   Is Published: ${group.publishedVersion > 0 ? '✅ YES' : '❌ NO'}\n`);
      
      if (group.publishedVersion === 0) {
        issues.push('Global trigger group is NOT published - no global triggers will load!');
      }
      
      const globalTriggers = await GlobalTrigger.findPublishedByGroupId(settings.activeGroupId);
      console.log(`   Published Global Triggers: ${globalTriggers.length}`);
      
      if (globalTriggers.length === 0 && group.publishedVersion > 0) {
        warnings.push('Group is published but contains no triggers');
      }
    }
  } else {
    console.log('   No global group assigned - using local triggers only\n');
  }
  
  // ──────────────────────────────────────────────────────────────────────
  // 4. LOCAL TRIGGERS - THE CRITICAL CHECK
  // ──────────────────────────────────────────────────────────────────────
  console.log('4️⃣  LOCAL TRIGGERS (CRITICAL CHECK)');
  console.log('─────────────────────────────────────────────────────────────────');
  
  // ALL triggers for this company (no filters)
  const allLocalTriggers = await CompanyLocalTrigger.find({ 
    companyId,
    isDeleted: { $ne: true }
  });
  
  console.log(`   Total Local Triggers: ${allLocalTriggers.length}\n`);
  
  // Break down by state
  const byState = {
    published: allLocalTriggers.filter(t => t.state === 'published'),
    draft: allLocalTriggers.filter(t => t.state === 'draft'),
    null: allLocalTriggers.filter(t => !t.state || t.state === null)
  };
  
  console.log('   Breakdown by State:');
  console.log(`   - Published: ${byState.published.length}`);
  console.log(`   - Draft: ${byState.draft.length}`);
  console.log(`   - Null/Missing: ${byState.null.length}\n`);
  
  // Break down by enabled
  const byEnabled = {
    enabled: allLocalTriggers.filter(t => t.enabled === true),
    disabled: allLocalTriggers.filter(t => t.enabled === false)
  };
  
  console.log('   Breakdown by Enabled:');
  console.log(`   - Enabled: ${byEnabled.enabled.length}`);
  console.log(`   - Disabled: ${byEnabled.disabled.length}\n`);
  
  // THE CRITICAL QUERY - what runtime actually sees
  const runtimeVisibleTriggers = await CompanyLocalTrigger.findActiveByCompanyId(companyId);
  
  console.log('   🎯 RUNTIME VISIBLE TRIGGERS (enabled + published):');
  console.log(`   ${runtimeVisibleTriggers.length}\n`);
  
  // ── THE DIAGNOSIS ──
  if (runtimeVisibleTriggers.length === 0) {
    console.log('   ❌❌❌ PROBLEM IDENTIFIED! ❌❌❌\n');
    console.log('   Runtime sees ZERO triggers because:\n');
    
    const enabledButNotPublished = allLocalTriggers.filter(
      t => t.enabled === true && t.state !== 'published'
    );
    
    if (enabledButNotPublished.length > 0) {
      issues.push(`${enabledButNotPublished.length} triggers are ENABLED but NOT PUBLISHED`);
      console.log(`   🚨 ${enabledButNotPublished.length} triggers are ENABLED but state != 'published'\n`);
      console.log('   These triggers:');
      enabledButNotPublished.slice(0, 10).forEach(t => {
        console.log(`      - ${t.ruleId} (${t.label})`);
        console.log(`        state: ${t.state || 'null'}, enabled: ${t.enabled}`);
      });
      if (enabledButNotPublished.length > 10) {
        console.log(`      ... and ${enabledButNotPublished.length - 10} more`);
      }
      console.log('');
      console.log('   💡 FIX: Run this command to publish all enabled triggers:');
      console.log(`      node scripts/fix-trigger-state.js ${companyId} --fix\n`);
    } else if (byEnabled.enabled.length === 0) {
      issues.push('All local triggers are DISABLED');
      console.log('   🚨 All local triggers are DISABLED\n');
      console.log('   💡 FIX: Enable triggers in the admin console\n');
    } else {
      issues.push('Unknown issue - investigate manually');
      console.log('   🚨 Unknown issue - all enabled triggers are published but query returns 0\n');
      console.log('   💡 This might be a Mongoose/database issue. Try:');
      console.log('      1. Restart the application');
      console.log('      2. Check database indexes');
      console.log('      3. Clear trigger cache\n');
    }
  } else {
    console.log('   ✅ Runtime can see triggers!\n');
    console.log('   Sample triggers:');
    runtimeVisibleTriggers.slice(0, 5).forEach(t => {
      console.log(`      - ${t.ruleId} (${t.label})`);
      console.log(`        Priority: ${t.priority}, Keywords: ${(t.keywords || []).length}`);
    });
    console.log('');
  }
  
  // ──────────────────────────────────────────────────────────────────────
  // 5. TRIGGER STRUCTURE VALIDATION
  // ──────────────────────────────────────────────────────────────────────
  console.log('5️⃣  TRIGGER STRUCTURE VALIDATION');
  console.log('─────────────────────────────────────────────────────────────────');
  
  const triggersWithIssues = [];
  
  runtimeVisibleTriggers.forEach(t => {
    const errors = [];
    
    // Check for keywords or phrases
    const hasKeywords = t.keywords && t.keywords.length > 0;
    const hasPhrases = t.phrases && t.phrases.length > 0;
    
    if (!hasKeywords && !hasPhrases) {
      errors.push('No keywords or phrases - will never match');
    }
    
    // Check for answer text (unless it's LLM mode)
    if (t.responseMode !== 'llm' && (!t.answerText || t.answerText.trim() === '')) {
      errors.push('No answer text - nothing to respond with');
    }
    
    if (errors.length > 0) {
      triggersWithIssues.push({ ruleId: t.ruleId, label: t.label, errors });
    }
  });
  
  if (triggersWithIssues.length > 0) {
    console.log(`   ⚠️  Found ${triggersWithIssues.length} triggers with structural issues:\n`);
    triggersWithIssues.slice(0, 5).forEach(t => {
      console.log(`   - ${t.ruleId} (${t.label})`);
      t.errors.forEach(e => console.log(`     ❌ ${e}`));
    });
    if (triggersWithIssues.length > 5) {
      console.log(`   ... and ${triggersWithIssues.length - 5} more\n`);
    }
    warnings.push(`${triggersWithIssues.length} triggers have structural issues`);
  } else {
    console.log('   ✅ All visible triggers have valid structure\n');
  }
  
  // ──────────────────────────────────────────────────────────────────────
  // 6. TEST TRIGGER LOADING (simulate runtime)
  // ──────────────────────────────────────────────────────────────────────
  console.log('6️⃣  RUNTIME SIMULATION');
  console.log('─────────────────────────────────────────────────────────────────');
  
  try {
    const triggers = await TriggerService.loadTriggersForCompany(companyId, { 
      useCache: false,
      includeMeta: true 
    });
    
    const actualTriggers = triggers.triggers || triggers;
    const meta = triggers.meta || {};
    
    console.log(`   Loaded ${actualTriggers.length} triggers`);
    console.log(`   From cache: ${meta.fromCache ? 'YES' : 'NO'}`);
    
    if (actualTriggers._loadMetadata) {
      const lm = actualTriggers._loadMetadata;
      console.log(`   Source: ${lm.source}`);
      console.log(`   Strict Mode: ${lm.strictMode ? 'YES' : 'NO'}`);
      console.log(`   Legacy Used: ${lm.legacyUsed ? '⚠️ YES' : 'NO'}\n`);
      
      if (lm.legacyUsed) {
        warnings.push('Legacy playbook.rules are being loaded - enable strict mode');
      }
    }
    
    if (actualTriggers.length === 0) {
      issues.push('Runtime trigger loading returns EMPTY array');
      console.log('   ❌ Runtime would see ZERO triggers - calls will default to fallback!\n');
    } else {
      console.log('   ✅ Runtime successfully loads triggers\n');
    }
  } catch (error) {
    issues.push(`Runtime loading failed: ${error.message}`);
    console.log(`   ❌ Error loading triggers: ${error.message}\n`);
  }
  
  // ──────────────────────────────────────────────────────────────────────
  // 7. TEST TRIGGER MATCHING
  // ──────────────────────────────────────────────────────────────────────
  console.log('7️⃣  TRIGGER MATCHING TEST');
  console.log('─────────────────────────────────────────────────────────────────');
  
  if (runtimeVisibleTriggers.length > 0) {
    // Transform to matcher format
    const matcherCards = runtimeVisibleTriggers.map(t => {
      if (t.toMatcherFormat) {
        return t.toMatcherFormat();
      }
      return {
        id: t.triggerId || t.ruleId,
        ruleId: t.ruleId,
        enabled: t.enabled,
        priority: t.priority || 50,
        label: t.label,
        match: {
          keywords: t.keywords || [],
          phrases: t.phrases || [],
          negativeKeywords: t.negativeKeywords || [],
          negativePhrases: t.negativePhrases || []
        },
        answer: {
          answerText: t.answerText || '',
          audioUrl: t.audioUrl || ''
        }
      };
    });
    
    // Test with a generic service request
    const testInputs = [
      'my air conditioning is not cooling',
      'schedule a service',
      'the thermostat is blank'
    ];
    
    console.log('   Testing sample inputs:\n');
    testInputs.forEach(input => {
      const result = TriggerCardMatcher.match(input, matcherCards);
      console.log(`   Input: "${input}"`);
      console.log(`   Match: ${result.matched ? '✅' : '❌'} ${
        result.matched ? `(${result.cardLabel})` : '(no match)'
      }`);
    });
    console.log('');
  } else {
    console.log('   ⏭️  Skipped - no triggers to test\n');
  }
  
  // ──────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📋 DIAGNOSTIC SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (issues.length === 0 && warnings.length === 0) {
    console.log('✅✅✅ ALL CHECKS PASSED! ✅✅✅\n');
    console.log('Your trigger system is healthy and should be working correctly.\n');
  } else {
    if (issues.length > 0) {
      console.log(`❌ CRITICAL ISSUES (${issues.length}):\n`);
      issues.forEach((issue, idx) => {
        console.log(`   ${idx + 1}. ${issue}`);
      });
      console.log('');
    }
    
    if (warnings.length > 0) {
      console.log(`⚠️  WARNINGS (${warnings.length}):\n`);
      warnings.forEach((warning, idx) => {
        console.log(`   ${idx + 1}. ${warning}`);
      });
      console.log('');
    }
    
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('💡 RECOMMENDED ACTIONS:');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    if (issues.some(i => i.includes('NOT PUBLISHED'))) {
      console.log('1️⃣  Publish your triggers:');
      console.log(`   node scripts/fix-trigger-state.js ${companyId} --fix\n`);
    }
    
    if (issues.some(i => i.includes('Group is NOT published'))) {
      console.log('2️⃣  Publish your global trigger group:');
      console.log('   Admin Console → Triggers → Publish Group\n');
    }
    
    console.log('3️⃣  Clear trigger cache:');
    console.log('   Admin Console → Triggers → Refresh Cache\n');
    
    console.log('4️⃣  Test with a call and check Call Console for:');
    console.log('   - TRIGGER_POOL_SOURCE event (should show LOCAL triggers)');
    console.log('   - TRIGGER_MATCHING_ANALYSIS event\n');
  }
  
  console.log('═══════════════════════════════════════════════════════════════\n');
}

async function main() {
  const companyId = process.argv[2];
  
  if (!companyId) {
    console.error('Usage: node scripts/diagnose-trigger-issue.js <companyId>');
    console.error('');
    console.error('Example: node scripts/diagnose-trigger-issue.js 68e3f77a9d623b8058c700c4');
    process.exit(1);
  }
  
  try {
    await diagnose(companyId);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ DIAGNOSTIC FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { diagnose };
