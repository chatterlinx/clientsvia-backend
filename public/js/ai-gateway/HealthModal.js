// ============================================================================
// 💊 AI GATEWAY - HEALTH RESULTS MODAL (Enterprise-Grade)
// ============================================================================
// PURPOSE: Display detailed health diagnostics, configuration, and history
// FEATURES: 3 tabs (Results, Settings, History), live updates, statistics
// INTEGRATIONS: AIGatewayManager, API endpoints, ToastManager
// CREATED: 2025-10-29
// ============================================================================

class HealthModal {
    // ========================================================================
    // 🏗️ CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        console.log('🏗️ [HEALTH MODAL] Initializing...');
        this.modalId = 'health-modal';
        this.currentTab = 'results';
        this.config = null;
        this.history = [];
        this.stats = null;
        this.countdownInterval = null;
        console.log('✅ [HEALTH MODAL] Initialized');
    }
    
    // ========================================================================
    // 🎨 MODAL RENDERING
    // ========================================================================
    
    /**
     * Open modal with health results
     */
    async open(healthResults = null) {
        console.log('🎨 [HEALTH MODAL] Opening modal...');
        
        try {
            // Load configuration first
            await this.loadConfig();
            
            // Create modal HTML
            this.createModal(healthResults);
            
            // Load initial data
            await this.loadAllData();
            
            // Start countdown if auto-ping enabled
            if (this.config && this.config.enabled) {
                this.startCountdown();
            }
            
            console.log('✅ [HEALTH MODAL] Modal opened');
            
        } catch (error) {
            console.error('❌ [HEALTH MODAL] Failed to open modal:', error);
            window.toastManager.error('Failed to open health modal');
        }
    }
    
    /**
     * Close modal
     */
    close() {
        console.log('🗑️ [HEALTH MODAL] Closing modal...');
        
        // Stop countdown
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        
        // Remove modal from DOM
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.remove();
        }
        
        console.log('✅ [HEALTH MODAL] Modal closed');
    }
    
    /**
     * Create modal HTML structure
     */
    createModal(healthResults) {
        // Remove existing modal if any
        const existing = document.getElementById(this.modalId);
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.id = this.modalId;
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50';
        
        modal.innerHTML = `
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
                <!-- Header -->
                <div class="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4 flex items-center justify-between">
                    <div>
                        <h2 class="text-2xl font-bold text-white flex items-center gap-2">
                            <i class="fas fa-heartbeat"></i>
                            AI Gateway Health Diagnostics
                        </h2>
                        <p class="text-purple-100 text-sm mt-1">Enterprise monitoring & configuration</p>
                    </div>
                    <button onclick="window.healthModal.close()" class="text-white hover:text-gray-200 transition-colors">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                
                <!-- Tabs -->
                <div class="border-b border-gray-200 bg-gray-50 px-6">
                    <nav class="flex gap-4">
                        <button id="tab-results" onclick="window.healthModal.switchTab('results')" class="px-4 py-3 font-semibold border-b-2 border-blue-600 text-blue-600 transition-colors">
                            <i class="fas fa-chart-line mr-2"></i>
                            Results
                        </button>
                        <button id="tab-settings" onclick="window.healthModal.switchTab('settings')" class="px-4 py-3 font-semibold border-b-2 border-transparent text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors">
                            <i class="fas fa-cog mr-2"></i>
                            Settings
                        </button>
                        <button id="tab-history" onclick="window.healthModal.switchTab('history')" class="px-4 py-3 font-semibold border-b-2 border-transparent text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors">
                            <i class="fas fa-history mr-2"></i>
                            History
                        </button>
                    </nav>
                </div>
                
                <!-- Content -->
                <div id="modal-content" class="p-6 overflow-y-auto" style="max-height: calc(90vh - 180px);">
                    <!-- Content will be rendered here -->
                </div>
                
                <!-- Footer -->
                <div class="bg-gray-50 px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                    <div class="text-sm text-gray-600">
                        <span id="modal-footer-info">Loading...</span>
                    </div>
                    <button onclick="window.healthModal.close()" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors">
                        Close
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Load initial tab
        this.renderCurrentTab();
    }
    
    // ========================================================================
    // 📊 DATA LOADING
    // ========================================================================
    
    /**
     * Load configuration from API
     */
    async loadConfig() {
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/ai-gateway/health/config', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            this.config = data.config;
            
            console.log('✅ [HEALTH MODAL] Config loaded:', this.config);
            
        } catch (error) {
            console.error('❌ [HEALTH MODAL] Failed to load config:', error);
            this.config = {
                enabled: true,
                interval: { value: 1, unit: 'hours' },
                notificationMode: 'errors_only',
                stats: { totalChecks: 0, healthyChecks: 0, errorChecks: 0 }
            };
        }
    }
    
    /**
     * Load history from API
     */
    async loadHistory() {
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/ai-gateway/health/history?limit=10', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            this.history = data.history || [];
            
            console.log('✅ [HEALTH MODAL] History loaded:', this.history.length, 'entries');
            
        } catch (error) {
            console.error('❌ [HEALTH MODAL] Failed to load history:', error);
            this.history = [];
        }
    }
    
    /**
     * Load statistics from API
     */
    async loadStats() {
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/ai-gateway/health/stats?days=7', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            this.stats = data.stats;
            
            console.log('✅ [HEALTH MODAL] Stats loaded:', this.stats);
            
        } catch (error) {
            console.error('❌ [HEALTH MODAL] Failed to load stats:', error);
            this.stats = null;
        }
    }
    
    /**
     * Load all data
     */
    async loadAllData() {
        await Promise.all([
            this.loadHistory(),
            this.loadStats()
        ]);
    }
    
    // ========================================================================
    // 🎨 TAB RENDERING
    // ========================================================================
    
    /**
     * Switch to a different tab
     */
    switchTab(tabName) {
        console.log(`🔄 [HEALTH MODAL] Switching to tab: ${tabName}`);
        
        this.currentTab = tabName;
        
        // Update tab buttons
        ['results', 'settings', 'history'].forEach(tab => {
            const btn = document.getElementById(`tab-${tab}`);
            if (btn) {
                if (tab === tabName) {
                    btn.className = 'px-4 py-3 font-semibold border-b-2 border-blue-600 text-blue-600 transition-colors';
                } else {
                    btn.className = 'px-4 py-3 font-semibold border-b-2 border-transparent text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors';
                }
            }
        });
        
        // Render tab content
        this.renderCurrentTab();
    }
    
    /**
     * Render current tab content
     */
    renderCurrentTab() {
        const content = document.getElementById('modal-content');
        if (!content) return;
        
        switch (this.currentTab) {
            case 'results':
                this.renderResultsTab(content);
                break;
            case 'settings':
                this.renderSettingsTab(content);
                break;
            case 'history':
                this.renderHistoryTab(content);
                break;
        }
        
        // Update footer
        this.updateFooter();
    }
    
    /**
     * Render Results tab
     */
    renderResultsTab(container) {
        // Get latest health status from AI Gateway Manager
        const latestResults = window.aiGatewayManager?.lastHealthResults || null;
        
        container.innerHTML = `
            <div class="space-y-6">
                <!-- Last Check Info -->
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <h3 class="text-lg font-bold text-blue-900">Last Health Check</h3>
                            <p class="text-sm text-blue-700 mt-1">
                                ${this.config?.lastCheck ? this.formatRelativeTime(new Date(this.config.lastCheck)) : 'Not available'}
                            </p>
                        </div>
                        <button onclick="window.healthModal.runManualCheck()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
                            <i class="fas fa-sync-alt mr-2"></i>
                            Run Check Now
                        </button>
                    </div>
                </div>
                
                <!-- Service Status Cards -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${this.renderServiceCard('OpenAI', latestResults?.openai, 'fa-robot', 'purple')}
                    ${this.renderServiceCard('MongoDB', latestResults?.mongodb, 'fa-database', 'green')}
                    ${this.renderServiceCard('Redis', latestResults?.redis, 'fa-server', 'red')}
                    ${this.renderServiceCard('3-Tier System', latestResults?.tier3System, 'fa-layer-group', 'yellow')}
                </div>
                
                <!-- Statistics -->
                ${this.stats ? `
                <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h3 class="text-lg font-bold text-gray-900 mb-3">
                        <i class="fas fa-chart-bar mr-2 text-blue-600"></i>
                        Last 7 Days Statistics
                    </h3>
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <p class="text-sm text-gray-600">Total Checks</p>
                            <p class="text-2xl font-bold text-gray-900">${this.stats.totalChecks}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-600">Healthy</p>
                            <p class="text-2xl font-bold text-green-600">${this.stats.breakdown.healthy}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-600">Errors</p>
                            <p class="text-2xl font-bold text-red-600">${this.stats.breakdown.critical + this.stats.breakdown.degraded}</p>
                        </div>
                    </div>
                    <div class="mt-4 pt-4 border-t border-gray-300">
                        <h4 class="text-sm font-bold text-gray-700 mb-2">Uptime %</h4>
                        <div class="grid grid-cols-3 gap-4 text-sm">
                            <div>
                                <span class="text-gray-600">OpenAI:</span>
                                <span class="font-bold text-purple-600">${this.stats.uptime.openai}</span>
                            </div>
                            <div>
                                <span class="text-gray-600">MongoDB:</span>
                                <span class="font-bold text-green-600">${this.stats.uptime.mongodb}</span>
                            </div>
                            <div>
                                <span class="text-gray-600">Redis:</span>
                                <span class="font-bold text-red-600">${this.stats.uptime.redis}</span>
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    }
    
    /**
     * Render a service status card
     */
    renderServiceCard(name, data, icon, color) {
        const colorClasses = {
            purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', icon: 'text-purple-600' },
            green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-900', icon: 'text-green-600' },
            red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900', icon: 'text-red-600' },
            yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-900', icon: 'text-yellow-600' }
        };
        
        const colors = colorClasses[color] || colorClasses.purple;
        const status = data?.status || 'UNKNOWN';
        const statusColors = {
            'HEALTHY': 'text-green-600',
            'UNHEALTHY': 'text-red-600',
            'NOT_CONFIGURED': 'text-yellow-600',
            'ENABLED': 'text-green-600',
            'DISABLED': 'text-gray-600',
            'UNKNOWN': 'text-gray-600'
        };
        
        return `
            <div class="${colors.bg} ${colors.border} border rounded-lg p-4">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <i class="fas ${icon} text-xl ${colors.icon}"></i>
                        <h4 class="font-bold ${colors.text}">${name}</h4>
                    </div>
                    <span class="px-2 py-1 rounded text-xs font-bold ${statusColors[status] || statusColors.UNKNOWN}">
                        ${status}
                    </span>
                </div>
                ${data ? `
                    <div class="space-y-1 text-sm">
                        ${data.responseTime ? `<p><span class="text-gray-600">Response:</span> <span class="font-bold">${data.responseTime}ms</span></p>` : ''}
                        ${data.queryTime ? `<p><span class="text-gray-600">Query:</span> <span class="font-bold">${data.queryTime}ms</span></p>` : ''}
                        ${data.latency ? `<p><span class="text-gray-600">Latency:</span> <span class="font-bold">${data.latency}ms</span></p>` : ''}
                        ${data.model ? `<p><span class="text-gray-600">Model:</span> <span class="font-bold">${data.model}</span></p>` : ''}
                        ${data.error ? `<p class="text-red-600 text-xs mt-2"><i class="fas fa-exclamation-triangle mr-1"></i>${data.error}</p>` : ''}
                    </div>
                ` : '<p class="text-sm text-gray-500">No data available</p>'}
            </div>
        `;
    }
    
    /**
     * Render Settings tab
     */
    renderSettingsTab(container) {
        container.innerHTML = `
            <div class="space-y-6">
                <!-- Enable/Disable -->
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <h3 class="text-lg font-bold text-blue-900">Auto-Ping Status</h3>
                            <p class="text-sm text-blue-700 mt-1">
                                ${this.config?.enabled ? '✅ Enabled and running' : '❌ Disabled'}
                            </p>
                        </div>
                        <button onclick="window.healthModal.toggleEnabled()" class="px-4 py-2 ${this.config?.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} text-white rounded-lg font-medium transition-colors">
                            ${this.config?.enabled ? 'Disable' : 'Enable'}
                        </button>
                    </div>
                </div>
                
                <!-- Interval Configuration -->
                <div class="bg-white border border-gray-200 rounded-lg p-6">
                    <h3 class="text-lg font-bold text-gray-900 mb-4">
                        <i class="fas fa-clock mr-2 text-blue-600"></i>
                        Check Interval
                    </h3>
                    
                    <div class="flex items-center gap-4 mb-4">
                        <div class="flex-1">
                            <label class="block text-sm font-medium text-gray-700 mb-2">Interval Value</label>
                            <input type="number" id="interval-value" min="1" max="1440" value="${this.config?.interval.value || 1}" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        </div>
                        <div class="flex-1">
                            <label class="block text-sm font-medium text-gray-700 mb-2">Unit</label>
                            <select id="interval-unit" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                                <option value="minutes" ${this.config?.interval.unit === 'minutes' ? 'selected' : ''}>Minutes</option>
                                <option value="hours" ${this.config?.interval.unit === 'hours' ? 'selected' : ''}>Hours</option>
                                <option value="days" ${this.config?.interval.unit === 'days' ? 'selected' : ''}>Days</option>
                            </select>
                        </div>
                    </div>
                    
                    <!-- Notification Mode -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Notification Mode</label>
                        <select id="notification-mode" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            <option value="never" ${this.config?.notificationMode === 'never' ? 'selected' : ''}>Never (Silent monitoring)</option>
                            <option value="errors_only" ${this.config?.notificationMode === 'errors_only' ? 'selected' : ''}>Errors Only (Default)</option>
                            <option value="always" ${this.config?.notificationMode === 'always' ? 'selected' : ''}>Always (Verbose)</option>
                        </select>
                        <p class="text-xs text-gray-500 mt-1">
                            <strong>Errors Only:</strong> Only sends alerts when systems are unhealthy<br>
                            <strong>Always:</strong> Sends INFO alerts for all checks (including healthy)
                        </p>
                    </div>
                    
                    <!-- Current Status -->
                    <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                        <h4 class="text-sm font-bold text-gray-700 mb-2">Current Status</h4>
                        <div class="space-y-1 text-sm text-gray-600">
                            <p><strong>Last Check:</strong> ${this.config?.lastCheck ? this.formatRelativeTime(new Date(this.config.lastCheck)) : 'Not available'}</p>
                            <p><strong>Next Check:</strong> <span id="next-check-countdown">${this.config?.nextScheduledCheck ? this.formatRelativeTime(new Date(this.config.nextScheduledCheck)) : 'Not scheduled'}</span></p>
                            <p><strong>Total Checks:</strong> ${this.config?.stats.totalChecks || 0} (${this.config?.stats.healthyChecks || 0} ✅, ${this.config?.stats.errorChecks || 0} ❌)</p>
                        </div>
                    </div>
                    
                    <!-- Save Button -->
                    <button onclick="window.healthModal.saveSettings()" class="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-colors">
                        <i class="fas fa-save mr-2"></i>
                        Save Settings
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Render History tab
     */
    renderHistoryTab(container) {
        container.innerHTML = `
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <h3 class="text-lg font-bold text-gray-900">
                        <i class="fas fa-history mr-2 text-blue-600"></i>
                        Last 10 Health Checks
                    </h3>
                    <button onclick="window.healthModal.loadHistory(); window.healthModal.renderCurrentTab();" class="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors">
                        <i class="fas fa-sync-alt mr-1"></i>
                        Refresh
                    </button>
                </div>
                
                ${this.history.length > 0 ? `
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-100 border-b-2 border-gray-300">
                                <tr>
                                    <th class="px-4 py-2 text-left font-bold text-gray-700">#</th>
                                    <th class="px-4 py-2 text-left font-bold text-gray-700">Time</th>
                                    <th class="px-4 py-2 text-left font-bold text-gray-700">Type</th>
                                    <th class="px-4 py-2 text-center font-bold text-gray-700">OpenAI</th>
                                    <th class="px-4 py-2 text-center font-bold text-gray-700">MongoDB</th>
                                    <th class="px-4 py-2 text-center font-bold text-gray-700">Redis</th>
                                    <th class="px-4 py-2 text-left font-bold text-gray-700">Overall</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-200">
                                ${this.history.map((log, idx) => this.renderHistoryRow(log, idx + 1)).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<p class="text-center text-gray-500 py-8">No health check history available</p>'}
            </div>
        `;
    }
    
    /**
     * Render a history row
     */
    renderHistoryRow(log, number) {
        const statusIcon = (status) => {
            switch (status) {
                case 'HEALTHY': return '✅';
                case 'UNHEALTHY': return '❌';
                case 'NOT_CONFIGURED': return '⚠️';
                case 'ENABLED': return '✅';
                case 'DISABLED': return '⚙️';
                default: return '❓';
            }
        };
        
        const overallColors = {
            'ALL_HEALTHY': 'text-green-600 font-bold',
            'DEGRADED': 'text-yellow-600 font-bold',
            'CRITICAL': 'text-red-600 font-bold'
        };
        
        return `
            <tr class="hover:bg-blue-50 cursor-pointer transition-colors" onclick="window.healthReportModal.open('${log._id}')" title="Click to view detailed diagnostic report">
                <td class="px-4 py-2 text-gray-600">${number}</td>
                <td class="px-4 py-2 text-gray-600 text-xs">${this.formatRelativeTime(new Date(log.timestamp))}</td>
                <td class="px-4 py-2">
                    <span class="px-2 py-1 rounded text-xs font-bold ${log.type === 'manual' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}">
                        ${log.type}
                    </span>
                </td>
                <td class="px-4 py-2 text-center">${statusIcon(log.openai.status)}</td>
                <td class="px-4 py-2 text-center">${statusIcon(log.mongodb.status)}</td>
                <td class="px-4 py-2 text-center">${statusIcon(log.redis.status)}</td>
                <td class="px-4 py-2">
                    <span class="${overallColors[log.overallStatus] || 'text-gray-600'}">${log.overallStatus}</span>
                </td>
            </tr>
        `;
    }
    
    // ========================================================================
    // 🔄 ACTIONS
    // ========================================================================
    
    /**
     * Run manual health check
     */
    async runManualCheck() {
        console.log('🏥 [HEALTH MODAL] Running manual health check...');
        
        try {
            window.toastManager.info('Running health check...');
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/ai-gateway/health/run', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            window.toastManager.success(`Health check complete: ${data.overallStatus}`);
            
            // Reload data
            await this.loadConfig();
            await this.loadHistory();
            await this.loadStats();
            
            // Refresh current tab
            this.renderCurrentTab();
            
            // Update main UI if available
            if (window.aiGatewayManager) {
                await window.aiGatewayManager.loadHealthStatus();
            }
            
            console.log('✅ [HEALTH MODAL] Manual check complete');
            
        } catch (error) {
            console.error('❌ [HEALTH MODAL] Manual check failed:', error);
            window.toastManager.error('Failed to run health check');
        }
    }
    
    /**
     * Save settings
     */
    async saveSettings() {
        console.log('💾 [HEALTH MODAL] Saving settings...');
        
        try {
            const intervalValue = parseInt(document.getElementById('interval-value').value);
            const intervalUnit = document.getElementById('interval-unit').value;
            const notificationMode = document.getElementById('notification-mode').value;
            
            // Validation
            if (!intervalValue || intervalValue < 1 || intervalValue > 1440) {
                window.toastManager.error('Invalid interval value (must be 1-1440)');
                return;
            }
            
            window.toastManager.info('Saving settings...');
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/ai-gateway/health/config', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    intervalValue,
                    intervalUnit,
                    notificationMode
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            window.toastManager.success('Settings saved successfully! Auto-ping rescheduled.');
            
            // Reload config
            await this.loadConfig();
            
            // Refresh settings tab
            this.renderCurrentTab();
            
            // Restart countdown
            if (this.config.enabled) {
                this.startCountdown();
            }
            
            console.log('✅ [HEALTH MODAL] Settings saved');
            
        } catch (error) {
            console.error('❌ [HEALTH MODAL] Failed to save settings:', error);
            window.toastManager.error('Failed to save settings');
        }
    }
    
    /**
     * Toggle enabled/disabled
     */
    async toggleEnabled() {
        const newState = !this.config.enabled;
        console.log(`🔄 [HEALTH MODAL] ${newState ? 'Enabling' : 'Disabling'} auto-ping...`);
        
        try {
            window.toastManager.info(`${newState ? 'Enabling' : 'Disabling'} auto-ping...`);
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/ai-gateway/health/enable', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enabled: newState })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            window.toastManager.success(data.message);
            
            // Reload config
            await this.loadConfig();
            
            // Refresh settings tab
            this.renderCurrentTab();
            
            // Start/stop countdown
            if (this.config.enabled) {
                this.startCountdown();
            } else {
                if (this.countdownInterval) {
                    clearInterval(this.countdownInterval);
                    this.countdownInterval = null;
                }
            }
            
            console.log('✅ [HEALTH MODAL] Toggle complete');
            
        } catch (error) {
            console.error('❌ [HEALTH MODAL] Failed to toggle:', error);
            window.toastManager.error('Failed to update auto-ping status');
        }
    }
    
    // ========================================================================
    // ⏰ COUNTDOWN
    // ========================================================================
    
    /**
     * Start countdown to next check
     */
    startCountdown() {
        // Stop existing countdown
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
        
        // Start new countdown
        this.countdownInterval = setInterval(() => {
            this.updateCountdown();
        }, 1000); // Update every second
        
        // Update immediately
        this.updateCountdown();
    }
    
    /**
     * Update countdown display
     */
    updateCountdown() {
        const element = document.getElementById('next-check-countdown');
        if (!element) return;
        
        if (this.config?.nextScheduledCheck) {
            element.textContent = this.formatRelativeTime(new Date(this.config.nextScheduledCheck));
        }
    }
    
    // ========================================================================
    // 🛠️ UTILITIES
    // ========================================================================
    
    /**
     * Format relative time (e.g., "2 minutes ago", "in 5 hours")
     */
    formatRelativeTime(date) {
        const now = new Date();
        const diffMs = date - now;
        const diffSec = Math.abs(diffMs) / 1000;
        
        if (diffSec < 60) {
            return diffMs < 0 ? 'just now' : 'in a few seconds';
        }
        
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) {
            return diffMs < 0 ? `${diffMin} minute${diffMin > 1 ? 's' : ''} ago` : `in ${diffMin} minute${diffMin > 1 ? 's' : ''}`;
        }
        
        const diffHour = Math.floor(diffMin / 60);
        if (diffHour < 24) {
            return diffMs < 0 ? `${diffHour} hour${diffHour > 1 ? 's' : ''} ago` : `in ${diffHour} hour${diffHour > 1 ? 's' : ''}`;
        }
        
        const diffDay = Math.floor(diffHour / 24);
        return diffMs < 0 ? `${diffDay} day${diffDay > 1 ? 's' : ''} ago` : `in ${diffDay} day${diffDay > 1 ? 's' : ''}`;
    }
    
    /**
     * Update footer info
     */
    updateFooter() {
        const footer = document.getElementById('modal-footer-info');
        if (!footer) return;
        
        if (this.currentTab === 'settings' && this.config) {
            footer.textContent = `Auto-ping: ${this.config.enabled ? '✅ Enabled' : '❌ Disabled'} • Interval: ${this.config.interval.value} ${this.config.interval.unit}`;
        } else if (this.currentTab === 'history') {
            footer.textContent = `Showing ${this.history.length} most recent checks`;
        } else {
            footer.textContent = `Last check: ${this.config?.lastCheck ? this.formatRelativeTime(new Date(this.config.lastCheck)) : 'Never'}`;
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 🌐 GLOBAL INSTANCE
// ────────────────────────────────────────────────────────────────────────────

window.healthModal = new HealthModal();
console.log('✅ [HEALTH MODAL] Global instance created');

