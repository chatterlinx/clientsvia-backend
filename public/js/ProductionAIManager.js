// ============================================================================
// 🚀 PRODUCTION AI MANAGER
// ============================================================================
// PURPOSE: Frontend manager for Production AI health monitoring & settings
// FEATURES: LLM health checks, company settings, system metrics, real-time status
// DOCUMENTATION: /docs/PRODUCTION-AI-CORE-INTEGRATION.md
// ============================================================================

class ProductionAIManager {
    constructor() {
        this.token = localStorage.getItem('adminToken');
        this.currentCompanyId = null;
        this.healthCheckInterval = null;
        this.AUTO_REFRESH_INTERVAL = 30000; // 30 seconds
        
        console.log('✅ [PRODUCTION AI] Manager initialized');
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🟢 SYSTEM HEALTH CHECKS
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Test OpenAI connection (manual button click)
     */
    async testOpenAIConnection() {
        console.log('[PRODUCTION AI] Testing OpenAI connection...');
        
        try {
            const response = await fetch('/api/admin/production-ai/health/openai', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            console.log('[PRODUCTION AI] OpenAI health check result:', result);
            
            // Update UI
            this.updateLLMStatus(result.status, result.responseTime, result.model);
            
            // Show toast
            if (result.status === 'HEALTHY') {
                window.toastManager.success(`✅ OpenAI Connected! Response time: ${result.responseTime}ms | Model: ${result.model || 'gpt-4'}`);
            } else if (result.status === 'NOT_CONFIGURED') {
                window.toastManager.warning('⚠️ OpenAI Not Configured - Add OPENAI_API_KEY to environment variables');
            } else {
                window.toastManager.error(`❌ OpenAI Connection Failed: ${result.error || 'Unknown error'}`);
            }
            
        } catch (error) {
            console.error('[PRODUCTION AI] OpenAI health check failed:', error);
            this.updateLLMStatus('ERROR', null, null);
            window.toastManager.error(`❌ Failed to check OpenAI connection: ${error.message}`);
            
            // Report to notification center
            FrontendErrorReporter.reportError({
                page: 'Production AI',
                action: 'test_openai_connection',
                error: error.message,
                severity: 'WARNING'
            });
        }
    }

    /**
     * Run full system health check
     */
    async runFullHealthCheck() {
        console.log('[PRODUCTION AI] Running full health check...');
        
        try {
            const response = await fetch('/api/admin/production-ai/health/full', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            console.log('[PRODUCTION AI] Full health check result:', result);
            
            // Update all health indicators
            if (result.health) {
                if (result.health.llm) {
                    this.updateLLMStatus(result.health.llm.status, result.health.llm.responseTime, result.health.llm.model);
                }
                if (result.health.database) {
                    this.updateDatabaseStatus(result.health.database.status, result.health.database.queryTime);
                }
                if (result.health.cache) {
                    this.updateRedisStatus(result.health.cache.status, result.health.cache.latency);
                }
            }
            
            window.toastManager.success('✅ Full health check complete - All systems checked');
            
        } catch (error) {
            console.error('[PRODUCTION AI] Full health check failed:', error);
            window.toastManager.error(`❌ Health check failed: ${error.message}`);
            
            FrontendErrorReporter.reportError({
                page: 'Production AI',
                action: 'full_health_check',
                error: error.message,
                severity: 'WARNING'
            });
        }
    }

    /**
     * Refresh health status (quick check)
     */
    async refreshHealthStatus() {
        console.log('[PRODUCTION AI] Refreshing health status...');
        await this.testOpenAIConnection();
        window.toastManager.success('✅ Health status refreshed');
    }

    /**
     * Start auto-refresh health status
     */
    startAutoRefresh() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        
        this.healthCheckInterval = setInterval(() => {
            console.log('[PRODUCTION AI] Auto-refresh health status...');
            this.testOpenAIConnection();
        }, this.AUTO_REFRESH_INTERVAL);
        
        console.log(`[PRODUCTION AI] Auto-refresh started (${this.AUTO_REFRESH_INTERVAL / 1000}s interval)`);
    }

    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            console.log('[PRODUCTION AI] Auto-refresh stopped');
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🎨 UI UPDATE METHODS
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Update LLM status indicator
     */
    updateLLMStatus(status, responseTime, model) {
        const indicator = document.getElementById('llm-status-indicator');
        const text = document.getElementById('llm-status-text');
        const timeEl = document.getElementById('llm-response-time');
        
        if (!indicator || !text) return;
        
        // Remove all status classes
        indicator.classList.remove('bg-green-500', 'bg-yellow-500', 'bg-red-500', 'bg-gray-400', 'animate-pulse');
        
        if (status === 'HEALTHY') {
            indicator.classList.add('bg-green-500', 'animate-pulse');
            text.textContent = '✅ Connected';
            text.classList.remove('text-gray-900', 'text-yellow-900', 'text-red-900');
            text.classList.add('text-green-900');
            if (timeEl && responseTime) {
                timeEl.textContent = `Response time: ${responseTime}ms${model ? ' | ' + model : ''}`;
            }
        } else if (status === 'NOT_CONFIGURED') {
            indicator.classList.add('bg-yellow-500');
            text.textContent = '⚙️ Not Configured';
            text.classList.remove('text-gray-900', 'text-green-900', 'text-red-900');
            text.classList.add('text-yellow-900');
            if (timeEl) {
                timeEl.textContent = 'Add OPENAI_API_KEY to enable';
            }
        } else if (status === 'ERROR' || status === 'DOWN') {
            indicator.classList.add('bg-red-500');
            text.textContent = '❌ Error';
            text.classList.remove('text-gray-900', 'text-green-900', 'text-yellow-900');
            text.classList.add('text-red-900');
            if (timeEl) {
                timeEl.textContent = 'Connection failed';
            }
        } else {
            indicator.classList.add('bg-gray-400');
            text.textContent = 'Unknown';
            text.classList.add('text-gray-900');
        }
    }

    /**
     * Update Database status indicator
     */
    updateDatabaseStatus(status, queryTime) {
        const indicator = document.getElementById('db-status-indicator');
        const text = document.getElementById('db-status-text');
        const timeEl = document.getElementById('db-query-time');
        
        if (!indicator || !text) return;
        
        indicator.classList.remove('bg-green-500', 'bg-red-500', 'bg-gray-400');
        
        if (status === 'HEALTHY') {
            indicator.classList.add('bg-green-500');
            text.textContent = '✅ Connected';
            if (timeEl && queryTime) {
                timeEl.textContent = `Query time: ${queryTime}ms`;
            }
        } else {
            indicator.classList.add('bg-red-500');
            text.textContent = '❌ Error';
        }
    }

    /**
     * Update Redis status indicator
     */
    updateRedisStatus(status, latency) {
        const indicator = document.getElementById('redis-status-indicator');
        const text = document.getElementById('redis-status-text');
        const timeEl = document.getElementById('redis-latency');
        
        if (!indicator || !text) return;
        
        indicator.classList.remove('bg-green-500', 'bg-red-500', 'bg-gray-400');
        
        if (status === 'HEALTHY') {
            indicator.classList.add('bg-green-500');
            text.textContent = '✅ Connected';
            if (timeEl && latency) {
                timeEl.textContent = `Latency: ${latency}ms`;
            }
        } else {
            indicator.classList.add('bg-red-500');
            text.textContent = '❌ Error';
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🏢 COMPANY SETTINGS MANAGEMENT
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Load all companies into selector
     */
    async loadCompanies() {
        console.log('[PRODUCTION AI] Loading companies...');
        
        try {
            const response = await fetch('/api/companies', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            const selector = document.getElementById('prod-ai-company-selector');
            if (!selector) return;
            
            // Clear existing options (except first one)
            while (selector.options.length > 1) {
                selector.remove(1);
            }
            
            // Add companies
            if (result.data && Array.isArray(result.data)) {
                result.data.forEach(company => {
                    const option = document.createElement('option');
                    option.value = company._id;
                    option.textContent = company.companyName;
                    selector.appendChild(option);
                });
                
                console.log(`[PRODUCTION AI] Loaded ${result.data.length} companies`);
            }
            
        } catch (error) {
            console.error('[PRODUCTION AI] Failed to load companies:', error);
            window.toastManager.error(`❌ Failed to load companies: ${error.message}`);
        }
    }

    /**
     * Load company-specific settings
     */
    async loadCompanySettings(companyId) {
        if (!companyId) {
            document.getElementById('company-settings-panel').classList.add('hidden');
            return;
        }
        
        console.log('[PRODUCTION AI] Loading settings for company:', companyId);
        this.currentCompanyId = companyId;
        
        try {
            const response = await fetch(`/api/admin/production-ai/settings/${companyId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            console.log('[PRODUCTION AI] Company settings:', result);
            
            // Show settings panel
            document.getElementById('company-settings-panel').classList.remove('hidden');
            
            // Populate form fields
            const gatekeeper = result.settings.templateGatekeeper || {};
            
            document.getElementById('gatekeeper-enabled').checked = gatekeeper.enabled || false;
            document.getElementById('tier1-threshold').value = gatekeeper.tier1Threshold || 0.70;
            document.getElementById('tier2-threshold').value = gatekeeper.tier2Threshold || 0.60;
            document.getElementById('llm-fallback-enabled').checked = gatekeeper.enableLLMFallback || false;
            document.getElementById('monthly-budget').value = gatekeeper.monthlyBudget || 0;
            
            // Update metrics
            const currentSpend = gatekeeper.currentSpend || 0;
            const monthlyBudget = gatekeeper.monthlyBudget || 0;
            const remaining = monthlyBudget - currentSpend;
            const percentage = monthlyBudget > 0 ? ((currentSpend / monthlyBudget) * 100).toFixed(1) : 0;
            
            document.getElementById('current-spend').textContent = `$${currentSpend.toFixed(2)}`;
            document.getElementById('spend-percentage').textContent = `${percentage}% of budget`;
            document.getElementById('budget-remaining').textContent = `$${remaining.toFixed(2)}`;
            
            // Load company metrics
            await this.loadCompanyMetrics(companyId);
            
        } catch (error) {
            console.error('[PRODUCTION AI] Failed to load company settings:', error);
            window.toastManager.error(`❌ Failed to load company settings: ${error.message}`);
            
            FrontendErrorReporter.reportError({
                page: 'Production AI',
                action: 'load_company_settings',
                error: error.message,
                companyId,
                severity: 'WARNING'
            });
        }
    }

    /**
     * Load company metrics (fallback rate, tier usage)
     */
    async loadCompanyMetrics(companyId) {
        try {
            const response = await fetch(`/api/admin/production-ai/metrics/${companyId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn('[PRODUCTION AI] Metrics not available yet');
                return;
            }

            const result = await response.json();
            
            console.log('[PRODUCTION AI] Company metrics:', result);
            
            // Update fallback rate
            if (result.metrics.fallbackRate !== undefined) {
                const rate = (result.metrics.fallbackRate * 100).toFixed(1);
                document.getElementById('fallback-rate').textContent = `${rate}%`;
            }
            
        } catch (error) {
            console.warn('[PRODUCTION AI] Failed to load metrics:', error.message);
        }
    }

    /**
     * Toggle gatekeeper enabled/disabled
     */
    toggleGatekeeper(enabled) {
        console.log('[PRODUCTION AI] Gatekeeper toggled:', enabled);
        // Value will be saved when user clicks "Save Gatekeeper Settings"
    }

    /**
     * Save gatekeeper settings
     */
    async saveGatekeeperSettings() {
        if (!this.currentCompanyId) {
            window.toastManager.error('❌ No company selected');
            return;
        }
        
        console.log('[PRODUCTION AI] Saving gatekeeper settings for company:', this.currentCompanyId);
        
        try {
            const settings = {
                enabled: document.getElementById('gatekeeper-enabled').checked,
                tier1Threshold: parseFloat(document.getElementById('tier1-threshold').value),
                tier2Threshold: parseFloat(document.getElementById('tier2-threshold').value),
                enableLLMFallback: document.getElementById('llm-fallback-enabled').checked,
                monthlyBudget: parseFloat(document.getElementById('monthly-budget').value)
            };
            
            console.log('[PRODUCTION AI] Saving settings:', settings);
            
            const response = await fetch(`/api/admin/production-ai/settings/${this.currentCompanyId}/gatekeeper`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                    'Idempotency-Key': `gatekeeper-save-${this.currentCompanyId}-${Date.now()}`
                },
                body: JSON.stringify(settings)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            
            console.log('[PRODUCTION AI] Settings saved:', result);
            
            window.toastManager.success('✅ Gatekeeper settings saved successfully!');
            
            // Reload settings to show updated values
            await this.loadCompanySettings(this.currentCompanyId);
            
        } catch (error) {
            console.error('[PRODUCTION AI] Failed to save settings:', error);
            window.toastManager.error(`❌ Failed to save settings: ${error.message}`);
            
            FrontendErrorReporter.reportError({
                page: 'Production AI',
                action: 'save_gatekeeper_settings',
                error: error.message,
                companyId: this.currentCompanyId,
                severity: 'CRITICAL'
            });
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 📊 SYSTEM-WIDE METRICS
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Load system-wide performance metrics
     */
    async loadSystemMetrics() {
        console.log('[PRODUCTION AI] Loading system-wide metrics...');
        
        try {
            const response = await fetch('/api/admin/production-ai/metrics/system', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn('[PRODUCTION AI] System metrics not available yet');
                return;
            }

            const result = await response.json();
            
            console.log('[PRODUCTION AI] System metrics:', result);
            
            // Update UI with metrics
            if (result.metrics.gatekeeper) {
                const g = result.metrics.gatekeeper;
                const total = g.tier1Calls + g.tier2Calls + g.tier3Calls;
                
                if (total > 0) {
                    const tier1Rate = ((g.tier1Calls / total) * 100).toFixed(1);
                    const tier2Rate = ((g.tier2Calls / total) * 100).toFixed(1);
                    
                    document.getElementById('tier1-success').textContent = `${tier1Rate}%`;
                    document.getElementById('tier2-success').textContent = `${tier2Rate}%`;
                    document.getElementById('tier3-calls').textContent = g.tier3Calls;
                    
                    if (g.avgResponseTime) {
                        document.getElementById('avg-response-time').textContent = `${g.avgResponseTime}ms`;
                    }
                }
            }
            
        } catch (error) {
            console.warn('[PRODUCTION AI] Failed to load system metrics:', error.message);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 💡 SUGGESTIONS MANAGEMENT
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Load suggestions for the selected template
     */
    async loadSuggestions(page = 1) {
        console.log('[PRODUCTION AI] Loading suggestions (page', page, ')...');
        
        try {
            // Show loading skeleton
            document.getElementById('suggestions-loading-skeleton').classList.remove('hidden');
            document.getElementById('suggestions-empty-state').classList.add('hidden');
            
            // Get selected template
            const templateFilter = document.getElementById('production-ai-template-filter');
            const templateId = templateFilter.value;
            
            // Load stats
            const statsResponse = await fetch(`/api/admin/production-ai/suggestions/stats${templateId ? '?templateId=' + templateId : ''}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!statsResponse.ok) {
                throw new Error(`HTTP ${statsResponse.status}`);
            }
            
            const statsData = await statsResponse.json();
            
            // Update stats bar
            document.getElementById('suggestions-pending-count').textContent = statsData.stats.pending || 0;
            document.getElementById('suggestions-applied-count').textContent = statsData.stats.applied || 0;
            document.getElementById('suggestions-ignored-count').textContent = statsData.stats.ignored || 0;
            
            // Load suggestions
            if (!templateId) {
                // No template selected, show message
                document.getElementById('suggestions-loading-skeleton').classList.add('hidden');
                document.getElementById('suggestions-empty-state').classList.remove('hidden');
                document.getElementById('suggestions-empty-state').querySelector('p:first-of-type').textContent = 'Select a template to view suggestions';
                return;
            }
            
            const suggestionsResponse = await fetch(`/api/admin/production-ai/suggestions/${templateId}?page=${page}&limit=10`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!suggestionsResponse.ok) {
                throw new Error(`HTTP ${suggestionsResponse.status}`);
            }
            
            const suggestionsData = await suggestionsResponse.json();
            
            // Hide loading skeleton
            document.getElementById('suggestions-loading-skeleton').classList.add('hidden');
            
            // Clear container
            const container = document.getElementById('suggestions-container');
            if (page === 1) {
                container.innerHTML = '';
            }
            
            // Show empty state or render suggestions
            if (suggestionsData.suggestions.length === 0) {
                document.getElementById('suggestions-empty-state').classList.remove('hidden');
            } else {
                document.getElementById('suggestions-empty-state').classList.add('hidden');
                
                // Render each suggestion
                suggestionsData.suggestions.forEach(suggestion => {
                    this.renderSuggestionCard(suggestion, container);
                });
                
                // Show/hide "Load More" button
                const loadMoreContainer = document.getElementById('suggestions-load-more-container');
                if (suggestionsData.pagination.page < suggestionsData.pagination.pages) {
                    loadMoreContainer.classList.remove('hidden');
                } else {
                    loadMoreContainer.classList.add('hidden');
                }
                
                // Store current page
                this.currentSuggestionsPage = page;
            }
            
        } catch (error) {
            console.error('[PRODUCTION AI] Failed to load suggestions:', error);
            document.getElementById('suggestions-loading-skeleton').classList.add('hidden');
            window.toastManager.error(`❌ Failed to load suggestions: ${error.message}`);
        }
    }

    /**
     * Load more suggestions (pagination)
     */
    async loadMoreSuggestions() {
        const nextPage = (this.currentSuggestionsPage || 1) + 1;
        await this.loadSuggestions(nextPage);
    }

    /**
     * Render a single suggestion card
     * @param {Object} suggestion - Suggestion data
     * @param {HTMLElement} container - Container to append to
     */
    renderSuggestionCard(suggestion, container) {
        // Priority badge styling
        let priorityBadge = '';
        let priorityBorder = '';
        
        if (suggestion.priority === 'high') {
            priorityBadge = '<span class="inline-flex items-center px-2 py-1 bg-red-100 text-red-800 text-xs font-bold rounded"><i class="fas fa-fire mr-1"></i>High Priority (' + Math.round(suggestion.confidence * 100) + '% confidence)</span>';
            priorityBorder = 'border-l-4 border-red-500';
        } else if (suggestion.priority === 'medium') {
            priorityBadge = '<span class="inline-flex items-center px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-bold rounded"><i class="fas fa-exclamation-circle mr-1"></i>Medium Priority (' + Math.round(suggestion.confidence * 100) + '% confidence)</span>';
            priorityBorder = 'border-l-4 border-yellow-500';
        } else {
            priorityBadge = '<span class="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded"><i class="fas fa-info-circle mr-1"></i>Low Priority (' + Math.round(suggestion.confidence * 100) + '% confidence)</span>';
            priorityBorder = 'border-l-4 border-blue-500';
        }
        
        const card = document.createElement('div');
        card.className = `bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow ${priorityBorder}`;
        card.innerHTML = `
            <div class="flex items-start justify-between mb-3">
                ${priorityBadge}
                <div class="text-xs text-gray-500">
                    <i class="far fa-clock mr-1"></i>
                    ${new Date(suggestion.createdAt).toLocaleString()}
                </div>
            </div>
            
            <p class="text-gray-900 font-medium mb-2">
                ${suggestion.briefDescription}
            </p>
            
            <p class="text-sm text-gray-600 mb-3">
                ${suggestion.impactSummary}
            </p>
            
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-xs text-gray-500">
                    <span><i class="fas fa-building mr-1"></i>${suggestion.companyId?.companyName || 'Unknown'}</span>
                    <span><i class="fas fa-copy mr-1"></i>${suggestion.templateId?.name || 'Unknown Template'}</span>
                </div>
                
                <button onclick="window.productionAIManager.openSuggestionModal('${suggestion._id}')" class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors">
                    <i class="fas fa-file-alt mr-2"></i>
                    📄 View Full Details
                </button>
            </div>
        `;
        
        container.appendChild(card);
    }

    /**
     * Open suggestion detail modal
     * @param {String} suggestionId - Suggestion ID
     */
    async openSuggestionModal(suggestionId) {
        console.log('[PRODUCTION AI] Opening suggestion modal:', suggestionId);
        
        // This will be handled by SuggestionAnalysisModal.js
        if (window.suggestionAnalysisModal && typeof window.suggestionAnalysisModal.open === 'function') {
            window.suggestionAnalysisModal.open(suggestionId);
        } else {
            console.error('[PRODUCTION AI] SuggestionAnalysisModal not found');
            window.toastManager.error('❌ Suggestion modal not available');
        }
    }

    /**
     * Apply a suggestion
     * @param {String} suggestionId - Suggestion ID
     */
    async applySuggestion(suggestionId) {
        console.log('[PRODUCTION AI] Applying suggestion:', suggestionId);
        
        try {
            window.toastManager.info('⏳ Applying suggestion...');
            
            const response = await fetch(`/api/admin/production-ai/suggestions/${suggestionId}/apply`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': `apply-${suggestionId}-${Date.now()}`
                },
                body: JSON.stringify({})
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            window.toastManager.success('✅ Suggestion applied successfully!');
            
            // Reload suggestions
            await this.loadSuggestions();
            
            return result;
            
        } catch (error) {
            console.error('[PRODUCTION AI] Failed to apply suggestion:', error);
            window.toastManager.error(`❌ Failed to apply suggestion: ${error.message}`);
            throw error;
        }
    }

    /**
     * Ignore a suggestion
     * @param {String} suggestionId - Suggestion ID
     */
    async ignoreSuggestion(suggestionId) {
        console.log('[PRODUCTION AI] Ignoring suggestion:', suggestionId);
        
        try {
            const response = await fetch(`/api/admin/production-ai/suggestions/${suggestionId}/ignore`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            window.toastManager.success('✅ Suggestion ignored');
            
            // Reload suggestions
            await this.loadSuggestions();
            
        } catch (error) {
            console.error('[PRODUCTION AI] Failed to ignore suggestion:', error);
            window.toastManager.error(`❌ Failed to ignore suggestion: ${error.message}`);
            throw error;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🚀 INITIALIZATION
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Initialize Production AI tab
     */
    async initialize() {
        console.log('[PRODUCTION AI] Initializing Production AI Manager...');
        
        try {
            // Load templates into filter dropdown
            await this.loadTemplates();
            
            // Load companies into selector (if needed for company-specific settings)
            await this.loadCompanies();
            
            // Load initial suggestions (will show empty state if no template selected)
            await this.loadSuggestions();
            
            // Load system metrics
            await this.loadSystemMetrics();
            
            // Run initial health check
            await this.testOpenAIConnection();
            
            // Start auto-refresh for health status
            this.startAutoRefresh();
            
            console.log('✅ [PRODUCTION AI] Initialization complete');
            
        } catch (error) {
            console.error('[PRODUCTION AI] Initialization failed:', error);
            window.toastManager.error(`❌ Production AI initialization failed: ${error.message}`);
        }
    }

    /**
     * Load templates into filter dropdown
     */
    async loadTemplates() {
        try {
            const response = await fetch('/api/admin/global-instant-responses', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            const templates = data.templates || [];
            
            // Populate filter dropdown
            const filterSelect = document.getElementById('production-ai-template-filter');
            filterSelect.innerHTML = '<option value="">All Templates</option>';
            
            templates.forEach(template => {
                const option = document.createElement('option');
                option.value = template._id;
                option.textContent = template.name;
                filterSelect.appendChild(option);
            });
            
            console.log(`[PRODUCTION AI] Loaded ${templates.length} templates into filter`);
            
        } catch (error) {
            console.error('[PRODUCTION AI] Failed to load templates:', error);
        }
    }

    /**
     * Cleanup when leaving tab
     */
    cleanup() {
        console.log('[PRODUCTION AI] Cleaning up...');
        this.stopAutoRefresh();
    }
}

// Create global instance
window.productionAIManager = new ProductionAIManager();

console.log('✅ [PRODUCTION AI MANAGER] Loaded successfully');

