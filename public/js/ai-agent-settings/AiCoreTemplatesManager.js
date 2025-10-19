/**
 * ============================================================================
 * AICORE TEMPLATES MANAGER - SIMPLE DROPDOWN APPROACH
 * ============================================================================
 * 
 * PURPOSE: Manage loaded Global AI Brain templates for this company
 * 
 * DESIGN: Simple dropdown select (one at a time)
 * - User selects from dropdown
 * - Template loads immediately
 * - Banner appears below
 * - Repeat to add more templates
 * 
 * ============================================================================
 */

class AiCoreTemplatesManager {
    constructor(parentManager) {
        this.parent = parentManager;
        this.companyId = parentManager.companyId;
        this.loadedTemplates = [];
        this.availableTemplates = [];
        
        console.log('🧠 [AICORE TEMPLATES] Initialized');
    }
    
    // ========== DEBUG UTILITIES (temporary, to isolate narrow layout) ==========
    getElementMetrics(element) {
        if (!element) return 'n/a';
        try {
            const cs = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return {
                width: cs.width,
                maxWidth: cs.maxWidth,
                minWidth: cs.minWidth,
                marginLeft: cs.marginLeft,
                marginRight: cs.marginRight,
                paddingLeft: cs.paddingLeft,
                paddingRight: cs.paddingRight,
                rectWidth: Math.round(rect.width) + 'px',
                offsetWidth: element.offsetWidth + 'px',
                clientWidth: element.clientWidth + 'px',
                scrollWidth: element.scrollWidth + 'px',
                classList: Array.from(element.classList || [])
            };
        } catch (e) {
            return { error: e.message };
        }
    }
    
    logLayoutCheckpoint(label) {
        try {
            const htmlEl = document.documentElement;
            const bodyEl = document.body;
            const rootContainer = document.querySelector('.ai-settings-container');
            const subTab = document.getElementById('ai-settings-aicore-templates-content');
            const container = document.getElementById('aicore-templates-container');
            const nearestTailwindContainer = container ? container.closest('.container') : null;
            console.group(`📐 [AICORE LAYOUT] ${label}`);
            console.log('html      =>', this.getElementMetrics(htmlEl));
            console.log('body      =>', this.getElementMetrics(bodyEl));
            console.log('.ai-settings-container =>', this.getElementMetrics(rootContainer));
            console.log('#ai-settings-aicore-templates-content =>', this.getElementMetrics(subTab));
            console.log('#aicore-templates-container =>', this.getElementMetrics(container));
            console.log('nearest .container =>', this.getElementMetrics(nearestTailwindContainer));
            console.groupEnd();
        } catch (e) {
            console.warn('[AICORE LAYOUT] checkpoint failed:', e);
        }
    }
    
    ensureDebugOverlay() {
        try {
            const existing = document.getElementById('aicore-layout-debug');
            if (existing) return existing;
            const el = document.createElement('div');
            el.id = 'aicore-layout-debug';
            el.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:99999;background:#111827;color:#e5e7eb;border:2px solid #3b82f6;border-radius:8px;padding:10px 12px;font:12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;box-shadow:0 4px 16px rgba(0,0,0,0.25);max-width:50vw;';
            el.innerHTML = '<div style="font-weight:700;margin-bottom:6px">AiCore Layout</div><pre id="aicore-layout-debug-pre" style="margin:0;white-space:pre-wrap"></pre>';
            document.body.appendChild(el);
            return el;
        } catch (e) {
            return null;
        }
    }
    
    updateDebugOverlay() {
        try {
            const el = this.ensureDebugOverlay();
            if (!el) return;
            const pre = el.querySelector('#aicore-layout-debug-pre');
            const rootContainer = document.querySelector('.ai-settings-container');
            const subTab = document.getElementById('ai-settings-aicore-templates-content');
            const container = document.getElementById('aicore-templates-container');
            const data = {
                root: this.getElementMetrics(rootContainer),
                subTab: this.getElementMetrics(subTab),
                container: this.getElementMetrics(container)
            };
            pre.textContent = JSON.stringify(data, null, 2);
        } catch {}
    }
    
