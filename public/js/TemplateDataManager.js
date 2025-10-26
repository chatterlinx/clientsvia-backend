/**
 * ============================================================================
 * TEMPLATE DATA MANAGER - World-Class State Management (Salesforce Standard)
 * ============================================================================
 * 
 * Responsibilities:
 * - Manage template settings (fillers, synonyms)
 * - Manage category settings table
 * - Auto-refresh on template change
 * - Optimistic UI updates with rollback
 * - Caching for performance
 * - Toast notifications
 * 
 * @author Chief Engineer
 * @version 1.0.0
 * @since 2025-10-26
 */

class TemplateDataManager {
    constructor() {
        console.log('🏗️ [TEMPLATE DATA MANAGER] Initializing world-class state manager...');
        
        // Current state
        this.currentTemplateId = null;
        this.currentTemplate = null;
        this.activeTab = 'settings';
        
        // Cache
        this.cache = {
            templates: new Map(),
            lastFetch: null,
            ttl: 300000 // 5 minutes
        };
        
        // Optimistic update tracking
        this.pendingUpdates = new Map();
        
        // Toast manager (reuse existing)
        this.toast = window.toastManager || this.initFallbackToast();
        
        // API base URL
        this.apiBase = '/api/admin/global-instant-responses';
        this.token = localStorage.getItem('adminToken');
        
        console.log('✅ [TEMPLATE DATA MANAGER] Initialized successfully');
    }
    
    /**
     * ========================================================================
     * TAB SWITCHING
     * ========================================================================
     */
    
    switchTab(tabName) {
        console.log(`🔄 [TAB SWITCH] Switching to: ${tabName}`);
        
        // Update active tab
        this.activeTab = tabName;
        
        // Update tab buttons
        const tabs = ['settings', 'categories'];
        tabs.forEach(tab => {
            const btn = document.getElementById(`template-data-tab-${tab}`);
            const panel = document.getElementById(`template-data-panel-${tab}`);
            
            if (tab === tabName) {
                btn?.classList.add('active');
                btn?.setAttribute('aria-selected', 'true');
                panel?.classList.add('active');
            } else {
                btn?.classList.remove('active');
                btn?.setAttribute('aria-selected', 'false');
                panel?.classList.remove('active');
            }
        });
        
        // Load data for active tab (if not already loaded)
        if (tabName === 'settings' && this.currentTemplateId) {
            this.loadTemplateSettings(this.currentTemplateId);
        } else if (tabName === 'categories' && this.currentTemplateId) {
            this.loadCategorySettings(this.currentTemplateId);
        }
        
        console.log(`✅ [TAB SWITCH] Switched to: ${tabName}`);
    }
    
    /**
     * ========================================================================
     * TEMPLATE CHANGE HANDLER
     * ========================================================================
     */
    
    async onTemplateChange(templateId) {
        console.log(`🔄 [TEMPLATE CHANGE] New template selected: ${templateId}`);
        
        if (!templateId) {
            console.warn('⚠️ [TEMPLATE CHANGE] No template ID provided');
            return;
        }
        
        // Show loading state
        this.showLoadingState();
        
        try {
            // Fetch template data
            this.currentTemplateId = templateId;
            this.currentTemplate = await this.fetchTemplate(templateId);
            
            // Refresh active tab
            if (this.activeTab === 'settings') {
                await this.loadTemplateSettings(templateId);
            } else if (this.activeTab === 'categories') {
                await this.loadCategorySettings(templateId);
            }
            
            // Update badge counts
            this.updateBadgeCounts();
            
            console.log('✅ [TEMPLATE CHANGE] Template data loaded successfully');
            
        } catch (error) {
            console.error('❌ [TEMPLATE CHANGE] Failed to load template:', error);
            this.toast.show('Failed to load template data', 'error');
        } finally {
            this.hideLoadingState();
        }
    }
    
    /**
     * ========================================================================
     * TEMPLATE SETTINGS - Fillers & Synonyms
     * ========================================================================
     */
    
    async loadTemplateSettings(templateId) {
        console.log(`📊 [TEMPLATE SETTINGS] Loading for template: ${templateId}`);
        
        try {
            const template = await this.fetchTemplate(templateId);
            
            // Render fillers
            this.renderTemplateFillers(template.fillerWords || []);
            
            // Render synonyms
            this.renderTemplateSynonyms(template.synonymMap || {});
            
            console.log('✅ [TEMPLATE SETTINGS] Loaded successfully');
            
        } catch (error) {
            console.error('❌ [TEMPLATE SETTINGS] Load failed:', error);
            throw error;
        }
    }
    
