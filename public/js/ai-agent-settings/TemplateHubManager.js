/**
 * ============================================================================
 * TEMPLATE HUB MANAGER - KNOWLEDGE SOURCE MANAGEMENT
 * ============================================================================
 * 
 * PURPOSE: Manage loaded Global AI Brain templates for this company
 * 
 * FEATURES:
 * - Dropdown search to add templates (like Global AI Brain)
 * - Template banners with stats (Categories, Scenarios, Triggers, Version)
 * - Safe delete with confirmation
 * - Reference-based architecture (no data duplication)
 * 
 * ============================================================================
 */

class TemplateHubManager {
    constructor(parentManager) {
        this.parent = parentManager;
        this.companyId = parentManager.companyId;
        this.loadedTemplates = [];
        
        console.log('🏢 [TEMPLATE HUB] Initialized');
    }
    
    /**
     * Load currently loaded templates for this company
     */
    async load() {
        console.log('🏢 [TEMPLATE HUB] Loading...');
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/templates`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            this.loadedTemplates = await response.json();
            
            console.log('✅ [TEMPLATE HUB] Loaded:', this.loadedTemplates);
            
            this.render();
            
        } catch (error) {
            console.error('❌ [TEMPLATE HUB] Failed to load:', error);
            this.loadedTemplates = [];
            this.render();
        }
    }
    
    /**
     * Render the template hub
     */
    render() {
        const container = document.getElementById('template-hub-container');
        if (!container) return;
        
        let html = `
            <!-- HEADER: Add Template Dropdown -->
            <div class="mb-6 flex items-center justify-between">
                <div>
                    <h3 class="text-xl font-bold text-gray-800">📦 Knowledge Templates</h3>
                    <p class="text-sm text-gray-600 mt-1">Loaded templates provide scenarios, variables, and AI knowledge</p>
                </div>
                <div class="relative">
                    <button 
                        id="add-template-btn" 
                        class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold shadow-lg transition-all flex items-center gap-2"
                        onclick="window.templateHubManager.showTemplateSelector()"
                    >
                        <i class="fas fa-plus"></i>
                        Add Template
                    </button>
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
                        Add a Global AI Brain template to provide your AI agent with scenarios and knowledge.
                    </p>
                    <button 
                        class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold inline-flex items-center gap-2"
                        onclick="window.templateHubManager.showTemplateSelector()"
                    >
                        <i class="fas fa-plus"></i>
                        Add Your First Template
                    </button>
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
    }
    
