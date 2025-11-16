/**
 * ============================================================================
 * ORCHESTRATION TYPES - FRONTLINE-INTEL + LLM-0
 * ============================================================================
 * 
 * PURPOSE: Type definitions for orchestration layer
 * ARCHITECTURE: JSDoc types only (no runtime logic)
 * USED BY: frontlineIntelService, orchestrationEngine, Twilio routes
 * 
 * ============================================================================
 */

/**
 * @typedef {'booking'|'update_appointment'|'troubleshooting'|'info'|'billing'|'emergency'|'wrong_number'|'spam'|'other'} FrontlineIntent
 */

/**
 * @typedef {'ask_question'|'confirm_info'|'answer_with_knowledge'|'initiate_booking'|'update_booking'|'escalate_to_human'|'small_talk'|'close_call'|'clarify_intent'|'no_op'} OrchestratorAction
 */

/**
 * @typedef {Object} ExtractedContact
 * @property {string} [name]
 * @property {string} [phone]
 * @property {string} [email]
 */

/**
 * @typedef {Object} ExtractedLocation
 * @property {string} [addressLine1]
 * @property {string} [addressLine2]
 * @property {string} [city]
 * @property {string} [state]
 * @property {string} [zip]
 */

/**
 * @typedef {Object} ExtractedProblem
 * @property {string} [summary]
 * @property {string} [category]
 * @property {string} [urgency]
 */

/**
 * @typedef {Object} ExtractedScheduling
 * @property {string} [preferredDate]
 * @property {string} [preferredWindow]
 */

/**
 * @typedef {Object} ExtractedAccess
 * @property {string} [gateCode]
 * @property {string} [notes]
 */

/**
 * @typedef {Object} ExtractedMeta
 * @property {string} [language]
 * @property {string} [sentiment]
 */

/**
 * @typedef {Object} ExtractedContext
 * @property {ExtractedContact} [contact]
 * @property {ExtractedLocation} [location]
 * @property {ExtractedProblem} [problem]
 * @property {ExtractedScheduling} [scheduling]
 * @property {ExtractedAccess} [access]
 * @property {ExtractedMeta} [meta]
 */

/**
 * @typedef {Object} OrchestratorDecisionUpdates
 * @property {Partial<ExtractedContext>} [extracted]
 * @property {Object} [flags]
 * @property {boolean} [flags.readyToBook]
 * @property {boolean} [flags.needsKnowledgeSearch]
 * @property {boolean} [flags.wantsHuman]
 */

/**
 * @typedef {Object} KnowledgeQuery
 * @property {'troubleshooting'|'info'|'billing'|null} type
 * @property {string} queryText
 */

/**
 * @typedef {Object} OrchestratorDecision
 * @property {OrchestratorAction} action
 * @property {string} nextPrompt
 * @property {FrontlineIntent|null} [updatedIntent]
 * @property {OrchestratorDecisionUpdates} [updates]
 * @property {KnowledgeQuery|null} [knowledgeQuery]
 * @property {string} [debugNotes]
 */

/**
 * @typedef {Object} FrontlineIntelResult
 * @property {FrontlineIntent} intent
 * @property {number} confidence
 * @property {Object} signals
 * @property {boolean} signals.maybeEmergency
 * @property {boolean} signals.maybeWrongNumber
 * @property {boolean} signals.maybeSpam
 * @property {boolean} signals.maybeBooking
 * @property {boolean} signals.maybeUpdate
 * @property {boolean} signals.maybeTroubleshooting
 */

/**
 * @typedef {Object} OrchestrationResult
 * @property {string} nextPrompt
 * @property {OrchestratorDecision} decision
 */

// Export types for use in other modules (documentation only)
module.exports = {
  // Type definitions exported for JSDoc reference only
  // Actual exports are documentation - types are JSDoc comments
};

