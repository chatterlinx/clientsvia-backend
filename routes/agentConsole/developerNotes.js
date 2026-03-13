/**
 * Developer Notes Routes
 *
 * CRUD endpoints for the enterprise build notepad.
 * Keyed by companyId — full tab/section state stored as a single document.
 *
 * GET  /api/developer-notes/:companyId        — load all notes
 * PUT  /api/developer-notes/:companyId        — save all notes (full replace)
 * DELETE /api/developer-notes/:companyId/tab/:tabId — delete a single tab
 *
 * @module routes/agentConsole/developerNotes
 */

const express = require('express');
const router  = express.Router();
const DeveloperNotes = require('../../models/DeveloperNotes');

// ── GET — load all notes ────────────────────────────────────────────────────
router.get('/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const doc = await DeveloperNotes.getNotes(companyId);
    res.json({ success: true, notes: doc });
  } catch (err) {
    console.error('[DeveloperNotes] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT — save all notes (full upsert) ─────────────────────────────────────
router.put('/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { tabs, lastActiveTabId } = req.body;
    const doc = await DeveloperNotes.saveNotes(companyId, { tabs, lastActiveTabId });
    res.json({ success: true, notes: doc });
  } catch (err) {
    console.error('[DeveloperNotes] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
