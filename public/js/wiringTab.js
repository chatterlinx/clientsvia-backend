/**
 * ============================================================================
 * WIRING TAB - Enterprise Wiring Visualization
 * ============================================================================
 * 
 * Single source of truth UI for platform wiring status.
 * 
 * Features:
 * - Scoreboard (health, issues count)
 * - Special checks (templates, scenarios, redis, booking)
 * - Issues list with fixes
 * - Tree view (expandable)
 * - Diagram view (boxes)
 * - Guardrails panel
 * - Export (JSON, Markdown)
 * - Search & Focus
 * 
 * ============================================================================
 */

(function() {
    'use strict';
    
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    
    // ========================================================================
    // STATE
    // ========================================================================
    
    let _report = null;
    let _index = null;
    let _selectedNodeId = null;
    let _focusedNodeId = null;
    let _viewMode = 'tree'; // tree | diagram
    let _searchTerm = '';
    let _expandedNodes = new Set();
    let _companyId = null;
    let _initialized = false;
    let _lastLoad = {
        url: null,
        companyId: null,
        status: null,
        ok: null,
        responseText: null,
        errorMessage: null,
        at: null
    };
    
    // ========================================================================
    // UTILITIES
    // ========================================================================
    
    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        }[c]));
    }
    
    function statusBadge(status) {
        const map = {
            'PROVEN': { t: 'PROVEN', c: 'green' },
            'WIRED': { t: 'WIRED', c: 'green' },
            'PARTIAL': { t: 'PARTIAL', c: 'yellow' },
            'MISCONFIGURED': { t: 'MISCONFIGURED', c: 'red' },
            'UI_ONLY': { t: 'UI-ONLY', c: 'red' },
            'DISABLED': { t: 'DISABLED', c: 'gray' },
            'NOT_CONFIGURED': { t: 'NOT CONFIGURED', c: 'gray' },
            'LINKED': { t: 'LINKED', c: 'green' },
            'NOT_LINKED': { t: 'NOT LINKED', c: 'red' },
            'LOADED': { t: 'LOADED', c: 'green' },
            'EMPTY': { t: 'EMPTY', c: 'red' },
            'HIT': { t: 'CACHED', c: 'green' },
            'MISS': { t: 'NOT CACHED', c: 'yellow' },
            'ACTIVE': { t: 'ACTIVE', c: 'green' },
            'NO_COMPANY_FLOWS': { t: 'NO FLOWS', c: 'yellow' },
            'NOT_COMPILED': { t: 'NOT COMPILED', c: 'yellow' }
        };
        const m = map[status] || { t: status || 'UNKNOWN', c: 'gray' };
        return `<span class="w-badge ${m.c}">${esc(m.t)}</span>`;
    }

    function isV2Report(r) {
        return !!(r && r.meta && (r.meta.reportType === 'WIRING_REPORT_V2' || String(r.meta.schemaVersion || '').includes('V2')));
    }

    function getV2FieldHealthById(r) {
        const map = new Map();
        const fields = r?.health?.fields || [];
        for (const f of fields) {
            if (f?.id) map.set(f.id, f);
        }
        return map;
    }

    function getV2CriticalById(r) {
        const map = new Map();
        const items = r?.health?.criticalIssues || [];
        for (const i of items) {
            if (i?.fieldId) map.set(i.fieldId, i);
        }
        return map;
    }

    function getV2WarningsById(r) {
        const map = new Map();
        const items = r?.health?.warnings || [];
        for (const i of items) {
            if (i?.fieldId) map.set(i.fieldId, i);
        }
        return map;
    }
    
    function healthBadge(health) {
        const c = health === 'GREEN' ? 'green' : health === 'YELLOW' ? 'yellow' : health === 'RED' ? 'red' : 'gray';
        return `<span class="w-health ${c}">${esc(health || 'UNKNOWN')}</span>`;
    }
    
    function severityBadge(severity) {
        const c = severity === 'CRITICAL' ? 'red' : severity === 'HIGH' ? 'orange' : 'yellow';
        return `<span class="w-severity ${c}">${esc(severity)}</span>`;
    }
    
    async function downloadJson(filename, obj) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
    
    async function copyText(txt) {
        await navigator.clipboard.writeText(txt);
        toast('Copied to clipboard');
    }
    
    function toast(msg, isErr = false) {
        const el = $('#wiringToast');
        if (!el) return;
        el.textContent = msg;
        el.className = `w-toast ${isErr ? 'err' : 'ok'} visible`;
        setTimeout(() => el.classList.remove('visible'), 2500);
    }

    function setState(state, details = {}) {
        // Enterprise rule: Wiring must never be blank. Always show a state panel.
        const scoreboard = $('#wiringScoreboard');
        const special = $('#wiringSpecialChecks');
        const issues = $('#wiringIssues');
        const guardrails = $('#wiringGuardrails');
        const tree = $('#wiringTree');
        const checkpoints = $('#wiringCheckpoints');
        
        const hideIf = (el, hide) => { if (el) el.style.display = hide ? 'none' : ''; };
        
        // Hide all content panels when not in "success"
        const isSuccess = state === 'success';
        hideIf(special, !isSuccess);
        hideIf(issues, !isSuccess);
        hideIf(guardrails, !isSuccess);
        hideIf(tree, !isSuccess);
        hideIf(checkpoints, !isSuccess);
        
        if (!scoreboard) return;
        
        const url = details.url || _lastLoad.url;
        const companyId = details.companyId || _companyId || _lastLoad.companyId;
        const status = details.status ?? _lastLoad.status;
        const respText = details.responseText ?? _lastLoad.responseText;
        const errMsg = details.errorMessage ?? _lastLoad.errorMessage;
        const stack = details.stack || null;
        const rect = details.rect || null;
        const payload = details.payload || null;
        
        const rawJson = payload
            ? JSON.stringify(payload, null, 2)
            : (respText && String(respText).trim().startsWith('{') ? respText : null);
        
        const header = state === 'loading'
            ? 'Loading wiring…'
            : state === 'error'
            ? 'Wiring fetch/render failed'
            : state === 'empty'
            ? 'No wiring nodes returned (0)'
            : state === 'needs_company'
            ? 'No company selected'
            : state === 'zero_size'
            ? 'Renderer container has zero size'
            : 'Wiring';
        
        const subtitle = state === 'needs_company'
            ? 'Select a company (or ensure companyId is in the URL) then click Reload.'
            : state === 'empty'
            ? 'Backend returned an empty graph. This is valid but should not be silent.'
            : state === 'zero_size'
            ? 'The Wiring tab is mounted, but the content container is collapsed/hidden.'
            : state === 'error'
            ? 'The UI must never go blank — this panel is the “hard failure” surface.'
            : '';
        
        scoreboard.innerHTML = `
          <div class="w-score-container">
            <div class="w-score-header">
              <div class="w-score-title">
                <span class="w-title">${esc(header)}</span>
              </div>
              <div class="w-score-meta">
                <div class="w-meta-row">
                  <span><strong>Company:</strong> ${esc(companyId || '—')}</span>
                  ${url ? `<span>•</span><span><strong>URL:</strong> ${esc(url)}</span>` : ''}
                  ${status ? `<span>•</span><span><strong>Status:</strong> ${esc(String(status))}</span>` : ''}
                </div>
                ${subtitle ? `<div class="w-meta-small">${esc(subtitle)}</div>` : ''}
              </div>
            </div>
            <div style="margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap;">
              <button class="w-btn primary" id="wiringStateReload">🔄 Reload</button>
              <button class="w-btn" id="wiringStateCopyRaw">Copy Raw</button>
            </div>
            <div style="margin-top: 12px;">
              ${errMsg ? `<div class="w-issue-item" style="border-color:#7f1d1d;background:#1b0b0b;"><div><strong>Error:</strong> ${esc(errMsg)}</div></div>` : ''}
              ${rect ? `<div class="w-issue-item"><div><strong>Container:</strong> ${esc(JSON.stringify(rect))}</div></div>` : ''}
              ${stack ? `<details style="margin-top:10px;"><summary style="cursor:pointer;">Show stack</summary><pre style="white-space:pre-wrap; background:#0b0b0d; border:1px solid #2a2a2e; padding:12px; border-radius:10px; overflow:auto;">${esc(stack)}</pre></details>` : ''}
              ${rawJson ? `<details style="margin-top:10px;" open><summary style="cursor:pointer;">Show Raw JSON</summary><pre style="white-space:pre-wrap; background:#0b0b0d; border:1px solid #2a2a2e; padding:12px; border-radius:10px; overflow:auto; max-height: 420px;">${esc(rawJson)}</pre></details>` : ''}
            </div>
          </div>
        `;
        
        // Wire state panel buttons
        const btnReload = $('#wiringStateReload');
        if (btnReload) btnReload.addEventListener('click', () => refresh(_companyId));
        
        const btnCopyRaw = $('#wiringStateCopyRaw');
        if (btnCopyRaw) btnCopyRaw.addEventListener('click', () => {
            const toCopy = rawJson || respText || errMsg || 'No raw payload available';
            copyText(String(toCopy));
        });
    }
    
    // ========================================================================
    // REPORT TO MARKDOWN
    // ========================================================================
    
    function toMarkdown(r) {
        // V2 report has a different contract (engineering bible).
        if (isV2Report(r)) {
            const lines = [];
            lines.push(`# Wiring Report (V2): ${r?.scope?.companyName || r?.scope?.companyId || 'Unknown'}`);
            lines.push('');
            lines.push(`- **Generated:** ${r?.meta?.generatedAt || ''}`);
            lines.push(`- **Company ID:** ${r?.scope?.companyId || ''}`);
            lines.push(`- **TradeKey:** ${r?.scope?.tradeKey || ''} (${r?.scope?.tradeKeySource || 'unknown'})`);
            lines.push(`- **Environment:** ${r?.scope?.environment || ''}`);
            lines.push(`- **Health:** ${r?.health?.overall || ''}`);
            lines.push('');

            lines.push('## Scoreboard');
            lines.push('');
            lines.push('| Check | Value | Status |');
            lines.push('|------:|:------|:-------|');
            const sb = r?.scoreboard || {};
            for (const key of Object.keys(sb)) {
                const c = sb[key];
                const status = c?.status || 'UNKNOWN';
                const emoji = status === 'GREEN' ? '✅' : status === 'YELLOW' ? '⚠️' : '🔴';
                lines.push(`| ${c?.label || key} | ${c?.value || ''} | ${emoji} ${status} |`);
            }
            lines.push('');

            if (Array.isArray(r?.health?.criticalIssues) && r.health.criticalIssues.length > 0) {
                lines.push('## 🔴 Critical Issues');
                lines.push('');
                for (const i of r.health.criticalIssues) {
                    lines.push(`- **${i.fieldId}** (${i.status})`);
                    if (i.reason) lines.push(`  - Reason: ${i.reason}`);
                    if (i.expected) lines.push(`  - Expected: ${i.expected}`);
                    if (i.actual) lines.push(`  - Actual: ${i.actual}`);
                    if (i.fix) lines.push(`  - Fix: ${i.fix}`);
                }
                lines.push('');
            }

            if (r?.derivedData) {
                lines.push('## Derived Data (Global Templates)');
                lines.push('');
                lines.push(`- hasTemplateRefs: ${String(r.derivedData.hasTemplateRefs)}`);
                lines.push(`- templateCount: ${String(r.derivedData.templateCount)}`);
                lines.push(`- scenarioCount: ${String(r.derivedData.scenarioCount)}`);
                lines.push(`- effectiveConfigVersion: ${r.derivedData.effectiveConfigVersion || 'n/a'}`);
                if (r.derivedData.scenarioPoolError) lines.push(`- scenarioPoolError: ${r.derivedData.scenarioPoolError}`);
                lines.push('');
            }

            if (r?.noTenantBleedProof) {
                lines.push('## Tenant Safety');
                lines.push('');
                lines.push(`- Overall: ${r.noTenantBleedProof.passed ? '✅ PASSED' : '🔴 FAILED'}`);
                if (Array.isArray(r.noTenantBleedProof.violations) && r.noTenantBleedProof.violations.length > 0) {
                    lines.push('- Violations:');
                    for (const v of r.noTenantBleedProof.violations) {
                        lines.push(`  - ${v.rule}: ${v.message}`);
                    }
                }
                lines.push('');
            }

            if (r?.diagrams) {
                lines.push('## Diagrams');
                for (const [k, v] of Object.entries(r.diagrams)) {
                    lines.push(`### ${k}`);
                    lines.push('```mermaid');
                    lines.push(String(v || '').trim());
                    lines.push('```');
                    lines.push('');
                }
            }

            return lines.join('\n');
        }

        const lines = [];
        
        lines.push(`# Wiring Report: ${r.companyName || r.companyId}`);
        lines.push('');
        lines.push(`- **Health:** ${r.health}`);
        lines.push(`- **Generated:** ${r.generatedAt}`);
        lines.push(`- **Company ID:** ${r.companyId}`);
        lines.push(`- **Trade:** ${r.tradeKey}`);
        lines.push(`- **Effective Config:** ${r.effectiveConfigVersion || 'n/a'}`);
        lines.push('');
        
        // Special Checks
        lines.push('## Special Checks');
        if (r.specialChecks?.templateReferences) {
            const tr = r.specialChecks.templateReferences;
            lines.push(`### Template References: ${tr.status}`);
            lines.push(`- Enabled: ${tr.enabledRefs}/${tr.totalRefs}`);
            lines.push(`- ${tr.message}`);
        }
        if (r.specialChecks?.scenarioPool) {
            const sp = r.specialChecks.scenarioPool;
            lines.push(`### Scenario Pool: ${sp.status}`);
            lines.push(`- Total: ${sp.scenarioCount}`);
            lines.push(`- Enabled: ${sp.enabledCount}`);
        }
        if (r.specialChecks?.redisCache) {
            const rc = r.specialChecks.redisCache;
            lines.push(`### Redis Cache: ${rc.status}`);
            lines.push(`- ${rc.message || ''}`);
        }
        if (r.specialChecks?.bookingContract) {
            const bc = r.specialChecks.bookingContract;
            lines.push(`### Booking Contract: ${bc.status}`);
            lines.push(`- ${bc.message || ''}`);
        }
        lines.push('');
        
        // Issues
        lines.push('## Issues');
        if (!r.issues?.length) {
            lines.push('✅ No issues');
        } else {
            for (const i of r.issues) {
                lines.push(`### ${i.severity}: ${i.label}`);
                lines.push(`- Node: ${i.nodeId}`);
                lines.push(`- Reasons: ${(i.reasons || []).join(', ')}`);
                if (i.fix) lines.push(`- Fix: ${i.fix}`);
            }
        }
        
        return lines.join('\n');
    }
    
    // ========================================================================
    // INDEX BUILDING
    // ========================================================================
    
    function buildIndex(report) {
        // V2 report: build a synthetic tree from uiMap (tabs → sections → fields)
        if (isV2Report(report)) {
            const map = new Map();
            const children = new Map();

            const healthById = getV2FieldHealthById(report);
            
            // Track IDs to prevent duplicates and circular refs
            const tabIds = new Set();
            const sectionIds = new Set();

            const addChild = (parentId, childId) => {
                if (!parentId) return;
                // Prevent self-reference (expected for some section nodes - not an error, just data quirk)
                if (parentId === childId) {
                    // Debug level - these are expected for certain section nodes that reference themselves
                    // The guard handles this correctly - node becomes root-level instead of infinite loop
                    return;
                }
                if (!children.has(parentId)) children.set(parentId, []);
                // Prevent duplicate children
                if (!children.get(parentId).includes(childId)) {
                    children.get(parentId).push(childId);
                }
            };

            // Tabs (root level - no parent)
            for (const t of (report?.uiMap?.tabs || [])) {
                if (!t.id) continue;
                tabIds.add(t.id);
                const node = {
                    id: t.id,
                    type: 'TAB',
                    label: t.label || t.id,
                    description: '',
                    parentId: null,
                    status: 'WIRED', // Tabs are structural; status driven by children counts
                    critical: !!t.critical,
                    uiPath: t?.ui?.tabId ? `Tab: ${t.ui.tabId}` : null
                };
                map.set(node.id, node);
                if (!children.has(node.id)) children.set(node.id, []);
            }

            // Sections (parent must be a TAB)
            for (const s of (report?.uiMap?.sections || [])) {
                if (!s.id) continue;
                sectionIds.add(s.id);
                // Only accept valid tab parents
                const parentId = (s.tabId && tabIds.has(s.tabId)) ? s.tabId : null;
                const node = {
                    id: s.id,
                    type: 'SECTION',
                    label: s.label || s.id,
                    description: '',
                    parentId,
                    status: 'WIRED',
                    critical: !!s.critical,
                    uiPath: s?.ui?.path || null
                };
                map.set(node.id, node);
                addChild(node.parentId, node.id);
                if (!children.has(node.id)) children.set(node.id, []);
            }

            // Fields (parent must be a SECTION)
            for (const f of (report?.uiMap?.fields || [])) {
                if (!f.id) continue;
                const h = healthById.get(f.id);
                // Only accept valid section parents
                const parentId = (f.sectionId && sectionIds.has(f.sectionId)) ? f.sectionId : null;
                const node = {
                    id: f.id,
                    type: 'FIELD',
                    label: f.label || f.id,
                    description: '',
                    parentId,
                    status: h?.status || 'UNKNOWN',
                    critical: !!f.critical,
                    required: !!f.required,
                    uiPath: f?.ui?.path || null
                };
                map.set(node.id, node);
                addChild(node.parentId, node.id);
            }

            console.log('[WiringTab] Index built:', { 
                tabs: tabIds.size, 
                sections: sectionIds.size, 
                fields: map.size - tabIds.size - sectionIds.size,
                totalNodes: map.size 
            });
            
            return { map, children };
        }

        const map = new Map();
        (report.nodes || []).forEach(n => {
            if (n && n.id) map.set(n.id, n);
        });
        
        const children = new Map();
        (report.nodes || []).forEach(n => {
            if (!n?.parentId || !n?.id) return;
            // Prevent self-reference
            if (n.parentId === n.id) return;
            if (!children.has(n.parentId)) children.set(n.parentId, []);
            if (!children.get(n.parentId).includes(n.id)) {
                children.get(n.parentId).push(n.id);
            }
        });
        
        return { map, children };
    }
    
    // ========================================================================
    // EXECUTIVE HEALTH BANNER - Salesforce-Grade First Impression
    // ========================================================================
    
    function renderExecutiveBanner() {
        const el = $('#wiringExecutiveBanner');
        if (!el || !_report) return;
        
        if (!isV2Report(_report)) {
            el.innerHTML = '';
            return;
        }
        
        const health = _report.health?.overall || 'UNKNOWN';
        const scope = _report.scope || {};
        const sb = _report.scoreboard || {};
        const critCount = _report.health?.criticalIssues?.length || 0;
        const warnCount = _report.health?.warnings?.length || 0;
        const fieldCount = _report.health?.fields?.length || 0;
        const wiredCount = _report.health?.byStatus?.WIRED || 0;
        const uiOnlyCount = _report.health?.byStatus?.UI_ONLY || 0;
        const misconfiguredCount = _report.health?.byStatus?.MISCONFIGURED || 0;
        
        const statusClass = health === 'GREEN' ? 'green' : health === 'YELLOW' ? 'yellow' : 'red';
        const statusText = health === 'GREEN' ? '✅ ALL SYSTEMS OPERATIONAL' : 
                          health === 'YELLOW' ? '⚠️ ISSUES DETECTED' : 
                          '🔴 CRITICAL ISSUES';
        
        el.innerHTML = `
          <div class="w-exec-banner status-${statusClass}">
            <div class="w-exec-status-indicator ${statusClass}"></div>
            
            <div class="w-exec-header">
              <div class="w-exec-title-group">
                <span class="w-exec-status-badge ${statusClass}">${statusText}</span>
                <span class="w-exec-company">${esc(scope.companyName || 'Unknown Company')}</span>
              </div>
              <div class="w-exec-meta">
                <div><strong>Trade:</strong> ${esc(scope.tradeKey || 'universal')} (${esc(scope.tradeKeySource || 'default')})</div>
                <div><strong>Environment:</strong> ${esc(scope.environment || 'production')}</div>
                <div><strong>ECV:</strong> ${esc((scope.effectiveConfigVersion || 'n/a').toString().substring(0, 16))}</div>
                <div class="w-meta-small">Report generated: ${esc(_report.meta?.generatedAt || '')} (${_report.meta?.generationTimeMs || 0}ms)</div>
              </div>
            </div>
            
            <div class="w-exec-metrics">
              <div class="w-exec-metric ${wiredCount > 0 ? 'highlight-green' : ''}">
                <div class="w-exec-metric-value">${wiredCount}</div>
                <div class="w-exec-metric-label">Fully Wired</div>
                <div class="w-exec-metric-detail">End-to-end connected</div>
              </div>
              <div class="w-exec-metric ${uiOnlyCount > 0 ? 'highlight-yellow' : ''}">
                <div class="w-exec-metric-value">${uiOnlyCount}</div>
                <div class="w-exec-metric-label">UI Only</div>
                <div class="w-exec-metric-detail">No runtime reader</div>
              </div>
              <div class="w-exec-metric ${misconfiguredCount > 0 ? 'highlight-red' : ''}">
                <div class="w-exec-metric-value">${misconfiguredCount}</div>
                <div class="w-exec-metric-label">Misconfigured</div>
                <div class="w-exec-metric-detail">Needs attention</div>
              </div>
              <div class="w-exec-metric ${critCount > 0 ? 'highlight-red' : ''}">
                <div class="w-exec-metric-value">${critCount}</div>
                <div class="w-exec-metric-label">Critical Issues</div>
                <div class="w-exec-metric-detail">Blocking problems</div>
              </div>
              <div class="w-exec-metric">
                <div class="w-exec-metric-value">${fieldCount}</div>
                <div class="w-exec-metric-label">Total Fields</div>
                <div class="w-exec-metric-detail">In registry</div>
              </div>
            </div>
          </div>
        `;
    }
    
    // ========================================================================
    // KILL SWITCHES STATUS
    // ========================================================================
    
    function renderKillSwitches() {
        const el = $('#wiringKillSwitches');
        if (!el || !_report) return;
        
        if (!isV2Report(_report)) {
            el.innerHTML = '';
            return;
        }
        
        const killSwitches = _report.effectiveConfig?.killSwitches || {};
        const ksEntries = Object.entries(killSwitches);
        
        if (ksEntries.length === 0) {
            el.innerHTML = '';
            return;
        }
        
        const hasBlocking = ksEntries.some(([_, v]) => v.isBlocking);
        
        el.innerHTML = `
          <div class="w-killswitch-panel">
            <div class="w-panel-title">🔑 Kill Switches ${hasBlocking ? '<span style="color:#f87171;font-weight:400;font-size:12px;">(BLOCKING ACTIVE)</span>' : '<span style="color:#22c55e;font-weight:400;font-size:12px;">(All Clear)</span>'}</div>
            <div class="w-killswitch-grid">
              ${ksEntries.map(([id, ks]) => `
                <div class="w-killswitch-card ${ks.isBlocking ? 'blocking' : 'safe'}">
                  <div class="w-killswitch-info">
                    <div class="w-killswitch-name">${esc(id.split('.').pop())}</div>
                    <div class="w-killswitch-effect">${esc(ks.effect || 'Controls behavior')}</div>
                  </div>
                  <div class="w-killswitch-status ${ks.isBlocking ? 'on' : 'off'}">
                    ${ks.isBlocking ? '🔴 ON' : '✅ OFF'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
    }
    
    // ========================================================================
    // GAP ANALYSIS - The Heart of Diagnostics
    // ========================================================================
    
    function renderGapAnalysis() {
        const el = $('#wiringGapAnalysis');
        if (!el || !_report) return;
        
        if (!isV2Report(_report)) {
            el.innerHTML = '';
            return;
        }
        
        const diff = _report.diff || {};
        const coverage = _report.coverage || {};
        const health = _report.health || {};
        
        // MISCONFIGURED - Critical issues
        const misconfigured = (health.criticalIssues || []).map(i => ({
            id: i.fieldId,
            label: i.label,
            reason: i.reason,
            fix: i.fix,
            dbPath: i.dbPath,
            uiPath: i.uiPath
        }));
        
        // UI_ONLY - Configured but no runtime reader
        const uiOnly = (coverage.uiOnlyPaths || []).map(id => {
            const field = (health.fields || []).find(f => f.id === id) || {};
            return {
                id,
                label: field.label || id,
                reason: 'No runtime code reads this field',
                fix: 'Add runtime reader or remove from UI'
            };
        });
        
        // DEAD_READ - Runtime reads but no UI
        const deadRead = (coverage.deadReadPaths || []).map(id => {
            const reader = _report.runtimeMap?.readers?.find(r => r.configPath === id) || {};
            return {
                id,
                label: id,
                reason: 'Code reads this but UI doesn\'t expose it',
                fix: 'Add to wiringRegistry or remove runtime reader',
                readers: reader.readers || []
            };
        });
        
        const renderGapItem = (item, type) => `
          <div class="w-gap-item" data-focus="${esc(item.id)}">
            <div class="w-gap-item-id">${esc(item.id)}</div>
            <div class="w-gap-item-label">${esc(item.label || item.reason)}</div>
            ${item.fix ? `<div class="w-gap-item-fix">💡 ${esc(item.fix)}</div>` : ''}
          </div>
        `;
        
        el.innerHTML = `
          <div class="w-gap-panel">
            <div class="w-gap-header">
              <div>
                <div class="w-gap-title">🔬 Gap Analysis</div>
                <div class="w-gap-subtitle">Registry vs MongoDB vs Runtime - Where are the mismatches?</div>
              </div>
            </div>
            
            <div class="w-gap-grid">
              <!-- MISCONFIGURED Column -->
              <div class="w-gap-column critical">
                <div class="w-gap-column-header">
                  <div class="w-gap-column-title">🔴 MISCONFIGURED</div>
                  <div class="w-gap-column-count">${misconfigured.length}</div>
                </div>
                <div class="w-gap-list">
                  ${misconfigured.length === 0 
                    ? '<div class="w-gap-empty success">✅ All required fields valid</div>'
                    : misconfigured.map(i => renderGapItem(i, 'critical')).join('')
                  }
                </div>
              </div>
              
              <!-- UI_ONLY Column -->
              <div class="w-gap-column warning">
                <div class="w-gap-column-header">
                  <div class="w-gap-column-title">🟡 UI_ONLY (Dead Config)</div>
                  <div class="w-gap-column-count">${uiOnly.length}</div>
                </div>
                <div class="w-gap-list">
                  ${uiOnly.length === 0 
                    ? '<div class="w-gap-empty success">✅ All UI fields have runtime readers</div>'
                    : uiOnly.map(i => renderGapItem(i, 'warning')).join('')
                  }
                </div>
              </div>
              
              <!-- DEAD_READ Column -->
              <div class="w-gap-column info">
                <div class="w-gap-column-header">
                  <div class="w-gap-column-title">🔵 DEAD_READ (Hidden Config)</div>
                  <div class="w-gap-column-count">${deadRead.length}</div>
                </div>
                <div class="w-gap-list">
                  ${deadRead.length === 0 
                    ? '<div class="w-gap-empty success">✅ All runtime reads exposed in UI</div>'
                    : deadRead.map(i => renderGapItem(i, 'info')).join('')
                  }
                </div>
              </div>
            </div>
          </div>
        `;
        
        // Bind click handlers for gap items
        $$('.w-gap-item[data-focus]', el).forEach(item => {
            item.addEventListener('click', () => selectNode(item.dataset.focus));
        });
    }
    
    // ========================================================================
    // ACTION QUEUE - Prioritized Fixes
    // ========================================================================
    
    function renderActionQueue() {
        const el = $('#wiringActionQueue');
        if (!el || !_report) return;
        
        if (!isV2Report(_report)) {
            el.innerHTML = '';
            return;
        }
        
        const actions = [];
        
        // Add critical issues as highest priority
        (_report.health?.criticalIssues || []).forEach((issue, idx) => {
            actions.push({
                priority: 'critical',
                order: idx + 1,
                field: issue.label || issue.fieldId,
                fieldId: issue.fieldId,
                reason: issue.reason,
                fix: issue.fix,
                dbPath: issue.dbPath,
                uiPath: issue.uiPath
            });
        });
        
        // Add warnings as medium priority
        (_report.health?.warnings || []).slice(0, 10).forEach((warn, idx) => {
            actions.push({
                priority: 'medium',
                order: actions.length + 1,
                field: warn.label || warn.fieldId,
                fieldId: warn.fieldId,
                reason: warn.reason || warn.message,
                fix: warn.fix,
                dbPath: warn.dbPath
            });
        });
        
        if (actions.length === 0) {
            el.innerHTML = `
              <div class="w-action-panel">
                <div class="w-action-header">
                  <div class="w-action-title">📋 Action Queue</div>
                </div>
                <div class="w-action-empty">✅ No actions required - system is healthy!</div>
              </div>
            `;
            return;
        }
        
        el.innerHTML = `
          <div class="w-action-panel">
            <div class="w-action-header">
              <div class="w-action-title">📋 Action Queue</div>
              <div class="w-action-count">${actions.length} fixes needed</div>
            </div>
            <div class="w-action-list">
              ${actions.slice(0, 15).map(a => `
                <div class="w-action-item priority-${a.priority}">
                  <div class="w-action-priority">#${a.order}</div>
                  <div class="w-action-content">
                    <div class="w-action-field">${esc(a.field)}</div>
                    <div class="w-action-reason">${esc(a.reason)}</div>
                    ${a.fix ? `<div class="w-action-fix">💡 ${esc(a.fix)}</div>` : ''}
                    ${a.uiPath ? `<div class="w-action-path">UI: ${esc(a.uiPath)}</div>` : ''}
                    ${a.dbPath ? `<div class="w-action-path">DB: ${esc(a.dbPath)}</div>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
    }
    
    // ========================================================================
    // SCOREBOARD RENDER
    // ========================================================================
    
    function renderScoreboard() {
        const el = $('#wiringScoreboard');
        if (!el || !_report) return;

        // V2 scoreboard
        if (isV2Report(_report)) {
            const sb = _report.scoreboard || {};
            const scope = _report.scope || {};
            el.innerHTML = `
              <div class="w-score-container">
                <div class="w-score-header">
                  <div class="w-score-title">
                    <span class="w-title">WIRING STATUS (V2)</span>
                    ${healthBadge(_report.health?.overall)}
                  </div>
                  <div class="w-score-meta">
                    <div><strong>${esc(scope.companyName || 'Unknown')}</strong></div>
                    <div class="w-meta-row">
                      <span>Trade: ${esc(scope.tradeKey || 'universal')}</span>
                      <span>•</span>
                      <span>Trade source: ${esc(scope.tradeKeySource || 'unknown')}</span>
                      <span>•</span>
                      <span>Env: ${esc(scope.environment || 'production')}</span>
                      <span>•</span>
                      <span>ECV: ${esc((_report.derivedData?.effectiveConfigVersion || scope.effectiveConfigVersion || 'n/a').toString().substring(0, 12))}</span>
                    </div>
                    <div class="w-meta-small">Generated: ${esc(_report.meta?.generatedAt || '')} (${esc(String(_report.meta?.generationTimeMs || ''))}ms)</div>
                  </div>
                </div>
                <div class="w-score-grid">
                  ${Object.keys(sb).map(k => {
                    const c = sb[k] || {};
                    const st = c.status || 'GRAY';
                    const tileClass = st === 'GREEN' ? 'green' : st === 'YELLOW' ? 'yellow' : st === 'RED' ? 'red' : '';
                    return `
                      <div class="w-tile ${tileClass}">
                        <div class="w-tile-num">${esc(String(c.percent ?? ''))}%</div>
                        <div class="w-tile-label">${esc(c.label || k)}</div>
                        <div class="w-meta-small">${esc(c.value || '')}</div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
            return;
        }
        
        const counts = _report.counts || {};
        const tabs = counts.tabs || {};
        const sections = counts.sections || {};
        const issues = counts.issues || {};
        
        el.innerHTML = `
            <div class="w-score-container">
                <div class="w-score-header">
                    <div class="w-score-title">
                        <span class="w-title">WIRING STATUS</span>
                        ${healthBadge(_report.health)}
                    </div>
                    <div class="w-score-meta">
                        <div><strong>${esc(_report.companyName || 'Unknown')}</strong></div>
                        <div class="w-meta-row">
                            <span>Trade: ${esc(_report.tradeKey)}</span>
                            <span>•</span>
                            <span>Env: ${esc(_report.environment)}</span>
                            <span>•</span>
                            <span>ECV: ${esc(_report.effectiveConfigVersion?.substring(0, 8) || 'n/a')}</span>
                        </div>
                        <div class="w-meta-small">Generated: ${esc(_report.generatedAt)} (${_report.generationTimeMs}ms)</div>
                    </div>
                </div>
                <div class="w-score-grid">
                    <div class="w-tile">
                        <div class="w-tile-num">${tabs.total || 0}</div>
                        <div class="w-tile-label">Tabs</div>
                    </div>
                    <div class="w-tile green">
                        <div class="w-tile-num">${(tabs.wired || 0) + (tabs.proven || 0)}</div>
                        <div class="w-tile-label">Wired</div>
                    </div>
                    <div class="w-tile yellow">
                        <div class="w-tile-num">${tabs.partial || 0}</div>
                        <div class="w-tile-label">Partial</div>
                    </div>
                    <div class="w-tile">
                        <div class="w-tile-num">${sections.total || 0}</div>
                        <div class="w-tile-label">Sections</div>
                    </div>
                    <div class="w-tile green">
                        <div class="w-tile-num">${(sections.wired || 0) + (sections.proven || 0)}</div>
                        <div class="w-tile-label">Wired</div>
                    </div>
                    <div class="w-tile red">
                        <div class="w-tile-num">${issues.critical || 0}</div>
                        <div class="w-tile-label">Critical</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // SPECIAL CHECKS RENDER
    // ========================================================================
    
    function renderSpecialChecks() {
        const el = $('#wiringSpecialChecks');
        if (!el || !_report?.specialChecks) return;

        // V2: show derivedData + tenant safety summary here
        if (isV2Report(_report)) {
            const d = _report.derivedData || {};
            const t = _report.noTenantBleedProof || {};
            el.innerHTML = `
              <div class="w-panel">
                <div class="w-panel-title">🔍 Source-of-Truth Summary</div>
                <div class="w-checks-grid">
                  <div class="w-check-card green">
                    <div class="w-check-header">
                      <span class="w-check-title">📦 Scenario Pool (Derived)</span>
                      ${statusBadge(d.scenarioCount > 0 ? 'LOADED' : 'EMPTY')}
                    </div>
                    <div class="w-check-details">
                      <div>Templates linked: <strong>${esc(String(d.templateCount ?? 0))}</strong></div>
                      <div>Scenario count: <strong>${esc(String(d.scenarioCount ?? 0))}</strong></div>
                      <div>ECV: <strong>${esc(String(d.effectiveConfigVersion || 'n/a'))}</strong></div>
                    </div>
                    ${d.scenarioPoolError ? `<div class="w-check-message">Error: ${esc(d.scenarioPoolError)}</div>` : ''}
                  </div>
                  <div class="w-check-card ${t.passed ? 'green' : 'red'}">
                    <div class="w-check-header">
                      <span class="w-check-title">🛡️ Tenant Safety</span>
                      ${statusBadge(t.passed ? 'PROVEN' : 'MISCONFIGURED')}
                    </div>
                    <div class="w-check-details">
                      <div>Passed: <strong>${esc(String(!!t.passed))}</strong></div>
                      <div>Violations: <strong>${esc(String((t.violations || []).length))}</strong></div>
                    </div>
                  </div>
                </div>
              </div>
            `;
            return;
        }
        
        const sc = _report.specialChecks;
        
        el.innerHTML = `
            <div class="w-panel">
                <div class="w-panel-title">🔍 Critical Checks (THE blockers we found)</div>
                <div class="w-checks-grid">
                    ${renderCheckCard('🔑 Kill Switches', sc.killSwitches)}
                    ${renderCheckCard('🔗 Template References', sc.templateReferences)}
                    ${renderCheckCard('📦 Scenario Pool', sc.scenarioPool)}
                    ${renderCheckCard('📋 Booking Slots', sc.bookingSlotNormalization)}
                    ${renderCheckCard('👋 Greeting Intercept', sc.greetingIntercept)}
                    ${renderCheckCard('💾 Redis Cache', sc.redisCache)}
                    ${renderCheckCard('📝 Booking Contract', sc.bookingContract)}
                    ${renderCheckCard('🔀 Dynamic Flows', sc.dynamicFlows)}
                </div>
            </div>
        `;
    }
    
    function renderCheckCard(title, check) {
        if (!check) return '';
        
        const health = check.health || 'GRAY';
        const status = check.status || 'UNKNOWN';
        
        let details = '';
        
        // Kill switches
        if (check.forceLLMDiscovery !== undefined) {
            details += `<div>forceLLMDiscovery: <strong class="${check.forceLLMDiscovery ? 'text-red' : 'text-green'}">${check.forceLLMDiscovery}</strong></div>`;
        }
        if (check.disableScenarioAutoResponses !== undefined) {
            details += `<div>disableScenarioAutoResponses: <strong class="${check.disableScenarioAutoResponses ? 'text-red' : 'text-green'}">${check.disableScenarioAutoResponses}</strong></div>`;
        }
        if (check.scenarioAutoResponseAllowed !== undefined) {
            details += `<div>Scenarios can auto-respond: <strong class="${check.scenarioAutoResponseAllowed ? 'text-green' : 'text-red'}">${check.scenarioAutoResponseAllowed ? 'YES' : 'NO'}</strong></div>`;
        }
        
        // Template refs
        if (check.enabledRefs !== undefined) {
            details += `<div>Linked: ${check.enabledRefs}/${check.totalRefs}</div>`;
        }
        if (check.scenarioCount !== undefined) {
            details += `<div>Scenarios: ${check.scenarioCount}</div>`;
        }
        if (check.enabledCount !== undefined) {
            details += `<div>Enabled: ${check.enabledCount}</div>`;
        }
        if (check.ttlSeconds !== undefined && check.ttlSeconds > 0) {
            details += `<div>TTL: ${check.ttlSeconds}s</div>`;
        }
        if (check.companyFlowCount !== undefined) {
            details += `<div>Flows: ${check.companyFlowCount}</div>`;
        }
        if (check.definedSlotCount !== undefined) {
            details += `<div>Slots: ${check.definedSlotCount}</div>`;
        }
        
        // Booking slot normalization
        if (check.validSlots !== undefined) {
            details += `<div>Valid slots: <strong class="text-green">${check.validSlots}</strong></div>`;
        }
        if (check.rejectedSlots !== undefined && check.rejectedSlots > 0) {
            details += `<div>Rejected slots: <strong class="text-red">${check.rejectedSlots}</strong></div>`;
        }
        if (check.rejectionReasons && Object.keys(check.rejectionReasons).length > 0) {
            details += `<div>Reasons: ${Object.entries(check.rejectionReasons).map(([k,v]) => `${k}(${v})`).join(', ')}</div>`;
        }
        
        // Greeting intercept
        if (check.responseCount !== undefined) {
            details += `<div>Greeting responses: ${check.responseCount}</div>`;
        }
        if (check.missingTriggers?.length > 0) {
            details += `<div>Missing: ${check.missingTriggers.slice(0, 3).join(', ')}${check.missingTriggers.length > 3 ? '...' : ''}</div>`;
        }
        
        return `
            <div class="w-check-card ${health.toLowerCase()}">
                <div class="w-check-header">
                    <span class="w-check-title">${esc(title)}</span>
                    ${statusBadge(status)}
                </div>
                <div class="w-check-details">${details}</div>
                ${check.message ? `<div class="w-check-message">${esc(check.message)}</div>` : ''}
                ${check.fix ? `<div class="w-check-fix">Fix: ${esc(check.fix)}</div>` : ''}
            </div>
        `;
    }
    
    // ========================================================================
    // ISSUES RENDER
    // ========================================================================
    
    function renderIssues() {
        const el = $('#wiringIssues');
        if (!el || !_report) return;

        // V2: show criticalIssues + warnings + diff
        if (isV2Report(_report)) {
            const crit = _report.health?.criticalIssues || [];
            const warns = _report.health?.warnings || [];
            const diff = _report.diff || {};
            const items = [];
            for (const c of crit) {
                items.push({
                    severity: c.critical ? 'CRITICAL' : 'HIGH',
                    nodeId: c.fieldId,
                    label: c.label || c.fieldId,
                    status: c.status,
                    reasons: [c.reason, c.expected ? `Expected: ${c.expected}` : null, c.actual ? `Actual: ${c.actual}` : null].filter(Boolean),
                    fix: c.fix || null
                });
            }
            for (const w of warns) {
                items.push({
                    severity: 'MEDIUM',
                    nodeId: w.fieldId,
                    label: w.label || w.fieldId,
                    status: w.status,
                    reasons: [w.reason].filter(Boolean),
                    fix: w.fix || null
                });
            }
            // Add diff highlights
            const uiVsDb = diff.uiVsDb || [];
            const dbVsRuntime = diff.dbVsRuntime || [];
            const runtimeVsUi = diff.runtimeVsUi || [];
            for (const d of uiVsDb.slice(0, 10)) {
                items.push({ severity: 'HIGH', nodeId: d.fieldId, label: d.issue, status: 'MISCONFIGURED', reasons: [d.dbPath || ''], fix: d.uiPath || null });
            }
            for (const d of dbVsRuntime.slice(0, 10)) {
                items.push({ severity: 'MEDIUM', nodeId: d.fieldId, label: d.issue, status: 'UI_ONLY', reasons: [d.dbPath || ''], fix: null });
            }
            for (const d of runtimeVsUi.slice(0, 10)) {
                items.push({ severity: 'MEDIUM', nodeId: d.fieldId, label: d.issue, status: 'DEAD_READ', reasons: [d.runtimeEntry?.dbPath || ''], fix: null });
            }

            if (items.length === 0) {
                el.innerHTML = `
                  <div class="w-panel">
                    <div class="w-panel-title">⚠️ Issues</div>
                    <div class="w-empty">✅ No wiring issues detected</div>
                  </div>
                `;
                return;
            }

            el.innerHTML = `
              <div class="w-panel">
                <div class="w-panel-title">⚠️ Issues (${items.length})</div>
                <div class="w-issues-list">
                  ${items.slice(0, 25).map(i => `
                    <div class="w-issue ${String(i.severity || '').toLowerCase()}">
                      <div class="w-issue-header">
                        ${severityBadge(i.severity)}
                        <span class="w-issue-label">${esc(i.label)}</span>
                        ${statusBadge(i.status)}
                      </div>
                      <div class="w-issue-node">Node: ${esc(i.nodeId)}</div>
                      ${i.reasons?.length ? `<div class="w-issue-reasons">${esc(i.reasons.join(' | '))}</div>` : ''}
                      ${i.fix ? `<div class="w-issue-fix">💡 Fix: ${esc(i.fix)}</div>` : ''}
                      <button class="w-mini-btn" data-focus="${esc(i.nodeId)}">Inspect</button>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;

            $$('.w-mini-btn[data-focus]', el).forEach(btn => {
                btn.addEventListener('click', () => selectNode(btn.dataset.focus));
            });
            return;
        }
        
        const issues = _report.issues || [];
        
        if (issues.length === 0) {
            el.innerHTML = `
                <div class="w-panel">
                    <div class="w-panel-title">⚠️ Issues</div>
                    <div class="w-empty">✅ No wiring issues detected</div>
                </div>
            `;
            return;
        }
        
        el.innerHTML = `
            <div class="w-panel">
                <div class="w-panel-title">⚠️ Issues (${issues.length})</div>
                <div class="w-issues-list">
                    ${issues.slice(0, 15).map(i => `
                        <div class="w-issue ${i.severity.toLowerCase()}">
                            <div class="w-issue-header">
                                ${severityBadge(i.severity)}
                                <span class="w-issue-label">${esc(i.label)}</span>
                                ${statusBadge(i.status)}
                            </div>
                            <div class="w-issue-node">Node: ${esc(i.nodeId)}</div>
                            ${i.reasons?.length ? `<div class="w-issue-reasons">${esc(i.reasons.join(' | '))}</div>` : ''}
                            ${i.fix ? `<div class="w-issue-fix">💡 Fix: ${esc(i.fix)}</div>` : ''}
                            <button class="w-mini-btn" data-focus="${esc(i.nodeId)}">View in Tree</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Bind focus buttons
        $$('.w-mini-btn[data-focus]', el).forEach(btn => {
            btn.addEventListener('click', () => focusNode(btn.dataset.focus));
        });
    }
    
    // ========================================================================
    // GUARDRAILS RENDER
    // ========================================================================
    
    function renderGuardrails() {
        const el = $('#wiringGuardrails');
        if (!el || !_report) return;

        // V2: show tenant safety checks + violations
        if (isV2Report(_report)) {
            const t = _report.noTenantBleedProof || {};
            const checks = t.checks || [];
            const violations = t.violations || [];
            el.innerHTML = `
              <div class="w-panel">
                <div class="w-panel-title">🛡️ Tenant Safety & Guardrails</div>
                <div class="w-meta-small">Strict company scoping, global templates only, no tenant bleed.</div>

                <div style="margin-top: 10px;">
                  <div><strong>Overall:</strong> ${t.passed ? '<span class="text-green">PASSED</span>' : '<span class="text-red">FAILED</span>'}</div>
                </div>

                <div style="margin-top: 10px;">
                  <div class="w-guard-section-title">Checks</div>
                  ${checks.map(c => `
                    <div class="w-guard-item ${c.passed ? 'pass' : 'violation'}">
                      <div class="w-guard-header">
                        <span class="w-guard-status">${c.passed ? '✅' : '🚫'}</span>
                        <strong>${esc(c.id || 'CHECK')}</strong>
                      </div>
                      <div class="w-guard-details">${esc(c.description || '')}</div>
                      ${c.expected !== undefined ? `<div class="w-guard-file">Expected: ${esc(String(c.expected))} | Actual: ${esc(String(c.actual))}</div>` : ''}
                    </div>
                  `).join('')}
                </div>

                ${violations.length > 0 ? `
                  <div style="margin-top: 14px;">
                    <div class="w-guard-section-title">Violations (${violations.length})</div>
                    ${violations.map(v => `
                      <div class="w-guard-item violation">
                        <div class="w-guard-header">
                          <span class="w-guard-status">🧨</span>
                          <strong>${esc(v.rule || 'TENANT_RISK')}</strong>
                          <span class="w-guard-severity">${esc(v.severity || 'CRITICAL')}</span>
                        </div>
                        <div class="w-guard-details">${esc(v.message || '')}</div>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            `;
            return;
        }
        
        const guardrails = _report.guardrails || [];
        const scan = _report.guardrailScan || [];
        
        const violations = scan.filter(g => g.status === 'VIOLATION' || g.status === 'WARN');
        const passes = scan.filter(g => g.status === 'PASS');
        
        el.innerHTML = `
            <div class="w-panel">
                <div class="w-panel-title">🛡️ Guardrails (MUST NOT DO)</div>
                
                ${violations.length > 0 ? `
                    <div class="w-guard-violations">
                        <div class="w-guard-section-title">⚠️ Violations (${violations.length})</div>
                        ${violations.map(v => `
                            <div class="w-guard-item violation">
                                <div class="w-guard-header">
                                    <span class="w-guard-status">🚫</span>
                                    <strong>${esc(v.ruleId)}</strong>
                                    <span class="w-guard-severity">${esc(v.severity)}</span>
                                </div>
                                <div class="w-guard-details">${esc(v.details)}</div>
                                ${v.file ? `<div class="w-guard-file">${esc(v.file)}:${v.line || '?'}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                
                <div class="w-guard-passes">
                    <div class="w-guard-section-title">✅ Passed (${passes.length})</div>
                    <div class="w-guard-pass-list">
                        ${passes.map(p => `<span class="w-guard-pass-item">${esc(p.ruleId)}</span>`).join('')}
                    </div>
                </div>
                
                <div class="w-guard-rules">
                    <div class="w-guard-section-title">📋 Rules Reference</div>
                    ${guardrails.map(g => `
                        <div class="w-guard-rule">
                            <strong>${esc(g.id)}</strong>: ${esc(g.label)}
                            <span class="w-guard-severity">${esc(g.severity)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // TREE VIEW RENDER
    // ========================================================================
    
    function renderTree() {
        const el = $('#wiringTree');
        if (!el || !_report || !_index) return;
        
        const { map, children } = _index;
        const roots = isV2Report(_report)
            ? (Array.from(map.values()).filter(n => n.type === 'TAB'))
            : (_report.nodes || []).filter(n => n.type === 'TAB');
        
        // Max depth to prevent infinite recursion from circular refs
        const MAX_DEPTH = 20;
        
        function nodeMatches(n) {
            if (!_searchTerm) return true;
            const s = _searchTerm.toLowerCase();
            return (n.label || '').toLowerCase().includes(s) || (n.id || '').toLowerCase().includes(s);
        }
        
        function subtreeMatches(id, visited = new Set()) {
            // Guard against circular refs
            if (visited.has(id) || visited.size > 200) return false;
            visited.add(id);
            
            const n = map.get(id);
            if (n && nodeMatches(n)) return true;
            const kids = children.get(id) || [];
            return kids.some(k => subtreeMatches(k, visited));
        }
        
        function renderNode(id, depth = 0, visited = new Set()) {
            // Guard against circular refs and excessive depth
            if (visited.has(id)) {
                console.warn('[WiringTab] Circular ref detected:', id);
                return '';
            }
            if (depth > MAX_DEPTH) {
                console.warn('[WiringTab] Max depth exceeded at:', id);
                return '';
            }
            visited.add(id);
            
            const n = map.get(id);
            if (!n) return '';
            
            // Focus filter (with circular ref guard)
            if (_focusedNodeId && !isDescendantOrSelf(id, _focusedNodeId, new Set())) return '';
            
            // Search filter
            if (_searchTerm && !subtreeMatches(id, new Set())) return '';
            
            const kids = children.get(id) || [];
            const hasKids = kids.length > 0;
            const isExpanded = _expandedNodes.has(id);
            
            return `
                <div class="w-node" data-node="${esc(id)}" style="margin-left:${depth * 16}px">
                    <div class="w-node-row" data-select="${esc(id)}" style="cursor:pointer;">
                        ${hasKids ? `
                            <button class="w-expander" data-expand="${esc(id)}">${isExpanded ? '▾' : '▸'}</button>
                        ` : '<span class="w-expander-spacer"></span>'}
                        <span class="w-node-type">${esc(n.type)}</span>
                        <span class="w-node-label">${esc(n.label)}</span>
                        ${statusBadge(n.status)}
                        ${n.critical ? '<span class="w-critical-flag">CRITICAL</span>' : ''}
                    </div>
                    ${n.description ? `<div class="w-node-desc">${esc(n.description)}</div>` : ''}
                    ${n.reasons?.length ? `<div class="w-node-reasons">${esc(n.reasons.join(' | '))}</div>` : ''}
                    
                    ${isExpanded ? `
                        <div class="w-node-details">
                            ${n.expectedDbPaths?.length ? `<div><strong>DB:</strong> ${esc(n.expectedDbPaths.join(', '))}</div>` : ''}
                            ${n.expectedConsumers?.length ? `<div><strong>Consumers:</strong> ${esc(n.expectedConsumers.join(', '))}</div>` : ''}
                            ${n.expectedTraceKeys?.length ? `<div><strong>Trace Keys:</strong> ${esc(n.expectedTraceKeys.join(', '))}</div>` : ''}
                            ${n.uiPath ? `<div><strong>UI:</strong> ${esc(n.uiPath)}</div>` : ''}
                            ${n.required ? `<div><strong>Required:</strong> true</div>` : ''}
                        </div>
                    ` : ''}
                    
                    ${hasKids && isExpanded ? `
                        <div class="w-children">
                            ${kids.map(k => renderNode(k, depth + 1, new Set(visited))).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
        function isDescendantOrSelf(id, target, visited = new Set()) {
            // Guard against circular parentId chains
            if (visited.has(id) || visited.size > 50) return false;
            visited.add(id);
            
            if (id === target) return true;
            const node = map.get(id);
            if (node?.parentId === target) return true;
            if (node?.parentId) return isDescendantOrSelf(node.parentId, target, visited);
            return false;
        }
        
        el.innerHTML = `
            <div class="w-panel">
                <div class="w-panel-title">🌳 Wiring Tree</div>
                <div class="w-tree-container">
                    ${roots.map(r => renderNode(r.id)).join('')}
                </div>
            </div>
        `;
        
        // Bind expanders
        $$('.w-expander[data-expand]', el).forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.expand;
                if (_expandedNodes.has(id)) {
                    _expandedNodes.delete(id);
                } else {
                    _expandedNodes.add(id);
                }
                renderTree();
            });
        });

        // Bind node selection (inspector)
        $$('.w-node-row[data-select]', el).forEach(row => {
            row.addEventListener('click', (e) => {
                // Don’t treat expander click as selection click
                if (e.target && e.target.matches('.w-expander')) return;
                selectNode(row.dataset.select);
            });
        });
    }

    // ========================================================================
    // NODE INSPECTOR (Source of Truth)
    // ========================================================================

    function selectNode(nodeId) {
        _selectedNodeId = nodeId || null;
        focusNode(nodeId);
        renderInspector();
    }

    function renderInspector() {
        const el = $('#wiringInspector');
        if (!el || !_report || !_selectedNodeId) {
            if (el) el.innerHTML = '';
            return;
        }

        if (!isV2Report(_report)) {
            el.innerHTML = `
              <div class="w-panel">
                <div class="w-panel-title">🧩 Node Inspector</div>
                <div class="w-meta-small">Inspector is available for Wiring V2 reports.</div>
              </div>
            `;
            return;
        }

        const node = _index?.map?.get(_selectedNodeId);
        const healthById = getV2FieldHealthById(_report);
        const critById = getV2CriticalById(_report);
        const warnById = getV2WarningsById(_report);

        const h = healthById.get(_selectedNodeId) || null;
        const crit = critById.get(_selectedNodeId) || null;
        const warn = warnById.get(_selectedNodeId) || null;

        const dataEntry = (_report.dataMap?.fields || []).find(x => x.id === _selectedNodeId) || null;
        const effectiveEntry = (_report.effectiveConfig?.fields || []).find(x => x.id === _selectedNodeId) || null;
        const runtimeEntry = (_report.runtimeMap?.readers || []).find(x => x.configPath === _selectedNodeId) || null;

        const valuePreview = (val) => {
            try {
                if (val == null) return 'null';
                if (typeof val === 'string') return val;
                return JSON.stringify(val, null, 2);
            } catch (e) {
                return String(val);
            }
        };

        const runtimeReaders = runtimeEntry?.readers || [];

        el.innerHTML = `
          <div class="w-panel">
            <div class="w-panel-title">🧩 Node Inspector</div>
            <div class="w-meta-row" style="margin-top:6px;">
              <span><strong>ID:</strong> ${esc(_selectedNodeId)}</span>
              <span>•</span>
              <span><strong>Type:</strong> ${esc(node?.type || 'UNKNOWN')}</span>
              <span>•</span>
              <span><strong>Status:</strong> ${statusBadge((h?.status || node?.status || 'UNKNOWN'))}</span>
            </div>

            ${node?.uiPath ? `<div style="margin-top:10px;"><strong>UI:</strong> ${esc(node.uiPath)}</div>` : ''}

            <div style="margin-top:12px;">
              <div><strong>Effective Value</strong> (${esc(effectiveEntry?.source || 'n/a')})</div>
              <pre style="white-space:pre-wrap; background:#0b0b0d; border:1px solid #2a2a2e; padding:12px; border-radius:10px; overflow:auto; max-height:220px;">${esc(valuePreview(effectiveEntry?.value))}</pre>
            </div>

            <div style="margin-top:12px;">
              <div><strong>DB</strong></div>
              <div class="w-meta-small">Collection: ${esc(dataEntry?.dbCollection || 'companiesCollection')} | Path: ${esc(dataEntry?.dbPath || 'n/a')} | Source: ${esc(dataEntry?.source || 'n/a')}</div>
              <pre style="white-space:pre-wrap; background:#0b0b0d; border:1px solid #2a2a2e; padding:12px; border-radius:10px; overflow:auto; max-height:220px;">${esc(valuePreview(dataEntry?.value))}</pre>
            </div>

            <div style="margin-top:12px;">
              <div><strong>🔌 Runtime Readers</strong> ${runtimeReaders.length === 0 ? '<span class="w-badge yellow">UI_ONLY</span>' : `<span class="w-badge green">${runtimeReaders.length} readers</span>`}</div>
              ${runtimeReaders.length === 0 ? `
                <div class="w-runtime-readers" style="border-color:#5a4a1a;">
                  <div style="text-align:center;padding:16px;color:#fbbf24;">
                    ⚠️ No runtime code reads this field<br>
                    <span style="font-size:11px;color:#888;">This configuration is saved but never used by the system</span>
                  </div>
                </div>
              ` : `
                <div class="w-runtime-readers">
                  ${runtimeReaders.map(r => `
                    <div class="w-runtime-reader">
                      <div class="w-runtime-file">${esc(r.file || 'unknown')}</div>
                      <div class="w-runtime-function">${esc(r.function || 'unknown')}()${r.line ? ` :${r.line}` : ''}</div>
                      <div class="w-runtime-desc">${esc(r.description || '')}${r.critical ? ' <span class="w-runtime-critical">CRITICAL</span>' : ''}${r.checkpoint ? ` [${esc(r.checkpoint)}]` : ''}</div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>

            ${crit ? `
              <div style="margin-top:12px;">
                <div><strong>Fix (Deterministic)</strong></div>
                <div class="w-issue-item" style="border-color:#7f1d1d;background:#1b0b0b;">
                  <div><strong>Reason:</strong> ${esc(crit.reason || '')}</div>
                  ${crit.expected ? `<div><strong>Expected:</strong> ${esc(crit.expected)}</div>` : ''}
                  ${crit.actual ? `<div><strong>Actual:</strong> ${esc(crit.actual)}</div>` : ''}
                  ${crit.fix ? `<div><strong>Fix:</strong> ${esc(crit.fix)}</div>` : ''}
                </div>
              </div>
            ` : ''}

            ${(!crit && warn) ? `
              <div style="margin-top:12px;">
                <div><strong>Warning</strong></div>
                <div class="w-issue-item" style="border-color:#7c2d12;background:#1f1308;">
                  <div><strong>Reason:</strong> ${esc(warn.reason || warn.message || '')}</div>
                  ${warn.fix ? `<div><strong>Fix:</strong> ${esc(warn.fix)}</div>` : ''}
                </div>
              </div>
            ` : ''}
          </div>
        `;
    }

    // ========================================================================
    // DIAGRAMS (Mermaid strings)
    // ========================================================================
    function renderDiagrams() {
        const el = $('#wiringDiagrams');
        if (!el || !_report) return;
        if (!isV2Report(_report) || !_report.diagrams) {
            el.innerHTML = '';
            return;
        }
        const diagrams = _report.diagrams || {};
        el.innerHTML = `
          <div class="w-panel">
            <div class="w-panel-title">🗺️ Diagrams (Mermaid)</div>
            ${Object.entries(diagrams).map(([k, v]) => `
              <details style="margin-top:10px;">
                <summary style="cursor:pointer;"><strong>${esc(k)}</strong></summary>
                <pre style="white-space:pre-wrap; background:#0b0b0d; border:1px solid #2a2a2e; padding:12px; border-radius:10px; overflow:auto; max-height:360px;">${esc(String(v || '').trim())}</pre>
                <button class="w-btn" data-copy-diagram="${esc(k)}">Copy Mermaid</button>
              </details>
            `).join('')}
          </div>
        `;
        $$('button[data-copy-diagram]', el).forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-copy-diagram');
                copyText(String(diagrams[key] || '').trim());
            });
        });
    }
    
    // ========================================================================
    // CHECKPOINTS RENDER
    // ========================================================================
    
    function renderCheckpoints() {
        const el = $('#wiringCheckpoints');
        if (!el || !_report?.checkpoints) return;
        
        el.innerHTML = `
            <div class="w-panel">
                <div class="w-panel-title">📍 Checkpoints Reference</div>
                <div class="w-checkpoints-list">
                    ${_report.checkpoints.map(cp => `
                        <div class="w-checkpoint">
                            <span class="w-cp-id">${esc(cp.id)}</span>
                            <span class="w-cp-desc">${esc(cp.description)}</span>
                            <span class="w-cp-file">${esc(cp.file)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // MAIN RENDER
    // ========================================================================
    
    function renderAll() {
        // Layout sanity check: never silently render into a 0-size container.
        const container = $('#wiringTab');
        if (container) {
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                setState('zero_size', { rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left } });
                return;
            }
        }
        
        console.log('[WiringTab] 🎨 renderAll() - Salesforce-Grade Dashboard');
        
        // === EXECUTIVE LAYER (First thing you see) ===
        renderExecutiveBanner();      // Big status banner
        renderScoreboard();           // Quick metrics tiles
        
        // === OPERATIONAL LAYER (What needs attention) ===
        renderKillSwitches();         // Kill switch status
        renderGapAnalysis();          // Registry vs DB vs Runtime gaps
        renderActionQueue();          // Prioritized fixes
        
        // === DETAIL LAYER (Deep dive) ===
        renderSpecialChecks();        // Source-of-truth checks
        renderIssues();               // Full issues list
        renderGuardrails();           // Tenant safety
        renderTree();                 // Field tree view
        renderInspector();            // Selected node details
        renderDiagrams();             // Mermaid visualizations
        renderCheckpoints();          // Code checkpoints
        
        updateFocusPill();
        
        console.log('[WiringTab] ✅ Dashboard rendered');
    }
    
    function updateFocusPill() {
        const pill = $('#wiringFocusPill');
        if (pill) {
            pill.textContent = _focusedNodeId ? `Focused: ${_focusedNodeId}` : 'Focus: none';
        }
    }
    
    function focusNode(nodeId) {
        _focusedNodeId = nodeId || null;
        
        // Auto-expand path to node
        if (_focusedNodeId && _index) {
            let current = _focusedNodeId;
            while (current) {
                _expandedNodes.add(current);
                const node = _index.map.get(current);
                current = node?.parentId;
            }
        }
        
        renderAll();
    }
    
    function setLoading(on) {
        const el = $('#wiringLoading');
        if (el) el.style.display = on ? 'block' : 'none';
    }
    
    // ========================================================================
    // API
    // ========================================================================
    
    async function loadWiringReport(companyId) {
        // Prefer Source-of-Truth V2 endpoint
        const url = `/api/admin/wiring-status/${companyId}/v2`;
        // Control-plane stores admin JWT under 'adminToken' key
        const token = localStorage.getItem('adminToken') || localStorage.getItem('auth_token') || localStorage.getItem('token');
        
        // Debug: log token presence (never log actual token)
        console.log('[WiringTab] Auth check:', {
            hasAdminToken: !!localStorage.getItem('adminToken'),
            hasAuthToken: !!localStorage.getItem('auth_token'),
            hasToken: !!localStorage.getItem('token'),
            tokenLength: token ? token.length : 0
        });
        
        if (!token) {
            throw new Error('No auth token found in localStorage (checked: adminToken, auth_token, token). Please log in again.');
        }
        
        console.log('WIRING_FETCH_START', { companyId, url });

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const text = await res.text().catch(() => '');
        _lastLoad = {
            url,
            companyId,
            status: res.status,
            ok: res.ok,
            responseText: text,
            errorMessage: null,
            at: new Date().toISOString()
        };
        
        if (!res.ok) {
            // Preserve a useful error message for the UI state panel.
            let msg = `HTTP ${res.status}`;
            try {
                const parsed = JSON.parse(text || '{}');
                msg = parsed.error || parsed.message || msg;
            } catch (_) {
                // keep msg
            }
            _lastLoad.errorMessage = msg;
            throw new Error(msg);
        }
        
        try {
            const parsed = JSON.parse(text || '{}');
            const hasUiMap = !!parsed?.uiMap;
            const nodeCount = Array.isArray(parsed?.uiMap?.fields) ? parsed.uiMap.fields.length : (Array.isArray(parsed?.nodes) ? parsed.nodes.length : 0);
            console.log('WIRING_FETCH_OK', { status: res.status, bytes: text.length, hasUiMap, nodeCount });
            return parsed;
        } catch (e) {
            _lastLoad.errorMessage = `Invalid JSON from wiring endpoint: ${e.message}`;
            throw new Error(_lastLoad.errorMessage);
        }
    }
    
    async function clearCache(companyId) {
        console.log('[WiringTab] 🗑️ CHECKPOINT: clearCache called', { companyId });
        
        const url = `/api/admin/wiring-status/${companyId}/clear-cache`;
        console.log('[WiringTab] CHECKPOINT: clearCache URL:', url);
        
        // Control-plane stores admin JWT under 'adminToken' key
        const token = localStorage.getItem('adminToken') || localStorage.getItem('auth_token') || localStorage.getItem('token');
        console.log('[WiringTab] CHECKPOINT: clearCache auth token present:', !!token);
        
        if (!token) {
            const error = new Error('No auth token found for clearCache');
            console.error('[WiringTab] ❌ CHECKPOINT FAILED:', error.message);
            throw error;
        }
        
        console.log('[WiringTab] CHECKPOINT: Sending POST to clear-cache...');
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[WiringTab] CHECKPOINT: clearCache response status:', res.status);
        
        const text = await res.text();
        console.log('[WiringTab] CHECKPOINT: clearCache raw response:', text.substring(0, 500));
        
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('[WiringTab] ❌ CHECKPOINT: Failed to parse clearCache response as JSON');
            throw new Error(`Clear cache failed: Invalid JSON response (status ${res.status})`);
        }
        
        if (!res.ok) {
            console.error('[WiringTab] ❌ CHECKPOINT: clearCache HTTP error', { status: res.status, data });
            throw new Error(data.error || `Clear cache failed with status ${res.status}`);
        }
        
        console.log('[WiringTab] ✅ CHECKPOINT: clearCache SUCCESS', data);
        return data;
    }
    
    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    async function refresh(companyId) {
        if (companyId) _companyId = companyId;
        if (!_companyId) {
            setState('needs_company', { companyId: null, url: null, status: null });
            toast('Company ID missing', true);
            return;
        }
        
        setLoading(true);
        setState('loading', { companyId: _companyId });
        try {
            _report = await loadWiringReport(_companyId);
            _index = buildIndex(_report);
            
            // V2 reports use uiMap.fields; V1 uses nodes array
            const nodeCount = isV2Report(_report)
                ? ((_report?.uiMap?.tabs?.length || 0) + (_report?.uiMap?.sections?.length || 0) + (_report?.uiMap?.fields?.length || 0))
                : (Array.isArray(_report?.nodes) ? _report.nodes.length : 0);
            
            console.log('[WiringTab] Loaded report', { 
                companyId: _companyId, 
                nodeCount,
                isV2: isV2Report(_report),
                hasTabs: !!_report?.uiMap?.tabs?.length,
                hasSections: !!_report?.uiMap?.sections?.length,
                hasFields: !!_report?.uiMap?.fields?.length,
                indexMapSize: _index?.map?.size || 0
            });
            
            if (!nodeCount && !(_index?.map?.size > 0)) {
                setState('empty', { companyId: _companyId, url: _lastLoad.url, status: _lastLoad.status, payload: _report });
            } else {
                setState('success');
                renderAll();
            }
            toast('Wiring report loaded');
        } catch (e) {
            console.error('[WiringTab] Load error:', e);
            setState('error', {
                companyId: _companyId,
                url: _lastLoad.url,
                status: _lastLoad.status,
                responseText: _lastLoad.responseText,
                errorMessage: e.message,
                stack: e.stack
            });
            toast(e.message || 'Wiring failed', true);
        } finally {
            setLoading(false);
        }
    }
    
    async function initWiringTab({ companyId, tradeKey = 'universal' }) {
        _companyId = companyId || _companyId;
        console.log('[WiringTab] Initializing...', { companyId: _companyId });

        // Prevent duplicate listeners when init is called multiple times (tab switch / company switch).
        const bindOnce = (el, event, handler) => {
            if (!el) return;
            const key = `wiringBound_${event}`;
            if (el.dataset && el.dataset[key] === '1') return;
            el.addEventListener(event, handler);
            if (el.dataset) el.dataset[key] = '1';
        };
        
        // Reload button
        const reloadBtn = $('#wiringReload');
        console.log('[WiringTab] CHECKPOINT: Reload button found:', !!reloadBtn);
        bindOnce(reloadBtn, 'click', () => {
            console.log('[WiringTab] 🔄 BUTTON CLICKED: Reload', { companyId: _companyId });
            refresh(_companyId);
        });
        
        // Clear focus button
        const clearFocusBtn = $('#wiringClearFocus');
        console.log('[WiringTab] CHECKPOINT: Clear Focus button found:', !!clearFocusBtn);
        bindOnce(clearFocusBtn, 'click', () => {
            console.log('[WiringTab] 🎯 BUTTON CLICKED: Clear Focus');
            focusNode(null);
            toast('Focus cleared');
        });
        
        // Expand all button
        const expandAllBtn = $('#wiringExpandAll');
        console.log('[WiringTab] CHECKPOINT: Expand All button found:', !!expandAllBtn);
        bindOnce(expandAllBtn, 'click', () => {
            console.log('[WiringTab] 📂 BUTTON CLICKED: Expand All');
            // Works for both V1 and V2 (V2 has no `report.nodes`)
            let count = 0;
            if (_index?.map) {
                Array.from(_index.map.values()).forEach(n => {
                    _expandedNodes.add(n.id);
                    count++;
                });
            } else if (_report?.nodes) {
                _report.nodes.forEach(n => {
                    _expandedNodes.add(n.id);
                    count++;
                });
            }
            console.log('[WiringTab] ✅ Expanded nodes:', count);
            renderTree();
            toast(`Expanded ${count} nodes`);
        });
        
        // Collapse all button
        const collapseAllBtn = $('#wiringCollapseAll');
        console.log('[WiringTab] CHECKPOINT: Collapse All button found:', !!collapseAllBtn);
        bindOnce(collapseAllBtn, 'click', () => {
            console.log('[WiringTab] 📁 BUTTON CLICKED: Collapse All');
            const previousCount = _expandedNodes.size;
            _expandedNodes.clear();
            console.log('[WiringTab] ✅ Collapsed nodes:', previousCount);
            renderTree();
            toast(`Collapsed ${previousCount} nodes`);
        });
        
        // Search input
        const searchInput = $('#wiringSearch');
        console.log('[WiringTab] CHECKPOINT: Search input found:', !!searchInput);
        bindOnce(searchInput, 'input', (e) => {
            _searchTerm = e.target.value || '';
            console.log('[WiringTab] 🔍 SEARCH: term =', _searchTerm);
            renderTree();
        });
        
        // Copy JSON button
        const copyJsonBtn = $('#wiringCopyJson');
        console.log('[WiringTab] CHECKPOINT: Copy JSON button found:', !!copyJsonBtn);
        bindOnce(copyJsonBtn, 'click', () => {
            console.log('[WiringTab] 📋 BUTTON CLICKED: Copy JSON');
            if (_report) {
                const json = JSON.stringify(_report, null, 2);
                console.log('[WiringTab] ✅ JSON length:', json.length);
                copyText(json);
            } else {
                console.warn('[WiringTab] ⚠️ No report to copy');
                toast('No report loaded', true);
            }
        });
        
        // Copy Markdown button
        const copyMdBtn = $('#wiringCopyMd');
        console.log('[WiringTab] CHECKPOINT: Copy MD button found:', !!copyMdBtn);
        bindOnce(copyMdBtn, 'click', () => {
            console.log('[WiringTab] 📝 BUTTON CLICKED: Copy Markdown');
            if (_report) {
                const md = toMarkdown(_report);
                console.log('[WiringTab] ✅ Markdown length:', md.length);
                copyText(md);
            } else {
                console.warn('[WiringTab] ⚠️ No report to copy');
                toast('No report loaded', true);
            }
        });

        // Paste JSON + Validate panel
        const validateToggleBtn = $('#wiringPasteValidate');
        const validatePanel = $('#wiringValidatePanel');
        const validateCloseBtn = $('#wiringValidateClose');
        const validateRunBtn = $('#wiringValidateRun');
        const validateInput = $('#wiringValidateInput');
        const validateOutput = $('#wiringValidateOutput');

        const showValidatePanel = (on) => {
            if (!validatePanel) return;
            validatePanel.style.display = on ? 'block' : 'none';
        };

        console.log('[WiringTab] CHECKPOINT: Paste Validate button found:', !!validateToggleBtn);
        console.log('[WiringTab] CHECKPOINT: Validate Close button found:', !!validateCloseBtn);
        console.log('[WiringTab] CHECKPOINT: Validate Run button found:', !!validateRunBtn);
        
        if (validateToggleBtn) {
            bindOnce(validateToggleBtn, 'click', () => {
                console.log('[WiringTab] 📋 BUTTON CLICKED: Paste JSON + Validate (toggle)');
                const isOpen = validatePanel && validatePanel.style.display !== 'none';
                showValidatePanel(!isOpen);
                if (validateInput && !validateInput.value && _report) {
                    validateInput.value = JSON.stringify(_report, null, 2);
                    console.log('[WiringTab] ✅ Prefilled validate input with current report');
                }
            });
        }
        if (validateCloseBtn) {
            bindOnce(validateCloseBtn, 'click', () => {
                console.log('[WiringTab] ❌ BUTTON CLICKED: Close Validate Panel');
                showValidatePanel(false);
            });
        }
        if (validateRunBtn) {
            bindOnce(validateRunBtn, 'click', async () => {
                console.log('[WiringTab] ✅ BUTTON CLICKED: Validate JSON');
                if (!validateInput) {
                    console.error('[WiringTab] ❌ validateInput element not found');
                    return;
                }
                const raw = validateInput.value || '';
                console.log('[WiringTab] CHECKPOINT: Input JSON length:', raw.length);
                
                if (!raw.trim()) {
                    console.warn('[WiringTab] ⚠️ No JSON to validate');
                    toast('Paste JSON first', true);
                    return;
                }
                if (validateOutput) validateOutput.innerHTML = `<div class="w-meta-small">Validating…</div>`;

                try {
                    const token = localStorage.getItem('adminToken') || localStorage.getItem('auth_token') || localStorage.getItem('token');
                    console.log('[WiringTab] CHECKPOINT: Auth token present:', !!token);
                    if (!token) throw new Error('No auth token found (adminToken). Please log in again.');

                    console.log('[WiringTab] CHECKPOINT: Sending POST to /api/admin/wiring-status/validate...');
                    const res = await fetch('/api/admin/wiring-status/validate', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ json: raw })
                    });
                    console.log('[WiringTab] CHECKPOINT: Validate response status:', res.status);
                    
                    const text = await res.text();
                    console.log('[WiringTab] CHECKPOINT: Validate response length:', text.length);
                    
                    let parsed;
                    try { parsed = JSON.parse(text); } catch { parsed = { error: 'Invalid JSON response', raw: text }; }

                    if (!res.ok) {
                        console.error('[WiringTab] ❌ Validate API error:', parsed);
                        throw new Error(parsed?.error || parsed?.message || `HTTP ${res.status}`);
                    }

                    const errs = parsed.errors || [];
                    const warns = parsed.warnings || [];
                    const ok = parsed.valid === true;
                    
                    console.log('[WiringTab] ✅ Validation result:', { valid: ok, errors: errs.length, warnings: warns.length });

                    if (validateOutput) {
                        validateOutput.innerHTML = `
                          <div class="w-issue-item" style="border-color:${ok ? '#14532d' : '#7f1d1d'};background:${ok ? '#07130b' : '#1b0b0b'};">
                            <div><strong>Valid:</strong> ${esc(String(ok))}</div>
                            <div><strong>Errors:</strong> ${esc(String(errs.length))}</div>
                            <div><strong>Warnings:</strong> ${esc(String(warns.length))}</div>
                          </div>
                          ${errs.length ? `<details style="margin-top:10px;" open><summary style="cursor:pointer;">Errors</summary><pre style="white-space:pre-wrap; background:#0b0b0d; border:1px solid #2a2a2e; padding:12px; border-radius:10px; overflow:auto; max-height:320px;">${esc(JSON.stringify(errs, null, 2))}</pre></details>` : ''}
                          ${warns.length ? `<details style="margin-top:10px;"><summary style="cursor:pointer;">Warnings</summary><pre style="white-space:pre-wrap; background:#0b0b0d; border:1px solid #2a2a2e; padding:12px; border-radius:10px; overflow:auto; max-height:320px;">${esc(JSON.stringify(warns, null, 2))}</pre></details>` : ''}
                        `;
                    }
                    toast(ok ? 'Validation passed' : 'Validation failed', !ok);
                } catch (e) {
                    console.error('[WiringTab] ❌ Validate FAILED:', e.message, e);
                    if (validateOutput) validateOutput.innerHTML = `<div class="w-issue-item" style="border-color:#7f1d1d;background:#1b0b0b;"><div><strong>Error:</strong> ${esc(e.message || String(e))}</div></div>`;
                    toast(e.message || 'Validate failed', true);
                }
            });
        }
        
        // Download JSON button
        const downloadBtn = $('#wiringDownloadJson');
        console.log('[WiringTab] CHECKPOINT: Download JSON button found:', !!downloadBtn);
        bindOnce(downloadBtn, 'click', () => {
            console.log('[WiringTab] ⬇️ BUTTON CLICKED: Download JSON');
            if (_report) {
                const cid = _report?.scope?.companyId || _report?.companyId || 'unknown';
                const filename = `wiring-${cid}-${new Date().toISOString().slice(0, 10)}.json`;
                console.log('[WiringTab] ✅ Downloading file:', filename);
                downloadJson(filename, _report);
                toast(`Downloaded: ${filename}`);
            } else {
                console.warn('[WiringTab] ⚠️ No report to download');
                toast('No report loaded', true);
            }
        });
        
        // Clear cache button
        const clearCacheBtn = $('#wiringClearCache');
        console.log('[WiringTab] CHECKPOINT: Clear Cache button found:', !!clearCacheBtn);
        bindOnce(clearCacheBtn, 'click', async () => {
            console.log('[WiringTab] 🗑️ BUTTON CLICKED: Clear Cache', { companyId: _companyId });
            if (!_companyId) {
                console.error('[WiringTab] ❌ No company ID for cache clear');
                toast('No company ID', true);
                return;
            }
            try {
                console.log('[WiringTab] CHECKPOINT: Calling clearCache API...');
                const result = await clearCache(_companyId);
                console.log('[WiringTab] ✅ Cache cleared:', result);
                toast(result.message || 'Cache cleared');
                console.log('[WiringTab] CHECKPOINT: Refreshing after cache clear...');
                await refresh(_companyId);
            } catch (e) {
                console.error('[WiringTab] ❌ Clear cache FAILED:', e.message, e);
                toast(e.message, true);
            }
        });
        
        // Initial load (or rebind to new companyId)
        if (!_initialized) {
            _initialized = true;
            if (!_companyId) {
                setState('needs_company', { companyId: null });
            }
        }
        await refresh(_companyId);
    }
    
    // ========================================================================
    // EXPORT
    // ========================================================================
    
    window.ClientViaWiringTab = {
        initWiringTab,
        refresh,
        focusNode,
        clearCache
    };
    
    console.log('[WiringTab] Module loaded');
    
})();

