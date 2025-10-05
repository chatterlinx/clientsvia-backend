#!/usr/bin/env node

/**
 * CRITICAL: Investigate Multiple Q&A Collections
 * Find and eliminate legacy duplicates
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function investigateCollections(companyId) {
    try {
        console.log('🚨 CRITICAL INVESTIGATION: Multiple Q&A collections detected');
        console.log('🔍 Company ID:', companyId);
        
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
        console.log('✅ Connected to MongoDB');
        
        const db = mongoose.connection.db;
        
        // Check companyqnas collection
        console.log('\n📚 COLLECTION: companyqnas');
        try {
            const companyqnas = await db.collection('companyqnas').find({ companyId }).toArray();
            console.log(`   Found ${companyqnas.length} entries`);
            
            companyqnas.forEach((qna, index) => {
                console.log(`   ${index + 1}. "${qna.question}" (status: ${qna.status})`);
                console.log(`      Keywords: [${qna.keywords?.slice(0, 5).join(', ')}${qna.keywords?.length > 5 ? '...' : ''}]`);
                console.log(`      Collection: companyqnas`);
            });
        } catch (error) {
            console.log('   ❌ Error accessing companyqnas:', error.message);
        }
        
        // Check qna collection  
        console.log('\n📚 COLLECTION: qna');
        try {
            const qnas = await db.collection('qna').find({ companyId }).toArray();
            console.log(`   Found ${qnas.length} entries`);
            
            qnas.forEach((qna, index) => {
                console.log(`   ${index + 1}. "${qna.question}" (status: ${qna.status})`);
                console.log(`      Keywords: [${qna.keywords?.slice(0, 5).join(', ')}${qna.keywords?.length > 5 ? '...' : ''}]`);
                console.log(`      Collection: qna`);
            });
        } catch (error) {
            console.log('   ❌ Error accessing qna:', error.message);
        }
        
        // Check for other Q&A related collections
        console.log('\n🔍 ALL Q&A RELATED COLLECTIONS:');
        const collections = await db.listCollections().toArray();
        const qnaCollections = collections.filter(col => 
            col.name.toLowerCase().includes('qna') || 
            col.name.toLowerCase().includes('q&a') ||
            col.name.toLowerCase().includes('knowledge')
        );
        
        for (const col of qnaCollections) {
            console.log(`   - ${col.name}`);
            try {
                const count = await db.collection(col.name).countDocuments({ companyId });
                console.log(`     Entries for company: ${count}`);
            } catch (error) {
                console.log(`     Error counting: ${error.message}`);
            }
        }
        
        console.log('\n🚨 LEGACY DETECTION COMPLETE');
        console.log('🎯 RECOMMENDATION: Use only ONE collection for V2 system');
        
    } catch (error) {
        console.error('❌ CRITICAL ERROR:', error);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Disconnected from MongoDB');
    }
}

// Get company ID from command line argument
const companyId = process.argv[2];

if (!companyId) {
    console.error('❌ Usage: node scripts/investigate-collections.js <companyId>');
    console.error('   Example: node scripts/investigate-collections.js 68813026dd95f599c74e49c7');
    process.exit(1);
}

// Run the investigation
investigateCollections(companyId);
