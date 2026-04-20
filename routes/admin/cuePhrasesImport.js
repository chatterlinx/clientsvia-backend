/**
 * ============================================================================
 * CUE PHRASES IMPORT — Standalone Admin Endpoint
 * ============================================================================
 *
 * Purpose:
 *   Safe, backup-rotated bulk import of the GlobalShare cuePhrases dictionary.
 *   Kept deliberately separate from the main globalshare routes because import
 *   is a DESTRUCTIVE operation that deserves its own isolated surface with:
 *     - diff preview BEFORE apply
 *     - 5-deep backup rotation
 *     - restore-previous
 *     - explicit audit trail
 *
 * Mount:
 *   app.use('/api/admin/cue-phrases-import', require('./routes/admin/cuePhrasesImport'));
 *
 * Endpoints:
 *   GET  /state                — current counts + recent backups list
 *   POST /preview              — body: { cuePhrases: [...] } → diff report
 *   POST /apply                — body: { cuePhrases: [...] } → backup + replace + flush cache
 *   POST /restore/:backupId    — restore backup (snapshots current as new backup first)
 *
 * Backup record shape (stored at AdminSettings.globalHub.phraseIntelligenceBackups):
 *   {
 *     backupId: <uuid>,
 *     createdAt: Date,
 *     createdBy: String,
 *     reason: String,
 *     patterns: [{ pattern, token }],
 *     counts: { <token>: <n> }
 *   }
 *   Ring-buffered to MAX_BACKUPS via $push + $slice.
 *
 * Security:
 *   Mounted under /api/admin/* so inherits whatever auth middleware protects
 *   that prefix (JWT / session). Every mutation stamps
 *   phraseIntelligenceUpdatedBy + phraseIntelligenceUpdatedAt.
 *
 * Cache invalidation:
 *   Every mutation calls PhraseReducerService.invalidateCache() so the
 *   CueExtractor picks up the new dictionary on the very next extract() call.
 *   NO server restart required.
 * ============================================================================
 */
'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const logger = require('../../utils/logger');
const AdminSettings = require('../../models/AdminSettings');
const PhraseReducerService = require('../../services/phraseIntelligence/PhraseReducerService');

const VALID_TOKENS = new Set([
    'requestCue', 'permissionCue', 'infoCue', 'directiveCue',
    'actionCore', 'urgencyCore', 'modifierCore',
]);

const MAX_BACKUPS = 5;
const MAX_PATTERNS = 10000; // sanity ceiling — current DB is ~1,927
const BAD_ROW_REJECT_PCT = 0.10; // >10% malformed → reject whole payload

