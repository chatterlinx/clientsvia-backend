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
const { authenticateJWT } = require('../../middleware/auth');
const { redisClient } = require('../../db');
const logger = require('../../utils/logger');

// Apply authentication to all routes
router.use(authenticateJWT);

// Configure multer for audio file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../../public/uploads/greetings');
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const companyId = req.params.companyId;
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `${companyId}_${timestamp}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /mp3|wav|m4a/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === 'audio/mp4';
        
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only .mp3, .wav, and .m4a files are allowed'));
        }
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/connection-messages/config
 * Get connection messages configuration
 * ============================================================================
 */
router.get('/:companyId/connection-messages/config', async (req, res) => {
    console.log(`[CONNECTION MESSAGES] GET /config for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId)
            .select('aiAgentLogic companyName');

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Initialize if doesn't exist
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }
        if (!company.aiAgentLogic.connectionMessages) {
            company.aiAgentLogic.connectionMessages = getDefaultConfig();
            await company.save();
        }

        res.json(company.aiAgentLogic.connectionMessages);

    } catch (error) {
        console.error('[CONNECTION MESSAGES] Error getting config:', error);
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
    console.log(`[CONNECTION MESSAGES] PATCH /config for company: ${req.params.companyId}`);

    try {
        const { voice, sms, webChat } = req.body;

        const company = await Company.findById(req.params.companyId);

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Initialize if doesn't exist
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }
        if (!company.aiAgentLogic.connectionMessages) {
            company.aiAgentLogic.connectionMessages = getDefaultConfig();
        }

        // Update voice settings
        if (voice) {
            if (voice.mode) company.aiAgentLogic.connectionMessages.voice.mode = voice.mode;
            
            if (voice.text !== undefined) {
                // CRITICAL: Save to voice.text (PRIMARY FIELD for runtime)
                company.aiAgentLogic.connectionMessages.voice.text = voice.text;
            }
            
            if (voice.realtime) {
                // Keep realtime for TTS generation settings
                if (!company.aiAgentLogic.connectionMessages.voice.realtime) {
                    company.aiAgentLogic.connectionMessages.voice.realtime = {};
                }
                company.aiAgentLogic.connectionMessages.voice.realtime.text = voice.realtime.text;
            }
            
            // Update intelligent fallback settings
            if (voice.fallback) {
                if (!company.aiAgentLogic.connectionMessages.voice.fallback) {
                    company.aiAgentLogic.connectionMessages.voice.fallback = {};
                }
                if (voice.fallback.enabled !== undefined) {
                    company.aiAgentLogic.connectionMessages.voice.fallback.enabled = voice.fallback.enabled;
                }
                if (voice.fallback.voiceMessage !== undefined) {
                    company.aiAgentLogic.connectionMessages.voice.fallback.voiceMessage = voice.fallback.voiceMessage;
                }
                if (voice.fallback.smsEnabled !== undefined) {
                    company.aiAgentLogic.connectionMessages.voice.fallback.smsEnabled = voice.fallback.smsEnabled;
                }
                if (voice.fallback.smsMessage !== undefined) {
                    company.aiAgentLogic.connectionMessages.voice.fallback.smsMessage = voice.fallback.smsMessage;
                }
                if (voice.fallback.notifyAdmin !== undefined) {
                    company.aiAgentLogic.connectionMessages.voice.fallback.notifyAdmin = voice.fallback.notifyAdmin;
                }
                if (voice.fallback.adminNotificationMethod) {
                    company.aiAgentLogic.connectionMessages.voice.fallback.adminNotificationMethod = voice.fallback.adminNotificationMethod;
                }
            }
        }

        // Update SMS settings
        if (sms) {
            if (sms.enabled !== undefined) company.aiAgentLogic.connectionMessages.sms.enabled = sms.enabled;
            if (sms.text) company.aiAgentLogic.connectionMessages.sms.text = sms.text;
            if (sms.businessHours) {
                if (sms.businessHours.enabled !== undefined) {
                    company.aiAgentLogic.connectionMessages.sms.businessHours.enabled = sms.businessHours.enabled;
                }
                if (sms.businessHours.duringHours) {
                    company.aiAgentLogic.connectionMessages.sms.businessHours.duringHours = sms.businessHours.duringHours;
                }
                if (sms.businessHours.afterHours) {
                    company.aiAgentLogic.connectionMessages.sms.businessHours.afterHours = sms.businessHours.afterHours;
                }
            }
        }

        // Update Web Chat settings (future)
        if (webChat) {
            if (webChat.enabled !== undefined) company.aiAgentLogic.connectionMessages.webChat.enabled = webChat.enabled;
            if (webChat.text) company.aiAgentLogic.connectionMessages.webChat.text = webChat.text;
        }

        company.aiAgentLogic.connectionMessages.lastUpdated = new Date();

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${req.params.companyId}`);
            console.log(`[CONNECTION MESSAGES] Cache cleared for company: ${req.params.companyId}`);
        } catch (cacheError) {
            console.warn('[CONNECTION MESSAGES] Cache clear failed:', cacheError.message);
        }

        console.log(`[CONNECTION MESSAGES] ✅ Configuration updated for company: ${req.params.companyId}`);

        res.json({
            success: true,
            message: 'Connection messages updated successfully',
            config: company.aiAgentLogic.connectionMessages
        });

    } catch (error) {
        console.error('[CONNECTION MESSAGES] Error updating config:', error);
        res.status(500).json({ error: 'Failed to update configuration' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/connection-messages/voice/upload
 * Upload pre-recorded audio file
 * ============================================================================
 */
router.post('/:companyId/connection-messages/voice/upload', upload.single('audio'), async (req, res) => {
    console.log(`[CONNECTION MESSAGES] POST /voice/upload for company: ${req.params.companyId}`);

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const company = await Company.findById(req.params.companyId);

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Initialize if doesn't exist
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }
        if (!company.aiAgentLogic.connectionMessages) {
            company.aiAgentLogic.connectionMessages = getDefaultConfig();
        }

        // Get file details
        const fileUrl = `/uploads/greetings/${req.file.filename}`;
        const fileName = req.file.originalname;
        const fileSize = req.file.size;

        // Calculate duration (we'll need a library for this in production)
        // For now, estimate based on file size (rough estimate)
        const estimatedDuration = Math.round(fileSize / 16000); // Rough estimate for MP3

        // Remove old file if exists
        if (company.aiAgentLogic.connectionMessages.voice.prerecorded.activeFileUrl) {
            const oldFilePath = path.join(__dirname, '../../public', company.aiAgentLogic.connectionMessages.voice.prerecorded.activeFileUrl);
            if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
                console.log(`[CONNECTION MESSAGES] Deleted old file: ${oldFilePath}`);
            }
        }

        // Update active file
        company.aiAgentLogic.connectionMessages.voice.prerecorded.activeFileUrl = fileUrl;
        company.aiAgentLogic.connectionMessages.voice.prerecorded.activeFileName = fileName;
        company.aiAgentLogic.connectionMessages.voice.prerecorded.activeDuration = estimatedDuration;
        company.aiAgentLogic.connectionMessages.voice.prerecorded.activeFileSize = fileSize;
        company.aiAgentLogic.connectionMessages.voice.prerecorded.uploadedBy = req.user.userId;
        company.aiAgentLogic.connectionMessages.voice.prerecorded.uploadedAt = new Date();

        company.aiAgentLogic.connectionMessages.lastUpdated = new Date();

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${req.params.companyId}`);
        } catch (cacheError) {
            console.warn('[CONNECTION MESSAGES] Cache clear failed:', cacheError.message);
        }

        console.log(`[CONNECTION MESSAGES] ✅ Audio uploaded: ${fileName}`);

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
        console.error('[CONNECTION MESSAGES] Error uploading file:', error);
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
    console.log(`[CONNECTION MESSAGES] DELETE /voice/remove for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId);

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (!company.aiAgentLogic?.connectionMessages?.voice?.prerecorded?.activeFileUrl) {
            return res.status(404).json({ error: 'No audio file to remove' });
        }

        // Delete file from disk
        const filePath = path.join(__dirname, '../../public', company.aiAgentLogic.connectionMessages.voice.prerecorded.activeFileUrl);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[CONNECTION MESSAGES] Deleted file: ${filePath}`);
        }

        // Clear prerecorded settings
        company.aiAgentLogic.connectionMessages.voice.prerecorded = {
            activeFileUrl: null,
            activeFileName: null,
            activeDuration: null,
            activeFileSize: null,
            uploadedBy: null,
            uploadedAt: null
        };

        company.aiAgentLogic.connectionMessages.lastUpdated = new Date();

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${req.params.companyId}`);
        } catch (cacheError) {
            console.warn('[CONNECTION MESSAGES] Cache clear failed:', cacheError.message);
        }

        console.log(`[CONNECTION MESSAGES] ✅ Audio file removed`);

        res.json({
            success: true,
            message: 'Audio file removed successfully'
        });

    } catch (error) {
        console.error('[CONNECTION MESSAGES] Error removing file:', error);
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
    console.log(`[CONNECTION MESSAGES] POST /voice/generate for company: ${req.params.companyId}`);

    try {
        const { text, voiceId } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        if (!voiceId) {
            return res.status(400).json({ error: 'Voice ID is required' });
        }

        // Get company for ElevenLabs API key
        const company = await Company.findById(req.params.companyId).select('aiAgentLogic companyName');

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        console.log(`[CONNECTION MESSAGES] Generating audio with ElevenLabs for company: ${company.companyName}`);
        console.log(`[CONNECTION MESSAGES] Text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        console.log(`[CONNECTION MESSAGES] Voice ID: ${voiceId}`);

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

        console.log(`[CONNECTION MESSAGES] ✅ Audio generated successfully (${audioBuffer.length} bytes)`);

        // Set headers for audio download
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="greeting_${Date.now()}.mp3"`);
        res.setHeader('Content-Length', audioBuffer.length);

        // Send audio buffer
        res.send(audioBuffer);

    } catch (error) {
        console.error('[CONNECTION MESSAGES] Error generating audio:', error);
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
    console.log(`[CONNECTION MESSAGES] POST /reset for company: ${req.params.companyId}`);

    try {
        const company = await Company.findById(req.params.companyId);

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Remove audio file if exists
        if (company.aiAgentLogic?.connectionMessages?.voice?.prerecorded?.activeFileUrl) {
            const filePath = path.join(__dirname, '../../public', company.aiAgentLogic.connectionMessages.voice.prerecorded.activeFileUrl);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[CONNECTION MESSAGES] Deleted file: ${filePath}`);
            }
        }

        // Reset to defaults
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }
        company.aiAgentLogic.connectionMessages = getDefaultConfig();

        await company.save();

        // Clear cache
        try {
            await redisClient.del(`company:${req.params.companyId}`);
        } catch (cacheError) {
            console.warn('[CONNECTION MESSAGES] Cache clear failed:', cacheError.message);
        }

        console.log(`[CONNECTION MESSAGES] ✅ Reset to defaults`);

        res.json({
            success: true,
            message: 'Reset to defaults successfully',
            config: company.aiAgentLogic.connectionMessages
        });

    } catch (error) {
        console.error('[CONNECTION MESSAGES] Error resetting:', error);
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
            // Intelligent Fallback System
            fallback: {
                enabled: true,
                voiceMessage: "We're experiencing technical difficulties. Please hold while we connect you to our team.",
                smsEnabled: true,
                smsMessage: "Sorry, our voice system missed your call. How can we help you?",
                notifyAdmin: true,
                adminNotificationMethod: 'sms' // sms | email | both
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

