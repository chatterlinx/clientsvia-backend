const { FrontDeskCoreRuntime } = require('./FrontDeskCoreRuntime');

const LANES = {
    DISCOVERY: 'DISCOVERY',
    BOOKING: 'BOOKING',
    ESCALATE: 'ESCALATE'
};

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
    if (level) {
        return level === 'strict';
    }
    return effectiveConfig?.frontDesk?.enforcement?.strictControlPlaneOnly === true;
}

function getEnforcementLevel(effectiveConfig) {
    const level = effectiveConfig?.frontDesk?.enforcement?.level;
    if (level && ['warn', 'strict'].includes(level)) {
        return level;
    }
    return effectiveConfig?.frontDesk?.enforcement?.strictControlPlaneOnly === true ? 'strict' : 'warn';
}

module.exports = {
    handleTurn,
    determineLane,
    isStrictModeEnabled,
    getEnforcementLevel,
    LANES
};
