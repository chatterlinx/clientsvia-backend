/**
 * ============================================================================
 * GLOBAL AI BRAIN - TWILIO TEST ROUTES
 * ============================================================================
 * 
 * PURPOSE:
 * Allows admins to test Global AI Brain templates via dedicated test phone numbers
 * COMPLETELY ISOLATED from production company phone numbers
 * 
 * ARCHITECTURE:
 * - Each template can have ONE unique test phone number
 * - Admin toggles testing ON/OFF per template
 * - Test calls use HybridScenarioSelector on template scenarios
 * - NO CROSSOVER with company production routes
 * 
 * SECURITY:
 * - Admin-only routes (JWT required)
 * - Phone number uniqueness enforced
 * - Toggle prevents accidental production exposure
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const HybridScenarioSelector = require('../../services/HybridScenarioSelector');
const twilio = require('twilio');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// ============================================
// UPDATE TEST CONFIGURATION
// ============================================

/**
 * POST /api/admin/global-ai-brain-test/:templateId/config
 * Update Twilio test configuration for a template
 */
router.post('/:templateId/config', authenticateJWT, async (req, res) => {
    try {
        const { templateId } = req.params;
        const { enabled, phoneNumber, notes } = req.body;
        
        logger.info(`📞 [TEST CONFIG] Updating test config for template ${templateId}`, {
            enabled,
            phoneNumber,
            user: req.user?.email
        });
        
        // Validate phone number format if provided
        if (phoneNumber && phoneNumber.trim()) {
            if (!phoneNumber.match(/^\+\d{10,15}$/)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid phone number format. Must be E.164 format (e.g., +15551234567)'
                });
            }
            
            // Check if phone number already in use by another template
            const existing = await GlobalInstantResponseTemplate.findOne({
                'twilioTest.phoneNumber': phoneNumber,
                _id: { $ne: templateId }
            });
            
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: `Phone number already in use by template: ${existing.name}`
                });
            }
        }
        
        // Update template
        const template = await GlobalInstantResponseTemplate.findByIdAndUpdate(
            templateId,
            {
                $set: {
                    'twilioTest.enabled': enabled || false,
                    'twilioTest.phoneNumber': phoneNumber?.trim() || null,
                    'twilioTest.notes': notes || ''
                }
            },
            { new: true }
        ).select('name version twilioTest');
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        logger.info(`✅ [TEST CONFIG] Updated successfully`, {
            templateId,
            templateName: template.name,
            enabled: template.twilioTest.enabled,
            phoneNumber: template.twilioTest.phoneNumber
        });
        
        res.json({
            success: true,
            message: 'Test configuration updated successfully',
            data: {
                twilioTest: template.twilioTest
            }
        });
        
    } catch (error) {
        logger.error(`❌ [TEST CONFIG] Error updating config`, {
            templateId: req.params.templateId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            message: 'Failed to update test configuration',
            error: error.message
        });
    }
});

// ============================================
// TWILIO WEBHOOK - TEST CALL HANDLER
// ============================================

/**
 * POST /api/admin/global-ai-brain-test/twilio/voice
 * Twilio webhook for incoming test calls
 * Routes to Global AI Brain template based on called phone number
 */
router.post('/twilio/voice', async (req, res) => {
    const callSid = req.body.CallSid || 'UNKNOWN';
    const from = req.body.From || 'UNKNOWN';
    const to = req.body.To || 'UNKNOWN';
    
    logger.info(`📞 [TEST CALL] Incoming test call`, {
        callSid,
        from,
        to
    });
    
    try {
        const twiml = new twilio.twiml.VoiceResponse();
        
        // Find template by test phone number
        const template = await GlobalInstantResponseTemplate.findOne({
            'twilioTest.phoneNumber': to,
            'twilioTest.enabled': true
        }).select('name version categories twilioTest');
        
        if (!template) {
            logger.warn(`⚠️ [TEST CALL] No active test template found for phone: ${to}`);
            twiml.say('Test template not found or not enabled. Please check your configuration.');
            twiml.hangup();
            return res.type('text/xml').send(twiml.toString());
        }
        
        logger.info(`✅ [TEST CALL] Found template: ${template.name} (${template.version})`);
        
        // Increment test call count
        await GlobalInstantResponseTemplate.findByIdAndUpdate(template._id, {
            $inc: { 'twilioTest.testCallCount': 1 },
            $set: { 'twilioTest.lastTestedAt': new Date() }
        });
        
        // Greeting
        const greeting = `Testing ${template.name}. What would you like to ask?`;
        
        // Set up speech gathering
        const gather = twiml.gather({
            input: 'speech',
            action: `/api/admin/global-ai-brain-test/twilio/respond/${template._id}`,
            method: 'POST',
            timeout: 5,
            speechTimeout: 'auto',
            enhanced: true,
            speechModel: 'phone_call'
        });
        
        gather.say(greeting);
        
        // Fallback
        twiml.say('I did not receive any input. Goodbye.');
        twiml.hangup();
        
        res.type('text/xml').send(twiml.toString());
        
    } catch (error) {
        logger.error(`❌ [TEST CALL] Error handling test call`, {
            callSid,
            error: error.message
        });
        
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('System error during test call. Please contact support.');
        twiml.hangup();
        res.type('text/xml').send(twiml.toString());
    }
});

