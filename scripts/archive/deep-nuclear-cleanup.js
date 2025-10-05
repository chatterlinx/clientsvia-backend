/**
 * 🚨 DEEP NUCLEAR CLEANUP SCRIPT
 * ==============================
 * 
 * MISSION: AGGRESSIVE elimination of ALL legacy contamination
 * TARGET: personalityResponses and ALL nested legacy fields
 * 
 * This script uses direct MongoDB operations to ensure complete elimination
 */

const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

async function connectToMongoDB() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✅ Connected to MongoDB (direct connection)');
    return client;
}

async function deepNuclearCleanup() {
    console.log('🚨 DEEP NUCLEAR CLEANUP - AGGRESSIVE MODE');
    console.log('=========================================\n');
    
    const client = await connectToMongoDB();
    const db = client.db();
    const companies = db.collection('companies');
    
    try {
        // Step 1: Find all contaminated companies
        console.log('🔍 Finding contaminated companies...');
        const contaminatedDocs = await companies.find({
            personalityResponses: { $exists: true }
        }).toArray();
        
        console.log(`🚨 Found ${contaminatedDocs.length} contaminated companies`);
        
        if (contaminatedDocs.length === 0) {
            console.log('✅ No contamination found!');
            return;
        }
        
        // Step 2: Show contamination details
        for (const doc of contaminatedDocs) {
            console.log(`\n🦠 ${doc.companyName} (${doc._id})`);
            if (doc.personalityResponses) {
                const responseTypes = Object.keys(doc.personalityResponses);
                console.log(`   📝 Contaminated fields: ${responseTypes.join(', ')}`);
            }
        }
        
        // Step 3: AGGRESSIVE CLEANUP - Remove entire personalityResponses field
        console.log('\n💥 EXECUTING DEEP NUCLEAR CLEANUP...');
        
        const result = await companies.updateMany(
            { personalityResponses: { $exists: true } },
            { 
                $unset: { 
                    personalityResponses: "" 
                }
            }
        );
        
        console.log(`✅ DEEP CLEANUP COMPLETE!`);
        console.log(`📊 Documents matched: ${result.matchedCount}`);
        console.log(`🧹 Documents modified: ${result.modifiedCount}`);
        
        // Step 4: Verify complete elimination
        console.log('\n🔍 VERIFYING COMPLETE ELIMINATION...');
        
        const remainingContamination = await companies.find({
            personalityResponses: { $exists: true }
        }).toArray();
        
        if (remainingContamination.length === 0) {
            console.log('✅ COMPLETE SUCCESS: All personalityResponses eliminated!');
            console.log('🎉 Database is now 100% clean of legacy contamination');
        } else {
            console.log(`❌ STILL CONTAMINATED: ${remainingContamination.length} documents`);
            
            // Show what's still there
            for (const doc of remainingContamination) {
                console.log(`   🦠 ${doc.companyName}: ${JSON.stringify(doc.personalityResponses, null, 2)}`);
            }
        }
        
        // Step 5: Verify V2 systems are intact
        const v2Count = await companies.countDocuments({
            'aiAgentLogic.responseCategories': { $exists: true }
        });
        
        console.log(`✅ V2 SYSTEMS PRESERVED: ${v2Count} companies have clean V2 responseCategories`);
        
    } catch (error) {
        console.error('💥 DEEP CLEANUP FAILED:', error);
        throw error;
    } finally {
        await client.close();
        console.log('📡 Disconnected from MongoDB');
    }
}

// Execute
deepNuclearCleanup().catch(error => {
    console.error('💥 SCRIPT FAILED:', error);
    process.exit(1);
});
