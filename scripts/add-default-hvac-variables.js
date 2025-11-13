/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADD DEFAULT HVAC VARIABLES TO COMPANIES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Pre-populate common HVAC business variables for all companies
 * 
 * Variables Added:
 * - {companyName} - Business name
 * - {emergencyPhone} - After-hours/emergency contact
 * - {mainPhone} - Main office number
 * - {billingPhone} - Billing department
 * - {schedulingPhone} - Appointment scheduling
 * - {serviceAreas} - Cities/regions served
 * - {serviceAdvisorName} - Primary contact for escalations
 * - {managerName} - Manager/owner name
 * - {businessHours} - Operating hours
 * - {officeAddress} - Physical address
 * 
 * These match the {variables} used in the default Frontline-Intel template!
 * 
 * Usage:
 *   node scripts/add-default-hvac-variables.js
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const connectDB = require('../db');
const Company = require('../models/v2Company');
const logger = require('../utils/logger');

/**
 * Default HVAC Variables (pre-filled with placeholder values)
 * Admins can edit these in the Variables tab
 */
const DEFAULT_HVAC_VARIABLES = [
    {
        key: 'companyName',
        label: 'Company Name',
        value: '[Your Business Name]',
        category: 'Company Info',
        type: 'text',
        required: true,
        example: 'Cool Air Pros',
        usageCount: 0
    },
    {
        key: 'emergencyPhone',
        label: 'Emergency Phone Number',
        value: '[Emergency Contact]',
        category: 'Contact Info',
        type: 'phone',
        required: true,
        example: '(555) 123-4567',
        usageCount: 0
    },
    {
        key: 'mainPhone',
        label: 'Main Office Phone',
        value: '[Main Office Number]',
        category: 'Contact Info',
        type: 'phone',
        required: true,
        example: '(555) 111-2222',
        usageCount: 0
    },
    {
        key: 'billingPhone',
        label: 'Billing Department Phone',
        value: '[Billing Number]',
        category: 'Contact Info',
        type: 'phone',
        required: false,
        example: '(555) 333-4444',
        usageCount: 0
    },
    {
        key: 'schedulingPhone',
        label: 'Scheduling Phone Number',
        value: '[Scheduling Number]',
        category: 'Contact Info',
        type: 'phone',
        required: false,
        example: '(555) 555-6666',
        usageCount: 0
    },
    {
        key: 'serviceAreas',
        label: 'Service Areas / Cities',
        value: '[Service Areas]',
        category: 'Service Info',
        type: 'text',
        required: true,
        example: 'Tampa, St. Pete, Clearwater',
        usageCount: 0
    },
    {
        key: 'serviceAdvisorName',
        label: 'Service Advisor Name',
        value: '[Service Advisor]',
        category: 'Staff Info',
        type: 'text',
        required: false,
        example: 'Mike',
        usageCount: 0
    },
    {
        key: 'managerName',
        label: 'Manager / Owner Name',
        value: '[Manager Name]',
        category: 'Staff Info',
        type: 'text',
        required: false,
        example: 'John Smith',
        usageCount: 0
    },
    {
        key: 'businessHours',
        label: 'Business Hours',
        value: '[Business Hours]',
        category: 'Service Info',
        type: 'text',
        required: true,
        example: 'Monday-Friday 8am-5pm',
        usageCount: 0
    },
    {
        key: 'officeAddress',
        label: 'Office Address',
        value: '[Office Address]',
        category: 'Company Info',
        type: 'address',
        required: false,
        example: '123 Main St, Tampa, FL 33601',
        usageCount: 0
    }
];

async function addDefaultVariables() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔧 ADD DEFAULT HVAC VARIABLES TO COMPANIES');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    try {
        // Connect to database
        await connectDB();
        console.log('✅ Connected to MongoDB\n');
        
        // Find all companies
        const companies = await Company.find({}).select('_id companyName businessName aiAgentSettings');
        console.log(`📊 Found ${companies.length} companies\n`);
        
        if (companies.length === 0) {
            console.log('⚠️  No companies found in database');
            return;
        }
        
        let companiesUpdated = 0;
        let variablesAdded = 0;
        
        for (const company of companies) {
            const companyName = company.businessName || company.companyName || company._id;
            console.log(`\n🏢 Processing: ${companyName}`);
            console.log(`   Company ID: ${company._id}`);
            
            // Get existing variables
            const existingVariables = company.aiAgentSettings?.variables || [];
            const existingKeys = new Set(existingVariables.map(v => v.key?.toLowerCase()));
            
            console.log(`   Existing variables: ${existingVariables.length}`);
            
            // Find variables to add (not already present)
            const variablesToAdd = DEFAULT_HVAC_VARIABLES.filter(v => 
                !existingKeys.has(v.key.toLowerCase())
            );
            
            if (variablesToAdd.length === 0) {
                console.log(`   ✅ All default variables already present (${existingVariables.length} total)`);
                continue;
            }
            
            // Pre-fill companyName variable with actual company name if available
            const companyNameVar = variablesToAdd.find(v => v.key === 'companyName');
            if (companyNameVar && (company.businessName || company.companyName)) {
                companyNameVar.value = company.businessName || company.companyName;
                console.log(`   🎯 Pre-filled {companyName} = "${companyNameVar.value}"`);
            }
            
            // Add new variables
            const updatedVariables = [
                ...existingVariables,
                ...variablesToAdd
            ];
            
            // Update company
            await Company.findByIdAndUpdate(
                company._id,
                {
                    $set: {
                        'aiAgentSettings.variables': updatedVariables
                    }
                },
                { new: true }
            );
            
            console.log(`   ✅ Added ${variablesToAdd.length} new variables:`);
            variablesToAdd.forEach(v => {
                console.log(`      • {${v.key}} - ${v.label}`);
            });
            console.log(`   📊 Total variables now: ${updatedVariables.length}`);
            
            companiesUpdated++;
            variablesAdded += variablesToAdd.length;
        }
        
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('✅ SCRIPT COMPLETE!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`📊 Companies Updated: ${companiesUpdated}/${companies.length}`);
        console.log(`📊 Total Variables Added: ${variablesAdded}`);
        console.log(`📊 Average per Company: ${(variablesAdded / companiesUpdated || 0).toFixed(1)}`);
        console.log('\n💡 Next Steps:');
        console.log('   1. Go to AI Agent Settings → Variables tab');
        console.log('   2. Fill in the placeholder values with your real info');
        console.log('   3. Run "Force Scan All Variables" to detect variable usage');
        console.log('   4. Variables will now auto-replace in Frontline-Intel!\n');
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

// Run the script
addDefaultVariables();

