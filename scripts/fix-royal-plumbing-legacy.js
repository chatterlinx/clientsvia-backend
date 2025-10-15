#!/usr/bin/env node
/**
 * ============================================================================
 * FIX ROYAL PLUMBING LEGACY DATA
 * ============================================================================
 * Direct MongoDB update to remove ALL legacy fields
 * ============================================================================
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function fixRoyalPlumbing() {
    try {
        console.log('🔥 FIXING ROYAL PLUMBING LEGACY DATA\n');

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const companyId = '68eeaf924e989145e9d46c12';
        const db = mongoose.connection.db;
        const collection = db.collection('companiesCollection');

        console.log('🔍 Current state:');
        const before = await collection.findOne({ _id: new mongoose.Types.ObjectId(companyId) });
        console.log('  connectionMessages exists?', !!before.connectionMessages);
        console.log('  connectionMessages.voice.fallback:', before.connectionMessages?.voice?.fallback);

        console.log('\n🔥 NUKING legacy connectionMessages...');
        
        // NUKE the entire connectionMessages field
        await collection.updateOne(
            { _id: new mongoose.Types.ObjectId(companyId) },
            { 
                $unset: { 
                    connectionMessages: "",
                    'aiAgentLogic.connectionMessages': ""
                }
            }
        );

        console.log('✅ Legacy data removed');

        console.log('\n📊 After removal:');
        const after = await collection.findOne({ _id: new mongoose.Types.ObjectId(companyId) });
        console.log('  connectionMessages exists?', !!after.connectionMessages);
        console.log('  aiAgentLogic.connectionMessages exists?', !!after.aiAgentLogic?.connectionMessages);

        console.log('\n✅ Royal Plumbing is now CLEAN!');
        console.log('Next step: The API will auto-initialize with proper schema on next load');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

fixRoyalPlumbing();

