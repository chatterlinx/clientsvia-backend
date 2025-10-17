#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

async function diagnose() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        
        console.log('📋 Available Collections:');
        collections.forEach(c => console.log(`   - ${c.name}`));
        console.log('');
        
        // Check each possible company collection
        const possibleCollections = ['companiesCollection', 'companies', 'v2Companies'];
        
        for (const collName of possibleCollections) {
            try {
                const coll = db.collection(collName);
                const total = await coll.countDocuments({});
                
                const deleted = await coll.countDocuments({
                    $or: [
                        { isDeleted: true },
                        { deleted: true },
                        { deletedAt: { $type: 'date' } },
                        { 'accountStatus.status': 'deleted' }
                    ]
                });
                
                const live = await coll.countDocuments({
                    $and: [
                        { $or: [ { isDeleted: { $exists: false } }, { isDeleted: false } ] },
                        { $or: [ { deleted: { $exists: false } }, { deleted: false } ] },
                        { $or: [ { deletedAt: { $exists: false } }, { deletedAt: null } ] },
                        { $or: [ { 'accountStatus.status': { $exists: false } }, { 'accountStatus.status': { $ne: 'deleted' } } ] }
                    ]
                });
                
                console.log(`📊 Collection: ${collName}`);
                console.log(`   Total: ${total}`);
                console.log(`   Live: ${live}`);
                console.log(`   Deleted: ${deleted}`);
                console.log('');
            } catch (err) {
                console.log(`⚠️  Collection "${collName}" not found or error: ${err.message}\n`);
            }
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

diagnose();

