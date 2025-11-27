#!/usr/bin/env node

/**
 * 🔍 DIAGNOSTIC SCRIPT: Phone Number to Company Mapping
 * 
 * This script checks which company is associated with phone +12392322030
 * and shows all Twilio-configured companies
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/Company');

async function diagnose() {
  try {
    console.log('\n🔍 DIAGNOSING PHONE NUMBER TO COMPANY MAPPING\n');
    console.log('═'.repeat(80));
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Target phone number from the logs
    const targetPhone = '+12392322030';
    console.log(`🎯 TARGET PHONE NUMBER: ${targetPhone}\n`);
    
    // Find all companies with Twilio config
    const allCompanies = await Company.find({
      $or: [
        { 'twilioConfig.phoneNumber': { $exists: true, $ne: null } },
        { 'twilioConfig.phoneNumbers': { $exists: true, $ne: [] } }
      ]
    }).select('_id companyName businessName twilioConfig aiAgentSettings').lean();
    
    console.log(`📋 Found ${allCompanies.length} companies with Twilio configuration:\n`);
    
    let targetCompany = null;
    
    for (const company of allCompanies) {
      const companyId = company._id.toString();
      const name = company.businessName || company.companyName || 'Unnamed';
      const hasV2Enabled = Boolean(company.aiAgentSettings?.enabled);
      
      console.log(`─`.repeat(80));
      console.log(`🏢 ${name}`);
      console.log(`   ID: ${companyId}`);
      console.log(`   V2 Agent Enabled: ${hasV2Enabled ? '✅ YES' : '❌ NO'}`);
      
      // Check single phoneNumber field
      if (company.twilioConfig?.phoneNumber) {
        console.log(`   📞 Phone: ${company.twilioConfig.phoneNumber}`);
        if (company.twilioConfig.phoneNumber === targetPhone) {
          console.log(`   🎯 *** THIS IS THE MATCH FOR ${targetPhone} ***`);
          targetCompany = company;
        }
      }
      
      // Check phoneNumbers array
      if (company.twilioConfig?.phoneNumbers && Array.isArray(company.twilioConfig.phoneNumbers)) {
        console.log(`   📞 Phone Numbers Array (${company.twilioConfig.phoneNumbers.length}):`);
        company.twilioConfig.phoneNumbers.forEach((phoneObj, idx) => {
          console.log(`      ${idx + 1}. ${phoneObj.phoneNumber} (${phoneObj.label || 'No label'})`);
          if (phoneObj.phoneNumber === targetPhone) {
            console.log(`      🎯 *** THIS IS THE MATCH FOR ${targetPhone} ***`);
            targetCompany = company;
          }
        });
      }
      
      console.log('');
    }
    
    console.log(`═`.repeat(80));
    console.log('\n📊 DIAGNOSIS RESULTS:\n');
    
    if (targetCompany) {
      const companyId = targetCompany._id.toString();
      const name = targetCompany.businessName || targetCompany.companyName || 'Unnamed';
      const hasV2Enabled = Boolean(targetCompany.aiAgentSettings?.enabled);
      
      console.log(`✅ Phone ${targetPhone} is mapped to:`);
      console.log(`   Company: ${name}`);
      console.log(`   ID: ${companyId}`);
      console.log(`   V2 Agent Enabled: ${hasV2Enabled ? '✅ YES' : '❌ NO (THIS IS THE PROBLEM!)'}`);
      
      if (!hasV2Enabled) {
        console.log('\n🔥 PROBLEM IDENTIFIED:');
        console.log(`   The company mapped to ${targetPhone} does NOT have V2 Agent enabled!`);
        console.log(`   This is why you're hearing "Configuration error: Company must configure V2 Agent Personality"`);
        console.log('\n💡 SOLUTION:');
        console.log(`   1. Enable V2 Agent for company: ${companyId}`);
        console.log(`   2. OR reconfigure your Twilio phone number to point to the correct company`);
        console.log(`   3. OR update the phone number in the correct company's Twilio config`);
      } else {
        console.log('\n✅ This company has V2 Agent enabled. The issue might be elsewhere.');
      }
      
      console.log(`\n📝 Twilio should use this action URL:`);
      console.log(`   https://clientsvia-backend.onrender.com/api/twilio/voice`);
      console.log(`   (It will auto-lookup company by phone number)`);
      console.log(`\n   OR`);
      console.log(`   https://clientsvia-backend.onrender.com/api/twilio/voice/${companyId}`);
      console.log(`   (Direct to company by ID)`);
      
    } else {
      console.log(`❌ Phone ${targetPhone} is NOT configured in any company!`);
      console.log('\n🔥 PROBLEM IDENTIFIED:');
      console.log(`   No company has ${targetPhone} in their Twilio configuration!`);
      console.log('\n💡 SOLUTION:');
      console.log(`   Add ${targetPhone} to the correct company's Twilio configuration`);
    }
    
    console.log('\n' + `═`.repeat(80) + '\n');
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

diagnose();

