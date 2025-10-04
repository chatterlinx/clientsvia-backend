#!/usr/bin/env node
/**
 * Test Script: Verify Quick Variables Save/Load
 * 
 * This script directly tests MongoDB to see if quickVariables are being saved and retrieved.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const v2Company = require('./models/v2Company');

const COMPANY_ID = '68813026dd95f599c74e49c7'; // Atlas Air

async function testQuickVariables() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Test 1: Fetch company and check current quickVariables
        console.log('📊 TEST 1: Fetching company document...');
        const company = await v2Company.findById(COMPANY_ID);
        
        if (!company) {
            console.error('❌ Company not found!');
            process.exit(1);
        }
        
        console.log('✅ Company found:', company.companyName);
        console.log('📊 Current quickVariables:', company.quickVariables);
        console.log('📊 quickVariables count:', company.quickVariables?.length || 0);
        console.log('');

        // Test 2: Add a test variable
        console.log('📊 TEST 2: Adding test variable...');
        const { v4: uuidv4 } = require('uuid');
        
        const testVar = {
            id: uuidv4(),
            name: 'Test Variable',
            value: 'Test Value',
            createdAt: new Date()
        };
        
        if (!company.quickVariables) {
            company.quickVariables = [];
        }
        
        // Check if already exists
        const exists = company.quickVariables.find(v => v.name === 'Test Variable');
        if (exists) {
            console.log('⚠️ Test variable already exists, skipping add');
        } else {
            company.quickVariables.push(testVar);
            console.log('📝 Test variable added to document');
            
            // Mark as modified (important for nested arrays!)
            company.markModified('quickVariables');
            
            await company.save();
            console.log('✅ Document saved to MongoDB');
        }
        console.log('');

        // Test 3: Re-fetch to verify persistence
        console.log('📊 TEST 3: Re-fetching to verify save...');
        const verifyCompany = await v2Company.findById(COMPANY_ID).select('quickVariables');
        console.log('📊 Verified quickVariables:', verifyCompany.quickVariables);
        console.log('📊 Verified count:', verifyCompany.quickVariables?.length || 0);
        
        if (verifyCompany.quickVariables && verifyCompany.quickVariables.length > 0) {
            console.log('✅ SUCCESS: Variables are persisting!');
            console.log('📊 Variables:');
            verifyCompany.quickVariables.forEach((v, i) => {
                console.log(`   ${i + 1}. "${v.name}" → "${v.value}"`);
            });
        } else {
            console.error('❌ FAILURE: Variables not persisting!');
        }
        
        console.log('\n✅ Test complete!');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

testQuickVariables();

