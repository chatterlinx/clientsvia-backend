/**
 * ============================================================================
 * CALL FLOW ENGINE MANAGER
 * ============================================================================
 * 
 * UI Controller for the Call Flow Engine - replaces the old Frontline-Intel
 * "big script" approach with structured, code-driven flow routing.
 * 
 * SECTIONS:
 * 1. Mission Triggers - Auto-extracted + manual triggers per flow
 * 2. Sentence Tester - Debug tool to test flow routing
 * 3. Style Configuration - Tone and greeting settings
 * 4. Booking Fields - Customizable data collection
 * 
 * ============================================================================
 */

class CallFlowEngineManager {
    constructor() {
        this.companyId = null;
        this.config = null;
        this.testResult = null;
        this.isDirty = false;
        
        console.log('[CALL FLOW ENGINE] Manager initialized');
    }
    
    // ========================================================================
    // LOAD CONFIGURATION
    // ========================================================================
    async load(companyId) {
        this.companyId = companyId;
        console.log('[CALL FLOW ENGINE] Loading config for company:', companyId);
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-flow-engine/${companyId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || 'Failed to load config');
            }
            
            this.config = result.data;
            console.log('[CALL FLOW ENGINE] Config loaded:', this.config);
            
            this.render();
            
        } catch (error) {
            console.error('[CALL FLOW ENGINE] Load failed:', error);
            this.showNotification(`Failed to load: ${error.message}`, 'error');
        }
    }
    
    // ========================================================================
    // MAIN RENDER
    // ========================================================================
    render() {
        const container = document.getElementById('callFlowEngineContainer');
        if (!container) {
            console.error('[CALL FLOW ENGINE] Container #callFlowEngineContainer not found');
            return;
        }
        
        const cfg = this.config || {};
        const mt = cfg.missionTriggers || {};
        const stats = cfg.stats || {};
        
        container.innerHTML = `
            <div class="cfe-wrapper">
                
                <!-- Header -->
                <div class="cfe-header">
                    <div class="cfe-header-title">
                        <h2><i class="fas fa-brain"></i> Call Flow Engine</h2>
                        <p>Universal flow routing - replace the giant frontline script with structured triggers</p>
                    </div>
                    <div class="cfe-header-actions">
                        <label class="cfe-toggle-row">
                            <input type="checkbox" id="cfe-enabled" ${cfg.enabled ? 'checked' : ''} onchange="callFlowEngineManager.toggleEnabled()">
                            <span class="cfe-toggle-label">${cfg.enabled ? '✅ Engine Active' : '⚪ Engine Disabled'}</span>
                        </label>
                    </div>
                </div>
                
                <!-- Main Grid -->
                <div class="cfe-grid">
                    
                    <!-- Left Column: Mission Triggers -->
                    <div class="cfe-panel cfe-triggers-panel">
                        <div class="cfe-panel-header">
                            <h3>🎯 Mission Triggers</h3>
                            <button class="cfe-btn cfe-btn-secondary cfe-btn-sm" onclick="callFlowEngineManager.rebuildCache()">
                                🔄 Sync from Triage/Scenarios
                            </button>
                        </div>
                        <p class="cfe-hint">Auto-extracted from your Triage Cards and Scenarios. Add manual overrides as needed.</p>
                        
                        <div class="cfe-trigger-sections">
                            ${this.renderTriggerSection('emergency', '🚨', 'EMERGENCY', mt.emergency, stats.emergency)}
                            ${this.renderTriggerSection('cancel', '❌', 'CANCEL', mt.cancel, stats.cancel)}
                            ${this.renderTriggerSection('reschedule', '📅', 'RESCHEDULE', mt.reschedule, stats.reschedule)}
                            ${this.renderTriggerSection('transfer', '📞', 'TRANSFER', mt.transfer, stats.transfer)}
                            ${this.renderTriggerSection('booking', '📋', 'BOOKING', mt.booking, stats.booking)}
                            ${this.renderTriggerSection('message', '💬', 'MESSAGE', mt.message, stats.message)}
                        </div>
                        
                        <div class="cfe-priority-note">
                            <strong>Priority Order:</strong> EMERGENCY → CANCEL → RESCHEDULE → TRANSFER → BOOKING → MESSAGE → GENERAL
                        </div>
                    </div>
                    
                    <!-- Right Column: Tester + Style -->
                    <div class="cfe-right-column">
                        
                        <!-- Sentence Tester -->
                        <div class="cfe-panel cfe-tester-panel">
                            <div class="cfe-panel-header">
                                <h3>🧪 Sentence Tester</h3>
                            </div>
                            <p class="cfe-hint">Test how the engine routes a caller's input</p>
                            
                            <div class="cfe-tester-input">
                                <input type="text" id="cfe-test-sentence" placeholder="I need to cancel my appointment..." class="cfe-input">
                                <button class="cfe-btn cfe-btn-primary" onclick="callFlowEngineManager.testSentence()">
                                    ▶ Test
                                </button>
                            </div>
                            
                            <div id="cfe-test-result" class="cfe-test-result">
                                ${this.renderTestResult()}
                            </div>
                        </div>
                        
                        <!-- Style Configuration -->
                        <div class="cfe-panel cfe-style-panel">
                            <div class="cfe-panel-header">
                                <h3>🎨 Conversation Style</h3>
                            </div>
                            
                            <div class="cfe-field">
                                <label>Tone Preset</label>
                                <select id="cfe-style-preset" class="cfe-select" onchange="callFlowEngineManager.markDirty()">
                                    <option value="friendly" ${cfg.style?.preset === 'friendly' ? 'selected' : ''}>Friendly</option>
                                    <option value="professional" ${cfg.style?.preset === 'professional' ? 'selected' : ''}>Professional</option>
                                    <option value="casual" ${cfg.style?.preset === 'casual' ? 'selected' : ''}>Casual</option>
                                    <option value="formal" ${cfg.style?.preset === 'formal' ? 'selected' : ''}>Formal</option>
                                </select>
                            </div>
                            
                            <div class="cfe-field">
                                <label>Custom Greeting</label>
                                <input type="text" id="cfe-style-greeting" class="cfe-input" 
                                    placeholder="Thank you for calling {companyName}..."
                                    value="${cfg.style?.greeting || ''}"
                                    oninput="callFlowEngineManager.markDirty()">
                            </div>
                            
                            <div class="cfe-field">
                                <label>Style Notes <span class="cfe-word-count">(max ~300 words)</span></label>
                                <textarea id="cfe-style-notes" class="cfe-textarea" rows="4"
                                    placeholder="Short notes for AI tone and phrasing..."
                                    oninput="callFlowEngineManager.markDirty()">${cfg.style?.customNotes || ''}</textarea>
                            </div>
                        </div>
                        
                    </div>
                    
                </div>
                
                <!-- Booking Fields Configuration Panel (Full Width) -->
                <div class="cfe-panel cfe-booking-fields-panel" style="margin-top: 20px;">
                    <div class="cfe-panel-header">
                        <h3>📋 Booking Fields</h3>
                        <button class="cfe-btn cfe-btn-secondary cfe-btn-sm" onclick="callFlowEngineManager.toggleBookingFieldsConfig()">
                            ⚙️ Configure
                        </button>
                    </div>
                    <p class="cfe-hint">
                        What information the AI collects from callers when booking. Drag to reorder. Toggle required fields.
                    </p>
                    
                    <div id="booking-fields-list" style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px;">
                        ${this.renderBookingFieldCards(cfg.bookingFields)}
                    </div>
                    
                    <!-- Expanded Config (hidden by default) -->
                    <div id="booking-fields-config" style="display: none; margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 8px; text-align: left;">Order</th>
                                    <th style="padding: 8px; text-align: left;">Field</th>
                                    <th style="padding: 8px; text-align: left;">Prompt</th>
                                    <th style="padding: 8px; text-align: center;">Required</th>
                                    <th style="padding: 8px; text-align: center;">Enabled</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.renderBookingFieldRows(cfg.bookingFields)}
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <!-- Quick Answers Panel (Full Width) -->
                <div class="cfe-panel cfe-quick-answers-panel" style="margin-top: 20px;">
                    <div class="cfe-panel-header">
                        <h3>❓ Quick Answers</h3>
                        <button class="cfe-btn cfe-btn-secondary cfe-btn-sm" onclick="callFlowEngineManager.openQuickAnswers()">
                            ⚙️ Manage Answers
                        </button>
                    </div>
                    <p class="cfe-hint">
                        Instant responses to common caller questions — hours, pricing, service areas, policies, etc.
                    </p>
                    <div id="quickAnswersSummary" style="margin-top: 12px;">
                        ${this.renderQuickAnswersSummary()}
                    </div>
                </div>
                
                <!-- Quick Answers Modal Container -->
                <div id="quickAnswersModalContainer"></div>
                    
                </div>
                
                <!-- Footer Actions -->
                <div class="cfe-footer">
                    <div class="cfe-footer-left">
                        <span class="cfe-last-updated">
                            ${cfg.lastCacheRebuild ? `Last sync: ${new Date(cfg.lastCacheRebuild).toLocaleString()}` : 'Never synced'}
                        </span>
                    </div>
                    <div class="cfe-footer-right">
                        <button class="cfe-btn cfe-btn-secondary" onclick="callFlowEngineManager.load('${this.companyId}')">
                            🔄 Reload
                        </button>
                        <button class="cfe-btn cfe-btn-primary" onclick="callFlowEngineManager.save()" ${this.isDirty ? '' : 'disabled'}>
                            💾 Save Changes
                        </button>
                    </div>
                </div>
                
            </div>
            
            <style>
                ${this.getStyles()}
            </style>
        `;
        
        // Attach enter key for tester
        const testInput = document.getElementById('cfe-test-sentence');
        if (testInput) {
            testInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.testSentence();
            });
        }
        
        // Load Quick Answers summary asynchronously
        this.loadQuickAnswersSummary();
    }
    
    // ========================================================================
    // RENDER TRIGGER SECTION
    // ========================================================================
    renderTriggerSection(flowType, icon, label, triggers, stat) {
        const autoList = triggers?.auto || [];
        const manualList = triggers?.manual || [];
        const total = stat?.total || 0;
        const isExpanded = total > 0;
        
        return `
            <div class="cfe-trigger-section ${isExpanded ? 'expanded' : ''}">
                <div class="cfe-trigger-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span class="cfe-trigger-icon">${icon}</span>
                    <span class="cfe-trigger-label">${label}</span>
                    <span class="cfe-trigger-count">${total} triggers</span>
                    <span class="cfe-trigger-arrow">▶</span>
                </div>
                <div class="cfe-trigger-body">
                    
                    <!-- Auto Triggers (read-only) -->
                    ${autoList.length > 0 ? `
                        <div class="cfe-trigger-group">
                            <span class="cfe-trigger-group-label">Auto-extracted:</span>
                            <div class="cfe-trigger-chips">
                                ${autoList.map(t => `
                                    <span class="cfe-chip cfe-chip-auto" title="From Triage/Scenario">
                                        ${t}
                                        <span class="cfe-chip-badge">Auto</span>
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    <!-- Manual Triggers (editable) -->
                    <div class="cfe-trigger-group">
                        <span class="cfe-trigger-group-label">Manual overrides:</span>
                        <div class="cfe-trigger-chips">
                            ${manualList.map(t => `
                                <span class="cfe-chip cfe-chip-manual">
                                    ${t}
                                    <button class="cfe-chip-remove" onclick="callFlowEngineManager.removeTrigger('${flowType}', '${t}')" title="Remove">×</button>
                                </span>
                            `).join('')}
                            <button class="cfe-chip cfe-chip-add" onclick="callFlowEngineManager.promptAddTrigger('${flowType}')">
                                + Add
                            </button>
                        </div>
                    </div>
                    
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // RENDER TEST RESULT
    // ========================================================================
    renderTestResult() {
        if (!this.testResult) {
            return `<div class="cfe-test-empty">Type a sentence and click Test</div>`;
        }
        
        const r = this.testResult;
        const decision = r.decision || {};
        const matchedTriggers = r.matchedTriggers || [];
        const nextStep = r.nextStep || {};
        
        return `
            <div class="cfe-test-output">
                <div class="cfe-test-decision">
                    <div class="cfe-test-flow ${decision.flow?.toLowerCase() || ''}">
                        ${decision.flow || 'UNKNOWN'}
                    </div>
                    <div class="cfe-test-confidence">
                        ${decision.confidencePercent || 0}% confidence
                    </div>
                </div>
                
                ${matchedTriggers.length > 0 ? `
                    <div class="cfe-test-matches">
                        <strong>Matched Triggers:</strong>
                        ${matchedTriggers.map(t => `
                            <span class="cfe-chip cfe-chip-mini">
                                "${t.trigger}"
                                <span class="cfe-chip-source">[${t.type}]</span>
                            </span>
                        `).join('')}
                    </div>
                ` : `
                    <div class="cfe-test-no-match">No trigger matched → GENERAL_INQUIRY</div>
                `}
                
                <div class="cfe-test-next-step">
                    <strong>Next Step:</strong> ${nextStep.step || 'N/A'}
                    ${nextStep.prompt ? `<br><em>"${nextStep.prompt}"</em>` : ''}
                </div>
                
                ${r.secondaryIntents?.length > 0 ? `
                    <div class="cfe-test-secondary">
                        <strong>Secondary Intents:</strong> ${r.secondaryIntents.join(', ')}
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    // ========================================================================
    // API METHODS
    // ========================================================================
    
    async toggleEnabled() {
        const checkbox = document.getElementById('cfe-enabled');
        const enabled = checkbox?.checked || false;
        
        try {
            await this.savePartial({ enabled });
            this.config.enabled = enabled;
            this.showNotification(enabled ? '✅ Engine enabled' : '⚪ Engine disabled', 'success');
            this.render();
        } catch (error) {
            this.showNotification('Failed to toggle: ' + error.message, 'error');
        }
    }
    
    async rebuildCache() {
        try {
            this.showNotification('🔄 Syncing triggers...', 'info');
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-flow-engine/${this.companyId}/rebuild`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ trade: '_default' })
            });
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message);
            }
            
            this.config.missionTriggers = result.data.missionTriggers;
            this.config.stats = result.data.stats;
            this.config.lastCacheRebuild = new Date().toISOString();
            
            // Show detailed sync report popup
            const report = result.data.syncReport;
            if (report) {
                this.showSyncReportModal(report);
            } else {
                this.showNotification('✅ Triggers synced from Triage/Scenarios', 'success');
            }
            
            this.render();
            
        } catch (error) {
            this.showNotification('Failed to sync: ' + error.message, 'error');
        }
    }
    
    /**
     * Show a detailed sync report modal
     */
    showSyncReportModal(report) {
        // Remove existing modal
        const existing = document.getElementById('cfe-sync-modal');
        if (existing) existing.remove();
        
        const flowIcons = {
            booking: '📅',
            emergency: '🚨',
            cancel: '❌',
            reschedule: '📆',
            transfer: '📞',
            message: '💬'
        };
        
        const flowLabels = {
            booking: 'BOOKING',
            emergency: 'EMERGENCY',
            cancel: 'CANCEL',
            reschedule: 'RESCHEDULE',
            transfer: 'TRANSFER',
            message: 'MESSAGE'
        };
        
        // Build flow rows
        let flowRows = '';
        for (const [flowType, sources] of Object.entries(report.sources || {})) {
            const icon = flowIcons[flowType] || '📌';
            const label = flowLabels[flowType] || flowType.toUpperCase();
            const fromTriage = sources.triage || 0;
            const fromScenarios = sources.scenarios || 0;
            const fromDefaults = sources.defaults || 0;
            const total = sources.total || 0;
            
            // Highlight new triggers (from triage/scenarios)
            const newCount = fromTriage + fromScenarios;
            const newBadge = newCount > 0 
                ? `<span style="background: #10b981; color: white; font-size: 11px; padding: 2px 6px; border-radius: 10px; margin-left: 8px;">+${newCount} new</span>`
                : '';
            
            flowRows += `
                <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 10px 0; font-weight: 600;">${icon} ${label}${newBadge}</td>
                    <td style="padding: 10px 0; text-align: center; color: #6b7280;">${fromDefaults}</td>
                    <td style="padding: 10px 0; text-align: center; color: ${fromTriage > 0 ? '#10b981' : '#9ca3af'}; font-weight: ${fromTriage > 0 ? '600' : '400'};">${fromTriage}</td>
                    <td style="padding: 10px 0; text-align: center; color: ${fromScenarios > 0 ? '#6366f1' : '#9ca3af'}; font-weight: ${fromScenarios > 0 ? '600' : '400'};">${fromScenarios}</td>
                    <td style="padding: 10px 0; text-align: center; font-weight: 700;">${total}</td>
                </tr>
            `;
        }
        
        const totalNew = report.newTriggersFound || 0;
        const summaryText = totalNew > 0
            ? `<span style="color: #10b981; font-weight: 600;">Found ${totalNew} new triggers</span> from your Triage Cards & Scenarios!`
            : `No new triggers found. All triggers are from universal defaults.`;
        
        const modal = document.createElement('div');
        modal.id = 'cfe-sync-modal';
        modal.innerHTML = `
            <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 16px; padding: 24px; max-width: 600px; width: 90%; max-height: 85vh; overflow: auto; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h2 style="margin: 0; font-size: 20px; font-weight: 700;">✅ Sync Complete</h2>
                        <button onclick="document.getElementById('cfe-sync-modal').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #6b7280;">&times;</button>
                    </div>
                    
                    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px; margin-bottom: 20px;">
                        <p style="margin: 0; font-size: 14px;">${summaryText}</p>
                    </div>
                    
                    <div style="background: #f9fafb; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                        <div style="display: flex; gap: 24px; font-size: 13px; color: #6b7280;">
                            <span>📋 Scanned <strong>${report.scanned?.triageCards || 0}</strong> Triage Cards</span>
                            <span>🎭 Scanned <strong>${report.scanned?.scenarios || 0}</strong> Scenarios</span>
                        </div>
                    </div>
                    
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <thead>
                            <tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
                                <th style="padding: 10px 0; text-align: left; font-weight: 600;">Flow</th>
                                <th style="padding: 10px 0; text-align: center; font-weight: 600; color: #6b7280;">Defaults</th>
                                <th style="padding: 10px 0; text-align: center; font-weight: 600; color: #10b981;">From Triage</th>
                                <th style="padding: 10px 0; text-align: center; font-weight: 600; color: #6366f1;">From Scenarios</th>
                                <th style="padding: 10px 0; text-align: center; font-weight: 600;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${flowRows}
                        </tbody>
                    </table>
                    
                    <div style="margin-top: 20px; text-align: right;">
                        <button onclick="document.getElementById('cfe-sync-modal').remove()" 
                                style="background: #6366f1; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;">
                            Got it!
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    async testSentence() {
        const input = document.getElementById('cfe-test-sentence');
        const sentence = input?.value?.trim();
        
        if (!sentence) {
            this.showNotification('Please enter a sentence to test', 'warning');
            return;
        }
        
        // Show loading state
        const resultContainer = document.getElementById('cfe-test-result');
        if (resultContainer) {
            resultContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #6b7280;">
                    <div style="font-size: 24px; margin-bottom: 8px;">🔄</div>
                    <div>Testing through all layers...</div>
                </div>
            `;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            
            // Use the FULL diagnostic endpoint
            const response = await fetch(`/api/admin/call-flow-engine/${this.companyId}/test-full`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sentence, trade: '_default' })
            });
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message);
            }
            
            this.testResult = result.data;
            
            if (resultContainer) {
                resultContainer.innerHTML = this.renderFullTestResult();
            }
            
        } catch (error) {
            console.error('[CFE] Test error:', error);
            if (resultContainer) {
                resultContainer.innerHTML = `
                    <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; color: #991b1b;">
                        <strong>❌ Test Failed</strong>
                        <p style="margin: 8px 0 0; font-size: 13px;">${error.message}</p>
                    </div>
                `;
            }
        }
    }
    
    // ========================================================================
    // RENDER FULL DIAGNOSTIC TEST RESULT
    // ========================================================================
    renderFullTestResult() {
        const { trace, summary } = this.testResult || {};
        
        if (!trace) {
            return '<div style="padding: 20px; text-align: center; color: #6b7280;">No results</div>';
        }
        
        // Status badge colors
        const statusColors = {
            'OK': { bg: '#dcfce7', border: '#86efac', text: '#166534' },
            'MATCHED': { bg: '#dcfce7', border: '#86efac', text: '#166534' },
            'NO_MATCH': { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' },
            'FALLBACK': { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' },
            'ERROR': { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
            'SKIPPED': { bg: '#f3f4f6', border: '#d1d5db', text: '#6b7280' },
            'COMPLETE': { bg: '#dbeafe', border: '#93c5fd', text: '#1e40af' }
        };
        
        // Verdict badge
        const verdictColors = {
            'OK': { bg: '#dcfce7', text: '#166534', icon: '✅' },
            'WARNINGS': { bg: '#fef3c7', text: '#92400e', icon: '⚠️' },
            'ISSUES_FOUND': { bg: '#fef2f2', text: '#991b1b', icon: '❌' }
        };
        
        const verdict = verdictColors[summary?.verdict] || verdictColors['OK'];
        
        return `
            <!-- Summary Banner -->
            <div style="background: ${verdict.bg}; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 20px;">${verdict.icon}</span>
                    <span style="font-weight: 600; color: ${verdict.text};">${summary?.verdict?.replace('_', ' ') || 'OK'}</span>
                </div>
                <div style="display: flex; gap: 16px; font-size: 12px; color: #6b7280;">
                    ${summary?.wouldUseLLM ? '<span style="color: #dc2626;">💰 Uses LLM</span>' : '<span style="color: #16a34a;">💚 Free Tier</span>'}
                    <span>⏱️ ~${summary?.estimatedLatency || 0}ms</span>
                    <span>💵 $${(summary?.estimatedCost || 0).toFixed(4)}</span>
                </div>
            </div>
            
            <!-- Steps Timeline -->
            <div style="display: flex; flex-direction: column; gap: 12px;">
                ${trace.steps.map(step => {
                    const colors = statusColors[step.status] || statusColors['OK'];
                    return `
                        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="background: #6366f1; color: white; font-weight: 600; font-size: 11px; padding: 2px 8px; border-radius: 10px;">STEP ${step.step}</span>
                                    <span style="font-weight: 500;">${step.name}</span>
                                </div>
                                <span style="background: ${colors.bg}; color: ${colors.text}; border: 1px solid ${colors.border}; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">
                                    ${step.status}
                                </span>
                            </div>
                            <div style="padding: 12px 14px; font-size: 13px;">
                                ${this.renderStepResult(step)}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            
            <!-- Issues & Suggestions -->
            ${trace.issues?.length > 0 ? `
                <div style="margin-top: 16px; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 16px;">
                    <div style="font-weight: 600; color: #92400e; margin-bottom: 8px;">⚠️ Issues Found (${trace.issues.length})</div>
                    <ul style="margin: 0; padding-left: 20px; color: #78350f; font-size: 13px;">
                        ${trace.issues.map(i => `<li style="margin: 4px 0;">[Step ${i.step}] ${i.message}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            
            ${trace.suggestions?.length > 0 ? `
                <div style="margin-top: 12px; background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 12px 16px;">
                    <div style="font-weight: 600; color: #1e40af; margin-bottom: 8px;">💡 Suggestions (${trace.suggestions.length})</div>
                    <ul style="margin: 0; padding-left: 20px; color: #1e3a8a; font-size: 13px;">
                        ${trace.suggestions.map(s => `
                            <li style="margin: 6px 0;">
                                <strong>${s.type.replace(/_/g, ' ')}:</strong> ${s.message}
                                ${s.suggestedKeywords ? `<br><code style="background: #dbeafe; padding: 2px 6px; border-radius: 4px; font-size: 11px;">Keywords: ${s.suggestedKeywords.join(', ')}</code>` : ''}
                            </li>
                        `).join('')}
                    </ul>
                </div>
            ` : ''}
        `;
    }
    
    // ========================================================================
    // RENDER INDIVIDUAL STEP RESULT
    // ========================================================================
    renderStepResult(step) {
        const result = step.result;
        
        if (step.error) {
            return `<div style="color: #dc2626;">❌ Error: ${step.error}</div>`;
        }
        
        switch (step.name) {
            case 'Flow Engine':
                return `
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                        <div>
                            <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Flow</div>
                            <div style="font-weight: 600; color: ${result.flow === 'BOOKING' ? '#16a34a' : result.flow === 'EMERGENCY' ? '#dc2626' : '#374151'};">
                                ${result.flow || 'GENERAL_INQUIRY'}
                            </div>
                        </div>
                        <div>
                            <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Confidence</div>
                            <div style="font-weight: 600;">${Math.round((result.confidence || 0) * 100)}%</div>
                        </div>
                        <div>
                            <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Matched Trigger</div>
                            <div style="font-weight: 500;">${result.matchedTrigger || '—'}</div>
                        </div>
                    </div>
                `;
                
            case 'Triage Match':
                if (result.matched) {
                    return `
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                            <div>
                                <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Card</div>
                                <div style="font-weight: 600; color: #16a34a;">✅ ${result.cardName}</div>
                            </div>
                            <div>
                                <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Action</div>
                                <div style="font-weight: 500;">${result.action}</div>
                            </div>
                            <div>
                                <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Matched Keyword</div>
                                <div><code style="background: #dcfce7; padding: 2px 6px; border-radius: 4px;">${result.matchedKeyword}</code></div>
                            </div>
                        </div>
                    `;
                } else {
                    return `
                        <div style="color: #78350f;">
                            <span style="font-weight: 500;">No triage card matched</span>
                            <span style="color: #92400e; font-size: 12px;"> — Checked ${result.cardsChecked || 0} cards</span>
                        </div>
                    `;
                }
                
            case '3-Tier Intelligence':
                if (!result) return '<div style="color: #6b7280;">No result</div>';
                return `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Tier Used</div>
                            <div style="font-weight: 600;">
                                ${result.tierUsed === 1 ? '🟢 Tier 1 (Free)' : 
                                  result.tierUsed === 2 ? '🟡 Tier 2 (Free)' : 
                                  '🔴 Tier 3 (LLM $)'}
                            </div>
                        </div>
                        <div>
                            <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Confidence</div>
                            <div style="font-weight: 600;">${Math.round((result.confidence || 0) * 100)}%</div>
                        </div>
                        ${result.scenario ? `
                            <div style="grid-column: span 2;">
                                <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Scenario</div>
                                <div style="font-weight: 500;">${result.scenario.name || result.scenario.key} <span style="color: #6b7280; font-size: 12px;">(${result.scenario.category || 'General'})</span></div>
                            </div>
                        ` : ''}
                        ${result.responsePreview ? `
                            <div style="grid-column: span 2; margin-top: 8px;">
                                <div style="color: #6b7280; font-size: 11px; text-transform: uppercase; margin-bottom: 4px;">Response Preview</div>
                                <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; font-size: 12px; color: #374151; font-style: italic;">
                                    "${result.responsePreview}..."
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;
                
            case 'Final Action':
                return `
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                        <div>
                            <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Action</div>
                            <div style="font-weight: 600; color: ${result.action === 'BOOKING_FLOW' ? '#16a34a' : '#374151'};">${result.action}</div>
                        </div>
                        <div>
                            <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Next Step</div>
                            <div style="font-weight: 500;">${result.nextStep}</div>
                        </div>
                        <div>
                            <div style="color: #6b7280; font-size: 11px; text-transform: uppercase;">Source</div>
                            <div style="font-weight: 500;">${result.source}</div>
                        </div>
                        ${result.warning ? `
                            <div style="grid-column: span 3; background: #fef3c7; padding: 8px; border-radius: 6px; color: #92400e; font-size: 12px;">
                                ⚠️ ${result.warning}
                            </div>
                        ` : ''}
                        ${result.responsePreview && !result.warning ? `
                            <div style="grid-column: span 3;">
                                <div style="color: #6b7280; font-size: 11px; text-transform: uppercase; margin-bottom: 4px;">Agent Would Say</div>
                                <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 10px; font-size: 12px; color: #166534;">
                                    "${result.responsePreview}"
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;
                
            default:
                return `<pre style="font-size: 11px; overflow: auto;">${JSON.stringify(result, null, 2)}</pre>`;
        }
    }
    
    async promptAddTrigger(flowType) {
        const trigger = prompt(`Add a trigger phrase for ${flowType.toUpperCase()}:\n\nExample: "I need to ${flowType === 'booking' ? 'schedule' : flowType}"`);
        
        if (!trigger || !trigger.trim()) return;
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-flow-engine/${this.companyId}/trigger`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ flowType, trigger: trigger.trim(), trade: '_default' })
            });
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message);
            }
            
            this.showNotification(`✅ Added "${trigger.trim()}" to ${flowType.toUpperCase()}`, 'success');
            await this.load(this.companyId);
            
        } catch (error) {
            this.showNotification('Failed to add trigger: ' + error.message, 'error');
        }
    }
    
    async removeTrigger(flowType, trigger) {
        if (!confirm(`Remove "${trigger}" from ${flowType.toUpperCase()}?`)) return;
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-flow-engine/${this.companyId}/trigger`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ flowType, trigger, trade: '_default' })
            });
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message);
            }
            
            this.showNotification(`✅ Removed "${trigger}"`, 'success');
            await this.load(this.companyId);
            
        } catch (error) {
            this.showNotification('Failed to remove trigger: ' + error.message, 'error');
        }
    }
    
    async save() {
        try {
            const updates = {
                style: {
                    preset: document.getElementById('cfe-style-preset')?.value || 'friendly',
                    greeting: document.getElementById('cfe-style-greeting')?.value || '',
                    customNotes: document.getElementById('cfe-style-notes')?.value || ''
                },
                // Include booking fields if modified
                bookingFields: this.config.bookingFields || [],
                rebuildCache: false
            };
            
            await this.savePartial(updates);
            
            this.isDirty = false;
            this.showNotification('✅ Changes saved', 'success');
            this.render();
            
        } catch (error) {
            this.showNotification('Failed to save: ' + error.message, 'error');
        }
    }
    
    async savePartial(updates) {
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/call-flow-engine/${this.companyId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message);
        }
        
        return result;
    }
    
    markDirty() {
        this.isDirty = true;
        const saveBtn = document.querySelector('.cfe-footer-right .cfe-btn-primary');
        if (saveBtn) saveBtn.disabled = false;
    }
    
    showNotification(message, type = 'info') {
        if (typeof ToastManager !== 'undefined' && ToastManager.show) {
            ToastManager.show(message, type);
        } else {
            console.log(`[CALL FLOW ENGINE] ${type.toUpperCase()}: ${message}`);
            if (type === 'error') alert(message);
        }
    }
    
    /**
     * Load a script dynamically
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    // ========================================================================
    // QUICK ANSWERS MANAGEMENT
    // ========================================================================
    
    /**
     * Render a summary of Quick Answers for the main panel
     */
    renderQuickAnswersSummary() {
        // This will be populated async after load
        return `
            <div id="qa-summary-content" style="display: flex; flex-wrap: wrap; gap: 10px; min-height: 40px;">
                <div style="color: #6b7280; font-size: 13px;">Loading quick answers...</div>
            </div>
        `;
    }
    
    /**
     * Load and display Quick Answers summary
     */
    async loadQuickAnswersSummary() {
        const summaryEl = document.getElementById('qa-summary-content');
        if (!summaryEl) return;
        
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            const response = await fetch(`/api/admin/quick-answers/${this.companyId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error('Failed to load');
            
            const result = await response.json();
            const answers = result.data || [];
            
            if (answers.length === 0) {
                summaryEl.innerHTML = `
                    <div style="color: #f59e0b; font-size: 13px;">
                        ⚠️ No quick answers configured — 
                        <a href="#" onclick="callFlowEngineManager.openQuickAnswers(); return false;" style="color: #3b82f6;">add some</a>
                        to help handle common questions.
                    </div>
                `;
                return;
            }
            
            // Show category counts
            const categories = {};
            answers.forEach(qa => {
                const cat = qa.category || 'general';
                categories[cat] = (categories[cat] || 0) + 1;
            });
            
            const categoryIcons = {
                hours: '🕐',
                pricing: '💰',
                service_area: '📍',
                services: '🔧',
                policies: '📋',
                general: '💬'
            };
            
            summaryEl.innerHTML = Object.entries(categories).map(([cat, count]) => `
                <div style="background: #f3f4f6; border-radius: 6px; padding: 6px 12px; font-size: 13px;">
                    ${categoryIcons[cat] || '💬'} ${cat.replace('_', ' ')}: <strong>${count}</strong>
                </div>
            `).join('') + `
                <div style="margin-left: auto; color: #22c55e; font-size: 13px; font-weight: 500;">
                    ✅ ${answers.length} answers ready
                </div>
            `;
            
        } catch (error) {
            console.error('[CALL FLOW ENGINE] Failed to load quick answers summary:', error);
            summaryEl.innerHTML = `<div style="color: #ef4444; font-size: 13px;">Failed to load quick answers</div>`;
        }
    }
    
    /**
     * Open Quick Answers management modal
     */
    async openQuickAnswers() {
        console.log('[CALL FLOW ENGINE] Opening Quick Answers');
        
        // Load the QuickAnswersManager script if not already loaded
        if (!window.QuickAnswersManager) {
            try {
                await this.loadScript('/js/ai-agent-settings/QuickAnswersManager.js');
                // Wait for class to be available (race condition fix)
                let retries = 0;
                while (!window.QuickAnswersManager && retries < 10) {
                    await new Promise(r => setTimeout(r, 50));
                    retries++;
                }
                if (!window.QuickAnswersManager) {
                    throw new Error('QuickAnswersManager not available after loading');
                }
                console.log('[CALL FLOW ENGINE] ✅ QuickAnswersManager script loaded');
            } catch (err) {
                console.error('[CALL FLOW ENGINE] ❌ Failed to load QuickAnswersManager:', err);
                alert('Failed to load Quick Answers. Please refresh and try again.');
                return;
            }
        }
        
        // Create modal backdrop
        const existingModal = document.getElementById('qa-modal-backdrop');
        if (existingModal) existingModal.remove();
        
        const modal = document.createElement('div');
        modal.id = 'qa-modal-backdrop';
        modal.innerHTML = `
            <style>
                #qa-modal-backdrop {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.7);
                    z-index: 9998;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .qa-modal {
                    background: #0d1117;
                    border-radius: 16px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
                    max-height: 90vh;
                    width: 700px;
                    max-width: 95%;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    animation: slideUp 0.2s ease-out;
                    border: 1px solid #30363d;
                }
                
                @keyframes slideUp {
                    from { transform: translateY(40px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                
                .qa-modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    border-bottom: 1px solid #30363d;
                    background: #161b22;
                }
                
                .qa-modal-header h2 {
                    margin: 0;
                    font-size: 1.1rem;
                    font-weight: 600;
                    color: #c9d1d9;
                }
                
                .qa-modal-close {
                    background: none;
                    border: none;
                    font-size: 20px;
                    cursor: pointer;
                    color: #8b949e;
                    padding: 4px 8px;
                    border-radius: 6px;
                }
                
                .qa-modal-close:hover {
                    background: #21262d;
                    color: #c9d1d9;
                }
                
                .qa-modal-body {
                    overflow-y: auto;
                    flex: 1;
                }
            </style>
            
            <div class="qa-modal">
                <div class="qa-modal-header">
                    <h2>❓ Quick Answers Manager</h2>
                    <button class="qa-modal-close" onclick="document.getElementById('qa-modal-backdrop').remove(); callFlowEngineManager.loadQuickAnswersSummary();">×</button>
                </div>
                <div class="qa-modal-body">
                    <div id="quickAnswersContainer" style="min-height: 300px;">
                        <div style="text-align: center; padding: 60px; color: #8b949e;">
                            <div style="font-size: 2rem; margin-bottom: 12px;">⏳</div>
                            <p>Loading quick answers...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                this.loadQuickAnswersSummary(); // Refresh summary on close
            }
        });
        
        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                this.loadQuickAnswersSummary();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        // Initialize and render the manager
        const manager = new window.QuickAnswersManager(this.companyId);
        await manager.load();
        
        const container = document.getElementById('quickAnswersContainer');
        if (container) {
            manager.render(container);
        }
    }
    
    // ========================================================================
    // BOOKING FIELDS MANAGEMENT
    // ========================================================================
    
    /**
     * Render booking field cards (compact view)
     */
    renderBookingFieldCards(fields) {
        if (!fields || !Array.isArray(fields) || fields.length === 0) {
            // Use defaults
            fields = [
                { key: 'name', label: 'Name', required: true, order: 1 },
                { key: 'phone', label: 'Phone', required: true, order: 2 },
                { key: 'address', label: 'Address', required: true, order: 3 },
                { key: 'serviceType', label: 'Service Type', required: false, order: 4 },
                { key: 'preferredTime', label: 'Preferred Time', required: false, order: 5 }
            ];
        }
        
        return fields
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map(f => {
                const required = f.required !== false;
                const emoji = this.getFieldEmoji(f.key);
                const bgColor = required ? '#f0fdf4' : '#f8fafc';
                const borderColor = required ? '#86efac' : '#e2e8f0';
                const hoverBorder = required ? '#22c55e' : '#94a3b8';
                
                return `
                    <div class="booking-field-card" 
                        data-key="${f.key}"
                        onclick="callFlowEngineManager.toggleBookingFieldRequired('${f.key}')"
                        title="Click to toggle Required/Optional"
                        style="
                            background: ${bgColor}; 
                            border: 2px solid ${borderColor}; 
                            border-radius: 8px; 
                            padding: 10px 14px;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            min-width: 120px;
                            cursor: pointer;
                            transition: all 0.15s ease;
                        "
                        onmouseover="this.style.borderColor='${hoverBorder}'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 6px rgba(0,0,0,0.1)'"
                        onmouseout="this.style.borderColor='${borderColor}'; this.style.transform='translateY(0)'; this.style.boxShadow='none'"
                    >
                        <span style="font-size: 16px;">${emoji}</span>
                        <div>
                            <strong style="color: #1f2937; font-size: 13px;">${f.label || f.key}</strong>
                            ${required 
                                ? '<span style="color: #dc2626; font-size: 11px; display: block;">Required ✓</span>' 
                                : '<span style="color: #9ca3af; font-size: 11px; display: block;">Optional</span>'}
                        </div>
                    </div>
                `;
            }).join('');
    }
    
    /**
     * Render booking field rows (expanded config view)
     */
    renderBookingFieldRows(fields) {
        if (!fields || !Array.isArray(fields) || fields.length === 0) {
            fields = [
                { key: 'name', label: 'Name', required: true, order: 1, prompt: 'May I have your name please?' },
                { key: 'phone', label: 'Phone', required: true, order: 2, prompt: "What's the best phone number to reach you?" },
                { key: 'address', label: 'Address', required: true, order: 3, prompt: "What's the service address?" },
                { key: 'serviceType', label: 'Service Type', required: false, order: 4, prompt: 'Is this for repair or maintenance?' },
                { key: 'preferredTime', label: 'Preferred Time', required: false, order: 5, prompt: 'When would you like us to come out?' }
            ];
        }
        
        return fields
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map(f => `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px;">
                        <input type="number" value="${f.order || 1}" min="1" max="10" 
                            style="width: 50px; padding: 4px; border: 1px solid #d1d5db; border-radius: 4px;"
                            onchange="callFlowEngineManager.updateBookingField('${f.key}', 'order', this.value)">
                    </td>
                    <td style="padding: 8px; font-weight: 600;">${this.getFieldEmoji(f.key)} ${f.label || f.key}</td>
                    <td style="padding: 8px;">
                        <input type="text" value="${f.prompt || ''}" 
                            style="width: 100%; padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px;"
                            placeholder="Enter prompt..."
                            onchange="callFlowEngineManager.updateBookingField('${f.key}', 'prompt', this.value)">
                    </td>
                    <td style="padding: 8px; text-align: center;">
                        <input type="checkbox" ${f.required !== false ? 'checked' : ''}
                            onchange="callFlowEngineManager.updateBookingField('${f.key}', 'required', this.checked)">
                    </td>
                    <td style="padding: 8px; text-align: center;">
                        <input type="checkbox" ${f.enabled !== false ? 'checked' : ''}
                            onchange="callFlowEngineManager.updateBookingField('${f.key}', 'enabled', this.checked)">
                    </td>
                </tr>
            `).join('');
    }
    
    /**
     * Get emoji for booking field
     */
    getFieldEmoji(key) {
        const emojis = {
            name: '👤',
            phone: '📞',
            address: '📍',
            serviceType: '🔧',
            preferredTime: '📅',
            email: '📧',
            notes: '📝'
        };
        return emojis[key] || '📋';
    }
    
    /**
     * Toggle booking fields config panel
     */
    toggleBookingFieldsConfig() {
        const panel = document.getElementById('booking-fields-config');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }
    }
    
    /**
     * Update a booking field property
     */
    /**
     * Toggle booking field required status (called when clicking cards)
     */
    toggleBookingFieldRequired(fieldKey) {
        this.ensureBookingFieldsExist();
        
        const field = this.config.bookingFields.find(f => f.key === fieldKey);
        if (field) {
            field.required = !field.required;
            this.markDirty();
            
            // Show visual feedback
            const status = field.required ? 'Required ✓' : 'Optional';
            this.showNotification(`${field.label || fieldKey}: ${status}`, 'info');
            
            // Re-render cards with animation
            const cardList = document.getElementById('booking-fields-list');
            if (cardList) {
                cardList.innerHTML = this.renderBookingFieldCards(this.config.bookingFields);
            }
        }
    }
    
    /**
     * Ensure bookingFields array exists with defaults
     */
    ensureBookingFieldsExist() {
        if (!this.config.bookingFields || !Array.isArray(this.config.bookingFields) || this.config.bookingFields.length === 0) {
            this.config.bookingFields = [
                { key: 'name', label: 'Name', required: true, order: 1, prompt: 'May I have your name please?' },
                { key: 'phone', label: 'Phone', required: true, order: 2, prompt: "What's the best phone number to reach you?" },
                { key: 'address', label: 'Address', required: true, order: 3, prompt: "What's the service address?" },
                { key: 'serviceType', label: 'Service Type', required: false, order: 4, prompt: 'Is this for repair or maintenance?' },
                { key: 'preferredTime', label: 'Preferred Time', required: false, order: 5, prompt: 'When would you like us to come out?' }
            ];
        }
    }
    
    updateBookingField(fieldKey, property, value) {
        this.ensureBookingFieldsExist();
        
        const field = this.config.bookingFields.find(f => f.key === fieldKey);
        if (field) {
            if (property === 'order') {
                field[property] = parseInt(value, 10);
            } else if (property === 'required' || property === 'enabled') {
                field[property] = !!value;
            } else {
                field[property] = value;
            }
            this.markDirty();
        }
        
        console.log('[CALL FLOW ENGINE] Updated booking field:', { fieldKey, property, value });
    }
    
    // ========================================================================
    // STYLES
    // ========================================================================
    getStyles() {
        return `
            .cfe-wrapper {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                color: #1f2937;
            }
            
            .cfe-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 24px;
                padding-bottom: 16px;
                border-bottom: 2px solid #e5e7eb;
            }
            
            .cfe-header-title h2 {
                font-size: 24px;
                font-weight: 700;
                color: #111827;
                margin: 0 0 4px;
            }
            
            .cfe-header-title h2 i {
                color: #6366f1;
                margin-right: 8px;
            }
            
            .cfe-header-title p {
                font-size: 14px;
                color: #6b7280;
                margin: 0;
            }
            
            .cfe-toggle-row {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
            }
            
            .cfe-toggle-label {
                font-weight: 600;
            }
            
            .cfe-grid {
                display: grid;
                grid-template-columns: 1fr 400px;
                gap: 24px;
            }
            
            .cfe-panel {
                background: #fff;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                padding: 20px;
            }
            
            .cfe-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
            }
            
            .cfe-panel-header h3 {
                font-size: 16px;
                font-weight: 600;
                margin: 0;
            }
            
            .cfe-hint {
                font-size: 13px;
                color: #6b7280;
                margin-bottom: 16px;
            }
            
            .cfe-btn {
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: 500;
                font-size: 14px;
                cursor: pointer;
                border: none;
                transition: all 0.2s;
            }
            
            .cfe-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .cfe-btn-primary {
                background: #6366f1;
                color: white;
            }
            
            .cfe-btn-primary:hover:not(:disabled) {
                background: #4f46e5;
            }
            
            .cfe-btn-secondary {
                background: #f3f4f6;
                color: #374151;
                border: 1px solid #d1d5db;
            }
            
            .cfe-btn-secondary:hover:not(:disabled) {
                background: #e5e7eb;
            }
            
            .cfe-btn-sm {
                padding: 4px 10px;
                font-size: 12px;
            }
            
            /* Trigger Sections */
            .cfe-trigger-sections {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            .cfe-trigger-section {
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                overflow: hidden;
            }
            
            .cfe-trigger-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                background: #f9fafb;
                cursor: pointer;
                transition: background 0.2s;
            }
            
            .cfe-trigger-header:hover {
                background: #f3f4f6;
            }
            
            .cfe-trigger-icon {
                font-size: 16px;
            }
            
            .cfe-trigger-label {
                font-weight: 600;
                font-size: 13px;
                flex: 1;
            }
            
            .cfe-trigger-count {
                font-size: 12px;
                color: #6b7280;
                background: #e5e7eb;
                padding: 2px 8px;
                border-radius: 10px;
            }
            
            .cfe-trigger-arrow {
                font-size: 10px;
                color: #9ca3af;
                transition: transform 0.2s;
            }
            
            .cfe-trigger-section.expanded .cfe-trigger-arrow {
                transform: rotate(90deg);
            }
            
            .cfe-trigger-body {
                display: none;
                padding: 12px;
                background: #fff;
                border-top: 1px solid #e5e7eb;
            }
            
            .cfe-trigger-section.expanded .cfe-trigger-body {
                display: block;
            }
            
            .cfe-trigger-group {
                margin-bottom: 12px;
            }
            
            .cfe-trigger-group:last-child {
                margin-bottom: 0;
            }
            
            .cfe-trigger-group-label {
                font-size: 11px;
                color: #6b7280;
                display: block;
                margin-bottom: 6px;
            }
            
            .cfe-trigger-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            
            .cfe-chip {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 10px;
                border-radius: 16px;
                font-size: 12px;
            }
            
            .cfe-chip-auto {
                background: #dbeafe;
                color: #1e40af;
            }
            
            .cfe-chip-manual {
                background: #dcfce7;
                color: #166534;
            }
            
            .cfe-chip-add {
                background: #f3f4f6;
                color: #374151;
                border: 1px dashed #9ca3af;
                cursor: pointer;
            }
            
            .cfe-chip-add:hover {
                background: #e5e7eb;
            }
            
            .cfe-chip-badge {
                font-size: 10px;
                opacity: 0.7;
            }
            
            .cfe-chip-remove {
                background: none;
                border: none;
                cursor: pointer;
                font-size: 14px;
                color: #166534;
                padding: 0;
                line-height: 1;
            }
            
            .cfe-chip-remove:hover {
                color: #dc2626;
            }
            
            .cfe-priority-note {
                margin-top: 16px;
                padding: 12px;
                background: #fef3c7;
                border: 1px solid #fcd34d;
                border-radius: 8px;
                font-size: 12px;
                color: #92400e;
            }
            
            /* Right Column */
            .cfe-right-column {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            
            /* Tester */
            .cfe-tester-input {
                display: flex;
                gap: 8px;
                margin-bottom: 16px;
            }
            
            .cfe-input, .cfe-select, .cfe-textarea {
                padding: 10px 12px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 14px;
                width: 100%;
            }
            
            .cfe-input:focus, .cfe-select:focus, .cfe-textarea:focus {
                outline: none;
                border-color: #6366f1;
                box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
            }
            
            .cfe-test-result {
                min-height: 120px;
            }
            
            .cfe-test-empty {
                color: #9ca3af;
                text-align: center;
                padding: 40px;
                font-style: italic;
            }
            
            .cfe-test-output {
                background: #f9fafb;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                padding: 16px;
            }
            
            .cfe-test-decision {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 12px;
            }
            
            .cfe-test-flow {
                font-weight: 700;
                font-size: 18px;
                padding: 6px 16px;
                border-radius: 6px;
            }
            
            .cfe-test-flow.booking { background: #dcfce7; color: #166534; }
            .cfe-test-flow.emergency { background: #fee2e2; color: #dc2626; }
            .cfe-test-flow.cancel { background: #fef3c7; color: #92400e; }
            .cfe-test-flow.reschedule { background: #dbeafe; color: #1e40af; }
            .cfe-test-flow.transfer { background: #f3e8ff; color: #7c3aed; }
            .cfe-test-flow.message { background: #e0e7ff; color: #4338ca; }
            .cfe-test-flow.general_inquiry { background: #f3f4f6; color: #6b7280; }
            
            .cfe-test-confidence {
                font-size: 14px;
                color: #6b7280;
            }
            
            .cfe-test-matches, .cfe-test-next-step, .cfe-test-secondary, .cfe-test-no-match {
                font-size: 13px;
                margin-bottom: 8px;
            }
            
            .cfe-test-no-match {
                color: #9ca3af;
                font-style: italic;
            }
            
            .cfe-chip-mini {
                font-size: 11px;
                padding: 2px 8px;
                background: #e5e7eb;
                color: #374151;
            }
            
            .cfe-chip-source {
                opacity: 0.6;
                margin-left: 4px;
            }
            
            /* Style Panel */
            .cfe-field {
                margin-bottom: 16px;
            }
            
            .cfe-field label {
                display: block;
                font-size: 13px;
                font-weight: 500;
                margin-bottom: 6px;
                color: #374151;
            }
            
            .cfe-word-count {
                font-weight: 400;
                color: #9ca3af;
            }
            
            /* Footer */
            .cfe-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 24px;
                padding-top: 16px;
                border-top: 1px solid #e5e7eb;
            }
            
            .cfe-last-updated {
                font-size: 12px;
                color: #9ca3af;
            }
            
            .cfe-footer-right {
                display: flex;
                gap: 12px;
            }
            
            @media (max-width: 1024px) {
                .cfe-grid {
                    grid-template-columns: 1fr;
                }
                
                .cfe-right-column {
                    order: -1;
                }
            }
        `;
    }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================
if (typeof window !== 'undefined') {
    window.CallFlowEngineManager = CallFlowEngineManager;
    window.callFlowEngineManager = new CallFlowEngineManager();
    console.log('[CALL FLOW ENGINE] ✅ Global instance created: window.callFlowEngineManager');
}

