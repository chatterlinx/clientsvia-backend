/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VARIABLES MANAGER - MISSION CONTROL CENTER
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Enterprise-grade variable management with scan control & health monitoring
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ TAB 1: Scan & Status                                                    │
 * │  • Health check (system status, last scan time)                         │
 * │  • Force scan button with live progress                                 │
 * │  • Scan results (what was found, match counts)                          │
 * │  • Category breakdown with completion %                                 │
 * │  • Alerts (missing required variables)                                  │
 * │                                                                          │
 * │ TAB 2: Variables Table                                                  │
 * │  • Clean table (one row per unique variable)                            │
 * │  • Inline editing with auto-save                                        │
 * │  • Status badges (OK, Required, Missing)                                │
 * │  • Match count (usage across scenarios)                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * CHECKPOINTS: Every critical operation logs checkpoint for debugging
 * ═══════════════════════════════════════════════════════════════════════════
 */

class VariablesManager {
    constructor(parent) {
        console.log('💼 [VARIABLES] Checkpoint 1: Constructor called');
        this.parent = parent;
        this.companyId = parent.companyId;
        this.currentTab = 'scan-status'; // Default to Scan & Status tab
        
        // Data storage
        this.variableDefinitions = [];
        this.variables = {};
        this.scanStatus = null;
        this.lastScanResult = null;
        this.isScanning = false;
        this.pollInterval = null; // For real-time scan progress polling
        
        console.log('✅ [VARIABLES] Checkpoint 2: Initialized for company:', this.companyId);
    }
    
    /**
     * Load variables data from API
     */
    async load() {
        console.log('💼 [VARIABLES] Checkpoint 3: Loading variables...');
        
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error('❌ [VARIABLES] Checkpoint 4: No auth token found');
                throw new Error('Authentication required');
            }
            console.log('✅ [VARIABLES] Checkpoint 4: Auth token present');
            
            console.log('💼 [VARIABLES] Checkpoint 5: Fetching from API...');
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            console.log('✅ [VARIABLES] Checkpoint 6: Response received - Status:', response.status);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            console.log('💼 [VARIABLES] Checkpoint 7: Parsing JSON...');
            const data = await response.json();
            
            console.log('✅ [VARIABLES] Checkpoint 8: Data parsed:', {
                definitions: data.definitions?.length || 0,
                variables: Object.keys(data.variables || {}).length,
                meta: data.meta
            });
            
            // REFACTORED: New API shape uses 'definitions' + 'meta'
            this.variableDefinitions = data.definitions || [];
            this.variables = data.variables || {};
            this.meta = data.meta || {
                lastScanDate: null,
                missingRequiredCount: 0,
                totalVariables: 0,
                totalRequired: 0
            };
            
            console.log('💼 [VARIABLES] Checkpoint 9: Rendering UI...');
            this.render();
            
            console.log('✅ [VARIABLES] Checkpoint 10: Load complete');
            
