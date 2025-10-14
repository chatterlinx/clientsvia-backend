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
            <!-- Template Name & Description -->
            <div class="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg p-6">
                <div class="flex items-start gap-4">
                    <div class="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center text-white text-3xl">
                        📦
                    </div>
                    <div class="flex-1">
                        <h3 class="text-2xl font-bold text-blue-900 mb-2">${this.escapeHtml(info.templateName)}</h3>
                        <p class="text-blue-800">${this.escapeHtml(info.templateDescription || 'No description available')}</p>
                    </div>
                </div>
            </div>
            
            <!-- Version Info -->
            <div class="grid grid-cols-2 gap-6 mb-6">
                <div class="bg-white border-2 border-gray-200 rounded-lg p-6">
                    <div class="text-sm text-gray-500 mb-1">Your Version</div>
                    <div class="text-3xl font-bold text-gray-900">v${info.clonedVersion || '1.0.0'}</div>
                    <div class="text-xs text-gray-500 mt-2">Cloned ${this.formatDate(info.clonedAt)}</div>
                </div>
                <div class="bg-white border-2 border-gray-200 rounded-lg p-6">
                    <div class="text-sm text-gray-500 mb-1">Latest Version</div>
                    <div class="text-3xl font-bold ${hasUpdates ? 'text-orange-600' : 'text-green-600'}">
                        v${info.currentVersion || '1.0.0'}
                    </div>
                    <div class="text-xs ${hasUpdates ? 'text-orange-600 font-semibold' : 'text-green-600'} mt-2">
                        ${hasUpdates ? '🔔 Updates Available!' : '✅ Up to Date'}
                    </div>
                </div>
            </div>
            
            <!-- Sync Status -->
            <div class="mb-6 ${isUpToDate ? 'bg-green-50 border-green-200' : hasUpdates ? 'bg-orange-50 border-orange-200' : 'bg-yellow-50 border-yellow-200'} border-2 rounded-lg p-6">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        ${isUpToDate ? '<i class="fas fa-check-circle text-3xl text-green-600"></i>' : 
                          hasUpdates ? '<i class="fas fa-sync text-3xl text-orange-600"></i>' : 
                          '<i class="fas fa-exclamation-triangle text-3xl text-yellow-600"></i>'}
                        <div>
                            <div class="font-bold text-lg ${isUpToDate ? 'text-green-900' : hasUpdates ? 'text-orange-900' : 'text-yellow-900'}">
                                ${this.getSyncStatusTitle(info.syncStatus)}
                            </div>
                            <div class="text-sm ${isUpToDate ? 'text-green-800' : hasUpdates ? 'text-orange-800' : 'text-yellow-800'}">
                                ${this.getSyncStatusDescription(info.syncStatus)}
                            </div>
                        </div>
                    </div>
                    ${hasUpdates ? `
                        <button class="ai-settings-btn ai-settings-btn-primary" onclick="templateInfoManager.syncUpdates()">
                            <i class="fas fa-download"></i>
                            Sync Updates
                        </button>
                    ` : ''}
                </div>
            </div>
            
            <!-- Stats -->
            <div class="grid grid-cols-4 gap-4 mb-6">
                <div class="bg-white border-2 border-gray-200 rounded-lg p-4 text-center">
                    <div class="text-2xl font-bold text-blue-600">${info.stats?.scenarios || 0}</div>
                    <div class="text-xs text-gray-600 mt-1">Scenarios</div>
                </div>
                <div class="bg-white border-2 border-gray-200 rounded-lg p-4 text-center">
                    <div class="text-2xl font-bold text-green-600">${info.stats?.categories || 0}</div>
                    <div class="text-xs text-gray-600 mt-1">Categories</div>
                </div>
                <div class="bg-white border-2 border-gray-200 rounded-lg p-4 text-center">
                    <div class="text-2xl font-bold text-purple-600">${info.stats?.variables || 0}</div>
                    <div class="text-xs text-gray-600 mt-1">Variables</div>
                </div>
                <div class="bg-white border-2 border-gray-200 rounded-lg p-4 text-center">
                    <div class="text-2xl font-bold text-orange-600">${info.stats?.fillerWords || 0}</div>
                    <div class="text-xs text-gray-600 mt-1">Filler Words</div>
                </div>
            </div>
            
            <!-- Last Sync -->
            <div class="text-sm text-gray-500 text-center">
                Last synced: ${this.formatDate(info.lastSyncedAt)}
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
            <div class="text-center py-16">
                <i class="fas fa-box-open text-6xl text-gray-300 mb-4"></i>
                <h3 class="text-xl font-bold text-gray-700 mb-2">No Template Cloned</h3>
                <p class="text-gray-500 mb-6">
                    Clone a Global AI Brain template to get started.
                </p>
                <button class="ai-settings-btn ai-settings-btn-primary" onclick="alert('Navigate to Global AI Brain to clone a template')">
                    <i class="fas fa-copy"></i>
                    Clone Template
                </button>
            </div>
        `;
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

