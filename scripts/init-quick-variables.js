#!/usr/bin/env node
/**
 * Initialize quickVariables field for all companies
 * Run this on Render if quickVariables field doesn't exist
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function initializeQuickVariables() {
    try {
        console.log('🔧 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected\n');

        const db = mongoose.connection.db;
        const companiesCollection = db.collection('companiesCollection');

        // Find companies without quickVariables field
        console.log('🔍 Finding companies without quickVariables field...');
        const companiesWithoutField = await companiesCollection.countDocuments({
            quickVariables: { $exists: false }
        });

        console.log(`📊 Found ${companiesWithoutField} companies without quickVariables field\n`);

        if (companiesWithoutField === 0) {
            console.log('✅ All companies already have quickVariables field!');
            process.exit(0);
        }

        // Initialize the field as an empty array
        console.log('🔧 Initializing quickVariables field...');
        const result = await companiesCollection.updateMany(
            { quickVariables: { $exists: false } },
            { $set: { quickVariables: [] } }
        );

        console.log('✅ Update complete!');
        console.log(`📊 Modified ${result.modifiedCount} documents`);
        console.log(`📊 Matched ${result.matchedCount} documents\n`);

        // Verify
        console.log('🔍 Verifying...');
        const remaining = await companiesCollection.countDocuments({
            quickVariables: { $exists: false }
        });

        if (remaining === 0) {
            console.log('✅ SUCCESS: All companies now have quickVariables field!');
        } else {
            console.error(`❌ WARNING: ${remaining} companies still missing field`);
        }

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

initializeQuickVariables();

