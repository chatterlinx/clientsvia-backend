#!/usr/bin/env node
/**
 * Get Company ID - Helper to find company IDs
 * 
 * Usage:
 *   node scripts/get-company-id.js
 *   node scripts/get-company-id.js "Company Name"
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function getCompanyId(searchName = null) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    let query = {};
    if (searchName) {
      // Case-insensitive search in both companyName and businessName
      query = {
        $or: [
          { companyName: new RegExp(searchName, 'i') },
          { businessName: new RegExp(searchName, 'i') }
        ]
      };
    }
    
    const companies = await Company.find(query)
      .select('_id companyName businessName status')
      .limit(20)
      .lean();
    
    if (companies.length === 0) {
      console.log('❌ No companies found');
      if (searchName) {
        console.log(`   Searched for: "${searchName}"`);
        console.log('\n💡 Try running without a search term to see all companies');
      }
      process.exit(1);
    }
    
    console.log(`Found ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}:\n`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    companies.forEach((company, index) => {
      console.log(`${index + 1}. ${company.companyName || company.businessName}`);
      console.log(`   ID: ${company._id}`);
      console.log(`   Business Name: ${company.businessName || 'N/A'}`);
      console.log(`   Status: ${company.status || 'unknown'}`);
      console.log('');
    });
    
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('💡 To diagnose triggers for a company, copy the ID and run:\n');
    console.log('   node scripts/diagnose-trigger-issue.js <COMPANY_ID>');
    console.log('\n   Example:');
    console.log(`   node scripts/diagnose-trigger-issue.js ${companies[0]._id}\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const searchName = process.argv[2];
getCompanyId(searchName);
