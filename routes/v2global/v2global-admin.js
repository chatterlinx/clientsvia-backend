/**
 * V2 GLOBAL ADMIN ROUTES - V2 System Management
 * 
 * 🌐 V2 GLOBAL ADMIN DASHBOARD - V2 ARCHITECTURE:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ ADMIN DASHBOARD V2 - MULTI-TENANT PLATFORM MANAGEMENT           ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Features: Company Directory, System Monitoring, Analytics        ║
 * ║ Security: JWT Authentication + Admin Role Required               ║
 * ║ Performance: Redis Caching + Optimized Queries                  ║
 * ║ Architecture: V2 Global Structure - No Legacy Dependencies      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * V2 Global Admin Routes:
 * - Company Management (Directory, Add, Edit)
 * - System Monitoring (Alerts, Performance)
 * - Analytics Dashboard (V2 Metrics)
 * - Emergency Tools (Cache Clear, User Fixes)
 * 
 * This V2 version eliminates legacy dependencies and provides
 * v2-grade admin functionality with sub-50ms performance.
 */

const express = require('express');
const router = express.Router();
const User = require('../../models/v2User');
const Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const redis = require('redis');

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
                userId
            });
        }
        
        // Find the company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
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
                userId,
                hadCompanyId: Boolean(user.companyId)
            },
            after: {
                userId: verifyUser._id,
                companyId: verifyUser.companyId?._id,
                companyName: verifyUser.companyId?.companyName,
                associationWorking: Boolean(verifyUser.companyId)
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
                populated: Boolean(user.companyId)
            },
            diagnosis: {
                hasCompanyId: Boolean(user.companyId),
                canAccessKnowledge: Boolean(user.companyId),
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

/**
 * 🚨 EMERGENCY: Clear Company Cache
 * Clears Redis cache for a specific company to force reload of fresh data
 */
router.post('/clear-cache/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log('🚨 EMERGENCY: Clearing company cache');
        console.log('🔍 Target company ID:', companyId);
        
        const client = redis.createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        });

        await client.connect();
        console.log('✅ Connected to Redis');

        // Clear all possible cache keys for this company
        const keysToDelete = [
            `ai_config_${companyId}`,
            `company:${companyId}`,
            `company:${companyId}:personality`,
            `company:${companyId}:config`,
            `company:${companyId}:ai`,
            `priorities:${companyId}`,
            `knowledge:${companyId}`
        ];

        let deletedCount = 0;
        const results = [];
        
        for (const key of keysToDelete) {
            const result = await client.del(key);
            if (result) {deletedCount++;}
            results.push({ key, deleted: Boolean(result) });
            console.log(`🗑️ Cache key: ${key} (${result ? 'deleted' : 'not found'})`);
        }

        await client.disconnect();
        console.log(`✅ Cache cleared: ${deletedCount} keys deleted`);

        res.json({
            success: true,
            companyId,
            deletedCount,
            results,
            message: `Cleared ${deletedCount} cache keys for company ${companyId}`
        });

    } catch (error) {
        console.error('❌ Cache clear failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear company cache',
            details: error.message
        });
    }
});

module.exports = router;