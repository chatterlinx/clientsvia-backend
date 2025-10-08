/**
 * ============================================================================
 * RESET GLOBAL TEMPLATE
 * ============================================================================
 * 
 * This script deletes the old global template and allows re-seeding with
 * the new simplified structure.
 * 
 * Run this script when:
 * - Upgrading from old schema to new simplified schema
 * - Need to completely reset the global AI brain
 * 
 * Usage: node scripts/reset-global-template.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

async function resetGlobalTemplate() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        console.log('\n🗑️  Deleting old global template...');
        const result = await GlobalInstantResponseTemplate.deleteMany({});
        console.log(`✅ Deleted ${result.deletedCount} template(s)`);

        console.log('\n✅ Global template reset complete!');
        console.log('📝 You can now re-seed the template from the admin UI or API');
        console.log('   Go to: Global AI Brain > Settings > Seed 8 Categories\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error resetting template:', error);
        process.exit(1);
    }
}

resetGlobalTemplate();

