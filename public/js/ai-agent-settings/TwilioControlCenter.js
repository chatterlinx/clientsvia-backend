/**
 * ============================================================================
 * TWILIO CONTROL CENTER - DIAGNOSTIC DASHBOARD
 * ============================================================================
 * 
 * PURPOSE: Mission Control diagnostic dashboard for Twilio integration
 * PHILOSOPHY: DIAGNOSTIC ONLY - No editing, pure status reporting
 * 
 * THIS IS NOT AN EDITOR - IT'S A HEALTH MONITOR
 * 
 * What it does:
 * - Shows real-time system health checks
 * - Reports exactly what's working and what's broken
 * - Provides clear guidance on how to fix issues
 * - Gives "Copy Diagnostics for AI" button for debugging
 * - Links to Configuration tab when editing is needed
 * 
 * What it does NOT do:
 * - ❌ No edit fields (those are in Configuration tab)
 * - ❌ No "Change Number" buttons
 * - ❌ No inline editing
 * 
 * When customers are calling and something breaks, this dashboard
 * tells you INSTANTLY what's wrong and where to fix it.
 * 
 * ============================================================================
 */

class TwilioControlCenter {
    constructor(companyId, parentManager) {
        this.companyId = companyId;
        this.parent = parentManager;
        this.status = null;
        this.config = null;
        this.health = null;
        this.activity = [];
        this.refreshInterval = null;
        this.isRefreshing = false;
        this.backoffMs = 0;
    }

    /**
     * Initialize and render the Twilio Control Center
     */
    async initialize() {
        console.log('📞 [TWILIO CONTROL] CHECKPOINT 1: Starting initialization...');
        console.log('📞 [TWILIO CONTROL] CHECKPOINT 2: Company ID:', this.companyId);

        try {
            console.log('📞 [TWILIO CONTROL] CHECKPOINT 3: Loading all data...');
            await this.loadAllData();
            
            console.log('📞 [TWILIO CONTROL] CHECKPOINT 4: Data loaded, rendering UI...');
            this.render();
            
            console.log('📞 [TWILIO CONTROL] CHECKPOINT 5: Starting auto-refresh...');
            this.startAutoRefresh();

            console.log('✅ [TWILIO CONTROL] CHECKPOINT 6: Initialized successfully');
        } catch (error) {
            console.error('❌ [TWILIO CONTROL] INITIALIZATION FAILED AT CHECKPOINT:', error);
            console.error('❌ [TWILIO CONTROL] Error stack:', error.stack);
            this.renderError('Failed to load Twilio Control Center: ' + error.message);
        }
    }

