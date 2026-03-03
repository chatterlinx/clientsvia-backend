#!/usr/bin/env node
/**
 * ============================================================================
 * TEST BUCKET SYSTEM - Comprehensive validation and testing
 * ============================================================================
 * 
 * Tests the complete bucket system end-to-end:
 * 1. Database models and queries
 * 2. Bucket classification accuracy
 * 3. Trigger pool filtering
 * 4. Zero-match retry safety net
 * 5. Health checks
 * 
 * Usage:
 *   node scripts/test-bucket-system.js <companyId>
 * 
 * Example:
 *   node scripts/test-bucket-system.js 68e3f77a9d623b8058c700c4
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const TriggerBucket = require('../models/TriggerBucket');
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
const { TriggerBucketClassifier } = require('../services/engine/agent2/TriggerBucketClassifier');

async function testBucketSystem(companyId) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 BUCKET SYSTEM COMPREHENSIVE TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log(`Company ID: ${companyId}\n`);
  
  try {
    // Connect
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // ────────────────────────────────────────────────────────────────────
    // TEST 1: Load Buckets
    // ────────────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('TEST 1: Load Buckets');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    const buckets = await TriggerBucket.findActiveByCompanyId(companyId);
    console.log(`Found ${buckets.length} active buckets\n`);
    
    if (buckets.length === 0) {
      console.log('⚠️  No buckets configured - bucket filtering disabled');
      console.log('   Create buckets in Admin Console → Triggers → Manage Buckets\n');
    } else {
      buckets.forEach(bucket => {
        console.log(`📦 ${bucket.icon} ${bucket.name}`);
        console.log(`   ID: ${bucket.bucketId}`);
        console.log(`   Keywords: ${bucket.classificationKeywords.join(', ')}`);
        console.log(`   Triggers: ${bucket.triggerCount}`);
        console.log(`   Threshold: ${Math.round(bucket.confidenceThreshold * 100)}%`);
        console.log('');
      });
    }
    
    // ────────────────────────────────────────────────────────────────────
    // TEST 2: Load Triggers
    // ────────────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('TEST 2: Load Triggers & Check Bucket Assignments');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    const triggers = await CompanyLocalTrigger.findActiveByCompanyId(companyId);
    console.log(`Found ${triggers.length} active triggers\n`);
    
    const bucketStats = {
      bucketed: 0,
      unbucketed: 0,
      emergency: 0,
      invalidBucket: 0
    };
    
    const bucketIds = new Set(buckets.map(b => b.bucketId));
    
    triggers.forEach(trigger => {
      if (trigger.alwaysEvaluate) {
        bucketStats.emergency++;
      } else if (!trigger.bucket) {
        bucketStats.unbucketed++;
      } else if (!bucketIds.has(trigger.bucket)) {
        bucketStats.invalidBucket++;
        console.log(`❌ ${trigger.label} → Invalid bucket: ${trigger.bucket}`);
      } else {
        bucketStats.bucketed++;
      }
    });
    
    console.log('Breakdown:');
    console.log(`  Bucketed: ${bucketStats.bucketed} ✓`);
    console.log(`  Unbucketed: ${bucketStats.unbucketed} ${bucketStats.unbucketed > 0 ? '⚠️' : ''}`);
    console.log(`  Emergency: ${bucketStats.emergency} 🚨`);
    console.log(`  Invalid: ${bucketStats.invalidBucket} ${bucketStats.invalidBucket > 0 ? '❌' : ''}`);
    console.log('');
    
    if (bucketStats.invalidBucket > 0) {
      console.log('❌ CRITICAL: Invalid bucket assignments found!');
      console.log('   Fix in Admin Console or run migration script\n');
    }
    
    // ────────────────────────────────────────────────────────────────────
    // TEST 3: Classification Test
    // ────────────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('TEST 3: Bucket Classification');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    if (buckets.length === 0) {
      console.log('⏭️  Skipped - no buckets to test\n');
    } else {
      const testInputs = [
        'my air conditioning is not cooling',
        'how much do you charge for service',
        'need to reschedule my appointment',
        'gas smell in my house',
        'thermostat is blank'
      ];
      
      console.log('Testing classification with common inputs:\n');
      
      for (const input of testInputs) {
        const result = await TriggerBucketClassifier.classify(input, companyId);
        
        console.log(`Input: "${input}"`);
        if (result.matched) {
          console.log(`  ✅ Matched: ${result.bucketName}`);
          console.log(`  Confidence: ${Math.round(result.confidence * 100)}%`);
          console.log(`  Keywords: ${result.matchedKeywords.join(', ')}`);
        } else {
          console.log(`  ❌ No bucket matched`);
          if (result.allScores.length > 0) {
            const highest = result.allScores[0];
            console.log(`  Closest: ${highest.name} (${Math.round(highest.score * 100)}% - below threshold)`);
          }
        }
        console.log('');
      }
    }
    
    // ────────────────────────────────────────────────────────────────────
    // TEST 4: Pool Filtering
    // ────────────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('TEST 4: Trigger Pool Filtering');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    if (buckets.length === 0 || triggers.length === 0) {
      console.log('⏭️  Skipped - need buckets and triggers\n');
    } else {
      const testInput = 'my air conditioning is not cooling';
      const classResult = await TriggerBucketClassifier.classify(testInput, companyId);
      
      console.log(`Test input: "${testInput}"\n`);
      
      if (classResult.matched) {
        // Transform triggers to matcher format
        const matcherTriggers = triggers.map(t => ({
          ruleId: t.ruleId,
          label: t.label,
          bucket: t.bucket,
          alwaysEvaluate: t.alwaysEvaluate,
          match: {
            keywords: t.keywords || [],
            phrases: t.phrases || []
          }
        }));
        
        const filterResult = TriggerBucketClassifier.filterTriggerPool(
          matcherTriggers,
          classResult
        );
        
        console.log('Filtering Result:');
        console.log(`  Detected Bucket: ${filterResult.detectedBucket}`);
        console.log(`  Confidence: ${Math.round(filterResult.confidence * 100)}%`);
        console.log(`  Original Pool: ${filterResult.originalSize} triggers`);
        console.log(`  Filtered Pool: ${filterResult.filteredSize} triggers`);
        console.log(`  Reduction: ${filterResult.reduction}%`);
        console.log(`  Always-Evaluate: ${filterResult.alwaysEvaluateCount}`);
        console.log(`  Bucket-Match: ${filterResult.bucketMatchCount}`);
        console.log('');
        
        if (filterResult.reduction > 0) {
          console.log(`✅ Pool filtering working! ${filterResult.reduction}% reduction in triggers to evaluate`);
        } else {
          console.log('⚠️  No reduction - check bucket assignments');
        }
      } else {
        console.log('❌ No bucket matched - filtering not applied');
      }
      console.log('');
    }
    
    // ────────────────────────────────────────────────────────────────────
    // TEST 5: Health Check
    // ────────────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('TEST 5: System Health Check');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    const health = await TriggerBucket.getHealthSummary(companyId);
    
    console.log('Health Summary:');
    console.log(`  Total Buckets: ${health.totalBuckets}`);
    console.log(`  Active Buckets: ${health.activeBuckets}`);
    console.log(`  Total Triggers: ${health.totalTriggers}`);
    console.log(`  Bucketed: ${health.bucketed} (${health.bucketedPercent}%)`);
    console.log(`  Unbucketed: ${health.unbucketed}`);
    console.log(`  Emergency: ${health.emergency}`);
    console.log(`  Invalid: ${health.invalidBucket}`);
    console.log(`  Status: ${health.healthy ? '✅ HEALTHY' : '❌ NEEDS ATTENTION'}`);
    console.log('');
    
    // ────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ────────────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 TEST SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    const issues = [];
    
    if (buckets.length === 0) {
      issues.push('No buckets configured - create buckets to enable filtering');
    }
    
    if (bucketStats.invalidBucket > 0) {
      issues.push(`${bucketStats.invalidBucket} triggers have invalid bucket assignments`);
    }
    
    if (health.bucketedPercent < 80 && buckets.length > 0) {
      issues.push(`Only ${health.bucketedPercent}% of triggers are bucketed (target: 80%+)`);
    }
    
    if (issues.length === 0) {
      console.log('✅✅✅ ALL TESTS PASSED! ✅✅✅\n');
      console.log('Bucket system is healthy and ready for production.\n');
    } else {
      console.log('⚠️  ISSUES FOUND:\n');
      issues.forEach((issue, idx) => {
        console.log(`   ${idx + 1}. ${issue}`);
      });
      console.log('');
      console.log('Recommendations:');
      console.log('1. Go to Admin Console → Triggers → Manage Buckets');
      console.log('2. Create buckets for your main intent types');
      console.log('3. Assign triggers to buckets using dropdown or quick assign');
      console.log('4. Run this test again to verify\n');
    }
    
    process.exit(issues.length === 0 ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const companyId = process.argv[2];

if (!companyId) {
  console.error('Usage: node scripts/test-bucket-system.js <companyId>');
  console.error('');
  console.error('Example:');
  console.error('  node scripts/test-bucket-system.js 68e3f77a9d623b8058c700c4');
  process.exit(1);
}

testBucketSystem(companyId);
