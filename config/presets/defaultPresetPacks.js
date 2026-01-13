/**
 * ============================================================================
 * DEFAULT PRESET PACK DEFINITIONS (Backend-owned)
 * ============================================================================
 *
 * PURPOSE:
 * - Single canonical place to define which PresetPack records are considered
 *   "default bootstrap packs" for a trade.
 * - Used by the admin "Seed Default Packs" API (and optionally scripts).
 *
 * IMPORTANT:
 * - These packs are UI-loadable only. They do NOT affect runtime until an admin
 *   loads + saves changes into company config.
 */

function getDefaultPresetPacks() {
  // Lazy-require to keep startup fast and avoid circular deps.
  const hvacResidential = require('../goldenSetups/hvac_residential');

  const hvacGoldenBlueprint = {
    tradeKey: 'hvac',
    packId: 'golden-blueprint',
    version: 'v1',
    label: 'HVAC Golden Blueprint (DEFAULT - OVERRIDE IN UI)',
    description: 'Best-practice HVAC setup pack for onboarding. Load into UI (not saved) and customize per company.',
    status: 'published',
    payload: {
      source: 'config/goldenSetups/hvac_residential.js',
      profileKey: hvacResidential.profileKey,
      tradeCategoryKey: hvacResidential.tradeCategoryKey,
      placeholders: hvacResidential.placeholders,
      frontDeskBehavior: hvacResidential.frontDeskBehavior,
      booking: hvacResidential.booking,
      defaultReplies: hvacResidential.defaultReplies,
      transfers: hvacResidential.transfers,
      callProtection: hvacResidential.callProtection,
      dynamicFlows: hvacResidential.dynamicFlows
    }
  };

  return [hvacGoldenBlueprint];
}

module.exports = {
  getDefaultPresetPacks
};