// ── Helpers ─────────────────────────────────────────────────────────────────
function _countByToken(patterns) {
    const counts = {};
    if (!Array.isArray(patterns)) return counts;
    for (const p of patterns) {
        const t = (p && p.token) || 'UNKNOWN';
        counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
}

function _validatePatterns(raw) {
    if (!Array.isArray(raw)) {
        return { ok: false, error: 'cuePhrases must be an array' };
    }
    if (raw.length === 0) {
        return { ok: false, error: 'cuePhrases cannot be empty (refusing to wipe the dictionary)' };
    }
    if (raw.length > MAX_PATTERNS) {
        return { ok: false, error: `cuePhrases cannot exceed ${MAX_PATTERNS} items (got ${raw.length})` };
    }

    const seen = new Set();
    const bad = [];
    const clean = [];
    for (let i = 0; i < raw.length; i++) {
        const row = raw[i];
        if (!row || typeof row !== 'object') {
            bad.push({ idx: i, reason: 'not an object' });
            continue;
        }
        const pattern = (row.pattern || '').toString().toLowerCase().trim();
        const token = (row.token || '').toString().trim();
        if (!pattern) {
            bad.push({ idx: i, reason: 'empty pattern', token });
            continue;
        }
        if (!VALID_TOKENS.has(token)) {
            bad.push({ idx: i, reason: `invalid token "${token}"`, pattern });
            continue;
        }
        const key = `${pattern}|${token}`;
        if (seen.has(key)) continue; // silent dedup
        seen.add(key);
        clean.push({ pattern, token });
    }

    if (bad.length > 0 && bad.length >= raw.length * BAD_ROW_REJECT_PCT) {
        return {
            ok: false,
            error: `${bad.length} of ${raw.length} rows invalid (${Math.round(bad.length / raw.length * 100)}%, threshold ${Math.round(BAD_ROW_REJECT_PCT * 100)}%). Fix the source JSON and retry.`,
            bad: bad.slice(0, 20),
        };
    }
    return { ok: true, clean, skipped: bad };
}

async function _getCurrent() {
    const settings = await AdminSettings.getSettings();
    const pi = settings?.globalHub?.phraseIntelligence || {};
    return {
        current: Array.isArray(pi.cuePhrases) ? pi.cuePhrases : [],
        backups: Array.isArray(settings?.globalHub?.phraseIntelligenceBackups)
            ? settings.globalHub.phraseIntelligenceBackups : [],
    };
}

function _diff(before, after) {
    const beforeKeys = new Set(before.map(p => `${p.pattern}|${p.token}`));
    const afterKeys = new Set(after.map(p => `${p.pattern}|${p.token}`));
    const added = after.filter(p => !beforeKeys.has(`${p.pattern}|${p.token}`));
    const removed = before.filter(p => !afterKeys.has(`${p.pattern}|${p.token}`));
    return { added, removed };
}

// ── GET /export ─────────────────────────────────────────────────────────────
// Download current cuePhrases as a standalone JSON file (bare array).
// Shape matches what POST /apply expects — round-trips cleanly.
router.get('/export', async (req, res) => {
    try {
        const { current } = await _getCurrent();
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `cuePhrases-${stamp}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify({
            exportedAt: new Date().toISOString(),
            total: current.length,
            counts: _countByToken(current),
            cuePhrases: current,
        }, null, 2));
    } catch (err) {
        logger.error('[cuePhrasesImport /export]', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /state ──────────────────────────────────────────────────────────────
router.get('/state', async (req, res) => {
    try {
        const { current, backups } = await _getCurrent();
        res.json({
            success: true,
            total: current.length,
            counts: _countByToken(current),
            backups: backups.map(b => ({
                backupId: b.backupId,
                createdAt: b.createdAt,
                createdBy: b.createdBy || 'unknown',
                reason: b.reason || '',
                total: Array.isArray(b.patterns) ? b.patterns.length : 0,
                counts: b.counts || {},
            })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        });
    } catch (err) {
        logger.error('[cuePhrasesImport /state]', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /preview ───────────────────────────────────────────────────────────
router.post('/preview', async (req, res) => {
    try {
        const v = _validatePatterns(req.body?.cuePhrases);
        if (!v.ok) return res.status(400).json({ success: false, error: v.error, bad: v.bad });

        const { current } = await _getCurrent();
        const beforeCounts = _countByToken(current);
        const afterCounts = _countByToken(v.clean);

        const tokens = new Set([...Object.keys(beforeCounts), ...Object.keys(afterCounts)]);
        const byToken = {};
        for (const t of [...tokens].sort()) {
            const before = beforeCounts[t] || 0;
            const after = afterCounts[t] || 0;
            byToken[t] = { before, after, delta: after - before };
        }

        const { added, removed } = _diff(current, v.clean);

        res.json({
            success: true,
            beforeTotal: current.length,
            afterTotal: v.clean.length,
            delta: v.clean.length - current.length,
            byToken,
            addedCount: added.length,
            addedSample: added.slice(0, 30),
            removedCount: removed.length,
            removedSample: removed.slice(0, 30),
            skippedRows: v.skipped.length,
        });
    } catch (err) {
        logger.error('[cuePhrasesImport /preview]', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /apply ─────────────────────────────────────────────────────────────
router.post('/apply', async (req, res) => {
    try {
        const v = _validatePatterns(req.body?.cuePhrases);
        if (!v.ok) return res.status(400).json({ success: false, error: v.error, bad: v.bad });

        const { current } = await _getCurrent();
        const now = new Date();
        const userEmail = req.user?.email || 'api';
        const reason = (req.body?.reason || 'manual-import').toString().slice(0, 120);

        const newBackup = {
            backupId: randomUUID(),
            createdAt: now,
            createdBy: userEmail,
            reason: `pre-apply:${reason}`,
            patterns: current,
            counts: _countByToken(current),
        };

        await AdminSettings.findOneAndUpdate(
            {},
            {
                $set: {
                    'globalHub.phraseIntelligence.cuePhrases': v.clean,
                    'globalHub.phraseIntelligenceUpdatedAt': now,
                    'globalHub.phraseIntelligenceUpdatedBy': userEmail,
                },
                $push: {
                    'globalHub.phraseIntelligenceBackups': {
                        $each: [newBackup],
                        $slice: -MAX_BACKUPS,
                    },
                },
            },
            { upsert: true, strict: false }
        );

        PhraseReducerService.invalidateCache();

        logger.info('[cuePhrasesImport /apply]', {
            user: userEmail,
            before: current.length,
            after: v.clean.length,
            delta: v.clean.length - current.length,
            backupId: newBackup.backupId,
            reason,
        });

        res.json({
            success: true,
            beforeTotal: current.length,
            afterTotal: v.clean.length,
            delta: v.clean.length - current.length,
            counts: _countByToken(v.clean),
            backupId: newBackup.backupId,
            cacheInvalidated: true,
        });
    } catch (err) {
        logger.error('[cuePhrasesImport /apply]', { error: err.message, stack: err.stack });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /restore/:backupId ─────────────────────────────────────────────────
router.post('/restore/:backupId', async (req, res) => {
    try {
        const { backupId } = req.params;
        const settings = await AdminSettings.getSettings();
        const backups = settings?.globalHub?.phraseIntelligenceBackups || [];
        const target = backups.find(b => b.backupId === backupId);
        if (!target) {
            return res.status(404).json({ success: false, error: `backup ${backupId} not found` });
        }
        if (!Array.isArray(target.patterns) || target.patterns.length === 0) {
            return res.status(400).json({ success: false, error: 'backup contains no patterns' });
        }

        const current = settings?.globalHub?.phraseIntelligence?.cuePhrases || [];
        const now = new Date();
        const userEmail = req.user?.email || 'api';

        const snapshotBackup = {
            backupId: randomUUID(),
            createdAt: now,
            createdBy: userEmail,
            reason: `pre-restore-of-${backupId.slice(0, 8)}`,
            patterns: current,
            counts: _countByToken(current),
        };

        await AdminSettings.findOneAndUpdate(
            {},
            {
                $set: {
                    'globalHub.phraseIntelligence.cuePhrases': target.patterns,
                    'globalHub.phraseIntelligenceUpdatedAt': now,
                    'globalHub.phraseIntelligenceUpdatedBy': userEmail,
                },
                $push: {
                    'globalHub.phraseIntelligenceBackups': {
                        $each: [snapshotBackup],
                        $slice: -MAX_BACKUPS,
                    },
                },
            },
            { upsert: true, strict: false }
        );

        PhraseReducerService.invalidateCache();

        logger.info('[cuePhrasesImport /restore]', {
            user: userEmail,
            restoredFrom: backupId,
            beforeRestore: current.length,
            afterRestore: target.patterns.length,
            newSnapshotId: snapshotBackup.backupId,
        });

        res.json({
            success: true,
            restoredFrom: backupId,
            afterTotal: target.patterns.length,
            counts: _countByToken(target.patterns),
            snapshotId: snapshotBackup.backupId,
            cacheInvalidated: true,
        });
    } catch (err) {
        logger.error('[cuePhrasesImport /restore]', { error: err.message, stack: err.stack });
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
