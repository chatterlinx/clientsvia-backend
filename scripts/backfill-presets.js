#!/usr/bin/env node
/**
 * Phase 6: Preset Backfill Script
 * Apply HVAC Starter preset defaults to existing companies to prevent config validation issues
 * 
 * Usage:
 *   node scripts/backfill-presets.js --dry    # Review changes without applying
 *   node scripts/backfill-presets.js          # Apply changes
 */

const mongoose = require('mongoose');
const Company = require('../models/Company');
const { applyPresetToCompanyDoc, validatePreset } = require('../services/presets');
const { PRESETS_V1, PRESET_DEFAULT } = require('../config/flags');

async function backfillPresets() {
    const isDryRun = process.argv.includes('--dry');
    const forceApply = process.argv.includes('--force');
    
    console.log('🚀 Starting preset backfill process...');
    console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'APPLY CHANGES'}`);
    console.log(`Presets enabled: ${PRESETS_V1}`);
    console.log(`Default preset: ${PRESET_DEFAULT}`);
    
    if (!PRESETS_V1) {
        console.log('⚠️ Presets feature is disabled. Enable with PRESETS_V1=on');
        process.exit(0);
    }
    
    try {
        // Connect to MongoDB
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI environment variable is required');
        }
        
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        // Validate default preset
        const validation = validatePreset(PRESET_DEFAULT);
        if (!validation.valid) {
            throw new Error(`Invalid default preset: ${validation.error}`);
        }
        
        // Find all companies
        const companies = await Company.find({});
        console.log(`📊 Found ${companies.length} companies to process`);
        
        let processedCount = 0;
        let changedCount = 0;
        let errorCount = 0;
        
        for (const company of companies) {
            try {
                processedCount++;
                
                // Skip if preset was already applied and not forcing
                if (company.appliedPreset && !forceApply) {
                    console.log(`⏭️  [${processedCount}/${companies.length}] Company ${company._id} (${company.companyName}) - preset already applied: ${company.appliedPreset.id}`);
                    continue;
                }
                
                // Capture current state for comparison
                const beforeState = {
                    hasInstructions: !!company.agentInstructions,
                    hasCompanyInfo: !!company.companyInfo && Object.keys(company.companyInfo).length > 0,
                    hasFallbackSettings: !!company.fallbackSettings && Object.keys(company.fallbackSettings).length > 0,
                    hasTtsSettings: !!company.ttsSettings && Object.keys(company.ttsSettings).length > 0,
                    appliedPreset: company.appliedPreset
                };
                
                // Apply preset configuration
                const updatedDoc = applyPresetToCompanyDoc(company.toObject(), PRESET_DEFAULT);
                
                // Check if anything actually changed
                const afterState = {
                    hasInstructions: !!updatedDoc.agentInstructions,
                    hasCompanyInfo: !!updatedDoc.companyInfo && Object.keys(updatedDoc.companyInfo).length > 0,
                    hasFallbackSettings: !!updatedDoc.fallbackSettings && Object.keys(updatedDoc.fallbackSettings).length > 0,
                    hasTtsSettings: !!updatedDoc.ttsSettings && Object.keys(updatedDoc.ttsSettings).length > 0,
                    appliedPreset: updatedDoc.appliedPreset
                };
                
                const hasChanges = JSON.stringify(beforeState) !== JSON.stringify(afterState);
                
                if (hasChanges) {
                    changedCount++;
                    
                    console.log(`🔄 [${processedCount}/${companies.length}] Company ${company._id} (${company.companyName}) - applying preset defaults`);
                    console.log(`   Before: Instructions:${beforeState.hasInstructions} CompanyInfo:${beforeState.hasCompanyInfo} Fallback:${beforeState.hasFallbackSettings} TTS:${beforeState.hasTtsSettings}`);
                    console.log(`   After:  Instructions:${afterState.hasInstructions} CompanyInfo:${afterState.hasCompanyInfo} Fallback:${afterState.hasFallbackSettings} TTS:${afterState.hasTtsSettings}`);
                    
                    if (!isDryRun) {
                        // Apply changes to the database
                        await Company.findByIdAndUpdate(
                            company._id,
                            { $set: updatedDoc },
                            { new: true, runValidators: true }
                        );
                        console.log(`   ✅ Applied to database`);
                    } else {
                        console.log(`   📝 Would apply to database (dry run)`);
                    }
                } else {
                    console.log(`⏭️  [${processedCount}/${companies.length}] Company ${company._id} (${company.companyName}) - no changes needed`);
                }
                
            } catch (error) {
                errorCount++;
                console.error(`❌ [${processedCount}/${companies.length}] Error processing company ${company._id}:`, error.message);
            }
        }
        
        console.log('\n📊 Backfill Summary:');
        console.log(`   Total companies: ${companies.length}`);
        console.log(`   Processed: ${processedCount}`);
        console.log(`   Changed: ${changedCount}`);
        console.log(`   Errors: ${errorCount}`);
        console.log(`   Mode: ${isDryRun ? 'DRY RUN' : 'APPLIED'}`);
        
        if (isDryRun && changedCount > 0) {
            console.log('\n🔄 To apply these changes, run:');
            console.log('   node scripts/backfill-presets.js');
        }
        
    } catch (error) {
        console.error('❌ Backfill failed:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('✅ Database connection closed');
    }
}

// Run the backfill
if (require.main === module) {
    backfillPresets()
        .then(() => {
            console.log('✅ Backfill completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Backfill failed:', error);
            process.exit(1);
        });
}

module.exports = { backfillPresets };
