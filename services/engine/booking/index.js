/**
 * ============================================================================
 * BOOKING ENGINE - UNIFIED EXPORTS
 * ============================================================================
 * 
 * The Booking Engine is the deterministic state machine that takes over
 * when booking mode is locked. It bypasses the scenario engine and LLM
 * to execute a checklist of booking steps.
 * 
 * ARCHITECTURE:
 * 
 *   v2twilio.js (phone call handler)
 *         │
 *         ▼
 *   ┌───────────────────────────────────────┐
 *   │  if (bookingModeLocked) {             │  ← SHORT-CIRCUIT
 *   │      BookingFlowRunner.runStep(...)   │
 *   │      return response;  // Skip LLM    │
 *   │  }                                    │
 *   └───────────────────────────────────────┘
 *         │
 *         ▼  (only if NOT in booking mode)
 *   ConversationEngine.processTurn()
 *         │
 *         ▼  (when booking intent detected)
 *   BookingFlowResolver.resolve() → sets bookingModeLocked = true
 * 
 * USAGE:
 * 
 *   const { BookingFlowRunner, BookingFlowResolver } = require('./services/engine/booking');
 *   
 *   // 1. At TOP of turn handler (short-circuit)
 *   if (state.bookingModeLocked) {
 *       const flow = BookingFlowResolver.resolve({ companyId, company });
 *       const result = await BookingFlowRunner.runStep({ flow, state, userInput, company });
 *       return result;  // No scenarios, no LLM
 *   }
 *   
 *   // 2. When entering BOOKING mode
 *   if (mode === 'BOOKING' && !state.bookingModeLocked) {
 *       const flow = BookingFlowResolver.resolve({ companyId, company });
 *       state.bookingModeLocked = true;
 *       state.bookingFlowId = flow.flowId;
 *       state.currentStepId = flow.steps[0].id;
 *       state.bookingCollected = {};
 *   }
 * 
 * ============================================================================
 */

const BookingFlowRunner = require('./BookingFlowRunner');
const BookingFlowResolver = require('./BookingFlowResolver');
const SlotExtractor = require('./SlotExtractor');
const DirectBookingIntentDetector = require('./DirectBookingIntentDetector');
const DiscoveryExtractor = require('./DiscoveryExtractor');
const SensitiveMasker = require('./SensitiveMasker');

module.exports = {
    BookingFlowRunner,
    BookingFlowResolver,
    SlotExtractor,
    DirectBookingIntentDetector,
    DiscoveryExtractor,
    SensitiveMasker,
    
    // Re-export constants for convenience
    DEFAULT_STEP_PROMPTS: BookingFlowResolver.DEFAULT_STEP_PROMPTS,
    VALIDATION_PATTERNS: BookingFlowResolver.VALIDATION_PATTERNS,
    SlotExtractors: BookingFlowRunner.SlotExtractors,
    CONFIDENCE: SlotExtractor.CONFIDENCE,
    SOURCE: SlotExtractor.SOURCE,
    DIRECT_BOOKING_PATTERNS: DirectBookingIntentDetector.DIRECT_BOOKING_PATTERNS,
    TRADE_PATTERNS: DirectBookingIntentDetector.TRADE_PATTERNS,
    HVAC_SYMPTOM_PATTERNS: DiscoveryExtractor.HVAC_SYMPTOM_PATTERNS,
    TECH_NAME_PATTERNS: DiscoveryExtractor.TECH_NAME_PATTERNS,
    TENURE_PATTERNS: DiscoveryExtractor.TENURE_PATTERNS,
    ALWAYS_SENSITIVE_TYPES: SensitiveMasker.ALWAYS_SENSITIVE_TYPES,
    DEFAULT_SENSITIVE_TYPES: SensitiveMasker.DEFAULT_SENSITIVE_TYPES
};
