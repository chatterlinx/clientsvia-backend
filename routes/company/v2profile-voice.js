/**
 * V2 AI Voice Settings API Routes
 * V2-grade ElevenLabs integration with aiAgentLogic system
 * 
 * 🎤 V2 VOICE SETTINGS - V2 ARCHITECTURE:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ ELEVENLABS INTEGRATION V2 - MULTI-TENANT VOICE SYSTEM            ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Storage: aiAgentLogic.voiceSettings (NOT legacy aiSettings)      ║
 * ║ Cache: Redis voice:company:{id} keys for sub-50ms performance    ║
 * ║ API: Latest ElevenLabs API with Turbo v2.5 model support        ║
 * ║ Security: Multi-tenant isolation + API key encryption           ║
 * ║ Performance: Streaming optimization + quality controls           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * Migration from Legacy:
 * - OLD: company.aiSettings.elevenLabs.*
 * - NEW: company.aiAgentLogic.voiceSettings.*
 * 
 * This ensures voice settings are part of the unified AI Agent Logic
 * system with complete v2-grade multi-tenant isolation.
 */

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const Company = require('../../models/v2Company');
const { redisClient } = require('../../clients');

// Redis client imported above

/**
 * @route   GET /api/company/:companyId/v2-voice-settings
 * @desc    Get V2 voice settings from aiAgentLogic.voiceSettings
 * @access  Private
 */
router.get('/:companyId/v2-voice-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID format'
            });
        }

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // 🔍 DIAGNOSTIC: Log what we're getting from the database
        console.log(`🔍 [GET VOICE] Company: ${company.companyName}`);
        console.log(`🔍 [GET VOICE] Has aiAgentLogic:`, !!company.aiAgentLogic);
        console.log(`🔍 [GET VOICE] Has voiceSettings:`, !!company.aiAgentLogic?.voiceSettings);
        console.log(`🔍 [GET VOICE] Raw voiceSettings:`, JSON.stringify(company.aiAgentLogic?.voiceSettings, null, 2));

        // Get voice settings from V2 aiAgentLogic system
        const voiceSettings = company.aiAgentLogic?.voiceSettings || {
            // V2 Default Settings - V2 Grade
            apiSource: 'clientsvia', // 'clientsvia' or 'own'
            apiKey: null, // Only used when apiSource = 'own'
            voiceId: null,
            
            // Voice Quality Controls
            stability: 0.5,
            similarityBoost: 0.7,
            styleExaggeration: 0.0,
            
            // Performance & Output
            speakerBoost: true,
            aiModel: 'eleven_turbo_v2_5',
            outputFormat: 'mp3_44100_128',
            streamingLatency: 0, // 0 = best quality, higher = lower latency
            
            // V2 Features
            enabled: true,
            lastUpdated: new Date(),
            version: '2.0'
        };

        // Mask API key for security
        const safeSettings = { ...voiceSettings };
        if (safeSettings.apiKey) {
            safeSettings.apiKey = '*****';
        }

        console.log(`✅ V2 Voice settings loaded for company ${companyId}`);

        res.json({
            success: true,
            settings: safeSettings,
            version: '2.0'
        });

    } catch (error) {
        console.error('❌ Error getting V2 voice settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get voice settings',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/company/:companyId/v2-voice-settings
 * @desc    Save V2 voice settings to aiAgentLogic.voiceSettings
 * @access  Private
 */
router.post('/:companyId/v2-voice-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        const {
            apiSource = 'clientsvia',
            apiKey,
            voiceId,
            stability = 0.5,
            similarityBoost = 0.7,
            styleExaggeration = 0.0,
            speakerBoost = true,
            aiModel = 'eleven_turbo_v2_5',
            outputFormat = 'mp3_44100_128',
            streamingLatency = 0
        } = req.body;

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID format'
            });
        }

        // Validate required fields
        if (!voiceId) {
            return res.status(400).json({
                success: false,
                message: 'Voice ID is required'
            });
        }

        if (apiSource === 'own' && !apiKey) {
            return res.status(400).json({
                success: false,
                message: 'API key is required when using own ElevenLabs account'
            });
        }

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize aiAgentLogic if not exists
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }

        // V2 Voice Settings Structure
        company.aiAgentLogic.voiceSettings = {
            apiSource: apiSource,
            apiKey: apiSource === 'own' ? apiKey : null,
            voiceId: voiceId,
            
            // Voice Quality Controls
            stability: parseFloat(stability),
            similarityBoost: parseFloat(similarityBoost),
            styleExaggeration: parseFloat(styleExaggeration),
            
            // Performance & Output
            speakerBoost: Boolean(speakerBoost),
            aiModel: aiModel,
            outputFormat: outputFormat,
            streamingLatency: parseInt(streamingLatency),
            
            // V2 Metadata
            enabled: true,
            lastUpdated: new Date(),
            version: '2.0'
        };

        // Save to database
        await company.save();

        // Clear Redis cache for immediate effect
        if (redisClient) {
            const cacheKeys = [
                `company:${companyId}`,
                `voice:company:${companyId}`,
                `ai-agent:${companyId}`
            ];
            
            // Also clear phone-based cache for Twilio integration
            if (company.twilioConfig?.phoneNumber) {
                cacheKeys.push(`company-phone:${company.twilioConfig.phoneNumber}`);
            }
            
            await Promise.all(cacheKeys.map(key => redisClient.del(key)));
            console.log(`🗑️ V2 Voice cache cleared for company ${companyId}: ${cacheKeys.join(', ')}`);
        }

        console.log(`✅ V2 Voice settings saved for company ${companyId}:`, {
            voiceId,
            apiSource,
            aiModel,
            outputFormat
        });

        // Return safe settings (mask API key)
        const safeSettings = { ...company.aiAgentLogic.voiceSettings };
        if (safeSettings.apiKey) {
            safeSettings.apiKey = '*****';
        }

        res.json({
            success: true,
            message: 'V2 voice settings saved successfully',
            settings: safeSettings,
            version: '2.0'
        });

    } catch (error) {
        console.error('❌ Error saving V2 voice settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save voice settings',
            error: error.message
        });
    }
});

