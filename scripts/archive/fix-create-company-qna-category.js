/**
 * 🔧 FIX: Create Company Q&A Category
 * Manually create the missing category so "Generate Top 15" can work
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CompanyQnACategory = require('./models/CompanyQnACategory');
const Company = require('./models/v2Company');

const TEST_COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air

async function createCategoryForCompany() {
    try {
        console.log('🔧 Creating Company Q&A Category\n');
        
        // Connect
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');
        
        // Get company
        const company = await Company.findById(TEST_COMPANY_ID).select('companyName businessType');
        if (!company) {
            throw new Error('Company not found');
        }
        console.log(`📋 Company: ${company.companyName}\n`);
        
        // Check if category already exists
        const existing = await CompanyQnACategory.findOne({ 
            companyId: TEST_COMPANY_ID,
            name: 'AC SERVICE CO - AI RECEPTIONIST'
        });
        
        if (existing) {
            console.log('⚠️  Category already exists!');
            console.log(`   ID: ${existing._id}`);
            console.log(`   Q&As: ${existing.qnas?.length || 0}\n`);
            return existing;
        }
        
        // Create new category
        console.log('✨ Creating new category: "AC SERVICE CO - AI RECEPTIONIST"\n');
        
        const newCategory = new CompanyQnACategory({
            name: 'AC SERVICE CO - AI RECEPTIONIST',
            description: 'Professional AI receptionist role and Q&As for HVAC services',
            companyId: TEST_COMPANY_ID,
            qnas: [],
            isActive: true,
            metadata: {
                totalQAs: 0,
                totalKeywords: 0,
                lastUpdated: new Date(),
                version: '2.0.0'
            },
            audit: {
                createdAt: new Date(),
                createdBy: 'fix-script',
                updatedAt: new Date(),
                updatedBy: 'fix-script'
            }
        });
        
        const saved = await newCategory.save();
        
        console.log('✅ Category created successfully!');
        console.log(`   ID: ${saved._id}`);
        console.log(`   Name: ${saved.name}`);
        console.log(`   Q&As: ${saved.qnas.length}\n`);
        
        console.log('🎯 NEXT STEPS:');
        console.log('   1. Refresh the browser page');
        console.log('   2. Go to Company Q&A tab');
        console.log('   3. Click "Generate Top 15" button');
        console.log('   4. It should now work!\n');
        
        return saved;
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Disconnected from MongoDB');
    }
}

// Run
createCategoryForCompany().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});

