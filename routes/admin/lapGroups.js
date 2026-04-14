'use strict';

/**
 * ============================================================================
 * ADMIN — LAP ENTRIES  (Phrase-Response Table)
 * ============================================================================
 *
 * PURPOSE:
 *   Manage the GLOBAL LAP phrase-response entries for ListenerActParser.
 *   Each entry = one phrase + 1-3 response texts (rotated randomly at runtime).
 *   All companies inherit these entries. Audio is per-company (LAPResponseAudio).
 *
 * AUTH:   authenticateJWT  (admin access)
 *
 * ROUTES:
 *   GET    /api/admin/globalshare/lap-groups              → list all entries
 *   POST   /api/admin/globalshare/lap-groups              → create entry
 *   PATCH  /api/admin/globalshare/lap-groups/:entryId     → update entry
 *   DELETE /api/admin/globalshare/lap-groups/:entryId     → remove entry
 *   POST   /api/admin/globalshare/lap-groups/reorder      → bulk update sortOrder
 *   POST   /api/admin/globalshare/lap-groups/bulk         → bulk save all entries
 *
 * NOTE: URL path kept as /lap-groups for backward compat with index.js mounting.
 *
 * ============================================================================
 */

const express          = require('express');
const router           = express.Router();
const { v4: uuidv4 }  = require('uuid');
const logger           = require('../../utils/logger');
const AdminSettings    = require('../../models/AdminSettings');
const GlobalHubService = require('../../services/GlobalHubService');
const LAPService       = require('../../services/engine/lap/LAPService');
const { authenticateJWT } = require('../../middleware/auth');

router.use(authenticateJWT);

// ── helpers ──────────────────────────────────────────────────────────────────

function _sanitizeEntry(e, sortOrder) {
  return {
    id:         e.id || uuidv4(),
    phrase:     (e.phrase || '').toLowerCase().trim(),
    action:     ['respond', 'hold', 'repeat_last'].includes(e.action) ? e.action : 'respond',
    responses:  (e.responses || [])
                  .map(r => (r || '').trim())
                  .filter(Boolean)
                  .slice(0, 3),
    holdConfig: e.action === 'hold' && e.holdConfig ? {
      maxHoldSeconds:      Number(e.holdConfig.maxHoldSeconds)      || 60,
      deadAirCheckSeconds: Number(e.holdConfig.deadAirCheckSeconds) || 15,
      deadAirPrompt:       (e.holdConfig.deadAirPrompt || 'Are you still there?').trim(),
      resumeKeywords:      (e.holdConfig.resumeKeywords || ['ok', 'back', 'ready', 'yes', "i'm here"])
                             .map(k => (k || '').toLowerCase().trim())
                             .filter(Boolean),
    } : null,
    enabled:    e.enabled !== false,
    sortOrder:  typeof e.sortOrder === 'number' ? e.sortOrder : sortOrder,
  };
}

async function _saveEntries(entries, userEmail) {
  await AdminSettings.findOneAndUpdate(
    {},
    {
      $set: {
        'globalHub.lapEntries':           entries,
        'globalHub.lapEntriesUpdatedAt':  new Date(),
        'globalHub.lapEntriesUpdatedBy':  userEmail || 'admin',
      }
    },
    { upsert: true, runValidators: false }
  );
  await GlobalHubService.syncLapEntriesToRedis(entries);
  await LAPService.invalidateAll();
}

// ── GET / ─ list all entries ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const entries = await GlobalHubService.getLapEntries();
    res.json({ entries });
  } catch (err) {
    logger.error('[LAP ADMIN] GET entries failed', { error: err.message });
    res.status(500).json({ error: 'Failed to load LAP entries' });
  }
});

// ── POST / ─ create new entry ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const entries = await GlobalHubService.getLapEntries();
    const newEntry = _sanitizeEntry(req.body, entries.length);
    entries.push(newEntry);
    await _saveEntries(entries, req.user?.email);

    logger.info('[LAP ADMIN] Entry created', { id: newEntry.id, phrase: newEntry.phrase, by: req.user?.email });
    res.json({ success: true, entry: newEntry });
  } catch (err) {
    logger.error('[LAP ADMIN] POST entry failed', { error: err.message });
    res.status(500).json({ error: 'Failed to create LAP entry' });
  }
});

