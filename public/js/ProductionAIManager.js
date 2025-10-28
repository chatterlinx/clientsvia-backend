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
                ToastManager.success(`✅ OpenAI Connected! Response time: ${result.responseTime}ms | Model: ${result.model || 'gpt-4'}`);
            } else if (result.status === 'NOT_CONFIGURED') {
                ToastManager.warning('⚠️ OpenAI Not Configured - Add OPENAI_API_KEY to environment variables');
            } else {
                ToastManager.error(`❌ OpenAI Connection Failed: ${result.error || 'Unknown error'}`);
            }
            
        } catch (error) {
            console.error('[PRODUCTION AI] OpenAI health check failed:', error);
            this.updateLLMStatus('ERROR', null, null);
            ToastManager.error(`❌ Failed to check OpenAI connection: ${error.message}`);
            
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
            
            ToastManager.success('✅ Full health check complete - All systems checked');
            
        } catch (error) {
            console.error('[PRODUCTION AI] Full health check failed:', error);
            ToastManager.error(`❌ Health check failed: ${error.message}`);
            
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
        ToastManager.success('✅ Health status refreshed');
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
            ToastManager.error(`❌ Failed to load companies: ${error.message}`);
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
            ToastManager.error(`❌ Failed to load company settings: ${error.message}`);
            
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
            ToastManager.error('❌ No company selected');
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
            
            ToastManager.success('✅ Gatekeeper settings saved successfully!');
            
            // Reload settings to show updated values
            await this.loadCompanySettings(this.currentCompanyId);
            
        } catch (error) {
            console.error('[PRODUCTION AI] Failed to save settings:', error);
            ToastManager.error(`❌ Failed to save settings: ${error.message}`);
            
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
    // 🚀 INITIALIZATION
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Initialize Production AI tab
     */
    async initialize() {
        console.log('[PRODUCTION AI] Initializing Production AI Manager...');
        
        try {
            // Load companies into selector
            await this.loadCompanies();
            
            // Load system metrics
            await this.loadSystemMetrics();
            
            // Run initial health check
            await this.testOpenAIConnection();
            
            // Start auto-refresh
            this.startAutoRefresh();
            
            console.log('✅ [PRODUCTION AI] Initialization complete');
            
        } catch (error) {
            console.error('[PRODUCTION AI] Initialization failed:', error);
            ToastManager.error(`❌ Production AI initialization failed: ${error.message}`);
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

