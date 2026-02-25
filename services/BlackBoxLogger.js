/**
 * ============================================================================
 * BLACKBOX LOGGER - DEPRECATED STUB
 * ============================================================================
 * This module has been deprecated and removed. This stub exists only to
 * prevent runtime crashes from legacy imports. All methods are no-ops.
 * 
 * DO NOT ADD NEW CODE THAT USES THIS MODULE.
 * Use CallSummary and CallTranscript models for call data instead.
 * ============================================================================
 */

const noop = () => {};
const noopAsync = async () => {};
const noopWithReturn = () => ({ success: true });
const noopAsyncWithReturn = async () => ({ success: true });

module.exports = {
  // Core methods - all no-ops
  initCall: noopAsync,
  logEvent: noopAsync,
  addEvent: noopAsync,
  appendError: noopAsync,
  addTranscript: noopAsync,
  finalizeCall: noopAsync,
  ensureCall: noopAsync,
  queryEvents: async () => [],
  getCallDetail: async () => null,
  getCallList: async () => ({ calls: [], total: 0 }),
  
  // QuickLog shortcuts
  QuickLog: {
    greetingSent: noopAsync,
    ttsStarted: noopAsync,
    ttsCompleted: noopAsync,
    ttsFailed: noopAsync,
  },
  
  // For any other method access
  log: noopAsync,
};
