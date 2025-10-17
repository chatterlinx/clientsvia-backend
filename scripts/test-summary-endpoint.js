#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

async function testSummary() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = new Set(collections.map(c => c.name));
        
        // Same logic as Data Center
        const buildCollectionsMap = (names) => ({
            companies: names.has('companiesCollection') ? 'companiesCollection' : 'companies',
        });
        
        const collectionsMap = buildCollectionsMap(names);
        const primary = db.collection(collectionsMap.companies);
        const legacy = collectionsMap.companies === 'companiesCollection' && names.has('companies') ? db.collection('companies') : null;
        
        console.log('🔧 Collections Map:', collectionsMap);
        console.log('🔧 Primary:', collectionsMap.companies);
        console.log('🔧 Legacy:', legacy ? 'companies' : 'none');
        console.log('');
        
        // Filters
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
        
        // Count from primary
        const [totalP, delP, liveP] = await Promise.all([
            primary.countDocuments({}),
            primary.countDocuments(deletedMatch),
            primary.countDocuments(liveMatch)
        ]);
        
        console.log('📊 Primary Collection Counts:');
        console.log('   Total:', totalP);
        console.log('   Deleted:', delP);
        console.log('   Live:', liveP);
        console.log('');
        
        // Count from legacy
        let totalL = 0, delL = 0, liveL = 0;
        if (legacy) {
            [totalL, delL, liveL] = await Promise.all([
                legacy.countDocuments({}),
                legacy.countDocuments(deletedMatch),
                legacy.countDocuments(liveMatch)
            ]);
            console.log('📊 Legacy Collection Counts:');
            console.log('   Total:', totalL);
            console.log('   Deleted:', delL);
            console.log('   Live:', liveL);
            console.log('');
        }
        
        // Merge
        const summary = {
            total: (totalP || 0) + (totalL || 0),
            live: (liveP || 0) + (liveL || 0),
            deleted: (delP || 0) + (delL || 0)
        };
        
        console.log('📊 MERGED Summary (what /summary endpoint should return):');
        console.log(JSON.stringify(summary, null, 2));
        console.log('');
        
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

testSummary();

