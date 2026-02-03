/**
 * ============================================================================
 * FLOW TREE DEFINITION - THE SINGLE SOURCE OF TRUTH
 * ============================================================================
 * 
 * This file defines the ACTUAL flow tree that runtime uses.
 * If a decision isn't in this graph, it doesn't exist.
 * 
 * RULES:
 * 1. Every runtime decision must map to a node
 * 2. Every state transition must map to an edge
 * 3. Runtime MUST emit flowNodeId on every TURN_TRACE
 * 4. Any path not in this graph triggers OUT_OF_TREE_PATH warning
 * 
 * STRUCTURE:
 * - nodes: Decision points, actions, routers
 * - edges: Transitions between nodes with conditions
 * - runtimeBindings: Maps checkpoints to nodes
 * 
 * ============================================================================
 */

const FLOW_TREE_VERSION = '1.0.1';  // V92: Fixed consent flow + renamed turnEnd

// ═══════════════════════════════════════════════════════════════════════════
// NODE TYPES
// ═══════════════════════════════════════════════════════════════════════════
const NODE_TYPES = {
    ENTRY: 'entry',           // Call start
    GUARD: 'guard',           // Validation/gating check
    DETECTOR: 'detector',     // Intent/pattern detection
    DECISION: 'decision',     // Branching point
    ACTION: 'action',         // Something that happens
    ROUTER: 'router',         // Routes to subsystem
    EXIT: 'exit'              // Call end
};

