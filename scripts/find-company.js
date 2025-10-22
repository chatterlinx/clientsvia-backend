require('dotenv').config();
const mongoose = require('mongoose');

async function findCompany() {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    
    const targetId = '68db204e1b313a26fd5e04de'; // Total Air
    console.log(`🔍 Searching for company: ${targetId}`);
    
    // Check companiesCollection (main collection)
    const main = await db.collection('companiesCollection').findOne({_id: mongoose.Types.ObjectId.createFromHexString(targetId)});
    console.log('\n📊 companiesCollection (MAIN):', Boolean(main) ? 'FOUND' : 'NOT FOUND');
    if (main) {
        console.log('   Name:', main.companyName);
        console.log('   callFiltering exists:', Boolean(main.callFiltering));
        if (main.callFiltering) {
            console.log('   callFiltering.settings:', JSON.stringify(main.callFiltering.settings, null, 2));
        }
    }
    
    // Check v2companies
    const v2 = await db.collection('v2companies').findOne({_id: mongoose.Types.ObjectId.createFromHexString(targetId)});
    console.log('\n📊 v2companies collection:', Boolean(v2) ? 'FOUND' : 'NOT FOUND');
    if (v2) {
        console.log('   Name:', v2.companyName);
        console.log('   callFiltering exists:', Boolean(v2.callFiltering));
        if (v2.callFiltering) {
            console.log('   callFiltering.settings:', JSON.stringify(v2.callFiltering.settings, null, 2));
        }
    }
    
    // Check legacy companies
    const legacy = await db.collection('companies').findOne({_id: mongoose.Types.ObjectId.createFromHexString(targetId)});
    console.log('\n📊 companies (legacy) collection:', Boolean(legacy) ? 'FOUND' : 'NOT FOUND');
    if (legacy) {
        console.log('   Name:', legacy.companyName);
        console.log('   callFiltering exists:', Boolean(legacy.callFiltering));
        if (legacy.callFiltering) {
            console.log('   callFiltering.settings:', JSON.stringify(legacy.callFiltering.settings, null, 2));
        }
    }
    
    process.exit(0);
}

findCompany();

