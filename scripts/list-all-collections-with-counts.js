require('dotenv').config();
const mongoose = require('mongoose');

async function listAll() {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    
    console.log('🔍 LISTING ALL COLLECTIONS IN DATABASE:\n');
    
    const collections = await db.listCollections().toArray();
    
    for (const coll of collections) {
        const count = await db.collection(coll.name).countDocuments({});
        console.log(`📊 ${coll.name}: ${count} documents`);
        
        // If it might be a company collection, show sample
        if (coll.name.toLowerCase().includes('compan')) {
            const sample = await db.collection(coll.name).findOne({});
            if (sample) {
                console.log(`   Sample ID: ${sample._id}`);
                console.log(`   Sample Name: ${sample.companyName || sample.name || 'N/A'}`);
            }
            console.log('');
        }
    }
    
    process.exit(0);
}

listAll();