// ═══════════════════════════════════════════════════════════════════════════
// FLOW TREE NODES
// ═══════════════════════════════════════════════════════════════════════════
const NODES = [
    // ─────────────────────────────────────────────────────────────────────────
    // ENTRY POINT
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.callStart',
        label: 'Call Start',
        type: NODE_TYPES.ENTRY,
        description: 'Inbound call received',
        checkpoint: 'CHECKPOINT_1'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // GUARDS (run before any routing)
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.emptyUtteranceGuard',
        label: 'Empty Utterance Guard',
        type: NODE_TYPES.GUARD,
        description: 'V92: Routes empty/punctuation-only input to SilenceHandler',
        checkpoint: 'CHECKPOINT_V92_EMPTY_GUARD',
        configPaths: ['routing.emptyUtteranceGuard.enabled'],
        codeLocation: 'ConversationEngine.js:4604'
    },
    {
        id: 'node.silenceHandler',
        label: 'Silence Handler',
        type: NODE_TYPES.ACTION,
        description: 'Deterministic silence response (0 tokens)',
        checkpoint: 'SILENCE_HANDLER',
        matchSource: 'SILENCE_HANDLER'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // SLOT EXTRACTION
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.slotExtraction',
        label: 'Slot Extraction',
        type: NODE_TYPES.ACTION,
        description: 'Extract name/phone/address/time from utterance',
        checkpoint: 'CHECKPOINT_8',
        configPaths: [
            'frontDesk.bookingSlots',
            'frontDesk.addressValidation.rejectQuestions'
        ],
        codeLocation: 'ConversationEngine.js:4030'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING MODE CHECK
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.bookingModeCheck',
        label: 'Booking Mode Check',
        type: NODE_TYPES.DECISION,
        description: 'Is booking mode locked?',
        checkpoint: 'CHECKPOINT_BRANCH_DECISION',
        configPaths: ['frontDesk.bookingBehavior.requireExplicitConsent']
    },
    {
        id: 'node.bookingRunner',
        label: 'Booking Flow Runner',
        type: NODE_TYPES.ROUTER,
        description: 'Deterministic slot collection (no LLM)',
        checkpoint: 'CHECKPOINT_9b',
        matchSource: 'BOOKING_SNAP',
        configPaths: [
            'frontDesk.bookingSlots',
            'frontDesk.askFullName',
            'frontDesk.confirmSpelling'
        ],
        codeLocation: 'BookingFlowRunner.js'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // META INTENT DETECTION (universal handlers)
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.metaIntentDetector',
        label: 'Meta Intent Detector',
        type: NODE_TYPES.DETECTOR,
        description: 'Detect universal intents (human request, cancel, etc.)',
        checkpoint: 'CHECKPOINT_V86_META',
        matchSource: 'META_INTENT_TIER1',
        configPaths: ['frontDesk.universalHandlers']
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // CONSENT DETECTION
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.directBookingIntentDetector',
        label: 'Direct Booking Intent Detector',
        type: NODE_TYPES.DETECTOR,
        description: 'V92: Detect "get somebody out", "schedule", etc.',
        checkpoint: 'CHECKPOINT_DIRECT_INTENT',
        configPaths: ['booking.directIntentPatterns'],
        codeLocation: 'DirectBookingIntentDetector.js'
    },
    {
        id: 'node.consentGate',
        label: 'Consent Gate',
        type: NODE_TYPES.DECISION,
        description: 'Check for explicit booking consent',
        checkpoint: 'CHECKPOINT_CONSENT_CHECK',
        configPaths: [
            'frontDesk.bookingBehavior.requireExplicitConsent',
            'frontDesk.bookingBehavior.consentPhrases'
        ],
        codeLocation: 'ConversationEngine.js:5345'
    },
    {
        id: 'node.bookingTrigger',
        label: 'Booking Mode Trigger',
        type: NODE_TYPES.ACTION,
        description: 'Flip bookingModeLocked=true, enter booking',
        checkpoint: 'CHECKPOINT_BOOKING_TRIGGER',
        configPaths: [],
        codeLocation: 'ConversationEngine.js:5389'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // FAST PATH BOOKING
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.fastPathIntentDetector',
        label: 'Fast Path Intent Detector',
        type: NODE_TYPES.DETECTOR,
        description: 'Detect urgency keywords (schedule, ASAP, send someone)',
        checkpoint: 'CHECKPOINT_9d_1',
        configPaths: [
            'frontDesk.fastPathBooking.enabled',
            'frontDesk.fastPathBooking.triggerKeywords'
        ],
        codeLocation: 'ConversationEngine.js:11517'
    },
    {
        id: 'node.fastPathOffer',
        label: 'Fast Path Offer',
        type: NODE_TYPES.ACTION,
        description: 'Speak offer script, set bookingConsentPending',
        checkpoint: 'FAST_PATH_OFFER',
        matchSource: 'FAST_PATH_BOOKING',
        configPaths: ['frontDesk.fastPathBooking.offerScript'],
        codeLocation: 'ConversationEngine.js:11673'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // DISCOVERY CLARIFICATION (V92)
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.discoveryClarification',
        label: 'Discovery Clarification',
        type: NODE_TYPES.DETECTOR,
        description: 'V92: Ask clarifying questions for vague issues',
        checkpoint: 'CHECKPOINT_V92_CLARIFY',
        configPaths: [
            'discovery.clarifyingQuestions.enabled',
            'discovery.clarifyingQuestions.vaguePatterns'
        ],
        codeLocation: 'ConversationEngine.js:11275'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO MATCHING
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.scenarioMatcher',
        label: 'Scenario Matcher',
        type: NODE_TYPES.ROUTER,
        description: 'BM25 + regex scenario matching',
        checkpoint: 'CHECKPOINT_SCENARIO_MATCH',
        matchSource: 'SCENARIO_MATCH',
        configPaths: [
            'scenarios.*.triggers',
            'scenarios.*.negativeTriggers',
            'scenarios.*.response'
        ],
        codeLocation: 'HybridScenarioSelector.js'
    },
    {
        id: 'node.scenarioResponse',
        label: 'Scenario Response',
        type: NODE_TYPES.ACTION,
        description: 'Return matched scenario response',
        checkpoint: 'SCENARIO_RESPONSE',
        matchSource: 'SCENARIO_MATCHED'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // LLM FALLBACK
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.llmFallback',
        label: 'LLM Fallback',
        type: NODE_TYPES.ROUTER,
        description: 'Tier-3 LLM when no deterministic match',
        checkpoint: 'CHECKPOINT_9e',
        matchSource: 'LLM_FALLBACK',
        tier: 'tier3',
        codeLocation: 'HybridReceptionistLLM.js'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // COMPLETION
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.bookingComplete',
        label: 'Booking Complete',
        type: NODE_TYPES.ACTION,
        description: 'All slots collected, booking finalized',
        checkpoint: 'BOOKING_COMPLETE',
        matchSource: 'BOOKING_COMPLETE',
        configPaths: ['frontDesk.bookingOutcome']
    },
    // ─────────────────────────────────────────────────────────────────────────
    // V1.0.1 FIX: Renamed from "callEnd" to "turnEnd"
    // This is END OF TURN (response built), NOT call hangup!
    // ─────────────────────────────────────────────────────────────────────────
    {
        id: 'node.turnEnd',
        label: 'Turn End',
        type: NODE_TYPES.EXIT,
        description: 'Response built, TwiML sent - end of this turn (NOT call hangup)',
        checkpoint: 'TURN_END',
        note: 'This node means: agent response ready. Call continues after this.'
    }
];

