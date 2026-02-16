/**
 * ============================================================================
 * SECTION HEALTH API - V110 Stabilization Dashboard
 * ============================================================================
 * 
 * Provides real-time health status for the 7 canonical sections:
 * 
 * S1 - Runtime Ownership (lane/mode owner)
 * S2 - Input Text Truth (speechResult vs partialCache)
 * S3 - Slot Extraction (name/phone/address)
 * S4 - Discovery Engine (step progression)
 * S5 - Call Reason Capture (call_reason_detail)
 * S6 - Consent & Lane Transition (DISCOVERY → BOOKING)
 * S7 - Voice Provider (ElevenLabs vs Twilio Say)
 * 
 * GREEN = Proven working in raw events
 * YELLOW = Partially working or untested
 * RED = Broken or missing events
 * LOCKED = Green + no changes allowed
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const BlackBoxRecording = require('../../models/BlackBoxRecording');
const logger = require('../../utils/logger');

/**
 * Section definitions with lock criteria
 */
const SECTION_DEFINITIONS = {
    S1_RUNTIME_OWNER: {
        id: 'S1',
        name: 'Runtime Ownership',
        description: 'Confirms lane (DISCOVERY/BOOKING) and owner',
        requiredEvents: ['SECTION_S1_RUNTIME_OWNER'],
        greenCriteria: 'Event appears on every turn with lane + sessionMode',
        lockedSha: null,
        lockedAt: null
    },
    S2_INPUT_TEXT_TRUTH: {
        id: 'S2',
        name: 'Input Text Truth',
        description: 'Proves speechResult vs partialCache source',
        requiredEvents: ['INPUT_TEXT_SELECTED'],
        greenCriteria: 'Event shows source, length > 0, preview',
        lockedSha: null,
        lockedAt: null
    },
    S3_SLOT_EXTRACTION: {
        id: 'S3',
        name: 'Slot Extraction',
        description: 'Extracts name/phone/address from utterances',
        requiredEvents: ['SECTION_S3_SLOT_EXTRACTION', 'SLOTS_EXTRACTED'],
        greenCriteria: 'Name "Mark" extracted with confidence 0.9, patternSource explicit_my_name_is',
        lockedSha: null,
        lockedAt: null
    },
    S4_DISCOVERY_ENGINE: {
        id: 'S4',
        name: 'Discovery Engine',
        description: 'Handles discovery step progression',
        requiredEvents: ['CORE_RUNTIME_OWNER_RESULT'],
        greenCriteria: 'matchSource=DISCOVERY_FLOW_RUNNER, sectionTrail ends with >S4',
        lockedSha: null,
        lockedAt: null
    },
    S5_CALL_REASON_CAPTURE: {
        id: 'S5',
        name: 'Call Reason Capture',
        description: 'Captures and acknowledges call_reason_detail',
        requiredEvents: ['SECTION_S5_CALL_REASON_CAPTURED'],
        greenCriteria: 'call_reason_detail slot filled and acknowledged',
        lockedSha: null,
        lockedAt: null
    },
    S6_CONSENT_AND_TRANSITION: {
        id: 'S6',
        name: 'Consent & Lane Transition',
        description: 'Handles consent gate and DISCOVERY → BOOKING',
        requiredEvents: ['SECTION_S6_CONSENT_GATE', 'LANE_TRANSITION'],
        greenCriteria: 'Consent only triggers after question spoken, lane transitions correctly',
        lockedSha: null,
        lockedAt: null
    },
    S7_VOICE_PROVIDER: {
        id: 'S7',
        name: 'Voice Provider',
        description: 'ElevenLabs TTS and TwiML generation',
        requiredEvents: ['TWIML_SENT'],
        greenCriteria: 'voiceProviderUsed=elevenlabs, hasPlay=true, hasSay=false',
        lockedSha: null,
        lockedAt: null
    }
};

/**
 * GET /api/admin/section-health/:companyId
 * 
 * Returns section health status based on recent calls
 */
