/**
 * CHECK ALL COMPANIES - Show all companies across all collections
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';

async function checkAllCompanies() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 CHECKING ALL COMPANIES IN DATABASE`);
    console.log(`${'='.repeat(80)}\n`);

    try {
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB\n');

        const db = mongoose.connection.db;

        // Check companiesCollection
        console.log(`${'='.repeat(80)}`);
        console.log(`📁 COLLECTION: companiesCollection`);
        console.log(`${'='.repeat(80)}\n`);
        
        const companiesCollection = db.collection('companiesCollection');
        const companiesInPrimary = await companiesCollection.find({}).toArray();
        
        console.log(`Total companies in companiesCollection: ${companiesInPrimary.length}\n`);
        
        companiesInPrimary.forEach((company, index) => {
            console.log(`${index + 1}. ${company.companyName || company.businessName || 'Unnamed'}`);
            console.log(`   ID: ${company._id}`);
            console.log(`   Status: ${company.accountStatus?.status || 'unknown'}`);
            console.log(`   isDeleted: ${company.isDeleted || false}`);
            console.log(`   deletedAt: ${company.deletedAt || 'N/A'}`);
            console.log(`   Created: ${company.createdAt || 'N/A'}`);
            console.log('');
        });

        // Check legacy companies collection
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📁 COLLECTION: companies (legacy)`);
        console.log(`${'='.repeat(80)}\n`);
        
        const legacyCollection = db.collection('companies');
        const companiesInLegacy = await legacyCollection.find({}).toArray();
        
        console.log(`Total companies in companies (legacy): ${companiesInLegacy.length}\n`);
        
        companiesInLegacy.forEach((company, index) => {
            console.log(`${index + 1}. ${company.companyName || company.businessName || 'Unnamed'}`);
            console.log(`   ID: ${company._id}`);
            console.log(`   Status: ${company.accountStatus?.status || 'unknown'}`);
            console.log(`   isDeleted: ${company.isDeleted || false}`);
            console.log(`   deletedAt: ${company.deletedAt || 'N/A'}`);
            console.log(`   Created: ${company.createdAt || 'N/A'}`);
            console.log('');
        });

        // Summary
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 SUMMARY`);
        console.log(`${'='.repeat(80)}\n`);
        
        const totalCompanies = companiesInPrimary.length + companiesInLegacy.length;
        const liveInPrimary = companiesInPrimary.filter(c => !c.isDeleted && c.isDeleted !== true).length;
        const liveInLegacy = companiesInLegacy.filter(c => !c.isDeleted && c.isDeleted !== true).length;
        const deletedInPrimary = companiesInPrimary.filter(c => c.isDeleted === true).length;
        const deletedInLegacy = companiesInLegacy.filter(c => c.isDeleted === true).length;
        
        console.log(`Total Companies: ${totalCompanies}`);
        console.log(`  - companiesCollection: ${companiesInPrimary.length}`);
        console.log(`  - companies (legacy): ${companiesInLegacy.length}`);
        console.log('');
        console.log(`Live Companies: ${liveInPrimary + liveInLegacy}`);
        console.log(`  - companiesCollection: ${liveInPrimary}`);
        console.log(`  - companies (legacy): ${liveInLegacy}`);
        console.log('');
        console.log(`Deleted Companies: ${deletedInPrimary + deletedInLegacy}`);
        console.log(`  - companiesCollection: ${deletedInPrimary}`);
        console.log(`  - companies (legacy): ${deletedInLegacy}`);
        console.log('');

        // Check if any companies have no account status
        const noStatusPrimary = companiesInPrimary.filter(c => !c.accountStatus || !c.accountStatus.status);
        const noStatusLegacy = companiesInLegacy.filter(c => !c.accountStatus || !c.accountStatus.status);
        
        if (noStatusPrimary.length > 0 || noStatusLegacy.length > 0) {
            console.log(`\n⚠️  Companies with NO account status: ${noStatusPrimary.length + noStatusLegacy.length}`);
            console.log(`   This might be why they're not showing in Data Center!`);
            console.log('');
            
            [...noStatusPrimary, ...noStatusLegacy].forEach(c => {
                console.log(`   - ${c.companyName || c.businessName || 'Unnamed'} (${c._id})`);
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB\n');
    }
}

checkAllCompanies().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