    /**
     * Load all data in parallel
     */
    async loadAllData() {
        const token = localStorage.getItem('adminToken');
        console.log('📞 [TWILIO CONTROL] LOAD CHECKPOINT 1: Token exists?', !!token);

        console.log('📞 [TWILIO CONTROL] LOAD CHECKPOINT 2: Fetching 4 endpoints in parallel...');
        console.log('   - Status:   /api/company/' + this.companyId + '/twilio-control/status');
        console.log('   - Config:   /api/company/' + this.companyId + '/twilio-control/config');
        console.log('   - Health:   /api/company/' + this.companyId + '/twilio-control/health');
        console.log('   - Activity: /api/company/' + this.companyId + '/twilio-control/activity');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const fetchWithOpts = (url) => fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: controller.signal,
            cache: 'no-cache'
        });

        const [statusRes, configRes, healthRes, activityRes] = await Promise.all([
            fetchWithOpts(`/api/company/${this.companyId}/twilio-control/status`),
            fetchWithOpts(`/api/company/${this.companyId}/twilio-control/config`),
            fetchWithOpts(`/api/company/${this.companyId}/twilio-control/health`),
            fetchWithOpts(`/api/company/${this.companyId}/twilio-control/activity?limit=5`)
        ]).finally(() => clearTimeout(timeoutId));

        console.log('📞 [TWILIO CONTROL] LOAD CHECKPOINT 3: All responses received');
        console.log('   - Status HTTP:   ', statusRes.status, statusRes.ok ? '✅' : '❌');
        console.log('   - Config HTTP:   ', configRes.status, configRes.ok ? '✅' : '❌');
        console.log('   - Health HTTP:   ', healthRes.status, healthRes.ok ? '✅' : '❌');
        console.log('   - Activity HTTP: ', activityRes.status, activityRes.ok ? '✅' : '❌');

        // Check for errors BEFORE parsing JSON
        if (!statusRes.ok) throw new Error(`Status endpoint failed: ${statusRes.status}`);
        if (!configRes.ok) throw new Error(`Config endpoint failed: ${configRes.status}`);
        if (!healthRes.ok) throw new Error(`Health endpoint failed: ${healthRes.status}`);
        if (!activityRes.ok) throw new Error(`Activity endpoint failed: ${activityRes.status}`);

        console.log('📞 [TWILIO CONTROL] LOAD CHECKPOINT 4: Parsing JSON responses...');
        this.status = await statusRes.json();
        this.config = await configRes.json();
        this.health = await healthRes.json();
        this.activity = (await activityRes.json()).activity;

        console.log('📞 [TWILIO CONTROL] LOAD CHECKPOINT 5: Data successfully loaded');
        console.log('   - Status:', this.status);
        console.log('   - Config:', this.config);
        console.log('   - Health:', this.health);
        console.log('   - Activity count:', this.activity?.length || 0);
    }

    /**
     * Render the complete Twilio Control Center
     */
    render() {
        const container = document.getElementById('twilio-control-center');
        if (!container) {
            console.error('❌ [TWILIO CONTROL] Container not found');
            return;
        }

        container.innerHTML = `
            ${this.renderHeader()}
            ${this.renderStatusCards()}
            ${this.renderCallRouting()}
            ${this.renderActivity()}
            ${this.renderActions()}
        `;

        // Attach event listeners
        this.attachEventListeners();
    }

    /**
     * Render header
     */
    renderHeader() {
        return `
            <div class="twilio-header">
                <div class="twilio-title">
                    <svg class="twilio-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="24" height="24">
                        <circle cx="15" cy="15" r="14" fill="#F22F46"/>
                        <circle cx="10" cy="10" r="3" fill="white"/>
                        <circle cx="20" cy="10" r="3" fill="white"/>
                        <circle cx="10" cy="20" r="3" fill="white"/>
                        <circle cx="20" cy="20" r="3" fill="white"/>
                    </svg>
                    <div>
                        <h2>📞 Twilio Control Center</h2>
                        <p>Manage telephony integration for your AI Agent</p>
                    </div>
                </div>
                <div class="twilio-badge">
                    <span class="badge ${this.health.status}">${this.health.status.toUpperCase()}</span>
                </div>
            </div>
        `;
    }

    /**
     * Render diagnostic status cards - PURE DIAGNOSTIC, NO EDITING
     */
    renderStatusCards() {
        const allGood = this.status.connected && this.status.configured;
        const diagnostics = this.status.diagnostics || {};
        
        // Build overall status message
        let overallStatus = '';
        let overallIcon = '';
        let overallColor = '';
        
        if (allGood) {
            overallStatus = 'ALL SYSTEMS OPERATIONAL';
            overallIcon = '✅';
            overallColor = 'green';
        } else if (this.status.configured && !this.status.connected) {
            overallStatus = 'CONFIGURATION ERROR';
            overallIcon = '⚠️';
            overallColor = 'red';
        } else {
            overallStatus = 'NOT CONFIGURED';
            overallIcon = '❌';
            overallColor = 'gray';
        }

        return `
            <!-- Overall System Status Banner -->
            <div class="diagnostic-banner ${overallColor}">
                <div class="banner-icon">${overallIcon}</div>
                <div class="banner-content">
                    <h2>${overallStatus}</h2>
                    <p>${allGood ? 'Your AI receptionist is ready to receive calls!' : 'Action required before going live with customers'}</p>
                </div>
                ${!allGood ? `
                    <button class="btn-fix" onclick="twilioControl.goToConfigurationTab()">
                        <i class="fas fa-wrench"></i> Fix in Configuration Tab
                    </button>
                ` : ''}
            </div>

            <!-- Diagnostic Checkpoints Grid -->
            <div class="diagnostic-grid">
                <!-- Checkpoint 1: Twilio Credentials -->
                <div class="diagnostic-card">
                    <div class="checkpoint-header">
                        <span class="checkpoint-icon">${diagnostics.accountSid === '✅ Configured' && diagnostics.authToken === '✅ Configured' ? '✅' : '❌'}</span>
                        <h3>Twilio Credentials</h3>
                    </div>
                    <div class="checkpoint-details">
                        <div class="detail-row">
                            <span>Account SID:</span>
                            <strong>${diagnostics.accountSid || '❌ Missing'}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Auth Token:</span>
                            <strong>${diagnostics.authToken || '❌ Missing'}</strong>
                        </div>
                        ${this.status.accountSid ? `
                            <div class="detail-row">
                                <span>SID Value:</span>
                                <code>${this.status.accountSid}</code>
                            </div>
                        ` : ''}
                    </div>
                    ${diagnostics.accountSid !== '✅ Configured' || diagnostics.authToken !== '✅ Configured' ? `
                        <div class="checkpoint-action">
                            <p class="action-guidance">→ Add credentials in Configuration tab</p>
                        </div>
                    ` : ''}
                </div>

                <!-- Checkpoint 2: Phone Number -->
                <div class="diagnostic-card">
                    <div class="checkpoint-header">
                        <span class="checkpoint-icon">${diagnostics.phoneNumber === '✅ Configured' ? '✅' : '❌'}</span>
                        <h3>Phone Number</h3>
                    </div>
                    <div class="checkpoint-details">
                        <div class="detail-row">
                            <span>Status:</span>
                            <strong>${diagnostics.phoneNumber || '❌ Missing'}</strong>
                        </div>
                        ${this.status.phoneNumber ? `
                            <div class="detail-row">
                                <span>Number:</span>
                                <strong class="phone-display">${this.status.phoneNumber}</strong>
                            </div>
                            ${this.status.phoneNumbersCount > 1 ? `
                                <div class="detail-row">
                                    <span>Additional:</span>
                                    <span>+${this.status.phoneNumbersCount - 1} more numbers</span>
                                </div>
                            ` : ''}
                        ` : `
                            <div class="detail-row">
                                <span>Number:</span>
                                <strong>Not set</strong>
                            </div>
                        `}
                    </div>
                    ${diagnostics.phoneNumber !== '✅ Configured' ? `
                        <div class="checkpoint-action">
                            <p class="action-guidance">→ Add phone number in Configuration tab</p>
                        </div>
                    ` : ''}
                </div>

                <!-- Checkpoint 3: Twilio API Connection -->
                <div class="diagnostic-card">
                    <div class="checkpoint-header">
                        <span class="checkpoint-icon">${this.status.connected ? '✅' : '❌'}</span>
                        <h3>Twilio API Connection</h3>
                    </div>
                    <div class="checkpoint-details">
                        <div class="detail-row">
                            <span>Connection:</span>
                            <strong class="${this.status.connected ? 'text-green' : 'text-red'}">
                                ${this.status.connected ? '✅ Connected' : '❌ Failed'}
                            </strong>
                        </div>
                        ${this.status.connected && this.status.connectionDetails ? `
                            <div class="detail-row">
                                <span>Account Status:</span>
                                <strong>${this.status.connectionDetails.accountStatus}</strong>
                            </div>
                            <div class="detail-row">
                                <span>Account Type:</span>
                                <strong>${this.status.connectionDetails.accountType}</strong>
                            </div>
                        ` : ''}
                        ${this.status.lastChecked ? `
                            <div class="detail-row">
                                <span>Last Checked:</span>
                                <span>${this.getTimeAgo(this.status.lastChecked)}</span>
                            </div>
                        ` : ''}
                    </div>
                    ${!this.status.connected && this.status.errorMessage ? `
                        <div class="checkpoint-error">
                            <strong>Error:</strong> ${this.status.errorMessage}
                        </div>
                        <div class="checkpoint-action">
                            <p class="action-guidance">→ Verify credentials in Configuration tab</p>
                        </div>
                    ` : ''}
                </div>

                <!-- Checkpoint 4: Voice Settings -->
                <div class="diagnostic-card">
                    <div class="checkpoint-header">
                        <span class="checkpoint-icon">${diagnostics.voice === '✅ Configured' ? '✅' : '⚠️'}</span>
                        <h3>AI Voice</h3>
                    </div>
                    <div class="checkpoint-details">
                        <div class="detail-row">
                            <span>Status:</span>
                            <strong>${diagnostics.voice || '⚠️ Not configured'}</strong>
                        </div>
                        ${this.config.voiceSettings?.selectedVoice ? `
                            <div class="detail-row">
                                <span>Voice:</span>
                                <strong>${this.config.voiceSettings.selectedVoice}</strong>
                            </div>
                            <div class="detail-row">
                                <span>Model:</span>
                                <span>${this.config.voiceSettings.aiModel || 'eleven_turbo_v2_5'}</span>
                            </div>
                        ` : ''}
                    </div>
                    ${diagnostics.voice !== '✅ Configured' ? `
                        <div class="checkpoint-action">
                            <p class="action-guidance">→ Configure voice in AI Voice Settings tab (optional but recommended)</p>
                        </div>
                    ` : ''}
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="diagnostic-actions">
                <button class="btn-diagnostic" onclick="twilioControl.copyDiagnostics()">
                    <i class="fas fa-copy"></i> Copy Full Diagnostics for AI
                </button>
                <button class="btn-refresh" onclick="twilioControl.refreshStatus()">
                    <i class="fas fa-sync"></i> Refresh Status
                </button>
                ${!allGood ? `
                    <button class="btn-primary" onclick="twilioControl.goToConfigurationTab()">
                        <i class="fas fa-wrench"></i> Go to Configuration Tab
                    </button>
                ` : ''}
            </div>

            <!-- Health Score Explanation -->
            <div class="health-explanation">
                <h4>What does ${this.health.healthScore}/100 Health Score mean?</h4>
                <ul>
                    ${this.health.healthScore === 100 ? `
                        <li>✅ Perfect! All systems operational and ready for customer calls</li>
                    ` : `
                        ${this.health.healthScore >= 80 ? `
                            <li>⚠️ Mostly configured, but ${this.getHealthIssues()}</li>
                        ` : `
                            <li>❌ Critical issues detected: ${this.getHealthIssues()}</li>
                        `}
                    `}
                </ul>
            </div>
        `;
    }

    /**
     * Render call routing settings
     */
    renderCallRouting() {
        const mode = this.config.callRouting.mode || 'ai-agent';
        const recording = this.config.callRouting.recordingEnabled !== false;

        return `
            <div class="twilio-section">
                <h3>📞 Call Routing</h3>
                <div class="routing-options">
                    <div class="radio-group">
                        <label class="radio-option ${mode === 'ai-agent' ? 'selected' : ''}">
                            <input type="radio" name="routing-mode" value="ai-agent" ${mode === 'ai-agent' ? 'checked' : ''}>
                            <span class="radio-label">
                                <strong>AI Agent</strong>
                                <small>Route calls to AI receptionist</small>
                            </span>
                        </label>
                        <label class="radio-option ${mode === 'voicemail' ? 'selected' : ''}">
                            <input type="radio" name="routing-mode" value="voicemail" ${mode === 'voicemail' ? 'checked' : ''}>
                            <span class="radio-label">
                                <strong>Voicemail</strong>
                                <small>Send calls to voicemail</small>
                            </span>
                        </label>
                        <label class="radio-option ${mode === 'forward' ? 'selected' : ''}">
                            <input type="radio" name="routing-mode" value="forward" ${mode === 'forward' ? 'checked' : ''}>
                            <span class="radio-label">
                                <strong>Forward</strong>
                                <small>Forward to another number</small>
                            </span>
                        </label>
                    </div>

                    ${mode === 'forward' ? `
                        <div class="forward-number-input">
                            <label>Forward To:</label>
                            <input type="tel" id="forward-number" value="${this.config.callRouting.forwardNumber || ''}" placeholder="+1-239-555-0100">
                        </div>
                    ` : ''}

                    <div class="routing-settings">
                        <label class="checkbox-option">
                            <input type="checkbox" id="recording-enabled" ${recording ? 'checked' : ''}>
                            <span>Enable call recording</span>
                        </label>
                    </div>

                    <button class="btn-primary" onclick="twilioControl.saveRouting()">
                        Save Routing Settings
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render activity timeline
     */
    renderActivity() {
        if (this.activity.length === 0) {
            return `
                <div class="twilio-section">
                    <h3>📊 Recent Activity</h3>
                    <div class="no-activity">
                        <p>No recent calls</p>
                    </div>
                </div>
            `;
        }

        const activityHTML = this.activity.map(call => `
            <div class="activity-item">
                <div class="activity-icon ${call.status === 'completed' ? 'success' : 'warning'}">
                    ${call.direction === 'inbound' ? '📞' : '📱'}
                </div>
                <div class="activity-details">
                    <div class="activity-main">
                        <strong>${call.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call</strong>
                        <span>${call.status === 'completed' ? 'answered' : call.status}</span>
                    </div>
                    <div class="activity-meta">
                        <span>From: ${call.from}</span>
                        ${call.duration ? `<span>Duration: ${this.formatDuration(call.duration)}</span>` : ''}
                    </div>
                </div>
                <div class="activity-time">${call.timeAgo}</div>
            </div>
        `).join('');

        return `
            <div class="twilio-section">
                <h3>📊 Recent Activity</h3>
                <div class="activity-timeline">
                    ${activityHTML}
                </div>
                <button class="btn-secondary" onclick="twilioControl.viewFullHistory()">
                    View Full History
                </button>
            </div>
        `;
    }

    /**
     * Render action buttons
     */
    renderActions() {
        return `
            <div class="twilio-actions">
                <button class="btn-test" onclick="twilioControl.testConnection()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM6.5 4v8l6-4-6-4z"/>
                    </svg>
                    Test Twilio Connection
                </button>
                <button class="btn-secondary" onclick="twilioControl.refresh()">
                    🔄 Refresh
                </button>
                <button class="btn-secondary" onclick="twilioControl.viewLogs()">
                    📋 View Logs
                </button>
            </div>
        `;
    }

    /**
     * Render error state
     */
    renderError(message) {
        const container = document.getElementById('twilio-control-center');
        if (!container) return;

        container.innerHTML = `
            <div class="twilio-error">
                <div class="error-icon">⚠️</div>
                <h3>Failed to Load Twilio Control Center</h3>
                <p>${message}</p>
                <button class="btn-primary" onclick="twilioControl.initialize()">
                    Retry
                </button>
            </div>
        `;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Radio buttons for routing mode
        document.querySelectorAll('input[name="routing-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.render(); // Re-render to show/hide forward number input
            });
        });
    }

    /**
     * Save routing settings
     */
    async saveRouting() {
        const mode = document.querySelector('input[name="routing-mode"]:checked')?.value;
        const forwardNumber = document.getElementById('forward-number')?.value;
        const recordingEnabled = document.getElementById('recording-enabled')?.checked;

        if (mode === 'forward' && !forwardNumber) {
            alert('⚠️ Please enter a forward number');
            return;
        }

        try {
            const response = await fetch(`/api/company/${this.companyId}/twilio-control/routing`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    mode,
                    forwardNumber: mode === 'forward' ? forwardNumber : null,
                    recordingEnabled
                })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();

            console.log('✅ [TWILIO CONTROL] Routing saved:', result);
            alert('✅ Routing settings saved successfully!');

            await this.refresh();

        } catch (error) {
            console.error('❌ [TWILIO CONTROL] Save routing failed:', error);
            alert(`Failed to save routing settings: ${error.message}`);
        }
    }

    /**
     * Test Twilio connection
     */
    async testConnection() {
        const testNumber = prompt('Enter a phone number to test with (e.g., +1-239-555-0100):');
        if (!testNumber) return;

        try {
            const response = await fetch(`/api/company/${this.companyId}/twilio-control/test-call`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ testPhoneNumber: testNumber })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP ${response.status}`);
            }

            const result = await response.json();

            console.log('✅ [TWILIO CONTROL] Test call initiated:', result);
            alert(`✅ Test call initiated!\n\nCall SID: ${result.callSid}\nStatus: ${result.status}\n\nYou should receive a call shortly.`);

        } catch (error) {
            console.error('❌ [TWILIO CONTROL] Test call failed:', error);
            alert(`Test call failed: ${error.message}`);
        }
    }

    /**
     * Refresh all data
     */
    async refresh() {
        if (this.isRefreshing) {
            console.warn('⏳ [TWILIO CONTROL] Refresh already in progress, skipping');
            return;
        }
        this.isRefreshing = true;
        console.log('🔄 [TWILIO CONTROL] Refreshing...');
        try {
            await this.loadAllData();
            this.render();
            this.backoffMs = 0; // reset backoff on success
            console.log('✅ [TWILIO CONTROL] Refreshed');
        } catch (error) {
            console.error('❌ [TWILIO CONTROL] Refresh failed:', error);
            // Exponential backoff up to 5 minutes
            this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, 300000) : 5000;
            console.warn(`⏱️ [TWILIO CONTROL] Applying backoff: ${this.backoffMs}ms`);
            this.stopAutoRefresh();
            setTimeout(() => {
                this.startAutoRefresh();
            }, this.backoffMs);
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Start auto-refresh every 30 seconds
     */
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        const intervalMs = this.backoffMs > 0 ? Math.max(this.backoffMs, 30000) : 30000;
        this.refreshInterval = setInterval(() => {
            this.refresh();
        }, intervalMs);

        console.log(`🔄 [TWILIO CONTROL] Auto-refresh enabled (${intervalMs / 1000}s)`);
    }

    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            console.log('🛑 [TWILIO CONTROL] Auto-refresh disabled');
        }
    }

    /**
     * Navigate to Profile Configuration
     */
    goToProfileConfig() {
        // This would navigate to the Profile Configuration tab
        alert('Navigate to Profile Configuration tab to edit Twilio credentials');
        // TODO: Implement actual navigation
    }

    /**
     * Show change number modal
     */
    showChangeNumberModal() {
        alert('Change Number modal - TODO: Implement');
        // TODO: Build modal
    }

    /**
     * View full call history
     */
    viewFullHistory() {
        alert('View Full History - TODO: Implement');
        // TODO: Navigate to full history page
    }

    /**
     * View logs
     */
    viewLogs() {
        alert('View Logs - TODO: Implement');
        // TODO: Show logs modal
    }

    /**
     * Format duration in seconds to MM:SS
     */
    formatDuration(seconds) {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Get human-readable time ago
     */
    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);
        
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    /**
     * Navigate to Configuration tab
     */
    goToConfigurationTab() {
        const configTab = document.getElementById('tab-config');
        if (configTab) {
            configTab.click();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            alert('Configuration tab not found');
        }
    }

    /**
     * Refresh status manually
     */
    async refreshStatus() {
        console.log('🔄 [TWILIO CONTROL] Manual refresh requested');
        try {
            await this.loadAllData();
            this.render();
            console.log('✅ [TWILIO CONTROL] Status refreshed');
        } catch (error) {
            console.error('❌ [TWILIO CONTROL] Refresh failed:', error);
            alert('Failed to refresh status: ' + error.message);
        }
    }

    /**
     * Copy full diagnostics to clipboard
     */
    async copyDiagnostics() {
        const report = this.generateDiagnosticReport();
        
        try {
            await navigator.clipboard.writeText(report);
            alert('✅ Diagnostics copied!\n\nPaste this to AI for debugging help.');
        } catch (error) {
            const textarea = document.createElement('textarea');
            textarea.value = report;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert('✅ Diagnostics copied!\n\nPaste this to AI for debugging help.');
        }
    }

    /**
     * Generate diagnostic report
     */
    generateDiagnosticReport() {
        const diagnostics = this.status.diagnostics || {};
        return `
═══════════════════════════════════════════════════
TWILIO DIAGNOSTIC REPORT
═══════════════════════════════════════════════════

Generated: ${new Date().toISOString()}
Company ID: ${this.companyId}

OVERALL STATUS:
- Configured: ${this.status.configured ? 'YES' : 'NO'}
- Connected: ${this.status.connected ? 'YES' : 'NO'}
- Health Score: ${this.health.healthScore}/100

CHECKPOINT 1: TWILIO CREDENTIALS
- Account SID: ${diagnostics.accountSid || '❌ Missing'}
- Auth Token: ${diagnostics.authToken || '❌ Missing'}
${this.status.accountSid ? `- SID Value: ${this.status.accountSid}` : ''}

CHECKPOINT 2: PHONE NUMBER
- Status: ${diagnostics.phoneNumber || '❌ Missing'}
${this.status.phoneNumber ? `- Number: ${this.status.phoneNumber}` : ''}

CHECKPOINT 3: TWILIO API CONNECTION
- Connection: ${this.status.connected ? '✅ Connected' : '❌ Failed'}
${this.status.errorMessage ? `- Error: ${this.status.errorMessage}` : ''}

CHECKPOINT 4: AI VOICE
- Status: ${diagnostics.voice || '⚠️ Not configured'}
${this.config.voiceSettings?.selectedVoice ? `- Voice: ${this.config.voiceSettings.selectedVoice}` : ''}

RECOMMENDATIONS:
${this.getDetailedRecommendations()}

═══════════════════════════════════════════════════
        `.trim();
    }

    /**
     * Get health issues
     */
    getHealthIssues() {
        const issues = [];
        const d = this.status.diagnostics || {};
        
        if (d.accountSID !== '✅ Configured') issues.push('Account SID missing');
        if (d.authToken !== '✅ Configured') issues.push('Auth Token missing');
        if (d.phoneNumber !== '✅ Configured') issues.push('Phone number missing');
        if (!this.status.connected && this.status.configured) issues.push('Connection failed');
        
        return issues.length > 0 ? issues.join(', ') : 'Unknown';
    }

    /**
     * Get detailed recommendations
     */
    getDetailedRecommendations() {
        const recs = [];
        const d = this.status.diagnostics || {};
        
        if (!this.status.configured) {
            recs.push('1. Go to Configuration tab');
            if (d.accountSid !== '✅ Configured') recs.push('   - Add Account SID');
            if (d.authToken !== '✅ Configured') recs.push('   - Add Auth Token');
            if (d.phoneNumber !== '✅ Configured') recs.push('   - Add Phone Number');
            recs.push('2. Save and return here');
        } else if (!this.status.connected) {
            recs.push('1. Verify credentials in Configuration tab');
            recs.push('2. Check Twilio account at console.twilio.com');
            if (this.status.errorMessage) recs.push(`3. Error: ${this.status.errorMessage}`);
        } else {
            recs.push('✅ All systems operational!');
        }
        
        return recs.join('\n');
    }

    /**
     * Destroy and cleanup
     */
    destroy() {
        this.stopAutoRefresh();
        console.log('💀 [TWILIO CONTROL] Destroyed');
    }
}

// Note: Global instance is declared in company-profile.html initialization script

