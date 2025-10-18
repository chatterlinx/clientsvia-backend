#!/usr/bin/env node

/**
 * Check Twilio credentials for a company
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function checkTwilioCredentials(companyId) {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const company = await Company.findById(companyId);
        
        if (!company) {
            console.log('❌ Company not found');
            return;
        }

        console.log(`\n📊 Company: ${company.businessName || company.companyName}`);
        console.log(`📧 ID: ${company._id}`);
        console.log(`\n🔐 TWILIO CREDENTIALS CHECK:`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        const twilioConfig = company.twilioConfig || {};
        
        // Check Account SID
        console.log(`\n1️⃣ Account SID:`);
        if (twilioConfig.accountSid) {
            console.log(`   ✅ SET: ${twilioConfig.accountSid.substring(0, 10)}...${twilioConfig.accountSid.slice(-4)}`);
        } else {
            console.log(`   ❌ NOT SET`);
        }

        // Check Auth Token
        console.log(`\n2️⃣ Auth Token:`);
        if (twilioConfig.authToken) {
            console.log(`   ✅ SET: ****** (last 4: ${twilioConfig.authToken.slice(-4)})`);
        } else {
            console.log(`   ❌ NOT SET`);
        }

        // Check Phone Numbers
        console.log(`\n3️⃣ Phone Numbers:`);
        if (twilioConfig.phoneNumbers && twilioConfig.phoneNumbers.length > 0) {
            console.log(`   ✅ ${twilioConfig.phoneNumbers.length} number(s):`);
            twilioConfig.phoneNumbers.forEach((num, i) => {
                console.log(`      ${i + 1}. ${num}`);
            });
        } else if (twilioConfig.phoneNumber) {
            console.log(`   ✅ LEGACY: ${twilioConfig.phoneNumber}`);
        } else {
            console.log(`   ❌ NO PHONE NUMBERS`);
        }

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

// Get company ID from command line
const companyId = process.argv[2];

if (!companyId) {
    console.error('Usage: node check-twilio-credentials.js <companyId>');
    process.exit(1);
}

checkTwilioCredentials(companyId);

