/**
 * ============================================================================
 * TEMPLATE INFO MANAGER - VERSION & SYNC STATUS
 * ============================================================================
 * 
 * PURPOSE: Show information about the cloned Global AI Brain template
 * 
 * DISPLAYS:
 * - Template name and description
 * - Version cloned vs. current version
 * - Last sync date
 * - Sync status (up-to-date, updates available, diverged)
 * - Button to sync updates from Global AI Brain
 * 
 * ============================================================================
 */

class TemplateInfoManager {
    constructor(parentManager) {
        this.parent = parentManager;
        this.companyId = parentManager.companyId;
        this.templateInfo = null;
        
        console.log('📦 [TEMPLATE INFO] Initialized');
    }
    
    /**
     * Load template info from API
     */
    async load() {
        console.log('📦 [TEMPLATE INFO] Loading...');
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/template-info`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            this.templateInfo = await response.json();
            
            console.log('✅ [TEMPLATE INFO] Loaded:', this.templateInfo);
            
            this.render();
            
        } catch (error) {
            console.error('❌ [TEMPLATE INFO] Failed to load:', error);
            this.renderEmpty();
        }
    }
    
    /**
     * Render template info
     */
    render() {
        const container = document.getElementById('template-info-container');
        if (!container) return;
        
        if (!this.templateInfo) {
            this.renderEmpty();
            return;
        }
        
        const info = this.templateInfo;
        const hasUpdates = info.syncStatus === 'updates_available';
        const isUpToDate = info.syncStatus === 'up_to_date';
        const isDiverged = info.syncStatus === 'diverged';
        
        let html = `
            <!-- 🎨 TEMPLATE BANNER - Bold & Visual -->
            <div class="bg-blue-600 rounded-xl p-8 mb-6 text-white shadow-xl">
                <div class="flex items-center justify-between mb-6">
                    <div class="flex items-center gap-6">
                        <div class="w-20 h-20 bg-white bg-opacity-20 rounded-xl flex items-center justify-center text-5xl">
                            🔧
                        </div>
                        <div>
                            <h2 class="text-4xl font-bold mb-2">${this.escapeHtml(info.templateName)}</h2>
                            <p class="text-lg text-white text-opacity-90">${this.escapeHtml(info.templateDescription || 'Industry Template')}</p>
                        </div>
                    </div>
                    <div class="flex gap-3">
                        ${hasUpdates ? `
                            <button class="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-lg font-semibold transition-all" onclick="templateInfoManager.syncUpdates()">
                                <i class="fas fa-sync-alt mr-2"></i>
                                Sync Updates
                            </button>
                        ` : `
                            <div class="bg-green-500 px-6 py-3 rounded-lg font-semibold flex items-center gap-2">
                                <i class="fas fa-check-circle"></i>
                                Up to Date
                            </div>
                        `}
                        <button class="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-semibold transition-all" onclick="templateInfoManager.removeTemplate()">
                            <i class="fas fa-trash mr-2"></i>
                            Remove
                        </button>
                    </div>
                </div>
                
                <!-- 📊 STATISTICS GRID -->
                <div class="grid grid-cols-4 gap-4">
                    <div class="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 text-center">
                        <div class="text-3xl font-bold mb-1">${info.stats?.scenarios || 0}</div>
                        <div class="text-sm text-white text-opacity-80">Scenarios</div>
                    </div>
                    <div class="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 text-center">
                        <div class="text-3xl font-bold mb-1">${info.stats?.categories || 0}</div>
                        <div class="text-sm text-white text-opacity-80">Categories</div>
                    </div>
                    <div class="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 text-center">
                        <div class="text-3xl font-bold mb-1">${info.stats?.variables || 0}</div>
                        <div class="text-sm text-white text-opacity-80">Variables</div>
                    </div>
                    <div class="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 text-center">
                        <div class="text-3xl font-bold mb-1">${info.stats?.fillerWords || 0}</div>
                        <div class="text-sm text-white text-opacity-80">Filler Words</div>
                    </div>
                </div>
                
                <div class="mt-4 text-sm text-white text-opacity-70 text-center">
                    Loaded ${this.formatDate(info.clonedAt)} • v${info.clonedVersion || '1.0.0'}
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }
    
