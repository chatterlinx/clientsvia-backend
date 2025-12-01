/**
 * ============================================================================
 * ORCHESTRATION SERVICES - BRAIN 1 (LLM-0)
 * ============================================================================
 * 
 * This folder contains the LLM-0 orchestration layer:
 * - LLM0Contracts.js - Hard I/O specifications
 * - LLM0OrchestratorService.js - Main entry point for Brain 1
 * 
 * ARCHITECTURE:
 *   Caller → Brain 1 (LLM-0) → Triage Cards → Brain 2 (3-Tier)
 * 
 * ============================================================================
 */

const { decideNextStep, getCircuitBreakerStatus } = require('./LLM0OrchestratorService');
const Contracts = require('./LLM0Contracts');

module.exports = {
    // Main entry point
    decideNextStep,
    getCircuitBreakerStatus,
    
    // Contracts
    Contracts,
    VALID_ACTIONS: Contracts.VALID_ACTIONS,
    isValidAction: Contracts.isValidAction,
    normalizeDecision: Contracts.normalizeDecision,
    createEmptyDecision: Contracts.createEmptyDecision
};

