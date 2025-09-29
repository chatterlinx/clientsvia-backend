/**
 * Company Q&A Manager - Frontend Component
 * V2-grade CRUD interface for Company Knowledge Base
 * Integrates with Knowledge Sources Priority tab
 * 
 * 🤖 AI AGENT ROUTING REFERENCE - FRONTEND CONTROL:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ FRONTEND FOR PRIORITY #1 KNOWLEDGE SOURCE MANAGEMENT            ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Data Flow: This UI → API Routes → Services → Database           ║
 * ║ ├─ CRUD Operations: /api/knowledge/company/:companyId/qnas      ║
 * ║ ├─ AI Agent Test: /api/ai-agent/company-knowledge/:companyId    ║
 * ║ ├─ Priority Flow Test: /api/ai-agent/test-priority-flow/:id     ║
 * ║ └─ Real-time Results: Displays confidence scores + routing      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * 🔧 TROUBLESHOOTING UI FEATURES:
 * • "Test with AI Agent" buttons → Live knowledge lookup testing
 * • "Test Priority Flow" → Full routing simulation with all sources
 * • Confidence scores displayed → Shows AI routing decision logic
 * • Search functionality → Tests semantic matching algorithms
 * • Performance metrics → Response times for optimization
 * 
 * 🚨 CRITICAL UI INTEGRATION POINTS:
 * - testWithAIAgent() method tests live routing (line ~600+)
 * - testPriorityFlow() simulates full routing cascade
 * - loadQnAs() method populates management interface
 * - Modal forms handle CRUD with auto-keyword generation
 * - Real-time validation ensures production-ready entries
 */

class CompanyQnAManager {
    constructor(containerId, apiClient) {
        this.container = document.getElementById(containerId);
        this.apiClient = apiClient;
        this.currentCompanyId = null;
        this.qnas = [];
        this.pagination = {
            current: 1,
            pages: 1,
            total: 0,
            limit: 20
        };
        this.filters = {
            search: '',
            category: '',
            status: 'active'
        };
        
        this.init();
    }

    /**
     * 🚀 INITIALIZE COMPONENT
     */
    init() {
        this.render();
        this.attachEventListeners();
        console.log('✅ CompanyQnAManager initialized');
    }

    /**
     * � SET COMPANY ID
     */
    setCompanyId(companyId) {
        this.currentCompanyId = companyId;
        console.log(`📋 Company ID set to: ${companyId}`);
        
        // Load data if we have a company ID
        if (companyId) {
            this.loadQnAs();
        }
    }

