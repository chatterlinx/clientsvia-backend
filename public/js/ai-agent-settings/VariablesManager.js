/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║                         VARIABLES TAB - MANAGER                            ║
 * ║                    AI Agent Settings > Variables Sub-Tab                   ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 * 
 * FILE: public/js/ai-agent-settings/VariablesManager.js
 * PARENT: AIAgentSettingsManager.js
 * LOADED IN: public/company-profile.html (line ~1566)
 * 
 * ┌─ PURPOSE ──────────────────────────────────────────────────────────────────┐
 * │ Manages company-specific variables used across all AI scenarios           │
 * │ Variables like {companyName}, {hvacServiceCall} are auto-replaced         │
 * │ in AI responses during live calls.                                         │
 * └────────────────────────────────────────────────────────────────────────────┘
 * 
 * ┌─ UI STRUCTURE ─────────────────────────────────────────────────────────────┐
 * │ 1. Hero Header (Purple gradient with progress bar)                        │
 * │ 2. Pro Tip Banner (Blue info box)                                         │
 * │ 3. Category Cards (Color-coded: Blue, Green, Purple, Orange, etc.)        │
 * │    - Company Info (Blue) 🏢                                               │
 * │    - Pricing (Green) 💰                                                   │
 * │    - Contact (Purple) 📞                                                  │
 * │    - Scheduling (Orange) 📅                                               │
 * │    - Services (Indigo) 🔧                                                 │
 * │    - General (Gray) 📝                                                    │
 * │ 4. Variable Cards (Gray cards with status badges and Preview buttons)     │
 * └────────────────────────────────────────────────────────────────────────────┘
 * 
 * ┌─ KEY METHODS ──────────────────────────────────────────────────────────────┐
 * │ load()              - Fetch variables from API                             │
 * │ render()            - Main render method (Hero + Categories)               │
 * │ renderEmpty()       - Empty state when no template active                  │
 * │ renderCategory()    - Color-coded category cards                           │
 * │ renderVariableRow() - Individual variable inline cards                     │
 * │ scanPlaceholders()  - Auto-detect new variables from templates             │
 * │ save()              - Preview & save flow with validation                  │
 * │ validateInput()     - Real-time validation (email, phone, URL, etc.)       │
 * │ previewVariable()   - Show where variable is used in scenarios             │
 * └────────────────────────────────────────────────────────────────────────────┘
 * 
 * ┌─ API ENDPOINTS ────────────────────────────────────────────────────────────┐
 * │ GET    /api/company/:companyId/configuration/variables                     │
 * │ POST   /api/company/:companyId/configuration/variables/scan                │
 * │ POST   /api/company/:companyId/configuration/variables/preview             │
 * │ POST   /api/company/:companyId/configuration/variables/apply               │
 * │ GET    /api/company/:companyId/configuration/variables/:key/usage          │
 * └────────────────────────────────────────────────────────────────────────────┘
 * 
 * ⚠️  CRITICAL DEPENDENCIES:
 * - Parent: AIAgentSettingsManager.js (provides companyId, showError, etc.)
 * - Backend: routes/company/v2companyConfiguration.js (variables endpoints)
 * - CSS: public/css/ai-agent-settings.css (modern card styles)
 * 
 * 📝 NOTES FOR FUTURE:
 * - All validation logic is client-side AND server-side mirrored
 * - Preview system uses tokens with 10-minute expiration
 * - Scan detects new variables from ALL active Global AI Brain templates
 * - Category colors are hard-coded in renderCategory() method
 * - Usage counts are auto-updated when templates change
 * 
 * 🔒 DO NOT:
 * - Remove validation logic (backend depends on it matching)
 * - Change API endpoints without updating backend routes
 * - Modify preview token flow (idempotency key prevents double-apply)
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
    
    /* ═══════════════════════════════════════════════════════════════════════
     * SECTION 1: DATA LOADING
     * ═══════════════════════════════════════════════════════════════════════ */
    
    /**
     * Load variables from API
     */
    async load() {
        console.log('💼 [VARIABLES] Loading...');
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
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
    
    /* ═══════════════════════════════════════════════════════════════════════
     * SECTION 2: PLACEHOLDER SCANNING
     * Purpose: Auto-detect variables from active templates
     * Triggers: Manual (Scan button) or Auto (template activation/removal)
     * ═══════════════════════════════════════════════════════════════════════ */
    
    /**
     * Scan all active templates for placeholders ({variable}, [variable], etc.)
     * Auto-detects new variables, updates usage counts, generates alerts
     */
    async scanPlaceholders() {
        console.log('🔍 [VARIABLES] Starting placeholder scan...');
        
        try {
            this.parent.showLoadingState();
            
            // Call scan API
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables/scan`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP ${response.status}`);
            }
            
            const scanResult = await response.json();
            
            console.log('✅ [VARIABLES] Scan complete:', scanResult);
            
            // Show results modal
            this.showScanResultsModal(scanResult);
            
            // Reload variables to show updates
            await this.load();
            
        } catch (error) {
            console.error('❌ [VARIABLES] Scan failed:', error);
            this.parent.showError(`Scan failed: ${error.message}`);
        } finally {
            this.parent.hideLoadingState();
        }
    }
    
    /**
     * Show scan results modal
     */
    showScanResultsModal(scanResult) {
        const modal = document.createElement('div');
        modal.id = 'scan-results-modal';
        modal.className = 'ai-settings-modal-overlay';
        
        // Determine alert status
        const alertStatus = scanResult.hasAlert 
            ? `<div class="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 mb-6">
                   <div class="flex items-center">
                       <i class="fas fa-exclamation-triangle text-yellow-600 text-2xl mr-3"></i>
                       <div>
                           <div class="font-bold text-yellow-900">Missing Required Variables</div>
                           <div class="text-yellow-800">${scanResult.missingRequired} required variable(s) need values before going live.</div>
                       </div>
                   </div>
               </div>`
            : `<div class="bg-green-50 border-2 border-green-400 rounded-lg p-4 mb-6">
                   <div class="flex items-center">
                       <i class="fas fa-check-circle text-green-600 text-2xl mr-3"></i>
                       <div class="font-bold text-green-900">All Set! No missing required variables.</div>
                   </div>
               </div>`;
        
        modal.innerHTML = `
            <div class="ai-settings-modal max-w-4xl">
                <div class="ai-settings-modal-header">
                    <h2><i class="fas fa-search mr-2"></i>Placeholder Scan Results</h2>
                    <button class="ai-settings-modal-close" onclick="this.closest('.ai-settings-modal-overlay').remove()">×</button>
                </div>
                
                <div class="ai-settings-modal-body">
                    <!-- Summary -->
                    <div class="grid grid-cols-3 gap-4 mb-6">
                        <div class="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 text-center">
                            <div class="text-3xl font-bold text-blue-600">${scanResult.newPlaceholders || 0}</div>
                            <div class="text-sm text-blue-800 font-medium">New Placeholders</div>
                        </div>
                        <div class="bg-purple-50 border-2 border-purple-200 rounded-lg p-4 text-center">
                            <div class="text-3xl font-bold text-purple-600">${scanResult.existingPlaceholders || 0}</div>
                            <div class="text-sm text-purple-800 font-medium">Existing Placeholders</div>
                        </div>
                        <div class="bg-orange-50 border-2 border-orange-200 rounded-lg p-4 text-center">
                            <div class="text-3xl font-bold text-orange-600">${scanResult.updatedPlaceholders || 0}</div>
                            <div class="text-sm text-orange-800 font-medium">Updated Counts</div>
                        </div>
                    </div>
                    
                    <!-- Alert Status -->
                    ${alertStatus}
                    
                    <!-- New Placeholders -->
                    ${scanResult.details?.newItems && scanResult.details.newItems.length > 0 ? `
                        <div class="mb-6">
                            <h3 class="text-lg font-bold text-gray-900 mb-3">
                                <i class="fas fa-plus-circle text-green-600 mr-2"></i>
                                New Placeholders Detected (${scanResult.details.newItems.length})
                            </h3>
                            <div class="space-y-2">
                                ${scanResult.details.newItems.map(item => `
                                    <div class="bg-green-50 border-l-4 border-green-500 p-3 rounded">
                                        <div class="flex items-center justify-between">
                                            <div>
                                                <code class="bg-green-100 text-green-800 px-2 py-1 rounded font-mono text-sm">{${item.key}}</code>
                                                <span class="ml-2 text-gray-700">${item.label || item.key}</span>
                                                ${item.required ? '<span class="ml-2 text-red-600 font-bold">*</span>' : ''}
                                            </div>
                                            <div class="flex items-center space-x-3">
                                                <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">${item.type || 'text'}</span>
                                                <span class="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded">${item.category || 'General'}</span>
                                                <span class="text-xs text-gray-500">${item.usageCount || 0} uses</span>
                                            </div>
                                        </div>
                                        ${item.description ? `<div class="text-xs text-gray-600 mt-1">${item.description}</div>` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    <!-- Updated Placeholders -->
                    ${scanResult.details?.updatedItems && scanResult.details.updatedItems.length > 0 ? `
                        <div class="mb-6">
                            <h3 class="text-lg font-bold text-gray-900 mb-3">
                                <i class="fas fa-sync-alt text-orange-600 mr-2"></i>
                                Updated Usage Counts (${scanResult.details.updatedItems.length})
                            </h3>
                            <div class="space-y-2">
                                ${scanResult.details.updatedItems.map(item => `
                                    <div class="bg-orange-50 border-l-4 border-orange-500 p-3 rounded">
                                        <div class="flex items-center justify-between">
                                            <code class="bg-orange-100 text-orange-800 px-2 py-1 rounded font-mono text-sm">{${item.key}}</code>
                                            <div class="text-sm text-gray-700">
                                                <span class="line-through text-gray-400">${item.oldCount} uses</span>
                                                <i class="fas fa-arrow-right mx-2 text-gray-400"></i>
                                                <span class="font-bold text-orange-700">${item.newCount} uses</span>
                                            </div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    <!-- No Changes -->
                    ${(!scanResult.details?.newItems || scanResult.details.newItems.length === 0) && 
                      (!scanResult.details?.updatedItems || scanResult.details.updatedItems.length === 0) ? `
                        <div class="text-center py-8">
                            <i class="fas fa-check-circle text-6xl text-gray-300 mb-4"></i>
                            <div class="text-lg font-bold text-gray-700">No Changes Detected</div>
                            <div class="text-gray-500">All placeholders are up to date.</div>
                        </div>
                    ` : ''}
                </div>
                
                <div class="ai-settings-modal-footer">
                    <button class="ai-settings-btn ai-settings-btn-primary" onclick="this.closest('.ai-settings-modal-overlay').remove()">
                        <i class="fas fa-check mr-2"></i>
                        Got It
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    /* ═══════════════════════════════════════════════════════════════════════
     * SECTION 3: UI RENDERING
     * Modern card-based design with hero header, progress tracking, categories
     * ═══════════════════════════════════════════════════════════════════════ */
    
    /**
     * Main render method: Hero Header + Pro Tip + Category Cards
     */
    render() {
        console.log('🎨 [VARIABLES RENDER] Starting render...');
        const container = document.getElementById('variables-container');
        if (!container) {
            console.error('❌ [VARIABLES RENDER] Container not found!');
            return;
        }
        
        console.log('🎨 [VARIABLES RENDER] Variable definitions count:', this.variableDefinitions.length);
        
        if (this.variableDefinitions.length === 0) {
            console.log('🎨 [VARIABLES RENDER] Calling renderEmpty()...');
            this.renderEmpty();
            return;
        }
        
        // Calculate stats
        const totalVars = this.variableDefinitions.length;
        const filledVars = this.variableDefinitions.filter(v => {
            const value = this.variables[v.key] || '';
            return value.trim() !== '';
        }).length;
        const completionPercent = Math.round((filledVars / totalVars) * 100);
        const requiredVars = this.variableDefinitions.filter(v => v.required).length;
        const filledRequired = this.variableDefinitions.filter(v => {
            if (!v.required) return false;
            const value = this.variables[v.key] || '';
            return value.trim() !== '';
        }).length;
        
        // Hero header with stats
        let html = `
            <!-- Hero Header -->
            <div class="relative overflow-hidden rounded-2xl shadow-lg mb-8" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <div class="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -mr-32 -mt-16"></div>
                <div class="absolute bottom-0 left-0 w-48 h-48 bg-white opacity-5 rounded-full -ml-24 -mb-12"></div>
                
                <div class="relative px-8 py-6">
                    <div class="flex items-center justify-between">
                        <div class="flex-1">
                            <h2 class="text-3xl font-bold text-white mb-2 flex items-center gap-3">
                                <i class="fas fa-sliders-h"></i>
                                Company Variables
                            </h2>
                            <p class="text-white text-opacity-90 text-lg mb-4">
                                Fill in your details once. They'll auto-replace across <strong>ALL 500+ AI scenarios!</strong>
                            </p>
                            <div class="bg-white bg-opacity-20 rounded-full h-3 overflow-hidden mb-2">
                                <div class="bg-white h-full rounded-full transition-all duration-500" style="width: ${completionPercent}%"></div>
                            </div>
                            <div class="text-white text-opacity-90 text-sm font-medium">
                                ${filledVars} of ${totalVars} variables filled · ${completionPercent}% complete
                            </div>
                        </div>
                        <div class="flex gap-4 ml-8">
                            <div class="bg-white bg-opacity-10 backdrop-blur-sm rounded-xl p-4 text-center min-w-[120px]">
                                <div class="text-4xl font-bold text-white">${filledRequired}/${requiredVars}</div>
                                <div class="text-white text-opacity-80 text-sm font-medium mt-1">Required</div>
                            </div>
                            <button 
                                onclick="variablesManager.scanPlaceholders()"
                                class="bg-white bg-opacity-10 backdrop-blur-sm hover:bg-opacity-20 rounded-xl p-4 text-center min-w-[120px] transition-all border-2 border-white border-opacity-20"
                                title="Scan templates for new placeholders"
                            >
                                <div class="text-3xl mb-1">🔍</div>
                                <div class="text-white text-sm font-bold">Scan Now</div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Pro Tip -->
            <div class="bg-blue-50 border-l-4 border-blue-500 rounded-lg p-4 mb-6 flex items-start gap-3">
                <i class="fas fa-lightbulb text-blue-600 text-2xl mt-1"></i>
                <div class="flex-1">
                    <div class="font-bold text-blue-900 mb-1">💡 How Variables Work</div>
                    <div class="text-blue-800 text-sm">
                        Variables like <code class="bg-blue-200 text-blue-900 px-2 py-0.5 rounded font-mono text-xs">{companyName}</code> 
                        are placeholders. When a caller asks "What's your company name?", your AI automatically replaces it with the actual value you enter below!
                    </div>
                </div>
            </div>
        `;
        
        // Group variables by category
        const grouped = this.groupByCategory(this.variableDefinitions);
        
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
     * Render a category section (MODERN COLOR-CODED CARDS)
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
        
        const categoryColors = {
            'Company Info': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900', badge: 'bg-blue-100 text-blue-800' },
            'Pricing': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-900', badge: 'bg-green-100 text-green-800' },
            'Contact': { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', badge: 'bg-purple-100 text-purple-800' },
            'Scheduling': { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-900', badge: 'bg-orange-100 text-orange-800' },
            'Services': { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-900', badge: 'bg-indigo-100 text-indigo-800' },
            'General': { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-900', badge: 'bg-gray-100 text-gray-800' }
        };
        
        const icon = categoryIcons[categoryName] || '📋';
        const colors = categoryColors[categoryName] || categoryColors['General'];
        const categoryId = categoryName.toLowerCase().replace(/\s+/g, '-');
        
        // Calculate completion
        const filledCount = variables.filter(v => {
            const value = this.variables[v.key] || '';
            return value.trim() !== '';
        }).length;
        const completionPercent = Math.round((filledCount / variables.length) * 100);
        
        let html = `
            <div class="bg-white border-2 ${colors.border} rounded-xl shadow-md mb-6 overflow-hidden">
                <!-- Card Header -->
                <div class="${colors.bg} px-6 py-4 border-b-2 ${colors.border}">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="text-4xl">${icon}</div>
                            <div>
                                <h3 class="text-xl font-bold ${colors.text}">${categoryName}</h3>
                                <div class="text-sm ${colors.text} opacity-75">${variables.length} variable${variables.length === 1 ? '' : 's'}</div>
                            </div>
                        </div>
                        <div class="flex items-center gap-4">
                            <div class="text-right">
                                <div class="text-2xl font-bold ${colors.text}" id="${categoryId}-complete">${filledCount}</div>
                                <div class="text-xs ${colors.text} opacity-75">of ${variables.length}</div>
                            </div>
                            <div class="${colors.badge} px-4 py-2 rounded-lg font-bold text-sm">
                                ${completionPercent}%
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Card Body -->
                <div class="p-6 space-y-4">
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
     * Render a single variable row (MODERN INLINE CARD)
     */
    renderVariableRow(varDef) {
        const value = this.variables[varDef.key] || '';
        const isRequired = varDef.required || false;
        const isEmpty = value.trim() === '';
        const isFilled = !isEmpty;
        const usageCount = varDef.usageCount || 0;
        
        const inputType = varDef.type === 'number' ? 'number' : 
                         varDef.type === 'phone' ? 'tel' :
                         varDef.type === 'email' ? 'email' :
                         varDef.type === 'url' ? 'url' : 'text';
        
        const placeholder = varDef.example || `Enter ${varDef.label}...`;
        
        // Status badge
        const statusBadge = isFilled 
            ? '<span class="px-2 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-full flex items-center gap-1"><i class="fas fa-check-circle"></i> Filled</span>'
            : isRequired
                ? '<span class="px-2 py-1 bg-red-100 text-red-800 text-xs font-bold rounded-full flex items-center gap-1"><i class="fas fa-exclamation-circle"></i> Required</span>'
                : '<span class="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">Optional</span>';
        
        return `
            <div class="bg-gray-50 border-2 border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-all" data-key="${varDef.key}">
                <div class="flex items-start gap-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-2">
                            <code class="bg-white px-2 py-1 rounded text-sm font-mono text-blue-700 border border-blue-200">{${varDef.key}}</code>
                            ${statusBadge}
                        </div>
                        <div class="font-semibold text-gray-900 mb-1">${varDef.label}</div>
                        ${varDef.description ? `<div class="text-xs text-gray-600 mb-3">${varDef.description}</div>` : ''}
                        <input 
                            type="${inputType}"
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all text-gray-900 font-medium ai-settings-variable-input"
                            data-key="${varDef.key}"
                            value="${this.escapeHtml(value)}"
                            placeholder="${placeholder}"
                            ${varDef.pattern ? `pattern="${varDef.pattern}"` : ''}
                        />
                    </div>
                    <div class="flex flex-col items-center gap-2 pt-8">
                        <div class="text-center bg-white border-2 border-blue-200 rounded-lg p-3 min-w-[80px]">
                            <div class="text-2xl font-bold text-blue-600">${usageCount}</div>
                            <div class="text-xs text-gray-600 font-medium">uses</div>
                        </div>
                        <button 
                            class="px-4 py-2 bg-white border-2 border-gray-300 hover:border-blue-500 hover:bg-blue-50 rounded-lg transition-all text-sm font-semibold text-gray-700 hover:text-blue-700 flex items-center gap-2"
                            onclick="variablesManager.previewVariable('${varDef.key}')"
                            title="Preview where this is used"
                        >
                            <i class="fas fa-eye"></i>
                            Preview
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Render empty state (MODERN UI)
     */
    renderEmpty() {
        console.log('🎨 [VARIABLES RENDER EMPTY] Starting renderEmpty...');
        const container = document.getElementById('variables-container');
        if (!container) {
            console.error('❌ [VARIABLES RENDER EMPTY] Container not found!');
            return;
        }
        
        console.log('🎨 [VARIABLES RENDER EMPTY] Setting new HTML...');
        container.innerHTML = `
            <div class="flex items-center justify-center min-h-[500px]">
                <div class="text-center max-w-2xl px-8">
                    <div class="inline-flex items-center justify-center w-32 h-32 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full shadow-lg mb-6">
                        <i class="fas fa-box-open text-6xl text-blue-400"></i>
                    </div>
                    <h3 class="text-3xl font-bold text-gray-900 mb-3">No Template Active</h3>
                    <p class="text-lg text-gray-600 mb-8 leading-relaxed">
                        Activate a <strong>Global AI Brain template</strong> first.<br>
                        Variables like <code class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">{companyName}</code> 
                        will be auto-detected from your templates.
                    </p>
                    <button 
                        class="px-8 py-4 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3 mx-auto"
                        style="background: linear-gradient(to right, #2563eb, #4f46e5);"
                        onclick="document.querySelector('[data-subtab=\\'aicore-templates\\']').click()"
                    >
                        <i class="fas fa-plus-circle text-xl"></i>
                        Go to AiCore Templates
                    </button>
                </div>
            </div>
        `;
    }
    
    /* ═══════════════════════════════════════════════════════════════════════
     * SECTION 4: EVENT HANDLING & VALIDATION
     * Real-time input validation, change detection, error display
     * ═══════════════════════════════════════════════════════════════════════ */
    
    /**
     * Attach event listeners to all variable inputs
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
     * Validate input with inline error messages
     * CRITICAL: Client-side validation matching backend validators
     */
    validateInput(input) {
        const key = input.dataset.key;
        const varDef = this.variableDefinitions.find(v => v.key === key);
        
        if (!varDef) {
            this.clearValidationError(input);
            return true;
        }
        
        const value = input.value.trim();
        const isEmpty = value === '';
        const isRequired = varDef.required || false;
        const type = varDef.type || 'text';
        
        // Check required
        if (isRequired && isEmpty) {
            this.showValidationError(input, `${varDef.label} is required`);
            return false;
        }
        
        // Skip further validation if empty and not required
        if (isEmpty && !isRequired) {
            this.clearValidationError(input);
            return true;
        }
        
        // Type-specific validation
        let error = null;
        
        switch (type) {
            case 'email':
                if (!this.validateEmail(value)) {
                    error = 'Invalid email format (e.g. contact@company.com)';
                }
                break;
                
            case 'phone':
                if (!this.validatePhone(value)) {
                    error = 'Invalid phone format (e.g. +1-239-555-0100)';
                }
                break;
                
            case 'url':
                if (!this.validateUrl(value)) {
                    error = 'Invalid URL format (must start with http:// or https://)';
                }
                break;
                
            case 'currency':
                if (!this.validateCurrency(value)) {
                    error = 'Invalid currency format (e.g. 125.99 or $125.99)';
                }
                break;
                
            case 'enum':
                if (varDef.enumValues && !varDef.enumValues.includes(value)) {
                    error = `Must be one of: ${varDef.enumValues.join(', ')}`;
                }
                break;
                
            case 'text':
            case 'multiline':
                // Check pattern if specified
                if (varDef.validation?.pattern) {
                    const regex = new RegExp(varDef.validation.pattern);
                    if (!regex.test(value)) {
                        error = varDef.validation.message || 'Invalid format';
                    }
                }
                
                // Check min/max length
                if (varDef.validation?.minLength && value.length < varDef.validation.minLength) {
                    error = `Must be at least ${varDef.validation.minLength} characters`;
                }
                if (varDef.validation?.maxLength && value.length > varDef.validation.maxLength) {
                    error = `Must be no more than ${varDef.validation.maxLength} characters`;
                }
                break;
        }
        
        if (error) {
            this.showValidationError(input, error);
            return false;
        }
        
        // Valid
        this.clearValidationError(input);
        return true;
    }
    
    /**
     * Show validation error message below input
     */
    showValidationError(input, message) {
        input.classList.add('error');
        
        // Remove existing error message
        const existingError = input.parentElement.querySelector('.validation-error');
        if (existingError) {
            existingError.remove();
        }
        
        // Add new error message
        const errorEl = document.createElement('div');
        errorEl.className = 'validation-error';
        errorEl.textContent = message;
        input.parentElement.appendChild(errorEl);
    }
    
    /**
     * Clear validation error
     */
    clearValidationError(input) {
        input.classList.remove('error');
        
        const errorEl = input.parentElement.querySelector('.validation-error');
        if (errorEl) {
            errorEl.remove();
        }
    }
    
    /**
     * Validate email format
     */
    validateEmail(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    }
    
    /**
     * Validate phone format (basic check)
     */
    validatePhone(phone) {
        // Remove all non-digit characters
        const digits = phone.replace(/\D/g, '');
        // Must have at least 10 digits
        return digits.length >= 10;
    }
    
    /**
     * Validate URL format
     */
    validateUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }
    
    /**
     * Validate currency format
     */
    validateCurrency(value) {
        // Remove $, commas, and spaces
        const cleaned = value.replace(/[$,\s]/g, '');
        // Must be a valid number
        const num = parseFloat(cleaned);
        return !isNaN(num) && num >= 0;
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
    
    /* ═══════════════════════════════════════════════════════════════════════
     * SECTION 5: PREVIEW & SAVE SYSTEM
     * Before/after comparison, 10-minute token expiration, idempotency keys
     * ═══════════════════════════════════════════════════════════════════════ */
    
    /**
     * Preview where a variable is used across scenarios
     */
    async previewVariable(key) {
        console.log(`💼 [VARIABLES] Previewing: ${key}`);
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables/${key}/usage`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
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
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
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
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
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

