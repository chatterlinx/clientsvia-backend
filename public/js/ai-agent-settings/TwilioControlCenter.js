/**
 * ============================================================================
 * TWILIO CONTROL CENTER - AI AGENT SETTINGS TAB
 * ============================================================================
 * 
 * PURPOSE: Frontend management for Twilio telephony integration
 * LOCATION: Top of AI Agent Settings tab
 * ISOLATION: 100% separate from legacy AI Agent Logic (to be deleted)
 * 
 * FEATURES:
 * - Real-time connection status
 * - Health score (0-100)
 * - Phone number management
 * - Call routing settings
 * - Activity timeline
 * - Test call functionality
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

        const [statusRes, configRes, healthRes, activityRes] = await Promise.all([
            fetch(`/api/company/${this.companyId}/twilio-control/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`/api/company/${this.companyId}/twilio-control/config`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`/api/company/${this.companyId}/twilio-control/health`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }),
            fetch(`/api/company/${this.companyId}/twilio-control/activity?limit=5`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
        ]);

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
     * Render status cards (Connection, Phone, Credentials)
     */
    renderStatusCards() {
        const healthColor = this.health.healthScore >= 80 ? 'green' : this.health.healthScore >= 60 ? 'yellow' : 'red';

        return `
            <div class="twilio-cards-grid">
                <!-- Connection Status -->
                <div class="twilio-card">
                    <div class="card-icon ${this.status.connected ? 'connected' : 'disconnected'}">
                        ${this.status.connected ? '🟢' : '🔴'}
                    </div>
                    <h3>Connection Status</h3>
                    <div class="card-value">${this.status.connected ? 'Connected' : 'Disconnected'}</div>
                    <div class="card-meta">
                        <span class="health-score ${healthColor}">${this.health.healthScore}/100 Health</span>
                        ${this.status.lastChecked ? `<span>Last: ${this.getTimeAgo(this.status.lastChecked)}</span>` : ''}
                    </div>
                    ${!this.status.connected && this.status.errorMessage ? `
                        <div class="card-error">${this.status.errorMessage}</div>
                    ` : ''}
                </div>

                <!-- Phone Number -->
                <div class="twilio-card">
                    <div class="card-icon">📱</div>
                    <h3>Phone Number</h3>
                    <div class="card-value">${this.config.phoneNumber || 'Not configured'}</div>
                    <div class="card-meta">
                        ${this.config.phoneNumbers.length > 1 ? `<span>+${this.config.phoneNumbers.length - 1} more</span>` : ''}
                    </div>
                    <button class="card-action" onclick="twilioControl.showChangeNumberModal()">
                        Change Number
                    </button>
                </div>

                <!-- Credentials -->
                <div class="twilio-card">
                    <div class="card-icon">🔑</div>
                    <h3>Credentials</h3>
                    <div class="card-value credentials">
                        <div class="credential-row">
                            <span>SID:</span>
                            <span>${this.status.accountSid || 'Not set'}</span>
                        </div>
                        <div class="credential-row">
                            <span>Token:</span>
                            <span>${this.config.authTokenMasked || '••••••••'}</span>
                        </div>
                    </div>
                    <button class="card-action" onclick="twilioControl.goToProfileConfig()">
                        Edit in Profile
                    </button>
                </div>
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
        console.log('🔄 [TWILIO CONTROL] Refreshing...');
        try {
            await this.loadAllData();
            this.render();
            console.log('✅ [TWILIO CONTROL] Refreshed');
        } catch (error) {
            console.error('❌ [TWILIO CONTROL] Refresh failed:', error);
        }
    }

    /**
     * Start auto-refresh every 30 seconds
     */
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(() => {
            this.refresh();
        }, 30000); // 30 seconds

        console.log('🔄 [TWILIO CONTROL] Auto-refresh enabled (30s)');
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
     * Destroy and cleanup
     */
    destroy() {
        this.stopAutoRefresh();
        console.log('💀 [TWILIO CONTROL] Destroyed');
    }
}

// Note: Global instance is declared in company-profile.html initialization script

