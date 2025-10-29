// ============================================================================
// 🎨 AI GATEWAY MANAGER - FRONTEND CONTROLLER
// ============================================================================
// PURPOSE: Main controller for AI Gateway UI interactions
// FEATURES: Health monitoring, suggestion queue, modal handling, API calls
// INTEGRATIONS: ToastManager, FrontendErrorReporter, SuggestionModal
// CREATED: 2025-10-29
// ============================================================================

class AIGatewayManager {
    // ========================================================================
    // 🏗️ CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        console.log('🏗️ [AI GATEWAY UI] CONSTRUCTOR: Initializing AIGatewayManager...');
        
        this.currentTemplateId = null;
        this.suggestions = [];
        this.healthCheckInterval = null;
        this.suggestionRefreshInterval = null;
        this.lastHealthResults = null; // Store latest health results for modal
        
        console.log('✅ [AI GATEWAY UI] CONSTRUCTOR: AIGatewayManager initialized');
    }
    
    // ========================================================================
    // 🚀 INITIALIZATION METHOD
    // ========================================================================
    
    async initialize() {
        console.log('🚀 [AI GATEWAY UI] ═══════════════════════════════════════════');
        console.log('🚀 [AI GATEWAY UI] INITIALIZATION STARTING');
        console.log('🚀 [AI GATEWAY UI] ═══════════════════════════════════════════');
        
        try {
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 1: Load Health Status
            // ────────────────────────────────────────────────────────────────
            console.log('💊 [AI GATEWAY UI] CHECKPOINT 1: Loading health status...');
            await this.loadHealthStatus();
            console.log('✅ [AI GATEWAY UI] CHECKPOINT 1: Health status loaded');
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 2: Load Suggestion Statistics
            // ────────────────────────────────────────────────────────────────
            console.log('📊 [AI GATEWAY UI] CHECKPOINT 2: Loading suggestion stats...');
            await this.loadSuggestionStats();
            console.log('✅ [AI GATEWAY UI] CHECKPOINT 2: Suggestion stats loaded');
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 3: Load Suggestions Queue
            // ────────────────────────────────────────────────────────────────
            console.log('💡 [AI GATEWAY UI] CHECKPOINT 3: Loading suggestions queue...');
            await this.loadSuggestions();
            console.log('✅ [AI GATEWAY UI] CHECKPOINT 3: Suggestions loaded');
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 4: Start Auto-Refresh
            // ────────────────────────────────────────────────────────────────
            console.log('🔄 [AI GATEWAY UI] CHECKPOINT 4: Starting auto-refresh...');
            this.startAutoRefresh();
            console.log('✅ [AI GATEWAY UI] CHECKPOINT 4: Auto-refresh started');
            
            console.log('🚀 [AI GATEWAY UI] ═══════════════════════════════════════════');
            console.log('🚀 [AI GATEWAY UI] INITIALIZATION COMPLETE ✅');
            console.log('🚀 [AI GATEWAY UI] ═══════════════════════════════════════════');
            
        } catch (error) {
            console.error('❌ [AI GATEWAY UI] INITIALIZATION FAILED');
            console.error('❌ [AI GATEWAY UI] Error:', error.message);
            console.error('❌ [AI GATEWAY UI] Stack:', error.stack);
            
            window.frontendErrorReporter?.reportError({
                component: 'AIGateway',
                action: 'initialize',
                error: error,
                severity: 'CRITICAL'
            });
            
            window.toastManager?.error(`Failed to initialize AI Gateway: ${error.message}`);
        }
    }
    
    // ========================================================================
    // 💊 HEALTH MONITORING METHODS
    // ========================================================================
    
    async loadHealthStatus() {
        console.log('💊 [AI GATEWAY UI] Loading health status...');
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/ai-gateway/health/full', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Store results for modal access
                this.lastHealthResults = {
                    ...data.health,
                    timestamp: new Date()
                };
                
                this.updateHealthDashboard(data.health);
                console.log('✅ [AI GATEWAY UI] Health status updated and stored');
            }
            
        } catch (error) {
            console.error('❌ [AI GATEWAY UI] Failed to load health status:', error.message);
            
            window.frontendErrorReporter?.reportError({
                component: 'AIGateway',
                action: 'loadHealthStatus',
                error: error,
                severity: 'ERROR'
            });
        }
    }
    
    async testOpenAIConnection() {
        console.log('🧪 [AI GATEWAY UI] CHECKPOINT 1: Test OpenAI button clicked');
        
        const button = document.getElementById('ai-gateway-test-openai-btn');
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing All Systems...';
        }
        
        try {
            console.log('📡 [AI GATEWAY UI] CHECKPOINT 2: Running FULL health check...');
            
            const token = localStorage.getItem('adminToken');
            
            // Run FULL health check (not just OpenAI)
            const response = await fetch('/api/admin/ai-gateway/health/run', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log(`📨 [AI GATEWAY UI] CHECKPOINT 3: Response received (${response.status})`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Update all health cards
                this.updateHealthCard('openai', data.results.openai);
                this.updateHealthCard('mongodb', data.results.mongodb);
                this.updateHealthCard('redis', data.results.redis);
                
                // Store FULL results for modal
                this.lastHealthResults = {
                    openai: data.results.openai,
                    mongodb: data.results.mongodb,
                    redis: data.results.redis,
                    tier3System: data.results.tier3System,
                    timestamp: new Date()
                };
                
                // Open health modal with ALL results
                if (window.healthModal) {
                    await window.healthModal.open(this.lastHealthResults);
                } else {
                    window.toastManager?.success(`Health check complete: ${data.overallStatus}`);
                }
                
                console.log('✅ [AI GATEWAY UI] Full health check complete, modal opened');
            }
            
        } catch (error) {
            console.error('❌ [AI GATEWAY UI] Health check failed:', error.message);
            
            window.frontendErrorReporter?.reportError({
                component: 'AIGateway',
                action: 'fullHealthCheck',
                error: error,
                severity: 'ERROR'
            });
            
            window.toastManager?.error(`Failed to run health check: ${error.message}`);
            
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-vial"></i> Run Health Check';
            }
        }
    }
    
    updateHealthDashboard(health) {
        console.log('🎨 [AI GATEWAY UI] Updating health dashboard...');
        
        // Update OpenAI card
        if (health.openai) {
            this.updateHealthCard('openai', health.openai);
        }
        
        // Update MongoDB card
        if (health.mongodb) {
            this.updateHealthCard('mongodb', health.mongodb);
        }
        
        // Update Redis card
        if (health.redis) {
            this.updateHealthCard('redis', health.redis);
        }
        
        // Update 3-Tier System card
        if (health.tier3System) {
            this.updateHealthCard('tier3', health.tier3System);
        }
    }
    
    updateHealthCard(cardType, healthData) {
        const statusMap = {
            'HEALTHY': { color: 'green', icon: '✅', pulse: true },
            'UNHEALTHY': { color: 'red', icon: '❌', pulse: false },
            'DEGRADED': { color: 'yellow', icon: '⚠️', pulse: false },
            'NOT_CONFIGURED': { color: 'gray', icon: '⚙️', pulse: false },
            'ENABLED': { color: 'green', icon: '✅', pulse: false },
            'DISABLED': { color: 'gray', icon: '⏸️', pulse: false },
            'UNKNOWN': { color: 'gray', icon: '❓', pulse: true }
        };
        
        const statusInfo = statusMap[healthData.status] || statusMap['UNKNOWN'];
        
        // Update status indicator
        const indicator = document.getElementById(`ai-gateway-${cardType}-indicator`);
        if (indicator) {
            indicator.className = `w-3 h-3 rounded-full bg-${statusInfo.color}-500 ${statusInfo.pulse ? 'animate-pulse' : ''}`;
        }
        
        // Update status text
        const statusText = document.getElementById(`ai-gateway-${cardType}-status`);
        if (statusText) {
            statusText.textContent = `${statusInfo.icon} ${healthData.status}`;
        }
        
        // Update response time/latency
        const timeElement = document.getElementById(`ai-gateway-${cardType}-time`);
        if (timeElement) {
            if (healthData.responseTime) {
                timeElement.textContent = `Response time: ${healthData.responseTime}ms`;
            } else if (healthData.queryTime) {
                timeElement.textContent = `Query time: ${healthData.queryTime}ms`;
            } else if (healthData.latency) {
                timeElement.textContent = `Latency: ${healthData.latency}ms`;
            } else if (healthData.info) {
                timeElement.textContent = healthData.info;
            } else if (healthData.error) {
                timeElement.textContent = healthData.error;
            }
        }
    }
    
    // ========================================================================
    // 💡 SUGGESTION MANAGEMENT METHODS
    // ========================================================================
    
    async loadSuggestionStats() {
        console.log('📊 [AI GATEWAY UI] Loading suggestion stats...');
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/ai-gateway/suggestions/stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.updateStatsBar(data.stats);
                console.log('✅ [AI GATEWAY UI] Stats updated:', data.stats);
            }
            
        } catch (error) {
            console.error('❌ [AI GATEWAY UI] Failed to load stats:', error.message);
            
            window.frontendErrorReporter?.reportError({
                component: 'AIGateway',
                action: 'loadSuggestionStats',
                error: error,
                severity: 'ERROR'
            });
        }
    }
    
    async loadSuggestions(templateId = null, page = 1) {
        console.log(`💡 [AI GATEWAY UI] Loading suggestions (template: ${templateId || 'all'}, page: ${page})...`);
        
        try {
            const token = localStorage.getItem('adminToken');
            const url = templateId 
                ? `/api/admin/ai-gateway/suggestions/${templateId}?page=${page}`
                : `/api/admin/ai-gateway/suggestions/stats`;
            
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.suggestions = data.suggestions || [];
                this.renderSuggestions();
                console.log(`✅ [AI GATEWAY UI] Loaded ${this.suggestions.length} suggestions`);
            }
            
        } catch (error) {
            console.error('❌ [AI GATEWAY UI] Failed to load suggestions:', error.message);
            
            window.frontendErrorReporter?.reportError({
                component: 'AIGateway',
                action: 'loadSuggestions',
                error: error,
                severity: 'ERROR'
            });
        }
    }
    
    renderSuggestions() {
        console.log(`🎨 [AI GATEWAY UI] Rendering ${this.suggestions.length} suggestions...`);
        
        const container = document.getElementById('suggestions-container');
        if (!container) {
            console.warn('⚠️ [AI GATEWAY UI] Suggestions container not found');
            return;
        }
        
        if (this.suggestions.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12">
                    <i class="fas fa-lightbulb text-gray-400 text-5xl mb-4"></i>
                    <p class="text-gray-600 text-lg">No suggestions yet</p>
                    <p class="text-gray-500 text-sm mt-2">Production call data will appear here once LLM analyzes calls</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.suggestions.map(suggestion => this.renderSuggestionCard(suggestion)).join('');
        console.log('✅ [AI GATEWAY UI] Suggestions rendered');
    }
    
    renderSuggestionCard(suggestion) {
        const priorityStyles = {
            'high': 'bg-red-100 text-red-800 border-red-300',
            'medium': 'bg-yellow-100 text-yellow-800 border-yellow-300',
            'low': 'bg-blue-100 text-blue-800 border-blue-300'
        };
        
        const priorityIcons = {
            'high': '🔥',
            'medium': '🟡',
            'low': '🔵'
        };
        
        const priorityStyle = priorityStyles[suggestion.priority] || priorityStyles['medium'];
        const priorityIcon = priorityIcons[suggestion.priority] || '🟡';
        
        return `
            <div class="border rounded-lg p-4 hover:shadow-md transition-shadow ${priorityStyle}">
                <div class="flex justify-between items-start mb-3">
                    <div class="flex items-center space-x-2">
                        <span class="text-2xl">${priorityIcon}</span>
                        <div>
                            <h4 class="font-semibold">${suggestion.briefDescription}</h4>
                            <p class="text-sm opacity-75">${suggestion.impactSummary}</p>
                        </div>
                    </div>
                    <span class="text-xs opacity-75">${new Date(suggestion.createdAt).toLocaleString()}</span>
                </div>
                
                <div class="flex justify-end space-x-2 mt-4">
                    <button onclick="window.aiGatewayManager.applySuggestion('${suggestion._id}')" 
                            class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm">
                        ✓ Apply
                    </button>
                    <button onclick="window.aiGatewayManager.ignoreSuggestion('${suggestion._id}')" 
                            class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm">
                        ✗ Ignore
                    </button>
                    <button onclick="window.aiGatewayManager.viewSuggestionDetails('${suggestion._id}')" 
                            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm">
                        📄 View Details
                    </button>
                </div>
            </div>
        `;
    }
    
    updateStatsBar(stats) {
        const pendingEl = document.getElementById('ai-gateway-stats-pending');
        const appliedEl = document.getElementById('ai-gateway-stats-applied');
        const ignoredEl = document.getElementById('ai-gateway-stats-ignored');
        
        if (pendingEl) pendingEl.textContent = stats.pending || 0;
        if (appliedEl) appliedEl.textContent = stats.applied || 0;
        if (ignoredEl) ignoredEl.textContent = stats.ignored || 0;
    }
    
    async applySuggestion(suggestionId) {
        console.log(`✅ [AI GATEWAY UI] Applying suggestion ${suggestionId}...`);
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/ai-gateway/suggestions/${suggestionId}/apply`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                window.toastManager?.success('Suggestion applied successfully!');
                await this.loadSuggestions();
                await this.loadSuggestionStats();
                console.log('✅ [AI GATEWAY UI] Suggestion applied');
            }
            
        } catch (error) {
            console.error('❌ [AI GATEWAY UI] Failed to apply suggestion:', error.message);
            window.toastManager?.error(`Failed to apply: ${error.message}`);
            
            window.frontendErrorReporter?.reportError({
                component: 'AIGateway',
                action: 'applySuggestion',
                error: error,
                severity: 'ERROR'
            });
        }
    }
    
    async ignoreSuggestion(suggestionId) {
        console.log(`⏭️ [AI GATEWAY UI] Ignoring suggestion ${suggestionId}...`);
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/ai-gateway/suggestions/${suggestionId}/ignore`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                window.toastManager?.info('Suggestion ignored');
                await this.loadSuggestions();
                await this.loadSuggestionStats();
                console.log('✅ [AI GATEWAY UI] Suggestion ignored');
            }
            
        } catch (error) {
            console.error('❌ [AI GATEWAY UI] Failed to ignore suggestion:', error.message);
            window.toastManager?.error(`Failed to ignore: ${error.message}`);
            
            window.frontendErrorReporter?.reportError({
                component: 'AIGateway',
                action: 'ignoreSuggestion',
                error: error,
                severity: 'ERROR'
            });
        }
    }
    
    async viewSuggestionDetails(suggestionId) {
        console.log(`📄 [AI GATEWAY UI] Viewing details for suggestion ${suggestionId}...`);
        
        // This will open the SuggestionModal (to be implemented)
        if (window.aiGatewaySuggestionModal) {
            window.aiGatewaySuggestionModal.open(suggestionId);
        } else {
            console.warn('⚠️ [AI GATEWAY UI] SuggestionModal not available');
            window.toastManager?.warning('Suggestion modal not yet implemented');
        }
    }
    
    // ========================================================================
    // 🔄 AUTO-REFRESH METHODS
    // ========================================================================
    
    startAutoRefresh() {
        console.log('🔄 [AI GATEWAY UI] Starting auto-refresh...');
        
        // Health check every 30 seconds
        this.healthCheckInterval = setInterval(() => {
            this.loadHealthStatus();
        }, 30 * 1000);
        
        // Suggestions refresh every 5 minutes
        this.suggestionRefreshInterval = setInterval(() => {
            this.loadSuggestions();
            this.loadSuggestionStats();
        }, 5 * 60 * 1000);
        
        console.log('✅ [AI GATEWAY UI] Auto-refresh started (Health: 30s, Suggestions: 5min)');
    }
    
    stopAutoRefresh() {
        console.log('🛑 [AI GATEWAY UI] Stopping auto-refresh...');
        
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        
        if (this.suggestionRefreshInterval) {
            clearInterval(this.suggestionRefreshInterval);
            this.suggestionRefreshInterval = null;
        }
        
        console.log('✅ [AI GATEWAY UI] Auto-refresh stopped');
    }
    
    // ========================================================================
    // 🧹 CLEANUP METHOD
    // ========================================================================
    
    cleanup() {
        console.log('🧹 [AI GATEWAY UI] Cleaning up AIGatewayManager...');
        this.stopAutoRefresh();
        this.suggestions = [];
        this.currentTemplateId = null;
        console.log('✅ [AI GATEWAY UI] Cleanup complete');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// 🌐 GLOBAL INSTANCE & INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

window.aiGatewayManager = new AIGatewayManager();
console.log('✅ [AI GATEWAY UI] Global instance created: window.aiGatewayManager');