    /**
     * �🎨 RENDER MAIN INTERFACE
     */
    render() {
        this.container.innerHTML = `
            <div class="company-qna-manager">
                <!-- Header with Actions -->
                <div class="qna-header">
                    <div class="qna-title">
                        <h3>📚 Company Knowledge Base</h3>
                        <p class="qna-subtitle">Manage company-specific Q&A entries that power your AI agent</p>
                    </div>
                    <div class="qna-actions">
                        <button id="addQnABtn" class="btn btn-primary">
                            <i class="fas fa-plus"></i> Add Q&A
                        </button>
                        <button id="testPriorityFlowBtn" class="btn btn-info">
                            <i class="fas fa-vial"></i> Test Priority Flow
                        </button>
                        <button id="importQnABtn" class="btn btn-secondary">
                            <i class="fas fa-upload"></i> Import
                        </button>
                        <button id="exportQnABtn" class="btn btn-secondary">
                            <i class="fas fa-download"></i> Export
                        </button>
                    </div>
                </div>

                <!-- Search and Filters -->
                <div class="qna-filters">
                    <div class="filter-row">
                        <div class="search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="searchInput" placeholder="Search questions, answers, or keywords..." 
                                   value="${this.filters.search}">
                        </div>
                        <select id="categoryFilter" class="filter-select">
                            <option value="">All Categories</option>
                            <option value="general" ${this.filters.category === 'general' ? 'selected' : ''}>General</option>
                            <option value="pricing" ${this.filters.category === 'pricing' ? 'selected' : ''}>Pricing</option>
                            <option value="services" ${this.filters.category === 'services' ? 'selected' : ''}>Services</option>
                            <option value="technical" ${this.filters.category === 'technical' ? 'selected' : ''}>Technical</option>
                            <option value="emergency" ${this.filters.category === 'emergency' ? 'selected' : ''}>Emergency</option>
                            <option value="scheduling" ${this.filters.category === 'scheduling' ? 'selected' : ''}>Scheduling</option>
                            <option value="warranty" ${this.filters.category === 'warranty' ? 'selected' : ''}>Warranty</option>
                            <option value="policies" ${this.filters.category === 'policies' ? 'selected' : ''}>Policies</option>
                        </select>
                        <select id="statusFilter" class="filter-select">
                            <option value="active" ${this.filters.status === 'active' ? 'selected' : ''}>Active</option>
                            <option value="draft" ${this.filters.status === 'draft' ? 'selected' : ''}>Draft</option>
                            <option value="archived" ${this.filters.status === 'archived' ? 'selected' : ''}>Archived</option>
                        </select>
                        <button id="resetFiltersBtn" class="btn btn-light">
                            <i class="fas fa-times"></i> Reset
                        </button>
                    </div>
                </div>

                <!-- Q&A List -->
                <div class="qna-list">
                    <div id="qnaTableContainer">
                        ${this.renderQnATable()}
                    </div>
                </div>

                <!-- Pagination -->
                <div class="qna-pagination">
                    ${this.renderPagination()}
                </div>

                <!-- Loading Overlay -->
                <div id="loadingOverlay" class="loading-overlay" style="display: none;">
                    <div class="loading-spinner">
                        <i class="fas fa-spinner fa-spin"></i>
                        <span class="loading-message">Loading...</span>
                    </div>
                </div>
            </div>

            <!-- Add/Edit Q&A Modal -->
            <div id="qnaModal" class="modal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 id="modalTitle">Add New Q&A</h4>
                        <button id="closeModal" class="close-btn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="qnaForm">
                            <div class="form-group">
                                <label for="questionInput">Question *</label>
                                <textarea id="questionInput" class="form-control" rows="3" 
                                         placeholder="Enter the question customers might ask..." required></textarea>
                                <small class="form-help">This will be automatically matched to customer queries</small>
                            </div>
                            
                            <div class="form-group">
                                <label for="answerInput">Answer *</label>
                                <textarea id="answerInput" class="form-control" rows="5" 
                                         placeholder="Enter the complete answer..." required></textarea>
                                <small class="form-help">This is what the AI agent will say to customers</small>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group col-md-6">
                                    <label for="categorySelect">Category</label>
                                    <select id="categorySelect" class="form-control">
                                        <option value="general">General</option>
                                        <option value="pricing">Pricing</option>
                                        <option value="services">Services</option>
                                        <option value="technical">Technical</option>
                                        <option value="emergency">Emergency</option>
                                        <option value="scheduling">Scheduling</option>
                                        <option value="warranty">Warranty</option>
                                        <option value="policies">Policies</option>
                                    </select>
                                </div>
                                
                                <div class="form-group col-md-6">
                                    <label for="prioritySelect">Priority</label>
                                    <select id="prioritySelect" class="form-control">
                                        <option value="normal">Normal</option>
                                        <option value="high">High</option>
                                        <option value="critical">Critical</option>
                                        <option value="low">Low</option>
                                    </select>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="customKeywords">Custom Keywords (Optional)</label>
                                <input type="text" id="customKeywords" class="form-control" 
                                       placeholder="additional, keywords, separated, by, commas">
                                <small class="form-help">Keywords are auto-generated, but you can add custom ones</small>
                            </div>
                            
                            <div class="form-group">
                                <label for="statusSelect">Status</label>
                                <select id="statusSelect" class="form-control">
                                    <option value="active">Active</option>
                                    <option value="draft">Draft</option>
                                </select>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" id="cancelBtn" class="btn btn-secondary">Cancel</button>
                        <button type="submit" id="saveQnABtn" class="btn btn-primary">
                            <i class="fas fa-save"></i> Save Q&A
                        </button>
                    </div>
                </div>
            </div>

            <!-- Delete Confirmation Modal -->
            <div id="deleteModal" class="modal" style="display: none;">
                <div class="modal-content modal-sm">
                    <div class="modal-header">
                        <h4>Confirm Delete</h4>
                        <button id="closeDeleteModal" class="close-btn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p>Are you sure you want to delete this Q&A entry?</p>
                        <p class="text-muted">This action cannot be undone.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" id="cancelDeleteBtn" class="btn btn-secondary">Cancel</button>
                        <button type="button" id="confirmDeleteBtn" class="btn btn-danger">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            </div>

            <!-- Test Priority Flow Modal -->
            <div id="testPriorityFlowModal" class="modal" style="display: none;">
                <div class="modal-content modal-lg">
                    <div class="modal-header">
                        <h4>🧪 Test AI Agent Priority Flow</h4>
                        <button id="closePriorityTestModal" class="close-btn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-4">
                            <label for="testQueryInput" class="form-label">Test Query</label>
                            <input type="text" id="testQueryInput" class="form-input" 
                                   placeholder="Enter a question to test how the AI agent would respond..." 
                                   value="">
                        </div>
                        
                        <div class="mb-4">
                            <label class="form-check-label">
                                <input type="checkbox" id="includeAllSourcesCheck" class="form-checkbox">
                                Test all sources (don't stop at first confident match)
                            </label>
                        </div>
                        
                        <div id="priorityTestResults" class="priority-test-results" style="display: none;">
                            <!-- Results will be populated here -->
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" id="cancelPriorityTestBtn" class="btn btn-secondary">Close</button>
                        <button type="button" id="runPriorityTestBtn" class="btn btn-primary">
                            <i class="fas fa-vial"></i> Run Test
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 📊 RENDER Q&A TABLE
     */
    renderQnATable() {
        if (this.qnas.length === 0) {
            return `
                <div class="empty-state">
                    <i class="fas fa-question-circle fa-3x"></i>
                    <h4>No Q&A entries found</h4>
                    <p>Start building your knowledge base by adding Q&A entries.</p>
                    <button class="btn btn-primary" onclick="companyQnAManager.showAddModal()">
                        <i class="fas fa-plus"></i> Add First Q&A
                    </button>
                </div>
            `;
        }

        return `
            <table class="qna-table">
                <thead>
                    <tr>
                        <th>Question</th>
                        <th>Category</th>
                        <th>Keywords</th>
                        <th>Confidence</th>
                        <th>Usage</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.qnas.map(qna => this.renderQnARow(qna)).join('')}
                </tbody>
            </table>
        `;
    }

    /**
     * 📝 RENDER INDIVIDUAL Q&A ROW
     */
    renderQnARow(qna) {
        const statusBadge = this.getStatusBadge(qna.status);
        const priorityBadge = this.getPriorityBadge(qna.priority);
        const confidenceBadge = this.getConfidenceBadge(qna.confidence);
        
        return `
            <tr data-qna-id="${qna._id}">
                <td class="question-cell">
                    <div class="question-preview">
                        <strong>${this.truncateText(qna.question, 60)}</strong>
                        ${priorityBadge}
                    </div>
                    <div class="answer-preview">
                        ${this.truncateText(qna.answer, 80)}
                    </div>
                    <div class="qna-meta">
                        <small class="text-muted">
                            Updated: ${this.formatDate(qna.updatedAt)}
                        </small>
                    </div>
                </td>
                <td>
                    <span class="category-badge category-${qna.category}">
                        ${this.capitalizeFirst(qna.category)}
                    </span>
                </td>
                <td class="keywords-cell">
                    <div class="keywords-container">
                        ${qna.keywords.slice(0, 3).map(keyword => 
                            `<span class="keyword-tag">${keyword}</span>`
                        ).join('')}
                        ${qna.keywords.length > 3 ? 
                            `<span class="keyword-more">+${qna.keywords.length - 3}</span>` : ''}
                    </div>
                </td>
                <td>
                    ${confidenceBadge}
                </td>
                <td class="usage-cell">
                    <div class="usage-stats">
                        <span class="usage-count">${qna.usageCount || 0}</span>
                        <small class="text-muted">uses</small>
                    </div>
                    ${qna.lastUsed ? `
                        <div class="last-used">
                            <small class="text-muted">Last: ${this.formatDate(qna.lastUsed)}</small>
                        </div>
                    ` : ''}
                </td>
                <td>
                    ${statusBadge}
                </td>
                <td class="actions-cell">
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-light" onclick="companyQnAManager.editQnA('${qna._id}')" 
                                title="Edit Q&A">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-light" onclick="companyQnAManager.testQnA('${qna._id}')" 
                                title="Test with AI Agent">
                            <i class="fas fa-robot"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="companyQnAManager.deleteQnA('${qna._id}')" 
                                title="Delete Q&A">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * 📄 RENDER PAGINATION
     */
    renderPagination() {
        if (this.pagination.pages <= 1) return '';

        let paginationHTML = `
            <div class="pagination-info">
                Showing ${(this.pagination.current - 1) * this.pagination.limit + 1} - 
                ${Math.min(this.pagination.current * this.pagination.limit, this.pagination.total)} 
                of ${this.pagination.total} entries
            </div>
            <div class="pagination-controls">
        `;

        // Previous button
        if (this.pagination.current > 1) {
            paginationHTML += `
                <button class="btn btn-sm btn-light" onclick="companyQnAManager.goToPage(${this.pagination.current - 1})">
                    <i class="fas fa-chevron-left"></i> Previous
                </button>
            `;
        }

        // Page numbers
        const startPage = Math.max(1, this.pagination.current - 2);
        const endPage = Math.min(this.pagination.pages, this.pagination.current + 2);

        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === this.pagination.current ? 'active' : '';
            paginationHTML += `
                <button class="btn btn-sm btn-light ${isActive}" onclick="companyQnAManager.goToPage(${i})">
                    ${i}
                </button>
            `;
        }

