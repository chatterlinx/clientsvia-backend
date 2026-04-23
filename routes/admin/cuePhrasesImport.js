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

// ═════════════════════════════════════════════════════════════════════════════
// SEMANTIC LINT — 7 Universal Cue shape guards (UAP/v1.md §23.3)
// ═════════════════════════════════════════════════════════════════════════════
// Each of the 7 universal cues has a semantic SHAPE. `_semanticLint()` flags
// patterns that clearly violate that shape (nouns in modifierCore, PP-phrases
// instead of modifiers, fillers in directiveCue, urgency tokens with no time
// marker, etc.).
//
// Principle: CONSERVATIVE. Reject only clear violations. When in doubt, accept.
// False negatives (missed pollution) cost far less than false positives
// (rejecting legitimate admin-authored patterns).
//
// Output: { ok: true } OR { ok: false, reason: '<code>', suggestedToken?: '...' }
// Flagged patterns surface in `/preview` and `/apply` responses as `warnings[]`.
// Default behavior: warnings surface but are NOT dropped from the import.
// Opt-in strict mode: body/query `strictSemantic:true` DROPS warnings from
// `clean[]` before writing to the dictionary.
// ─────────────────────────────────────────────────────────────────────────────

// Filler / stopword lexicons (rejected when they form the ENTIRE pattern)
const _FILLERS = new Set([
    'um', 'uh', 'er', 'hmm', 'like', 'just', 'well', 'yeah', 'ok', 'okay',
    'so', 'basically', 'actually', 'literally', 'right', 'mean',
]);
const _STOPWORDS_ONLY = new Set([
    'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by',
    'from', 'and', 'or', 'but', 'as', 'is', 'was', 'be', 'been', 'being',
]);

// Prepositions that mark a pp-phrase (reject when first token of modifierCore)
const _PREPOSITIONS_LEADING = new Set([
    'in', 'on', 'at', 'from', 'under', 'behind', 'near', 'beside', 'over',
    'through', 'inside', 'outside', 'above', 'below', 'beneath', 'between',
    'around', 'into', 'onto', 'across',
]);

// Ability / permission markers (permissionCue)
const _ABILITY_MARKERS = new Set([
    'able', 'can', 'could', 'may', 'might', 'allow', 'allowed', 'permit',
    'permitted', 'possible',
]);

// Urgency markers (urgencyCore)
const _URGENCY_UNIGRAMS = new Set([
    'now', 'today', 'asap', 'immediate', 'immediately', 'emergency', 'urgent',
    'urgently', 'quick', 'quickly', 'fast', 'tonight', 'stat', 'pronto',
    'hurry', 'rush',
]);
const _URGENCY_BIGRAMS_RE = /\b(right away|right now|as soon as|on the way|without delay|in a hurry|same day|first thing|as early as|soon as possible)\b/;

