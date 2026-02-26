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
                // V110: Slots come from slotRegistry + bookingFlow
                slotRegistry: frontDesk.slotRegistry,
                bookingFlow: frontDesk.bookingFlow,
                slotCount: frontDesk.slotRegistry?.slots?.length || 0
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

// ☢️ NUKED Feb 2026: save-greeting — Agent 2.0 owns greetings via /api/admin/agent2/:companyId/greetings/call-start
router.post('/save-greeting', async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'NUKED: Legacy frontDeskBehavior.greeting removed. Use Agent Console greetings.'
    });
});

// ☢️ NUKED Feb 2026: save-flow-json endpoint removed - V110 architecture replaces Dynamic Flows
router.post('/save-flow-json', async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'Dynamic Flows have been removed. V110 architecture replaces this functionality.'
    });
});

// ☢️ NUKED Feb 2026: write-test-greeting — Legacy debug endpoint removed
router.post('/write-test-greeting', async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'NUKED: Legacy greeting test endpoint removed.'
    });
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

