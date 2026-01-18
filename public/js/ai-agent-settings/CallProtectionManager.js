// ============================================================================
// 🛡️ CALL PROTECTION MANAGER - Enterprise Edge Case UI
// ============================================================================
// PURPOSE: Manage call filtering rules (telemarketer, spam, vendor, abuse)
// 
// FEATURES:
//   - Pattern-based detection (keywords, regex)
//   - Action types: polite_hangup, force_transfer, override_response, flag_only
//   - Spam score bridge (react to SmartCallFilter scores)
//   - Side effects: auto-blacklist, auto-tag, notifications
//   - Time-based rules (after hours only, weekends only)
//
// BACKEND INTEGRATION:
//   - Saves to CheatSheetVersion.config.edgeCases[]
//   - Runtime: CheatSheetEngine.detectEdgeCase()
//   - Spam integration: SmartCallFilter → spamContext → edge case matching
//
// ============================================================================

class CallProtectionManager {
    constructor(companyId) {
        console.log(`🛡️ [CALL PROTECTION] Initializing for company: ${companyId}`);
        this.companyId = companyId;
        this.edgeCases = [];
        this.isDirty = false;
        this.versionId = null;
        
        // Predefined rule templates for quick setup
        this.ruleTemplates = {
            telemarketer: {
                name: 'Telemarketer Detection',
                description: 'Detects sales calls and politely ends the call',
                match: {
                    keywordsAny: ['solar', 'insurance', 'credit card', 'free vacation', 'qualify', 'lower your rate', 'warranty', 'extended warranty', 'google listing', 'SEO', 'marketing services']
                },
                action: {
                    type: 'polite_hangup',
                    hangupMessage: "Thank you for calling, but we're not interested at this time. Have a great day!"
                },
                sideEffects: {
                    autoBlacklist: true,
                    autoTag: ['telemarketer'],
                    logSeverity: 'warning'
                },
                priority: 5
            },
            vendorSales: {
                name: 'Vendor Sales Call',
                description: 'Detects B2B vendor sales attempts',
                match: {
                    keywordsAny: ['vendor', 'partnership', 'business opportunity', 'wholesale', 'supplier', 'representative calling']
                },
                action: {
                    type: 'override_response',
                    inlineResponse: "I appreciate your call, but our business inquiries are handled via email. Please send details to our office email. Thank you!"
                },
                sideEffects: {
                    autoTag: ['vendor-call'],
                    logSeverity: 'info'
                },
                priority: 8
            },
            spamHighRisk: {
                name: 'High-Risk Spam',
                description: 'Auto-hangup when spam score is very high',
                minSpamScore: 0.85,
                spamRequired: true,
                match: { keywordsAny: [] },
                action: {
                    type: 'polite_hangup',
                    hangupMessage: "Thank you for calling. Goodbye."
                },
                sideEffects: {
                    autoBlacklist: true,
                    autoTag: ['spam-blocked'],
                    logSeverity: 'critical'
                },
                priority: 1
            },
            machineDetection: {
                name: 'Machine/IVR Detection',
                description: 'Detects automated calling systems',
                match: {
                    keywordsAny: ['press 1', 'press one', 'hold for', 'please hold', 'this is an automated', 'recorded message', 'robo', 'robot']
                },
                action: {
                    type: 'polite_hangup',
                    hangupMessage: ""
                },
                sideEffects: {
                    autoBlacklist: false,
                    autoTag: ['machine-call'],
                    logSeverity: 'info'
                },
                priority: 2
            },
            silenceAbuse: {
                name: 'Silence/Abuse Detection',
                description: 'Handles silent calls or abusive language',
                match: {
                    keywordsAny: ['[silence]', '[no_speech]', 'fuck', 'shit', 'asshole', 'bitch']
                },
                action: {
                    type: 'polite_hangup',
                    hangupMessage: "I'm sorry, I'm not able to continue this call. Goodbye."
                },
                sideEffects: {
                    autoBlacklist: true,
                    autoTag: ['abuse'],
                    logSeverity: 'critical'
                },
                priority: 3
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════
    
    async init() {
        console.log('🛡️ [CALL PROTECTION] Loading edge cases...');
        await this.load();
        this.render();
    }

    async load() {
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error('❌ [CALL PROTECTION] No auth token');
                return;
            }

            // Load from CheatSheetVersion (live version)
            const res = await fetch(`/api/admin/cheatsheet/${this.companyId}/live`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                console.warn('⚠️ [CALL PROTECTION] No live cheatsheet, starting fresh');
                this.edgeCases = [];
                return;
            }

            const data = await res.json();
            this.edgeCases = data.config?.edgeCases || [];
            this.versionId = data._id || data.versionId;
            
            console.log(`✅ [CALL PROTECTION] Loaded ${this.edgeCases.length} edge cases`);
        } catch (error) {
            console.error('❌ [CALL PROTECTION] Load error:', error);
            this.edgeCases = [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // RENDER UI
    // ═══════════════════════════════════════════════════════════════════
    
    render() {
        const container = document.getElementById('edge-cases-list') || 
                         document.getElementById('call-protection-container');
        if (!container) {
            console.error('❌ [CALL PROTECTION] Container not found');
            return;
        }

        container.innerHTML = `
            <div style="margin-bottom: 20px;">
                <!-- Quick Add Templates -->
                <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
                    <h3 style="margin: 0 0 12px 0; color: #fff; font-size: 14px; font-weight: 600;">
                        <i class="fas fa-magic"></i> Quick Add Protection Rules
                    </h3>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        ${this.renderTemplateButtons()}
                    </div>
                </div>

                <!-- Save Button -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div style="color: #64748b; font-size: 13px;">
                        <i class="fas fa-shield-alt"></i> 
                        ${this.edgeCases.length} protection rule${this.edgeCases.length !== 1 ? 's' : ''} configured
                        ${this.isDirty ? '<span style="color: #f59e0b; font-weight: 600;"> • Unsaved changes</span>' : ''}
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="window.callProtectionManager.addCustomRule()" 
                            style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">
                            <i class="fas fa-plus"></i> Add Custom Rule
                        </button>
                        <button onclick="window.callProtectionManager.save()" 
                            style="background: ${this.isDirty ? '#3b82f6' : '#94a3b8'}; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;"
                            ${this.isDirty ? '' : 'disabled'}>
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                    </div>
                </div>
            </div>

            <!-- Edge Cases List -->
            <div id="edge-cases-cards" style="display: flex; flex-direction: column; gap: 12px;">
                ${this.edgeCases.length === 0 ? this.renderEmptyState() : this.renderEdgeCaseCards()}
            </div>
        `;
    }

    renderTemplateButtons() {
        return Object.entries(this.ruleTemplates).map(([key, template]) => `
            <button onclick="window.callProtectionManager.addFromTemplate('${key}')"
                style="background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.3); 
                       padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer;
                       transition: all 0.2s ease;"
                onmouseover="this.style.background='rgba(255,255,255,0.25)'"
                onmouseout="this.style.background='rgba(255,255,255,0.15)'">
                ${this.getTemplateIcon(key)} ${template.name}
            </button>
        `).join('');
    }

    getTemplateIcon(key) {
        const icons = {
            telemarketer: '📞',
            vendorSales: '🏢',
            spamHighRisk: '🚫',
            machineDetection: '🤖',
            silenceAbuse: '🔇'
        };
        return icons[key] || '📋';
    }

    renderEmptyState() {
        return `
            <div style="text-align: center; padding: 48px 24px; background: #f8fafc; border-radius: 12px; border: 2px dashed #e2e8f0;">
                <i class="fas fa-shield-alt" style="font-size: 48px; color: #cbd5e1; margin-bottom: 16px;"></i>
                <h3 style="margin: 0 0 8px 0; color: #475569; font-size: 16px;">No Protection Rules Yet</h3>
                <p style="margin: 0; color: #94a3b8; font-size: 13px;">
                    Use the quick-add templates above to protect against spam, telemarketers, and abuse calls.
                </p>
            </div>
        `;
    }

    renderEdgeCaseCards() {
        return this.edgeCases.map((ec, index) => this.renderEdgeCaseCard(ec, index)).join('');
    }

    renderEdgeCaseCard(ec, index) {
        const actionType = ec.action?.type || 'override_response';
        const actionColors = {
            'polite_hangup': { bg: '#fef2f2', border: '#fecaca', icon: '🚫', label: 'Polite Hangup' },
            'force_transfer': { bg: '#eff6ff', border: '#bfdbfe', icon: '📞', label: 'Force Transfer' },
            'override_response': { bg: '#f0fdf4', border: '#bbf7d0', icon: '💬', label: 'Custom Response' },
            'flag_only': { bg: '#fefce8', border: '#fef08a', icon: '🏷️', label: 'Flag Only' }
        };
        const actionStyle = actionColors[actionType] || actionColors['override_response'];
        
        const keywords = ec.match?.keywordsAny || ec.triggerPatterns || [];
        const hasSpamBridge = ec.minSpamScore != null || ec.spamRequired;

        return `
            <div style="background: ${actionStyle.bg}; border: 1px solid ${actionStyle.border}; border-radius: 12px; padding: 16px; position: relative;">
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                            <span style="font-size: 20px;">${actionStyle.icon}</span>
                            <input type="text" value="${this.escapeHtml(ec.name || 'Unnamed Rule')}"
                                onchange="window.callProtectionManager.updateField(${index}, 'name', this.value)"
                                style="font-size: 15px; font-weight: 600; color: #1e293b; border: none; background: transparent; 
                                       border-bottom: 1px dashed transparent; padding: 2px 0; flex: 1;"
                                onfocus="this.style.borderBottom='1px dashed #94a3b8'"
                                onblur="this.style.borderBottom='1px dashed transparent'">
                        </div>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <span style="background: ${actionStyle.border}; color: #1e293b; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;">
                                ${actionStyle.label}
                            </span>
                            <span style="background: #e2e8f0; color: #475569; padding: 2px 8px; border-radius: 4px; font-size: 11px;">
                                Priority: ${ec.priority || 10}
                            </span>
                            ${hasSpamBridge ? `<span style="background: #fbbf24; color: #78350f; padding: 2px 8px; border-radius: 4px; font-size: 11px;">
                                🔗 Spam Bridge Active
                            </span>` : ''}
                            ${ec.sideEffects?.autoBlacklist ? `<span style="background: #ef4444; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px;">
                                Auto-Blacklist
                            </span>` : ''}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #64748b;">
                            <input type="checkbox" ${ec.enabled !== false ? 'checked' : ''}
                                onchange="window.callProtectionManager.updateField(${index}, 'enabled', this.checked)">
                            Enabled
                        </label>
                        <button onclick="window.callProtectionManager.toggleExpand(${index})"
                            style="background: none; border: none; color: #64748b; cursor: pointer; padding: 4px;">
                            <i class="fas fa-chevron-down" id="expand-icon-${index}"></i>
                        </button>
                        <button onclick="window.callProtectionManager.removeRule(${index})"
                            style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>

                <!-- Keywords Preview -->
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">
                        Detection Keywords
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${keywords.slice(0, 6).map(kw => `
                            <span style="background: white; border: 1px solid #e2e8f0; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-family: monospace;">
                                ${this.escapeHtml(kw)}
                            </span>
                        `).join('')}
                        ${keywords.length > 6 ? `<span style="color: #94a3b8; font-size: 11px;">+${keywords.length - 6} more</span>` : ''}
                    </div>
                </div>

                <!-- Expandable Details -->
                <div id="expand-section-${index}" style="display: none; border-top: 1px solid ${actionStyle.border}; padding-top: 12px; margin-top: 12px;">
                    ${this.renderExpandedSection(ec, index)}
                </div>
            </div>
        `;
    }

    renderExpandedSection(ec, index) {
        const actionType = ec.action?.type || 'override_response';
        const keywords = ec.match?.keywordsAny || ec.triggerPatterns || [];

        return `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
                <!-- Keywords Section -->
                <div>
                    <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                        Detection Keywords (one per line)
                    </label>
                    <textarea rows="4"
                        onchange="window.callProtectionManager.updateKeywords(${index}, this.value)"
                        style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 12px; font-family: monospace;"
                        placeholder="solar&#10;insurance&#10;free vacation">${keywords.join('\n')}</textarea>
                </div>

                <!-- Action Configuration -->
                <div>
                    <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                        Action Type
                    </label>
                    <select onchange="window.callProtectionManager.updateAction(${index}, 'type', this.value)"
                        style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 12px; margin-bottom: 8px;">
                        <option value="polite_hangup" ${actionType === 'polite_hangup' ? 'selected' : ''}>🚫 Polite Hangup</option>
                        <option value="force_transfer" ${actionType === 'force_transfer' ? 'selected' : ''}>📞 Force Transfer</option>
                        <option value="override_response" ${actionType === 'override_response' ? 'selected' : ''}>💬 Custom Response</option>
                        <option value="flag_only" ${actionType === 'flag_only' ? 'selected' : ''}>🏷️ Flag Only (log & continue)</option>
                    </select>

                    ${actionType === 'polite_hangup' || actionType === 'override_response' ? `
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                            ${actionType === 'polite_hangup' ? 'Hangup Message' : 'Response Message'}
                        </label>
                        <textarea rows="2"
                            onchange="window.callProtectionManager.updateAction(${index}, '${actionType === 'polite_hangup' ? 'hangupMessage' : 'inlineResponse'}', this.value)"
                            style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 12px;"
                            placeholder="${actionType === 'polite_hangup' ? 'Thank you for calling. Goodbye!' : 'I appreciate your call, but...'}">${this.escapeHtml(ec.action?.hangupMessage || ec.action?.inlineResponse || ec.responseText || '')}</textarea>
                    ` : ''}

                    ${actionType === 'force_transfer' ? `
                        <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                            Transfer Target
                        </label>
                        <input type="text" 
                            value="${this.escapeHtml(ec.action?.transferTarget || '')}"
                            onchange="window.callProtectionManager.updateAction(${index}, 'transferTarget', this.value)"
                            style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 12px; margin-bottom: 8px;"
                            placeholder="manager, +15551234567">
                    ` : ''}
                </div>

                <!-- Side Effects & Spam Bridge -->
                <div>
                    <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                        Side Effects
                    </label>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #4b5563;">
                            <input type="checkbox" ${ec.sideEffects?.autoBlacklist ? 'checked' : ''}
                                onchange="window.callProtectionManager.updateSideEffect(${index}, 'autoBlacklist', this.checked)">
                            Auto-blacklist caller number
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #4b5563;">
                            <input type="checkbox" ${ec.spamRequired ? 'checked' : ''}
                                onchange="window.callProtectionManager.updateField(${index}, 'spamRequired', this.checked)">
                            Requires spam detection flag
                        </label>
                    </div>

                    <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-top: 12px; margin-bottom: 6px;">
                        Minimum Spam Score (0-1, leave empty to disable)
                    </label>
                    <input type="number" step="0.05" min="0" max="1"
                        value="${ec.minSpamScore ?? ''}"
                        onchange="window.callProtectionManager.updateField(${index}, 'minSpamScore', this.value ? parseFloat(this.value) : null)"
                        style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 12px;"
                        placeholder="e.g., 0.85">
                    
                    <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-top: 12px; margin-bottom: 6px;">
                        Priority (1-100, lower = higher priority)
                    </label>
                    <input type="number" min="1" max="100"
                        value="${ec.priority || 10}"
                        onchange="window.callProtectionManager.updateField(${index}, 'priority', parseInt(this.value))"
                        style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 12px;">
                </div>
            </div>
        `;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ACTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    toggleExpand(index) {
        const section = document.getElementById(`expand-section-${index}`);
        const icon = document.getElementById(`expand-icon-${index}`);
        if (section) {
            const isHidden = section.style.display === 'none';
            section.style.display = isHidden ? 'block' : 'none';
            if (icon) {
                icon.className = isHidden ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
            }
        }
    }

    addFromTemplate(templateKey) {
        const template = this.ruleTemplates[templateKey];
        if (!template) return;

        // Check if already exists
        const exists = this.edgeCases.some(ec => 
            ec.name === template.name || 
            (ec.match?.keywordsAny?.join(',') === template.match?.keywordsAny?.join(','))
        );
        
        if (exists) {
            alert(`A "${template.name}" rule already exists!`);
            return;
        }

        const newEdgeCase = {
            id: `ec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: template.name,
            description: template.description,
            enabled: true,
            priority: template.priority,
            match: { ...template.match },
            action: { ...template.action },
            sideEffects: { ...template.sideEffects },
            minSpamScore: template.minSpamScore ?? null,
            spamRequired: template.spamRequired ?? false
        };

        this.edgeCases.unshift(newEdgeCase);
        this.markDirty();
        this.render();
        
        console.log(`✅ [CALL PROTECTION] Added template: ${template.name}`);
    }

    addCustomRule() {
        const newEdgeCase = {
            id: `ec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: 'New Protection Rule',
            description: '',
            enabled: true,
            priority: 10,
            match: { keywordsAny: [] },
            action: { type: 'polite_hangup', hangupMessage: 'Thank you for calling. Goodbye!' },
            sideEffects: { autoBlacklist: false, autoTag: [], logSeverity: 'info' }
        };

        this.edgeCases.unshift(newEdgeCase);
        this.markDirty();
        this.render();
        
        // Auto-expand the new rule
        setTimeout(() => this.toggleExpand(0), 100);
    }

    removeRule(index) {
        if (confirm('Are you sure you want to remove this protection rule?')) {
            this.edgeCases.splice(index, 1);
            this.markDirty();
            this.render();
        }
    }

    updateField(index, field, value) {
        if (this.edgeCases[index]) {
            this.edgeCases[index][field] = value;
            this.markDirty();
        }
    }

    updateKeywords(index, value) {
        if (this.edgeCases[index]) {
            const keywords = value.split('\n').map(k => k.trim()).filter(Boolean);
            if (!this.edgeCases[index].match) {
                this.edgeCases[index].match = {};
            }
            this.edgeCases[index].match.keywordsAny = keywords;
            // Also set legacy field for backward compat
            this.edgeCases[index].triggerPatterns = keywords;
            this.markDirty();
        }
    }

    updateAction(index, field, value) {
        if (this.edgeCases[index]) {
            if (!this.edgeCases[index].action) {
                this.edgeCases[index].action = {};
            }
            this.edgeCases[index].action[field] = value;
            
            // Update legacy field for backward compat
            if (field === 'inlineResponse' || field === 'hangupMessage') {
                this.edgeCases[index].responseText = value;
            }
            
            this.markDirty();
            
            // Re-render if action type changed (to show different fields)
            if (field === 'type') {
                this.render();
                setTimeout(() => this.toggleExpand(index), 100);
            }
        }
    }

    updateSideEffect(index, field, value) {
        if (this.edgeCases[index]) {
            if (!this.edgeCases[index].sideEffects) {
                this.edgeCases[index].sideEffects = {};
            }
            this.edgeCases[index].sideEffects[field] = value;
            this.markDirty();
        }
    }

    markDirty() {
        this.isDirty = true;
        // Update save button state
        const saveBtn = document.querySelector('button[onclick*="save()"]');
        if (saveBtn) {
            saveBtn.style.background = '#3b82f6';
            saveBtn.disabled = false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // SAVE
    // ═══════════════════════════════════════════════════════════════════
    
    async save() {
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                alert('Not authenticated');
                return;
            }

            console.log('💾 [CALL PROTECTION] Saving edge cases...');

            // Save to CheatSheetVersion
            const res = await fetch(`/api/admin/cheatsheet/${this.companyId}/edge-cases`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ edgeCases: this.edgeCases })
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || 'Failed to save');
            }

            this.isDirty = false;
            this.render();
            
            console.log('✅ [CALL PROTECTION] Saved successfully');
            
            // Show success toast
            this.showToast('Protection rules saved successfully!', 'success');

        } catch (error) {
            console.error('❌ [CALL PROTECTION] Save error:', error);
            this.showToast(`Save failed: ${error.message}`, 'error');
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 12px 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white; border-radius: 8px; font-size: 14px; font-weight: 500;
            z-index: 10000; animation: slideIn 0.3s ease;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for global access
window.CallProtectionManager = CallProtectionManager;
