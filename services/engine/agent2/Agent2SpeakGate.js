/**
 * ============================================================================
 * AGENT 2.0 SPEAK GATE (V4 - No-UI-No-Speak Enforcement)
 * ============================================================================
 *
 * THE SINGLE MANDATORY GATE FOR ALL SPOKEN OUTPUT.
 *
 * RULE: If a line can be spoken, it MUST have a UI path.
 *       There are ZERO literal English strings allowed in runtime.
 *       If UI doesn't have it, it doesn't exist.
 *
 * Every speak path in Agent 2.0 must call:
 *   resolveSpeakLine({ uiPath, config, emit })
 *
 * If the uiPath resolves to empty/missing → block and use emergency fallback.
 * If emergency fallback is also missing → emit CRITICAL and return empty.
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');

/**
 * Deep get a value from an object using dot notation path.
 * Supports array indexing like "templates.serviceDown[0]"
 * 
 * @param {Object} obj - The object to traverse
 * @param {string} path - Dot notation path (e.g., "empathy.templates.serviceDown[0]")
 * @returns {*} The value at the path, or undefined
 */
function deepGet(obj, path) {
  if (!obj || !path) return undefined;
  
  // Handle array notation like "templates.serviceDown[0]"
  const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalizedPath.split('.');
  
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  
  return current;
}

/**
 * @typedef {Object} SpeakLineRequest
 * @property {string} uiPath - Primary UI config path (e.g., "discovery.empathy.templates.serviceDown[0]")
 * @property {string} [fallbackUiPath] - Secondary UI path if primary is empty
 * @property {string} [emergencyUiPath] - Emergency fallback path (usually "emergencyFallbackLine.text")
 * @property {Object} config - The agent2 config object
 * @property {Function} emit - Event emitter function for logging
 * @property {string} sourceId - Identifier for this speak source (for logging)
 * @property {string} [reason] - Why this line is being spoken (for logging)
 */

/**
 * @typedef {Object} SpeakLineResult
 * @property {string} text - The resolved text to speak (may be empty if CRITICAL)
 * @property {string} uiPath - The UI path that provided the text
 * @property {boolean} blocked - True if the line was blocked (no UI path)
 * @property {string} severity - 'OK' | 'WARNING' | 'CRITICAL'
 * @property {string} [blockReason] - Why it was blocked (if blocked)
 */

/**
 * THE SINGLE MANDATORY GATE FOR ALL SPOKEN OUTPUT.
 * 
 * Call this for EVERY line the agent might speak.
 * It enforces: No UI path = No speech.
 * 
 * @param {SpeakLineRequest} request
 * @returns {SpeakLineResult}
 */
function resolveSpeakLine(request) {
  const { uiPath, fallbackUiPath, emergencyUiPath, config, emit, sourceId, reason } = request;
  
  const result = {
    text: '',
    uiPath: '',
    blocked: false,
    severity: 'OK',
    blockReason: null
  };
  
  // Validate inputs
  if (!config) {
    result.blocked = true;
    result.severity = 'CRITICAL';
    result.blockReason = 'No config object provided';
    emitBlocked(emit, sourceId, result, reason);
    return result;
  }
  
  // Try primary UI path
  if (uiPath) {
    const primaryText = resolveFromPath(config, uiPath);
    if (primaryText) {
      result.text = primaryText;
      result.uiPath = `aiAgentSettings.agent2.${uiPath}`;
      result.severity = 'OK';
      
      logger.debug('[SpeakGate] Resolved from primary path', {
        sourceId,
        uiPath: result.uiPath,
        textPreview: primaryText.substring(0, 50)
      });
      
      return result;
    }
  }
  
  // Try fallback UI path
  if (fallbackUiPath) {
    const fallbackText = resolveFromPath(config, fallbackUiPath);
    if (fallbackText) {
      result.text = fallbackText;
      result.uiPath = `aiAgentSettings.agent2.${fallbackUiPath}`;
      result.severity = 'WARNING';
      
      emit?.('SPEAK_GATE_FALLBACK', {
        sourceId,
        primaryPath: uiPath,
        fallbackPath: fallbackUiPath,
        resolvedFrom: 'fallback',
        reason
      });
      
      logger.debug('[SpeakGate] Resolved from fallback path', {
        sourceId,
        uiPath: result.uiPath,
        textPreview: fallbackText.substring(0, 50)
      });
      
      return result;
    }
  }
  
  // Try emergency fallback
  const emergencyPath = emergencyUiPath || 'emergencyFallbackLine.text';
  const emergencyText = resolveFromPath(config, emergencyPath);
  if (emergencyText) {
    result.text = emergencyText;
    result.uiPath = `aiAgentSettings.agent2.${emergencyPath}`;
    result.severity = 'WARNING';
    
    emit?.('SPEAK_GATE_EMERGENCY', {
      sourceId,
      primaryPath: uiPath,
      fallbackPath: fallbackUiPath,
      emergencyPath,
      resolvedFrom: 'emergency',
      reason,
      warning: 'Primary and fallback UI paths were empty - using emergency fallback'
    });
    
    logger.warn('[SpeakGate] Using emergency fallback', {
      sourceId,
      primaryPath: uiPath,
      fallbackPath: fallbackUiPath,
      emergencyPath
    });
    
    return result;
  }
  
  // CRITICAL: No UI-configured text available anywhere
  result.blocked = true;
  result.severity = 'CRITICAL';
  result.blockReason = 'No UI path resolved to valid text';
  result.uiPath = 'UNMAPPED';
  
  emitBlocked(emit, sourceId, result, reason, {
    attemptedPaths: [uiPath, fallbackUiPath, emergencyPath].filter(Boolean)
  });
  
  logger.error('[SpeakGate] CRITICAL - No UI path for spoken text', {
    sourceId,
    attemptedPaths: [uiPath, fallbackUiPath, emergencyPath].filter(Boolean),
    reason
  });
  
  return result;
}

