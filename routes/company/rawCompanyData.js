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
                    isActive: flow.isActive,
                    priority: flow.priority,
                    isTemplate: flow.isTemplate,
                    
                    // ═══════════════════════════════════════════════════════════
                    // TRIGGERS - FULL RAW ARRAY (schema uses 'triggers' not 'trigger')
                    // ═══════════════════════════════════════════════════════════
                    triggers_RAW: flow.triggers || [],
                    // Also show legacy field if present (backward compat)
                    trigger_LEGACY: flow.trigger || null,
                    
                    // Analyzed paths for debugging
                    trigger_analysis: (() => {
                        const firstTrigger = flow.triggers?.[0] || flow.trigger;
                        return {
                            source: flow.triggers?.length > 0 ? 'triggers[] (correct)' : (flow.trigger ? 'trigger (legacy)' : '❌ MISSING'),
                            triggersCount: flow.triggers?.length || 0,
                            type: firstTrigger?.type || '❌ MISSING',
                            'v2_path_config.phrases': firstTrigger?.config?.phrases || [],
                            'v2_path_config.phrases.length': firstTrigger?.config?.phrases?.length || 0,
                            'legacy_path_phrases': firstTrigger?.phrases || [],
                            'legacy_path_phrases.length': firstTrigger?.phrases?.length || 0,
                            schemaDetected: firstTrigger?.config?.phrases?.length > 0 ? 'v2' : 
                                           firstTrigger?.phrases?.length > 0 ? 'legacy' : 'empty'
                        };
                    })(),
                    
                    // ═══════════════════════════════════════════════════════════
                    // ACTIONS - FULL RAW ARRAY
                    // ═══════════════════════════════════════════════════════════
                    actions_RAW: flow.actions || [],
                    actions_analysis: {
                        count: flow.actions?.length || 0,
                        types: flow.actions?.map(a => a.type) || [],
                        hasSetFlag: flow.actions?.some(a => a.type === 'set_flag'),
                        hasAppendLedger: flow.actions?.some(a => a.type === 'append_ledger'),
                        hasAckOnce: flow.actions?.some(a => a.type === 'ack_once'),
                        hasTransitionMode: flow.actions?.some(a => a.type === 'transition_mode'),
                        completeV1: flow.actions?.length >= 4 && 
                            flow.actions?.some(a => a.type === 'set_flag') &&
                            flow.actions?.some(a => a.type === 'append_ledger') &&
                            flow.actions?.some(a => a.type === 'ack_once') &&
                            flow.actions?.some(a => a.type === 'transition_mode')
                    },
                    
                    // Settings
                    settings: flow.settings,
                    
                    // Metadata
                    tradeCategoryId: flow.tradeCategoryId,
                    tradeCategoryName: flow.tradeCategoryName,
                    templateId: flow.templateId,
                    
                    // Timestamps
                    createdAt: flow.createdAt,
                    updatedAt: flow.updatedAt
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

/**
 * POST /api/company/:companyId/raw/save-flow-json
 * 
 * Saves a dynamic flow from raw JSON input.
 * Validates V2 schema before saving.
 * Upserts by (companyId + flowKey).
 */
