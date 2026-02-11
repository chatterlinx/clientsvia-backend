/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LEGACY TRIAGE BOOBY-TRAP — Catches hidden call paths
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file replaces all legacy triage exports with functions that:
 * 1. Log an ERROR with full call stack (reveals hidden callers)
 * 2. Return a safe null result (don't crash the call)
 * 3. Log a BlackBox event for tracking
 *
 * If this fires in production, it means something is still calling
 * the old triage code and needs to be rewired to TriageEngineRouter.
 *
 * After 48 hours with no triggers, the legacy files can be deleted.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const logger = require('../../utils/logger');

function createTrap(functionName, originalFile) {
    return function legacyTriageTrap(...args) {
        const stack = new Error().stack;
        
        logger.error('[LEGACY_TRIAGE_CALLED] 🚨 Legacy triage function invoked — must rewire to TriageEngineRouter', {
            functionName,
            originalFile,
            callerStack: stack?.substring(0, 500),
            args: args.length,
            firstArg: typeof args[0] === 'string' ? args[0]?.substring(0, 100) : typeof args[0],
            timestamp: new Date().toISOString()
        });

        // Try to log to BlackBox for permanent record
        try {
            const BlackBoxLogger = require('../../services/BlackBoxLogger');
            BlackBoxLogger.logEvent({
                callId: 'LEGACY_TRIAGE_TRAP',
                companyId: 'UNKNOWN',
                type: 'LEGACY_TRIAGE_CALLED',
                data: {
                    functionName,
                    originalFile,
                    callerStack: stack?.substring(0, 500),
                    timestamp: new Date().toISOString()
                }
            }).catch(() => {});
        } catch {
            // BlackBox not available — that's fine, logger already captured it
        }

        // Return safe null result — DON'T crash the call
        return {
            matched: false,
            intentGuess: null,
            confidence: 0,
            callReasonDetail: null,
            matchedCardId: null,
            triageCardId: null,
            triageLabel: null,
            action: null,
            signals: {},
            _legacyTrap: true,
            _originalFile: originalFile,
            _functionName: functionName
        };
    };
}

function createAsyncTrap(functionName, originalFile) {
    const syncTrap = createTrap(functionName, originalFile);
    return async function asyncLegacyTriageTrap(...args) {
        return syncTrap(...args);
    };
}

module.exports = { createTrap, createAsyncTrap };
