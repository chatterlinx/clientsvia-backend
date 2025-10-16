#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

async function checkDatabase() {
    try {
        console.log('\n🔍 DATABASE CONNECTION DIAGNOSTIC');
        console.log('═'.repeat(80));
        
        console.log('\n📡 MongoDB URI:', process.env.MONGODB_URI?.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@'));
        
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const db = mongoose.connection.db;
        console.log('📊 Database Name:', db.databaseName);
        
        // List all collections
        const collections = await db.listCollections().toArray();
        console.log(`\n📂 Collections (${collections.length} total):`);
        
        for (const coll of collections) {
            const count = await db.collection(coll.name).countDocuments();
            console.log(`   - ${coll.name}: ${count} documents`);
        }
        
        // Try to find the companies collection
        console.log('\n🔍 Looking for companies...');
        const possibleNames = ['companies', 'v2companies', 'v2Companies', 'Companies'];
        
        for (const name of possibleNames) {
            try {
                const count = await db.collection(name).countDocuments();
                if (count > 0) {
                    console.log(`✅ Found ${count} documents in collection: ${name}`);
                    
                    // Show first company
                    const firstCompany = await db.collection(name).findOne({});
                    console.log(`\n📄 Sample company from "${name}":`);
                    console.log(`   _id: ${firstCompany._id}`);
                    console.log(`   companyName: ${firstCompany.companyName}`);
                    console.log(`   Has aiAgentLogic: ${!!firstCompany.aiAgentLogic}`);
                    if (firstCompany.aiAgentLogic) {
                        console.log(`   voiceSettings type: ${typeof firstCompany.aiAgentLogic.voiceSettings}`);
                        console.log(`   voiceSettings value:`, firstCompany.aiAgentLogic.voiceSettings);
                    }
                }
            } catch (e) {
                // Collection doesn't exist
            }
        }
        
        await mongoose.disconnect();
        console.log('\n✅ Done');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ ERROR:', error);
        process.exit(1);
    }
}

checkDatabase();

