/**
 * STTSettingsManager.js - STT Settings UI Controller
 * 
 * Manages the STT Profile configuration UI in Control Plane:
 * - Provider & Model settings
 * - Fillers (noise removal)
 * - Vocabulary (boosted keywords)
 * - Corrections (mishear map)
 * - Suggestions (Black Box learning queue)
 * - Test widget
 * 
 * @module public/js/ai-agent-settings/STTSettingsManager
 * @version 1.0.0
 */

class STTSettingsManager {
    constructor(containerId, companyId, templateId = null) {
        this.container = typeof containerId === 'string' 
            ? document.getElementById(containerId) 
            : containerId;
        this.companyId = companyId;
        this.templateId = templateId;
        this.profile = null;
        this.metrics = null;
        this.activeTab = 'provider';
        
        if (!this.container) {
            console.error('[STT SETTINGS] Container not found:', containerId);
            return;
        }
        
        console.log('[STT SETTINGS] Manager initialized', { companyId, templateId });
        this.init();
    }
    
    async init() {
        try {
            // If no templateId, get it from company
            if (!this.templateId) {
                await this.fetchCompanyTemplate();
            }
            
            if (!this.templateId) {
                this.renderNoTemplate();
                return;
            }
            
            await this.loadProfile();
            this.render();
        } catch (error) {
            console.error('[STT SETTINGS] Init failed:', error);
            this.renderError(error.message);
        }
    }
    
    async fetchCompanyTemplate() {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        const response = await fetch(`/api/company/${this.companyId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            this.templateId = data.company?.aiAgentSettings?.activeTemplateId || 
                              data.company?.aiAgentSettings?.selectedGlobalTemplateId ||
                              data.company?.selectedTemplate?.templateId;
            console.log('[STT SETTINGS] Template ID from company:', this.templateId);
        }
    }
    
    async loadProfile() {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        const [profileRes, metricsRes] = await Promise.all([
            fetch(`/api/admin/stt-profile/${this.templateId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`/api/admin/stt-profile/${this.templateId}/metrics`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
        ]);
        
        if (!profileRes.ok) {
            throw new Error('Failed to load STT profile');
        }
        
        const profileData = await profileRes.json();
        this.profile = profileData.data;
        
        if (metricsRes.ok) {
            const metricsData = await metricsRes.json();
            this.metrics = metricsData.data;
        }
        
        console.log('[STT SETTINGS] Profile loaded:', {
            templateName: this.profile.templateName,
            fillers: this.profile.fillers?.length,
            keywords: this.profile.vocabulary?.boostedKeywords?.length,
            corrections: this.profile.corrections?.length,
            suggestions: this.profile.suggestions?.filter(s => s.status === 'pending').length
        });
    }
    
    renderNoTemplate() {
        this.container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                <div style="font-size: 64px; margin-bottom: 20px;">🎤</div>
                <h2 style="color: var(--text-primary); margin-bottom: 12px;">No Template Selected</h2>
                <p>STT Settings are configured per template. Please select a Global Template in the AI Brain tab first.</p>
            </div>
        `;
    }
    
    renderError(message) {
        this.container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: var(--accent-red);">
                <div style="font-size: 64px; margin-bottom: 20px;">⚠️</div>
                <h2 style="color: var(--text-primary); margin-bottom: 12px;">Error Loading STT Settings</h2>
                <p>${message}</p>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: var(--accent-blue); color: white; border: none; border-radius: 8px; cursor: pointer;">
                    Retry
                </button>
            </div>
        `;
    }
    
