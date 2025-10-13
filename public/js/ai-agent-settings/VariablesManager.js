/**
 * ============================================================================
 * VARIABLES MANAGER - COMPANY-SPECIFIC DATA CONFIGURATION
 * ============================================================================
 * 
 * PURPOSE: Manage company-specific variables used across all AI scenarios
 * EXAMPLES: {companyName}, {hvacServiceCall}, {dispatcherPhone}, etc.
 * 
 * FEATURES:
 * - Visual validation (required fields highlighted)
 * - Usage tracking (shows where each variable is used)
 * - Preview system (see how replies will look with your data)
 * - Auto-save drafts
 * - Template inheritance
 * 
 * ============================================================================
 */

class VariablesManager {
    constructor(parentManager) {
        this.parent = parentManager;
        this.companyId = parentManager.companyId;
        this.variables = {};
        this.variableDefinitions = []; // From template
        this.isDirty = false;
        
        console.log('💼 [VARIABLES] Initialized');
    }
    
    /**
     * Load variables from API
     */
    async load() {
        console.log('💼 [VARIABLES] Loading...');
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            this.variables = data.variables || {};
            this.variableDefinitions = data.definitions || [];
            
            console.log('✅ [VARIABLES] Loaded:', this.variables);
            
            this.render();
            
        } catch (error) {
            console.error('❌ [VARIABLES] Failed to load:', error);
            this.renderEmpty();
        }
    }
    
    /**
     * Render variables UI
     */
    render() {
        const container = document.getElementById('variables-container');
        if (!container) return;
        
        if (this.variableDefinitions.length === 0) {
            this.renderEmpty();
            return;
        }
        
        // Group variables by category
        const grouped = this.groupByCategory(this.variableDefinitions);
        
        let html = '';
        
        for (const [category, vars] of Object.entries(grouped)) {
            html += this.renderCategory(category, vars);
        }
        
        container.innerHTML = html;
        
        // Attach event listeners
        this.attachEventListeners();
    }
    
    /**
     * Group variables by category
     */
    groupByCategory(definitions) {
        const groups = {};
        
        definitions.forEach(def => {
            const category = def.category || 'General';
            if (!groups[category]) {
                groups[category] = [];
            }
            groups[category].push(def);
        });
        
        return groups;
    }
    
    /**
     * Render a category section
     */
    renderCategory(categoryName, variables) {
        const categoryIcons = {
            'Company Info': '🏢',
            'Pricing': '💰',
            'Contact': '📞',
            'Scheduling': '📅',
            'Services': '🔧',
            'General': '📝'
        };
        
        const icon = categoryIcons[categoryName] || '📋';
        const categoryId = categoryName.toLowerCase().replace(/\s+/g, '-');
        
        let html = `
            <div class="ai-settings-section mb-6">
                <div class="ai-settings-section-header" onclick="this.nextElementSibling.classList.toggle('expanded')">
                    <h3>
                        ${icon} ${categoryName}
                    </h3>
                    <div class="ai-settings-section-status">
                        <span id="${categoryId}-complete">0</span>/<span id="${categoryId}-total">${variables.length}</span> 
                        <i class="fas fa-chevron-down ml-2"></i>
                    </div>
                </div>
                <div class="ai-settings-section-content expanded">
        `;
        
        variables.forEach(varDef => {
            html += this.renderVariableRow(varDef);
        });
        
        html += `
                </div>
            </div>
        `;
        
        return html;
    }
    
    /**
     * Render a single variable row
     */
    renderVariableRow(varDef) {
        const value = this.variables[varDef.key] || '';
        const isRequired = varDef.required || false;
        const isEmpty = value.trim() === '';
        const errorClass = isRequired && isEmpty ? 'error' : '';
        const usageCount = varDef.usageCount || 0;
        
        const inputType = varDef.type === 'number' ? 'number' : 
                         varDef.type === 'phone' ? 'tel' :
                         varDef.type === 'email' ? 'email' :
                         varDef.type === 'url' ? 'url' : 'text';
        
        const placeholder = varDef.example || `Enter ${varDef.label}...`;
        
        return `
            <div class="ai-settings-variable-row" data-key="${varDef.key}">
                <div class="ai-settings-variable-label">
                    ${varDef.label}
                    ${isRequired ? '<span class="text-red-600 ml-1">*</span>' : ''}
                    ${varDef.description ? `
                        <div class="text-xs text-gray-500 mt-1">${varDef.description}</div>
                    ` : ''}
                </div>
                <input 
                    type="${inputType}"
                    class="ai-settings-variable-input ${errorClass}"
                    data-key="${varDef.key}"
                    value="${this.escapeHtml(value)}"
                    placeholder="${placeholder}"
                    ${varDef.pattern ? `pattern="${varDef.pattern}"` : ''}
                />
                <div class="ai-settings-variable-usage">
                    <i class="fas fa-link text-gray-400"></i>
                    <span class="font-semibold">${usageCount}</span>
                    <div class="text-xs text-gray-400">uses</div>
                </div>
                <div class="ai-settings-variable-actions">
                    <button 
                        class="ai-settings-btn ai-settings-btn-secondary px-3 py-1 text-xs"
                        onclick="variablesManager.previewVariable('${varDef.key}')"
                        title="Preview where this is used"
                    >
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Render empty state
     */
    renderEmpty() {
        const container = document.getElementById('variables-container');
        if (!container) return;
        
        container.innerHTML = `
            <div class="text-center py-16">
                <i class="fas fa-box-open text-6xl text-gray-300 mb-4"></i>
                <h3 class="text-xl font-bold text-gray-700 mb-2">No Template Cloned</h3>
                <p class="text-gray-500 mb-6">
                    Clone a Global AI Brain template to get started with variables.
                </p>
                <button class="ai-settings-btn ai-settings-btn-primary" onclick="alert('Navigate to Global AI Brain to clone a template')">
                    <i class="fas fa-copy"></i>
                    Clone a Template
                </button>
            </div>
        `;
    }
    
    /**
     * Attach event listeners to inputs
     */
    attachEventListeners() {
        const inputs = document.querySelectorAll('.ai-settings-variable-input');
        
        inputs.forEach(input => {
            input.addEventListener('input', (e) => {
                this.onVariableChange(e.target.dataset.key, e.target.value);
            });
            
            input.addEventListener('blur', (e) => {
                this.validateInput(e.target);
            });
        });
    }
    
    /**
     * Handle variable change
     */
    onVariableChange(key, value) {
        this.variables[key] = value;
        this.isDirty = true;
        
        // Update UI
        this.updateCategoryStats();
        this.parent.updateStatusBanner();
        
        console.log(`💼 [VARIABLES] Changed: ${key} = ${value}`);
    }
    
    /**
     * Validate input
     */
    validateInput(input) {
        const key = input.dataset.key;
        const varDef = this.variableDefinitions.find(v => v.key === key);
        
        if (!varDef) return;
        
        const value = input.value.trim();
        const isEmpty = value === '';
        const isRequired = varDef.required || false;
        
        // Check required
        if (isRequired && isEmpty) {
            input.classList.add('error');
            return false;
        }
        
        // Check pattern
        if (varDef.pattern && value !== '') {
            const regex = new RegExp(varDef.pattern);
            if (!regex.test(value)) {
                input.classList.add('error');
                return false;
            }
        }
        
        // Valid
        input.classList.remove('error');
        return true;
    }
    
    /**
     * Update category completion stats
     */
    updateCategoryStats() {
        const grouped = this.groupByCategory(this.variableDefinitions);
        
        for (const [category, vars] of Object.entries(grouped)) {
            const categoryId = category.toLowerCase().replace(/\s+/g, '-');
            const completeCount = vars.filter(v => {
                const value = this.variables[v.key] || '';
                return value.trim() !== '';
            }).length;
            
            const completeEl = document.getElementById(`${categoryId}-complete`);
            if (completeEl) {
                completeEl.textContent = completeCount;
            }
        }
    }
    
    /**
     * Preview where a variable is used
     */
    async previewVariable(key) {
        console.log(`💼 [VARIABLES] Previewing: ${key}`);
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables/${key}/usage`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const usage = await response.json();
            
            this.showPreviewModal(key, usage);
            
        } catch (error) {
            console.error('❌ [VARIABLES] Failed to preview:', error);
            alert('Failed to load preview');
        }
    }
    
    /**
     * Show preview modal
     */
    showPreviewModal(key, usage) {
        const value = this.variables[key] || `{${key}}`;
        
        let html = `
            <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" id="variable-preview-modal">
                <div class="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
                    <div class="p-6 border-b-2 border-gray-200 flex items-center justify-between">
                        <h3 class="text-2xl font-bold text-gray-900">
                            <i class="fas fa-eye text-blue-600 mr-2"></i>
                            Preview: <code class="bg-blue-100 text-blue-800 px-3 py-1 rounded">{${key}}</code>
                        </h3>
                        <button onclick="document.getElementById('variable-preview-modal').remove()" class="ai-settings-btn ai-settings-btn-danger">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="p-6 overflow-y-auto flex-1">
                        <div class="bg-green-50 border-2 border-green-200 rounded-lg p-4 mb-6">
                            <div class="font-bold text-green-900 mb-2">Current Value:</div>
                            <div class="text-lg text-green-800">${this.escapeHtml(value)}</div>
                        </div>
                        
                        <div class="mb-4">
                            <h4 class="font-bold text-gray-900 mb-2">Used in ${usage.scenarios.length} scenario(s):</h4>
                        </div>
                        
                        ${usage.scenarios.map(scenario => `
                            <div class="bg-gray-50 border-2 border-gray-200 rounded-lg p-4 mb-4">
                                <div class="font-bold text-gray-900 mb-2">${scenario.name}</div>
                                <div class="text-sm text-gray-600 mb-3">${scenario.category}</div>
                                <div class="bg-white rounded p-3 text-sm">
                                    <div class="font-semibold text-gray-700 mb-1">Example Reply:</div>
                                    <div class="text-gray-900">${this.replaceVariable(scenario.exampleReply, key, value)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', html);
    }
    
    /**
     * Replace variable in text (for preview)
     */
    replaceVariable(text, key, value) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        const replaced = text.replace(regex, `<span class="bg-yellow-200 font-bold">${this.escapeHtml(value)}</span>`);
        return replaced;
    }
    
    /**
     * Save variables to API
     */
    /**
     * Preview changes before applying
     * CRITICAL: Shows before/after comparison and impact on scenarios
     */
    async save() {
        console.log('💼 [VARIABLES] Initiating preview...');
        
        // Validate all inputs
        const inputs = document.querySelectorAll('.ai-settings-variable-input');
        let isValid = true;
        
        inputs.forEach(input => {
            if (!this.validateInput(input)) {
                isValid = false;
            }
        });
        
        if (!isValid) {
            this.parent.showError('⚠️ Please fix validation errors before saving.');
            return;
        }
        
        try {
            this.parent.showLoadingState();
            
            // Call preview API
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables/preview`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    variables: this.variables
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP ${response.status}`);
            }
            
            const previewData = await response.json();
            
            console.log('✅ [VARIABLES] Preview generated:', previewData);
            
            // Show preview modal
            this.showPreviewModal(previewData);
            
        } catch (error) {
            console.error('❌ [VARIABLES] Preview failed:', error);
            this.parent.showError(`Preview failed: ${error.message}`);
        } finally {
            this.parent.hideLoadingState();
        }
    }
    
    /**
     * Show preview modal with before/after comparison
     */
    showPreviewModal(previewData) {
        const modal = document.createElement('div');
        modal.id = 'variables-preview-modal';
        modal.className = 'ai-settings-modal-overlay';
        
        // Countdown timer (10 minutes)
        const expiresAt = Date.now() + (previewData.expiresIn * 1000);
        
        modal.innerHTML = `
            <div class="ai-settings-modal">
                <div class="ai-settings-modal-header">
                    <h2>📝 Preview Changes</h2>
                    <button class="ai-settings-modal-close" onclick="this.closest('.ai-settings-modal-overlay').remove()">×</button>
                </div>
                
                <div class="ai-settings-modal-body">
                    <!-- Summary -->
                    <div class="preview-summary">
                        <div class="preview-summary-card">
                            <div class="preview-summary-icon">📊</div>
                            <div>
                                <div class="preview-summary-number">${previewData.summary.variablesChanging}</div>
                                <div class="preview-summary-label">Variables Changing</div>
                            </div>
                        </div>
                        <div class="preview-summary-card">
                            <div class="preview-summary-icon">💬</div>
                            <div>
                                <div class="preview-summary-number">${previewData.summary.scenariosAffected}</div>
                                <div class="preview-summary-label">Scenarios Affected</div>
                            </div>
                        </div>
                        <div class="preview-summary-card">
                            <div class="preview-summary-icon">⏰</div>
                            <div>
                                <div class="preview-summary-number" id="preview-countdown">10:00</div>
                                <div class="preview-summary-label">Time Remaining</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Changes List -->
                    <div class="preview-changes">
                        <h3>🔄 Changes</h3>
                        ${previewData.changes.map(change => `
                            <div class="preview-change-item ${change.status}">
                                <div class="preview-change-header">
                                    <span class="preview-change-badge ${change.status}">
                                        ${change.status === 'added' ? '➕ Added' : change.status === 'removed' ? '➖ Removed' : '✏️ Modified'}
                                    </span>
                                    <strong>${change.label || change.key}</strong>
                                    ${change.type ? `<span class="preview-change-type">${change.type}</span>` : ''}
                                </div>
                                <div class="preview-change-comparison">
                                    <div class="preview-change-old">
                                        <span class="preview-label">Before:</span>
                                        <code>${this.escapeHtml(change.oldValue)}</code>
                                    </div>
                                    <div class="preview-change-arrow">→</div>
                                    <div class="preview-change-new">
                                        <span class="preview-label">After:</span>
                                        <code>${this.escapeHtml(change.newValue)}</code>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    
                    <!-- Examples (if any) -->
                    ${previewData.examples && previewData.examples.length > 0 ? `
                        <div class="preview-examples">
                            <h3>📋 Example Impact</h3>
                            <p class="preview-examples-desc">See how these changes will affect AI responses:</p>
                            ${previewData.examples.slice(0, 3).map(ex => `
                                <div class="preview-example-item">
                                    <div class="preview-example-scenario">${this.escapeHtml(ex.scenarioName)}</div>
                                    <div class="preview-example-comparison">
                                        <div class="preview-example-before">
                                            <span class="preview-label">Before:</span>
                                            <div class="preview-example-text">${this.escapeHtml(ex.beforeText)}</div>
                                        </div>
                                        <div class="preview-example-after">
                                            <span class="preview-label">After:</span>
                                            <div class="preview-example-text">${this.escapeHtml(ex.afterText)}</div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
                
                <div class="ai-settings-modal-footer">
                    <button class="ai-settings-btn ai-settings-btn-secondary" onclick="this.closest('.ai-settings-modal-overlay').remove()">
                        Cancel
                    </button>
                    <button class="ai-settings-btn ai-settings-btn-success" onclick="variablesManager.applyChanges('${previewData.previewToken}', ${expiresAt})">
                        ✅ Apply Changes
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Start countdown timer
        this.startCountdown(expiresAt);
    }
    
    /**
     * Start countdown timer for preview expiration
     */
    startCountdown(expiresAt) {
        const countdownEl = document.getElementById('preview-countdown');
        if (!countdownEl) return;
        
        const interval = setInterval(() => {
            const remaining = Math.max(0, expiresAt - Date.now());
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            
            countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            if (remaining <= 0) {
                clearInterval(interval);
                countdownEl.textContent = 'Expired';
                countdownEl.style.color = '#ef4444';
                
                // Disable apply button
                const applyBtn = document.querySelector('.ai-settings-modal-footer .ai-settings-btn-success');
                if (applyBtn) {
                    applyBtn.disabled = true;
                    applyBtn.textContent = '⏰ Preview Expired';
                }
            }
        }, 1000);
    }
    
    /**
     * Apply changes using preview token
     * CRITICAL: Uses idempotency key to prevent double-apply
     */
    async applyChanges(previewToken, expiresAt) {
        console.log('💼 [VARIABLES] Applying changes...');
        
        // Check if preview expired
        if (Date.now() >= expiresAt) {
            this.parent.showError('Preview expired. Please generate a new preview.');
            return;
        }
        
        // Generate idempotency key (UUID v4)
        const idempotencyKey = this.generateIdempotencyKey();
        
        try {
            this.parent.showLoadingState();
            
            // Call apply API
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables/apply`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'idempotency-key': idempotencyKey
                },
                body: JSON.stringify({
                    variables: this.variables,
                    previewToken: previewToken
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            console.log('✅ [VARIABLES] Applied successfully:', result);
            
            // Close modal
            const modal = document.getElementById('variables-preview-modal');
            if (modal) modal.remove();
            
            // Show success
            this.isDirty = false;
            this.parent.showSuccess('✅ Variables saved successfully!');
            
            // Refresh to show updated data
            await this.parent.refresh();
            
        } catch (error) {
            console.error('❌ [VARIABLES] Apply failed:', error);
            this.parent.showError(`Failed to apply changes: ${error.message}`);
        } finally {
            this.parent.hideLoadingState();
        }
    }
    
    /**
     * Generate UUID v4 for idempotency key
     */
    generateIdempotencyKey() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use in AIAgentSettingsManager
if (typeof window !== 'undefined') {
    window.VariablesManager = VariablesManager;
}

