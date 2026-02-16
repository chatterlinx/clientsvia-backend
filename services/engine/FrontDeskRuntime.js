/**
 * ════════════════════════════════════════════════════════════════════════════
 * FRONT DESK RUNTIME - LEGACY COMPATIBILITY WRAPPER
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * ⚠️ DEPRECATED: This file exists ONLY for boot-time verification in index.js
 * 
 * All actual call flow logic is in FrontDeskCoreRuntime.js
 * Do NOT add new functionality here.
 * 
 * This wrapper will be removed in a future version.
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

const { FrontDeskCoreRuntime } = require('./FrontDeskCoreRuntime');

// Lane constants - exposed for boot verification
const LANES = {
    DISCOVERY: 'DISCOVERY',
    BOOKING: 'BOOKING',
    ESCALATE: 'ESCALATE'
};

// Thin wrapper - delegates to FrontDeskCoreRuntime
async function handleTurn(effectiveConfig, callState, userTurn, context = {}) {
    return FrontDeskCoreRuntime.processTurn(effectiveConfig, callState, userTurn, context);
}

function determineLane(_effectiveConfig, callState) {
    if (callState?.sessionMode === 'BOOKING' || callState?.bookingModeLocked === true) {
        return LANES.BOOKING;
    }
    return LANES.DISCOVERY;
}

function isStrictModeEnabled(effectiveConfig) {
    const level = effectiveConfig?.frontDesk?.enforcement?.level;
    return level === 'strict' || effectiveConfig?.frontDesk?.enforcement?.strictControlPlaneOnly === true;
}

function getEnforcementLevel(effectiveConfig) {
    const level = effectiveConfig?.frontDesk?.enforcement?.level;
    if (level && ['warn', 'strict'].includes(level)) return level;
    return effectiveConfig?.frontDesk?.enforcement?.strictControlPlaneOnly === true ? 'strict' : 'warn';
}

module.exports = {
    handleTurn,
    determineLane,
    isStrictModeEnabled,
    getEnforcementLevel,
    LANES
};
