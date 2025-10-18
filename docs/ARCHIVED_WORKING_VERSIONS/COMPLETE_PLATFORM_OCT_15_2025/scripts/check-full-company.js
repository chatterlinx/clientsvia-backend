#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function checkCompany(companyId) {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const company = await Company.findById(companyId);
        
        console.log('\n📋 FULL TWILIO CONFIG:');
        console.log(JSON.stringify(company.twilioConfig, null, 2));
        
        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkCompany('68813026dd95f599c74e49c7');

