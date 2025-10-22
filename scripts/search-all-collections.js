require('dotenv').config();
const mongoose = require('mongoose');

async function searchAll() {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    
    const targetId = '68e3f77a9d623b8058c700c4';
    console.log(`🔍 Searching ALL collections for ID: ${targetId}\n`);
    
    // Get all collection names
    const collections = await db.listCollections().toArray();
    
    for (const coll of collections) {
        const name = coll.name;
        try {
            const doc = await db.collection(name).findOne({_id: mongoose.Types.ObjectId.createFromHexString(targetId)});
            if (doc) {
                console.log(`✅ FOUND IN: ${name}`);
                console.log(`   Company Name: ${doc.companyName || 'N/A'}`);
                console.log(`   Has callFiltering: ${Boolean(doc.callFiltering)}`);
                if (doc.callFiltering) {
                    console.log(`   callFiltering.settings:`, JSON.stringify(doc.callFiltering.settings, null, 2));
                }
                console.log('');
            }
        } catch (err) {
            // Skip collections that can't be queried with this ID
        }
    }
    
    console.log('\n✅ Search complete');
    process.exit(0);
}

searchAll();