    render() {
        const pendingSuggestions = this.profile.suggestions?.filter(s => s.status === 'pending').length || 0;
        
        this.container.innerHTML = `
            <div class="stt-settings-wrapper" style="padding: 20px;">
                <!-- Header -->
                <div style="margin-bottom: 24px;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                        <span style="font-size: 32px;">🎤</span>
                        <h1 style="margin: 0; font-size: 24px;">STT Intelligence</h1>
                        <span style="background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px;">
                            Enterprise
                        </span>
                    </div>
                    <p style="color: var(--text-secondary); margin: 0;">
                        Speech-to-Text correction for <strong>${this.profile.templateName}</strong>
                    </p>
                </div>
                
                <!-- Stats Row -->
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 24px;">
                    ${this.renderStatCard('Fillers', this.profile.fillers?.length || 0, '🔇', '#6366f1')}
                    ${this.renderStatCard('Keywords', this.profile.vocabulary?.boostedKeywords?.length || 0, '🎯', '#10b981')}
                    ${this.renderStatCard('Corrections', this.profile.corrections?.length || 0, '🔄', '#f59e0b')}
                    ${this.renderStatCard('Impossible', this.profile.impossibleWords?.length || 0, '🚫', '#ef4444')}
                    ${this.renderStatCard('Suggestions', pendingSuggestions, '💡', pendingSuggestions > 0 ? '#ec4899' : '#6b7280')}
                </div>
                
                <!-- Tab Navigation -->
                <div style="display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">
                    ${this.renderTab('provider', '⚙️ Provider', this.activeTab === 'provider')}
                    ${this.renderTab('fillers', '🔇 Fillers', this.activeTab === 'fillers')}
                    ${this.renderTab('vocabulary', '🎯 Vocabulary', this.activeTab === 'vocabulary')}
                    ${this.renderTab('corrections', '🔄 Corrections', this.activeTab === 'corrections')}
                    ${this.renderTab('impossible', '🚫 Impossible', this.activeTab === 'impossible')}
                    ${this.renderTab('suggestions', '💡 Suggestions', this.activeTab === 'suggestions', pendingSuggestions)}
                    ${this.renderTab('test', '🧪 Test', this.activeTab === 'test')}
                </div>
                
                <!-- Tab Content -->
                <div id="stt-tab-content">
                    ${this.renderTabContent()}
                </div>
            </div>
        `;
        
        this.attachEventListeners();
    }
    
    renderStatCard(label, value, icon, color) {
        return `
            <div style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; text-align: center;">
                <div style="font-size: 24px; margin-bottom: 4px;">${icon}</div>
                <div style="font-size: 24px; font-weight: bold; color: ${color};">${value}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${label}</div>
            </div>
        `;
    }
    
    renderTab(id, label, active, badge = 0) {
        return `
            <button class="stt-tab ${active ? 'active' : ''}" data-tab="${id}" style="
                padding: 10px 16px;
                background: ${active ? 'var(--accent-blue)' : 'transparent'};
                color: ${active ? 'white' : 'var(--text-secondary)'};
                border: none;
                border-radius: 8px 8px 0 0;
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s;
            ">
                ${label}
                ${badge > 0 ? `<span style="background: #ec4899; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px;">${badge}</span>` : ''}
            </button>
        `;
    }
    
    renderTabContent() {
        switch (this.activeTab) {
            case 'provider': return this.renderProviderTab();
            case 'fillers': return this.renderFillersTab();
            case 'vocabulary': return this.renderVocabularyTab();
            case 'corrections': return this.renderCorrectionsTab();
            case 'impossible': return this.renderImpossibleTab();
            case 'suggestions': return this.renderSuggestionsTab();
            case 'test': return this.renderTestTab();
            default: return '<p>Unknown tab</p>';
        }
    }
    
