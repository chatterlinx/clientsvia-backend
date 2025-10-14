/**
 * ============================================================================
 * SYSTEM DIAGNOSTICS - AI AGENT SETTINGS
 * ============================================================================
 * 
 * Comprehensive diagnostic panel for debugging AI Agent issues
 * Displays:
 * - Greeting system status and fallback chain
 * - Last call details
 * - Data path verification
 * - Configuration conflicts
 * - Performance metrics
 * - Redis cache status
 * 
 * Provides "Copy All" button to paste diagnostics for AI debugging
 * ============================================================================
 */

class SystemDiagnostics {
    constructor(companyId) {
        this.companyId = companyId;
        this.isExpanded = false;
        this.diagnostics = null;
    }

    /**
     * Render the diagnostics panel
     */
    render() {
        return `
            <div class="system-diagnostics-container">
                <div class="diagnostics-header" onclick="systemDiagnostics.toggle()">
                    <div class="diagnostics-header-left">
                        <i class="fas fa-stethoscope"></i>
                        <h3>System Diagnostics</h3>
                        <span class="diagnostics-badge">Copy & paste for instant debugging</span>
                    </div>
                    <div class="diagnostics-header-right">
                        <button class="btn-refresh" onclick="event.stopPropagation(); systemDiagnostics.refresh();">
                            <i class="fas fa-sync"></i> Refresh
                        </button>
                        <i class="fas fa-chevron-${this.isExpanded ? 'up' : 'down'} toggle-icon"></i>
                    </div>
                </div>

                <div class="diagnostics-content ${this.isExpanded ? 'expanded' : 'collapsed'}">
                    ${this.isExpanded ? this.renderContent() : ''}
                </div>
            </div>
        `;
    }

    /**
     * Render diagnostics content
     */
    renderContent() {
        if (!this.diagnostics) {
            return `
                <div class="diagnostics-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Loading diagnostics...</p>
                </div>
            `;
        }

        return `
            <div class="diagnostics-actions">
                <button class="btn-copy-all" onclick="systemDiagnostics.copyAll()">
                    <i class="fas fa-copy"></i> Copy All Diagnostics
                </button>
                <span class="copy-hint">← Paste this to AI for instant debugging</span>
            </div>

            ${this.renderGreetingDiagnostics()}
            ${this.renderDataPathDiagnostics()}
            ${this.renderConflictsDiagnostics()}
            ${this.renderCacheDiagnostics()}
            ${this.renderLastCallDiagnostics()}
            ${this.renderPerformanceDiagnostics()}
        `;
    }

