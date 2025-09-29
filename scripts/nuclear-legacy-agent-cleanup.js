/**
 * ☢️ NUCLEAR LEGACY AGENT CLEANUP
 * ===============================
 * 
 * MISSION: DESTROY ALL legacy agent directory and enterprise AI intelligence data
 * TARGET: Complete elimination of legacy contamination from company documents
 * 
 * LEGACY FIELDS TO ELIMINATE:
 * - agentDirectory (Test Person, Sales, etc.)
 * - agentNotifyTargets
 * - companyKBSettings
 * - enterpriseAIIntelligence (massive legacy system)
 * - Any other legacy agent-related fields
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

async function nuclearLegacyAgentCleanup() {
    console.log('☢️ NUCLEAR LEGACY AGENT CLEANUP');
    console.log('================================');
    console.log('🎯 TARGET: Complete elimination of legacy agent and enterprise AI data');
    console.log('⚠️  WARNING: This will permanently delete legacy fields from ALL companies');
    console.log('');

    const client = await connectToMongoDB();
    const db = client.db();

    try {
        // First, let's find companies with the specific company ID from the logs
        const targetCompanyId = '68813026dd95f599c74e49c7';
        console.log(`🔍 INSPECTING TARGET COMPANY: ${targetCompanyId}`);
        
        const targetCompany = await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId(targetCompanyId) });
        
        if (targetCompany) {
            console.log(`\n🏢 Found company: ${targetCompany.companyName}`);
            
            // Check for legacy fields
            const legacyFields = [];
            if (targetCompany.agentDirectory) legacyFields.push('agentDirectory');
            if (targetCompany.agentNotifyTargets) legacyFields.push('agentNotifyTargets');
            if (targetCompany.companyKBSettings) legacyFields.push('companyKBSettings');
            if (targetCompany.enterpriseAIIntelligence) legacyFields.push('enterpriseAIIntelligence');
            
            console.log(`🔍 Legacy fields found: ${legacyFields.join(', ')}`);
            
            if (targetCompany.agentDirectory) {
                console.log('📋 agentDirectory contents:');
                targetCompany.agentDirectory.forEach((agent, index) => {
                    console.log(`   ${index + 1}. ${agent.name} (${agent.department}) - ${agent.phone}`);
                });
            }
        }

        // Now let's find ALL companies with any of these legacy fields
        console.log('\n🔍 SCANNING ALL COMPANIES FOR LEGACY CONTAMINATION...');
        
        const legacyFieldsToRemove = [
            'agentDirectory',
            'agentNotifyTargets', 
            'companyKBSettings',
            'enterpriseAIIntelligence',
            'companyKB', // Legacy knowledge base
            'agentPersonalitySettings', // Legacy personality
            'legacyAIIntelligence',
            'enterpriseSettings',
            'agentSetup.directory',
            'agentSetup.contacts',
            'agentSettings.directory',
            'agentSettings.contacts'
        ];

        // Build the query to find companies with ANY of these fields
        const legacyQuery = {
            $or: legacyFieldsToRemove.map(field => ({ [field]: { $exists: true } }))
        };

        const companiesWithLegacy = await db.collection('companies').find(legacyQuery).toArray();
        console.log(`📊 Found ${companiesWithLegacy.length} companies with legacy contamination`);

        for (const company of companiesWithLegacy) {
            console.log(`\n🏢 ${company.companyName} (${company._id})`);
            
            legacyFieldsToRemove.forEach(field => {
                if (company[field] !== undefined) {
                    console.log(`   ❌ Has legacy field: ${field}`);
                }
            });
        }

        // NUCLEAR CLEANUP - Remove all legacy fields
        console.log('\n☢️ INITIATING NUCLEAR CLEANUP...');
        console.log('⚠️  This will permanently delete ALL legacy agent fields');
        
        // Build the $unset operation
        const unsetOperation = {};
        legacyFieldsToRemove.forEach(field => {
            unsetOperation[field] = 1;
        });

        console.log('🗑️ Fields to be deleted:', Object.keys(unsetOperation));
        
        // Execute the cleanup
        const result = await db.collection('companies').updateMany(
            {}, // Update ALL companies
            { $unset: unsetOperation }
        );

        console.log('\n✅ NUCLEAR CLEANUP COMPLETE');
        console.log('============================');
        console.log(`📊 Companies scanned: ${result.matchedCount}`);
        console.log(`📊 Companies updated: ${result.modifiedCount}`);
        console.log('☢️ All legacy agent directory and enterprise AI data has been ELIMINATED');

        // Verify cleanup
        console.log('\n🔍 VERIFICATION: Checking for remaining legacy data...');
        const remainingLegacy = await db.collection('companies').find(legacyQuery).toArray();
        
        if (remainingLegacy.length === 0) {
            console.log('✅ VERIFICATION PASSED: No legacy data remaining');
        } else {
            console.log(`❌ VERIFICATION FAILED: ${remainingLegacy.length} companies still have legacy data`);
            for (const company of remainingLegacy) {
                console.log(`   🏢 ${company.companyName} (${company._id}) still has legacy fields`);
            }
        }

    } catch (error) {
        console.error('❌ Error during nuclear cleanup:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

// Run the nuclear cleanup
nuclearLegacyAgentCleanup().catch(console.error);