    renderProviderTab() {
        const provider = this.profile.provider || {};
        return `
            <div style="max-width: 600px;">
                <h3 style="margin-bottom: 16px;">Provider & Model Settings</h3>
                
                <div style="display: grid; gap: 16px;">
                    <div>
                        <label style="display: block; margin-bottom: 4px; font-weight: 500;">STT Provider</label>
                        <select id="stt-provider-type" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--input-bg);">
                            <option value="twilio" ${provider.type === 'twilio' ? 'selected' : ''}>Twilio (Current)</option>
                            <option value="deepgram" ${provider.type === 'deepgram' ? 'selected' : ''}>Deepgram (Future)</option>
                            <option value="google" ${provider.type === 'google' ? 'selected' : ''}>Google (Future)</option>
                        </select>
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 4px; font-weight: 500;">Language</label>
                        <select id="stt-language" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--input-bg);">
                            <option value="en-US" ${provider.language === 'en-US' ? 'selected' : ''}>English (US)</option>
                            <option value="en-GB" ${provider.language === 'en-GB' ? 'selected' : ''}>English (UK)</option>
                            <option value="es-US" ${provider.language === 'es-US' ? 'selected' : ''}>Spanish (US)</option>
                        </select>
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 4px; font-weight: 500;">Model</label>
                        <select id="stt-model" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--input-bg);">
                            <option value="phone_call" ${provider.model === 'phone_call' ? 'selected' : ''}>Phone Call (Recommended)</option>
                            <option value="default" ${provider.model === 'default' ? 'selected' : ''}>Default</option>
                            <option value="enhanced" ${provider.model === 'enhanced' ? 'selected' : ''}>Enhanced</option>
                        </select>
                    </div>
                    
                    <div style="border-top: 1px solid var(--border-color); padding-top: 16px;">
                        <h4 style="margin-bottom: 12px;">Feature Toggles</h4>
                        
                        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer;">
                            <input type="checkbox" id="stt-use-hints" ${provider.useHints ? 'checked' : ''}>
                            <span>Use vocabulary as STT hints</span>
                        </label>
                        
                        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer;">
                            <input type="checkbox" id="stt-apply-fillers" ${provider.applyFillers !== false ? 'checked' : ''}>
                            <span>Strip filler words before AI processing</span>
                        </label>
                        
                        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer;">
                            <input type="checkbox" id="stt-apply-corrections" ${provider.applyCorrections !== false ? 'checked' : ''}>
                            <span>Apply mishear corrections</span>
                        </label>
                        
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="stt-apply-impossible" ${provider.applyImpossibleWords !== false ? 'checked' : ''}>
                            <span>Detect impossible words</span>
                        </label>
                    </div>
                    
                    <button onclick="sttManager.saveProviderSettings()" style="
                        padding: 12px 24px;
                        background: var(--accent-blue);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-weight: 500;
                        margin-top: 8px;
                    ">
                        Save Provider Settings
                    </button>
                </div>
            </div>
        `;
    }
    
