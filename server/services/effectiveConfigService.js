// Phase 2 — Service wrapper for effective config resolver + cache
const resolver = require('./effectiveConfigResolver');
const cache = require('./effectiveConfigCache');

const getEffectiveSettings = async (companyId) => {
  return await resolver.getEffectiveSettings(companyId);
};

const invalidate = (companyId) => {
  cache.invalidate(companyId);
};

module.exports = { getEffectiveSettings, invalidate };
