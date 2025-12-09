/**
 * SmartConfirmationService.js - Smart Confirmation for Critical Decisions
 * 
 * Prevents wrong decisions by confirming before:
 * - Transfers (high cost if wrong)
 * - Emergency dispatch (safety critical)
 * - Cancellations (destructive)
 * - Low confidence decisions
 * 
 * @module services/SmartConfirmationService
 * @version 1.0.0
 */

const logger = require('../utils/logger');

// Default settings if company hasn't configured them
const defaultSettings = {
    enabled: true,
    confirmTransfers: true,
    confirmBookings: false,
    confirmEmergency: true,
    confirmCancellations: true,
    confirmBelowConfidence: 0.75,
    confirmationStyle: 'smart',
    transferConfirmPhrase: "Before I transfer you, I want to make sure - you'd like to speak with a live agent, correct?",
    bookingConfirmPhrase: "Just to confirm, you'd like to schedule a service appointment, is that right?",
    emergencyConfirmPhrase: "This sounds like an emergency. I want to make sure - should I dispatch someone right away?",
    lowConfidencePhrase: "I want to make sure I understand correctly. You're looking for help with {detected_intent}, is that right?",
    onNoResponse: 'apologize_and_clarify',
    clarifyPhrase: "I apologize for the confusion. Could you tell me more about what you need help with?"
};

class SmartConfirmationService {
    
    /**
     * Check if confirmation is needed for this decision
     * @param {Object} params
     * @param {string} params.action - The proposed action (transfer, book, emergency, etc.)
     * @param {number} params.confidence - Confidence score (0-1)
     * @param {Object} params.llm0Controls - Company's LLM-0 controls with smartConfirmation settings
     * @param {Object} params.callState - Current call state
     * @returns {Object} { needsConfirmation: boolean, confirmationPhrase?: string, pendingAction?: string }
     */
    static checkIfConfirmationNeeded({ action, confidence, llm0Controls, callState }) {
        const settings = llm0Controls?.smartConfirmation || defaultSettings;
        
        // Smart confirmation disabled
        if (settings.enabled === false) {
            return { needsConfirmation: false };
        }
        
        // Already in confirmation flow
        if (callState?.pendingConfirmation) {
            return { needsConfirmation: false };
        }
        
        // Check by action type
        const actionLower = (action || '').toLowerCase();
        
        // Transfer confirmation
        if (actionLower === 'transfer' && settings.confirmTransfers !== false) {
            return {
                needsConfirmation: true,
                confirmationPhrase: settings.transferConfirmPhrase || defaultSettings.transferConfirmPhrase,
                pendingAction: 'transfer',
                severity: 'high'
            };
        }
        
        // Emergency confirmation
        if ((actionLower === 'emergency' || actionLower === 'dispatch') && settings.confirmEmergency !== false) {
            return {
                needsConfirmation: true,
                confirmationPhrase: settings.emergencyConfirmPhrase || defaultSettings.emergencyConfirmPhrase,
                pendingAction: 'emergency',
                severity: 'critical'
            };
        }
        
        // Booking confirmation (optional)
        if (actionLower === 'book' && settings.confirmBookings === true) {
            return {
                needsConfirmation: true,
                confirmationPhrase: settings.bookingConfirmPhrase || defaultSettings.bookingConfirmPhrase,
                pendingAction: 'book',
                severity: 'medium'
            };
        }
        
        // Cancellation confirmation
        if (actionLower === 'cancel' && settings.confirmCancellations !== false) {
            return {
                needsConfirmation: true,
                confirmationPhrase: "Just to confirm, you'd like to cancel? This action cannot be undone.",
                pendingAction: 'cancel',
                severity: 'high'
            };
        }
        
        // ════════════════════════════════════════════════════════════════════════
        // LOW CONFIDENCE CONFIRMATION - DISABLED (Dec 2025)
        // ════════════════════════════════════════════════════════════════════════
        // Problem: This was causing infinite loops because:
        //   1. No triggers matched → confidence = 0
        //   2. Confirmation asked → User says "yes"
        //   3. Next turn → Still no triggers → confidence = 0 → Loop!
        //
        // Solution: Let the LLM ask NATURAL clarifying questions instead
        // of robotic "was that a yes or no?" confirmations.
        //
        // Keep confirmations ONLY for high-risk: transfer, emergency, cancel
        // ════════════════════════════════════════════════════════════════════════
        // const confThreshold = settings.confirmBelowConfidence || 0.75;
        // if (confidence < confThreshold && actionLower !== 'continue') { ... }
        
        return { needsConfirmation: false };
    }
    