    renderFillersTab() {
        const fillers = this.profile.fillers || [];
        return `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3>Filler Words / Noise Removal</h3>
                    <button onclick="sttManager.showAddFillerModal()" style="
                        padding: 8px 16px;
                        background: var(--accent-green);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                    ">
                        + Add Filler
                    </button>
                </div>
                <p style="color: var(--text-secondary); margin-bottom: 16px;">
                    These words are stripped from transcripts before AI processing.
                </p>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--card-bg); border-bottom: 1px solid var(--border-color);">
                                <th style="text-align: left; padding: 12px;">Enabled</th>
                                <th style="text-align: left; padding: 12px;">Phrase</th>
                                <th style="text-align: left; padding: 12px;">Scope</th>
                                <th style="text-align: left; padding: 12px;">Added By</th>
                                <th style="text-align: center; padding: 12px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${fillers.map((f, i) => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 12px;">
                                        <input type="checkbox" ${f.enabled ? 'checked' : ''} onchange="sttManager.toggleFiller('${f.phrase}')">
                                    </td>
                                    <td style="padding: 12px; font-family: monospace;">${this.escapeHtml(f.phrase)}</td>
                                    <td style="padding: 12px;">
                                        <span style="background: ${f.scope === 'global' ? '#6366f1' : '#10b981'}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                                            ${f.scope}
                                        </span>
                                    </td>
                                    <td style="padding: 12px; color: var(--text-secondary);">${f.addedBy || 'system'}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        <button onclick="sttManager.deleteFiller('${f.phrase}')" style="background: none; border: none; color: var(--accent-red); cursor: pointer;">🗑️</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
    
    renderVocabularyTab() {
        const keywords = this.profile.vocabulary?.boostedKeywords || [];
        return `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3>Boosted Vocabulary / Keywords</h3>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="sttManager.syncVocabulary()" style="
                            padding: 8px 16px;
                            background: var(--accent-blue);
                            color: white;
                            border: none;
                            border-radius: 8px;
                            cursor: pointer;
                        ">
                            🔄 Sync from Template
                        </button>
                        <button onclick="sttManager.showAddKeywordModal()" style="
                            padding: 8px 16px;
                            background: var(--accent-green);
                            color: white;
                            border: none;
                            border-radius: 8px;
                            cursor: pointer;
                        ">
                            + Add Keyword
                        </button>
                    </div>
                </div>
                <p style="color: var(--text-secondary); margin-bottom: 16px;">
                    These words are sent as hints to improve STT accuracy.
                </p>
                
                <div style="overflow-x: auto; max-height: 500px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead style="position: sticky; top: 0; background: var(--bg-primary);">
                            <tr style="background: var(--card-bg); border-bottom: 1px solid var(--border-color);">
                                <th style="text-align: left; padding: 12px;">Phrase</th>
                                <th style="text-align: left; padding: 12px;">Type</th>
                                <th style="text-align: left; padding: 12px;">Source</th>
                                <th style="text-align: center; padding: 12px;">Weight</th>
                                <th style="text-align: center; padding: 12px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${keywords.slice(0, 100).map(k => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 12px; font-family: monospace;">${this.escapeHtml(k.phrase)}</td>
                                    <td style="padding: 12px;">
                                        <span style="background: ${this.getTypeColor(k.type)}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                                            ${k.type}
                                        </span>
                                    </td>
                                    <td style="padding: 12px; color: var(--text-secondary); max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(k.source || '-')}</td>
                                    <td style="padding: 12px; text-align: center;">${k.boostWeight || 5}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        ${k.type === 'manual' ? `<button onclick="sttManager.deleteKeyword('${k.phrase}')" style="background: none; border: none; color: var(--accent-red); cursor: pointer;">🗑️</button>` : '-'}
                                    </td>
                                </tr>
                            `).join('')}
                            ${keywords.length > 100 ? `
                                <tr>
                                    <td colspan="5" style="padding: 12px; text-align: center; color: var(--text-secondary);">
                                        ... and ${keywords.length - 100} more keywords
                                    </td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
    
    renderCorrectionsTab() {
        const corrections = this.profile.corrections || [];
        return `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3>Mishear Corrections</h3>
                    <button onclick="sttManager.showAddCorrectionModal()" style="
                        padding: 8px 16px;
                        background: var(--accent-green);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                    ">
                        + Add Correction
                    </button>
                </div>
                <p style="color: var(--text-secondary); margin-bottom: 16px;">
                    Map commonly misheard words to their correct form.
                </p>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--card-bg); border-bottom: 1px solid var(--border-color);">
                                <th style="text-align: left; padding: 12px;">Enabled</th>
                                <th style="text-align: left; padding: 12px;">Heard As</th>
                                <th style="text-align: left; padding: 12px;">→</th>
                                <th style="text-align: left; padding: 12px;">Correct To</th>
                                <th style="text-align: left; padding: 12px;">Context</th>
                                <th style="text-align: center; padding: 12px;">Occurrences</th>
                                <th style="text-align: center; padding: 12px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${corrections.map(c => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 12px;">
                                        <input type="checkbox" ${c.enabled ? 'checked' : ''}>
                                    </td>
                                    <td style="padding: 12px; font-family: monospace; color: var(--accent-red);">${this.escapeHtml(c.heard)}</td>
                                    <td style="padding: 12px;">→</td>
                                    <td style="padding: 12px; font-family: monospace; color: var(--accent-green);">${this.escapeHtml(c.normalized)}</td>
                                    <td style="padding: 12px; color: var(--text-secondary);">
                                        ${c.context?.length ? c.context.join(', ') : 'Any context'}
                                    </td>
                                    <td style="padding: 12px; text-align: center;">${c.occurrences || 0}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        <button onclick="sttManager.deleteCorrection('${c.heard}')" style="background: none; border: none; color: var(--accent-red); cursor: pointer;">🗑️</button>
                                    </td>
                                </tr>
                            `).join('')}
                            ${corrections.length === 0 ? `
                                <tr>
                                    <td colspan="7" style="padding: 24px; text-align: center; color: var(--text-secondary);">
                                        No corrections yet. Add one or wait for Black Box suggestions.
                                    </td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
    
    renderImpossibleTab() {
        const impossibleWords = this.profile.impossibleWords || [];
        return `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3>Impossible Words</h3>
                    <button onclick="sttManager.showAddImpossibleModal()" style="
                        padding: 8px 16px;
                        background: var(--accent-green);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                    ">
                        + Add Impossible Word
                    </button>
                </div>
                <p style="color: var(--text-secondary); margin-bottom: 16px;">
                    Words that should never appear in this template's context (e.g., "toothache" in HVAC).
                </p>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--card-bg); border-bottom: 1px solid var(--border-color);">
                                <th style="text-align: left; padding: 12px;">Word</th>
                                <th style="text-align: left; padding: 12px;">Reason</th>
                                <th style="text-align: left; padding: 12px;">Suggest Instead</th>
                                <th style="text-align: center; padding: 12px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${impossibleWords.map(iw => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 12px; font-family: monospace; color: var(--accent-red);">${this.escapeHtml(iw.word)}</td>
                                    <td style="padding: 12px; color: var(--text-secondary);">${this.escapeHtml(iw.reason || '-')}</td>
                                    <td style="padding: 12px; font-family: monospace; color: var(--accent-green);">${this.escapeHtml(iw.suggestCorrection || '-')}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        <button onclick="sttManager.deleteImpossible('${iw.word}')" style="background: none; border: none; color: var(--accent-red); cursor: pointer;">🗑️</button>
                                    </td>
                                </tr>
                            `).join('')}
                            ${impossibleWords.length === 0 ? `
                                <tr>
                                    <td colspan="4" style="padding: 24px; text-align: center; color: var(--text-secondary);">
                                        No impossible words defined yet.
                                    </td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
    
