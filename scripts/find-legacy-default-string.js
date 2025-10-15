#!/usr/bin/env node
/**
 * ============================================================================
 * FIND LEGACY "default" STRING
 * ============================================================================
 * Hunt down EVERY instance of string 'default' in Royal Plumbing
 * ============================================================================
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function findLegacyDefaults() {
    try {
        console.log('🔍 HUNTING FOR LEGACY "default" STRINGS\n');

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const companyId = '68eeaf924e989145e9d46c12';
        const db = mongoose.connection.db;
        const collection = db.collection('companiesCollection');

        // Get raw document WITHOUT Mongoose schema processing
        const company = await collection.findOne({ _id: new mongoose.Types.ObjectId(companyId) });

        if (!company) {
            console.log('❌ Company not found!');
            process.exit(1);
        }

        console.log(`📋 Company: ${company.companyName || company.businessName}\n`);

        // Recursive function to find all 'default' strings
        function findDefaultStrings(obj, path = '') {
            const results = [];

            if (typeof obj === 'string' && obj === 'default') {
                results.push(path);
            } else if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    results.push(...findDefaultStrings(item, `${path}[${index}]`));
                });
            } else if (obj && typeof obj === 'object') {
                Object.keys(obj).forEach(key => {
                    results.push(...findDefaultStrings(obj[key], path ? `${path}.${key}` : key));
                });
            }

            return results;
        }

        const foundPaths = findDefaultStrings(company);

        console.log('🔍 FOUND "default" STRINGS AT:');
        console.log('='.repeat(80));

        if (foundPaths.length === 0) {
            console.log('✅ No "default" strings found!');
        } else {
            foundPaths.forEach(path => {
                console.log(`❌ ${path}`);
                
                // Get the value at this path
                const parts = path.split('.').filter(p => !p.includes('['));
                let value = company;
                for (const part of parts) {
                    if (value) value = value[part];
                }
                console.log(`   Value: "${value}"`);
                console.log('');
            });
        }

        // Also check specifically for problematic fields
        console.log('\n📊 SPECIFIC FIELD CHECKS:');
        console.log('='.repeat(80));

        const checksmsSettings =company.smsSettings;
        console.log('\nsmsSettings:', checksmsSettings);

        const checkAgentSetup = company.agentSetup;
        console.log('\nagentSetup:', JSON.stringify(checkAgentSetup, null, 2));

        const checkAiAgentLogic = company.aiAgentLogic;
        console.log('\naiAgentLogic keys:', Object.keys(checkAiAgentLogic || {}));

        if (checkAiAgentLogic) {
            console.log('\naiAgentLogic.voiceSettings:', checkAiAgentLogic.voiceSettings);
            console.log('\naiAgentLogic.connectionMessages:', checkAiAgentLogic.connectionMessages);
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

findLegacyDefaults();

