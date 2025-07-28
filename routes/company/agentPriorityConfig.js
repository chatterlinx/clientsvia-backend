/**
 * Agent Priority Configuration Routes
 * Handles the no-code drag-and-drop priority controller for agent answer flow
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');

// =============================================
// GET AGENT PRIORITY CONFIGURATION
// =============================================

router.get('/:companyId/agent-priority-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`[Agent Priority] 📥 Loading priority config for company: ${companyId}`);
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Return saved priority configuration or defaults
        const priorityConfig = company.agentPriorityConfig || getDefaultPriorityConfig();
        
        console.log(`[Agent Priority] ✅ Priority config loaded successfully`);
        
        res.json({
            success: true,
            data: priorityConfig
        });
        
    } catch (error) {
        console.error('[Agent Priority] ❌ Error loading priority config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load agent priority configuration',
            error: error.message
        });
    }
});

// =============================================
// SAVE AGENT PRIORITY CONFIGURATION
// =============================================

router.post('/:companyId/agent-priority-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        const priorityConfig = req.body;
        
        console.log(`[Agent Priority] 💾 Saving priority config for company: ${companyId}`);
        console.log(`[Agent Priority] Config:`, JSON.stringify(priorityConfig, null, 2));
        
        // Validate the configuration structure
        if (!validatePriorityConfig(priorityConfig)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid priority configuration format'
            });
        }
        
        // Update company with new priority configuration
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                agentPriorityConfig: priorityConfig,
                updatedAt: new Date()
            },
            { new: true }
        );
        
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        console.log(`[Agent Priority] ✅ Priority config saved successfully`);
        
        res.json({
            success: true,
            message: 'Agent priority configuration saved successfully',
            data: priorityConfig
        });
        
    } catch (error) {
        console.error('[Agent Priority] ❌ Error saving priority config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save agent priority configuration',
            error: error.message
        });
    }
});

// =============================================
// HELPER FUNCTIONS
// =============================================

function getDefaultPriorityConfig() {
    return {
        flow: [
            { id: 'company-knowledge', priority: 1, enabled: true },
            { id: 'trade-categories', priority: 2, enabled: true },
            { id: 'template-intelligence', priority: 3, enabled: true },
            { id: 'learning-queue', priority: 4, enabled: true },
            { id: 'emergency-llm', priority: 5, enabled: true }
        ],
        settings: {
            knowledgeFirst: true,
            autoLearning: true,
            emergencyLLM: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

function validatePriorityConfig(config) {
    try {
        // Check required structure
        if (!config || typeof config !== 'object') {
            return false;
        }
        
        // Check flow array
        if (!Array.isArray(config.flow)) {
            return false;
        }
        
        // Check each flow item
        for (const item of config.flow) {
            if (!item.id || typeof item.priority !== 'number' || typeof item.enabled !== 'boolean') {
                return false;
            }
        }
        
        // Check settings object
        if (!config.settings || typeof config.settings !== 'object') {
            return false;
        }
        
        const requiredSettings = ['knowledgeFirst', 'autoLearning', 'emergencyLLM'];
        for (const setting of requiredSettings) {
            if (typeof config.settings[setting] !== 'boolean') {
                return false;
            }
        }
        
        return true;
        
    } catch (error) {
        console.error('[Agent Priority] ❌ Validation error:', error);
        return false;
    }
}

// =============================================
// GET PRIORITY FLOW FOR AGENT PROCESSING
// =============================================

router.get('/:companyId/agent-priority-flow', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`[Agent Priority] 🔄 Getting priority flow for agent processing: ${companyId}`);
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        const priorityConfig = company.agentPriorityConfig || getDefaultPriorityConfig();
        
        // Return only the essential flow information for agent processing
        const processingFlow = {
            flow: priorityConfig.flow
                .filter(item => item.enabled)
                .sort((a, b) => a.priority - b.priority)
                .map(item => ({
                    source: item.id,
                    priority: item.priority
                })),
            settings: priorityConfig.settings
        };
        
        console.log(`[Agent Priority] ✅ Processing flow generated:`, processingFlow);
        
        res.json({
            success: true,
            data: processingFlow
        });
        
    } catch (error) {
        console.error('[Agent Priority] ❌ Error getting priority flow:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get agent priority flow',
            error: error.message
        });
    }
});

module.exports = router;
