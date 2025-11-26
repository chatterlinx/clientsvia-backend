#!/usr/bin/env node
/**
 * Quick fix script: Enable AI Agent for a company
 * Usage: node scripts/fix-aiagent-enabled.js
 */

const { connectDB } = require('../db');
const Company = require('../models/v2Company');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Marc's company

async function fixAIAgentEnabled() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected\n');
    
    const company = await Company.findById(COMPANY_ID);
    
    if (!company) {
      console.log('❌ Company not found:', COMPANY_ID);
      process.exit(1);
    }
    
    console.log('📊 CURRENT STATE:');
    console.log('  Company Name:', company.businessName || company.companyName);
    console.log('  aiAgentSettings exists:', !!company.aiAgentSettings);
    console.log('  aiAgentSettings.enabled:', company.aiAgentSettings?.enabled);
    console.log('');
    
    if (!company.aiAgentSettings || company.aiAgentSettings.enabled !== true) {
      console.log('🔧 FIXING: Setting aiAgentSettings.enabled = true');
      
      if (!company.aiAgentSettings) {
        company.aiAgentSettings = {};
      }
      
      company.aiAgentSettings.enabled = true;
      company.markModified('aiAgentSettings');
      await company.save();
      
      console.log('✅ FIXED: aiAgentSettings.enabled = true');
      console.log('');
      console.log('🎯 Try calling your agent now - greeting should work!');
    } else {
      console.log('✅ Already enabled - no fix needed');
      console.log('');
      console.log('⚠️  If greeting still not working, check:');
      console.log('   1. connectionMessages.voice.text is set');
      console.log('   2. Redis cache was cleared');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

fixAIAgentEnabled();

