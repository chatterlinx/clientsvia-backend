/**
 * ============================================================================
 * RAW COMPANY DATA API - DB Echo for Truth Report
 * ============================================================================
 * 
 * Returns raw (sanitized) company data directly from MongoDB.
 * Used by Truth Report to compare DB state vs runtime snapshot.
 * 
 * CRITICAL: This shows what's ACTUALLY in the database, not transformed.
 * If DB Echo differs from snapshot, we have a snapshot reader bug.
 * If DB Echo shows empty, we have a save bug.
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const Company = require('../../models/v2Company');
// ☢️ NUKED Feb 2026: DynamicFlow import removed - V110 architecture replaces Dynamic Flows
// ☢️ NUKED Feb 2026: CheatSheetVersion import removed - full cheat sheet nuke
const logger = require('../../utils/logger');

// Auth middleware
router.use(authenticateJWT);
router.use(requireRole('admin', 'owner'));

/**
 * GET /api/company/:companyId/raw
 * 
 * Returns raw company data for debugging/verification.
 * Sanitized (no secrets, tokens, passwords).
 */
router.get('/', async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    logger.info('[RAW COMPANY DATA] Fetching', { companyId });
    
    try {
        // Validate companyId
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid companyId format'
            });
        }
        
        // Fetch company document
        const company = await Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // ☢️ NUKED Feb 2026: DynamicFlow.find() removed - V110 architecture replaces Dynamic Flows
        
        // CheatSheetVersion fetch REMOVED Feb 2026 — full cheat sheet nuke
        
        // Extract relevant settings (sanitized - no secrets)
        const settings = company.aiAgentSettings || {};
        const frontDesk = settings.frontDeskBehavior || {};
        const fallback = settings.fallbackResponses || {};
        const stages = settings.conversationStages || {};
        
        // Build raw data response
        const rawData = {
            meta: {
                companyId: companyId,
                fetchedAt: new Date().toISOString(),
                fetchTimeMs: 0 // Will be set at end
            },
            
            // ═══════════════════════════════════════════════════════════════
            // COMPANY CORE
            // ═══════════════════════════════════════════════════════════════
            company: {
                _id: company._id,
                companyName: company.companyName,
                status: company.status,
                tradeKey: company.tradeKey || company.industryType,
                createdAt: company.createdAt,
                updatedAt: company.updatedAt
            },
            
            // ═══════════════════════════════════════════════════════════════
            // GREETING FIELDS (all 3 canonical locations)
            // ═══════════════════════════════════════════════════════════════
            greetingFields: {
                // Path 1: frontDeskBehavior.greeting (canonical)
                'frontDeskBehavior.greeting': frontDesk.greeting || null,
                'frontDeskBehavior.greeting.length': frontDesk.greeting?.length || 0,
                
                // Path 2: fallbackResponses.greeting
                'fallbackResponses.greeting': fallback.greeting || null,
                'fallbackResponses.greeting.length': fallback.greeting?.length || 0,
                
                // Path 3: conversationStages.greetingRules
                'conversationStages.greetingRules': stages.greetingRules || [],
                'conversationStages.greetingRules.length': stages.greetingRules?.length || 0,
                
                // Legacy: conversationStages.greetingResponses
                'conversationStages.greetingResponses': stages.greetingResponses || null
            },
            
            // ═══════════════════════════════════════════════════════════════
            // FRONT DESK BEHAVIOR (full object)
            // ═══════════════════════════════════════════════════════════════
            frontDeskBehavior: {
                enabled: frontDesk.enabled,
                conversationStyle: frontDesk.conversationStyle,
                greeting: frontDesk.greeting,
                personality: frontDesk.personality,
                bookingSlots: frontDesk.bookingSlots,
                bookingSlotsCount: frontDesk.bookingSlots?.length || 0
            },
            
            // ☢️ NUKED Feb 2026: DynamicFlow data removed - V110 architecture replaces Dynamic Flows
            dynamicFlows: {
                count: 0,
                flows: []
            },
            
            // ☢️ NUKED Feb 2026: Call protection (cheat sheet edge cases) removed
            callProtection: {
                status: 'REMOVED_FEB_2026',
                note: 'Cheat sheet system nuked — Tier 2 reserved for future rebuild'
            },
            
            // ═══════════════════════════════════════════════════════════════
            // FALLBACK RESPONSES
            // ═══════════════════════════════════════════════════════════════
            fallbackResponses: {
                greeting: fallback.greeting,
                didNotUnderstandTier1: fallback.didNotUnderstandTier1,
                didNotUnderstandTier2: fallback.didNotUnderstandTier2,
                didNotUnderstandTier3: fallback.didNotUnderstandTier3
            },
            
            // ═══════════════════════════════════════════════════════════════
            // CONVERSATION STAGES
            // ═══════════════════════════════════════════════════════════════
            conversationStages: {
                enabled: stages.enabled,
                greetingRules: stages.greetingRules,
                greetingRulesCount: stages.greetingRules?.length || 0,
                greetingResponses: stages.greetingResponses
            }
        };
        
        // Set fetch time
        rawData.meta.fetchTimeMs = Date.now() - startTime;
        
        logger.info('[RAW COMPANY DATA] Success', {
            companyId,
            fetchTimeMs: rawData.meta.fetchTimeMs,
            hasGreeting: !!rawData.greetingFields['frontDeskBehavior.greeting']
        });
        
        res.json({
            success: true,
            ...rawData
        });
        
    } catch (error) {
        logger.error('[RAW COMPANY DATA] Error', {
            companyId,
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/raw/save-greeting
 * 
 * Saves a greeting string to frontDeskBehavior.greeting
 * This is the canonical greeting path.
 */
router.post('/save-greeting', async (req, res) => {
    const { companyId } = req.params;
    const { greeting } = req.body;
    
    if (!greeting || typeof greeting !== 'string') {
        return res.status(400).json({
            success: false,
            error: 'greeting (string) is required in body'
        });
    }
    
    logger.info('[SAVE GREETING] Initiated', { companyId, greetingLength: greeting.length });
    
    try {
        // Write to the canonical path
        const result = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentSettings.frontDeskBehavior.greeting': greeting
                }
            },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Verify it saved
        const savedGreeting = result.aiAgentSettings?.frontDeskBehavior?.greeting;
        const saveSuccess = savedGreeting === greeting;
        
        logger.info('[SAVE GREETING] Result', {
            companyId,
            saveSuccess,
            savedLength: savedGreeting?.length
        });
        
        res.json({
            success: saveSuccess,
            savedTo: 'aiAgentSettings.frontDeskBehavior.greeting',
            savedValue: savedGreeting,
            message: saveSuccess ? 'Greeting saved successfully' : 'Save completed but verification failed'
        });
        
    } catch (error) {
        logger.error('[SAVE GREETING] Error', {
            companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ☢️ NUKED Feb 2026: save-flow-json endpoint removed - V110 architecture replaces Dynamic Flows
router.post('/save-flow-json', async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'Dynamic Flows have been removed. V110 architecture replaces this functionality.'
    });
});

/**
 * POST /api/company/:companyId/raw/write-test-greeting
 * 
 * Writes a test greeting to verify the save pipeline works.
 * This is a UI-driven test, not hardcoding.
 */
router.post('/write-test-greeting', async (req, res) => {
    const { companyId } = req.params;
    
    logger.info('[WRITE TEST] Greeting test initiated', { companyId });
    
    try {
        // Generate test greeting
        const testGreeting = `DEBUG_GREETING__${Date.now()}__${Math.random().toString(36).substring(7)}`;
        
        // Write to DB
        const result = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentSettings.frontDeskBehavior.greeting': testGreeting
                }
            },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Verify the write
        const verify = await Company.findById(companyId).lean();
        const savedValue = verify?.aiAgentSettings?.frontDeskBehavior?.greeting;
        
        const writeSuccess = savedValue === testGreeting;
        
        logger.info('[WRITE TEST] Greeting result', {
            companyId,
            testGreeting,
            savedValue,
            writeSuccess
        });
        
        res.json({
            success: writeSuccess,
            testGreeting,
            savedValue,
            match: writeSuccess,
            message: writeSuccess 
                ? 'Write test PASSED - greeting saved and verified in DB' 
                : 'Write test FAILED - saved value does not match'
        });
        
    } catch (error) {
        logger.error('[WRITE TEST] Error', {
            companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ☢️ NUKED Feb 2026: write-test-dynamic-flow endpoint removed - V110 architecture replaces Dynamic Flows
router.post('/write-test-dynamic-flow', async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'Dynamic Flows have been removed. V110 architecture replaces this functionality.'
    });
});

// ☢️ NUKED Feb 2026: convert-flow-to-v2 endpoint removed - V110 architecture replaces Dynamic Flows
router.post('/convert-flow-to-v2', async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'Dynamic Flows have been removed. V110 architecture replaces this functionality.'
    });
});

// ☢️ NUKED Feb 2026: cleanup-test-flows endpoint removed - V110 architecture replaces Dynamic Flows
router.delete('/cleanup-test-flows', async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'Dynamic Flows have been removed. V110 architecture replaces this functionality.',
        deletedCount: 0
    });
});

module.exports = router;

