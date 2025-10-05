/**
 * 🕵️ AGENT DIRECTORY LEGACY HUNTER
 * ===============================
 * 
 * MISSION: Hunt down and DESTROY all legacy agentDirectory and agentNotifyTargets data
 * TARGET: "Test Person" Sales department and other legacy test data
 * 
 * HUNTING GROUNDS:
 * 1. Company.agentDirectory (legacy embedded)
 * 2. Company.agentNotifyTargets (legacy embedded)
 * 3. Any other legacy agent directory fields
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

async function huntAgentDirectoryLegacy() {
    console.log('🕵️ AGENT DIRECTORY LEGACY HUNTER');
    console.log('================================');
    console.log('🎯 TARGET: Test Person, Sales department, and other legacy agent directory data');
    console.log('');

    const client = await connectToMongoDB();
    const db = client.db();

    try {
        // 1. Hunt in Company collection for agentDirectory fields
        console.log('🔍 HUNTING GROUND 1: Company.agentDirectory');
        const companiesWithAgentDirectory = await db.collection('companies').find({
            $or: [
                { 'agentDirectory': { $exists: true, $ne: [] } },
                { 'agentNotifyTargets': { $exists: true, $ne: [] } }
            ]
        }).toArray();

        console.log(`📊 Found ${companiesWithAgentDirectory.length} companies with legacy agent directory data`);

        for (const company of companiesWithAgentDirectory) {
            console.log(`\n🏢 Company: ${company.companyName} (${company._id})`);
            
            if (company.agentDirectory && company.agentDirectory.length > 0) {
                console.log('🔍 agentDirectory found:');
                company.agentDirectory.forEach((agent, index) => {
                    console.log(`   ${index + 1}. Name: "${agent.name}" | Dept: "${agent.department}" | Phone: "${agent.phone}"`);
                });
            }

            if (company.agentNotifyTargets && company.agentNotifyTargets.length > 0) {
                console.log('🔍 agentNotifyTargets found:');
                company.agentNotifyTargets.forEach((target, index) => {
                    console.log(`   ${index + 1}. ${JSON.stringify(target)}`);
                });
            }
        }

        // 2. Search for any other legacy agent-related fields
        console.log('\n🔍 HUNTING GROUND 2: Other legacy agent fields');
        const companiesWithOtherAgentFields = await db.collection('companies').find({
            $or: [
                { 'agentSettings.directory': { $exists: true } },
                { 'agentSettings.contacts': { $exists: true } },
                { 'agentSetup.directory': { $exists: true } },
                { 'agentSetup.contacts': { $exists: true } }
            ]
        }).toArray();

        console.log(`📊 Found ${companiesWithOtherAgentFields.length} companies with other legacy agent fields`);

        for (const company of companiesWithOtherAgentFields) {
            console.log(`\n🏢 Company: ${company.companyName} (${company._id})`);
            
            if (company.agentSettings?.directory) {
                console.log('🔍 agentSettings.directory found:', company.agentSettings.directory);
            }
            if (company.agentSettings?.contacts) {
                console.log('🔍 agentSettings.contacts found:', company.agentSettings.contacts);
            }
            if (company.agentSetup?.directory) {
                console.log('🔍 agentSetup.directory found:', company.agentSetup.directory);
            }
            if (company.agentSetup?.contacts) {
                console.log('🔍 agentSetup.contacts found:', company.agentSetup.contacts);
            }
        }

        // 3. Check for any documents with "Test Person" anywhere
        console.log('\n🔍 HUNTING GROUND 3: Documents containing "Test Person"');
        const companiesWithTestPerson = await db.collection('companies').find({
            $or: [
                { $text: { $search: "Test Person" } },
                { 'agentDirectory.name': 'Test Person' },
                { 'agentNotifyTargets.name': 'Test Person' }
            ]
        }).toArray();

        console.log(`📊 Found ${companiesWithTestPerson.length} companies with "Test Person" references`);

        for (const company of companiesWithTestPerson) {
            console.log(`\n🏢 Company: ${company.companyName} (${company._id})`);
            console.log('🔍 Full document search for "Test Person" - manual inspection needed');
        }

        console.log('\n🎯 LEGACY HUNT COMPLETE');
        console.log('========================');
        console.log(`📈 Total companies with agentDirectory: ${companiesWithAgentDirectory.length}`);
        console.log(`📈 Total companies with other agent fields: ${companiesWithOtherAgentFields.length}`);
        console.log(`📈 Total companies with "Test Person": ${companiesWithTestPerson.length}`);

    } catch (error) {
        console.error('❌ Error during legacy hunt:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

// Run the hunter
huntAgentDirectoryLegacy().catch(console.error);
