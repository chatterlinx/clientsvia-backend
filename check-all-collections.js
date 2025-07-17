// check-all-collections.js
// Script to check all collections and their contents

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chatterlinx:eSnQuCbvZUXTJ6ZV@cluster0.0bqzx.mongodb.net/';
const DB_NAME = process.env.MONGODB_DB_NAME || 'clientsvia';

async function checkAllCollections() {
    console.log('Checking all collections in database...');
    
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        
        // List all collections
        const collections = await db.listCollections().toArray();
        console.log(`Found ${collections.length} collections in database '${DB_NAME}':`);
        
        for (const collection of collections) {
            console.log(`\n📁 Collection: ${collection.name}`);
            
            const coll = db.collection(collection.name);
            const count = await coll.countDocuments();
            console.log(`   Documents: ${count}`);
            
            if (count > 0 && count <= 5) {
                const samples = await coll.find({}).limit(2).toArray();
                console.log(`   Sample documents:`, JSON.stringify(samples, null, 2));
            }
        }
        
    } catch (error) {
        console.error('Error checking collections:', error);
    } finally {
        await client.close();
    }
}

// Run if called directly
if (require.main === module) {
    checkAllCollections()
        .then(() => {
            console.log('\nCollection check completed.');
            process.exit(0);
        })
        .catch(error => {
            console.error('Failed to check collections:', error);
            process.exit(1);
        });
}

module.exports = { checkAllCollections };