// ═══════════════════════════════════════════════════════════════════════════
// FLOW TREE EDGES - V1.0.1
// ═══════════════════════════════════════════════════════════════════════════
// FIXED in V1.0.1:
// - Direct intent respects requireExplicitConsent
// - Fast-path runs BEFORE consent gate (it's how we ASK for consent)
// - Renamed callEnd → turnEnd (it's end of turn, not hangup)
// ═══════════════════════════════════════════════════════════════════════════
const EDGES = [
    // ─────────────────────────────────────────────────────────────────────────
    // ENTRY → GUARDS
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.1', from: 'node.callStart', to: 'node.emptyUtteranceGuard', when: 'always' },
    
    // Empty Guard branching
    { id: 'edge.2a', from: 'node.emptyUtteranceGuard', to: 'node.silenceHandler', when: 'isEmpty || isPunctuationOnly || isFillerOnly' },
    { id: 'edge.2b', from: 'node.emptyUtteranceGuard', to: 'node.slotExtraction', when: 'hasContent' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // SLOT EXTRACTION → BOOKING MODE CHECK
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.3', from: 'node.slotExtraction', to: 'node.bookingModeCheck', when: 'always' },
    
    // Booking mode branching
    { id: 'edge.4a', from: 'node.bookingModeCheck', to: 'node.bookingRunner', when: 'bookingModeLocked === true' },
    { id: 'edge.4b', from: 'node.bookingModeCheck', to: 'node.metaIntentDetector', when: 'bookingModeLocked === false' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // META INTENT → DIRECT/FAST-PATH INTENT DETECTION
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.5a', from: 'node.metaIntentDetector', to: 'node.turnEnd', when: 'humanRequest || cancel' },
    { id: 'edge.5b', from: 'node.metaIntentDetector', to: 'node.directBookingIntentDetector', when: 'noMetaIntent' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // DIRECT BOOKING INTENT - V1.0.1 FIX: Must respect requireExplicitConsent
    // ─────────────────────────────────────────────────────────────────────────
    // If consent NOT required: direct intent → booking trigger (skip consent)
    { id: 'edge.6a', from: 'node.directBookingIntentDetector', to: 'node.bookingTrigger', when: 'hasDirectIntent && confidence >= 0.75 && requireExplicitConsent === false' },
    // If consent IS required: direct intent → fast-path offer (ask consent)
    { id: 'edge.6b', from: 'node.directBookingIntentDetector', to: 'node.fastPathOffer', when: 'hasDirectIntent && confidence >= 0.75 && requireExplicitConsent === true' },
    // No direct intent → continue to fast-path check
    { id: 'edge.6c', from: 'node.directBookingIntentDetector', to: 'node.fastPathIntentDetector', when: 'noDirectIntent' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // FAST-PATH INTENT - This is HOW we ask for consent
    // V1.0.1 FIX: Fast-path runs BEFORE consent gate, not after
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.7a', from: 'node.fastPathIntentDetector', to: 'node.fastPathOffer', when: 'fastPathTriggered' },
    { id: 'edge.7b', from: 'node.fastPathIntentDetector', to: 'node.consentGate', when: 'noFastPath && bookingConsentPending' },
    { id: 'edge.7c', from: 'node.fastPathIntentDetector', to: 'node.discoveryClarification', when: 'noFastPath && !bookingConsentPending' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // CONSENT GATE - Only checked when bookingConsentPending === true
    // This is AFTER we've offered booking (via fast-path or scenario)
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.8a', from: 'node.consentGate', to: 'node.bookingTrigger', when: 'hasConsent' },
    { id: 'edge.8b', from: 'node.consentGate', to: 'node.discoveryClarification', when: 'noConsent' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING TRIGGER → BOOKING RUNNER
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.9', from: 'node.bookingTrigger', to: 'node.bookingRunner', when: 'always' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // DISCOVERY CLARIFICATION - V1.0.1 FIX: Goes to turnEnd, not "call end"
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.10a', from: 'node.discoveryClarification', to: 'node.scenarioMatcher', when: 'issueClear' },
    { id: 'edge.10b', from: 'node.discoveryClarification', to: 'node.turnEnd', when: 'askClarifyingQuestion' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // SCENARIO MATCHING
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.11a', from: 'node.scenarioMatcher', to: 'node.scenarioResponse', when: 'scenarioMatched' },
    { id: 'edge.11b', from: 'node.scenarioMatcher', to: 'node.llmFallback', when: 'noScenarioMatch' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING RUNNER OUTCOMES
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.12a', from: 'node.bookingRunner', to: 'node.bookingComplete', when: 'allSlotsCollected' },
    { id: 'edge.12b', from: 'node.bookingRunner', to: 'node.turnEnd', when: 'slotQuestionAsked' },
    
    // ─────────────────────────────────────────────────────────────────────────
    // TERMINAL EDGES (end of turn, response ready) - V1.0.1: All use turnEnd
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'edge.13', from: 'node.silenceHandler', to: 'node.turnEnd', when: 'always' },
    { id: 'edge.14', from: 'node.scenarioResponse', to: 'node.turnEnd', when: 'always' },
    { id: 'edge.15', from: 'node.llmFallback', to: 'node.turnEnd', when: 'always' },
    { id: 'edge.16', from: 'node.fastPathOffer', to: 'node.turnEnd', when: 'always' },
    { id: 'edge.17', from: 'node.bookingComplete', to: 'node.turnEnd', when: 'always' }
];

// ═══════════════════════════════════════════════════════════════════════════
// RUNTIME BINDINGS - V1.0.1
// Maps checkpoints and matchSources to flow nodes
// ═══════════════════════════════════════════════════════════════════════════
// RULE: Every node must have a binding OR explicit note "purely visual"
// If runtime cannot map to a node, emit OUT_OF_TREE_PATH
// ═══════════════════════════════════════════════════════════════════════════
const RUNTIME_BINDINGS = [
    // ─────────────────────────────────────────────────────────────────────────
    // ENTRY/EXIT NODES (V1.0.1: Added missing bindings)
    // ─────────────────────────────────────────────────────────────────────────
    {
        nodeId: 'node.callStart',
        checkpoints: ['CHECKPOINT_1', 'CALL_START'],
        matchSources: [],
        codePatterns: ['Starting processTurn', 'CALL_START'],
        events: ['CALL_START']
    },
    {
        nodeId: 'node.turnEnd',
        checkpoints: ['TURN_END', 'TWIML_SENT', 'AGENT_RESPONSE_BUILT'],
        matchSources: [],
        codePatterns: ['TURN_COMPLETE', 'PATH_RESOLVED'],
        events: ['TWIML_SENT', 'TURN_COMPLETE', 'AGENT_RESPONSE_BUILT'],
        note: 'V1.0.1: This is END OF TURN, not call hangup. Call continues.'
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // GUARDS
    // ─────────────────────────────────────────────────────────────────────────
    {
        nodeId: 'node.emptyUtteranceGuard',
        checkpoints: ['CHECKPOINT_V92_EMPTY_GUARD'],
        matchSources: [],
        codePatterns: ['shouldTreatAsSilence', 'isPunctuationOnly', 'isFillerOnly']
    },
    {
        nodeId: 'node.silenceHandler',
        checkpoints: ['SILENCE_HANDLER'],
        matchSources: ['SILENCE_HANDLER'],
        codePatterns: ['SILENCE_DETERMINISTIC']
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // SLOT EXTRACTION (V1.0.1: Added missing binding)
    // ─────────────────────────────────────────────────────────────────────────
    {
        nodeId: 'node.slotExtraction',
        checkpoints: ['CHECKPOINT_8'],
        matchSources: [],
        codePatterns: ['Extracting slots', 'SLOTS_EXTRACTED'],
        events: ['SLOTS_EXTRACTED']
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING MODE
    {
        nodeId: 'node.bookingModeCheck',
        checkpoints: ['CHECKPOINT_BRANCH_DECISION'],
        matchSources: [],
        codePatterns: ['bookingModeLocked', 'checkpointC_branchDecision']
    },
    {
        nodeId: 'node.bookingRunner',
        checkpoints: ['CHECKPOINT_9b', 'checkpointD_bookingRunner'],
        matchSources: ['BOOKING_SNAP', 'BOOKING_FLOW_RUNNER'],
        codePatterns: ['BookingFlowRunner']
    },
    
    // Intent detection
    {
        nodeId: 'node.directBookingIntentDetector',
        checkpoints: ['CHECKPOINT_DIRECT_INTENT'],
        matchSources: [],
        codePatterns: ['DirectBookingIntentDetector', 'hasDirectIntent']
    },
    {
        nodeId: 'node.consentGate',
        checkpoints: ['CHECKPOINT_CONSENT_CHECK'],
        matchSources: [],
        codePatterns: ['shouldEnterBooking', 'consentCheck.hasConsent']
    },
    {
        nodeId: 'node.bookingTrigger',
        checkpoints: ['CHECKPOINT_BOOKING_TRIGGER'],
        matchSources: [],
        codePatterns: ['bookingModeLocked = true', 'BOOKING MODE TRIGGERED']
    },
    
    // Fast path
    {
        nodeId: 'node.fastPathIntentDetector',
        checkpoints: ['CHECKPOINT_9d_1'],
        matchSources: [],
        codePatterns: ['fastPathTriggered', 'fastPathKeywords']
    },
    {
        nodeId: 'node.fastPathOffer',
        checkpoints: ['FAST_PATH_OFFER'],
        matchSources: ['FAST_PATH_BOOKING'],
        codePatterns: ['FAST-PATH ACTIVATED']
    },
    
    // Scenarios
    {
        nodeId: 'node.scenarioMatcher',
        checkpoints: ['CHECKPOINT_SCENARIO_MATCH'],
        matchSources: ['SCENARIO_MATCH'],
        codePatterns: ['HybridScenarioSelector', 'scenarioRetrieval']
    },
    {
        nodeId: 'node.scenarioResponse',
        checkpoints: ['SCENARIO_RESPONSE'],
        // V92: STATE_MACHINE is used when fromStateMachine=true + tokensUsed=0
        // This includes scenario matches, fast-path, and deterministic handlers
        matchSources: ['SCENARIO_MATCHED', 'STATE_MACHINE', 'RULE_BASED'],
        codePatterns: ['scenarioMatched', 'fromStateMachine']
    },
    
    // LLM
    {
        nodeId: 'node.llmFallback',
        checkpoints: ['CHECKPOINT_9e'],
        matchSources: ['LLM_FALLBACK', 'TIER3_FALLBACK'],
        codePatterns: ['HybridReceptionistLLM', 'tier3']
    },
    
    // Meta intent (universal handlers)
    {
        nodeId: 'node.metaIntentDetector',
        checkpoints: ['CHECKPOINT_V86_META'],
        matchSources: ['META_INTENT_TIER1'],
        codePatterns: ['metaIntentCheck', 'META_INTENT']
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOOKING COMPLETE (V1.0.1: Added missing binding)
    // ─────────────────────────────────────────────────────────────────────────
    {
        nodeId: 'node.bookingComplete',
        checkpoints: ['BOOKING_COMPLETE'],
        matchSources: ['BOOKING_COMPLETE'],
        codePatterns: ['booking finalized', 'allSlotsCollected'],
        events: ['BOOKING_CREATED', 'BOOKING_COMPLETE']
    }
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get node by ID
 */
function getNode(nodeId) {
    return NODES.find(n => n.id === nodeId) || null;
}

/**
 * Get edges from a node
 */
function getEdgesFrom(nodeId) {
    return EDGES.filter(e => e.from === nodeId);
}

/**
 * Get edges to a node
 */
function getEdgesTo(nodeId) {
    return EDGES.filter(e => e.to === nodeId);
}

/**
 * Find node by matchSource (from runtime logs)
 */
function findNodeByMatchSource(matchSource) {
    const binding = RUNTIME_BINDINGS.find(b => 
        b.matchSources.includes(matchSource)
    );
    return binding ? getNode(binding.nodeId) : null;
}

/**
 * Find node by checkpoint (from code)
 */
function findNodeByCheckpoint(checkpoint) {
    const binding = RUNTIME_BINDINGS.find(b => 
        b.checkpoints.includes(checkpoint)
    );
    return binding ? getNode(binding.nodeId) : null;
}

/**
 * Check if a matchSource is in the flow tree
 * If not, it's an OUT_OF_TREE_PATH
 */
function isMatchSourceInTree(matchSource) {
    return RUNTIME_BINDINGS.some(b => b.matchSources.includes(matchSource));
}

/**
 * Get all valid matchSources (for runtime validation)
 */
function getValidMatchSources() {
    const sources = new Set();
    RUNTIME_BINDINGS.forEach(b => {
        b.matchSources.forEach(s => sources.add(s));
    });
    return Array.from(sources);
}

/**
 * Export the full flow tree for Truth Bundle
 */
function exportFlowTree() {
    return {
        version: FLOW_TREE_VERSION,
        generatedAt: new Date().toISOString(),
        nodes: NODES,
        edges: EDGES,
        entryNodeId: 'node.callStart',
        exitNodeId: 'node.turnEnd',  // V1.0.1: Renamed from callEnd
        nodeCount: NODES.length,
        edgeCount: EDGES.length
    };
}

/**
 * Export runtime bindings for Truth Bundle
 */
function exportRuntimeBindings() {
    return RUNTIME_BINDINGS;
}

/**
 * Validate that all nodes are reachable from entry
 * Returns array of unreachable node IDs
 */
function findUnreachableNodes() {
    const visited = new Set();
    const queue = ['node.callStart'];
    
    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        
        const outEdges = getEdgesFrom(current);
        outEdges.forEach(e => {
            if (!visited.has(e.to)) {
                queue.push(e.to);
            }
        });
    }
    
    return NODES.filter(n => !visited.has(n.id)).map(n => n.id);
}

/**
 * Validate that all edges reference valid nodes
 */
function findInvalidEdges() {
    const nodeIds = new Set(NODES.map(n => n.id));
    return EDGES.filter(e => !nodeIds.has(e.from) || !nodeIds.has(e.to));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    // Constants
    FLOW_TREE_VERSION,
    NODE_TYPES,
    NODES,
    EDGES,
    RUNTIME_BINDINGS,
    
    // Query functions
    getNode,
    getEdgesFrom,
    getEdgesTo,
    findNodeByMatchSource,
    findNodeByCheckpoint,
    isMatchSourceInTree,
    getValidMatchSources,
    
    // Export functions
    exportFlowTree,
    exportRuntimeBindings,
    
    // Validation functions
    findUnreachableNodes,
    findInvalidEdges
};
