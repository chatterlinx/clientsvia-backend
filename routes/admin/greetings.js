/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🎙️ GREETINGS API - Agent 2.0 Greeting Management
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * ────────────────────────────────────────────────────────────────────────────
 * Comprehensive API for managing Agent 2.0 greeting system.
 * Handles both Call Start Greeting (outbound) and Greeting Interceptor (inbound).
 * 
 * FEATURES:
 * ────────────────────────────────────────────────────────────────────────────
 * ✓ Call Start Greeting: Configure initial greeting when call connects
 * ✓ Greeting Interceptor: Respond to short caller greetings ("hi", "hello")
 * ✓ Short-Only Gate: Prevent hijacking real intent with word count limits
 * ✓ Intent Word Blocking: Skip greetings when caller has real business
 * ✓ Greeting Rules: Priority-based matching with audio support
 * ✓ Audio Generation: ElevenLabs integration for TTS audio
 * ✓ Seed from Global: Load platform-wide default greeting rules
 * 
 * ARCHITECTURE:
 * ────────────────────────────────────────────────────────────────────────────
 * - Database: v2Company.aiAgentSettings.agent2.greetings
 * - Audio Files: /public/audio/greetings/*
 * - Integration: Agent2DiscoveryRunner checks greetings BEFORE trigger cards
 * 
 * SECURITY:
 * ────────────────────────────────────────────────────────────────────────────
 * - JWT authentication required on all endpoints
 * - CONFIG_READ permission for GET endpoints
 * - CONFIG_WRITE permission for PUT/POST/DELETE endpoints
 * - Input validation and sanitization on all writes
 * 
 * API ENDPOINTS:
 * ────────────────────────────────────────────────────────────────────────────
 * GET    /:companyId/greetings                    → Get all greetings config
 * PUT    /:companyId/greetings/call-start         → Update call start greeting
 * POST   /:companyId/greetings/call-start/audio   → Generate call start audio
 * PUT    /:companyId/greetings/interceptor        → Update interceptor settings
 * GET    /:companyId/greetings/rules              → Get all greeting rules
 * POST   /:companyId/greetings/rules              → Create new greeting rule
 * PATCH  /:companyId/greetings/rules/:ruleId      → Update existing rule
 * DELETE /:companyId/greetings/rules/:ruleId      → Delete greeting rule
 * POST   /:companyId/greetings/rules/:ruleId/audio → Generate rule audio
 * POST   /:companyId/greetings/seed-global        → Load default greeting rules
 * 
 * DATABASE SCHEMA:
 * ────────────────────────────────────────────────────────────────────────────
 * v2Company.aiAgentSettings.agent2.greetings = {
 *   callStart: {
 *     enabled: Boolean,
 *     text: String (max 500 chars),
 *     audioUrl: String,
 *     audioTextHash: String,
 *     audioGeneratedAt: Date
 *   },
 *   interceptor: {
 *     enabled: Boolean,
 *     shortOnlyGate: {
 *       maxWords: Number (1-5),
 *       blockIfIntentWords: Boolean
 *     },
 *     intentWords: [String],
 *     rules: [{
 *       ruleId: String (unique),
 *       enabled: Boolean,
 *       priority: Number (1-1000),
 *       matchType: 'EXACT' | 'CONTAINS' | 'REGEX',
 *       triggers: [String],
 *       response: String (max 300 chars),
 *       audioUrl: String,
 *       audioTextHash: String,
 *       audioGeneratedAt: Date,
 *       createdAt: Date,
 *       updatedAt: Date
 *     }]
 *   }
 * }
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * @module routes/admin/greetings
 * @version 1.0.0
 * @date February 2026
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const v2Company = require('../../models/v2Company');
const logger = require('../../utils/logger');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// MODULE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MODULE_ID = 'GREETINGS_API';
const VERSION = 'v1.0.0';

// Audio configuration
const AUDIO_DIR = path.join(__dirname, '../../public/audio/greetings');
const AUDIO_URL_PREFIX = '/audio/greetings';

// Text hash algorithm (consistent with trigger audio)
const HASH_ALGORITHM = 'sha256';
const HASH_ENCODING = 'hex';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate text hash for audio invalidation detection
 * @param {string} text - Text to hash
 * @returns {string} - Hex-encoded hash
 */
