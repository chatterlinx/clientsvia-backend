/**
 * ============================================================================
 * SERVICE TYPE CLARIFICATION MANAGER
 * ============================================================================
 * 
 * UI Manager for configuring Service Type Clarification settings.
 * 
 * PURPOSE:
 * When caller says "I need AC service" - we don't know if they mean:
 *   - Repair (something broken)
 *   - Maintenance (tune-up, cleaning)
 *   - Installation (new unit)
 * 
 * This UI allows admins to configure:
 *   - Service types and their keywords
 *   - Ambiguous phrases that trigger clarification
 *   - The clarification question text
 *   - Calendar mapping per service type
 * 
 * ============================================================================
 */

class ServiceTypeClarificationManager {
    constructor() {
        this.companyId = null;
        this.config = {};
        this.isDirty = false;
        this.originalConfig = {};
        console.log('[SERVICE TYPE] Manager initialized');
    }

    /**
     * Load configuration from backend
     */
    async load(companyId) {
        this.companyId = companyId;
        console.log('[SERVICE TYPE] Loading config for company:', companyId);
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/service-type-clarification/${companyId}`, {
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
            this.originalConfig = JSON.parse(JSON.stringify(result.data));
            this.isDirty = false;
            
            console.log('[SERVICE TYPE] Config loaded:', this.config);
            this.render();
            
        } catch (error) {
            console.error('[SERVICE TYPE] Load failed:', error);
            // Use defaults if load fails
            this.config = this.getDefaultConfig();
            this.render();
        }
    }

    /**
     * Get default configuration
     */
    getDefaultConfig() {
        return {
            enabled: true,
            ambiguousPhrases: [
                'service', 'work', 'come out', 'look at', 'check', 'check out',
                'needs attention', 'acting up', 'not right', 'needs service'
            ],
            clarificationQuestion: "Absolutely — is this for a repair issue, or routine maintenance and tune-up?",
            serviceTypes: [
                {
                    key: 'repair',
                    label: 'Repair',
                    keywords: ['broken', 'not working', 'not cooling', 'not heating', 'leak', 'noise', 'emergency', 'urgent'],
                    calendarId: null,
                    priority: 1,
                    enabled: true
                },
                {
                    key: 'maintenance',
                    label: 'Maintenance / Tune-Up',
                    keywords: ['tune up', 'tune-up', 'maintenance', 'cleaning', 'annual', 'yearly', 'seasonal'],
                    calendarId: null,
                    priority: 2,
                    enabled: true
                },
                {
                    key: 'installation',
                    label: 'Installation / Replacement',
                    keywords: ['new unit', 'new system', 'replace', 'replacement', 'install', 'upgrade'],
                    calendarId: null,
                    priority: 3,
                    enabled: true
                }
            ]
        };
    }

    /**
     * Render the complete UI
     */
    render() {
        const container = document.getElementById('serviceTypeClarificationContainer');
        if (!container) {
            console.error('[SERVICE TYPE] Container not found');
            return;
        }

        const cfg = this.config;
        
        container.innerHTML = `
            <style>
                .stc-container {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                
                .stc-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 24px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid #e5e7eb;
                }
                
                .stc-header-info h2 {
                    margin: 0 0 8px;
                    font-size: 20px;
                    font-weight: 700;
                    color: #111827;
                }
                
                .stc-header-info p {
                    margin: 0;
                    color: #6b7280;
                    font-size: 14px;
                }
                
                .stc-badge {
                    display: inline-block;
                    padding: 2px 8px;
                    font-size: 11px;
                    font-weight: 600;
                    border-radius: 12px;
                    margin-left: 8px;
                    background: #fef3c7;
                    color: #92400e;
                }
                
                .stc-toggle-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    cursor: pointer;
                }
                
                .stc-toggle-label {
                    font-weight: 600;
                    font-size: 14px;
                }
                
                .stc-section {
                    background: #fff;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 20px;
                }
                
