// ============================================================================
// SPAM FILTER MANAGER
// ============================================================================
// 📋 PURPOSE: Frontend UI for Smart Call Filter Management
// 🎯 FEATURES:
//    - Enable/disable spam filtering
//    - Manage blacklist & whitelist
//    - View blocked call logs
//    - Configure detection settings
//    - View spam statistics
// 🔄 AUTO-REFRESH: Every 60 seconds
// ============================================================================

class SpamFilterManager {
    constructor(companyId) {
        console.log(`🛡️ [SPAM FILTER] CHECKPOINT 1: Constructor called for company: ${companyId}`);
        this.companyId = companyId;
        this.refreshInterval = null;
        this.settings = null;
        this.blockedLogs = [];
        console.log(`✅ [SPAM FILTER] CHECKPOINT 2: Initialized successfully`);
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * INITIALIZE
     * ────────────────────────────────────────────────────────────────────────
     */
    async init() {
        console.log(`🎯 [SPAM FILTER] Init called - starting load...`);
        await this.load();
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * LOAD DATA
     * ────────────────────────────────────────────────────────────────────────
     */
    async load() {
        try {
            console.log(`🛡️ [SPAM FILTER] CHECKPOINT 3: Loading spam filter data...`);

            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error(`❌ [SPAM FILTER] No auth token found`);
                this.renderError('Authentication required');
                return;
            }

            // Fetch settings
            const settingsRes = await fetch(`/api/admin/call-filtering/${this.companyId}/settings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!settingsRes.ok) {
                throw new Error(`Failed to load settings: ${settingsRes.status}`);
            }

            const settingsData = await settingsRes.json();
            this.settings = settingsData.data || {};

            console.log(`✅ [SPAM FILTER] CHECKPOINT 4: Settings loaded successfully`);
            console.log(`   - Enabled: ${this.settings.enabled}`);
            console.log(`   - Blacklist: ${this.settings.blacklist?.length || 0} numbers`);
            console.log(`   - Whitelist: ${this.settings.whitelist?.length || 0} numbers`);

            // Render UI
            this.render();

            console.log(`✅ [SPAM FILTER] CHECKPOINT 5: Dashboard loaded successfully`);

            // Start auto-refresh
            this.startAutoRefresh();

        } catch (error) {
            console.error(`❌ [SPAM FILTER] ERROR loading dashboard:`, error);
            this.renderError(error.message);
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER DASHBOARD
     * ────────────────────────────────────────────────────────────────────────
     */
    render() {
        console.log(`🎨 [SPAM FILTER] CHECKPOINT 6: Starting render...`);
        
        const container = document.getElementById('spam-filter-dashboard-container');
        if (!container) {
            console.error(`❌ [SPAM FILTER] Container not found`);
            return;
        }

        const { enabled, blacklist = [], whitelist = [], settings = {}, stats = {} } = this.settings;
        
        // 🔍 DEBUG: Log what settings we're rendering
        console.log(`🔍 [SPAM FILTER] CHECKPOINT 6.1: Rendering with settings:`, {
            checkGlobalSpamDB: settings.checkGlobalSpamDB,
            enableFrequencyCheck: settings.enableFrequencyCheck,
            enableRobocallDetection: settings.enableRobocallDetection
        });

        // Build HTML
        container.innerHTML = `
            <div class="spam-filter-dashboard">
                
                <!-- Status Banner -->
                <div class="status-banner ${enabled ? 'status-active' : 'status-inactive'}">
                    <div class="status-content">
                        <div class="status-icon">
                            <i class="fas fa-shield-alt"></i>
                        </div>
                        <div class="status-info">
                            <h3>${enabled ? '🟢 Spam Filter Active' : '🔴 Spam Filter Disabled'}</h3>
                            <p>${enabled ? 'Your AI agent is protected from spam and robocalls' : 'Enable spam filtering to protect your AI agent'}</p>
                        </div>
                        <div class="status-toggle">
                            <label class="toggle-switch">
                                <input type="checkbox" id="spam-filter-toggle" ${enabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Statistics Cards -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon red">
                            <i class="fas fa-ban"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-value">${stats.totalBlocked || 0}</div>
                            <div class="stat-label">Calls Blocked (All Time)</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon yellow">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-value">${blacklist.length}</div>
                            <div class="stat-label">Blacklisted Numbers</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon green">
                            <i class="fas fa-check-circle"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-value">${whitelist.length}</div>
                            <div class="stat-label">Whitelisted Numbers</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon blue">
                            <i class="fas fa-shield-virus"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-value">${stats.todayBlocked || 0}</div>
                            <div class="stat-label">Blocked Today</div>
                        </div>
                    </div>
                </div>

                <!-- Main Content Grid -->
                <div class="filter-content-grid">
                    
                    <!-- Blacklist Section -->
                    <div class="filter-section">
                        <div class="filter-section-header">
                            <h3>
                                <i class="fas fa-ban text-red-500"></i>
                                Blacklist
                            </h3>
                            <button class="btn-secondary btn-sm" onclick="spamFilterManager.addToBlacklist()">
                                <i class="fas fa-plus"></i> Add Number
                            </button>
                        </div>
                        <div class="filter-section-content">
                            ${blacklist.length === 0 ? `
                                <div class="empty-state-small">
                                    <i class="fas fa-ban"></i>
                                    <p>No blocked numbers</p>
                                </div>
                            ` : `
                                <div class="number-list">
                                    ${blacklist.map((num, idx) => `
                                        <div class="number-item">
                                            <div class="number-info">
                                                <i class="fas fa-phone"></i>
                                                <span>${num}</span>
                                            </div>
                                            <button class="btn-danger btn-xs" onclick="spamFilterManager.removeFromBlacklist('${num}')">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            `}
                        </div>
                    </div>

                    <!-- Whitelist Section -->
                    <div class="filter-section">
                        <div class="filter-section-header">
                            <h3>
                                <i class="fas fa-check-circle text-green-500"></i>
                                Whitelist
                            </h3>
                            <button class="btn-secondary btn-sm" onclick="spamFilterManager.addToWhitelist()">
                                <i class="fas fa-plus"></i> Add Number
                            </button>
                        </div>
                        <div class="filter-section-content">
                            ${whitelist.length === 0 ? `
                                <div class="empty-state-small">
                                    <i class="fas fa-check-circle"></i>
                                    <p>No whitelisted numbers</p>
                                </div>
                            ` : `
                                <div class="number-list">
                                    ${whitelist.map((num, idx) => `
                                        <div class="number-item">
                                            <div class="number-info">
                                                <i class="fas fa-phone"></i>
                                                <span>${num}</span>
                                            </div>
                                            <button class="btn-danger btn-xs" onclick="spamFilterManager.removeFromWhitelist('${num}')">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            `}
                        </div>
                    </div>

                </div>

                <!-- Detection Settings -->
                <div class="filter-section">
                    <div class="filter-section-header">
                        <h3>
                            <i class="fas fa-cog text-blue-500"></i>
                            Detection Settings
                        </h3>
                    </div>
                    <div class="filter-section-content">
                        <div class="settings-grid">
                            <div class="setting-item">
                                <label class="setting-label">
                                    <input type="checkbox" id="check-global-db" ${settings.checkGlobalSpamDB === true ? 'checked' : ''}>
                                    Check Global Spam Database
                                </label>
                                <p class="setting-description">Blocks numbers reported as spam by other companies</p>
                            </div>
                            <div class="setting-item">
                                <label class="setting-label">
                                    <input type="checkbox" id="frequency-check" ${settings.enableFrequencyCheck === true ? 'checked' : ''}>
                                    Frequency Analysis
                                </label>
                                <p class="setting-description">Blocks numbers calling too frequently</p>
                            </div>
                            <div class="setting-item">
                                <label class="setting-label">
                                    <input type="checkbox" id="robocall-detection" ${settings.enableRobocallDetection === true ? 'checked' : ''}>
                                    Robocall Detection
                                </label>
                                <p class="setting-description">AI-powered detection of automated calls</p>
                            </div>
                        </div>
                        <div class="mt-4">
                            <button class="btn-primary" onclick="spamFilterManager.saveSettings()">
                                <i class="fas fa-save"></i> Save Settings
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        `;

        console.log(`✅ [SPAM FILTER] Render complete`);

        // Attach event listeners
        this.attachEventListeners();
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * EVENT LISTENERS
     * ────────────────────────────────────────────────────────────────────────
     */
    attachEventListeners() {
        const toggle = document.getElementById('spam-filter-toggle');
        if (toggle) {
            toggle.addEventListener('change', (e) => this.toggleSpamFilter(e.target.checked));
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * TOGGLE SPAM FILTER
     * ────────────────────────────────────────────────────────────────────────
     */
    async toggleSpamFilter(enabled) {
        try {
            console.log(`🛡️ [SPAM FILTER] Toggling filter: ${enabled}`);

            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/settings`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enabled })
            });

            if (!response.ok) {
                throw new Error('Failed to update settings');
            }

            this.settings.enabled = enabled;
            this.render();

            // Show success notification
            this.notify(enabled ? 'Spam filter enabled' : 'Spam filter disabled', 'success');

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Error toggling filter:`, error);
            this.notify('Failed to update settings', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * ADD TO BLACKLIST
     * ────────────────────────────────────────────────────────────────────────
     */
    async addToBlacklist() {
        const phoneNumber = prompt('Enter phone number to blacklist (E.164 format, e.g., +15551234567):');
        if (!phoneNumber) return;

        // Validate E.164 format
        if (!phoneNumber.match(/^\+[1-9]\d{1,14}$/)) {
            this.notify('Invalid phone number format. Use E.164 format (e.g., +15551234567)', 'error');
            return;
        }

        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/blacklist`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phoneNumber })
            });

            if (!response.ok) {
                throw new Error('Failed to add to blacklist');
            }

            this.settings.blacklist.push(phoneNumber);
            this.render();
            this.notify('Number added to blacklist', 'success');

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Error adding to blacklist:`, error);
            this.notify('Failed to add number', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * REMOVE FROM BLACKLIST
     * ────────────────────────────────────────────────────────────────────────
     */
    async removeFromBlacklist(phoneNumber) {
        console.log(`🗑️ [SPAM FILTER] Attempting to remove from blacklist: ${phoneNumber}`);
        
        if (!confirm(`Remove ${phoneNumber} from blacklist?`)) {
            console.log(`⏭️ [SPAM FILTER] Removal cancelled by user`);
            return;
        }

        try {
            const token = localStorage.getItem('adminToken');
            
            // ⚠️ CRITICAL BUG FIX: Backend route expects phoneNumber in URL path, not body!
            console.log(`🌐 [SPAM FILTER] Sending DELETE request to: /api/admin/call-filtering/${this.companyId}/blacklist/${encodeURIComponent(phoneNumber)}`);
            
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/blacklist/${encodeURIComponent(phoneNumber)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`📥 [SPAM FILTER] Response status: ${response.status}`);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error(`❌ [SPAM FILTER] Remove failed:`, errorData);
                throw new Error(errorData.message || 'Failed to remove from blacklist');
            }

            const responseData = await response.json();
            console.log(`✅ [SPAM FILTER] Successfully removed from blacklist:`, responseData);

            this.settings.blacklist = this.settings.blacklist.filter(num => num !== phoneNumber);
            this.render();
            this.notify('Number removed from blacklist', 'success');

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Error removing from blacklist:`, error);
            console.error(`❌ [SPAM FILTER] Stack:`, error.stack);
            this.notify('Failed to remove number', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * ADD TO WHITELIST
     * ────────────────────────────────────────────────────────────────────────
     */
    async addToWhitelist() {
        const phoneNumber = prompt('Enter phone number to whitelist (E.164 format, e.g., +15551234567):');
        if (!phoneNumber) return;

        // Validate E.164 format
        if (!phoneNumber.match(/^\+[1-9]\d{1,14}$/)) {
            this.notify('Invalid phone number format. Use E.164 format (e.g., +15551234567)', 'error');
            return;
        }

        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/whitelist/${this.companyId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phoneNumber })
            });

            if (!response.ok) {
                throw new Error('Failed to add to whitelist');
            }

            this.settings.whitelist.push(phoneNumber);
            this.render();
            this.notify('Number added to whitelist', 'success');

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Error adding to whitelist:`, error);
            this.notify('Failed to add number', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * REMOVE FROM WHITELIST
     * ────────────────────────────────────────────────────────────────────────
     */
    async removeFromWhitelist(phoneNumber) {
        if (!confirm(`Remove ${phoneNumber} from whitelist?`)) return;

        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/whitelist/${this.companyId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phoneNumber })
            });

            if (!response.ok) {
                throw new Error('Failed to remove from whitelist');
            }

            this.settings.whitelist = this.settings.whitelist.filter(num => num !== phoneNumber);
            this.render();
            this.notify('Number removed from whitelist', 'success');

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Error removing from whitelist:`, error);
            this.notify('Failed to remove number', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * SAVE DETECTION SETTINGS
     * ────────────────────────────────────────────────────────────────────────
     */
    async saveSettings() {
        try {
            console.log(`💾 [SPAM FILTER] CHECKPOINT 7: Save Settings clicked`);

            const checkGlobalDB = document.getElementById('check-global-db').checked;
            const frequencyCheck = document.getElementById('frequency-check').checked;
            const robocallDetection = document.getElementById('robocall-detection').checked;

            console.log(`📋 [SPAM FILTER] CHECKPOINT 8: Settings to save:`, {
                checkGlobalSpamDB: checkGlobalDB,
                enableFrequencyCheck: frequencyCheck,
                enableRobocallDetection: robocallDetection
            });

            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error(`❌ [SPAM FILTER] No auth token found`);
                this.notify('Authentication required', 'error');
                return;
            }

            console.log(`🌐 [SPAM FILTER] CHECKPOINT 9: Sending PUT request to: /api/admin/call-filtering/${this.companyId}/settings`);

            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/settings`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    settings: {
                        checkGlobalSpamDB: checkGlobalDB,
                        enableFrequencyCheck: frequencyCheck,
                        enableRobocallDetection: robocallDetection
                    }
                })
            });

            console.log(`📥 [SPAM FILTER] CHECKPOINT 10: Response status: ${response.status}`);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error(`❌ [SPAM FILTER] Save failed:`, errorData);
                throw new Error(errorData.message || 'Failed to save settings');
            }

            const responseData = await response.json();
            console.log(`✅ [SPAM FILTER] CHECKPOINT 11: Settings saved successfully:`, responseData);

            // Update local settings
            this.settings.settings = {
                checkGlobalSpamDB: checkGlobalDB,
                enableFrequencyCheck: frequencyCheck,
                enableRobocallDetection: robocallDetection
            };

            this.notify('Detection settings saved', 'success');

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Error saving settings:`, error);
            console.error(`❌ [SPAM FILTER] Stack:`, error.stack);
            this.notify('Failed to save settings', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER ERROR
     * ────────────────────────────────────────────────────────────────────────
     */
    renderError(message) {
        const container = document.getElementById('spam-filter-dashboard-container');
        if (!container) return;

        container.innerHTML = `
            <div class="error-banner">
                <i class="fas fa-exclamation-triangle"></i>
                <div>
                    <strong>Failed to load Spam Filter Dashboard</strong>
                    <p>${message}</p>
                </div>
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * AUTO-REFRESH
     * ────────────────────────────────────────────────────────────────────────
     */
    startAutoRefresh() {
        // Refresh every 60 seconds
        this.refreshInterval = setInterval(() => {
            console.log('🔄 [SPAM FILTER] Auto-refreshing...');
            this.load();
        }, 60000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * NOTIFICATION HELPER - World-Class Toast System
     * ────────────────────────────────────────────────────────────────────────
     */
    notify(message, type = 'info') {
        console.log(`🔔 [SPAM FILTER] NOTIFICATION: [${type.toUpperCase()}] ${message}`);
        
        // Create toast container if it doesn't exist
        let toastContainer = document.getElementById('spam-filter-toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'spam-filter-toast-container';
            toastContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 999999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            `;
            document.body.appendChild(toastContainer);
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'spam-filter-toast';
        
        // Set icon and color based on type
        let icon = 'ℹ️';
        let bgColor = '#3B82F6'; // blue
        let textColor = '#FFFFFF';
        
        if (type === 'success') {
            icon = '✅';
            bgColor = '#10B981'; // green
        } else if (type === 'error') {
            icon = '❌';
            bgColor = '#EF4444'; // red
        } else if (type === 'warning') {
            icon = '⚠️';
            bgColor = '#F59E0B'; // orange
        }

        toast.style.cssText = `
            background: ${bgColor};
            color: ${textColor};
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 300px;
            max-width: 500px;
            pointer-events: auto;
            cursor: pointer;
            transform: translateX(400px);
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        `;

        toast.innerHTML = `
            <span style="font-size: 20px; line-height: 1;">${icon}</span>
            <span style="flex: 1;">${message}</span>
            <span style="opacity: 0.7; font-size: 18px; line-height: 1;">×</span>
        `;

        toastContainer.appendChild(toast);

        // Animate in
        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
            toast.style.opacity = '1';
        }, 10);

        // Auto-dismiss after 3 seconds
        const dismissToast = () => {
            toast.style.transform = 'translateX(400px)';
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
                // Remove container if empty
                if (toastContainer.children.length === 0 && toastContainer.parentNode) {
                    toastContainer.parentNode.removeChild(toastContainer);
                }
            }, 300);
        };

        const timeoutId = setTimeout(dismissToast, 3000);

        // Click to dismiss
        toast.addEventListener('click', () => {
            clearTimeout(timeoutId);
            dismissToast();
        });
    }
}

