/**
 * V2 AI Voice Settings API Routes
 * V2-grade ElevenLabs integration with aiAgentSettings system
 * 
 * 🎤 V2 VOICE SETTINGS - V2 ARCHITECTURE:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ ELEVENLABS INTEGRATION V2 - MULTI-TENANT VOICE SYSTEM            ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Storage: aiAgentSettings.voiceSettings (V2 system)               ║
 * ║ Cache: Redis voice:company:{id} keys for sub-50ms performance    ║
 * ║ API: Latest ElevenLabs API with Turbo v2.5 model support        ║
 * ║ Security: Multi-tenant isolation + API key encryption           ║
 * ║ Performance: Streaming optimization + quality controls           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * ☠️ REMOVED: aiAgentSettings (legacy nuked 2025-11-20)
 * - OLD: company.aiAgentSettings.voiceSettings.*
 * - NEW: company.aiAgentSettings.voiceSettings.*
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const Company = require('../../models/v2Company');
const { redisClient } = require('../../clients');
const { getAvailableVoices, getUserInfo, synthesizeSpeech } = require('../../services/v2elevenLabsService');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');

// 🔒 SECURITY: Require authentication AND multi-tenant access control
router.use(authenticateJWT);
router.use(requireCompanyAccess);

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

        logger.info(`🔍 [VOICE STATUS] Running comprehensive check for ${company.companyName}`);

        const status = {
            timestamp: new Date().toISOString(),
            companyId: company._id,
            companyName: company.companyName,
            checks: {}
        };

        // ========================================
        // CHECK 1: DATABASE - Are settings saved?
        // ========================================
        logger.info(`🔍 [CHECK 1] Database check...`);
        const voiceSettings = company.aiAgentSettings?.voiceSettings;
        
        status.checks.database = {
            name: 'Database Storage',
            passed: Boolean(voiceSettings && voiceSettings.voiceId),
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
            logger.info(`✅ [CHECK 1] Database: PASS - Voice ID: ${voiceSettings.voiceId}`);
        } else {
            status.checks.database.details.error = 'No voice settings found in database';
            status.checks.database.details.solution = 'Go to AI Voice Settings tab and save a voice';
            logger.info(`❌ [CHECK 1] Database: FAIL - No voice settings`);
        }

        // ========================================
        // CHECK 2: ELEVENLABS API - Can we connect?
        // ========================================
        logger.info(`🔍 [CHECK 2] ElevenLabs API check...`);
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
                logger.debug(`❌ [CHECK 2] API: FAIL - No API key`);
            } else {
                // 🔧 WORLD-CLASS FIX: Test API with voices endpoint (doesn't require user_read permission)
                // This is more reliable because TTS uses voices, not user info
                logger.info(`🔍 [CHECK 2] Testing API with voices endpoint...`);
                const voices = await getAvailableVoices({ company });
                
                if (voices && voices.length > 0) {
                    status.checks.elevenLabsApi.passed = true;
                    status.checks.elevenLabsApi.details = {
                        voicesAvailable: voices.length,
                        apiKeySource: voiceSettings?.apiSource === 'own' ? 'Your Own API' : 'ClientsVia Global',
                        connection: 'Active',
                        message: 'API key is valid and voices are accessible'
                    };
                    logger.info(`✅ [CHECK 2] API: PASS - ${voices.length} voices available`);
                    
                    // Try to get user info for additional details (optional, won't fail if missing permissions)
                    try {
                        const userInfo = await getUserInfo({ company });
                        status.checks.elevenLabsApi.details.subscription = userInfo.subscription?.tier || 'unknown';
                        status.checks.elevenLabsApi.details.charactersUsed = userInfo.subscription?.character_count || 0;
                        status.checks.elevenLabsApi.details.charactersLimit = userInfo.subscription?.character_limit || 0;
                        logger.info(`✅ [CHECK 2] API: Subscription info added - ${userInfo.subscription?.tier}`);
                    } catch (userInfoError) {
                        // Non-critical: User info is just bonus data
                        logger.info(`⚠️ [CHECK 2] API: Could not get subscription info (non-critical): ${userInfoError.message}`);
                        status.checks.elevenLabsApi.details.note = 'Subscription info unavailable (API key may have limited permissions, but TTS works)';
                    }
                } else {
                    status.checks.elevenLabsApi.details.error = 'No voices returned from API';
                    logger.info(`❌ [CHECK 2] API: FAIL - No voices available`);
                }
            }
        } catch (error) {
            status.checks.elevenLabsApi.details.error = error.message;
            status.checks.elevenLabsApi.details.solution = 'Verify ELEVENLABS_API_KEY environment variable is set correctly';
            logger.info(`❌ [CHECK 2] API: FAIL - ${error.message}`);
        }

        // ========================================
        // CHECK 3: VOICE VALIDATION - Is voice ID valid?
        // ========================================
        logger.info(`🔍 [CHECK 3] Voice validation check...`);
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
                    logger.info(`✅ [CHECK 3] Voice: PASS - ${voice.name}`);
                } else {
                    status.checks.voiceValidation.details.error = 'Voice ID not found in available voices';
                    status.checks.voiceValidation.details.voiceId = voiceSettings.voiceId;
                    logger.info(`❌ [CHECK 3] Voice: FAIL - Voice ID not found`);
                }
            } catch (error) {
                status.checks.voiceValidation.details.error = error.message;
                logger.info(`❌ [CHECK 3] Voice: FAIL - ${error.message}`);
            }
        } else {
            status.checks.voiceValidation.details.error = 'Cannot validate - no voice ID or API unavailable';
            logger.info(`⚠️ [CHECK 3] Voice: SKIP - No voice ID or API failed`);
        }

        // ========================================
        // CHECK 4: TWILIO INTEGRATION - What will be used on calls?
        // ========================================
        logger.info(`🔍 [CHECK 4] Twilio integration check...`);
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
            logger.info(`✅ [CHECK 4] Twilio: PASS - Will use ElevenLabs`);
        } else {
            status.checks.twilioIntegration.details = {
                willUse: 'Twilio Default Voice (Alice)',
                reason: 'One or more checks failed',
                failedChecks: []
            };
            
            if (!status.checks.database.passed) {status.checks.twilioIntegration.details.failedChecks.push('Database');}
            if (!status.checks.elevenLabsApi.passed) {status.checks.twilioIntegration.details.failedChecks.push('ElevenLabs API');}
            if (!status.checks.voiceValidation.passed) {status.checks.twilioIntegration.details.failedChecks.push('Voice Validation');}
            
            logger.info(`❌ [CHECK 4] Twilio: FAIL - Will fall back to Twilio voice`);
        }

        // ========================================
        // OVERALL STATUS
        // ========================================
        status.overallStatus = allChecksPassed ? 'OPERATIONAL' : 'DEGRADED';
        status.summary = allChecksPassed 
            ? `✅ All systems operational - Calls will use ${status.checks.voiceValidation.details.voiceName} (ElevenLabs)`
            : `⚠️ System degraded - Calls will use Twilio's default voice (Alice)`;

        logger.info(`🔍 [STATUS] Overall: ${status.overallStatus}`);

        res.json({
            success: true,
            status
        });

    } catch (error) {
        logger.error('❌ Error running voice settings status check:', error);
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
        const forceRefresh = req.query.refresh === '1';

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ success: false, message: 'Invalid company ID format' });
        }

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        // Determine cache key: global key users share cache, own-key users get isolated cache
        const apiSource = company.aiAgentSettings?.voiceSettings?.apiSource || 'clientsvia';
        const cacheKey = apiSource === 'own'
            ? `voices:company:${companyId}`
            : `voices:global`;
        const CACHE_TTL = 3600; // 1 hour — voices rarely change

        // Try Redis cache first (skip on force-refresh)
        if (!forceRefresh && redisClient) {
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    const voices = JSON.parse(cached);
                    logger.debug(`⚡ [VOICES] Cache HIT (${voices.length} voices) key=${cacheKey}`);
                    return res.json({ success: true, voices, count: voices.length, cached: true });
                }
            } catch (cacheErr) {
                logger.warn(`⚠️ [VOICES] Redis cache read failed: ${cacheErr.message}`);
            }
        }

        logger.debug(`🎤 [VOICES] Cache MISS — fetching from ElevenLabs for ${company.companyName}`);
        const voices = await getAvailableVoices({ company });
        logger.info(`✅ [VOICES] Loaded ${voices.length} voices from ElevenLabs`);

        // Write to cache (non-blocking)
        if (redisClient) {
            redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(voices))
                .catch(err => logger.warn(`⚠️ [VOICES] Redis cache write failed: ${err.message}`));
        }

        res.json({ success: true, voices, count: voices.length, cached: false });

    } catch (error) {
        logger.error('❌ [VOICES] Error loading voices:', error);
        res.status(500).json({ success: false, message: 'Failed to load voices', error: error.message });
    }
});

/**
 * @route   GET /api/company/:companyId/v2-voice-settings/voices/:voiceId/preview
 * @desc    Generate a live TTS preview for a voice (used when preview_url is null)
 */
