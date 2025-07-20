const express = require('express');
const router = express.Router();
const TransferRouter = require('../services/transferRouter');
const fs = require('fs').promises;
const path = require('path');

// Initialize transfer router
const transferRouter = new TransferRouter();

// Get transfer router status and configuration
router.get('/company/:companyId/status', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get current status
        const status = {
            enabled: transferRouter.isEnabled(companyId),
            activeTransfers: transferRouter.getActiveTransfers(companyId),
            configuration: transferRouter.getConfiguration(companyId),
            analytics: transferRouter.getAnalytics(companyId),
            personnel: await getPersonnelConfig(companyId)
        };

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Error getting transfer router status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Enable/disable transfer router
router.post('/company/:companyId/toggle', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { enabled } = req.body;

        if (enabled) {
            transferRouter.enable(companyId);
        } else {
            transferRouter.disable(companyId);
        }

        res.json({
            success: true,
            message: `Transfer router ${enabled ? 'enabled' : 'disabled'} for company ${companyId}`,
            enabled: transferRouter.isEnabled(companyId)
        });
    } catch (error) {
        console.error('Error toggling transfer router:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update transfer router configuration
router.post('/company/:companyId/config', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { config } = req.body;

        if (!config) {
            return res.status(400).json({
                success: false,
                error: 'Configuration is required'
            });
        }

        transferRouter.updateConfiguration(companyId, config);

        res.json({
            success: true,
            message: 'Transfer router configuration updated successfully',
            configuration: transferRouter.getConfiguration(companyId)
        });
    } catch (error) {
        console.error('Error updating transfer router config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get personnel configuration
router.get('/company/:companyId/personnel', async (req, res) => {
    try {
        const { companyId } = req.params;
        const personnel = await getPersonnelConfig(companyId);

        res.json({
            success: true,
            data: personnel
        });
    } catch (error) {
        console.error('Error getting personnel config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update personnel configuration
router.post('/company/:companyId/personnel', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { personnel } = req.body;

        if (!personnel) {
            return res.status(400).json({
                success: false,
                error: 'Personnel configuration is required'
            });
        }

        await updatePersonnelConfig(companyId, personnel);

        res.json({
            success: true,
            message: 'Personnel configuration updated successfully',
            data: personnel
        });
    } catch (error) {
        console.error('Error updating personnel config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add personnel member
router.post('/company/:companyId/personnel/add', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { member } = req.body;

        if (!member || !member.name || !member.role || !member.phone) {
            return res.status(400).json({
                success: false,
                error: 'Member name, role, and phone are required'
            });
        }

        const personnel = await getPersonnelConfig(companyId);
        
        // Generate unique ID
        member.id = Date.now().toString();
        member.status = 'active';
        member.addedAt = new Date().toISOString();

        personnel.members.push(member);
        await updatePersonnelConfig(companyId, personnel);

        res.json({
            success: true,
            message: 'Personnel member added successfully',
            data: member
        });
    } catch (error) {
        console.error('Error adding personnel member:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update personnel member
router.put('/company/:companyId/personnel/:memberId', async (req, res) => {
    try {
        const { companyId, memberId } = req.params;
        const { updates } = req.body;

        const personnel = await getPersonnelConfig(companyId);
        const memberIndex = personnel.members.findIndex(m => m.id === memberId);

        if (memberIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Personnel member not found'
            });
        }

        // Update member
        personnel.members[memberIndex] = {
            ...personnel.members[memberIndex],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        await updatePersonnelConfig(companyId, personnel);

        res.json({
            success: true,
            message: 'Personnel member updated successfully',
            data: personnel.members[memberIndex]
        });
    } catch (error) {
        console.error('Error updating personnel member:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Remove personnel member
router.delete('/company/:companyId/personnel/:memberId', async (req, res) => {
    try {
        const { companyId, memberId } = req.params;

        const personnel = await getPersonnelConfig(companyId);
        const memberIndex = personnel.members.findIndex(m => m.id === memberId);

        if (memberIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Personnel member not found'
            });
        }

        // Remove member
        const removedMember = personnel.members.splice(memberIndex, 1)[0];
        await updatePersonnelConfig(companyId, personnel);

        res.json({
            success: true,
            message: 'Personnel member removed successfully',
            data: removedMember
        });
    } catch (error) {
        console.error('Error removing personnel member:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test transfer functionality
router.post('/company/:companyId/test-transfer', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { targetMember, reason, customerInfo } = req.body;

        if (!targetMember || !reason) {
            return res.status(400).json({
                success: false,
                error: 'Target member and reason are required'
            });
        }

        // Create test transfer data
        const transferData = {
            companyId,
            targetMember,
            reason,
            customerInfo: customerInfo || {
                name: 'Test Customer',
                phone: '+1234567890'
            },
            timestamp: new Date().toISOString(),
            test: true
        };

        // Execute test transfer
        const result = await transferRouter.executeTransfer(transferData);

        res.json({
            success: true,
            message: 'Test transfer executed successfully',
            data: result
        });
    } catch (error) {
        console.error('Error executing test transfer:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get transfer analytics
router.get('/company/:companyId/analytics', async (req, res) => {
    try {
        const { companyId } = req.params;
        const analytics = transferRouter.getAnalytics(companyId);

        res.json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error('Error getting transfer analytics:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get active transfers
router.get('/company/:companyId/active-transfers', async (req, res) => {
    try {
        const { companyId } = req.params;
        const activeTransfers = transferRouter.getActiveTransfers(companyId);

        res.json({
            success: true,
            data: activeTransfers
        });
    } catch (error) {
        console.error('Error getting active transfers:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper functions
async function getPersonnelConfig(companyId) {
    try {
        const configPath = path.join(__dirname, '../config/personnelConfig.json');
        const data = await fs.readFile(configPath, 'utf8');
        const allConfig = JSON.parse(data);
        
        return allConfig[companyId] || {
            members: [],
            settings: {
                autoDistribution: true,
                priority: 'round_robin',
                businessHours: {
                    enabled: true,
                    start: '09:00',
                    end: '17:00',
                    timezone: 'America/New_York'
                }
            }
        };
    } catch (error) {
        console.error('Error reading personnel config:', error);
        return {
            members: [],
            settings: {
                autoDistribution: true,
                priority: 'round_robin',
                businessHours: {
                    enabled: true,
                    start: '09:00',
                    end: '17:00',
                    timezone: 'America/New_York'
                }
            }
        };
    }
}

async function updatePersonnelConfig(companyId, personnel) {
    try {
        const configPath = path.join(__dirname, '../config/personnelConfig.json');
        let allConfig = {};
        
        try {
            const data = await fs.readFile(configPath, 'utf8');
            allConfig = JSON.parse(data);
        } catch (error) {
            // File doesn't exist or is invalid, start with empty config
        }
        
        allConfig[companyId] = personnel;
        
        await fs.writeFile(configPath, JSON.stringify(allConfig, null, 2));
        return true;
    } catch (error) {
        console.error('Error updating personnel config:', error);
        throw error;
    }
}

module.exports = router;
