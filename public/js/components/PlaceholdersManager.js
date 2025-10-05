/**
 * ============================================================================
 * 🎯 PLACEHOLDERS MANAGER - ENTERPRISE FRONTEND COMPONENT
 * ============================================================================
 * 
 * Purpose: Manage dynamic placeholders in AI Agent Logic tab
 * Pattern: Follows InstantResponseCategoriesManager proven pattern
 * Features: Full CRUD, real-time validation, comprehensive checkpoints
 * 
 * Checkpoint Logging:
 *   [PH-UI-XXX] - UI operations and user interactions
 *   [PH-API-XXX] - API calls and responses
 *   [PH-ERROR-XXX] - Error handling and recovery
 * 
 * Created: Fresh implementation - Zero legacy code
 * ============================================================================
 */

class PlaceholdersManager {
    constructor(companyId) {
        console.log('==========================================');
        console.log('[PH-UI-1] 🎯 Initializing PlaceholdersManager');
        console.log('[PH-UI-2] Company ID:', companyId);
        console.log('[PH-UI-3] Timestamp:', new Date().toISOString());
        
        this.companyId = companyId;
        this.placeholders = [];
        this.editingId = null;
        
        console.log('[PH-UI-4] ✅ PlaceholdersManager initialized');
        console.log('==========================================');
    }

    /**
     * Initialize the component - attach listeners and load data
     */
    async init() {
        console.log('[PH-UI-5] 🚀 Starting initialization...');
        
        try {
            this.attachEventListeners();
            await this.loadPlaceholders();
            
            console.log('[PH-UI-6] ✅ Initialization complete');
        } catch (error) {
            console.error('[PH-ERROR-1] ❌ Initialization failed:', error);
            this.showNotification('Failed to initialize placeholders', 'error');
        }
    }

