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
        
        // Use the same API that AiCore Templates tab uses
        const response = await fetch(`/api/company/${this.companyId}/configuration/templates`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const templates = await response.json();
            
            console.log('[STT SETTINGS] Active templates from API:', templates);
            
            // Get the first active template (primary)
            if (templates && templates.length > 0) {
                this.templateId = templates[0].templateId;
                this.templateName = templates[0].name;
                console.log('[STT SETTINGS] Using template:', this.templateName, '(', this.templateId, ')');
            } else {
                console.log('[STT SETTINGS] No active templates found for company');
            }
        } else {
            console.error('[STT SETTINGS] Failed to fetch templates:', response.status);
        }
    }
    
    async loadProfile() {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        const [profileRes, metricsRes, callExpRes] = await Promise.all([
            fetch(`/api/admin/stt-profile/${this.templateId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`/api/admin/stt-profile/${this.templateId}/metrics`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`/api/company/${this.companyId}/call-experience`, {
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
        
        // Load call experience settings
        if (callExpRes.ok) {
            const callExpData = await callExpRes.json();
            this.profile.callExperience = callExpData.data;
            console.log('[STT SETTINGS] Call experience loaded:', this.profile.callExperience);
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
            <div style="text-align: center; padding: 60px 20px; color: #64748b;">
                <div style="font-size: 64px; margin-bottom: 20px;">🎤</div>
                <h2 style="color: #1e293b; margin-bottom: 12px;">No Template Selected</h2>
                <p>STT Settings are configured per template. Please select a Global Template in the AI Brain tab first.</p>
            </div>
        `;
    }
    
    renderError(message) {
        this.container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #ef4444;">
                <div style="font-size: 64px; margin-bottom: 20px;">⚠️</div>
                <h2 style="color: #1e293b; margin-bottom: 12px;">Error Loading STT Settings</h2>
                <p>${message}</p>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer;">
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
                    <p style="color: #64748b; margin: 0;">
                        Speech-to-Text correction for <strong>${this.profile.templateName}</strong>
                    </p>
                </div>
                
                <!-- ═══════════════════════════════════════════════════════════════════ -->
                <!-- 📞 CALL EXPERIENCE SETTINGS - TOP OF PAGE -->
                <!-- ═══════════════════════════════════════════════════════════════════ -->
                ${this.renderCallExperienceSettingsTop()}
                
                <!-- Quick Actions Bar -->
                <div style="display: flex; gap: 12px; margin-bottom: 16px; padding: 12px; background: linear-gradient(135deg, #1e293b, #334155); border-radius: 12px;">
                    <button onclick="window.sttManager.seedAll()" style="
                        padding: 10px 20px;
                        background: linear-gradient(135deg, #10b981, #059669);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 14px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    " title="One-click: Add keywords, corrections, and remove bad fillers">
                        🚀 Seed All Defaults
                    </button>
                    <button onclick="window.sttManager.cleanBadFillers()" style="
                        padding: 10px 20px;
                        background: linear-gradient(135deg, #f59e0b, #d97706);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 14px;
                    " title="Remove yes/no/do/and/etc. that break conversations">
                        🧹 Clean Bad Fillers
                    </button>
                    <div style="flex: 1; display: flex; align-items: center; justify-content: flex-end; color: #94a3b8; font-size: 13px;">
                        💡 Click "Seed All Defaults" to populate with industry-standard settings
                    </div>
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
                <div style="display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
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
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; text-align: center;">
                <div style="font-size: 24px; margin-bottom: 4px;">${icon}</div>
                <div style="font-size: 24px; font-weight: bold; color: ${color};">${value}</div>
                <div style="font-size: 12px; color: #64748b;">${label}</div>
            </div>
        `;
    }
    
    renderTab(id, label, active, badge = 0) {
        return `
            <button class="stt-tab ${active ? 'active' : ''}" data-tab="${id}" style="
                padding: 10px 16px;
                background: ${active ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : 'transparent'};
                color: ${active ? 'white' : '#64748b'};
                border: ${active ? 'none' : '1px solid #e2e8f0'};
                border-bottom: ${active ? '2px solid #3b82f6' : '1px solid #e2e8f0'};
                border-radius: 8px 8px 0 0;
                cursor: pointer;
                font-size: 14px;
                font-weight: ${active ? '600' : '500'};
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s;
                box-shadow: ${active ? '0 -2px 10px rgba(59, 130, 246, 0.3)' : 'none'};
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
                        <select id="stt-provider-type" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff;">
                            <option value="twilio" ${provider.type === 'twilio' ? 'selected' : ''}>Twilio — FREE (included) • ~80% accuracy</option>
                            <option value="deepgram" ${provider.type === 'deepgram' ? 'selected' : ''}>Deepgram Nova-2 — $0.004/min • ~95% accuracy ⭐</option>
                            <option value="google" ${provider.type === 'google' ? 'selected' : ''} disabled>Google Cloud — Coming Soon</option>
                        </select>
                        <p style="color: #64748b; font-size: 12px; margin-top: 4px;">
                            ${provider.type === 'deepgram' ? '🟢 Deepgram active - superior accuracy enabled' : 
                              provider.type === 'twilio' ? '💡 Upgrade to Deepgram for 95% accuracy' : 
                              '⏳ Google Cloud Speech coming soon'}
                        </p>
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 4px; font-weight: 500;">Language</label>
                        <select id="stt-language" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff;">
                            <option value="en-US" ${provider.language === 'en-US' ? 'selected' : ''}>English (US)</option>
                            <option value="en-GB" ${provider.language === 'en-GB' ? 'selected' : ''}>English (UK)</option>
                            <option value="es-US" ${provider.language === 'es-US' ? 'selected' : ''}>Spanish (US)</option>
                        </select>
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 4px; font-weight: 500;">Model</label>
                        <select id="stt-model" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff;">
                            <option value="phone_call" ${provider.model === 'phone_call' ? 'selected' : ''}>Phone Call (Recommended)</option>
                            <option value="default" ${provider.model === 'default' ? 'selected' : ''}>Default</option>
                            <option value="enhanced" ${provider.model === 'enhanced' ? 'selected' : ''}>Enhanced</option>
                        </select>
                    </div>
                    
                    <div style="border-top: 1px solid #e2e8f0; padding-top: 16px;">
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
                    
                    <button onclick="window.sttManager.saveProviderSettings()" style="
                        padding: 12px 24px;
                        background: #3b82f6;
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
    
    // Helper: Generate info icon with tooltip popup
    infoIcon(id, explanation) {
        // Escape quotes for the data attribute
        const escapedExp = explanation.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        return `
            <span class="info-icon-wrapper" style="position: relative; display: inline-flex; margin-left: 6px;">
                <span class="info-icon" 
                    data-tooltip-id="${id}"
                    onclick="window.sttManager.showTooltip('${id}')"
                    style="
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 18px;
                        height: 18px;
                        background: #e2e8f0;
                        border-radius: 50%;
                        cursor: pointer;
                        font-size: 11px;
                        color: #64748b;
                        font-weight: bold;
                        transition: all 0.2s;
                    "
                    onmouseover="this.style.background='#3b82f6'; this.style.color='white';"
                    onmouseout="this.style.background='#e2e8f0'; this.style.color='#64748b';"
                >ℹ</span>
                <div id="tooltip-${id}" class="info-tooltip" style="
                    display: none;
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #1e293b;
                    color: white;
                    padding: 12px 16px;
                    border-radius: 8px;
                    font-size: 13px;
                    line-height: 1.5;
                    width: 320px;
                    max-width: 90vw;
                    z-index: 1000;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                    margin-bottom: 8px;
                    text-align: left;
                    font-weight: normal;
                ">${explanation}</div>
            </span>
        `;
    }
    
    showTooltip(id) {
        // Close any other open tooltips
        document.querySelectorAll('.info-tooltip').forEach(t => {
            if (t.id !== `tooltip-${id}`) t.style.display = 'none';
        });
        
        const tooltip = document.getElementById(`tooltip-${id}`);
        if (tooltip) {
            const isVisible = tooltip.style.display !== 'none';
            tooltip.style.display = isVisible ? 'none' : 'block';
            
            // Add click-outside listener to close tooltip
            if (!isVisible) {
                setTimeout(() => {
                    const closeHandler = (e) => {
                        if (!e.target.closest('.info-icon-wrapper')) {
                            tooltip.style.display = 'none';
                            document.removeEventListener('click', closeHandler);
                        }
                    };
                    document.addEventListener('click', closeHandler);
                }, 10);
            }
        }
    }
    
    renderCallExperienceSettingsTop() {
        // Get current settings from profile or defaults
        const callExp = this.profile.callExperience || {};
        const speechTimeout = callExp.speechTimeout ?? 3;
        const initialTimeout = callExp.initialTimeout ?? 5;
        const endSilenceTimeout = callExp.endSilenceTimeout ?? 2.0;
        const allowInterruption = callExp.allowInterruption !== false;
        const interruptSensitivity = callExp.interruptSensitivity || 'medium';
        const speakingSpeed = callExp.speakingSpeed ?? 1.0;
        const pauseBetweenSentences = callExp.pauseBetweenSentences ?? 0.3;
        const llmTimeout = callExp.llmTimeout ?? 6;
        const maxSilenceBeforePrompt = callExp.maxSilenceBeforePrompt ?? 8;
        const responseLength = callExp.responseLength || 'medium';
        const ashleyModeActive = callExp.ashleyMode === true;
        
        // Tooltip explanations
        const TOOLTIPS = {
            speechTimeout: `<b>Speech Timeout</b><br><br>How long the AI waits after the caller stops speaking before responding.<br><br>• <b>1-2s</b> = Snappy, responsive (recommended)<br>• <b>3-4s</b> = Relaxed, gives caller time to think<br>• <b>5s</b> = Very patient, may feel slow<br><br>💡 Lower = faster conversation, less dead air`,
            
            endSilence: `<b>End Silence Timeout</b><br><br>Extra silence detection to determine when caller is truly done speaking.<br><br>• <b>0.5-0.9s</b> = Quick detection (recommended)<br>• <b>1-2s</b> = More patient<br>• <b>3s</b> = Very slow to respond<br><br>⚠️ This is the #1 cause of dead air. Keep it low!`,
            
            initialTimeout: `<b>Initial Timeout</b><br><br>How long to wait for the caller to start talking after the AI greeting.<br><br>• <b>5s</b> = Standard (recommended)<br>• <b>8-10s</b> = Patient, good for elderly callers<br>• <b>15s</b> = Very patient<br><br>After this timeout, AI will prompt: "Are you still there?"`,
            
            bargeIn: `<b>Allow Caller to Interrupt (Barge-in)</b><br><br>✅ <b>ON (Recommended)</b>: Caller can cut off the AI mid-sentence. If they start talking while AI is speaking, AI stops immediately and listens. Makes conversations feel natural and alive.<br><br>⬜ <b>OFF</b>: Caller must wait for AI to finish. Use only if you have important info (disclaimers, legal) that MUST be spoken completely.`,
            
            interruptSensitivity: `<b>Interrupt Sensitivity</b><br><br>How easily the caller's voice triggers an interrupt (only works when barge-in is ON).<br><br>• <b>Low</b>: Caller must speak clearly/loudly. Less sensitive to background noise.<br>• <b>Medium</b>: Balanced threshold.<br>• <b>High</b> ⭐: Very responsive - even soft speech triggers interrupt. Best for natural conversation but might cut off on background noise.`,
            
            speakingSpeed: `<b>Speaking Speed</b><br><br>How fast the AI voice talks.<br><br>• <b>0.8-0.9x</b> = Slow, deliberate<br>• <b>1.0x</b> = Normal speed<br>• <b>1.15-1.25x</b> = Confident receptionist (recommended)<br>• <b>1.3-1.5x</b> = Fast, energetic<br><br>💡 Slightly faster (1.2x) sounds more human and professional`,
            
            pauseBetweenSentences: `<b>Pause Between Sentences</b><br><br>Micro-pause for natural breathing between sentences.<br><br>• <b>0s</b> = Run-on robot, no pauses<br>• <b>0.15-0.25s</b> = Natural breathing (recommended)<br>• <b>0.3-0.5s</b> = Dramatic pauses<br><br>💡 Small pauses make AI sound more human`,
            
            llmTimeout: `<b>LLM Timeout</b><br><br>Maximum time to wait for the AI brain to generate a response.<br><br>• <b>2-3s</b> = Fast fallback, but complex questions might not get good answers<br>• <b>4s</b> = Balanced (recommended)<br>• <b>5-8s</b> = More thinking time, but caller waits in silence<br><br>If exceeded, uses smart fallback like "Sorry, I think our connection dropped. What was that?"`,
            
            maxSilence: `<b>Max Silence Before Prompt</b><br><br>If the caller goes quiet for this long, the AI jumps in with a prompt.<br><br>• <b>3-4s</b> = AI jumps in quickly, keeps conversation moving<br>• <b>5s</b> = Standard (recommended)<br>• <b>8-15s</b> = Very patient, gives caller time to think<br><br>AI will say something like "Still there?" or "Take your time, I'm here when you're ready."`,
            
            responseLength: `<b>Response Length</b><br><br>How wordy the AI responses are.<br><br>• <b>Short (~12 words)</b>: "Got it! What's your address?"<br><br>• <b>Medium (~20 words)</b> ⭐: "Okay, sounds like an AC issue. Can you give me your address so I can get a tech out there?"<br><br>• <b>Long (~35 words)</b>: "I understand, it sounds like your air conditioning isn't cooling properly. That's definitely something we can help with. Let me get your address."<br><br>💡 Medium is usually best - conversational without rambling`
        };
        
        return `
            <div style="max-width: 700px; margin-top: 32px; border-top: 2px solid #e2e8f0; padding-top: 24px;">
                <!-- ASHLEY MODE PRESET -->
                <div style="
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 24px;
                    color: white;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h3 style="margin: 0 0 8px 0; display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 24px;">✨</span>
                                Ashley Mode — Natural Flow
                            </h3>
                            <p style="margin: 0; opacity: 0.9; font-size: 14px;">
                                One-click preset for human-like conversation timing. Reduces dead air, enables interruption, speeds up response.
                            </p>
                        </div>
                        <button id="ashley-mode-btn" onclick="window.sttManager.applyAshleyMode()" style="
                            padding: 12px 24px;
                            background: ${ashleyModeActive ? '#10b981' : 'rgba(255,255,255,0.2)'};
                            color: white;
                            border: 2px solid white;
                            border-radius: 8px;
                            cursor: pointer;
                            font-weight: 600;
                            font-size: 14px;
                            transition: all 0.2s;
                        " onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='${ashleyModeActive ? '#10b981' : 'rgba(255,255,255,0.2)'}'"
                        >
                            ${ashleyModeActive ? '✓ Active' : 'Enable Ashley Mode'}
                        </button>
                    </div>
                </div>
                
                <h3 style="margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                    <span>📞</span> Call Experience Settings
                </h3>
                <p style="color: #64748b; margin-bottom: 20px; font-size: 14px;">
                    Fine-tune how the AI listens, speaks, and responds. These settings eliminate dead air and make conversations feel natural.
                </p>
                
                <div style="display: grid; gap: 24px;">
                    <!-- RESPONSE TIMING SECTION -->
                    <div style="background: #f8fafc; border-radius: 12px; padding: 20px;">
                        <h4 style="margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px;">
                            <span>🎯</span> Response Timing
                        </h4>
                        
                        <div style="display: grid; gap: 16px;">
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <label style="font-weight: 500; display: flex; align-items: center;">
                                        Speech Timeout ${this.infoIcon('speechTimeout', TOOLTIPS.speechTimeout)}
                                    </label>
                                    <span id="speech-timeout-value" style="color: #3b82f6; font-weight: 600;">${speechTimeout}s</span>
                                </div>
                                <input type="range" id="call-exp-speech-timeout" min="1" max="5" step="0.5" value="${speechTimeout}" 
                                    style="width: 100%; cursor: pointer;"
                                    oninput="document.getElementById('speech-timeout-value').textContent = this.value + 's'; window.sttManager.onSliderChange();">
                                <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">
                                    How long to wait after caller stops talking. Lower = faster response. (Rec: 1.5-2s)
                                </p>
                            </div>
                            
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <label style="font-weight: 500; display: flex; align-items: center;">
                                        End Silence Timeout ${this.infoIcon('endSilence', TOOLTIPS.endSilence)}
                                    </label>
                                    <span id="end-silence-value" style="color: #3b82f6; font-weight: 600;">${endSilenceTimeout}s</span>
                                </div>
                                <input type="range" id="call-exp-end-silence" min="0.5" max="3" step="0.1" value="${endSilenceTimeout}" 
                                    style="width: 100%; cursor: pointer;"
                                    oninput="document.getElementById('end-silence-value').textContent = this.value + 's'; window.sttManager.onSliderChange();">
                                <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">
                                    Extra silence detection. This is the #1 cause of dead air. (Rec: 0.7-0.9s)
                                </p>
                            </div>
                            
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <label style="font-weight: 500; display: flex; align-items: center;">
                                        Initial Timeout ${this.infoIcon('initialTimeout', TOOLTIPS.initialTimeout)}
                                    </label>
                                    <span id="initial-timeout-value" style="color: #3b82f6; font-weight: 600;">${initialTimeout}s</span>
                                </div>
                                <input type="range" id="call-exp-initial-timeout" min="3" max="15" step="1" value="${initialTimeout}" 
                                    style="width: 100%; cursor: pointer;"
                                    oninput="document.getElementById('initial-timeout-value').textContent = this.value + 's'; window.sttManager.onSliderChange();">
                                <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">
                                    Max wait for caller to start talking after greeting. (Rec: 5s)
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- INTERRUPTION SECTION -->
                    <div style="background: #f8fafc; border-radius: 12px; padding: 20px;">
                        <h4 style="margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px;">
                            <span>🗣️</span> Interruption Behavior
                        </h4>
                        
                        <div style="display: grid; gap: 16px;">
                            <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
                                <input type="checkbox" id="call-exp-allow-interrupt" ${allowInterruption ? 'checked' : ''} 
                                    style="width: 20px; height: 20px; cursor: pointer; margin-top: 2px;"
                                    onchange="window.sttManager.onCheckboxChange();">
                                <div>
                                    <span style="font-weight: 500; display: flex; align-items: center;">
                                        Allow Caller to Interrupt (Barge-in) ${this.infoIcon('bargeIn', TOOLTIPS.bargeIn)}
                                    </span>
                                    <p style="color: #64748b; font-size: 12px; margin: 2px 0 0 0;">
                                        Caller can cut off AI mid-sentence. Makes it feel alive. (Rec: ON)
                                    </p>
                                </div>
                            </label>
                            
                            <div>
                                <label style="font-weight: 500; display: flex; align-items: center; margin-bottom: 8px;">
                                    Interrupt Sensitivity ${this.infoIcon('interruptSensitivity', TOOLTIPS.interruptSensitivity)}
                                </label>
                                <div style="display: flex; gap: 8px;">
                                    <button onclick="window.sttManager.setInterruptSensitivity('low')" 
                                        style="flex: 1; padding: 10px; border: 2px solid ${interruptSensitivity === 'low' ? '#3b82f6' : '#e2e8f0'}; 
                                        background: ${interruptSensitivity === 'low' ? '#eff6ff' : 'white'}; border-radius: 8px; cursor: pointer;">
                                        Low
                                    </button>
                                    <button onclick="window.sttManager.setInterruptSensitivity('medium')" 
                                        style="flex: 1; padding: 10px; border: 2px solid ${interruptSensitivity === 'medium' ? '#3b82f6' : '#e2e8f0'}; 
                                        background: ${interruptSensitivity === 'medium' ? '#eff6ff' : 'white'}; border-radius: 8px; cursor: pointer;">
                                        Medium
                                    </button>
                                    <button onclick="window.sttManager.setInterruptSensitivity('high')" 
                                        style="flex: 1; padding: 10px; border: 2px solid ${interruptSensitivity === 'high' ? '#3b82f6' : '#e2e8f0'}; 
                                        background: ${interruptSensitivity === 'high' ? '#eff6ff' : 'white'}; border-radius: 8px; cursor: pointer;">
                                        High ⭐
                                    </button>
                                </div>
                                <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">
                                    How easily caller voice triggers interrupt. (Rec: High)
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- VOICE & SPEED SECTION -->
                    <div style="background: #f8fafc; border-radius: 12px; padding: 20px;">
                        <h4 style="margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px;">
                            <span>🔊</span> Voice & Speed
                        </h4>
                        
                        <div style="display: grid; gap: 16px;">
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <label style="font-weight: 500; display: flex; align-items: center;">
                                        Speaking Speed ${this.infoIcon('speakingSpeed', TOOLTIPS.speakingSpeed)}
                                    </label>
                                    <span id="speaking-speed-value" style="color: #3b82f6; font-weight: 600;">${speakingSpeed}x</span>
                                </div>
                                <input type="range" id="call-exp-speaking-speed" min="0.8" max="1.5" step="0.05" value="${speakingSpeed}" 
                                    style="width: 100%; cursor: pointer;"
                                    oninput="document.getElementById('speaking-speed-value').textContent = this.value + 'x'; window.sttManager.onSliderChange();">
                                <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">
                                    1.0x = normal. 1.2x = confident receptionist. (Rec: 1.15-1.25x)
                                </p>
                            </div>
                            
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <label style="font-weight: 500; display: flex; align-items: center;">
                                        Pause Between Sentences ${this.infoIcon('pauseBetweenSentences', TOOLTIPS.pauseBetweenSentences)}
                                    </label>
                                    <span id="pause-value" style="color: #3b82f6; font-weight: 600;">${pauseBetweenSentences}s</span>
                                </div>
                                <input type="range" id="call-exp-pause" min="0" max="0.5" step="0.05" value="${pauseBetweenSentences}" 
                                    style="width: 100%; cursor: pointer;"
                                    oninput="document.getElementById('pause-value').textContent = this.value + 's'; window.sttManager.onSliderChange();">
                                <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">
                                    Micro-pause for natural breathing. 0s = run-on robot. (Rec: 0.15-0.25s)
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- AI BEHAVIOR SECTION -->
                    <div style="background: #f8fafc; border-radius: 12px; padding: 20px;">
                        <h4 style="margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px;">
                            <span>🤖</span> AI Response Behavior
                        </h4>
                        
                        <div style="display: grid; gap: 16px;">
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <label style="font-weight: 500; display: flex; align-items: center;">
                                        LLM Timeout ${this.infoIcon('llmTimeout', TOOLTIPS.llmTimeout)}
                                    </label>
                                    <span id="llm-timeout-value" style="color: #3b82f6; font-weight: 600;">${llmTimeout}s</span>
                                </div>
                                <input type="range" id="call-exp-llm-timeout" min="2" max="10" step="0.5" value="${llmTimeout}" 
                                    style="width: 100%; cursor: pointer;"
                                    oninput="document.getElementById('llm-timeout-value').textContent = this.value + 's'; window.sttManager.onSliderChange();">
                                <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">
                                    Max wait for AI response. Uses smart fallback if exceeded. (Rec: 4s)
                                </p>
                            </div>
                            
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <label style="font-weight: 500; display: flex; align-items: center;">
                                        Max Silence Before Prompt ${this.infoIcon('maxSilence', TOOLTIPS.maxSilence)}
                                    </label>
                                    <span id="max-silence-value" style="color: #3b82f6; font-weight: 600;">${maxSilenceBeforePrompt}s</span>
                                </div>
                                <input type="range" id="call-exp-max-silence" min="3" max="15" step="1" value="${maxSilenceBeforePrompt}" 
                                    style="width: 100%; cursor: pointer;"
                                    oninput="document.getElementById('max-silence-value').textContent = this.value + 's'; window.sttManager.onSliderChange();">
                                <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">
                                    If caller goes quiet, AI says "Still there?" (Rec: 5s)
                                </p>
                            </div>
                            
                            <div>
                                <label style="font-weight: 500; display: flex; align-items: center; margin-bottom: 8px;">
                                    Response Length ${this.infoIcon('responseLength', TOOLTIPS.responseLength)}
                                </label>
                                <div style="display: flex; gap: 8px;">
                                    <button onclick="window.sttManager.setResponseLength('short')" 
                                        style="flex: 1; padding: 10px; border: 2px solid ${responseLength === 'short' ? '#3b82f6' : '#e2e8f0'}; 
                                        background: ${responseLength === 'short' ? '#eff6ff' : 'white'}; border-radius: 8px; cursor: pointer;">
                                        Short<br><span style="font-size: 11px; color: #64748b;">~12 words</span>
                                    </button>
                                    <button onclick="window.sttManager.setResponseLength('medium')" 
                                        style="flex: 1; padding: 10px; border: 2px solid ${responseLength === 'medium' ? '#3b82f6' : '#e2e8f0'}; 
                                        background: ${responseLength === 'medium' ? '#eff6ff' : 'white'}; border-radius: 8px; cursor: pointer;">
                                        Medium ⭐<br><span style="font-size: 11px; color: #64748b;">~20 words</span>
                                    </button>
                                    <button onclick="window.sttManager.setResponseLength('long')" 
                                        style="flex: 1; padding: 10px; border: 2px solid ${responseLength === 'long' ? '#3b82f6' : '#e2e8f0'}; 
                                        background: ${responseLength === 'long' ? '#eff6ff' : 'white'}; border-radius: 8px; cursor: pointer;">
                                        Long<br><span style="font-size: 11px; color: #64748b;">~35 words</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Auto-save status indicator -->
                    <div id="auto-save-indicator" style="
                        padding: 14px 28px;
                        background: #f0fdf4;
                        color: #10b981;
                        border: 2px solid #10b981;
                        border-radius: 8px;
                        font-weight: 600;
                        font-size: 15px;
                        width: 100%;
                        text-align: center;
                        box-sizing: border-box;
                    ">
                        ✅ Auto-save enabled — changes save automatically
                    </div>
                </div>
            </div>
        `;
    }
    
    // Call Experience Methods
    async applyAshleyMode() {
        // Check if already active - don't reset user's tweaks!
        if (this.profile.callExperience?.ashleyMode === true) {
            console.log('[STT SETTINGS] Ashley Mode already active - no reset needed');
            alert('✨ Ashley Mode is already active! Your settings are optimized for natural flow.');
            return;
        }
        
        // Ashley Mode optimal settings
        const ashleySettings = {
            ashleyMode: true,
            speechTimeout: 1.5,
            endSilenceTimeout: 0.8,
            initialTimeout: 5,
            allowInterruption: true,
            interruptSensitivity: 'high',
            speakingSpeed: 1.2,
            pauseBetweenSentences: 0.2,
            llmTimeout: 4,
            maxSilenceBeforePrompt: 5,
            responseLength: 'medium'
        };
        
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/company/${this.companyId}/call-experience`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(ashleySettings)
            });
            
            if (response.ok) {
                this.profile.callExperience = ashleySettings;
                this.render();
                alert('✨ Ashley Mode activated! Natural conversation flow enabled.');
            } else {
                throw new Error('Failed to apply Ashley Mode');
            }
        } catch (error) {
            console.error('[STT SETTINGS] Ashley Mode failed:', error);
            alert('Failed to apply Ashley Mode: ' + error.message);
        }
    }
    
    setInterruptSensitivity(level) {
        this.profile.callExperience = this.profile.callExperience || {};
        this.profile.callExperience.interruptSensitivity = level;
        // Update button styling immediately
        this.updateInterruptButtons(level);
        // Auto-save
        this.autoSaveCallExperience();
    }
    
    setResponseLength(length) {
        this.profile.callExperience = this.profile.callExperience || {};
        this.profile.callExperience.responseLength = length;
        // Update button styling immediately
        this.updateResponseLengthButtons(length);
        // Auto-save
        this.autoSaveCallExperience();
    }
    
    updateInterruptButtons(selected) {
        ['low', 'medium', 'high'].forEach(level => {
            const btn = document.querySelector(`button[onclick*="setInterruptSensitivity('${level}')"]`);
            if (btn) {
                const isSelected = level === selected;
                btn.style.border = `2px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}`;
                btn.style.background = isSelected ? '#eff6ff' : 'white';
            }
        });
    }
    
    updateResponseLengthButtons(selected) {
        ['short', 'medium', 'long'].forEach(length => {
            const btn = document.querySelector(`button[onclick*="setResponseLength('${length}')"]`);
            if (btn) {
                const isSelected = length === selected;
                btn.style.border = `2px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}`;
                btn.style.background = isSelected ? '#eff6ff' : 'white';
            }
        });
    }
    
    // Ashley Mode preset values for comparison
    static ASHLEY_PRESET = {
        speechTimeout: 1.5,
        endSilenceTimeout: 0.8,
        initialTimeout: 5,
        allowInterruption: true,
        interruptSensitivity: 'high',
        speakingSpeed: 1.2,
        pauseBetweenSentences: 0.2,
        llmTimeout: 4,
        maxSilenceBeforePrompt: 5,
        responseLength: 'medium'
    };
    
    // Check if current settings match Ashley Mode preset
    settingsMatchAshleyPreset(settings) {
        const preset = STTSettingsManager.ASHLEY_PRESET;
        return (
            Math.abs(settings.speechTimeout - preset.speechTimeout) < 0.01 &&
            Math.abs(settings.endSilenceTimeout - preset.endSilenceTimeout) < 0.01 &&
            settings.initialTimeout === preset.initialTimeout &&
            settings.allowInterruption === preset.allowInterruption &&
            settings.interruptSensitivity === preset.interruptSensitivity &&
            Math.abs(settings.speakingSpeed - preset.speakingSpeed) < 0.01 &&
            Math.abs(settings.pauseBetweenSentences - preset.pauseBetweenSentences) < 0.01 &&
            Math.abs(settings.llmTimeout - preset.llmTimeout) < 0.01 &&
            settings.maxSilenceBeforePrompt === preset.maxSilenceBeforePrompt &&
            settings.responseLength === preset.responseLength
        );
    }
    
    // Debounced auto-save (500ms delay)
    autoSaveCallExperience() {
        if (this._autoSaveTimeout) {
            clearTimeout(this._autoSaveTimeout);
        }
        
        // Show saving indicator
        this.updateSaveStatus('saving');
        
        this._autoSaveTimeout = setTimeout(() => {
            this.performAutoSave();
        }, 500);
    }
    
    updateSaveStatus(status) {
        const indicator = document.getElementById('auto-save-indicator');
        if (!indicator) return;
        
        if (status === 'saving') {
            indicator.innerHTML = '💾 Saving...';
            indicator.style.color = '#f59e0b';
        } else if (status === 'saved') {
            indicator.innerHTML = '✅ Saved';
            indicator.style.color = '#10b981';
        } else if (status === 'error') {
            indicator.innerHTML = '❌ Save failed';
            indicator.style.color = '#ef4444';
        }
    }
    
    async performAutoSave() {
        const speechTimeoutEl = document.getElementById('call-exp-speech-timeout');
        const endSilenceEl = document.getElementById('call-exp-end-silence');
        const initialTimeoutEl = document.getElementById('call-exp-initial-timeout');
        const allowInterruptEl = document.getElementById('call-exp-allow-interrupt');
        const speakingSpeedEl = document.getElementById('call-exp-speaking-speed');
        const pauseEl = document.getElementById('call-exp-pause');
        const llmTimeoutEl = document.getElementById('call-exp-llm-timeout');
        const maxSilenceEl = document.getElementById('call-exp-max-silence');
        
        if (!speechTimeoutEl || !endSilenceEl) {
            console.error('[STT SETTINGS] ❌ Cannot auto-save: form elements not found');
            this.updateSaveStatus('error');
            return;
        }
        
        const settings = {
            speechTimeout: parseFloat(speechTimeoutEl.value),
            endSilenceTimeout: parseFloat(endSilenceEl.value),
            initialTimeout: parseInt(initialTimeoutEl.value),
            allowInterruption: allowInterruptEl?.checked ?? false,
            interruptSensitivity: this.profile.callExperience?.interruptSensitivity || 'medium',
            speakingSpeed: parseFloat(speakingSpeedEl?.value || 1.0),
            pauseBetweenSentences: parseFloat(pauseEl?.value || 0.3),
            llmTimeout: parseFloat(llmTimeoutEl?.value || 6),
            maxSilenceBeforePrompt: parseInt(maxSilenceEl?.value || 8),
            responseLength: this.profile.callExperience?.responseLength || 'medium'
        };
        
        // PRESERVE Ashley Mode state - slider adjustments don't change it!
        // Ashley Mode is a USER CHOICE, not automatically calculated.
        // User can tweak sliders while keeping Ashley Mode "active" (it's their base).
        settings.ashleyMode = this.profile.callExperience?.ashleyMode || false;
        
        console.log('[STT SETTINGS] 🔄 Auto-saving:', settings);
        console.log('[STT SETTINGS] 🔄 Ashley Mode preserved:', settings.ashleyMode);
        
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`/api/company/${this.companyId}/call-experience`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });
            
            if (response.ok) {
                this.profile.callExperience = settings;
                this.updateSaveStatus('saved');
                // Don't change Ashley button - it stays whatever it was
                console.log('[STT SETTINGS] ✅ Auto-saved successfully');
            } else {
                throw new Error('Save failed');
            }
        } catch (error) {
            console.error('[STT SETTINGS] ❌ Auto-save failed:', error);
            this.updateSaveStatus('error');
        }
    }
    
    updateAshleyButtonState(isActive) {
        const ashleyBtn = document.getElementById('ashley-mode-btn');
        if (!ashleyBtn) return;
        
        if (isActive) {
            ashleyBtn.innerHTML = '✓ Active';
            ashleyBtn.style.background = '#10b981';
        } else {
            ashleyBtn.innerHTML = 'Enable Ashley Mode';
            ashleyBtn.style.background = 'rgba(255,255,255,0.2)';
        }
    }
    
    // Trigger auto-save from slider change
    onSliderChange() {
        this.autoSaveCallExperience();
    }
    
    // Trigger auto-save from checkbox change
    onCheckboxChange() {
        this.autoSaveCallExperience();
    }
    
    // Legacy method - kept for compatibility but not used
    async saveCallExperienceSettings() {
        // Just trigger auto-save
        this.autoSaveCallExperience();
    }
    
    renderFillersTab() {
        const fillers = this.profile.fillers || [];
        return `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3>Filler Words / Noise Removal</h3>
                    <button onclick="window.sttManager.showAddFillerModal()" style="
                        padding: 8px 16px;
                        background: #10b981;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                    ">
                        + Add Filler
                    </button>
                </div>
                <p style="color: #64748b; margin-bottom: 16px;">
                    These words are stripped from transcripts before AI processing.
                </p>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                <th style="text-align: left; padding: 12px;">Enabled</th>
                                <th style="text-align: left; padding: 12px;">Phrase</th>
                                <th style="text-align: left; padding: 12px;">Scope</th>
                                <th style="text-align: left; padding: 12px;">Added By</th>
                                <th style="text-align: center; padding: 12px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${fillers.map((f, i) => `
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 12px;">
                                        <input type="checkbox" ${f.enabled ? 'checked' : ''} onchange="sttManager.toggleFiller('${f.phrase}')">
                                    </td>
                                    <td style="padding: 12px; font-family: monospace;">${this.escapeHtml(f.phrase)}</td>
                                    <td style="padding: 12px;">
                                        <span style="background: ${f.scope === 'global' ? '#6366f1' : '#10b981'}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                                            ${f.scope}
                                        </span>
                                    </td>
                                    <td style="padding: 12px; color: #64748b;">${f.addedBy || 'system'}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        <button onclick="window.sttManager.deleteFiller('${f.phrase}')" style="background: none; border: none; color: #ef4444; cursor: pointer;">🗑️</button>
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
                        <button onclick="window.sttManager.seedHvacKeywords()" style="
                            padding: 8px 16px;
                            background: #6366f1;
                            color: white;
                            border: none;
                            border-radius: 8px;
                            cursor: pointer;
                            font-size: 13px;
                        " title="Add 50+ HVAC industry terms">
                            ❄️ Seed HVAC Keywords
                        </button>
                        <button onclick="window.sttManager.syncVocabulary()" style="
                            padding: 8px 16px;
                            background: #3b82f6;
                            color: white;
                            border: none;
                            border-radius: 8px;
                            cursor: pointer;
                        ">
                            🔄 Sync from Template
                        </button>
                        <button onclick="window.sttManager.showAddKeywordModal()" style="
                            padding: 8px 16px;
                            background: #10b981;
                            color: white;
                            border: none;
                            border-radius: 8px;
                            cursor: pointer;
                        ">
                            + Add Keyword
                        </button>
                    </div>
                </div>
                
                <!-- Info box -->
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <p style="color: #166534; margin: 0; font-size: 13px;">
                        <strong>💡 How it works:</strong> Keywords are sent to Twilio's <code>&lt;Gather&gt;</code> as hints, 
                        helping STT recognize industry-specific terms. Higher weight = stronger hint.
                    </p>
                </div>
                
                <p style="color: #64748b; margin-bottom: 16px;">
                    These words are sent as hints to improve STT accuracy. Current: <strong>${keywords.length}</strong> keywords
                </p>
                
                <div style="overflow-x: auto; max-height: 500px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead style="position: sticky; top: 0; background: #ffffff;">
                            <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                <th style="text-align: left; padding: 12px;">Phrase</th>
                                <th style="text-align: left; padding: 12px;">Type</th>
                                <th style="text-align: left; padding: 12px;">Source</th>
                                <th style="text-align: center; padding: 12px;">Weight</th>
                                <th style="text-align: center; padding: 12px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${keywords.slice(0, 100).map(k => `
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 12px; font-family: monospace;">${this.escapeHtml(k.phrase)}</td>
                                    <td style="padding: 12px;">
                                        <span style="background: ${this.getTypeColor(k.type)}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                                            ${k.type}
                                        </span>
                                    </td>
                                    <td style="padding: 12px; color: #64748b; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(k.source || '-')}</td>
                                    <td style="padding: 12px; text-align: center;">${k.boostWeight || 5}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        ${k.type === 'manual' ? `<button onclick="window.sttManager.deleteKeyword('${k.phrase}')" style="background: none; border: none; color: #ef4444; cursor: pointer;">🗑️</button>` : '-'}
                                    </td>
                                </tr>
                            `).join('')}
                            ${keywords.length > 100 ? `
                                <tr>
                                    <td colspan="5" style="padding: 12px; text-align: center; color: #64748b;">
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
                    <div style="display: flex; gap: 8px;">
                        <button onclick="window.sttManager.seedAddressCorrections()" style="
                            padding: 8px 16px;
                            background: #6366f1;
                            color: white;
                            border: none;
                            border-radius: 8px;
                            cursor: pointer;
                            font-size: 13px;
                        " title="Add ~100 common address/phone corrections">
                            🏠 Seed Address Defaults
                        </button>
                        <button onclick="window.sttManager.showAddCorrectionModal()" style="
                            padding: 8px 16px;
                            background: #10b981;
                            color: white;
                            border: none;
                            border-radius: 8px;
                            cursor: pointer;
                        ">
                            + Add Correction
                        </button>
                    </div>
                </div>
                
                <!-- Info box -->
                <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <p style="color: #0369a1; margin: 0; font-size: 13px;">
                        <strong>💡 Pro Tip:</strong> Click "Seed Address Defaults" to add 100+ corrections for addresses, phone numbers, 
                        ordinals (1st, 2nd), unit numbers (Apt 4B), and Spanish address terms. Duplicates are automatically skipped.
                    </p>
                </div>
                
                <p style="color: #64748b; margin-bottom: 16px;">
                    Map commonly misheard words to their correct form.
                </p>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
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
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 12px;">
                                        <input type="checkbox" ${c.enabled ? 'checked' : ''}>
                                    </td>
                                    <td style="padding: 12px; font-family: monospace; color: #ef4444;">${this.escapeHtml(c.heard)}</td>
                                    <td style="padding: 12px;">→</td>
                                    <td style="padding: 12px; font-family: monospace; color: #10b981;">${this.escapeHtml(c.normalized)}</td>
                                    <td style="padding: 12px; color: #64748b;">
                                        ${c.context?.length ? c.context.join(', ') : 'Any context'}
                                    </td>
                                    <td style="padding: 12px; text-align: center;">${c.occurrences || 0}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        <button onclick="window.sttManager.deleteCorrection('${c.heard}')" style="background: none; border: none; color: #ef4444; cursor: pointer;">🗑️</button>
                                    </td>
                                </tr>
                            `).join('')}
                            ${corrections.length === 0 ? `
                                <tr>
                                    <td colspan="7" style="padding: 24px; text-align: center; color: #64748b;">
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
                    <button onclick="window.sttManager.showAddImpossibleModal()" style="
                        padding: 8px 16px;
                        background: #10b981;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                    ">
                        + Add Impossible Word
                    </button>
                </div>
                <p style="color: #64748b; margin-bottom: 16px;">
                    Words that should never appear in this template's context (e.g., "toothache" in HVAC).
                </p>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                <th style="text-align: left; padding: 12px;">Word</th>
                                <th style="text-align: left; padding: 12px;">Reason</th>
                                <th style="text-align: left; padding: 12px;">Suggest Instead</th>
                                <th style="text-align: center; padding: 12px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${impossibleWords.map(iw => `
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 12px; font-family: monospace; color: #ef4444;">${this.escapeHtml(iw.word)}</td>
                                    <td style="padding: 12px; color: #64748b;">${this.escapeHtml(iw.reason || '-')}</td>
                                    <td style="padding: 12px; font-family: monospace; color: #10b981;">${this.escapeHtml(iw.suggestCorrection || '-')}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        <button onclick="window.sttManager.deleteImpossible('${iw.word}')" style="background: none; border: none; color: #ef4444; cursor: pointer;">🗑️</button>
                                    </td>
                                </tr>
                            `).join('')}
                            ${impossibleWords.length === 0 ? `
                                <tr>
                                    <td colspan="4" style="padding: 24px; text-align: center; color: #64748b;">
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
                <p style="color: #64748b; margin-bottom: 16px;">
                    Patterns detected from real calls. Approve to add to your STT intelligence.
                </p>
                
                ${suggestions.length === 0 ? `
                    <div style="text-align: center; padding: 40px; color: #64748b;">
                        <div style="font-size: 48px; margin-bottom: 12px;">✨</div>
                        <p>No pending suggestions. Make some calls to generate learning data!</p>
                    </div>
                ` : `
                    <div style="display: grid; gap: 12px;">
                        ${suggestions.map((s, i) => `
                            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
                                <div style="display: flex; justify-content: space-between; align-items: start;">
                                    <div>
                                        <span style="background: ${this.getSuggestionTypeColor(s.type)}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                                            ${s.type}
                                        </span>
                                        <span style="font-family: monospace; font-size: 18px; margin-left: 12px;">"${this.escapeHtml(s.phrase)}"</span>
                                    </div>
                                    <div style="display: flex; gap: 8px;">
                                        <button onclick="window.sttManager.approveSuggestion(${i})" style="
                                            padding: 6px 12px;
                                            background: #10b981;
                                            color: white;
                                            border: none;
                                            border-radius: 6px;
                                            cursor: pointer;
                                        ">✓ Approve</button>
                                        <button onclick="window.sttManager.ignoreSuggestion(${i})" style="
                                            padding: 6px 12px;
                                            background: #ef4444;
                                            color: white;
                                            border: none;
                                            border-radius: 6px;
                                            cursor: pointer;
                                        ">✗ Ignore</button>
                                    </div>
                                </div>
                                <div style="margin-top: 8px; color: #64748b; font-size: 13px;">
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
                <p style="color: #64748b; margin-bottom: 16px;">
                    Enter sample text to see how STT preprocessing transforms it.
                </p>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 4px; font-weight: 500;">Input (raw STT)</label>
                    <textarea id="stt-test-input" rows="3" placeholder="e.g., Hi honey um I need uh air condition service plank thermostat" style="
                        width: 100%;
                        padding: 12px;
                        border-radius: 8px;
                        border: 1px solid #e2e8f0;
                        background: #ffffff;
                        font-family: monospace;
                    "></textarea>
                </div>
                
                <button onclick="window.sttManager.runTest()" style="
                    padding: 12px 24px;
                    background: #3b82f6;
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
                        <label style="display: block; margin-bottom: 4px; font-weight: 500; color: #10b981;">Output (cleaned)</label>
                        <div id="stt-test-output" style="
                            padding: 12px;
                            background: #f8fafc;
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            font-family: monospace;
                        "></div>
                    </div>
                    
                    <div id="stt-test-transformations" style="
                        padding: 16px;
                        background: #f8fafc;
                        border: 1px solid #e2e8f0;
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
    
    /**
     * Seed default address corrections (~100 rules)
     * Includes: unit/suite, ordinals, phone patterns, street types, Spanish terms
     */
    async seedAddressCorrections() {
        if (!confirm('Add ~100 default address corrections?\n\nThis includes:\n• Apartment/Suite/Unit (Apt 4B, Ste 200)\n• Ordinals (1st, 2nd, 21st)\n• Numbers (double five → 55)\n• Street types (Ave, Blvd, Pkwy)\n• Directions (N, S, E, W)\n• Spanish terms (calle, avenida)\n\nDuplicates will be skipped.')) {
            return;
        }
        
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            this.showToast('⏳ Seeding corrections...', 'info');
            
            const response = await fetch(`/api/admin/stt-profile/${this.templateId}/seed-address-corrections`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                await this.loadProfile();
                this.render();
                this.showToast(`✅ ${result.message}`, 'success');
            } else {
                this.showToast(`❌ ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('[STT] Seed error:', error);
            this.showToast('Error seeding corrections', 'error');
        }
    }
    
    /**
     * Seed default HVAC vocabulary keywords for better recognition
     */
    async seedHvacKeywords() {
        if (!confirm('Add 50+ HVAC industry keywords?\n\nThis includes:\n• Equipment (AC, HVAC, furnace, thermostat)\n• Components (compressor, condenser, evaporator)\n• Services (maintenance, repair, tune-up)\n• Problems (no heat, no AC, leaking, frozen)\n• Booking terms (appointment, schedule, ASAP)\n\nDuplicates will be skipped.')) {
            return;
        }
        
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            this.showToast('⏳ Seeding HVAC keywords...', 'info');
            
            const response = await fetch(`/api/admin/stt-profile/${this.templateId}/seed-hvac-keywords`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                await this.loadProfile();
                this.render();
                this.showToast(`✅ ${result.message}`, 'success');
            } else {
                this.showToast(`❌ ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('[STT] Seed keywords error:', error);
            this.showToast('Error seeding keywords', 'error');
        }
    }
    
    /**
     * 🚀 SEED ALL DEFAULTS - One-click comprehensive setup
     */
    async seedAll() {
        if (!confirm('🚀 SEED ALL DEFAULTS\n\nThis will:\n✅ Add 30+ HVAC keywords\n✅ Add common mishear corrections\n✅ Remove bad fillers (yes, no, do, and, etc.)\n\nThis is the recommended starting configuration.\nDuplicates will be skipped.\n\nProceed?')) {
            return;
        }
        
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            this.showToast('🚀 Seeding all defaults...', 'info');
            
            console.log('[STT SETTINGS] 🚀 Calling seed-all for template:', this.templateId);
            
            const response = await fetch(`/api/admin/stt-profile/${this.templateId}/seed-all`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('[STT SETTINGS] 🚀 Seed-all response status:', response.status);
            
            const result = await response.json();
            console.log('[STT SETTINGS] 🚀 Seed-all result:', result);
            
            if (result.success) {
                await this.loadProfile();
                this.render();
                this.showToast(`✅ ${result.message}`, 'success');
            } else {
                console.error('[STT SETTINGS] ❌ Seed-all failed:', result.error);
                this.showToast(`❌ ${result.error || 'Unknown error'}`, 'error');
                alert(`Seed failed: ${result.error || 'Check Render logs for CHECKPOINT details'}`);
            }
        } catch (error) {
            console.error('[STT] Seed all error:', error);
            this.showToast('Error seeding defaults', 'error');
            alert(`Seed error: ${error.message}`);
        }
    }
    
    /**
     * 🧹 CLEAN BAD FILLERS - Remove words that break conversations
     */
    async cleanBadFillers() {
        if (!confirm('🧹 CLEAN BAD FILLERS\n\nThis will remove words that should NEVER be stripped:\n• Confirmations: yes, no, yeah, okay\n• Pronouns: you, we, they, it\n• Grammar: do, does, is, are, and, or\n• Questions: what, when, where, how\n\nThese cause infinite loops when stripped!\n\nProceed?')) {
            return;
        }
        
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        
        try {
            this.showToast('🧹 Cleaning bad fillers...', 'info');
            
            const response = await fetch(`/api/admin/stt-profile/${this.templateId}/clean-bad-fillers`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                await this.loadProfile();
                this.render();
                this.showToast(`✅ ${result.message}`, 'success');
                if (result.removedWords?.length > 0) {
                    console.log('[STT] Removed bad fillers:', result.removedWords);
                }
            } else {
                this.showToast(`❌ ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('[STT] Clean fillers error:', error);
            this.showToast('Error cleaning fillers', 'error');
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
                    html += '<p style="color: #64748b;">No transformations needed.</p>';
                }
                
                html += `<p style="margin-top: 8px; font-size: 12px; color: #64748b;">Processing time: ${data.data.metrics.processingTimeMs}ms</p>`;
                
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
        toast.style.background = type === 'success' ? '#10b981' : 
                                 type === 'error' ? '#ef4444' : '#3b82f6';
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
console.log('✅ [STT SETTINGS MANAGER] Loaded and available globally - VERSION 2025-12-11-V1');