    /**
     * Load currently loaded templates for this company
     */
    async load() {
        console.log('🧠 [AICORE TEMPLATES] Loading...');
        this.logLayoutCheckpoint('before-load');
        
        try {
            // Load loaded templates
            const response = await fetch(`/api/company/${this.companyId}/configuration/templates`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            this.loadedTemplates = await response.json();
            
            // Load available templates for dropdown
            await this.loadAvailableTemplates();
            
            console.log('✅ [AICORE TEMPLATES] Loaded:', this.loadedTemplates);
            
            this.render();
            
        } catch (error) {
            console.error('❌ [AICORE TEMPLATES] Failed to load:', error);
            this.loadedTemplates = [];
            this.render();
        }
        this.logLayoutCheckpoint('after-load');
        this.updateDebugOverlay();
    }
    
    /**
     * Load available templates from Global AI Brain
     */
    async loadAvailableTemplates() {
        try {
			const response = await fetch('/api/admin/global-instant-responses/published', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
			const payload = await response.json();
			// Support both array and { success, data } shapes
			this.availableTemplates = Array.isArray(payload) ? payload : (payload && payload.data ? payload.data : []);
			
			console.log('✅ [AICORE TEMPLATES] Available templates loaded:', this.availableTemplates.length);
            
        } catch (error) {
            console.error('❌ [AICORE TEMPLATES] Failed to load available templates:', error);
            this.availableTemplates = [];
        }
    }
    
    /**
     * Render the AiCore Templates tab
     */
    render() {
        const container = document.getElementById('aicore-templates-container');
        if (!container) return;

        try {
            const subTab = document.getElementById('ai-settings-aicore-templates-content');
            const rootContainer = document.querySelector('.ai-settings-container');
            const bodyWidth = document.body ? getComputedStyle(document.body).width : 'n/a';
            const subTabStyles = subTab ? getComputedStyle(subTab) : null;
            const rootStyles = rootContainer ? getComputedStyle(rootContainer) : null;
            const containerStyles = getComputedStyle(container);

            console.log('[AICORE WIDTH DEBUG]', {
                body: { width: bodyWidth },
                root: rootStyles ? { width: rootStyles.width, maxWidth: rootStyles.maxWidth } : 'n/a',
                subTab: subTabStyles ? { width: subTabStyles.width, maxWidth: subTabStyles.maxWidth } : 'n/a',
                container: { width: containerStyles.width, maxWidth: containerStyles.maxWidth },
            });
        } catch (e) {
            console.warn('[AICORE WIDTH DEBUG] Failed to read computed styles', e);
        }
        
        let html = `
            <!-- HEADER: Dropdown Selector -->
            <div class="mb-6">
                <div class="bg-blue-50 border-2 border-blue-300 rounded-xl p-6">
                    <div class="flex items-center gap-4">
                        <div class="flex-shrink-0">
                            <i class="fas fa-cube text-blue-600 text-3xl"></i>
                        </div>
                        <div class="flex-1">
                            <label class="block text-sm font-semibold text-gray-700 mb-2">
                                📦 Currently Editing Template:
                            </label>
                            <select 
                                id="aicore-template-selector" 
                                class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none bg-white text-gray-800 font-medium cursor-pointer"
                                onchange="window.aiCoreTemplatesManager.handleTemplateSelect(this)"
                            >
                                <option value="">🔽 Select Template to Add...</option>
        `;
        
        // Add available templates to dropdown (exclude already loaded ones)
        const loadedIds = this.loadedTemplates.map(t => t.templateId ? t.templateId.toString() : '');
        this.availableTemplates.forEach(template => {
            const isLoaded = loadedIds.includes(template._id ? template._id.toString() : '');
            if (!isLoaded) {
                const stats = template.stats || {};
                const icon = template.icon || '🔧';
                const name = template.name || 'Unnamed Template';
                const scenarios = stats.scenarios || 0;
                const version = template.version || 'v1.0.0';
                html += `<option value="${template._id}">${icon} ${name} - ${scenarios} scenarios (${version})</option>`;
            }
        });
        
        html += `
                            </select>
                        </div>
                        <button 
                            class="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-all"
                            onclick="window.aiCoreTemplatesManager.refreshTemplates()"
                            title="Refresh template list"
                        >
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Render loaded templates as banners
        if (this.loadedTemplates.length === 0) {
            html += `
                <div class="text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                    <i class="fas fa-box-open text-6xl text-gray-300 mb-4"></i>
                    <h3 class="text-xl font-bold text-gray-700 mb-2">No Templates Loaded</h3>
                    <p class="text-gray-500 mb-6">
                        Select a Global AI Brain template from the dropdown above to get started.
                    </p>
                </div>
            `;
        } else {
            html += '<div class="space-y-4">';
            
            this.loadedTemplates.forEach(template => {
                html += this.renderTemplateBanner(template);
            });
            
            html += '</div>';
        }
        
        container.innerHTML = html;
        this.logLayoutCheckpoint('after-render');
        this.updateDebugOverlay();
    }
    
    /**
     * Render a single template banner (matching Global AI Brain design)
     */
    renderTemplateBanner(template) {
        const stats = template.stats || {};
        const categories = stats.categories || 0;
        const scenarios = stats.scenarios || 0;
        const triggers = stats.triggers || 0;
        const version = template.version || 'v1.0.0';
        const lastUpdated = template.lastUpdated ? new Date(template.lastUpdated).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown';
        
        return `
            <div class="relative bg-white border-2 border-blue-200 rounded-xl p-6 shadow-md hover:shadow-lg transition-all">
                <!-- Template Header -->
                <div class="flex items-start gap-4 mb-4">
                    <div class="w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center text-3xl flex-shrink-0">
                        ${template.icon || '🔧'}
                    </div>
                    <div class="flex-1 min-w-0">
                        <h3 class="text-2xl font-bold text-gray-800 mb-1">${template.name}</h3>
                        <p class="text-sm text-gray-600">${template.description || 'No description'}</p>
                    </div>
                </div>
                
                <!-- Stats Grid (like Global AI Brain image) -->
                <div class="grid grid-cols-4 gap-4 mt-4 mb-4">
                    <div class="text-center bg-blue-50 rounded-lg p-3 border border-blue-200">
                        <div class="text-3xl font-bold text-blue-600">${categories}</div>
                        <div class="text-xs text-gray-600 mt-1 flex items-center justify-center gap-1">
                            <i class="fas fa-folder"></i>
                            Categories
                        </div>
                    </div>
                    <div class="text-center bg-green-50 rounded-lg p-3 border border-green-200">
                        <div class="text-3xl font-bold text-green-600">${scenarios}</div>
                        <div class="text-xs text-gray-600 mt-1 flex items-center justify-center gap-1">
                            <i class="fas fa-comments"></i>
                            Scenarios
                        </div>
                    </div>
                    <div class="text-center bg-purple-50 rounded-lg p-3 border border-purple-200">
                        <div class="text-3xl font-bold text-purple-600">${triggers}</div>
                        <div class="text-xs text-gray-600 mt-1 flex items-center justify-center gap-1">
                            <i class="fas fa-bolt"></i>
                            Triggers
                        </div>
                    </div>
                    <div class="text-center bg-indigo-50 rounded-lg p-3 border border-indigo-200">
                        <div class="text-3xl font-bold text-indigo-600">${version}</div>
                        <div class="text-xs text-gray-600 mt-1 flex items-center justify-center gap-1">
                            <i class="fas fa-code-branch"></i>
                            Version
                        </div>
                    </div>
                </div>
                
                <!-- Last Updated -->
                <div class="text-center text-xs text-gray-500 mt-2">
                    <i class="far fa-clock"></i>
                    Last updated: ${lastUpdated}
                </div>
                
                <!-- Small Delete Button (Bottom Right) -->
                <button 
                    class="absolute bottom-3 right-3 text-gray-400 hover:text-red-600 transition-colors p-2"
                    onclick="window.aiCoreTemplatesManager.deleteTemplate('${template.templateId}')"
                    title="Remove template"
                >
                    <i class="fas fa-trash-alt text-sm"></i>
                </button>
            </div>
        `;
    }
    
    /**
     * Handle template selection from dropdown
     */
    async handleTemplateSelect(selectElement) {
        const templateId = selectElement.value;
        
        if (!templateId) {
            return; // User selected "Select Template to Add..."
        }
        
        console.log('🧠 [AICORE TEMPLATES] Template selected:', templateId);
        
        // Add the template
        await this.addTemplate(templateId);
        
        // Reset dropdown
        selectElement.value = '';
    }
    
    /**
     * Refresh templates (reload available list)
     */
    async refreshTemplates() {
        console.log('🧠 [AICORE TEMPLATES] Refreshing templates...');
        await this.loadAvailableTemplates();
        this.render();
    }
    
    /**
     * Add a template to this company
     */
    async addTemplate(templateId) {
        console.log('🧠 [AICORE TEMPLATES] Adding template:', templateId);
        
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
            
            console.log('✅ [AICORE TEMPLATES] Template added:', result);
            
            // Reload templates
            await this.load();
            
            // Show success notification
            alert('✅ Template added successfully! Variables will be scanned automatically.');
            
        } catch (error) {
            console.error('❌ [AICORE TEMPLATES] Failed to add template:', error);
            alert(`❌ Failed to add template: ${error.message}`);
        }
    }
    
    /**
     * Delete a template from this company (with 2-step safe delete)
     */
    async deleteTemplate(templateId) {
        console.log('🧠 [AICORE TEMPLATES] Attempting to delete template:', templateId);
        
        // Find template name for confirmation
        const template = this.loadedTemplates.find(t => t.templateId === templateId);
        const templateName = template ? template.name : 'this template';
        
        // Step 1: Warning dialog
        const confirmed = confirm(`⚠️ WARNING: Remove "${templateName}"?\n\nThis will permanently remove:\n❌ All scenarios from this template\n❌ All associated variables\n❌ Connection to this template\n\nYou can always load it again later.\n\nContinue?`);
        
        if (!confirmed) {
            console.log('ℹ️ [AICORE TEMPLATES] Deletion cancelled by user');
            return;
        }
        
        // Step 2: Type DELETE to confirm
        const verification = prompt(`🔒 SAFETY CHECK\n\nTo confirm removal of "${templateName}", please type:\n\nDELETE\n\n(Type exactly as shown, in CAPITAL LETTERS)`);
        
        if (verification !== 'DELETE') {
            alert('❌ Deletion cancelled. Text did not match.');
            console.log('ℹ️ [AICORE TEMPLATES] Deletion cancelled - verification failed');
            return;
        }
        
        // Proceed with deletion
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
            
            console.log('✅ [AICORE TEMPLATES] Template deleted:', templateId);
            
            // Reload templates
            await this.load();
            
            // Show success notification
            alert(`✅ "${templateName}" has been removed successfully.`);
            
        } catch (error) {
            console.error('❌ [AICORE TEMPLATES] Failed to delete template:', error);
            alert(`❌ Failed to remove template: ${error.message}`);
        }
    }
}

// Make it globally accessible
if (typeof window !== 'undefined') {
    window.AiCoreTemplatesManager = AiCoreTemplatesManager;
}
