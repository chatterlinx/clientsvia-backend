#!/usr/bin/env node
/**
 * DIAGNOSTIC SCRIPT: Check Intelligence Mode for Company
 * 
 * Purpose: Diagnose intelligence mode data mismatch between frontend and backend
 * 
 * Usage: node scripts/check-company-intelligence-mode.js <companyId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

const COMPANY_ID = process.argv[2] || '68e3f77a9d623b8058c700c4';

async function checkIntelligenceMode() {
    try {
        console.log('🔍 [DIAGNOSTIC] Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ [DIAGNOSTIC] Connected to MongoDB');

        console.log(`\n🔍 [DIAGNOSTIC] Fetching company: ${COMPANY_ID}`);
        const company = await Company.findById(COMPANY_ID);

        if (!company) {
            console.log('❌ [DIAGNOSTIC] Company not found');
            process.exit(1);
        }

        console.log('\n📊 [DIAGNOSTIC] Company Intelligence Mode Data:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Company Name: ${company.name}`);
        console.log(`Company ID: ${company._id}`);
        console.log(`Intelligence Mode (field value): ${company.intelligenceMode}`);
        console.log(`Intelligence Mode (type): ${typeof company.intelligenceMode}`);
        console.log(`Intelligence Mode (exists in doc): ${company.toObject().hasOwnProperty('intelligenceMode')}`);
        console.log(`Has aiAgentLogic: ${!!company.aiAgentLogic}`);
        console.log(`aiAgentLogic Keys: ${company.aiAgentLogic ? Object.keys(company.aiAgentLogic).join(', ') : 'N/A'}`);
        
        if (company.intelligenceModeHistory && company.intelligenceModeHistory.length > 0) {
            console.log(`\nIntelligence Mode History (${company.intelligenceModeHistory.length} entries):`);
            company.intelligenceModeHistory.forEach((entry, index) => {
                console.log(`  ${index + 1}. ${entry.mode} - ${entry.switchedBy} - ${entry.switchedAt}`);
            });
        } else {
            console.log('\nIntelligence Mode History: None');
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Check raw MongoDB document
        console.log('\n📦 [DIAGNOSTIC] Raw MongoDB Document (intelligenceMode field):');
        const rawDoc = await mongoose.connection.db
            .collection('companies')
            .findOne({ _id: mongoose.Types.ObjectId(COMPANY_ID) });
        
        if (rawDoc) {
            console.log(`Raw intelligenceMode value: ${rawDoc.intelligenceMode}`);
            console.log(`Raw intelligenceMode exists: ${rawDoc.hasOwnProperty('intelligenceMode')}`);
        } else {
            console.log('❌ Raw document not found in companies collection');
            
            // Try companiesCollection
            const rawDoc2 = await mongoose.connection.db
                .collection('companiesCollection')
                .findOne({ _id: mongoose.Types.ObjectId(COMPANY_ID) });
            
            if (rawDoc2) {
                console.log('✅ Found in companiesCollection');
                console.log(`Raw intelligenceMode value: ${rawDoc2.intelligenceMode}`);
                console.log(`Raw intelligenceMode exists: ${rawDoc2.hasOwnProperty('intelligenceMode')}`);
            }
        }

        console.log('\n✅ [DIAGNOSTIC] Check complete');
        process.exit(0);
    } catch (error) {
        console.error('❌ [DIAGNOSTIC] Error:', error);
        process.exit(1);
    }
}

checkIntelligenceMode();

