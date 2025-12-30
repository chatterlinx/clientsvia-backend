const crypto = require('crypto');

/**
 * Stable stringify for deterministic hashing (sorts object keys recursively).
 * This is intentionally minimal (no BigInt/Date handling beyond string coercion).
 */
function stableStringify(value) {
  const seen = new WeakSet();

  const walk = (v) => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Date) return v.toISOString();

    if (Array.isArray(v)) return v.map(walk);

    if (typeof v === 'object') {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
      const out = {};
      for (const k of Object.keys(v).sort()) {
        out[k] = walk(v[k]);
      }
      return out;
    }

    // functions/symbols/etc.
    return String(v);
  };

  return JSON.stringify(walk(value));
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

/**
 * Compute an enterprise-grade "effective config version" hash.
 *
 * Rule:
 * - Hash ONLY inputs that affect runtime behavior (config + global content versions + provider versions).
 * - Never include volatile timestamps like "generatedAt".
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {object} [params.frontDeskBehavior] - company.aiAgentSettings.frontDeskBehavior
 * @param {object} [params.agentSettings] - company.agentSettings (for after-hours gating, etc.)
 * @param {Array}  [params.templateReferences] - company.aiAgentSettings.templateReferences
 * @param {Array}  [params.scenarioControls] - company.aiAgentSettings.scenarioControls
 * @param {Array}  [params.templatesMeta] - [{templateId, version, updatedAt, isPublished, isActive}]
 * @param {Array}  [params.placeholders] - company placeholders list (key/value)
 * @param {object} [params.providerVersions] - map of provider->version
 * @param {string} [params.algorithmVersion] - version label for this hashing algorithm
 */
function computeEffectiveConfigVersion({
  companyId,
  frontDeskBehavior = null,
  agentSettings = null,
  templateReferences = null,
  scenarioControls = null,
  templatesMeta = null,
  placeholders = null,
  providerVersions = null,
  algorithmVersion = 'ECV_V1'
}) {
  const payload = {
    algorithmVersion,
    companyId: String(companyId || ''),
    // Company-scoped behavior config
    frontDeskBehavior: frontDeskBehavior || null,
    agentSettings: agentSettings || null,
    templateReferences: templateReferences || null,
    scenarioControls: scenarioControls || null,
    // Global content versions that affect runtime behavior
    templatesMeta: templatesMeta || null,
    // Company-scoped placeholder substitutions can change spoken output
    placeholders: placeholders || null,
    // Provider versions ensure “same config + different algorithm” yields new version
    providerVersions: providerVersions || null
  };

  const canon = stableStringify(payload);
  const hex = sha256Hex(canon);
  // Short, URL-safe-ish identifier (still collision-resistant enough for ops)
  return `${algorithmVersion}_${hex.slice(0, 16)}`;
}

module.exports = {
  stableStringify,
  computeEffectiveConfigVersion
};