function hashText(text) {
    if (!text) return null;
    return crypto
        .createHash(HASH_ALGORITHM)
        .update(text.trim().toLowerCase())
        .digest(HASH_ENCODING)
        .substring(0, 16);
}

/**
 * Ensure audio directory exists
 */
function ensureAudioDirectory() {
    if (!fs.existsSync(AUDIO_DIR)) {
        fs.mkdirSync(AUDIO_DIR, { recursive: true });
        logger.info(`[${MODULE_ID}] Created audio directory: ${AUDIO_DIR}`);
    }
}

/**
 * Validate rule ID format
 * @param {string} ruleId - Rule ID to validate
 * @returns {boolean} - True if valid
 */
function isValidRuleId(ruleId) {
    if (!ruleId || typeof ruleId !== 'string') return false;
    // Allow alphanumeric, hyphens, underscores (1-50 chars)
    return /^[a-zA-Z0-9_-]{1,50}$/.test(ruleId);
}

/**
 * Sanitize greeting rule data
 * @param {object} rule - Raw rule data from request
 * @returns {object} - Sanitized rule data
 */
function sanitizeRuleData(rule) {
    return {
        ruleId: String(rule.ruleId || '').trim(),
        enabled: Boolean(rule.enabled !== false),
        priority: Math.max(1, Math.min(1000, parseInt(rule.priority) || 50)),
        matchType: ['EXACT', 'CONTAINS', 'REGEX'].includes(rule.matchType) ? rule.matchType : 'EXACT',
        triggers: Array.isArray(rule.triggers) ? rule.triggers.map(t => String(t).trim()).filter(Boolean) : [],
        response: String(rule.response || '').trim().substring(0, 300),
        audioUrl: rule.audioUrl || null,
        audioTextHash: rule.audioTextHash || null,
        audioGeneratedAt: rule.audioGeneratedAt || null
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /:companyId/greetings
 * ═══════════════════════════════════════════════════════════════════════════
 * Get complete greetings configuration for a company
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   data: {
 *     callStart: { ... },
 *     interceptor: { ... }
 *   }
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.get(
    '/:companyId/greetings',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_READ),
    async (req, res) => {
        try {
            const { companyId } = req.params;
            
            logger.info(`[${MODULE_ID}] Fetching greetings config`, { companyId });
            
            const company = await v2Company.findById(companyId)
                .select('aiAgentSettings.agent2.greetings')
                .lean();
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            const greetings = company.aiAgentSettings?.agent2?.greetings || {
                callStart: {
                    enabled: true,
                    text: '',
                    audioUrl: null
                },
                interceptor: {
                    enabled: true,
                    shortOnlyGate: {
                        maxWords: 2,
                        blockIfIntentWords: true
                    },
                    intentWords: [
                        'repair', 'maintenance', 'tune-up', 'not cooling', 'no cool',
                        'no heat', 'leak', 'water', 'dripping', 'thermostat', 'blank',
                        'schedule', 'appointment', 'price', 'cost', 'how much',
                        'service call', 'diagnostic', 'emergency'
                    ],
                    rules: []
                }
            };
            
            res.json({
                success: true,
                data: greetings
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error fetching greetings:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch greetings configuration'
            });
        }
    }
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUT /:companyId/greetings/call-start
 * ═══════════════════════════════════════════════════════════════════════════
 * Update Call Start Greeting settings
 * 
 * REQUEST BODY:
 * {
 *   enabled: boolean,
 *   text: string (max 500 chars)
 * }
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   data: { ... updated call start settings }
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.put(
    '/:companyId/greetings/call-start',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_WRITE),
    async (req, res) => {
        try {
            const { companyId } = req.params;
            const { enabled, text } = req.body;
            
            logger.info(`[${MODULE_ID}] Updating call start greeting`, { companyId });
            
            // Validation
            if (typeof enabled !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    error: 'enabled must be a boolean'
                });
            }
            
            if (text && text.length > 500) {
                return res.status(400).json({
                    success: false,
                    error: 'Text cannot exceed 500 characters'
                });
            }
            
            const company = await v2Company.findById(companyId);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            // Initialize greetings structure if not exists
            if (!company.aiAgentSettings) company.aiAgentSettings = {};
            if (!company.aiAgentSettings.agent2) company.aiAgentSettings.agent2 = {};
            if (!company.aiAgentSettings.agent2.greetings) company.aiAgentSettings.agent2.greetings = {};
            if (!company.aiAgentSettings.agent2.greetings.callStart) company.aiAgentSettings.agent2.greetings.callStart = {};
            
            const currentText = company.aiAgentSettings.agent2.greetings.callStart.text || '';
            const currentHash = company.aiAgentSettings.agent2.greetings.callStart.audioTextHash;
            const newText = (text || '').trim();
            const newHash = hashText(newText);
            
            // Detect if text changed (invalidate audio)
            const textChanged = currentText !== newText;
            const audioInvalidated = textChanged && currentHash && newHash !== currentHash;
            
            // Update call start greeting
            company.aiAgentSettings.agent2.greetings.callStart.enabled = enabled;
            company.aiAgentSettings.agent2.greetings.callStart.text = newText;
            
            if (audioInvalidated) {
                // Clear audio if text changed
                company.aiAgentSettings.agent2.greetings.callStart.audioUrl = null;
                company.aiAgentSettings.agent2.greetings.callStart.audioTextHash = null;
                company.aiAgentSettings.agent2.greetings.callStart.audioGeneratedAt = null;
                
                logger.info(`[${MODULE_ID}] Audio invalidated for call start greeting`, { companyId });
            }
            
            company.markModified('aiAgentSettings');
            await company.save();
            
            logger.info(`[${MODULE_ID}] Call start greeting updated successfully`, {
                companyId,
                audioInvalidated
            });
            
            res.json({
                success: true,
                audioInvalidated,
                data: company.aiAgentSettings.agent2.greetings.callStart
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error updating call start greeting:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to update call start greeting'
            });
        }
    }
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /:companyId/greetings/call-start/audio
 * ═══════════════════════════════════════════════════════════════════════════
 * Generate audio for Call Start Greeting using ElevenLabs
 * 
 * REQUEST BODY:
 * {
 *   text: string (required)
 * }
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   audioUrl: string,
 *   textHash: string
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.post(
    '/:companyId/greetings/call-start/audio',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_WRITE),
    async (req, res) => {
        try {
            const { companyId } = req.params;
            const { text } = req.body;
            
            if (!text || typeof text !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'text is required'
                });
            }
            
            logger.info(`[${MODULE_ID}] Generating call start audio`, { companyId });
            
            const company = await v2Company.findById(companyId).lean();
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            // Get ElevenLabs voice settings
            const voiceId = company.aiAgentSettings?.voiceSettings?.voiceId;
            
            if (!voiceId) {
                return res.status(400).json({
                    success: false,
                    error: 'No ElevenLabs voice configured',
                    hint: 'Configure voice in Company Profile → Voice Settings'
                });
            }
            
            // Generate audio via ElevenLabs
            const ElevenLabsService = require('../../services/ElevenLabsService');
            const textHash = hashText(text);
            const filename = `callstart_${companyId}_${textHash}.mp3`;
            const audioPath = path.join(AUDIO_DIR, filename);
            const audioUrl = `${AUDIO_URL_PREFIX}/${filename}`;
            
            ensureAudioDirectory();
            
            // Check if audio already exists for this text
            if (fs.existsSync(audioPath)) {
                logger.info(`[${MODULE_ID}] Audio already exists, returning cached URL`, {
                    companyId,
                    filename
                });
                
                // Update company record with audio URL
                await v2Company.findByIdAndUpdate(
                    companyId,
                    {
                        'aiAgentSettings.agent2.greetings.callStart.audioUrl': audioUrl,
                        'aiAgentSettings.agent2.greetings.callStart.audioTextHash': textHash,
                        'aiAgentSettings.agent2.greetings.callStart.audioGeneratedAt': new Date()
                    },
                    { new: true }
                );
                
                return res.json({
                    success: true,
                    audioUrl,
                    textHash,
                    cached: true
                });
            }
            
            // Generate new audio
            const audioBuffer = await ElevenLabsService.generateSpeech(voiceId, text);
            
            // Save audio file
            fs.writeFileSync(audioPath, audioBuffer);
            
            logger.info(`[${MODULE_ID}] Call start audio generated successfully`, {
                companyId,
                filename,
                size: audioBuffer.length
            });
            
            // Update company record with audio URL
            await v2Company.findByIdAndUpdate(
                companyId,
                {
                    'aiAgentSettings.agent2.greetings.callStart.audioUrl': audioUrl,
                    'aiAgentSettings.agent2.greetings.callStart.audioTextHash': textHash,
                    'aiAgentSettings.agent2.greetings.callStart.audioGeneratedAt': new Date()
                },
                { new: true }
            );
            
            res.json({
                success: true,
                audioUrl,
                textHash,
                cached: false
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error generating call start audio:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate audio',
                message: error.message
            });
        }
    }
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUT /:companyId/greetings/interceptor
 * ═══════════════════════════════════════════════════════════════════════════
 * Update Greeting Interceptor settings (gate + intent words)
 * 
 * REQUEST BODY:
 * {
 *   enabled: boolean,
 *   shortOnlyGate: {
 *     maxWords: number (1-5),
 *     blockIfIntentWords: boolean
 *   },
 *   intentWords: string[] (comma-separated words)
 * }
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   data: { ... updated interceptor settings }
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.put(
    '/:companyId/greetings/interceptor',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_WRITE),
    async (req, res) => {
        try {
            const { companyId } = req.params;
            const { enabled, shortOnlyGate, intentWords } = req.body;
            
            logger.info(`[${MODULE_ID}] Updating greeting interceptor`, { companyId });
            
            // Validation
            if (typeof enabled !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    error: 'enabled must be a boolean'
                });
            }
            
            if (shortOnlyGate) {
                if (typeof shortOnlyGate.maxWords !== 'number' || shortOnlyGate.maxWords < 1 || shortOnlyGate.maxWords > 5) {
                    return res.status(400).json({
                        success: false,
                        error: 'maxWords must be between 1 and 5'
                    });
                }
                
                if (typeof shortOnlyGate.blockIfIntentWords !== 'boolean') {
                    return res.status(400).json({
                        success: false,
                        error: 'blockIfIntentWords must be a boolean'
                    });
                }
            }
            
            if (intentWords && !Array.isArray(intentWords)) {
                return res.status(400).json({
                    success: false,
                    error: 'intentWords must be an array'
                });
            }
            
            const company = await v2Company.findById(companyId);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            // Initialize greetings structure if not exists
            if (!company.aiAgentSettings) company.aiAgentSettings = {};
            if (!company.aiAgentSettings.agent2) company.aiAgentSettings.agent2 = {};
            if (!company.aiAgentSettings.agent2.greetings) company.aiAgentSettings.agent2.greetings = {};
            if (!company.aiAgentSettings.agent2.greetings.interceptor) {
                company.aiAgentSettings.agent2.greetings.interceptor = {
                    enabled: true,
                    shortOnlyGate: { maxWords: 2, blockIfIntentWords: true },
                    intentWords: [],
                    rules: []
                };
            }
            
            // Update interceptor settings
            company.aiAgentSettings.agent2.greetings.interceptor.enabled = enabled;
            
            if (shortOnlyGate) {
                company.aiAgentSettings.agent2.greetings.interceptor.shortOnlyGate = {
                    maxWords: shortOnlyGate.maxWords,
                    blockIfIntentWords: shortOnlyGate.blockIfIntentWords
                };
            }
            
            if (intentWords) {
                // Sanitize intent words (lowercase, trim, filter empty)
                company.aiAgentSettings.agent2.greetings.interceptor.intentWords = intentWords
                    .map(word => String(word).toLowerCase().trim())
                    .filter(Boolean);
            }
            
            company.markModified('aiAgentSettings');
            await company.save();
            
            logger.info(`[${MODULE_ID}] Greeting interceptor updated successfully`, { companyId });
            
            res.json({
                success: true,
                data: company.aiAgentSettings.agent2.greetings.interceptor
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error updating greeting interceptor:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to update greeting interceptor'
            });
        }
    }
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /:companyId/greetings/rules
 * ═══════════════════════════════════════════════════════════════════════════
 * Get all greeting rules for a company (sorted by priority descending)
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   data: [ ... array of greeting rules ]
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.get(
    '/:companyId/greetings/rules',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_READ),
    async (req, res) => {
        try {
            const { companyId } = req.params;
            
            logger.info(`[${MODULE_ID}] Fetching greeting rules`, { companyId });
            
            const company = await v2Company.findById(companyId)
                .select('aiAgentSettings.agent2.greetings.interceptor.rules')
                .lean();
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            const rules = company.aiAgentSettings?.agent2?.greetings?.interceptor?.rules || [];
            
            // Sort by priority (higher priority first)
            const sortedRules = rules.sort((a, b) => (b.priority || 50) - (a.priority || 50));
            
            res.json({
                success: true,
                data: sortedRules
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error fetching greeting rules:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch greeting rules'
            });
        }
    }
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /:companyId/greetings/rules
 * ═══════════════════════════════════════════════════════════════════════════
 * Create a new greeting rule
 * 
 * REQUEST BODY:
 * {
 *   ruleId: string (unique, alphanumeric + hyphens/underscores),
 *   enabled: boolean (default: true),
 *   priority: number (1-1000, default: 50),
 *   matchType: 'EXACT' | 'CONTAINS' | 'REGEX' (default: 'EXACT'),
 *   triggers: string[] (phrases to match),
 *   response: string (max 300 chars)
 * }
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   data: { ... created rule }
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.post(
    '/:companyId/greetings/rules',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_WRITE),
    async (req, res) => {
        try {
            const { companyId } = req.params;
            const ruleData = req.body;
            
            logger.info(`[${MODULE_ID}] Creating greeting rule`, { companyId, ruleId: ruleData.ruleId });
            
            // Validate required fields
            if (!ruleData.ruleId) {
                return res.status(400).json({
                    success: false,
                    error: 'ruleId is required'
                });
            }
            
            if (!isValidRuleId(ruleData.ruleId)) {
                return res.status(400).json({
                    success: false,
                    error: 'ruleId must be alphanumeric with hyphens/underscores (1-50 chars)'
                });
            }
            
            if (!ruleData.response || !ruleData.response.trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'response is required'
                });
            }
            
            if (!Array.isArray(ruleData.triggers) || ruleData.triggers.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'triggers must be a non-empty array'
                });
            }
            
            const company = await v2Company.findById(companyId);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            // Initialize greetings structure if not exists
            if (!company.aiAgentSettings) company.aiAgentSettings = {};
            if (!company.aiAgentSettings.agent2) company.aiAgentSettings.agent2 = {};
            if (!company.aiAgentSettings.agent2.greetings) company.aiAgentSettings.agent2.greetings = {};
            if (!company.aiAgentSettings.agent2.greetings.interceptor) {
                company.aiAgentSettings.agent2.greetings.interceptor = {
                    enabled: true,
                    shortOnlyGate: { maxWords: 2, blockIfIntentWords: true },
                    intentWords: [],
                    rules: []
                };
            }
            
            // Check for duplicate ruleId
            const existingRule = company.aiAgentSettings.agent2.greetings.interceptor.rules.find(
                r => r.ruleId === ruleData.ruleId
            );
            
            if (existingRule) {
                return res.status(400).json({
                    success: false,
                    error: `Rule with ruleId "${ruleData.ruleId}" already exists`
                });
            }
            
            // Sanitize and create new rule
            const newRule = {
                ...sanitizeRuleData(ruleData),
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            company.aiAgentSettings.agent2.greetings.interceptor.rules.push(newRule);
            
            company.markModified('aiAgentSettings');
            await company.save();
            
            logger.info(`[${MODULE_ID}] Greeting rule created successfully`, {
                companyId,
                ruleId: newRule.ruleId
            });
            
            res.json({
                success: true,
                data: newRule
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error creating greeting rule:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to create greeting rule'
            });
        }
    }
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PATCH /:companyId/greetings/rules/:ruleId
 * ═══════════════════════════════════════════════════════════════════════════
 * Update an existing greeting rule
 * 
 * REQUEST BODY:
 * {
 *   enabled?: boolean,
 *   priority?: number,
 *   matchType?: string,
 *   triggers?: string[],
 *   response?: string
 * }
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   audioInvalidated: boolean,
 *   data: { ... updated rule }
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.patch(
    '/:companyId/greetings/rules/:ruleId',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_WRITE),
    async (req, res) => {
        try {
            const { companyId, ruleId } = req.params;
            const updates = req.body;
            
            logger.info(`[${MODULE_ID}] Updating greeting rule`, { companyId, ruleId });
            
            const company = await v2Company.findById(companyId);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            const rules = company.aiAgentSettings?.agent2?.greetings?.interceptor?.rules || [];
            const ruleIndex = rules.findIndex(r => r.ruleId === ruleId);
            
            if (ruleIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: `Rule "${ruleId}" not found`
                });
            }
            
            const currentRule = rules[ruleIndex];
            const currentResponse = currentRule.response || '';
            const currentHash = currentRule.audioTextHash;
            
            // Apply updates
            if (typeof updates.enabled === 'boolean') {
                currentRule.enabled = updates.enabled;
            }
            
            if (typeof updates.priority === 'number') {
                currentRule.priority = Math.max(1, Math.min(1000, updates.priority));
            }
            
            if (updates.matchType && ['EXACT', 'CONTAINS', 'REGEX'].includes(updates.matchType)) {
                currentRule.matchType = updates.matchType;
            }
            
            if (Array.isArray(updates.triggers)) {
                currentRule.triggers = updates.triggers.map(t => String(t).trim()).filter(Boolean);
            }
            
            let audioInvalidated = false;
            
            if (updates.response) {
                const newResponse = String(updates.response).trim().substring(0, 300);
                const newHash = hashText(newResponse);
                
                // Check if response changed (invalidate audio)
                if (currentResponse !== newResponse && currentHash && newHash !== currentHash) {
                    currentRule.audioUrl = null;
                    currentRule.audioTextHash = null;
                    currentRule.audioGeneratedAt = null;
                    audioInvalidated = true;
                    
                    logger.info(`[${MODULE_ID}] Audio invalidated for rule`, { companyId, ruleId });
                }
                
                currentRule.response = newResponse;
            }
            
            currentRule.updatedAt = new Date();
            
            company.aiAgentSettings.agent2.greetings.interceptor.rules[ruleIndex] = currentRule;
            
            company.markModified('aiAgentSettings');
            await company.save();
            
            logger.info(`[${MODULE_ID}] Greeting rule updated successfully`, {
                companyId,
                ruleId,
                audioInvalidated
            });
            
            res.json({
                success: true,
                audioInvalidated,
                data: currentRule
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error updating greeting rule:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to update greeting rule'
            });
        }
    }
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DELETE /:companyId/greetings/rules/:ruleId
 * ═══════════════════════════════════════════════════════════════════════════
 * Delete a greeting rule
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   message: 'Rule deleted successfully'
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.delete(
    '/:companyId/greetings/rules/:ruleId',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_WRITE),
    async (req, res) => {
        try {
            const { companyId, ruleId } = req.params;
            
            logger.info(`[${MODULE_ID}] Deleting greeting rule`, { companyId, ruleId });
            
            const company = await v2Company.findById(companyId);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            const rules = company.aiAgentSettings?.agent2?.greetings?.interceptor?.rules || [];
            const ruleIndex = rules.findIndex(r => r.ruleId === ruleId);
            
            if (ruleIndex === -1) {
                return res.status(404).json({
                    success: false,
                    error: `Rule "${ruleId}" not found`
                });
            }
            
            // Remove rule from array
            company.aiAgentSettings.agent2.greetings.interceptor.rules.splice(ruleIndex, 1);
            
            company.markModified('aiAgentSettings');
            await company.save();
            
            logger.info(`[${MODULE_ID}] Greeting rule deleted successfully`, { companyId, ruleId });
            
            res.json({
                success: true,
                message: 'Rule deleted successfully'
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error deleting greeting rule:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete greeting rule'
            });
        }
    }
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /:companyId/greetings/rules/:ruleId/audio
 * ═══════════════════════════════════════════════════════════════════════════
 * Generate audio for a specific greeting rule
 * 
 * REQUEST BODY:
 * {
 *   text?: string (optional, uses rule.response if not provided)
 * }
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   audioUrl: string,
 *   textHash: string
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.post(
    '/:companyId/greetings/rules/:ruleId/audio',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_WRITE),
    async (req, res) => {
        try {
            const { companyId, ruleId } = req.params;
            let { text } = req.body;
            
            logger.info(`[${MODULE_ID}] Generating rule audio`, { companyId, ruleId });
            
            const company = await v2Company.findById(companyId);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            const rules = company.aiAgentSettings?.agent2?.greetings?.interceptor?.rules || [];
            const rule = rules.find(r => r.ruleId === ruleId);
            
            if (!rule) {
                return res.status(404).json({
                    success: false,
                    error: `Rule "${ruleId}" not found`
                });
            }
            
            // Use rule response if text not provided
            if (!text) {
                text = rule.response;
            }
            
            if (!text || typeof text !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'text is required'
                });
            }
            
            // Get ElevenLabs voice settings
            const voiceId = company.aiAgentSettings?.voiceSettings?.voiceId;
            
            if (!voiceId) {
                return res.status(400).json({
                    success: false,
                    error: 'No ElevenLabs voice configured',
                    hint: 'Configure voice in Company Profile → Voice Settings'
                });
            }
            
            // Generate audio via ElevenLabs
            const ElevenLabsService = require('../../services/ElevenLabsService');
            const textHash = hashText(text);
            const filename = `rule_${companyId}_${ruleId}_${textHash}.mp3`;
            const audioPath = path.join(AUDIO_DIR, filename);
            const audioUrl = `${AUDIO_URL_PREFIX}/${filename}`;
            
            ensureAudioDirectory();
            
            // Check if audio already exists for this text
            if (fs.existsSync(audioPath)) {
                logger.info(`[${MODULE_ID}] Audio already exists, returning cached URL`, {
                    companyId,
                    ruleId,
                    filename
                });
                
                // Update rule with audio URL
                rule.audioUrl = audioUrl;
                rule.audioTextHash = textHash;
                rule.audioGeneratedAt = new Date();
                
                company.markModified('aiAgentSettings');
                await company.save();
                
                return res.json({
                    success: true,
                    audioUrl,
                    textHash,
                    cached: true
                });
            }
            
            // Generate new audio
            const audioBuffer = await ElevenLabsService.generateSpeech(voiceId, text);
            
            // Save audio file
            fs.writeFileSync(audioPath, audioBuffer);
            
            logger.info(`[${MODULE_ID}] Rule audio generated successfully`, {
                companyId,
                ruleId,
                filename,
                size: audioBuffer.length
            });
            
            // Update rule with audio URL
            rule.audioUrl = audioUrl;
            rule.audioTextHash = textHash;
            rule.audioGeneratedAt = new Date();
            
            company.markModified('aiAgentSettings');
            await company.save();
            
            res.json({
                success: true,
                audioUrl,
                textHash,
                cached: false
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error generating rule audio:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate audio',
                message: error.message
            });
        }
    }
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /:companyId/greetings/seed-global
 * ═══════════════════════════════════════════════════════════════════════════
 * Load default platform greeting rules
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   data: { rulesAdded: number, rules: [...] }
 * }
 * ═══════════════════════════════════════════════════════════════════════════
 */
