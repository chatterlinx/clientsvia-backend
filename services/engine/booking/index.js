/**
 * ============================================================================
 * BOOKING ENGINE - UNIFIED EXPORTS
 * ============================================================================
 * 
 * ☢️ NUKED Feb 22, 2026: Legacy booking components removed.
 * 
 * The new booking system is:
 *   - BookingLogicEngine.js = The sole booking state machine
 *   - Receives JSON payload from Agent 2.0 discovery
 *   - No slot extraction, no flow resolution - deterministic steps
 * 
 * ARCHITECTURE (New World):
 * 
 *   CallRuntime.processTurn()
 *         │
 *         ▼
 *   ┌───────────────────────────────────────────┐
 *   │  if (session.mode === 'BOOKING') {        │  ← MODE SWITCH
 *   │      BookingLogicEngine.computeStep(...)  │
 *   │      return response;                     │
 *   │  }                                        │
 *   └───────────────────────────────────────────┘
 *         │
 *         ▼  (only if in DISCOVERY mode)
 *   Agent 2.0 handles discovery
 * 
 * REMOVED COMPONENTS:
 *   - BookingFlowRunner.js (DELETED - legacy slot-based booking)
 *   - BookingFlowResolver.js (DELETED - legacy flow resolution)
 *   - SlotExtractor.js (DELETED - legacy slot extraction)
 * 
 * ============================================================================
 */

const BookingLogicEngine = require('./BookingLogicEngine');
const DiscoveryExtractor = require('./DiscoveryExtractor');
const SensitiveMasker = require('./SensitiveMasker');

module.exports = {
    // New World
    BookingLogicEngine,
    computeStep: BookingLogicEngine.computeStep,
    
    // Still needed utilities
    DiscoveryExtractor,
    SensitiveMasker,
    
    // Re-export constants for convenience
    HVAC_SYMPTOM_PATTERNS: DiscoveryExtractor.HVAC_SYMPTOM_PATTERNS,
    TECH_NAME_PATTERNS: DiscoveryExtractor.TECH_NAME_PATTERNS,
    TENURE_PATTERNS: DiscoveryExtractor.TENURE_PATTERNS,
    ALWAYS_SENSITIVE_TYPES: SensitiveMasker.ALWAYS_SENSITIVE_TYPES,
    DEFAULT_SENSITIVE_TYPES: SensitiveMasker.DEFAULT_SENSITIVE_TYPES
};
