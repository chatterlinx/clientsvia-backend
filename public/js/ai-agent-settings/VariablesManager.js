/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VARIABLES MANAGER - MISSION CONTROL CENTER
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * VERSION: 7.0 (2025-11-03) - Canonical API refactor
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
        this.meta = {};
        this.stats = null;
        this.detectedVariables = [];
        this.scanStatus = null;
        this.lastScanResult = null;
        this.isScanning = false;
        this.pollInterval = null; // For real-time scan progress polling
        
        // ENTERPRISE: Validation & audit trail
        this.templateBreakdown = [];
        this.validationIssues = [];
        this.scanHistory = [];
        this.scanHistoryVisible = false;
        
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
                    id="variables-tab-scan-status"
                    class="px-6 py-3 font-bold transition-all ${this.currentTab === 'scan-status' ? 'border-b-4 border-purple-600 text-purple-600' : 'text-gray-600 hover:text-purple-600'}"
                    data-tab="scan-status"
                >
                    <i class="fas fa-radar mr-2"></i>
                    Scan & Status
                </button>
                <button 
                    id="variables-tab-variables"
                    class="px-6 py-3 font-bold transition-all ${this.currentTab === 'variables' ? 'border-b-4 border-purple-600 text-purple-600' : 'text-gray-600 hover:text-purple-600'}"
                    data-tab="variables"
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
        
        // Attach event listeners to tabs
        this.attachTabListeners();
        
        // Render active tab content
        this.renderTabContent();
    }
    
    /**
     * Attach event listeners to tab buttons
     */
    attachTabListeners() {
        const scanStatusTab = document.getElementById('variables-tab-scan-status');
        const variablesTab = document.getElementById('variables-tab-variables');
        
        if (scanStatusTab) {
            scanStatusTab.onclick = () => this.switchTab('scan-status');
        }
        
        if (variablesTab) {
            variablesTab.onclick = () => this.switchTab('variables');
        }
        
        console.log('✅ [VARIABLES] Tab event listeners attached');
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
            this.attachScanStatusListeners();
        } else if (this.currentTab === 'variables') {
            this.renderVariablesTable(contentContainer);
            this.attachVariablesTableListeners();
        }
    }
    
    /**
     * Attach event listeners for Scan & Status tab
     */
    attachScanStatusListeners() {
        // Force Scan button
        const forceScanBtn = document.getElementById('variables-force-scan-btn');
        if (forceScanBtn) {
            forceScanBtn.onclick = () => this.forceScan();
            console.log('✅ [VARIABLES] Force Scan button listener attached');
        }
        
        // "Fill Now" buttons in alerts
        const fillNowButtons = document.querySelectorAll('.variables-fill-now-btn');
        fillNowButtons.forEach(btn => {
            btn.onclick = () => this.switchTab('variables');
        });
        
        console.log('✅ [VARIABLES] Scan & Status listeners attached');
    }
    
    /**
     * Attach event listeners for Variables table tab
     */
    attachVariablesTableListeners() {
        // Save All button
        const saveAllBtn = document.getElementById('variables-save-all-btn');
        if (saveAllBtn) {
            saveAllBtn.onclick = () => this.saveAll();
            console.log('✅ [VARIABLES] Save All button listener attached');
        }
        
        // "Go to Scan & Status" button (if no variables)
        const gotoScanBtn = document.getElementById('variables-goto-scan-btn');
        if (gotoScanBtn) {
            gotoScanBtn.onclick = () => this.switchTab('scan-status');
            console.log('✅ [VARIABLES] Go to Scan button listener attached');
        }
        
        // Variable input fields
        const variableInputs = document.querySelectorAll('.variable-input');
        variableInputs.forEach(input => {
            input.onchange = (e) => {
                const key = e.target.dataset.key;
                const value = e.target.value;
                this.onVariableChange(key, value);
            };
        });
        
        if (variableInputs.length > 0) {
            console.log(`✅ [VARIABLES] Attached listeners to ${variableInputs.length} variable inputs`);
        }
        
        console.log('✅ [VARIABLES] Variables table listeners attached');
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
        const hasScanned = lastScan !== null;
        const isHealthy = totalVars > 0 && missingRequired === 0;
        const healthIcon = isHealthy ? '🟢' : (totalVars > 0 ? '🟡' : (hasScanned ? '⚪' : '🔴'));
        
        let healthText;
        if (!hasScanned) {
            healthText = 'SYSTEM NOT SCANNED';
        } else if (totalVars === 0) {
            healthText = 'NO VARIABLES FOUND (0 placeholders in active templates)';
        } else if (missingRequired > 0) {
            healthText = 'ACTION REQUIRED';
        } else {
            healthText = 'SYSTEM HEALTHY';
        }
        
        console.log('✅ [VARIABLES] Checkpoint 18: Status calculated:', {
            total: totalVars,
            filled: filledVars,
            required: totalRequired,
            missingRequired: missingRequired,
            completion: completionPercent,
            health: healthText
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // ENTERPRISE DASHBOARD: Top Stats & Validation
        // ═══════════════════════════════════════════════════════════════════
        const templatesCount = this.stats?.templatesCount || 0;
        const categoriesCount = this.stats?.categoriesCount || 0;
        const scenariosCount = this.stats?.scenariosCount || 0;
        
        // Get validation status from first template
        const firstTemplate = this.templateBreakdown[0] || {};
        const expectedCategories = firstTemplate.expected?.categories || 0;
        const scannedCategories = firstTemplate.scanned?.categories || 0;
        const expectedScenarios = firstTemplate.expected?.scenarios || 0;
        const scannedScenarios = firstTemplate.scanned?.scenarios || 0;
        
        const categoriesMatch = scannedCategories === expectedCategories;
        const scenariosMatch = scannedScenarios === expectedScenarios;
        const hasValidationIssues = this.validationIssues.length > 0;
        
        const templateIcon = hasValidationIssues ? '⚠️' : '✅';
        const categoriesIcon = categoriesMatch ? '✅' : (scannedCategories > 0 ? '⚠️' : '❌');
        const scenariosIcon = scenariosMatch ? '✅' : (scannedScenarios > 0 ? '⚠️' : '❌');
        
        let enterpriseDashboard = `
            <div class="mb-6 space-y-4">
                <!-- Top Enterprise Stat Boxes -->
                <div class="grid grid-cols-3 gap-4">
                    <!-- Templates Box -->
                    <div class="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border-2 ${hasValidationIssues ? 'border-yellow-400' : 'border-blue-300'}">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-2xl">${templateIcon}</span>
                            <span class="text-xs font-medium ${hasValidationIssues ? 'text-yellow-700' : 'text-green-700'}">
                                ${hasValidationIssues ? 'Issues Found' : 'All Verified'}
                            </span>
                        </div>
                        <div class="text-3xl font-bold text-blue-900">${templatesCount}</div>
                        <div class="text-sm text-blue-700 font-medium">Template${templatesCount !== 1 ? 's' : ''}</div>
                    </div>
                    
                    <!-- Categories Box -->
                    <div class="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border-2 ${categoriesMatch ? 'border-green-300' : 'border-yellow-400'}">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-2xl">${categoriesIcon}</span>
                            <span class="text-xs font-medium ${categoriesMatch ? 'text-green-700' : 'text-yellow-700'}">
                                ${scannedCategories}/${expectedCategories}
                            </span>
                        </div>
                        <div class="text-3xl font-bold ${categoriesMatch ? 'text-green-900' : 'text-yellow-900'}">${scannedCategories}</div>
                        <div class="text-sm ${categoriesMatch ? 'text-green-700' : 'text-yellow-700'} font-medium">Categories</div>
                    </div>
                    
                    <!-- Scenarios Box -->
                    <div class="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border-2 ${scenariosMatch ? 'border-purple-300' : 'border-yellow-400'}">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-2xl">${scenariosIcon}</span>
                            <span class="text-xs font-medium ${scenariosMatch ? 'text-purple-700' : 'text-yellow-700'}">
                                ${scannedScenarios}/${expectedScenarios}
                            </span>
                        </div>
                        <div class="text-3xl font-bold ${scenariosMatch ? 'text-purple-900' : 'text-yellow-900'}">${scannedScenarios}</div>
                        <div class="text-sm ${scenariosMatch ? 'text-purple-700' : 'text-yellow-700'} font-medium">Scenarios</div>
                    </div>
                </div>
                
                ${hasValidationIssues ? `
                <!-- Validation Issues Alert -->
                <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
                    <div class="flex items-start">
                        <span class="text-2xl mr-3">⚠️</span>
                        <div class="flex-1">
                            <h3 class="text-sm font-bold text-yellow-800 mb-2">Validation Issues Detected</h3>
                            <div class="space-y-1">
                                ${this.validationIssues.map(issue => `
                                    <div class="text-xs text-yellow-700">
                                        • <strong>${issue.templateName}</strong>: Expected ${issue.expected.categories} categories / ${issue.expected.scenarios} scenarios, 
                                        but scanned ${issue.scanned.categories} categories / ${issue.scanned.scenarios} scenarios
                                    </div>
                                `).join('')}
                            </div>
                            <div class="mt-2 text-xs text-yellow-600">
                                <strong>Possible causes:</strong> ScenarioPoolService filtering, template integrity issues, or scenario controls blocking scenarios.
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        `;
        
        let html = enterpriseDashboard + `
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
                            id="variables-force-scan-btn"
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
        const missingRequiredVars = this.variableDefinitions.filter(v => v.required && !this.variables[v.key]);
        if (missingRequiredVars.length > 0) {
            html += this.renderAlerts(missingRequiredVars);
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
     * Render scan result (with rich stats)
     */
    renderScanResult() {
        const result = this.lastScanResult;
        const timestamp = new Date(result.scannedAt);
        const timeAgo = this.getTimeAgo(timestamp);
        const stats = result.stats || this.stats || {};
        
        let html = `
            <div class="bg-green-50 border-2 border-green-400 rounded-xl p-6 mb-6">
                <h3 class="text-xl font-bold text-green-900 mb-4">
                    <i class="fas fa-check-circle mr-2"></i>
                    Scan Completed - ${timeAgo}
                </h3>
                
                <!-- Scan Stats Summary -->
                <div class="bg-white rounded-lg p-4 mb-4 border-l-4 border-green-500">
                    <div class="text-sm text-gray-700 mb-2">
                        <strong>📊 Scanned:</strong> 
                        ${stats.templatesCount || 0} template(s) · 
                        ${stats.categoriesCount || 0} categories · 
                        ${stats.scenariosCount || 0} scenarios
                    </div>
                    <div class="text-sm text-gray-700">
                        <strong>🔍 Found:</strong> 
                        ${stats.totalPlaceholderOccurrences || 0} placeholder occurrences · 
                        ${stats.uniqueVariables || 0} unique variables · 
                        ${stats.newVariables || 0} new this scan
                    </div>
                </div>
                
                <!-- Variable Counts -->
                <div class="grid grid-cols-3 gap-4 mb-4">
                    <div class="bg-white rounded-lg p-4 text-center">
                        <div class="text-3xl font-bold text-green-600">${stats.uniqueVariables || 0}</div>
                        <div class="text-sm text-gray-600">Unique Variables</div>
                    </div>
                    <div class="bg-white rounded-lg p-4 text-center">
                        <div class="text-3xl font-bold text-blue-600">${stats.newVariables || 0}</div>
                        <div class="text-sm text-gray-600">New Variables</div>
                    </div>
                    <div class="bg-white rounded-lg p-4 text-center">
                        <div class="text-3xl font-bold text-purple-600">${stats.totalPlaceholderOccurrences || 0}</div>
                        <div class="text-sm text-gray-600">Total Uses</div>
                    </div>
                </div>
                
                <!-- Detected Variables List -->
                <details class="bg-white rounded-lg p-4" ${stats.uniqueVariables > 0 ? 'open' : ''}>
                    <summary class="font-bold text-gray-900 cursor-pointer hover:text-purple-600">
                        📋 View All Detected Variables (${stats.uniqueVariables || 0})
                    </summary>
                    <div class="mt-4">
                        ${(stats.uniqueVariables || 0) === 0 ? `
                            <div class="text-center py-8 text-gray-500">
                                <i class="fas fa-info-circle text-3xl mb-2"></i>
                                <p>No {placeholder} variables found in your active templates.</p>
                                <p class="text-sm mt-2">This is normal if your templates don't use dynamic variables yet.</p>
                            </div>
                        ` : `
                            <div class="overflow-x-auto">
                                <table class="w-full text-sm">
                                    <thead class="bg-gray-50 border-b-2">
                                        <tr>
                                            <th class="text-left p-2 font-semibold">Variable</th>
                                            <th class="text-left p-2 font-semibold">Category</th>
                                            <th class="text-left p-2 font-semibold">Type</th>
                                            <th class="text-center p-2 font-semibold">Uses</th>
                                        </tr>
                                    </thead>
                                    <tbody class="max-h-64 overflow-y-auto">
                                        ${this.detectedVariables.map(v => `
                                            <tr class="border-b hover:bg-gray-50">
                                                <td class="p-2">
                                                    <code class="text-blue-700 font-mono font-bold">{${v.key}}</code>
                                                    ${v.required ? '<span class="ml-2 text-xs bg-red-100 text-red-800 px-2 py-1 rounded">REQUIRED</span>' : ''}
                                                </td>
                                                <td class="p-2 text-gray-700">${v.category}</td>
                                                <td class="p-2 text-gray-600">${v.type}</td>
                                                <td class="p-2 text-center">
                                                    <span class="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded-full font-semibold">
                                                        ${v.usageCount}
                                                    </span>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        `}
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
                                class="variables-fill-now-btn px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all text-sm font-bold"
                                data-action="fill-now"
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
                        id="variables-goto-scan-btn"
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
                    id="variables-save-all-btn"
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
                        class="variable-input w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:outline-none transition-all"
                        value="${this.escapeHtml(value)}"
                        placeholder="${varDef.example || 'Enter value...'}"
                        data-key="${varDef.key}"
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
            
            // Update data - NEW API SHAPE WITH STATS + ENTERPRISE VALIDATION
            this.variableDefinitions = data.definitions || [];
            this.variables = data.variables || {};
            this.meta = data.meta || {
                lastScanDate: null,
                missingRequiredCount: 0,
                totalVariables: 0,
                totalRequired: 0
            };
            this.stats = data.stats || null;
            this.detectedVariables = data.detectedVariables || [];
            this.scanStatus = data.scanStatus || null;
            
            // ENTERPRISE: Store validation data
            this.templateBreakdown = data.templateBreakdown || [];
            this.validationIssues = data.validationIssues || [];
            
            console.log('📊 [SCAN] ENTERPRISE validation data received:', {
                templateBreakdown: this.templateBreakdown.length,
                validationIssues: this.validationIssues.length
            });
            
            this.lastScanResult = {
                scannedAt: data.scannedAt || new Date().toISOString(),
                found: this.variableDefinitions.length,
                newCount: data.stats?.newVariables || 0,
                stats: this.stats,
                validationStatus: this.validationIssues.length === 0 ? 'complete' : 'partial'
            };
            
            console.log('📊 [SCAN] Stats received:', this.stats);
            
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

// Verification log
console.log('✅ [VARIABLES MANAGER] v7.0 loaded successfully - Class exported to window.VariablesManager');
