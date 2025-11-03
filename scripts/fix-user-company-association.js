/**
 * ============================================================================
 * FIX USER-COMPANY ASSOCIATION
 * ============================================================================
 * 
 * PURPOSE: Fix user (6887a36b8e85a49918736de8) who has undefined companyId
 * 
 * ISSUE: User authenticated successfully but companyId is undefined
 * SOLUTION: Assign user to a company
 * 
 * USAGE:
 * 1. Get your list of companies: node scripts/list-companies.js
 * 2. Run this script with the company ID you want to assign
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/v2User');
const Company = require('../models/v2Company');
const logger = require('../utils/logger');

const PROBLEM_USER_ID = '6887a36b8e85a49918736de8';

async function fixUserCompanyAssociation() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info('✅ Connected to MongoDB');
        
        // Find the problem user
        const user = await User.findById(PROBLEM_USER_ID);
        
        if (!user) {
            logger.error('❌ User not found:', PROBLEM_USER_ID);
            process.exit(1);
        }
        
        logger.info('✅ Found user:', {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            currentCompanyId: user.companyId
        });
        
        // Get first active company (or you can specify a specific company ID)
        const company = await Company.findOne({ 
            $or: [
                { status: 'active' },
                { accountStatus: { $exists: false } }, // Legacy companies
                { 'accountStatus.status': 'active' }
            ]
        }).sort({ createdAt: -1 }); // Get most recent
        
        if (!company) {
            logger.error('❌ No companies found in database!');
            logger.info('💡 You need to create a company first before fixing user association');
            process.exit(1);
        }
        
        logger.info('✅ Found company:', {
            id: company._id,
            name: company.companyName || company.businessName
        });
        
        // Fix the association
        logger.info('🔧 Updating user companyId...');
        user.companyId = company._id;
        await user.save();
        
        // Verify the fix
        const verifiedUser = await User.findById(PROBLEM_USER_ID).populate('companyId');
        
        logger.info('✅ FIX COMPLETE!');
        logger.info('📊 Verification:', {
            userId: verifiedUser._id,
            email: verifiedUser.email,
            companyId: verifiedUser.companyId?._id,
            companyName: verifiedUser.companyId?.companyName || verifiedUser.companyId?.businessName
        });
        
        logger.info('\n🚀 User can now access the platform!');
        logger.info('📝 Logout and login again to refresh the session.\n');
        
        process.exit(0);
        
    } catch (error) {
        logger.error('❌ Error fixing user-company association:', error);
        process.exit(1);
    }
}

fixUserCompanyAssociation();
