/**
 * ============================================================================
 * TRUTH BUNDLE EXPORTER
 * ============================================================================
 * 
 * Generates the TRUTH_BUNDLE_V1 JSON - the single source of truth for the
 * entire platform. Contains three sections:
 * 
 * 1. wiringReport - Config paths, readers, UI mappings (existing WIRING_REPORT_V2)
 * 2. flowTree - Actual nodes/edges that runtime uses
 * 3. runtimeBindings - Maps checkpoints to flow nodes
 * 
 * RULE: If it's not in the Truth Bundle, it doesn't exist.
 * 
 * ============================================================================
 */

const crypto = require('crypto');
const FlowTreeDefinition = require('./FlowTreeDefinition');

// Try to load wiring report generator (may not exist yet)
let WiringReport;
try {
    WiringReport = require('./wiringReport.v2');
} catch (e) {
    WiringReport = null;
}

const TRUTH_BUNDLE_SCHEMA = 'TRUTH_BUNDLE_V1';

/**
 * Generate the complete Truth Bundle
 * 
 * @param {Object} options
 * @param {string} options.companyId - Company ID for company-specific config
 * @param {Object} options.company - Company document (optional, for config values)
 * @param {string} options.environment - 'production' | 'staging' | 'development'
 * @returns {Object} TRUTH_BUNDLE_V1 JSON
 */
async function generateTruthBundle(options = {}) {
    const {
        companyId = 'global',
        company = null,
        environment = process.env.NODE_ENV || 'development'
    } = options;
    
    const generatedAt = new Date().toISOString();
    
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 1: WIRING REPORT
    // ═══════════════════════════════════════════════════════════════════════
    let wiringReport = null;
    if (WiringReport && typeof WiringReport.generateReport === 'function') {
        try {
            wiringReport = await WiringReport.generateReport({ companyId, company });
        } catch (e) {
            console.error('[TRUTH BUNDLE] Failed to generate wiring report:', e.message);
            wiringReport = { error: e.message };
        }
    } else {
        // Fallback: minimal wiring report structure
        wiringReport = {
            schema: 'WIRING_REPORT_V2',
            generatedAt,
            note: 'Full wiring report not available - using fallback'
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 2: FLOW TREE
    // ═══════════════════════════════════════════════════════════════════════
    const flowTree = FlowTreeDefinition.exportFlowTree();
    
    // ═══════════════════════════════════════════════════════════════════════
    // SECTION 3: RUNTIME BINDINGS
    // ═══════════════════════════════════════════════════════════════════════
    const runtimeBindings = FlowTreeDefinition.exportRuntimeBindings();
    
    // ═══════════════════════════════════════════════════════════════════════
    // VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    const validation = {
        unreachableNodes: FlowTreeDefinition.findUnreachableNodes(),
        invalidEdges: FlowTreeDefinition.findInvalidEdges(),
        validMatchSources: FlowTreeDefinition.getValidMatchSources()
    };
    
    // ═══════════════════════════════════════════════════════════════════════
    // ASSEMBLE BUNDLE
    // ═══════════════════════════════════════════════════════════════════════
    const bundleContent = {
        wiringReport,
        flowTree,
        runtimeBindings,
        validation
    };
    
    // Generate hash of content for integrity checking
    const contentHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(bundleContent))
        .digest('hex');
    
    const truthBundle = {
        meta: {
            schema: TRUTH_BUNDLE_SCHEMA,
            generatedAt,
            companyId,
            environment,
            hash: contentHash,
            flowTreeVersion: flowTree.version,
            nodeCount: flowTree.nodeCount,
            edgeCount: flowTree.edgeCount,
            bindingCount: runtimeBindings.length
        },
        ...bundleContent
    };
    
    return truthBundle;
}

/**
 * Validate a Truth Bundle (e.g., when loading from file)
 */
function validateTruthBundle(bundle) {
    const errors = [];
    
    // Check schema
    if (bundle.meta?.schema !== TRUTH_BUNDLE_SCHEMA) {
        errors.push(`Invalid schema: expected ${TRUTH_BUNDLE_SCHEMA}, got ${bundle.meta?.schema}`);
    }
    
    // Check required sections
    if (!bundle.flowTree) errors.push('Missing flowTree section');
    if (!bundle.runtimeBindings) errors.push('Missing runtimeBindings section');
    
    // Verify hash if present
    if (bundle.meta?.hash) {
        const { meta, ...content } = bundle;
        const computedHash = crypto
            .createHash('sha256')
            .update(JSON.stringify(content))
            .digest('hex');
        
        if (computedHash !== bundle.meta.hash) {
            errors.push('Content hash mismatch - bundle may have been modified');
        }
    }
    
    // Check for unreachable nodes
    if (bundle.validation?.unreachableNodes?.length > 0) {
        errors.push(`Unreachable nodes: ${bundle.validation.unreachableNodes.join(', ')}`);
    }
    
    // Check for invalid edges
    if (bundle.validation?.invalidEdges?.length > 0) {
        errors.push(`Invalid edges: ${bundle.validation.invalidEdges.map(e => e.id).join(', ')}`);
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Get the flow node ID for a given runtime state
 * Used by ConversationEngine to emit flowNodeId in TURN_TRACE
 */
function resolveFlowNodeId(runtimeState) {
    const { matchSource, checkpoint, branchTaken } = runtimeState;
    
    // Try matchSource first (most reliable)
    if (matchSource) {
        const node = FlowTreeDefinition.findNodeByMatchSource(matchSource);
        if (node) return node.id;
    }
    
    // Try checkpoint
    if (checkpoint) {
        const node = FlowTreeDefinition.findNodeByCheckpoint(checkpoint);
        if (node) return node.id;
    }
    
    // Special cases based on branchTaken
    if (branchTaken === 'BOOKING_FLOW_RUNNER') return 'node.bookingRunner';
    if (branchTaken === 'NORMAL_ROUTING') return 'node.metaIntentDetector';
    
    // Not found - this is an OUT_OF_TREE_PATH
    return null;
}

/**
 * Check if a runtime path is in the flow tree
 * Returns warning info if not
 */
function checkPathInTree(runtimeState) {
    const flowNodeId = resolveFlowNodeId(runtimeState);
    
    if (flowNodeId) {
        return { inTree: true, flowNodeId };
    }
    
    // OUT_OF_TREE_PATH detected
    return {
        inTree: false,
        flowNodeId: null,
        warning: {
            type: 'OUT_OF_TREE_PATH',
            matchSource: runtimeState.matchSource,
            checkpoint: runtimeState.checkpoint,
            branchTaken: runtimeState.branchTaken,
            message: 'Runtime took a path not defined in Flow Tree - this decision needs to be wired'
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    TRUTH_BUNDLE_SCHEMA,
    generateTruthBundle,
    validateTruthBundle,
    resolveFlowNodeId,
    checkPathInTree
};
