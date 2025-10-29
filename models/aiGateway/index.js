// ============================================================================
// 📦 AI GATEWAY - MODELS INDEX
// ============================================================================
// PURPOSE: Central export point for all AI Gateway models
// USAGE: const { AIGatewayCallLog, AIGatewaySuggestion } = require('./models/aiGateway');
// CREATED: 2025-10-29
// ============================================================================

const AIGatewayCallLog = require('./CallLog');
const AIGatewaySuggestion = require('./Suggestion');

module.exports = {
    AIGatewayCallLog,
    AIGatewaySuggestion
};

