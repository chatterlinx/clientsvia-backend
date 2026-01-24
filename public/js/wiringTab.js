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
    }
    
    /**
     * V56: Show safety check details modal
     */
    function showCheckDetailsModal(info) {
        // Remove existing modal
        const existing = document.getElementById('check-details-modal');
        if (existing) existing.remove();
        
        const passed = info.passed;
        const statusColor = passed ? '#22c55e' : '#ef4444';
        const statusIcon = passed ? '✅' : '❌';
        const statusText = passed ? 'PASSED' : 'FAILED';
        
        const modal = document.createElement('div');
        modal.id = 'check-details-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        modal.innerHTML = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; max-width: 550px; width: 90%;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="margin: 0; color: #fff; font-size: 16px; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 24px;">${statusIcon}</span>
                        ${esc(info.id)}
                    </h3>
                    <button id="close-check-modal" style="background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 20px;">✕</button>
                </div>
                
                <!-- Score Badge -->
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                    <div style="font-size: 32px; font-weight: 800; color: ${statusColor};">${passed ? '100%' : '0%'}</div>
                    <div style="padding: 6px 12px; background: ${passed ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${statusColor}; border-radius: 6px; font-weight: 700; font-size: 12px;">
                        ${statusText}
                    </div>
                </div>
                
                <!-- What It Checks -->
                <div style="margin-bottom: 16px;">
                    <div style="font-size: 11px; color: #9ca3af; text-transform: uppercase; margin-bottom: 6px; font-weight: 600;">What it checks</div>
                    <div style="color: #e0e0e0; font-size: 14px; line-height: 1.5;">${esc(info.desc)}</div>
                </div>
                
                <!-- Why It Matters -->
                <div style="margin-bottom: 16px;">
                    <div style="font-size: 11px; color: #9ca3af; text-transform: uppercase; margin-bottom: 6px; font-weight: 600;">Why it matters</div>
                    <div style="color: #e0e0e0; font-size: 14px; line-height: 1.5;">${esc(info.why)}</div>
                </div>
                
                <!-- Current Status / Details -->
                <div style="margin-bottom: 16px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 8px; border-left: 3px solid ${statusColor};">
                    <div style="font-size: 11px; color: #9ca3af; text-transform: uppercase; margin-bottom: 6px; font-weight: 600;">Details</div>
                    <div style="color: #c9d1d9; font-size: 13px; font-family: monospace;">${esc(info.details || 'No additional details')}</div>
                </div>
                
                ${!passed ? `
                <!-- How to Fix -->
                <div style="margin-bottom: 16px; padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.3);">
                    <div style="font-size: 11px; color: #f87171; text-transform: uppercase; margin-bottom: 6px; font-weight: 600;">🔧 How to fix</div>
                    <div style="color: #fca5a5; font-size: 13px; line-height: 1.5;">${esc(info.fix)}</div>
                </div>
                ` : `
                <!-- All Good -->
                <div style="padding: 12px; background: rgba(34, 197, 94, 0.1); border-radius: 8px; border: 1px solid rgba(34, 197, 94, 0.3); text-align: center;">
                    <span style="color: #4ade80; font-size: 13px; font-weight: 600;">✓ This check is passing - no action needed</span>
                </div>
                `}
                
                <div style="margin-top: 20px; display: flex; justify-content: flex-end;">
                    <button id="close-check-btn" style="padding: 8px 20px; background: #238636; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-size: 13px; font-weight: 600;">Got it</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close handlers
        modal.querySelector('#close-check-modal').onclick = () => modal.remove();
        modal.querySelector('#close-check-btn').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    }
    
    /**
     * Show compliance check results in a modal
     */
    function showComplianceModal(result) {
        // Remove existing modal if any
        const existing = document.getElementById('compliance-modal');
        if (existing) existing.remove();
        
        const score = result.summary?.complianceScore || 0;
        const status = result.summary?.status || 'UNKNOWN';
        const violations = result.violations || [];
        const files = result.files || [];
        
        // Color based on score
        const scoreColor = score === 100 ? '#22c55e' : score >= 80 ? '#f59e0b' : '#ef4444';
        const statusEmoji = score === 100 ? '✅' : '⚠️';
        
        const violationsHtml = violations.length > 0 ? `
            <div style="margin-top: 16px;">
                <h4 style="color: #f87171; margin: 0 0 8px 0;">❌ Violations Found (${violations.length})</h4>
                <div style="max-height: 300px; overflow-y: auto; background: #0d1117; border-radius: 8px; padding: 12px;">
                    ${violations.map(v => `
                        <div style="margin-bottom: 12px; padding: 8px; background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; border-radius: 4px;">
                            <div style="font-weight: 600; color: #f87171;">${esc(v.file)}:${v.line}</div>
                            <div style="font-size: 12px; color: #9ca3af; margin-top: 4px;">
                                <strong>Rule:</strong> ${esc(v.ruleId)} | <strong>Severity:</strong> ${esc(v.severity)}
                            </div>
                            <div style="font-size: 12px; color: #fff; margin-top: 4px;">
                                <strong>Found:</strong> <code style="background: #21262d; padding: 2px 6px; border-radius: 4px;">${esc(v.matched)}</code>
                            </div>
                            <div style="font-size: 11px; color: #58a6ff; margin-top: 4px;">
                                → Should come from: <code>${esc(v.shouldComeFrom)}</code>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : '';
        
        const filesHtml = `
            <div style="margin-top: 16px;">
                <h4 style="color: #9ca3af; margin: 0 0 8px 0;">📁 Files Scanned (${files.filter(f => f.status !== 'NOT_FOUND').length})</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${files.map(f => {
                        if (f.status === 'NOT_FOUND') return '';
                        const color = f.status === 'COMPLIANT' ? '#22c55e' : '#ef4444';
                        const icon = f.status === 'COMPLIANT' ? '✓' : '✗';
                        return `<span style="font-size: 11px; padding: 4px 8px; background: rgba(${color === '#22c55e' ? '34, 197, 94' : '239, 68, 68'}, 0.2); color: ${color}; border-radius: 4px;">${icon} ${f.file.split('/').pop()}</span>`;
                    }).join('')}
                </div>
            </div>
        `;
        
        const modal = document.createElement('div');
        modal.id = 'compliance-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        modal.innerHTML = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="margin: 0; color: #fff; font-size: 18px;">🔍 Code Compliance Report</h3>
                    <button id="close-compliance-modal" style="background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 20px;">✕</button>
                </div>
                
                <div style="display: flex; gap: 20px; margin-bottom: 16px;">
                    <div style="flex: 1; background: #0d1117; border-radius: 8px; padding: 16px; text-align: center;">
                        <div style="font-size: 36px; font-weight: 700; color: ${scoreColor};">${score}%</div>
                        <div style="font-size: 12px; color: #9ca3af;">Compliance Score</div>
                    </div>
                    <div style="flex: 1; background: #0d1117; border-radius: 8px; padding: 16px; text-align: center;">
                        <div style="font-size: 24px;">${statusEmoji}</div>
                        <div style="font-size: 14px; font-weight: 600; color: ${scoreColor};">${status}</div>
                    </div>
                </div>
                
                <div style="padding: 12px; background: ${score === 100 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; border-radius: 8px; border-left: 3px solid ${scoreColor};">
                    <div style="color: #fff; font-size: 13px;">
                        ${score === 100 
                            ? '<strong>All clear!</strong> No hardcoded values found. All config values are properly wired to the database.'
                            : '<strong>Action Required:</strong> Found hardcoded values that should be reading from config. Fix these to ensure consistent behavior across tenants.'}
                    </div>
                </div>
                
                ${violationsHtml}
                ${filesHtml}
                
                <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #30363d; display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="copy-compliance-json" style="padding: 8px 16px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; font-size: 12px;">📋 Copy JSON</button>
                    <button id="close-compliance-btn" style="padding: 8px 16px; background: #238636; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px;">Done</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close handlers
        modal.querySelector('#close-compliance-modal').onclick = () => modal.remove();
        modal.querySelector('#close-compliance-btn').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        
        // Copy JSON
        modal.querySelector('#copy-compliance-json').onclick = () => {
            navigator.clipboard.writeText(JSON.stringify(result, null, 2));
            toast('Compliance report copied to clipboard');
        };
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
        const critCount = _report.health?.criticalIssues?.length || 0;
        const fieldCount = _report.health?.fields?.length || 0;
        const wiredCount = _report.health?.byStatus?.WIRED || 0;
        const uiOnlyCount = _report.health?.byStatus?.UI_ONLY || 0;
        const misconfiguredCount = _report.health?.byStatus?.MISCONFIGURED || 0;
        
        // NEW: Required vs Optional coverage
        const reqCoverage = _report.health?.requiredCoverage || { total: 0, wired: 0, percent: 0, missingFields: [] };
        const optCoverage = _report.health?.optionalCoverage || { total: 0, configured: 0, percent: 0 };
        const goldenBlueprint = _report.health?.goldenBlueprint || { ready: false, score: 0 };
        
        const statusClass = health === 'GREEN' ? 'green' : health === 'YELLOW' ? 'yellow' : 'red';
        const statusText = health === 'GREEN' ? '✅ ALL SYSTEMS OPERATIONAL' : 
                          health === 'YELLOW' ? '⚠️ ISSUES DETECTED' : 
                          '🔴 CRITICAL ISSUES';
        
        // Golden Blueprint status
        const goldenClass = goldenBlueprint.ready ? 'golden-ready' : 'golden-pending';
        const goldenText = goldenBlueprint.ready ? '🏆 GOLDEN BLUEPRINT READY' : '📋 BLUEPRINT INCOMPLETE';
        
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
            
            <!-- GOLDEN BLUEPRINT STATUS - The answer to "is this actually good?" -->
            <div class="w-golden-blueprint ${goldenClass}">
              <div class="w-golden-header">
                <span class="w-golden-badge">${goldenText}</span>
                <span class="w-golden-score">${goldenBlueprint.score}%</span>
              </div>
              <div class="w-golden-bars">
                <div class="w-golden-bar">
                  <span class="w-golden-bar-label">Required (${reqCoverage.wired}/${reqCoverage.total})</span>
                  <div class="w-golden-bar-track">
                    <div class="w-golden-bar-fill ${reqCoverage.percent === 100 ? 'complete' : 'incomplete'}" style="width: ${reqCoverage.percent}%"></div>
                  </div>
                  <span class="w-golden-bar-percent">${reqCoverage.percent}%</span>
                </div>
                <div class="w-golden-bar">
                  <span class="w-golden-bar-label">Optional (${optCoverage.configured}/${optCoverage.total})</span>
                  <div class="w-golden-bar-track">
                    <div class="w-golden-bar-fill optional" style="width: ${optCoverage.percent}%"></div>
                  </div>
                  <span class="w-golden-bar-percent">${optCoverage.percent}%</span>
                </div>
              </div>
              ${reqCoverage.missingFields?.length > 0 ? `
                <div class="w-golden-missing">
                  <span class="w-golden-missing-label">Missing required:</span>
                  ${reqCoverage.missingFields.slice(0, 3).map(f => `<span class="w-golden-missing-field">${esc(f.label || f.id)}</span>`).join('')}
                  ${reqCoverage.missingFields.length > 3 ? `<span class="w-golden-missing-more">+${reqCoverage.missingFields.length - 3} more</span>` : ''}
                </div>
              ` : ''}
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
                    ${renderCheckCard('🔄 Scenario Alignment', sc.scenarioAlignment)}
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
        
        // Scenario alignment (Gap Fill + Audit + Agent harmony)
        if (check.metrics) {
            const m = check.metrics;
            details += `<div>Agent sees: <strong class="text-green">${m.agentCanSee}</strong> scenarios</div>`;
            details += `<div>Gap Fill: <strong class="${m.gapFillScope === m.agentCanSee ? 'text-green' : 'text-yellow'}">${m.gapFillScope}</strong> | Audit: <strong class="${m.auditScope === m.agentCanSee ? 'text-green' : 'text-yellow'}">${m.auditScope}</strong></div>`;
            if (m.disabledByCompany > 0) {
                details += `<div>Disabled by company: <strong class="text-yellow">${m.disabledByCompany}</strong></div>`;
            }
            if (m.alignmentPercentage !== undefined) {
                details += `<div>Alignment: <strong class="${m.alignmentPercentage >= 100 ? 'text-green' : m.alignmentPercentage >= 80 ? 'text-yellow' : 'text-red'}">${m.alignmentPercentage}%</strong></div>`;
            }
        }
        if (check.isAligned !== undefined) {
            details += `<div>Harmony: <strong class="${check.isAligned ? 'text-green' : 'text-yellow'}">${check.isAligned ? '✅ All systems aligned' : '⚠️ Systems misaligned'}</strong></div>`;
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

        // V2: show comprehensive Scope Proof + tenant safety checks
        if (isV2Report(_report)) {
            const t = _report.noTenantBleedProof || {};
            const checks = t.checks || [];
            const violations = t.violations || [];
            const scopeProof = t.scopeProof || {};
            const summary = t.summary || {};
            
            // Separate critical vs warning violations
            const criticalViolations = violations.filter(v => v.severity === 'CRITICAL');
            const warnings = violations.filter(v => v.severity === 'WARNING');
            
            el.innerHTML = `
              <div class="w-panel">
                <div class="w-panel-title">🛡️ Multi-Tenant Scope Proof</div>
                <div class="w-meta-small">Strict company scoping, global templates only, no tenant bleed.</div>

                <!-- SCOPE PROOF BOX -->
                <div class="w-scope-proof ${t.passed ? 'safe' : 'unsafe'}">
                  <div class="w-scope-proof-header">
                    <div class="w-scope-proof-verdict ${summary.verdict === 'SAFE' ? 'safe' : 'unsafe'}">
                      ${summary.verdict === 'SAFE' ? '✅ SCOPE SAFE' : '🚨 SCOPE UNSAFE'}
                    </div>
                    <div class="w-scope-proof-stats">
                      <span>${summary.passed || 0}/${summary.totalChecks || 0} checks passed</span>
                      ${summary.criticalViolations > 0 ? `<span class="text-red">${summary.criticalViolations} critical</span>` : ''}
                      ${summary.warnings > 0 ? `<span class="text-yellow">${summary.warnings} warnings</span>` : ''}
                    </div>
                  </div>
                  
                  <div class="w-scope-proof-grid">
                    <div class="w-scope-proof-item w-scope-clickable" data-nav-url="/control-plane-v2.html?companyId=${esc(scopeProof.companyId)}" title="Open Control Plane (Truth UI)">
                      <div class="w-scope-proof-label">Company ID <i class="fas fa-external-link-alt" style="font-size: 9px; opacity: 0.5;"></i></div>
                      <div class="w-scope-proof-value">${esc(scopeProof.companyId || 'N/A')}</div>
                    </div>
                    <div class="w-scope-proof-item w-scope-clickable" data-nav-tab="data-config" data-nav-subtab="onboarding" title="Change Trade Key in Onboarding">
                      <div class="w-scope-proof-label">Trade Key <i class="fas fa-edit" style="font-size: 9px; opacity: 0.5;"></i></div>
                      <div class="w-scope-proof-value">${esc(scopeProof.tradeKey || 'universal')}</div>
                    </div>
                    <div class="w-scope-proof-item w-scope-proof-item-wide w-scope-clickable" data-nav-tab="data-config" data-nav-subtab="templates" title="Manage Templates">
                      <div class="w-scope-proof-label">Templates Used (${(scopeProof.templatesUsed || scopeProof.templateIdsUsed || []).length}) <i class="fas fa-edit" style="font-size: 9px; opacity: 0.5;"></i></div>
                      <div class="w-scope-proof-value">
                        ${(scopeProof.templatesUsed || []).length > 0 
                          ? scopeProof.templatesUsed.map(t => `
                              <div class="w-template-detail">
                                <span class="w-template-name">${esc(t.name)}</span>
                                <code class="w-template-id">${esc(t.id?.substring(0, 8) || 'N/A')}...</code>
                              </div>
                            `).join('')
                          : `<span class="text-red">❌ No templates linked</span>`
                        }
                      </div>
                    </div>
                    <div class="w-scope-proof-item w-scope-clickable" data-nav-tab="data-config" data-nav-subtab="scenarios" title="View Scenarios">
                      <div class="w-scope-proof-label">Scenarios Loaded <i class="fas fa-eye" style="font-size: 9px; opacity: 0.5;"></i></div>
                      <div class="w-scope-proof-value">${(scopeProof.scenarioIdsUsed || []).length} IDs (refs only)</div>
                    </div>
                    <div class="w-scope-proof-item">
                      <div class="w-scope-proof-label">No Embedded Bodies</div>
                      <div class="w-scope-proof-value ${scopeProof.noEmbeddedScenarioBodies ? 'text-green' : 'text-red'}">
                        ${scopeProof.noEmbeddedScenarioBodies ? '✅ True' : '❌ False'}
                      </div>
                    </div>
                    <div class="w-scope-proof-item">
                      <div class="w-scope-proof-label">Config Chain</div>
                      <div class="w-scope-proof-value">${(scopeProof.configSourceChain || []).join(' → ')}</div>
                    </div>
                  </div>
                </div>

                <!-- CRITICAL VIOLATIONS -->
                ${criticalViolations.length > 0 ? `
                  <div style="margin-top: 14px;">
                    <div class="w-guard-section-title text-red">🚨 Critical Violations (${criticalViolations.length})</div>
                    ${criticalViolations.map(v => `
                      <div class="w-guard-item violation critical">
                        <div class="w-guard-header">
                          <span class="w-guard-status">🧨</span>
                          <strong>${esc(v.rule || 'TENANT_RISK')}</strong>
                        </div>
                        <div class="w-guard-details">${esc(v.message || '')}</div>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}

                <!-- WARNINGS -->
                ${warnings.length > 0 ? `
                  <div style="margin-top: 14px;">
                    <div class="w-guard-section-title text-yellow">⚠️ Warnings (${warnings.length})</div>
                    ${warnings.map(v => `
                      <div class="w-guard-item warning">
                        <div class="w-guard-header">
                          <span class="w-guard-status">⚠️</span>
                          <strong>${esc(v.rule || 'WARNING')}</strong>
                        </div>
                        <div class="w-guard-details">${esc(v.message || '')}</div>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}

                <!-- ALL CHECKS WITH SCORE -->
                <div style="margin-top: 14px;">
                  ${(() => {
                    const passedCount = checks.filter(c => c.passed).length;
                    const totalCount = checks.length;
                    const percentage = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
                    const scoreColor = percentage === 100 ? '#22c55e' : percentage >= 70 ? '#f59e0b' : '#ef4444';
                    
                    return `
                    <div class="w-checks-score-header">
                      <div class="w-guard-section-title">Safety Checks</div>
                      <div class="w-checks-score" style="color: ${scoreColor};">
                        <span class="w-checks-score-num">${percentage}%</span>
                        <span class="w-checks-score-label">(${passedCount}/${totalCount} passed)</span>
                      </div>
                    </div>
                    <div class="w-checks-progress-bar">
                      <div class="w-checks-progress-fill" style="width: ${percentage}%; background: ${scoreColor};"></div>
                    </div>
                    `;
                  })()}
                  <div class="w-checks-compact">
                    ${checks.map((c, idx) => {
                      // V56: Human-readable descriptions and details for each check
                      const checkInfo = {
                        'COMPANY_ID_MATCH': {
                          desc: 'Company document ID matches the requested ID',
                          why: 'Prevents loading wrong company data (tenant bleed)',
                          fix: 'This should always pass. If it fails, there\'s a serious bug.',
                          details: `Expected: ${esc(_companyId || 'N/A')}, Got: ${esc(c.actual || c.expected || 'N/A')}`
                        },
                        'NO_EMBEDDED_SCENARIOS': {
                          desc: 'Template references contain IDs only, not full scenario bodies',
                          why: 'Keeps data normalized - scenarios live in global templates',
                          fix: 'Remove any embedded scenarios from templateReferences array',
                          details: `Template refs checked: ${c.templateRefCount || 'N/A'}`
                        },
                        'NO_SCENARIO_TEXT': {
                          desc: 'Company doc doesn\'t contain raw scenario text',
                          why: 'All scenarios should come from global templates, not company doc',
                          fix: 'Remove triggers/quickReplies from company document',
                          details: 'Scanning for "triggers":[ and "quickReplies":[ patterns'
                        },
                        'TRADE_KEY_SET': {
                          desc: 'Company has a trade key assigned (hvac, plumbing, etc.)',
                          why: 'Ensures correct template/scenario filtering by industry',
                          fix: 'Go to Data & Config → Onboarding → Set Trade Key',
                          details: `Current trade key: ${esc(c.tradeKey || 'NOT_SET')}`
                        },
                        'PLACEHOLDERS_ALLOWLIST': {
                          desc: 'Only allowed placeholders are used',
                          why: 'Prevents injection of unauthorized variables',
                          fix: 'Remove invalid placeholder keys from company config',
                          details: c.invalidKeys?.length > 0 ? `Invalid: ${c.invalidKeys.join(', ')}` : 'All placeholders valid'
                        },
                        'NO_HARDCODED_COMPANY_DATA': {
                          desc: 'No company-specific data embedded in templates',
                          why: 'Global templates should use {placeholders}, not hardcoded names',
                          fix: 'Replace hardcoded company names with {companyName} placeholder',
                          details: 'Checking for hardcoded company names in responses'
                        },
                        'COMPANY_STORES_REFS_ONLY': {
                          desc: 'Company stores references (IDs) to templates, not copies',
                          why: 'Prevents data duplication and drift',
                          fix: 'Remove scenarios/categories/templates arrays from company doc',
                          details: 'Company should only have templateReferences with IDs'
                        }
                      };
                      const info = checkInfo[c.id] || { desc: c.description || 'Safety check', why: 'Multi-tenant data isolation', fix: 'Review configuration', details: '' };
                      const checkData = JSON.stringify({ id: c.id, passed: c.passed, ...info, raw: c }).replace(/"/g, '&quot;');
                      
                      return `
                      <div class="w-check-compact w-check-clickable ${c.passed ? 'pass' : 'fail'}" 
                           data-check-idx="${idx}"
                           data-check-info="${checkData}"
                           title="Click for details">
                        <span class="w-check-icon">${c.passed ? '✅' : '❌'}</span>
                        <span class="w-check-id">${esc(c.id || 'CHECK')}</span>
                        <span class="w-check-percent">${c.passed ? '100%' : '0%'}</span>
                      </div>
                    `;}).join('')}
                  </div>
                  <div style="font-size: 10px; color: #6b7280; margin-top: 8px; text-align: center;">
                    Click any check to see details
                  </div>
                </div>
              </div>
            `;
            
            // V55: Bind click handlers for clickable scope proof items
            setTimeout(() => {
                $$('.w-scope-clickable[data-nav-tab]', el).forEach(item => {
                    item.addEventListener('click', () => {
                        const tab = item.dataset.navTab;
                        const subtab = item.dataset.navSubtab;
                        console.log('[WiringTab] 🔗 Scope item clicked:', { tab, subtab });
                        
                        // Navigate to the tab
                        if (window.ControlPlaneNav?.go) {
                            window.ControlPlaneNav.go({ tab, section: subtab || null });
                        } else {
                            // Fallback: click the tab button
                            const tabBtn = document.querySelector(`[data-tab="${tab}"]`);
                            if (tabBtn) tabBtn.click();
                        }
                        
                        // If there's a subtab, switch to it after tab loads
                        if (subtab) {
                            setTimeout(() => {
                                const subtabBtn = document.querySelector(`[data-subtab="${subtab}"]`);
                                if (subtabBtn) subtabBtn.click();
                            }, 200);
                        }
                    });
                });
                
                // External URL links (like Company Profile)
                $$('.w-scope-clickable[data-nav-url]', el).forEach(item => {
                    item.addEventListener('click', () => {
                        const url = item.dataset.navUrl;
                        console.log('[WiringTab] 🔗 Opening URL:', url);
                        window.open(url, '_blank');
                    });
                });
                
                // V56: Clickable safety checks - show details modal
                $$('.w-check-clickable[data-check-info]', el).forEach(item => {
                    item.addEventListener('click', () => {
                        try {
                            const info = JSON.parse(item.dataset.checkInfo.replace(/&quot;/g, '"'));
                            showCheckDetailsModal(info);
                        } catch (err) {
                            console.error('[WiringTab] Failed to parse check info:', err);
                        }
                    });
                });
            }, 100);
            
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
        
        // Old renderNode removed - replaced by renderNodeWithHealth below
        
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
        
        // V56: Calculate health per tab
        function calculateTabHealth(tabId) {
            const tabNode = map.get(tabId);
            if (!tabNode) return { total: 0, configured: 0, percent: 0, issues: [] };
            
            const kids = children.get(tabId) || [];
            let total = 0;
            let configured = 0;
            const issues = [];
            
            // Check direct fields
            if (tabNode.status === 'WIRED') configured++;
            if (tabNode.status === 'MISCONFIGURED' || tabNode.status === 'NOT_CONFIGURED') {
                issues.push({ id: tabId, label: tabNode.label, status: tabNode.status });
            }
            total++;
            
            // Check children recursively
            function checkChildren(parentId, depth = 0) {
                if (depth > 10) return; // Prevent infinite recursion
                const childIds = children.get(parentId) || [];
                for (const childId of childIds) {
                    const child = map.get(childId);
                    if (!child) continue;
                    total++;
                    if (child.status === 'WIRED' || child.status === 'CONFIGURED') {
                        configured++;
                    } else if (child.status === 'MISCONFIGURED' || child.status === 'NOT_CONFIGURED' || child.status === 'EMPTY') {
                        issues.push({ id: childId, label: child.label, status: child.status, type: child.type });
                    } else if (child.status) {
                        configured++; // Partial, etc. count as configured
                    }
                    checkChildren(childId, depth + 1);
                }
            }
            checkChildren(tabId);
            
            const percent = total > 0 ? Math.round((configured / total) * 100) : 0;
            return { total, configured, percent, issues };
        }
        
        // V56: Build health data for all tabs
        const tabHealthData = new Map();
        roots.forEach(r => {
            tabHealthData.set(r.id, calculateTabHealth(r.id));
        });
        
        // Calculate overall health
        const overallConfigured = Array.from(tabHealthData.values()).reduce((sum, h) => sum + h.configured, 0);
        const overallTotal = Array.from(tabHealthData.values()).reduce((sum, h) => sum + h.total, 0);
        const overallPercent = overallTotal > 0 ? Math.round((overallConfigured / overallTotal) * 100) : 0;
        const overallColor = overallPercent === 100 ? '#22c55e' : overallPercent >= 70 ? '#f59e0b' : '#ef4444';
        
        el.innerHTML = `
            <div class="w-panel">
                <div class="w-panel-title" style="display: flex; justify-content: space-between; align-items: center;">
                    <span>🌳 Wiring Tree</span>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div class="w-tree-overall-score" style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 20px; font-weight: 800; color: ${overallColor};">${overallPercent}%</span>
                            <span style="font-size: 11px; color: #9ca3af;">(${overallConfigured}/${overallTotal} fields)</span>
                        </div>
                        <button id="verify-all-tabs-btn" class="w-btn w-btn-verify" style="padding: 6px 12px; background: linear-gradient(135deg, #3b82f6, #2563eb); border: none; border-radius: 6px; color: white; font-size: 11px; font-weight: 600; cursor: pointer;">
                            🔬 Verify All
                        </button>
                    </div>
                </div>
                
                <!-- Overall Progress Bar -->
                <div style="margin-bottom: 16px;">
                    <div class="w-tree-progress-bar" style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
                        <div style="height: 100%; width: ${overallPercent}%; background: ${overallColor}; transition: width 0.5s;"></div>
                    </div>
                </div>
                
                <div class="w-tree-container">
                    ${roots.map(r => {
                        const health = tabHealthData.get(r.id);
                        return renderNodeWithHealth(r.id, health);
                    }).join('')}
                </div>
            </div>
        `;
        
        // V56: Enhanced renderNode with health badge
        function renderNodeWithHealth(id, health, depth = 0, visited = new Set()) {
            if (visited.has(id) || depth > MAX_DEPTH) return '';
            visited.add(id);
            
            const n = map.get(id);
            if (!n) return '';
            
            if (_focusedNodeId && !isDescendantOrSelf(id, _focusedNodeId, new Set())) return '';
            if (_searchTerm && !subtreeMatches(id, new Set())) return '';
            
            const kids = children.get(id) || [];
            const hasKids = kids.length > 0;
            const isExpanded = _expandedNodes.has(id);
            const isTab = n.type === 'TAB';
            
            // Health badge for tabs
            const healthBadge = isTab && health ? `
                <span class="w-tab-health" style="margin-left: auto; display: flex; align-items: center; gap: 6px;">
                    <span class="w-tab-health-percent" style="font-size: 12px; font-weight: 700; color: ${health.percent === 100 ? '#22c55e' : health.percent >= 70 ? '#f59e0b' : '#ef4444'};">
                        ${health.percent}%
                    </span>
                    <span class="w-tab-health-bar" style="width: 40px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                        <span style="display: block; height: 100%; width: ${health.percent}%; background: ${health.percent === 100 ? '#22c55e' : health.percent >= 70 ? '#f59e0b' : '#ef4444'};"></span>
                    </span>
                    ${health.issues.length > 0 ? `<span style="font-size: 10px; color: #f59e0b;">(${health.issues.length} issues)</span>` : ''}
                </span>
            ` : '';
            
            return `
                <div class="w-node" data-node="${esc(id)}" style="margin-left:${depth * 16}px">
                    <div class="w-node-row ${isTab ? 'w-node-tab-row' : ''}" data-select="${esc(id)}" style="cursor:pointer;">
                        ${hasKids ? `
                            <button class="w-expander" data-expand="${esc(id)}">${isExpanded ? '▾' : '▸'}</button>
                        ` : '<span class="w-expander-spacer"></span>'}
                        <span class="w-node-type">${esc(n.type)}</span>
                        <span class="w-node-label">${esc(n.label)}</span>
                        ${statusBadge(n.status)}
                        ${n.critical ? '<span class="w-critical-flag">CRITICAL</span>' : ''}
                        ${healthBadge}
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
                            ${isTab && health?.issues?.length > 0 ? `
                                <div class="w-tab-issues" style="margin-top: 8px; padding: 8px; background: rgba(239, 68, 68, 0.1); border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.3);">
                                    <div style="font-size: 11px; font-weight: 600; color: #f87171; margin-bottom: 6px;">⚠️ Issues Found (${health.issues.length})</div>
                                    ${health.issues.slice(0, 5).map(i => `
                                        <div style="font-size: 10px; color: #fca5a5; margin-bottom: 2px;">• ${esc(i.label || i.id)}: ${esc(i.status)}</div>
                                    `).join('')}
                                    ${health.issues.length > 5 ? `<div style="font-size: 10px; color: #9ca3af;">... and ${health.issues.length - 5} more</div>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}
                    
                    ${hasKids && isExpanded ? `
                        <div class="w-children">
                            ${kids.map(k => renderNodeWithHealth(k, null, depth + 1, new Set(visited))).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
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
                // Don't treat expander click as selection click
                if (e.target && e.target.matches('.w-expander')) return;
                selectNode(row.dataset.select);
            });
        });
        
        // V56: Verify All button
        const verifyBtn = el.querySelector('#verify-all-tabs-btn');
        if (verifyBtn) {
            verifyBtn.addEventListener('click', async () => {
                verifyBtn.disabled = true;
                verifyBtn.innerHTML = '⏳ Verifying...';
                
                try {
                    // Expand all tabs to show issues
                    roots.forEach(r => _expandedNodes.add(r.id));
                    renderTree();
                    
                    // Show summary modal
                    const allIssues = [];
                    let totalConfigured = 0;
                    let totalFields = 0;
                    
                    roots.forEach(r => {
                        const health = tabHealthData.get(r.id);
                        if (health) {
                            totalConfigured += health.configured;
                            totalFields += health.total;
                            health.issues.forEach(i => allIssues.push({ tab: r.label || r.id, ...i }));
                        }
                    });
                    
                    showVerificationResultsModal({
                        totalFields,
                        totalConfigured,
                        percent: totalFields > 0 ? Math.round((totalConfigured / totalFields) * 100) : 0,
                        issues: allIssues,
                        tabs: roots.map(r => ({ id: r.id, label: r.label, ...tabHealthData.get(r.id) }))
                    });
                    
                } finally {
                    verifyBtn.disabled = false;
                    verifyBtn.innerHTML = '🔬 Verify All';
                }
            });
        }
    }
    
    /**
     * V56: Show verification results modal
     */
    function showVerificationResultsModal(results) {
        const existing = document.getElementById('verification-modal');
        if (existing) existing.remove();
        
        const scoreColor = results.percent === 100 ? '#22c55e' : results.percent >= 70 ? '#f59e0b' : '#ef4444';
        const statusText = results.percent === 100 ? '✅ FULLY WIRED' : results.percent >= 70 ? '⚠️ MOSTLY WIRED' : '❌ NEEDS ATTENTION';
        
        const modal = document.createElement('div');
        modal.id = 'verification-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        modal.innerHTML = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 28px; max-width: 700px; width: 95%; max-height: 85vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3 style="margin: 0; color: #fff; font-size: 20px;">🔬 Wiring Verification Report</h3>
                    <button id="close-verify-modal" style="background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 24px;">✕</button>
                </div>
                
                <!-- Overall Score -->
                <div style="text-align: center; padding: 24px; background: linear-gradient(135deg, rgba(0,0,0,0.3), rgba(0,0,0,0.2)); border-radius: 12px; margin-bottom: 24px;">
                    <div style="font-size: 56px; font-weight: 800; color: ${scoreColor};">${results.percent}%</div>
                    <div style="font-size: 14px; color: ${scoreColor}; font-weight: 600; margin-top: 4px;">${statusText}</div>
                    <div style="font-size: 12px; color: #9ca3af; margin-top: 8px;">${results.totalConfigured} of ${results.totalFields} fields configured</div>
                    
                    <!-- Progress bar -->
                    <div style="margin-top: 16px; height: 10px; background: rgba(255,255,255,0.1); border-radius: 5px; overflow: hidden;">
                        <div style="height: 100%; width: ${results.percent}%; background: ${scoreColor}; transition: width 0.5s;"></div>
                    </div>
                </div>
                
                <!-- Per-Tab Breakdown -->
                <div style="margin-bottom: 24px;">
                    <h4 style="color: #e0e0e0; font-size: 14px; margin: 0 0 12px 0;">📊 Tab-by-Tab Breakdown</h4>
                    <div style="display: grid; gap: 8px;">
                        ${results.tabs.map(t => {
                            const tabColor = t.percent === 100 ? '#22c55e' : t.percent >= 70 ? '#f59e0b' : '#ef4444';
                            return `
                            <div style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid #2a2a2e;">
                                <span style="font-size: 13px; color: #e0e0e0; flex: 1;">${esc(t.label || t.id)}</span>
                                <span style="font-size: 12px; font-weight: 700; color: ${tabColor};">${t.percent}%</span>
                                <div style="width: 60px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                                    <div style="height: 100%; width: ${t.percent}%; background: ${tabColor};"></div>
                                </div>
                                <span style="font-size: 10px; color: #9ca3af; width: 50px; text-align: right;">${t.configured}/${t.total}</span>
                                ${t.issues?.length > 0 ? `<span style="font-size: 10px; color: #f59e0b;">⚠️ ${t.issues.length}</span>` : '<span style="font-size: 10px; color: #22c55e;">✓</span>'}
                            </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                
                ${results.issues.length > 0 ? `
                <!-- Issues List -->
                <div style="margin-bottom: 20px;">
                    <h4 style="color: #f87171; font-size: 14px; margin: 0 0 12px 0;">⚠️ Issues to Fix (${results.issues.length})</h4>
                    <div style="max-height: 200px; overflow-y: auto; background: rgba(239, 68, 68, 0.05); border-radius: 8px; padding: 12px; border: 1px solid rgba(239, 68, 68, 0.2);">
                        ${results.issues.map(i => `
                            <div style="font-size: 12px; color: #fca5a5; margin-bottom: 6px; padding-left: 12px; border-left: 2px solid #ef4444;">
                                <strong>${esc(i.tab)}</strong> → ${esc(i.label || i.id)}: <span style="color: #f87171;">${esc(i.status)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : `
                <div style="padding: 20px; background: rgba(34, 197, 94, 0.1); border-radius: 8px; border: 1px solid rgba(34, 197, 94, 0.3); text-align: center; margin-bottom: 20px;">
                    <span style="font-size: 24px;">🎉</span>
                    <div style="color: #4ade80; font-size: 14px; font-weight: 600; margin-top: 8px;">All systems wired correctly!</div>
                </div>
                `}
                
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="close-verify-btn" style="padding: 10px 24px; background: #238636; border: none; border-radius: 8px; color: #fff; cursor: pointer; font-size: 13px; font-weight: 600;">Done</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        modal.querySelector('#close-verify-modal').onclick = () => modal.remove();
        modal.querySelector('#close-verify-btn').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
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
    // TIER SYSTEM - Prescriptive Build Guide (not passive report)
    // ========================================================================
    
    function renderTierProgress() {
        const el = $('#wiringTierProgress');
        if (!el || !_report) return;
        
        if (!isV2Report(_report) || !_report.tiers) {
            el.innerHTML = '';
            return;
        }
        
        const tiers = _report.tiers;
        const tierDefs = _report.tierDefinitions || [];
        const byTier = tiers.byTier || {};
        
        // Current tier badge
        const currentTier = tiers.displayTier || { id: 'NONE', name: 'Not Ready', icon: '⚪', color: '#6b7280' };
        
        el.innerHTML = `
          <div class="w-tier-panel">
            <div class="w-tier-header">
              <div class="w-tier-current" style="background: ${currentTier.color}20; border-color: ${currentTier.color};">
                <div class="w-tier-icon">${currentTier.icon}</div>
                <div class="w-tier-info">
                  <div class="w-tier-label">Current Performance Tier</div>
                  <div class="w-tier-name" style="color: ${currentTier.color};">${esc(currentTier.name)}</div>
                </div>
              </div>
              <div class="w-tier-score">
                <div class="w-tier-score-value">${tiers.overallScore}%</div>
                <div class="w-tier-score-label">Overall Score</div>
              </div>
            </div>
            
            <!-- Tier Progress Bars -->
            <div class="w-tier-progress-grid">
              ${tierDefs.map(def => {
                const tierData = byTier[def.id] || {};
                const percent = tierData.percent || 0;
                const isComplete = tierData.isComplete;
                const isUnlocked = tierData.isUnlocked;
                const missingCount = (tierData.missing || []).length;
                
                return `
                  <div class="w-tier-progress-card ${isComplete ? 'complete' : ''} ${!isUnlocked ? 'locked' : ''}">
                    <div class="w-tier-progress-header">
                      <span class="w-tier-progress-icon">${def.icon}</span>
                      <span class="w-tier-progress-name">${esc(def.name)}</span>
                      ${isComplete ? '<span class="w-tier-complete-badge">✓</span>' : ''}
                      ${!isUnlocked ? '<span class="w-tier-locked-badge">🔒</span>' : ''}
                    </div>
                    <div class="w-tier-progress-desc">${esc(def.description)}</div>
                    <div class="w-tier-progress-bar">
                      <div class="w-tier-progress-fill" style="width: ${percent}%; background: ${def.color};"></div>
                    </div>
                    <div class="w-tier-progress-stats">
                      <span>${tierData.complete || 0}/${tierData.total || 0} requirements</span>
                      ${missingCount > 0 ? `<span class="w-tier-missing">${missingCount} missing</span>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
    }
    
    function renderNextActions() {
        const el = $('#wiringNextActions');
        if (!el || !_report) return;
        
        if (!isV2Report(_report) || !_report.tiers) {
            el.innerHTML = '';
            return;
        }
        
        const nextActions = _report.tiers.nextActions || [];
        
        if (nextActions.length === 0) {
            el.innerHTML = `
              <div class="w-next-actions-panel">
                <div class="w-next-actions-header">
                  <div class="w-next-actions-title">🎯 Next Best Actions</div>
                </div>
                <div class="w-next-actions-empty">
                  <div class="w-next-actions-success-icon">🏆</div>
                  <div class="w-next-actions-success-text">MAX Performance Achieved!</div>
                  <div class="w-next-actions-success-sub">All tiers complete. Your AI agent is fully wired.</div>
                </div>
              </div>
            `;
            return;
        }
        
        const impactColors = {
            reliability: '#ef4444',
            safety: '#f59e0b',
            conversion: '#22c55e',
            speed: '#3b82f6'
        };
        
        const impactLabels = {
            reliability: '⚡ Reliability',
            safety: '🛡️ Safety',
            conversion: '📈 Conversion',
            speed: '🚀 Speed'
        };
        
        // Map tabs to human-readable names
        const tabNames = {
            'front-desk': 'Front Desk',
            'data-config': 'Data & Config',
            'dynamic-flow': 'Dynamic Flow',
            'transfer-calls': 'Transfer Calls'
        };
        
        el.innerHTML = `
          <div class="w-next-actions-panel">
            <div class="w-next-actions-header">
              <div class="w-next-actions-title">🎯 Next Best Actions</div>
              <div class="w-next-actions-subtitle">Fix these to reach MAX performance</div>
            </div>
            <div class="w-next-actions-list">
              ${nextActions.map((action, idx) => {
                const nav = action.nav || {};
                const navTab = nav.tab || '';
                const navSection = nav.section || '';
                const navField = nav.field || '';
                const tabLabel = tabNames[navTab] || navTab;
                const hasNav = navTab && navSection;
                
                // Format recommendedValue for preview
                const previewJson = action.recommendedValue 
                    ? JSON.stringify(action.recommendedValue, null, 2)
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                    : null;
                
                return `
                <div class="w-next-action-card" data-field-id="${esc(action.fieldId)}">
                  <div class="w-next-action-number">${idx + 1}</div>
                  <div class="w-next-action-content">
                    <div class="w-next-action-top">
                      <span class="w-next-action-label">${esc(action.label)}</span>
                      <span class="w-next-action-tier tier-${action.tier}">${action.tier}</span>
                      ${action.critical ? '<span class="w-next-action-critical">CRITICAL</span>' : ''}
                    </div>
                    <div class="w-next-action-purpose">${esc(action.purpose)}</div>
                    <div class="w-next-action-failure">
                      <strong>If missing:</strong> ${esc(action.failureMode)}
                    </div>
                    ${action.payoff ? `<div class="w-next-action-payoff">💰 ${esc(action.payoff)}</div>` : ''}
                    
                    <!-- ACTIONABLE BUTTONS -->
                    <div class="w-next-action-buttons">
                      ${action.canAutoApply ? `
                        <button class="w-apply-fix-btn" 
                                data-field-id="${esc(action.fieldId)}"
                                title="Click to apply recommended configuration">
                          ✨ Apply Recommended
                        </button>
                        <button class="w-preview-btn" 
                                data-field-id="${esc(action.fieldId)}"
                                title="Show what will be applied">
                          👁️ Preview
                        </button>
                      ` : ''}
                      ${hasNav ? `
                        <button class="w-fix-now-btn" 
                                data-nav-tab="${esc(navTab)}" 
                                data-nav-section="${esc(navSection)}" 
                                data-nav-field="${esc(navField)}">
                          🔧 ${action.requiresUserInput ? 'Configure' : 'Fix Now'} → ${esc(tabLabel)}
                        </button>
                      ` : ''}
                      <button class="w-inspect-btn" data-focus="${esc(action.fieldId)}">
                        🔍 Inspect
                      </button>
                    </div>
                    
                    ${action.canAutoApply && previewJson ? `
                      <div class="w-next-action-preview" data-field-id="${esc(action.fieldId)}" style="display: none;">
                        <div class="w-preview-header">📋 Recommended Value (will be applied):</div>
                        <pre class="w-preview-code">${previewJson}</pre>
                      </div>
                    ` : ''}
                    
                    ${action.requiresUserInput ? `
                      <div class="w-next-action-user-input-hint">
                        ⚠️ Requires your input - cannot auto-apply
                      </div>
                    ` : ''}
                    
                    <div class="w-next-action-fix-hint">
                      💡 ${esc(action.fixInstructions)}
                    </div>
                    
                    <div class="w-next-action-meta">
                      <span class="w-next-action-impact" style="color: ${impactColors[action.impact] || '#666'};">
                        ${impactLabels[action.impact] || action.impact}
                      </span>
                      ${action.currentStatus ? `<span class="w-next-action-status">Status: ${action.currentStatus}</span>` : ''}
                    </div>
                  </div>
                </div>
              `;}).join('')}
            </div>
          </div>
        `;
        
        // Bind "Preview" buttons - toggle visibility of recommended value
        $$('.w-preview-btn[data-field-id]', el).forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const fieldId = btn.dataset.fieldId;
                const previewEl = el.querySelector(`.w-next-action-preview[data-field-id="${fieldId}"]`);
                if (previewEl) {
                    const isHidden = previewEl.style.display === 'none';
                    previewEl.style.display = isHidden ? 'block' : 'none';
                    btn.innerHTML = isHidden ? '👁️ Hide' : '👁️ Preview';
                }
            });
        });
        
        // Bind "Apply Fix" buttons (one-click apply)
        // SECURE: Button only sends fieldId, server generates patch from registry
        $$('.w-apply-fix-btn[data-field-id]', el).forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const fieldId = btn.dataset.fieldId;
                const card = el.querySelector(`.w-next-action-card[data-field-id="${fieldId}"]`);
                
                console.log('[WiringTab] ✨ APPLY_FIX_CLICK:', fieldId);
                
                // Disable button and show loading
                btn.disabled = true;
                const originalText = btn.innerHTML;
                btn.innerHTML = '⏳ Applying...';
                
                try {
                    // SECURE: Send only fieldId, server looks up recommended value
                    const result = await applyWiringFix(fieldId, 'recommended');
                    
                    // SUCCESS: Update button and card to show completion
                    btn.innerHTML = '✅ Applied!';
                    btn.style.background = '#22c55e';
                    btn.style.color = '#fff';
                    
                    // Mark the card as complete (visual feedback)
                    if (card) {
                        card.style.opacity = '0.6';
                        card.style.borderColor = '#22c55e';
                        card.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(34, 197, 94, 0.05))';
                        
                        // Add completion badge
                        const badge = document.createElement('div');
                        badge.className = 'w-applied-badge';
                        badge.innerHTML = '✅ CONFIGURED - Refreshing...';
                        badge.style.cssText = 'position:absolute;top:10px;right:10px;background:#22c55e;color:#fff;padding:4px 8px;border-radius:4px;font-size:11px;font-weight:600;';
                        card.style.position = 'relative';
                        card.appendChild(badge);
                    }
                    
                    // Note: The applyWiringFix function already triggers a refresh
                    // which will remove this card from the list if successful
                    
                } catch (err) {
                    console.error('[WiringTab] ❌ Apply failed:', err);
                    btn.innerHTML = '❌ Failed: ' + (err.message || 'Unknown error');
                    btn.style.background = '#ef4444';
                    btn.style.color = '#fff';
                    
                    setTimeout(() => {
                        btn.innerHTML = originalText;
                        btn.style.background = '';
                        btn.style.color = '';
                        btn.disabled = false;
                    }, 4000);
                }
            });
        });
        
        // Bind "Fix Now" deep link buttons
        $$('.w-fix-now-btn[data-nav-tab]', el).forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tab = btn.dataset.navTab;
                const section = btn.dataset.navSection;
                const field = btn.dataset.navField;
                console.log('[WiringTab] 🔧 FIX NOW clicked:', { tab, section, field });
                navigateToFix(tab, section, field);
            });
        });
        
        // Bind "Inspect" buttons
        $$('.w-inspect-btn[data-focus]', el).forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectNode(btn.dataset.focus);
            });
        });
    }
    
    /**
     * Navigate to a specific tab/section/field in the Control Plane
     * This is the DEEP LINK function that makes "Fix Now" actually work
     * 
     * Uses ControlPlaneNav.go() which:
     * - Updates URL params (shareable)
     * - Switches tabs
     * - Handles Front Desk internal tabs
     * - Scrolls to section
     * - Highlights the field
     */
    function navigateToFix(tab, section, field) {
        console.log('[WiringTab] 🚀 navigateToFix:', { tab, section, field });
        
        // Use the global ControlPlaneNav if available (preferred)
        if (window.ControlPlaneNav && typeof window.ControlPlaneNav.go === 'function') {
            console.log('[WiringTab] ✅ Using ControlPlaneNav.go()');
            window.ControlPlaneNav.go({ tab, section, field });
            return;
        }
        
        // Fallback: legacy navigation for backwards compatibility
        console.warn('[WiringTab] ⚠️ ControlPlaneNav not available, using fallback');
        
        // Step 1: Switch to the target tab using Control Plane's switchTab
        if (typeof window.switchControlPlaneTab === 'function') {
            window.switchControlPlaneTab(tab);
        } else if (typeof window.switchTab === 'function') {
            window.switchTab(tab);
        } else {
            // Fallback: click the nav button directly
            const navBtn = document.querySelector(`.nav-tab[data-tab="${tab}"]`);
            if (navBtn) {
                navBtn.click();
            } else {
                toast(`Tab not found: ${tab}`, true);
                return;
            }
        }
        
        // Step 2: Wait for tab to render, then scroll to section/field
        setTimeout(() => {
            // Try to find section by various ID patterns
            const sectionEl = document.getElementById(section) ||
                              document.getElementById(`section-${section}`) ||
                              document.querySelector(`[data-section="${section}"]`) ||
                              document.querySelector(`[data-section-id="${section}"]`);
            
            if (sectionEl) {
                // Expand section if it's collapsible
                if (sectionEl.classList.contains('collapsed')) {
                    sectionEl.classList.remove('collapsed');
                }
                
                // Scroll into view
                sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                
                // Highlight the section
                sectionEl.classList.add('cp-highlight-section');
                setTimeout(() => sectionEl.classList.remove('cp-highlight-section'), 3000);
            }
            
            // Step 3: Try to focus the specific field
            if (field) {
                setTimeout(() => {
                    const fieldEl = document.getElementById(field) ||
                                   document.querySelector(`[name="${field}"]`) ||
                                   document.querySelector(`[data-field="${field}"]`) ||
                                   document.querySelector(`#${field}-input`) ||
                                   document.querySelector(`input[id*="${field}"]`) ||
                                   document.querySelector(`select[id*="${field}"]`) ||
                                   document.querySelector(`textarea[id*="${field}"]`);
                    
                    if (fieldEl) {
                        fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        fieldEl.focus();
                        
                        // Add highlight effect
                        fieldEl.classList.add('cp-highlight');
                        setTimeout(() => fieldEl.classList.remove('cp-highlight'), 2500);
                    } else {
                        console.log('[WiringTab] Field not found, showing section only:', field);
                    }
                }, 300);
            }
            
            // Update URL for shareability
            const url = new URL(window.location.href);
            url.searchParams.set('tab', tab);
            url.searchParams.set('section', section);
            if (field) url.searchParams.set('field', field);
            window.history.replaceState({}, '', url.toString());
            
            toast(`Navigated to ${tab} → ${section}`);
            
        }, 200); // Give tab time to render
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
        
        console.log('[WiringTab] 🎨 renderAll() - Prescriptive Build Guide');
        
        // === TIER SYSTEM (First thing you see - "What tier am I? What's next?") ===
        renderTierProgress();         // MVA → PRO → MAX progress
        renderNextActions();          // Top 5 prioritized fixes with payoff
        
        // === EXECUTIVE LAYER ===
        renderExecutiveBanner();      // Big status banner
        renderScoreboard();           // Quick metrics tiles
        
        // === OPERATIONAL LAYER (What needs attention) ===
        renderKillSwitches();         // Kill switch status
        renderGapAnalysis();          // Registry vs DB vs Runtime gaps
        renderActionQueue();          // Prioritized fixes (legacy, now superseded by NextActions)
        
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
    
    /**
     * Apply a wiring fix via the /apply endpoint
     * SECURE: Client sends only fieldId, server generates patch from registry
     * 
     * @param {string} fieldId - The wiring field ID (e.g., "frontDesk.greetingResponses")
     * @param {string} mode - "recommended" (default) or "custom"
     * @param {Object} inputs - For custom mode, { value: ... }
     */
    async function applyWiringFix(fieldId, mode = 'recommended', inputs = null) {
        if (!_companyId) {
            toast('Company ID missing', true);
            throw new Error('No companyId');
        }
        
        if (!fieldId) {
            toast('Missing field ID', true);
            throw new Error('No fieldId');
        }
        
        console.log('[WiringTab] 🔧 applyWiringFix:', { 
            companyId: _companyId, 
            fieldId, 
            mode,
            hasInputs: !!inputs 
        });
        
        const token = localStorage.getItem('adminToken');
        if (!token) {
            toast('Not authenticated', true);
            throw new Error('No auth token');
        }
        
        // SECURE: Send only fieldId and mode, NOT the patch
        // Server generates patch from wiringTiers registry
        const body = {
            fieldId,
            mode,
            reason: 'wiring_next_action'
        };
        
        if (mode === 'custom' && inputs) {
            body.inputs = inputs;
        }
        
        const resp = await fetch(`/api/admin/wiring-status/${_companyId}/apply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });
        
        const data = await resp.json();
        
        if (!resp.ok || !data.success) {
            console.error('[WiringTab] ❌ Apply failed:', data);
            const errorMsg = data.message || data.error || 'Apply failed';
            toast(errorMsg, true);
            throw new Error(errorMsg);
        }
        
        console.log('[WiringTab] ✅ Apply succeeded:', {
            requestId: data.requestId,
            fieldId: data.fieldId,
            tier: data.tier,
            modifiedCount: data.modifiedCount
        });
        toast(`✅ Applied: ${fieldId} (${data.tier})`, false);
        
        // Auto-refresh the wiring report to show updated tier scores
        setTimeout(() => {
            console.log('[WiringTab] 🔄 Auto-refreshing wiring report...');
            refresh(_companyId);
        }, 500);
        
        return data;
    }
    
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
        // Compliance Check button
        const complianceBtn = $('#wiringComplianceCheck');
        console.log('[WiringTab] CHECKPOINT: Compliance Check button found:', !!complianceBtn);
        bindOnce(complianceBtn, 'click', async () => {
            console.log('[WiringTab] 🔍 BUTTON CLICKED: Compliance Check', { companyId: _companyId });
            if (!_companyId) {
                toast('No company ID', true);
                return;
            }
            
            complianceBtn.disabled = true;
            const originalText = complianceBtn.innerHTML;
            complianceBtn.innerHTML = '⏳ Scanning...';
            
            try {
                const token = localStorage.getItem('adminToken');
                const resp = await fetch(`/api/admin/wiring-status/${_companyId}/compliance`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (!resp.ok) {
                    throw new Error(`Compliance check failed: ${resp.statusText}`);
                }
                
                const result = await resp.json();
                console.log('[WiringTab] ✅ Compliance check result:', result);
                
                // Show modal with results
                showComplianceModal(result);
                
            } catch (err) {
                console.error('[WiringTab] ❌ Compliance check error:', err);
                toast('Compliance check failed: ' + err.message, true);
            } finally {
                complianceBtn.innerHTML = originalText;
                complianceBtn.disabled = false;
            }
        });
        
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
    // DEEP LINKING & SECTION FOCUS (for Test Agent integration)
    // ========================================================================
    
    /**
     * Scroll to and highlight a specific section in the Wiring Tab
     * Called from Test Agent when showing wiring issues
     * 
     * @param {string} sectionId - One of: 'executiveBanner', 'killSwitches', 'gapAnalysis', 'actionQueue', 'inspector'
     */
    function focusSection(sectionId) {
        console.log('[WiringTab] 🎯 Focusing section:', sectionId);
        
        const sectionMap = {
            'executiveBanner': '#wiringExecutiveBanner',
            'scoreboard': '#wiringScoreboard',
            'killSwitches': '#wiringKillSwitches',
            'gapAnalysis': '#wiringGapAnalysis',
            'actionQueue': '#wiringActionQueue',
            'specialChecks': '#wiringSpecialChecks',
            'issues': '#wiringIssues',
            'guardrails': '#wiringGuardrails',
            'tree': '#wiringTree',
            'inspector': '#wiringInspector'
        };
        
        const selector = sectionMap[sectionId];
        if (!selector) {
            console.warn('[WiringTab] Unknown section:', sectionId);
            return;
        }
        
        const el = $(selector);
        if (!el) {
            console.warn('[WiringTab] Section not found:', selector);
            return;
        }
        
        // Scroll into view
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // Highlight effect
        el.style.transition = 'box-shadow 0.3s ease, outline 0.3s ease';
        el.style.outline = '3px solid #38bdf8';
        el.style.boxShadow = '0 0 20px rgba(56, 189, 248, 0.3)';
        
        // Remove highlight after 3 seconds
        setTimeout(() => {
            el.style.outline = 'none';
            el.style.boxShadow = 'none';
        }, 3000);
        
        toast(`Focused: ${sectionId}`);
    }
    
    /**
     * Show a diagnostic overlay from Test Agent
     * Displays wiring issues that might have caused a test failure
     * 
     * @param {Object} diagnostics - Diagnostics from WiringDiagnosticService.getQuickDiagnostics()
     */
    function showTestDiagnostics(diagnostics) {
        console.log('[WiringTab] 🧪 Showing test diagnostics:', diagnostics);
        
        // Create overlay if it doesn't exist
        let overlay = $('#wiringTestDiagnosticsOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'wiringTestDiagnosticsOverlay';
            overlay.className = 'w-test-diagnostics-overlay';
            document.body.appendChild(overlay);
        }
        
        const issueCount = (diagnostics.issues || []).length;
        const warningCount = (diagnostics.warnings || []).length;
        const isHealthy = diagnostics.healthy;
        
        overlay.innerHTML = `
            <div class="w-test-diagnostics-modal">
                <div class="w-test-diagnostics-header">
                    <h3>🔬 Test Diagnostics → Wiring Analysis</h3>
                    <button class="w-btn" onclick="window.ClientViaWiringTab.hideTestDiagnostics()">✕ Close</button>
                </div>
                
                <div class="w-test-diagnostics-status ${isHealthy ? 'healthy' : 'unhealthy'}">
                    ${isHealthy ? '✅ Wiring Healthy' : '🔴 Wiring Issues Detected'}
                </div>
                
                ${issueCount > 0 ? `
                    <div class="w-test-diagnostics-section">
                        <h4>🔴 Critical Issues (${issueCount})</h4>
                        <div class="w-test-diagnostics-list">
                            ${(diagnostics.issues || []).map(issue => `
                                <div class="w-test-diagnostics-item critical" data-section="${issue.wiringLink || ''}">
                                    <div class="w-test-diagnostics-item-title">${esc(issue.title)}</div>
                                    <div class="w-test-diagnostics-item-message">${esc(issue.message)}</div>
                                    <div class="w-test-diagnostics-item-fix">💡 Fix: ${esc(issue.fix)}</div>
                                    ${issue.wiringLink ? `<button class="w-mini-btn" onclick="window.ClientViaWiringTab.focusSection('${issue.wiringLink}'); window.ClientViaWiringTab.hideTestDiagnostics();">Jump to Section →</button>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                
                ${warningCount > 0 ? `
                    <div class="w-test-diagnostics-section">
                        <h4>⚠️ Warnings (${warningCount})</h4>
                        <div class="w-test-diagnostics-list">
                            ${(diagnostics.warnings || []).map(warn => `
                                <div class="w-test-diagnostics-item warning">
                                    <div class="w-test-diagnostics-item-title">${esc(warn.title)}</div>
                                    <div class="w-test-diagnostics-item-message">${esc(warn.message || '')}</div>
                                    ${warn.fix ? `<div class="w-test-diagnostics-item-fix">💡 ${esc(warn.fix)}</div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <div class="w-test-diagnostics-stats">
                    <div class="w-test-diagnostics-stat">
                        <span class="label">Kill Switches:</span>
                        <span class="${diagnostics.stats?.killSwitches?.scenariosBlocked ? 'text-red' : 'text-green'}">
                            ${diagnostics.stats?.killSwitches?.scenariosBlocked ? '🔴 BLOCKING' : '✅ OK'}
                        </span>
                    </div>
                    <div class="w-test-diagnostics-stat">
                        <span class="label">Templates:</span>
                        <span class="${diagnostics.stats?.templates?.hasTemplates ? 'text-green' : 'text-red'}">
                            ${diagnostics.stats?.templates?.enabled || 0} linked
                        </span>
                    </div>
                    <div class="w-test-diagnostics-stat">
                        <span class="label">Scenarios:</span>
                        <span class="${(diagnostics.stats?.scenarios?.count || 0) > 0 ? 'text-green' : 'text-red'}">
                            ${diagnostics.stats?.scenarios?.count || 0} available
                        </span>
                    </div>
                </div>
            </div>
        `;
        
        overlay.style.display = 'flex';
        
        // Close on overlay click (outside modal)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                hideTestDiagnostics();
            }
        });
    }
    
    /**
     * Hide the test diagnostics overlay
     */
    function hideTestDiagnostics() {
        const overlay = $('#wiringTestDiagnosticsOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
    
    /**
     * Handle URL hash for deep linking
     * Example: ?section=killSwitches
     */
    function handleDeepLink() {
        const urlParams = new URLSearchParams(window.location.search);
        const section = urlParams.get('section');
        
        if (section) {
            console.log('[WiringTab] Deep link detected, focusing:', section);
            // Small delay to let the tab render first
            setTimeout(() => focusSection(section), 500);
        }
    }
    
    // ========================================================================
    // EXPORT
    // ========================================================================
    
    window.ClientViaWiringTab = {
        initWiringTab,
        refresh,
        focusNode,
        clearCache,
        // Deep linking & Test Agent integration
        focusSection,
        showTestDiagnostics,
        hideTestDiagnostics,
        handleDeepLink,
        // "Fix Now" navigation - navigates to specific tab/section/field
        navigateToFix,
        // Expose getQuickDiagnostics API call
        async fetchDiagnostics(companyId) {
            const token = localStorage.getItem('adminToken');
            const res = await fetch(`/api/admin/wiring-status/${companyId}/quick-diagnostics`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.json();
        }
    };
    
    console.log('[WiringTab] Module loaded');
    
})();

