#!/usr/bin/env node

/**
 * CRITICAL: Migrate Q&A from Legacy to V2 System
 * Move entries from 'qna' to 'companyqnas' and delete legacy collections
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CompanyKnowledgeQnA = require('../models/knowledge/CompanyQnA');

async function migrateToV2(companyId) {
    try {
        console.log('🚨 CRITICAL MIGRATION: Legacy Q&A to V2 System');
        console.log('🔍 Company ID:', companyId);
        
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
        console.log('✅ Connected to MongoDB');
        
        const db = mongoose.connection.db;
        
        // Step 1: Get legacy Q&A entries
        console.log('\n📚 STEP 1: Extracting legacy Q&A entries...');
        const legacyQnas = await db.collection('qna').find({ companyId }).toArray();
        console.log(`   Found ${legacyQnas.length} legacy entries to migrate`);
        
        let migrated = 0;
        let errors = 0;
        
        // Step 2: Migrate each entry to V2 system
        console.log('\n🔄 STEP 2: Migrating to V2 CompanyKnowledgeQnA...');
        for (const legacyQna of legacyQnas) {
            try {
                console.log(`   Migrating: "${legacyQna.question}"`);
                
                // Create V2 Q&A entry with enhanced structure
                const v2Qna = new CompanyKnowledgeQnA({
                    question: legacyQna.question,
                    answer: legacyQna.answer,
                    companyId: legacyQna.companyId,
                    category: legacyQna.category || 'general',
                    status: legacyQna.status || 'active',
                    confidence: legacyQna.confidence || 0.8,
                    usageCount: legacyQna.usageCount || 0,
                    lastUsed: legacyQna.lastUsed || null,
                    tradeCategories: legacyQna.tradeCategories || [],
                    createdAt: legacyQna.createdAt || new Date(),
                    updatedAt: new Date()
                });
                
                // Save with automatic keyword generation
                await v2Qna.save();
                console.log(`   ✅ Migrated with enhanced keywords`);
                migrated++;
                
            } catch (error) {
                console.error(`   ❌ Migration failed for "${legacyQna.question}":`, error.message);
                errors++;
            }
        }
        
        // Step 3: Delete legacy collections
        console.log('\n🗑️ STEP 3: Deleting legacy collections...');
        const legacyCollections = [
            'qna', 
            'knowledgeentries', 
            'suggestedknowledgeentries', 
            'approvedknowledges'
        ];
        
        for (const collectionName of legacyCollections) {
            try {
                const count = await db.collection(collectionName).countDocuments();
                if (count > 0) {
                    console.log(`   Deleting ${collectionName} (${count} documents)...`);
                    await db.collection(collectionName).drop();
                    console.log(`   ✅ Deleted ${collectionName}`);
                } else {
                    console.log(`   ⚪ ${collectionName} already empty`);
                }
            } catch (error) {
                if (error.message.includes('ns not found')) {
                    console.log(`   ⚪ ${collectionName} doesn't exist`);
                } else {
                    console.error(`   ❌ Failed to delete ${collectionName}:`, error.message);
                }
            }
        }
        
        // Step 4: Verify V2 system
        console.log('\n✅ STEP 4: Verifying V2 system...');
        const v2Count = await CompanyKnowledgeQnA.countDocuments({ companyId });
        console.log(`   V2 CompanyKnowledgeQnA entries: ${v2Count}`);
        
        // Show sample entry with keywords
        const sampleEntry = await CompanyKnowledgeQnA.findOne({ companyId });
        if (sampleEntry) {
            console.log(`   Sample entry: "${sampleEntry.question}"`);
            console.log(`   Enhanced keywords: [${sampleEntry.keywords.slice(0, 10).join(', ')}${sampleEntry.keywords.length > 10 ? '...' : ''}]`);
        }
        
        console.log('\n🎉 MIGRATION COMPLETE:');
        console.log(`   ✅ Migrated: ${migrated} entries`);
        console.log(`   ❌ Errors: ${errors} entries`);
        console.log(`   🗑️ Legacy collections: DELETED`);
        console.log(`   🚀 V2 system: ACTIVE`);
        
        console.log('\n🎯 NEXT STEPS:');
        console.log('   1. Test "hours open" query again');
        console.log('   2. Should now find your "What are your business hours?" entry');
        console.log('   3. AI agent will use enhanced keywords for better matching');
        
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
    console.error('❌ Usage: node scripts/migrate-to-v2-qna.js <companyId>');
    console.error('   Example: node scripts/migrate-to-v2-qna.js 68813026dd95f599c74e49c7');
    process.exit(1);
}

// Run the migration
migrateToV2(companyId);
