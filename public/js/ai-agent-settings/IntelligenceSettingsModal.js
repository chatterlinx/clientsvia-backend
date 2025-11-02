// ============================================================================
// CLIENTSVIA - INTELLIGENCE SETTINGS MODAL
// ============================================================================
// Purpose: Beautiful UI for configuring Test Pilot Intelligence presets
// Created: 2025-11-02
// Architecture: Dual 3-Tier System (Test vs Production)
// Features:
//   - Gorgeous preset selector with emoji indicators
//   - Live cost estimation based on call volume
//   - Real-time budget tracking
//   - Advanced custom settings panel
//   - YOLO mode confirmation dialog
//   - Recommendations based on template maturity
// ============================================================================

class IntelligenceSettingsModal {
    constructor() {
        console.log('🏗️ [INTELLIGENCE MODAL] Initializing...');
        
        this.currentConfig = null;
        this.presets = [];
        this.selectedPreset = 'balanced';
        this.isOpen = false;
        
        console.log('✅ [INTELLIGENCE MODAL] Initialized');
    }
    
    // ========================================================================
    // OPEN MODAL - Load Current Config & Show UI
    // ========================================================================
    async open() {
        try {
            console.log('📖 [INTELLIGENCE MODAL] Opening modal...');
            
            // Load current configuration from backend
            await this.loadCurrentConfig();
            
            // Load available presets
            await this.loadPresets();
            
            // Show modal
            this.show();
            
            // Render content
            this.render();
            
            this.isOpen = true;
            console.log('✅ [INTELLIGENCE MODAL] Modal opened successfully');
            
        } catch (error) {
            console.error('❌ [INTELLIGENCE MODAL] Failed to open modal:', error);
            this.showToast('error', 'Failed to load intelligence settings');
        }
    }
    
    // ========================================================================
    // LOAD CURRENT CONFIG FROM BACKEND
    // ========================================================================
    async loadCurrentConfig() {
        try {
            console.log('📡 [INTELLIGENCE MODAL] Loading current config from backend...');
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/intelligence/test-pilot', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Failed to load config');
            }
            
            this.currentConfig = data.config;
            this.selectedPreset = this.currentConfig.preset;
            
