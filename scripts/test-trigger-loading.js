#!/usr/bin/env node
/**
 * Test Trigger Loading - Verify triggers load correctly for runtime
 * 
 * This simulates EXACTLY what happens during a call to see if triggers
 * are properly transformed and exposed to the matcher.
 */

const mongoose = require('mongoose');

let MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  try {
    require('dotenv').config();
    MONGODB_URI = process.env.MONGODB_URI;
  } catch (err) {}
}

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found');
  process.exit(1);
}

const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
const { TriggerCardMatcher } = require('../services/engine/agent2/TriggerCardMatcher');
const TriggerService = require('../services/engine/agent2/TriggerService');

async function testTriggerLoading(companyId) {
  try {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🧪 TEST TRIGGER LOADING FOR RUNTIME');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log(`Company ID: ${companyId}\n`);
    
    // Connect
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('STEP 1: Raw Database Query (what findActiveByCompanyId returns)');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    const rawTriggers = await CompanyLocalTrigger.findActiveByCompanyId(companyId);
    console.log(`Found ${rawTriggers.length} triggers\n`);
    
    if (rawTriggers.length > 0) {
      const sample = rawTriggers[0];
      console.log('Sample trigger (raw from DB):');
      console.log(`  ruleId: ${sample.ruleId}`);
      console.log(`  label: ${sample.label}`);
      console.log(`  enabled: ${sample.enabled}`);
      console.log(`  state: ${sample.state}`);
      console.log(`  keywords: ${JSON.stringify(sample.keywords)}`);
      console.log(`  phrases: ${JSON.stringify(sample.phrases)}`);
      console.log(`  answerText: ${sample.answerText ? sample.answerText.substring(0, 50) + '...' : 'NONE'}`);
      console.log('');
    }
    
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('STEP 2: TriggerService Load (what runtime actually uses)');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    const loadedTriggers = await TriggerService.loadTriggersForCompany(companyId, {
      useCache: false,
      includeMeta: true
    });
    
    const triggers = loadedTriggers.triggers || loadedTriggers;
    console.log(`TriggerService loaded ${triggers.length} triggers\n`);
    
    if (triggers.length > 0) {
      const sample = triggers[0];
      console.log('Sample trigger (after TriggerService transform):');
      console.log(`  id: ${sample.id}`);
      console.log(`  ruleId: ${sample.ruleId}`);
      console.log(`  label: ${sample.label}`);
      console.log(`  enabled: ${sample.enabled}`);
      console.log(`  priority: ${sample.priority}`);
      console.log(`  match.keywords: ${JSON.stringify(sample.match?.keywords)}`);
      console.log(`  match.phrases: ${JSON.stringify(sample.match?.phrases)}`);
      console.log(`  answer.answerText: ${sample.answer?.answerText ? sample.answer.answerText.substring(0, 50) + '...' : 'NONE'}`);
      console.log('');
      
      // Check for common issues
      const issues = [];
      
      if (!sample.match) {
        issues.push('❌ CRITICAL: "match" object is missing!');
      } else {
        if (!sample.match.keywords && !sample.match.phrases) {
          issues.push('❌ CRITICAL: No keywords or phrases in match object!');
        }
        if (!Array.isArray(sample.match.keywords)) {
          issues.push('❌ match.keywords is not an array');
        }
        if (!Array.isArray(sample.match.phrases)) {
          issues.push('❌ match.phrases is not an array');
        }
      }
      
      if (!sample.answer) {
        issues.push('❌ "answer" object is missing!');
      }
      
      if (issues.length > 0) {
        console.log('🚨 ISSUES FOUND:\n');
        issues.forEach(issue => console.log(`   ${issue}`));
        console.log('');
      } else {
        console.log('✅ Trigger structure looks correct\n');
      }
    }
    
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('STEP 3: TriggerCardMatcher Test (actual matching)');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    if (triggers.length === 0) {
      console.log('⏭️  Skipped - no triggers to test\n');
    } else {
      // Test with common HVAC inputs
      const testInputs = [
        'my air conditioning is not cooling',
        'ac not working',
        'thermostat is blank',
        'need to schedule service',
        'gas smell'
      ];
      
      console.log('Testing with common inputs:\n');
      
      testInputs.forEach(input => {
        const result = TriggerCardMatcher.match(input, triggers);
        
        if (result.matched) {
          console.log(`✅ "${input}"`);
          console.log(`   → Matched: ${result.cardLabel}`);
          console.log(`   → Type: ${result.matchType}`);
          console.log(`   → Matched on: ${result.matchedOn}`);
        } else {
          console.log(`❌ "${input}"`);
          console.log(`   → No match`);
          console.log(`   → Cards evaluated: ${result.totalCards}`);
          console.log(`   → Enabled cards: ${result.enabledCards}`);
          
          if (result.evaluated && result.evaluated.length > 0) {
            const firstCard = result.evaluated[0];
            if (firstCard.skipped) {
              console.log(`   → First card skipped: ${firstCard.skipReason}`);
            }
          }
        }
        console.log('');
      });
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 DIAGNOSTIC SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    if (rawTriggers.length === 0) {
      console.log('❌ DATABASE QUERY RETURNS 0 TRIGGERS');
      console.log('   → Triggers have wrong state or are disabled\n');
    } else if (triggers.length === 0) {
      console.log('❌ TRIGGERSERVICE RETURNS 0 TRIGGERS');
      console.log('   → Transform or merge logic is broken\n');
    } else if (triggers.length > 0 && !triggers[0].match) {
      console.log('❌ TRIGGERS MISSING "match" OBJECT');
      console.log('   → toMatcherFormat() not being called\n');
    } else {
      console.log('✅ TRIGGERS LOAD CORRECTLY');
      console.log(`   ${triggers.length} triggers with proper structure\n`);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const companyId = process.argv[2];

if (!companyId) {
  console.error('Usage: node scripts/test-trigger-loading.js <companyId>');
  console.error('');
  console.error('Example:');
  console.error('  node scripts/test-trigger-loading.js 68e3f77a9d623b8058c700c4');
  process.exit(1);
}

testTriggerLoading(companyId);
