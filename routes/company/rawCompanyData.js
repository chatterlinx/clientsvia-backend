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
const DynamicFlow = require('../../models/DynamicFlow');
const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');
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
        
        // Fetch company's dynamic flows
        const dynamicFlows = await DynamicFlow.find({
            companyId: new mongoose.Types.ObjectId(companyId),
            isTemplate: false
        }).lean();
        
        // Fetch cheat sheet (call protection rules)
        const cheatSheet = await CheatSheetVersion.findOne({
            companyId: new mongoose.Types.ObjectId(companyId),
            isActive: true
        }).lean();
        
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
            
            // ═══════════════════════════════════════════════════════════════
            // DYNAMIC FLOWS (company-specific, not templates)
            // ═══════════════════════════════════════════════════════════════
            dynamicFlows: {
                count: dynamicFlows.length,
                flows: dynamicFlows.map(flow => ({
                    _id: flow._id,
                    flowKey: flow.flowKey,
                    name: flow.name,
                    enabled: flow.enabled,
                    priority: flow.priority,
                    isTemplate: flow.isTemplate,
                    
                    // TRIGGER (raw)
                    trigger: {
                        type: flow.trigger?.type,
                        'config.phrases': flow.trigger?.config?.phrases || [],
                        'config.phrases.length': flow.trigger?.config?.phrases?.length || 0,
                        'config.fuzzy': flow.trigger?.config?.fuzzy,
                        'config.minConfidence': flow.trigger?.config?.minConfidence,
                        priority: flow.trigger?.priority
                    },
                    
                    // ACTIONS (raw)
                    actions: flow.actions?.map(a => ({
                        type: a.type,
                        timing: a.timing,
                        config: a.config,
                        description: a.description
                    })) || [],
                    actionsCount: flow.actions?.length || 0,
                    actionTypes: flow.actions?.map(a => a.type) || [],
                    
                    // Settings
                    settings: flow.settings,
                    
                    // Metadata
                    tradeCategoryId: flow.tradeCategoryId,
                    tradeCategoryName: flow.tradeCategoryName,
                    templateId: flow.templateId
                }))
            },
            
            // ═══════════════════════════════════════════════════════════════
            // CALL PROTECTION (edge cases from cheat sheet)
            // ═══════════════════════════════════════════════════════════════
            callProtection: {
                hasCheatSheet: !!cheatSheet,
                edgeCases: (cheatSheet?.config?.edgeCases || []).map(rule => ({
                    name: rule.name,
                    enabled: rule.enabled,
                    priority: rule.priority,
                    
                    // Match config
                    'match.keywordsAny': rule.match?.keywordsAny || [],
                    'match.keywordsAny.length': rule.match?.keywordsAny?.length || 0,
                    
                    // Legacy patterns
                    triggerPatterns: rule.triggerPatterns || [],
                    'triggerPatterns.length': rule.triggerPatterns?.length || 0,
                    
                    // Action
                    'action.type': rule.action?.type,
                    'action.hangupMessage': rule.action?.hangupMessage,
                    'action.transferTarget': rule.action?.transferTarget
                })),
                edgeCasesCount: cheatSheet?.config?.edgeCases?.length || 0
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
            dynamicFlowsCount: rawData.dynamicFlows.count,
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

/**
 * POST /api/company/:companyId/raw/write-test-dynamic-flow
 * 
 * Writes a test emergency_service flow with CORRECT V2 schema.
 * Verifies the DynamicFlow save pipeline works end-to-end.
 */
router.post('/write-test-dynamic-flow', async (req, res) => {
    const { companyId } = req.params;
    
    logger.info('[WRITE TEST] Dynamic flow test initiated', { companyId });
    
    try {
        const timestamp = Date.now();
        
        // V2 CORRECT SCHEMA - This is what the runtime expects
        const testFlow = {
            companyId: new mongoose.Types.ObjectId(companyId),
            flowKey: 'emergency_service_test',
            name: `Emergency Service Test (${timestamp})`,
            priority: 200,
            enabled: true,
            isActive: true,
            isTemplate: false,
            
            // V2 TRIGGER SCHEMA
            trigger: {
                type: 'phrase',  // lowercase
                config: {
                    phrases: [
                        'emergency',
                        'no AC',
                        'no heat',
                        'smoke smell',
                        'water leak',
                        'gas smell'
                    ],
                    fuzzy: true,
                    minConfidence: 0.7
                },
                priority: 200,
                description: 'Test emergency detection trigger'
            },
            
            // V2 ACTIONS SCHEMA
            actions: [
                {
                    timing: 'on_activate',
                    type: 'set_flag',
                    config: {
                        flagName: 'isEmergencyTest',
                        flagValue: true,
                        alsoWriteToCallLedgerFacts: true
                    },
                    description: 'Mark as emergency test'
                },
                {
                    timing: 'on_activate',
                    type: 'append_ledger',
                    config: {
                        type: 'EVENT',
                        key: 'EMERGENCY_TEST_DETECTED',
                        note: 'Test emergency detection triggered'
                    },
                    description: 'Log to ledger'
                },
                {
                    timing: 'on_activate',
                    type: 'ack_once',
                    config: {
                        text: 'I understand this is a test emergency. Let me help.'
                    },
                    description: 'Acknowledge test'
                },
                {
                    timing: 'on_complete',
                    type: 'transition_mode',
                    config: {
                        targetMode: 'BOOKING',
                        setBookingLocked: true
                    },
                    description: 'Transition to booking'
                }
            ],
            
            settings: {
                allowConcurrent: false
            },
            
            metadata: {
                version: 1,
                createdBy: 'write-test',
                tags: ['test', 'emergency']
            }
        };
        
        // Delete any existing test flow first
        await DynamicFlow.deleteOne({
            companyId: new mongoose.Types.ObjectId(companyId),
            flowKey: 'emergency_service_test'
        });
        
        // Create the test flow
        const createdFlow = await DynamicFlow.create(testFlow);
        
        // Verify by reading back
        const verifyFlow = await DynamicFlow.findOne({
            companyId: new mongoose.Types.ObjectId(companyId),
            flowKey: 'emergency_service_test'
        }).lean();
        
        // Check what we got back
        const verification = {
            flowCreated: !!createdFlow,
            flowFound: !!verifyFlow,
            flowKey: verifyFlow?.flowKey,
            triggerType: verifyFlow?.trigger?.type,
            triggerPhrasesCount: verifyFlow?.trigger?.config?.phrases?.length || 0,
            triggerPhrasesSample: verifyFlow?.trigger?.config?.phrases?.slice(0, 3) || [],
            actionsCount: verifyFlow?.actions?.length || 0,
            actionTypes: verifyFlow?.actions?.map(a => a.type) || [],
            enabled: verifyFlow?.enabled,
            isTemplate: verifyFlow?.isTemplate
        };
        
        const allChecksPass = 
            verification.flowFound &&
            verification.triggerType === 'phrase' &&
            verification.triggerPhrasesCount >= 4 &&
            verification.actionsCount === 4 &&
            verification.enabled === true &&
            verification.isTemplate === false;
        
        logger.info('[WRITE TEST] Dynamic flow result', {
            companyId,
            verification,
            allChecksPass
        });
        
        res.json({
            success: allChecksPass,
            testFlowKey: 'emergency_service_test',
            verification,
            allChecksPass,
            message: allChecksPass 
                ? 'Write test PASSED - Dynamic flow created with correct V2 schema'
                : 'Write test PARTIAL - Flow created but verification failed. Check verification object.'
        });
        
    } catch (error) {
        logger.error('[WRITE TEST] Dynamic flow error', {
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
 * DELETE /api/company/:companyId/raw/cleanup-test-flows
 * 
 * Removes test flows created by write tests.
 */
router.delete('/cleanup-test-flows', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const result = await DynamicFlow.deleteMany({
            companyId: new mongoose.Types.ObjectId(companyId),
            flowKey: { $regex: /^(emergency_service_test|DEBUG_)/ }
        });
        
        res.json({
            success: true,
            deletedCount: result.deletedCount
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