/**
 * Resolve text from a config path.
 * Returns trimmed string or null if empty/missing.
 */
function resolveFromPath(config, path) {
  const value = deepGet(config, path);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  // Handle arrays - take first non-empty element
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === 'string') {
      const trimmed = first.trim();
      return trimmed || null;
    }
  }
  return null;
}

/**
 * Emit the SPOKEN_TEXT_UNMAPPED_BLOCKED event.
 */
function emitBlocked(emit, sourceId, result, reason, extra = {}) {
  emit?.('SPOKEN_TEXT_UNMAPPED_BLOCKED', {
    blockedSourceId: sourceId,
    blockedText: '(no text - blocked)',
    reason: result.blockReason,
    severity: result.severity,
    attemptedPaths: extra.attemptedPaths || [],
    originalReason: reason,
    action: 'Speech blocked - agent will be silent or use emergency fallback if available'
  });
}

/**
 * Validate that a config has all required UI paths populated.
 * Returns array of missing/empty paths.
 * 
 * @param {Object} config - The agent2 config
 * @returns {Array<{path: string, severity: string, description: string}>}
 */
function validateRequiredPaths(config) {
  const issues = [];
  
  const requiredPaths = [
    { path: 'emergencyFallbackLine.text', severity: 'CRITICAL', description: 'Emergency fallback (last resort)' },
    { path: 'discovery.playbook.fallback.noMatchAnswer', severity: 'HIGH', description: 'Fallback when no trigger and no reason' },
    { path: 'discovery.playbook.fallback.noMatchWhenReasonCaptured', severity: 'HIGH', description: 'Fallback when reason captured but no trigger' },
    { path: 'greetings.callStart.text', severity: 'HIGH', description: 'Call start greeting' }
  ];
  
  const recommendedPaths = [
    { path: 'discovery.humanTone.templates.general', severity: 'MEDIUM', description: 'General empathy template' },
    { path: 'discovery.humanTone.templates.serviceDown', severity: 'MEDIUM', description: 'Service-down empathy template' },
    { path: 'discovery.discoveryHandoff.consentQuestion', severity: 'MEDIUM', description: 'Handoff consent question' },
    { path: 'discovery.playbook.fallback.noMatchClarifierQuestion', severity: 'LOW', description: 'Clarifier question' }
  ];
  
  for (const req of [...requiredPaths, ...recommendedPaths]) {
    const value = resolveFromPath(config, req.path);
    if (!value) {
      issues.push({
        path: `aiAgentSettings.agent2.${req.path}`,
        severity: req.severity,
        description: req.description,
        status: 'MISSING_OR_EMPTY'
      });
    }
  }
  
  return issues;
}

/**
 * Get the full UI path for logging/tracing.
 */
function getFullUiPath(relativePath) {
  return `aiAgentSettings.agent2.${relativePath}`;
}

module.exports = {
  resolveSpeakLine,
  validateRequiredPaths,
  getFullUiPath,
  deepGet
};