            console.log('✅ [INTELLIGENCE MODAL] Current config loaded:', {
                preset: this.currentConfig.preset,
                tier1: this.currentConfig.thresholds.tier1,
                tier2: this.currentConfig.thresholds.tier2,
                todaysCost: this.currentConfig.todaysCost.amount
            });
            
        } catch (error) {
            console.error('❌ [INTELLIGENCE MODAL] Failed to load current config:', error);
            throw error;
        }
    }
    
    // ========================================================================
    // LOAD AVAILABLE PRESETS FROM BACKEND
    // ========================================================================
    async loadPresets() {
        try {
            console.log('📡 [INTELLIGENCE MODAL] Loading presets from backend...');
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/intelligence/presets', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Failed to load presets');
            }
            
            this.presets = data.presets;
            
            console.log(`✅ [INTELLIGENCE MODAL] Loaded ${this.presets.length} presets:`, this.presets.map(p => p.name));
            
        } catch (error) {
            console.error('❌ [INTELLIGENCE MODAL] Failed to load presets:', error);
            throw error;
        }
    }
    
    // ========================================================================
    // SHOW MODAL - Display UI
    // ========================================================================
    show() {
        console.log('🎨 [INTELLIGENCE MODAL] Showing modal UI...');
        
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'intelligence-modal-backdrop';
        backdrop.className = 'intelligence-modal-backdrop';
        backdrop.onclick = () => this.close();
        
        // Create modal container
        const modal = document.createElement('div');
        modal.id = 'intelligence-modal';
        modal.className = 'intelligence-modal';
        modal.onclick = (e) => e.stopPropagation(); // Prevent closing when clicking inside modal
        
        // Add to DOM
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
        
        // Animate in
        setTimeout(() => {
            backdrop.classList.add('show');
            modal.classList.add('show');
        }, 10);
        
        console.log('✅ [INTELLIGENCE MODAL] Modal UI displayed');
    }
    
    // ========================================================================
    // RENDER MODAL CONTENT
    // ========================================================================
    render() {
        console.log('🎨 [INTELLIGENCE MODAL] Rendering modal content...');
        
        const modal = document.getElementById('intelligence-modal');
        if (!modal) {
            console.error('❌ [INTELLIGENCE MODAL] Modal element not found');
            return;
        }
        
        modal.innerHTML = `
            <!-- Modal Header -->
            <div class="intelligence-modal-header">
                <div class="intelligence-modal-header-content">
                    <div class="intelligence-modal-title">
                        <i class="fas fa-brain"></i>
                        <h2>Test Pilot Intelligence Settings</h2>
                    </div>
                    <p class="intelligence-modal-subtitle">
                        Configure how aggressively the AI learns during testing. 
                        <strong>These settings only affect Test Pilot</strong> - production uses separate conservative settings.
                    </p>
                </div>
                <button class="intelligence-modal-close" onclick="window.intelligenceSettingsModal.close()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <!-- Modal Body -->
            <div class="intelligence-modal-body">
                
                <!-- Current Status Banner -->
                <div class="intelligence-current-status">
                    <div class="intelligence-status-badge">
                        <span class="intelligence-status-label">Current Preset:</span>
                        <span class="intelligence-status-value">${this.currentConfig.presetDetails.emoji} ${this.currentConfig.presetDetails.name}</span>
                    </div>
                    <div class="intelligence-status-badge">
                        <span class="intelligence-status-label">Today's Cost:</span>
                        <span class="intelligence-status-value">$${this.currentConfig.todaysCost.amount.toFixed(2)}</span>
                    </div>
                    <div class="intelligence-status-badge">
                        <span class="intelligence-status-label">Tier 3 Calls:</span>
                        <span class="intelligence-status-value">${this.currentConfig.todaysCost.tier3Calls}</span>
                    </div>
                </div>
                
                <!-- Preset Selector -->
                <div class="intelligence-preset-section">
                    <h3 class="intelligence-section-title">
                        <i class="fas fa-sliders-h"></i>
                        Choose Intelligence Preset
                    </h3>
                    <p class="intelligence-section-desc">
                        Select a preset based on your testing goals. Presets prevent configuration mistakes and optimize for different scenarios.
                    </p>
                    
                    <div class="intelligence-preset-grid" id="preset-grid">
                        ${this.renderPresetCards()}
                    </div>
                </div>
                
                <!-- Cost Estimator -->
                <div class="intelligence-cost-section">
                    <h3 class="intelligence-section-title">
                        <i class="fas fa-calculator"></i>
                        Cost Estimator
                    </h3>
                    <p class="intelligence-section-desc">
                        Estimate your monthly LLM costs based on expected test call volume.
                    </p>
                    
                    <div class="intelligence-cost-estimator">
                        <div class="intelligence-cost-input-group">
                            <label for="cost-est-calls">Test Calls Per Day:</label>
                            <input type="number" id="cost-est-calls" value="100" min="1" max="1000" 
                                   oninput="window.intelligenceSettingsModal.updateCostEstimate(this.value)">
                        </div>
                        
                        <div class="intelligence-cost-results" id="cost-estimate-results">
                            ${this.renderCostEstimate(100)}
                        </div>
                    </div>
                </div>
                
                <!-- Advanced Settings (Collapsible) -->
                <div class="intelligence-advanced-section">
                    <button class="intelligence-advanced-toggle" onclick="window.intelligenceSettingsModal.toggleAdvanced()">
                        <i class="fas fa-cog"></i>
                        Advanced Settings (Custom Configuration)
                        <i class="fas fa-chevron-down" id="advanced-chevron"></i>
                    </button>
                    
                    <div class="intelligence-advanced-content" id="advanced-content" style="display: none;">
                        <div class="intelligence-advanced-warning">
                            ⚠️ <strong>Warning:</strong> Custom settings override the selected preset. 
                            Only modify if you know what you're doing!
                        </div>
                        
                        ${this.renderAdvancedSettings()}
                    </div>
                </div>
                
            </div>
            
            <!-- Modal Footer -->
            <div class="intelligence-modal-footer">
                <button class="intelligence-btn intelligence-btn-secondary" onclick="window.intelligenceSettingsModal.close()">
                    Cancel
                </button>
                <button class="intelligence-btn intelligence-btn-primary" onclick="window.intelligenceSettingsModal.save()">
                    <i class="fas fa-save"></i>
                    Save & Apply Settings
                </button>
            </div>
        `;
        
        console.log('✅ [INTELLIGENCE MODAL] Content rendered successfully');
    }
    
    // ========================================================================
    // RENDER PRESET CARDS
    // ========================================================================
    renderPresetCards() {
        console.log('🎨 [INTELLIGENCE MODAL] Rendering preset cards...');
        
        return this.presets.map(preset => {
            const isSelected = preset.id === this.selectedPreset;
            const isYolo = preset.id === 'yolo';
            
            return `
                <div class="intelligence-preset-card ${isSelected ? 'selected' : ''} ${isYolo ? 'yolo' : ''}"
                     onclick="window.intelligenceSettingsModal.selectPreset('${preset.id}')">
                    
                    ${isSelected ? '<div class="intelligence-preset-selected-badge">✓ Active</div>' : ''}
                    
                    <div class="intelligence-preset-icon">
                        ${preset.emoji}
                    </div>
                    
                    <h4 class="intelligence-preset-name">${preset.name}</h4>
                    
                    <p class="intelligence-preset-desc">${preset.description}</p>
                    
                    <div class="intelligence-preset-stats">
                        <div class="intelligence-preset-stat">
                            <span class="intelligence-preset-stat-label">Tier 3 Rate:</span>
                            <span class="intelligence-preset-stat-value">${preset.tier3Rate}</span>
                        </div>
                        <div class="intelligence-preset-stat">
                            <span class="intelligence-preset-stat-label">Est. Cost:</span>
                            <span class="intelligence-preset-stat-value">${preset.estimatedCost}</span>
                        </div>
                    </div>
                    
                    ${isYolo ? '<div class="intelligence-preset-warning">⚠️ Auto-reverts in 24h</div>' : ''}
                </div>
            `;
        }).join('');
    }
    
    // ========================================================================
    // RENDER COST ESTIMATE
    // ========================================================================
    renderCostEstimate(callsPerDay) {
        const preset = this.presets.find(p => p.id === this.selectedPreset);
        if (!preset) return '<p>Loading...</p>';
        
        // Parse cost range
        const costMatch = preset.estimatedCost.match(/\$(\d+)-(\d+)/);
        const costMin = costMatch ? parseInt(costMatch[1]) : 0;
        const costMax = costMatch ? parseInt(costMatch[2]) : 0;
        
        // Parse tier 3 rate
        const tier3Match = preset.tier3Rate.match(/(\d+)-(\d+)%/);
        const tier3Min = tier3Match ? parseInt(tier3Match[1]) : 0;
        const tier3Max = tier3Match ? parseInt(tier3Match[2]) : 0;
        
        // Calculate estimates
        const dailyCostMin = (callsPerDay / 100) * costMin;
        const dailyCostMax = (callsPerDay / 100) * costMax;
        const monthlyCostMin = dailyCostMin * 30;
        const monthlyCostMax = dailyCostMax * 30;
        
        const tier3CallsMin = Math.round(callsPerDay * (tier3Min / 100));
        const tier3CallsMax = Math.round(callsPerDay * (tier3Max / 100));
        
        return `
            <div class="intelligence-cost-breakdown">
                <div class="intelligence-cost-row">
                    <span class="intelligence-cost-label">Daily Cost:</span>
                    <span class="intelligence-cost-value">$${dailyCostMin.toFixed(2)} - $${dailyCostMax.toFixed(2)}</span>
                </div>
                <div class="intelligence-cost-row">
                    <span class="intelligence-cost-label">Monthly Cost:</span>
                    <span class="intelligence-cost-value highlight">$${monthlyCostMin.toFixed(2)} - $${monthlyCostMax.toFixed(2)}</span>
                </div>
                <div class="intelligence-cost-row">
                    <span class="intelligence-cost-label">Daily Tier 3 Calls:</span>
                    <span class="intelligence-cost-value">${tier3CallsMin} - ${tier3CallsMax} calls</span>
                </div>
            </div>
        `;
    }
    
    // ========================================================================
    // RENDER ADVANCED SETTINGS
    // ========================================================================
    renderAdvancedSettings() {
        return `
            <div class="intelligence-advanced-grid">
                
                <!-- Tier 1 Threshold -->
                <div class="intelligence-setting-group">
                    <label for="adv-tier1">Tier 1 Threshold (${(this.currentConfig.thresholds.tier1 * 100).toFixed(0)}%)</label>
                    <input type="range" id="adv-tier1" min="50" max="95" 
                           value="${this.currentConfig.thresholds.tier1 * 100}"
                           oninput="this.previousElementSibling.textContent = 'Tier 1 Threshold (' + this.value + '%)'">
                    <p class="intelligence-setting-hint">Lower = More Tier 2/3 triggers (more learning, higher cost)</p>
                </div>
                
                <!-- Tier 2 Threshold -->
                <div class="intelligence-setting-group">
                    <label for="adv-tier2">Tier 2 Threshold (${(this.currentConfig.thresholds.tier2 * 100).toFixed(0)}%)</label>
                    <input type="range" id="adv-tier2" min="30" max="80" 
                           value="${this.currentConfig.thresholds.tier2 * 100}"
                           oninput="this.previousElementSibling.textContent = 'Tier 2 Threshold (' + this.value + '%)'">
                    <p class="intelligence-setting-hint">Lower = More Tier 3 triggers (more LLM usage, highest cost)</p>
                </div>
                
                <!-- LLM Model -->
                <div class="intelligence-setting-group">
                    <label for="adv-model">LLM Model</label>
                    <select id="adv-model">
                        <option value="gpt-4o" ${this.currentConfig.llmConfig.model === 'gpt-4o' ? 'selected' : ''}>
                            GPT-4o (Best Quality, $0.10/call)
                        </option>
                        <option value="gpt-4o-mini" ${this.currentConfig.llmConfig.model === 'gpt-4o-mini' ? 'selected' : ''}>
                            GPT-4o-mini (Balanced, $0.04/call)
                        </option>
                        <option value="gpt-3.5-turbo" ${this.currentConfig.llmConfig.model === 'gpt-3.5-turbo' ? 'selected' : ''}>
                            GPT-3.5-turbo (Fast & Cheap, $0.01/call)
                        </option>
                    </select>
                    <p class="intelligence-setting-hint">Higher quality = better suggestions, but more expensive</p>
                </div>
                
                <!-- Auto-Apply -->
                <div class="intelligence-setting-group">
                    <label for="adv-autoapply">Auto-Apply Suggestions</label>
                    <select id="adv-autoapply">
                        <option value="manual" ${this.currentConfig.llmConfig.autoApply === 'manual' ? 'selected' : ''}>
                            Manual Review (Recommended)
                        </option>
                        <option value="high-confidence" ${this.currentConfig.llmConfig.autoApply === 'high-confidence' ? 'selected' : ''}>
                            Auto-apply High Confidence (>90%)
                        </option>
                        <option value="all" ${this.currentConfig.llmConfig.autoApply === 'all' ? 'selected' : ''}>
                            Auto-apply ALL (Risky!)
                        </option>
                    </select>
                    <p class="intelligence-setting-hint">Manual review prevents bad suggestions from being auto-applied</p>
                </div>
                
                <!-- Daily Budget -->
                <div class="intelligence-setting-group">
                    <label for="adv-budget">Daily Budget (USD)</label>
                    <input type="number" id="adv-budget" min="0" step="5" 
                           value="${this.currentConfig.costControls.dailyBudget || ''}"
                           placeholder="Unlimited">
                    <p class="intelligence-setting-hint">Tier 3 pauses when budget exceeded (leave blank for unlimited)</p>
                </div>
                
                <!-- Alert Threshold -->
                <div class="intelligence-setting-group">
                    <label for="adv-alert">Alert Threshold (USD)</label>
                    <input type="number" id="adv-alert" min="0" step="5" 
                           value="${this.currentConfig.costControls.alertThreshold || ''}"
                           placeholder="No alerts">
                    <p class="intelligence-setting-hint">Email alert when cost reaches this amount</p>
                </div>
                
            </div>
        `;
    }
    
    // ========================================================================
    // SELECT PRESET
    // ========================================================================
    selectPreset(presetId) {
        console.log(`🎯 [INTELLIGENCE MODAL] Preset selected: ${presetId}`);
        
        this.selectedPreset = presetId;
        
        // Re-render preset cards to show selection
        const presetGrid = document.getElementById('preset-grid');
        if (presetGrid) {
            presetGrid.innerHTML = this.renderPresetCards();
        }
        
        // Update cost estimate
        const callsInput = document.getElementById('cost-est-calls');
        if (callsInput) {
            this.updateCostEstimate(callsInput.value);
        }
    }
    
    // ========================================================================
    // UPDATE COST ESTIMATE (Live Calculation)
    // ========================================================================
    updateCostEstimate(callsPerDay) {
        console.log(`💰 [INTELLIGENCE MODAL] Updating cost estimate for ${callsPerDay} calls/day...`);
        
        const resultsDiv = document.getElementById('cost-estimate-results');
        if (resultsDiv) {
            resultsDiv.innerHTML = this.renderCostEstimate(parseInt(callsPerDay));
        }
    }
    
    // ========================================================================
    // TOGGLE ADVANCED SETTINGS
    // ========================================================================
    toggleAdvanced() {
        const content = document.getElementById('advanced-content');
        const chevron = document.getElementById('advanced-chevron');
        
        if (content && chevron) {
            const isHidden = content.style.display === 'none';
            content.style.display = isHidden ? 'block' : 'none';
            chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            
            console.log(`🔧 [INTELLIGENCE MODAL] Advanced settings ${isHidden ? 'expanded' : 'collapsed'}`);
        }
    }
    
    // ========================================================================
    // SAVE SETTINGS
    // ========================================================================
    async save() {
        try {
            console.log('💾 [INTELLIGENCE MODAL] Saving settings...');
            console.log(`   Selected preset: ${this.selectedPreset}`);
            
            // YOLO mode confirmation
            if (this.selectedPreset === 'yolo' && this.currentConfig.preset !== 'yolo') {
                const confirmed = await this.showYoloConfirmation();
                if (!confirmed) {
                    console.log('⚠️ [INTELLIGENCE MODAL] YOLO mode cancelled by user');
                    return;
                }
            }
            
            // Build request body
            const requestBody = {
                preset: this.selectedPreset,
                yoloConfirmed: this.selectedPreset === 'yolo'
            };
            
            // Check if advanced settings are visible (custom config)
            const advancedContent = document.getElementById('advanced-content');
            if (advancedContent && advancedContent.style.display === 'block') {
                // Include custom settings
                const tier1 = parseInt(document.getElementById('adv-tier1').value) / 100;
                const tier2 = parseInt(document.getElementById('adv-tier2').value) / 100;
                const model = document.getElementById('adv-model').value;
                const autoApply = document.getElementById('adv-autoapply').value;
                const dailyBudget = document.getElementById('adv-budget').value;
                const alertThreshold = document.getElementById('adv-alert').value;
                
                requestBody.thresholds = { tier1, tier2 };
                requestBody.llmConfig = { model, autoApply };
                requestBody.costControls = {
                    dailyBudget: dailyBudget ? parseFloat(dailyBudget) : null,
                    alertThreshold: alertThreshold ? parseFloat(alertThreshold) : null
                };
                
                console.log('   Including custom settings:', requestBody);
            }
            
            // Save to backend
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/intelligence/test-pilot', {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                
                // Check if YOLO confirmation required
                if (errorData.requiresConfirmation) {
                    const confirmed = await this.showYoloConfirmation();
                    if (confirmed) {
                        // Retry with confirmation
                        requestBody.yoloConfirmed = true;
                        return this.save(); // Recursive call with confirmation
                    }
                    return;
                }
                
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Failed to save settings');
            }
            
            console.log('✅ [INTELLIGENCE MODAL] Settings saved successfully');
            
            this.showToast('success', `Intelligence preset updated to "${data.presetDetails.name}"`);
            
            // Close modal
            this.close();
            
        } catch (error) {
            console.error('❌ [INTELLIGENCE MODAL] Failed to save settings:', error);
            this.showToast('error', `Failed to save settings: ${error.message}`);
        }
    }
    
    // ========================================================================
    // YOLO CONFIRMATION DIALOG
    // ========================================================================
    async showYoloConfirmation() {
        return new Promise((resolve) => {
            const confirmed = confirm(
                `⚠️ YOLO MODE WARNING ⚠️\n\n` +
                `YOLO mode sends 50-70% of calls to LLM (GPT-4o).\n\n` +
                `Estimated Cost: $50-100 per 100 test calls\n` +
                `This is 10-20x MORE EXPENSIVE than Balanced mode!\n\n` +
                `YOLO mode is designed for SHORT-TERM research only.\n` +
                `It will automatically revert to Balanced after 24 hours.\n\n` +
                `Are you SURE you want to enable YOLO mode?`
            );
            
            console.log(`🔥 [INTELLIGENCE MODAL] YOLO confirmation: ${confirmed ? 'YES' : 'NO'}`);
            resolve(confirmed);
        });
    }
    
    // ========================================================================
    // CLOSE MODAL
    // ========================================================================
    close() {
        console.log('👋 [INTELLIGENCE MODAL] Closing modal...');
        
        const backdrop = document.getElementById('intelligence-modal-backdrop');
        const modal = document.getElementById('intelligence-modal');
        
        if (backdrop) {
            backdrop.classList.remove('show');
            setTimeout(() => backdrop.remove(), 300);
        }
        
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => modal.remove(), 300);
        }
        
        this.isOpen = false;
        console.log('✅ [INTELLIGENCE MODAL] Modal closed');
    }
    
    // ========================================================================
    // SHOW TOAST NOTIFICATION
    // ========================================================================
    showToast(type, message) {
        if (window.ToastManager) {
            window.ToastManager[type](message);
        } else {
            console.log(`[TOAST ${type.toUpperCase()}] ${message}`);
        }
    }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================
window.intelligenceSettingsModal = new IntelligenceSettingsModal();

console.log('✅ [INTELLIGENCE MODAL] Class loaded and global instance created');

