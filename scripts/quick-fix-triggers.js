#!/usr/bin/env node
/**
 * Quick Trigger Fix - One command to diagnose and fix
 * 
 * This script:
 * 1. Lists all companies
 * 2. For each company, checks trigger state
 * 3. Offers to fix any issues found
 * 
 * Usage:
 *   node scripts/quick-fix-triggers.js
 */

const mongoose = require('mongoose');

// Try to get MongoDB URI from environment or require the db module
let MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.log('⚠️  MONGODB_URI not in environment, trying to load from .env...\n');
  try {
    require('dotenv').config();
    MONGODB_URI = process.env.MONGODB_URI;
  } catch (err) {
    // dotenv might not be installed, that's ok
  }
}

if (!MONGODB_URI) {
  console.error('❌ ERROR: MONGODB_URI not found!');
  console.error('');
  console.error('Please set MONGODB_URI environment variable or create a .env file');
  console.error('');
  console.error('On Render server, run:');
  console.error('  export MONGODB_URI="your_mongodb_connection_string"');
  console.error('  node scripts/quick-fix-triggers.js');
  console.error('');
  console.error('Or get the URI from Render dashboard → Environment Variables');
  process.exit(1);
}

const Company = require('../models/v2Company');
const CompanyLocalTrigger = require('../models/CompanyLocalTrigger');
const TriggerService = require('../services/engine/agent2/TriggerService');

async function quickFix() {
  try {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔧 QUICK TRIGGER FIX - Find and Fix Trigger Issues');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Connect
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get all active companies
    const companies = await Company.find({ status: 'active' })
      .select('_id companyName businessName')
      .limit(50)
      .lean();
    
    console.log(`Found ${companies.length} active companies\n`);
    console.log('───────────────────────────────────────────────────────────────\n');
    
    const issues = [];
    
    for (const company of companies) {
      const companyId = company._id.toString();
      const name = company.companyName || company.businessName || 'Unknown';
      
      console.log(`📋 ${name} (${companyId})`);
      
      // Check all triggers
      const allTriggers = await CompanyLocalTrigger.find({ 
        companyId,
        isDeleted: { $ne: true }
      }).lean();
      
      // Check runtime-visible triggers
      const visibleTriggers = await CompanyLocalTrigger.findActiveByCompanyId(companyId);
      
      const total = allTriggers.length;
      const visible = visibleTriggers.length;
      const enabled = allTriggers.filter(t => t.enabled === true).length;
      const published = allTriggers.filter(t => t.state === 'published').length;
      const enabledButNotPublished = allTriggers.filter(
        t => t.enabled === true && t.state !== 'published'
      ).length;
      
      console.log(`   Total: ${total}, Enabled: ${enabled}, Published: ${published}, Visible: ${visible}`);
      
      if (enabledButNotPublished > 0) {
        console.log(`   🚨 ISSUE: ${enabledButNotPublished} enabled triggers NOT published!`);
        issues.push({
          companyId,
          name,
          total,
          enabled,
          visible,
          enabledButNotPublished,
          triggers: allTriggers.filter(t => t.enabled === true && t.state !== 'published')
        });
      } else if (visible === 0 && enabled > 0) {
        console.log(`   ⚠️  WARNING: ${enabled} enabled triggers but 0 visible (check state)`);
        issues.push({
          companyId,
          name,
          total,
          enabled,
          visible,
          enabledButNotPublished: 0,
          triggers: allTriggers.filter(t => t.enabled === true)
        });
      } else if (visible > 0) {
        console.log(`   ✅ OK - ${visible} triggers visible at runtime`);
      } else {
        console.log(`   ℹ️  No triggers configured`);
      }
      
      console.log('');
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    if (issues.length === 0) {
      console.log('✅✅✅ ALL COMPANIES HEALTHY! ✅✅✅\n');
      console.log('No trigger issues found.\n');
      process.exit(0);
    }
    
    console.log(`❌ Found issues in ${issues.length} compan${issues.length === 1 ? 'y' : 'ies'}:\n`);
    
    issues.forEach((issue, idx) => {
      console.log(`${idx + 1}. ${issue.name}`);
      console.log(`   Company ID: ${issue.companyId}`);
      console.log(`   Problem: ${issue.enabledButNotPublished} enabled triggers not published`);
      console.log(`   Impact: Triggers invisible at runtime → all calls fall to LLM`);
      console.log('');
    });
    
    console.log('───────────────────────────────────────────────────────────────');
    console.log('🔧 AUTOMATIC FIX AVAILABLE');
    console.log('───────────────────────────────────────────────────────────────\n');
    
    const shouldFix = process.argv.includes('--fix') || process.argv.includes('-y');
    
    if (shouldFix) {
      console.log('Fixing all issues...\n');
      
      for (const issue of issues) {
        console.log(`Fixing ${issue.name}...`);
        
        const result = await CompanyLocalTrigger.updateMany(
          {
            companyId: issue.companyId,
            enabled: true,
            state: { $ne: 'published' }
          },
          {
            $set: { state: 'published' }
          }
        );
        
        console.log(`   ✅ Updated ${result.modifiedCount} triggers to 'published'`);
        
        // Invalidate cache
        TriggerService.invalidateCacheForCompany(issue.companyId);
        console.log(`   ✅ Cache cleared\n`);
      }
      
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('✅ ALL FIXES APPLIED!');
      console.log('═══════════════════════════════════════════════════════════════\n');
      console.log('Next steps:');
      console.log('1. Test a call to verify triggers now match');
      console.log('2. Check Call Console for trigger events\n');
      
    } else {
      console.log('To fix all issues automatically, run:\n');
      console.log('  node scripts/quick-fix-triggers.js --fix\n');
      console.log('This will:');
      console.log('- Set state: "published" for all enabled triggers');
      console.log('- Clear trigger cache');
      console.log('- Make triggers immediately visible\n');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

quickFix();
