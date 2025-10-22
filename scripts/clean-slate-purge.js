#!/usr/bin/env node
/**
 * Clean Slate - Purge Old Test Companies
 * 
 * Removes all test companies from LOCAL database to start fresh.
 * This is SAFE to run - it only affects your local development database.
 * 
 * IMPORTANT: Only run this on LOCAL, never on production!
 */
require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function cleanSlate() {
    try {
        console.log(`\n${  '='.repeat(80)}`);
        console.log('🧹 CLEAN SLATE - PURGE OLD TEST COMPANIES');
        console.log(`${'='.repeat(80)  }\n`);

        await mongoose.connect(process.env.MONGODB_URI);
        const dbName = mongoose.connection.db.databaseName;
        console.log('✅ Connected to MongoDB:', dbName);
        console.log('');

        // Safety check - confirm this is NOT production
        if (dbName.toLowerCase().includes('prod') || dbName.toLowerCase().includes('clientsvia')) {
            console.log('🚨 SAFETY CHECK FAILED!');
            console.log('❌ This appears to be a PRODUCTION database.');
            console.log('❌ This script should ONLY be run on LOCAL test databases.');
            console.log('');
            await mongoose.disconnect();
            process.exit(1);
        }

        console.log('✅ Safety check passed - this is a local/test database\n');

        const db = mongoose.connection.db;
        
        // Get all collections
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        
        console.log('📊 Found collections:');
        const companyCollections = [];
        if (names.has('companiesCollection')) {
            companyCollections.push('companiesCollection');
            console.log('   ✓ companiesCollection');
        }
        if (names.has('companies')) {
            companyCollections.push('companies');
            console.log('   ✓ companies');
        }
        console.log('');

        // Count companies
        let totalCompanies = 0;
        const companyIds = [];
        
        for (const collName of companyCollections) {
            const coll = db.collection(collName);
            const count = await coll.countDocuments({});
            totalCompanies += count;
            
            const docs = await coll.find({}).toArray();
            docs.forEach(doc => {
                companyIds.push(doc._id);
                console.log(`   📋 ${doc.companyName || doc.businessName || 'Unnamed'} (${doc._id})`);
            });
        }

        console.log('');
        console.log(`📊 Total companies to purge: ${totalCompanies}`);
        console.log('');

        // Confirm deletion
        const confirm = await question(`⚠️  Are you sure you want to PERMANENTLY DELETE all ${totalCompanies} companies? (yes/no): `);
        
        if (confirm.toLowerCase() !== 'yes') {
            console.log('❌ Cancelled by user');
            await mongoose.disconnect();
            rl.close();
            process.exit(0);
        }

        console.log('');
        console.log('🗑️  Starting purge...\n');

        let deletedCount = 0;

        // Delete companies
        for (const collName of companyCollections) {
            const coll = db.collection(collName);
            const result = await coll.deleteMany({});
            deletedCount += result.deletedCount;
            console.log(`   ✓ Deleted ${result.deletedCount} companies from ${collName}`);
        }

        // Delete related data for each companyId
        console.log('');
        console.log('🗑️  Cleaning up related data...\n');

        const relatedCollections = [
            { name: 'v2aiagentcalllogs', field: 'companyId' },
            { name: 'v2contacts', field: 'companyId' },
            { name: 'v2notificationlogs', field: 'companyId' },
            { name: 'conversationlogs', field: 'companyId' },
            { name: 'companyqnas', field: 'companyId' },
            { name: 'bookings', field: 'companyId' }
        ];

        for (const rel of relatedCollections) {
            if (names.has(rel.name)) {
                const coll = db.collection(rel.name);
                const result = await coll.deleteMany({
                    [rel.field]: { $in: companyIds }
                });
                if (result.deletedCount > 0) {
                    console.log(`   ✓ Deleted ${result.deletedCount} documents from ${rel.name}`);
                }
            }
        }

        console.log('');
        console.log('='.repeat(80));
        console.log('✅ CLEAN SLATE COMPLETE!');
        console.log('='.repeat(80));
        console.log(`   Deleted ${deletedCount} companies`);
        console.log('   Deleted all related data (calls, contacts, logs, etc.)');
        console.log('   Database is now clean and ready for fresh testing');
        console.log('');

        await mongoose.disconnect();
        rl.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        rl.close();
        process.exit(1);
    }
}

cleanSlate();