// Information-seeking markers (infoCue)
const _WH_WORDS = new Set([
    'what', 'who', 'where', 'when', 'why', 'how', 'which', 'whose', 'whom',
]);
const _KNOWLEDGE_VERBS = new Set([
    'know', 'tell', 'explain', 'show', 'understand', 'clarify', 'describe',
    'confirm',
]);
const _INFO_BIGRAMS_RE = /\b(tell me|do you (know|have|offer|sell|do|carry)|let me know|i'?d like to know|can you tell|is there)\b/;

// Action verbs (actionCore) — what the caller wants DONE (verb + object)
const _ACTION_VERBS = new Set([
    'pay', 'charge', 'get', 'send', 'schedule', 'fix', 'repair', 'book',
    'replace', 'install', 'remove', 'check', 'come', 'bring', 'give', 'help',
    'cancel', 'reschedule', 'call', 'text', 'email', 'stop', 'start', 'quote',
    'estimate', 'diagnose', 'service', 'clean', 'refund', 'credit', 'dispatch',
    'receive', 'accept', 'add', 'update', 'change', 'transfer', 'route',
    'maintain', 'tune', 'inspect', 'test', 'reset', 'replace', 'order',
]);

// Directive verbs (directiveCue) — imperatives addressed at the agent
const _DIRECTIVE_VERBS = new Set([
    'get', 'send', 'schedule', 'fix', 'repair', 'call', 'book', 'put', 'give',
    'check', 'come', 'bring', 'dispatch', 'set', 'help', 'cancel',
    'reschedule', 'confirm', 'drop', 'hold', 'wait', 'transfer', 'route',
    'page', 'add', 'remove', 'update', 'change', 'pick', 'have', 'go',
]);

// Request markers (requestCue)
const _REQUEST_MARKERS = new Set([
    'want', 'need', 'require', 'looking',
]);
const _REQUEST_BIGRAMS_RE = /\b(i want|i need|i require|i would like|i'd like|i'd love|i'll take|i'm looking|i am looking|i want to|can you|could you|would you|will you|send (me|a|somebody|someone)|get me|put me|set up|sign me up|schedule me|book (me|an|a))\b/;

// Modifier markers (modifierCore) — repeat / negation / quantifier / degree
const _REPEAT_MODIFIERS = new Set([
    'another', 'again', 'still', 'back', 'same', 'repeat', 'recurring',
    'keeps', 'comes', 'came', 'returning', 'persistent',
]);
const _NEGATION_MODIFIERS = new Set([
    'not', 'no', 'none', 'never', 'without', 'neither', 'nothing',
]);
const _QUANTIFIER_MODIFIERS = new Set([
    'more', 'less', 'any', 'some', 'few', 'many', 'enough', 'several',
    'couple', 'lot', 'bit',
]);

/**
 * Run the semantic predicate for a given (pattern, token) pair.
 * Returns `{ ok: true }` on accept, or `{ ok: false, reason, suggestedToken? }`
 * on a clear shape violation.
 *
 * @param {string} pattern — normalized (lowercased, trimmed) pattern text
 * @param {string} token   — one of the 7 VALID_TOKENS
 * @returns {{ok:true} | {ok:false, reason:string, suggestedToken?:string}}
 */
function _semanticLint(pattern, token) {
    if (typeof pattern !== 'string' || !pattern) {
        return { ok: false, reason: 'empty-pattern' };
    }
    const words = pattern.split(/\s+/).filter(Boolean);
    if (words.length === 0) return { ok: false, reason: 'empty-pattern' };

    const first = words[0];
    const hasAny = (set) => words.some(w => set.has(w));
    const allFillerOrStop = words.every(
        w => _FILLERS.has(w) || _STOPWORDS_ONLY.has(w)
    );

    // Universal reject (applies to all tokens): pure filler / stopword pattern
    if (allFillerOrStop) {
        return { ok: false, reason: 'all-filler-or-stopword' };
    }
    // Universal reject: single-word pattern that's a filler
    if (words.length === 1 && _FILLERS.has(first)) {
        return { ok: false, reason: 'single-filler-word' };
    }

    switch (token) {
        case 'urgencyCore': {
            if (hasAny(_URGENCY_UNIGRAMS)) return { ok: true };
            if (_URGENCY_BIGRAMS_RE.test(pattern)) return { ok: true };
            return { ok: false, reason: 'no-urgency-marker' };
        }

        case 'permissionCue': {
            if (hasAny(_ABILITY_MARKERS)) return { ok: true };
            return { ok: false, reason: 'no-ability-marker' };
        }

        case 'requestCue': {
            if (_REQUEST_BIGRAMS_RE.test(pattern)) return { ok: true };
            if (hasAny(_REQUEST_MARKERS)) return { ok: true };
            return { ok: false, reason: 'no-request-marker' };
        }

        case 'infoCue': {
            if (_WH_WORDS.has(first)) return { ok: true };
            if (hasAny(_WH_WORDS)) return { ok: true };
            if (hasAny(_KNOWLEDGE_VERBS)) return { ok: true };
            if (_INFO_BIGRAMS_RE.test(pattern)) return { ok: true };
            return { ok: false, reason: 'no-info-marker' };
        }

        case 'directiveCue': {
            // Imperative: first word is a directive verb
            if (_DIRECTIVE_VERBS.has(first)) return { ok: true };
            // Contains a directive or action verb somewhere
            if (hasAny(_DIRECTIVE_VERBS)) return { ok: true };
            if (hasAny(_ACTION_VERBS)) return { ok: true };
            return { ok: false, reason: 'no-directive-verb' };
        }

        case 'actionCore': {
            if (hasAny(_ACTION_VERBS)) return { ok: true };
            // If it has a REQUEST_MARKER but no action verb, it's probably a
            // requestCue that got misfiled — suggest the correct bucket.
            if (hasAny(_REQUEST_MARKERS)) {
                return {
                    ok: false,
                    reason: 'no-action-verb',
                    suggestedToken: 'requestCue',
                };
            }
            return { ok: false, reason: 'no-action-verb' };
        }

        case 'modifierCore': {
            // PP-phrase ("in the garage", "from the attic") — wrong bucket
            if (_PREPOSITIONS_LEADING.has(first)) {
                return { ok: false, reason: 'pp-phrase' };
            }
            if (hasAny(_REPEAT_MODIFIERS)) return { ok: true };
            if (hasAny(_NEGATION_MODIFIERS)) return { ok: true };
            if (hasAny(_QUANTIFIER_MODIFIERS)) return { ok: true };
            // Bare single word that isn't a modifier marker → likely a noun
            // that belongs in tradeVocabularies, not a cue pattern
            if (words.length === 1) {
                return { ok: false, reason: 'bare-noun-or-filler' };
            }
            // Multi-word compound (e.g. "something like that") — permissive
            return { ok: true };
        }
    }
    // Unknown token (should be caught by VALID_TOKENS upstream)
    return { ok: true };
}

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

/**
 * Validate a raw cuePhrases payload.
 *
 * Two-pass:
 *   Pass 1 — SHAPE: array check, type check, VALID_TOKENS enum, dedup. Failures
 *            go into `skipped[]`. If >BAD_ROW_REJECT_PCT fail shape, the whole
 *            payload is rejected hard.
 *   Pass 2 — SEMANTIC: run `_semanticLint()` on each shape-valid row. Failures
 *            go into `warnings[]`. By default warnings are ADVISORY (included
 *            in clean[], surfaced in response). With `opts.strictSemantic=true`,
 *            warnings are DROPPED from clean[] before being written to the
 *            dictionary.
 *
 * @param {Array} raw — input payload
 * @param {{strictSemantic?:boolean}} [opts]
 * @returns {{ok:true, clean:Array, skipped:Array, warnings:Array} | {ok:false, error:string, bad?:Array}}
 */
function _validatePatterns(raw, opts = {}) {
    if (!Array.isArray(raw)) {
        return { ok: false, error: 'cuePhrases must be an array' };
    }
    if (raw.length === 0) {
        return { ok: false, error: 'cuePhrases cannot be empty (refusing to wipe the dictionary)' };
    }
    if (raw.length > MAX_PATTERNS) {
        return { ok: false, error: `cuePhrases cannot exceed ${MAX_PATTERNS} items (got ${raw.length})` };
    }

    const strictSemantic = opts.strictSemantic === true;
    const seen = new Set();
    const bad = [];
    const shapeClean = []; // shape-valid rows, pre-semantic
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
        shapeClean.push({ pattern, token, _idx: i });
    }

    // Hard-reject payload if too many shape failures
    if (bad.length > 0 && bad.length >= raw.length * BAD_ROW_REJECT_PCT) {
        return {
            ok: false,
            error: `${bad.length} of ${raw.length} rows invalid (${Math.round(bad.length / raw.length * 100)}%, threshold ${Math.round(BAD_ROW_REJECT_PCT * 100)}%). Fix the source JSON and retry.`,
            bad: bad.slice(0, 20),
        };
    }

    // Pass 2 — semantic predicate
    const clean = [];
    const warnings = [];
    for (const row of shapeClean) {
        const lint = _semanticLint(row.pattern, row.token);
        if (lint.ok) {
            clean.push({ pattern: row.pattern, token: row.token });
        } else {
            const w = {
                idx: row._idx,
                pattern: row.pattern,
                token: row.token,
                reason: lint.reason,
            };
            if (lint.suggestedToken) w.suggestedToken = lint.suggestedToken;
            warnings.push(w);
            // Advisory default: keep in clean[] too. Strict: drop.
            if (!strictSemantic) {
                clean.push({ pattern: row.pattern, token: row.token });
            }
        }
    }

    return { ok: true, clean, skipped: bad, warnings };
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

/**
 * Group semantic-lint warnings by reason code for at-a-glance triage reporting.
 * Returns `{ <reason>: count, ... }`.
 */
function _groupWarningsByReason(warnings) {
    const out = {};
    if (!Array.isArray(warnings)) return out;
    for (const w of warnings) {
        const r = w?.reason || 'unknown';
        out[r] = (out[r] || 0) + 1;
    }
    return out;
}

// ── GET /export ─────────────────────────────────────────────────────────────
// Download current cuePhrases as a standalone JSON file.
// Full-dictionary (all 7 tokens) export.
router.get('/export', async (req, res) => {
    try {
        const { current } = await _getCurrent();
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `cuePhrases-${stamp}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify({
            exportedAt: new Date().toISOString(),
            scope: 'all',
            total: current.length,
            counts: _countByToken(current),
            cuePhrases: current,
        }, null, 2));
    } catch (err) {
        logger.error('[cuePhrasesImport /export]', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /export/:token ──────────────────────────────────────────────────────
// Download only patterns for a single cue token (e.g. actionCore only).
// Produces a smaller, focused JSON for surgical review + per-token cleanup.
router.get('/export/:token', async (req, res) => {
    try {
        const { token } = req.params;
        if (!VALID_TOKENS.has(token)) {
            return res.status(400).json({
                success: false,
                error: `invalid token "${token}". Valid: ${[...VALID_TOKENS].join(', ')}`
            });
        }
        const { current } = await _getCurrent();
        const filtered = current.filter(p => p.token === token);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `cuePhrases-${token}-${stamp}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify({
            exportedAt: new Date().toISOString(),
            scope: 'single-token',
            token,
            total: filtered.length,
            cuePhrases: filtered,
        }, null, 2));
    } catch (err) {
        logger.error('[cuePhrasesImport /export/:token]', { error: err.message });
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
        const strictSemantic = req.body?.strictSemantic === true;
        const v = _validatePatterns(req.body?.cuePhrases, { strictSemantic });
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
            strictSemantic,
            beforeTotal: current.length,
            afterTotal: v.clean.length,
            delta: v.clean.length - current.length,
            byToken,
            addedCount: added.length,
            addedSample: added.slice(0, 30),
            removedCount: removed.length,
            removedSample: removed.slice(0, 30),
            skippedRows: v.skipped.length,
            // Semantic lint surfacing (UAP/v1.md §23.3)
            warningsCount: v.warnings.length,
            warningsSample: v.warnings.slice(0, 40),
            warningsByReason: _groupWarningsByReason(v.warnings),
        });
    } catch (err) {
        logger.error('[cuePhrasesImport /preview]', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /apply ─────────────────────────────────────────────────────────────
router.post('/apply', async (req, res) => {
    try {
        const strictSemantic = req.body?.strictSemantic === true;
        const v = _validatePatterns(req.body?.cuePhrases, { strictSemantic });
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
            strictSemantic,
            warnings: v.warnings.length,
        });

        res.json({
            success: true,
            strictSemantic,
            beforeTotal: current.length,
            afterTotal: v.clean.length,
            delta: v.clean.length - current.length,
            counts: _countByToken(v.clean),
            backupId: newBackup.backupId,
            cacheInvalidated: true,
            warningsCount: v.warnings.length,
            warningsByReason: _groupWarningsByReason(v.warnings),
        });
    } catch (err) {
        logger.error('[cuePhrasesImport /apply]', { error: err.message, stack: err.stack });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /preview/:token ────────────────────────────────────────────────────
// Preview a token-scoped import. Incoming payload must contain ONLY patterns
// for the selected token. We splice them into the full current dictionary
// (replacing only that token's slice) and produce the standard diff report.
router.post('/preview/:token', async (req, res) => {
    try {
        const { token } = req.params;
        if (!VALID_TOKENS.has(token)) {
            return res.status(400).json({
                success: false,
                error: `invalid token "${token}". Valid: ${[...VALID_TOKENS].join(', ')}`
            });
        }

        const strictSemantic = req.body?.strictSemantic === true;
        const v = _validatePatterns(req.body?.cuePhrases, { strictSemantic });
        if (!v.ok) return res.status(400).json({ success: false, error: v.error, bad: v.bad });

        // Enforce scope: every incoming row MUST match the selected token
        const mismatched = v.clean.filter(p => p.token !== token);
        if (mismatched.length > 0) {
            return res.status(400).json({
                success: false,
                error: `scope mismatch — ${mismatched.length} row(s) have a token other than "${token}". Import aborted.`,
                mismatched: mismatched.slice(0, 10),
            });
        }

        const { current } = await _getCurrent();
        // Replace only this token's slice; keep all others intact
        const otherTokens = current.filter(p => p.token !== token);
        const merged = [...otherTokens, ...v.clean];

        const beforeCounts = _countByToken(current);
        const afterCounts = _countByToken(merged);

        const tokens = new Set([...Object.keys(beforeCounts), ...Object.keys(afterCounts)]);
        const byToken = {};
        for (const t of [...tokens].sort()) {
            const before = beforeCounts[t] || 0;
            const after = afterCounts[t] || 0;
            byToken[t] = { before, after, delta: after - before };
        }

        const { added, removed } = _diff(current, merged);

        res.json({
            success: true,
            scope: 'single-token',
            token,
            strictSemantic,
            beforeTotal: current.length,
            afterTotal: merged.length,
            delta: merged.length - current.length,
            byToken,
            addedCount: added.length,
            addedSample: added.slice(0, 30),
            removedCount: removed.length,
            removedSample: removed.slice(0, 30),
            skippedRows: v.skipped.length,
            warningsCount: v.warnings.length,
            warningsSample: v.warnings.slice(0, 40),
            warningsByReason: _groupWarningsByReason(v.warnings),
        });
    } catch (err) {
        logger.error('[cuePhrasesImport /preview/:token]', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /apply/:token ──────────────────────────────────────────────────────
// Apply a token-scoped import. Replaces only the selected token's slice of
// the dictionary; all other tokens pass through untouched. Full dictionary
// snapshot (pre-apply) is still pushed to backups so restore works as-is.
router.post('/apply/:token', async (req, res) => {
    try {
        const { token } = req.params;
        if (!VALID_TOKENS.has(token)) {
            return res.status(400).json({
                success: false,
                error: `invalid token "${token}". Valid: ${[...VALID_TOKENS].join(', ')}`
            });
        }

        const strictSemantic = req.body?.strictSemantic === true;
        const v = _validatePatterns(req.body?.cuePhrases, { strictSemantic });
        if (!v.ok) return res.status(400).json({ success: false, error: v.error, bad: v.bad });

        // Enforce scope
        const mismatched = v.clean.filter(p => p.token !== token);
        if (mismatched.length > 0) {
            return res.status(400).json({
                success: false,
                error: `scope mismatch — ${mismatched.length} row(s) have a token other than "${token}". Import aborted.`,
                mismatched: mismatched.slice(0, 10),
            });
        }

        const { current } = await _getCurrent();
        const otherTokens = current.filter(p => p.token !== token);
        const merged = [...otherTokens, ...v.clean];

        const now = new Date();
        const userEmail = req.user?.email || 'api';
        const reason = (req.body?.reason || `token-import:${token}`).toString().slice(0, 120);

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
                    'globalHub.phraseIntelligence.cuePhrases': merged,
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

        const tokenBefore = current.filter(p => p.token === token).length;
        const tokenAfter = v.clean.length;

        logger.info('[cuePhrasesImport /apply/:token]', {
            user: userEmail,
            token,
            tokenBefore,
            tokenAfter,
            dictBefore: current.length,
            dictAfter: merged.length,
            backupId: newBackup.backupId,
            reason,
            strictSemantic,
            warnings: v.warnings.length,
        });

        res.json({
            success: true,
            scope: 'single-token',
            token,
            strictSemantic,
            tokenBefore,
            tokenAfter,
            tokenDelta: tokenAfter - tokenBefore,
            beforeTotal: current.length,
            afterTotal: merged.length,
            counts: _countByToken(merged),
            backupId: newBackup.backupId,
            cacheInvalidated: true,
            warningsCount: v.warnings.length,
            warningsByReason: _groupWarningsByReason(v.warnings),
        });
    } catch (err) {
        logger.error('[cuePhrasesImport /apply/:token]', { error: err.message, stack: err.stack });
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
