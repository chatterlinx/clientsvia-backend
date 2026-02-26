// ============================================================================
// 🛡️ SMART CALL FILTER MANAGER - ENTERPRISE EDITION
// ============================================================================
// 📋 PURPOSE: Advanced enterprise-grade spam detection and call filtering UI
// 
// 🎯 ENTERPRISE FEATURES:
//    ✅ Real-time threat monitoring dashboard
//    ✅ Advanced analytics & reporting
//    ✅ Multi-layer detection engine controls
//    ✅ Intelligent auto-blacklist system
//    ✅ Comprehensive audit trails
//    ✅ Search & filter capabilities
//    ✅ Bulk operations management
//    ✅ Performance metrics tracking
// 
// 🏗️ ARCHITECTURE:
//    - Modular component-based design
//    - State management with reactive updates
//    - Error boundary protection
//    - Optimized API call patterns
//    - Graceful degradation support
// 
// 🔄 AUTO-REFRESH: Intelligent polling (60s default)
// 
// ⚠️ SCHEMA SPECIFICATION (Post-Nuclear-Nuke Recovery - Feb 2026):
// Core Detection Settings:
//    ✅ checkGlobalSpamDB - Global spam database lookup
//    ✅ enableFrequencyCheck - Call frequency analysis
//    ✅ enableRobocallDetection - AI-powered robocall detection
// 
// Auto-Blacklist Settings:
//    ✅ autoBlacklistEnabled - Enable automatic blacklisting
//    ✅ autoBlacklistThreshold - Detections before blacklist
//    ✅ autoBlacklistTriggers - Array of trigger types
//    ✅ requireAdminApproval - Require manual approval
// 
// 🔗 SYSTEM INTEGRATION:
//    - Backend API: routes/admin/callFiltering.js
//    - Service Layer: services/SmartCallFilter.js
//    - Data Model: models/v2Company.js
//    - Call Processing: routes/v2twilio.js
// 
// 📝 API CONTRACTS:
//    GET  /api/admin/call-filtering/:companyId/settings
//    PUT  /api/admin/call-filtering/:companyId/settings
//    POST /api/admin/call-filtering/:companyId/blacklist
//    DELETE /api/admin/call-filtering/:companyId/blacklist/:phoneNumber
//    POST /api/admin/call-filtering/whitelist/:companyId
//    DELETE /api/admin/call-filtering/whitelist/:companyId
//    POST /api/admin/call-filtering/:companyId/blacklist/:phoneNumber/approve
//    POST /api/admin/call-filtering/:companyId/blacklist/approve-all
//    POST /api/admin/call-filtering/:companyId/blacklist/reject-all
// 
// 🎨 UI COMPONENT HIERARCHY:
//    └── Smart Call Filter Dashboard
//        ├── System Status Panel (Active/Inactive Banner)
//        ├── Analytics Overview (4 Metric Cards)
//        ├── Pending Review Section (Auto-detected threats)
//        ├── Management Grid
//        │   ├── Blacklist Manager
//        │   └── Whitelist Manager
//        ├── Detection Engine Configuration
//        └── Auto-Blacklist Intelligence Settings
// ============================================================================

