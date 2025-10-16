const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkCompanies() {
    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');

        const count = await mongoose.connection.db.collection('companies').countDocuments();
        console.log(`\n📊 Total companies in 'companies' collection: ${count}`);

        const allCompanies = await mongoose.connection.db.collection('companies').find({}).toArray();
        console.log(`\n📋 All ${allCompanies.length} Companies:`);
        
        allCompanies.forEach((company, index) => {
            const name = company.companyName || company.businessName || 'Unnamed';
            const deleted = company.isDeleted ? '🗑️ DELETED' : '✅ LIVE';
            const active = company.isActive !== false ? 'ACTIVE' : 'INACTIVE';
            console.log(`\n${index + 1}. ${deleted} ${name}`);
            console.log(`   ID: ${company._id}`);
            console.log(`   Status: ${active}`);
            console.log(`   Created: ${company.createdAt || 'N/A'}`);
            if (company.email || company.ownerEmail) {
                console.log(`   Email: ${company.email || company.ownerEmail}`);
            }
            if (company.isDeleted) {
                console.log(`   Deleted At: ${company.deletedAt || 'N/A'}`);
                console.log(`   Delete Reason: ${company.deleteReason || 'N/A'}`);
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

checkCompanies();
