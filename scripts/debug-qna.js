#!/usr/bin/env node

/**
 * Debug Q&A Entries - Find all Q&A entries for a company
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function debugQnA(companyId) {
    try {
        console.log('🔍 Debugging Q&A entries for company:', companyId);
        
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
        console.log('✅ Connected to MongoDB');
        
        // Check both possible Q&A models
        console.log('\n📚 Checking CompanyKnowledgeQnA model...');
        try {
            const CompanyKnowledgeQnA = require('../models/knowledge/CompanyQnA');
            const knowledgeQnas = await CompanyKnowledgeQnA.find({ companyId });
            console.log(`   Found ${knowledgeQnas.length} entries in CompanyKnowledgeQnA`);
            
            knowledgeQnas.forEach((qna, index) => {
                console.log(`   ${index + 1}. "${qna.question}" (status: ${qna.status})`);
                console.log(`      Keywords: [${qna.keywords?.slice(0, 5).join(', ')}${qna.keywords?.length > 5 ? '...' : ''}]`);
            });
        } catch (error) {
            console.log('   ❌ CompanyKnowledgeQnA model error:', error.message);
        }
        
        console.log('\n📚 Checking legacy CompanyQnA model...');
        try {
            const CompanyQnA = require('../models/CompanyQnA');
            const legacyQnas = await CompanyQnA.find({ companyId });
            console.log(`   Found ${legacyQnas.length} entries in legacy CompanyQnA`);
            
            legacyQnas.forEach((qna, index) => {
                console.log(`   ${index + 1}. "${qna.question}" (status: ${qna.status})`);
                console.log(`      Keywords: [${qna.keywords?.slice(0, 5).join(', ')}${qna.keywords?.length > 5 ? '...' : ''}]`);
            });
        } catch (error) {
            console.log('   ❌ Legacy CompanyQnA model error:', error.message);
        }
        
        console.log('\n🔍 Checking all collections in database...');
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log('   Available collections:');
        collections.forEach(col => {
            if (col.name.toLowerCase().includes('qna') || col.name.toLowerCase().includes('company')) {
                console.log(`   - ${col.name}`);
            }
        });
        
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
    console.error('❌ Usage: node scripts/debug-qna.js <companyId>');
    console.error('   Example: node scripts/debug-qna.js 68813026dd95f599c74e49c7');
    process.exit(1);
}

// Run the debug
debugQnA(companyId);
