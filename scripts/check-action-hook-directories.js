/**
 * Diagnostic script to check Action Hook Directories in database
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalActionHookDirectory = require('../models/GlobalActionHookDirectory');

async function checkDirectories() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('📊 Fetching all Action Hook Directories...\n');
        const directories = await GlobalActionHookDirectory.find().sort({ sortOrder: 1 });

        console.log(`Found ${directories.length} directories:\n`);
        console.log('='.repeat(80));

        directories.forEach((dir, index) => {
            console.log(`\n${index + 1}. ${dir.name} (${dir.directoryId})`);
            console.log(`   ID: ${dir._id}`);
            console.log(`   Icon: ${dir.icon}`);
            console.log(`   Color: ${dir.color}`);
            console.log(`   Sort Order: ${dir.sortOrder}`);
            console.log(`   Active: ${dir.isActive}`);
            console.log(`   System Default: ${dir.isSystemDefault}`);
            console.log(`   Description: ${dir.description || 'N/A'}`);
        });

        console.log('\n' + '='.repeat(80));
        console.log(`\n✅ Total: ${directories.length} directories`);

        await mongoose.connection.close();
        console.log('\n🔌 Disconnected from MongoDB');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkDirectories();