    /**
     * Process caller's response to confirmation question
     * @param {Object} params
     * @param {string} params.userInput - What the caller said
     * @param {Object} params.callState - Current call state with pending confirmation
     * @param {Object} params.llm0Controls - Company's LLM-0 controls
     * @returns {Object} { confirmed: boolean, nextAction: string, responseText?: string }
     */
    static processConfirmationResponse({ userInput, callState, llm0Controls }) {
        const settings = llm0Controls?.smartConfirmation || defaultSettings;
        const input = (userInput || '').toLowerCase().trim();
        
        // Detect YES responses
        const yesPatterns = [
            'yes', 'yeah', 'yep', 'yup', 'correct', 'right', 'that\'s right',
            'affirmative', 'absolutely', 'definitely', 'sure', 'ok', 'okay',
            'please', 'go ahead', 'do it', 'proceed', 'confirm'
        ];
        
        // Detect NO responses
        const noPatterns = [
            'no', 'nope', 'nah', 'wrong', 'not', 'don\'t', 'cancel',
            'wait', 'stop', 'hold on', 'actually', 'never mind', 'nevermind',
            'that\'s not', 'that is not', 'incorrect'
        ];
        
        // Check for YES
        if (yesPatterns.some(p => input.includes(p))) {
            return {
                confirmed: true,
                nextAction: callState.pendingAction || 'continue',
                debug: {
                    matched: 'yes',
                    input: input.substring(0, 50)
                }
            };
        }
        
        // Check for NO
        if (noPatterns.some(p => input.includes(p))) {
            const onNo = settings.onNoResponse || 'apologize_and_clarify';
            const clarifyPhrase = settings.clarifyPhrase || defaultSettings.clarifyPhrase;
            
            return {
                confirmed: false,
                nextAction: 'clarify',
                responseText: clarifyPhrase,
                debug: {
                    matched: 'no',
                    recovery: onNo,
                    input: input.substring(0, 50)
                }
            };
        }
        
        // Ambiguous response - ask again
        return {
            confirmed: false,
            nextAction: 'repeat_confirmation',
            responseText: "I'm sorry, I didn't catch that. Was that a yes or no?",
            debug: {
                matched: 'ambiguous',
                input: input.substring(0, 50)
            }
        };
    }
    
    /**
     * Build call state for pending confirmation
     * @param {Object} callState - Current call state
     * @param {Object} confirmationResult - Result from checkIfConfirmationNeeded
     * @param {Object} originalDecision - The original decision being confirmed
     * @returns {Object} Updated call state
     */
    static buildPendingState(callState, confirmationResult, originalDecision) {
        return {
            ...callState,
            pendingConfirmation: true,
            pendingAction: confirmationResult.pendingAction,
            pendingSeverity: confirmationResult.severity,
            originalDecision: {
                action: originalDecision.action,
                text: originalDecision.text,
                confidence: originalDecision.confidence,
                scenario: originalDecision.scenario
            },
            confirmationAskedAt: new Date().toISOString()
        };
    }
    
    /**
     * Clear pending confirmation from call state
     * @param {Object} callState - Current call state
     * @returns {Object} Updated call state without pending confirmation
     */
    static clearPendingState(callState) {
        const newState = { ...callState };
        delete newState.pendingConfirmation;
        delete newState.pendingAction;
        delete newState.pendingSeverity;
        delete newState.originalDecision;
        delete newState.confirmationAskedAt;
        return newState;
    }
}

module.exports = SmartConfirmationService;
