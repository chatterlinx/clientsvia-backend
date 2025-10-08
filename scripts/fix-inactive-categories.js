/**
 * Fix script: Reactivate all inactive system default categories
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalActionHookCategory = require('../models/GlobalActionHookCategory');

async function fixCategories() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('📊 Finding inactive categories...\n');
        const inactiveCategories = await GlobalActionHookCategory.find({ isActive: false });

        if (inactiveCategories.length === 0) {
            console.log('✅ No inactive categories found. All good!');
        } else {
            console.log(`Found ${inactiveCategories.length} inactive categories:\n`);
            
            for (const cat of inactiveCategories) {
                console.log(`   - ${cat.name} (${cat.categoryId})`);
            }

            console.log('\n🔧 Reactivating all categories...\n');

            const result = await GlobalActionHookCategory.updateMany(
                { isActive: false },
                { $set: { isActive: true } }
            );

            console.log(`✅ Updated ${result.modifiedCount} categories to Active: true`);
        }

        await mongoose.connection.close();
        console.log('\n🔌 Disconnected from MongoDB');
        console.log('\n✨ All categories are now active!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixCategories();

