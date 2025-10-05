/**
 * 🕵️ LEGACY Q&A MOTHERLOAD HUNTER
 * ===============================
 * 
 * MISSION: Hunt down ALL legacy Q&A entries across ALL collections
 * TARGET: Made-up test entries like "how much is your ac service" and "$49"
 * 
 * HUNTING GROUNDS:
 * 1. CompanyKnowledgeQnA collection (standalone)
 * 2. Company.aiAgentLogic.knowledgeManagement.companyQnA (embedded)
 * 3. Company.companyKB (legacy embedded)
 * 4. Any other legacy collections
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

async function huntLegacyQnAMotherload() {
    console.log('🕵️ LEGACY Q&A MOTHERLOAD HUNTER');
    console.log('===============================');
    console.log('Mission: Hunt down ALL legacy Q&A contamination');
    console.log('Target: Made-up test entries and legacy spaghetti\n');
    
    const client = await connectToMongoDB();
    const db = client.db();
    
    try {
        console.log('🔍 HUNTING GROUND 1: CompanyKnowledgeQnA Collection (Standalone)');
        console.log('================================================================');
        
        const companyQnAs = db.collection('companyknowledgeqnas');
        const standaloneQnAs = await companyQnAs.find({}).toArray();
        
        console.log(`📊 Found ${standaloneQnAs.length} entries in standalone collection`);
        
        if (standaloneQnAs.length > 0) {
            console.log('\n🦠 STANDALONE Q&A CONTAMINATION:');
            standaloneQnAs.forEach((qna, index) => {
                console.log(`${index + 1}. Company: ${qna.companyId}`);
                console.log(`   Question: "${qna.question}"`);
                console.log(`   Answer: "${qna.answer.substring(0, 100)}..."`);
                console.log(`   Created: ${qna.createdAt}`);
                console.log(`   Status: ${qna.status}`);
                console.log(`   Keywords: ${qna.keywords?.join(', ') || 'none'}`);
                console.log('   ---');
            });
        }
        
        console.log('\n🔍 HUNTING GROUND 2: Company.aiAgentLogic.knowledgeManagement.companyQnA (Embedded)');
        console.log('=================================================================================');
        
        const companies = db.collection('companies');
        const embeddedQnAs = await companies.find({
            'aiAgentLogic.knowledgeManagement.companyQnA': { $exists: true, $ne: [] }
        }).toArray();
        
        console.log(`📊 Found ${embeddedQnAs.length} companies with embedded Q&A`);
        
        if (embeddedQnAs.length > 0) {
            console.log('\n🦠 EMBEDDED Q&A CONTAMINATION:');
            embeddedQnAs.forEach((company, index) => {
                console.log(`${index + 1}. Company: ${company.companyName} (${company._id})`);
                const qnas = company.aiAgentLogic?.knowledgeManagement?.companyQnA || [];
                console.log(`   📝 ${qnas.length} embedded Q&A entries:`);
                
                qnas.forEach((qna, qIndex) => {
                    console.log(`      ${qIndex + 1}. Q: "${qna.question}"`);
                    console.log(`         A: "${qna.answer?.substring(0, 80)}..."`);
                    console.log(`         Created: ${qna.createdAt}`);
                });
                console.log('   ---');
            });
        }
        
        console.log('\n🔍 HUNTING GROUND 3: Company.companyKB (Legacy Embedded)');
        console.log('========================================================');
        
        const legacyKBCompanies = await companies.find({
            'companyKB': { $exists: true, $ne: [] }
        }).toArray();
        
        console.log(`📊 Found ${legacyKBCompanies.length} companies with legacy companyKB`);
        
        if (legacyKBCompanies.length > 0) {
            console.log('\n🦠 LEGACY COMPANY KB CONTAMINATION:');
            legacyKBCompanies.forEach((company, index) => {
                console.log(`${index + 1}. Company: ${company.companyName} (${company._id})`);
                const kb = company.companyKB || [];
                console.log(`   📝 ${kb.length} legacy KB entries:`);
                
                kb.forEach((entry, kIndex) => {
                    console.log(`      ${kIndex + 1}. Q: "${entry.question}"`);
                    console.log(`         A: "${entry.answer?.substring(0, 80)}..."`);
                    console.log(`         Category: ${entry.category}`);
                    console.log(`         Created: ${entry.createdAt}`);
                });
                console.log('   ---');
            });
        }
        
        console.log('\n🔍 HUNTING GROUND 4: Other Legacy Collections');
        console.log('=============================================');
        
        const collections = await db.listCollections().toArray();
        const legacyCollectionNames = collections
            .map(c => c.name)
            .filter(name => 
                name.includes('qna') || 
                name.includes('knowledge') || 
                name.includes('qa')
            );
        
        console.log(`📊 Found ${legacyCollectionNames.length} potential legacy collections:`);
        console.log(`   ${legacyCollectionNames.join(', ')}`);
        
        for (const collectionName of legacyCollectionNames) {
            if (collectionName === 'companyknowledgeqnas') continue; // Already checked
            
            try {
                const collection = db.collection(collectionName);
                const count = await collection.countDocuments();
                
                if (count > 0) {
                    console.log(`\n🦠 LEGACY COLLECTION: ${collectionName} (${count} entries)`);
                    const samples = await collection.find({}).limit(3).toArray();
                    
                    samples.forEach((entry, index) => {
                        console.log(`   ${index + 1}. ${JSON.stringify(entry, null, 2).substring(0, 200)}...`);
                    });
                }
            } catch (error) {
                console.log(`   ⚠️ Could not access ${collectionName}: ${error.message}`);
            }
        }
        
        console.log('\n🎯 SUMMARY OF CONTAMINATION:');
        console.log('============================');
        console.log(`📊 Standalone Q&As: ${standaloneQnAs.length}`);
        console.log(`📊 Companies with embedded Q&As: ${embeddedQnAs.length}`);
        console.log(`📊 Companies with legacy KB: ${legacyKBCompanies.length}`);
        console.log(`📊 Legacy collections found: ${legacyCollectionNames.length}`);
        
        const totalContamination = standaloneQnAs.length + 
            embeddedQnAs.reduce((sum, c) => sum + (c.aiAgentLogic?.knowledgeManagement?.companyQnA?.length || 0), 0) +
            legacyKBCompanies.reduce((sum, c) => sum + (c.companyKB?.length || 0), 0);
        
        console.log(`🚨 TOTAL LEGACY Q&A ENTRIES: ${totalContamination}`);
        
        if (totalContamination > 0) {
            console.log('\n💥 READY TO NUKE LEGACY Q&A CONTAMINATION');
            console.log('Run with --nuke flag to eliminate all legacy entries');
        } else {
            console.log('\n✅ NO LEGACY Q&A CONTAMINATION DETECTED');
        }
        
    } catch (error) {
        console.error('💥 HUNTING FAILED:', error);
        throw error;
    } finally {
        await client.close();
        console.log('📡 Disconnected from MongoDB');
    }
}

async function nukeLegacyQnAs() {
    console.log('\n💥 NUKING LEGACY Q&A CONTAMINATION');
    console.log('==================================');
    
    const client = await connectToMongoDB();
    const db = client.db();
    
    try {
        let totalNuked = 0;
        
        // Nuke 1: Standalone CompanyKnowledgeQnA collection
        console.log('💥 NUKING: Standalone CompanyKnowledgeQnA entries...');
        const companyQnAs = db.collection('companyknowledgeqnas');
        const standaloneResult = await companyQnAs.deleteMany({});
        console.log(`   ✅ Nuked ${standaloneResult.deletedCount} standalone entries`);
        totalNuked += standaloneResult.deletedCount;
        
        // Nuke 2: Embedded Q&As in Company documents
        console.log('💥 NUKING: Embedded Q&As in Company documents...');
        const companies = db.collection('companies');
        const embeddedResult = await companies.updateMany(
            {},
            { 
                $unset: { 
                    'aiAgentLogic.knowledgeManagement.companyQnA': "",
                    'companyKB': ""
                }
            }
        );
        console.log(`   ✅ Cleaned ${embeddedResult.modifiedCount} company documents`);
        
        // Nuke 3: Any other legacy collections
        console.log('💥 NUKING: Legacy collections...');
        const collections = await db.listCollections().toArray();
        const legacyCollectionNames = collections
            .map(c => c.name)
            .filter(name => 
                name.includes('qna') && name !== 'companyknowledgeqnas' ||
                name.includes('knowledgeentries') ||
                name.includes('suggestedknowledge') ||
                name.includes('approvedknowledge')
            );
        
        for (const collectionName of legacyCollectionNames) {
            try {
                await db.collection(collectionName).drop();
                console.log(`   ✅ Dropped legacy collection: ${collectionName}`);
            } catch (error) {
                console.log(`   ⚠️ Could not drop ${collectionName}: ${error.message}`);
            }
        }
        
        console.log(`\n🎉 NUCLEAR SUCCESS: ${totalNuked} legacy Q&A entries eliminated!`);
        console.log('✅ Database is now clean of legacy Q&A contamination');
        
    } catch (error) {
        console.error('💥 NUCLEAR CLEANUP FAILED:', error);
        throw error;
    } finally {
        await client.close();
        console.log('📡 Disconnected from MongoDB');
    }
}

// Execute
const args = process.argv.slice(2);
if (args.includes('--nuke')) {
    nukeLegacyQnAs().catch(error => {
        console.error('💥 NUKE FAILED:', error);
        process.exit(1);
    });
} else {
    huntLegacyQnAMotherload().catch(error => {
        console.error('💥 HUNT FAILED:', error);
        process.exit(1);
    });
}
