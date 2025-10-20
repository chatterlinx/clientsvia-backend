require('dotenv').config();
const mongoose = require('mongoose');

async function checkLegacy() {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    
    console.log('🔍 CHECKING LEGACY "companies" COLLECTION:\n');
    
    const companies = await db.collection('companies').find({}).toArray();
    console.log(`Found ${companies.length} companies in LEGACY collection:\n`);
    
    companies.forEach((c, i) => {
        console.log(`${i + 1}. ${c.companyName || 'Unnamed'}`);
        console.log(`   ID: ${c._id}`);
        console.log(`   Status: ${c.status || c.isDeleted ? 'deleted' : 'live'}`);
        console.log(`   Has callFiltering: ${!!c.callFiltering}`);
        if (c.callFiltering?.settings) {
            console.log(`   callFiltering.settings:`, JSON.stringify(c.callFiltering.settings, null, 2));
        }
        console.log('');
    });
    
    process.exit(0);
}

checkLegacy();

