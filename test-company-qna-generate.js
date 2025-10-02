/**
 * 🧪 TEST: Company Q&A Generation
 * Diagnose why "Generate Top 15" button isn't working
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CompanyQnACategory = require('./models/CompanyQnACategory');
const Company = require('./models/v2Company');

const TEST_COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air from screenshot

async function testGenerateQnAs() {
    try {
        console.log('🚀 Starting Company Q&A Generation Test\n');
        
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        // 1. Find the company
        const company = await Company.findById(TEST_COMPANY_ID).select('companyName businessType');
        if (!company) {
            throw new Error(`Company ${TEST_COMPANY_ID} not found`);
        }
        console.log(`📋 Company: ${company.companyName} (${company.businessType || 'N/A'})\n`);
        
        // 2. Find categories for this company
        const categories = await CompanyQnACategory.find({ companyId: TEST_COMPANY_ID });
        console.log(`📚 Found ${categories.length} categories:\n`);
        
        categories.forEach((cat, idx) => {
            console.log(`   ${idx + 1}. "${cat.name}"`);
            console.log(`      - Q&As: ${cat.qnas?.length || 0}`);
            console.log(`      - Active: ${cat.isActive}`);
            console.log(`      - ID: ${cat._id}\n`);
        });
        
        if (categories.length === 0) {
            console.log('❌ NO CATEGORIES FOUND! This is the problem!');
            console.log('   The company needs at least one category to generate Q&As into.\n');
            return;
        }
        
        // 3. Test generation for first category
        const testCategory = categories[0];
        console.log(`🎯 Testing generation for category: "${testCategory.name}"\n`);
        console.log(`   Current Q&As: ${testCategory.qnas?.length || 0}`);
        
        if (testCategory.qnas && testCategory.qnas.length > 0) {
            console.log(`   First 3 Q&As:`);
            testCategory.qnas.slice(0, 3).forEach((qna, idx) => {
                console.log(`      ${idx + 1}. Q: ${qna.question.substring(0, 60)}...`);
                console.log(`         A: ${qna.answer.substring(0, 60)}...`);
            });
        }
        
        console.log('\n✅ Diagnostic complete!');
        console.log('\n📊 SUMMARY:');
        console.log(`   - Company exists: YES`);
        console.log(`   - Categories exist: ${categories.length > 0 ? 'YES' : 'NO'}`);
        console.log(`   - Total Q&As across all categories: ${categories.reduce((sum, c) => sum + (c.qnas?.length || 0), 0)}`);
        
        if (categories.length > 0 && categories[0].qnas && categories[0].qnas.length === 6) {
            console.log('\n🔍 ISSUE IDENTIFIED:');
            console.log('   - Category has exactly 6 Q&As');
            console.log('   - "Generate Top 15" should ADD 15 more (total 21)');
            console.log('   - If it\'s not working, check:');
            console.log('     1. Frontend button click handler');
            console.log('     2. API endpoint is being called');
            console.log('     3. Check browser console for errors');
            console.log('     4. Check server logs for generation attempt');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('\n👋 Disconnected from MongoDB');
    }
}

// Run test
testGenerateQnAs().then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
}).catch(error => {
    console.error('\n💥 Test crashed:', error);
    process.exit(1);
});

