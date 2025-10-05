/**
 * 🔍 INSPECT SPECIFIC COMPANY
 * ===========================
 * 
 * MISSION: Inspect the exact company document that's showing legacy data
 * TARGET: Company ID 68813026dd95f599c74e49c7 (from the logs)
 */

const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

async function connectToMongoDB() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✅ Connected to MongoDB (direct connection)');
    return client;
}

async function inspectSpecificCompany() {
    console.log('🔍 INSPECT SPECIFIC COMPANY');
    console.log('===========================');
    
    const targetCompanyId = '68813026dd95f599c74e49c7';
    console.log(`🎯 TARGET: ${targetCompanyId}`);
    console.log('');

    const client = await connectToMongoDB();
    const db = client.db();

    try {
        // Get the exact company document
        const company = await db.collection('companies').findOne({ 
            _id: new mongoose.Types.ObjectId(targetCompanyId) 
        });

        if (!company) {
            console.log('❌ Company not found');
            return;
        }

        console.log(`🏢 Company: ${company.companyName}`);
        console.log(`📅 Created: ${company.createdAt}`);
        console.log(`📅 Updated: ${company.updatedAt}`);
        console.log('');

        // Check for ALL possible legacy fields
        const legacyFields = [
            'agentDirectory',
            'agentNotifyTargets',
            'companyKBSettings',
            'enterpriseAIIntelligence',
            'companyKB',
            'agentPersonalitySettings',
            'personalityResponses',
            'legacyAIIntelligence',
            'enterpriseSettings'
        ];

        console.log('🔍 LEGACY FIELD INSPECTION:');
        console.log('============================');

        let foundLegacy = false;
        for (const field of legacyFields) {
            if (company[field] !== undefined) {
                foundLegacy = true;
                console.log(`❌ FOUND: ${field}`);
                
                if (field === 'agentDirectory' && Array.isArray(company[field])) {
                    console.log('   📋 agentDirectory contents:');
                    company[field].forEach((agent, index) => {
                        console.log(`      ${index + 1}. ${agent.name} (${agent.department}) - ${agent.phone}`);
                    });
                }
                
                if (typeof company[field] === 'object' && company[field] !== null) {
                    console.log(`   📊 ${field} type: ${Array.isArray(company[field]) ? 'Array' : 'Object'}`);
                    if (Array.isArray(company[field])) {
                        console.log(`   📊 ${field} length: ${company[field].length}`);
                    } else {
                        console.log(`   📊 ${field} keys: ${Object.keys(company[field]).slice(0, 5).join(', ')}${Object.keys(company[field]).length > 5 ? '...' : ''}`);
                    }
                }
            }
        }

        if (!foundLegacy) {
            console.log('✅ No legacy fields found in database');
        }

        // Check the top-level keys of the document
        console.log('\n🔍 ALL DOCUMENT KEYS:');
        console.log('=====================');
        const allKeys = Object.keys(company);
        allKeys.forEach((key, index) => {
            const value = company[key];
            const type = Array.isArray(value) ? 'Array' : typeof value;
            const size = Array.isArray(value) ? `[${value.length}]` : 
                        typeof value === 'object' && value !== null ? `{${Object.keys(value).length}}` : 
                        typeof value === 'string' ? `"${value.substring(0, 20)}${value.length > 20 ? '...' : ''}"` : 
                        String(value);
            console.log(`   ${index + 1}. ${key}: ${type} ${size}`);
        });

    } catch (error) {
        console.error('❌ Error during inspection:', error);
    } finally {
        await client.close();
        console.log('\n🔌 MongoDB connection closed');
    }
}

// Run the inspection
inspectSpecificCompany().catch(console.error);