    renderSuggestionsTab() {
        const suggestions = (this.profile.suggestions || []).filter(s => s.status === 'pending');
        return `
            <div>
                <h3 style="margin-bottom: 8px;">Suggestions from Black Box</h3>
                <p style="color: var(--text-secondary); margin-bottom: 16px;">
                    Patterns detected from real calls. Approve to add to your STT intelligence.
                </p>
                
                ${suggestions.length === 0 ? `
                    <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                        <div style="font-size: 48px; margin-bottom: 12px;">✨</div>
                        <p>No pending suggestions. Make some calls to generate learning data!</p>
                    </div>
                ` : `
                    <div style="display: grid; gap: 12px;">
                        ${suggestions.map((s, i) => `
                            <div style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px;">
                                <div style="display: flex; justify-content: space-between; align-items: start;">
                                    <div>
                                        <span style="background: ${this.getSuggestionTypeColor(s.type)}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                                            ${s.type}
                                        </span>
                                        <span style="font-family: monospace; font-size: 18px; margin-left: 12px;">"${this.escapeHtml(s.phrase)}"</span>
                                    </div>
                                    <div style="display: flex; gap: 8px;">
                                        <button onclick="sttManager.approveSuggestion(${i})" style="
                                            padding: 6px 12px;
                                            background: var(--accent-green);
                                            color: white;
                                            border: none;
                                            border-radius: 6px;
                                            cursor: pointer;
                                        ">✓ Approve</button>
                                        <button onclick="sttManager.ignoreSuggestion(${i})" style="
                                            padding: 6px 12px;
                                            background: var(--accent-red);
                                            color: white;
                                            border: none;
                                            border-radius: 6px;
                                            cursor: pointer;
                                        ">✗ Ignore</button>
                                    </div>
                                </div>
                                <div style="margin-top: 8px; color: var(--text-secondary); font-size: 13px;">
                                    <span>Seen ${s.count}x</span>
                                    ${s.context ? ` • Context: ${this.escapeHtml(s.context)}` : ''}
                                    ${s.confidenceScore ? ` • Confidence: ${(s.confidenceScore * 100).toFixed(0)}%` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;
    }
    
    renderTestTab() {
        return `
            <div style="max-width: 700px;">
                <h3 style="margin-bottom: 16px;">🧪 Test STT Preprocessing</h3>
                <p style="color: var(--text-secondary); margin-bottom: 16px;">
                    Enter sample text to see how STT preprocessing transforms it.
                </p>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 4px; font-weight: 500;">Input (raw STT)</label>
                    <textarea id="stt-test-input" rows="3" placeholder="e.g., Hi honey um I need uh air condition service plank thermostat" style="
                        width: 100%;
                        padding: 12px;
                        border-radius: 8px;
                        border: 1px solid var(--border-color);
                        background: var(--input-bg);
                        font-family: monospace;
                    "></textarea>
                </div>
                
                <button onclick="sttManager.runTest()" style="
                    padding: 12px 24px;
                    background: var(--accent-blue);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 500;
                    margin-bottom: 16px;
                ">
                    🔬 Process
                </button>
                
                <div id="stt-test-results" style="display: none;">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--accent-green);">Output (cleaned)</label>
                        <div id="stt-test-output" style="
                            padding: 12px;
                            background: var(--card-bg);
                            border: 1px solid var(--border-color);
                            border-radius: 8px;
                            font-family: monospace;
                        "></div>
                    </div>
                    
                    <div id="stt-test-transformations" style="
                        padding: 16px;
                        background: var(--card-bg);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                    "></div>
                </div>
            </div>
        `;
    }
    
    // ======== Helper Methods ========
    
    getTypeColor(type) {
        const colors = {
            'triage_card': '#f59e0b',
            'scenario': '#6366f1',
            'technician': '#10b981',
            'service': '#3b82f6',
            'manual': '#8b5cf6',
            'location': '#ef4444'
        };
        return colors[type] || '#6b7280';
    }
    
    getSuggestionTypeColor(type) {
        const colors = {
            'filler': '#6366f1',
            'correction': '#f59e0b',
            'vocabulary': '#10b981',
            'impossible': '#ef4444'
        };
        return colors[type] || '#6b7280';
    }
    
    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
    attachEventListeners() {
        // Tab switching
        this.container.querySelectorAll('.stt-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.activeTab = tab.dataset.tab;
                this.render();
            });
        });
    }
    
    // ======== API Methods ========
    
    async saveProviderSettings() {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        const settings = {
            type: document.getElementById('stt-provider-type').value,
            language: document.getElementById('stt-language').value,
            model: document.getElementById('stt-model').value,
            useHints: document.getElementById('stt-use-hints').checked,
            applyFillers: document.getElementById('stt-apply-fillers').checked,
            applyCorrections: document.getElementById('stt-apply-corrections').checked,
            applyImpossibleWords: document.getElementById('stt-apply-impossible').checked
        };
        
        try {
            const response = await fetch(`/api/admin/stt-profile/${this.templateId}/provider`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });
            
            if (response.ok) {
                this.showToast('Provider settings saved!', 'success');
                await this.loadProfile();
            } else {
                this.showToast('Failed to save settings', 'error');
            }
        } catch (error) {
            this.showToast('Error: ' + error.message, 'error');
        }
    }
    
    async toggleFiller(phrase) {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/fillers/${encodeURIComponent(phrase)}/toggle`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            await this.loadProfile();
            this.render();
        } catch (error) {
            this.showToast('Error toggling filler', 'error');
        }
    }
    
