/**
 * ============================================================================
 * ADMIN NOTIFICATION SETTINGS - API ROUTES
 * ============================================================================
 * 
 * ENDPOINTS:
 * - GET  /api/admin/notification-settings - Get current settings
 * - POST /api/admin/notification-settings - Update settings
 * - POST /api/admin/notification-settings/test - Send test notification
 * 
 * AUTHENTICATION:
 * All endpoints require admin JWT authentication
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const AdminSettings = require('../../models/AdminSettings');
const AdminNotificationService = require('../../services/AdminNotificationService');

// ============================================================================
// GET ADMIN NOTIFICATION SETTINGS
// ============================================================================

/**
 * GET /api/admin/notification-settings
 * Get current admin notification settings
 */
router.get('/notification-settings', authenticateJWT, requireRole('admin'), async (req, res) => {
    console.log('📋 [API] GET /api/admin/notification-settings');
    
    try {
        const settings = await AdminSettings.getSettings();
        
        console.log('✅ [API] Settings retrieved successfully');
        
        res.json({
            success: true,
            settings
        });
        
    } catch (error) {
        console.error('❌ [API] Failed to get settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve notification settings',
            error: error.message
        });
    }
});

// ============================================================================
// UPDATE ADMIN NOTIFICATION SETTINGS
// ============================================================================

/**
 * POST /api/admin/notification-settings
 * Update admin notification settings
 * 
 * BODY:
 * {
 *   sms: {
 *     enabled: true,
 *     phoneNumber: '+1234567890',
 *     template: '...'
 *   },
 *   email: {
 *     enabled: true,
 *     address: 'admin@example.com',
 *     template: '...',
 *     subject: '...'
 *   },
 *   alertTypes: {
 *     missingVariables: true,
 *     criticalErrors: true,
 *     warnings: false,
 *     info: false
 *   }
 * }
 */
router.post('/notification-settings', authenticateJWT, requireRole('admin'), async (req, res) => {
    console.log('📝 [API] POST /api/admin/notification-settings');
    
    try {
        const updates = req.body;
        
        // Add metadata
        updates.lastUpdated = new Date();
        updates.updatedBy = req.user?.email || 'Admin';
        
        const settings = await AdminSettings.updateSettings(updates);
        
        console.log('✅ [API] Settings updated successfully');
        
        res.json({
            success: true,
            message: 'Notification settings updated successfully',
            settings
        });
        
    } catch (error) {
        console.error('❌ [API] Failed to update settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update notification settings',
            error: error.message
        });
    }
});

// ============================================================================
// SEND TEST NOTIFICATION
// ============================================================================

/**
 * POST /api/admin/notification-settings/test
 * Send a test notification
 * 
 * BODY:
 * {
 *   type: 'sms' | 'email' | 'both'  (default: 'both')
 * }
 */
router.post('/notification-settings/test', authenticateJWT, requireRole('admin'), async (req, res) => {
    console.log('🧪 [API] POST /api/admin/notification-settings/test');
    
    try {
        const { type = 'both' } = req.body;
        
        // Validate type
        if (!['sms', 'email', 'both'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid type. Must be "sms", "email", or "both"'
            });
        }
        
        console.log(`🧪 [API] Sending test notification (type: ${type})`);
        
        const result = await AdminNotificationService.sendTestNotification(type);
        
        if (result.success) {
            console.log('✅ [API] Test notification sent successfully');
            
            res.json({
                success: true,
                message: 'Test notification sent successfully',
                results: result.results
            });
        } else {
            console.warn('⚠️  [API] Test notification failed');
            
            res.status(500).json({
                success: false,
                message: 'Failed to send test notification',
                reason: result.reason
            });
        }
        
    } catch (error) {
        console.error('❌ [API] Test notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send test notification',
            error: error.message
        });
    }
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = router;

