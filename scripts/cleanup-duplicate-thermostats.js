/**
 * Cleanup Script: Remove Duplicate "Thermostats" Categories
 * 
 * Issue: Multiple "Thermostats" categories exist due to the "Active" checkbox confusion
 * Solution: Find all duplicate "Thermostats" categories and keep only one (the active one)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

async function cleanupDuplicateThermostats() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Find all templates first
        const allTemplates = await GlobalInstantResponseTemplate.find({});
        console.log(`📚 Found ${allTemplates.length} templates:\n`);
        allTemplates.forEach((t, i) => {
            console.log(`  ${i + 1}. ${t.name} (ID: ${t._id})`);
            console.log(`     Categories: ${t.categories?.length || 0}`);
            if (t.categories && t.categories.length > 0) {
                t.categories.forEach(cat => {
                    console.log(`       - ${cat.icon || '📁'} ${cat.name} (Active: ${cat.isActive}, Scenarios: ${cat.scenarios?.length || 0})`);
                });
            }
            console.log('');
        });

        // Just use the first template (there's only one)
        const hvacTemplate = allTemplates[0];

        if (!hvacTemplate) {
            console.log('❌ No templates found');
            process.exit(1);
        }

        console.log(`📋 Found template: ${hvacTemplate.name}`);
        console.log(`📁 Total categories: ${hvacTemplate.categories.length}\n`);

        // Find all "Thermostats" categories
        const thermostatCategories = hvacTemplate.categories.filter(cat => 
            cat.name.toLowerCase().includes('thermostat')
        );

        console.log(`🌡️ Found ${thermostatCategories.length} Thermostat categories:\n`);
        
        thermostatCategories.forEach((cat, index) => {
            console.log(`  ${index + 1}. ID: ${cat.id}`);
            console.log(`     Name: ${cat.name}`);
            console.log(`     Icon: ${cat.icon || 'No icon'}`);
            console.log(`     Active: ${cat.isActive}`);
            console.log(`     Scenarios: ${cat.scenarios?.length || 0}`);
            console.log(`     Description: ${cat.description || 'No description'}`);
            console.log('');
        });

        if (thermostatCategories.length <= 1) {
            console.log('✅ No duplicates found. Nothing to clean up.');
            process.exit(0);
        }

        // Keep the active one with scenarios, remove the rest
        const activeWithScenarios = thermostatCategories.find(cat => 
            cat.isActive === true && cat.scenarios && cat.scenarios.length > 0
        );

        const activeWithoutScenarios = thermostatCategories.find(cat => 
            cat.isActive === true && (!cat.scenarios || cat.scenarios.length === 0)
        );

        const inactive = thermostatCategories.filter(cat => !cat.isActive);

        let categoryToKeep;
        if (activeWithScenarios) {
            categoryToKeep = activeWithScenarios;
            console.log('✅ Keeping: Active category with scenarios');
        } else if (activeWithoutScenarios) {
            categoryToKeep = activeWithoutScenarios;
            console.log('✅ Keeping: Active category (no scenarios yet)');
        } else {
            categoryToKeep = thermostatCategories[0];
            console.log('⚠️ Keeping: First category found');
        }

        console.log(`📌 Category to keep: ${categoryToKeep.id} (${categoryToKeep.name})\n`);

        // Remove duplicates
        const idsToRemove = thermostatCategories
            .filter(cat => cat.id !== categoryToKeep.id)
            .map(cat => cat.id);

        if (idsToRemove.length === 0) {
            console.log('✅ No duplicates to remove.');
            process.exit(0);
        }

        console.log(`🗑️ Removing ${idsToRemove.length} duplicate(s):\n`);
        idsToRemove.forEach(id => {
            const cat = thermostatCategories.find(c => c.id === id);
            console.log(`  ❌ Removing: ${id} (Active: ${cat.isActive}, Scenarios: ${cat.scenarios?.length || 0})`);
        });

        // Confirm before deletion
        console.log('\n⚠️ ABOUT TO DELETE DUPLICATE CATEGORIES FROM DATABASE');
        console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');
        
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Remove duplicates
        hvacTemplate.categories = hvacTemplate.categories.filter(cat => 
            !idsToRemove.includes(cat.id)
        );

        await hvacTemplate.save();

        console.log('\n✅ SUCCESS! Duplicate categories removed.');
        console.log(`📁 Remaining categories: ${hvacTemplate.categories.length}`);
        console.log(`🌡️ Thermostats category ID: ${categoryToKeep.id}`);

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Run cleanup
cleanupDuplicateThermostats();

