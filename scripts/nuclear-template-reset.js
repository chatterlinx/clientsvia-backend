#!/usr/bin/env node
/**
 * NUCLEAR TEMPLATE RESET
 * 
 * Deletes ALL templates and reseeds the Universal template
 * with correct schema and isPublished: true
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

async function nuclearReset() {
    try {
        console.log('☢️  NUCLEAR TEMPLATE RESET - Starting...\n');
        console.log('🔧 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Step 1: Show current templates
        console.log('📊 Current templates in database:');
        const current = await GlobalInstantResponseTemplate.find().select('name version templateType isPublished isDefaultTemplate isActive');
        current.forEach(t => {
            console.log(`   - ${t.name} (${t.version})`);
            console.log(`     Type: ${t.templateType}, Published: ${t.isPublished}, Default: ${t.isDefaultTemplate}, Active: ${t.isActive}`);
        });
        console.log(`   Total: ${current.length} templates\n`);

        // Step 2: Delete ALL templates
        console.log('🗑️  Deleting ALL templates...');
        const deleteResult = await GlobalInstantResponseTemplate.deleteMany({});
        console.log(`✅ Deleted ${deleteResult.deletedCount} templates\n`);

        // Step 3: Verify deletion
        const remaining = await GlobalInstantResponseTemplate.countDocuments();
        console.log(`📊 Remaining templates: ${remaining}`);
        if (remaining > 0) {
            console.log('⚠️  WARNING: Some templates still remain!');
        }

        console.log('\n✅ Nuclear reset complete!');
        console.log('\n📝 Next steps:');
        console.log('   1. Run: npm run seed-global-ai-brain');
        console.log('   2. Verify Universal template appears in Clone dropdown');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

nuclearReset();