/**
 * @route   PATCH /api/company/:companyId/v2-voice-settings
 * @desc    Update specific V2 voice settings (partial update)
 * @access  Private
 */
router.patch('/:companyId/v2-voice-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        const updates = req.body;

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID format'
            });
        }

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize aiAgentLogic.voiceSettings if not exists
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }
        if (!company.aiAgentLogic.voiceSettings) {
            company.aiAgentLogic.voiceSettings = {
                apiSource: 'clientsvia',
                enabled: true,
                version: '2.0'
            };
        }

        // Apply partial updates
        const allowedFields = [
            'apiSource', 'apiKey', 'voiceId', 'stability', 'similarityBoost',
            'styleExaggeration', 'speakerBoost', 'aiModel', 'outputFormat',
            'streamingLatency', 'enabled'
        ];

        let hasChanges = false;
        allowedFields.forEach(field => {
            if (field in updates) {
                company.aiAgentLogic.voiceSettings[field] = updates[field];
                hasChanges = true;
            }
        });

        if (hasChanges) {
            company.aiAgentLogic.voiceSettings.lastUpdated = new Date();
            await company.save();

            // Clear cache
            if (redisClient) {
                await redisClient.del(`company:${companyId}`);
                await redisClient.del(`voice:company:${companyId}`);
            }

            console.log(`✅ V2 Voice settings updated for company ${companyId}`);
        }

        // Return safe settings
        const safeSettings = { ...company.aiAgentLogic.voiceSettings };
        if (safeSettings.apiKey) {
            safeSettings.apiKey = '*****';
        }

        res.json({
            success: true,
            message: 'V2 voice settings updated successfully',
            settings: safeSettings,
            version: '2.0'
        });

    } catch (error) {
        console.error('❌ Error updating V2 voice settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update voice settings',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/company/cleanup-hardcoded-voice
 * @desc    Emergency cleanup: Remove hardcoded voice ID from all companies
 * @access  Private (Admin only)
 */
router.post('/cleanup-hardcoded-voice', async (req, res) => {
    try {
        const HARDCODED_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';
        
        console.log('🧹 Starting emergency cleanup of hardcoded voice settings...');
        
        // Find companies with the hardcoded voice ID
        const companiesWithHardcodedVoice = await Company.find({
            'aiAgentLogic.voiceSettings.voiceId': HARDCODED_VOICE_ID
        });

        console.log(`🔍 Found ${companiesWithHardcodedVoice.length} companies with hardcoded voice ID`);

        if (companiesWithHardcodedVoice.length === 0) {
            return res.json({
                success: true,
                message: 'No companies found with hardcoded voice ID - cleanup not needed',
                companiesUpdated: 0
            });
        }

        // Reset voice settings to clean defaults
        const updateResult = await Company.updateMany(
            { 'aiAgentLogic.voiceSettings.voiceId': HARDCODED_VOICE_ID },
            {
                $set: {
                    'aiAgentLogic.voiceSettings': {
                        apiSource: 'clientsvia',
                        apiKey: null,
                        voiceId: null, // Reset to null - must be configured in UI
                        stability: 0.5,
                        similarityBoost: 0.7,
                        styleExaggeration: 0.0,
                        speakerBoost: true,
                        aiModel: 'eleven_turbo_v2_5',
                        outputFormat: 'mp3_44100_128',
                        streamingLatency: 0,
                        enabled: true,
                        lastUpdated: new Date(),
                        version: '2.0'
                    }
                }
            }
        );

        // Clear Redis cache for all affected companies
        if (redisClient) {
            for (const company of companiesWithHardcodedVoice) {
                const cacheKeys = [
                    `company:${company._id}`,
                    `voice:company:${company._id}`,
                    `ai-agent:${company._id}`
                ];
                
                if (company.twilioConfig?.phoneNumber) {
                    cacheKeys.push(`company-phone:${company.twilioConfig.phoneNumber}`);
                }
                
                await Promise.all(cacheKeys.map(key => redisClient.del(key)));
                console.log(`🗑️ Cache cleared for company ${company._id}: ${cacheKeys.join(', ')}`);
            }
        }

        console.log(`✅ Updated ${updateResult.modifiedCount} companies`);

        res.json({
            success: true,
            message: 'Hardcoded voice settings cleaned up successfully',
            companiesUpdated: updateResult.modifiedCount,
            affectedCompanies: companiesWithHardcodedVoice.map(c => ({
                id: c._id,
                name: c.companyName
            }))
        });

    } catch (error) {
        console.error('❌ Emergency cleanup failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cleanup hardcoded voice settings',
            error: error.message
        });
    }
});

module.exports = router;
