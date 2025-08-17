// Phase 2 — live resolver
const _ = require("lodash");
const getDefaults = require("../presets/platformDefaults");
const hvacPack = require("../presets/starterPack.hvac_v1.json");
const cache = require("./effectiveConfigCache");

// Lazy load Company model to avoid MongoDB connection on require
let Company;
function getCompanyModel() {
  if (!Company) {
    Company = require("../../models/Company");
  }
  return Company;
}

// custom merge: arrays prefer override if defined, else fallback
const _merge = (top, mid, base) => _.mergeWith({}, base, mid, top, (obj, src) => {
  if (Array.isArray(obj) || Array.isArray(src)) return src !== undefined ? src : obj;
  return undefined;
});

async function _loadCompanyOverrides(companyId) {
  const Company = getCompanyModel();
  const company = await Company.findById(companyId).lean();
  if (!company) throw new Error("Company not found");
  // Collect only relevant override sections you already store
  return {
    routing: company.agentRoutingSettings || undefined,
    knowledge: company.agentKnowledgeSettings || undefined,
    enterprise: company.agentIntelligenceSettings || undefined,
    behavior: company.agentBehaviorSettings || undefined,
    voice: company.agentVoiceSettings || undefined,
    transfer: company.agentTransferSettings || undefined,
    booking: company.agentBookingSettings || undefined,
    fallbacks: company.agentFallbackSettings || undefined,
    qna: {
      companyQA: company.companyQnA || undefined,
      tradeQA: company.tradeQnA || undefined,
      generic: company.genericQnA || undefined
    }
  };
}

exports.getEffectiveSettings = async (companyId) => {
  const hit = cache.get(companyId);
  if (hit) return { etag: hit.etag, config: hit.data };

  const platform = getDefaults();
  const companyOverrides = await _loadCompanyOverrides(companyId);

  // merge layers: companyOverrides → hvacPack → platform
  const merged = _merge(companyOverrides, hvacPack, platform);
  const etag = cache.set(companyId, merged);
  return { etag, config: merged };
};

exports.getEffectiveModule = async (companyId, moduleKey) => {
  const { etag, config } = await exports.getEffectiveSettings(companyId);
  return { etag, module: config?.[moduleKey] ?? null };
};

// returns JUST starter pack for a module (used by Reset to populate the form)
exports.getPackModule = (moduleKey) => hvacPack?.[moduleKey] ?? null;
