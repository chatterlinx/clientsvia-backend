/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║                      AICORE TEMPLATES TAB - MANAGER                        ║
 * ║                AI Agent Settings > AiCore Templates Sub-Tab                ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 * 
 * FILE: public/js/ai-agent-settings/AiCoreTemplatesManager.js
 * PARENT: AIAgentSettingsManager.js
 * LOADED IN: public/company-profile.html (line ~1569)
 * 
 * ┌─ PURPOSE ──────────────────────────────────────────────────────────────────┐
 * │ Manage Global AI Brain template activation/stacking for this company      │
 * │ Templates provide industry-specific Q&A scenarios (HVAC, Dental, etc.)    │
 * └────────────────────────────────────────────────────────────────────────────┘
 * 
 * ┌─ ARCHITECTURE ─────────────────────────────────────────────────────────────┐
 * │ REFERENCE-BASED SYSTEM (NO Cloning!)                                      │
 * │ - Templates live in Global AI Brain (shared across ALL companies)         │
 * │ - Companies "activate" templates → stores REFERENCES only                 │
 * │ - Multiple templates can be active (stacking with priority)               │
 * │ - Variables auto-scan triggers on activation/removal                      │
 * │ - Cache invalidation: Redis cleared on template changes                   │
 * └────────────────────────────────────────────────────────────────────────────┘
 * 
 * ┌─ UI STRUCTURE ─────────────────────────────────────────────────────────────┐
 * │ 1. ACTIVE TEMPLATES (Top Section)                                         │
 * │    - Large cards with green border                                        │
 * │    - Shows: Priority badge, stats (categories/scenarios/triggers)         │
 * │    - "Remove Template" button (red)                                       │
 * │    - Empty state: "No Templates Active Yet" with gray illustration        │
 * │                                                                            │
 * │ 2. AVAILABLE TEMPLATES (Bottom Section)                                   │
 * │    - Compact horizontal banners (list style)                              │
 * │    - Shows: Icon, Name, Industry, Version, Inline stats, Blue button     │
 * │    - "Activate" button (blue gradient) on right side                      │
 * │    - Filters out already-active templates                                 │
 * └────────────────────────────────────────────────────────────────────────────┘
 * 
 * ┌─ KEY METHODS ──────────────────────────────────────────────────────────────┐
 * │ load()                        - Fetch active + available templates        │
 * │ render()                      - Main render (Active + Available sections) │
 * │ renderActiveTemplatesSection() - Top section with active templates        │
 * │ renderActiveTemplateCard()    - Big green card for active template        │
 * │ renderAvailableTemplatesSection() - Bottom section gallery                │
 * │ renderAvailableTemplateCard() - Compact banner with Activate button       │
 * │ activateTemplate()            - POST to add template reference            │
 * │ removeTemplate()              - DELETE to remove template reference       │
 * └────────────────────────────────────────────────────────────────────────────┘
 * 
 * ┌─ API ENDPOINTS ────────────────────────────────────────────────────────────┐
 * │ GET    /api/company/:companyId/configuration/templates (Active templates) │
 * │ POST   /api/company/:companyId/configuration/templates (Activate)         │
 * │ DELETE /api/company/:companyId/configuration/templates/:templateId        │
 * │ GET    /api/admin/global-instant-responses/published (Available list)     │
 * └────────────────────────────────────────────────────────────────────────────┘
 * 
 * ⚠️  CRITICAL DEPENDENCIES:
 * - Parent: AIAgentSettingsManager.js
 * - Backend: routes/company/v2companyConfiguration.js (templates CRUD)
 * - Backend: routes/admin/globalInstantResponses.js (published templates)
 * - Model: models/GlobalInstantResponseTemplate.js (template schema)
 * 
 * 📝 NOTES FOR FUTURE:
 * - Activation triggers variable auto-scan (VariablesManager.scanPlaceholders)
 * - Stats (categories, scenarios, triggers) come from backend calculation
 * - Priority determines knowledge routing order (lower = checked first)
 * - Cache keys cleared: company:${companyId}, company-phone:${phoneNumber}
 * - Uses inline CSS for button colors (Tailwind classes weren't working)
 * 
 * 🔒 DO NOT:
 * - Change to "cloning" model (breaks shared template updates)
 * - Remove cache invalidation calls (causes stale data)
 * - Modify activation flow without updating Variables tab trigger
 * 
 * ============================================================================
 */

class AiCoreTemplatesManager {
    constructor(parentManager) {
        this.parent = parentManager;
        this.companyId = parentManager.companyId;
        this.loadedTemplates = []; // Active templates (references)
        this.availableTemplates = []; // All published templates from Global AI Brain
        this.isLoading = false;
        this.activatingTemplateId = null; // Track activation in progress
        
        console.log('🧠 [AICORE TEMPLATES] Initialized for company:', this.companyId);
    }
    
    /* ============================================================================
       DATA LOADING METHODS
       ============================================================================ */
    
    /* ═══════════════════════════════════════════════════════════════════════
     * SECTION 1: DATA LOADING
     * Fetch active templates (company references) + available (Global AI Brain)
     * ═══════════════════════════════════════════════════════════════════════ */
    
    /**
     * Load all data (active + available templates)
     * Called on tab initialization
     */
    async load() {
        console.log('🧠 [AICORE TEMPLATES] Loading data...');
        
        if (this.isLoading) {
            console.warn('⚠️ [AICORE TEMPLATES] Load already in progress, skipping');
            return;
        }
        
        this.isLoading = true;
        this.showLoadingState();
        
        try {
            // Load both in parallel for speed
            await Promise.all([
                this.loadActiveTemplates(),
                this.loadAvailableTemplates()
            ]);
            
            console.log('✅ [AICORE TEMPLATES] Data loaded successfully');
            console.log(`   Active: ${this.loadedTemplates.length} templates`);
            console.log(`   Available: ${this.availableTemplates.length} templates`);
            
            this.render();
            
        } catch (error) {
            console.error('❌ [AICORE TEMPLATES] Failed to load:', error);
            this.showError('Failed to load templates. Please refresh the page.');
        } finally {
            this.isLoading = false;
        }
    }
    
    /**
     * Load active templates for this company
     * Fetches template references from company.aiAgentSettings.templateReferences
     */
    async loadActiveTemplates() {
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/templates`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.loadedTemplates = await response.json();
            
            console.log(`✅ [AICORE TEMPLATES] Loaded ${this.loadedTemplates.length} active templates`);
            
        } catch (error) {
            console.error('❌ [AICORE TEMPLATES] Failed to load active templates:', error);
            this.loadedTemplates = [];
            throw error;
        }
    }
    
    /**
     * Load available templates from Global AI Brain
     * Fetches all published templates
     */
    async loadAvailableTemplates() {
        try {
            const response = await fetch('/api/admin/global-instant-responses/published', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const payload = await response.json();
            
            console.log('📦 [AICORE TEMPLATES DEBUG] Raw API response:', JSON.stringify(payload, null, 2));
            
            // Support both array and { success, data } response formats
            this.availableTemplates = Array.isArray(payload) 
                ? payload 
                : (payload && payload.data ? payload.data : []);
            
            console.log(`✅ [AICORE TEMPLATES] Loaded ${this.availableTemplates.length} available templates from Global AI Brain`);
            console.log('📊 [AICORE TEMPLATES DEBUG] Template stats sample:', 
                this.availableTemplates[0] ? JSON.stringify(this.availableTemplates[0].stats, null, 2) : 'No templates'
            );
            
        } catch (error) {
            console.error('❌ [AICORE TEMPLATES] Failed to load available templates:', error);
            this.availableTemplates = [];
            throw error;
        }
    }
    
    /* ═══════════════════════════════════════════════════════════════════════
     * SECTION 2: UI RENDERING
     * Card gallery: Active templates (top) + Available templates (bottom)
     * ═══════════════════════════════════════════════════════════════════════ */
    
    /**
     * Main render method - orchestrates the entire UI
     */
    render() {
        const container = document.getElementById('aicore-templates-container');
        if (!container) {
            console.error('❌ [AICORE TEMPLATES] Container not found');
            return;
        }
        
        console.log('[AICORE TEMPLATES] Rendering UI...');
        
        let html = `
            <!-- ============================================================ -->
            <!-- ACTIVE TEMPLATES SECTION -->
            <!-- ============================================================ -->
            ${this.renderActiveTemplatesSection()}
            
            <!-- ============================================================ -->
            <!-- AVAILABLE TEMPLATES SECTION -->
            <!-- ============================================================ -->
            ${this.renderAvailableTemplatesSection()}
        `;
        
        container.innerHTML = html;
        
        console.log('✅ [AICORE TEMPLATES] UI rendered successfully');
    }
    
    /**
     * Render Active Templates section (top)
     * Shows templates currently activated by this company
     */
    renderActiveTemplatesSection() {
        const hasActive = this.loadedTemplates.length > 0;
        
        let html = `
            <div class="mb-8">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <i class="fas fa-check-circle text-green-600"></i>
                        Active Templates
                        <span class="text-sm font-normal text-gray-500">(${this.loadedTemplates.length})</span>
                    </h3>
                    ${hasActive ? `
                        <button 
                            onclick="window.aiCoreTemplatesManager.refreshData()" 
                            class="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                            title="Refresh template data"
                        >
                            <i class="fas fa-sync-alt"></i>
                            Refresh
                        </button>
                    ` : ''}
                </div>
        `;
        
        if (!hasActive) {
            html += `
                <div class="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-dashed border-blue-300 rounded-xl p-12 text-center">
                    <div class="inline-flex items-center justify-center w-20 h-20 bg-white rounded-full shadow-md mb-4">
                        <i class="fas fa-box-open text-4xl text-blue-400"></i>
                    </div>
                    <h4 class="text-xl font-bold text-gray-800 mb-2">No Templates Active Yet</h4>
                    <p class="text-gray-600 mb-1">Browse the templates below and click <strong>"Activate"</strong> to get started.</p>
                    <p class="text-sm text-gray-500">Templates provide industry-specific scenarios for your AI agent.</p>
                </div>
            `;
        } else {
            html += '<div class="space-y-4">';
            
            // Sort by priority (lowest number = highest priority)
            const sorted = [...this.loadedTemplates].sort((a, b) => (a.priority || 99) - (b.priority || 99));
            
            sorted.forEach(template => {
                html += this.renderActiveTemplateCard(template);
            });
            
            html += '</div>';
        }
        
        html += '</div>'; // Close active section
        
        return html;
    }
    
    /**
     * Render a single active template card
     * @param {Object} template - Active template data
     */
    renderActiveTemplateCard(template) {
        const stats = template.stats || {};
        const categories = stats.totalCategories || stats.categories || 0;
        const scenarios = stats.totalScenarios || stats.scenarios || 0;
        const triggers = stats.totalTriggers || stats.triggers || 0;
        const version = template.version || 'v1.0.0';
        const icon = template.icon || '🔧';
        const priority = template.priority || 1;
        const activatedDate = template.clonedAt 
            ? new Date(template.clonedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Unknown';
        
        // Priority label
        let priorityLabel = 'Checked First';
        let priorityColor = 'green';
        if (priority === 1) {
            priorityLabel = 'Primary (Checked First)';
            priorityColor = 'green';
        } else if (priority === 2) {
            priorityLabel = 'Secondary';
            priorityColor = 'blue';
        } else {
            priorityLabel = `Fallback (Priority ${priority})`;
            priorityColor = 'gray';
        }
        
        return `
            <div class="relative bg-white border-2 border-green-200 rounded-xl p-6 shadow-md hover:shadow-xl transition-all">
                <!-- Priority Badge (Top Right) -->
                <div class="absolute top-4 right-4">
                    <span class="inline-flex items-center gap-1 px-3 py-1 bg-${priorityColor}-100 text-${priorityColor}-700 text-xs font-bold rounded-full border border-${priorityColor}-300">
                        <i class="fas fa-layer-group"></i>
                        ${priorityLabel}
                    </span>
                </div>
                
                <!-- Template Header -->
                <div class="flex items-start gap-4 mb-6 pr-40">
                    <div class="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center text-3xl flex-shrink-0 shadow-md">
                        ${icon}
                    </div>
                    <div class="flex-1 min-w-0">
                        <h4 class="text-2xl font-bold text-gray-900 mb-1">${this.escapeHtml(template.name)}</h4>
                        <p class="text-sm text-gray-600">${this.escapeHtml(template.description || 'No description available')}</p>
                        <div class="flex items-center gap-4 mt-2 text-xs text-gray-500">
                            <span><i class="fas fa-code-branch mr-1"></i>${version}</span>
                            <span><i class="fas fa-calendar-check mr-1"></i>Activated: ${activatedDate}</span>
                        </div>
                    </div>
                </div>
                
                <!-- Stats Grid -->
                <div class="grid grid-cols-3 gap-3">
                    <div class="text-center bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                        <div class="text-3xl font-bold text-blue-700">${categories}</div>
                        <div class="text-xs text-gray-700 mt-1 font-medium flex items-center justify-center gap-1">
                            <i class="fas fa-folder"></i>
                            Categories
                        </div>
                    </div>
                    <div class="text-center bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                        <div class="text-3xl font-bold text-green-700">${scenarios}</div>
                        <div class="text-xs text-gray-700 mt-1 font-medium flex items-center justify-center gap-1">
                            <i class="fas fa-comments"></i>
                            Scenarios
                        </div>
                    </div>
                    <div class="text-center bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
                        <div class="text-3xl font-bold text-purple-700">${triggers}</div>
                        <div class="text-xs text-gray-700 mt-1 font-medium flex items-center justify-center gap-1">
                            <i class="fas fa-bolt"></i>
                            Triggers
                        </div>
                    </div>
                </div>
                
                <!-- Remove Button -->
                <div class="mt-4 pt-4 border-t border-gray-200 flex justify-end">
                    <button 
                        onclick="window.aiCoreTemplatesManager.removeTemplate('${template.templateId}')"
                        class="px-4 py-2 text-sm font-semibold text-red-600 hover:text-white hover:bg-red-600 border-2 border-red-600 rounded-lg transition-all"
                        title="Remove this template"
                    >
                        <i class="fas fa-trash-alt mr-1"></i>
                        Remove Template
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Render Available Templates section (bottom)
     * Shows all published templates from Global AI Brain
     */
    renderAvailableTemplatesSection() {
        // Filter out already active templates
        const activeIds = this.loadedTemplates.map(t => t.templateId?.toString());
        const available = this.availableTemplates.filter(t => !activeIds.includes(t._id?.toString()));
        
        let html = `
            <div class="border-t-4 border-gray-300 pt-8">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <i class="fas fa-store text-blue-600"></i>
                        Available Templates
                        <span class="text-sm font-normal text-gray-500">(${available.length})</span>
                    </h3>
                    <button 
                        onclick="window.aiCoreTemplatesManager.refreshData()" 
                        class="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                        title="Refresh available templates"
                    >
                        <i class="fas fa-sync-alt"></i>
                        Refresh
                    </button>
                </div>
                <p class="text-sm text-gray-600 mb-6">
                    <i class="fas fa-info-circle text-blue-500 mr-1"></i>
                    Select templates to activate industry-specific scenarios. Templates are shared resources and auto-update when improved.
                </p>
        `;
        
        if (available.length === 0) {
            html += `
                <div class="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
                    <i class="fas fa-check-double text-5xl text-gray-400 mb-4"></i>
                    <h4 class="text-lg font-bold text-gray-700 mb-2">All Templates Activated!</h4>
                    <p class="text-gray-600">You're using all available templates. Check back later for new additions.</p>
                </div>
            `;
        } else {
            html += `<div class="space-y-3">`;
            
            available.forEach(template => {
                html += this.renderAvailableTemplateCard(template);
            });
            
            html += '</div>';
        }
        
        html += '</div>'; // Close available section
        
        return html;
    }
    
    /**
     * Render a single available template card (COMPACT BANNER STYLE)
     * @param {Object} template - Available template data from Global AI Brain
     */
    renderAvailableTemplateCard(template) {
        const stats = template.stats || {};
        const categories = stats.totalCategories || stats.categories || 0;
        const scenarios = stats.totalScenarios || stats.scenarios || 0;
        const triggers = stats.totalTriggers || stats.triggers || 0;
        const version = template.version || 'v1.0.0';
        const icon = template.icon || '🔧';
        const industry = template.industryLabel || 'General';
        const isActivating = this.activatingTemplateId === template._id;
        
        return `
            <div class="bg-white border-2 border-gray-200 rounded-lg p-4 hover:border-blue-400 hover:shadow-md transition-all ${isActivating ? 'opacity-50 pointer-events-none' : ''}">
                <div class="flex items-center gap-4">
                    <!-- Icon -->
                    <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-2xl flex-shrink-0 shadow-sm">
                        ${icon}
                    </div>
                    
                    <!-- Template Info -->
                    <div class="flex-1 min-w-0">
                        <h4 class="text-lg font-bold text-gray-900 truncate">${this.escapeHtml(template.name)}</h4>
                        <p class="text-xs text-gray-500 flex items-center gap-2">
                            <span><i class="fas fa-industry"></i> ${this.escapeHtml(industry)}</span>
                            <span>•</span>
                            <span>${version}</span>
                        </p>
                    </div>
                    
                    <!-- Compact Stats -->
                    <div class="flex items-center gap-3 text-sm">
                        <div class="text-center">
                            <div class="font-bold text-blue-600">${categories}</div>
                            <div class="text-xs text-gray-500">Cat</div>
                        </div>
                        <div class="text-center">
                            <div class="font-bold text-green-600">${scenarios}</div>
                            <div class="text-xs text-gray-500">Scen</div>
                        </div>
                        <div class="text-center">
                            <div class="font-bold text-purple-600">${triggers}</div>
                            <div class="text-xs text-gray-500">Trig</div>
                        </div>
                    </div>
                    
                    <!-- Activate Button (Compact) -->
                    <button 
                        onclick="window.aiCoreTemplatesManager.activateTemplate('${template._id}')"
                        class="px-6 py-2 text-white font-semibold rounded-lg transition-all shadow-sm hover:shadow-md flex items-center gap-2 flex-shrink-0 ${isActivating ? 'cursor-not-allowed' : ''}"
                        style="background: linear-gradient(to right, #2563eb, #4f46e5); ${isActivating ? 'opacity: 0.5;' : ''}"
                        ${isActivating ? 'disabled' : ''}
                        title="Activate this template for your company"
                    >
                        ${isActivating ? '<i class="fas fa-spinner fa-spin"></i> Activating...' : '<i class="fas fa-plus-circle"></i> Activate'}
                    </button>
                </div>
            </div>
        `;
    }
    
    /* ═══════════════════════════════════════════════════════════════════════
     * SECTION 3: TEMPLATE ACTIONS
     * Activate (add reference) and Remove (delete reference) operations
     * ⚠️  CRITICAL: These trigger variable auto-scan + cache invalidation
     * ═══════════════════════════════════════════════════════════════════════ */
    
    /**
     * Activate a template for this company
     * @param {String} templateId - Global AI Brain template ID
     */
    async activateTemplate(templateId) {
        console.log(`🧠 [AICORE TEMPLATES] Activating template: ${templateId}`);
        
        // Prevent double-activation
        if (this.activatingTemplateId) {
            console.warn('⚠️ [AICORE TEMPLATES] Activation already in progress');
            return;
        }
        
        this.activatingTemplateId = templateId;
        this.render(); // Show loading state
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/templates`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ templateId })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || error.error || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            console.log('✅ [AICORE TEMPLATES] Template activated successfully:', result);
            
            // Reload data
            await this.load();
            
            // Show success message
            this.showSuccess('Template activated! Variables are being scanned automatically.');
            
            // Notify all relevant tabs to refresh their data
            if (this.parent) {
                // Refresh Variables tab
                if (this.parent.variablesManager && typeof this.parent.variablesManager.load === 'function') {
                    console.log('🔄 [AICORE TEMPLATES] Refreshing Variables tab...');
                    setTimeout(() => this.parent.variablesManager.load(), 1000);
                }
                
                // Refresh Filler Filter tab
                if (this.parent.aiCoreFillerFilterManager && typeof this.parent.aiCoreFillerFilterManager.load === 'function') {
                    console.log('🔄 [AICORE TEMPLATES] Refreshing Filler Filter tab...');
                    setTimeout(() => this.parent.aiCoreFillerFilterManager.load(), 1000);
                }
                
                // Refresh Live Scenarios tab
                if (this.parent.aiCoreLiveScenariosManager && typeof this.parent.aiCoreLiveScenariosManager.load === 'function') {
                    console.log('🔄 [AICORE TEMPLATES] Refreshing Live Scenarios tab...');
                    setTimeout(() => this.parent.aiCoreLiveScenariosManager.load(), 1000);
                }
            }
            
        } catch (error) {
            console.error('❌ [AICORE TEMPLATES] Failed to activate template:', error);
            this.showError(`Failed to activate template: ${error.message}`);
            this.render(); // Remove loading state
        } finally {
            this.activatingTemplateId = null;
        }
    }
    
    /**
     * Remove a template from this company
     * @param {String} templateId - Template reference ID
     */
    async removeTemplate(templateId) {
        console.log(`🧠 [AICORE TEMPLATES] Attempting to remove template: ${templateId}`);
        
        // Find template name for confirmation
        const template = this.loadedTemplates.find(t => t.templateId === templateId);
        const templateName = template ? template.name : 'this template';
        
        // Confirmation dialog
        const confirmed = confirm(
            `⚠️ WARNING: Remove "${templateName}"?\n\n` +
            `This will:\n` +
            `❌ Remove all scenarios from this template\n` +
            `❌ Remove variables only used by this template\n` +
            `❌ Disconnect from this template\n\n` +
            `You can always activate it again later.\n\n` +
            `Continue?`
        );
        
        if (!confirmed) {
            console.log('ℹ️ [AICORE TEMPLATES] Removal cancelled by user');
            return;
        }
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/templates/${templateId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || error.error || `HTTP ${response.status}`);
            }
            
            console.log('✅ [AICORE TEMPLATES] Template removed successfully');
            
            // Reload data
            await this.load();
            
            // Show success message
            this.showSuccess(`"${templateName}" has been removed successfully.`);
            
            // Notify all relevant tabs to refresh their data
            if (this.parent) {
                // Refresh Variables tab
                if (this.parent.variablesManager && typeof this.parent.variablesManager.load === 'function') {
                    console.log('🔄 [AICORE TEMPLATES] Refreshing Variables tab...');
                    setTimeout(() => this.parent.variablesManager.load(), 1000);
                }
                
                // Refresh Filler Filter tab
                if (this.parent.aiCoreFillerFilterManager && typeof this.parent.aiCoreFillerFilterManager.load === 'function') {
                    console.log('🔄 [AICORE TEMPLATES] Refreshing Filler Filter tab...');
                    setTimeout(() => this.parent.aiCoreFillerFilterManager.load(), 1000);
                }
                
                // Refresh Live Scenarios tab
                if (this.parent.aiCoreLiveScenariosManager && typeof this.parent.aiCoreLiveScenariosManager.load === 'function') {
                    console.log('🔄 [AICORE TEMPLATES] Refreshing Live Scenarios tab...');
                    setTimeout(() => this.parent.aiCoreLiveScenariosManager.load(), 1000);
                }
            }
            
        } catch (error) {
            console.error('❌ [AICORE TEMPLATES] Failed to remove template:', error);
            this.showError(`Failed to remove template: ${error.message}`);
        }
    }
    
    /**
     * Refresh all data (active + available templates)
     */
    async refreshData() {
        console.log('🧠 [AICORE TEMPLATES] Refreshing data...');
        await this.load();
    }
    
    /* ============================================================================
       UI HELPER METHODS
       ============================================================================ */
    
    /**
     * Show loading state
     */
    showLoadingState() {
        const container = document.getElementById('aicore-templates-container');
        if (!container) return;
        
        container.innerHTML = `
            <div class="flex items-center justify-center py-20">
                <div class="text-center">
                    <i class="fas fa-spinner fa-spin text-5xl text-blue-600 mb-4"></i>
                    <p class="text-gray-600 font-medium">Loading templates...</p>
                </div>
            </div>
        `;
    }
    
    /**
     * Show success message
     * @param {String} message - Success message
     */
    showSuccess(message) {
        // Use browser alert for now (can be replaced with toast notification)
        alert(`✅ ${message}`);
    }
    
    /**
     * Show error message
     * @param {String} message - Error message
     */
    showError(message) {
        // Use browser alert for now (can be replaced with toast notification)
        alert(`❌ ${message}`);
    }
    
    /**
     * Escape HTML to prevent XSS
     * @param {String} str - String to escape
     * @returns {String} - Escaped string
     */
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

/* ============================================================================
   GLOBAL EXPORT
   ============================================================================ */

// Make it globally accessible
if (typeof window !== 'undefined') {
    window.AiCoreTemplatesManager = AiCoreTemplatesManager;
}