        // Next button
        if (this.pagination.current < this.pagination.pages) {
            paginationHTML += `
                <button class="btn btn-sm btn-light" onclick="companyQnAManager.goToPage(${this.pagination.current + 1})">
                    Next <i class="fas fa-chevron-right"></i>
                </button>
            `;
        }

        paginationHTML += '</div>';
        return paginationHTML;
    }

    /**
     * 🎧 ATTACH EVENT LISTENERS
     */
    attachEventListeners() {
        // Search and filters
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this.debounceSearch();
        });

        document.getElementById('categoryFilter').addEventListener('change', (e) => {
            this.filters.category = e.target.value;
            this.pagination.current = 1;
            this.loadQnAs();
        });

        document.getElementById('statusFilter').addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this.pagination.current = 1;
            this.loadQnAs();
        });

        document.getElementById('resetFiltersBtn').addEventListener('click', () => {
            this.resetFilters();
        });

        // Action buttons
        document.getElementById('addQnABtn').addEventListener('click', () => {
            this.showAddModal();
        });

        document.getElementById('importQnABtn').addEventListener('click', () => {
            this.showImportModal();
        });

        document.getElementById('exportQnABtn').addEventListener('click', () => {
            this.exportQnAs();
        });

        document.getElementById('testPriorityFlowBtn').addEventListener('click', () => {
            this.showTestPriorityFlowModal();
        });

        // Modal events
        document.getElementById('closeModal').addEventListener('click', () => {
            this.hideModal();
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            this.hideModal();
        });

        document.getElementById('saveQnABtn').addEventListener('click', () => {
            this.saveQnA();
        });

        // Delete modal events
        document.getElementById('closeDeleteModal').addEventListener('click', () => {
            this.hideDeleteModal();
        });

        document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
            this.hideDeleteModal();
        });

        document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
            this.confirmDelete();
        });

        // Priority flow test modal events
        document.getElementById('closePriorityTestModal').addEventListener('click', () => {
            this.hidePriorityTestModal();
        });

        document.getElementById('cancelPriorityTestBtn').addEventListener('click', () => {
            this.hidePriorityTestModal();
        });

        document.getElementById('runPriorityTestBtn').addEventListener('click', () => {
            this.runPriorityFlowTest();
        });
    }

    /**
     * 📚 LOAD Q&AS FROM API
     */
    async loadQnAs() {
        if (!this.currentCompanyId) return;

        this.showLoading();

        try {
            const params = new URLSearchParams({
                page: this.pagination.current,
                limit: this.pagination.limit,
                status: this.filters.status
            });

            if (this.filters.search) params.append('search', this.filters.search);
            if (this.filters.category) params.append('category', this.filters.category);

            const response = await fetch(`/api/knowledge/company/${this.currentCompanyId}/qnas?${params}`);
            const result = await response.json();

            if (result.success) {
                this.qnas = result.data;
                this.pagination = result.pagination;
                this.updateTable();
            } else {
                this.showError('Failed to load Q&As: ' + result.error);
            }

        } catch (error) {
            console.error('Failed to load Q&As:', error);
            this.showError('Failed to load Q&As: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 💾 SAVE Q&A (CREATE OR UPDATE)
     */
    async saveQnA() {
        const form = document.getElementById('qnaForm');
        const formData = new FormData(form);
        
        const qnaData = {
            question: document.getElementById('questionInput').value.trim(),
            answer: document.getElementById('answerInput').value.trim(),
            category: document.getElementById('categorySelect').value,
            priority: document.getElementById('prioritySelect').value,
            status: document.getElementById('statusSelect').value
        };

        // Add custom keywords if provided
        const customKeywords = document.getElementById('customKeywords').value.trim();
        if (customKeywords) {
            qnaData.customKeywords = customKeywords.split(',').map(k => k.trim()).filter(k => k);
        }

        // Validate required fields
        if (!qnaData.question || !qnaData.answer) {
            this.showError('Question and answer are required');
            return;
        }

        this.showLoading();

        try {
            const isEdit = this.currentEditId !== null;
            const url = isEdit 
                ? `/api/knowledge/company/${this.currentCompanyId}/qnas/${this.currentEditId}`
                : `/api/knowledge/company/${this.currentCompanyId}/qnas`;
            
            const method = isEdit ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(qnaData)
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccess(isEdit ? 'Q&A updated successfully' : 'Q&A created successfully');
                this.hideModal();
                this.loadQnAs();
                
                // Show analytics about generated keywords
                if (result.analytics && result.analytics.keywordsGenerated > 0) {
                    this.showInfo(`${result.analytics.keywordsGenerated} keywords automatically generated for better AI matching`);
                }
            } else {
                this.showError('Failed to save Q&A: ' + result.error);
            }

        } catch (error) {
            console.error('Failed to save Q&A:', error);
            this.showError('Failed to save Q&A: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * ✏️ EDIT Q&A
     */
    editQnA(qnaId) {
        const qna = this.qnas.find(q => q._id === qnaId);
        if (!qna) return;

        this.currentEditId = qnaId;
        
        // Populate form
        document.getElementById('modalTitle').textContent = 'Edit Q&A';
        document.getElementById('questionInput').value = qna.question;
        document.getElementById('answerInput').value = qna.answer;
        document.getElementById('categorySelect').value = qna.category;
        document.getElementById('prioritySelect').value = qna.priority;
        document.getElementById('statusSelect').value = qna.status;
        
        // Populate custom keywords
        const customKeywords = qna.keywordCategories?.custom || [];
        document.getElementById('customKeywords').value = customKeywords.join(', ');

        this.showModal();
    }

    /**
     * 🗑️ DELETE Q&A
     */
    deleteQnA(qnaId) {
        this.currentDeleteId = qnaId;
        this.showDeleteModal();
    }

    /**
     * ✅ CONFIRM DELETE
     */
    async confirmDelete() {
        if (!this.currentDeleteId) return;

        this.showLoading();

        try {
            const response = await fetch(`/api/knowledge/company/${this.currentCompanyId}/qnas/${this.currentDeleteId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccess('Q&A deleted successfully');
                this.hideDeleteModal();
                this.loadQnAs();
            } else {
                this.showError('Failed to delete Q&A: ' + result.error);
            }

        } catch (error) {
            console.error('Failed to delete Q&A:', error);
            this.showError('Failed to delete Q&A: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 🤖 TEST Q&A WITH AI AGENT
     */
    async testQnA(qnaId) {
        const qna = this.qnas.find(q => q._id === qnaId);
        if (!qna) return;

        this.showLoading('Testing with AI Agent...');

        try {
            // Test with the actual AI agent endpoint that handles priority routing
            const response = await this.apiClient.post(`/api/ai-agent/company-knowledge/${this.currentCompanyId}`, {
                query: qna.question,
                confidence: 0.5, // Lower threshold for testing
                maxResults: 3
            });

            if (response.success && response.answers && response.answers.length > 0) {
                const match = response.answers[0];
                const confidence = Math.round(match.confidence * 100);
                const responseTime = response.responseTime || 'N/A';
                
                // Check if it found the exact Q&A we're testing
                const exactMatch = response.answers.find(answer => answer.id === qnaId);
                
                if (exactMatch) {
                    this.showSuccess(`✅ AI Agent Test: Found exact match with ${confidence}% confidence (${responseTime}ms)`);
                } else {
                    this.showWarning(`⚠️ AI Agent Test: Found different answer with ${confidence}% confidence. Consider improving keywords or question phrasing.`);
                }
                
                // Show the answer that was found for comparison
                console.log('🤖 AI Agent Response:', {
                    query: qna.question,
                    foundAnswer: match.answer,
                    expectedAnswer: qna.answer,
                    confidence: match.confidence,
                    keywords: match.keywords
                });
                
            } else {
                this.showWarning('⚠️ AI Agent Test: No answer found. The AI agent could not find a suitable response using the priority flow.');
            }

        } catch (error) {
            console.error('Failed to test Q&A with AI Agent:', error);
            this.showError('Failed to test Q&A with AI Agent: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 🎯 PUBLIC METHODS FOR INTEGRATION
     */
    
    setCompanyId(companyId) {
        this.currentCompanyId = companyId;
        this.pagination.current = 1;
        this.loadQnAs();
    }

    refresh() {
        this.loadQnAs();
    }

    // Additional utility methods...
    showAddModal() {
        this.currentEditId = null;
        document.getElementById('modalTitle').textContent = 'Add New Q&A';
        document.getElementById('qnaForm').reset();
        document.getElementById('statusSelect').value = 'active';
        this.showModal();
    }

    showModal() {
        document.getElementById('qnaModal').style.display = 'block';
    }

    hideModal() {
        document.getElementById('qnaModal').style.display = 'none';
    }

    showDeleteModal() {
        document.getElementById('deleteModal').style.display = 'block';
    }

    hideDeleteModal() {
        document.getElementById('deleteModal').style.display = 'none';
        this.currentDeleteId = null;
    }

    showTestPriorityFlowModal() {
        document.getElementById('testPriorityFlowModal').style.display = 'block';
        // Clear previous results
        document.getElementById('priorityTestResults').style.display = 'none';
        document.getElementById('testQueryInput').value = '';
        document.getElementById('includeAllSourcesCheck').checked = false;
    }

    hidePriorityTestModal() {
        document.getElementById('testPriorityFlowModal').style.display = 'none';
    }

    async runPriorityFlowTest() {
        const query = document.getElementById('testQueryInput').value.trim();
        const includeAllSources = document.getElementById('includeAllSourcesCheck').checked;

        if (!query) {
            this.showError('Please enter a test query');
            return;
        }

        if (!this.currentCompanyId) {
            this.showError('No company ID available');
            return;
        }

        this.showLoading('Testing Priority Flow...');

        try {
            const response = await this.apiClient.post(`/api/ai-agent/test-priority-flow/${this.currentCompanyId}`, {
                query,
                includeAllSources
            });

            if (response.success) {
                this.displayPriorityTestResults(response);
            } else {
                this.showError('Priority flow test failed: ' + response.error);
            }

        } catch (error) {
            console.error('Failed to run priority flow test:', error);
            this.showError('Failed to run priority flow test: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    displayPriorityTestResults(results) {
        const resultsContainer = document.getElementById('priorityTestResults');
        
        let html = `
            <div class="priority-test-summary">
                <h5>🧪 Priority Flow Test Results</h5>
                <div class="test-meta">
                    <span class="badge badge-info">Query: "${results.query}"</span>
                    <span class="badge badge-secondary">${results.sourcesTestedCount} sources tested</span>
                    <span class="badge badge-light">${results.totalResponseTime}ms total</span>
                </div>
                <div class="test-recommendation ${results.finalAnswer ? 'success' : 'warning'}">
                    ${results.recommendation}
                </div>
            </div>

            <div class="priority-flow-results">
        `;

        // Display results for each source
        results.priorityFlow.forEach((source, index) => {
            const statusClass = source.passed ? 'success' : (source.found ? 'warning' : 'neutral');
            const statusIcon = source.passed ? 'check-circle' : (source.found ? 'exclamation-triangle' : 'minus-circle');
            
            html += `
                <div class="source-result ${statusClass}">
                    <div class="source-header">
                        <div class="source-info">
                            <span class="priority-badge">${source.priority}</span>
                            <strong>${source.sourceName}</strong>
                            <i class="fas fa-${statusIcon} status-icon"></i>
                        </div>
                        <div class="source-metrics">
                            <span class="confidence">Confidence: ${Math.round(source.confidence * 100)}%</span>
                            <span class="response-time">${source.responseTime}ms</span>
                        </div>
                    </div>
            `;

            if (source.answers && source.answers.length > 0) {
                html += `
                    <div class="source-answers">
                        ${source.answers.map(answer => `
                            <div class="answer-preview">
                                <div class="answer-question">${answer.question}</div>
                                <div class="answer-text">${answer.answer}</div>
                                <div class="answer-meta">
                                    <span class="answer-confidence">${Math.round(answer.confidence * 100)}% confidence</span>
                                    ${answer.keywords ? `<span class="answer-keywords">${answer.keywords.join(', ')}</span>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (source.message) {
                html += `<div class="source-message">${source.message}</div>`;
            } else if (source.error) {
                html += `<div class="source-error">Error: ${source.error}</div>`;
            }

            html += `</div>`;
        });

        html += `
            </div>
            
            <div class="test-metadata">
                <h6>Test Metadata</h6>
                <div class="metadata-grid">
                    <div>Timestamp: ${new Date(results.metadata.timestamp).toLocaleString()}</div>
                    <div>Company ID: ${results.metadata.companyId}</div>
                    <div>Total Sources: ${results.metadata.totalSources}</div>
                    <div>Active Sources: ${results.metadata.activeSources}</div>
                    <div>Include All Sources: ${results.includeAllSources ? 'Yes' : 'No'}</div>
                </div>
            </div>
        `;

        resultsContainer.innerHTML = html;
        resultsContainer.style.display = 'block';
    }

    showLoading(message = 'Loading...') {
        const overlay = document.getElementById('loadingOverlay');
        const messageElement = overlay.querySelector('.loading-message');
        if (messageElement) {
            messageElement.textContent = message;
        }
        overlay.style.display = 'flex';
    }

    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }

    updateTable() {
        document.getElementById('qnaTableContainer').innerHTML = this.renderQnATable();
        document.querySelector('.qna-pagination').innerHTML = this.renderPagination();
    }

    goToPage(page) {
        this.pagination.current = page;
        this.loadQnAs();
    }

    resetFilters() {
        this.filters = { search: '', category: '', status: 'active' };
        document.getElementById('searchInput').value = '';
        document.getElementById('categoryFilter').value = '';
        document.getElementById('statusFilter').value = 'active';
        this.pagination.current = 1;
        this.loadQnAs();
    }

    debounceSearch() {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.pagination.current = 1;
            this.loadQnAs();
        }, 500);
    }

    // Utility methods for rendering
    getStatusBadge(status) {
        const badges = {
            active: '<span class="badge badge-success">Active</span>',
            draft: '<span class="badge badge-warning">Draft</span>',
            archived: '<span class="badge badge-secondary">Archived</span>'
        };
        return badges[status] || badges.active;
    }

    getPriorityBadge(priority) {
        const badges = {
            critical: '<span class="priority-badge priority-critical">Critical</span>',
            high: '<span class="priority-badge priority-high">High</span>',
            normal: '',
            low: '<span class="priority-badge priority-low">Low</span>'
        };
        return badges[priority] || '';
    }

    getConfidenceBadge(confidence) {
        const score = Math.round(confidence * 100);
        const className = score >= 90 ? 'success' : score >= 70 ? 'warning' : 'danger';
        return `<span class="confidence-badge confidence-${className}">${score}%</span>`;
    }

    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    // Notification methods
    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showWarning(message) {
        this.showNotification(message, 'warning');
    }

    showInfo(message) {
        this.showNotification(message, 'info');
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
                <button class="notification-close">&times;</button>
            </div>
        `;

        // Add to page
        document.body.appendChild(notification);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);

        // Manual close
        notification.querySelector('.notification-close').addEventListener('click', () => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        });
    }

    getNotificationIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }
}

// Export for use in other modules
window.CompanyQnAManager = CompanyQnAManager;
