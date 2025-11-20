/**
 * ============================================================================
 * CONNECTION MESSAGES API - AI AGENT SETTINGS TAB
 * ============================================================================
 * 
 * PURPOSE: Backend API for managing multi-channel connection messages
 * CHANNELS: Voice, SMS, Web Chat
 * 
 * These messages are sent BEFORE AI agent begins processing:
 * - Voice: Pre-recorded audio OR real-time TTS
 * - SMS: Instant text auto-reply
 * - Web Chat: Auto-reply messages (future)
 * 
 * ENDPOINTS:
 * - GET    /api/company/:companyId/connection-messages/config
 * - PATCH  /api/company/:companyId/connection-messages/config
 * - POST   /api/company/:companyId/connection-messages/voice/upload
 * - DELETE /api/company/:companyId/connection-messages/voice/remove
 * - POST   /api/company/:companyId/connection-messages/voice/generate
 * - POST   /api/company/:companyId/connection-messages/reset
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Company = require('../../models/v2Company');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { redisClient } = require('../../db');
const logger = require('../../utils/logger');

// Apply authentication AND multi-tenant access control to all routes
router.use(authenticateJWT);
router.use(requireCompanyAccess);

// Configure multer for audio file uploads
const storage = multer.diskStorage({
    destination (req, file, cb) {
        const uploadDir = path.join(__dirname, '../../public/uploads/greetings');
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        cb(null, uploadDir);
    },
    filename (req, file, cb) {
        const companyId = req.params.companyId;
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `${companyId}_${timestamp}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max
    },
    fileFilter (req, file, cb) {
        const allowedTypes = /mp3|wav|m4a/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === 'audio/mp4';
        
        if (extname && mimetype) {
            return cb(null, true);
        } 
            cb(new Error('Only .mp3, .wav, and .m4a files are allowed'));
        
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/connection-messages/config
 * Get connection messages configuration
 * ============================================================================
 */
