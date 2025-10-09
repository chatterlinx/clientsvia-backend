/**
 * Script to reactivate all inactive Action Hook Directories
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalActionHookDirectory = require('../models/GlobalActionHookDirectory');

async function fixInactiveDirectories() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('📊 Finding inactive directories...');
        const inactiveDirectories = await GlobalActionHookDirectory.find({ isActive: false });

        if (inactiveDirectories.length === 0) {
            console.log('✅ No inactive directories found. All directories are active!\n');
            await mongoose.connection.close();
            process.exit(0);
        }

        console.log(`\nFound ${inactiveDirectories.length} inactive directories:\n`);
        inactiveDirectories.forEach(dir => {
            console.log(`   - ${dir.name} (${dir.directoryId})`);
        });

        console.log('\n🔧 Reactivating all directories...');
        const result = await GlobalActionHookDirectory.updateMany(
            { isActive: false },
            { $set: { isActive: true, lastModifiedBy: 'System Fix Script' } }
        );

        console.log(`\n✅ Updated ${result.modifiedCount} directories to Active: true`);

        await mongoose.connection.close();
        console.log('\n🔌 Disconnected from MongoDB');
        console.log('\n✨ All directories are now active!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixInactiveDirectories();
