/**
 * Instant Responses Manager - Frontend Component
 * Priority 0 CRUD interface for ultra-fast instant responses
 * Part of the 5-tier priority knowledge system
 * 
 * 🚀 PRIORITY 0 - INSTANT RESPONSES SYSTEM:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ FASTEST RESPONSE TIER - SUB-5MS TARGET PERFORMANCE              ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Data Flow: This UI → API Routes → Matcher → Response            ║
 * ║ ├─ CRUD Operations: /api/company/:id/instant-responses       ║
 * ║ ├─ Template Library: /api/company/:id/instant-responses/templates ║
 * ║ ├─ AI Suggestions: /api/company/:id/instant-responses/suggest-variations ║
 * ║ ├─ Test Matching: /api/company/:id/instant-responses/test-match ║
 * ║ └─ Coverage Analysis: /api/company/:id/instant-responses/analyze-coverage ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * 🎯 KEY FEATURES:
 * • Full CRUD for instant responses
 * • Template library browser with one-click apply
 * • AI-assisted variation suggestions (in-house, no LLMs)
 * • Test matching functionality
 * • Coverage gap analysis
 * • Bulk import/export
 * • Company-to-company copy
 * 
 * 📊 PERFORMANCE METRICS:
 * • Match time displayed (target: < 5ms)
 * • Confidence scores shown
 * • Coverage percentage tracked
 * 
 * Last Updated: 2025-10-02
 */

class InstantResponsesManager {
    constructor(containerId, apiClient) {
        this.container = document.getElementById(containerId);
        this.apiClient = apiClient;
        this.currentCompanyId = null;
        this.responses = [];
        this.templates = [];
        this.stats = null;
        this.filters = {
            search: '',
            category: '',
            enabled: 'all'
        };
        
        this.init();
    }

    /**
     * 🚀 INITIALIZE COMPONENT
     */
    init() {
        this.render();
        this.attachEventListeners();
        console.log('✅ InstantResponsesManager initialized');
    }

    /**
     * 📋 SET COMPANY ID
     */
    setCompanyId(companyId) {
        this.currentCompanyId = companyId;
        console.log(`⚡ Instant Responses - Company ID set to: ${companyId}`);
        
        if (companyId) {
            this.loadResponses();
            this.loadStats();
        }
    }

