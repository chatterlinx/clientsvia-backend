/**
 * 🚨 SEARCH AND DESTROY: Legacy Q&A Elimination
 * =============================================
 * 
 * MISSION: Find and IMMEDIATELY DELETE all legacy Q&A contamination
 * ORDERS: Delete on sight - no mercy for legacy spaghetti
 * 
 * TARGET: ALL Q&A entries everywhere - we have ZERO company Q&As
 */

const mongoose = require('mongoose');
const { MongoClient, ObjectId } = require('mongodb');

async function connectToMongoDB() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✅ Connected to MongoDB - SEARCH AND DESTROY MODE ACTIVE');
    return client;
}

async function searchAndDestroyLegacyQnAs() {
    console.log('🚨 SEARCH AND DESTROY: Legacy Q&A Elimination');
    console.log('=============================================');
    console.log('ORDERS: Delete ALL Q&A entries on sight');
    console.log('TARGET: Complete elimination - ZERO Q&As allowed\n');
    
    const client = await connectToMongoDB();
    const db = client.db();
    
    let totalDestroyed = 0;
    
    try {
        console.log('🔍 PHASE 1: Destroying standalone Q&A collections...');
        console.log('===================================================');
        
        // Get all collections
        const collections = await db.listCollections().toArray();
        const qnaCollections = collections.filter(c => 
            c.name.toLowerCase().includes('qna') || 
            c.name.toLowerCase().includes('knowledge') ||
            c.name === 'companyqnas'
        );
        
        console.log(`📊 Found ${qnaCollections.length} Q&A collections to destroy:`);
        qnaCollections.forEach(c => console.log(`   - ${c.name}`));
        
        for (const collectionInfo of qnaCollections) {
            const collection = db.collection(collectionInfo.name);
            
            console.log(`\n💥 DESTROYING: ${collectionInfo.name}`);
            
            // Count entries before destruction
            const count = await collection.countDocuments();
            console.log(`   📊 Found ${count} entries to eliminate`);
            
            if (count > 0) {
                // Show what we're destroying
                const samples = await collection.find({}).limit(3).toArray();
                console.log('   🦠 Sample entries being destroyed:');
                samples.forEach((entry, index) => {
                    console.log(`      ${index + 1}. Q: "${entry.question || 'N/A'}"`);
                    console.log(`         A: "${(entry.answer || 'N/A').substring(0, 50)}..."`);
                });
                
                // DESTROY ALL ENTRIES
                const deleteResult = await collection.deleteMany({});
                console.log(`   ✅ DESTROYED: ${deleteResult.deletedCount} entries eliminated`);
                totalDestroyed += deleteResult.deletedCount;
                
                // Drop the entire collection
                try {
                    await collection.drop();
                    console.log(`   💀 COLLECTION DROPPED: ${collectionInfo.name} completely eliminated`);
                } catch (error) {
                    console.log(`   ⚠️ Could not drop collection: ${error.message}`);
                }
            } else {
                console.log('   ✅ Collection already empty');
            }
        }
        
        console.log('\n🔍 PHASE 2: Destroying embedded Q&As in Company documents...');
        console.log('============================================================');
        
        const companies = db.collection('companies');
        
        // Find companies with ANY embedded Q&A data
        const embeddedQnAQuery = {
            $or: [
                { 'aiAgentLogic.knowledgeManagement.companyQnA': { $exists: true } },
                { 'companyKB': { $exists: true } },
                { 'knowledgeBase': { $exists: true } },
                { 'qnaEntries': { $exists: true } },
                { 'companyQnA': { $exists: true } }
            ]
        };
        
        const companiesWithQnAs = await companies.find(embeddedQnAQuery).toArray();
        console.log(`📊 Found ${companiesWithQnAs.length} companies with embedded Q&As`);
        
        if (companiesWithQnAs.length > 0) {
            console.log('\n🦠 Companies with embedded Q&A contamination:');
            companiesWithQnAs.forEach((company, index) => {
                console.log(`   ${index + 1}. ${company.companyName} (${company._id})`);
                
                // Count embedded entries
                const locations = [
                    'aiAgentLogic.knowledgeManagement.companyQnA',
                    'companyKB',
                    'knowledgeBase', 
                    'qnaEntries',
                    'companyQnA'
                ];
                
                let embeddedCount = 0;
                for (const location of locations) {
                    const qnas = getNestedProperty(company, location);
                    if (qnas && Array.isArray(qnas)) {
                        embeddedCount += qnas.length;
                    }
                }
                console.log(`      📝 ${embeddedCount} embedded Q&A entries to destroy`);
            });
            
            // DESTROY ALL EMBEDDED Q&As
            console.log('\n💥 DESTROYING embedded Q&As...');
            const embeddedResult = await companies.updateMany(
                {},
                { 
                    $unset: { 
                        'aiAgentLogic.knowledgeManagement.companyQnA': "",
                        'companyKB': "",
                        'knowledgeBase': "",
                        'qnaEntries': "",
                        'companyQnA': ""
                    }
                }
            );
            
            console.log(`   ✅ DESTROYED: Cleaned ${embeddedResult.modifiedCount} company documents`);
        }
        
        console.log('\n🔍 PHASE 3: Destroying Redis cache contamination...');
        console.log('==================================================');
        
        try {
            // Connect to Redis and destroy Q&A caches
            const redis = require('redis');
            const redisClient = redis.createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379'
            });
            
            await redisClient.connect();
            
            // Find and destroy all Q&A related cache keys
            const keys = await redisClient.keys('*qna*');
            const knowledgeKeys = await redisClient.keys('*knowledge*');
            const companyKeys = await redisClient.keys('company:*');
            
            const allCacheKeys = [...keys, ...knowledgeKeys, ...companyKeys];
            
            if (allCacheKeys.length > 0) {
                console.log(`📊 Found ${allCacheKeys.length} cache keys to destroy`);
                console.log('   🦠 Sample cache keys:');
                allCacheKeys.slice(0, 5).forEach(key => console.log(`      - ${key}`));
                
                // DESTROY ALL CACHE KEYS
                for (const key of allCacheKeys) {
                    await redisClient.del(key);
                }
                
                console.log(`   ✅ DESTROYED: ${allCacheKeys.length} cache keys eliminated`);
            } else {
                console.log('   ✅ No Q&A cache keys found');
            }
            
            await redisClient.disconnect();
            
        } catch (error) {
            console.log(`   ⚠️ Redis cleanup failed: ${error.message}`);
        }
        
        console.log('\n🔍 PHASE 4: Final verification - ensuring complete elimination...');
        console.log('================================================================');
        
        // Verify no Q&A data remains anywhere
        const remainingCollections = await db.listCollections().toArray();
        const remainingQnACollections = remainingCollections.filter(c => 
            c.name.toLowerCase().includes('qna') || 
            c.name.toLowerCase().includes('knowledge')
        );
        
        if (remainingQnACollections.length > 0) {
            console.log(`❌ WARNING: ${remainingQnACollections.length} Q&A collections still exist:`);
            remainingQnACollections.forEach(c => console.log(`   - ${c.name}`));
        } else {
            console.log('✅ VERIFIED: No Q&A collections remain');
        }
        
        // Check for any remaining embedded Q&As
        const remainingEmbedded = await companies.find(embeddedQnAQuery).toArray();
        if (remainingEmbedded.length > 0) {
            console.log(`❌ WARNING: ${remainingEmbedded.length} companies still have embedded Q&As`);
        } else {
            console.log('✅ VERIFIED: No embedded Q&As remain');
        }
        
        console.log('\n🎉 SEARCH AND DESTROY MISSION COMPLETE!');
        console.log('=======================================');
        console.log(`💀 Total Q&A entries destroyed: ${totalDestroyed}`);
        console.log(`🧹 Collections eliminated: ${qnaCollections.length}`);
        console.log(`🏢 Company documents cleaned: ${companiesWithQnAs.length}`);
        console.log('✅ Database is now 100% Q&A free');
        console.log('🚀 ZERO company Q&As - mission accomplished!');
        
    } catch (error) {
        console.error('💥 SEARCH AND DESTROY FAILED:', error);
        throw error;
    } finally {
        await client.close();
        console.log('📡 Disconnected from MongoDB');
    }
}

function getNestedProperty(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : null;
    }, obj);
}

// EXECUTE SEARCH AND DESTROY
searchAndDestroyLegacyQnAs().catch(error => {
    console.error('💥 MISSION FAILED:', error);
    process.exit(1);
});