    /**
     * Render empty state
     */
    renderEmpty() {
        const container = document.getElementById('template-info-container');
        if (!container) return;
        
        container.innerHTML = `
            <div class="text-center py-16 w-full">
                <i class="fas fa-box-open text-6xl text-gray-300 mb-4"></i>
                <h3 class="text-xl font-bold text-gray-700 mb-2">No Template Loaded</h3>
                <p class="text-gray-500 mb-6 max-w-2xl mx-auto">
                    Load a Global AI Brain template to get started. Your company will reference the template and receive automatic updates.
                </p>
                <button class="ai-settings-btn ai-settings-btn-primary" onclick="templateInfoManager.cloneTemplate()">
                    <i class="fas fa-download"></i>
                    Load Template
                </button>
            </div>
        `;
    }
    
    /**
     * Load a template from Global AI Brain
     */
    async cloneTemplate() {
        console.log('📦 [TEMPLATE INFO] Opening load template modal...');
        
        try {
            // Fetch available templates
            const response = await fetch('/api/admin/global-ai-brain/templates', {
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
            
            // Show modal with template selection
            this.showCloneModal(templates);
            
        } catch (error) {
            console.error('❌ [TEMPLATE INFO] Failed to load templates:', error);
            alert('❌ Failed to load available templates. Please try again.');
        }
    }
    
    /**
     * Show clone template modal
     */
    showCloneModal(templates) {
        // Create modal HTML
        const modalHtml = `
            <div id="clone-template-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                <div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                    <!-- Header -->
                    <div class="sticky top-0 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-8 py-6 rounded-t-2xl">
                        <h2 class="text-2xl font-bold">📦 Load Global AI Brain Template</h2>
                        <p class="text-blue-100 mt-2">Select a template to load for your company</p>
                    </div>
                    
                    <!-- Body -->
                    <div class="p-8">
                        ${templates.map(template => `
                            <div class="mb-4 border-2 border-gray-200 rounded-xl p-6 hover:border-blue-500 transition-all cursor-pointer" 
                                 onclick="templateInfoManager.confirmClone('${template._id}', '${this.escapeHtml(template.name)}')">
                                <div class="flex items-start gap-4">
                                    <div class="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center text-white text-2xl flex-shrink-0">
                                        📦
                                    </div>
                                    <div class="flex-1">
                                        <h3 class="text-xl font-bold text-gray-900 mb-2">${this.escapeHtml(template.name)}</h3>
                                        <p class="text-gray-600 mb-3">${this.escapeHtml(template.description || 'No description')}</p>
                                        <div class="flex items-center gap-4 text-sm text-gray-500">
                                            <span><i class="fas fa-layer-group mr-1"></i> ${template.categories?.length || 0} Categories</span>
                                            <span><i class="fas fa-comments mr-1"></i> ${this.countScenarios(template)} Scenarios</span>
                                            <span><i class="fas fa-code-branch mr-1"></i> v${template.version || '1.0.0'}</span>
                                        </div>
                                    </div>
                                    <button class="ai-settings-btn ai-settings-btn-primary">
                                        <i class="fas fa-clone"></i>
                                        Clone
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    
                    <!-- Footer -->
                    <div class="border-t border-gray-200 px-8 py-4 bg-gray-50 rounded-b-2xl">
                        <button onclick="templateInfoManager.closeCloneModal()" 
                                class="ai-settings-btn ai-settings-btn-secondary">
                            <i class="fas fa-times"></i>
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Inject modal into page
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    
    /**
     * Count total scenarios in a template
     */
    countScenarios(template) {
        if (!template.categories) return 0;
        return template.categories.reduce((sum, cat) => sum + (cat.scenarios?.length || 0), 0);
    }
    
    /**
     * Remove template - SAFE DELETE with confirmation
     */
    async removeTemplate() {
        const templateName = this.templateInfo?.templateName || 'this template';
        const scenarioCount = this.templateInfo?.stats?.scenarios || 0;
        
        // STEP 1: Show warning
        if (!confirm(`⚠️ WARNING: Remove "${templateName}"?\n\n` +
                     `This will permanently remove:\n` +
                     `❌ ${scenarioCount} scenarios\n` +
                     `❌ All associated variables\n` +
                     `❌ Connection to this template\n\n` +
                     `You can always load it again later.\n\n` +
                     `Continue to confirmation step?`)) {
            return;
        }
        
        // STEP 2: Type to confirm (SAFE DELETE)
        const confirmation = prompt(
            `🔒 SAFETY CHECK\n\n` +
            `To confirm removal of "${templateName}", please type:\n\n` +
            `DELETE\n\n` +
            `(Type exactly as shown, in CAPITAL LETTERS)`
        );
        
        if (confirmation !== 'DELETE') {
            if (confirmation !== null) {
                alert('❌ Deletion cancelled. Text did not match.');
            }
            return;
        }
        
        console.log('🗑️ [TEMPLATE INFO] Removing template...');
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/remove-template`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP ${response.status}`);
            }
            
            console.log('✅ [TEMPLATE INFO] Template removed successfully');
            
            this.parent.showSuccess(`Template "${templateName}" removed successfully! 🗑️`);
            
            // Reload everything
            await this.parent.refresh();
            
        } catch (error) {
            console.error('❌ [TEMPLATE INFO] Failed to remove template:', error);
            alert(`Failed to remove template: ${error.message}`);
        }
    }
    
