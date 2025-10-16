const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Company = require('../models/v2Company');

async function countDeletedCompanies() {
    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!mongoUri) {
            console.error('❌ MONGODB_URI not found in environment variables');
            process.exit(1);
        }

        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');

        // Use aggregation to bypass middleware
        const allCompanies = await mongoose.connection.db.collection('companies').find({}).toArray();
        const totalCount = allCompanies.length;
        const deletedCount = allCompanies.filter(c => c.isDeleted === true).length;
        const liveCount = allCompanies.filter(c => c.isDeleted !== true).length;

        console.log('\n📊 Company Statistics:');
        console.log(`   Total Companies: ${totalCount}`);
        console.log(`   Live Companies: ${liveCount}`);
        console.log(`   Deleted Companies: ${deletedCount}`);
        
        // List all companies
        console.log('\n📋 All Companies:');
        allCompanies.forEach(company => {
            const name = company.companyName || company.businessName || 'Unnamed';
            const status = company.isDeleted ? '🗑️ DELETED' : '✅ LIVE';
            console.log(`   ${status} - ${name} (${company._id})`);
            if (company.isDeleted && company.deletedAt) {
                console.log(`       Deleted: ${company.deletedAt}`);
            }
            if (company.deleteReason) {
                console.log(`       Reason: ${company.deleteReason}`);
            }
        });

        await mongoose.disconnect();
        console.log('\n✅ Done');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

countDeletedCompanies();
