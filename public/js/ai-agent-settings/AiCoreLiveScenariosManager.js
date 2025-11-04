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
        this.currentFilter = 'all'; // 'all', 'enabled', 'disabled', or category name
        this.searchQuery = '';
        this.summary = null;
        
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
            this.summary = data.summary || null;
            this.templatesUsed = data.templatesUsed || [];
            
            console.log(`✅ [LIVE SCENARIOS] Checkpoint 9: Loaded ${this.scenarios.length} scenarios from ${this.categories.length} categories`);
            console.log(`📊 [LIVE SCENARIOS] Summary:`, this.summary);
            
            // Check if there's any data
            if (this.scenarios.length === 0) {
                console.log('🎭 [LIVE SCENARIOS] No scenarios found - rendering empty state');
                this.renderEmptyState();
                return;
            }
            
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
        const totalEnabled = this.summary?.totalEnabled || this.scenarios.filter(s => s.isEnabledForCompany).length;
        const totalDisabled = this.summary?.totalDisabled || (totalScenarios - totalEnabled);
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
                            Enable/disable scenarios for this company • Read-only (edit in Global AI Brain)
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
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px;">
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #6366f1;">
                        ${totalScenarios}
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        Total Scenarios
                    </div>
                </div>
                
                <div style="background: white; border: 2px solid #10b981; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #10b981;">
                        ${totalEnabled}
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        Enabled
                    </div>
                </div>
                
                <div style="background: white; border: 2px solid #ef4444; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #ef4444;">
                        ${totalDisabled}
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        Disabled
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
            </div>
            
            <!-- ACTIVE TEMPLATES BREAKDOWN -->
            ${this.renderTemplateCards()}
            
            <!-- SEARCH & FILTER -->
            <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                <div style="display: flex; gap: 16px; align-items: center;">
                    <div style="flex: 1;">
                        <input type="text" 
                               id="scenario-search-input"
                               placeholder="Search scenarios by name, trigger, reply, or category..."
                               value="${this.escapeHtml(this.searchQuery)}"
                               onkeyup="aiCoreLiveScenariosManager.onSearchChange(this.value)"
                               style="width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px;">
                    </div>
                    <select id="status-filter" onchange="aiCoreLiveScenariosManager.onFilterChange(this.value)"
                            style="padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; cursor: pointer; min-width: 180px;">
                        <option value="all" ${this.currentFilter === 'all' ? 'selected' : ''}>All Scenarios</option>
                        <option value="enabled" ${this.currentFilter === 'enabled' ? 'selected' : ''}>✅ Enabled Only</option>
                        <option value="disabled" ${this.currentFilter === 'disabled' ? 'selected' : ''}>❌ Disabled Only</option>
                        <option disabled>──────────</option>
                        ${this.categories.map(cat => `<option value="${this.escapeHtml(cat)}" ${this.currentFilter === cat ? 'selected' : ''}>${this.escapeHtml(cat)}</option>`).join('')}
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
     * Render template cards showing per-template breakdown
     */
    renderTemplateCards() {
        if (!this.templatesUsed || this.templatesUsed.length === 0) {
            return '';
        }
        
        return `
            <div style="margin-bottom: 32px;">
                <h3 style="font-size: 18px; font-weight: 600; color: #111827; margin-bottom: 16px;">
                    📘 Active Templates (${this.templatesUsed.length})
                </h3>
                <div style="display: grid; gap: 16px;">
                    ${this.templatesUsed.map(template => `
                        <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; transition: all 0.2s;"
                             onmouseover="this.style.borderColor='#6366f1'; this.style.boxShadow='0 4px 12px rgba(99, 102, 241, 0.1)'"
                             onmouseout="this.style.borderColor='#e5e7eb'; this.style.boxShadow='none'">
                            
                            <!-- Template Header -->
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                                <div>
                                    <h4 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 4px 0;">
                                        📘 ${this.escapeHtml(template.templateName)}
                                    </h4>
                                    <div style="font-size: 12px; color: #6b7280;">
                                        <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-family: monospace;">
                                            ID: ${this.escapeHtml(template.templateId)}
                                        </code>
                                        <span style="margin: 0 8px; color: #d1d5db;">•</span>
                                        <span style="font-weight: 500;">Version: ${this.escapeHtml(template.version || 'v1.0.0')}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Template Stats -->
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px;">
                                <div style="text-align: center; padding: 12px; background: #fef3c7; border-radius: 8px;">
                                    <div style="font-size: 24px; font-weight: 700; color: #92400e;">
                                        ${template.categoriesCount || 0}
                                    </div>
                                    <div style="font-size: 12px; color: #78350f; margin-top: 4px;">
                                        Categories
                                    </div>
                                </div>
                                
                                <div style="text-align: center; padding: 12px; background: #dbeafe; border-radius: 8px;">
                                    <div style="font-size: 24px; font-weight: 700; color: #1e40af;">
                                        ${template.scenariosCount || 0}
                                    </div>
                                    <div style="font-size: 12px; color: #1e3a8a; margin-top: 4px;">
                                        Scenarios
                                    </div>
                                </div>
                                
                                <div style="text-align: center; padding: 12px; background: #dcfce7; border-radius: 8px;">
                                    <div style="font-size: 24px; font-weight: 700; color: #15803d;">
                                        ${template.triggersCount || 0}
                                    </div>
                                    <div style="font-size: 12px; color: #166534; margin-top: 4px;">
                                        Triggers
                                    </div>
                                </div>
                                
                                <div style="text-align: center; padding: 12px; background: #fee2e2; border-radius: 8px;">
                                    <div style="font-size: 24px; font-weight: 700; color: #991b1b;">
                                        ${template.disabledCount || 0}
                                    </div>
                                    <div style="font-size: 12px; color: #7f1d1d; margin-top: 4px;">
                                        Disabled
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    /**
     * Render scenarios grouped by category
     */
    renderScenarios() {
        // Filter scenarios
        let filtered = this.scenarios;
        
        // Apply status filter (enabled/disabled)
        if (this.currentFilter === 'enabled') {
            filtered = filtered.filter(s => s.isEnabledForCompany !== false);
        } else if (this.currentFilter === 'disabled') {
            filtered = filtered.filter(s => s.isEnabledForCompany === false);
        } else if (this.currentFilter !== 'all') {
            // Category filter
            filtered = filtered.filter(s => s.category === this.currentFilter);
        }
        
        // Apply search query
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(s => 
                (s.name && s.name.toLowerCase().includes(query)) ||
                (s.trigger && s.trigger.toLowerCase().includes(query)) ||
                (s.reply && s.reply.toLowerCase().includes(query)) ||
                (s.category && s.category.toLowerCase().includes(query)) ||
                (s.templateName && s.templateName.toLowerCase().includes(query))
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
        const isEnabled = scenario.isEnabledForCompany !== false;
        const confidence = scenario.avgConfidence ? (scenario.avgConfidence * 100).toFixed(0) : '--';
        const usageCount = scenario.usageCount || 0;
        
        const confidenceColor = scenario.avgConfidence >= 0.8 ? '#10b981' : 
                                scenario.avgConfidence >= 0.6 ? '#f59e0b' : '#ef4444';
        
        // Construct unique toggle ID
        const toggleId = `toggle-${scenario.templateId}-${scenario.scenarioId}`;
        
        return `
            <div style="background: ${isEnabled ? '#f9fafb' : '#fef2f2'}; border: 2px solid ${isEnabled ? '#e5e7eb' : '#fecaca'}; border-radius: 8px; padding: 16px; transition: all 0.2s; ${!isEnabled ? 'opacity: 0.7;' : ''}"
                 onmouseover="this.style.borderColor='${isEnabled ? '#6366f1' : '#ef4444'}'; this.style.boxShadow='0 2px 8px rgba(99,102,241,0.1)'"
                 onmouseout="this.style.borderColor='${isEnabled ? '#e5e7eb' : '#fecaca'}'; this.style.boxShadow='none'">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                            <!-- TOGGLE SWITCH -->
                            <label style="position: relative; display: inline-block; width: 50px; height: 24px; cursor: pointer;">
                                <input type="checkbox" 
                                       id="${toggleId}"
                                       ${isEnabled ? 'checked' : ''}
                                       onchange="aiCoreLiveScenariosManager.toggleScenario('${scenario.templateId}', '${scenario.scenarioId}', this.checked)"
                                       style="opacity: 0; width: 0; height: 0;">
                                <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isEnabled ? '#10b981' : '#ef4444'}; transition: 0.3s; border-radius: 24px;">
                                    <span style="position: absolute; content: ''; height: 18px; width: 18px; left: ${isEnabled ? '26px' : '3px'}; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%;"></span>
                                </span>
                            </label>
                            
                            <div style="font-size: 16px; font-weight: 600; color: ${isEnabled ? '#1f2937' : '#991b1b'};">
                                ${this.escapeHtml(scenario.name || scenario.trigger)}
                            </div>
                            
                            ${!isEnabled ? `
                                <span style="background: #ef4444; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
                                    DISABLED
                                </span>
                            ` : ''}
                        </div>
                        
                        <div style="font-size: 14px; color: #6b7280; margin-bottom: 4px;">
                            🎯 Trigger: <strong>${this.escapeHtml(scenario.trigger)}</strong>
                        </div>
                        
                        <div style="font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 8px;">
                            💬 ${this.escapeHtml(scenario.reply).substring(0, 200)}${scenario.reply.length > 200 ? '...' : ''}
                        </div>
                        
                        <div style="font-size: 13px; color: #6b7280;">
                            📚 Template: <strong>${this.escapeHtml(scenario.templateName)}</strong>
                            ${scenario.disabledBy ? ` • Disabled by ${this.escapeHtml(scenario.disabledBy)}` : ''}
                        </div>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-left: 16px;">
                        <div style="background: ${confidenceColor}; color: white; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; text-align: center; white-space: nowrap;">
                            ${confidence}%
                        </div>
                        <div style="background: #6366f1; color: white; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; text-align: center; white-space: nowrap;">
                            ${usageCount} uses
                        </div>
                    </div>
                </div>
                
                <div style="padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
                    <strong>Note:</strong> Scenario content is read-only. To edit triggers or replies, go to <strong>Global AI Brain → Templates</strong>.
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
     * Toggle scenario ON/OFF for this company
     * @param {String} templateId - Template ID
     * @param {String} scenarioId - Scenario ID
     * @param {Boolean} isEnabled - New enabled state
     */
    async toggleScenario(templateId, scenarioId, isEnabled) {
        console.log(`🎯 [LIVE SCENARIOS] Toggle scenario: template=${templateId}, scenario=${scenarioId}, enabled=${isEnabled}`);
        
        const toggleId = `toggle-${templateId}-${scenarioId}`;
        const checkbox = document.getElementById(toggleId);
        
        try {
            // Optimistic UI update
            const originalState = !isEnabled;
            
            const url = `/api/aicore/${this.companyId}/scenarios/${templateId}/${scenarioId}`;
            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                },
                body: JSON.stringify({ isEnabled })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Toggle failed');
            }
            
            console.log(`✅ [LIVE SCENARIOS] Scenario ${isEnabled ? 'enabled' : 'disabled'} successfully`);
            
            // Show success toast
            this.showToast(
                isEnabled ? '✅ Scenario Enabled' : '❌ Scenario Disabled',
                `This scenario is now ${isEnabled ? 'active' : 'inactive'} for runtime matching.`,
                'success'
            );
            
            // Reload to reflect changes
            await this.load();
            
        } catch (error) {
            console.error('❌ [LIVE SCENARIOS] Toggle failed:', error);
            
            // Revert checkbox state on error
            if (checkbox) {
                checkbox.checked = !isEnabled;
            }
            
            // Show error toast
            this.showToast(
                '❌ Toggle Failed',
                `Could not ${isEnabled ? 'enable' : 'disable'} scenario: ${error.message}`,
                'error'
            );
        }
    }
    
    /**
     * Show toast notification
     */
    showToast(title, message, type = 'info') {
        // Simple toast implementation
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#6366f1'};
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            max-width: 400px;
            animation: slideIn 0.3s ease-out;
        `;
        toast.innerHTML = `
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">${title}</div>
            <div style="font-size: 13px; opacity: 0.9;">${message}</div>
        `;
        document.body.appendChild(toast);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
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
     * Render empty state (no scenarios)
     */
    renderEmptyState() {
        const container = document.getElementById('ai-settings-aicore-live-scenarios-content');
        if (!container) return;
        
        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; min-height: 400px;">
                <div style="text-align: center; max-width: 600px; padding: 40px;">
                    <div style="font-size: 80px; margin-bottom: 24px; opacity: 0.3;">🎭</div>
                    
                    <h3 style="font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 12px;">
                        No Live Scenarios Yet
                    </h3>
                    
                    <p style="font-size: 16px; color: #6b7280; line-height: 1.6; margin-bottom: 32px;">
                        We checked, but there are no active scenarios available. Scenarios come from activated 
                        Global AI Brain templates. Once you activate a template, all its scenarios will appear 
                        here for you to browse, search, and test.
                    </p>
                    
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; color: white; text-align: left; margin-bottom: 24px;">
                        <h4 style="font-size: 16px; font-weight: 700; margin-bottom: 12px;">
                            💡 What are Live Scenarios?
                        </h4>
                        <p style="font-size: 14px; line-height: 1.6; margin-bottom: 12px;">
                            Scenarios are pre-built conversation flows that teach your AI how to handle specific 
                            customer questions like booking appointments, answering FAQs, providing hours, and more.
                        </p>
                        <p style="font-size: 14px; line-height: 1.6;">
                            Each template contains dozens of scenarios organized by category (Booking, Hours, Pricing, etc.)
                        </p>
                    </div>
                    
                    <div style="padding: 20px; background: #f9fafb; border-radius: 8px; border: 2px dashed #e5e7eb;">
                        <p style="font-size: 14px; color: #6b7280; margin-bottom: 12px;">
                            <strong style="color: #111827;">🚀 To see live scenarios:</strong>
                        </p>
                        <ol style="text-align: left; font-size: 14px; color: #6b7280; line-height: 1.8; padding-left: 20px;">
                            <li>Go to the <strong>AiCore Templates</strong> tab</li>
                            <li>Click <strong>Activate</strong> on a template (e.g., "Universal AI Brain")</li>
                            <li>Come back here to see all scenarios from that template</li>
                            <li>Browse, search, and test scenarios in real-time</li>
                        </ol>
                        <button onclick="window.aiCoreLiveScenariosManager.goToTemplates()" style="margin-top: 16px; padding: 12px 24px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;">
                            Go to AiCore Templates →
                        </button>
                    </div>
                </div>
            </div>
        `;
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

