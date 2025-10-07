/**
 * INSTANT RESPONSE CATEGORIES MANAGER
 * 
 * Purpose: Category-based organization for instant responses
 * Features:
 * - Category CRUD (create, read, update, delete)
 * - Q&A management within categories
 * - AI generation (10 Q&As per category, 8 variations per trigger)
 * - Advanced behavior (timing, follow-ups, context awareness)
 * 
 * Architecture: Inspired by Company Q&A design pattern
 * 
 * Created: 2025-10-02
 */

class InstantResponseCategoriesManager {
    constructor(companyId) {
        this.companyId = companyId;
        this.categories = [];
        this.currentCategory = null;
        this.currentQnA = null;
        
        // 🧠 Initialize Global AI Brain Sync
        this.globalAIBrainSync = null;
        
        console.log(`⚡ Initializing InstantResponseCategoriesManager for company: ${companyId}`);
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    async init() {
        console.log('⚡ [Categories] Initializing...');
        await this.loadCategories();
        this.attachEventListeners();
        this.render();
        
        // 🧠 Initialize Global AI Brain Sync
        if (typeof GlobalAIBrainSync !== 'undefined') {
            this.globalAIBrainSync = new GlobalAIBrainSync(this.companyId, this);
            window.globalAIBrainSync = this.globalAIBrainSync; // Make globally accessible
            console.log('🧠 [Categories] Global AI Brain Sync initialized');
        }
        
        console.log('✅ [Categories] Initialized successfully');
    }

    getAuthToken() {
        return localStorage.getItem('adminToken') ||
               localStorage.getItem('authToken') ||
               sessionStorage.getItem('authToken') ||
               localStorage.getItem('token') ||
               sessionStorage.getItem('token') || '';
    }

    // ========================================================================
    // API CALLS
    // ========================================================================

    async loadCategories() {
        try {
            console.log(`📁 Loading categories for company: ${this.companyId}`);
            
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories?includeQnAs=true`, {
                credentials: 'include',
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            this.categories = result.data || [];
            
            console.log(`✅ Loaded ${this.categories.length} categories`);
        } catch (error) {
            console.error('Error loading categories:', error);
            this.showError('Failed to load categories');
        }
    }

    async createCategory(data) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            this.categories.push(result.data);
            this.showSuccess('Category created successfully!');
            this.render();
            return result.data;
        } catch (error) {
            console.error('Error creating category:', error);
            this.showError(error.message || 'Failed to create category');
            throw error;
        }
    }

    async updateCategory(categoryId, data) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories/${categoryId}`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            const index = this.categories.findIndex(c => c._id === categoryId);
            if (index !== -1) {
                this.categories[index] = result.data;
            }
            this.showSuccess('Category updated successfully!');
            this.render();
            return result.data;
        } catch (error) {
            console.error('Error updating category:', error);
            this.showError(error.message || 'Failed to update category');
            throw error;
        }
    }

    async deleteCategory(categoryId) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories/${categoryId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            this.categories = this.categories.filter(c => c._id !== categoryId);
            this.showSuccess('Category deleted successfully!');
            this.render();
        } catch (error) {
            console.error('Error deleting category:', error);
            this.showError('Failed to delete category');
            throw error;
        }
    }

    async addQnA(categoryId, qnaData) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories/${categoryId}/qnas`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify(qnaData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            
            // Update local category
            const category = this.categories.find(c => c._id === categoryId);
            if (category) {
                category.qnas.push(result.data);
                category.stats.totalQnAs = category.qnas.length;
                category.stats.enabledQnAs = category.qnas.filter(q => q.enabled).length;
            }
            
            this.showSuccess('Q&A added successfully!');
            this.render();
            return result.data;
        } catch (error) {
            console.error('Error adding Q&A:', error);
            this.showError(error.message || 'Failed to add Q&A');
            throw error;
        }
    }

    async updateQnA(categoryId, qnaId, updates) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories/${categoryId}/qnas/${qnaId}`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify(updates)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            
            // Update local Q&A
            const category = this.categories.find(c => c._id === categoryId);
            if (category) {
                const qnaIndex = category.qnas.findIndex(q => q.id === qnaId);
                if (qnaIndex !== -1) {
                    category.qnas[qnaIndex] = result.data;
                }
            }
            
