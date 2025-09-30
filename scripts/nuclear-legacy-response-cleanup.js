/**
 * ☢️ NUCLEAR LEGACY RESPONSE CLEANUP
 * ==================================
 * 
 * MISSION: DESTROY ALL legacy fields that appear in API responses
 * TARGET: Complete elimination of messageTemplates, agentPriorityConfig, responseCategories, etc.
 * 
 * LEGACY FIELDS TO ELIMINATE:
 * - messageTemplates (booking confirmation templates)
 * - agentPriorityConfig (legacy priority system)
 * - aiAgentLogic.responseCategories (massive legacy response system)
 * - aiAgentLogic.analytics (legacy analytics)
 * - aiAgentLogic.metrics (legacy metrics)
 * - aiAgentLogic.privacy (legacy privacy settings)
 * - aiAgentLogic.autoOptimization (legacy optimization)
 * - aiAgentLogic.fallbackBehavior (legacy fallback)
 * - aiAgentLogic.memorySettings (legacy memory)
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

async function nuclearLegacyResponseCleanup() {
    console.log('☢️ NUCLEAR LEGACY RESPONSE CLEANUP');
    console.log('===================================');
    console.log('🎯 TARGET: Complete elimination of legacy API response fields');
    console.log('⚠️  WARNING: This will permanently delete legacy fields from ALL companies');
    console.log('');

    const client = await connectToMongoDB();
    const db = client.db();

    try {
        // First, let's find companies with these specific legacy fields
        console.log('🔍 SCANNING FOR LEGACY RESPONSE CONTAMINATION...');
        
        const legacyResponseFields = [
            'messageTemplates',
            'agentPriorityConfig',
            'aiAgentLogic.responseCategories',
            'aiAgentLogic.analytics',
            'aiAgentLogic.metrics',
            'aiAgentLogic.privacy',
            'aiAgentLogic.autoOptimization',
            'aiAgentLogic.fallbackBehavior',
            'aiAgentLogic.memorySettings'
        ];

        // Build the query to find companies with ANY of these fields
        const legacyQuery = {
            $or: legacyResponseFields.map(field => ({ [field]: { $exists: true } }))
        };

        const companiesWithLegacy = await db.collection('companies').find(legacyQuery).toArray();
        console.log(`📊 Found ${companiesWithLegacy.length} companies with legacy response contamination`);

        for (const company of companiesWithLegacy) {
            console.log(`\n🏢 ${company.companyName} (${company._id})`);
            
            // Check for top-level legacy fields
            if (company.messageTemplates) {
                console.log(`   ❌ Has messageTemplates: ${Object.keys(company.messageTemplates).join(', ')}`);
            }
            if (company.agentPriorityConfig) {
                console.log(`   ❌ Has agentPriorityConfig: ${Object.keys(company.agentPriorityConfig).join(', ')}`);
            }
            
            // Check for nested aiAgentLogic legacy fields
            if (company.aiAgentLogic) {
                if (company.aiAgentLogic.responseCategories) {
                    const categories = Object.keys(company.aiAgentLogic.responseCategories);
                    console.log(`   ❌ Has aiAgentLogic.responseCategories: ${categories.join(', ')}`);
                }
                if (company.aiAgentLogic.analytics) {
                    console.log(`   ❌ Has aiAgentLogic.analytics`);
                }
                if (company.aiAgentLogic.metrics) {
                    console.log(`   ❌ Has aiAgentLogic.metrics`);
                }
                if (company.aiAgentLogic.privacy) {
                    console.log(`   ❌ Has aiAgentLogic.privacy`);
                }
                if (company.aiAgentLogic.autoOptimization) {
                    console.log(`   ❌ Has aiAgentLogic.autoOptimization`);
                }
                if (company.aiAgentLogic.fallbackBehavior) {
                    console.log(`   ❌ Has aiAgentLogic.fallbackBehavior`);
                }
                if (company.aiAgentLogic.memorySettings) {
                    console.log(`   ❌ Has aiAgentLogic.memorySettings`);
                }
            }
        }

        // NUCLEAR CLEANUP - Remove all legacy response fields
        console.log('\n☢️ INITIATING NUCLEAR RESPONSE CLEANUP...');
        console.log('⚠️  This will permanently delete ALL legacy response fields');
        
        // Build the $unset operation for top-level fields
        const unsetOperation = {
            'messageTemplates': 1,
            'agentPriorityConfig': 1,
            'aiAgentLogic.responseCategories': 1,
            'aiAgentLogic.analytics': 1,
            'aiAgentLogic.metrics': 1,
            'aiAgentLogic.privacy': 1,
            'aiAgentLogic.autoOptimization': 1,
            'aiAgentLogic.fallbackBehavior': 1,
            'aiAgentLogic.memorySettings': 1
        };

        console.log('🗑️ Fields to be deleted:', Object.keys(unsetOperation));
        
        // Execute the cleanup
        const result = await db.collection('companies').updateMany(
            {}, // Update ALL companies
            { $unset: unsetOperation }
        );

        console.log('\n✅ NUCLEAR RESPONSE CLEANUP COMPLETE');
        console.log('====================================');
        console.log(`📊 Companies scanned: ${result.matchedCount}`);
        console.log(`📊 Companies updated: ${result.modifiedCount}`);
        console.log('☢️ All legacy response fields have been ELIMINATED');

        // Verify cleanup
        console.log('\n🔍 VERIFICATION: Checking for remaining legacy response data...');
        const remainingLegacy = await db.collection('companies').find(legacyQuery).toArray();
        
        if (remainingLegacy.length === 0) {
            console.log('✅ VERIFICATION PASSED: No legacy response data remaining');
        } else {
            console.log(`❌ VERIFICATION FAILED: ${remainingLegacy.length} companies still have legacy response data`);
            for (const company of remainingLegacy) {
                console.log(`   🏢 ${company.companyName} (${company._id}) still has legacy response fields`);
            }
        }

        // Also clean up any other potential legacy response fields
        console.log('\n🔍 CLEANING UP ADDITIONAL LEGACY FIELDS...');
        const additionalLegacyFields = {
            'aiAgentLogic.voiceSettings': 1,
            'aiAgentLogic.knowledgeManagement': 1,
            'aiAgentLogic.knowledgeSourcePriorities': 1,
            'personalityResponses': 1,
            'companyKBSettings': 1,
            'enterpriseAIIntelligence': 1
        };

        const additionalResult = await db.collection('companies').updateMany(
            {},
            { $unset: additionalLegacyFields }
        );

        console.log(`📊 Additional cleanup: ${additionalResult.modifiedCount} companies updated`);

    } catch (error) {
        console.error('❌ Error during nuclear response cleanup:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

// Run the nuclear response cleanup
nuclearLegacyResponseCleanup().catch(console.error);
