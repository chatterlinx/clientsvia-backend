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
    let _focusedNodeId = null;
    let _viewMode = 'tree'; // tree | diagram
    let _searchTerm = '';
    let _expandedNodes = new Set();
    
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
    
    // ========================================================================
    // REPORT TO MARKDOWN
    // ========================================================================
    
    function toMarkdown(r) {
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
        const map = new Map();
        (report.nodes || []).forEach(n => map.set(n.id, n));
        
        const children = new Map();
        (report.nodes || []).forEach(n => {
            if (!n.parentId) return;
            if (!children.has(n.parentId)) children.set(n.parentId, []);
            children.get(n.parentId).push(n.id);
        });
        
        return { map, children };
    }
    
    // ========================================================================
    // SCOREBOARD RENDER
    // ========================================================================
    
    function renderScoreboard() {
        const el = $('#wiringScoreboard');
        if (!el || !_report) return;
        
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
        
        const sc = _report.specialChecks;
        
        el.innerHTML = `
            <div class="w-panel">
                <div class="w-panel-title">🔍 Critical Checks</div>
                <div class="w-checks-grid">
                    ${renderCheckCard('Template References', sc.templateReferences)}
                    ${renderCheckCard('Scenario Pool', sc.scenarioPool)}
                    ${renderCheckCard('Redis Cache', sc.redisCache)}
                    ${renderCheckCard('Booking Contract', sc.bookingContract)}
                    ${renderCheckCard('Dynamic Flows', sc.dynamicFlows)}
                </div>
            </div>
        `;
    }
    
    function renderCheckCard(title, check) {
        if (!check) return '';
        
        const health = check.health || 'GRAY';
        const status = check.status || 'UNKNOWN';
        
        let details = '';
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
        const roots = (_report.nodes || []).filter(n => n.type === 'TAB');
        
        function nodeMatches(n) {
            if (!_searchTerm) return true;
            const s = _searchTerm.toLowerCase();
            return (n.label || '').toLowerCase().includes(s) || (n.id || '').toLowerCase().includes(s);
        }
        
        function subtreeMatches(id) {
            const n = map.get(id);
            if (n && nodeMatches(n)) return true;
            const kids = children.get(id) || [];
            return kids.some(k => subtreeMatches(k));
        }
        
        function renderNode(id, depth = 0) {
            const n = map.get(id);
            if (!n) return '';
            
            // Focus filter
            if (_focusedNodeId && !isDescendantOrSelf(id, _focusedNodeId)) return '';
            
            // Search filter
            if (_searchTerm && !subtreeMatches(id)) return '';
            
            const kids = children.get(id) || [];
            const hasKids = kids.length > 0;
            const isExpanded = _expandedNodes.has(id);
            
            return `
                <div class="w-node" data-node="${esc(id)}" style="margin-left:${depth * 16}px">
                    <div class="w-node-row">
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
                        </div>
                    ` : ''}
                    
                    ${hasKids && isExpanded ? `
                        <div class="w-children">
                            ${kids.map(k => renderNode(k, depth + 1)).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
        function isDescendantOrSelf(id, target) {
            if (id === target) return true;
            const node = map.get(id);
            if (node?.parentId === target) return true;
            if (node?.parentId) return isDescendantOrSelf(node.parentId, target);
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
        renderScoreboard();
        renderSpecialChecks();
        renderIssues();
        renderGuardrails();
        renderTree();
        renderCheckpoints();
        updateFocusPill();
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
        const url = `/api/admin/wiring-status/${companyId}?includeGuardrails=1&includeInfrastructure=1`;
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        
        return res.json();
    }
    
    async function clearCache(companyId) {
        const url = `/api/admin/wiring-status/${companyId}/clear-cache`;
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        return res.json();
    }
    
    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    async function refresh(companyId) {
        setLoading(true);
        try {
            _report = await loadWiringReport(companyId);
            _index = buildIndex(_report);
            renderAll();
            toast('Wiring report loaded');
        } catch (e) {
            console.error('[WiringTab] Load error:', e);
            toast(e.message, true);
        } finally {
            setLoading(false);
        }
    }
    
    async function initWiringTab({ companyId, tradeKey = 'universal' }) {
        console.log('[WiringTab] Initializing...', { companyId });
        
        // Reload button
        const reloadBtn = $('#wiringReload');
        if (reloadBtn) {
            reloadBtn.addEventListener('click', () => refresh(companyId));
        }
        
        // Clear focus button
        const clearFocusBtn = $('#wiringClearFocus');
        if (clearFocusBtn) {
            clearFocusBtn.addEventListener('click', () => focusNode(null));
        }
        
        // Expand all button
        const expandAllBtn = $('#wiringExpandAll');
        if (expandAllBtn) {
            expandAllBtn.addEventListener('click', () => {
                if (_report?.nodes) {
                    _report.nodes.forEach(n => _expandedNodes.add(n.id));
                }
                renderTree();
            });
        }
        
        // Collapse all button
        const collapseAllBtn = $('#wiringCollapseAll');
        if (collapseAllBtn) {
            collapseAllBtn.addEventListener('click', () => {
                _expandedNodes.clear();
                renderTree();
            });
        }
        
        // Search input
        const searchInput = $('#wiringSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                _searchTerm = e.target.value || '';
                renderTree();
            });
        }
        
        // Copy JSON button
        const copyJsonBtn = $('#wiringCopyJson');
        if (copyJsonBtn) {
            copyJsonBtn.addEventListener('click', () => {
                if (_report) {
                    copyText(JSON.stringify(_report, null, 2));
                }
            });
        }
        
        // Copy Markdown button
        const copyMdBtn = $('#wiringCopyMd');
        if (copyMdBtn) {
            copyMdBtn.addEventListener('click', () => {
                if (_report) {
                    copyText(toMarkdown(_report));
                }
            });
        }
        
        // Download JSON button
        const downloadBtn = $('#wiringDownloadJson');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                if (_report) {
                    const filename = `wiring-${_report.companyId}-${new Date().toISOString().slice(0, 10)}.json`;
                    downloadJson(filename, _report);
                }
            });
        }
        
        // Clear cache button
        const clearCacheBtn = $('#wiringClearCache');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', async () => {
                try {
                    const result = await clearCache(companyId);
                    toast(result.message || 'Cache cleared');
                    // Refresh after clearing
                    await refresh(companyId);
                } catch (e) {
                    toast(e.message, true);
                }
            });
        }
        
        // Initial load
        await refresh(companyId);
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

