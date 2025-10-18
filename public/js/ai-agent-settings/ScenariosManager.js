/**
 * ============================================================================
 * SCENARIOS MANAGER - CONVERSATION FLOW NAVIGATOR
 * ============================================================================
 * 
 * PURPOSE: Browse, search, and manage 500+ AI conversation scenarios
 * CHALLENGE: How to make 500+ items navigable and user-friendly
 * 
 * SOLUTION:
 * - Category accordion (collapsible sections)
 * - Search/filter system
 * - Status filters (active, draft, disabled)
 * - Read-only view (edits happen in Global AI Brain)
 * - "Clone from Global" button to sync updates
 * 
 * ARCHITECTURE:
 * - Company inherits scenarios from cloned template
 * - Cannot edit individual scenarios here (read-only)
 * - Can bulk sync updates from Global AI Brain
 * - Can enable/disable scenarios
 * 
 * ============================================================================
 */

class ScenariosManager {
    constructor(parentManager) {
        this.parent = parentManager;
        this.companyId = parentManager.companyId;
        this.scenarios = [];
        this.categories = [];
        this.filteredScenarios = [];
        this.searchTerm = '';
        this.categoryFilter = 'all';
        this.statusFilter = 'active';
        this.expandedCategories = new Set();
        
        console.log('💬 [SCENARIOS] Initialized');
    }
    
    /**
     * Load scenarios from API
     */
    async load() {
        console.log('💬 [SCENARIOS] Loading...');
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/scenarios`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            this.scenarios = data.scenarios || [];
            this.categories = data.categories || [];
            this.filteredScenarios = [...this.scenarios];
            
            console.log('✅ [SCENARIOS] Loaded:', {
                scenarios: this.scenarios.length,
                categories: this.categories.length
            });
            
            this.applyFilters();
            this.render();
            this.attachEventListeners();
            
        } catch (error) {
            console.error('❌ [SCENARIOS] Failed to load:', error);
            this.renderEmpty();
        }
    }
    
    /**
     * Apply search and filters
     */
    applyFilters() {
        let filtered = [...this.scenarios];
        
        // Apply search
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            filtered = filtered.filter(s => 
                s.name.toLowerCase().includes(term) ||
                s.triggers.some(t => t.toLowerCase().includes(term)) ||
                s.categories.some(c => c.toLowerCase().includes(term))
            );
        }
        
        // Apply category filter
        if (this.categoryFilter !== 'all') {
            filtered = filtered.filter(s => 
                s.categories.includes(this.categoryFilter)
            );
        }
        
        // Apply status filter
        if (this.statusFilter !== 'all') {
            filtered = filtered.filter(s => s.status === this.statusFilter);
        }
        
        this.filteredScenarios = filtered;
        
        console.log(`💬 [SCENARIOS] Filtered: ${filtered.length}/${this.scenarios.length} scenarios`);
    }
    
    /**
     * Render scenarios
     */
    render() {
        const container = document.getElementById('scenarios-container');
        if (!container) return;
        
        if (this.scenarios.length === 0) {
            this.renderEmpty();
            return;
        }
        
        if (this.filteredScenarios.length === 0) {
            this.renderNoResults();
            return;
        }
        
        // Group by category
        const grouped = this.groupByCategories(this.filteredScenarios);
        
        let html = '';
        
        for (const [categoryName, scenarios] of Object.entries(grouped)) {
            html += this.renderCategory(categoryName, scenarios);
        }
        
        container.innerHTML = html;
    }
    
    /**
     * Group scenarios by their first category
     */
    groupByCategories(scenarios) {
        const groups = {};
        
        scenarios.forEach(scenario => {
            const category = scenario.categories[0] || 'Uncategorized';
            if (!groups[category]) {
                groups[category] = [];
            }
            groups[category].push(scenario);
        });
        
        return groups;
    }
    
    /**
     * Render a category accordion
     */
    renderCategory(categoryName, scenarios) {
        const categoryId = this.sanitizeId(categoryName);
        const isExpanded = this.expandedCategories.has(categoryName);
        const expandClass = isExpanded ? 'expanded' : '';
        const iconClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';
        
        const categoryEmoji = this.getCategoryEmoji(categoryName);
        
        let html = `
            <div class="ai-settings-scenario-category">
                <div 
                    class="ai-settings-scenario-category-header" 
                    onclick="scenariosManager.toggleCategory('${categoryName}')"
                >
                    <div class="flex items-center gap-3">
                        <i class="fas ${iconClass} text-gray-400"></i>
                        <span class="font-bold text-gray-900">${categoryEmoji} ${categoryName}</span>
                        <span class="text-sm text-gray-500">(${scenarios.length} scenarios)</span>
                    </div>
                </div>
                <div id="category-${categoryId}" class="ai-settings-scenario-category-content ${expandClass}" style="display: ${isExpanded ? 'block' : 'none'}">
        `;
        
        scenarios.forEach(scenario => {
            html += this.renderScenario(scenario);
        });
        
        html += `
                </div>
            </div>
        `;
        
        return html;
    }
    
    /**
     * Render a single scenario
     */
    renderScenario(scenario) {
        const statusBadge = this.getStatusBadge(scenario.status);
        const triggerCount = scenario.triggers?.length || 0;
        const replyCount = (scenario.quickReplies?.length || 0) + (scenario.fullReplies?.length || 0);
        
        return `
            <div class="ai-settings-scenario-item">
                <div class="ai-settings-scenario-header">
                    <div class="flex items-center gap-3 flex-1">
                        <div class="flex-1">
                            <div class="font-bold text-gray-900 mb-1">${this.escapeHtml(scenario.name)}</div>
                            <div class="flex gap-4 text-sm text-gray-600">
                                <span><i class="fas fa-comment-dots mr-1"></i>${triggerCount} triggers</span>
                                <span><i class="fas fa-reply mr-1"></i>${replyCount} replies</span>
                                ${scenario.priority ? `<span><i class="fas fa-flag mr-1"></i>Priority ${scenario.priority}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="ai-settings-scenario-badges">
                        ${statusBadge}
                    </div>
                </div>
                
                ${scenario.triggers && scenario.triggers.length > 0 ? `
                    <div class="mt-3 pl-4 border-l-4 border-blue-200">
                        <div class="text-xs font-semibold text-gray-500 mb-1">SAMPLE TRIGGERS:</div>
                        <div class="text-sm text-gray-700">
                            ${scenario.triggers.slice(0, 3).map(t => `"${this.escapeHtml(t)}"`).join(', ')}
                            ${scenario.triggers.length > 3 ? ` ... +${scenario.triggers.length - 3} more` : ''}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    /**
     * Get status badge HTML
     */
    getStatusBadge(status) {
        const badges = {
            'active': '<span class="ai-settings-badge active">✅ Active</span>',
            'draft': '<span class="ai-settings-badge draft">📝 Draft</span>',
            'disabled': '<span class="ai-settings-badge disabled">⏸️ Disabled</span>',
            'archived': '<span class="ai-settings-badge disabled">📦 Archived</span>'
        };
        
        return badges[status] || badges['active'];
    }
    
    /**
     * Get category emoji
     */
    getCategoryEmoji(categoryName) {
        const emojis = {
            'Greetings & Basic Interactions': '👋',
            'Booking & Scheduling': '📅',
            'Emergency Requests': '🚨',
            'Pricing Questions': '💰',
            'Service Questions': '🔧',
            'Appointment Management': '📆',
            'Payment & Billing': '💳',
            'Location & Hours': '📍',
            'Small Talk': '💬',
            'Hold & Transfers': '⏸️',
            'Complaints & Escalation': '⚠️',
            'Universal': '🌐'
        };
        
        return emojis[categoryName] || '📋';
    }
    
    /**
     * Toggle category expansion
     */
    toggleCategory(categoryName) {
        const categoryId = this.sanitizeId(categoryName);
        const content = document.getElementById(`category-${categoryId}`);
        
        if (!content) return;
        
        if (this.expandedCategories.has(categoryName)) {
            this.expandedCategories.delete(categoryName);
            content.style.display = 'none';
        } else {
            this.expandedCategories.add(categoryName);
            content.style.display = 'block';
        }
        
        // Re-render to update chevron icon
        this.render();
    }
    
    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Search
        const searchInput = document.getElementById('scenarios-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.trim();
                this.applyFilters();
                this.render();
            });
        }
        
