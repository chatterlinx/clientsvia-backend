/**
 * ============================================================================
 * FIX USER-COMPANY ASSOCIATION - ADMIN ENDPOINT
 * ============================================================================
 * 
 * PURPOSE: Fix existing users who have undefined companyId
 * 
 * ISSUE: Users created before the auto-assignment fix have no companyId
 * SOLUTION: Auto-assign them to Platform Admin company
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const User = require('../../models/v2User');
const Company = require('../../models/v2Company');
const logger = require('../../utils/logger');

/**
 * POST /api/admin/fix-users-without-company
 * Fix ALL users who don't have a companyId assigned
 */
router.post('/fix-users-without-company', async (req, res) => {
    try {
        logger.info('🔧 [FIX] Starting user-company association fix...');
        
        // Find all users without companyId
        const usersWithoutCompany = await User.find({ 
            companyId: { $exists: false }
        }).select('_id email name role');
        
        if (usersWithoutCompany.length === 0) {
            logger.info('✅ [FIX] No users need fixing - all have companyId assigned');
            return res.json({
                success: true,
                message: 'No users need fixing',
                fixed: 0
            });
        }
        
        logger.info(`🔍 [FIX] Found ${usersWithoutCompany.length} users without companyId`);
        
        // Find or create Platform Admin company
        let adminCompany = await Company.findOne({ 
            $or: [
                { companyName: 'Platform Admin' },
                { businessName: 'Platform Admin' },
                { 'metadata.isPlatformAdmin': true }
            ]
        });
        
        if (!adminCompany) {
            logger.info('🏢 [FIX] Creating Platform Admin company...');
            adminCompany = await Company.create({
                companyName: 'Platform Admin',
                businessName: 'Platform Admin',
                email: 'admin@clientsvia.com',
                status: 'active',
                accountStatus: {
                    status: 'active',
                    lastChanged: new Date()
                },
                metadata: {
                    isPlatformAdmin: true,
                    purpose: 'Default company for platform administrators',
                    createdBy: 'fix-endpoint',
                    setupAt: new Date()
                }
            });
            logger.info('✅ [FIX] Platform Admin company created:', adminCompany._id);
        }
        
        // Fix each user
        const results = [];
        for (const user of usersWithoutCompany) {
            user.companyId = adminCompany._id;
            await user.save();
            
            results.push({
                userId: user._id,
                email: user.email,
                role: user.role,
                companyId: adminCompany._id
            });
            
            logger.info(`✅ [FIX] Fixed user: ${user.email} (${user._id}) → Company: ${adminCompany._id}`);
        }
        
        logger.info(`🎉 [FIX] Successfully fixed ${results.length} users`);
        
        res.json({
            success: true,
            message: `Fixed ${results.length} users without companyId`,
            fixed: results.length,
            adminCompany: {
                id: adminCompany._id,
                name: adminCompany.companyName
            },
            users: results
        });
        
    } catch (error) {
        logger.error('❌ [FIX] Error fixing users:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/fix-specific-user/:userId
 * Fix a specific user's companyId
 */
router.post('/fix-specific-user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { companyId } = req.body; // Optional: specify which company to assign
        
        logger.info(`🔧 [FIX] Fixing user: ${userId}`);
        
        // Find the user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Determine which company to assign
        let targetCompany;
        if (companyId) {
            targetCompany = await Company.findById(companyId);
            if (!targetCompany) {
                return res.status(404).json({
                    success: false,
                    error: 'Specified company not found'
                });
            }
        } else {
            // Auto-assign to Platform Admin company
            targetCompany = await Company.findOne({ 
                $or: [
                    { companyName: 'Platform Admin' },
                    { businessName: 'Platform Admin' },
                    { 'metadata.isPlatformAdmin': true }
                ]
            });
            
            if (!targetCompany) {
                logger.info('🏢 [FIX] Creating Platform Admin company...');
                targetCompany = await Company.create({
                    companyName: 'Platform Admin',
                    businessName: 'Platform Admin',
                    email: 'admin@clientsvia.com',
                    status: 'active',
                    accountStatus: {
                        status: 'active',
                        lastChanged: new Date()
                    },
                    metadata: {
                        isPlatformAdmin: true,
                        purpose: 'Default company for platform administrators',
                        createdBy: 'fix-endpoint',
                        setupAt: new Date()
                    }
                });
            }
        }
        
        // Fix the user
        user.companyId = targetCompany._id;
        await user.save();
        
        logger.info(`✅ [FIX] User fixed: ${user.email} → Company: ${targetCompany.companyName}`);
        
        res.json({
            success: true,
            message: 'User fixed successfully',
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                companyId: targetCompany._id,
                companyName: targetCompany.companyName || targetCompany.businessName
            }
        });
        
    } catch (error) {
        logger.error('❌ [FIX] Error fixing user:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

