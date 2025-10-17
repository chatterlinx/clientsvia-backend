#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function listCompanies() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const companies = await Company.find({ deletedAt: { $exists: false } })
            .select('_id companyName businessName accountStatus.status')
            .limit(20)
            .lean();
        
        console.log(`📋 Found ${companies.length} companies:\n`);
        
        companies.forEach((company, i) => {
            const name = company.companyName || company.businessName || 'Unnamed';
            const status = company.accountStatus?.status || 'unknown';
            console.log(`${i + 1}. ${name}`);
            console.log(`   ID: ${company._id}`);
            console.log(`   Status: ${status}\n`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

listCompanies();

