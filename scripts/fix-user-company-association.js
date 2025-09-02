#!/usr/bin/env node
/**
 * Fix User-Company Association Script
 * Addresses the critical issue where users have null companyId
 * 
 * 🚨 CRITICAL ISSUE IDENTIFIED:
 * User ID: 688bdd8b2f0ec14cfaf88139
 * Company ID: 68813026dd95f599c74e49c7
 * Problem: user.companyId = null (should be the company ObjectId)
 * 
 * This script will:
 * 1. Find the user by ID
 * 2. Associate them with the correct company
 * 3. Verify the association is working
 * 4. Test the Knowledge Sources API afterward
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Company = require('../models/Company');
const { connectDB } = require('../db');

async function fixUserCompanyAssociation() {
    try {
        console.log('🔧 Starting User-Company Association Fix...');
        
        // Connect to MongoDB using the same method as the main app
        console.log('📡 Connecting to MongoDB...');
        await connectDB();
        console.log('✅ Connected to MongoDB');
        
        // Find the problematic user
        const userId = '688bdd8b2f0ec14cfaf88139';
        const companyId = '68813026dd95f599c74e49c7';
        
        console.log('🔍 Looking for user:', userId);
        const user = await User.findById(userId);
        
        if (!user) {
            console.error('❌ User not found');
            return;
        }
        
        console.log('✅ User found:', {
            id: user._id,
            email: user.email,
            name: user.name,
            currentCompanyId: user.companyId,
            status: user.status
        });
        
        // Find the target company
        console.log('🔍 Looking for company:', companyId);
        const company = await Company.findById(companyId);
        
        if (!company) {
            console.error('❌ Company not found');
            return;
        }
        
        console.log('✅ Company found:', {
            id: company._id,
            name: company.companyName,
            phone: company.companyPhone
        });
        
        // Fix the association
        console.log('🔧 Fixing user-company association...');
        user.companyId = companyId;
        await user.save();
        
        console.log('✅ User-company association updated');
        
        // Verify the fix
        console.log('🔍 Verifying the fix...');
        const updatedUser = await User.findById(userId).populate('companyId');
        
        console.log('✅ Verification results:', {
            userId: updatedUser._id,
            companyId: updatedUser.companyId?._id,
            companyName: updatedUser.companyId?.companyName,
            associationWorking: !!updatedUser.companyId
        });
        
        if (updatedUser.companyId) {
            console.log('🎉 SUCCESS: User-company association fixed!');
            console.log('🎯 The Knowledge Sources API should now work properly');
        } else {
            console.error('❌ FAILED: Association still not working');
        }
        
    } catch (error) {
        console.error('❌ Script failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('📡 Disconnected from MongoDB');
    }
}

// Run the script
if (require.main === module) {
    fixUserCompanyAssociation()
        .then(() => {
            console.log('🎉 User-Company Association Fix completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = fixUserCompanyAssociation;
