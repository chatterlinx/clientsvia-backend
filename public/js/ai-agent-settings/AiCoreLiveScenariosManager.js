/**
 * ============================================================================
 * AICORE LIVE SCENARIOS MANAGER
 * ============================================================================
 * 
 * PURPOSE: Real-time scenario browser from ALL activated Global AI Brain templates
 * 
 * WHAT IT SHOWS:
 * - All scenarios from EVERY active template (merged view)
 * - Live performance metrics per scenario (confidence, usage)
 * - Categorized by trade (HVAC, Plumbing, Electrical, etc.)
 * - Searchable & filterable
 * - Quick test functionality
 * 
 * ARCHITECTURE:
 * - Reads from activated template references (company.aiAgentSettings.templateReferences)
 * - Fetches scenario data from Global AI Brain templates
 * - Displays merged list with category grouping
 * - Shows scenario metadata (triggers, confidence, usage stats)
 * 
 * INTEGRATES WITH:
 * - AiCore Templates (to see which templates are active)
 * - AiCore Knowledgebase (to see which scenarios need improvement)
 * 
 * ============================================================================
 */

class AiCoreLiveScenariosManager {
    constructor(parentManager) {
        this.parentManager = parentManager;
        this.companyId = parentManager.companyId;
        this.container = document.getElementById('aicore-live-scenarios-container');
        
        this.scenarios = [];
        this.categories = [];
        this.isLoading = false;
        this.currentFilter = 'all';
        this.searchQuery = '';
        
        console.log('🎭 [LIVE SCENARIOS] Initialized');
    }
    