router.get('/:companyId/connection-messages/config', async (req, res) => {
    logger.info(`[CONNECTION MESSAGES] GET /config for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId)
            .select('connectionMessages companyName'); // 🔧 FIX: Select ROOT level connectionMessages

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // 🔧 FIX: connectionMessages is at ROOT level, not in aiAgentSettings!
        // Initialize if doesn't exist
        if (!company.connectionMessages) {
            const defaultConfig = getDefaultConfig();
            
            // 🔧 FIX: Use targeted update to avoid full document validation
            await Company.findByIdAndUpdate(
                req.params.companyId,
                {
                    $set: {
                        connectionMessages: defaultConfig  // 🔧 FIX: Save to ROOT level!
                    }
                },
                { runValidators: false }
            );
            
            company.connectionMessages = defaultConfig;
        }

        logger.info(`[CONNECTION MESSAGES] 📤 Returning mode:`, company.connectionMessages?.voice?.mode);
        logger.info(`[CONNECTION MESSAGES] 📤 Voice config:`, JSON.stringify(company.connectionMessages?.voice || {}, null, 2));

        res.json(company.connectionMessages);

    } catch (error) {
        logger.error('[CONNECTION MESSAGES] Error getting config:', error);
        res.status(500).json({ error: 'Failed to get configuration' });
    }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/connection-messages/config
 * Update connection messages configuration
 * ============================================================================
 */
router.patch('/:companyId/connection-messages/config', async (req, res) => {
    logger.info(`[CONNECTION MESSAGES] PATCH /config for company: ${req.params.companyId}`);
    logger.info(`[CONNECTION MESSAGES] 📥 Received body:`, JSON.stringify(req.body, null, 2));

    try {
        const { voice, sms, webChat } = req.body;

        // Load company
        const company = await Company.findById(req.params.companyId);

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // 🔧 FIX: connectionMessages is at ROOT level, not in aiAgentSettings!
        // Initialize if doesn't exist
        if (!company.connectionMessages) {
            company.connectionMessages = getDefaultConfig();
        }

        logger.debug(`[CONNECTION MESSAGES] 📊 Current mode in DB:`, company.connectionMessages?.voice?.mode);
        logger.info(`[CONNECTION MESSAGES] 📥 Incoming voice.mode:`, voice?.mode);

        // Update voice settings
        if (voice) {
            if (voice.mode) {
                logger.info(`[CONNECTION MESSAGES] ✏️ Updating mode from "${company.connectionMessages?.voice?.mode}" to "${voice.mode}"`);
                company.connectionMessages.voice.mode = voice.mode;
                logger.info(`[CONNECTION MESSAGES] ✅ Mode updated in memory:`, company.connectionMessages?.voice?.mode);
            }
            
            if (voice.text !== undefined) {
                // CRITICAL: Save to voice.text (PRIMARY FIELD for runtime)
                company.connectionMessages.voice.text = voice.text;
            }
            
            if (voice.realtime) {
                // Keep realtime for TTS generation settings
                if (!company.connectionMessages.voice.realtime) {
                    company.connectionMessages.voice.realtime = {};
                }
                company.connectionMessages.voice.realtime.text = voice.realtime.text;
            }
            
            // Update intelligent fallback settings
            if (voice.fallback) {
                if (!company.connectionMessages.voice.fallback) {
                    company.connectionMessages.voice.fallback = {};
                }
                if (voice.fallback.enabled !== undefined) {
                    company.connectionMessages.voice.fallback.enabled = voice.fallback.enabled;
                }
                if (voice.fallback.voiceMessage !== undefined) {
                    company.connectionMessages.voice.fallback.voiceMessage = voice.fallback.voiceMessage;
                }
                if (voice.fallback.smsEnabled !== undefined) {
                    company.connectionMessages.voice.fallback.smsEnabled = voice.fallback.smsEnabled;
                }
                if (voice.fallback.smsMessage !== undefined) {
                    company.connectionMessages.voice.fallback.smsMessage = voice.fallback.smsMessage;
                }
                if (voice.fallback.notifyAdmin !== undefined) {
                    company.connectionMessages.voice.fallback.notifyAdmin = voice.fallback.notifyAdmin;
                }
                if (voice.fallback.adminNotificationMethod) {
                    company.connectionMessages.voice.fallback.adminNotificationMethod = voice.fallback.adminNotificationMethod;
                }
                if (voice.fallback.adminPhone !== undefined) {
                    company.connectionMessages.voice.fallback.adminPhone = voice.fallback.adminPhone;
                }
                if (voice.fallback.adminEmail !== undefined) {
                    company.connectionMessages.voice.fallback.adminEmail = voice.fallback.adminEmail;
                }
                if (voice.fallback.adminSmsMessage !== undefined) {
                    company.connectionMessages.voice.fallback.adminSmsMessage = voice.fallback.adminSmsMessage;
                }
            }
        }

        // Update SMS settings
        if (sms) {
            if (sms.enabled !== undefined) {company.connectionMessages.sms.enabled = sms.enabled;}
            if (sms.text) {company.connectionMessages.sms.text = sms.text;}
            if (sms.businessHours) {
                if (sms.businessHours.enabled !== undefined) {
                    company.connectionMessages.sms.businessHours.enabled = sms.businessHours.enabled;
                }
                if (sms.businessHours.duringHours) {
                    company.connectionMessages.sms.businessHours.duringHours = sms.businessHours.duringHours;
                }
                if (sms.businessHours.afterHours) {
                    company.connectionMessages.sms.businessHours.afterHours = sms.businessHours.afterHours;
                }
            }
        }

        // Update Web Chat settings (future)
        if (webChat) {
            if (webChat.enabled !== undefined) {company.connectionMessages.webChat.enabled = webChat.enabled;}
            if (webChat.text) {company.connectionMessages.webChat.text = webChat.text;}
        }

        company.connectionMessages.lastUpdated = new Date();

        logger.info(`[CONNECTION MESSAGES] 💾 About to save with mode:`, company.connectionMessages?.voice?.mode);
        logger.info(`[CONNECTION MESSAGES] 💾 Full connectionMessages object:`, JSON.stringify(company.connectionMessages || {}, null, 2));

        // 🔧 FIX: Convert Mongoose subdocument to plain object before saving
        // Mongoose subdocuments have special properties that don't work with $set
        const plainConnectionMessages = company.connectionMessages.toObject ? 
            company.connectionMessages.toObject() : 
            JSON.parse(JSON.stringify(company.connectionMessages));
        
        logger.info(`[CONNECTION MESSAGES] 🔧 Converted to plain object, mode:`, plainConnectionMessages?.voice?.mode);

        // 🔧 FIX: Use targeted update to avoid full document validation
        // This bypasses validation of corrupt data in OTHER fields
        logger.info(`[CONNECTION MESSAGES] 🔧 Using targeted update to bypass full validation`);
        
        const updatedCompany = await Company.findByIdAndUpdate(
            req.params.companyId,
            {
                $set: {
                    connectionMessages: plainConnectionMessages  // 🔧 FIX: Save to ROOT level, not aiAgentSettings!
                }
            },
            { new: true, runValidators: false } // Skip full validation
        );
        
        if (!updatedCompany) {
            logger.error(`[CONNECTION MESSAGES] ❌ Company not found during update`);
            return res.status(404).json({
                error: 'Company not found'
            });
        }
        
        logger.debug(`[CONNECTION MESSAGES] ✅ Saved! Mode in returned document:`, updatedCompany.connectionMessages?.voice?.mode);

        // Clear cache
        try {
            await redisClient.del(`company:${req.params.companyId}`);
            logger.debug(`[CONNECTION MESSAGES] Cache cleared for company: ${req.params.companyId}`);
        } catch (cacheError) {
            logger.warn('[CONNECTION MESSAGES] Cache clear failed:', cacheError.message);
        }

        logger.debug(`[CONNECTION MESSAGES] ✅ Configuration updated for company: ${req.params.companyId}`);

        res.json({
            success: true,
            message: 'Connection messages updated successfully',
            config: updatedCompany.connectionMessages
        });

    } catch (error) {
        logger.error('[CONNECTION MESSAGES] ❌ Error updating config:', error);
        logger.error('[CONNECTION MESSAGES] ❌ Error stack:', error.stack);
        logger.error('[CONNECTION MESSAGES] ❌ Error name:', error.name);
        logger.error('[CONNECTION MESSAGES] ❌ Error message:', error.message);
        if (error.errors) {
            logger.error('[CONNECTION MESSAGES] ❌ Validation errors:', JSON.stringify(error.errors, null, 2));
        }
        res.status(500).json({ 
            error: 'Failed to update configuration',
            details: error.message,
            validationErrors: error.errors ? Object.keys(error.errors) : null
        });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/connection-messages/voice/upload
 * Upload pre-recorded audio file
 * ============================================================================
 */
router.post('/:companyId/connection-messages/voice/upload', upload.single('audio'), async (req, res) => {
    logger.info(`[CONNECTION MESSAGES] POST /voice/upload for company: ${req.params.companyId}`);

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const company = await Company.findById(req.params.companyId);

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Initialize if doesn't exist
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.connectionMessages) {
            company.connectionMessages = getDefaultConfig();
        }

        // Get file details
        const fileUrl = `/uploads/greetings/${req.file.filename}`;
        const fileName = req.file.originalname;
        const fileSize = req.file.size;

        // Calculate duration (we'll need a library for this in production)
        // For now, estimate based on file size (rough estimate)
        const estimatedDuration = Math.round(fileSize / 16000); // Rough estimate for MP3

        // Remove old file if exists
        if (company.connectionMessages.voice.prerecorded.activeFileUrl) {
            const oldFilePath = path.join(__dirname, '../../public', company.connectionMessages.voice.prerecorded.activeFileUrl);
            if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
                logger.info(`[CONNECTION MESSAGES] Deleted old file: ${oldFilePath}`);
            }
        }

        // Update active file
        company.connectionMessages.voice.prerecorded.activeFileUrl = fileUrl;
        company.connectionMessages.voice.prerecorded.activeFileName = fileName;
        company.connectionMessages.voice.prerecorded.activeDuration = estimatedDuration;
        company.connectionMessages.voice.prerecorded.activeFileSize = fileSize;
        company.connectionMessages.voice.prerecorded.uploadedBy = req.user.userId;
        company.connectionMessages.voice.prerecorded.uploadedAt = new Date();

        company.connectionMessages.lastUpdated = new Date();

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${req.params.companyId}`);
        } catch (cacheError) {
            logger.warn('[CONNECTION MESSAGES] Cache clear failed:', cacheError.message);
        }

        logger.debug(`[CONNECTION MESSAGES] ✅ Audio uploaded: ${fileName}`);

        res.json({
            success: true,
            message: 'Audio file uploaded successfully',
            file: {
                url: fileUrl,
                name: fileName,
                size: fileSize,
                duration: estimatedDuration
            }
        });

    } catch (error) {
        logger.error('[CONNECTION MESSAGES] Error uploading file:', error);
        res.status(500).json({ error: 'Failed to upload audio file' });
    }
});