    renderTemplateFillers(fillers) {
        const container = document.getElementById('template-fillers-display');
        if (!container) return;
        
        if (!fillers || fillers.length === 0) {
            container.innerHTML = `
                <div class="text-center text-gray-500 py-4 w-full">
                    <i class="fas fa-inbox text-3xl mb-2"></i>
                    <p class="text-sm">No filler words yet</p>
                    <p class="text-xs">Add words like "um", "uh", "like" to remove them from caller input</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = fillers.map(filler => `
            <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-800 rounded-full border border-blue-300 transition-all hover:bg-blue-200">
                <span class="font-medium">${this.escapeHtml(filler)}</span>
                <button onclick="templateDataManager.removeTemplateFiller('${this.escapeHtml(filler)}')" 
                        class="text-blue-600 hover:text-blue-800 hover:bg-blue-300 rounded-full p-1 transition-colors"
                        title="Remove filler">
                    <i class="fas fa-times text-xs"></i>
                </button>
            </div>
        `).join('');
    }
    
    renderTemplateSynonyms(synonymMap) {
        const container = document.getElementById('template-synonyms-display');
        if (!container) return;
        
        const entries = Object.entries(synonymMap);
        
        if (entries.length === 0) {
            container.innerHTML = `
                <div class="text-center text-gray-500 py-4">
                    <i class="fas fa-inbox text-3xl mb-2"></i>
                    <p class="text-sm">No synonym mappings yet</p>
                    <p class="text-xs">Map colloquial terms (e.g., "thingy") to technical terms (e.g., "thermostat")</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = entries.map(([technical, colloquial]) => `
            <div class="flex items-center justify-between p-3 bg-white border-2 border-purple-200 rounded-lg hover:border-purple-400 hover:shadow-md transition-all">
                <div class="flex items-center gap-3 flex-1">
                    <div class="font-mono font-bold text-purple-900">${this.escapeHtml(technical)}</div>
                    <div class="text-gray-400 text-xl">→</div>
                    <div class="flex flex-wrap gap-1.5">
                        ${(Array.isArray(colloquial) ? colloquial : [colloquial]).map(term => `
                            <span class="px-2 py-1 bg-purple-50 text-purple-700 rounded text-sm border border-purple-200">
                                ${this.escapeHtml(term)}
                            </span>
                        `).join('')}
                    </div>
                </div>
                <button onclick="templateDataManager.removeTemplateSynonym('${this.escapeHtml(technical)}')" 
                        class="ml-3 px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg transition-colors text-sm font-semibold">
                    <i class="fas fa-trash mr-1"></i>
                    Delete
                </button>
            </div>
        `).join('');
    }
    
    /**
     * ========================================================================
     * CATEGORY SETTINGS TABLE
     * ========================================================================
     */
    
    async loadCategorySettings(templateId) {
        console.log(`📊 [CATEGORY SETTINGS] Loading for template: ${templateId}`);
        
        try {
            const template = await this.fetchTemplate(templateId);
            const categories = template.categories || [];
            
            // Update count
            document.getElementById('category-table-count').textContent = categories.length;
            document.getElementById('category-settings-badge').textContent = categories.length;
            
            // Render table
            this.renderCategoryTable(categories, template.fillerWords || [], template.synonymMap || {});
            
            console.log('✅ [CATEGORY SETTINGS] Loaded successfully');
            
        } catch (error) {
            console.error('❌ [CATEGORY SETTINGS] Load failed:', error);
            throw error;
        }
    }
    
    renderCategoryTable(categories, templateFillers, templateSynonyms) {
        const tbody = document.getElementById('category-settings-tbody');
        const emptyState = document.getElementById('category-settings-empty');
        
        if (!categories || categories.length === 0) {
            tbody.innerHTML = '';
            emptyState?.classList.remove('hidden');
            return;
        }
        
        emptyState?.classList.add('hidden');
        
        tbody.innerHTML = categories.map((category, index) => {
            const customFillers = category.additionalFillerWords || [];
            const customSynonyms = Object.keys(category.synonymMap || {}).length;
            const totalFillers = templateFillers.length + customFillers.length;
            const totalSynonyms = Object.keys(templateSynonyms).length + customSynonyms;
            
            return `
                <tr id="category-row-${category._id}" class="hover:bg-blue-50 transition-colors">
                    <td>
                        <button onclick="templateDataManager.toggleCategoryRow('${category._id}')" 
                                class="text-gray-400 hover:text-blue-600 transition-colors">
                            <i class="fas fa-chevron-right transform transition-transform" id="chevron-${category._id}"></i>
                        </button>
                    </td>
                    <td>
                        <div class="font-semibold text-gray-900">${this.escapeHtml(category.name)}</div>
                        <div class="text-xs text-gray-500 mt-0.5">${this.escapeHtml(category.description || '')}</div>
                    </td>
                    <td>
                        <span class="badge-base badge-count">
                            <i class="fas fa-comment-dots"></i>
                            ${category.scenarios?.length || 0}
                        </span>
                    </td>
                    <td>
                        <span class="badge-base ${customFillers.length > 0 ? 'badge-custom' : 'badge-count'}">
                            <i class="fas fa-filter"></i>
                            ${customFillers.length > 0 ? `+${customFillers.length} custom` : 'Inherited only'}
                        </span>
                    </td>
                    <td>
                        <span class="badge-base ${customSynonyms > 0 ? 'badge-custom' : 'badge-count'}">
                            <i class="fas fa-language"></i>
                            ${customSynonyms > 0 ? `+${customSynonyms} custom` : 'Inherited only'}
                        </span>
                    </td>
                    <td>
                        <div class="text-sm text-gray-700">
                            <span class="font-semibold">${totalFillers}</span> fillers, 
                            <span class="font-semibold">${totalSynonyms}</span> synonyms
                        </div>
                    </td>
                    <td>
                        <button onclick="templateDataManager.editCategorySettings('${category._id}')" 
                                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-semibold">
                            <i class="fas fa-edit mr-1"></i>
                            Edit
                        </button>
                    </td>
                </tr>
                <tr id="category-expansion-${category._id}" class="hidden">
                    <td colspan="7">
                        <div class="table-expansion-panel">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                
                                <!-- ============================================
                                     CUSTOM FILLERS (Category-Specific)
                                     ============================================ -->
                                <div>
                                    <h4 class="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                                        <i class="fas fa-filter text-blue-600"></i>
                                        Custom Fillers (${customFillers.length})
                                        <span class="badge-base badge-inheritance text-xs ml-2">
                                            + ${templateFillers.length} inherited
                                        </span>
                                    </h4>
                                    
                                    <!-- Quick Add Form -->
                                    <div class="flex gap-2 mb-3">
                                        <input type="text" 
                                               id="quick-add-filler-${category._id}" 
                                               placeholder="Add filler (e.g., basically, literally...)" 
                                               class="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                               onkeypress="if(event.key==='Enter'){event.preventDefault();templateDataManager.addCategoryFiller('${category._id}', this.value.trim()).then(()=>this.value='');}">
                                        <button onclick="const input=document.getElementById('quick-add-filler-${category._id}'); templateDataManager.addCategoryFiller('${category._id}', input.value.trim()).then(()=>input.value='');" 
                                                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold transition-colors">
                                            <i class="fas fa-plus"></i>
                                        </button>
                                    </div>
                                    
                                    <!-- Filler Tags -->
                                    <div class="flex flex-wrap gap-1.5 min-h-[40px] p-2 bg-yellow-50 border border-yellow-200 rounded-md">
                                        ${customFillers.length > 0 ? customFillers.map(filler => `
                                            <span class="inline-flex items-center gap-1.5 px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium border border-yellow-300 hover:bg-yellow-200 transition-colors">
                                                ${this.escapeHtml(filler)}
                                                <button onclick="templateDataManager.removeCategoryFiller('${category._id}', '${this.escapeHtml(filler)}')" 
                                                        class="text-yellow-600 hover:text-yellow-900 hover:bg-yellow-300 rounded-full transition-colors"
                                                        title="Remove">
                                                    <i class="fas fa-times text-xs"></i>
                                                </button>
                                            </span>
                                        `).join('') : '<span class="text-gray-500 text-xs italic">No custom fillers yet</span>'}
                                    </div>
                                    
                                    <!-- Info Box -->
                                    <div class="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-md">
                                        <p class="text-xs text-gray-700">
                                            <i class="fas fa-info-circle text-blue-600 mr-1"></i>
                                            These extend the ${templateFillers.length} template fillers. All ${customFillers.length + templateFillers.length} words will be removed from caller input.
                                        </p>
                                    </div>
                                </div>
                                
                                <!-- ============================================
                                     CUSTOM SYNONYMS (Category-Specific)
                                     ============================================ -->
                                <div>
                                    <h4 class="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                                        <i class="fas fa-language text-purple-600"></i>
                                        Custom Synonyms (${customSynonyms})
                                        <span class="badge-base badge-inheritance text-xs ml-2">
                                            + ${Object.keys(templateSynonyms).length} inherited
                                        </span>
                                    </h4>
                                    
                                    <!-- Quick Add Form -->
                                    <div class="flex gap-1 mb-3">
                                        <input type="text" 
                                               id="quick-add-synonym-tech-${category._id}" 
                                               placeholder="Technical" 
                                               class="flex-1 px-3 py-1.5 border border-purple-300 rounded-md text-xs focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                                        <span class="flex items-center text-gray-400 font-bold">→</span>
                                        <input type="text" 
                                               id="quick-add-synonym-coll-${category._id}" 
                                               placeholder="Colloquial (comma-separated)" 
                                               class="flex-1 px-3 py-1.5 border border-purple-300 rounded-md text-xs focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                               onkeypress="if(event.key==='Enter'){event.preventDefault();const tech=document.getElementById('quick-add-synonym-tech-${category._id}').value.trim(); const coll=this.value.trim(); if(tech&&coll){templateDataManager.addCategorySynonym('${category._id}',tech,coll).then(()=>{document.getElementById('quick-add-synonym-tech-${category._id}').value='';this.value='';});}}">
                                        <button onclick="const tech=document.getElementById('quick-add-synonym-tech-${category._id}').value.trim(); const coll=document.getElementById('quick-add-synonym-coll-${category._id}').value.trim(); if(tech&&coll){templateDataManager.addCategorySynonym('${category._id}',tech,coll).then(()=>{document.getElementById('quick-add-synonym-tech-${category._id}').value='';document.getElementById('quick-add-synonym-coll-${category._id}').value='';});}" 
                                                class="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-xs font-semibold transition-colors">
                                            <i class="fas fa-plus"></i>
                                        </button>
                                    </div>
                                    
                                    <!-- Synonym Cards -->
                                    <div class="space-y-1.5 min-h-[40px] p-2 bg-purple-50 border border-purple-200 rounded-md">
                                        ${customSynonyms > 0 ? Object.entries(category.synonymMap || {}).map(([tech, coll]) => `
                                            <div class="flex items-center justify-between p-2 bg-white border border-purple-200 rounded-md hover:border-purple-400 transition-colors">
                                                <div class="flex-1 text-xs">
                                                    <span class="font-mono font-bold text-purple-900">${this.escapeHtml(tech)}</span>
                                                    <span class="text-gray-400 mx-1">→</span>
                                                    <span class="text-purple-700">${Array.isArray(coll) ? coll.join(', ') : coll}</span>
                                                </div>
                                                <button onclick="templateDataManager.removeCategorySynonym('${category._id}', '${this.escapeHtml(tech)}')" 
                                                        class="ml-2 px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-semibold transition-colors"
                                                        title="Delete">
                                                    <i class="fas fa-trash text-xs"></i>
                                                </button>
                                            </div>
                                        `).join('') : '<span class="text-gray-500 text-xs italic">No custom synonyms yet</span>'}
                                    </div>
                                    
                                    <!-- Info Box -->
                                    <div class="mt-2 p-2 bg-purple-50 border border-purple-200 rounded-md">
                                        <p class="text-xs text-gray-700">
                                            <i class="fas fa-info-circle text-purple-600 mr-1"></i>
                                            These extend the ${Object.keys(templateSynonyms).length} template synonyms. Total: ${customSynonyms + Object.keys(templateSynonyms).length} mappings.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
    
    toggleCategoryRow(categoryId) {
        const row = document.getElementById(`category-row-${categoryId}`);
        const expansion = document.getElementById(`category-expansion-${categoryId}`);
        const chevron = document.getElementById(`chevron-${categoryId}`);
        
        if (!row || !expansion || !chevron) return;
        
        const isExpanded = !expansion.classList.contains('hidden');
        
        if (isExpanded) {
            // Collapse
            expansion.classList.add('hidden');
            row.classList.remove('expanded');
            chevron.style.transform = 'rotate(0deg)';
        } else {
            // Expand
            expansion.classList.remove('hidden');
            row.classList.add('expanded');
            chevron.style.transform = 'rotate(90deg)';
        }
    }
    
    /**
     * ========================================================================
     * API OPERATIONS
     * ========================================================================
     */
    
    async fetchTemplate(templateId) {
        // Check cache
        const cached = this.cache.templates.get(templateId);
        const now = Date.now();
        
        if (cached && (now - this.cache.lastFetch) < this.cache.ttl) {
            console.log('✅ [CACHE HIT] Using cached template data');
            return cached;
        }
        
        // Fetch from API
        console.log(`📡 [API] Fetching template: ${templateId}`);
        const response = await fetch(`${this.apiBase}/${templateId}`, {
            headers: {
                'Authorization': `Bearer ${this.token}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch template: ${response.statusText}`);
        }
        
        const data = await response.json();
        const template = data.template || data;
        
        // Update cache
        this.cache.templates.set(templateId, template);
        this.cache.lastFetch = now;
        
        return template;
    }
    
    async addTemplateFiller(filler) {
        console.log(`➕ [ADD FILLER] Adding to template: ${filler}`);
        
        try {
            const response = await fetch(`${this.apiBase}/${this.currentTemplateId}/fillers`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fillers: [filler] })
            });
            
            if (!response.ok) throw new Error('Failed to add filler');
            
            // Invalidate cache
            this.cache.templates.delete(this.currentTemplateId);
            
            // Reload
            await this.loadTemplateSettings(this.currentTemplateId);
            
            this.toast.show(`Added filler: "${filler}"`, 'success');
            console.log('✅ [ADD FILLER] Success');
            
        } catch (error) {
            console.error('❌ [ADD FILLER] Failed:', error);
            this.toast.show('Failed to add filler', 'error');
            throw error;
        }
    }
    
    async removeTemplateFiller(filler) {
        console.log(`➖ [REMOVE FILLER] Removing from template: ${filler}`);
        
        try {
            const response = await fetch(`${this.apiBase}/${this.currentTemplateId}/fillers`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fillers: [filler] })
            });
            
            if (!response.ok) throw new Error('Failed to remove filler');
            
            // Invalidate cache
            this.cache.templates.delete(this.currentTemplateId);
            
            // Reload
            await this.loadTemplateSettings(this.currentTemplateId);
            
            this.toast.show(`Removed filler: "${filler}"`, 'success');
            console.log('✅ [REMOVE FILLER] Success');
            
        } catch (error) {
            console.error('❌ [REMOVE FILLER] Failed:', error);
            this.toast.show('Failed to remove filler', 'error');
            throw error;
        }
    }
    
    async addTemplateSynonym(technical, colloquial) {
        console.log(`➕ [ADD SYNONYM] ${technical} → ${colloquial}`);
        
        try {
            const response = await fetch(`${this.apiBase}/${this.currentTemplateId}/synonyms`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    technicalTerm: technical,
                    colloquialTerms: colloquial.split(',').map(t => t.trim())
                })
            });
            
            if (!response.ok) throw new Error('Failed to add synonym');
            
            // Invalidate cache
            this.cache.templates.delete(this.currentTemplateId);
            
            // Reload
            await this.loadTemplateSettings(this.currentTemplateId);
            
            this.toast.show(`Added synonym mapping: "${technical}"`, 'success');
            console.log('✅ [ADD SYNONYM] Success');
            
        } catch (error) {
            console.error('❌ [ADD SYNONYM] Failed:', error);
            this.toast.show('Failed to add synonym', 'error');
            throw error;
        }
    }
    
    async removeTemplateSynonym(technical) {
        console.log(`➖ [REMOVE SYNONYM] Removing: ${technical}`);
        
        try {
            const response = await fetch(`${this.apiBase}/${this.currentTemplateId}/synonyms/${encodeURIComponent(technical)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (!response.ok) throw new Error('Failed to remove synonym');
            
            // Invalidate cache
            this.cache.templates.delete(this.currentTemplateId);
            
            // Reload
            await this.loadTemplateSettings(this.currentTemplateId);
            
            this.toast.show(`Removed synonym: "${technical}"`, 'success');
            console.log('✅ [REMOVE SYNONYM] Success');
            
        } catch (error) {
            console.error('❌ [REMOVE SYNONYM] Failed:', error);
            this.toast.show('Failed to remove synonym', 'error');
            throw error;
        }
    }
    
    /**
     * ========================================================================
     * UI HELPERS
     * ========================================================================
     */
    
    showLoadingState() {
        // Show skeletons in active tab
        if (this.activeTab === 'settings') {
            const fillersContainer = document.getElementById('template-fillers-display');
            const synonymsContainer = document.getElementById('template-synonyms-display');
            
            if (fillersContainer) {
                fillersContainer.innerHTML = `
                    <div class="skeleton skeleton-text w-20"></div>
                    <div class="skeleton skeleton-text w-16"></div>
                    <div class="skeleton skeleton-text w-24"></div>
                `;
            }
            
            if (synonymsContainer) {
                synonymsContainer.innerHTML = `
                    <div class="skeleton skeleton-text w-full"></div>
                    <div class="skeleton skeleton-text w-3/4"></div>
                    <div class="skeleton skeleton-text w-5/6"></div>
                `;
            }
        }
    }
    
    hideLoadingState() {
        // Loading states are replaced by actual content
    }
    
    updateBadgeCounts() {
        if (!this.currentTemplate) return;
        
        const fillerCount = (this.currentTemplate.fillerWords || []).length;
        const synonymCount = Object.keys(this.currentTemplate.synonymMap || {}).length;
        const totalSettings = fillerCount + synonymCount;
        
        document.getElementById('template-settings-badge').textContent = totalSettings;
        document.getElementById('category-settings-badge').textContent = (this.currentTemplate.categories || []).length;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    initFallbackToast() {
        return {
            show: (message, type) => {
                console.log(`[TOAST ${type.toUpperCase()}] ${message}`);
                alert(message);
            }
        };
    }
    
    editCategorySettings(categoryId) {
        console.log(`📝 [EDIT CATEGORY] Opening editor for: ${categoryId}`);
        // This will hook into existing category modal system
        if (typeof window.openEditCategoryModal === 'function') {
            const category = this.currentTemplate?.categories.find(c => c._id === categoryId);
            if (category) {
                window.openEditCategoryModal(category);
            }
        }
    }
    
    /**
     * ========================================================================
     * CATEGORY-LEVEL FILLER & SYNONYM OPERATIONS
     * ========================================================================
     */
    
    async addCategoryFiller(categoryId, filler) {
        console.log(`➕ [CATEGORY FILLER] Adding to category ${categoryId}: ${filler}`);
        
        try {
            const response = await fetch(`${this.apiBase}/${this.currentTemplateId}/categories/${categoryId}/fillers`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fillers: [filler] })
            });
            
            if (!response.ok) throw new Error('Failed to add category filler');
            
            // Invalidate cache
            this.cache.templates.delete(this.currentTemplateId);
            
            // Reload category settings tab
            await this.loadCategorySettings(this.currentTemplateId);
            
            this.toast.show(`Added filler to category: "${filler}"`, 'success');
            console.log('✅ [CATEGORY FILLER] Success');
            
        } catch (error) {
            console.error('❌ [CATEGORY FILLER] Failed:', error);
            this.toast.show('Failed to add filler', 'error');
            throw error;
        }
    }
    
    async removeCategoryFiller(categoryId, filler) {
        console.log(`➖ [CATEGORY FILLER] Removing from category ${categoryId}: ${filler}`);
        
        try {
            const response = await fetch(`${this.apiBase}/${this.currentTemplateId}/categories/${categoryId}/fillers`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fillers: [filler] })
            });
            
