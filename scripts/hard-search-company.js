/**
 * HARD SEARCH - Verify company is completely deleted from ALL collections
 * Usage: node scripts/hard-search-company.js "company name"
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';

async function hardSearch(searchTerm) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 HARD SEARCH: "${searchTerm}"`);
    console.log(`${'='.repeat(80)}\n`);

    try {
        // Connect to MongoDB
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB\n');

        const db = mongoose.connection.db;

        // Get all collections
        const collections = await db.listCollections().toArray();
        console.log(`📊 Searching across ${collections.length} collections...\n`);

        let totalFound = 0;
        const results = [];

        // Search in all collections
        for (const collectionInfo of collections) {
            const collectionName = collectionInfo.name;
            
            // Skip system collections
            if (collectionName.startsWith('system.')) {continue;}

            const collection = db.collection(collectionName);

            try {
                // Search for company name in various fields
                const query = {
                    $or: [
                        { companyName: new RegExp(searchTerm, 'i') },
                        { businessName: new RegExp(searchTerm, 'i') },
                        { name: new RegExp(searchTerm, 'i') }
                    ]
                };

                const count = await collection.countDocuments(query);

                if (count > 0) {
                    console.log(`❌ FOUND ${count} document(s) in collection: ${collectionName}`);
                    
                    // Get actual documents
                    const docs = await collection.find(query).limit(5).toArray();
                    docs.forEach((doc, index) => {
                        console.log(`   Document ${index + 1}:`, {
                            _id: doc._id,
                            companyName: doc.companyName || doc.businessName || doc.name,
                            isDeleted: doc.isDeleted,
                            deletedAt: doc.deletedAt
                        });
                    });
                    console.log('');
                    
                    totalFound += count;
                    results.push({ collection: collectionName, count, documents: docs });
                } else {
                    console.log(`✅ Clean - ${collectionName}`);
                }
            } catch (err) {
                console.warn(`⚠️  Could not search ${collectionName}:`, err.message);
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🎯 SEARCH COMPLETE`);
        console.log(`${'='.repeat(80)}\n`);

        if (totalFound === 0) {
            console.log(`✅ SUCCESS: "${searchTerm}" is COMPLETELY DELETED`);
            console.log(`✅ No traces found in any collection`);
            console.log(`✅ Hard delete was successful!\n`);
        } else {
            console.log(`❌ WARNING: Found ${totalFound} document(s) containing "${searchTerm}"`);
            console.log(`❌ Hard delete may not have completed properly\n`);
            
            console.log(`📋 Summary:`);
            results.forEach(r => {
                console.log(`   - ${r.collection}: ${r.count} document(s)`);
            });
            console.log('');
        }

    } catch (error) {
        console.error('❌ Search error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB\n');
    }
}

// Get search term from command line
const searchTerm = process.argv[2] || 'benjamin Plumbing';

hardSearch(searchTerm).then(() => {
    process.exit(0);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

