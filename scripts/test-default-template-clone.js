#!/usr/bin/env node

/**
 * TEST DEFAULT TEMPLATE CLONING
 * Creates a test company and verifies it receives scenarios from the default template
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const InstantResponseCategory = require('../models/InstantResponseCategory');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

async function testDefaultTemplateClone() {
    try {
        console.log('\n🧪 TESTING DEFAULT TEMPLATE CLONING...\n');

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Step 1: Check default template
        console.log('📋 STEP 1: Checking default template...');
        const defaultTemplate = await GlobalInstantResponseTemplate.findOne({ 
            isDefaultTemplate: true,
            isPublished: true 
        });

        if (!defaultTemplate) {
            console.log('❌ No default template found! Set one in the Global AI Brain UI first.');
            process.exit(1);
        }

        const totalScenarios = defaultTemplate.categories.reduce((sum, cat) => sum + cat.scenarios.length, 0);
        console.log(`✅ Default Template: "${defaultTemplate.name}" (${defaultTemplate.version})`);
        console.log(`   Categories: ${defaultTemplate.categories.length}`);
        console.log(`   Total Scenarios: ${totalScenarios}\n`);

        // Step 2: Create test company
        console.log('📋 STEP 2: Creating test company...');
        const testCompanyName = `Test Company ${Date.now()}`;
        
        const testCompany = new Company({
            companyName: testCompanyName,
            businessPhone: '+15551234567',
            businessAddress: '123 Test St, Test City, TS 12345',
            businessEmail: 'test@example.com',
            timezone: 'America/New_York',
            isActive: true,
            aiAgentLogic: {
                isEnabled: true
            }
        });

        const savedCompany = await testCompany.save();
        console.log(`✅ Company created: ${savedCompany.companyName}`);
        console.log(`   Company ID: ${savedCompany._id}\n`);

        // Step 3: Clone template (simulating what happens in the POST route)
        console.log('📋 STEP 3: Cloning default template to company...');
        let scenariosCloned = 0;

        for (const globalCategory of defaultTemplate.categories) {
            const newCategory = new InstantResponseCategory({
                companyId: savedCompany._id,
                name: globalCategory.name,
                description: globalCategory.description || `${globalCategory.name} scenarios from ${defaultTemplate.name}`,
                icon: globalCategory.icon || '🧠',
                color: globalCategory.color || '#4F46E5',
                qnas: globalCategory.scenarios.map(scenario => ({
                    id: scenario.id,
                    name: scenario.name,
                    triggers: [...scenario.triggers],
                    keywords: [...scenario.keywords],
                    quickReplies: [...scenario.quickReplies],
                    fullReplies: [...scenario.fullReplies],
                    behavior: globalCategory.behavior || 'empathetic',
                    escalateAfterAttempts: scenario.escalateAfterAttempts || 2,
                    isActive: scenario.isActive !== false,
                    metadata: {
                        source: 'global_template',
                        templateName: defaultTemplate.name,
                        templateVersion: defaultTemplate.version,
                        clonedAt: new Date()
                    }
                })),
                isActive: globalCategory.isActive !== false
            });

            await newCategory.save();
            scenariosCloned += globalCategory.scenarios.length;
        }

        console.log(`✅ Cloned ${scenariosCloned} scenarios\n`);

        // Step 4: Verify
        console.log('📋 STEP 4: Verifying company has scenarios...');
        const companyCategories = await InstantResponseCategory.find({ 
            companyId: savedCompany._id 
        });

        const companyScenarios = companyCategories.reduce((sum, cat) => sum + cat.qnas.length, 0);
        
        console.log(`✅ Company "${savedCompany.companyName}" now has:`);
        console.log(`   Categories: ${companyCategories.length}`);
        console.log(`   Total Scenarios: ${companyScenarios}\n`);

        if (companyScenarios === totalScenarios) {
            console.log('✅✅✅ SUCCESS! All scenarios cloned correctly!\n');
        } else {
            console.log(`⚠️  WARNING: Expected ${totalScenarios} scenarios but found ${companyScenarios}\n`);
        }

        // Step 5: Cleanup (optional - comment out to keep test company)
        console.log('📋 STEP 5: Cleaning up test company...');
        await InstantResponseCategory.deleteMany({ companyId: savedCompany._id });
        await Company.findByIdAndDelete(savedCompany._id);
        console.log('✅ Test company deleted\n');

        console.log('🎉 TEST COMPLETE!\n');

        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

testDefaultTemplateClone();

