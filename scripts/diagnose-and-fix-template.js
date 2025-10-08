/**
 * ============================================================================
 * DIAGNOSE AND FIX TEMPLATE - COMPREHENSIVE SOLUTION
 * ============================================================================
 * 
 * This script will:
 * 1. Show ALL templates in database with their IDs
 * 2. Delete ALL templates (clean slate)
 * 3. Explain next steps
 * 
 * Usage: node scripts/diagnose-and-fix-template.js
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

async function diagnoseAndFix() {
    try {
        console.log('🔧 DIAGNOSE AND FIX TEMPLATES');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Step 1: List ALL templates
        console.log('📋 STEP 1: Finding all templates in database...\n');
        const templates = await GlobalInstantResponseTemplate.find({});
        
        if (templates.length === 0) {
            console.log('✅ No templates found - database is clean!');
            console.log('\n📝 Next steps:');
            console.log('   1. Go to Global AI Brain page');
            console.log('   2. Settings tab');
            console.log('   3. Click "Seed 8 Categories"');
            process.exit(0);
        }

        console.log(`Found ${templates.length} template(s):\n`);
        
        templates.forEach((t, index) => {
            console.log(`Template #${index + 1}:`);
            console.log(`   ID: ${t._id}`);
            console.log(`   Version: ${t.version}`);
            console.log(`   Active: ${t.isActive}`);
            console.log(`   Categories: ${t.categories?.length || 0}`);
            console.log(`   Scenarios: ${t.stats?.totalScenarios || 0}`);
            
            // Check if categories have behavior field
            if (t.categories && t.categories.length > 0) {
                const hasBehavior = t.categories[0].behavior !== undefined;
                console.log(`   Has behavior field: ${hasBehavior ? '✅ YES' : '❌ NO (OLD SCHEMA!)'}`);
            }
            console.log(`   Created: ${t.createdAt}\n`);
        });

        // Step 2: Delete all templates
        console.log('🗑️  STEP 2: Deleting ALL templates for clean slate...\n');
        
        const deleteResult = await GlobalInstantResponseTemplate.deleteMany({});
        console.log(`✅ Deleted ${deleteResult.deletedCount} template(s)\n`);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✨ DATABASE CLEANED SUCCESSFULLY!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n📝 NEXT STEPS:');
        console.log('   1. Go to Global AI Brain page in your browser');
        console.log('   2. Refresh the page (Cmd+R or Ctrl+R)');
        console.log('   3. Go to Settings tab');
        console.log('   4. Click "Seed 8 Categories" button');
        console.log('   5. Refresh again');
        console.log('   6. Go to Overview tab - see your categories!');
        console.log('   7. SUCCESS! 🎉\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('\nFull error:', error);
        process.exit(1);
    }
}

// Run the script
diagnoseAndFix();

