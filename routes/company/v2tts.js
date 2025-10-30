/**
 * V2 Text-to-Speech (TTS) API Routes
 * ElevenLabs integration for voice testing and preview
 * 
 * Used by AI Voice Settings tab for:
 * - Voice preview/testing
 * - Custom text generation
 * - Audio download
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const { ObjectId } = require('mongodb');
const Company = require('../../models/v2Company');
const { synthesizeSpeech } = require('../../services/v2elevenLabsService');
const { authenticateJWT } = require('../../middleware/auth');

// 🔒 SECURITY: Require authentication for all routes
router.use(authenticateJWT);

/**
 * @route   POST /api/company/:companyId/v2-tts/generate
 * @desc    Generate TTS audio using ElevenLabs
 * @access  Private
 */
router.post('/:companyId/v2-tts/generate', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { text, voiceId, stability, similarity_boost, style, model_id } = req.body;
        
        logger.info(`🎤 [TTS] Generate request for company: ${companyId}`);
        logger.info(`🎤 [TTS] Voice: ${voiceId}, Text length: ${text?.length || 0} chars`);
        
        // Validation
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid company ID format'
            });
        }
        
        if (!text || !text.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Text is required'
            });
        }
        
        if (!voiceId) {
            return res.status(400).json({
                success: false,
                error: 'Voice ID is required'
            });
        }
        
        // Get company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        logger.info(`🎤 [TTS] Company: ${company.companyName}`);
        
        // Prepare voice settings (use provided values or defaults)
        const voiceSettings = {
            stability: stability !== undefined ? parseFloat(stability) : 0.5,
            similarity_boost: similarity_boost !== undefined ? parseFloat(similarity_boost) : 0.7,
            style: style !== undefined ? parseFloat(style) : 0.0
        };
        
        const options = {
            text: text.trim(),
            voiceId,
            company,
            model_id: model_id || 'eleven_turbo_v2_5',
            voice_settings: voiceSettings,
            output_format: 'mp3_44100_128'
        };
        
        logger.info(`🎤 [TTS] Generating audio with settings:`, {
            model: options.model_id,
            voiceSettings,
            textLength: text.length
        });
        
        // Generate audio
        const audioBuffer = await synthesizeSpeech(options);
        
        logger.info(`✅ [TTS] Audio generated successfully: ${audioBuffer.length} bytes`);
        
        // Set headers for audio download
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.length,
            'Content-Disposition': `attachment; filename="voice-test-${Date.now()}.mp3"`,
            'Cache-Control': 'no-cache'
        });
        
        res.send(audioBuffer);
        
    } catch (error) {
        logger.error('❌ [TTS] Error generating audio:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate audio',
            message: error.message
        });
    }
});

module.exports = router;