            this.showSuccess('Q&A updated successfully!');
            this.render();
            return result.data;
        } catch (error) {
            console.error('Error updating Q&A:', error);
            this.showError(error.message || 'Failed to update Q&A');
            throw error;
        }
    }

    async deleteQnA(categoryId, qnaId) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories/${categoryId}/qnas/${qnaId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // Update local category
            const category = this.categories.find(c => c._id === categoryId);
            if (category) {
                category.qnas = category.qnas.filter(q => q.id !== qnaId);
                category.stats.totalQnAs = category.qnas.length;
                category.stats.enabledQnAs = category.qnas.filter(q => q.enabled).length;
            }
            
            this.showSuccess('Q&A deleted successfully!');
            this.render();
        } catch (error) {
            console.error('Error deleting Q&A:', error);
            this.showError('Failed to delete Q&A');
            throw error;
        }
    }

    async generateVariations(trigger) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories/generate-variations`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify({ trigger, count: 8 })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            return result.data || [];
        } catch (error) {
            console.error('Error generating variations:', error);
            this.showError('Failed to generate variations');
            return [];
        }
    }

    async suggestAIResponse(categoryName, categoryDescription, mainTrigger, variations) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories/suggest-response`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify({
                    categoryName,
                    categoryDescription,
                    mainTrigger,
                    variations
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            return result.data?.response || '';
        } catch (error) {
            console.error('Error generating AI response:', error);
            this.showError('Failed to generate AI response suggestion');
            return '';
        }
    }

    async generateQnAs(categoryId) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories/${categoryId}/generate-qnas`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify({ count: 10 })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            return result.data || [];
        } catch (error) {
            console.error('Error generating Q&As:', error);
            this.showError('Failed to generate Q&As');
            return [];
        }
    }

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================

    attachEventListeners() {
        // Add Category button
        document.getElementById('add-category-btn')?.addEventListener('click', () => {
            this.openCategoryModal();
        });

        // Category modal save
        document.getElementById('save-category-btn')?.addEventListener('click', () => {
            this.saveCategoryModal();
        });
        
        // 🧠 Sync with Global AI Brain button
        document.getElementById('sync-global-brain-btn')?.addEventListener('click', () => {
            if (this.globalAIBrainSync) {
                this.globalAIBrainSync.openSyncModal();
            } else {
                this.showError('Global AI Brain Sync not initialized');
            }
        });
    }

    openCategoryModal(category = null) {
        this.currentCategory = category;
        
        const modal = document.getElementById('category-modal');
        const title = document.getElementById('category-modal-title');
        
        if (category) {
            title.textContent = 'Edit Category';
            document.getElementById('ir-category-name').value = category.name || '';
            document.getElementById('ir-category-description').value = category.description || '';
            document.getElementById('category-icon').value = category.icon || '⚡';
            document.getElementById('category-color').value = category.color || '#4F46E5';
        } else {
            title.textContent = 'Add Category';
            document.getElementById('ir-category-name').value = '';
            document.getElementById('ir-category-description').value = '';
            document.getElementById('category-icon').value = '⚡';
            document.getElementById('category-color').value = '#4F46E5';
        }
        
        modal.style.display = 'flex';
    }

    closeCategoryModal() {
        document.getElementById('category-modal').style.display = 'none';
        this.currentCategory = null;
    }

    async saveCategoryModal() {
        const data = {
            name: document.getElementById('ir-category-name').value.trim(),
            description: document.getElementById('ir-category-description').value.trim(),
            icon: document.getElementById('category-icon').value.trim(),
            color: document.getElementById('category-color').value.trim()
        };

        if (!data.name || !data.description) {
            this.showError('Name and description are required');
            return;
        }

        try {
            if (this.currentCategory) {
                await this.updateCategory(this.currentCategory._id, data);
            } else {
                await this.createCategory(data);
            }
            this.closeCategoryModal();
        } catch (error) {
            // Error already shown in API call
        }
    }

    async handleDeleteCategory(categoryId, categoryName) {
        if (!confirm(`Are you sure you want to delete "${categoryName}"? This will delete all Q&As in this category.`)) {
            return;
        }

        await this.deleteCategory(categoryId);
    }

    // ========================================================================
    // RENDERING
    // ========================================================================

    render() {
        const container = document.getElementById('instant-response-categories-container');
        if (!container) {
            console.error('Container not found');
            return;
        }

        container.innerHTML = this.renderHTML();
        this.attachDynamicEventListeners();
    }

    renderHTML() {
        if (this.categories.length === 0) {
            return this.renderEmptyState();
        }

        return `
            <div class="categories-list">
                ${this.categories.map(cat => this.renderCategory(cat)).join('')}
            </div>
        `;
    }

    renderEmptyState() {
        return `
            <div class="empty-state" style="text-align: center; padding: 60px 20px; background: #f8f9fa; border-radius: 12px; border: 2px dashed #dee2e6;">
                <i class="fas fa-folder-open" style="font-size: 64px; color: #adb5bd; margin-bottom: 20px;"></i>
                <h3 style="color: #495057; margin-bottom: 10px;">No Categories Yet</h3>
                <p style="color: #6c757d; margin-bottom: 20px;">Create your first category to organize instant responses</p>
                <button onclick="instantResponseCategoriesManager.openCategoryModal()" class="btn btn-primary">
                    <i class="fas fa-plus mr-2"></i>Add Your First Category
                </button>
            </div>
        `;
    }

    renderCategory(category) {
        const qnaCount = category.stats?.totalQnAs || category.qnas?.length || 0;
        const enabledCount = category.stats?.enabledQnAs || category.qnas?.filter(q => q.enabled).length || 0;
        
        return `
            <div class="category-card" style="background: white; border: 2px solid #e9ecef; border-radius: 12px; padding: 20px; margin-bottom: 20px; transition: all 0.3s ease;">
                <div style="display: flex; align-items: start; justify-content: space-between; margin-bottom: 15px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                            <span style="font-size: 24px;">${this.escapeHtml(category.icon || '⚡')}</span>
                            <h3 style="font-size: 20px; font-weight: 700; color: #2c3e50; margin: 0;">
                                ${this.escapeHtml(category.name)}
                            </h3>
                            ${!category.enabled ? '<span class="badge badge-secondary">Disabled</span>' : ''}
                        </div>
                        <p style="color: #6c757d; font-size: 14px; margin: 0; line-height: 1.5;">
                            ${this.escapeHtml(category.description)}
                        </p>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-sm btn-outline-primary" onclick="instantResponseCategoriesManager.openCategoryModal(${this.escapeJson(category)})" title="Edit Category">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="instantResponseCategoriesManager.handleDeleteCategory('${category._id}', '${this.escapeHtml(category.name)}')" title="Delete Category">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>

                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <button class="btn btn-sm btn-success" onclick="instantResponseCategoriesManager.openAddQnAModal('${category._id}')">
                        <i class="fas fa-plus mr-1"></i>Add Q&A
                    </button>
                    <button class="btn btn-sm btn-info" onclick="instantResponseCategoriesManager.handleGenerateQnAs('${category._id}')">
                        <i class="fas fa-magic mr-1"></i>AI Suggest 10 Q&As
                    </button>
                </div>

                <div style="background: #f8f9fa; border-radius: 8px; padding: 12px; margin-bottom: 15px;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 14px; color: #6c757d;">
                            <i class="fas fa-list-ul mr-2"></i><strong>${qnaCount}</strong> Q&As
                            ${enabledCount !== qnaCount ? `(${enabledCount} enabled)` : ''}
                        </span>
                    </div>
                </div>

                ${qnaCount > 0 ? this.renderQnAsList(category) : '<p style="color: #adb5bd; font-style: italic; text-align: center; margin: 20px 0;">No Q&As yet - click "Add Q&A" or "AI Suggest 10 Q&As" to get started</p>'}
            </div>
        `;
    }

    renderQnAsList(category) {
        const qnas = category.qnas || [];
        
        if (qnas.length === 0) return '';

        return `
            <div class="qnas-list" style="border-top: 1px solid #e9ecef; padding-top: 15px;">
                ${qnas.map(qna => this.renderQnA(category._id, qna)).join('')}
            </div>
        `;
    }

    renderResponseVariations(qna) {
        const responses = qna.responses || (qna.response ? [qna.response] : []);
        
        if (responses.length === 0) {
            return '<p style="color: #adb5bd; font-style: italic; font-size: 13px; margin: 0;">No response set</p>';
        }
        
        if (responses.length === 1) {
            // Single response
            return `
                <p style="color: #495057; font-size: 14px; margin: 0; line-height: 1.5;">
                    → ${this.escapeHtml(responses[0])}
                </p>
            `;
        }
        
        // Multiple responses - show all with badges
        return `
            <div style="margin-top: 5px;">
                ${responses.map((resp, idx) => `
                    <div style="display: flex; align-items: start; gap: 8px; margin-bottom: 5px;">
                        <span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 2px;">
                            ${idx + 1}
                        </span>
                        <p style="color: #495057; font-size: 14px; margin: 0; line-height: 1.5; flex: 1;">
                            ${this.escapeHtml(resp)}
                        </p>
                    </div>
                `).join('')}
                <div style="margin-top: 8px; padding: 8px; background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); border-radius: 6px;">
                    <small style="color: #667eea; font-weight: 600;">
                        <i class="fas fa-sync-alt mr-1"></i>${responses.length} response variations - AI rotates for natural conversation
                    </small>
                </div>
            </div>
        `;
    }

    renderQnA(categoryId, qna) {
        const triggers = qna.triggers || [];
        const mainTrigger = triggers[0] || '';
        const variationCount = triggers.length - 1;
        
        return `
            <div class="qna-item" style="background: white; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                            <span style="font-weight: 600; color: #4F46E5;">
                                "${this.escapeHtml(mainTrigger)}"
                            </span>
                            ${variationCount > 0 ? `<span class="badge badge-info">+${variationCount} variations</span>` : ''}
                            ${!qna.enabled ? '<span class="badge badge-secondary">Disabled</span>' : ''}
                            ${qna.timing?.enabled ? '<span class="badge badge-warning"><i class="fas fa-clock mr-1"></i>Timed</span>' : ''}
                        </div>
                        ${this.renderResponseVariations(qna)}
                        ${qna.keywords?.length > 0 ? `
                            <div style="margin-top: 8px;">
                                <small style="color: #6c757d;">
                                    <i class="fas fa-key mr-1"></i>
                                    ${qna.keywords.slice(0, 5).map(k => `<span class="badge badge-light">${this.escapeHtml(k)}</span>`).join(' ')}
                                    ${qna.keywords.length > 5 ? `<span class="badge badge-light">+${qna.keywords.length - 5} more</span>` : ''}
                                </small>
                            </div>
                        ` : ''}
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn btn-sm btn-outline-primary" onclick="instantResponseCategoriesManager.openEditQnAModal('${categoryId}', '${qna.id}')" title="Edit Q&A">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="instantResponseCategoriesManager.handleDeleteQnA('${categoryId}', '${qna.id}')" title="Delete Q&A">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    attachDynamicEventListeners() {
        // Event listeners for dynamically rendered elements are handled via onclick attributes
    }

    // ========================================================================
    // Q&A MODAL HANDLERS
    // ========================================================================

    openAddQnAModal(categoryId) {
        this.currentCategory = this.categories.find(c => c._id === categoryId);
        this.currentQnA = null;
        this.currentVariations = [];
        
        document.getElementById('qna-modal-title').innerHTML = '<span style="font-size: 32px;">💬</span><span>Add Q&A</span>';
        this.resetQnAForm();
        document.getElementById('qna-modal').style.display = 'flex';
    }

    openEditQnAModal(categoryId, qnaId) {
        this.currentCategory = this.categories.find(c => c._id === categoryId);
        this.currentQnA = this.currentCategory?.qnas.find(q => q.id === qnaId);
        
        if (!this.currentQnA) {
            this.showError('Q&A not found');
            return;
        }
        
        document.getElementById('qna-modal-title').innerHTML = '<span style="font-size: 32px;">✏️</span><span>Edit Q&A</span>';
        this.populateQnAForm(this.currentQnA);
        document.getElementById('qna-modal').style.display = 'flex';
    }

    closeQnAModal() {
        document.getElementById('qna-modal').style.display = 'none';
        this.currentCategory = null;
        this.currentQnA = null;
        this.currentVariations = [];
    }

    resetQnAForm() {
        document.getElementById('qna-main-trigger').value = '';
        document.getElementById('qna-response').value = '';
        document.getElementById('qna-enabled').value = 'true';
        document.getElementById('qna-notes').value = '';
        document.getElementById('qna-priority').value = '50';
        document.getElementById('qna-priority-display').textContent = '50';
        document.getElementById('qna-timing-enabled').checked = false;
        document.getElementById('qna-context-aware').checked = false;
        document.getElementById('variations-container').style.display = 'none';
        document.getElementById('variations-list').innerHTML = '';
        document.getElementById('qna-keywords-display').textContent = 'Keywords will be generated automatically';
        this.currentVariations = [];
    }

    populateQnAForm(qna) {
        document.getElementById('qna-main-trigger').value = qna.triggers[0] || '';
        document.getElementById('qna-response').value = qna.response || '';
        document.getElementById('qna-enabled').value = qna.enabled ? 'true' : 'false';
        document.getElementById('qna-notes').value = qna.notes || '';
        document.getElementById('qna-priority').value = qna.priority || 50;
        document.getElementById('qna-priority-display').textContent = qna.priority || 50;
        document.getElementById('qna-context-aware').checked = qna.contextAware || false;
        
        // Load variations
        this.currentVariations = [...qna.triggers];
        if (this.currentVariations.length > 1) {
            this.renderVariations();
        }
        
        // Load timing settings
        if (qna.timing?.enabled) {
            document.getElementById('qna-timing-enabled').checked = true;
            document.getElementById('qna-wait-seconds').value = qna.timing.waitSeconds || 90;
            document.getElementById('qna-followup-message').value = qna.timing.followUpMessage || '';
            document.getElementById('timing-options').style.display = 'block';
            
            if (qna.timing.secondFollowUp?.enabled) {
                document.getElementById('qna-second-followup').checked = true;
                document.getElementById('qna-second-wait').value = qna.timing.secondFollowUp.waitSeconds || 120;
                document.getElementById('qna-second-message').value = qna.timing.secondFollowUp.message || '';
                document.getElementById('second-followup-options').style.display = 'block';
            }
        }
        
        // Display keywords
        if (qna.keywords && qna.keywords.length > 0) {
            const keywordsHtml = qna.keywords.slice(0, 5).map(k => `<span class="badge badge-primary">${this.escapeHtml(k)}</span>`).join(' ');
            document.getElementById('qna-keywords-display').innerHTML = keywordsHtml;
        }
    }

    async generateTriggerVariations() {
        const mainTrigger = document.getElementById('qna-main-trigger').value.trim();
        
        if (!mainTrigger) {
            this.showError('Please enter a main trigger phrase first');
            return;
        }
        
        try {
            const variations = await this.generateVariations(mainTrigger);
            
            // Start with main trigger, add variations
            this.currentVariations = [mainTrigger, ...variations.filter(v => v !== mainTrigger)];
            this.renderVariations();
            
            this.showSuccess(`Generated ${variations.length} variations!`);
        } catch (error) {
            console.error('Error generating variations:', error);
            this.showError('Failed to generate variations');
        }
    }

    async suggestAIResponseForModal() {
        const mainTrigger = document.getElementById('qna-main-trigger').value.trim();
        
        if (!mainTrigger) {
            this.showError('Please enter a main trigger phrase first');
            return;
        }
        
        try {
            // Get category context
            const category = this.categories.find(c => c._id === this.currentCategoryId);
            const categoryName = category?.name || '';
            const categoryDescription = category?.description || '';
            
            console.log('✨ Generating AI response suggestion...');
            
            // Call AI suggestion service
            const suggestedResponse = await this.suggestAIResponse(
                categoryName,
                categoryDescription,
                mainTrigger,
                this.currentVariations || [mainTrigger]
            );
            
            if (suggestedResponse) {
                // Auto-fill the response textarea
                document.getElementById('qna-response').value = suggestedResponse;
                this.showSuccess('AI response suggestion generated!');
            }
        } catch (error) {
            console.error('Error suggesting AI response:', error);
            this.showError('Failed to generate AI response');
        }
    }

    renderVariations() {
        const container = document.getElementById('variations-container');
        const list = document.getElementById('variations-list');
        
        if (this.currentVariations.length === 0) {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        list.innerHTML = this.currentVariations.map((v, idx) => `
            <div style="display: flex; align-items: center; gap: 10px; padding: 12px; background: white; border: 2px solid #e0e0e0; border-radius: 8px;">
                <span style="flex: 1; font-size: 15px; color: #2c3e50; font-weight: 500;">${this.escapeHtml(v)}</span>
                <button type="button" onclick="instantResponseCategoriesManager.editVariation(${idx})" 
                        style="padding: 6px 12px; border: none; background: #3498db; border-radius: 6px; color: white; cursor: pointer; font-size: 13px;">
                    ✏️ Edit
                </button>
                <button type="button" onclick="instantResponseCategoriesManager.removeVariation(${idx})" 
                        style="padding: 6px 12px; border: none; background: #e74c3c; border-radius: 6px; color: white; cursor: pointer; font-size: 13px;">
                    ❌ Remove
                </button>
            </div>
        `).join('');
    }

    addVariation() {
        const newVariation = prompt('Enter a new variation:');
        if (newVariation && newVariation.trim()) {
            this.currentVariations.push(newVariation.trim());
            this.renderVariations();
        }
    }

    editVariation(index) {
        const current = this.currentVariations[index];
        const updated = prompt('Edit variation:', current);
        if (updated && updated.trim()) {
            this.currentVariations[index] = updated.trim();
            this.renderVariations();
        }
    }

    removeVariation(index) {
        this.currentVariations.splice(index, 1);
        this.renderVariations();
    }

    toggleAdvanced() {
        const content = document.getElementById('advanced-content');
        const icon = document.getElementById('advanced-toggle-icon');
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.className = 'fas fa-chevron-up';
        } else {
            content.style.display = 'none';
            icon.className = 'fas fa-chevron-down';
        }
    }

    async saveQnAModal() {
        const mainTrigger = document.getElementById('qna-main-trigger').value.trim();
        const responseText = document.getElementById('qna-response').value.trim();
        
        if (!mainTrigger || !responseText) {
            this.showError('Main trigger and response are required');
            return;
        }
        
        // Build triggers array
        const triggers = this.currentVariations.length > 0 
            ? this.currentVariations 
            : [mainTrigger];
        
        // Parse responses - check if it's formatted with [Variation 1], [Variation 2], etc.
        let responses = [];
        if (responseText.includes('[Variation 1]')) {
            // AI-generated format with multiple variations
            responses = responseText
                .split(/---+/)
                .map(section => {
                    // Remove [Variation X] header and trim
                    return section.replace(/\[Variation \d+\]/g, '').trim();
                })
                .filter(r => r.length > 0);
        } else {
            // Single response - wrap in array
            responses = [responseText];
        }
        
        console.log(`💾 Saving Q&A with ${responses.length} response variations`);
        
        // Build Q&A data
        const qnaData = {
            triggers,
            responses, // ARRAY of responses (1-10 variations)
            rotationMode: 'random', // Default to random rotation
            enabled: document.getElementById('qna-enabled').value === 'true',
            priority: parseInt(document.getElementById('qna-priority').value),
            notes: document.getElementById('qna-notes').value.trim(),
            contextAware: document.getElementById('qna-context-aware').checked
        };
        
        // Add timing if enabled
        if (document.getElementById('qna-timing-enabled').checked) {
            qnaData.timing = {
                enabled: true,
                waitSeconds: parseInt(document.getElementById('qna-wait-seconds').value),
                followUpMessage: document.getElementById('qna-followup-message').value.trim()
            };
            
            if (document.getElementById('qna-second-followup').checked) {
                qnaData.timing.secondFollowUp = {
                    enabled: true,
                    waitSeconds: parseInt(document.getElementById('qna-second-wait').value),
                    message: document.getElementById('qna-second-message').value.trim()
                };
            }
        }
        
        try {
            if (this.currentQnA) {
                // Update existing
                await this.updateQnA(this.currentCategory._id, this.currentQnA.id, qnaData);
            } else {
                // Create new
                await this.addQnA(this.currentCategory._id, qnaData);
            }
            
            this.closeQnAModal();
        } catch (error) {
            // Error already shown in API call
        }
    }

    async handleDeleteQnA(categoryId, qnaId) {
        if (!confirm('Are you sure you want to delete this Q&A?')) {
            return;
        }

        await this.deleteQnA(categoryId, qnaId);
    }

    async handleGenerateQnAs(categoryId) {
        if (!confirm('Generate 10 AI-suggested Q&As based on this category? This may take a few seconds.')) {
            return;
        }
        
        try {
            const suggestions = await this.generateQnAs(categoryId);
            this.showSuccess(`Generated ${suggestions.length} Q&A suggestions! Review and save the ones you like.`);
            
            // TODO: Display suggestions in a preview modal
            console.log('Generated suggestions:', suggestions);
        } catch (error) {
            this.showError('Failed to generate Q&As');
        }
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeJson(obj) {
        return JSON.stringify(obj).replace(/"/g, '&quot;');
    }

    showSuccess(message) {
        console.log(`✅ ${message}`);
        // TODO: Integrate with existing notification system
        alert(message);
    }

    showError(message) {
        console.error(`❌ ${message}`);
        alert(`Error: ${message}`);
    }

    showInfo(message) {
        console.log(`ℹ️ ${message}`);
        alert(message);
    }

    // ========================================================================
    // AI RESPONSE SUGGESTION (MULTI-VARIATION)
    // ========================================================================

    /**
     * Call backend to suggest MULTIPLE response variations
     */
    async suggestAIResponses(categoryName, categoryDescription, mainTrigger, variations) {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/instant-response-categories/suggest-response`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify({
                    categoryName,
                    categoryDescription,
                    mainTrigger,
                    variations
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            return result.data?.responses || []; // Returns array of responses
        } catch (error) {
            console.error('Error generating AI response variations:', error);
            this.showError('Failed to generate AI response suggestions');
            return [];
        }
    }

    /**
     * Handle AI Suggest Response button click
     * Generates 3 response variations and populates the textarea
     */
    async suggestAIResponseForModal() {
        const mainTrigger = document.getElementById('qna-main-trigger').value.trim();
        
        if (!mainTrigger) {
            this.showError('Please enter a main trigger phrase first');
            return;
        }
        
        try {
            const category = this.categories.find(c => c._id === this.currentCategoryId);
            const categoryName = category?.name || '';
            const categoryDescription = category?.description || '';
            
            console.log('✨ Generating AI response suggestions (3 variations)...');
            this.showInfo('AI is generating 3 response variations... Please wait.');
            
            const suggestedResponses = await this.suggestAIResponses(
                categoryName,
                categoryDescription,
                mainTrigger,
                this.currentVariations || [mainTrigger]
            );
            
            if (suggestedResponses && suggestedResponses.length > 0) {
                // Join all 3 responses with separator for user to see all options
                const formattedResponses = suggestedResponses
                    .map((r, i) => `[Variation ${i + 1}]\n${r}`)
                    .join('\n\n---\n\n');
                
                document.getElementById('qna-response').value = formattedResponses;
                
                this.showSuccess(`Generated ${suggestedResponses.length} response variations! Review and edit as needed.`);
                
                console.log('✅ AI suggestions populated into textarea');
                console.log('📝 Variations:', suggestedResponses);
            } else {
                this.showError('AI did not return any response suggestions. Please try again.');
            }
        } catch (error) {
            console.error('Error suggesting AI responses:', error);
            this.showError('Failed to generate AI response variations');
        }
    }
}

// Export for use in company profile
window.InstantResponseCategoriesManager = InstantResponseCategoriesManager;