    async deleteFiller(phrase) {
        if (!confirm(`Delete filler "${phrase}"?`)) return;
        
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/fillers/${encodeURIComponent(phrase)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            await this.loadProfile();
            this.render();
            this.showToast('Filler deleted', 'success');
        } catch (error) {
            this.showToast('Error deleting filler', 'error');
        }
    }
    
    async deleteKeyword(phrase) {
        if (!confirm(`Delete keyword "${phrase}"?`)) return;
        
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/vocabulary/${encodeURIComponent(phrase)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            await this.loadProfile();
            this.render();
            this.showToast('Keyword deleted', 'success');
        } catch (error) {
            this.showToast('Error deleting keyword', 'error');
        }
    }
    
    async deleteCorrection(heard) {
        if (!confirm(`Delete correction for "${heard}"?`)) return;
        
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/corrections/${encodeURIComponent(heard)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            await this.loadProfile();
            this.render();
            this.showToast('Correction deleted', 'success');
        } catch (error) {
            this.showToast('Error deleting correction', 'error');
        }
    }
    
    async deleteImpossible(word) {
        if (!confirm(`Delete impossible word "${word}"?`)) return;
        
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/impossible-words/${encodeURIComponent(word)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            await this.loadProfile();
            this.render();
            this.showToast('Impossible word deleted', 'success');
        } catch (error) {
            this.showToast('Error deleting impossible word', 'error');
        }
    }
    
