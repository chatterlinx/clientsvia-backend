/**
 * Diagnostic script to check Action Hook Categories in database
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalActionHookCategory = require('../models/GlobalActionHookCategory');

async function checkCategories() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('📊 Fetching all Action Hook Categories...\n');
        const categories = await GlobalActionHookCategory.find().sort({ sortOrder: 1 });

        console.log(`Found ${categories.length} categories:\n`);
        console.log('='.repeat(80));

        categories.forEach((cat, index) => {
            console.log(`\n${index + 1}. ${cat.name} (${cat.categoryId})`);
            console.log(`   ID: ${cat._id}`);
            console.log(`   Icon: ${cat.icon}`);
            console.log(`   Color: ${cat.color}`);
            console.log(`   Sort Order: ${cat.sortOrder}`);
            console.log(`   Active: ${cat.isActive}`);
            console.log(`   System Default: ${cat.isSystemDefault}`);
            console.log(`   Description: ${cat.description || 'N/A'}`);
        });

        console.log('\n' + '='.repeat(80));
        console.log(`\n✅ Total: ${categories.length} categories`);

        await mongoose.connection.close();
        console.log('\n🔌 Disconnected from MongoDB');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkCategories();

