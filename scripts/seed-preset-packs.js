/**
 * Seed Preset Packs into MongoDB
 *
 * Usage:
 *   MONGODB_URI="mongodb+srv://..." node scripts/seed-preset-packs.js
 *
 * Notes:
 * - This seeds DB data only (PresetPack library). It does NOT affect runtime until an admin loads + saves.
 * - Seeded content is visible/editable in the UI after load.
 */

const mongoose = require('mongoose');
const PresetPack = require('../models/PresetPack');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(uri);

  // Existing demo config (Penguin Air reference). Treat as a pack payload.
  // IMPORTANT: this is not runtime behavior; it is a UI-loadable, editable starting point.
  const hvacResidential = require('../config/goldenSetups/hvac_residential');

  const pack = {
    tradeKey: 'hvac',
    packId: 'golden-blueprint',
    version: 'v1',
    label: 'HVAC Golden Blueprint (DEFAULT - OVERRIDE IN UI)',
    description: 'Best-practice HVAC setup pack for demos/onboarding. Load into UI (not saved) and customize per company.',
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
    },
    updatedBy: 'seed-script',
    createdBy: 'seed-script'
  };

  const res = await PresetPack.findOneAndUpdate(
    { tradeKey: pack.tradeKey, packId: pack.packId, version: pack.version },
    { $set: pack },
    { upsert: true, new: true }
  ).lean();

  console.log('✅ Seeded PresetPack:', {
    tradeKey: res.tradeKey,
    packId: res.packId,
    version: res.version,
    status: res.status,
    updatedAt: res.updatedAt
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Seed preset packs failed:', err);
  process.exitCode = 1;
});


