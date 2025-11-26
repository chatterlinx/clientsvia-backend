#!/usr/bin/env node
/**
 * EMERGENCY FIX: Enable AI Agent for Marc's company
 * This script connects directly to production MongoDB and flips the switch
 */

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://marcclinton90:NasaShuttle2500@clientsvia.hhivq.mongodb.net/clientsvia?retryWrites=true&w=majority&appName=ClientsVia';
const COMPANY_ID = '68e3f77a9d623b8058c700c4';

async function emergencyFix() {
  const mongoose = require('mongoose');
  
  try {
    console.log('🔌 Connecting to production MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to production\n');
    
    const Company = require('../models/v2Company');
    
    const company = await Company.findById(COMPANY_ID);
    
    if (!company) {
      console.log('❌ Company not found:', COMPANY_ID);
      process.exit(1);
    }
    
    console.log('📊 BEFORE:');
    console.log('  Company:', company.businessName || company.companyName);
    console.log('  aiAgentSettings exists:', !!company.aiAgentSettings);
    console.log('  aiAgentSettings.enabled:', company.aiAgentSettings?.enabled);
    console.log('');
    
    // FORCE ENABLE
    if (!company.aiAgentSettings) {
      company.aiAgentSettings = {};
    }
    
    company.aiAgentSettings.enabled = true;
    company.markModified('aiAgentSettings');
    await company.save();
    
    console.log('✅ FIXED:');
    console.log('  aiAgentSettings.enabled = TRUE');
    console.log('');
    console.log('🎯 TRY CALLING NOW - GREETING SHOULD WORK');
    
    await mongoose.disconnect();
    process.exit(0);
    
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

emergencyFix();

