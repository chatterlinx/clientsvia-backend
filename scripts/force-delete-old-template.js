/**
 * ============================================================================
 * FORCE DELETE OLD TEMPLATE - BYPASS API VALIDATION
 * ============================================================================
 * 
 * This script directly deletes the old template from MongoDB, bypassing
 * all API validation and active status checks.
 * 
 * Use this when:
 * - UI buttons fail with HTTP 500/400 errors
 * - Template has schema conflicts preventing normal deletion
 * - Template is stuck as "active" and can't be deactivated
 * 
 * Usage: node scripts/force-delete-old-template.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

async function forceDeleteOldTemplate() {
    try {
        console.log('🔧 FORCE DELETE OLD TEMPLATE');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const targetId = '68e5033ab02424067d056f0a';
        console.log(`🎯 Target template ID: ${targetId}\n`);

        // Check if template exists
        console.log('🔍 Checking if template exists...');
        const template = await GlobalInstantResponseTemplate.findById(targetId);
        
        if (!template) {
            console.log('✅ Template not found - already deleted or never existed');
            console.log('\n📝 You can now seed the new template from the UI');
            process.exit(0);
        }

        console.log(`📋 Found template: ${template.version}`);
        console.log(`   - Categories: ${template.stats?.totalCategories || 0}`);
        console.log(`   - Scenarios: ${template.stats?.totalScenarios || 0}`);
        console.log(`   - Active: ${template.isActive}`);
        console.log(`   - Created: ${template.createdAt}\n`);

        // Force delete - bypass all validation
        console.log('🗑️  Force deleting template (bypassing validation)...');
        const result = await GlobalInstantResponseTemplate.deleteOne({ _id: targetId });
        
        if (result.deletedCount > 0) {
            console.log('✅ Template deleted successfully!\n');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('✨ NEXT STEPS:');
            console.log('   1. Go to Global AI Brain page in browser');
            console.log('   2. Refresh the page (Cmd+R or Ctrl+R)');
            console.log('   3. Go to Settings tab');
            console.log('   4. Click "Seed 8 Categories" button');
            console.log('   5. Done! 🎉');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        } else {
            console.log('⚠️  No documents deleted (template might have been removed already)\n');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('\nFull error:', error);
        process.exit(1);
    }
}

// Run the script
forceDeleteOldTemplate();

