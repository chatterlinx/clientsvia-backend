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
const { getAvailableVoices, getUserInfo } = require('../../services/v2elevenLabsService');

/**
 * @route   GET /api/company/:companyId/v2-voice-settings/status
 * @desc    COMPREHENSIVE SYSTEM CHECK - Database + ElevenLabs API + Twilio Integration
 * @access  Private
 */
router.get('/:companyId/v2-voice-settings/status', async (req, res) => {
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

        console.log(`🔍 [VOICE STATUS] Running comprehensive check for ${company.companyName}`);

        const status = {
            timestamp: new Date().toISOString(),
            companyId: company._id,
            companyName: company.companyName,
            checks: {}
        };

        // ========================================
        // CHECK 1: DATABASE - Are settings saved?
        // ========================================
        console.log(`🔍 [CHECK 1] Database check...`);
        const voiceSettings = company.aiAgentLogic?.voiceSettings;
        
        status.checks.database = {
            name: 'Database Storage',
            passed: !!(voiceSettings && voiceSettings.voiceId),
            details: {}
        };

        if (voiceSettings && voiceSettings.voiceId) {
            status.checks.database.details = {
                voiceId: voiceSettings.voiceId,
                apiSource: voiceSettings.apiSource,
                aiModel: voiceSettings.aiModel,
                stability: voiceSettings.stability,
                similarityBoost: voiceSettings.similarityBoost,
                lastUpdated: voiceSettings.lastUpdated
            };
            console.log(`✅ [CHECK 1] Database: PASS - Voice ID: ${voiceSettings.voiceId}`);
        } else {
            status.checks.database.details.error = 'No voice settings found in database';
            status.checks.database.details.solution = 'Go to AI Voice Settings tab and save a voice';
            console.log(`❌ [CHECK 1] Database: FAIL - No voice settings`);
        }

        // ========================================
        // CHECK 2: ELEVENLABS API - Can we connect?
        // ========================================
        console.log(`🔍 [CHECK 2] ElevenLabs API check...`);
        status.checks.elevenLabsApi = {
            name: 'ElevenLabs API Connection',
            passed: false,
            details: {}
        };

        try {
            const apiKey = voiceSettings?.apiSource === 'own' 
                ? voiceSettings?.apiKey 
                : process.env.ELEVENLABS_API_KEY;

            if (!apiKey) {
                status.checks.elevenLabsApi.details.error = 'No API key available';
                status.checks.elevenLabsApi.details.apiSource = voiceSettings?.apiSource || 'not configured';
                console.log(`❌ [CHECK 2] API: FAIL - No API key`);
            } else {
                // 🔧 WORLD-CLASS FIX: Test API with voices endpoint (doesn't require user_read permission)
                // This is more reliable because TTS uses voices, not user info
                console.log(`🔍 [CHECK 2] Testing API with voices endpoint...`);
                const voices = await getAvailableVoices({ company });
                
                if (voices && voices.length > 0) {
                    status.checks.elevenLabsApi.passed = true;
                    status.checks.elevenLabsApi.details = {
                        voicesAvailable: voices.length,
                        apiKeySource: voiceSettings?.apiSource === 'own' ? 'Your Own API' : 'ClientsVia Global',
                        connection: 'Active',
                        message: 'API key is valid and voices are accessible'
                    };
                    console.log(`✅ [CHECK 2] API: PASS - ${voices.length} voices available`);
                    
                    // Try to get user info for additional details (optional, won't fail if missing permissions)
                    try {
                        const userInfo = await getUserInfo({ company });
                        status.checks.elevenLabsApi.details.subscription = userInfo.subscription?.tier || 'unknown';
                        status.checks.elevenLabsApi.details.charactersUsed = userInfo.subscription?.character_count || 0;
                        status.checks.elevenLabsApi.details.charactersLimit = userInfo.subscription?.character_limit || 0;
                        console.log(`✅ [CHECK 2] API: Subscription info added - ${userInfo.subscription?.tier}`);
                    } catch (userInfoError) {
                        // Non-critical: User info is just bonus data
                        console.log(`⚠️ [CHECK 2] API: Could not get subscription info (non-critical): ${userInfoError.message}`);
                        status.checks.elevenLabsApi.details.note = 'Subscription info unavailable (API key may have limited permissions, but TTS works)';
                    }
                } else {
                    status.checks.elevenLabsApi.details.error = 'No voices returned from API';
                    console.log(`❌ [CHECK 2] API: FAIL - No voices available`);
                }
            }
        } catch (error) {
            status.checks.elevenLabsApi.details.error = error.message;
            status.checks.elevenLabsApi.details.solution = 'Verify ELEVENLABS_API_KEY environment variable is set correctly';
            console.log(`❌ [CHECK 2] API: FAIL - ${error.message}`);
        }

        // ========================================
        // CHECK 3: VOICE VALIDATION - Is voice ID valid?
        // ========================================
        console.log(`🔍 [CHECK 3] Voice validation check...`);
        status.checks.voiceValidation = {
            name: 'Voice ID Validation',
            passed: false,
            details: {}
        };

        if (voiceSettings && voiceSettings.voiceId && status.checks.elevenLabsApi.passed) {
            try {
                const voices = await getAvailableVoices({ company });
                const voice = voices.find(v => v.voice_id === voiceSettings.voiceId);
                
                if (voice) {
                    status.checks.voiceValidation.passed = true;
                    status.checks.voiceValidation.details = {
                        voiceId: voice.voice_id,
                        voiceName: voice.name,
                        gender: voice.labels?.gender || 'unknown',
                        category: voice.labels?.category || 'general',
                        previewUrl: voice.preview_url
                    };
                    console.log(`✅ [CHECK 3] Voice: PASS - ${voice.name}`);
                } else {
                    status.checks.voiceValidation.details.error = 'Voice ID not found in available voices';
                    status.checks.voiceValidation.details.voiceId = voiceSettings.voiceId;
                    console.log(`❌ [CHECK 3] Voice: FAIL - Voice ID not found`);
                }
            } catch (error) {
                status.checks.voiceValidation.details.error = error.message;
                console.log(`❌ [CHECK 3] Voice: FAIL - ${error.message}`);
            }
        } else {
            status.checks.voiceValidation.details.error = 'Cannot validate - no voice ID or API unavailable';
            console.log(`⚠️ [CHECK 3] Voice: SKIP - No voice ID or API failed`);
        }

        // ========================================
        // CHECK 4: TWILIO INTEGRATION - What will be used on calls?
        // ========================================
        console.log(`🔍 [CHECK 4] Twilio integration check...`);
        status.checks.twilioIntegration = {
            name: 'Twilio Call Integration',
            passed: false,
            details: {}
        };

        const allChecksPassed = status.checks.database.passed && 
                               status.checks.elevenLabsApi.passed && 
                               status.checks.voiceValidation.passed;

        if (allChecksPassed) {
            status.checks.twilioIntegration.passed = true;
            status.checks.twilioIntegration.details = {
                willUse: 'ElevenLabs',
                voiceName: status.checks.voiceValidation.details.voiceName,
                voiceId: status.checks.voiceValidation.details.voiceId,
                apiSource: status.checks.elevenLabsApi.details.apiKeySource,
                model: voiceSettings.aiModel,
                quality: `Stability: ${voiceSettings.stability}, Similarity: ${voiceSettings.similarityBoost}`
            };
            console.log(`✅ [CHECK 4] Twilio: PASS - Will use ElevenLabs`);
        } else {
            status.checks.twilioIntegration.details = {
                willUse: 'Twilio Default Voice (Alice)',
                reason: 'One or more checks failed',
                failedChecks: []
            };
            
            if (!status.checks.database.passed) status.checks.twilioIntegration.details.failedChecks.push('Database');
            if (!status.checks.elevenLabsApi.passed) status.checks.twilioIntegration.details.failedChecks.push('ElevenLabs API');
            if (!status.checks.voiceValidation.passed) status.checks.twilioIntegration.details.failedChecks.push('Voice Validation');
            
            console.log(`❌ [CHECK 4] Twilio: FAIL - Will fall back to Twilio voice`);
        }

        // ========================================
        // OVERALL STATUS
        // ========================================
        status.overallStatus = allChecksPassed ? 'OPERATIONAL' : 'DEGRADED';
        status.summary = allChecksPassed 
            ? `✅ All systems operational - Calls will use ${status.checks.voiceValidation.details.voiceName} (ElevenLabs)`
            : `⚠️ System degraded - Calls will use Twilio's default voice (Alice)`;

        console.log(`🔍 [STATUS] Overall: ${status.overallStatus}`);

        res.json({
            success: true,
            status
        });

    } catch (error) {
        console.error('❌ Error running voice settings status check:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to run status check',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/company/:companyId/v2-voice-settings/voices
 * @desc    Get available ElevenLabs voices
 * @access  Private
 */
router.get('/:companyId/v2-voice-settings/voices', async (req, res) => {
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

        console.log(`🎤 [VOICES] Loading ElevenLabs voices for ${company.companyName}`);

        // Get voices from ElevenLabs API
        // Uses company's own API key if configured, otherwise uses global ClientsVia key
        const voices = await getAvailableVoices({ company });

        console.log(`✅ [VOICES] Loaded ${voices.length} voices`);

        res.json({
            success: true,
            voices: voices,
            count: voices.length
        });

    } catch (error) {
        console.error('❌ [VOICES] Error loading voices:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load voices',
            error: error.message
        });
    }
});

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
        
        console.log(`🔍 [SAVE-1] POST request received for company: ${companyId}`);
        console.log(`🔍 [SAVE-2] Request body:`, JSON.stringify(req.body, null, 2));
        
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

        console.log(`🔍 [SAVE-3] Parsed values:`, {
            apiSource,
            voiceId,
            stability,
            similarityBoost,
            aiModel
        });

        if (!ObjectId.isValid(companyId)) {
            console.log(`❌ [SAVE-4] Invalid company ID format: ${companyId}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID format'
            });
        }

        // Validate required fields
        if (!voiceId) {
            console.log(`❌ [SAVE-5] Voice ID missing`);
            return res.status(400).json({
                success: false,
                message: 'Voice ID is required'
            });
        }

        if (apiSource === 'own' && !apiKey) {
            console.log(`❌ [SAVE-6] API key required for own API source`);
            return res.status(400).json({
                success: false,
                message: 'API key is required when using own ElevenLabs account'
            });
        }

        console.log(`🔍 [SAVE-7] Fetching company from database...`);
        const company = await Company.findById(companyId);
        
        if (!company) {
            console.log(`❌ [SAVE-8] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        console.log(`🔍 [SAVE-9] Company found: ${company.companyName}`);
        console.log(`🔍 [SAVE-10] Existing aiAgentLogic:`, !!company.aiAgentLogic);
        console.log(`🔍 [SAVE-11] Existing voiceSettings:`, JSON.stringify(company.aiAgentLogic?.voiceSettings, null, 2));

        // Initialize aiAgentLogic if not exists
        if (!company.aiAgentLogic) {
            console.log(`🔍 [SAVE-12] Initializing new aiAgentLogic object`);
            company.aiAgentLogic = {};
        }
        
        // 🔧 ROBUST MIGRATION FIX: Handle ALL possible voiceSettings corruption scenarios
        const voiceSettingsType = typeof company.aiAgentLogic.voiceSettings;
        const isValidObject = company.aiAgentLogic.voiceSettings 
            && voiceSettingsType === 'object' 
            && !Array.isArray(company.aiAgentLogic.voiceSettings);
        
        if (!isValidObject) {
            console.log(`🔧 [SAVE-12A] MIGRATION: voiceSettings is invalid (type: ${voiceSettingsType}, array: ${Array.isArray(company.aiAgentLogic.voiceSettings)})`);
            console.log(`🔧 [SAVE-12A] MIGRATION: Current value:`, company.aiAgentLogic.voiceSettings);
            
            // Force clear the entire aiAgentLogic and recreate it to avoid schema validation issues
            console.log(`🔧 [SAVE-12A] MIGRATION: Clearing aiAgentLogic and rebuilding...`);
            const oldAiAgentLogic = company.aiAgentLogic;
            
            // Mark the entire aiAgentLogic as modified to force Mongoose to recalculate
            company.markModified('aiAgentLogic');
            
            // Set voiceSettings to undefined first to clear any invalid data
            company.aiAgentLogic.voiceSettings = undefined;
            company.markModified('aiAgentLogic.voiceSettings');
            
            // Now set it to an empty object
            company.aiAgentLogic.voiceSettings = {};
            company.markModified('aiAgentLogic.voiceSettings');
            
            console.log(`🔧 [SAVE-12A] MIGRATION: voiceSettings reset to empty object`);
        } else {
            console.log(`✅ [SAVE-12B] voiceSettings is already a valid object`);
        }

        // V2 Voice Settings Structure
        const newVoiceSettings = {
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

        console.log(`🔍 [SAVE-13] New voice settings to save:`, JSON.stringify(newVoiceSettings, null, 2));
        
        company.aiAgentLogic.voiceSettings = newVoiceSettings;
        
        // 🔧 CRITICAL: Explicitly mark as modified to ensure Mongoose saves nested changes
        company.markModified('aiAgentLogic');
        company.markModified('aiAgentLogic.voiceSettings');

        console.log(`🔍 [SAVE-14] Voice settings assigned to company object (and marked modified)`);
        console.log(`🔍 [SAVE-15] company.aiAgentLogic.voiceSettings is now:`, JSON.stringify(company.aiAgentLogic.voiceSettings, null, 2));

        // Save to database
        console.log(`🔍 [SAVE-16] Calling company.save()...`);
        let saveResult;
        try {
            saveResult = await company.save();
            console.log(`🔍 [SAVE-17] Save completed successfully`);
            console.log(`🔍 [SAVE-18] Saved document _id:`, saveResult._id);
        } catch (saveError) {
            console.error(`❌ [SAVE-17-ERROR] Failed to save company:`, saveError.message);
            console.error(`❌ [SAVE-17-ERROR] Error name:`, saveError.name);
            console.error(`❌ [SAVE-17-ERROR] Stack:`, saveError.stack);
            throw saveError; // Re-throw to be caught by outer catch
        }

        // Verify save by reloading from DB
        console.log(`🔍 [SAVE-19] Verifying save by reloading from database...`);
        let verifyCompany;
        try {
            verifyCompany = await Company.findById(companyId);
            console.log(`🔍 [SAVE-20] Verification - voiceSettings from DB:`, JSON.stringify(verifyCompany.aiAgentLogic?.voiceSettings, null, 2));
        } catch (verifyError) {
            console.error(`❌ [SAVE-20-ERROR] Failed to verify save:`, verifyError.message);
            console.error(`❌ [SAVE-20-ERROR] Stack:`, verifyError.stack);
            // Don't throw - verification failure isn't critical if save succeeded
        }

        // Clear Redis cache for immediate effect
        if (redisClient) {
            try {
                console.log(`🔍 [SAVE-21] Clearing Redis cache...`);
                const cacheKeys = [
                    `company:${companyId}`,
                    `voice:company:${companyId}`,
                    `ai-agent:${companyId}`
                ];
                
                // Also clear phone-based cache for Twilio integration
                if (company.twilioConfig?.phoneNumber) {
                    cacheKeys.push(`company-phone:${company.twilioConfig.phoneNumber}`);
                }
                
                await Promise.all(cacheKeys.map(key => redisClient.del(key).catch(err => {
                    console.warn(`⚠️ Failed to delete cache key ${key}:`, err.message);
                    return null; // Continue even if one fails
                })));
                console.log(`🗑️ [SAVE-22] V2 Voice cache cleared for company ${companyId}: ${cacheKeys.join(', ')}`);
            } catch (cacheError) {
                console.warn(`⚠️ [SAVE-22-ERROR] Redis cache clear failed (non-fatal):`, cacheError.message);
                // Continue anyway - cache clear failure shouldn't block save
            }
        } else {
            console.log(`⚠️ [SAVE-23] Redis client not available - skipping cache clear`);
        }

        console.log(`✅ [SAVE-24] V2 Voice settings saved for company ${companyId}:`, {
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

        console.log(`🔍 [SAVE-25] Sending success response to client`);

        res.json({
            success: true,
            message: 'V2 voice settings saved successfully',
            settings: safeSettings,
            version: '2.0'
        });

    } catch (error) {
        console.error('❌ [SAVE-ERROR] Error saving V2 voice settings:', error);
        console.error('❌ [SAVE-ERROR] Stack trace:', error.stack);
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