        // Category filter
        const categoryFilter = document.getElementById('scenarios-category-filter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.categoryFilter = e.target.value;
                this.applyFilters();
                this.render();
            });
        }
        
        // Status filter
        const statusFilter = document.getElementById('scenarios-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.statusFilter = e.target.value;
                this.applyFilters();
                this.render();
            });
        }
    }
    
    /**
     * Render empty state
     */
    renderEmpty() {
        const container = document.getElementById('scenarios-container');
        if (!container) return;
        
        container.innerHTML = `
            <div class="text-center py-16">
                <i class="fas fa-box-open text-6xl text-gray-300 mb-4"></i>
                <h3 class="text-xl font-bold text-gray-700 mb-2">No Scenarios Yet</h3>
                <p class="text-gray-500 mb-6">
                    Clone a Global AI Brain template to get 500+ pre-built scenarios.
                </p>
                <button class="ai-settings-btn ai-settings-btn-primary" onclick="templateInfoManager.cloneTemplate()">
                    <i class="fas fa-copy"></i>
                    Clone Template
                </button>
            </div>
        `;
    }
    
    /**
     * Render no results state
     */
    renderNoResults() {
        const container = document.getElementById('scenarios-container');
        if (!container) return;
        
        container.innerHTML = `
            <div class="text-center py-16">
                <i class="fas fa-search text-6xl text-gray-300 mb-4"></i>
                <h3 class="text-xl font-bold text-gray-700 mb-2">No Scenarios Found</h3>
                <p class="text-gray-500 mb-6">
                    Try adjusting your search or filters.
                </p>
                <button class="ai-settings-btn ai-settings-btn-secondary" onclick="scenariosManager.clearFilters()">
                    <i class="fas fa-times"></i>
                    Clear Filters
                </button>
            </div>
        `;
    }
    
    /**
     * Clear all filters
     */
    clearFilters() {
        this.searchTerm = '';
        this.categoryFilter = 'all';
        this.statusFilter = 'active';
        
        const searchInput = document.getElementById('scenarios-search');
        const categoryFilter = document.getElementById('scenarios-category-filter');
        const statusFilter = document.getElementById('scenarios-status-filter');
        
        if (searchInput) searchInput.value = '';
        if (categoryFilter) categoryFilter.value = 'all';
        if (statusFilter) statusFilter.value = 'active';
        
        this.applyFilters();
        this.render();
    }
    
    /**
     * Sanitize ID for DOM
     */
    sanitizeId(text) {
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
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
    window.ScenariosManager = ScenariosManager;
}