    /**
     * Attach event listeners to UI elements
     */
    attachEventListeners() {
        console.log('[PH-UI-7] 🔗 Attaching event listeners...');
        
        // Add Placeholder button
        const addBtn = document.getElementById('add-placeholder-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                console.log('[PH-UI-8] 📝 Add button clicked');
                this.openModal();
            });
            console.log('[PH-UI-9] ✅ Add button listener attached');
        } else {
            console.warn('[PH-UI-10] ⚠️ Add button not found');
        }
        
        // Save button
        const saveBtn = document.getElementById('save-placeholder-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                console.log('[PH-UI-11] 💾 Save button clicked');
                this.savePlaceholder();
            });
            console.log('[PH-UI-12] ✅ Save button listener attached');
        }
        
        // Cancel button
        const cancelBtn = document.getElementById('cancel-placeholder-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                console.log('[PH-UI-13] ❌ Cancel button clicked');
                this.closeModal();
            });
            console.log('[PH-UI-14] ✅ Cancel button listener attached');
        }
        
        // Close modal X button
        const closeBtn = document.getElementById('close-placeholder-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                console.log('[PH-UI-15] ❌ Close X clicked');
                this.closeModal();
            });
            console.log('[PH-UI-16] ✅ Close button listener attached');
        }
        
        console.log('[PH-UI-17] ✅ All event listeners attached');
    }

    /**
     * ========================================================================
     * API METHODS - CRUD OPERATIONS
     * ========================================================================
     */

    /**
     * Load all placeholders from API
     */
    async loadPlaceholders() {
        console.log('==========================================');
        console.log('[PH-API-1] 📥 Loading placeholders...');
        console.log('[PH-API-2] Company ID:', this.companyId);
        
        try {
            const token = this.getAuthToken();
            console.log('[PH-API-3] Auth token:', token ? 'Present' : 'Missing');
            
            const url = `/api/company/${this.companyId}/placeholders`;
            console.log('[PH-API-4] Fetching from:', url);
            
            const startTime = Date.now();
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const responseTime = Date.now() - startTime;
            console.log('[PH-API-5] Response time:', responseTime, 'ms');
            console.log('[PH-API-6] Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[PH-API-7] ❌ Non-OK response:', errorText.substring(0, 200));
                throw new Error(`HTTP ${response.status}`);
            }
            
            const result = await response.json();
            console.log('[PH-API-8] Response data:', result);
            console.log('[PH-API-9] Placeholders count:', result.data?.length || 0);
            
            if (result.success) {
                this.placeholders = result.data || [];
                console.log('[PH-API-10] ✅ Loaded', this.placeholders.length, 'placeholders');
                this.renderPlaceholders();
            } else {
                throw new Error(result.message || 'Failed to load');
            }
            
            console.log('==========================================');
            
        } catch (error) {
            console.error('[PH-ERROR-2] ❌ Load error:', error);
            console.error('[PH-ERROR-3] ❌ Stack:', error.stack);
            console.log('==========================================');
            this.showNotification('Failed to load placeholders', 'error');
        }
    }

    /**
     * Save placeholder (create or update)
     */
    async savePlaceholder() {
        console.log('==========================================');
        console.log('[PH-API-11] 💾 Saving placeholder...');
        
        try {
            // Get form values
            const nameInput = document.getElementById('placeholder-name');
            const valueInput = document.getElementById('placeholder-value');
            const categoryInput = document.getElementById('placeholder-category');
            
            console.log('[PH-API-12] Reading form values...');
            
            if (!nameInput || !valueInput) {
                console.error('[PH-API-13] ❌ Form inputs not found');
                throw new Error('Form inputs not found');
            }
            
            const name = nameInput.value.trim();
            const value = valueInput.value.trim();
            const category = categoryInput ? categoryInput.value : 'general';
            
            console.log('[PH-API-14] Form data:', { name, value, category });
            
            // Validation
            if (!name || !value) {
                console.error('[PH-API-15] ❌ Validation failed: Empty fields');
                this.showNotification('Name and value are required', 'error');
                return;
            }
            
            console.log('[PH-API-16] ✅ Validation passed');
            
            // Determine if creating or updating
            const isUpdate = this.editingId !== null;
            const method = isUpdate ? 'PUT' : 'POST';
            const url = isUpdate 
                ? `/api/company/${this.companyId}/placeholders/${this.editingId}`
                : `/api/company/${this.companyId}/placeholders`;
            
            console.log('[PH-API-17] Operation:', isUpdate ? 'UPDATE' : 'CREATE');
            console.log('[PH-API-18] URL:', url);
            console.log('[PH-API-19] Method:', method);
            
            const token = this.getAuthToken();
            const startTime = Date.now();
            
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, value, category })
            });
            
            const responseTime = Date.now() - startTime;
            console.log('[PH-API-20] Response time:', responseTime, 'ms');
            console.log('[PH-API-21] Response status:', response.status);
            
            if (!response.ok) {
                const errorData = await response.json();
                console.error('[PH-API-22] ❌ Error response:', errorData);
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            console.log('[PH-API-23] Success response:', result);
            
            if (result.success) {
                console.log('[PH-API-24] ✅ Save successful');
                this.showNotification(
                    isUpdate ? 'Placeholder updated' : 'Placeholder created',
                    'success'
                );
                this.closeModal();
                await this.loadPlaceholders(); // Reload list
            } else {
                throw new Error(result.message || 'Save failed');
            }
            
            console.log('==========================================');
            
        } catch (error) {
            console.error('[PH-ERROR-4] ❌ Save error:', error);
            console.error('[PH-ERROR-5] ❌ Stack:', error.stack);
            console.log('==========================================');
            this.showNotification(error.message || 'Failed to save placeholder', 'error');
        }
    }

    /**
     * Delete placeholder
     */
    async deletePlaceholder(id, name) {
        console.log('==========================================');
        console.log('[PH-API-25] 🗑️ Deleting placeholder...');
        console.log('[PH-API-26] ID:', id);
        console.log('[PH-API-27] Name:', name);
        
        if (!confirm(`Delete placeholder "${name}"?`)) {
            console.log('[PH-API-28] ❌ User cancelled deletion');
            console.log('==========================================');
            return;
        }
        
        console.log('[PH-API-29] ✅ User confirmed deletion');
        
        try {
            const token = this.getAuthToken();
            const url = `/api/company/${this.companyId}/placeholders/${id}`;
            
            console.log('[PH-API-30] DELETE URL:', url);
            
            const startTime = Date.now();
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const responseTime = Date.now() - startTime;
            console.log('[PH-API-31] Response time:', responseTime, 'ms');
            console.log('[PH-API-32] Response status:', response.status);
            
            if (!response.ok) {
                const errorData = await response.json();
                console.error('[PH-API-33] ❌ Error response:', errorData);
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            console.log('[PH-API-34] Success response:', result);
            
            if (result.success) {
                console.log('[PH-API-35] ✅ Delete successful');
                this.showNotification('Placeholder deleted', 'success');
                await this.loadPlaceholders(); // Reload list
            } else {
                throw new Error(result.message || 'Delete failed');
            }
            
            console.log('==========================================');
            
        } catch (error) {
            console.error('[PH-ERROR-6] ❌ Delete error:', error);
            console.error('[PH-ERROR-7] ❌ Stack:', error.stack);
            console.log('==========================================');
            this.showNotification('Failed to delete placeholder', 'error');
        }
    }

    /**
     * ========================================================================
     * UI RENDERING METHODS
     * ========================================================================
     */

    /**
     * Render placeholders list
     */
    renderPlaceholders() {
        console.log('[PH-UI-18] 🎨 Rendering placeholders...');
        console.log('[PH-UI-19] Count:', this.placeholders.length);
        
        const container = document.getElementById('placeholders-list');
        const emptyState = document.getElementById('placeholders-empty');
        
        if (!container) {
            console.error('[PH-UI-20] ❌ Container not found');
            return;
        }
        
        console.log('[PH-UI-21] ✅ Container found');
        
        // Show/hide empty state
        if (this.placeholders.length === 0) {
            console.log('[PH-UI-22] Showing empty state');
            container.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }
        
        if (emptyState) emptyState.classList.add('hidden');
        console.log('[PH-UI-23] Building HTML...');
        
        // Build HTML
        const html = this.placeholders.map((placeholder, index) => {
            console.log(`[PH-UI-24] Rendering placeholder ${index + 1}:`, placeholder.name);
            
            return `
                <div class="bg-white border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors">
                    <div class="flex items-start justify-between mb-3">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-2">
                                <h3 class="text-lg font-semibold text-gray-900">${this.escapeHtml(placeholder.name)}</h3>
                                <span class="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">${this.escapeHtml(placeholder.category)}</span>
                            </div>
                            <p class="text-sm text-gray-600 mb-3">${this.escapeHtml(placeholder.value)}</p>
                            <div class="flex items-center gap-3 flex-wrap">
                                <div class="text-xs text-gray-500">Usage examples:</div>
                                <code class="bg-green-50 text-green-700 px-2 py-1 rounded text-xs font-mono cursor-pointer hover:bg-green-100" 
                                      onclick="navigator.clipboard.writeText('[${placeholder.name}]'); placeholdersManager.showNotification('Copied!', 'success')">
                                    [${this.escapeHtml(placeholder.name)}]
                                </code>
                                <code class="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-mono cursor-pointer hover:bg-blue-100" 
                                      onclick="navigator.clipboard.writeText('{${placeholder.name}}'); placeholdersManager.showNotification('Copied!', 'success')">
                                    {${this.escapeHtml(placeholder.name)}}
                                </code>
                            </div>
                        </div>
                        <div class="flex gap-2 ml-4">
                            <button onclick="placeholdersManager.editPlaceholder('${placeholder.id}')"
                                    class="text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-50 rounded transition-colors"
                                    title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="placeholdersManager.deletePlaceholder('${placeholder.id}', '${this.escapeHtml(placeholder.name)}')"
                                    class="text-red-600 hover:text-red-800 p-2 hover:bg-red-50 rounded transition-colors"
                                    title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = html;
        console.log('[PH-UI-25] ✅ Render complete');
    }

    /**
     * ========================================================================
     * MODAL MANAGEMENT
     * ========================================================================
     */

    /**
     * Open modal for create/edit
     */
    openModal(placeholder = null) {
        console.log('[PH-UI-26] 📝 Opening modal...');
        console.log('[PH-UI-27] Mode:', placeholder ? 'EDIT' : 'CREATE');
        
        const modal = document.getElementById('placeholder-modal');
        const modalTitle = document.getElementById('placeholder-modal-title');
        const nameInput = document.getElementById('placeholder-name');
        const valueInput = document.getElementById('placeholder-value');
        const categoryInput = document.getElementById('placeholder-category');
        
        if (!modal) {
            console.error('[PH-UI-28] ❌ Modal not found');
            return;
        }
        
        console.log('[PH-UI-29] ✅ Modal found');
        
        // Set mode
        this.editingId = placeholder ? placeholder.id : null;
        
        // Set title
        if (modalTitle) {
            modalTitle.textContent = placeholder ? 'Edit Placeholder' : 'Create Placeholder';
        }
        
        // Fill form
        if (nameInput) nameInput.value = placeholder ? placeholder.name : '';
        if (valueInput) valueInput.value = placeholder ? placeholder.value : '';
        if (categoryInput) categoryInput.value = placeholder ? placeholder.category : 'general';
        
        console.log('[PH-UI-30] Form populated');
        
        // Show modal
        modal.classList.remove('hidden');
        console.log('[PH-UI-31] ✅ Modal opened');
        
        // Focus first input
        if (nameInput) {
            setTimeout(() => nameInput.focus(), 100);
        }
    }

    /**
     * Close modal
     */
    closeModal() {
        console.log('[PH-UI-32] 🚪 Closing modal...');
        
        const modal = document.getElementById('placeholder-modal');
        if (modal) {
            modal.classList.add('hidden');
            console.log('[PH-UI-33] ✅ Modal closed');
        }
        
        this.editingId = null;
        
        // Clear form
        const nameInput = document.getElementById('placeholder-name');
        const valueInput = document.getElementById('placeholder-value');
        const categoryInput = document.getElementById('placeholder-category');
        
        if (nameInput) nameInput.value = '';
        if (valueInput) valueInput.value = '';
        if (categoryInput) categoryInput.value = 'general';
        
        console.log('[PH-UI-34] Form cleared');
    }

    /**
     * Open modal with existing placeholder data for editing
     */
    editPlaceholder(id) {
        console.log('[PH-UI-35] ✏️ Edit requested for ID:', id);
        
        const placeholder = this.placeholders.find(p => p.id === id);
        
        if (!placeholder) {
            console.error('[PH-UI-36] ❌ Placeholder not found:', id);
            this.showNotification('Placeholder not found', 'error');
            return;
        }
        
        console.log('[PH-UI-37] ✅ Found placeholder:', placeholder.name);
        this.openModal(placeholder);
    }

    /**
     * ========================================================================
     * UTILITY METHODS
     * ========================================================================
     */

    /**
     * Get auth token
     */
    getAuthToken() {
        // Try multiple sources - adminToken is PRIMARY for this system
        const token = localStorage.getItem('adminToken') ||
                     localStorage.getItem('authToken') || 
                     sessionStorage.getItem('authToken') ||
                     localStorage.getItem('token') ||
                     sessionStorage.getItem('token') || '';
        return token;
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        console.log('[PH-UI-38] 🔔 Notification:', type, '-', message);
        
        // Try to use global notification function if available
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
            return;
        }
        
        // Fallback to alert
        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
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

console.log('[INIT] ✅ PlaceholdersManager class loaded - Ready for initialization');

