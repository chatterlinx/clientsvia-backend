#!/usr/bin/env node
/**
 * ============================================================================
 * SETUP DEFAULT BUCKETS - Quick start for new companies
 * ============================================================================
 * 
 * Creates standard HVAC buckets for a company based on industry best practices.
 * Analyzes existing triggers and auto-assigns them to appropriate buckets.
 * 
 * Usage:
 *   node scripts/setup-default-buckets.js <companyId> [--apply]
 * 
 * Without --apply: Shows what would be created (dry run)
 * With --apply: Actually creates buckets and assigns triggers
 * 
 * Example:
 *   node scripts/setup-default-buckets.js 68e3f77a9d623b8058c700c4 --apply
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const TriggerBucket = require('../models/TriggerBucket');
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');

// Default bucket templates for HVAC companies
const DEFAULT_HVAC_BUCKETS = [
  {
    bucketId: 'cooling_service',
    name: 'Cooling Issues',
    icon: '🧊',
    description: 'AC not cooling, warm air, refrigerant issues',
    classificationKeywords: [
      'cooling', 'not cooling', 'warm air', 'ac not cold',
      'not blowing cold', 'refrigerant', 'freon', 'compressor'
    ],
    priority: 10,
    confidenceThreshold: 0.70,
    matchRules: {
      keywords: ['cooling', 'cool', 'cold', 'warm', 'refrigerant', 'freon', 'compressor'],
      ruleIdPatterns: ['cooling', 'ac', 'refrigerant']
    }
  },
  {
    bucketId: 'heating_service',
    name: 'Heating Issues',
    icon: '🔥',
    description: 'Furnace problems, no heat, thermostat issues',
    classificationKeywords: [
      'heating', 'not heating', 'no heat', 'furnace',
      'heater', 'thermostat', 'cold house'
    ],
    priority: 10,
    confidenceThreshold: 0.70,
    matchRules: {
      keywords: ['heating', 'heat', 'furnace', 'heater', 'thermostat'],
      ruleIdPatterns: ['heating', 'furnace', 'thermostat']
    }
  },
  {
    bucketId: 'scheduling',
    name: 'Scheduling & Appointments',
    icon: '📅',
    description: 'Book service, schedule appointment, maintenance',
    classificationKeywords: [
      'schedule', 'appointment', 'book', 'booking',
      'service call', 'maintenance', 'visit'
    ],
    priority: 20,
    confidenceThreshold: 0.70,
    matchRules: {
      keywords: ['schedule', 'appointment', 'book', 'booking', 'maintenance'],
      ruleIdPatterns: ['booking', 'schedule', 'appointment', 'maintenance']
    }
  },
  {
    bucketId: 'billing',
    name: 'Billing & Payments',
    icon: '💰',
    description: 'Invoices, charges, payment questions',
    classificationKeywords: [
      'bill', 'invoice', 'charge', 'payment', 'cost',
      'price', 'how much', 'estimate'
    ],
    priority: 30,
    confidenceThreshold: 0.70,
    matchRules: {
      keywords: ['bill', 'invoice', 'charge', 'payment', 'cost', 'price'],
      ruleIdPatterns: ['billing', 'payment', 'price', 'cost']
    }
  },
  {
    bucketId: 'emergency',
    name: 'Emergency',
    icon: '🚨',
    description: 'Gas leaks, no heat in winter, safety issues',
    classificationKeywords: [
      'emergency', 'gas', 'leak', 'smoke', 'fire',
      'carbon monoxide', 'co alarm', 'flooding'
    ],
    priority: 1,
    confidenceThreshold: 0.50,  // Lower threshold for emergencies
    alwaysEvaluate: true,  // Always active
    matchRules: {
      keywords: ['emergency', 'gas', 'leak', 'smoke', 'fire', 'carbon', 'monoxide'],
      ruleIdPatterns: ['emergency', 'gas', 'leak']
    }
  }
];

async function setupDefaultBuckets(companyId, apply = false) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🚀 SETUP DEFAULT BUCKETS FOR HVAC COMPANY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log(`Company ID: ${companyId}`);
  console.log(`Mode: ${apply ? 'APPLY (will create)' : 'DRY RUN (preview only)'}\n`);
  
  try {
    // Connect
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Load existing buckets and triggers
    const existingBuckets = await TriggerBucket.find({ companyId }).lean();
    const triggers = await CompanyLocalTrigger.findActiveByCompanyId(companyId);
    
    console.log(`Existing buckets: ${existingBuckets.length}`);
    console.log(`Active triggers: ${triggers.length}\n`);
    
    if (existingBuckets.length > 0) {
      console.log('⚠️  Company already has buckets:');
      existingBuckets.forEach(b => {
        console.log(`   - ${b.icon} ${b.name} (${b.bucketId})`);
      });
      console.log('');
      
      if (!confirm('Continue and create more buckets? (y/n) ')) {
        console.log('Aborted.\n');
        process.exit(0);
      }
    }
    
    // ────────────────────────────────────────────────────────────────────
    // CREATE BUCKETS
    // ────────────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('STEP 1: Create Buckets');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    const createdBuckets = [];
    
    for (const template of DEFAULT_HVAC_BUCKETS) {
      // Check if bucket already exists
      const exists = existingBuckets.find(b => b.bucketId === template.bucketId);
      if (exists) {
        console.log(`⏭️  Skipped: ${template.name} (already exists)\n`);
        createdBuckets.push(exists);
        continue;
      }
      
      console.log(`📦 ${template.icon} ${template.name}`);
      console.log(`   ID: ${template.bucketId}`);
      console.log(`   Keywords: ${template.classificationKeywords.join(', ')}`);
      console.log(`   Priority: ${template.priority}`);
      console.log(`   Threshold: ${Math.round(template.confidenceThreshold * 100)}%`);
      console.log(`   Always Evaluate: ${template.alwaysEvaluate ? 'YES' : 'NO'}`);
      
      if (apply) {
        const bucket = await TriggerBucket.create({
          companyId,
          ...template
        });
        createdBuckets.push(bucket);
        console.log(`   ✅ Created`);
      } else {
        console.log(`   [Would create]`);
      }
      console.log('');
    }
    
    if (!apply) {
      console.log('─────────────────────────────────────────────────────────────────');
      console.log('This was a DRY RUN. No changes were made.');
      console.log('Run with --apply to actually create these buckets.\n');
      console.log(`Command: node scripts/setup-default-buckets.js ${companyId} --apply\n`);
      process.exit(0);
    }
    
    // ────────────────────────────────────────────────────────────────────
    // AUTO-ASSIGN TRIGGERS
    // ────────────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('STEP 2: Auto-Assign Triggers to Buckets');
    console.log('─────────────────────────────────────────────────────────────────\n');
    
    const assignments = [];
    
    for (const trigger of triggers) {
      // Skip if already assigned
      if (trigger.bucket || trigger.alwaysEvaluate) {
        continue;
      }
      
      // Try to match to a bucket
      const triggerKeywords = (trigger.keywords || []).join(' ').toLowerCase();
      const triggerRuleId = (trigger.ruleId || '').toLowerCase();
      
      let matchedBucket = null;
      let matchScore = 0;
      
      for (const template of DEFAULT_HVAC_BUCKETS) {
        // Score based on keyword overlap
        const matchedKeywords = template.matchRules.keywords.filter(kw => 
          triggerKeywords.includes(kw)
        );
        
        // Score based on ruleId patterns
        const matchedPatterns = template.matchRules.ruleIdPatterns.filter(pattern =>
          triggerRuleId.includes(pattern)
        );
        
        const score = matchedKeywords.length + (matchedPatterns.length * 2);
        
        if (score > matchScore) {
          matchScore = score;
          matchedBucket = template.bucketId;
        }
      }
      
      if (matchedBucket && matchScore > 0) {
        assignments.push({
          ruleId: trigger.ruleId,
          label: trigger.label,
          bucket: matchedBucket,
          score: matchScore
        });
      }
    }
    
    if (assignments.length === 0) {
      console.log('No triggers to auto-assign (all already have buckets)\n');
    } else {
      console.log(`Found ${assignments.length} triggers to auto-assign:\n`);
      
      assignments.forEach(a => {
        console.log(`  ${a.label} → ${a.bucket} (score: ${a.score})`);
      });
      console.log('');
      
      // Apply assignments
      for (const assignment of assignments) {
        await CompanyLocalTrigger.updateOne(
          { companyId, ruleId: assignment.ruleId },
          { $set: { bucket: assignment.bucket, bucketValidatedAt: new Date() } }
        );
      }
      
      console.log(`✅ Auto-assigned ${assignments.length} triggers\n`);
    }
    
    // ────────────────────────────────────────────────────────────────────
    // FINAL STATUS
    // ────────────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ SETUP COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('What was created:');
    console.log(`  Buckets: ${createdBuckets.length}`);
    console.log(`  Auto-assigned triggers: ${assignments.length}`);
    console.log('');
    
    console.log('Next steps:');
    console.log('1. Go to Admin Console → Triggers');
    console.log('2. Click "🗂️ Manage Buckets" to review buckets');
    console.log('3. Check bucket health bar - should show improved coverage');
    console.log('4. Assign remaining unbucketed triggers');
    console.log('5. Test with a call to verify bucket classification\n');
    
    console.log('To test bucket system:');
    console.log(`  node scripts/test-bucket-system.js ${companyId}\n`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ SETUP FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const companyId = process.argv[2];
const apply = process.argv.includes('--apply');

if (!companyId) {
  console.error('Usage: node scripts/setup-default-buckets.js <companyId> [--apply]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/setup-default-buckets.js 68e3f77a9d623b8058c700c4          # Dry run');
  console.error('  node scripts/setup-default-buckets.js 68e3f77a9d623b8058c700c4 --apply  # Create buckets');
  process.exit(1);
}

setupDefaultBuckets(companyId, apply);
