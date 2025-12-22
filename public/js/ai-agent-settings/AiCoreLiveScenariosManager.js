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
        
        // ═══════════════════════════════════════════════════════════════════
        // SCOPE LOCK INFO (Multi-tenant protection)
        // ═══════════════════════════════════════════════════════════════════
        const scope = scenario.scope || 'GLOBAL';
        const isLocked = scope === 'GLOBAL'; // GLOBAL = read-only in company context
        const isOverride = scope === 'COMPANY';
        const ownerCompanyId = scenario.ownerCompanyId || null;
        
        // Scope pill rendering
        const scopePillHtml = scope === 'GLOBAL' 
            ? `<span style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px;">
                   🌐 GLOBAL
               </span>`
            : `<span style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px;">
                   🏢 OVERRIDE
               </span>`;
        
        // Locked banner for GLOBAL scenarios
        const lockedBannerHtml = isLocked ? `
            <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 14px;">🔒</span>
                    <span style="font-size: 12px; color: #92400e; font-weight: 500;">
                        GLOBAL shared scenario — editing locked to prevent contamination
                    </span>
                </div>
                <button onclick="aiCoreLiveScenariosManager.cloneScenarioToCompany('${scenario.templateId}', '${scenario.categoryId || ''}', '${scenario.scenarioId}')"
                        style="background: #f59e0b; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;">
                    Clone to Override
                </button>
            </div>
        ` : '';
        
        // Override badge for company-owned scenarios
        const overrideBadgeHtml = isOverride ? `
            <div style="background: #d1fae5; border: 1px solid #10b981; border-radius: 6px; padding: 6px 10px; margin-bottom: 12px;">
                <span style="font-size: 12px; color: #065f46; font-weight: 500;">
                    ✅ Company override — safe to edit
                </span>
            </div>
        ` : '';
        
        // Construct unique toggle ID
        const toggleId = `toggle-${scenario.templateId}-${scenario.scenarioId}`;
        
        return `
            <div style="background: ${isEnabled ? '#f9fafb' : '#fef2f2'}; border: 2px solid ${isEnabled ? '#e5e7eb' : '#fecaca'}; border-radius: 8px; padding: 16px; transition: all 0.2s; ${!isEnabled ? 'opacity: 0.7;' : ''}"
                 onmouseover="this.style.borderColor='${isEnabled ? '#6366f1' : '#ef4444'}'; this.style.boxShadow='0 2px 8px rgba(99,102,241,0.1)'"
                 onmouseout="this.style.borderColor='${isEnabled ? '#e5e7eb' : '#fecaca'}'; this.style.boxShadow='none'">
                
                ${lockedBannerHtml}
                ${overrideBadgeHtml}
                
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap;">
                            <!-- TOGGLE SWITCH -->
                            <label style="position: relative; display: inline-block; width: 50px; height: 24px; cursor: pointer;">
                                <input type="checkbox" 
                                       id="${toggleId}"
                                       ${isEnabled ? 'checked' : ''}
                                       onchange="aiCoreLiveScenariosManager.toggleScenario('${scenario.templateId}', '${scenario.scenarioId}', this.checked, '${scenario.categoryId || ''}', '${this.escapeHtml(scenario.name || scenario.trigger).replace(/'/g, "\\'")}')"
                                       style="opacity: 0; width: 0; height: 0;">
                                <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isEnabled ? '#10b981' : '#ef4444'}; transition: 0.3s; border-radius: 24px;">
                                    <span style="position: absolute; content: ''; height: 18px; width: 18px; left: ${isEnabled ? '26px' : '3px'}; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%;"></span>
                                </span>
                            </label>
                            
                            <div style="font-size: 16px; font-weight: 600; color: ${isEnabled ? '#1f2937' : '#991b1b'};">
                                ${this.escapeHtml(scenario.name || scenario.trigger)}
                            </div>
                            
                            <!-- SCOPE PILL -->
                            ${scopePillHtml}
                            
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
                    ${isLocked 
                        ? `<strong>🔒 Read-only:</strong> This is GLOBAL shared content. Click "Clone to Override" to make editable changes for this company only.`
                        : `<strong>✏️ Editable:</strong> This is a company-specific override. Changes only affect this company.`
                    }
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
     * @param {String} categoryId - Category ID (for disable modal)
     * @param {String} scenarioName - Scenario name (for display)
     */
    async toggleScenario(templateId, scenarioId, isEnabled, categoryId = null, scenarioName = '') {
        console.log(`🎯 [LIVE SCENARIOS] Toggle scenario: template=${templateId}, scenario=${scenarioId}, enabled=${isEnabled}`);
        
        const toggleId = `toggle-${templateId}-${scenarioId}`;
        const checkbox = document.getElementById(toggleId);
        
        // If DISABLING, show modal for alternate reply configuration
        if (!isEnabled) {
            // Revert checkbox for now (modal will handle final state)
            if (checkbox) checkbox.checked = true;
            
            this.showDisableScenarioModal(templateId, scenarioId, categoryId, scenarioName);
            return;
        }
        
        // ENABLING - call API directly
        try {
            const url = `/api/company/${this.companyId}/overrides/scenarios/${scenarioId}/enable`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Enable failed');
            }
            
            console.log(`✅ [LIVE SCENARIOS] Scenario enabled successfully`);
            
            this.showToast('✅ Scenario Enabled', 'This scenario is now active for runtime matching.', 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [LIVE SCENARIOS] Enable failed:', error);
            if (checkbox) checkbox.checked = false;
            this.showToast('❌ Enable Failed', `Could not enable scenario: ${error.message}`, 'error');
        }
    }
    
    /**
     * Show modal for disabling a scenario with alternate reply options
     * Per December 2025 Directive: Deterministic fallback, NO LLM required
     */
    showDisableScenarioModal(templateId, scenarioId, categoryId, scenarioName) {
        // Remove existing modal if any
        const existingModal = document.getElementById('disable-scenario-modal');
        if (existingModal) existingModal.remove();
        
        const modal = document.createElement('div');
        modal.id = 'disable-scenario-modal';
        modal.innerHTML = `
            <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 10000; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 16px; width: 90%; max-width: 600px; max-height: 90vh; overflow-y: auto; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);">
                    
                    <!-- Header -->
                    <div style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-radius: 16px 16px 0 0;">
                        <h3 style="margin: 0; color: white; font-size: 18px; font-weight: 600;">
                            🚫 Disable Scenario
                        </h3>
                        <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">
                            "${scenarioName || 'This scenario'}"
                        </p>
                    </div>
                    
                    <!-- Body -->
                    <div style="padding: 24px;">
                        
                        <!-- Explanation -->
                        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                            <p style="margin: 0; font-size: 14px; color: #92400e;">
                                <strong>🧠 What happens when disabled?</strong><br>
                                When a caller triggers this scenario, the system will use your configured fallback reply instead of the normal response. <strong>No LLM guessing required.</strong>
                            </p>
                        </div>
                        
                        <!-- Fallback Preference -->
                        <div style="margin-bottom: 20px;">
                            <label style="display: block; font-weight: 600; margin-bottom: 12px; color: #1f2937;">
                                Fallback Preference
                            </label>
                            
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <label style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; cursor: pointer; transition: all 0.2s;" 
                                       onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e2e8f0'">
                                    <input type="radio" name="fallbackPreference" value="COMPANY" checked 
                                           style="margin-top: 2px; accent-color: #3b82f6;">
                                    <div>
                                        <strong style="color: #1f2937;">Use Company Default</strong>
                                        <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">
                                            Use the company's "Not Offered" reply. Best for services you don't provide.
                                        </p>
                                    </div>
                                </label>
                                
                                <label style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; cursor: pointer; transition: all 0.2s;"
                                       onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e2e8f0'">
                                    <input type="radio" name="fallbackPreference" value="CATEGORY"
                                           style="margin-top: 2px; accent-color: #3b82f6;">
                                    <div>
                                        <strong style="color: #1f2937;">Use Category Default</strong>
                                        <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">
                                            Use the category's disabled reply. Good when whole category is limited.
                                        </p>
                                    </div>
                                </label>
                                
                                <label style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; cursor: pointer; transition: all 0.2s;"
                                       onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor=this.querySelector('input').checked?'#3b82f6':'#e2e8f0'">
                                    <input type="radio" name="fallbackPreference" value="SCENARIO"
                                           style="margin-top: 2px; accent-color: #3b82f6;">
                                    <div>
                                        <strong style="color: #1f2937;">Use Custom Alternate Reply</strong>
                                        <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">
                                            Write a specific reply for this scenario. Most precise control.
                                        </p>
                                    </div>
                                </label>
                            </div>
                        </div>
                        
                        <!-- Custom Alternate Reply (shown when SCENARIO is selected) -->
                        <div id="custom-reply-section" style="display: none; margin-bottom: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                            <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #1f2937;">
                                Custom Alternate Reply
                            </label>
                            
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 13px; color: #6b7280; margin-bottom: 4px;">
                                    Quick Reply (short, for fast responses)
                                </label>
                                <input type="text" id="disable-quick-reply" 
                                       placeholder="e.g., I'm sorry, we don't offer that service right now."
                                       style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                            </div>
                            
                            <div>
                                <label style="display: block; font-size: 13px; color: #6b7280; margin-bottom: 4px;">
                                    Full Reply (detailed response) <span style="color: #ef4444;">*</span>
                                </label>
                                <textarea id="disable-full-reply" rows="4"
                                          placeholder="e.g., I apologize, but we don't currently offer that service. However, I can help you with... Is there anything else I can assist you with today?"
                                          style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; resize: vertical;"></textarea>
                            </div>
                        </div>
                        
                        <!-- Notes -->
                        <div style="margin-bottom: 20px;">
                            <label style="display: block; font-size: 13px; color: #6b7280; margin-bottom: 4px;">
                                Notes (optional, for audit trail)
                            </label>
                            <input type="text" id="disable-notes" 
                                   placeholder="e.g., Temporarily disabled for Q4 promotion"
                                   style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                        </div>
                        
                    </div>
                    
                    <!-- Footer -->
                    <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 12px; background: #f8fafc; border-radius: 0 0 16px 16px;">
                        <button onclick="document.getElementById('disable-scenario-modal').remove()" 
                                style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; color: #374151; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;">
                            Cancel
                        </button>
                        <button onclick="aiCoreLiveScenariosManager.confirmDisableScenario('${templateId}', '${scenarioId}', '${categoryId}')"
                                style="padding: 10px 20px; border: none; background: #ef4444; color: white; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;">
                            🚫 Disable Scenario
                        </button>
                    </div>
                    
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add event listener to show/hide custom reply section
        const radios = modal.querySelectorAll('input[name="fallbackPreference"]');
        const customSection = modal.querySelector('#custom-reply-section');
        
        radios.forEach(radio => {
            radio.addEventListener('change', () => {
                customSection.style.display = radio.value === 'SCENARIO' ? 'block' : 'none';
            });
        });
    }
    
    /**
     * Confirm and execute scenario disable
     */
    async confirmDisableScenario(templateId, scenarioId, categoryId) {
        const modal = document.getElementById('disable-scenario-modal');
        
        const fallbackPreference = modal.querySelector('input[name="fallbackPreference"]:checked')?.value || 'COMPANY';
        const quickReply = modal.querySelector('#disable-quick-reply')?.value?.trim() || null;
        const fullReply = modal.querySelector('#disable-full-reply')?.value?.trim() || null;
        const notes = modal.querySelector('#disable-notes')?.value?.trim() || null;
        
        // Validate: if SCENARIO fallback, fullReply is required
        if (fallbackPreference === 'SCENARIO' && !fullReply) {
            alert('Please provide a Full Reply when using custom alternate reply.');
            return;
        }
        
        try {
            const url = `/api/company/${this.companyId}/overrides/scenarios/${scenarioId}/disable`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                },
                body: JSON.stringify({
                    templateId,
                    categoryId,
                    quickReply,
                    fullReply,
                    fallbackPreference,
                    notes
                })
            });
            
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Disable failed');
            }
            
            console.log('✅ [LIVE SCENARIOS] Scenario disabled with override:', data);
            
            modal.remove();
            this.showToast('🚫 Scenario Disabled', 'Alternate reply configured. No LLM guessing required.', 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [LIVE SCENARIOS] Disable failed:', error);
            this.showToast('❌ Disable Failed', error.message, 'error');
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
     * Clone a GLOBAL scenario to COMPANY override
     * This creates an editable copy for this company only
     */
    async cloneScenarioToCompany(templateId, categoryId, scenarioId) {
        console.log(`🔀 [LIVE SCENARIOS] Cloning scenario ${scenarioId} to company override...`);
        
        // Show confirmation
        const confirmed = confirm(
            `Clone this GLOBAL scenario to a COMPANY override?\n\n` +
            `This will create an editable copy that only affects this company. ` +
            `The original GLOBAL scenario will remain unchanged for other tenants.`
        );
        
        if (!confirmed) {
            console.log('🔀 [LIVE SCENARIOS] Clone cancelled by user');
            return;
        }
        
        try {
            const url = `/api/company/${this.companyId}/scenarios/${templateId}/${categoryId}/${scenarioId}/clone`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            const data = await response.json();
            console.log('✅ [LIVE SCENARIOS] Scenario cloned successfully:', data);
            
            this.showToast('✅ Scenario cloned! You can now edit it safely.');
            
            // Refresh to show new override
            await this.refresh();
            
        } catch (error) {
            console.error('❌ [LIVE SCENARIOS] Clone failed:', error);
            alert(`Failed to clone scenario: ${error.message}`);
        }
    }
    
    /**
     * Clone a GLOBAL category to COMPANY override (with all scenarios)
     */
    async cloneCategoryToCompany(templateId, categoryId) {
        console.log(`🔀 [LIVE SCENARIOS] Cloning category ${categoryId} to company override...`);
        
        const confirmed = confirm(
            `Clone this GLOBAL category (with all scenarios) to a COMPANY override?\n\n` +
            `This will create an editable copy of the entire category and all its scenarios ` +
            `for this company only.`
        );
        
        if (!confirmed) {
            console.log('🔀 [LIVE SCENARIOS] Clone cancelled by user');
            return;
        }
        
        try {
            const url = `/api/company/${this.companyId}/categories/${templateId}/${categoryId}/clone`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            const data = await response.json();
            console.log('✅ [LIVE SCENARIOS] Category cloned successfully:', data);
            
            this.showToast(`✅ Category cloned with ${data.data.scenariosCloned} scenarios!`);
            
            // Refresh to show new overrides
            await this.refresh();
            
        } catch (error) {
            console.error('❌ [LIVE SCENARIOS] Clone failed:', error);
            alert(`Failed to clone category: ${error.message}`);
        }
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

// Expose globally for Control Plane onclick handlers
if (typeof window !== 'undefined') {
    window.AiCoreLiveScenariosManager = AiCoreLiveScenariosManager;
    console.log('✅ [AICORE LIVE SCENARIOS] Class exported to window.AiCoreLiveScenariosManager');
}