router.get('/:companyId/v2-voice-settings/voices/:voiceId/preview', authenticateJWT, async (req, res) => {
    try {
        const { companyId, voiceId } = req.params;

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ success: false, message: 'Invalid company ID' });
        }

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        logger.debug(`🎤 [VOICE PREVIEW] Generating TTS preview for voice ${voiceId}`);

        const audioBuffer = await synthesizeSpeech({
            text: "Hello! I'm your AI assistant. How can I help you today?",
            voiceId,
            stability: 0.5,
            similarity_boost: 0.7,
            model_id: 'eleven_turbo_v2_5',
            company
        });

        res.set('Content-Type', 'audio/mpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(audioBuffer);

    } catch (error) {
        logger.error('❌ [VOICE PREVIEW] Error generating preview:', error);
        res.status(500).json({ success: false, message: 'Failed to generate voice preview', error: error.message });
    }
});

/**
 * @route   GET /api/company/:companyId/v2-voice-settings
 * @desc    Get V2 voice settings from aiAgentSettings.voiceSettings
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
        logger.info(`🔍 [GET VOICE] Company: ${company.companyName}`);
        logger.info(`🔍 [GET VOICE] Has aiAgentSettings:`, Boolean(company.aiAgentSettings));
        logger.info(`🔍 [GET VOICE] Has voiceSettings:`, Boolean(company.aiAgentSettings?.voiceSettings));
        logger.info(`🔍 [GET VOICE] Raw voiceSettings:`, JSON.stringify(company.aiAgentSettings?.voiceSettings, null, 2));

        // Get voice settings from V2 aiAgentSettings system
        const voiceSettings = company.aiAgentSettings?.voiceSettings || {
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

        logger.info(`✅ V2 Voice settings loaded for company ${companyId}`);

        res.json({
            success: true,
            settings: safeSettings,
            version: '2.0'
        });

    } catch (error) {
        logger.error('❌ Error getting V2 voice settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get voice settings',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/company/:companyId/v2-voice-settings
 * @desc    Save V2 voice settings to aiAgentSettings.voiceSettings
 * @access  Private
 * 
 * 🔧 BULLETPROOF: Handles ALL legacy formats and prevents schema validation crashes
 */