            // Start polling if scan is in progress
            if (this.scanStatus?.isScanning) {
                console.log('📡 [VARIABLES] Checkpoint 11: Scan in progress detected - starting poll');
                this.startPolling();
            }
            
        } catch (error) {
            console.error('❌ [VARIABLES] Failed at load:', error);
            this.renderError('Failed to load variables. Please refresh the page.');
        }
    }
    
    /**
     * Start polling for scan status updates (real-time progress)
     */
    startPolling() {
        console.log('📡 [POLL] Checkpoint 1: Starting real-time scan status polling');
        
        // Clear any existing interval
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        
        // Poll every 2 seconds
        this.pollInterval = setInterval(async () => {
            await this.checkScanStatus();
        }, 2000);
        
        console.log('✅ [POLL] Checkpoint 2: Polling started (every 2 seconds)');
    }
    
    /**
     * Stop polling
     */
    stopPolling() {
        if (this.pollInterval) {
            console.log('📡 [POLL] Checkpoint 3: Stopping poll');
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }
    
    /**
     * Check scan status (called by polling)
     */
    async checkScanStatus() {
        console.log('📡 [POLL] Checkpoint 4: Checking scan status...');
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables/scan-status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            const scanStatus = data.scanStatus;
            
            console.log('📡 [POLL] Checkpoint 5: Status received:', {
                isScanning: scanStatus.isScanning,
                progress: scanStatus.scanProgress
            });
            
            // Update scan status
            this.scanStatus = scanStatus;
            
            if (scanStatus.isScanning) {
                // Still scanning - update progress UI
                this.isScanning = true;
                this.updateScanProgress(scanStatus.scanProgress);
            } else {
                // Scan complete - stop polling and reload
                console.log('✅ [POLL] Checkpoint 6: Scan complete - stopping poll');
                this.stopPolling();
                this.isScanning = false;
                
                // Reload data to get new variables
                await this.load();
            }
            
        } catch (error) {
            console.error('❌ [POLL] Error checking scan status:', error);
            // Continue polling even if error
        }
    }
    
    /**
     * Update scan progress UI in real-time
     */
    updateScanProgress(progress) {
        console.log('📊 [PROGRESS] Updating UI:', progress);
        
        // Update progress text
        const progressTextEl = document.getElementById('scan-progress-text');
        if (progressTextEl) {
            const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
            progressTextEl.textContent = `Scanning ${progress.currentTemplate}... ${progress.current}/${progress.total} scenarios (${percent}%)`;
        }
        
        // Update progress bar
        const progressBarEl = document.getElementById('scan-progress-bar');
        if (progressBarEl && progress.total > 0) {
            const percent = Math.round((progress.current / progress.total) * 100);
            progressBarEl.style.width = `${percent}%`;
        }
    }
    
    /**
     * Main render - switches between tabs
     */
    render() {
        console.log('🎨 [VARIABLES] Checkpoint 11: Starting render - Current tab:', this.currentTab);
        
        const container = document.getElementById('variables-container');
        if (!container) {
            console.error('❌ [VARIABLES] Checkpoint 12: Container not found!');
            return;
        }
        console.log('✅ [VARIABLES] Checkpoint 12: Container found');
        
        // Render tab navigation
        const html = `
            <!-- Tab Navigation -->
            <div class="flex gap-4 mb-6 border-b-2 border-gray-200">
                <button 
                    class="px-6 py-3 font-bold transition-all ${this.currentTab === 'scan-status' ? 'border-b-4 border-purple-600 text-purple-600' : 'text-gray-600 hover:text-purple-600'}"
                    onclick="variablesManager.switchTab('scan-status')"
                >
                    <i class="fas fa-radar mr-2"></i>
                    Scan & Status
                </button>
                <button 
                    class="px-6 py-3 font-bold transition-all ${this.currentTab === 'variables' ? 'border-b-4 border-purple-600 text-purple-600' : 'text-gray-600 hover:text-purple-600'}"
                    onclick="variablesManager.switchTab('variables')"
                >
                    <i class="fas fa-table mr-2"></i>
                    Variables
                </button>
            </div>
            
            <!-- Tab Content -->
            <div id="variables-tab-content"></div>
        `;
        
        container.innerHTML = html;
        console.log('✅ [VARIABLES] Checkpoint 13: Tab navigation rendered');
        
        // Render active tab content
        this.renderTabContent();
    }
    
    /**
     * Switch between tabs
     */
    switchTab(tabName) {
        console.log('🔄 [VARIABLES] Checkpoint 14: Switching to tab:', tabName);
        this.currentTab = tabName;
        this.render();
    }
    
    /**
     * Render active tab content
     */
    renderTabContent() {
        console.log('🎨 [VARIABLES] Checkpoint 15: Rendering tab content:', this.currentTab);
        
        const contentContainer = document.getElementById('variables-tab-content');
        if (!contentContainer) {
            console.error('❌ [VARIABLES] Checkpoint 16: Tab content container not found');
            return;
        }
        console.log('✅ [VARIABLES] Checkpoint 16: Tab content container found');
        
        if (this.currentTab === 'scan-status') {
            this.renderScanStatus(contentContainer);
        } else if (this.currentTab === 'variables') {
            this.renderVariablesTable(contentContainer);
        }
    }
    
    /**
     * TAB 1: Scan & Status
     */
    renderScanStatus(container) {
        console.log('🎨 [VARIABLES] Checkpoint 17: Rendering Scan & Status tab');
        
        // REFACTORED: Use meta from new API shape
        const totalVars = this.variableDefinitions.length;
        const totalRequired = this.meta.totalRequired || 0;
        const missingRequired = this.meta.missingRequiredCount || 0;
        const filledRequired = totalRequired - missingRequired;
        
        const filledVars = this.variableDefinitions.filter(v => {
            const value = this.variables[v.key] || '';
            return value.trim() !== '';
        }).length;
        
        const completionPercent = totalRequired > 0 
            ? Math.round((filledRequired / totalRequired) * 100) 
            : (totalVars > 0 ? Math.round((filledVars / totalVars) * 100) : 0);
        
        const lastScan = this.meta.lastScanDate;
        const lastScanText = lastScan ? this.getTimeAgo(new Date(lastScan)) : 'Never';
        
        // Health status
        const isHealthy = totalVars > 0 && missingRequired === 0;
        const healthIcon = isHealthy ? '🟢' : (totalVars > 0 ? '🟡' : '🔴');
        const healthText = isHealthy ? 'HEALTHY' : (totalVars > 0 ? 'ACTION REQUIRED' : 'SYSTEM NO DATA');
        
        console.log('✅ [VARIABLES] Checkpoint 18: Status calculated:', {
            total: totalVars,
            filled: filledVars,
            required: totalRequired,
            missingRequired: missingRequired,
            completion: completionPercent,
            health: healthText
        });
        
        let html = `
            <!-- Health Check Card -->
            <div class="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl shadow-lg p-6 mb-6 text-white">
                <div class="flex items-center justify-between">
                    <div class="flex-1">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="text-4xl">${healthIcon}</span>
                            <div>
                                <h2 class="text-2xl font-bold">SYSTEM ${healthText}</h2>
                                <p class="text-purple-100 text-sm">Variables Management Control Center</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-3 gap-4 mt-4 text-sm">
                            <div>
                                <div class="text-purple-200">Last Scan</div>
                                <div class="font-bold text-lg">${lastScanText}</div>
                            </div>
                            <div>
                                <div class="text-purple-200">Variables Found</div>
                                <div class="font-bold text-lg">${totalVars} unique</div>
                            </div>
                            <div>
                                <div class="text-purple-200">Completion</div>
                                <div class="font-bold text-lg">${totalRequired > 0 ? `${filledRequired}/${totalRequired}` : `${filledVars}/${totalVars}`} (${completionPercent}%)</div>
                            </div>
                        </div>
                    </div>
                    <div class="ml-6">
                        <button 
                            onclick="variablesManager.forceScan()"
                            class="bg-white text-purple-700 hover:bg-purple-50 rounded-xl px-8 py-4 font-bold text-lg transition-all shadow-lg hover:shadow-xl ${this.isScanning ? 'opacity-50 cursor-not-allowed' : ''}"
                            ${this.isScanning ? 'disabled' : ''}
                            title="Scan active templates for variables"
                        >
                            <i class="fas fa-radar text-2xl mr-3"></i>
                            ${this.isScanning ? 'Scanning...' : 'Force Scan Now'}
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Scan progress (if scanning) - REAL-TIME
        if (this.isScanning || this.scanStatus?.isScanning) {
            const progress = this.scanStatus?.scanProgress || { current: 0, total: 0, currentTemplate: '' };
            const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
            
            html += `
                <div class="bg-blue-50 border-2 border-blue-400 rounded-xl p-6 mb-6">
                    <h3 class="text-xl font-bold text-blue-900 mb-4">
                        <i class="fas fa-spinner fa-spin mr-2"></i>
                        Background Scan in Progress
                    </h3>
                    
                    <!-- Progress Text -->
                    <div id="scan-progress-text" class="text-blue-800 font-semibold mb-3">
                        ${progress.currentTemplate ? `Scanning ${progress.currentTemplate}... ${progress.current}/${progress.total} scenarios (${percent}%)` : 'Initializing scan...'}
                    </div>
                    
                    <!-- Progress Bar -->
                    <div class="bg-blue-200 rounded-full h-4 overflow-hidden mb-4">
                        <div 
                            id="scan-progress-bar" 
                            class="bg-gradient-to-r from-blue-500 to-indigo-600 h-full transition-all duration-500"
                            style="width: ${percent}%"
                        ></div>
                    </div>
                    
                    <!-- Info -->
                    <div class="text-sm text-blue-700">
                        <i class="fas fa-info-circle mr-2"></i>
                        This scan is running in the background. You can close this page and it will continue.
                    </div>
                </div>
            `;
        }
        
        // Last scan result
        if (this.lastScanResult && !this.isScanning) {
            html += this.renderScanResult();
        }
        
        // Category breakdown
        if (totalVars > 0) {
            html += this.renderCategoryBreakdown();
        }
        
        // Alerts
        const missingRequired = this.variableDefinitions.filter(v => v.required && !this.variables[v.key]);
        if (missingRequired.length > 0) {
            html += this.renderAlerts(missingRequired);
        }
        
        // Empty state
        if (totalVars === 0) {
            html += `
                <div class="text-center py-16">
                    <div class="inline-flex items-center justify-center w-32 h-32 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full shadow-lg mb-6">
                        <i class="fas fa-radar text-6xl text-blue-400"></i>
                    </div>
                    <h3 class="text-3xl font-bold text-gray-900 mb-3">Ready to Scan</h3>
                    <p class="text-lg text-gray-600 mb-4">
                        Click <strong>"Force Scan Now"</strong> above to detect variables from your active templates.
                    </p>
                </div>
            `;
        }
        
        container.innerHTML = html;
        console.log('✅ [VARIABLES] Checkpoint 19: Scan & Status tab rendered');
    }
    
    /**
     * Render scan result
     */
    renderScanResult() {
        const result = this.lastScanResult;
        const timestamp = new Date(result.scannedAt);
        const timeAgo = this.getTimeAgo(timestamp);
        
        let html = `
            <div class="bg-green-50 border-2 border-green-400 rounded-xl p-6 mb-6">
                <h3 class="text-xl font-bold text-green-900 mb-4">
                    <i class="fas fa-check-circle mr-2"></i>
                    Scan Completed - ${timeAgo}
                </h3>
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div class="bg-white rounded-lg p-4">
                        <div class="text-3xl font-bold text-green-600">${result.found || 0}</div>
                        <div class="text-sm text-gray-600">Variables Found</div>
                    </div>
                    <div class="bg-white rounded-lg p-4">
                        <div class="text-3xl font-bold text-blue-600">${result.newCount || 0}</div>
                        <div class="text-sm text-gray-600">New Variables</div>
                    </div>
                </div>
                
                <details class="bg-white rounded-lg p-4">
                    <summary class="font-bold text-gray-900 cursor-pointer hover:text-purple-600">
                        📋 View All Detected Variables (${result.found || 0})
                    </summary>
                    <div class="mt-4 space-y-2 text-sm max-h-64 overflow-y-auto">
                        ${this.variableDefinitions.map(v => `
                            <div class="flex items-center justify-between p-2 hover:bg-gray-50 rounded">
                                <code class="text-blue-700 font-mono">{${v.key}}</code>
                                <span class="text-gray-600">${v.usageCount || 0} matches</span>
                            </div>
                        `).join('')}
                    </div>
                </details>
            </div>
        `;
        
        return html;
    }
    
    /**
     * Render category breakdown
     */
    renderCategoryBreakdown() {
        const grouped = this.groupByCategory(this.variableDefinitions);
        const categoryIcons = {
            'Company Info': '🏢',
            'Pricing': '💰',
            'Contact': '📞',
            'Scheduling': '📅',
            'Services': '🔧',
            'General': '📝'
        };
        
        let html = `
            <div class="bg-white border-2 border-gray-200 rounded-xl p-6 mb-6">
                <h3 class="text-xl font-bold text-gray-900 mb-4">Category Breakdown</h3>
                <div class="space-y-3">
        `;
        
        for (const [category, vars] of Object.entries(grouped)) {
            const icon = categoryIcons[category] || '📋';
            const filled = vars.filter(v => this.variables[v.key]?.trim()).length;
            const total = vars.length;
            const percent = Math.round((filled / total) * 100);
            
            html += `
                <div class="flex items-center gap-4">
                    <span class="text-2xl">${icon}</span>
                    <div class="flex-1">
                        <div class="flex items-center justify-between mb-1">
                            <span class="font-semibold text-gray-900">${category}</span>
                            <span class="text-sm font-bold text-gray-700">${filled}/${total} (${percent}%)</span>
                        </div>
                        <div class="bg-gray-200 rounded-full h-3 overflow-hidden">
                            <div class="bg-gradient-to-r from-purple-500 to-indigo-500 h-full transition-all" style="width: ${percent}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        html += `
                </div>
            </div>
        `;
        
        return html;
    }
    
    /**
     * Render alerts
     */
    renderAlerts(missingRequired) {
        let html = `
            <div class="bg-red-50 border-2 border-red-400 rounded-xl p-6">
                <h3 class="text-xl font-bold text-red-900 mb-4">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    Action Required
                </h3>
                <p class="text-red-800 mb-3">
                    ${missingRequired.length} required variable${missingRequired.length === 1 ? '' : 's'} missing value${missingRequired.length === 1 ? '' : 's'}:
                </p>
                <div class="space-y-2">
                    ${missingRequired.map(v => `
                        <div class="bg-white rounded-lg p-3 flex items-center justify-between">
                            <div>
                                <code class="text-red-700 font-mono">{${v.key}}</code>
                                <span class="text-gray-600 text-sm ml-2">${v.usageCount || 0} matches</span>
                            </div>
                            <button 
                                onclick="variablesManager.switchTab('variables')"
                                class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all text-sm font-bold"
                            >
                                Fill Now
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        return html;
    }
    
    /**
     * TAB 2: Variables Table
     */
    renderVariablesTable(container) {
        console.log('🎨 [VARIABLES] Checkpoint 20: Rendering Variables Table');
        
        if (this.variableDefinitions.length === 0) {
            container.innerHTML = `
                <div class="text-center py-16">
                    <div class="inline-flex items-center justify-center w-32 h-32 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full shadow-lg mb-6">
                        <i class="fas fa-table text-6xl text-blue-400"></i>
                    </div>
                    <h3 class="text-3xl font-bold text-gray-900 mb-3">No Variables Yet</h3>
                    <p class="text-lg text-gray-600 mb-6">
                        Run a scan first to detect variables from your active templates.
                    </p>
                    <button 
                        onclick="variablesManager.switchTab('scan-status')"
                        class="px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold rounded-xl hover:shadow-xl transition-all"
                    >
                        Go to Scan & Status
                    </button>
                </div>
            `;
            return;
        }
        
        const html = `
            <!-- Table Header -->
            <div class="bg-white border-2 border-gray-200 rounded-t-xl p-4 flex items-center justify-between">
                <h3 class="text-xl font-bold text-gray-900">
                    <i class="fas fa-table mr-2"></i>
                    All Variables (${this.variableDefinitions.length})
                </h3>
                <button 
                    onclick="variablesManager.saveAll()"
                    class="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold rounded-xl hover:shadow-lg transition-all"
                >
                    <i class="fas fa-save mr-2"></i>
                    Save All Changes
                </button>
            </div>
            
            <!-- Table -->
            <div class="bg-white border-2 border-t-0 border-gray-200 rounded-b-xl overflow-hidden">
                <table class="w-full">
                    <thead class="bg-gray-100 border-b-2 border-gray-200">
                        <tr>
                            <th class="text-left p-4 font-bold text-gray-700">Variable</th>
                            <th class="text-left p-4 font-bold text-gray-700">Category</th>
                            <th class="text-left p-4 font-bold text-gray-700">Value</th>
                            <th class="text-center p-4 font-bold text-gray-700">Matches</th>
                            <th class="text-center p-4 font-bold text-gray-700">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.variableDefinitions.map(v => this.renderVariableRow(v)).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        container.innerHTML = html;
        console.log('✅ [VARIABLES] Checkpoint 21: Variables Table rendered');
    }
    
    /**
     * Render single variable row
     */
    renderVariableRow(varDef) {
        const value = this.variables[varDef.key] || '';
        const isEmpty = value.trim() === '';
        const isRequired = varDef.required || false;
        
        let statusBadge = '';
        let rowClass = '';
        
        if (isEmpty && isRequired) {
            statusBadge = '<span class="px-3 py-1 bg-red-100 text-red-800 text-xs font-bold rounded-full">⚠️ REQUIRED</span>';
            rowClass = 'bg-red-50';
        } else if (isEmpty) {
            statusBadge = '<span class="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">Optional</span>';
        } else {
            statusBadge = '<span class="px-3 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-full">✅ OK</span>';
        }
        
        return `
            <tr class="border-b border-gray-200 hover:bg-gray-50 ${rowClass}">
                <td class="p-4">
                    <code class="text-blue-700 font-mono font-bold">{${varDef.key}}</code>
                </td>
                <td class="p-4 text-gray-700">${varDef.category || 'General'}</td>
                <td class="p-4">
                    <input 
                        type="text"
                        class="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:outline-none transition-all"
                        value="${this.escapeHtml(value)}"
                        placeholder="${varDef.example || 'Enter value...'}"
                        data-key="${varDef.key}"
                        onchange="variablesManager.onVariableChange('${varDef.key}', this.value)"
                    />
                </td>
                <td class="p-4 text-center">
                    <span class="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-bold text-sm">
                        ${varDef.usageCount || 0}
                    </span>
                </td>
                <td class="p-4 text-center">
                    ${statusBadge}
                </td>
            </tr>
        `;
    }
    
    /**
     * Force scan - trigger manual scan
     */
    async forceScan() {
        console.log('🔘 [SCAN] Checkpoint 22: Force Scan button clicked');
        
        if (this.isScanning) {
            console.log('⚠️ [SCAN] Already scanning, ignoring click');
            return;
        }
        
        this.isScanning = true;
        console.log('🔘 [SCAN] Checkpoint 23: Setting isScanning = true');
        
        // Re-render to show progress
        this.render();
        
        try {
            // Simulate progress steps
            this.updateScanStep(1, 'complete');
            await this.delay(300);
            
            console.log('🔘 [SCAN] Checkpoint 24: Calling API POST /variables/scan');
            const token = localStorage.getItem('adminToken');
            
            this.updateScanStep(2, 'active');
            
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables/scan`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('🔘 [SCAN] Checkpoint 25: Response received - HTTP', response.status);
            
            this.updateScanStep(2, 'complete');
            this.updateScanStep(3, 'active');
            await this.delay(300);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            console.log('🔘 [SCAN] Checkpoint 26: Parsing JSON response...');
            const data = await response.json();
            
            this.updateScanStep(3, 'complete');
            this.updateScanStep(4, 'active');
            await this.delay(300);
            
            console.log('🔘 [SCAN] Checkpoint 27: Data received:', {
                variableDefinitions: data.variableDefinitions?.length || 0,
                scannedAt: data.scannedAt
            });
            
            // Update data
            this.variableDefinitions = data.variableDefinitions || [];
            this.variables = data.variables || {};
            this.scanStatus = data.scanStatus || null;
            this.lastScanResult = {
                scannedAt: data.scannedAt || new Date().toISOString(),
                found: this.variableDefinitions.length,
                newCount: data.newCount || 0
            };
            
            this.updateScanStep(4, 'complete');
            this.updateScanStep(5, 'active');
            await this.delay(300);
            this.updateScanStep(5, 'complete');
            
            console.log('✅ [SCAN] Checkpoint 28: Scan complete!');
            
            // Clear Redis cache
            console.log('🔘 [SCAN] Checkpoint 29: Clearing cache...');
            await this.clearCache();
            
            this.parent.showSuccess(`Scan complete! Found ${this.variableDefinitions.length} variables.`);
            
            // Start polling to catch any background scans
            this.startPolling();
            
        } catch (error) {
            console.error('❌ [SCAN] Failed:', error);
            this.parent.showError('Scan failed. Please try again.');
        } finally {
            this.isScanning = false;
            console.log('🔘 [SCAN] Checkpoint 30: Setting isScanning = false');
            
            // Re-render to show results
            this.render();
        }
    }
    
    /**
     * Update scan progress step
     */
    updateScanStep(step, status) {
        const el = document.getElementById(`scan-step-${step}`);
        if (!el) return;
        
        if (status === 'active') {
            el.className = 'flex items-center gap-2';
            el.innerHTML = el.innerHTML.replace(/<i[^>]*>/, '<i class="fas fa-circle-notch fa-spin text-blue-600">');
        } else if (status === 'complete') {
            el.className = 'flex items-center gap-2';
            el.innerHTML = el.innerHTML.replace(/<i[^>]*>/, '<i class="fas fa-check-circle text-green-600">');
        }
    }
    
    /**
     * Handle variable value change
     */
    onVariableChange(key, value) {
        console.log('✏️ [EDIT] Checkpoint 31: Variable changed:', key, '→', value);
        this.variables[key] = value;
    }
    
    /**
     * Save all variables
     */
    async saveAll() {
        console.log('💾 [SAVE] Checkpoint 32: Save All clicked');
        
        try {
            const token = localStorage.getItem('adminToken');
            
            console.log('💾 [SAVE] Checkpoint 33: Calling API PATCH /variables');
            const response = await fetch(`/api/company/${this.companyId}/configuration/variables`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ variables: this.variables })
            });
            
            console.log('💾 [SAVE] Checkpoint 34: Response received - HTTP', response.status);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            console.log('💾 [SAVE] Checkpoint 35: Clearing cache...');
            await this.clearCache();
            
            console.log('✅ [SAVE] Checkpoint 36: Save complete!');
            this.parent.showSuccess('All variables saved successfully!');
            
            // Reload to refresh stats
            await this.load();
            
        } catch (error) {
            console.error('❌ [SAVE] Failed:', error);
            this.parent.showError('Failed to save variables. Please try again.');
        }
    }
    
    /**
     * Clear Redis cache
     */
    async clearCache() {
        const token = localStorage.getItem('adminToken');
        
        // Clear company cache
        await fetch(`/api/admin/cache/company/${this.companyId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        console.log('✅ [CACHE] Cache cleared for company:', this.companyId);
    }
    
    /**
     * Helper: Group variables by category
     */
    groupByCategory(variables) {
        const grouped = {};
        variables.forEach(v => {
            const cat = v.category || 'General';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(v);
        });
        return grouped;
    }
    
    /**
     * Helper: Get time ago text
     */
    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        return `${Math.floor(seconds / 86400)} days ago`;
    }
    
    /**
     * Helper: Delay for progress animation
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Helper: Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Render error state
     */
    renderError(message) {
        const container = document.getElementById('variables-container');
        if (!container) return;
        
        container.innerHTML = `
            <div class="text-center py-16">
                <div class="inline-flex items-center justify-center w-32 h-32 bg-red-100 rounded-full shadow-lg mb-6">
                    <i class="fas fa-exclamation-triangle text-6xl text-red-500"></i>
                </div>
                <h3 class="text-3xl font-bold text-gray-900 mb-3">Error</h3>
                <p class="text-lg text-gray-600">${message}</p>
            </div>
        `;
    }
}

// Make globally accessible
window.VariablesManager = VariablesManager;