// ── POST /reorder ─ bulk update sortOrder ────────────────────────────────────
router.post('/reorder', async (req, res) => {
  try {
    const { order } = req.body; // array of entry IDs in desired order
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array of entry IDs' });
    }

    const entries = await GlobalHubService.getLapEntries();
    const entryMap = new Map(entries.map(e => [e.id, e]));

    // Rebuild in new order, append any not mentioned at the end
    const reordered = [];
    for (let i = 0; i < order.length; i++) {
      const entry = entryMap.get(order[i]);
      if (entry) {
        entry.sortOrder = i;
        reordered.push(entry);
        entryMap.delete(order[i]);
      }
    }
    // Append remaining
    for (const entry of entryMap.values()) {
      entry.sortOrder = reordered.length;
      reordered.push(entry);
    }

    await _saveEntries(reordered, req.user?.email);
    res.json({ success: true, count: reordered.length });
  } catch (err) {
    logger.error('[LAP ADMIN] POST reorder failed', { error: err.message });
    res.status(500).json({ error: 'Failed to reorder LAP entries' });
  }
});

// ── POST /bulk ─ save all entries at once ────────────────────────────────────
router.post('/bulk', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries must be an array' });
    }

    const clean = entries.map((e, i) => _sanitizeEntry(e, i));
    await _saveEntries(clean, req.user?.email);

    logger.info('[LAP ADMIN] Bulk save', { count: clean.length, by: req.user?.email });
    res.json({ success: true, count: clean.length, entries: clean });
  } catch (err) {
    logger.error('[LAP ADMIN] POST bulk failed', { error: err.message });
    res.status(500).json({ error: 'Failed to bulk save LAP entries' });
  }
});

// ── PATCH /:entryId ─ update single entry ────────────────────────────────────
router.patch('/:entryId', async (req, res) => {
  const { entryId } = req.params;
  try {
    const entries = await GlobalHubService.getLapEntries();
    const idx = entries.findIndex(e => e.id === entryId);
    if (idx === -1) {
      return res.status(404).json({ error: `LAP entry '${entryId}' not found` });
    }

    // Merge updates
    const updated = _sanitizeEntry({ ...entries[idx], ...req.body }, entries[idx].sortOrder);
    updated.id = entryId; // preserve original ID
    entries[idx] = updated;

    await _saveEntries(entries, req.user?.email);

    logger.info('[LAP ADMIN] Entry updated', { id: entryId, phrase: updated.phrase, by: req.user?.email });
    res.json({ success: true, entry: updated });
  } catch (err) {
    logger.error('[LAP ADMIN] PATCH entry failed', { entryId, error: err.message });
    res.status(500).json({ error: 'Failed to update LAP entry' });
  }
});

// ── DELETE /:entryId ─ remove entry ──────────────────────────────────────────
router.delete('/:entryId', async (req, res) => {
  const { entryId } = req.params;
  try {
    const entries = await GlobalHubService.getLapEntries();
    const filtered = entries.filter(e => e.id !== entryId);
    if (filtered.length === entries.length) {
      return res.status(404).json({ error: `LAP entry '${entryId}' not found` });
    }

    // Reindex sortOrder
    filtered.forEach((e, i) => { e.sortOrder = i; });
    await _saveEntries(filtered, req.user?.email);

    logger.info('[LAP ADMIN] Entry deleted', { id: entryId, by: req.user?.email });
    res.json({ success: true, remaining: filtered.length });
  } catch (err) {
    logger.error('[LAP ADMIN] DELETE entry failed', { entryId, error: err.message });
    res.status(500).json({ error: 'Failed to delete LAP entry' });
  }
});