    /**
     * Confirm and execute clone
     */
    async confirmClone(templateId, templateName) {
        if (!confirm(`🚀 Load "${templateName}"?\n\nThis will:\n✅ Load all scenarios\n✅ Load all filler words\n✅ Set up variables for you to fill\n\nContinue?`)) {
            return;
        }
        
        console.log(`📦 [TEMPLATE INFO] Loading template ${templateId}...`);
        
        this.closeCloneModal();
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/clone-template`, {
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
            
            console.log('✅ [TEMPLATE INFO] Template loaded successfully:', result);
            
            this.parent.showSuccess(`Template "${result.template.name}" loaded successfully! 🎉`);
            
            // Reload everything
            await this.parent.refresh();
            
        } catch (error) {
            console.error('❌ [TEMPLATE INFO] Failed to clone template:', error);
            alert(`❌ Failed to clone template:\n${error.message}`);
        }
    }
    
    /**
     * Close clone modal
     */
    closeCloneModal() {
        const modal = document.getElementById('clone-template-modal');
        if (modal) {
            modal.remove();
        }
    }
    
    /**
     * Get sync status title
     */
    getSyncStatusTitle(status) {
        const titles = {
            'up_to_date': 'Up to Date',
            'updates_available': 'Updates Available',
            'diverged': 'Customizations Detected',
            'never_synced': 'Never Synced'
        };
        return titles[status] || 'Unknown Status';
    }
    
    /**
     * Get sync status description
     */
    getSyncStatusDescription(status) {
        const descriptions = {
            'up_to_date': 'Your AI is using the latest Global AI Brain template.',
            'updates_available': 'New improvements are available. Click "Sync Updates" to get the latest scenarios, filler words, and variables.',
            'diverged': 'You have custom modifications. Syncing may overwrite your changes.',
            'never_synced': 'This template has never been synced with the Global AI Brain.'
        };
        return descriptions[status] || 'Unable to determine sync status.';
    }
    
    /**
     * Sync updates from Global AI Brain
     */
    async syncUpdates() {
        if (!confirm('🔄 This will sync updates from the Global AI Brain. Continue?')) {
            return;
        }
        
        console.log('📦 [TEMPLATE INFO] Syncing updates...');
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/sync`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            console.log('✅ [TEMPLATE INFO] Synced successfully:', result);
            
            this.parent.showSuccess('Synced successfully! Refreshing...');
            
            // Reload everything
            await this.parent.refresh();
            
        } catch (error) {
            console.error('❌ [TEMPLATE INFO] Failed to sync:', error);
            this.parent.showError('Failed to sync updates');
        }
    }
    
    /**
     * Format date
     */
    formatDate(dateString) {
        if (!dateString) return 'Never';
        
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        
        return date.toLocaleDateString();
    }
    
    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use in AIAgentSettingsManager
if (typeof window !== 'undefined') {
    window.TemplateInfoManager = TemplateInfoManager;
}