router.post('/save-flow-json', async (req, res) => {
    const { companyId } = req.params;
    const { flow } = req.body;
    
    if (!flow || typeof flow !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'flow (object) is required in body'
        });
    }
    
    logger.info('[SAVE FLOW JSON] Initiated', { 
        companyId, 
        flowKey: flow.flowKey 
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // VALIDATE V2 SCHEMA
    // ═══════════════════════════════════════════════════════════════════════
    const validationErrors = [];
    
    if (!flow.flowKey) {
        validationErrors.push('flowKey is required');
    }
    
    if (!flow.trigger?.type) {
        validationErrors.push('trigger.type is required');
    }
    
    if (flow.trigger?.type === 'phrase' && (!flow.trigger?.config?.phrases || flow.trigger.config.phrases.length === 0)) {
        validationErrors.push('trigger.config.phrases must have at least 1 phrase for phrase triggers');
    }
    
    if (!flow.actions || flow.actions.length === 0) {
        validationErrors.push('actions array is required and must not be empty');
    }
    
    // Check for V1 action completeness
    const actionTypes = (flow.actions || []).map(a => a.type);
    const requiredActions = ['set_flag', 'append_ledger', 'ack_once', 'transition_mode'];
    const missingActions = requiredActions.filter(t => !actionTypes.includes(t));
    
    if (missingActions.length > 0) {
        validationErrors.push(`V1 flows should have all 4 action types. Missing: ${missingActions.join(', ')}`);
    }
    
    if (validationErrors.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Schema validation failed',
            validationErrors
        });
    }
    
    try {
        // Build the flow document
        // NOTE: The DynamicFlow model uses 'triggers' (array) not 'trigger' (object)
        const flowDoc = {
            companyId: new mongoose.Types.ObjectId(companyId),
            flowKey: flow.flowKey,
            name: flow.name || flow.flowKey,
            enabled: flow.enabled !== false,
            isActive: flow.enabled !== false,
            isTemplate: false,
            priority: flow.priority || 100,
            
            // CRITICAL: Schema uses 'triggers' (array), not 'trigger'
            // Support both input formats for flexibility
            triggers: flow.triggers ? flow.triggers : (flow.trigger ? [flow.trigger] : []),
            
            actions: flow.actions,
            settings: flow.settings || { allowConcurrent: false },
            
            metadata: {
                ...(flow.metadata || {}),
                savedVia: 'save-flow-json',
                savedAt: new Date().toISOString()
            }
        };
        
        logger.info('[SAVE FLOW JSON] Flow doc built', {
            companyId,
            flowKey: flowDoc.flowKey,
            triggersCount: flowDoc.triggers.length,
            triggerType: flowDoc.triggers[0]?.type,
            phrasesCount: flowDoc.triggers[0]?.config?.phrases?.length || 0,
            actionsCount: flowDoc.actions?.length
        });
        
        // Upsert by companyId + flowKey
        const result = await DynamicFlow.findOneAndUpdate(
            {
                companyId: flowDoc.companyId,
                flowKey: flowDoc.flowKey,
                isTemplate: false
            },
            { $set: flowDoc },
            { new: true, upsert: true }
        );
        
        // Verify
        const verify = await DynamicFlow.findById(result._id).lean();
        
        // Get first trigger (the schema uses 'triggers' array)
        const firstTrigger = verify.triggers?.[0];
        
        const verification = {
            _id: verify._id,
            flowKey: verify.flowKey,
            triggersCount: verify.triggers?.length || 0,
            triggerType: firstTrigger?.type || 'missing',
            triggerPhrasesCount: firstTrigger?.config?.phrases?.length || 0,
            triggerPhrasesSample: firstTrigger?.config?.phrases?.slice(0, 3) || [],
            actionsCount: verify.actions?.length || 0,
            actionTypes: verify.actions?.map(a => a.type) || [],
            schemaUsed: firstTrigger?.config?.phrases?.length > 0 ? 'v2' : 'legacy',
            enabled: verify.enabled
        };
        
        logger.info('[SAVE FLOW JSON] Success', {
            companyId,
            flowKey: flow.flowKey,
            verification
        });
        
        res.json({
            success: true,
            operation: result.isNew ? 'created' : 'updated',
            verification,
            message: `Flow "${flow.flowKey}" saved successfully with V2 schema`
        });
        
    } catch (error) {
        logger.error('[SAVE FLOW JSON] Error', {
            companyId,
            flowKey: flow.flowKey,
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
 * POST /api/company/:companyId/raw/convert-flow-to-v2
 * 
 * Converts a legacy flow to V2 schema.
 * Fixes the "schemaUsed: legacy" problem.
 */
router.post('/convert-flow-to-v2', async (req, res) => {
    const { companyId } = req.params;
    const { flowKey } = req.body;
    
    if (!flowKey) {
        return res.status(400).json({
            success: false,
            error: 'flowKey is required'
        });
    }
    
    logger.info('[CONVERT TO V2] Initiated', { companyId, flowKey });
    
    try {
        // Find the flow
        const flow = await DynamicFlow.findOne({
            companyId: new mongoose.Types.ObjectId(companyId),
            flowKey: flowKey,
            isTemplate: { $ne: true }
        });
        
        if (!flow) {
            return res.status(404).json({
                success: false,
                error: `Flow "${flowKey}" not found for this company`
            });
        }
        
        // Detect current schema
        const hasV2Trigger = flow.trigger?.config?.phrases?.length > 0;
        const hasLegacyTrigger = flow.trigger?.phrases?.length > 0;
        const currentSchema = hasV2Trigger ? 'v2' : (hasLegacyTrigger ? 'legacy' : 'empty');
        
        // Get phrases from wherever they are
        let phrases = [];
        if (hasV2Trigger) {
            phrases = flow.trigger.config.phrases;
        } else if (hasLegacyTrigger) {
            phrases = flow.trigger.phrases;
        }
        
        // If no phrases anywhere, provide defaults for emergency_service
        if (phrases.length === 0 && flowKey.includes('emergency')) {
            phrases = [
                'emergency',
                'no heat',
                'no AC',
                'no air',
                'gas smell',
                'carbon monoxide',
                'water leak',
                'flooding',
                'smoke',
                'fire'
            ];
        }
        
        // Build V2 trigger
        const v2Trigger = {
            type: 'phrase',
            config: {
                phrases: phrases,
                fuzzy: flow.trigger?.fuzzy ?? flow.trigger?.config?.fuzzy ?? true,
                minConfidence: flow.trigger?.minConfidence ?? flow.trigger?.config?.minConfidence ?? 0.7
            },
            priority: flow.trigger?.priority ?? flow.priority ?? 100,
            description: flow.trigger?.description || `Trigger for ${flowKey}`
        };
        
        // Build V2 actions if missing or incomplete
        let v2Actions = flow.actions || [];
        
        // Check if actions are in V2 format
        const hasValidActions = v2Actions.length >= 4 && 
            v2Actions.some(a => a.type === 'set_flag') &&
            v2Actions.some(a => a.type === 'append_ledger') &&
            v2Actions.some(a => a.type === 'ack_once') &&
            v2Actions.some(a => a.type === 'transition_mode');
        
        if (!hasValidActions && flowKey.includes('emergency')) {
            // Provide default emergency actions
            v2Actions = [
                {
                    timing: 'on_activate',
                    type: 'set_flag',
                    config: {
                        flagName: 'isEmergency',
                        flagValue: true,
                        alsoWriteToCallLedgerFacts: true
                    },
                    description: 'Mark as emergency'
                },
                {
                    timing: 'on_activate',
                    type: 'append_ledger',
                    config: {
                        type: 'EVENT',
                        key: 'EMERGENCY_DETECTED',
                        note: 'Caller indicated emergency situation'
                    },
                    description: 'Log emergency to ledger'
                },
                {
                    timing: 'on_activate',
                    type: 'ack_once',
                    config: {
                        text: "I understand this is urgent. Let me get you help right away."
                    },
                    description: 'Acknowledge emergency'
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
            ];
        }
        
        // Update the flow
        flow.trigger = v2Trigger;
        flow.actions = v2Actions;
        flow.enabled = true;
        flow.isActive = true;
        
        await flow.save();
        
        // Verify the conversion
        const verifyFlow = await DynamicFlow.findById(flow._id).lean();
        
        const verification = {
            flowKey: verifyFlow.flowKey,
            triggerType: verifyFlow.trigger?.type,
            triggerPhrasesCount: verifyFlow.trigger?.config?.phrases?.length || 0,
            triggerPhrasesSample: verifyFlow.trigger?.config?.phrases?.slice(0, 5) || [],
            actionsCount: verifyFlow.actions?.length || 0,
            actionTypes: verifyFlow.actions?.map(a => a.type) || [],
            schemaUsed: verifyFlow.trigger?.config?.phrases?.length > 0 ? 'v2' : 'legacy',
            enabled: verifyFlow.enabled
        };
        
        const conversionSuccess = 
            verification.triggerType === 'phrase' &&
            verification.triggerPhrasesCount > 0 &&
            verification.actionsCount >= 4;
        
        logger.info('[CONVERT TO V2] Result', {
            companyId,
            flowKey,
            currentSchema,
            verification,
            conversionSuccess
        });
        
        res.json({
            success: conversionSuccess,
            previousSchema: currentSchema,
            verification,
            message: conversionSuccess 
                ? `Flow "${flowKey}" converted to V2 schema successfully`
                : `Conversion completed but verification failed. Check verification object.`
        });
        
    } catch (error) {
        logger.error('[CONVERT TO V2] Error', {
            companyId,
            flowKey,
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

