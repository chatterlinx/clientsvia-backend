/**
 * cue-import.js — Cue Phrases bulk import admin UI.
 *
 * Flow:
 *   1) GET /state on load → render current counts + backups
 *   2) User picks JSON file → parse in-browser → enable Preview
 *   3) Preview → POST /preview → show diff modal
 *   4) Apply → POST /apply with reason → backup + replace + cache flush → refresh state
 *   5) Restore → POST /restore/:backupId from backups list
 *
 * All calls send credentials (cookies / session). If 401, redirect to login.
 */
(function () {
    'use strict';

    const API_BASE = '/api/admin/cue-phrases-import';

    const els = {
        fileInput:        document.getElementById('file-input'),
        fileStatus:       document.getElementById('file-status'),
        btnPreview:       document.getElementById('btn-preview'),
        btnApply:         document.getElementById('btn-apply'),
        btnRefresh:       document.getElementById('btn-refresh'),
        btnDownload:      document.getElementById('btn-download'),
        scopeSelect:      document.getElementById('scope-select'),
        scopeHint:        document.getElementById('scope-hint'),
        reason:           document.getElementById('reason'),
        currentState:     document.getElementById('current-state'),
        backupsList:      document.getElementById('backups-list'),
        modal:            document.getElementById('preview-modal'),
        modalClose:       document.getElementById('modal-close'),
        previewSummary:   document.getElementById('preview-summary'),
        previewTable:     document.getElementById('preview-token-table'),
        addedCountBadge:  document.getElementById('added-count-badge'),
        removedCountBadge:document.getElementById('removed-count-badge'),
        addedSample:      document.getElementById('added-sample'),
        removedSample:    document.getElementById('removed-sample'),
        toast:            document.getElementById('toast'),
    };

    // Current state cache so we can update scope hint (per-token counts)
    let currentCountsCache = {};

    // File contents parsed & validated client-side
    let parsedPatterns = null;

    // ── Utilities ───────────────────────────────────────────────────────────
    function toast(msg, type) {
        const colours = { error: 'bg-red-600', success: 'bg-green-600', info: 'bg-slate-900' };
        els.toast.textContent = msg;
        els.toast.className = `fixed bottom-6 right-6 text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-md z-50 ${colours[type] || colours.info}`;
        setTimeout(() => { els.toast.className += ' hidden'; }, 4000);
    }

    async function api(method, path, body) {
        const res = await fetch(API_BASE + path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: body ? JSON.stringify(body) : undefined,
        });
        if (res.status === 401) {
            toast('Session expired — redirecting to login', 'error');
            setTimeout(() => { window.location.href = '/login.html'; }, 1200);
            throw new Error('unauthorised');
        }
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = { error: text }; }
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        return json;
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleString();
    }

    function renderCounts(counts, total) {
        const order = ['actionCore', 'modifierCore', 'permissionCue', 'urgencyCore', 'infoCue', 'directiveCue', 'requestCue'];
        const seen = new Set();
        const rows = [];
        for (const tok of order) {
            if (counts[tok] != null) { rows.push([tok, counts[tok]]); seen.add(tok); }
        }
        for (const tok of Object.keys(counts)) {
            if (!seen.has(tok)) rows.push([tok, counts[tok]]);
        }
        return `
            <div class="flex items-center gap-3 flex-wrap">
                <span class="pill pill-blue">Total: ${total}</span>
                ${rows.map(([t, n]) => `<span class="pill pill-gray">${t}: ${n}</span>`).join('')}
            </div>
        `;
    }

    // ── Render current state ────────────────────────────────────────────────
    async function loadState() {
        els.currentState.innerHTML = '<span class="muted">Loading…</span>';
        els.backupsList.innerHTML = '<div class="muted">Loading…</div>';
        try {
            const data = await api('GET', '/state');
            currentCountsCache = data.counts || {};
            els.currentState.innerHTML = renderCounts(currentCountsCache, data.total);
            renderBackups(data.backups || []);
            updateScopeUI();
        } catch (err) {
            els.currentState.innerHTML = `<span class="text-red-600">Failed to load: ${err.message}</span>`;
            els.backupsList.innerHTML = `<span class="text-red-600">${err.message}</span>`;
        }
    }

    // ── Scope selector ──────────────────────────────────────────────────────
    // Rewires the Download Current button href and shows a scope-aware hint.
    function updateScopeUI() {
        const scope = els.scopeSelect?.value || 'all';
        if (els.btnDownload) {
            els.btnDownload.href = scope === 'all'
                ? '/api/admin/cue-phrases-import/export'
                : `/api/admin/cue-phrases-import/export/${encodeURIComponent(scope)}`;
        }
        if (els.scopeHint) {
            if (scope === 'all') {
                els.scopeHint.textContent = 'Full dictionary export (all 7 tokens).';
            } else {
                const n = currentCountsCache[scope] || 0;
                els.scopeHint.textContent = `${scope}: ${n} pattern${n === 1 ? '' : 's'} in current dictionary.`;
            }
        }
        // Any pending file is invalidated by scope change (mismatched intent)
        if (parsedPatterns) {
            parsedPatterns = null;
            els.fileInput.value = '';
            els.fileStatus.innerHTML = '<span class="muted">Scope changed — reselect file.</span>';
            els.btnPreview.disabled = true;
            els.btnApply.disabled = true;
        }
    }
    els.scopeSelect?.addEventListener('change', updateScopeUI);

    function renderBackups(backups) {
        if (backups.length === 0) {
            els.backupsList.innerHTML = '<div class="muted">No backups yet. The first /apply creates one automatically.</div>';
            return;
        }
        els.backupsList.innerHTML = `
            <div class="space-y-2">
                ${backups.map(b => `
                    <div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                        <div class="text-sm">
                            <div class="font-medium text-slate-900">${fmtDate(b.createdAt)} · <span class="mono text-xs muted">${b.backupId.slice(0, 8)}</span></div>
                            <div class="muted text-xs mt-1">
                                <span class="pill pill-gray">${b.total} patterns</span>
                                <span class="ml-2">by ${b.createdBy}</span>
                                <span class="ml-2">· ${b.reason || 'no reason'}</span>
                            </div>
                        </div>
                        <button class="btn btn-ghost btn-restore" data-id="${b.backupId}" data-total="${b.total}">Restore</button>
                    </div>
                `).join('')}
            </div>
        `;
        els.backupsList.querySelectorAll('.btn-restore').forEach(btn => {
            btn.addEventListener('click', () => onRestore(btn.dataset.id, btn.dataset.total));
        });
    }

    // ── File read + parse ───────────────────────────────────────────────────
    els.fileInput.addEventListener('change', async () => {
        parsedPatterns = null;
        els.btnPreview.disabled = true;
        els.btnApply.disabled = true;
        els.fileStatus.textContent = '';

        const f = els.fileInput.files?.[0];
        if (!f) return;

        if (f.size > 50 * 1024 * 1024) {
            toast('File too large (>50MB)', 'error');
            return;
        }

        try {
            const text = await f.text();
            const json = JSON.parse(text);

            // Accept either a bare array or a full phrase-intelligence export object
            let patterns = null;
            if (Array.isArray(json)) {
                patterns = json;
            } else if (Array.isArray(json.cuePhrases)) {
                patterns = json.cuePhrases;
            } else if (Array.isArray(json.phraseIntelligence?.cuePhrases)) {
                patterns = json.phraseIntelligence.cuePhrases;
            } else if (Array.isArray(json.globalHub?.phraseIntelligence?.cuePhrases)) {
                patterns = json.globalHub.phraseIntelligence.cuePhrases;
            }

            if (!Array.isArray(patterns)) {
                toast('Could not find cuePhrases array in this JSON', 'error');
                els.fileStatus.innerHTML = '<span class="text-red-600">Unrecognised JSON shape</span>';
                return;
            }
            if (patterns.length === 0) {
                toast('cuePhrases array is empty — refusing to wipe dictionary', 'error');
                return;
            }

            // Scope-aware validation: in token mode, every row must match selected token
            const scope = els.scopeSelect?.value || 'all';
            if (scope !== 'all') {
                const mismatched = patterns.filter(p => p && p.token !== scope);
                if (mismatched.length > 0) {
                    toast(`Scope is "${scope}" but ${mismatched.length} row(s) have different tokens. Use "All tokens" scope or fix the file.`, 'error');
                    els.fileStatus.innerHTML = `<span class="text-red-600">${mismatched.length} rows don't match scope "${scope}"</span>`;
                    return;
                }
            }

            parsedPatterns = patterns;
            const scopeLabel = scope === 'all' ? 'all tokens' : scope;
            els.fileStatus.innerHTML = `<span class="text-green-700">${f.name} — ${patterns.length} rows ready · scope: ${scopeLabel}</span>`;
            els.btnPreview.disabled = false;
        } catch (err) {
            toast('Invalid JSON: ' + err.message, 'error');
            els.fileStatus.innerHTML = `<span class="text-red-600">Invalid JSON</span>`;
        }
    });

    // ── Preview ─────────────────────────────────────────────────────────────
    els.btnPreview.addEventListener('click', async () => {
        if (!parsedPatterns) return;
        els.btnPreview.disabled = true;
        els.btnPreview.textContent = 'Validating…';
        try {
            const scope = els.scopeSelect?.value || 'all';
            const path = scope === 'all' ? '/preview' : `/preview/${encodeURIComponent(scope)}`;
            const data = await api('POST', path, { cuePhrases: parsedPatterns });
            renderPreview(data);
            els.modal.showModal();
            els.btnApply.disabled = false;
        } catch (err) {
            toast('Preview failed: ' + err.message, 'error');
        } finally {
            els.btnPreview.disabled = false;
            els.btnPreview.textContent = 'Preview Import';
        }
    });

    function deltaClass(n) {
        if (n > 0) return 'delta-pos';
        if (n < 0) return 'delta-neg';
        return 'delta-zero';
    }
    function deltaStr(n) { return n > 0 ? `+${n}` : `${n}`; }

    function renderPreview(data) {
        const netClass = data.delta > 0 ? 'delta-pos' : data.delta < 0 ? 'delta-neg' : 'delta-zero';
        els.previewSummary.innerHTML = `
            <div class="grid grid-cols-3 gap-4">
                <div class="bg-slate-50 rounded-lg p-4">
                    <div class="text-xs muted uppercase tracking-wide">Before</div>
                    <div class="text-2xl font-bold text-slate-900 mt-1">${data.beforeTotal}</div>
                </div>
                <div class="bg-slate-50 rounded-lg p-4">
                    <div class="text-xs muted uppercase tracking-wide">After</div>
                    <div class="text-2xl font-bold text-slate-900 mt-1">${data.afterTotal}</div>
                </div>
                <div class="bg-slate-50 rounded-lg p-4">
                    <div class="text-xs muted uppercase tracking-wide">Net Δ</div>
                    <div class="text-2xl font-bold ${netClass} mt-1">${deltaStr(data.delta)}</div>
                </div>
            </div>
            ${data.skippedRows > 0 ? `<div class="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">Skipped ${data.skippedRows} malformed row(s) during validation.</div>` : ''}
        `;

        const tokens = data.byToken || {};
        els.previewTable.innerHTML = Object.keys(tokens).sort().map(t => {
            const row = tokens[t];
            return `
                <tr class="token-row">
                    <td class="mono">${t}</td>
                    <td class="text-right mono">${row.before}</td>
                    <td class="text-right mono">${row.after}</td>
                    <td class="text-right mono ${deltaClass(row.delta)}">${deltaStr(row.delta)}</td>
                </tr>
            `;
        }).join('');

        els.addedCountBadge.textContent = `${data.addedCount} added`;
        els.removedCountBadge.textContent = `${data.removedCount} removed`;
        els.addedSample.innerHTML = (data.addedSample || []).map(p =>
            `<span class="sample-row added mono">${p.token}:${p.pattern}</span>`
        ).join('') || '<span class="muted text-sm">none</span>';
        els.removedSample.innerHTML = (data.removedSample || []).map(p =>
            `<span class="sample-row removed mono">${p.token}:${p.pattern}</span>`
        ).join('') || '<span class="muted text-sm">none</span>';
    }

    els.modalClose.addEventListener('click', () => els.modal.close());

    // ── Apply ───────────────────────────────────────────────────────────────
    els.btnApply.addEventListener('click', async () => {
        if (!parsedPatterns) return;
        const reason = (els.reason.value || '').trim() || 'manual-import';
        const scope = els.scopeSelect?.value || 'all';
        const scopeLine = scope === 'all'
            ? '• Replaces the ENTIRE dictionary (all 7 tokens).'
            : `• Replaces ONLY the "${scope}" slice — all other tokens pass through untouched.`;
        const confirmMsg =
            `Apply ${parsedPatterns.length} patterns to the live cuePhrases dictionary?\n\n` +
            scopeLine + `\n` +
            `• Current state will be snapshotted to backups before the replace.\n` +
            `• CueExtractor cache flushes immediately — no restart.\n` +
            `• This affects ALL tenants platform-wide.\n\n` +
            `Reason: "${reason}"\n\n` +
            `Proceed?`;
        if (!confirm(confirmMsg)) return;

        els.btnApply.disabled = true;
        els.btnApply.textContent = 'Applying…';
        try {
            const path = scope === 'all' ? '/apply' : `/apply/${encodeURIComponent(scope)}`;
            const data = await api('POST', path, { cuePhrases: parsedPatterns, reason });
            const msg = scope === 'all'
                ? `Imported ${data.afterTotal} patterns (was ${data.beforeTotal}). Backup ${data.backupId.slice(0, 8)}. Cache flushed.`
                : `Replaced ${scope}: ${data.tokenBefore} → ${data.tokenAfter} (Δ${deltaStr(data.tokenDelta)}). Dict total now ${data.afterTotal}. Backup ${data.backupId.slice(0, 8)}.`;
            toast(msg, 'success');
            parsedPatterns = null;
            els.fileInput.value = '';
            els.fileStatus.textContent = '';
            els.btnApply.disabled = true;
            els.btnPreview.disabled = true;
            els.modal.close();
            await loadState();
        } catch (err) {
            toast('Apply failed: ' + err.message, 'error');
        } finally {
            els.btnApply.textContent = 'Apply Import';
        }
    });

    // ── Restore ─────────────────────────────────────────────────────────────
    async function onRestore(backupId, total) {
        if (!confirm(`Restore backup ${backupId.slice(0, 8)}? (${total} patterns)\n\nYour current dictionary will be snapshotted to a new backup first, so this is reversible.`)) return;
        try {
            const data = await api('POST', `/restore/${backupId}`);
            toast(`Restored ${data.afterTotal} patterns. Previous state snapshot ${data.snapshotId.slice(0, 8)}. Cache flushed.`, 'success');
            await loadState();
        } catch (err) {
            toast('Restore failed: ' + err.message, 'error');
        }
    }

    // ── Refresh ─────────────────────────────────────────────────────────────
    els.btnRefresh.addEventListener('click', loadState);

    // ── Boot ────────────────────────────────────────────────────────────────
    loadState();
})();
