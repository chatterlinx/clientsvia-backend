#!/usr/bin/env node

/**
 * Fix Company Account Statuses
 * Sets all non-deleted companies to 'active' status
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function fixCompanyStatuses() {
    try {
        console.log('🔧 Connecting to MongoDB...');
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGODB_URI not found in environment variables');
        }
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Find all non-deleted companies
        const companies = await Company.find({ isDeleted: { $ne: true } });
        
        console.log(`📊 Found ${companies.length} non-deleted companies\n`);
        
        for (const company of companies) {
            const currentStatus = company.accountStatus?.status;
            
            console.log(`Company: ${company.companyName}`);
            console.log(`  Current Status: ${currentStatus || 'UNDEFINED'}`);
            
            // Initialize accountStatus if it doesn't exist
            if (!company.accountStatus) {
                company.accountStatus = {
                    status: 'active',
                    changedBy: 'system',
                    changedAt: new Date(),
                    history: []
                };
                console.log(`  ✅ Initialized accountStatus to 'active'`);
            } else if (currentStatus !== 'active') {
                // Update to active if it's something else
                company.accountStatus.status = 'active';
                company.accountStatus.changedBy = 'system-fix';
                company.accountStatus.changedAt = new Date();
                
                // Add to history
                if (!company.accountStatus.history) {
                    company.accountStatus.history = [];
                }
                company.accountStatus.history.push({
                    status: currentStatus || 'undefined',
                    changedAt: new Date(),
                    changedBy: 'system-fix',
                    reason: 'Automated fix to set all companies to active status'
                });
                
                console.log(`  ✅ Updated from '${currentStatus}' to 'active'`);
            } else {
                console.log(`  ℹ️  Already 'active' - no change needed`);
            }
            
            // Save the company
            await company.save();
            console.log('');
        }
        
        console.log('✅ All company statuses fixed!\n');
        
        // Verify
        console.log('🔍 Verification:');
        const activeCompanies = await Company.countDocuments({ 
            isDeleted: { $ne: true },
            'accountStatus.status': 'active'
        });
        const suspendedCompanies = await Company.countDocuments({ 
            isDeleted: { $ne: true },
            'accountStatus.status': 'suspended'
        });
        const callForwardCompanies = await Company.countDocuments({ 
            isDeleted: { $ne: true },
            'accountStatus.status': 'call_forward'
        });
        const undefinedStatus = await Company.countDocuments({ 
            isDeleted: { $ne: true },
            'accountStatus.status': { $exists: false }
        });
        
        console.log(`  Active: ${activeCompanies}`);
        console.log(`  Suspended: ${suspendedCompanies}`);
        console.log(`  Call Forward: ${callForwardCompanies}`);
        console.log(`  Undefined: ${undefinedStatus}`);
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MongoDB');
    }
}

fixCompanyStatuses();