    /**
     * 🎨 RENDER MAIN INTERFACE
     */
    render() {
        this.container.innerHTML = `
            <div class="instant-responses-manager">
                <!-- Header with Actions -->
                <div class="ir-header">
                    <div class="ir-title">
                        <h3>⚡ Instant Responses (Priority 0)</h3>
                        <p class="ir-subtitle">Ultra-fast sub-5ms responses using word-boundary matching</p>
                    </div>
                    <div class="ir-actions">
                        <button id="addResponseBtn" class="btn btn-primary">
                            <i class="fas fa-plus"></i> Add Response
                        </button>
                        <button id="browseTemplatesBtn" class="btn btn-success">
                            <i class="fas fa-book"></i> Browse Templates
                        </button>
                        <button id="testMatchBtn" class="btn btn-info">
                            <i class="fas fa-vial"></i> Test Matching
                        </button>
                        <button id="importBtn" class="btn btn-secondary">
                            <i class="fas fa-upload"></i> Import
                        </button>
                        <button id="exportBtn" class="btn btn-secondary">
                            <i class="fas fa-download"></i> Export
                        </button>
                    </div>
                </div>

                <!-- Statistics Dashboard -->
                <div id="statsContainer" class="ir-stats">
                    <div class="stat-card">
                        <div class="stat-icon">📊</div>
                        <div class="stat-content">
                            <div class="stat-value" id="statTotal">-</div>
                            <div class="stat-label">Total Responses</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">✅</div>
                        <div class="stat-content">
                            <div class="stat-value" id="statEnabled">-</div>
                            <div class="stat-label">Enabled</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">⚡</div>
                        <div class="stat-content">
                            <div class="stat-value" id="statMatcher">-</div>
                            <div class="stat-label">Confidence Threshold</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">📈</div>
                        <div class="stat-content">
                            <div class="stat-value" id="statPriority">-</div>
                            <div class="stat-label">Avg Priority</div>
                        </div>
                    </div>
                </div>

                <!-- Filters and Search -->
                <div class="ir-filters">
                    <div class="filter-group">
                        <input 
                            type="text" 
                            id="searchInput" 
                            class="form-control" 
                            placeholder="🔍 Search triggers or responses..."
                        >
                    </div>
                    <div class="filter-group">
                        <select id="categoryFilter" class="form-control">
                            <option value="">All Categories</option>
                            <optgroup label="Conversational (AI Personality)">
                                <option value="acknowledgment">Acknowledgments</option>
                                <option value="waiting">Customer Waiting</option>
                                <option value="consultation">Consultation/Checking</option>
                                <option value="appreciation">Thanks/Appreciation</option>
                                <option value="smalltalk">Small Talk</option>
                            </optgroup>
                            <optgroup label="Business Information">
                                <option value="hours">Hours</option>
                                <option value="location">Location</option>
                                <option value="pricing">Pricing</option>
                                <option value="services">Services</option>
                                <option value="contact">Contact</option>
                                <option value="booking">Booking</option>
                                <option value="emergency">Emergency</option>
                            </optgroup>
                            <option value="other">Other</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <select id="statusFilter" class="form-control">
                            <option value="all">All Status</option>
                            <option value="enabled">Enabled Only</option>
                            <option value="disabled">Disabled Only</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <button id="analyzeCoverageBtn" class="btn btn-outline">
                            <i class="fas fa-chart-bar"></i> Analyze Coverage
                        </button>
                    </div>
                </div>

                <!-- Responses List -->
                <div id="responsesContainer" class="ir-responses">
                    <div class="loading-state">
                        <i class="fas fa-spinner fa-spin"></i> Loading instant responses...
                    </div>
                </div>
            </div>

            <!-- Add/Edit Modal -->
            <div id="responseModal" class="modal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 id="modalTitle">Add Instant Response</h4>
                        <button class="modal-close" id="closeModal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="responseForm">
                            <input type="hidden" id="responseId">
                            
                            <div class="form-group">
                                <label for="trigger">Trigger <span class="required">*</span></label>
                                <input 
                                    type="text" 
                                    id="trigger" 
                                    class="form-control" 
                                    placeholder="e.g., what are your hours"
                                    required
                                    maxlength="200"
                                >
                                <small class="form-hint">The question or phrase that triggers this response</small>
                                <button type="button" id="suggestVariationsBtn" class="btn btn-sm btn-outline mt-2">
                                    <i class="fas fa-magic"></i> Suggest Variations
                                </button>
                            </div>

                            <div id="suggestedVariations" class="variations-container" style="display: none;">
                                <h5>Suggested Variations:</h5>
                                <div id="variationsList"></div>
                            </div>

                            <div class="form-group">
                                <label for="response">Response <span class="required">*</span></label>
                                <textarea 
                                    id="response" 
                                    class="form-control" 
                                    rows="4"
                                    placeholder="e.g., We are open Monday-Friday 9am-5pm"
                                    required
                                    maxlength="500"
                                ></textarea>
                                <small class="form-hint">The instant response to return (max 500 characters)</small>
                            </div>

                            <div class="form-row">
                                <div class="form-group">
                                    <label for="category">Category</label>
                                    <select id="category" class="form-control">
                                        <optgroup label="Conversational (AI Personality)">
                                            <option value="acknowledgment">Acknowledgments (okay, sure, yes)</option>
                                            <option value="waiting">Customer Waiting (hold on, one moment)</option>
                                            <option value="consultation">Consultation/Checking (ask wife, check with partner)</option>
                                            <option value="appreciation">Thanks/Appreciation (thank you)</option>
                                            <option value="smalltalk">Small Talk (how are you, weather)</option>
                                        </optgroup>
                                        <optgroup label="Business Information">
                                            <option value="hours">Hours</option>
                                            <option value="location">Location</option>
                                            <option value="pricing">Pricing</option>
                                            <option value="services">Services</option>
                                            <option value="contact">Contact</option>
                                            <option value="booking">Booking</option>
                                            <option value="emergency">Emergency</option>
                                        </optgroup>
                                        <option value="other">Other</option>
                                    </select>
                                </div>

                                <div class="form-group">
                                    <label for="priority">Priority</label>
                                    <input 
                                        type="number" 
                                        id="priority" 
                                        class="form-control" 
                                        min="0" 
                                        max="100" 
                                        value="50"
                                    >
                                    <small class="form-hint">0-100 (higher = more important)</small>
                                </div>

                                <div class="form-group">
                                    <label for="enabled">Status</label>
                                    <select id="enabled" class="form-control">
                                        <option value="true">Enabled</option>
                                        <option value="false">Disabled</option>
                                    </select>
                                </div>
                            </div>

                            <div class="form-group">
                                <label for="notes">Notes (Optional)</label>
                                <textarea 
                                    id="notes" 
                                    class="form-control" 
                                    rows="2"
                                    placeholder="Internal notes about this response"
                                ></textarea>
                            </div>

                            <div class="modal-actions">
                                <button type="button" class="btn btn-secondary" id="cancelBtn">Cancel</button>
                                <button type="submit" class="btn btn-primary" id="saveBtn">
                                    <i class="fas fa-save"></i> Save Response
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Template Library Modal -->
            <div id="templatesModal" class="modal" style="display: none;">
                <div class="modal-content modal-lg">
                    <div class="modal-header">
                        <h4>📚 Template Library</h4>
                        <button class="modal-close" id="closeTemplatesModal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="templates-filters">
                            <input 
                                type="text" 
                                id="templateSearch" 
                                class="form-control" 
                                placeholder="Search templates..."
                            >
                            <select id="templateCategory" class="form-control">
                                <option value="">All Categories</option>
                                <option value="general">General Business</option>
                                <option value="plumbing">Plumbing</option>
                                <option value="hvac">HVAC</option>
                                <option value="electrical">Electrical</option>
                                <option value="restaurant">Restaurant</option>
                                <option value="medical">Medical</option>
                                <option value="automotive">Automotive</option>
                                <option value="cleaning">Cleaning</option>
                            </select>
                        </div>
                        <div id="templatesContainer" class="templates-grid">
                            <div class="loading-state">
                                <i class="fas fa-spinner fa-spin"></i> Loading templates...
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Test Matching Modal -->
            <div id="testMatchModal" class="modal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4>🧪 Test Instant Response Matching</h4>
                        <button class="modal-close" id="closeTestModal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="testQuery">Test Query</label>
                            <input 
                                type="text" 
                                id="testQuery" 
                                class="form-control" 
                                placeholder="e.g., when are you open"
                            >
                        </div>
                        <button id="runTestBtn" class="btn btn-primary">
                            <i class="fas fa-play"></i> Run Test
                        </button>
                        <div id="testResults" class="test-results" style="display: none;"></div>
                    </div>
                </div>
            </div>

            <!-- Coverage Analysis Modal -->
            <div id="coverageModal" class="modal" style="display: none;">
                <div class="modal-content modal-lg">
                    <div class="modal-header">
                        <h4>📊 Coverage Analysis</h4>
                        <button class="modal-close" id="closeCoverageModal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="coverageResults" class="coverage-results">
                            <div class="loading-state">
                                <i class="fas fa-spinner fa-spin"></i> Analyzing coverage...
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 🔐 GET AUTH TOKEN
     */
    getAuthToken() {
        // Check all possible token storage locations
        return localStorage.getItem('adminToken') ||
               localStorage.getItem('authToken') ||
               sessionStorage.getItem('authToken') ||
               localStorage.getItem('token') ||
               sessionStorage.getItem('token') || '';
    }

    /**
     * 🔗 ATTACH EVENT LISTENERS
     */
    attachEventListeners() {
        // Main action buttons
        document.getElementById('addResponseBtn')?.addEventListener('click', () => this.showAddModal());
        document.getElementById('browseTemplatesBtn')?.addEventListener('click', () => this.showTemplatesModal());
        document.getElementById('testMatchBtn')?.addEventListener('click', () => this.showTestModal());
        document.getElementById('importBtn')?.addEventListener('click', () => this.handleImport());
        document.getElementById('exportBtn')?.addEventListener('click', () => this.handleExport());
        document.getElementById('analyzeCoverageBtn')?.addEventListener('click', () => this.showCoverageModal());

        // Filters
        document.getElementById('searchInput')?.addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this.filterResponses();
        });
        document.getElementById('categoryFilter')?.addEventListener('change', (e) => {
            this.filters.category = e.target.value;
            this.filterResponses();
        });
        document.getElementById('statusFilter')?.addEventListener('change', (e) => {
            this.filters.enabled = e.target.value;
            this.filterResponses();
        });

        // Modal controls
        document.getElementById('closeModal')?.addEventListener('click', () => this.hideModal());
        document.getElementById('cancelBtn')?.addEventListener('click', () => this.hideModal());
        document.getElementById('responseForm')?.addEventListener('submit', (e) => this.handleSave(e));
        document.getElementById('suggestVariationsBtn')?.addEventListener('click', () => this.suggestVariations());

        // Templates modal
        document.getElementById('closeTemplatesModal')?.addEventListener('click', () => this.hideTemplatesModal());
        document.getElementById('templateSearch')?.addEventListener('input', (e) => this.filterTemplates(e.target.value));
        document.getElementById('templateCategory')?.addEventListener('change', (e) => this.filterTemplatesByCategory(e.target.value));

        // Test modal
        document.getElementById('closeTestModal')?.addEventListener('click', () => this.hideTestModal());
        document.getElementById('runTestBtn')?.addEventListener('click', () => this.runMatchTest());

        // Coverage modal
        document.getElementById('closeCoverageModal')?.addEventListener('click', () => this.hideCoverageModal());
    }

    /**
     * 📥 LOAD RESPONSES FROM API
     */
    async loadResponses() {
        if (!this.currentCompanyId) {
            console.warn('No company ID set');
            return;
        }

        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.currentCompanyId}/instant-responses`, {
                credentials: 'include',
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.responses = data.data.instantResponses || [];
            this.renderResponses();
            console.log(`✅ Loaded ${this.responses.length} instant responses`);
        } catch (error) {
            console.error('Error loading instant responses:', error);
            this.showError('Failed to load instant responses');
        }
    }