router.get('/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { callCount = 3 } = req.query;
        
        // Get recent calls with their events
        const recentCalls = await BlackBoxRecording.find({ companyId })
            .sort({ startedAt: -1 })
            .limit(parseInt(callCount))
            .select('callId startedAt events')
            .lean();
        
        if (!recentCalls || recentCalls.length === 0) {
            return res.json({
                success: true,
                message: 'No recent calls found',
                sections: Object.entries(SECTION_DEFINITIONS).map(([key, def]) => ({
                    ...def,
                    status: 'UNKNOWN',
                    lastSeen: null,
                    lastSectionTrail: null,
                    evidence: null
                }))
            });
        }
        
        // Analyze events from recent calls
        const sectionStatus = {};
        
        for (const [sectionKey, definition] of Object.entries(SECTION_DEFINITIONS)) {
            const status = analyzeSection(sectionKey, definition, recentCalls);
            sectionStatus[sectionKey] = {
                ...definition,
                ...status
            };
        }
        
        // Get current runtime SHA
        const runtimeSha = process.env.GIT_SHA || process.env.RENDER_GIT_COMMIT?.substring(0, 8) || 'unknown';
        
        res.json({
            success: true,
            runtimeSha,
            callsAnalyzed: recentCalls.length,
            lastCallId: recentCalls[0]?.callId,
            lastCallTime: recentCalls[0]?.startedAt,
            sections: Object.values(sectionStatus)
        });
        
    } catch (error) {
        logger.error('[SECTION HEALTH] Error getting status', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/section-health/:companyId/lock/:sectionId
 * 
 * Lock a section (mark as stable, no changes allowed)
 */
router.post('/:companyId/lock/:sectionId', async (req, res) => {
    try {
        const { companyId, sectionId } = req.params;
        const { sha, reason } = req.body;
        
        const sectionKey = Object.keys(SECTION_DEFINITIONS).find(
            k => SECTION_DEFINITIONS[k].id === sectionId
        );
        
        if (!sectionKey) {
            return res.status(404).json({
                success: false,
                error: `Unknown section: ${sectionId}`
            });
        }
        
        // In production, this would persist to database
        // For now, just return confirmation
        logger.info('[SECTION HEALTH] Section locked', {
            companyId,
            sectionId,
            sha,
            reason
        });
        
        res.json({
            success: true,
            message: `Section ${sectionId} locked at SHA ${sha}`,
            section: {
                ...SECTION_DEFINITIONS[sectionKey],
                lockedSha: sha,
                lockedAt: new Date().toISOString(),
                lockedReason: reason
            }
        });
        
    } catch (error) {
        logger.error('[SECTION HEALTH] Error locking section', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Analyze a section's health based on recent call events
 */
function analyzeSection(sectionKey, definition, recentCalls) {
    const result = {
        status: 'UNKNOWN',
        lastSeen: null,
        lastSectionTrail: null,
        evidence: null,
        callsWithSection: 0,
        totalCalls: recentCalls.length
    };
    
    // Flatten all events from recent calls
    const allEvents = [];
    for (const call of recentCalls) {
        if (call.events && Array.isArray(call.events)) {
            for (const event of call.events) {
                allEvents.push({
                    ...event,
                    callId: call.callId,
                    callStartedAt: call.startedAt
                });
            }
        }
    }
    
    // Find matching events for this section
    const matchingEvents = allEvents.filter(e => 
        definition.requiredEvents.includes(e.type)
    );
    
    if (matchingEvents.length === 0) {
        result.status = 'RED';
        result.evidence = `No ${definition.requiredEvents.join(' or ')} events found`;
        return result;
    }
    
    // Get the most recent matching event
    const latestEvent = matchingEvents.sort((a, b) => 
        new Date(b.ts || b.callStartedAt) - new Date(a.ts || a.callStartedAt)
    )[0];
    
    result.lastSeen = latestEvent.ts || latestEvent.callStartedAt;
    result.lastSectionTrail = latestEvent.data?.sectionTrail || null;
    
    // Count unique calls with this section
    const callsWithSection = new Set(matchingEvents.map(e => e.callId)).size;
    result.callsWithSection = callsWithSection;
    
    // Determine status based on section-specific criteria
    switch (sectionKey) {
        case 'S1_RUNTIME_OWNER':
            result.status = latestEvent.data?.lane ? 'GREEN' : 'YELLOW';
            result.evidence = `lane=${latestEvent.data?.lane}, sessionMode=${latestEvent.data?.sessionMode}`;
            break;
            
        case 'S2_INPUT_TEXT_TRUTH':
            result.status = latestEvent.data?.inputTextLength > 0 ? 'GREEN' : 'YELLOW';
            result.evidence = `source=${latestEvent.data?.inputTextSource}, length=${latestEvent.data?.inputTextLength}`;
            break;
            
        case 'S3_SLOT_EXTRACTION':
            const hasName = latestEvent.data?.slotsPresent?.name === true || 
                           latestEvent.data?.extractedSlots?.name;
            result.status = hasName ? 'GREEN' : 'YELLOW';
            result.evidence = `name=${latestEvent.data?.nameValuePreview || latestEvent.data?.extractedSlots?.name?.value}, confidence=${latestEvent.data?.nameConfidence || latestEvent.data?.extractedSlots?.name?.confidence}`;
            break;
            
        case 'S4_DISCOVERY_ENGINE':
            const isDiscovery = latestEvent.data?.matchSource === 'DISCOVERY_FLOW_RUNNER';
            result.status = isDiscovery ? 'GREEN' : 'YELLOW';
            result.evidence = `matchSource=${latestEvent.data?.matchSource}, response="${latestEvent.data?.responsePreview?.substring(0, 50)}..."`;
            break;
            
        case 'S5_CALL_REASON_CAPTURE':
            // This is currently broken - check for evidence
            result.status = 'RED';
            result.evidence = 'call_reason_detail not being captured';
            break;
            
        case 'S6_CONSENT_AND_TRANSITION':
            // Check if we've seen consent events
            result.status = 'YELLOW';
            result.evidence = 'Not yet tested';
            break;
            
        case 'S7_VOICE_PROVIDER':
            const isElevenLabs = latestEvent.data?.voiceProviderUsed === 'elevenlabs';
            const hasPlay = latestEvent.data?.hasPlay === true;
            result.status = (isElevenLabs && hasPlay) ? 'GREEN' : 'YELLOW';
            result.evidence = `provider=${latestEvent.data?.voiceProviderUsed}, hasPlay=${latestEvent.data?.hasPlay}, hasSay=${latestEvent.data?.hasSay}`;
            break;
            
        default:
            result.status = 'YELLOW';
            result.evidence = 'Unknown section';
    }
    
    // Check if locked
    if (definition.lockedSha) {
        result.status = 'LOCKED';
        result.lockedSha = definition.lockedSha;
        result.lockedAt = definition.lockedAt;
    }
    
    return result;
}

module.exports = router;