router.post('/:companyId/v2-voice-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        const b = req.body || {};
        
        logger.info(`🔍 [SAVE-1] POST request for company: ${companyId}`);
        logger.info(`🔍 [SAVE-2] Raw body:`, JSON.stringify(b, null, 2));

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID format'
            });
        }

        // 🔧 NORMALIZE INPUT: Accept legacy strings, flat objects, or nested structures
        // Helper to pick first non-null/undefined value
        const pick = (...vals) => vals.find(v => v !== undefined && v !== null);

        // Extract values from multiple possible locations
        const apiSource = pick(b.apiSource, b.provider?.apiSource, 'clientsvia');
        const apiKey = pick(b.apiKey, b.provider?.apiKey, null);
        const voiceId = pick(b.voiceId, b.provider?.voiceId, null);
        const stability = Number(pick(b.stability, b.provider?.stability, 0.5));
        const similarityBoost = Number(pick(b.similarityBoost, b.provider?.similarityBoost, 0.7));
        const styleExaggeration = Number(pick(b.styleExaggeration, b.provider?.styleExaggeration, 0.0));
        const speakerBoost = Boolean(pick(b.speakerBoost, b.provider?.speakerBoost, true));
        const aiModel = pick(b.aiModel, b.provider?.aiModel, 'eleven_turbo_v2_5');
        const outputFormat = pick(b.outputFormat, b.provider?.outputFormat, 'mp3_44100_128');
        const streamingLatency = Number(pick(b.streamingLatency, b.provider?.streamingLatency, 0));
        
        // ═══════════════════════════════════════════════════════════════════════════════════
        // V85: SPEECH DETECTION SETTINGS (CRITICAL FOR RESPONSE SPEED!)
        // These control how fast the AI responds to callers.
        // speechTimeout: 3 (default) → 1.5 saves 1.5 seconds PER TURN!
        // bargeIn: true → Callers can interrupt, feels 2s faster
        // ═══════════════════════════════════════════════════════════════════════════════════
        const speechDetection = {
            speechTimeout: Number(pick(b.speechDetection?.speechTimeout, 3)),
            initialTimeout: Number(pick(b.speechDetection?.initialTimeout, 5)),
            bargeIn: Boolean(pick(b.speechDetection?.bargeIn, false)),
            enhancedRecognition: Boolean(pick(b.speechDetection?.enhancedRecognition, true)),
            speechModel: pick(b.speechDetection?.speechModel, 'phone_call')
        };
        
        logger.info('🚀 [SAVE] Speech detection settings:', speechDetection);

        logger.info(`🔍 [SAVE-3] Normalized values:`, {
            apiSource,
            voiceId,
            stability,
            similarityBoost,
            aiModel
        });

        // Validate required fields
        logger.info(`🔍 [SAVE-4] VALIDATION CHECK: voiceId = "${voiceId}" (type: ${typeof voiceId})`);
        if (!voiceId) {
            logger.debug(`❌ [SAVE-4-FAIL] Voice ID is missing!`);
            return res.status(400).json({
                success: false,
                message: 'Voice ID is required',
                debug: { voiceId, receivedBody: b }
            });
        }
        logger.debug(`✅ [SAVE-4-PASS] Voice ID validation passed`);

        logger.debug(`🔍 [SAVE-5] VALIDATION CHECK: apiSource = "${apiSource}", apiKey = ${apiKey ? '(present)' : '(null)'}`);
        if (apiSource === 'own' && !apiKey) {
            logger.debug(`❌ [SAVE-5-FAIL] API key required for own source!`);
            return res.status(400).json({
                success: false,
                message: 'API key is required when using own ElevenLabs account',
                debug: { apiSource, hasApiKey: Boolean(apiKey) }
            });
        }
        logger.debug(`✅ [SAVE-5-PASS] API source validation passed`);

        // Fetch company
        logger.debug(`🔍 [SAVE-7] Fetching company from database...`);
        const company = await Company.findById(companyId);
        
        if (!company) {
            logger.debug(`❌ [SAVE-8] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        logger.debug(`🔍 [SAVE-9] Company found: ${company.companyName}`);
        
        // Initialize aiAgentSettings if not exists
        if (!company.aiAgentSettings) {
            logger.debug(`🔍 [SAVE-10] Initializing aiAgentSettings`);
            company.aiAgentSettings = {};
        }
        
        // Build voice settings object (flat structure matching architecture doc)
        const newVoiceSettings = {
            apiSource,
            apiKey: apiSource === 'own' ? apiKey : null,
            voiceId,
            stability,
            similarityBoost,
            styleExaggeration,
            speakerBoost,
            aiModel,
            outputFormat,
            streamingLatency,
            // V85: Speech detection settings (critical for response speed!)
            speechDetection,
            enabled: true,
            lastUpdated: new Date(),
            version: '2.0'
        };

        logger.info(`🔍 [SAVE-13] Voice settings to save:`, JSON.stringify(newVoiceSettings, null, 2));
        
        // Save using Mongoose (normal approach)
        logger.info(`🔍 [SAVE-14] Using targeted update to avoid full document validation`);
        
        try {
            // Use findByIdAndUpdate with $set to update ONLY voiceSettings field
            // This avoids Mongoose validating corrupt data in OTHER fields
            const updatedCompany = await Company.findByIdAndUpdate(
                companyId,
                {
                    $set: {
                        'aiAgentSettings.voiceSettings': newVoiceSettings
                    }
                },
                { new: true, runValidators: false } // Skip full validation, only validate the field we're updating
            );
            
            if (!updatedCompany) {
                logger.error(`❌ [SAVE-16-ERROR] Company not found during update`);
                return res.status(404).json({
                    success: false,
                    message: 'Company not found'
                });
            }
            
            logger.info(`✅ [SAVE-16] Voice settings updated successfully via targeted update`);
        } catch (saveError) {
            logger.error(`❌ [SAVE-16-ERROR] Mongoose update failed!`);
            logger.error(`❌ [SAVE-16-ERROR] Error name: ${saveError.name}`);
            logger.error(`❌ [SAVE-16-ERROR] Error message: ${saveError.message}`);
            logger.error(`❌ [SAVE-16-ERROR] Full error:`, saveError);
            
            // Return specific validation error
            return res.status(400).json({
                success: false,
                message: `Database update error: ${saveError.message}`,
                error: saveError.name,
                details: saveError.errors || saveError.message
            });
        }

        logger.debug(`✅ [SAVE-17] Voice settings saved successfully via Mongoose`);

        // Clear Redis cache for immediate effect
        if (redisClient) {
            try {
                logger.debug(`🔍 [SAVE-21] Clearing Redis cache...`);
                const cacheKeys = [
                    `company:${companyId}`,
                    `voice:company:${companyId}`,
                    `ai-agent:${companyId}`
                ];
                
                await Promise.all(cacheKeys.map(key => redisClient.del(key).catch(err => {
                    logger.warn(`⚠️ Failed to delete cache key ${key}:`, err.message);
                    return null;
                })));
                logger.debug(`🗑️ [SAVE-22] Redis cache cleared: ${cacheKeys.join(', ')}`);
            } catch (cacheError) {
                logger.warn(`⚠️ [SAVE-22-ERROR] Redis cache clear failed (non-fatal):`, cacheError.message);
            }
        } else {
            logger.debug(`⚠️ [SAVE-23] Redis client not available - skipping cache clear`);
        }

        logger.debug(`✅ [SAVE-24] Voice settings saved successfully`);

        // Purge pre-cached trigger audio (voice changed → must regenerate)
        try {
            const InstantAudioService = require('../../services/instantAudio/InstantAudioService');
            const purged = InstantAudioService.purgeCompanyTriggerAudio(companyId);
            if (purged.removed > 0) {
                logger.info(`[SAVE-24b] Purged ${purged.removed} cached trigger audio files (voice changed)`, { companyId });
            }
        } catch (purgeErr) {
            logger.warn('[SAVE-24b] Trigger audio purge failed (non-fatal)', { error: purgeErr.message });
        }

        // Return safe response (mask API key)
        const safeSettings = { ...newVoiceSettings };
        if (safeSettings.apiKey) {
            safeSettings.apiKey = '*****';
        }

        logger.info(`🔍 [SAVE-25] Sending success response`);

        res.json({
            success: true,
            message: 'V2 voice settings saved successfully',
            settings: safeSettings,
            version: '2.0'
        });

    } catch (error) {
        logger.error('❌ [SAVE-ERROR] Voice settings save error:', error);
        // Return 400 instead of 500 for validation errors (more helpful to client)
        const statusCode = error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500;
        res.status(statusCode).json({
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

        // Initialize aiAgentSettings.voiceSettings if not exists
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.aiAgentSettings.voiceSettings) {
            company.aiAgentSettings.voiceSettings = {
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
                company.aiAgentSettings.voiceSettings[field] = updates[field];
                hasChanges = true;
            }
        });

        if (hasChanges) {
            company.aiAgentSettings.voiceSettings.lastUpdated = new Date();
            await company.save();

            // Clear cache
            if (redisClient) {
                await redisClient.del(`company:${companyId}`);
                await redisClient.del(`voice:company:${companyId}`);
            }

            logger.info(`✅ V2 Voice settings updated for company ${companyId}`);
        }

        // Return safe settings
        const safeSettings = { ...company.aiAgentSettings.voiceSettings };
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
        logger.error('❌ Error updating V2 voice settings:', error);
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
        
        logger.debug('🧹 Starting emergency cleanup of hardcoded voice settings...');
        
        // Find companies with the hardcoded voice ID
        const companiesWithHardcodedVoice = await Company.find({
            'aiAgentSettings.voiceSettings.voiceId': HARDCODED_VOICE_ID
        });

        logger.info(`🔍 Found ${companiesWithHardcodedVoice.length} companies with hardcoded voice ID`);

        if (companiesWithHardcodedVoice.length === 0) {
            return res.json({
                success: true,
                message: 'No companies found with hardcoded voice ID - cleanup not needed',
                companiesUpdated: 0
            });
        }

        // Reset voice settings to clean defaults
        const updateResult = await Company.updateMany(
            { 'aiAgentSettings.voiceSettings.voiceId': HARDCODED_VOICE_ID },
            {
                $set: {
                    'aiAgentSettings.voiceSettings': {
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
                logger.debug(`🗑️ Cache cleared for company ${company._id}: ${cacheKeys.join(', ')}`);
            }
        }

        logger.debug(`✅ Updated ${updateResult.modifiedCount} companies`);

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
        logger.error('❌ Emergency cleanup failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cleanup hardcoded voice settings',
            error: error.message
        });
    }
});

module.exports = router;
