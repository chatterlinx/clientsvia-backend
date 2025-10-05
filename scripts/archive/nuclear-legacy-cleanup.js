/**
 * 🚨 NUCLEAR LEGACY CLEANUP SCRIPT
 * ================================
 * 
 * MISSION: Eliminate ALL legacy spaghetti contamination from the database
 * TARGET: personalityResponses and other legacy enterprise fields
 * 
 * ⚠️  DANGER: This script will PERMANENTLY DELETE legacy data
 * ✅ SAFE: Only removes deprecated fields, preserves V2 clean data
 * 
 * CONTAMINATION DETECTED:
 * - personalityResponses (cantUnderstand, speakClearly, outOfCategory, etc.)
 * - Legacy enterprise spaghetti fields
 * - Old hardcoded response arrays
 * 
 * V2 CLEAN SYSTEM PRESERVED:
 * - aiAgentLogic.responseCategories (V2 system)
 * - aiAgentLogic.personalitySystem (V2 system)
 * - All other V2 clean fields
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');

// 🎯 LEGACY CONTAMINATION FIELDS TO ELIMINATE
const LEGACY_SPAGHETTI_FIELDS = [
    'personalityResponses',
    'personalityResponses.cantUnderstand',
    'personalityResponses.speakClearly', 
    'personalityResponses.outOfCategory',
    'personalityResponses.transferToRep',
    'personalityResponses.calendarHesitation',
    'personalityResponses.businessClosed',
    'personalityResponses.frustratedCaller',
    'personalityResponses.businessHours',
    'personalityResponses.connectionTrouble',
    'personalityResponses.agentNotUnderstood',
    'personalityResponses.lightHumor',
    'personalityResponses.customerJoke',
    'personalityResponses.weatherSmallTalk',
    'personalityResponses.complimentResponse',
    'personalityResponses.casualGreeting',
    'personalityResponses.empathyResponse',
    
    // Other legacy enterprise contamination
    'legacyPersonalitySettings',
    'hardcodedResponses',
    'enterprisePersonalityResponses',
    'oldAgentResponses',
    'deprecatedPersonality'
];

async function connectToDatabase() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error);
        process.exit(1);
    }
}

async function scanForContamination() {
    console.log('\n🔍 SCANNING FOR LEGACY CONTAMINATION...\n');
    
    try {
        // Find companies with personalityResponses contamination
        const contaminatedCompanies = await Company.find({
            personalityResponses: { $exists: true }
        }).select('_id companyName personalityResponses');
        
        console.log(`🚨 CONTAMINATION DETECTED: ${contaminatedCompanies.length} companies infected with legacy spaghetti`);
        
        if (contaminatedCompanies.length > 0) {
            console.log('\n📋 INFECTED COMPANIES:');
            contaminatedCompanies.forEach((company, index) => {
                console.log(`${index + 1}. ${company.companyName} (${company._id})`);
                
                if (company.personalityResponses) {
                    const responseTypes = Object.keys(company.personalityResponses);
                    console.log(`   🦠 Legacy response types: ${responseTypes.join(', ')}`);
                    
                    // Show sample contamination
                    if (company.personalityResponses.cantUnderstand) {
                        console.log(`   📝 Sample contamination: ${company.personalityResponses.cantUnderstand.length} cantUnderstand responses`);
                    }
                }
            });
        }
        
        return contaminatedCompanies;
        
    } catch (error) {
        console.error('❌ Contamination scan failed:', error);
        throw error;
    }
}

async function nukeContamination(dryRun = true) {
    console.log(`\n${dryRun ? '🧪 DRY RUN' : '💥 NUCLEAR CLEANUP'}: Eliminating legacy contamination...\n`);
    
    try {
        // Build unset operation to remove all legacy fields
        const unsetOperation = {};
        LEGACY_SPAGHETTI_FIELDS.forEach(field => {
            unsetOperation[field] = "";
        });
        
        if (dryRun) {
            console.log('🧪 DRY RUN: Would execute the following cleanup:');
            console.log('📋 Fields to eliminate:', LEGACY_SPAGHETTI_FIELDS);
            console.log('⚡ MongoDB operation: { $unset: { ... } }');
            
            // Count affected documents
            const affectedCount = await Company.countDocuments({
                $or: LEGACY_SPAGHETTI_FIELDS.map(field => ({ [field]: { $exists: true } }))
            });
            
            console.log(`📊 Companies that would be cleaned: ${affectedCount}`);
            
        } else {
            console.log('💥 EXECUTING NUCLEAR CLEANUP...');
            
            const result = await Company.updateMany(
                {}, // Update all companies
                { $unset: unsetOperation }
            );
            
            console.log(`✅ CLEANUP COMPLETE!`);
            console.log(`📊 Companies processed: ${result.matchedCount}`);
            console.log(`🧹 Companies cleaned: ${result.modifiedCount}`);
            console.log(`💀 Legacy fields eliminated: ${LEGACY_SPAGHETTI_FIELDS.length}`);
        }
        
    } catch (error) {
        console.error('❌ Nuclear cleanup failed:', error);
        throw error;
    }
}

async function verifyCleanup() {
    console.log('\n🔍 VERIFYING CLEANUP SUCCESS...\n');
    
    try {
        // Check for any remaining contamination
        const remainingContamination = await Company.find({
            personalityResponses: { $exists: true }
        }).select('_id companyName');
        
        if (remainingContamination.length === 0) {
            console.log('✅ CLEANUP VERIFIED: No legacy contamination detected');
            console.log('🎉 V2 CLEAN SYSTEM: Database is now pure!');
        } else {
            console.log(`❌ CLEANUP FAILED: ${remainingContamination.length} companies still contaminated`);
            remainingContamination.forEach(company => {
                console.log(`   🦠 ${company.companyName} (${company._id})`);
            });
        }
        
        // Verify V2 systems are intact
        const v2Companies = await Company.find({
            'aiAgentLogic.responseCategories': { $exists: true }
        }).select('_id companyName');
        
        console.log(`✅ V2 SYSTEMS PRESERVED: ${v2Companies.length} companies have clean V2 responseCategories`);
        
    } catch (error) {
        console.error('❌ Verification failed:', error);
        throw error;
    }
}

async function main() {
    console.log('🚨 NUCLEAR LEGACY CLEANUP SCRIPT');
    console.log('================================');
    console.log('Mission: Eliminate personalityResponses contamination');
    console.log('Target: Legacy enterprise spaghetti fields');
    console.log('Preserve: V2 clean aiAgentLogic system\n');
    
    await connectToDatabase();
    
    try {
        // Step 1: Scan for contamination
        const contaminatedCompanies = await scanForContamination();
        
        if (contaminatedCompanies.length === 0) {
            console.log('✅ NO CONTAMINATION DETECTED: Database is already clean!');
            return;
        }
        
        // Step 2: Dry run first
        await nukeContamination(true);
        
        // Step 3: Ask for confirmation
        console.log('\n⚠️  READY TO EXECUTE NUCLEAR CLEANUP');
        console.log('This will PERMANENTLY DELETE legacy contamination');
        console.log('V2 clean systems will be preserved');
        
        const args = process.argv.slice(2);
        if (args.includes('--execute')) {
            // Step 4: Execute cleanup
            await nukeContamination(false);
            
            // Step 5: Verify success
            await verifyCleanup();
            
            console.log('\n🎉 MISSION ACCOMPLISHED!');
            console.log('💀 Legacy spaghetti eliminated');
            console.log('✅ V2 clean system preserved');
            console.log('🚀 Database is now enterprise-grade clean');
            
        } else {
            console.log('\n🧪 DRY RUN COMPLETE');
            console.log('To execute cleanup, run: node scripts/nuclear-legacy-cleanup.js --execute');
        }
        
    } catch (error) {
        console.error('💥 NUCLEAR CLEANUP FAILED:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('📡 Disconnected from MongoDB');
    }
}

// Execute if run directly
if (require.main === module) {
    main().catch(error => {
        console.error('💥 SCRIPT FAILED:', error);
        process.exit(1);
    });
}

module.exports = { main, scanForContamination, nukeContamination, verifyCleanup };
