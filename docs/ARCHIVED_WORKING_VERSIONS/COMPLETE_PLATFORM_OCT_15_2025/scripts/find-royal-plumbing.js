#!/usr/bin/env node
const mongoose = require('mongoose');
const Company = require('../models/v2Company');
require('dotenv').config();

async function findRoyalPlumbing() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find Royal Plumbing
        const companies = await Company.find({
            $or: [
                { companyName: /royal/i },
                { businessName: /royal/i }
            ]
        }).select('_id companyName businessName createdAt');

        console.log(`Found ${companies.length} companies:\n`);
        companies.forEach(c => {
            console.log(`ID: ${c._id}`);
            console.log(`Name: ${c.companyName || c.businessName}`);
            console.log(`Created: ${c.createdAt}`);
            console.log('---');
        });

        // Also find all companies
        const allCompanies = await Company.find({}).select('_id companyName businessName');
        console.log(`\nAll companies (${allCompanies.length} total):`);
        allCompanies.forEach(c => {
            console.log(`${c._id} - ${c.companyName || c.businessName}`);
        });

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

findRoyalPlumbing();

