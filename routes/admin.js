/**
 * Admin Routes for System Management
 * Emergency endpoints for fixing production issues
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Company = require('../models/Company');
const { authenticateJWT } = require('../middleware/auth');

/**
 * 🚨 EMERGENCY: Fix User-Company Association
 * Addresses critical issue where users have null companyId
 */
router.post('/fix-user-company/:userId/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { userId, companyId } = req.params;
        
        console.log('🚨 EMERGENCY: Fixing user-company association');
        console.log('🔍 Target user ID:', userId);
        console.log('🔍 Target company ID:', companyId);
        
        // Find the user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                userId: userId
            });
        }
        
        // Find the company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId: companyId
            });
        }
        
        console.log('✅ Found user:', {
            id: user._id,
            email: user.email,
            currentCompanyId: user.companyId
        });
        
        console.log('✅ Found company:', {
            id: company._id,
            name: company.companyName
        });
        
        // Fix the association
        user.companyId = companyId;
        await user.save();
        
        // Verify the fix
        const verifyUser = await User.findById(userId).populate('companyId');
        
        const result = {
            success: true,
            message: 'User-company association fixed successfully',
            before: {
                userId: userId,
                hadCompanyId: !!user.companyId
            },
            after: {
                userId: verifyUser._id,
                companyId: verifyUser.companyId?._id,
                companyName: verifyUser.companyId?.companyName,
                associationWorking: !!verifyUser.companyId
            }
        };
        
        console.log('🎉 SUCCESS: User-company association fixed!', result);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ EMERGENCY: Fix user-company association failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fix user-company association',
            details: error.message
        });
    }
});

/**
 * 🔍 DIAGNOSTIC: Check User-Company Association
 * Verify user-company relationships
 */
router.get('/check-user-company/:userId', authenticateJWT, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId).populate('companyId');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const diagnosis = {
            success: true,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                status: user.status
            },
            company: {
                id: user.companyId?._id || null,
                name: user.companyId?.companyName || null,
                populated: !!user.companyId
            },
            diagnosis: {
                hasCompanyId: !!user.companyId,
                canAccessKnowledge: !!user.companyId,
                needsFix: !user.companyId
            }
        };
        
        console.log('🔍 User-company diagnosis:', diagnosis);
        
        res.json(diagnosis);
        
    } catch (error) {
        console.error('❌ User-company check failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check user-company association',
            details: error.message
        });
    }
});

module.exports = router;