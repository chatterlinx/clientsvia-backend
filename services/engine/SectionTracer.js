/**
 * ============================================================================
 * SECTION TRACER - V110 Stabilization Tracking
 * ============================================================================
 * 
 * PURPOSE: Make it impossible to argue from vibes. Every turn gets stamped
 * with section IDs showing exactly what code ran and what decisions were made.
 * 
 * SECTIONS:
 * S1 - Runtime Ownership (which engine owns the turn)
 * S2 - Input Text Truth (where transcript came from)
 * S3 - Slot Extraction (name/phone/address extraction)
 * S4 - Discovery Step Engine (discovery flow progression)
 * S5 - Consent Gate (booking consent detection)
 * S6 - Booking Flow (booking step progression)
 * S7 - Voice Provider (ElevenLabs vs Twilio Say)
 * 
 * USAGE:
 * ```
 * const tracer = SectionTracer.forCall(callState);
 * tracer.enter('S3_SLOT_EXTRACTION', { name: 'Mark' });
 * // ... do work ...
 * tracer.emit('SLOTS_EXTRACTED', { slotCount: 2 });
 * ```
 * 
 * RAW EVENTS OUTPUT:
 * Every event includes:
 * - section: "S3_SLOT_EXTRACTION"
 * - sectionTrail: "S1>S2(speechResult)>S3(name:Mark)>S4(d1:confirm)>S7(elevenlabs)"
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');

let BlackBoxLogger = null;
try {
    BlackBoxLogger = require('../BlackBoxLogger');
} catch (err) {
    BlackBoxLogger = null;
}

/**
 * CANONICAL SECTION IDS - V110 Stabilization
 * 
 * These MUST match the advisor's canonical list exactly.
 * Once a section is GREEN + LOCKED, do NOT modify its code.
 * 
 * Status:
 * - S1: GREEN (proven in raw events, lane/sessionMode present)
 * - S2: GREEN (proven in raw events, inputTextSource/length/preview present)
 * - S3: GREEN (proven in raw events, name extraction working)
 * - S4: GREEN (proven in raw events, DISCOVERY_FLOW_RUNNER owning turns)
 * - S5: RED (call_reason_detail not being captured)
 * - S6: YELLOW (not yet tested)
 * - S7: GREEN (proven in raw events, elevenlabs + hasPlay=true)
 */
const SECTIONS = {
    // S1 — Runtime Ownership (lane/mode owner)
    S1_RUNTIME_OWNER: 'S1_RUNTIME_OWNER',
    
    // S2 — Input Text Truth (speechResult vs partialCache)
    S2_INPUT_TEXT_TRUTH: 'S2_INPUT_TEXT_TRUTH',
    
    // S3 — Slot Extraction (name/phone/address/time)
    S3_SLOT_EXTRACTION: 'S3_SLOT_EXTRACTION',
    
    // S4 — Discovery Engine (step progression)
    S4_DISCOVERY_ENGINE: 'S4_DISCOVERY_ENGINE',
    
    // S5 — Call Reason Capture (call_reason_detail)
    S5_CALL_REASON_CAPTURE: 'S5_CALL_REASON_CAPTURE',
    
    // S6 — Consent & Lane Transition (DISCOVERY → BOOKING)
    S6_CONSENT_AND_TRANSITION: 'S6_CONSENT_AND_TRANSITION',
    
    // S7 — Voice Provider (ElevenLabs vs Twilio Say)
    S7_VOICE_PROVIDER: 'S7_VOICE_PROVIDER'
};

class SectionTracer {
    constructor(callState, callId, companyId) {
        this.callState = callState;
        this.callId = callId;
        this.companyId = companyId;
        this.currentSection = null;
        
        // Initialize trail if not exists
        if (!this.callState.sectionTrail) {
            this.callState.sectionTrail = [];
        }
    }
    
    /**
     * Enter a section - adds to trail
     */
    enter(sectionId, metadata = {}) {
        this.currentSection = sectionId;
        
        // Build breadcrumb string
        let breadcrumb = sectionId.replace('_', '').substring(0, 2); // S1, S2, etc.
        
        // Add metadata to breadcrumb
        const metaKeys = Object.keys(metadata);
        if (metaKeys.length > 0) {
            const metaStr = metaKeys
                .map(k => `${k}:${metadata[k]}`)
                .join(',');
            breadcrumb += `(${metaStr})`;
        }
        
        // Add to trail
        this.callState.sectionTrail.push(breadcrumb);
        
        logger.debug('[SECTION TRACER] Entered', {
            callId: this.callId,
            section: sectionId,
            metadata,
            trail: this.getTrailString()
        });
        
        return this;
    }
    
    /**
     * Get current trail as string
     */
    getTrailString() {
        return this.callState.sectionTrail.join('>');
    }
    
    /**
     * Emit event to BlackBox with section context
     */
    emit(eventType, data = {}) {
        if (!BlackBoxLogger?.logEvent || !this.callId) {
            return;
        }
        
        const turn = this.callState?.turnCount || 0;
        
        BlackBoxLogger.logEvent({
            callId: this.callId,
            companyId: this.companyId,
            turn,
            type: eventType,
            data: {
                ...data,
                section: this.currentSection,
                sectionTrail: this.getTrailString()
            }
        }).catch(() => {});
    }
    
    /**
     * Create tracer for a call
     */
    static forCall(callState, callId, companyId) {
        return new SectionTracer(callState, callId, companyId);
    }
}

module.exports = {
    SectionTracer,
    SECTIONS
};
