#!/usr/bin/env node
/**
 * Production Data Center Diagnostic Script
 * Runs the EXACT same logic as the Data Center summary endpoint
 * to identify why UI shows 2 companies instead of 21
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function diagnose() {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🔍 DATA CENTER PRODUCTION DIAGNOSTIC');
        console.log('='.repeat(80) + '\n');

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB:', mongoose.connection.db.databaseName);
        console.log('');

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));

        // EXACT SAME LOGIC AS DATA CENTER
        const buildCollectionsMap = (names) => ({
            companies: names.has('companiesCollection') ? 'companiesCollection' : 'companies',
        });

        const collectionsMap = buildCollectionsMap(names);
        console.log('📊 STEP 1: Collection Detection');
        console.log('   Available collections:', collections.length);
        console.log('   Has "companiesCollection"?', names.has('companiesCollection'));
        console.log('   Has "companies"?', names.has('companies'));
        console.log('   Primary collection selected:', collectionsMap.companies);
        console.log('');

        const primary = db.collection(collectionsMap.companies);
        const legacy = collectionsMap.companies === 'companiesCollection' && names.has('companies') 
            ? db.collection('companies') 
            : null;

        console.log('📊 STEP 2: Collection Mapping');
        console.log('   Primary:', collectionsMap.companies);
        console.log('   Legacy:', legacy ? 'companies' : 'NONE');
        console.log('');

        // EXACT SAME FILTERS AS DATA CENTER
        const deletedMatch = {
            $or: [
                { isDeleted: true },
                { isDeleted: 'true' },
                { deleted: true },
                { deleted: 'true' },
                { deletedAt: { $type: 'date' } },
                { 'accountStatus.status': 'deleted' }
            ]
        };
        
        const liveMatch = {
            $and: [
                { $or: [ { isDeleted: { $exists: false } }, { isDeleted: false }, { isDeleted: 'false' } ] },
                { $or: [ { deleted: { $exists: false } }, { deleted: false }, { deleted: 'false' } ] },
                { $or: [ { deletedAt: { $exists: false } }, { deletedAt: null } ] },
                { $or: [ { 'accountStatus.status': { $exists: false } }, { 'accountStatus.status': { $ne: 'deleted' } } ] }
            ]
        };

        console.log('📊 STEP 3: Counting Primary Collection');
        const [totalP, delP, liveP] = await Promise.all([
            primary.countDocuments({}),
            primary.countDocuments(deletedMatch),
            primary.countDocuments(liveMatch)
        ]);
        console.log(`   Total: ${totalP}`);
        console.log(`   Deleted: ${delP}`);
        console.log(`   Live: ${liveP}`);
        console.log('');

        // Sample some companies
        const samplePrimary = await primary.find({}).limit(5).toArray();
        console.log('   Sample companies in primary:');
        samplePrimary.forEach((c, i) => {
            console.log(`     ${i+1}. ${c.companyName || c.businessName || 'Unnamed'} (${c._id})`);
        });
        console.log('');

        let totalL = 0, delL = 0, liveL = 0;
        if (legacy) {
            console.log('📊 STEP 4: Counting Legacy Collection');
            [totalL, delL, liveL] = await Promise.all([
                legacy.countDocuments({}),
                legacy.countDocuments(deletedMatch),
                legacy.countDocuments(liveMatch)
            ]);
            console.log(`   Total: ${totalL}`);
            console.log(`   Deleted: ${delL}`);
            console.log(`   Live: ${liveL}`);
            console.log('');

            if (totalL > 0) {
                const sampleLegacy = await legacy.find({}).limit(5).toArray();
                console.log('   Sample companies in legacy:');
                sampleLegacy.forEach((c, i) => {
                    console.log(`     ${i+1}. ${c.companyName || c.businessName || 'Unnamed'} (${c._id})`);
                });
                console.log('');
            }
        } else {
            console.log('📊 STEP 4: No Legacy Collection Found');
            console.log('');
        }

        const summary = {
            total: (totalP || 0) + (totalL || 0),
            live: (liveP || 0) + (liveL || 0),
            deleted: (delP || 0) + (delL || 0)
        };

        console.log('='.repeat(80));
        console.log('🎯 FINAL SUMMARY (What /summary endpoint should return):');
        console.log('='.repeat(80));
        console.log(`   Total Companies: ${summary.total}`);
        console.log(`   Live: ${summary.live}`);
        console.log(`   Deleted: ${summary.deleted}`);
        console.log('');

        if (summary.total === 2) {
            console.log('⚠️  WARNING: Only 2 companies found!');
            console.log('   This matches the UI bug. Investigating further...\n');

            // Deep dive into what's different
            console.log('🔍 DEEP DIVE: Checking for issues...\n');
            
            // Check if there are companies with weird states
            const allDocs = await primary.find({}).toArray();
            console.log(`   Found ${allDocs.length} total documents in primary collection`);
            
            if (allDocs.length > 2) {
                console.log(`   ⚠️  FOUND THE BUG: Primary collection has ${allDocs.length} docs but counts show ${totalP}`);
                console.log('   This suggests the countDocuments query is not matching what find() returns');
                console.log('   Checking document states...\n');
                
                allDocs.forEach((doc, i) => {
                    console.log(`   ${i+1}. ${doc.companyName || doc.businessName || 'Unnamed'}`);
                    console.log(`      isDeleted: ${doc.isDeleted}`);
                    console.log(`      deleted: ${doc.deleted}`);
                    console.log(`      deletedAt: ${doc.deletedAt}`);
                    console.log(`      accountStatus.status: ${doc.accountStatus?.status}`);
                    console.log('');
                });
            }
        } else {
            console.log('✅ Counts look correct! Issue might be in frontend or API response.');
        }

        console.log('='.repeat(80));
        console.log('');

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

diagnose();