    /**
     * Load all scenarios from activated templates
     */
    async load() {
        console.log('🎭 [LIVE SCENARIOS] Checkpoint 1: Starting load...');
        console.log('🎭 [LIVE SCENARIOS] Checkpoint 2: Company ID:', this.companyId);
        
        this.isLoading = true;
        this.renderLoading();
        
        try {
            const url = `/api/company/${this.companyId}/live-scenarios`;
            console.log('🎭 [LIVE SCENARIOS] Checkpoint 3: Fetching from:', url);
            console.log('🎭 [LIVE SCENARIOS] Checkpoint 4: Auth token exists?', !!localStorage.getItem('adminToken'));
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            console.log('🎭 [LIVE SCENARIOS] Checkpoint 5: Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('🎭 [LIVE SCENARIOS] Checkpoint 6: HTTP ERROR!', {
                    status: response.status,
                    statusText: response.statusText,
                    body: errorText
                });
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            console.log('🎭 [LIVE SCENARIOS] Checkpoint 7: Parsing JSON...');
            const data = await response.json();
            console.log('🎭 [LIVE SCENARIOS] Checkpoint 8: Data received:', data);
            
            this.scenarios = data.scenarios || [];
            this.categories = data.categories || [];
            
            console.log(`✅ [LIVE SCENARIOS] Checkpoint 9: Loaded ${this.scenarios.length} scenarios from ${this.categories.length} categories`);
            
            this.render();
            
        } catch (error) {
            console.error('❌ [LIVE SCENARIOS] Checkpoint 10: LOAD FAILED!');
            console.error('❌ [LIVE SCENARIOS] Error name:', error.name);
            console.error('❌ [LIVE SCENARIOS] Error message:', error.message);
            console.error('❌ [LIVE SCENARIOS] Full error:', error);
            console.error('❌ [LIVE SCENARIOS] Stack trace:', error.stack);
            this.renderError('Failed to load scenarios. Please refresh.');
        } finally {
            this.isLoading = false;
        }
    }
    
    /**
     * Render the main dashboard
     */
    render() {
        const totalScenarios = this.scenarios.length;
        const totalCategories = this.categories.length;
        const avgConfidence = totalScenarios > 0 
            ? (this.scenarios.reduce((sum, s) => sum + (s.avgConfidence || 0), 0) / totalScenarios * 100).toFixed(0)
            : 0;
        
        this.container.innerHTML = `
            <!-- HERO HEADER -->
            <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px; border-radius: 12px; margin-bottom: 24px; color: white;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h2 style="font-size: 28px; font-weight: 700; margin: 0 0 8px 0;">
                            🎭 Live Scenarios Dashboard
                        </h2>
                        <p style="font-size: 16px; opacity: 0.95; margin: 0;">
                            All active scenarios from your AI Brain templates
                        </p>
                    </div>
                    <button onclick="aiCoreLiveScenariosManager.refresh()" 
                            style="background: rgba(255,255,255,0.2); border: 2px solid rgba(255,255,255,0.4); color: white; padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                            onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                        <i class="fas fa-sync-alt mr-2"></i>Refresh
                    </button>
                </div>
            </div>
            
            <!-- STATUS CARDS -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px;">
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #6366f1;">
                        ${totalScenarios}
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        Live Scenarios
                    </div>
                </div>
                
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #8b5cf6;">
                        ${totalCategories}
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        Categories
                    </div>
                </div>
                
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #10b981;">
                        ${avgConfidence}%
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        Avg Confidence
                    </div>
                </div>
            </div>
            
            <!-- SEARCH & FILTER -->
            <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                <div style="display: flex; gap: 16px; align-items: center;">
                    <div style="flex: 1;">
                        <input type="text" 
                               id="scenario-search-input"
                               placeholder="Search scenarios by trigger, reply, or category..."
                               onkeyup="aiCoreLiveScenariosManager.onSearchChange(this.value)"
                               style="width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px;">
                    </div>
                    <select onchange="aiCoreLiveScenariosManager.onFilterChange(this.value)"
                            style="padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; cursor: pointer;">
                        <option value="all">All Categories</option>
                        ${this.categories.map(cat => `<option value="${this.escapeHtml(cat)}">${this.escapeHtml(cat)}</option>`).join('')}
                    </select>
                </div>
            </div>
            
            ${totalScenarios === 0 ? this.renderEmptyState() : `
                <!-- SCENARIOS LIST -->
                ${this.renderScenarios()}
            `}
        `;
    }
    
    /**
     * Render scenarios grouped by category
     */
    renderScenarios() {
        // Filter scenarios
        let filtered = this.scenarios;
        
        if (this.currentFilter !== 'all') {
            filtered = filtered.filter(s => s.category === this.currentFilter);
        }
        
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(s => 
                s.trigger.toLowerCase().includes(query) ||
                s.reply.toLowerCase().includes(query) ||
                (s.category && s.category.toLowerCase().includes(query))
            );
        }
        
        // Group by category
        const grouped = {};
        filtered.forEach(scenario => {
            const cat = scenario.category || 'Uncategorized';
            if (!grouped[cat]) {
                grouped[cat] = [];
            }
            grouped[cat].push(scenario);
        });
        
        if (Object.keys(grouped).length === 0) {
            return `
                <div style="text-align: center; padding: 60px 20px; background: white; border: 2px solid #e5e7eb; border-radius: 12px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                    <h3 style="font-size: 20px; font-weight: 600; color: #1f2937; margin: 0 0 8px 0;">
                        No Scenarios Found
                    </h3>
                    <p style="font-size: 14px; color: #6b7280;">
                        Try adjusting your search or filter
                    </p>
                </div>
            `;
        }
        
        return Object.keys(grouped).sort().map(category => `
            <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <h3 style="font-size: 20px; font-weight: 700; color: #1f2937; margin: 0 0 16px 0;">
                    ${this.getCategoryIcon(category)} ${this.escapeHtml(category)} (${grouped[category].length})
                </h3>
                
                <div style="display: grid; gap: 12px;">
                    ${grouped[category].map((scenario, idx) => this.renderScenarioCard(scenario, idx)).join('')}
                </div>
            </div>
        `).join('');
    }
    
    /**
     * Render single scenario card
     */
    renderScenarioCard(scenario, index) {
        const confidence = scenario.avgConfidence ? (scenario.avgConfidence * 100).toFixed(0) : '--';
        const usageCount = scenario.usageCount || 0;
        
        const confidenceColor = scenario.avgConfidence >= 0.8 ? '#10b981' : 
                                scenario.avgConfidence >= 0.6 ? '#f59e0b' : '#ef4444';
        
        return `
            <div style="background: #f9fafb; border: 2px solid #e5e7eb; border-radius: 8px; padding: 16px; transition: all 0.2s;"
                 onmouseover="this.style.borderColor='#6366f1'; this.style.boxShadow='0 2px 8px rgba(99,102,241,0.1)'"
                 onmouseout="this.style.borderColor='#e5e7eb'; this.style.boxShadow='none'">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div style="font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">
                            🎯 ${this.escapeHtml(scenario.trigger)}
                        </div>
                        <div style="font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 8px;">
                            💬 ${this.escapeHtml(scenario.reply).substring(0, 200)}${scenario.reply.length > 200 ? '...' : ''}
                        </div>
                        ${scenario.templateName ? `
                            <div style="font-size: 13px; color: #6b7280;">
                                📚 From: <strong>${this.escapeHtml(scenario.templateName)}</strong>
                            </div>
                        ` : ''}
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-left: 16px;">
                        <div style="background: ${confidenceColor}; color: white; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; text-align: center; white-space: nowrap;">
                            ${confidence}% Confidence
                        </div>
                        <div style="background: #6366f1; color: white; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; text-align: center; white-space: nowrap;">
                            ${usageCount} Uses
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; gap: 8px; margin-top: 12px;">
                    <button onclick="aiCoreLiveScenariosManager.showDetails('${scenario._id || index}')"
                            style="flex: 1; background: white; border: 2px solid #e5e7eb; color: #374151; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.borderColor='#6366f1'; this.style.color='#6366f1'"
                            onmouseout="this.style.borderColor='#e5e7eb'; this.style.color='#374151'">
                        <i class="fas fa-eye mr-1"></i>View Full Details
                    </button>
                    <button onclick="aiCoreLiveScenariosManager.testScenario('${scenario._id || index}')"
                            style="background: #6366f1; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity 0.2s;"
                            onmouseover="this.style.opacity='0.9'"
                            onmouseout="this.style.opacity='1'">
                        <i class="fas fa-vial mr-1"></i>Test
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Render empty state
     */
    renderEmptyState() {
        return `
            <div style="text-align: center; padding: 60px 20px; background: white; border: 2px solid #e5e7eb; border-radius: 12px;">
                <div style="font-size: 72px; margin-bottom: 16px;">🎭</div>
                <h3 style="font-size: 24px; font-weight: 700; color: #1f2937; margin: 0 0 8px 0;">
                    No Active Scenarios
                </h3>
                <p style="font-size: 16px; color: #6b7280; margin: 0 0 16px 0;">
                    Activate a Global AI Brain template to get started
                </p>
                <button onclick="aiCoreLiveScenariosManager.goToTemplates()"
                        style="background: linear-gradient(to right, #6366f1, #8b5cf6); color: white; padding: 12px 24px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: opacity 0.2s;"
                        onmouseover="this.style.opacity='0.9'"
                        onmouseout="this.style.opacity='1'">
                    <i class="fas fa-brain mr-2"></i>Go to AiCore Templates
                </button>
            </div>
        `;
    }
    
    /**
     * Render loading state
     */
    renderLoading() {
        this.container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: #6366f1; margin-bottom: 16px;"></i>
                <div style="font-size: 18px; color: #6b7280;">Loading scenarios...</div>
            </div>
        `;
    }
    
    /**
     * Render error state
     */
    renderError(message) {
        this.container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; background: #fef2f2; border: 2px solid #ef4444; border-radius: 12px;">
                <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #ef4444; margin-bottom: 16px;"></i>
                <div style="font-size: 18px; color: #991b1b; font-weight: 600;">${message}</div>
            </div>
        `;
    }
    
    /**
     * Get category icon
     */
    getCategoryIcon(category) {
        const icons = {
            'HVAC': '🔥',
            'Plumbing': '🚰',
            'Electrical': '⚡',
            'General': '🏢',
            'Emergency': '🚨',
            'Scheduling': '📅',
            'Pricing': '💰',
            'Services': '🛠️'
        };
        return icons[category] || '📁';
    }
    
    /**
     * Search change handler
     */
    onSearchChange(value) {
        this.searchQuery = value;
        this.render();
    }
    
    /**
     * Filter change handler
     */
    onFilterChange(value) {
        this.currentFilter = value;
        this.render();
    }
    
    /**
     * Show scenario details in modal
     */
    showDetails(scenarioId) {
        console.log(`👁️ [LIVE SCENARIOS] Show details for: ${scenarioId}`);
        // TODO: Implement modal with full scenario details
        alert('Scenario details modal - Coming soon!');
    }
    
    /**
     * Test scenario
     */
    testScenario(scenarioId) {
        console.log(`🧪 [LIVE SCENARIOS] Test scenario: ${scenarioId}`);
        // TODO: Implement test modal
        alert('Scenario test - Coming soon!');
    }
    
    /**
     * Navigate to Templates tab
     */
    goToTemplates() {
        this.parentManager.switchSubTab('aicore-templates');
    }
    
    /**
     * Refresh data
     */
    async refresh() {
        console.log('🔄 [LIVE SCENARIOS] Refreshing...');
        await this.load();
    }
    
    /**
     * Escape HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

