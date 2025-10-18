#!/usr/bin/env node

/**
 * Regenerate Keywords for Existing Q&A Entries
 * This script updates existing Q&A entries with enhanced keywords
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CompanyKnowledgeQnA = require('../models/knowledge/CompanyQnA');

async function regenerateKeywords(companyId) {
    try {
        console.log('🚀 Starting keyword regeneration for company:', companyId);
        
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
        console.log('✅ Connected to MongoDB');
        
        // Find all active Q&A entries for the company
        const qnas = await CompanyKnowledgeQnA.find({ 
            companyId: companyId, 
            status: 'active' 
        });
        
        console.log(`📚 Found ${qnas.length} Q&A entries to process`);
        
        let processed = 0;
        let success = 0;
        let errors = 0;
        
        for (const qna of qnas) {
            try {
                processed++;
                console.log(`\n🔄 Processing Q&A ${processed}/${qnas.length}:`);
                console.log(`   Question: "${qna.question}"`);
                console.log(`   Old keywords: [${qna.keywords.join(', ')}]`);
                
                // Force keyword regeneration by marking question as modified
                qna.markModified('question');
                await qna.save();
                
                // Reload to see new keywords
                const updated = await CompanyKnowledgeQnA.findById(qna._id);
                console.log(`   New keywords: [${updated.keywords.slice(0, 10).join(', ')}${updated.keywords.length > 10 ? '...' : ''}]`);
                console.log(`   ✅ Enhanced with ${updated.keywords.length} keywords`);
                
                success++;
            } catch (error) {
                console.error(`   ❌ Failed to regenerate keywords for Q&A ${qna._id}:`, error.message);
                errors++;
            }
        }
        
        console.log('\n🎉 KEYWORD REGENERATION COMPLETE:');
        console.log(`   📊 Processed: ${processed} entries`);
        console.log(`   ✅ Success: ${success} entries`);
        console.log(`   ❌ Errors: ${errors} entries`);
        
        if (success > 0) {
            console.log('\n🚀 NEXT STEPS:');
            console.log('   1. Test your "hours open" query again');
            console.log('   2. Should now match with much higher confidence');
            console.log('   3. Enhanced keywords will improve AI agent performance');
        }
        
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
    console.error('❌ Usage: node scripts/regenerate-keywords.js <companyId>');
    console.error('   Example: node scripts/regenerate-keywords.js 68813026dd95f599c74e49c7');
    process.exit(1);
}

// Run the regeneration
regenerateKeywords(companyId);