            if (!response.ok) throw new Error('Failed to remove category filler');
            
            // Invalidate cache
            this.cache.templates.delete(this.currentTemplateId);
            
            // Reload category settings tab
            await this.loadCategorySettings(this.currentTemplateId);
            
            this.toast.show(`Removed filler from category: "${filler}"`, 'success');
            console.log('✅ [CATEGORY FILLER] Success');
            
        } catch (error) {
            console.error('❌ [CATEGORY FILLER] Failed:', error);
            this.toast.show('Failed to remove filler', 'error');
            throw error;
        }
    }
    
    async addCategorySynonym(categoryId, technical, colloquial) {
        console.log(`➕ [CATEGORY SYNONYM] Adding to category ${categoryId}: ${technical} → ${colloquial}`);
        
        try {
            const response = await fetch(`${this.apiBase}/${this.currentTemplateId}/categories/${categoryId}/synonyms`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    technicalTerm: technical,
                    colloquialTerms: colloquial.split(',').map(t => t.trim())
                })
            });
            
            if (!response.ok) throw new Error('Failed to add category synonym');
            
            // Invalidate cache
            this.cache.templates.delete(this.currentTemplateId);
            
            // Reload category settings tab
            await this.loadCategorySettings(this.currentTemplateId);
            
            this.toast.show(`Added synonym to category: "${technical}"`, 'success');
            console.log('✅ [CATEGORY SYNONYM] Success');
            
        } catch (error) {
            console.error('❌ [CATEGORY SYNONYM] Failed:', error);
            this.toast.show('Failed to add synonym', 'error');
            throw error;
        }
    }
    
    async removeCategorySynonym(categoryId, technical) {
        console.log(`➖ [CATEGORY SYNONYM] Removing from category ${categoryId}: ${technical}`);
        
        try {
            const response = await fetch(`${this.apiBase}/${this.currentTemplateId}/categories/${categoryId}/synonyms/${encodeURIComponent(technical)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (!response.ok) throw new Error('Failed to remove category synonym');
            
            // Invalidate cache
            this.cache.templates.delete(this.currentTemplateId);
            
            // Reload category settings tab
            await this.loadCategorySettings(this.currentTemplateId);
            
            this.toast.show(`Removed synonym from category: "${technical}"`, 'success');
            console.log('✅ [CATEGORY SYNONYM] Success');
            
        } catch (error) {
            console.error('❌ [CATEGORY SYNONYM] Failed:', error);
            this.toast.show('Failed to remove synonym', 'error');
            throw error;
        }
    }
}

// ============================================================================
// GLOBAL FUNCTIONS (Called from HTML onclick handlers)
// ============================================================================

/**
 * Initialize the manager when page loads
 */
let templateDataManager;

document.addEventListener('DOMContentLoaded', () => {
    templateDataManager = new TemplateDataManager();
    window.templateDataManager = templateDataManager; // Global access
    console.log('🎉 [INIT] TemplateDataManager ready');
});

/**
 * Tab switching handler
 */
function switchTemplateDataTab(tabName) {
    templateDataManager?.switchTab(tabName);
}

/**
 * Template filler operations
 */
function addTemplateFillers() {
    const input = document.getElementById('template-filler-input');
    if (!input || !input.value.trim()) return;
    
    const fillers = input.value.split(',').map(f => f.trim()).filter(f => f);
    
    // Add each filler
    Promise.all(fillers.map(filler => templateDataManager.addTemplateFiller(filler)))
        .then(() => {
            input.value = '';
        })
        .catch(console.error);
}

/**
 * Template synonym operations
 */
function addTemplateSynonym() {
    const technicalInput = document.getElementById('template-synonym-technical');
    const colloquialInput = document.getElementById('template-synonym-colloquial');
    
    if (!technicalInput || !colloquialInput) return;
    
    const technical = technicalInput.value.trim();
    const colloquial = colloquialInput.value.trim();
    
    if (!technical || !colloquial) {
        templateDataManager.toast.show('Please enter both technical and colloquial terms', 'error');
        return;
    }
    
    templateDataManager.addTemplateSynonym(technical, colloquial)
        .then(() => {
            technicalInput.value = '';
            colloquialInput.value = '';
        })
        .catch(console.error);
}

/**
 * Import/Export operations (placeholder)
 */
function importTemplateFillers() {
    console.log('📥 [IMPORT] Fillers - Feature coming soon');
    templateDataManager.toast.show('Import feature coming soon', 'info');
}

function exportTemplateFillers() {
    console.log('📤 [EXPORT] Fillers');
    const fillers = templateDataManager.currentTemplate?.fillerWords || [];
    const blob = new Blob([JSON.stringify(fillers, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template-fillers-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importTemplateSynonyms() {
    console.log('📥 [IMPORT] Synonyms - Feature coming soon');
    templateDataManager.toast.show('Import feature coming soon', 'info');
}

function exportTemplateSynonyms() {
    console.log('📤 [EXPORT] Synonyms');
    const synonyms = templateDataManager.currentTemplate?.synonymMap || {};
    const blob = new Blob([JSON.stringify(synonyms, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template-synonyms-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