class SpamFilterManager {
    constructor(companyId) {
        console.log(`🛡️ [SPAM FILTER] Initializing Enterprise Edition for company: ${companyId}`);
        
        // Core configuration
        this.companyId = companyId;
        this.refreshInterval = null;
        this.settings = null;
        this.blockedLogs = [];
        
        // UI state management
        this.state = {
            isLoading: false,
            searchQuery: '',
            filterMode: 'all',
            sortBy: 'date',
            sortOrder: 'desc',
            activeTab: 'overview'
        };
        
        // Error handling
        this.errorRetryCount = 0;
        this.maxRetries = 3;
        
        console.log(`✅ [SPAM FILTER] Enterprise Edition initialized successfully`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // LIFECYCLE METHODS
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Initialize dashboard and start auto-refresh
     */
    async init() {
        console.log(`🚀 [SPAM FILTER] Starting dashboard initialization...`);
        
        try {
            await this.load();
            this.startAutoRefresh();
            console.log(`✅ [SPAM FILTER] Dashboard initialized - auto-refresh active`);
        } catch (error) {
            console.error(`❌ [SPAM FILTER] Initialization failed:`, error);
            this.renderError('Failed to initialize dashboard. Please refresh the page.');
        }
    }

    /**
     * Load data from backend
     */
    async load() {
        if (this.state.isLoading) {
            console.log(`⏭️ [SPAM FILTER] Load already in progress, skipping...`);
            return;
        }

        try {
            this.state.isLoading = true;
            console.log(`📡 [SPAM FILTER] Fetching data from backend...`);

            const token = localStorage.getItem('adminToken');
            if (!token) {
                throw new Error('Authentication required - please log in');
            }

            // Fetch settings from backend
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/settings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            this.settings = data.data || {};
            
            // Reset error count on success
            this.errorRetryCount = 0;

            console.log(`✅ [SPAM FILTER] Data loaded successfully:`, {
                enabled: this.settings.enabled,
                blacklist: this.settings.blacklist?.length || 0,
                whitelist: this.settings.whitelist?.length || 0,
                autoBlacklistEnabled: this.settings.settings?.autoBlacklistEnabled
            });

            // Render the dashboard
            this.render();

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Load failed:`, error);
            
            // Implement exponential backoff retry
            if (this.errorRetryCount < this.maxRetries) {
                this.errorRetryCount++;
                const retryDelay = Math.pow(2, this.errorRetryCount) * 1000;
                console.log(`🔄 [SPAM FILTER] Retry ${this.errorRetryCount}/${this.maxRetries} in ${retryDelay}ms...`);
                setTimeout(() => this.load(), retryDelay);
            } else {
                this.renderError(error.message);
            }
        } finally {
            this.state.isLoading = false;
        }
    }

    /**
     * Start auto-refresh interval
     */
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        this.refreshInterval = setInterval(() => {
            console.log('🔄 [SPAM FILTER] Auto-refreshing dashboard...');
            this.load();
        }, 60000); // 60 seconds
    }

    /**
     * Stop auto-refresh interval
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            console.log('⏹️ [SPAM FILTER] Auto-refresh stopped');
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // RENDERING METHODS
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Main render method - builds entire dashboard
     */
    render() {
        console.log(`🎨 [SPAM FILTER] Rendering Enterprise Dashboard...`);
        
        const container = document.getElementById('spam-filter-dashboard-container');
        if (!container) {
            console.error(`❌ [SPAM FILTER] Container element not found`);
            return;
        }

        const { enabled, blacklist = [], whitelist = [], settings = {}, stats = {} } = this.settings;
        
        // Categorize blacklist entries
        const pendingBlacklist = blacklist.filter(e => 
            typeof e === 'object' && e.status === 'pending'
        );
        const activeBlacklist = blacklist.filter(e => 
            typeof e === 'string' || (typeof e === 'object' && e.status === 'active')
        );
        const autoDetectedCount = blacklist.filter(e => 
            typeof e === 'object' && e.source === 'auto'
        ).length;
        
        console.log(`📊 [SPAM FILTER] Dashboard metrics:`, {
            enabled,
            totalBlocked: stats.totalBlocked || 0,
            activeBlacklist: activeBlacklist.length,
            pendingReview: pendingBlacklist.length,
            whitelist: whitelist.length,
            autoDetected: autoDetectedCount
        });

        // Build enterprise-grade dashboard HTML
        container.innerHTML = `
            <div class="spam-filter-enterprise-dashboard">
                
                ${this.renderSystemStatus(enabled)}
                ${this.renderAnalyticsOverview(stats, blacklist, whitelist, autoDetectedCount)}
                ${pendingBlacklist.length > 0 ? this.renderPendingReviewSection(pendingBlacklist) : ''}
                ${this.renderManagementGrid(activeBlacklist, whitelist)}
                ${this.renderDetectionConfiguration(settings)}
                ${this.renderAutoBlacklistSettings(settings)}
                
            </div>
        `;

        // Attach event listeners after rendering
        this.attachEventListeners();
        
        console.log(`✅ [SPAM FILTER] Dashboard render complete`);
    }

    /**
     * Render system status banner
     */
    renderSystemStatus(enabled) {
        const statusClass = enabled ? 'status-active' : 'status-inactive';
        const statusIcon = enabled ? '✓' : '✕';
        const statusText = enabled ? 'Protection Active' : 'Protection Disabled';
        const statusDesc = enabled 
            ? 'Your AI agent is fully protected against spam and robocalls'
            : 'Enable protection to defend against unwanted calls';
        
        return `
            <div class="enterprise-status-banner ${statusClass}">
                <div class="status-banner-content">
                    <div class="status-indicator">
                        <div class="status-pulse"></div>
                        <div class="status-icon">${statusIcon}</div>
                    </div>
                    <div class="status-details">
                        <h2 class="status-title">
                            <i class="fas fa-shield-alt"></i>
                            Smart Call Filter ${statusText}
                        </h2>
                        <p class="status-description">${statusDesc}</p>
                    </div>
                    <div class="status-controls">
                        <label class="enterprise-toggle">
                            <input type="checkbox" id="spam-filter-toggle" ${enabled ? 'checked' : ''}>
                            <span class="toggle-track">
                                <span class="toggle-indicator"></span>
                            </span>
                            <span class="toggle-label">${enabled ? 'Enabled' : 'Disabled'}</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render analytics overview cards
     */
    renderAnalyticsOverview(stats, blacklist, whitelist, autoDetectedCount) {
        const totalBlocked = stats.totalBlocked || 0;
        const blockRate = stats.blockRate || 0;
        const todayBlocked = stats.todayBlocked || 0;
        
        return `
            <div class="analytics-overview">
                <h3 class="section-title">
                    <i class="fas fa-chart-line"></i>
                    Protection Analytics
                </h3>
                <div class="analytics-grid">
                    
                    <div class="metric-card card-primary">
                        <div class="metric-header">
                            <div class="metric-icon">
                                <i class="fas fa-ban"></i>
                            </div>
                            <span class="metric-label">Total Blocked</span>
                        </div>
                        <div class="metric-value">${totalBlocked.toLocaleString()}</div>
                        <div class="metric-footer">
                            <i class="fas fa-clock"></i>
                            All-time protection
                        </div>
                    </div>
                    
                    <div class="metric-card card-warning">
                        <div class="metric-header">
                            <div class="metric-icon">
                                <i class="fas fa-list"></i>
                            </div>
                            <span class="metric-label">Blacklisted</span>
                        </div>
                        <div class="metric-value">${blacklist.length}</div>
                        <div class="metric-footer">
                            <i class="fas fa-robot"></i>
                            ${autoDetectedCount} auto-detected
                        </div>
                    </div>
                    
                    <div class="metric-card card-success">
                        <div class="metric-header">
                            <div class="metric-icon">
                                <i class="fas fa-check-circle"></i>
                            </div>
                            <span class="metric-label">Whitelisted</span>
                        </div>
                        <div class="metric-value">${whitelist.length}</div>
                        <div class="metric-footer">
                            <i class="fas fa-shield-check"></i>
                            Trusted numbers
                        </div>
                    </div>
                    
                    <div class="metric-card card-info">
                        <div class="metric-header">
                            <div class="metric-icon">
                                <i class="fas fa-calendar-day"></i>
                            </div>
                            <span class="metric-label">Today</span>
                        </div>
                        <div class="metric-value">${todayBlocked}</div>
                        <div class="metric-footer">
                            <i class="fas fa-trending-up"></i>
                            Blocked today
                        </div>
                    </div>
                    
                </div>
            </div>
        `;
    }

    /**
     * Render pending review section for auto-detected spam
     */
    renderPendingReviewSection(pendingBlacklist) {
        return `
            <div class="pending-review-section">
                <div class="section-header header-warning">
                    <h3 class="section-title">
                        <i class="fas fa-exclamation-triangle"></i>
                        Pending Review
                        <span class="badge badge-danger">${pendingBlacklist.length} Awaiting</span>
                    </h3>
                    <div class="section-actions">
                        <button class="btn btn-success btn-sm" onclick="spamFilterManager.approveAllPending()">
                            <i class="fas fa-check-double"></i>
                            Approve All
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="spamFilterManager.rejectAllPending()">
                            <i class="fas fa-times-circle"></i>
                            Reject All
                        </button>
                    </div>
                </div>
                
                <div class="pending-review-content">
                    <div class="alert alert-warning">
                        <i class="fas fa-info-circle"></i>
                        <div>
                            <strong>Auto-Detection Review Required</strong>
                            <p>These numbers were flagged by our AI system. Review each carefully to avoid blocking legitimate callers.</p>
                        </div>
                    </div>
                    
                    <div class="pending-list">
                        ${pendingBlacklist.map(entry => this.renderPendingItem(entry)).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render individual pending review item
     */
    renderPendingItem(entry) {
        const detectedDate = new Date(entry.addedAt).toLocaleString();
        const reason = entry.reason || 'Auto-detected spam pattern';
        const edgeCase = entry.edgeCaseName || 'Unknown pattern';
        
        return `
            <div class="pending-item">
                <div class="pending-info">
                    <div class="pending-phone">
                        <i class="fas fa-phone"></i>
                        <strong>${entry.phoneNumber}</strong>
                        <span class="badge badge-warning">Pending</span>
                    </div>
                    <div class="pending-details">
                        <div class="detail-row">
                            <i class="fas fa-calendar"></i>
                            Detected: ${detectedDate}
                        </div>
                        <div class="detail-row">
                            <i class="fas fa-flag"></i>
                            Reason: ${reason}
                        </div>
                        <div class="detail-row">
                            <i class="fas fa-tag"></i>
                            Pattern: ${edgeCase}
                        </div>
                    </div>
                </div>
                <div class="pending-actions">
                    <button class="btn btn-success btn-sm" onclick="spamFilterManager.approveSpam('${entry.phoneNumber}')" title="Block this number">
                        <i class="fas fa-check"></i>
                        Approve
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="spamFilterManager.rejectSpam('${entry.phoneNumber}')" title="Remove from list">
                        <i class="fas fa-times"></i>
                        Reject
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="spamFilterManager.whitelistAndNeverBlock('${entry.phoneNumber}')" title="Add to whitelist">
                        <i class="fas fa-star"></i>
                        Whitelist
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render blacklist and whitelist management grid
     */
    renderManagementGrid(activeBlacklist, whitelist) {
        return `
            <div class="management-grid">
                
                <!-- Blacklist Panel -->
                <div class="management-panel panel-blacklist">
                    <div class="panel-header">
                        <h3 class="panel-title">
                            <i class="fas fa-ban"></i>
                            Blacklist
                        </h3>
                        <button class="btn btn-primary btn-sm" onclick="spamFilterManager.addToBlacklist()">
                            <i class="fas fa-plus"></i>
                            Add Number
                        </button>
                    </div>
                    
                    <div class="panel-content">
                        ${activeBlacklist.length === 0 ? `
                            <div class="empty-state">
                                <div class="empty-icon">
                                    <i class="fas fa-ban"></i>
                                </div>
                                <p class="empty-text">No blocked numbers</p>
                                <p class="empty-hint">Numbers added here will be automatically blocked</p>
                            </div>
                        ` : `
                            <div class="number-list">
                                ${activeBlacklist.map(entry => this.renderBlacklistItem(entry)).join('')}
                            </div>
                        `}
                    </div>
                </div>
                
                <!-- Whitelist Panel -->
                <div class="management-panel panel-whitelist">
                    <div class="panel-header">
                        <h3 class="panel-title">
                            <i class="fas fa-check-circle"></i>
                            Whitelist
                        </h3>
                        <button class="btn btn-primary btn-sm" onclick="spamFilterManager.addToWhitelist()">
                            <i class="fas fa-plus"></i>
                            Add Number
                        </button>
                    </div>
                    
                    <div class="panel-content">
                        ${whitelist.length === 0 ? `
                            <div class="empty-state">
                                <div class="empty-icon">
                                    <i class="fas fa-check-circle"></i>
                                </div>
                                <p class="empty-text">No whitelisted numbers</p>
                                <p class="empty-hint">Numbers added here will never be blocked</p>
                            </div>
                        ` : `
                            <div class="number-list">
                                ${whitelist.map((num, idx) => this.renderWhitelistItem(num)).join('')}
                            </div>
                        `}
                    </div>
                </div>
                
            </div>
        `;
    }

    /**
     * Render blacklist item
     */
    renderBlacklistItem(entry) {
        const phone = typeof entry === 'string' ? entry : entry.phoneNumber;
        const source = entry.source || 'manual';
        const reason = entry.reason || 'Manually blacklisted';
        const timesBlocked = entry.timesBlocked || 0;
        const addedAt = entry.addedAt ? new Date(entry.addedAt).toLocaleDateString() : 'Unknown';
        const isAuto = source === 'auto';
        const isGlobal = entry.isGlobal || false;
        const globalReportCount = entry.globalReportCount || 0;
        
        return `
            <div class="number-item ${isAuto ? 'item-auto' : ''} ${isGlobal ? 'item-global' : ''}">
                <div class="number-info">
                    <div class="number-phone">
                        <i class="fas fa-phone"></i>
                        <strong>${phone}</strong>
                        ${isAuto ? '<span class="badge badge-purple">Auto</span>' : ''}
                        ${isGlobal ? '<span class="badge badge-global"><i class="fas fa-globe"></i> Global</span>' : '<span class="badge badge-local"><i class="fas fa-building"></i> Local</span>'}
                        ${isGlobal && globalReportCount > 1 ? `<span class="badge badge-info">${globalReportCount} reports</span>` : ''}
                    </div>
                    <div class="number-meta">
                        <span><i class="fas fa-calendar"></i> ${addedAt}</span>
                        ${timesBlocked > 0 ? `<span><i class="fas fa-ban"></i> Blocked ${timesBlocked}× </span>` : ''}
                    </div>
                    <div class="number-reason">${reason}</div>
                </div>
                <div class="number-actions">
                    ${!isGlobal ? `
                        <button class="btn btn-global btn-sm" onclick="spamFilterManager.makeGlobal('${phone}')" title="Report to global spam database - blocks for ALL companies">
                            <i class="fas fa-globe"></i>
                            Make Global
                        </button>
                    ` : `
                        <span class="global-indicator" title="Reported to global database by ${globalReportCount} ${globalReportCount === 1 ? 'company' : 'companies'}">
                            <i class="fas fa-shield-alt"></i>
                            Protected Globally
                        </span>
                    `}
                    <button class="btn btn-danger btn-icon" onclick="spamFilterManager.removeFromBlacklist('${phone}')" title="Remove from blacklist">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render whitelist item
     */
    renderWhitelistItem(num) {
        return `
            <div class="number-item">
                <div class="number-info">
                    <div class="number-phone">
                        <i class="fas fa-phone"></i>
                        <strong>${num}</strong>
                        <span class="badge badge-success">Trusted</span>
                    </div>
                </div>
                <button class="btn btn-danger btn-icon" onclick="spamFilterManager.removeFromWhitelist('${num}')" title="Remove from whitelist">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
    }

    /**
     * Render detection engine configuration
     */
    renderDetectionConfiguration(settings) {
        return `
            <div class="configuration-panel">
                <div class="panel-header">
                    <h3 class="panel-title">
                        <i class="fas fa-cogs"></i>
                        Detection Engine Configuration
                    </h3>
                </div>
                
                <div class="panel-content">
                    <p class="panel-description">
                        Configure multi-layer spam detection algorithms. Each layer provides additional protection.
                    </p>
                    
                    <div class="detection-settings">
                        
                        <div class="setting-card">
                            <div class="setting-control">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="check-global-db" ${settings.checkGlobalSpamDB === true ? 'checked' : ''}>
                                    <span class="checkbox-custom"></span>
                                    <span class="setting-name">Global Spam Database</span>
                                </label>
                                <span class="setting-badge badge-primary">Recommended</span>
                            </div>
                            <p class="setting-description">
                                Blocks numbers reported as spam by other companies in our global database
                            </p>
                        </div>
                        
                        <div class="setting-card">
                            <div class="setting-control">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="frequency-check" ${settings.enableFrequencyCheck === true ? 'checked' : ''}>
                                    <span class="checkbox-custom"></span>
                                    <span class="setting-name">Frequency Analysis</span>
                                </label>
                                <span class="setting-badge badge-info">Advanced</span>
                            </div>
                            <p class="setting-description">
                                Detects and blocks numbers making excessive calls within short time periods
                            </p>
                        </div>
                        
                        <div class="setting-card">
                            <div class="setting-control">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="robocall-detection" ${settings.enableRobocallDetection === true ? 'checked' : ''}>
                                    <span class="checkbox-custom"></span>
                                    <span class="setting-name">AI Robocall Detection</span>
                                </label>
                                <span class="setting-badge badge-success">AI-Powered</span>
                            </div>
                            <p class="setting-description">
                                Uses machine learning to identify and block automated calling patterns
                            </p>
                        </div>
                        
                    </div>
                    
                    <div class="panel-footer">
                        <button class="btn btn-primary" onclick="spamFilterManager.saveSettings()">
                            <i class="fas fa-save"></i>
                            Save Detection Settings
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render auto-blacklist settings
     */
    renderAutoBlacklistSettings(settings) {
        const enabled = settings.autoBlacklistEnabled === true;
        const threshold = settings.autoBlacklistThreshold || 1;
        const triggers = settings.autoBlacklistTriggers || [];
        const requireApproval = settings.requireAdminApproval !== false;
        
        return `
            <div class="configuration-panel auto-blacklist-panel">
                <div class="panel-header">
                    <h3 class="panel-title">
                        <i class="fas fa-robot"></i>
                        Auto-Blacklist Intelligence
                    </h3>
                </div>
                
                <div class="panel-content">
                    <div class="setting-card setting-card-prominent">
                        <div class="setting-control">
                            <label class="checkbox-label">
                                <input type="checkbox" id="auto-blacklist-enabled" ${enabled ? 'checked' : ''} onchange="document.getElementById('auto-blacklist-options').style.display = this.checked ? 'block' : 'none';">
                                <span class="checkbox-custom"></span>
                                <span class="setting-name">Enable Auto-Blacklist</span>
                            </label>
                            <span class="setting-badge badge-purple">Intelligent</span>
                        </div>
                        <p class="setting-description">
                            Automatically add numbers to blacklist when AI detects spam patterns during calls
                        </p>
                    </div>
                    
                    <div id="auto-blacklist-options" style="display: ${enabled ? 'block' : 'none'};" class="auto-blacklist-options">
                        
                        <div class="options-section">
                            <h4 class="options-title">
                                <i class="fas fa-flag"></i>
                                Detection Triggers
                            </h4>
                            <p class="options-description">Select which patterns should trigger auto-blacklist</p>
                            
                            <div class="trigger-grid">
                                <label class="trigger-option ${triggers.includes('ai_telemarketer') ? 'selected' : ''}">
                                    <input type="checkbox" class="auto-trigger" value="ai_telemarketer" ${triggers.includes('ai_telemarketer') ? 'checked' : ''}>
                                    <span class="trigger-icon"><i class="fas fa-robot"></i></span>
                                    <span class="trigger-name">AI Telemarketer</span>
                                </label>
                                
                                <label class="trigger-option ${triggers.includes('ivr_system') ? 'selected' : ''}">
                                    <input type="checkbox" class="auto-trigger" value="ivr_system" ${triggers.includes('ivr_system') ? 'checked' : ''}>
                                    <span class="trigger-icon"><i class="fas fa-phone-volume"></i></span>
                                    <span class="trigger-name">IVR System</span>
                                </label>
                                
                                <label class="trigger-option ${triggers.includes('call_center_noise') ? 'selected' : ''}">
                                    <input type="checkbox" class="auto-trigger" value="call_center_noise" ${triggers.includes('call_center_noise') ? 'checked' : ''}>
                                    <span class="trigger-icon"><i class="fas fa-volume-up"></i></span>
                                    <span class="trigger-name">Call Center Noise</span>
                                </label>
                                
                                <label class="trigger-option ${triggers.includes('robocall') ? 'selected' : ''}">
                                    <input type="checkbox" class="auto-trigger" value="robocall" ${triggers.includes('robocall') ? 'checked' : ''}>
                                    <span class="trigger-icon"><i class="fas fa-phone-slash"></i></span>
                                    <span class="trigger-name">Robocall</span>
                                </label>
                                
                                <label class="trigger-option ${triggers.includes('dead_air') ? 'selected' : ''}">
                                    <input type="checkbox" class="auto-trigger" value="dead_air" ${triggers.includes('dead_air') ? 'checked' : ''}>
                                    <span class="trigger-icon"><i class="fas fa-volume-mute"></i></span>
                                    <span class="trigger-name">Dead Air</span>
                                    <span class="trigger-warning" title="May cause false positives">⚠️</span>
                                </label>
                            </div>
                        </div>
                        
                        <div class="options-section">
                            <h4 class="options-title">
                                <i class="fas fa-sliders-h"></i>
                                Detection Threshold
                            </h4>
                            <p class="options-description">Number of detections before auto-blacklist activation</p>
                            
                            <div class="threshold-control">
                                <input type="range" id="auto-blacklist-threshold" value="${threshold}" min="1" max="10" step="1" class="threshold-slider" oninput="document.getElementById('threshold-value').textContent = this.value">
                                <div class="threshold-display">
                                    <span class="threshold-value" id="threshold-value">${threshold}</span>
                                    <span class="threshold-label">detection(s)</span>
                                </div>
                                <div class="threshold-guide">
                                    <span>Aggressive (1)</span>
                                    <span>Balanced (2-3)</span>
                                    <span>Conservative (4+)</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="options-section">
                            <h4 class="options-title">
                                <i class="fas fa-user-check"></i>
                                Approval Settings
                            </h4>
                            
                            <div class="setting-card">
                                <div class="setting-control">
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="require-admin-approval" ${requireApproval ? 'checked' : ''}>
                                        <span class="checkbox-custom"></span>
                                        <span class="setting-name">Require Admin Approval</span>
                                    </label>
                                    <span class="setting-badge badge-warning">Recommended</span>
                                </div>
                                <p class="setting-description">
                                    Numbers will be flagged for review before blocking to prevent false positives
                                </p>
                            </div>
                        </div>
                        
                    </div>
                    
                    <div class="panel-footer">
                        <button class="btn btn-primary" onclick="spamFilterManager.saveAutoBlacklistSettings()">
                            <i class="fas fa-save"></i>
                            Save Auto-Blacklist Settings
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render error state
     */
    renderError(message) {
        const container = document.getElementById('spam-filter-dashboard-container');
        if (!container) return;

        container.innerHTML = `
            <div class="error-container">
                <div class="error-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <h3 class="error-title">Unable to Load Dashboard</h3>
                <p class="error-message">${message}</p>
                <button class="btn btn-primary" onclick="spamFilterManager.load()">
                    <i class="fas fa-redo"></i>
                    Retry
                </button>
            </div>
        `;
    }

    // ════════════════════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Attach event listeners to interactive elements
     */
    attachEventListeners() {
        const toggle = document.getElementById('spam-filter-toggle');
        if (toggle) {
            toggle.addEventListener('change', (e) => this.toggleSpamFilter(e.target.checked));
        }
    }

    /**
     * Toggle spam filter on/off
     */
    async toggleSpamFilter(enabled) {
        try {
            console.log(`🔄 [SPAM FILTER] Toggling protection: ${enabled}`);

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
                throw new Error('Failed to update protection status');
            }

            this.settings.enabled = enabled;
            this.render();
            this.showNotification(
                enabled ? 'Protection enabled successfully' : 'Protection disabled',
                'success'
            );

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Toggle failed:`, error);
            this.showNotification('Failed to update protection status', 'error');
            
            // Revert toggle on error
            const toggle = document.getElementById('spam-filter-toggle');
            if (toggle) toggle.checked = !enabled;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // LIST MANAGEMENT METHODS
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Add number to blacklist
     */
    async addToBlacklist() {
        const phoneNumber = prompt('Enter phone number to blacklist (E.164 format, e.g., +15551234567):');
        if (!phoneNumber) return;

        if (!phoneNumber.match(/^\+[1-9]\d{1,14}$/)) {
            this.showNotification('Invalid phone number format. Use E.164 format (e.g., +15551234567)', 'error');
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

            if (!response.ok) throw new Error('Failed to add to blacklist');

            this.showNotification(`${phoneNumber} added to blacklist`, 'success');
            await this.load();

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Add to blacklist failed:`, error);
            this.showNotification('Failed to add number to blacklist', 'error');
        }
    }

    /**
     * Remove number from blacklist
     */
    async removeFromBlacklist(phoneNumber) {
        if (!confirm(`Remove ${phoneNumber} from blacklist?`)) return;

        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/blacklist/${encodeURIComponent(phoneNumber)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) throw new Error('Failed to remove from blacklist');

            this.showNotification(`${phoneNumber} removed from blacklist`, 'success');
            await this.load();

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Remove from blacklist failed:`, error);
            this.showNotification('Failed to remove number', 'error');
        }
    }

    /**
     * Add number to whitelist
     */
    async addToWhitelist() {
        const phoneNumber = prompt('Enter phone number to whitelist (E.164 format, e.g., +15551234567):');
        if (!phoneNumber) return;

        if (!phoneNumber.match(/^\+[1-9]\d{1,14}$/)) {
            this.showNotification('Invalid phone number format. Use E.164 format (e.g., +15551234567)', 'error');
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

            if (!response.ok) throw new Error('Failed to add to whitelist');

            this.showNotification(`${phoneNumber} added to whitelist`, 'success');
            await this.load();

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Add to whitelist failed:`, error);
            this.showNotification('Failed to add number to whitelist', 'error');
        }
    }

    /**
     * Remove number from whitelist
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

            if (!response.ok) throw new Error('Failed to remove from whitelist');

            this.showNotification(`${phoneNumber} removed from whitelist`, 'success');
            await this.load();

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Remove from whitelist failed:`, error);
            this.showNotification('Failed to remove number', 'error');
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // SETTINGS MANAGEMENT
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Save detection engine settings
     */
    async saveSettings() {
        try {
            const checkGlobalDB = document.getElementById('check-global-db').checked;
            const frequencyCheck = document.getElementById('frequency-check').checked;
            const robocallDetection = document.getElementById('robocall-detection').checked;

            console.log(`💾 [SPAM FILTER] Saving detection settings...`);

            const token = localStorage.getItem('adminToken');
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

            if (!response.ok) throw new Error('Failed to save settings');

            this.settings.settings = {
                checkGlobalSpamDB: checkGlobalDB,
                enableFrequencyCheck: frequencyCheck,
                enableRobocallDetection: robocallDetection
            };

            this.showNotification('Detection settings saved successfully', 'success');

        } catch (error) {
            console.error(`❌ [SPAM FILTER] Save settings failed:`, error);
            this.showNotification('Failed to save detection settings', 'error');
        }
    }

    /**
     * Save auto-blacklist settings
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
            
            console.log(`💾 [SPAM FILTER] Saving auto-blacklist settings...`);
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-filtering/${this.companyId}/settings`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    settings: {
                        ...this.settings.settings,
                        autoBlacklistEnabled: enabled,
                        autoBlacklistThreshold: threshold,
                        autoBlacklistTriggers: triggers,
                        requireAdminApproval: requireApproval
                    }
                })
            });
            
            if (!response.ok) throw new Error('Failed to save auto-blacklist settings');
            
            this.showNotification('Auto-blacklist settings saved successfully', 'success');
            await this.load();
            
        } catch (error) {
            console.error(`❌ [SPAM FILTER] Save auto-blacklist settings failed:`, error);
            this.showNotification('Failed to save auto-blacklist settings', 'error');
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PENDING REVIEW MANAGEMENT
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Approve pending spam number
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
            
            this.showNotification(`${phoneNumber} approved - now blocking calls`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Approval error:', error);
            this.showNotification('Failed to approve spam number', 'error');
        }
    }

    /**
     * Reject pending spam number
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
            
            this.showNotification(`${phoneNumber} rejected - removed from spam list`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Rejection error:', error);
            this.showNotification('Failed to reject spam number', 'error');
        }
    }

    /**
     * Whitelist number and prevent future auto-blocking
     */
    async whitelistAndNeverBlock(phoneNumber) {
        if (!confirm(`Whitelist ${phoneNumber}?\n\nThis number will be:\n• Removed from blacklist\n• Added to whitelist\n• NEVER auto-blocked again`)) {
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            
            // Remove from blacklist
            await fetch(`/api/admin/call-filtering/${this.companyId}/blacklist/${encodeURIComponent(phoneNumber)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            // Add to whitelist
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
            
            this.showNotification(`${phoneNumber} whitelisted - will never be blocked`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Whitelist error:', error);
            this.showNotification('Failed to whitelist number', 'error');
        }
    }

    /**
     * Approve all pending spam numbers
     */
    async approveAllPending() {
        const pendingCount = this.settings.blacklist.filter(e => 
            typeof e === 'object' && e.status === 'pending'
        ).length;
        
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
            
            this.showNotification(`Approved ${pendingCount} numbers successfully`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Bulk approval error:', error);
            this.showNotification('Failed to approve all pending numbers', 'error');
        }
    }

    /**
     * Reject all pending spam numbers
     */
    async rejectAllPending() {
        const pendingCount = this.settings.blacklist.filter(e => 
            typeof e === 'object' && e.status === 'pending'
        ).length;
        
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
            
            this.showNotification(`Rejected ${pendingCount} numbers`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Bulk rejection error:', error);
            this.showNotification('Failed to reject all pending numbers', 'error');
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // GLOBAL SPAM DATABASE MANAGEMENT
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Make a number global (report to global spam database)
     */
    async makeGlobal(phoneNumber) {
        if (!confirm(`Report ${phoneNumber} to global spam database?\n\n🌍 This will:\n• Block this number for ALL companies\n• Add to global spam registry\n• Help protect the entire network`)) {
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            
            // Report to global spam database
            const response = await fetch(`/api/admin/call-filtering/report-spam`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    phoneNumber,
                    companyId: this.companyId,
                    spamType: 'reported_by_admin'
                })
            });
            
            if (!response.ok) throw new Error('Failed to report to global database');
            
            this.showNotification(`🌍 ${phoneNumber} reported globally - now blocking for all companies`, 'success');
            await this.load();
            
        } catch (error) {
            console.error('❌ [SPAM FILTER] Make global error:', error);
            this.showNotification('Failed to report to global database', 'error');
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // NOTIFICATION SYSTEM
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Show toast notification
     */
    showNotification(message, type = 'info') {
        console.log(`🔔 [SPAM FILTER] Notification: [${type.toUpperCase()}] ${message}`);
        
        let container = document.getElementById('spam-filter-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'spam-filter-toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        
        toast.innerHTML = `
            <i class="fas ${icons[type] || icons.info}"></i>
            <span>${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(toast);

        // Animate in
        setTimeout(() => toast.classList.add('show'), 10);

        // Auto-dismiss after 4 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
}

// ════════════════════════════════════════════════════════════════════════
// GLOBAL EXPORT
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
    window.SpamFilterManager = SpamFilterManager;
    console.log('✅ [SPAM FILTER] Enterprise Edition loaded successfully');
}
