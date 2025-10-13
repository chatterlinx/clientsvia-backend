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
    async save() {
        console.log('💼 [VARIABLES] Saving...');
        
        // Validate all inputs
        const inputs = document.querySelectorAll('.ai-settings-variable-input');
        let isValid = true;
        
        inputs.forEach(input => {
            if (!this.validateInput(input)) {
                isValid = false;
            }
        });
        
        if (!isValid) {
            alert('⚠️ Please fix validation errors before saving.');
            return;
        }
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    variables: this.variables
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            console.log('✅ [VARIABLES] Saved successfully');
            
            this.isDirty = false;
            this.parent.showSuccess('Variables saved successfully!');
            this.parent.refresh();
            
        } catch (error) {
            console.error('❌ [VARIABLES] Failed to save:', error);
            this.parent.showError('Failed to save variables');
        }
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

