/**
 * 🎯 SPECIFIC LEGACY Q&A HUNTER
 * =============================
 * 
 * MISSION: Hunt for the EXACT legacy entries seen in the UI
 * TARGET: "how much is your ac service?" and "$49" entries
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

async function huntSpecificLegacyQnA() {
    console.log('🎯 SPECIFIC LEGACY Q&A HUNTER');
    console.log('=============================');
    console.log('Target: "how much is your ac service?" and "$49" entries\n');
    
    const client = await connectToMongoDB();
    const db = client.db();
    
    try {
        // Check all possible collection names for CompanyKnowledgeQnA
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        
        console.log('📋 All collections in database:');
        collectionNames.forEach(name => console.log(`   - ${name}`));
        
        // Try different possible collection names
        const possibleQnACollections = [
            'companyknowledgeqnas',
            'companyknowledgeqnas', // plural
            'companyqnas',
            'company_knowledge_qnas',
            'CompanyKnowledgeQnAs'
        ];
        
        console.log('\n🔍 Searching for Q&A entries...');
        
        for (const collectionName of possibleQnACollections) {
            if (collectionNames.includes(collectionName)) {
                console.log(`\n📊 Checking collection: ${collectionName}`);
                const collection = db.collection(collectionName);
                
                // Get all entries
                const allEntries = await collection.find({}).toArray();
                console.log(`   Found ${allEntries.length} total entries`);
                
                if (allEntries.length > 0) {
                    console.log('\n🔍 ALL ENTRIES IN COLLECTION:');
                    allEntries.forEach((entry, index) => {
                        console.log(`\n   ${index + 1}. ID: ${entry._id}`);
                        console.log(`      Company: ${entry.companyId}`);
                        console.log(`      Question: "${entry.question}"`);
                        console.log(`      Answer: "${entry.answer}"`);
                        console.log(`      Status: ${entry.status}`);
                        console.log(`      Created: ${entry.createdAt}`);
                        console.log(`      Keywords: ${entry.keywords?.join(', ') || 'none'}`);
                    });
                }
                
                // Search for specific legacy entries
                console.log('\n🎯 Searching for specific legacy entries...');
                
                const acServiceEntries = await collection.find({
                    $or: [
                        { question: /ac service/i },
                        { question: /how much/i },
                        { answer: /\$49/i },
                        { answer: /49/i }
                    ]
                }).toArray();
                
                if (acServiceEntries.length > 0) {
                    console.log(`\n🚨 FOUND ${acServiceEntries.length} LEGACY ENTRIES:`);
                    acServiceEntries.forEach((entry, index) => {
                        console.log(`\n   🦠 LEGACY ENTRY ${index + 1}:`);
                        console.log(`      ID: ${entry._id}`);
                        console.log(`      Company: ${entry.companyId}`);
                        console.log(`      Question: "${entry.question}"`);
                        console.log(`      Answer: "${entry.answer}"`);
                        console.log(`      Status: ${entry.status}`);
                        console.log(`      Created: ${entry.createdAt}`);
                        console.log(`      Last Modified: ${entry.updatedAt}`);
                    });
                } else {
                    console.log('   ✅ No specific legacy entries found in this collection');
                }
            }
        }
        
        // Also check the companies collection for your specific company
        console.log('\n🔍 Checking Atlas Air company specifically...');
        const companies = db.collection('companies');
        const atlasAir = await companies.findOne({ 
            companyName: /atlas air/i 
        });
        
        if (atlasAir) {
            console.log(`\n📊 Atlas Air Company: ${atlasAir._id}`);
            
            // Check all possible embedded Q&A locations
            const locations = [
                'aiAgentLogic.knowledgeManagement.companyQnA',
                'companyKB',
                'knowledgeBase',
                'qnaEntries'
            ];
            
            for (const location of locations) {
                const qnas = getNestedProperty(atlasAir, location);
                if (qnas && qnas.length > 0) {
                    console.log(`\n🦠 Found ${qnas.length} Q&As in ${location}:`);
                    qnas.forEach((qna, index) => {
                        console.log(`   ${index + 1}. Q: "${qna.question}"`);
                        console.log(`      A: "${qna.answer}"`);
                    });
                }
            }
        }
        
    } catch (error) {
        console.error('💥 HUNT FAILED:', error);
        throw error;
    } finally {
        await client.close();
        console.log('\n📡 Disconnected from MongoDB');
    }
}

function getNestedProperty(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : null;
    }, obj);
}

// Execute
huntSpecificLegacyQnA().catch(error => {
    console.error('💥 HUNT FAILED:', error);
    process.exit(1);
});
