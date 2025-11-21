/**
 * ============================================================================
 * DIAGNOSTIC MODAL - ENTERPRISE DEVELOPER TROUBLESHOOTING
 * ============================================================================
 * 
 * PURPOSE: Display detailed diagnostic information for AI Agent components
 * AUDIENCE: Developers and system administrators
 * OUTPUT: Technical diagnostic data with code references and fix actions
 * 
 * COMPONENTS SUPPORTED:
 * - Templates: Template cloning, sync status, scenario count
 * - Variables: Required fields, format validation, database state
 * - Twilio: Credentials, phone number, API connectivity
 * - Voice: ElevenLabs configuration, voice settings
 * - Scenarios: Scenario count, category coverage, disabled scenarios
 * 
 * FEATURES:
 * - Code file/line references
 * - Database path visualization
 * - Impact analysis
 * - Actionable fix buttons
 * - Copy-paste ready output
 * - JSON export
 * 
 * Created: 2025-11-04
 * ============================================================================
 */

class DiagnosticModal {
    constructor() {
        this.currentDiagnostics = null;
        this.currentComponent = null;
    }
    
    /**
     * Show diagnostic modal for a component
     * @param {string} component - Component name (templates|variables|twilio|voice|scenarios)
     * @param {string} companyId - Company ID
     */
    async show(component, companyId) {
        console.log(`[DIAGNOSTICS] Opening diagnostic modal for: ${component}`);
        
        try {
            // Fetch diagnostics from API
            const response = await fetch(
                `/api/company/${companyId}/configuration/diagnostics/${component}`,
                {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    }
                }
            );
            
            if (!response.ok) {
                throw new Error(`Failed to fetch diagnostics: ${response.statusText}`);
            }
            
            const diagnostics = await response.json();
            
            console.log(`[DIAGNOSTICS] Received diagnostic data:`, diagnostics);
            
            this.currentDiagnostics = diagnostics;
            this.currentComponent = component;
            
            // Render modal
            this.render();
            
        } catch (error) {
            console.error(`[DIAGNOSTICS] Error loading diagnostics:`, error);
            this.showError(error.message);
        }
    }
    
    /**
     * Render the diagnostic modal
     */
    render() {
        const diagnostics = this.currentDiagnostics;
        const component = this.currentComponent;
        
        // Remove existing modal if any
        const existing = document.querySelector('.diagnostic-modal-overlay');
        if (existing) {
            existing.remove();
        }
        
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'diagnostic-modal-overlay';
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                this.close();
            }
        };
        
        // Build modal HTML
        overlay.innerHTML = `
            <div class="diagnostic-modal" onclick="event.stopPropagation()">
                ${this.renderHeader(component, diagnostics)}
                ${this.renderStatusSection(diagnostics)}
                ${this.renderSummarySection(diagnostics)}
                ${this.renderChecksSection(diagnostics)}
                ${this.renderActionsSection(diagnostics)}
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Add keyboard listener
        this.keyboardListener = (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        };
        document.addEventListener('keydown', this.keyboardListener);
    }
    
    /**
     * Render modal header
     */
    renderHeader(component, diagnostics) {
        const icons = {
            templates: '📋',
            variables: '🔧',
            twilio: '📞',
            voice: '🎙️',
            scenarios: '🎭',
            cheatsheet: '📖',
            'frontline-intel': '📝',
            'tier-settings': '🎯',
            'tier-llm': '🤖',
            'brain-llm': '🧠'
        };
        
        const icon = icons[component] || '📊';
        const componentName = component.charAt(0).toUpperCase() + component.slice(1);
        
        return `
            <div class="diagnostic-header">
                <div class="diagnostic-header-title">
                    <span class="diagnostic-icon">${icon}</span>
                    <div>
                        <h2>${componentName} Diagnostic Report</h2>
                        <div class="diagnostic-meta">
                            Company: ${diagnostics.companyName} | 
                            Timestamp: ${new Date(diagnostics.timestamp).toLocaleString()}
                        </div>
                    </div>
                </div>
                <button class="diagnostic-close" onclick="diagnosticModal.close()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }
    
    /**
     * Render status section
     */
    renderStatusSection(diagnostics) {
        const statusClass = diagnostics.status;
        const statusIcon = diagnostics.status === 'passed' ? '✓' : 
                          diagnostics.status === 'warning' ? '⚠️' : '✗';
        const statusLabel = diagnostics.status.toUpperCase();
        
        return `
            <div class="diagnostic-status-section">
                <div class="diagnostic-status-badge ${statusClass}">
                    <span class="status-icon">${statusIcon}</span>
                    <span class="status-label">${statusLabel}</span>
                </div>
                <div class="diagnostic-score">
                    <div class="score-value">${diagnostics.score}</div>
                    <div class="score-label">/ 100</div>
                </div>
            </div>
        `;
    }
    
    /**
     * Render summary section
     */
    renderSummarySection(diagnostics) {
        const summary = diagnostics.summary || {};
        
        return `
            <div class="diagnostic-summary">
                <div class="summary-stat">
                    <div class="stat-value">${summary.total || 0}</div>
                    <div class="stat-label">Total Checks</div>
                </div>
                <div class="summary-stat passed">
                    <div class="stat-value">${summary.passed || 0}</div>
                    <div class="stat-label">Passed</div>
                </div>
                <div class="summary-stat failed">
                    <div class="stat-value">${summary.failed || 0}</div>
                    <div class="stat-label">Failed</div>
                </div>
                <div class="summary-stat warning">
                    <div class="stat-value">${summary.warnings || 0}</div>
                    <div class="stat-label">Warnings</div>
                </div>
            </div>
        `;
    }
    
    /**
     * Render checks section (main content)
     */
    renderChecksSection(diagnostics) {
        const checks = diagnostics.checks || [];
        
        if (checks.length === 0) {
            return `
                <div class="diagnostic-checks">
                    <div class="diagnostic-empty">
                        <i class="fas fa-info-circle"></i>
                        <p>No diagnostic checks available</p>
                    </div>
                </div>
            `;
        }
        
        // Group checks by status
        const failed = checks.filter(c => c.status === 'failed');
        const warnings = checks.filter(c => c.status === 'warning');
        const passed = checks.filter(c => c.status === 'passed');
        
        let html = '<div class="diagnostic-checks">';
        
        // Failed checks first (most important)
        if (failed.length > 0) {
            html += '<div class="checks-group">';
            html += '<h3 class="checks-group-title failed">🚨 Critical Issues</h3>';
            failed.forEach(check => {
                html += this.renderCheck(check);
            });
            html += '</div>';
        }
        
        // Warnings second
        if (warnings.length > 0) {
            html += '<div class="checks-group">';
            html += '<h3 class="checks-group-title warning">⚠️ Warnings</h3>';
            warnings.forEach(check => {
                html += this.renderCheck(check);
            });
            html += '</div>';
        }
        
        // Passed checks last (collapsible)
        if (passed.length > 0) {
            html += '<div class="checks-group">';
            html += `<h3 class="checks-group-title passed collapsible" onclick="this.parentElement.classList.toggle('collapsed')">
                        ✓ Passed Checks (${passed.length})
                        <i class="fas fa-chevron-down"></i>
                     </h3>`;
            html += '<div class="checks-group-content">';
            passed.forEach(check => {
                html += this.renderCheck(check);
            });
            html += '</div>';
            html += '</div>';
        }
        
        html += '</div>';
        
        return html;
    }
    
    /**
     * Render individual check
     */
    renderCheck(check) {
        const statusClass = check.status;
        const severityClass = check.severity || 'info';
        const statusIcon = check.status === 'passed' ? '✓' : 
                          check.status === 'warning' ? '⚠️' : '✗';
        
        let html = `
            <div class="diagnostic-check ${statusClass}">
                <div class="check-header">
                    <span class="check-status-icon">${statusIcon}</span>
                    <span class="check-message">${check.message}</span>
                    <span class="check-severity ${severityClass}">${check.severity || 'info'}</span>
                </div>
        `;
        
        // Show details for failed/warning checks
        if (check.status === 'failed' || check.status === 'warning') {
            html += '<div class="check-details">';
            
            // Field info
            if (check.field) {
                html += `
                    <div class="detail-row">
                        <span class="detail-label">Field:</span>
                        <code class="detail-value">${check.field}</code>
                    </div>
                `;
            }
            
            // Current value
            if (check.currentValue !== undefined) {
                const displayValue = check.currentValue === null ? '(empty)' : 
                                   check.currentValue === '' ? '(empty string)' : 
                                   check.currentValue;
                html += `
                    <div class="detail-row">
                        <span class="detail-label">Current Value:</span>
                        <code class="detail-value">${this.escapeHtml(String(displayValue))}</code>
                    </div>
                `;
            }
            
            // Expected value/format
            if (check.expectedValue) {
                html += `
                    <div class="detail-row">
                        <span class="detail-label">Expected:</span>
                        <code class="detail-value">${this.escapeHtml(check.expectedValue)}</code>
                    </div>
                `;
            } else if (check.expectedFormat) {
                html += `
                    <div class="detail-row">
                        <span class="detail-label">Expected Format:</span>
                        <code class="detail-value">${this.escapeHtml(check.expectedFormat)}</code>
                    </div>
                `;
            }
            
            // Impact
            if (check.impact && check.impact.length > 0) {
                html += `
                    <div class="detail-row">
                        <span class="detail-label">Impact:</span>
                        <ul class="impact-list">
                            ${check.impact.map(i => `<li>${this.escapeHtml(i)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }
            
            // Code reference
            if (check.codeReference) {
                html += `
                    <div class="detail-row code-reference">
                        <span class="detail-label">Code Location:</span>
                        <div class="code-ref-details">
                            <code>${check.codeReference.file}:${check.codeReference.line}</code>
                            <code class="code-path">${check.codeReference.path}</code>
                        </div>
                    </div>
                `;
            }
            
            // Fix action
            if (check.fix) {
                html += `
                    <div class="check-fix">
                        <strong>💡 How to Fix:</strong>
                        <p>${this.escapeHtml(check.fix.description)}</p>
                        ${this.renderFixButton(check.fix)}
                    </div>
                `;
            }
            
            html += '</div>';
        }
        
        // Show details for passed checks (collapsible)
        if (check.status === 'passed' && check.details) {
            html += '<div class="check-details collapsed">';
            html += '<div class="detail-expand" onclick="this.parentElement.classList.toggle(\'collapsed\')">';
            html += 'Show Details <i class="fas fa-chevron-down"></i>';
            html += '</div>';
            html += '<div class="detail-content">';
            html += this.renderDetails(check.details);
            html += '</div>';
            html += '</div>';
        }
        
        html += '</div>';
        
        return html;
    }
    
    /**
     * Render fix button
     */
    renderFixButton(fix) {
        if (fix.action === 'navigate') {
            return `
                <button class="fix-button" onclick="diagnosticModal.handleFix('${fix.action}', '${fix.target}', '${fix.field || ''}')">
                    → Go to ${fix.target.replace(/-/g, ' ').toUpperCase()}
                </button>
            `;
        } else if (fix.action === 'edit') {
            return `
                <button class="fix-button" onclick="diagnosticModal.handleFix('${fix.action}', '${fix.target}', '${fix.field}')">
                    ✏️ Edit ${fix.field}
                </button>
            `;
        } else if (fix.action === 'sync') {
            return `
                <button class="fix-button" onclick="diagnosticModal.handleFix('${fix.action}', 'sync', '')">
                    🔄 Sync Template
                </button>
            `;
        } else {
            return '';
        }
    }
    
    /**
     * Render details object
     */
    renderDetails(details) {
        let html = '<dl class="details-list">';
        
        for (const [key, value] of Object.entries(details)) {
            const label = key.replace(/([A-Z])/g, ' $1').trim();
            const displayLabel = label.charAt(0).toUpperCase() + label.slice(1);
            
            html += `
                <div class="detail-item">
                    <dt>${this.escapeHtml(displayLabel)}:</dt>
                    <dd>${this.escapeHtml(String(value))}</dd>
                </div>
            `;
        }
        
        html += '</dl>';
        return html;
    }
    
    /**
     * Render actions section
     */
    renderActionsSection(diagnostics) {
        return `
            <div class="diagnostic-actions">
                <button class="action-btn secondary" onclick="diagnosticModal.copyJSON()">
                    <i class="fas fa-copy"></i> Copy JSON
                </button>
                <button class="action-btn secondary" onclick="diagnosticModal.exportReport()">
                    <i class="fas fa-download"></i> Export Report
                </button>
                <button class="action-btn primary" onclick="diagnosticModal.close()">
                    Close
                </button>
            </div>
        `;
    }
    
    /**
     * Handle fix action
     */
    handleFix(action, target, field) {
        console.log(`[DIAGNOSTICS] Handling fix: ${action} -> ${target} (field: ${field})`);
        
        // Close modal
        this.close();
        
        if (action === 'navigate') {
            // Navigate to the appropriate tab
            const tabButton = document.querySelector(`[data-subtab="${target}"]`);
            if (tabButton) {
                tabButton.click();
                
                // If field specified, try to focus it
                if (field) {
                    setTimeout(() => {
                        const fieldInput = document.querySelector(`[data-variable="${field}"]`) ||
                                         document.querySelector(`#${field}`) ||
                                         document.querySelector(`[name="${field}"]`);
                        if (fieldInput) {
                            fieldInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            fieldInput.focus();
                        }
                    }, 300);
                }
            }
        } else if (action === 'edit') {
            // Navigate to tab and focus field
            this.handleFix('navigate', target, field);
        } else if (action === 'sync') {
            // Trigger template sync
            const syncButton = document.querySelector('.template-sync-button');
            if (syncButton) {
                syncButton.click();
            }
        }
    }
    
    /**
     * Copy diagnostic JSON to clipboard
     */
    copyJSON() {
        const json = JSON.stringify(this.currentDiagnostics, null, 2);
        
        navigator.clipboard.writeText(json).then(() => {
            this.showNotification('Diagnostic JSON copied to clipboard', 'success');
        }).catch(err => {
            console.error('[DIAGNOSTICS] Failed to copy:', err);
            this.showNotification('Failed to copy to clipboard', 'error');
        });
    }
    
    /**
     * Export diagnostic report as file
     */
    exportReport() {
        const json = JSON.stringify(this.currentDiagnostics, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `diagnostic-${this.currentComponent}-${Date.now()}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        
        this.showNotification('Diagnostic report exported', 'success');
    }
    
    /**
     * Show notification
     */
    showNotification(message, type) {
        // Use existing notification system if available
        if (window.aiAgentSettings && window.aiAgentSettings.showSuccess) {
            if (type === 'success') {
                window.aiAgentSettings.showSuccess(message);
            } else if (type === 'error') {
                window.aiAgentSettings.showError(message);
            } else {
                window.aiAgentSettings.showInfo(message);
            }
        } else {
            // Fallback
            alert(message);
        }
    }
    
    /**
     * Show error modal
     */
    showError(message) {
        const overlay = document.createElement('div');
        overlay.className = 'diagnostic-modal-overlay';
        overlay.innerHTML = `
            <div class="diagnostic-modal error">
                <div class="diagnostic-header">
                    <h2>Error Loading Diagnostics</h2>
                    <button class="diagnostic-close" onclick="this.closest('.diagnostic-modal-overlay').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="diagnostic-error-content">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>${this.escapeHtml(message)}</p>
                </div>
                <div class="diagnostic-actions">
                    <button class="action-btn primary" onclick="this.closest('.diagnostic-modal-overlay').remove()">
                        Close
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    /**
     * Close modal
     */
    close() {
        const overlay = document.querySelector('.diagnostic-modal-overlay');
        if (overlay) {
            overlay.remove();
        }
        
        // Remove keyboard listener
        if (this.keyboardListener) {
            document.removeEventListener('keydown', this.keyboardListener);
            this.keyboardListener = null;
        }
    }
    
    /**
     * Escape HTML for safe rendering
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create global instance
const diagnosticModal = new DiagnosticModal();

