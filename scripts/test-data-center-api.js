const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Company = require('../models/v2Company');

async function testAPI() {
    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');

        // Simulate what the API does
        const match = {};
        const state = 'all';
        
        if (state === 'live') {
            match.isDeleted = { $ne: true };
            match.isActive = true;
        } else if (state === 'deleted') {
            match.isDeleted = true;
        }
        
        console.log('\n📊 Match filter:', JSON.stringify(match, null, 2));

        const pipeline = [
            { $match: match },
            {
                $project: {
                    _id: 1,
                    companyName: 1,
                    businessName: 1,
                    email: 1,
                    ownerEmail: 1,
                    createdAt: 1,
                    isDeleted: 1,
                    isActive: 1
                }
            }
        ];

        console.log('\n🔍 Running aggregation...');
        const companies = await Company.aggregate(pipeline);
        
        console.log(`\n✅ Found ${companies.length} companies:`);
        companies.forEach((company, index) => {
            const name = company.companyName || company.businessName || 'Unnamed';
            const deleted = company.isDeleted ? '🗑️' : '✅';
            console.log(`${index + 1}. ${deleted} ${name} (${company._id})`);
        });

        await mongoose.disconnect();
        console.log('\n✅ Done');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

testAPI();