    /**
     * 📊 LOAD STATISTICS
     */
    async loadStats() {
        if (!this.currentCompanyId) return;

        try {
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.currentCompanyId}/instant-responses/stats`, {
                credentials: 'include',
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            this.stats = data.data;
            this.renderStats();
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    /**
     * 🎨 RENDER STATISTICS
     */
    renderStats() {
        if (!this.stats) return;

        document.getElementById('statTotal').textContent = this.stats.total || 0;
        document.getElementById('statEnabled').textContent = this.stats.enabled || 0;
        document.getElementById('statMatcher').textContent = 
            this.stats.matcher ? `${(this.stats.matcher.confidenceThreshold * 100).toFixed(0)}%` : '-';
        document.getElementById('statPriority').textContent = this.stats.averagePriority || '-';
    }

    /**
     * 🎨 RENDER RESPONSES LIST
     */
    renderResponses() {
        const container = document.getElementById('responsesContainer');
        
        if (!this.responses || this.responses.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox fa-3x"></i>
                    <h4>No Instant Responses Yet</h4>
                    <p>Get started by adding your first instant response or browse the template library.</p>
                    <button class="btn btn-primary" onclick="instantResponsesManager.showAddModal()">
                        <i class="fas fa-plus"></i> Add First Response
                    </button>
                    <button class="btn btn-success" onclick="instantResponsesManager.showTemplatesModal()">
                        <i class="fas fa-book"></i> Browse Templates
                    </button>
                </div>
            `;
            return;
        }

