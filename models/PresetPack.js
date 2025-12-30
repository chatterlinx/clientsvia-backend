/**
 * ============================================================================
 * PRESET PACK - Versioned, Audited "Golden Blueprint" payloads (UI-loaded)
 * ============================================================================
 *
 * PURPOSE:
 * - Store best-practice configuration packs per tradeKey (HVAC, Plumbing, etc.)
 * - UI can fetch a pack and load it into form state (NOT saved until user clicks Save)
 * - Enables iteration without redeploying the UI (enterprise requirement)
 *
 * IMPORTANT:
 * - This model does NOT affect runtime behavior by itself.
 * - Runtime must read ONLY persisted company config (proved by /runtime-truth).
 * - Preset packs are just a library of editable starting points.
 */

const mongoose = require('mongoose');

const presetPackSchema = new mongoose.Schema(
  {
    tradeKey: { type: String, required: true, trim: true }, // e.g. "hvac"
    packId: { type: String, required: true, trim: true }, // e.g. "golden-blueprint"
    version: { type: String, required: true, trim: true }, // e.g. "v1"

    label: { type: String, required: true, trim: true }, // human-friendly name
    description: { type: String, default: null, trim: true },

    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },

    // UI payload (shape is intentionally flexible; UI + apply endpoints validate what they consume)
    payload: { type: mongoose.Schema.Types.Mixed, required: true },

    // Audit metadata
    createdBy: { type: String, default: null, trim: true },
    updatedBy: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

presetPackSchema.index({ tradeKey: 1, packId: 1, version: 1 }, { unique: true });
presetPackSchema.index({ tradeKey: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('PresetPack', presetPackSchema);


