// ============================================================================
// LLM-0 CONTROLS MANAGER
// ============================================================================
// 📋 PURPOSE: Frontend manager for LLM-0 (Brain-1) behavior settings
// 🎯 FEATURES:
//    - Silence handling configuration
//    - Loop detection settings
//    - Spam filter (Layer 3) with telemarketer phrase management
//    - Customer patience mode
//    - Bailout rules
//    - Confidence thresholds
// 🔌 API: /api/admin/llm0-controls/:companyId
// ============================================================================

class LLM0ControlsManager {
    constructor(companyId, containerElement = null) {
        this.companyId = companyId;
        this.controls = null;
        this.defaults = null;
        // Accept either DOM element directly or null (will use init() with containerId)
        this.container = containerElement;
        this.hasChanges = false;
        console.log('[LLM-0 CONTROLS] Manager constructed for company:', companyId);
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    async init(containerId) {
        // If container wasn't passed to constructor, find it by ID
        if (!this.container) {
            this.container = document.getElementById(containerId);
        }
        if (!this.container) {
            console.error('[LLM-0 CONTROLS] Container not found:', containerId);
            return;
        }

        this.renderLoading();
        await this.load();
    }

    renderLoading() {
        this.container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280;">
                <div class="spinner" style="width: 40px; height: 40px; border: 3px solid #e5e7eb; border-top-color: #8b5cf6; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
                <p>Loading LLM-0 Controls...</p>
            </div>
        `;
    }

    // ========================================================================
    // DATA LOADING
    // ========================================================================
    async load() {
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/llm0-controls/${this.companyId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const result = await response.json();
            
            if (result.success) {
                this.controls = result.data;
                this.defaults = result.defaults;
                this.render();
            } else {
                this.renderError(result.message || 'Failed to load settings');
            }
        } catch (error) {
            console.error('[LLM-0 CONTROLS] Load error:', error);
            this.renderError('Network error: ' + error.message);
        }
    }

    renderError(message) {
        this.container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                <h3 style="margin-bottom: 8px;">Error Loading Controls</h3>
                <p>${message}</p>
                <button onclick="window.llm0ControlsManager.load()" style="margin-top: 16px; padding: 8px 24px; background: #8b5cf6; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Retry
                </button>
            </div>
        `;
    }

    // ========================================================================
    // MAIN RENDER
    // ========================================================================
    render() {
        const c = this.controls;
        
        this.container.innerHTML = `
            <style>
                .llm0-panel {
                    background: #ffffff;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    margin-bottom: 20px;
                    overflow: hidden;
                }
                .llm0-panel-header {
                    background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
                    color: white;
                    padding: 16px 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .llm0-panel-title {
                    font-size: 16px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .llm0-panel-toggle {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .llm0-toggle {
                    position: relative;
                    width: 48px;
                    height: 26px;
                    background: rgba(255,255,255,0.3);
                    border-radius: 13px;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .llm0-toggle.active {
                    background: #22c55e;
                }
                .llm0-toggle-knob {
                    position: absolute;
                    top: 3px;
                    left: 3px;
                    width: 20px;
                    height: 20px;
                    background: white;
                    border-radius: 50%;
                    transition: left 0.2s;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
                .llm0-toggle.active .llm0-toggle-knob {
                    left: 25px;
                }
                .llm0-panel-body {
                    padding: 20px;
                }
                .llm0-field {
                    margin-bottom: 16px;
                }
                .llm0-label {
                    display: block;
                    font-size: 13px;
                    font-weight: 500;
                    color: #374151;
                    margin-bottom: 6px;
                }
                .llm0-hint {
                    font-size: 11px;
                    color: #9ca3af;
                    margin-top: 4px;
                }
                .llm0-input {
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    transition: border-color 0.2s;
                }
                .llm0-input:focus {
                    outline: none;
                    border-color: #8b5cf6;
                    box-shadow: 0 0 0 3px rgba(139,92,246,0.1);
                }
                .llm0-select {
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    background: white;
                    cursor: pointer;
                }
                .llm0-number {
                    width: 100px;
                    text-align: center;
                }
                .llm0-slider-container {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .llm0-slider {
                    flex: 1;
                    height: 6px;
                    -webkit-appearance: none;
                    background: #e5e7eb;
                    border-radius: 3px;
                    outline: none;
                }
                .llm0-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 18px;
                    height: 18px;
                    background: #8b5cf6;
                    border-radius: 50%;
                    cursor: pointer;
                }
                .llm0-row {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 16px;
                }
                .llm0-phrases {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 12px;
                }
                .llm0-phrase {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: #fef3c7;
                    color: #92400e;
                    padding: 4px 10px;
                    border-radius: 16px;
                    font-size: 12px;
                }
                .llm0-phrase-remove {
                    cursor: pointer;
                    opacity: 0.7;
                }
                .llm0-phrase-remove:hover {
                    opacity: 1;
                }
                .llm0-add-phrase {
                    display: flex;
                    gap: 8px;
                }
                .llm0-actions {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 20px;
                    background: #f9fafb;
                    border-top: 1px solid #e5e7eb;
                }
                .llm0-btn {
                    padding: 10px 24px;
                    border-radius: 6px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .llm0-btn-primary {
                    background: linear-gradient(135deg, #8b5cf6, #6366f1);
                    color: white;
                    border: none;
                }
                .llm0-btn-primary:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(139,92,246,0.4);
                }
                .llm0-btn-secondary {
                    background: white;
                    color: #6b7280;
                    border: 1px solid #d1d5db;
                }
                .llm0-btn-secondary:hover {
                    background: #f3f4f6;
                }
                .llm0-section-divider {
                    height: 1px;
                    background: #e5e7eb;
                    margin: 20px 0;
                }
                .llm0-checkbox-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 12px;
                }
                .llm0-checkbox {
                    width: 18px;
                    height: 18px;
                    accent-color: #8b5cf6;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>

            <div style="margin-bottom: 24px;">
                <h2 style="font-size: 24px; font-weight: 600; color: #1f2937; display: flex; align-items: center; gap: 12px;">
                    🧠 LLM-0 Intelligence Controls
                    <span style="background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500;">ENTERPRISE</span>
                </h2>
                <p style="color: #6b7280; margin-top: 8px;">
                    Technical AI settings: silence handling, spam detection, confidence thresholds, and STT quality guards.
                </p>
                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin-top: 12px;">
                    <p style="margin: 0; color: #92400e; font-size: 13px;">
                        <strong>💡 Note:</strong> Frustration, Loop Detection, and Escalation settings are now in <strong>Front Desk Behavior</strong> tab for unified control.
                    </p>
                </div>
            </div>

            <!-- SILENCE HANDLING -->
            ${this.renderSilencePanel(c.silenceHandling)}

            <!-- SPAM FILTER -->
            ${this.renderSpamPanel(c.spamFilter)}

            <!-- CUSTOMER PATIENCE -->
            ${this.renderPatiencePanel(c.customerPatience)}

            <!-- CONFIDENCE THRESHOLDS -->
            ${this.renderConfidencePanel(c.confidenceThresholds)}

            <!-- LOW CONFIDENCE HANDLING - STT Quality Guard -->
            ${this.renderLowConfidencePanel(c.lowConfidenceHandling || {})}

            <!-- SMART CONFIRMATION -->
            ${this.renderSmartConfirmationPanel(c.smartConfirmation || {})}

            <!-- ACTIONS -->
            <div class="llm0-actions">
                <button class="llm0-btn llm0-btn-secondary" onclick="window.llm0ControlsManager.resetToDefaults()">
                    🔄 Reset to Defaults
                </button>
                <div style="display: flex; gap: 12px;">
                    <button class="llm0-btn llm0-btn-secondary" onclick="window.llm0ControlsManager.load()">
                        ↩️ Discard Changes
                    </button>
                    <button class="llm0-btn llm0-btn-primary" onclick="window.llm0ControlsManager.save()">
                        💾 Save Changes
                    </button>
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    // ========================================================================
    // PANEL RENDERERS
    // ========================================================================
    renderSilencePanel(s) {
        return `
            <div class="llm0-panel">
                <div class="llm0-panel-header">
                    <div class="llm0-panel-title">
                        <span>🤫</span> Silence Handling
                    </div>
                    <div class="llm0-panel-toggle">
                        <span style="font-size: 12px;">Enabled</span>
                        <div class="llm0-toggle ${s.enabled ? 'active' : ''}" data-section="silenceHandling" data-field="enabled">
                            <div class="llm0-toggle-knob"></div>
                        </div>
                    </div>
                </div>
                <div class="llm0-panel-body">
                    <p style="color: #6b7280; margin-bottom: 16px;">
                        How the AI responds when a caller goes silent. Gentle prompts help customers who need time.
                    </p>
                    
                    <div class="llm0-row">
                        <div class="llm0-field">
                            <label class="llm0-label">Silence Threshold (seconds)</label>
                            <input type="number" class="llm0-input llm0-number" value="${s.thresholdSeconds}" 
                                   data-section="silenceHandling" data-field="thresholdSeconds" min="2" max="30">
                            <div class="llm0-hint">Wait this long before prompting</div>
                        </div>
                        <div class="llm0-field">
                            <label class="llm0-label">Max Prompts</label>
                            <input type="number" class="llm0-input llm0-number" value="${s.maxPrompts}" 
                                   data-section="silenceHandling" data-field="maxPrompts" min="1" max="5">
                            <div class="llm0-hint">Number of gentle prompts before callback offer</div>
                        </div>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">First Prompt</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(s.firstPrompt)}" 
                               data-section="silenceHandling" data-field="firstPrompt">
                    </div>
                    <div class="llm0-field">
                        <label class="llm0-label">Second Prompt</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(s.secondPrompt)}" 
                               data-section="silenceHandling" data-field="secondPrompt">
                    </div>
                    <div class="llm0-field">
                        <label class="llm0-label">Third Prompt</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(s.thirdPrompt)}" 
                               data-section="silenceHandling" data-field="thirdPrompt">
                    </div>
                    
