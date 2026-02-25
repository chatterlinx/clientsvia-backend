/**
 * ============================================================================
 * BLACKBOX RECORDING MODEL - DEPRECATED STUB
 * ============================================================================
 * This model has been deprecated and removed. This stub exists only to
 * prevent runtime crashes from legacy imports.
 * 
 * DO NOT ADD NEW CODE THAT USES THIS MODEL.
 * Use CallSummary and CallTranscript models for call data instead.
 * ============================================================================
 */

module.exports = {
  // Static methods - all return empty/null
  getCallDetail: async () => null,
  getCallList: async () => ({ calls: [], total: 0 }),
  findOne: async () => null,
  find: async () => [],
  countDocuments: async () => 0,
  
  // Schema info for scripts that check it
  schema: {
    path: () => ({ enumValues: [] })
  }
};
