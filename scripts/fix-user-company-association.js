#!/usr/bin/env node
/**
 * Diagnostic and Fix Script: User Company Association
 * 
 * Problem: User 6887a36b8e85a49918736de8 has no companyId
 * Solution: Either assign to a company or mark as admin with global access
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/v2User');
const Company = require('../models/v2Company');

async function diagnoseAndFix() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const userId = '6887a36b8e85a49918736de8';

    // 1. Get the user
    const user = await User.findById(userId);
    if (!user) {
      console.error('❌ User not found!');
      process.exit(1);
    }

    console.log('👤 User Details:');
    console.log('   ID:', user._id);
    console.log('   Email:', user.email);
    console.log('   Name:', user.name);
    console.log('   Role:', user.role);
    console.log('   Status:', user.status);
    console.log('   CompanyId:', user.companyId);
    console.log('   CompanyId Type:', typeof user.companyId);
    console.log();

    // 2. Check if user has a company
    if (user.companyId) {
      console.log('✅ User already has a company association');
      const company = await Company.findById(user.companyId);
      if (company) {
        console.log('   Company Name:', company.companyName);
        console.log('   Company Status:', company.status);
      } else {
        console.log('⚠️  Company reference exists but company not found in database!');
        console.log('   This is a BROKEN REFERENCE and needs fixing.');
      }
      process.exit(0);
    }

    // 3. User has NO company - offer solutions
    console.log('❌ PROBLEM: User has NO company association\n');
    console.log('📋 Available Solutions:\n');
    console.log('Option 1: Assign to an existing company');
    console.log('Option 2: Make this a true admin (no company required)\n');

    // Get all companies
    const companies = await Company.find({ status: 'active' }).select('companyName businessPhone email');
    
    if (companies.length === 0) {
      console.log('⚠️  No active companies found!');
      console.log('   You need to create a company first or make this user a global admin.\n');
      console.log('RECOMMENDATION: If this is your main admin account, it should be role: "admin"');
      console.log('                and can optionally have no companyId for global access.');
      process.exit(0);
    }

    console.log(`Found ${companies.length} active companies:\n`);
    companies.forEach((company, index) => {
      console.log(`${index + 1}. ${company.companyName} (${company.email || company.businessPhone})`);
      console.log(`   ID: ${company._id}`);
    });
    console.log();

    // Auto-assign to first company if only one exists
    if (companies.length === 1) {
      console.log('🔧 AUTO-FIX: Only one company exists, assigning user to this company...\n');
      
      user.companyId = companies[0]._id;
      await user.save();

      console.log('✅ User successfully assigned to company:');
      console.log('   Company:', companies[0].companyName);
      console.log('   Company ID:', companies[0]._id);
      console.log();
      console.log('🎉 Problem fixed! User now has proper company association.');
    } else {
      console.log('⚠️  Multiple companies exist. Please choose one:\n');
      console.log('To assign user to a company, run:');
      console.log(`   node scripts/assign-user-to-company.js ${userId} <COMPANY_ID>`);
      console.log();
      console.log('Or if this should be a global admin (no company), that\'s OK for admin role.');
      console.log('However, most endpoints require a company association.');
    }

  } catch (error) {
    console.error('❌ Script error:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

diagnoseAndFix();

