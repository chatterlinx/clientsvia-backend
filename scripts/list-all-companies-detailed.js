require('dotenv').config();
const mongoose = require('mongoose');

async function listAll() {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    
    console.log('🔍 CHECKING ALL COMPANY COLLECTIONS:\n');
    
    // Check companiesCollection (main)
    console.log('═══════════════════════════════════════════════════════');
    console.log('📊 companiesCollection (MAIN):');
    console.log('═══════════════════════════════════════════════════════');
    const mainCompanies = await db.collection('companiesCollection').find({}).toArray();
    console.log(`Found ${mainCompanies.length} companies`);
    mainCompanies.forEach((c, i) => {
        console.log(`\n${i + 1}. ${c.companyName || 'Unnamed'}`);
        console.log(`   ID: ${c._id}`);
        console.log(`   Status: ${c.status || 'unknown'}`);
        console.log(`   Has callFiltering: ${!!c.callFiltering}`);
        if (c.callFiltering?.settings) {
            console.log(`   callFiltering.settings:`, Object.keys(c.callFiltering.settings));
        }
    });
    
    // Check companies (legacy)
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📊 companies (LEGACY):');
    console.log('═══════════════════════════════════════════════════════');
    const legacyCompanies = await db.collection('companies').find({}).toArray();
    console.log(`Found ${legacyCompanies.length} companies`);
    legacyCompanies.forEach((c, i) => {
        console.log(`\n${i + 1}. ${c.companyName || 'Unnamed'}`);
        console.log(`   ID: ${c._id}`);
        console.log(`   Status: ${c.status || 'unknown'}`);
        console.log(`   Has callFiltering: ${!!c.callFiltering}`);
        if (c.callFiltering?.settings) {
            console.log(`   callFiltering.settings:`, Object.keys(c.callFiltering.settings));
        }
    });
    
    // Check v2companies
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📊 v2companies:');
    console.log('═══════════════════════════════════════════════════════');
    const v2Companies = await db.collection('v2companies').find({}).toArray();
    console.log(`Found ${v2Companies.length} companies`);
    v2Companies.forEach((c, i) => {
        console.log(`\n${i + 1}. ${c.companyName || 'Unnamed'}`);
        console.log(`   ID: ${c._id}`);
        console.log(`   Status: ${c.status || 'unknown'}`);
        console.log(`   Has callFiltering: ${!!c.callFiltering}`);
        if (c.callFiltering?.settings) {
            console.log(`   callFiltering.settings:`, Object.keys(c.callFiltering.settings));
        }
    });
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✅ SEARCH COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
    
    process.exit(0);
}

listAll();