    async syncVocabulary() {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            this.showToast('Syncing vocabulary...', 'info');
            
            await fetch(`/api/admin/stt-profile/${this.templateId}/vocabulary/sync`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            await this.loadProfile();
            this.render();
            this.showToast('Vocabulary synced!', 'success');
        } catch (error) {
            this.showToast('Error syncing vocabulary', 'error');
        }
    }
    
    async approveSuggestion(index) {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/suggestions/${index}/approve`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });
            
            await this.loadProfile();
            this.render();
            this.showToast('Suggestion approved!', 'success');
        } catch (error) {
            this.showToast('Error approving suggestion', 'error');
        }
    }
    
    async ignoreSuggestion(index) {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/suggestions/${index}/ignore`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            await this.loadProfile();
            this.render();
            this.showToast('Suggestion ignored', 'success');
        } catch (error) {
            this.showToast('Error ignoring suggestion', 'error');
        }
    }
    
    async runTest() {
        const input = document.getElementById('stt-test-input').value.trim();
        if (!input) {
            this.showToast('Please enter some text to test', 'error');
            return;
        }
        
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            const response = await fetch(`/api/admin/stt-profile/${this.templateId}/test`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text: input })
            });
            
            const data = await response.json();
            
            if (data.success) {
                document.getElementById('stt-test-results').style.display = 'block';
                document.getElementById('stt-test-output').textContent = data.data.output;
                
                const transformations = data.data.transformations;
                let html = '<h4 style="margin-bottom: 8px;">Transformations Applied:</h4>';
                
                if (transformations.fillersRemoved?.length) {
                    html += `<p>🔇 <strong>Fillers removed:</strong> ${transformations.fillersRemoved.map(f => `"${f.phrase}" (${f.count}x)`).join(', ')}</p>`;
                }
                if (transformations.correctionsApplied?.length) {
                    html += `<p>🔄 <strong>Corrections:</strong> ${transformations.correctionsApplied.map(c => `"${c.heard}" → "${c.normalized}"`).join(', ')}</p>`;
                }
                if (transformations.impossibleWordsDetected?.length) {
                    html += `<p>🚫 <strong>Impossible words:</strong> ${transformations.impossibleWordsDetected.map(w => `"${w.word}"`).join(', ')}</p>`;
                }
                if (!transformations.fillersRemoved?.length && !transformations.correctionsApplied?.length && !transformations.impossibleWordsDetected?.length) {
                    html += '<p style="color: var(--text-secondary);">No transformations needed.</p>';
                }
                
                html += `<p style="margin-top: 8px; font-size: 12px; color: var(--text-secondary);">Processing time: ${data.data.metrics.processingTimeMs}ms</p>`;
                
                document.getElementById('stt-test-transformations').innerHTML = html;
            } else {
                this.showToast('Test failed: ' + data.error, 'error');
            }
        } catch (error) {
            this.showToast('Error running test', 'error');
        }
    }
    
    // ======== Modal Methods ========
    
    showAddFillerModal() {
        const phrase = prompt('Enter filler word/phrase to add:');
        if (!phrase) return;
        
        const scope = confirm('Make this a GLOBAL filler (applies to all templates)?\n\nClick OK for Global, Cancel for Template-only.') ? 'global' : 'template';
        
        this.addFiller(phrase, scope);
    }
    
    async addFiller(phrase, scope = 'template') {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/fillers`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phrase, scope })
            });
            
            await this.loadProfile();
            this.render();
            this.showToast('Filler added!', 'success');
        } catch (error) {
            this.showToast('Error adding filler', 'error');
        }
    }
    
    showAddKeywordModal() {
        const phrase = prompt('Enter keyword/phrase to boost:');
        if (!phrase) return;
        
        this.addKeyword(phrase);
    }
    
    async addKeyword(phrase) {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/vocabulary`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phrase, type: 'manual' })
            });
            
            await this.loadProfile();
            this.render();
            this.showToast('Keyword added!', 'success');
        } catch (error) {
            this.showToast('Error adding keyword', 'error');
        }
    }
    
    showAddCorrectionModal() {
        const heard = prompt('Enter the MISHEARD word (what STT outputs wrong):');
        if (!heard) return;
        
        const normalized = prompt(`What should "${heard}" be corrected to?`);
        if (!normalized) return;
        
        this.addCorrection(heard, normalized);
    }
    
    async addCorrection(heard, normalized, context = []) {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/corrections`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ heard, normalized, context })
            });
            
            await this.loadProfile();
            this.render();
            this.showToast('Correction added!', 'success');
        } catch (error) {
            this.showToast('Error adding correction', 'error');
        }
    }
    
    showAddImpossibleModal() {
        const word = prompt('Enter the IMPOSSIBLE word (should never appear in this industry):');
        if (!word) return;
        
        const reason = prompt('Why is this word impossible? (optional)') || '';
        const suggestCorrection = prompt(`If "${word}" is heard, what might they actually mean? (optional)`) || '';
        
        this.addImpossible(word, reason, suggestCorrection);
    }
    
    async addImpossible(word, reason, suggestCorrection) {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            await fetch(`/api/admin/stt-profile/${this.templateId}/impossible-words`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ word, reason, suggestCorrection })
            });
            
            await this.loadProfile();
            this.render();
            this.showToast('Impossible word added!', 'success');
        } catch (error) {
            this.showToast('Error adding impossible word', 'error');
        }
    }
    
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = 'toast-notification show';
        toast.style.background = type === 'success' ? 'var(--accent-green)' : 
                                 type === 'error' ? 'var(--accent-red)' : 'var(--accent-blue)';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }
}

// Export for Control Plane lazy loading
window.STTSettingsManager = STTSettingsManager;
console.log('✅ [STT SETTINGS MANAGER] Loaded and available globally');