/**
 * POST /api/admin/global-ai-brain-test/twilio/respond/:templateId
 * Handle user speech during test call
 */
router.post('/twilio/respond/:templateId', async (req, res) => {
    const { templateId } = req.params;
    const callSid = req.body.CallSid || 'UNKNOWN';
    const speechResult = req.body.SpeechResult || '';
    
    logger.info(`🗣️ [TEST RESPONSE] Processing speech`, {
        templateId,
        callSid,
        speech: speechResult.substring(0, 100)
    });
    
    try {
        const twiml = new twilio.twiml.VoiceResponse();
        
        if (!speechResult || speechResult.trim() === '') {
            logger.warn(`⚠️ [TEST RESPONSE] Empty speech result`);
            twiml.say('I did not hear anything. Please try again.');
            twiml.hangup();
            return res.type('text/xml').send(twiml.toString());
        }
        
        // Load template
        const template = await GlobalInstantResponseTemplate.findById(templateId)
            .select('name categories')
            .lean();
        
        if (!template) {
            logger.error(`❌ [TEST RESPONSE] Template not found: ${templateId}`);
            twiml.say('Template not found.');
            twiml.hangup();
            return res.type('text/xml').send(twiml.toString());
        }
        
        // Flatten scenarios
        let allScenarios = [];
        for (const category of template.categories || []) {
            if (category.scenarios && category.scenarios.length > 0) {
                allScenarios = allScenarios.concat(category.scenarios);
            }
        }
        
        logger.info(`🧠 [TEST RESPONSE] Testing against ${allScenarios.length} scenarios`);
        
        if (allScenarios.length === 0) {
            twiml.say('This template has no scenarios configured yet.');
            twiml.hangup();
            return res.type('text/xml').send(twiml.toString());
        }
        
        // Use HybridScenarioSelector
        const matchContext = {
            channel: 'voice',
            language: 'auto',
            conversationState: {},
            recentScenarios: {},
            lastIntent: null,
            callerProfile: null
        };
        
        const result = await HybridScenarioSelector.selectScenario(
            speechResult,
            allScenarios,
            matchContext
        );
        
        let responseText = '';
        
        if (result.scenario && result.confidence > 0) {
            logger.info(`✅ [TEST RESPONSE] Matched scenario: ${result.scenario.name}`, {
                confidence: result.confidence.toFixed(3),
                score: result.score.toFixed(3)
            });
            
            // Select reply
            const useQuickReply = Math.random() < 0.3;
            let replyVariants = useQuickReply ? 
                result.scenario.quickReplies : 
                result.scenario.fullReplies;
            
            if (!replyVariants || replyVariants.length === 0) {
                replyVariants = result.scenario.fullReplies || result.scenario.quickReplies || [];
            }
            
            responseText = replyVariants[Math.floor(Math.random() * replyVariants.length)] || 
                          "I'm here to help!";
            
            // Add debug info
            const debugInfo = ` ... Matched scenario: ${result.scenario.name}, confidence: ${(result.confidence * 100).toFixed(0)}%, score: ${(result.score * 100).toFixed(0)}%`;
            responseText += debugInfo;
            
        } else {
            logger.info(`ℹ️ [TEST RESPONSE] No match found`, {
                bestConfidence: result.confidence || 0
            });
            responseText = `No matching scenario found for: "${speechResult}". Best confidence was ${((result.confidence || 0) * 100).toFixed(0)}%`;
        }
        
        // Return response
        twiml.say(responseText);
        twiml.pause({ length: 1 });
        twiml.say('Test complete. Goodbye.');
        twiml.hangup();
        
        res.type('text/xml').send(twiml.toString());
        
    } catch (error) {
        logger.error(`❌ [TEST RESPONSE] Error processing speech`, {
            templateId,
            callSid,
            error: error.message,
            stack: error.stack
        });
        
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('System error during test. Please try again.');
        twiml.hangup();
        res.type('text/xml').send(twiml.toString());
    }
});

module.exports = router;