// ── GET /audio-status ─ audio coverage for a company ─────────────────────────
router.get('/audio-status', async (req, res) => {
  const { companyId } = req.query;
  if (!companyId) {
    return res.status(400).json({ error: 'companyId query parameter required' });
  }

  try {
    const v2Company         = require('../../models/v2Company');
    const LAPResponseAudio  = require('../../models/LAPResponseAudio');
    const InstantAudioService = require('../../services/instantAudio/InstantAudioService');

    const entries = await GlobalHubService.getLapEntries();
    const company = await v2Company.findById(companyId).select('aiAgentSettings.voiceSettings').lean();
    const vs = company?.aiAgentSettings?.voiceSettings;
    const coverage = {};

    // Collect all response texts across all entries
    const allTexts = [];
    for (const e of entries) {
      for (const r of (e.responses || [])) {
        const text = (r || '').trim();
        if (text) allTexts.push(text);
      }
    }

    if (!vs?.voiceId) {
      allTexts.forEach(t => { coverage[t] = false; });
    } else {
      for (const text of allTexts) {
        const status = InstantAudioService.getStatus({
          companyId, kind: 'LAP_RESPONSE', text, voiceSettings: vs,
        });
        const hashMatch = status.fileName?.match(/([a-f0-9]{16})\.mp3$/);
        if (!hashMatch) { coverage[text] = false; continue; }
        const existing = await LAPResponseAudio.findOne({
          companyId, fileHash: hashMatch[1], isValid: true,
        }).select('_id').lean();
        coverage[text] = !!existing;
      }
    }

    res.json({ coverage });
  } catch (err) {
    logger.error('[LAP ADMIN] GET audio-status failed', { companyId, error: err.message });
    res.status(500).json({ error: 'Failed to load audio status' });
  }
});

// ── POST /audio-generate ─ generate TTS for LAP response texts ───────────────
router.post('/audio-generate', async (req, res) => {
  const { companyId, texts } = req.body;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });
  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: 'texts must be a non-empty array' });
  }

  try {
    const fs                  = require('fs');
    const v2Company           = require('../../models/v2Company');
    const LAPResponseAudio    = require('../../models/LAPResponseAudio');
    const InstantAudioService = require('../../services/instantAudio/InstantAudioService');

    const company = await v2Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const vs = company?.aiAgentSettings?.voiceSettings;
    if (!vs?.voiceId) {
      return res.status(400).json({
        error: 'No voice configured — set your ElevenLabs voice in Agent Settings first.',
      });
    }

    let generated = 0, skipped = 0, errors = 0;
    const uniqueTexts = [...new Set(texts.map(t => (t || '').trim()).filter(Boolean))];

    for (const text of uniqueTexts) {
      try {
        const status = InstantAudioService.getStatus({
          companyId, kind: 'LAP_RESPONSE', text, voiceSettings: vs,
        });
        const hashMatch = status.fileName?.match(/([a-f0-9]{16})\.mp3$/);
        if (!hashMatch) { skipped++; continue; }

        const fileHash = hashMatch[1];
        const existing = await LAPResponseAudio.findOne({
          companyId, fileHash, isValid: true,
        }).select('_id').lean();

        if (existing) { skipped++; continue; }

        const genResult = await InstantAudioService.generate({
          companyId, kind: 'LAP_RESPONSE', text, company, voiceSettings: vs, force: false,
        });

        const safeUrl = genResult.url.replace('/audio/', '/audio-safe/');
        try {
          const buffer = fs.readFileSync(genResult.filePath);
          await LAPResponseAudio.saveAudio(companyId, fileHash, safeUrl, text, vs.voiceId, buffer);
        } catch (persistErr) {
          logger.warn('[LAP ADMIN] audio-generate — MongoDB persist failed', { companyId, fileHash, error: persistErr.message });
        }

        generated++;
        logger.info('[LAP ADMIN] audio-generate — generated', { companyId: companyId.slice(0, 12), text: text.slice(0, 50), fileHash });
      } catch (genErr) {
        errors++;
        logger.warn('[LAP ADMIN] audio-generate — generation failed', { companyId, text: text.slice(0, 50), error: genErr.message });
      }
    }

    logger.info('[LAP ADMIN] audio-generate complete', { companyId, generated, skipped, errors, total: uniqueTexts.length });
    res.json({ generated, skipped, errors, total: uniqueTexts.length });
  } catch (err) {
    logger.error('[LAP ADMIN] POST audio-generate failed', { companyId, error: err.message });
    res.status(500).json({ error: 'Audio generation failed' });
  }
});

module.exports = router;