                    <div class="llm0-section-divider"></div>
                    
                    <div class="llm0-checkbox-row">
                        <input type="checkbox" class="llm0-checkbox" id="silence-callback" ${s.offerCallback ? 'checked' : ''}
                               data-section="silenceHandling" data-field="offerCallback">
                        <label for="silence-callback" style="font-size: 14px; color: #374151;">Offer callback after max prompts</label>
                    </div>
                    <div class="llm0-field">
                        <label class="llm0-label">Callback Offer Message</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(s.callbackMessage)}" 
                               data-section="silenceHandling" data-field="callbackMessage">
                    </div>
                </div>
            </div>
        `;
    }

    // REMOVED: renderLoopPanel - Now in Front Desk Behavior > Loops tab

    renderSpamPanel(sp) {
        const phrases = sp.telemarketerPhrases || [];
        return `
            <div class="llm0-panel">
                <div class="llm0-panel-header" style="background: linear-gradient(135deg, #ef4444, #dc2626);">
                    <div class="llm0-panel-title">
                        <span>🚫</span> Spam Filter (Layer 3 Detection)
                    </div>
                    <div class="llm0-panel-toggle">
                        <span style="font-size: 12px;">Enabled</span>
                        <div class="llm0-toggle ${sp.enabled ? 'active' : ''}" data-section="spamFilter" data-field="enabled">
                            <div class="llm0-toggle-knob"></div>
                        </div>
                    </div>
                </div>
                <div class="llm0-panel-body">
                    <p style="color: #6b7280; margin-bottom: 16px;">
                        LLM-0 detects telemarketer patterns that got past Edge Cases. Learn new patterns → add to Edge Cases for FREE blocking.
                    </p>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Telemarketer Trigger Phrases</label>
                        <div class="llm0-phrases" id="spam-phrases">
                            ${phrases.map(p => `
                                <div class="llm0-phrase">
                                    ${this.escapeHtml(p)}
                                    <span class="llm0-phrase-remove" onclick="window.llm0ControlsManager.removePhrase('${this.escapeHtml(p)}')">×</span>
                                </div>
                            `).join('')}
                        </div>
                        <div class="llm0-add-phrase">
                            <input type="text" class="llm0-input" id="new-spam-phrase" placeholder="Add new phrase...">
                            <button class="llm0-btn llm0-btn-primary" style="padding: 10px 16px;" onclick="window.llm0ControlsManager.addPhrase()">+ Add</button>
                        </div>
                        <div class="llm0-hint">Phrases that indicate telemarketer/robocall</div>
                    </div>
                    
                    <div class="llm0-section-divider"></div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">On Spam Detected</label>
                        <select class="llm0-select" data-section="spamFilter" data-field="onSpamDetected">
                            <option value="polite_dismiss" ${sp.onSpamDetected === 'polite_dismiss' ? 'selected' : ''}>Polite dismiss (recommended)</option>
                            <option value="silent_hangup" ${sp.onSpamDetected === 'silent_hangup' ? 'selected' : ''}>Silent hangup</option>
                            <option value="flag_only" ${sp.onSpamDetected === 'flag_only' ? 'selected' : ''}>Flag only (continue call)</option>
                        </select>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Dismiss Message</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(sp.dismissMessage)}" 
                               data-section="spamFilter" data-field="dismissMessage">
                    </div>
                    
                    <div class="llm0-checkbox-row">
                        <input type="checkbox" class="llm0-checkbox" id="spam-auto-blacklist" ${sp.autoAddToBlacklist ? 'checked' : ''}
                               data-section="spamFilter" data-field="autoAddToBlacklist">
                        <label for="spam-auto-blacklist" style="font-size: 14px; color: #374151;">Auto-add caller to blacklist</label>
                    </div>
                    <div class="llm0-checkbox-row">
                        <input type="checkbox" class="llm0-checkbox" id="spam-log-blackbox" ${sp.logToBlackBox ? 'checked' : ''}
                               data-section="spamFilter" data-field="logToBlackBox">
                        <label for="spam-log-blackbox" style="font-size: 14px; color: #374151;">Log to Black Box for learning</label>
                    </div>
                </div>
            </div>
        `;
    }

    renderPatiencePanel(p) {
        return `
            <div class="llm0-panel">
                <div class="llm0-panel-header" style="background: linear-gradient(135deg, #22c55e, #16a34a);">
                    <div class="llm0-panel-title">
                        <span>💚</span> Customer Patience Mode
                    </div>
                    <div class="llm0-panel-toggle">
                        <span style="font-size: 12px;">Enabled</span>
                        <div class="llm0-toggle ${p.enabled ? 'active' : ''}" data-section="customerPatience" data-field="enabled">
                            <div class="llm0-toggle-knob"></div>
                        </div>
                    </div>
                </div>
                <div class="llm0-panel-body">
                    <p style="color: #6b7280; margin-bottom: 16px;">
                        <strong>NEVER lose a real customer!</strong> Be patient with callers who need time. Always offer alternatives.
                    </p>
                    
                    <div class="llm0-checkbox-row">
                        <input type="checkbox" class="llm0-checkbox" id="patience-never-hangup" ${p.neverAutoHangup ? 'checked' : ''}
                               data-section="customerPatience" data-field="neverAutoHangup">
                        <label for="patience-never-hangup" style="font-size: 14px; color: #374151; font-weight: 500;">
                            🛡️ Never auto-hangup on potential customer
                        </label>
                    </div>
                    
                    <div class="llm0-checkbox-row">
                        <input type="checkbox" class="llm0-checkbox" id="patience-always-callback" ${p.alwaysOfferCallback ? 'checked' : ''}
                               data-section="customerPatience" data-field="alwaysOfferCallback">
                        <label for="patience-always-callback" style="font-size: 14px; color: #374151;">
                            Always offer callback option
                        </label>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Max Patience Prompts</label>
                        <input type="number" class="llm0-input llm0-number" value="${p.maxPatiencePrompts}" 
                               data-section="customerPatience" data-field="maxPatiencePrompts" min="2" max="10">
                        <div class="llm0-hint">Gentle prompts before escalating</div>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Patience Message</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(p.patienceMessage)}" 
                               data-section="customerPatience" data-field="patienceMessage">
                    </div>
                </div>
            </div>
        `;
    }

    // REMOVED: renderBailoutPanel - Now in Front Desk Behavior > Escalation tab

    renderConfidencePanel(ct) {
        return `
            <div class="llm0-panel">
                <div class="llm0-panel-header" style="background: linear-gradient(135deg, #0ea5e9, #0284c7);">
                    <div class="llm0-panel-title">
                        <span>📊</span> Confidence Thresholds
                    </div>
                </div>
                <div class="llm0-panel-body">
                    <p style="color: #6b7280; margin-bottom: 16px;">
                        How confident the AI must be before taking action. Higher = more certain.
                    </p>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">High Confidence (fast match)</label>
                        <div class="llm0-slider-container">
                            <input type="range" class="llm0-slider" value="${ct.highConfidence * 100}" 
                                   data-section="confidenceThresholds" data-field="highConfidence" 
                                   min="50" max="100" id="high-conf-slider">
                            <span id="high-conf-value">${(ct.highConfidence * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Medium Confidence</label>
                        <div class="llm0-slider-container">
                            <input type="range" class="llm0-slider" value="${ct.mediumConfidence * 100}" 
                                   data-section="confidenceThresholds" data-field="mediumConfidence" 
                                   min="30" max="90" id="med-conf-slider">
                            <span id="med-conf-value">${(ct.mediumConfidence * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Low Confidence</label>
                        <div class="llm0-slider-container">
                            <input type="range" class="llm0-slider" value="${ct.lowConfidence * 100}" 
                                   data-section="confidenceThresholds" data-field="lowConfidence" 
                                   min="10" max="70" id="low-conf-slider">
                            <span id="low-conf-value">${(ct.lowConfidence * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Fallback to LLM (below this, use LLM)</label>
                        <div class="llm0-slider-container">
                            <input type="range" class="llm0-slider" value="${ct.fallbackToLLM * 100}" 
                                   data-section="confidenceThresholds" data-field="fallbackToLLM" 
                                   min="10" max="60" id="fallback-slider">
                            <span id="fallback-value">${(ct.fallbackToLLM * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderLowConfidencePanel(lc) {
        // Provide defaults if lowConfidenceHandling doesn't exist yet
        lc = lc || {
            enabled: true,
            threshold: 60,
            action: 'repeat',
            repeatPhrase: "Sorry, there's some background noise — could you say that again?",
            maxRepeatsBeforeEscalation: 2,
            escalatePhrase: "I'm having trouble hearing you clearly. Let me get someone to help you.",
            preserveBookingOnLowConfidence: true,
            bookingRepeatPhrase: "Sorry, I didn't catch that. Could you repeat that for me?",
            logToBlackBox: true
        };

        return `
            <div class="llm0-panel">
                <div class="llm0-panel-header" style="background: linear-gradient(135deg, #f97316, #ea580c);">
                    <div class="llm0-panel-title">
                        <span>🎯</span> Low Confidence Handling
                        <span style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 12px; font-size: 10px; margin-left: 8px;">STT GUARD</span>
                    </div>
                    <div class="llm0-panel-toggle">
                        <span style="font-size: 12px;">Enabled</span>
                        <div class="llm0-toggle ${lc.enabled !== false ? 'active' : ''}" data-section="lowConfidenceHandling" data-field="enabled">
                            <div class="llm0-toggle-knob"></div>
                        </div>
                    </div>
                </div>
                <div class="llm0-panel-body">
                    <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                        <h4 style="margin: 0 0 8px; color: #92400e; font-size: 14px;">✅ Recommended Setting</h4>
                        <p style="margin: 0; color: #78350f; font-size: 13px; line-height: 1.5;">
                            <strong>Protect your business from misinterpreted calls.</strong> When the AI isn't confident in what the caller said, it politely asks them to repeat instead of guessing.
                        </p>
                    </div>

                    <div style="background: #f0fdf4; border: 1px solid #22c55e; border-radius: 8px; padding: 12px; margin-bottom: 20px;">
                        <p style="margin: 0; color: #166534; font-size: 12px;">
                            <strong>💡 Why this works:</strong> A polite "Could you repeat that?" takes 3 seconds. A wrong interpretation loses customers. This is the same approach used by Google Contact Center AI, Amazon Lex, and enterprise contact centers.
                        </p>
                    </div>

                    <h4 style="margin: 0 0 16px; color: #374151; font-size: 14px; font-weight: 600;">📊 Confidence Threshold</h4>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Ask to repeat when STT confidence below:</label>
                        <div class="llm0-slider-container">
                            <input type="range" class="llm0-slider" value="${lc.threshold || 60}" 
                                   data-section="lowConfidenceHandling" data-field="threshold" 
                                   min="30" max="90" id="low-conf-threshold-slider">
                            <span id="low-conf-threshold-value" style="min-width: 45px; text-align: right; font-weight: 600; color: #f97316;">${lc.threshold || 60}%</span>
                        </div>
                        <div class="llm0-hint">Lower = more aggressive (ask more often). Higher = more lenient (trust more). Recommended: 60%</div>
                    </div>

                    <div class="llm0-field">
                        <label class="llm0-label">Action When Confidence is Low</label>
                        <select class="llm0-select" data-section="lowConfidenceHandling" data-field="action">
                            <option value="repeat" ${lc.action === 'repeat' ? 'selected' : ''}>🔄 Ask to Repeat (Safest)</option>
                            <option value="guess_with_context" ${lc.action === 'guess_with_context' ? 'selected' : ''}>🧠 Guess with Context (Future)</option>
                            <option value="accept" ${lc.action === 'accept' ? 'selected' : ''}>⚠️ Accept Anyway (Risky)</option>
                        </select>
                        <div class="llm0-hint">Repeat is recommended - it prevents mistakes without losing callers</div>
                    </div>

                    <div class="llm0-section-divider"></div>

                    <h4 style="margin: 0 0 16px; color: #374151; font-size: 14px; font-weight: 600;">💬 Repeat Phrases</h4>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Standard Repeat Phrase</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(lc.repeatPhrase || '')}" 
                               data-section="lowConfidenceHandling" data-field="repeatPhrase"
                               placeholder="Sorry, there's some background noise — could you say that again?">
                        <div class="llm0-hint">Natural, polite request - customers accept this</div>
                    </div>

                    <div class="llm0-field">
                        <label class="llm0-label">Booking Flow Repeat Phrase</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(lc.bookingRepeatPhrase || '')}" 
                               data-section="lowConfidenceHandling" data-field="bookingRepeatPhrase"
                               placeholder="Sorry, I didn't catch that. Could you repeat that for me?">
                        <div class="llm0-hint">Used when already in booking mode - stays in flow</div>
                    </div>

                    <div class="llm0-section-divider"></div>

                    <h4 style="margin: 0 0 16px; color: #374151; font-size: 14px; font-weight: 600;">🚨 Escalation After Max Repeats</h4>
                    
                    <div class="llm0-row">
                        <div class="llm0-field">
                            <label class="llm0-label">Max Repeat Attempts</label>
                            <input type="number" class="llm0-input llm0-number" value="${lc.maxRepeatsBeforeEscalation || 2}" 
                                   data-section="lowConfidenceHandling" data-field="maxRepeatsBeforeEscalation" min="1" max="5">
                            <div class="llm0-hint">After this many repeats, escalate to human</div>
                        </div>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Escalation Phrase</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(lc.escalatePhrase || '')}" 
                               data-section="lowConfidenceHandling" data-field="escalatePhrase"
                               placeholder="I'm having trouble hearing you clearly. Let me get someone to help you.">
                        <div class="llm0-hint">Said before transferring to human agent</div>
                    </div>

                    <div class="llm0-section-divider"></div>

                    <h4 style="margin: 0 0 16px; color: #374151; font-size: 14px; font-weight: 600;">⚙️ Advanced Options</h4>
                    
                    <div class="llm0-checkbox-row">
                        <input type="checkbox" class="llm0-checkbox" id="lc-preserve-booking" ${lc.preserveBookingOnLowConfidence !== false ? 'checked' : ''}
                               data-section="lowConfidenceHandling" data-field="preserveBookingOnLowConfidence">
                        <label for="lc-preserve-booking" style="font-size: 14px; color: #374151;">
                            📅 Preserve booking mode during low confidence (don't break the flow)
                        </label>
                    </div>
                    
                    <div class="llm0-checkbox-row">
                        <input type="checkbox" class="llm0-checkbox" id="lc-log-blackbox" ${lc.logToBlackBox !== false ? 'checked' : ''}
                               data-section="lowConfidenceHandling" data-field="logToBlackBox">
                        <label for="lc-log-blackbox" style="font-size: 14px; color: #374151;">
                            📦 Log to Black Box for vocabulary training
                        </label>
                    </div>

                    <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 12px; margin-top: 16px;">
                        <p style="margin: 0; color: #1e40af; font-size: 12px;">
                            <strong>📊 How it works:</strong> When STT gives low confidence → Log the bad transcript to Black Box → Ask caller to repeat → Get better transcript → Proceed with confidence. The logged data helps improve your vocabulary over time.
                        </p>
                    </div>
                    <div class="llm0-checkbox-row">
                        <input type="checkbox" class="llm0-checkbox" id="lc-skip-confirm" ${lc.skipConfirmationOnClearRepeat !== false ? 'checked' : ''}
                               data-section="lowConfidenceHandling" data-field="skipConfirmationOnClearRepeat">
                        <label for="lc-skip-confirm" style="font-size: 14px; color: #374151;">
                            ⚡ Skip confirmation if caller repeats clearly (prevents double-confirmation)
                        </label>
                    </div>

                    <div class="llm0-section-divider"></div>

                    <h4 style="margin: 0 0 16px; color: #374151; font-size: 14px; font-weight: 600;">🎯 Deepgram Hybrid STT <span style="background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; margin-left: 8px;">PREMIUM</span></h4>

                    <div style="background: linear-gradient(135deg, #ede9fe 0%, #fce7f3 100%); border: 1px solid #8b5cf6; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                        <p style="margin: 0; color: #5b21b6; font-size: 13px;">
                            <strong>🚀 Hybrid STT:</strong> When Twilio confidence is low, automatically use Deepgram for a second opinion instead of asking the caller to repeat. Better accuracy, no UX penalty.
                        </p>
                    </div>

                    <div class="llm0-checkbox-row">
                        <input type="checkbox" class="llm0-checkbox" id="lc-deepgram-fallback" ${lc.useDeepgramFallback !== false ? 'checked' : ''}
                               data-section="lowConfidenceHandling" data-field="useDeepgramFallback">
                        <label for="lc-deepgram-fallback" style="font-size: 14px; color: #374151; font-weight: 500;">
                            🎯 Use Deepgram Fallback (recommended for premium accounts)
                        </label>
                    </div>

                    <div class="llm0-row" style="margin-top: 12px;">
                        <div class="llm0-field">
                            <label class="llm0-label">Trigger Deepgram below:</label>
                            <div class="llm0-slider-container">
                                <input type="range" class="llm0-slider" value="${lc.deepgramFallbackThreshold || 60}" 
                                       data-section="lowConfidenceHandling" data-field="deepgramFallbackThreshold" 
                                       min="30" max="90" id="dg-fallback-slider">
                                <span id="dg-fallback-value" style="min-width: 45px; text-align: right;">${lc.deepgramFallbackThreshold || 60}%</span>
                            </div>
                        </div>
                        <div class="llm0-field">
                            <label class="llm0-label">Accept Deepgram above:</label>
                            <div class="llm0-slider-container">
                                <input type="range" class="llm0-slider" value="${lc.deepgramAcceptThreshold || 80}" 
                                       data-section="lowConfidenceHandling" data-field="deepgramAcceptThreshold" 
                                       min="50" max="100" id="dg-accept-slider">
                                <span id="dg-accept-value" style="min-width: 45px; text-align: right;">${lc.deepgramAcceptThreshold || 80}%</span>
                            </div>
                        </div>
                    </div>

                    <div style="background: #f0fdf4; border: 1px solid #22c55e; border-radius: 8px; padding: 12px; margin-top: 12px;">
                        <p style="margin: 0; color: #166534; font-size: 12px;">
                            <strong>💰 Cost:</strong> ~$0.0048/min only when Twilio is uncertain (~10% of calls). All comparisons logged to Black Box for vocabulary learning.
                        </p>
                    </div>
                </div>
            </div>
        `;
    }

    // REMOVED: renderFrustrationPanel - Now in Front Desk Behavior > Frustration tab
    // REMOVED: renderResponseTimingPanel - Now in STT Settings > Call Experience

    renderSmartConfirmationPanel(sc) {
        // Provide defaults if smartConfirmation doesn't exist yet
        sc = sc || {
            enabled: true,
            confirmTransfers: true,
            confirmBookings: false,
            confirmEmergency: true,
            confirmCancellations: true,
            confirmBelowConfidence: 0.75,
            confirmationStyle: 'smart',
            transferConfirmPhrase: "Before I transfer you, I want to make sure - you'd like to speak with a live agent, correct?",
            bookingConfirmPhrase: "Just to confirm, you'd like to schedule a service appointment, is that right?",
            emergencyConfirmPhrase: "This sounds like an emergency. I want to make sure - should I dispatch someone right away?",
            lowConfidencePhrase: "I want to make sure I have this right — you need help with {detected_intent}, correct?",
            onNoResponse: 'apologize_and_clarify',
            clarifyPhrase: "I apologize for the confusion. Could you tell me more about what you need help with?"
        };

        return `
            <div class="llm0-panel">
                <div class="llm0-panel-header" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed);">
                    <div class="llm0-panel-title">
                        <span>✅</span> Smart Confirmation
                    </div>
                    <div class="llm0-panel-toggle">
                        <span style="font-size: 12px;">Enabled</span>
                        <div class="llm0-toggle ${sc.enabled !== false ? 'active' : ''}" data-section="smartConfirmation" data-field="enabled">
                            <div class="llm0-toggle-knob"></div>
                        </div>
                    </div>
                </div>
                <div class="llm0-panel-body">
                    <p style="color: #6b7280; margin-bottom: 16px;">
                        <strong>Prevents embarrassing mistakes.</strong> Confirm critical decisions before acting to avoid wrong transfers, bookings, or dispatches.
                    </p>
                    
                    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin-bottom: 20px;">
                        <span style="font-size: 14px;">💡 <strong>Why this matters:</strong> A wrong transfer = lost customer. A wrong emergency dispatch = liability. Confirmation takes 3 seconds but saves hours of problems.</span>
                    </div>

                    <h4 style="margin: 20px 0 12px; color: #374151; font-size: 14px; font-weight: 600;">🎯 Always Confirm These Actions</h4>
                    
                    <div class="llm0-row" style="grid-template-columns: 1fr 1fr;">
                        <div class="llm0-checkbox-field">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" ${sc.confirmTransfers !== false ? 'checked' : ''} 
                                       data-section="smartConfirmation" data-field="confirmTransfers">
                                <span>📞 Transfers</span>
                            </label>
                            <div class="llm0-hint">High cost if wrong - always ask</div>
                        </div>
                        <div class="llm0-checkbox-field">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" ${sc.confirmEmergency !== false ? 'checked' : ''} 
                                       data-section="smartConfirmation" data-field="confirmEmergency">
                                <span>🚨 Emergency Dispatch</span>
                            </label>
                            <div class="llm0-hint">Safety critical - always verify</div>
                        </div>
                    </div>
                    
                    <div class="llm0-row" style="grid-template-columns: 1fr 1fr;">
                        <div class="llm0-checkbox-field">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" ${sc.confirmBookings ? 'checked' : ''} 
                                       data-section="smartConfirmation" data-field="confirmBookings">
                                <span>📅 Bookings</span>
                            </label>
                            <div class="llm0-hint">Optional - can clarify during flow</div>
                        </div>
                        <div class="llm0-checkbox-field">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" ${sc.confirmCancellations !== false ? 'checked' : ''} 
                                       data-section="smartConfirmation" data-field="confirmCancellations">
                                <span>❌ Cancellations</span>
                            </label>
                            <div class="llm0-hint">Destructive action - confirm first</div>
                        </div>
                    </div>

                    <h4 style="margin: 24px 0 12px; color: #374151; font-size: 14px; font-weight: 600;">📊 Confidence-Based Confirmation</h4>
                    
                    <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                        <span style="font-size: 13px; color: #065f46;">
                            <strong>✅ ACTIVE:</strong> When AI detects a real intent (service, repair, booking, etc.) but confidence is below the threshold, it will ask: "I want to make sure I understand correctly..."
                        </span>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Confirm when confidence below:</label>
                        <div class="llm0-slider-container">
                            <input type="range" class="llm0-slider" value="${(sc.confirmBelowConfidence || 0.75) * 100}" 
                                   data-section="smartConfirmation" data-field="confirmBelowConfidence" 
                                   min="50" max="95" id="confirm-conf-slider">
                            <span id="confirm-conf-value">${((sc.confirmBelowConfidence || 0.75) * 100).toFixed(0)}%</span>
                        </div>
                        <div class="llm0-hint">If AI is less confident than this AND detects a real intent, ask for confirmation. Won't trigger on generic responses.</div>
                    </div>

                    <div class="llm0-field">
                        <label class="llm0-label">Confirmation Style</label>
                        <select class="llm0-input" data-section="smartConfirmation" data-field="confirmationStyle">
                            <option value="smart" ${sc.confirmationStyle === 'smart' ? 'selected' : ''}>🧠 Smart (based on severity)</option>
                            <option value="explicit" ${sc.confirmationStyle === 'explicit' ? 'selected' : ''}>✋ Explicit (always ask directly)</option>
                            <option value="implicit" ${sc.confirmationStyle === 'implicit' ? 'selected' : ''}>💬 Implicit (weave into response)</option>
                        </select>
                    </div>

                    <h4 style="margin: 24px 0 12px; color: #374151; font-size: 14px; font-weight: 600;">💬 Confirmation Phrases</h4>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Transfer Confirmation</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(sc.transferConfirmPhrase || '')}" 
                               data-section="smartConfirmation" data-field="transferConfirmPhrase"
                               placeholder="Before I transfer you, I want to make sure...">
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Emergency Confirmation</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(sc.emergencyConfirmPhrase || '')}" 
                               data-section="smartConfirmation" data-field="emergencyConfirmPhrase"
                               placeholder="This sounds like an emergency. Should I dispatch...">
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Low Confidence Confirmation</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(sc.lowConfidencePhrase || '')}" 
                               data-section="smartConfirmation" data-field="lowConfidencePhrase"
                               placeholder="I want to make sure I understand. You're looking for {detected_intent}...">
                        <div class="llm0-hint">Use {detected_intent} as placeholder for what AI thinks caller wants</div>
                    </div>

                    <h4 style="margin: 24px 0 12px; color: #374151; font-size: 14px; font-weight: 600;">🔄 When Caller Says "No"</h4>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Recovery Action</label>
                        <select class="llm0-input" data-section="smartConfirmation" data-field="onNoResponse">
                            <option value="apologize_and_clarify" ${sc.onNoResponse === 'apologize_and_clarify' ? 'selected' : ''}>😊 Apologize & Ask What They Need</option>
                            <option value="clarify" ${sc.onNoResponse === 'clarify' ? 'selected' : ''}>🔍 Just Ask for Clarification</option>
                            <option value="restart" ${sc.onNoResponse === 'restart' ? 'selected' : ''}>🔄 Start Over Fresh</option>
                        </select>
                    </div>
                    
                    <div class="llm0-field">
                        <label class="llm0-label">Clarification Phrase</label>
                        <input type="text" class="llm0-input" value="${this.escapeHtml(sc.clarifyPhrase || '')}" 
                               data-section="smartConfirmation" data-field="clarifyPhrase"
                               placeholder="I apologize for the confusion. Could you tell me...">
                    </div>
                </div>
            </div>
        `;
    }

    // ========================================================================
    // EVENT LISTENERS
    // ========================================================================
    attachEventListeners() {
        // Toggle switches
        this.container.querySelectorAll('.llm0-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('active');
                this.hasChanges = true;
            });
        });

        // All inputs
        this.container.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('change', () => {
                this.hasChanges = true;
            });
        });

        // Slider value display updates
        // NOTE: Removed confusion-slider (bailout panel moved to Front Desk)
        const sliders = [
            { id: 'high-conf-slider', display: 'high-conf-value', suffix: '%' },
            { id: 'med-conf-slider', display: 'med-conf-value', suffix: '%' },
            { id: 'low-conf-slider', display: 'low-conf-value', suffix: '%' },
            { id: 'fallback-slider', display: 'fallback-value', suffix: '%' },
            { id: 'confirm-conf-slider', display: 'confirm-conf-value', suffix: '%' },
            { id: 'low-conf-threshold-slider', display: 'low-conf-threshold-value', suffix: '%' },
            { id: 'dg-fallback-slider', display: 'dg-fallback-value', suffix: '%' },
            { id: 'dg-accept-slider', display: 'dg-accept-value', suffix: '%' }
        ];

        sliders.forEach(s => {
            const slider = document.getElementById(s.id);
            const display = document.getElementById(s.display);
            if (slider && display) {
                slider.addEventListener('input', () => {
                    display.textContent = slider.value + s.suffix;
                });
            }
        });

        // New phrase input - enter key
        const newPhraseInput = document.getElementById('new-spam-phrase');
        if (newPhraseInput) {
            newPhraseInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addPhrase();
                }
            });
        }
    }

    // ========================================================================
    // PHRASE MANAGEMENT
    // ========================================================================
    async addPhrase() {
        const input = document.getElementById('new-spam-phrase');
        const phrase = input.value.trim().toLowerCase();
        
        if (phrase.length < 3) {
            this.showToast('error', 'Phrase must be at least 3 characters');
            return;
        }

        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/llm0-controls/${this.companyId}/spam-phrase`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ phrase })
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast('success', `Added "${phrase}" to spam filter`);
                input.value = '';
                await this.load(); // Reload to show new phrase
            } else {
                this.showToast('error', result.message || 'Failed to add phrase');
            }
        } catch (error) {
            this.showToast('error', 'Network error: ' + error.message);
        }
    }

    async removePhrase(phrase) {
        if (!confirm(`Remove "${phrase}" from spam filter?`)) return;

        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/llm0-controls/${this.companyId}/spam-phrase`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ phrase })
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast('success', `Removed "${phrase}"`);
                await this.load();
            } else {
                this.showToast('error', result.message);
            }
        } catch (error) {
            this.showToast('error', 'Network error: ' + error.message);
        }
    }

    // REMOVED: Frustration Keyword Management - Now in Front Desk Behavior > Frustration tab

    // ========================================================================
    // SAVE / RESET
    // ========================================================================
    collectFormData() {
        // NOTE: loopDetection, bailoutRules, frustrationDetection, responseTiming
        // are now managed in Front Desk Behavior / STT Settings tabs
        const data = {
            silenceHandling: {},
            spamFilter: {},
            customerPatience: {},
            confidenceThresholds: {},
            lowConfidenceHandling: {},
            smartConfirmation: {}
        };

        // Collect toggle states
        this.container.querySelectorAll('.llm0-toggle').forEach(toggle => {
            const section = toggle.dataset.section;
            const field = toggle.dataset.field;
            if (section && field) {
                data[section][field] = toggle.classList.contains('active');
            }
        });

        // Collect inputs
        this.container.querySelectorAll('input[data-section], select[data-section]').forEach(input => {
            const section = input.dataset.section;
            const field = input.dataset.field;
            if (!section || !field) return;

            let value;
            if (input.type === 'checkbox') {
                value = input.checked;
            } else if (input.type === 'number' || input.type === 'range') {
                value = parseFloat(input.value);
                // Sliders for percentages need to be divided by 100
                // EXCEPT lowConfidenceHandling.threshold which is stored as 0-100
                if (input.type === 'range' && 
                    (field.includes('Confidence') || field === 'confusionThreshold') && 
                    !(section === 'lowConfidenceHandling' && field === 'threshold')) {
                    value = value / 100;
                }
            } else {
                value = input.value;
            }

            data[section][field] = value;
        });

        return data;
    }

    async save() {
        const data = this.collectFormData();
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/llm0-controls/${this.companyId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast('success', 'LLM-0 controls saved successfully!');
                this.hasChanges = false;
                await this.load();
            } else {
                this.showToast('error', result.message || 'Failed to save');
            }
        } catch (error) {
            this.showToast('error', 'Network error: ' + error.message);
        }
    }

    async resetToDefaults() {
        if (!confirm('Reset all LLM-0 controls to defaults? This cannot be undone.')) return;

        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/llm0-controls/${this.companyId}/reset`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const result = await response.json();
            
            if (result.success) {
                this.showToast('success', 'Reset to defaults complete');
                await this.load();
            } else {
                this.showToast('error', result.message);
            }
        } catch (error) {
            this.showToast('error', 'Network error: ' + error.message);
        }
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================
    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
    }

    showToast(type, message) {
        const existing = document.querySelector('.llm0-toast');
        if (existing) existing.remove();

        const colors = {
            success: '#22c55e',
            error: '#ef4444',
            info: '#3b82f6'
        };

        const toast = document.createElement('div');
        toast.className = 'llm0-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 16px 24px;
            background: ${colors[type] || colors.info};
            color: white;
            border-radius: 8px;
            font-weight: 500;
            z-index: 10000;
            animation: slideIn 0.3s ease;
            max-width: 400px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 4000);
    }
}

// Export class to window for Control Plane lazy loading
window.LLM0ControlsManager = LLM0ControlsManager;

// Global instance
window.llm0ControlsManager = null;

// Initialize function (legacy support)
window.initLLM0Controls = function(companyId, containerId) {
    window.llm0ControlsManager = new LLM0ControlsManager(companyId);
    window.llm0ControlsManager.init(containerId);
};

console.log('✅ [LLM-0 CONTROLS] Manager loaded and exported to window.LLM0ControlsManager');

