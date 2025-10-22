#!/usr/bin/env node

/**
 * Diagnose All Companies
 * Shows all companies including deleted ones
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function diagnoseCompanies() {
    try {
        console.log('🔧 Connecting to MongoDB...');
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Find ALL companies (including deleted)
        const companies = await Company.find({});
        
        console.log(`📊 TOTAL COMPANIES IN DATABASE: ${companies.length}\n`);
        console.log('='.repeat(80));
        
        for (const company of companies) {
            console.log(`\nCompany: ${company.companyName || 'UNNAMED'}`);
            console.log(`  ID: ${company._id}`);
            console.log(`  isDeleted: ${company.isDeleted || false}`);
            console.log(`  accountStatus.status: ${company.accountStatus?.status || 'UNDEFINED'}`);
            console.log(`  createdAt: ${company.createdAt}`);
            console.log(`  deletedAt: ${company.deletedAt || 'N/A'}`);
        }
        
        console.log(`\n${  '='.repeat(80)}`);
        console.log('\n📊 SUMMARY:');
        
        const total = companies.length;
        const deleted = companies.filter(c => c.isDeleted === true).length;
        const active = companies.filter(c => !c.isDeleted && c.accountStatus?.status === 'active').length;
        const suspended = companies.filter(c => !c.isDeleted && c.accountStatus?.status === 'suspended').length;
        const callForward = companies.filter(c => !c.isDeleted && c.accountStatus?.status === 'call_forward').length;
        const undefined = companies.filter(c => !c.isDeleted && !c.accountStatus?.status).length;
        
        console.log(`  Total: ${total}`);
        console.log(`  Deleted: ${deleted}`);
        console.log(`  Active (non-deleted): ${active}`);
        console.log(`  Suspended (non-deleted): ${suspended}`);
        console.log(`  Call Forward (non-deleted): ${callForward}`);
        console.log(`  Undefined Status (non-deleted): ${undefined}`);
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MongoDB');
    }
}

diagnoseCompanies();

