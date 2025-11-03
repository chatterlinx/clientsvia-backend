#!/usr/bin/env node
/**
 * Utility Script: Assign User to Company
 * 
 * Usage: node scripts/assign-user-to-company.js <USER_ID> <COMPANY_ID>
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/v2User');
const Company = require('../models/v2Company');

async function assignUserToCompany(userId, companyId) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Validate inputs
    if (!userId || !companyId) {
      console.error('❌ Usage: node scripts/assign-user-to-company.js <USER_ID> <COMPANY_ID>');
      process.exit(1);
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      console.error(`❌ User not found: ${userId}`);
      process.exit(1);
    }

    // Find company
    const company = await Company.findById(companyId);
    if (!company) {
      console.error(`❌ Company not found: ${companyId}`);
      process.exit(1);
    }

    console.log('👤 User:', user.email, `(${user.name})`);
    console.log('🏢 Company:', company.companyName);
    console.log();

    // Assign
    user.companyId = company._id;
    await user.save();

    console.log('✅ User successfully assigned to company!');
    console.log();
    console.log('Updated User:');
    console.log('   Email:', user.email);
    console.log('   Role:', user.role);
    console.log('   CompanyId:', user.companyId);
    console.log('   Company Name:', company.companyName);

  } catch (error) {
    console.error('❌ Script error:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

const userId = process.argv[2];
const companyId = process.argv[3];

assignUserToCompany(userId, companyId);

