// ============================================================================
// CHECK SPAM FILTER SETTINGS IN DATABASE
// ============================================================================

require('dotenv').config();
const mongoose = require('mongoose');
const v2Company = require('../models/v2Company');

async function checkSettings() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected!');

        const companyId = '68eeaf924e989145e9d46c12'; // Real Royal Plumbing ID
        console.log(`\n📊 Checking spam filter settings for company: ${companyId}`);

        const company = await v2Company.findById(companyId).lean();
        
        if (!company) {
            console.log('❌ Company not found!');
            process.exit(1);
        }

        console.log('\n🔍 Full callFiltering object:');
        console.log(JSON.stringify(company.callFiltering, null, 2));

        console.log('\n🔍 Settings specifically:');
        console.log(JSON.stringify(company.callFiltering?.settings, null, 2));

        console.log('\n🔍 Settings keys:');
        if (company.callFiltering?.settings) {
            console.log(Object.keys(company.callFiltering.settings));
        } else {
            console.log('No settings object exists!');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkSettings();

