/**
 * 🔍 FIND ATLAS AIR COMPANY
 * =========================
 * 
 * MISSION: Find the company with "atlas air" name that has the legacy data
 * The logs show "atlas air" but our target ID shows "Demo HVAC Company"
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

async function findAtlasAirCompany() {
    console.log('🔍 FIND ATLAS AIR COMPANY');
    console.log('=========================');
    console.log('🎯 TARGET: Company with "atlas air" name');
    console.log('');

    const client = await connectToMongoDB();
    const db = client.db();

    try {
        // Search for companies with "atlas air" in the name
        const atlasCompanies = await db.collection('companies').find({
            companyName: { $regex: /atlas air/i }
        }).toArray();

        console.log(`📊 Found ${atlasCompanies.length} companies with "atlas air" in name`);

        for (const company of atlasCompanies) {
            console.log(`\n🏢 Company: ${company.companyName} (${company._id})`);
            console.log(`📅 Created: ${company.createdAt}`);
            console.log(`📅 Updated: ${company.updatedAt}`);

            // Check for legacy fields
            const legacyFields = [
                'agentDirectory',
                'agentNotifyTargets',
                'companyKBSettings',
                'enterpriseAIIntelligence'
            ];

            let foundLegacy = false;
            for (const field of legacyFields) {
                if (company[field] !== undefined) {
                    foundLegacy = true;
                    console.log(`❌ FOUND LEGACY: ${field}`);
                    
                    if (field === 'agentDirectory' && Array.isArray(company[field])) {
                        console.log('   📋 agentDirectory contents:');
                        company[field].forEach((agent, index) => {
                            console.log(`      ${index + 1}. ${agent.name} (${agent.department}) - ${agent.phone}`);
                        });
                    }
                }
            }

            if (!foundLegacy) {
                console.log('✅ No legacy fields found');
            }
        }

        // Also search by the exact ID from the logs
        const targetId = '68813026dd95f599c74e49c7';
        console.log(`\n🔍 CHECKING TARGET ID: ${targetId}`);
        
        const targetCompany = await db.collection('companies').findOne({
            _id: new mongoose.Types.ObjectId(targetId)
        });

        if (targetCompany) {
            console.log(`🏢 Target company: ${targetCompany.companyName}`);
            console.log(`📧 Email: ${targetCompany.companyEmail || 'N/A'}`);
            console.log(`📞 Phone: ${targetCompany.companyPhone || 'N/A'}`);
        }

        // Check ALL collections for any documents with "Test Person"
        console.log('\n🔍 SEARCHING ALL COLLECTIONS FOR "Test Person"...');
        const collections = await db.listCollections().toArray();
        
        for (const collection of collections) {
            const collectionName = collection.name;
            try {
                const count = await db.collection(collectionName).countDocuments({
                    $or: [
                        { 'agentDirectory.name': 'Test Person' },
                        { 'name': 'Test Person' },
                        { 'agentNotifyTargets.name': 'Test Person' }
                    ]
                });
                
                if (count > 0) {
                    console.log(`❌ Found "Test Person" in collection: ${collectionName} (${count} documents)`);
                    
                    // Get a sample document
                    const sample = await db.collection(collectionName).findOne({
                        $or: [
                            { 'agentDirectory.name': 'Test Person' },
                            { 'name': 'Test Person' },
                            { 'agentNotifyTargets.name': 'Test Person' }
                        ]
                    });
                    
                    console.log(`   📋 Sample document ID: ${sample._id}`);
                    if (sample.companyName) console.log(`   🏢 Company: ${sample.companyName}`);
                }
            } catch (error) {
                // Skip collections that can't be queried
            }
        }

    } catch (error) {
        console.error('❌ Error during search:', error);
    } finally {
        await client.close();
        console.log('\n🔌 MongoDB connection closed');
    }
}

// Run the search
findAtlasAirCompany().catch(console.error);