                .stc-section-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                }
                
                .stc-section-header h3 {
                    font-size: 16px;
                    font-weight: 600;
                    margin: 0;
                    color: #374151;
                }
                
                .stc-hint {
                    font-size: 13px;
                    color: #6b7280;
                    margin-bottom: 16px;
                }
                
                .stc-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 12px;
                }
                
                .stc-tag {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 12px;
                    background: #f3f4f6;
                    border: 1px solid #d1d5db;
                    border-radius: 20px;
                    font-size: 13px;
                    color: #374151;
                }
                
                .stc-tag-repair {
                    background: #fef2f2;
                    border-color: #fca5a5;
                    color: #991b1b;
                }
                
                .stc-tag-maintenance {
                    background: #f0fdf4;
                    border-color: #86efac;
                    color: #166534;
                }
                
                .stc-tag-installation {
                    background: #eff6ff;
                    border-color: #93c5fd;
                    color: #1e40af;
                }
                
                .stc-tag-remove {
                    background: none;
                    border: none;
                    cursor: pointer;
                    color: inherit;
                    opacity: 0.6;
                    font-size: 14px;
                    padding: 0;
                    line-height: 1;
                }
                
                .stc-tag-remove:hover {
                    opacity: 1;
                }
                
                .stc-add-row {
                    display: flex;
                    gap: 8px;
                    margin-top: 8px;
                }
                
                .stc-input {
                    flex: 1;
                    padding: 8px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                }
                
                .stc-input:focus {
                    outline: none;
                    border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
                }
                
                .stc-btn {
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-weight: 500;
                    font-size: 14px;
                    cursor: pointer;
                    border: none;
                    transition: all 0.2s;
                }
                
                .stc-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                
                .stc-btn-primary {
                    background: #6366f1;
                    color: white;
                }
                
                .stc-btn-primary:hover:not(:disabled) {
                    background: #4f46e5;
                }
                
                .stc-btn-secondary {
                    background: #f3f4f6;
                    color: #374151;
                    border: 1px solid #d1d5db;
                }
                
                .stc-btn-secondary:hover:not(:disabled) {
                    background: #e5e7eb;
                }
                
                .stc-btn-sm {
                    padding: 4px 10px;
                    font-size: 12px;
                }
                
                .stc-btn-danger {
                    background: #fee2e2;
                    color: #dc2626;
                    border: 1px solid #fca5a5;
                }
                
                .stc-btn-danger:hover:not(:disabled) {
                    background: #fecaca;
                }
                
                .stc-textarea {
                    width: 100%;
                    padding: 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 8px;
                    font-size: 14px;
                    font-family: inherit;
                    resize: vertical;
                    min-height: 80px;
                }
                
                .stc-textarea:focus {
                    outline: none;
                    border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
                }
                
                .stc-service-type {
                    background: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    padding: 16px;
                    margin-bottom: 16px;
                }
                
                .stc-service-type-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                }
                
                .stc-service-type-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .stc-service-type-title input[type="checkbox"] {
                    width: 18px;
                    height: 18px;
                }
                
                .stc-service-type-title strong {
                    font-size: 15px;
                    color: #111827;
                }
                
                .stc-service-type-actions {
                    display: flex;
                    gap: 8px;
                }
                
                .stc-field {
                    margin-bottom: 12px;
                }
                
                .stc-field label {
                    display: block;
                    font-size: 13px;
                    font-weight: 500;
                    color: #374151;
                    margin-bottom: 4px;
                }
                
                .stc-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    padding-top: 20px;
                    border-top: 1px solid #e5e7eb;
                    margin-top: 20px;
                }
                
                .stc-notification {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    padding: 12px 20px;
                    border-radius: 8px;
                    font-weight: 500;
                    z-index: 9999;
                    animation: slideIn 0.3s ease;
                }
                
                .stc-notification.success {
                    background: #10b981;
                    color: white;
                }
                
                .stc-notification.error {
                    background: #ef4444;
                    color: white;
                }
                
                .stc-notification.info {
                    background: #6366f1;
                    color: white;
                }
                
                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                
                .stc-calendar-select {
                    padding: 8px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    width: 100%;
                    background: white;
                }
                
                .stc-priority-badge {
                    font-size: 11px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    background: #e5e7eb;
                    color: #4b5563;
                    margin-left: 8px;
                }
            </style>
            
            <div class="stc-container">
                <div class="stc-header">
                    <div class="stc-header-info">
                        <h2>🔧 Service Type Clarification <span class="stc-badge">CRITICAL</span></h2>
                        <p>When caller says "I need AC service" — ask if it's repair or maintenance to route to the correct calendar.</p>
                    </div>
                    <div class="stc-header-actions">
                        <label class="stc-toggle-row">
                            <input type="checkbox" id="stc-enabled" ${cfg.enabled ? 'checked' : ''} onchange="serviceTypeClarificationManager.toggleEnabled()">
                            <span class="stc-toggle-label">${cfg.enabled ? '✅ Enabled' : '⚪ Disabled'}</span>
                        </label>
                    </div>
                </div>
                
                <!-- Clarification Question -->
                <div class="stc-section">
                    <div class="stc-section-header">
                        <h3>💬 Clarification Question</h3>
                    </div>
                    <p class="stc-hint">This question is asked when the caller uses ambiguous phrases like "I need service".</p>
                    <textarea id="stc-question" class="stc-textarea" oninput="serviceTypeClarificationManager.markDirty()">${cfg.clarificationQuestion || ''}</textarea>
                </div>
                
                <!-- Ambiguous Phrases -->
                <div class="stc-section">
                    <div class="stc-section-header">
                        <h3>⚠️ Ambiguous Phrases</h3>
                    </div>
                    <p class="stc-hint">When caller uses these phrases WITHOUT clear repair/maintenance keywords, ask for clarification.</p>
                    <div class="stc-tags" id="stc-ambiguous-tags">
                        ${this.renderAmbiguousTags(cfg.ambiguousPhrases || [])}
                    </div>
                    <div class="stc-add-row">
                        <input type="text" id="stc-new-ambiguous" class="stc-input" placeholder="Add phrase (e.g., 'come out')">
                        <button class="stc-btn stc-btn-secondary" onclick="serviceTypeClarificationManager.addAmbiguousPhrase()">+ Add</button>
                    </div>
                </div>
                
                <!-- Service Types -->
                <div class="stc-section">
                    <div class="stc-section-header">
                        <h3>📋 Service Types</h3>
                        <button class="stc-btn stc-btn-secondary stc-btn-sm" onclick="serviceTypeClarificationManager.addServiceType()">+ Add Service Type</button>
                    </div>
                    <p class="stc-hint">Each service type has keywords that auto-detect it, and can map to a specific calendar.</p>
                    <div id="stc-service-types">
                        ${this.renderServiceTypes(cfg.serviceTypes || [])}
                    </div>
                </div>
                
                <!-- Actions -->
                <div class="stc-actions">
                    <button class="stc-btn stc-btn-secondary" onclick="serviceTypeClarificationManager.reset()">🔄 Reset to Defaults</button>
                    <button class="stc-btn stc-btn-primary" id="stc-save-btn" onclick="serviceTypeClarificationManager.save()" ${this.isDirty ? '' : 'disabled'}>💾 Save Changes</button>
                </div>
            </div>
        `;
        
        this.attachEventListeners();
    }

    /**
     * Render ambiguous phrase tags
     */
    renderAmbiguousTags(phrases) {
        return phrases.map((phrase, idx) => `
            <span class="stc-tag">
                ${phrase}
                <button class="stc-tag-remove" onclick="serviceTypeClarificationManager.removeAmbiguousPhrase(${idx})">×</button>
            </span>
        `).join('');
    }

    /**
     * Render service types
     */
    renderServiceTypes(serviceTypes) {
        if (!serviceTypes || serviceTypes.length === 0) {
            return '<p style="color: #6b7280; font-style: italic;">No service types configured. Add one to get started.</p>';
        }
        
        return serviceTypes.map((st, idx) => {
            const tagClass = `stc-tag-${st.key}`;
            const icon = st.key === 'repair' ? '🔧' : st.key === 'maintenance' ? '🧹' : st.key === 'installation' ? '🏗️' : '📌';
            
            return `
                <div class="stc-service-type" data-index="${idx}">
                    <div class="stc-service-type-header">
                        <div class="stc-service-type-title">
                            <input type="checkbox" ${st.enabled !== false ? 'checked' : ''} 
                                   onchange="serviceTypeClarificationManager.toggleServiceType(${idx})">
                            <strong>${icon} ${st.label || st.key}</strong>
                            <span class="stc-priority-badge">Priority: ${st.priority || idx + 1}</span>
                        </div>
                        <div class="stc-service-type-actions">
                            <button class="stc-btn stc-btn-secondary stc-btn-sm" onclick="serviceTypeClarificationManager.editServiceType(${idx})">Edit</button>
                            <button class="stc-btn stc-btn-danger stc-btn-sm" onclick="serviceTypeClarificationManager.removeServiceType(${idx})">🗑️</button>
                        </div>
                    </div>
                    
                    <div class="stc-field">
                        <label>Keywords (when detected, skips clarification)</label>
                        <div class="stc-tags">
                            ${(st.keywords || []).map((kw, kwIdx) => `
                                <span class="stc-tag ${tagClass}">
                                    ${kw}
                                    <button class="stc-tag-remove" onclick="serviceTypeClarificationManager.removeKeyword(${idx}, ${kwIdx})">×</button>
                                </span>
                            `).join('')}
                        </div>
                        <div class="stc-add-row">
                            <input type="text" class="stc-input stc-keyword-input" data-type-idx="${idx}" placeholder="Add keyword">
                            <button class="stc-btn stc-btn-secondary stc-btn-sm" onclick="serviceTypeClarificationManager.addKeyword(${idx})">+ Add</button>
                        </div>
                    </div>
                    
                    <div class="stc-field">
                        <label>Calendar (optional - for routing)</label>
                        <input type="text" class="stc-input" value="${st.calendarId || ''}" 
                               placeholder="Calendar ID or leave empty"
                               onchange="serviceTypeClarificationManager.updateCalendarId(${idx}, this.value)">
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Enter key for adding phrases
        const newAmbiguousInput = document.getElementById('stc-new-ambiguous');
        if (newAmbiguousInput) {
            newAmbiguousInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addAmbiguousPhrase();
                }
            });
        }
        
        // Enter key for adding keywords
        document.querySelectorAll('.stc-keyword-input').forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const idx = parseInt(input.dataset.typeIdx);
                    this.addKeyword(idx);
                }
            });
        });
    }

    /**
     * Toggle enabled state
     */
    toggleEnabled() {
        this.config.enabled = document.getElementById('stc-enabled').checked;
        this.markDirty();
        this.render();
    }

    /**
     * Mark config as dirty (unsaved changes)
     */
    markDirty() {
        this.isDirty = true;
        const saveBtn = document.getElementById('stc-save-btn');
        if (saveBtn) saveBtn.disabled = false;
    }

    /**
     * Add ambiguous phrase
     */
    addAmbiguousPhrase() {
        const input = document.getElementById('stc-new-ambiguous');
        const phrase = input.value.trim().toLowerCase();
        
        if (!phrase) return;
        
        if (!this.config.ambiguousPhrases) {
            this.config.ambiguousPhrases = [];
        }
        
        if (!this.config.ambiguousPhrases.includes(phrase)) {
            this.config.ambiguousPhrases.push(phrase);
            this.markDirty();
            this.render();
        }
        
        input.value = '';
    }

    /**
     * Remove ambiguous phrase
     */
    removeAmbiguousPhrase(idx) {
        this.config.ambiguousPhrases.splice(idx, 1);
        this.markDirty();
        this.render();
    }

    /**
     * Add service type
     */
    addServiceType() {
        const key = prompt('Enter service type key (e.g., "repair", "maintenance", "emergency"):');
        if (!key) return;
        
        const label = prompt('Enter display label (e.g., "Repair", "Maintenance / Tune-Up"):');
        if (!label) return;
        
        if (!this.config.serviceTypes) {
            this.config.serviceTypes = [];
        }
        
        this.config.serviceTypes.push({
            key: key.toLowerCase().replace(/\s+/g, '_'),
            label: label,
            keywords: [],
            calendarId: null,
            priority: this.config.serviceTypes.length + 1,
            enabled: true
        });
        
        this.markDirty();
        this.render();
    }

    /**
     * Edit service type
     */
    editServiceType(idx) {
        const st = this.config.serviceTypes[idx];
        const newLabel = prompt('Edit display label:', st.label);
        if (newLabel !== null) {
            st.label = newLabel;
            this.markDirty();
            this.render();
        }
    }

    /**
     * Remove service type
     */
    removeServiceType(idx) {
        if (confirm('Are you sure you want to remove this service type?')) {
            this.config.serviceTypes.splice(idx, 1);
            this.markDirty();
            this.render();
        }
    }

    /**
     * Toggle service type enabled
     */
    toggleServiceType(idx) {
        this.config.serviceTypes[idx].enabled = !this.config.serviceTypes[idx].enabled;
        this.markDirty();
    }

    /**
     * Add keyword to service type
     */
    addKeyword(typeIdx) {
        const input = document.querySelector(`.stc-keyword-input[data-type-idx="${typeIdx}"]`);
        const keyword = input.value.trim().toLowerCase();
        
        if (!keyword) return;
        
        if (!this.config.serviceTypes[typeIdx].keywords) {
            this.config.serviceTypes[typeIdx].keywords = [];
        }
        
        if (!this.config.serviceTypes[typeIdx].keywords.includes(keyword)) {
            this.config.serviceTypes[typeIdx].keywords.push(keyword);
            this.markDirty();
            this.render();
        }
        
        input.value = '';
    }

    /**
     * Remove keyword from service type
     */
    removeKeyword(typeIdx, kwIdx) {
        this.config.serviceTypes[typeIdx].keywords.splice(kwIdx, 1);
        this.markDirty();
        this.render();
    }

    /**
     * Update calendar ID
     */
    updateCalendarId(idx, value) {
        this.config.serviceTypes[idx].calendarId = value || null;
        this.markDirty();
    }

    /**
     * Reset to defaults
     */
    async reset() {
        if (confirm('Reset to default configuration? This will discard all customizations.')) {
            this.config = this.getDefaultConfig();
            this.markDirty();
            this.render();
            this.showNotification('Reset to defaults. Save to apply.', 'info');
        }
    }

    /**
     * Save configuration
     */
    async save() {
        try {
            this.showNotification('💾 Saving...', 'info');
            
            // Collect current values
            this.config.clarificationQuestion = document.getElementById('stc-question')?.value || this.config.clarificationQuestion;
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/service-type-clarification/${this.companyId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.config)
            });
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message);
            }
            
            this.isDirty = false;
            this.originalConfig = JSON.parse(JSON.stringify(this.config));
            this.showNotification('✅ Service Type Clarification saved!', 'success');
            this.render();
            
        } catch (error) {
            console.error('[SERVICE TYPE] Save failed:', error);
            this.showNotification('❌ Save failed: ' + error.message, 'error');
        }
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Remove existing
        const existing = document.querySelector('.stc-notification');
        if (existing) existing.remove();
        
        const notification = document.createElement('div');
        notification.className = `stc-notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.remove(), 3000);
        console.log(`[SERVICE TYPE] ${type.toUpperCase()}: ${message}`);
    }
}

// Create global instance
window.serviceTypeClarificationManager = new ServiceTypeClarificationManager();
console.log('[SERVICE TYPE] ✅ Global instance created: window.serviceTypeClarificationManager');

