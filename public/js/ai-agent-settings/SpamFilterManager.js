// ============================================================================
// 🛡️ SPAM FILTER MANAGER - FRONTEND UI
// ============================================================================
// 📋 PURPOSE: Frontend UI for Smart Call Filter Management
// 
// 🎯 FEATURES:
//    - Enable/disable spam filtering
//    - Manage blacklist & whitelist  
//    - Configure detection settings (3 checkboxes)
//    - View spam statistics
// 
// 🔄 AUTO-REFRESH: Every 60 seconds
// 
// ⚠️ CRITICAL SCHEMA INFORMATION (October 2025):
// This UI uses the NEW schema keys ONLY:
//    ✅ checkGlobalSpamDB (Check Global Spam Database)
//    ✅ enableFrequencyCheck (Frequency Analysis)
//    ✅ enableRobocallDetection (Robocall Detection)
// 
// OLD SCHEMA KEYS (DO NOT USE):
//    ❌ blockKnownSpam → Replaced by checkGlobalSpamDB
//    ❌ blockHighFrequency → Replaced by enableFrequencyCheck
//    ❌ blockRobocalls → Replaced by enableRobocallDetection
// 
// 🔗 RELATED FILES:
//    - Backend API: routes/admin/callFiltering.js
//    - Mongoose Model: models/v2Company.js (lines 1707-1777)
//    - Verification: scripts/verify-spam-filter-schema.js
//    - Documentation: docs/SPAM-FILTER-FIX-COMPLETE-REPORT.md
// 
// 📝 FRONTEND-BACKEND CONTRACT:
//    GET /api/admin/call-filtering/:companyId/settings
//       → Returns: { settings: { checkGlobalSpamDB, enableFrequencyCheck, enableRobocallDetection } }
//    
//    PUT /api/admin/call-filtering/:companyId/settings
//       → Sends: { settings: { checkGlobalSpamDB, enableFrequencyCheck, enableRobocallDetection } }
//       → Backend saves ONLY these 3 keys (purges old schema)
// 
// ⚠️ WARNING FOR FUTURE ENGINEERS:
// If you need to add a new spam filter checkbox:
//    1. Add the key to this file (see lines 105-150 for checkbox rendering)
//    2. Add the key to saveSettings() method (see line 513-523)
//    3. Update backend API to accept/save the new key (routes/admin/callFiltering.js)
//    4. Update Mongoose schema (models/v2Company.js)
//    5. Run: node scripts/verify-spam-filter-schema.js
// 
// 🎨 UI STRUCTURE:
//    - Section 1: Detection Settings (3 checkboxes)
//    - Section 2: Blacklist Management
//    - Section 3: Whitelist Management
//    - Section 4: Statistics Dashboard
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
            console.log(`🔍 [SPAM FILTER] CHECKPOINT 4.1: Detection settings from backend:`, {
                checkGlobalSpamDB: this.settings.settings?.checkGlobalSpamDB,
                enableFrequencyCheck: this.settings.settings?.enableFrequencyCheck,
                enableRobocallDetection: this.settings.settings?.enableRobocallDetection,
                rawSettings: this.settings.settings
            });

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
        
        // ────────────────────────────────────────────────────────────────────────
        // 🤖 AUTO-BLACKLIST: Split blacklist into pending and active
        // ────────────────────────────────────────────────────────────────────────
        const pendingBlacklist = blacklist.filter(e => 
            typeof e === 'object' && e.status === 'pending'
        );
        const activeBlacklist = blacklist.filter(e => 
            typeof e === 'string' || (typeof e === 'object' && e.status === 'active')
        );
        const autoDetectedCount = blacklist.filter(e => 
            typeof e === 'object' && e.source === 'auto'
        ).length;
        
        console.log(`🤖 [SPAM FILTER] Auto-blacklist counts:`, {
            total: blacklist.length,
            pending: pendingBlacklist.length,
            active: activeBlacklist.length,
            autoDetected: autoDetectedCount
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
                            <i class="fas fa-robot"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-value">${autoDetectedCount}</div>
                            <div class="stat-label">Auto-Detected Numbers</div>
                        </div>
                    </div>
                </div>

                <!-- 🤖 Pending Review Section -->
                ${pendingBlacklist.length > 0 ? `
                    <div class="filter-section review-pending" style="border: 2px solid #f59e0b; border-radius: 8px; margin: 24px 0; animation: pulse-warning 2s infinite;">
                        <div class="filter-section-header" style="background: #fef3c7; border-left: 4px solid #f59e0b;">
                            <h3 style="display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i>
                                Review Auto-Detected Spam
                                <span style="background: #dc2626; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-left: 12px;">
                                    ${pendingBlacklist.length} Awaiting Review
                                </span>
                            </h3>
                        </div>
                        <div class="filter-section-content">
                            <p style="color: #92400e; margin-bottom: 16px; background: #fef3c7; padding: 12px; border-radius: 6px; border-left: 4px solid #f59e0b;">
                                <strong>⚠️ These numbers were auto-detected as spam but need your approval before blocking.</strong><br>
                                Review each one carefully to avoid blocking legitimate customers.
                            </p>
                            
                            <div class="pending-list">
                                ${pendingBlacklist.map((entry) => `
                                    <div class="pending-item" style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border: 1px solid #fbbf24; border-radius: 8px; background: #fffbeb; margin-bottom: 12px;">
                                        <div class="pending-info" style="flex: 1;">
                                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                                <i class="fas fa-phone" style="color: #f59e0b;"></i>
                                                <strong style="font-size: 16px;">${entry.phoneNumber}</strong>
                                                <span style="background: #f59e0b; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
                                                    Pending Review
                                                </span>
                                            </div>
                                            <div style="margin-left: 24px; font-size: 13px; color: #78350f;">
                                                <div><strong>Detected:</strong> ${new Date(entry.addedAt).toLocaleString()}</div>
                                                <div><strong>Reason:</strong> ${entry.reason || 'Auto-detected spam'}</div>
                                                <div><strong>Edge Case:</strong> ${entry.edgeCaseName || 'Unknown'}</div>
                                            </div>
                                        </div>
                                        <div class="pending-actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
                                            <button class="btn-success btn-sm" onclick="spamFilterManager.approveSpam('${entry.phoneNumber}')" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">
                                                <i class="fas fa-check"></i> Approve & Block
                                            </button>
                                            <button class="btn-danger btn-sm" onclick="spamFilterManager.rejectSpam('${entry.phoneNumber}')" style="background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">
                                                <i class="fas fa-times"></i> Reject
                                            </button>
                                            <button class="btn-secondary btn-sm" onclick="spamFilterManager.whitelistAndNeverBlock('${entry.phoneNumber}')" style="background: #6b7280; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">
                                                <i class="fas fa-star"></i> Whitelist
                                            </button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            
                            <div style="margin-top: 16px; display: flex; gap: 12px;">
                                <button onclick="spamFilterManager.approveAllPending()" style="background: #10b981; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;">
                                    <i class="fas fa-check-double"></i> Approve All (${pendingBlacklist.length})
                                </button>
                                <button onclick="spamFilterManager.rejectAllPending()" style="background: #ef4444; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;">
                                    <i class="fas fa-times-circle"></i> Reject All
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <style>
                        @keyframes pulse-warning {
                            0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
                            50% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
                        }
                    </style>
                ` : ''}

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
                            ${activeBlacklist.length === 0 ? `
                                <div class="empty-state-small">
                                    <i class="fas fa-ban"></i>
                                    <p>No blocked numbers</p>
                                </div>
                            ` : `
                                <div class="number-list">
                                    ${activeBlacklist.map((entry) => {
                                        // Handle both old format (string) and new format (object)
                                        const phone = typeof entry === 'string' ? entry : entry.phoneNumber;
                                        const source = entry.source || 'manual';
                                        const reason = entry.reason || 'Manually blacklisted';
                                        const timesBlocked = entry.timesBlocked || 0;
                                        const addedAt = entry.addedAt ? new Date(entry.addedAt).toLocaleDateString() : 'Unknown';
                                        const badge = source === 'auto' ? ' 🤖' : '';
                                        const bgClass = source === 'auto' ? 'style="background: linear-gradient(to right, #f3f4f6, #fef3c7); border-left: 3px solid #f59e0b; padding: 12px; border-radius: 6px;"' : 'style="padding: 12px;"';
                                        
                                        return `
                                            <div class="number-item" ${bgClass}>
                                                <div class="number-info" style="flex: 1;">
                                                    <div style="display: flex; align-items: center; gap: 8px;">
                                                        <i class="fas fa-phone"></i>
                                                        <span style="font-weight: 600;">${phone}${badge}</span>
                                                    </div>
                                                    <div style="font-size: 12px; color: #6b7280; margin-top: 4px; margin-left: 24px;">
                                                        ${source === 'auto' ? 
                                                            `Auto-detected on ${addedAt} (${reason})` : 
                                                            `Added manually on ${addedAt}`
                                                        }
                                                        ${timesBlocked > 0 ? ` • Blocked ${timesBlocked} times` : ''}
                                                    </div>
                                                </div>
                                                <button class="btn-danger btn-xs" onclick="spamFilterManager.removeFromBlacklist('${phone}')" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer;">
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        `;
                                    }).join('')}
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

                <!-- 🤖 Auto-Blacklist Settings -->
                <div class="filter-section" style="margin-top: 24px;">
                    <div class="filter-section-header">
                        <h3>
                            <i class="fas fa-robot" style="color: #8b5cf6;"></i>
                            Auto-Blacklist Settings
                        </h3>
                    </div>
                    <div class="filter-section-content">
                        <div class="setting-item" style="margin-bottom: 20px;">
                            <label class="setting-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="auto-blacklist-enabled" ${settings.autoBlacklistEnabled ? 'checked' : ''} onchange="document.getElementById('auto-blacklist-options').style.display = this.checked ? 'block' : 'none';">
                                <strong>Enable Auto-Blacklist</strong>
                            </label>
                            <p class="setting-description" style="margin-left: 28px; font-size: 13px; color: #6b7280;">
                                Automatically add numbers to blacklist when spam edge cases are detected during calls
                            </p>
                        </div>
                        
                        <div id="auto-blacklist-options" style="display: ${settings.autoBlacklistEnabled ? 'block' : 'none'}; margin-left: 24px; padding-left: 16px; border-left: 3px solid #8b5cf6;">
                            
                            <div class="setting-item" style="margin-bottom: 16px;">
                                <label class="setting-label" style="font-weight: 600; display: block; margin-bottom: 8px;">Detection Triggers:</label>
                                <div style="margin-left: 20px;">
                                    <label style="display: block; margin-bottom: 6px; cursor: pointer;">
                                        <input type="checkbox" class="auto-trigger" value="ai_telemarketer" 
                                            ${(settings.autoBlacklistTriggers || []).includes('ai_telemarketer') ? 'checked' : ''}>
                                        AI Telemarketer / Robocall
                                    </label>
                                    <label style="display: block; margin-bottom: 6px; cursor: pointer;">
                                        <input type="checkbox" class="auto-trigger" value="ivr_system" 
                                            ${(settings.autoBlacklistTriggers || []).includes('ivr_system') ? 'checked' : ''}>
                                        IVR System / Automated Menu
                                    </label>
                                    <label style="display: block; margin-bottom: 6px; cursor: pointer;">
                                        <input type="checkbox" class="auto-trigger" value="call_center_noise" 
                                            ${(settings.autoBlacklistTriggers || []).includes('call_center_noise') ? 'checked' : ''}>
                                        Call Center Background Noise
                                    </label>
                                    <label style="display: block; margin-bottom: 6px; cursor: pointer;">
                                        <input type="checkbox" class="auto-trigger" value="robocall" 
                                            ${(settings.autoBlacklistTriggers || []).includes('robocall') ? 'checked' : ''}>
                                        Robocall Detection
                                    </label>
                                    <label style="display: block; margin-bottom: 6px; cursor: pointer;">
                                        <input type="checkbox" class="auto-trigger" value="dead_air" 
                                            ${(settings.autoBlacklistTriggers || []).includes('dead_air') ? 'checked' : ''}>
                                        Dead Air / No Response (risky - can cause false positives)
                                    </label>
                                </div>
                            </div>
                            
                            <div class="setting-item" style="margin-bottom: 16px;">
                                <label class="setting-label" style="font-weight: 600; display: flex; align-items: center; gap: 8px;">
                                    Add to blacklist after:
                                    <input type="number" id="auto-blacklist-threshold" 
                                        value="${settings.autoBlacklistThreshold || 1}" 
                                        min="1" max="10" 
                                        style="width: 60px; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 14px;">
                                    detection(s)
                                </label>
                                <p class="setting-description" style="font-size: 13px; color: #6b7280; margin-top: 4px;">
                                    Threshold prevents false positives: 1 = aggressive, 2-3 = balanced, 4-5 = conservative
                                </p>
                            </div>
                            
                            <div class="setting-item" style="margin-bottom: 16px;">
                                <label class="setting-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" id="require-admin-approval" ${settings.requireAdminApproval !== false ? 'checked' : ''}>
                                    Require admin approval before blocking
                                </label>
                                <p class="setting-description" style="margin-left: 28px; font-size: 13px; color: #6b7280;">
                                    Numbers will be added as "pending" and require manual approval in the review section above
                                </p>
                            </div>
                            
                        </div>
                        
                        <div style="margin-top: 16px;">
                            <button onclick="spamFilterManager.saveAutoBlacklistSettings()" style="background: #8b5cf6; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;">
                                <i class="fas fa-save"></i> Save Auto-Blacklist Settings
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

    /**
     * ────────────────────────────────────────────────────────────────────────
     * 🤖 APPROVE SPAM (change status from 'pending' to 'active')
     * ────────────────────────────────────────────────────────────────────────
     */
    async approveSpam(phoneNumber) {
        if (!confirm(`Approve ${phoneNumber} as spam?\n\nFuture calls from this number will be blocked.`)) {
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/blacklist/${encodeURIComponent(phoneNumber)}/approve`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error('Approval failed');
            
            this.notify(`✅ Approved! ${phoneNumber} will now be blocked.`, 'success');
            await this.load();  // Reload to update UI
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Approval error:', error);
            this.notify('Failed to approve spam number', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * 🤖 REJECT SPAM (remove from list - it's not actually spam)
     * ────────────────────────────────────────────────────────────────────────
     */
    async rejectSpam(phoneNumber) {
        if (!confirm(`Reject ${phoneNumber}?\n\nThis number will be removed from the spam list.`)) {
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/blacklist/${encodeURIComponent(phoneNumber)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error('Rejection failed');
            
            this.notify(`✅ Rejected. ${phoneNumber} removed from spam list.`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Rejection error:', error);
            this.notify('Failed to reject spam number', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * 🤖 WHITELIST AND NEVER BLOCK (for false positives)
     * ────────────────────────────────────────────────────────────────────────
     */
    async whitelistAndNeverBlock(phoneNumber) {
        if (!confirm(`Whitelist ${phoneNumber}?\n\nThis number will be:\n• Removed from blacklist\n• Added to whitelist\n• NEVER auto-blocked again`)) {
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            
            // Step 1: Remove from blacklist
            await fetch(`/api/admin/call-filtering/${this.companyId}/blacklist/${encodeURIComponent(phoneNumber)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            // Step 2: Add to whitelist
            const response = await fetch(`/api/admin/call-filtering/whitelist/${this.companyId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    phoneNumber,
                    reason: 'False positive - manually whitelisted'
                })
            });
            
            if (!response.ok) throw new Error('Whitelist failed');
            
            this.notify(`✅ Whitelisted! ${phoneNumber} will never be blocked.`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Whitelist error:', error);
            this.notify('Failed to whitelist number', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * 🤖 APPROVE ALL PENDING
     * ────────────────────────────────────────────────────────────────────────
     */
    async approveAllPending() {
        const pendingCount = this.settings.blacklist.filter(e => typeof e === 'object' && e.status === 'pending').length;
        
        if (!confirm(`Approve all ${pendingCount} pending numbers?\n\nAll will be moved to active blacklist.`)) {
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/blacklist/approve-all`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error('Bulk approval failed');
            
            this.notify(`✅ Approved ${pendingCount} numbers!`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Bulk approval error:', error);
            this.notify('Failed to approve all', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * 🤖 REJECT ALL PENDING
     * ────────────────────────────────────────────────────────────────────────
     */
    async rejectAllPending() {
        const pendingCount = this.settings.blacklist.filter(e => typeof e === 'object' && e.status === 'pending').length;
        
        if (!confirm(`Reject all ${pendingCount} pending numbers?\n\nAll will be removed from the list.`)) {
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/blacklist/reject-all`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error('Bulk rejection failed');
            
            this.notify(`✅ Rejected ${pendingCount} numbers.`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Bulk rejection error:', error);
            this.notify('Failed to reject all', 'error');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * 🤖 SAVE AUTO-BLACKLIST SETTINGS
     * ────────────────────────────────────────────────────────────────────────
     */
    async saveAutoBlacklistSettings() {
        try {
            const enabled = document.getElementById('auto-blacklist-enabled').checked;
            const threshold = parseInt(document.getElementById('auto-blacklist-threshold').value);
            const requireApproval = document.getElementById('require-admin-approval').checked;
            
            const triggers = [];
            document.querySelectorAll('.auto-trigger:checked').forEach(checkbox => {
                triggers.push(checkbox.value);
            });
            
            console.log(`💾 [SPAM FILTER] Saving auto-blacklist settings:`, {
                enabled,
                threshold,
                triggers,
                requireApproval
            });
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/settings`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    settings: {
                        ...this.settings.settings,  // Keep existing settings
                        autoBlacklistEnabled: enabled,
                        autoBlacklistThreshold: threshold,
                        autoBlacklistTriggers: triggers,
                        requireAdminApproval: requireApproval
                    }
                })
            });
            
            if (!response.ok) throw new Error('Save failed');
            
            this.notify('✅ Auto-blacklist settings saved successfully', 'success');
            await this.load();  // Reload to show updated UI
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Auto-blacklist save error:', error);
            this.notify('Failed to save auto-blacklist settings', 'error');
        }
    }
}