        const html = `
            <table class="ir-table">
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Trigger</th>
                        <th>Response</th>
                        <th>Category</th>
                        <th>Priority</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.responses.map(r => this.renderResponseRow(r)).join('')}
                </tbody>
            </table>
        `;
        
        container.innerHTML = html;
    }

    /**
     * 🎨 RENDER SINGLE RESPONSE ROW
     */
    renderResponseRow(response) {
        const statusIcon = response.enabled ? 
            '<span class="status-badge status-enabled">✓ Enabled</span>' : 
            '<span class="status-badge status-disabled">✗ Disabled</span>';
        
        const categoryIcon = this.getCategoryIcon(response.category);
        
        return `
            <tr data-id="${response._id}">
                <td>${statusIcon}</td>
                <td class="trigger-cell">
                    <strong>${this.escapeHtml(response.trigger)}</strong>
                    ${response.notes ? `<br><small class="text-muted">${this.escapeHtml(response.notes)}</small>` : ''}
                </td>
                <td class="response-cell">${this.escapeHtml(response.response)}</td>
                <td><span class="category-badge">${categoryIcon} ${response.category}</span></td>
                <td><span class="priority-badge">${response.priority}</span></td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-primary" onclick="instantResponsesManager.editResponse('${response._id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="instantResponsesManager.deleteResponse('${response._id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    /**
     * 🔍 FILTER RESPONSES
     */
    filterResponses() {
        let filtered = [...this.responses];

        // Search filter
        if (this.filters.search) {
            const search = this.filters.search.toLowerCase();
            filtered = filtered.filter(r => 
                r.trigger.toLowerCase().includes(search) ||
                r.response.toLowerCase().includes(search)
            );
        }

        // Category filter
        if (this.filters.category) {
            filtered = filtered.filter(r => r.category === this.filters.category);
        }

        // Status filter
        if (this.filters.enabled === 'enabled') {
            filtered = filtered.filter(r => r.enabled === true);
        } else if (this.filters.enabled === 'disabled') {
            filtered = filtered.filter(r => r.enabled === false);
        }

        // Temporarily replace responses array for rendering
        const originalResponses = this.responses;
        this.responses = filtered;
        this.renderResponses();
        this.responses = originalResponses;
    }

    /**
     * ➕ SHOW ADD MODAL
     */
    showAddModal() {
        document.getElementById('modalTitle').textContent = 'Add Instant Response';
        document.getElementById('responseForm').reset();
        document.getElementById('responseId').value = '';
        document.getElementById('suggestedVariations').style.display = 'none';
        document.getElementById('responseModal').style.display = 'flex';
    }

    /**
     * ✏️ EDIT RESPONSE
     */
    async editResponse(responseId) {
        const response = this.responses.find(r => r._id === responseId);
        if (!response) return;

        document.getElementById('modalTitle').textContent = 'Edit Instant Response';
        document.getElementById('responseId').value = response._id;
        document.getElementById('trigger').value = response.trigger;
        document.getElementById('response').value = response.response;
        document.getElementById('category').value = response.category;
        document.getElementById('priority').value = response.priority;
        document.getElementById('enabled').value = response.enabled.toString();
        document.getElementById('notes').value = response.notes || '';
        document.getElementById('suggestedVariations').style.display = 'none';
        document.getElementById('responseModal').style.display = 'flex';
    }

    /**
     * 💾 HANDLE SAVE
     */
    async handleSave(e) {
        e.preventDefault();

        const responseId = document.getElementById('responseId').value;
        const formData = {
            trigger: document.getElementById('trigger').value.trim(),
            response: document.getElementById('response').value.trim(),
            category: document.getElementById('category').value,
            priority: parseInt(document.getElementById('priority').value),
            enabled: document.getElementById('enabled').value === 'true',
            notes: document.getElementById('notes').value.trim()
        };

        try {
            const url = responseId ? 
                `/api/company/${this.currentCompanyId}/instant-responses/${responseId}` :
                `/api/company/${this.currentCompanyId}/instant-responses`;
            
            const method = responseId ? 'PUT' : 'POST';
            const authToken = this.getAuthToken();

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Save failed');
            }

            this.showSuccess(responseId ? 'Response updated!' : 'Response created!');
            this.hideModal();
            await this.loadResponses();
            await this.loadStats();
        } catch (error) {
            console.error('Error saving response:', error);
            this.showError(error.message);
        }
    }

    /**
     * 🗑️ DELETE RESPONSE
     */
    async deleteResponse(responseId) {
        if (!confirm('Are you sure you want to delete this instant response?')) return;

        try {
            const authToken = this.getAuthToken();
            const response = await fetch(
                `/api/company/${this.currentCompanyId}/instant-responses/${responseId}`,
                {
                    method: 'DELETE',
                    credentials: 'include',
                    headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
                }
            );

            if (!response.ok) throw new Error('Delete failed');

            this.showSuccess('Response deleted!');
            await this.loadResponses();
            await this.loadStats();
        } catch (error) {
            console.error('Error deleting response:', error);
            this.showError('Failed to delete response');
        }
    }

    /**
     * 🪄 SUGGEST VARIATIONS
     */
    async suggestVariations() {
        const trigger = document.getElementById('trigger').value.trim();
        if (!trigger) {
            this.showError('Please enter a trigger first');
            return;
        }

        try {
            const authToken = this.getAuthToken();
            const response = await fetch(
                `/api/company/${this.currentCompanyId}/instant-responses/suggest-variations`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                    },
                    credentials: 'include',
                    body: JSON.stringify({ trigger })
                }
            );

            if (!response.ok) throw new Error('Suggestion failed');

            const data = await response.json();
            this.renderVariations(data.data.suggestions);
        } catch (error) {
            console.error('Error suggesting variations:', error);
            this.showError('Failed to generate suggestions');
        }
    }

    /**
     * 🎨 RENDER VARIATIONS
     */
    renderVariations(suggestions) {
        const container = document.getElementById('variationsList');
        const variationsContainer = document.getElementById('suggestedVariations');

        if (!suggestions || suggestions.length === 0) {
            container.innerHTML = '<p class="text-muted">No variations suggested.</p>';
            variationsContainer.style.display = 'block';
            return;
        }

        const html = `
            <div style="margin-bottom: 12px; padding: 10px; background: #e7f3ff; border-radius: 6px; border-left: 4px solid #0066cc;">
                <p style="margin: 0; font-size: 13px; color: #0066cc;">
                    <i class="fas fa-info-circle"></i> <strong>Click any variation</strong> to use it as your trigger phrase
                </p>
            </div>
            ${suggestions.slice(0, 10).map((s, idx) => `
                <div class="variation-item" data-variation="${this.escapeHtml(s.text)}" style="cursor: pointer;">
                    <span class="variation-text">${this.escapeHtml(s.text)}</span>
                    <span class="variation-type">${s.type}</span>
                    <span class="variation-confidence">${(s.confidence * 100).toFixed(0)}%</span>
                </div>
            `).join('')}
        `;

        container.innerHTML = html;
        
        // Make variations clickable to use them
        container.querySelectorAll('.variation-item').forEach(item => {
            item.addEventListener('click', () => {
                const variation = item.getAttribute('data-variation');
                document.getElementById('trigger').value = variation;
                this.showSuccess(`✅ Using variation: "${variation}"`);
            });
        });
        
        variationsContainer.style.display = 'block';
    }

    /**
     * 📚 SHOW TEMPLATES MODAL
     */
    async showTemplatesModal() {
        document.getElementById('templatesModal').style.display = 'flex';
        await this.loadTemplates();
    }

    /**
     * 📥 LOAD TEMPLATES
     */
    async loadTemplates() {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(
                `/api/company/${this.currentCompanyId}/instant-responses/templates`,
                { 
                    credentials: 'include',
                    headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
                }
            );

            if (!response.ok) throw new Error('Failed to load templates');

            const data = await response.json();
            this.templates = data.data.templates;
            this.renderTemplates();
        } catch (error) {
            console.error('Error loading templates:', error);
            this.showError('Failed to load templates');
        }
    }

    /**
     * 🎨 RENDER TEMPLATES
     */
    renderTemplates() {
        const container = document.getElementById('templatesContainer');

        if (!this.templates || this.templates.length === 0) {
            container.innerHTML = '<p class="text-muted">No templates available.</p>';
            return;
        }

        const html = this.templates.map(t => `
            <div class="template-card">
                <div class="template-header">
                    <h4>${this.getCategoryIcon(t.category)} ${this.escapeHtml(t.name)}</h4>
                    <span class="template-count">${t.templates.length} responses</span>
                </div>
                <p class="template-description">${this.escapeHtml(t.description)}</p>
                <div class="template-tags">
                    ${t.tags.map(tag => `<span class="tag">${this.escapeHtml(tag)}</span>`).join('')}
                </div>
                <div class="template-actions">
                    <button class="btn btn-sm btn-primary" onclick="instantResponsesManager.applyTemplate('${t._id}')">
                        <i class="fas fa-check"></i> Apply Template
                    </button>
                    <button class="btn btn-sm btn-outline" onclick="instantResponsesManager.previewTemplate('${t._id}')">
                        <i class="fas fa-eye"></i> Preview
                    </button>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    }

    /**
     * ✅ APPLY TEMPLATE
     */
    async applyTemplate(templateId) {
        const mode = confirm('Replace all existing responses? Click OK to replace, Cancel to append.') ? 
            'replace' : 'append';

        try {
            const authToken = this.getAuthToken();
            const response = await fetch(
                `/api/company/${this.currentCompanyId}/instant-responses/apply-template/${templateId}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                    },
                    credentials: 'include',
                    body: JSON.stringify({ mode })
                }
            );

            if (!response.ok) throw new Error('Apply failed');

            const data = await response.json();
            this.showSuccess(`Applied ${data.data.summary.applied} responses!`);
            this.hideTemplatesModal();
            await this.loadResponses();
            await this.loadStats();
        } catch (error) {
            console.error('Error applying template:', error);
            this.showError('Failed to apply template');
        }
    }

    /**
     * 🧪 SHOW TEST MODAL
     */
    showTestModal() {
        document.getElementById('testMatchModal').style.display = 'flex';
        document.getElementById('testResults').style.display = 'none';
    }

    /**
     * ▶️ RUN MATCH TEST
     */
    async runMatchTest() {
        const query = document.getElementById('testQuery').value.trim();
        if (!query) {
            this.showError('Please enter a test query');
            return;
        }

        try {
            const authToken = this.getAuthToken();
            const response = await fetch(
                `/api/company/${this.currentCompanyId}/instant-responses/test-match`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                    },
                    credentials: 'include',
                    body: JSON.stringify({ query })
                }
            );

            if (!response.ok) throw new Error('Test failed');

            const data = await response.json();
            this.renderTestResults(data.data);
        } catch (error) {
            console.error('Error testing match:', error);
            this.showError('Test failed');
        }
    }

    /**
     * 🎨 RENDER TEST RESULTS
     */
    renderTestResults(results) {
        const container = document.getElementById('testResults');
        
        if (results.match) {
            container.innerHTML = `
                <div class="test-result success">
                    <h5>✅ Match Found!</h5>
                    <div class="result-details">
                        <p><strong>Trigger:</strong> ${this.escapeHtml(results.match.trigger)}</p>
                        <p><strong>Response:</strong> ${this.escapeHtml(results.match.response)}</p>
                        <p><strong>Confidence:</strong> ${(results.match.score * 100).toFixed(1)}%</p>
                        <p><strong>Category:</strong> ${results.match.category}</p>
                        <p><strong>Match Time:</strong> ${results.match.matchTimeMs}ms</p>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="test-result warning">
                    <h5>⚠️ No Match Found</h5>
                    <p>No instant response matched this query with sufficient confidence.</p>
                    <p>Try adding more variations or check your triggers.</p>
                </div>
            `;
        }
        
        container.style.display = 'block';
    }

    /**
     * 📊 SHOW COVERAGE MODAL
     */
    async showCoverageModal() {
        document.getElementById('coverageModal').style.display = 'flex';
        await this.analyzeCoverage();
    }

    /**
     * 📈 ANALYZE COVERAGE
     */
    async analyzeCoverage() {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(
                `/api/company/${this.currentCompanyId}/instant-responses/analyze-coverage`,
                { 
                    credentials: 'include',
                    headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
                }
            );

            if (!response.ok) throw new Error('Analysis failed');

            const data = await response.json();
            this.renderCoverageAnalysis(data.data);
        } catch (error) {
            console.error('Error analyzing coverage:', error);
            this.showError('Coverage analysis failed');
        }
    }

    /**
     * 🎨 RENDER COVERAGE ANALYSIS
     */
    renderCoverageAnalysis(analysis) {
        const container = document.getElementById('coverageResults');
        
        const html = `
            <div class="coverage-summary">
                <h5>Coverage Summary</h5>
                <div class="coverage-stats">
                    <div class="coverage-stat">
                        <span class="stat-value">${analysis.totalResponses}</span>
                        <span class="stat-label">Total Responses</span>
                    </div>
                    <div class="coverage-stat">
                        <span class="stat-value">${analysis.categoriesConfigured}</span>
                        <span class="stat-label">Categories</span>
                    </div>
                    <div class="coverage-stat">
                        <span class="stat-value">${(analysis.overallCoverage * 100).toFixed(0)}%</span>
                        <span class="stat-label">Overall Coverage</span>
                    </div>
                </div>
            </div>
            
            <div class="category-coverage">
                <h5>Coverage by Category</h5>
                ${Object.entries(analysis.categoryAnalysis).map(([category, data]) => `
                    <div class="category-item">
                        <div class="category-header">
                            <span class="category-name">${this.getCategoryIcon(category)} ${category}</span>
                            <span class="category-score">${(data.coverage * 100).toFixed(0)}%</span>
                        </div>
                        <div class="category-details">
                            <p><strong>Triggers:</strong> ${data.triggerCount}</p>
                            ${data.missingVariations.length > 0 ? `
                                <p><strong>Missing:</strong> ${data.missingVariations.slice(0, 5).join(', ')}${data.missingVariations.length > 5 ? '...' : ''}</p>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        container.innerHTML = html;
    }

    /**
     * 📤 HANDLE EXPORT
     */
    async handleExport() {
        try {
            const authToken = this.getAuthToken();
            const response = await fetch(
                `/api/company/${this.currentCompanyId}/instant-responses/export`,
                { 
                    credentials: 'include',
                    headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
                }
            );

            if (!response.ok) throw new Error('Export failed');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `instant-responses-${this.currentCompanyId}-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            this.showSuccess('Export successful!');
        } catch (error) {
            console.error('Error exporting:', error);
            this.showError('Export failed');
        }
    }

    /**
     * 📥 HANDLE IMPORT
     */
    handleImport() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);
                
                const mode = confirm('Replace all existing responses? Click OK to replace, Cancel to append.') ? 
                    'replace' : 'append';

                const authToken = this.getAuthToken();
                const response = await fetch(
                    `/api/company/${this.currentCompanyId}/instant-responses/import`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                        },
                        credentials: 'include',
                        body: JSON.stringify({ 
                            instantResponses: data.instantResponses,
                            mode 
                        })
                    }
                );

                if (!response.ok) throw new Error('Import failed');

                const result = await response.json();
                this.showSuccess(`Imported ${result.data.summary.imported} responses!`);
                await this.loadResponses();
                await this.loadStats();
            } catch (error) {
                console.error('Error importing:', error);
                this.showError('Import failed');
            }
        };
        input.click();
    }

    /**
     * 🚫 HIDE MODALS
     */
    hideModal() {
        document.getElementById('responseModal').style.display = 'none';
    }

    hideTemplatesModal() {
        document.getElementById('templatesModal').style.display = 'none';
    }

    hideTestModal() {
        document.getElementById('testMatchModal').style.display = 'none';
    }

    hideCoverageModal() {
        document.getElementById('coverageModal').style.display = 'none';
    }

    /**
     * 🎨 HELPER: GET CATEGORY ICON
     */
    getCategoryIcon(category) {
        const icons = {
            hours: '🕒',
            location: '📍',
            pricing: '💰',
            services: '🔧',
            contact: '📞',
            booking: '📅',
            emergency: '🚨',
            other: '📝'
        };
        return icons[category] || '📝';
    }

    /**
     * 🔒 HELPER: ESCAPE HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * ✅ SHOW SUCCESS MESSAGE
     */
    showSuccess(message) {
        // Implement your notification system
        alert(message); // Simple fallback
    }

    /**
     * ❌ SHOW ERROR MESSAGE
     */
    showError(message) {
        // Implement your notification system
        alert('Error: ' + message); // Simple fallback
    }
}

// Make it globally accessible
window.InstantResponsesManager = InstantResponsesManager;
