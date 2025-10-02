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
    }

    openCategoryModal(category = null) {
        this.currentCategory = category;
        
        const modal = document.getElementById('category-modal');
        const title = document.getElementById('category-modal-title');
        
        if (category) {
            title.textContent = 'Edit Category';
            document.getElementById('category-name').value = category.name || '';
            document.getElementById('category-description').value = category.description || '';
            document.getElementById('category-icon').value = category.icon || '⚡';
            document.getElementById('category-color').value = category.color || '#4F46E5';
        } else {
            title.textContent = 'Add Category';
            document.getElementById('category-name').value = '';
            document.getElementById('category-description').value = '';
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
            name: document.getElementById('category-name').value.trim(),
            description: document.getElementById('category-description').value.trim(),
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
                        <p style="color: #495057; font-size: 14px; margin: 0; line-height: 1.5;">
                            → ${this.escapeHtml(qna.response)}
                        </p>
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
    // Q&A MODAL HANDLERS (Stub for Phase 2)
    // ========================================================================

    openAddQnAModal(categoryId) {
        this.showInfo('Q&A modal coming in Phase 2! 🚀');
        console.log(`Opening Add Q&A modal for category: ${categoryId}`);
    }

    openEditQnAModal(categoryId, qnaId) {
        this.showInfo('Q&A editing coming in Phase 2! 🚀');
        console.log(`Opening Edit Q&A modal for category: ${categoryId}, Q&A: ${qnaId}`);
    }

    async handleDeleteQnA(categoryId, qnaId) {
        if (!confirm('Are you sure you want to delete this Q&A?')) {
            return;
        }

        await this.deleteQnA(categoryId, qnaId);
    }

    async handleGenerateQnAs(categoryId) {
        this.showInfo('AI generation coming in Phase 2! 🚀');
        console.log(`Generating Q&As for category: ${categoryId}`);
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
}

// Export for use in company profile
window.InstantResponseCategoriesManager = InstantResponseCategoriesManager;