    /**
     * Render a single template banner
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
                
                <!-- Stats Grid -->
                <div class="grid grid-cols-4 gap-4 mt-4 mb-4">
                    <div class="text-center bg-blue-50 rounded-lg p-3">
                        <div class="text-3xl font-bold text-blue-600">${categories}</div>
                        <div class="text-xs text-gray-600 mt-1 flex items-center justify-center gap-1">
                            <i class="fas fa-folder"></i>
                            Categories
                        </div>
                    </div>
                    <div class="text-center bg-green-50 rounded-lg p-3">
                        <div class="text-3xl font-bold text-green-600">${scenarios}</div>
                        <div class="text-xs text-gray-600 mt-1 flex items-center justify-center gap-1">
                            <i class="fas fa-comments"></i>
                            Scenarios
                        </div>
                    </div>
                    <div class="text-center bg-purple-50 rounded-lg p-3">
                        <div class="text-3xl font-bold text-purple-600">${triggers}</div>
                        <div class="text-xs text-gray-600 mt-1 flex items-center justify-center gap-1">
                            <i class="fas fa-bolt"></i>
                            Triggers
                        </div>
                    </div>
                    <div class="text-center bg-indigo-50 rounded-lg p-3">
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
                
                <!-- Delete Button (Bottom Right) -->
                <button 
                    class="absolute bottom-3 right-3 text-gray-400 hover:text-red-600 transition-colors"
                    onclick="window.templateHubManager.deleteTemplate('${template.templateId}')"
                    title="Remove template"
                >
                    <i class="fas fa-trash text-sm"></i>
                </button>
            </div>
        `;
    }
    
    /**
     * Show template selector dropdown modal
     */
    async showTemplateSelector() {
        console.log('🏢 [TEMPLATE HUB] Opening template selector...');
        
        try {
            // Fetch available templates from Global AI Brain
            const response = await fetch('/api/admin/global-instant-responses/published', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const templates = await response.json();
            
            if (!templates || templates.length === 0) {
                alert('⚠️ No templates available. Please create a template in the Global AI Brain first.');
                return;
            }
            
            // Build modal HTML
            let modalHTML = `
                <div id="template-selector-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
                        <!-- Header -->
                        <div class="bg-blue-600 text-white p-6">
                            <h2 class="text-2xl font-bold flex items-center gap-3">
                                <i class="fas fa-plus-circle"></i>
                                Add Knowledge Template
                            </h2>
                            <p class="text-sm text-blue-100 mt-2">Select a Global AI Brain template to load</p>
                        </div>
                        
                        <!-- Search Bar -->
                        <div class="p-6 border-b">
                            <input 
                                type="text" 
                                id="template-search" 
                                class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                                placeholder="🔍 Search templates..."
                                oninput="window.templateHubManager.filterTemplates()"
                            />
                        </div>
                        
                        <!-- Template List -->
                        <div id="template-list" class="overflow-y-auto max-h-96 p-6 space-y-3">
            `;
            
            templates.forEach(template => {
                const stats = template.stats || {};
                modalHTML += `
                    <div class="template-option border-2 border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:bg-blue-50 cursor-pointer transition-all" 
                         data-name="${(template.name || '').toLowerCase()}"
                         onclick="window.templateHubManager.addTemplate('${template._id}')">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center text-2xl flex-shrink-0">
                                ${template.icon || '🔧'}
                            </div>
                            <div class="flex-1 min-w-0">
                                <h3 class="font-bold text-gray-800">${template.name}</h3>
                                <p class="text-xs text-gray-600 mt-1">${template.description || 'No description'}</p>
                                <div class="flex gap-4 mt-2 text-xs text-gray-500">
                                    <span><i class="fas fa-folder"></i> ${stats.categories || 0} Categories</span>
                                    <span><i class="fas fa-comments"></i> ${stats.scenarios || 0} Scenarios</span>
                                    <span><i class="fas fa-code-branch"></i> ${template.version || 'v1.0.0'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            modalHTML += `
                        </div>
                        
                        <!-- Footer -->
                        <div class="p-6 border-t bg-gray-50 flex justify-end">
                            <button 
                                class="px-6 py-2 bg-gray-300 hover:bg-gray-400 rounded-lg font-semibold"
                                onclick="window.templateHubManager.closeTemplateSelector()"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            // Inject modal into page
            const modalContainer = document.createElement('div');
            modalContainer.innerHTML = modalHTML;
            document.body.appendChild(modalContainer);
            
        } catch (error) {
            console.error('❌ [TEMPLATE HUB] Failed to load templates:', error);
            alert('❌ Failed to load templates. Please try again.');
        }
    }
    
    /**
     * Filter templates in the selector modal
     */
    filterTemplates() {
        const searchInput = document.getElementById('template-search');
        const filter = searchInput.value.toLowerCase();
        const options = document.querySelectorAll('.template-option');
        
        options.forEach(option => {
            const name = option.dataset.name;
            if (name.includes(filter)) {
                option.style.display = '';
            } else {
                option.style.display = 'none';
            }
        });
    }
    
    /**
     * Close template selector modal
     */
    closeTemplateSelector() {
        const modal = document.getElementById('template-selector-modal');
        if (modal && modal.parentElement) {
            modal.parentElement.remove();
        }
    }
    
    /**
     * Add a template to this company
     */
    async addTemplate(templateId) {
        console.log('🏢 [TEMPLATE HUB] Adding template:', templateId);
        
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
                throw new Error(error.message || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            console.log('✅ [TEMPLATE HUB] Template added:', result);
            
            // Close modal
            this.closeTemplateSelector();
            
            // Reload templates
            await this.load();
            
            // Show success notification
            alert('✅ Template added successfully! Variables will be scanned automatically.');
            
        } catch (error) {
            console.error('❌ [TEMPLATE HUB] Failed to add template:', error);
            alert(`❌ Failed to add template: ${error.message}`);
        }
    }
    
    /**
     * Delete a template from this company (with confirmation)
     */
    async deleteTemplate(templateId) {
        console.log('🏢 [TEMPLATE HUB] Attempting to delete template:', templateId);
        
        // Find template name for confirmation
        const template = this.loadedTemplates.find(t => t.templateId === templateId);
        const templateName = template ? template.name : 'this template';
        
        // Step 1: Warning dialog
        const confirmed = confirm(`⚠️ WARNING: Remove "${templateName}"?\n\nThis will permanently remove:\n❌ All scenarios from this template\n❌ All associated variables\n❌ Connection to this template\n\nYou can always load it again later.\n\nContinue?`);
        
        if (!confirmed) {
            console.log('ℹ️ [TEMPLATE HUB] Deletion cancelled by user');
            return;
        }
        
        // Step 2: Type DELETE to confirm
        const verification = prompt(`🔒 SAFETY CHECK\n\nTo confirm removal of "${templateName}", please type:\n\nDELETE\n\n(Type exactly as shown, in CAPITAL LETTERS)`);
        
        if (verification !== 'DELETE') {
            alert('❌ Deletion cancelled. Text did not match.');
            console.log('ℹ️ [TEMPLATE HUB] Deletion cancelled - verification failed');
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
                throw new Error(error.message || `HTTP ${response.status}`);
            }
            
            console.log('✅ [TEMPLATE HUB] Template deleted:', templateId);
            
            // Reload templates
            await this.load();
            
            // Show success notification
            alert(`✅ "${templateName}" has been removed successfully.`);
            
        } catch (error) {
            console.error('❌ [TEMPLATE HUB] Failed to delete template:', error);
            alert(`❌ Failed to remove template: ${error.message}`);
        }
    }
}

// Make it globally accessible
if (typeof window !== 'undefined') {
    window.TemplateHubManager = TemplateHubManager;
}