/**
 * ============================================================================
 * DELETE /api/company/:companyId/connection-messages/voice/remove
 * Remove pre-recorded audio file
 * ============================================================================
 */
router.delete('/:companyId/connection-messages/voice/remove', async (req, res) => {
    logger.info(`[CONNECTION MESSAGES] DELETE /voice/remove for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId);

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (!company.aiAgentSettings?.connectionMessages?.voice?.prerecorded?.activeFileUrl) {
            return res.status(404).json({ error: 'No audio file to remove' });
        }

        // Delete file from disk
        const filePath = path.join(__dirname, '../../public', company.connectionMessages.voice.prerecorded.activeFileUrl);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info(`[CONNECTION MESSAGES] Deleted file: ${filePath}`);
        }

        // Clear prerecorded settings
        company.connectionMessages.voice.prerecorded = {
            activeFileUrl: null,
            activeFileName: null,
            activeDuration: null,
            activeFileSize: null,
            uploadedBy: null,
            uploadedAt: null
        };

        company.connectionMessages.lastUpdated = new Date();

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${req.params.companyId}`);
        } catch (cacheError) {
            logger.warn('[CONNECTION MESSAGES] Cache clear failed:', cacheError.message);
        }

        logger.debug(`[CONNECTION MESSAGES] ✅ Audio file removed`);

        res.json({
            success: true,
            message: 'Audio file removed successfully'
        });

    } catch (error) {
        logger.error('[CONNECTION MESSAGES] Error removing file:', error);
        res.status(500).json({ error: 'Failed to remove audio file' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/connection-messages/voice/generate
 * Generate audio with ElevenLabs (future implementation)
 * ============================================================================
 */
router.post('/:companyId/connection-messages/voice/generate', async (req, res) => {
    logger.info(`[CONNECTION MESSAGES] POST /voice/generate for company: ${req.params.companyId}`);

    try {
        const { text, voiceId } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        if (!voiceId) {
            return res.status(400).json({ error: 'Voice ID is required' });
        }

        // Get company for ElevenLabs API key
        const company = await Company.findById(req.params.companyId).select('aiAgentSettings companyName');

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        logger.info(`[CONNECTION MESSAGES] Generating audio with ElevenLabs for company: ${company.companyName}`);
        logger.info(`[CONNECTION MESSAGES] Text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        logger.info(`[CONNECTION MESSAGES] Voice ID: ${voiceId}`);

        // Import ElevenLabs service
        const { synthesizeSpeech } = require('../../services/v2elevenLabsService');

        // Generate audio using ElevenLabs
        const audioBuffer = await synthesizeSpeech({
            text,
            voiceId,
            company,
            model_id: 'eleven_turbo_v2_5',
            output_format: 'mp3_44100_128'
        });

        logger.info(`[CONNECTION MESSAGES] ✅ Audio generated successfully (${audioBuffer.length} bytes)`);

        // Set headers for audio download
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="greeting_${Date.now()}.mp3"`);
        res.setHeader('Content-Length', audioBuffer.length);

        // Send audio buffer
        res.send(audioBuffer);

    } catch (error) {
        logger.error('[CONNECTION MESSAGES] Error generating audio:', error);
        res.status(500).json({ 
            error: 'Failed to generate audio',
            message: error.message,
            details: error.message.includes('API key') 
                ? 'Please configure your ElevenLabs API key in AI Voice Settings'
                : 'An error occurred while generating audio'
        });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/connection-messages/reset
 * Reset to default configuration
 * ============================================================================
 */
router.post('/:companyId/connection-messages/reset', async (req, res) => {
    logger.info(`[CONNECTION MESSAGES] POST /reset for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId);

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Remove audio file if exists
        if (company.aiAgentSettings?.connectionMessages?.voice?.prerecorded?.activeFileUrl) {
            const filePath = path.join(__dirname, '../../public', company.connectionMessages.voice.prerecorded.activeFileUrl);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.info(`[CONNECTION MESSAGES] Deleted file: ${filePath}`);
            }
        }

        // Reset to defaults
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        company.connectionMessages = getDefaultConfig();

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${req.params.companyId}`);
        } catch (cacheError) {
            logger.warn('[CONNECTION MESSAGES] Cache clear failed:', cacheError.message);
        }

        logger.debug(`[CONNECTION MESSAGES] ✅ Reset to defaults`);

        res.json({
            success: true,
            message: 'Reset to defaults successfully',
            config: company.connectionMessages
        });

    } catch (error) {
        logger.error('[CONNECTION MESSAGES] Error resetting:', error);
        res.status(500).json({ error: 'Failed to reset configuration' });
    }
});

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Get default configuration
 */
function getDefaultConfig() {
    return {
        voice: {
            mode: 'prerecorded', // prerecorded | realtime | disabled
            text: null, // PRIMARY FIELD for runtime
            prerecorded: {
                activeFileUrl: null,
                activeFileName: null,
                activeDuration: null,
                activeFileSize: null,
                uploadedBy: null,
                uploadedAt: null
            },
            realtime: {
                text: 'Thank you for calling. Please wait a moment while we connect you...',
                voiceId: null
            },
            // Infrastructure Failure Fallback (Hybrid Approach)
            // 🔥 NO generic voice fallback - goes straight to transfer + SMS + alert
            fallback: {
                enabled: true,
                smsEnabled: true,
                smsMessage: "We're experiencing technical issues and are connecting you to our team. Thank you for your patience.",
                notifyAdmin: true,
                adminNotificationMethod: 'both', // sms | email | both - ALWAYS notify ops
                adminPhone: null, // Custom admin phone for notifications
                adminEmail: null, // Custom admin email for notifications
                adminSmsMessage: "⚠️ FALLBACK ALERT: Greeting fallback occurred in {companyname} ({companyid}). Please check the Messages & Greetings settings immediately."
            }
        },
        sms: {
            enabled: false,
            text: 'Thanks for contacting us! Our AI assistant will respond shortly.',
            businessHours: {
                enabled: false,
                duringHours: 'Thanks for texting! We\'ll respond right away...',
                afterHours: 'Thanks for texting! We\'re currently closed but will respond first thing...'
            }
        },
        webChat: {
            enabled: false,
            text: 'Thanks for reaching out! Our AI assistant will respond in a moment...',
            showTypingIndicator: true,
            delaySeconds: 2
        },
        lastUpdated: new Date()
    };
}

module.exports = router;