    /**
     * Render greeting system diagnostics
     */
    renderGreetingDiagnostics() {
        const greeting = this.diagnostics.greeting;
        const statusColor = greeting.status === 'OPTIMAL' ? 'green' : 'yellow';

        return `
            <div class="diagnostic-section">
                <div class="diagnostic-section-header">
                    <i class="fas fa-comment-dots"></i>
                    <h4>1. Greeting System Status</h4>
                    <span class="status-badge status-${statusColor}">${greeting.status}</span>
                </div>
                <div class="diagnostic-section-content">
                    <div class="diagnostic-row">
                        <span class="label">Active Source:</span>
                        <code>${greeting.activeSource}</code>
                    </div>
                    <div class="diagnostic-row">
                        <span class="label">Active Text:</span>
                        <div class="greeting-preview">"${greeting.activeText}"</div>
                    </div>
                    ${greeting.lastUpdated ? `
                        <div class="diagnostic-row">
                            <span class="label">Last Updated:</span>
                            <span>${new Date(greeting.lastUpdated).toLocaleString()}</span>
                        </div>
                    ` : ''}
                    
                    <div class="fallback-chain">
                        <strong>📊 Fallback Chain:</strong>
                        ${greeting.fallbackChain.map((item, index) => `
                            <div class="fallback-item ${item.active ? 'active' : ''}">
                                <div class="fallback-header">
                                    <span class="priority">${item.priority}.</span>
                                    <code>${item.source}</code>
                                    <span class="status-icon">${item.status === 'SET' ? '✅' : '❌'}</span>
                                    ${item.active ? '<span class="active-badge">ACTIVE</span>' : ''}
                                </div>
                                ${item.preview ? `
                                    <div class="fallback-preview">"${item.preview}"</div>
                                ` : ''}
                                ${item.warning ? `
                                    <div class="fallback-warning">⚠️ ${item.warning}</div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render data path diagnostics
     */
    renderDataPathDiagnostics() {
        const dataPaths = this.diagnostics.dataPaths;
        const statusColor = dataPaths.status === 'HEALTHY' ? 'green' : 'red';

        return `
            <div class="diagnostic-section">
                <div class="diagnostic-section-header">
                    <i class="fas fa-database"></i>
                    <h4>2. Data Path Verification</h4>
                    <span class="status-badge status-${statusColor}">${dataPaths.status}</span>
                </div>
                <div class="diagnostic-section-content">
                    <div class="diagnostic-row">
                        <span class="label">Summary:</span>
                        <span>${dataPaths.summary.ok}/${dataPaths.summary.total} paths OK</span>
                    </div>
                    
                    <div class="data-paths-list">
                        ${dataPaths.checks.map(check => `
                            <div class="data-path-item ${check.status === 'OK' ? 'ok' : 'error'}">
                                <span class="status-icon">${check.status === 'OK' ? '✅' : '❌'}</span>
                                <code class="path-name">${check.path}</code>
                                <span class="path-status">${check.status}</span>
                                ${check.value ? `<span class="path-value">${check.value}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render configuration conflicts diagnostics
     */
    renderConflictsDiagnostics() {
        const conflicts = this.diagnostics.conflicts;
        const statusColor = conflicts.status === 'NO_CONFLICTS' ? 'green' : 'yellow';

        return `
            <div class="diagnostic-section">
                <div class="diagnostic-section-header">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>3. Configuration Conflicts</h4>
                    <span class="status-badge status-${statusColor}">${conflicts.issueCount} issue(s)</span>
                </div>
                <div class="diagnostic-section-content">
                    ${conflicts.issues.length === 0 ? `
                        <div class="no-issues">
                            <i class="fas fa-check-circle"></i>
                            <p>No configuration conflicts detected</p>
                        </div>
                    ` : `
                        <div class="issues-list">
                            ${conflicts.issues.map(issue => `
                                <div class="issue-item severity-${issue.severity.toLowerCase()}">
                                    <div class="issue-header">
                                        <span class="severity-badge">${issue.severity}</span>
                                        <strong>${issue.type}</strong>
                                    </div>
                                    <p>${issue.message}</p>
                                    ${issue.field ? `<code>Field: ${issue.field}</code>` : ''}
                                </div>
                            `).join('')}
                        </div>

                        <div class="recommendations-section">
                            <strong>💡 Recommendations:</strong>
                            ${conflicts.recommendations.map((rec, index) => `
                                <div class="recommendation-item">
                                    <span class="rec-number">${index + 1}.</span>
                                    <div>
                                        <strong>${rec.action}</strong>
                                        <p>${rec.reason}</p>
                                        <span class="priority-badge priority-${rec.priority.toLowerCase()}">${rec.priority} Priority</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    /**
     * Render cache diagnostics
     */
    renderCacheDiagnostics() {
        const cache = this.diagnostics.cache;
        const statusColor = cache.status === 'CACHED' ? 'green' : 'gray';

        return `
            <div class="diagnostic-section">
                <div class="diagnostic-section-header">
                    <i class="fas fa-database"></i>
                    <h4>4. Redis Cache Status</h4>
                    <span class="status-badge status-${statusColor}">${cache.status}</span>
                </div>
                <div class="diagnostic-section-content">
                    <div class="diagnostic-row">
                        <span class="label">Cached:</span>
                        <span>${cache.isCached ? 'Yes' : 'No'}</span>
                    </div>
                    ${cache.expiresIn ? `
                        <div class="diagnostic-row">
                            <span class="label">Expires In:</span>
                            <span>${cache.expiresIn}</span>
                        </div>
                    ` : ''}
                    <div class="cache-tip">
                        💡 ${cache.tip}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render last call diagnostics
     */
    renderLastCallDiagnostics() {
        const lastCall = this.diagnostics.lastCall;

        return `
            <div class="diagnostic-section">
                <div class="diagnostic-section-header">
                    <i class="fas fa-phone"></i>
                    <h4>5. Last Call Diagnostics</h4>
                    <span class="status-badge status-gray">Pending</span>
                </div>
                <div class="diagnostic-section-content">
                    <div class="placeholder-message">
                        <i class="fas fa-info-circle"></i>
                        <p>${lastCall.message}</p>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render performance diagnostics
     */
    renderPerformanceDiagnostics() {
        const performance = this.diagnostics.performance;

        return `
            <div class="diagnostic-section">
                <div class="diagnostic-section-header">
                    <i class="fas fa-tachometer-alt"></i>
                    <h4>6. Performance Metrics</h4>
                    <span class="status-badge status-gray">Pending</span>
                </div>
                <div class="diagnostic-section-content">
                    <div class="placeholder-message">
                        <i class="fas fa-info-circle"></i>
                        <p>${performance.message}</p>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Toggle panel expansion
     */
    async toggle() {
        this.isExpanded = !this.isExpanded;
        
        if (this.isExpanded && !this.diagnostics) {
            await this.loadDiagnostics();
        }
        
        this.updateUI();
    }

    /**
     * Refresh diagnostics
     */
    async refresh() {
        await this.loadDiagnostics();
        this.updateUI();
    }

    /**
     * Load diagnostics from API
     */
    async loadDiagnostics() {
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/company/${this.companyId}/ai-agent-settings/diagnostics`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            this.diagnostics = await response.json();
            console.log('✅ [DIAGNOSTICS] Loaded:', this.diagnostics);

        } catch (error) {
            console.error('❌ [DIAGNOSTICS] Error loading:', error);
            this.diagnostics = {
                error: true,
                message: error.message
            };
        }
    }

    /**
     * Copy all diagnostics to clipboard
     */
    async copyAll() {
        const text = this.formatDiagnosticsForCopy();
        
        try {
            await navigator.clipboard.writeText(text);
            
            // Show success feedback
            const btn = document.querySelector('.btn-copy-all');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            btn.style.background = '#10b981';
            
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.background = '';
            }, 2000);
            
        } catch (error) {
            console.error('Failed to copy:', error);
            alert('Failed to copy diagnostics. Please try again.');
        }
    }

    /**
     * Format diagnostics for copy/paste
     */
    formatDiagnosticsForCopy() {
        if (!this.diagnostics) return 'No diagnostics available';

        const lines = [];
        lines.push('═══════════════════════════════════════════════════');
        lines.push('AI AGENT SETTINGS - SYSTEM DIAGNOSTICS');
        lines.push('═══════════════════════════════════════════════════');
        lines.push('');
        lines.push(`Generated: ${this.diagnostics.meta.timestamp}`);
        lines.push(`Company: ${this.diagnostics.meta.companyName}`);
        lines.push(`Company ID: ${this.diagnostics.meta.companyId}`);
        lines.push('');

        // Greeting System
        lines.push('1. GREETING SYSTEM STATUS');
        lines.push('─────────────────────────────────────────────────');
        lines.push(`Status: ${this.diagnostics.greeting.status}`);
        lines.push(`Active Source: ${this.diagnostics.greeting.activeSource}`);
        lines.push(`Active Text: "${this.diagnostics.greeting.activeText}"`);
        if (this.diagnostics.greeting.lastUpdated) {
            lines.push(`Last Updated: ${this.diagnostics.greeting.lastUpdated}`);
        }
        lines.push('');
        lines.push('Fallback Chain:');
        this.diagnostics.greeting.fallbackChain.forEach(item => {
            lines.push(`  ${item.priority}. ${item.source}: ${item.status} ${item.active ? '(ACTIVE)' : ''}`);
            if (item.preview) lines.push(`     Preview: "${item.preview}"`);
            if (item.warning) lines.push(`     ⚠️ ${item.warning}`);
        });
        lines.push('');

        // Data Paths
        lines.push('2. DATA PATH VERIFICATION');
        lines.push('─────────────────────────────────────────────────');
        lines.push(`Status: ${this.diagnostics.dataPaths.status}`);
        lines.push(`Paths OK: ${this.diagnostics.dataPaths.summary.ok}/${this.diagnostics.dataPaths.summary.total}`);
        lines.push('');
        this.diagnostics.dataPaths.checks.forEach(check => {
            lines.push(`  ${check.status === 'OK' ? '✅' : '❌'} ${check.path}: ${check.status}`);
            if (check.value) lines.push(`     Value: ${check.value}`);
        });
        lines.push('');

        // Conflicts
        lines.push('3. CONFIGURATION CONFLICTS');
        lines.push('─────────────────────────────────────────────────');
        lines.push(`Issues Found: ${this.diagnostics.conflicts.issueCount}`);
        if (this.diagnostics.conflicts.issues.length > 0) {
            lines.push('');
            this.diagnostics.conflicts.issues.forEach((issue, i) => {
                lines.push(`  Issue ${i + 1}: [${issue.severity}] ${issue.type}`);
                lines.push(`    Message: ${issue.message}`);
                if (issue.field) lines.push(`    Field: ${issue.field}`);
            });
            lines.push('');
            lines.push('Recommendations:');
            this.diagnostics.conflicts.recommendations.forEach((rec, i) => {
                lines.push(`  ${i + 1}. ${rec.action} [${rec.priority} Priority]`);
                lines.push(`     Reason: ${rec.reason}`);
            });
        } else {
            lines.push('  ✅ No conflicts detected');
        }
        lines.push('');

        // Cache
        lines.push('4. REDIS CACHE STATUS');
        lines.push('─────────────────────────────────────────────────');
        lines.push(`Status: ${this.diagnostics.cache.status}`);
        lines.push(`Cached: ${this.diagnostics.cache.isCached ? 'Yes' : 'No'}`);
        if (this.diagnostics.cache.expiresIn) {
            lines.push(`Expires In: ${this.diagnostics.cache.expiresIn}`);
        }
        lines.push(`Tip: ${this.diagnostics.cache.tip}`);
        lines.push('');

        lines.push('═══════════════════════════════════════════════════');

        return lines.join('\n');
    }

    /**
     * Update UI
     */
    updateUI() {
        const container = document.querySelector('.system-diagnostics-container');
        if (container) {
            container.outerHTML = this.render();
        }
    }
}

// Global instance
let systemDiagnostics = null;

