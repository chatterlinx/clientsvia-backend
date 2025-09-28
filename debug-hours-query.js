#!/usr/bin/env node

// Debug script to check why "What are your hours?" is not matching Company Q&A
require('dotenv').config();
const mongoose = require('mongoose');

async function debugHoursQuery() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const companyId = '68813026dd95f599c74e49c7'; // Your company ID from screenshot
        
        // Import models
        const CompanyKnowledgeQnA = require('./models/knowledge/CompanyQnA');
        const Company = require('./models/Company');
        
        console.log('\n🔍 DEBUGGING: "What are your hours?" query');
        console.log('Company ID:', companyId);
        
        // 1. Check if Company Q&A entries exist
        const companyQnAs = await CompanyKnowledgeQnA.find({ companyId }).lean();
        console.log(`\n📊 Found ${companyQnAs.length} Company Q&A entries in collection`);
        
        if (companyQnAs.length === 0) {
            console.log('❌ NO COMPANY Q&A ENTRIES FOUND!');
            console.log('This is why it\'s going to inHouseFallback');
            
            // Check if data is in the old embedded format
            const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeManagement.companyQnA').lean();
            const embeddedQnA = company?.aiAgentLogic?.knowledgeManagement?.companyQnA || [];
            console.log(`\n🔍 Checking embedded Q&A: Found ${embeddedQnA.length} entries`);
            
            if (embeddedQnA.length > 0) {
                console.log('📋 Sample embedded Q&A:');
                embeddedQnA.slice(0, 3).forEach((qna, i) => {
                    console.log(`  ${i+1}. Q: "${qna.question?.substring(0, 50)}..."`);
                    console.log(`     A: "${qna.answer?.substring(0, 50)}..."`);
                    console.log(`     Keywords: [${qna.keywords?.join(', ') || 'none'}]`);
                });
                console.log('\n💡 SOLUTION: Run migration script to move embedded Q&A to collection');
            }
        } else {
            console.log('\n📋 Company Q&A entries found:');
            companyQnAs.forEach((qna, i) => {
                console.log(`\n  ${i+1}. Q: "${qna.question}"`);
                console.log(`     A: "${qna.answer?.substring(0, 100)}..."`);
                console.log(`     Keywords: [${qna.keywords?.join(', ') || 'none'}]`);
                console.log(`     Status: ${qna.status}`);
                console.log(`     Confidence: ${qna.confidence}`);
            });
            
            // 2. Test keyword matching
            const query = 'What are your hours?';
            const queryWords = query.toLowerCase().split(/\s+/);
            console.log(`\n🔍 Testing keyword matching for: "${query}"`);
            console.log(`Query words: [${queryWords.join(', ')}]`);
            
            let foundMatch = false;
            companyQnAs.forEach((qna, i) => {
                if (qna.keywords && qna.keywords.length > 0) {
                    const matches = qna.keywords.filter(keyword => 
                        queryWords.some(word => 
                            keyword.includes(word) || word.includes(keyword)
                        )
                    );
                    if (matches.length > 0) {
                        console.log(`  ✅ Q&A #${i+1} matches: [${matches.join(', ')}]`);
                        foundMatch = true;
                    } else {
                        console.log(`  ❌ Q&A #${i+1} no matches`);
                    }
                }
            });
            
            if (!foundMatch) {
                console.log('\n❌ NO KEYWORD MATCHES FOUND!');
                console.log('💡 SOLUTION: Add "hours", "open", "schedule" keywords to business hours Q&A');
            }
        }
        
        // 3. Check priority configuration
        const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeSourcePriorities').lean();
        const priorities = company?.aiAgentLogic?.knowledgeSourcePriorities;
        
        if (priorities) {
            console.log('\n🎯 Priority Configuration:');
            console.log(`  Company Q&A threshold: ${priorities.companyQnA?.threshold || 'not set'}`);
            console.log(`  Company Q&A enabled: ${priorities.companyQnA?.enabled !== false}`);
        } else {
            console.log('\n⚠️ No priority configuration found - using defaults');
        }
        
    } catch (error) {
        console.error('❌ Debug failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ Disconnected from MongoDB');
    }
}

debugHoursQuery();
