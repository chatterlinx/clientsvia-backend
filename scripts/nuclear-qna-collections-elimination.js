/**
 * ☢️ NUCLEAR Q&A COLLECTIONS ELIMINATION
 * ======================================
 * 
 * MISSION: Find and DESTROY all Q&A collections at once
 * TARGET: Complete elimination of all Q&A storage locations
 * 
 * STRATEGY: 
 * 1. List all MongoDB collections
 * 2. Identify Q&A-related collections
 * 3. DROP entire collections (fastest way to delete all at once)
 * 4. Verify complete elimination
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

async function nuclearQnACollectionsElimination() {
    console.log('☢️ NUCLEAR Q&A COLLECTIONS ELIMINATION');
    console.log('=======================================');
    console.log('🎯 TARGET: Complete elimination of all Q&A collections');
    console.log('⚠️  WARNING: This will DROP entire collections (fastest deletion method)');
    console.log('');

    const client = await connectToMongoDB();
    const db = client.db();

    try {
        // First, let's list ALL collections to see what exists
        console.log('🔍 SCANNING ALL MONGODB COLLECTIONS...');
        const collections = await db.listCollections().toArray();
        
        console.log(`📊 Found ${collections.length} total collections:`);
        collections.forEach((collection, index) => {
            console.log(`   ${index + 1}. ${collection.name}`);
        });

        // Identify Q&A-related collections
        const qnaCollectionNames = [
            'companyqnas',           // Main Q&A collection (from CompanyKnowledgeQnA model)
            'knowledgeentries',      // Legacy knowledge entries
            'suggestedknowledgeentries', // Legacy suggested entries
            'approvedknowledges',    // Legacy approved knowledge
            'companyknowledgeqnas',  // Alternative naming
            'qnas',                  // Generic Q&A
            'knowledge',             // Generic knowledge
            'companykb',             // Company knowledge base
            'knowledgebase'          // Knowledge base
        ];

        console.log('\n🔍 CHECKING FOR Q&A COLLECTIONS...');
        const existingQnACollections = [];
        
        for (const collectionName of qnaCollectionNames) {
            try {
                const collectionExists = collections.some(col => col.name === collectionName);
                if (collectionExists) {
                    // Check document count
                    const count = await db.collection(collectionName).countDocuments();
                    console.log(`❌ FOUND: ${collectionName} (${count} documents)`);
                    existingQnACollections.push({ name: collectionName, count });
                    
                    // Show sample documents
                    if (count > 0) {
                        const samples = await db.collection(collectionName).find({}).limit(3).toArray();
                        console.log(`   📋 Sample documents:`);
                        samples.forEach((doc, index) => {
                            const question = doc.question || doc.title || doc.name || 'Unknown';
                            const answer = doc.answer || doc.content || doc.response || 'Unknown';
                            console.log(`      ${index + 1}. "${question.substring(0, 40)}..." -> "${answer.substring(0, 40)}..."`);
                        });
                    }
                } else {
                    console.log(`✅ NOT FOUND: ${collectionName}`);
                }
            } catch (error) {
                console.log(`❌ ERROR checking ${collectionName}: ${error.message}`);
            }
        }

        if (existingQnACollections.length === 0) {
            console.log('\n✅ NO Q&A COLLECTIONS FOUND - Database is already clean!');
            return;
        }

        // NUCLEAR ELIMINATION - DROP entire collections
        console.log('\n☢️ INITIATING NUCLEAR COLLECTION ELIMINATION...');
        console.log('⚠️  This will DROP entire collections (fastest way to delete all Q&As at once)');
        
        let droppedCount = 0;
        let totalDocumentsDeleted = 0;
        
        for (const collection of existingQnACollections) {
            try {
                console.log(`\n🔥 DROPPING COLLECTION: ${collection.name} (${collection.count} documents)`);
                await db.collection(collection.name).drop();
                console.log(`✅ ELIMINATED: ${collection.name} - ${collection.count} documents deleted`);
                droppedCount++;
                totalDocumentsDeleted += collection.count;
            } catch (error) {
                if (error.message.includes('ns not found')) {
                    console.log(`ℹ️  ALREADY GONE: ${collection.name} (collection doesn't exist)`);
                } else {
                    console.log(`❌ ERROR dropping ${collection.name}: ${error.message}`);
                }
            }
        }

        console.log('\n✅ NUCLEAR COLLECTION ELIMINATION COMPLETE');
        console.log('===========================================');
        console.log(`☢️ Collections dropped: ${droppedCount}`);
        console.log(`📊 Total documents eliminated: ${totalDocumentsDeleted}`);
        console.log('🎯 ALL Q&A DATA ELIMINATED AT ONCE');

        // Verify elimination
        console.log('\n🔍 VERIFICATION: Checking for remaining Q&A collections...');
        const remainingCollections = await db.listCollections().toArray();
        const remainingQnACollections = remainingCollections.filter(col => 
            qnaCollectionNames.some(qnaName => col.name.toLowerCase().includes(qnaName.toLowerCase()))
        );
        
        if (remainingQnACollections.length === 0) {
            console.log('✅ VERIFICATION PASSED: No Q&A collections remain');
        } else {
            console.log(`❌ VERIFICATION FAILED: ${remainingQnACollections.length} Q&A collections still exist:`);
            remainingQnACollections.forEach(col => {
                console.log(`   - ${col.name}`);
            });
        }

        // Also check for embedded Q&As in Company documents
        console.log('\n🔍 CHECKING FOR EMBEDDED Q&As IN COMPANY DOCUMENTS...');
        const companiesWithEmbeddedQnA = await db.collection('companies').find({
            $or: [
                { 'companyQnA': { $exists: true, $ne: [] } },
                { 'companyKB': { $exists: true, $ne: [] } },
                { 'knowledgeBase': { $exists: true, $ne: [] } }
            ]
        }).toArray();

        if (companiesWithEmbeddedQnA.length > 0) {
            console.log(`❌ FOUND ${companiesWithEmbeddedQnA.length} companies with embedded Q&As`);
            console.log('🔥 ELIMINATING EMBEDDED Q&As...');
            
            const embeddedResult = await db.collection('companies').updateMany(
                {},
                { 
                    $unset: { 
                        'companyQnA': 1,
                        'companyKB': 1,
                        'knowledgeBase': 1
                    } 
                }
            );
            
            console.log(`✅ ELIMINATED embedded Q&As from ${embeddedResult.modifiedCount} companies`);
        } else {
            console.log('✅ No embedded Q&As found in company documents');
        }

    } catch (error) {
        console.error('❌ Error during nuclear collection elimination:', error);
    } finally {
        await client.close();
        console.log('\n🔌 MongoDB connection closed');
    }
}

// Run the nuclear collection elimination
nuclearQnACollectionsElimination().catch(console.error);