router.post(
    '/:companyId/greetings/seed-global',
    authenticateJWT,
    requirePermission(PERMISSIONS.CONFIG_WRITE),
    async (req, res) => {
        try {
            const { companyId } = req.params;
            
            logger.info(`[${MODULE_ID}] Seeding global greeting rules`, { companyId });
            
            const company = await v2Company.findById(companyId);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            // Initialize greetings structure if not exists
            if (!company.aiAgentSettings) company.aiAgentSettings = {};
            if (!company.aiAgentSettings.agent2) company.aiAgentSettings.agent2 = {};
            if (!company.aiAgentSettings.agent2.greetings) company.aiAgentSettings.agent2.greetings = {};
            if (!company.aiAgentSettings.agent2.greetings.interceptor) {
                company.aiAgentSettings.agent2.greetings.interceptor = {
                    enabled: true,
                    shortOnlyGate: { maxWords: 2, blockIfIntentWords: true },
                    intentWords: [],
                    rules: []
                };
            }
            
            // Default platform greeting rules
            const defaultRules = [
                {
                    ruleId: 'hi-hello-hey',
                    enabled: true,
                    priority: 10,
                    matchType: 'EXACT',
                    triggers: ['hi', 'hello', 'hey'],
                    response: 'Hi! How can I help you today?',
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                {
                    ruleId: 'good-morning',
                    enabled: true,
                    priority: 11,
                    matchType: 'EXACT',
                    triggers: ['good morning'],
                    response: 'Good morning! How can I help you today?',
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                {
                    ruleId: 'good-afternoon',
                    enabled: true,
                    priority: 12,
                    matchType: 'EXACT',
                    triggers: ['good afternoon'],
                    response: 'Good afternoon! How can I help you today?',
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                {
                    ruleId: 'good-evening',
                    enabled: true,
                    priority: 13,
                    matchType: 'EXACT',
                    triggers: ['good evening'],
                    response: 'Good evening! How can I help you today?',
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            ];
            
            // Get existing rule IDs
            const existingRuleIds = new Set(
                (company.aiAgentSettings.agent2.greetings.interceptor.rules || [])
                    .map(r => r.ruleId)
            );
            
            // Only add rules that don't already exist
            const newRules = defaultRules.filter(rule => !existingRuleIds.has(rule.ruleId));
            
            if (newRules.length === 0) {
                return res.json({
                    success: true,
                    message: 'All default rules already exist',
                    data: {
                        rulesAdded: 0,
                        rules: []
                    }
                });
            }
            
            // Add new rules
            company.aiAgentSettings.agent2.greetings.interceptor.rules.push(...newRules);
            
            company.markModified('aiAgentSettings');
            await company.save();
            
            logger.info(`[${MODULE_ID}] Global greeting rules seeded successfully`, {
                companyId,
                rulesAdded: newRules.length
            });
            
            res.json({
                success: true,
                data: {
                    rulesAdded: newRules.length,
                    rules: newRules
                }
            });
            
        } catch (error) {
            logger.error(`[${MODULE_ID}] Error seeding global rules:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to seed global rules'
            });
        }
    }
);

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ROUTER
// ═══════════════════════════════════════════════════════════════════════════

module.exports = router;
