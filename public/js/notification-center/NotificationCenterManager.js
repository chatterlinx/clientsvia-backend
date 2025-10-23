// ============================================================================
// 🔔 NOTIFICATION CENTER MANAGER - Main Controller
// ============================================================================
// Purpose: Orchestrates all notification center functionality
//
// Responsibilities:
// - Sub-tab navigation
// - API communication
// - Sub-manager coordination
// - Auto-refresh
//
// Related Files:
// - DashboardManager.js
// - RegistryManager.js
// - LogManager.js
// - SettingsManager.js
// ============================================================================

class NotificationCenterManager {
    constructor() {
        this.currentTab = 'dashboard';
        this.token = localStorage.getItem('adminToken'); // FIXED: Use adminToken (same as index.html)
        this.refreshInterval = null;
        
        // Sub-managers
        this.dashboardManager = null;
        this.registryManager = null;
        this.logManager = null;
        this.settingsManager = null;
        
        this.init();
    }
    
    /**
     * Generate a UUID v4 for Idempotency-Key and request correlation
     */
    generateUUID() {
        // RFC4122 version 4 compliant (no external deps)
        const getRandomByte = () => {
            try {
                if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
                    const buf = new Uint8Array(1);
                    window.crypto.getRandomValues(buf);
                    return buf[0];
                }
            } catch (_) { /* fallback below */ }
            return Math.floor(Math.random() * 256);
        };
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = getRandomByte() & 15;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    /**
     * Create default headers with Authorization and JSON content type
     * Optionally inject Idempotency-Key for mutation requests
     */
    buildHeaders({ includeIdempotency = false } = {}) {
        const headers = {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        if (includeIdempotency) {
            headers['Idempotency-Key'] = this.generateUUID();
        }

        return headers;
    }

    async init() {
        console.log('🔔 [NC MANAGER] Initializing Notification Center...');
        
        try {
            // Setup sub-tab navigation
            this.setupSubTabNavigation();
            
            // Initialize sub-managers
            this.dashboardManager = new DashboardManager(this);
            this.registryManager = new RegistryManager(this);
            this.logManager = new LogManager(this);
            this.settingsManager = new SettingsManager(this);
            
            // Expose logManager globally for onclick handlers
            window.logManager = this.logManager;
            
            // Load initial tab
            await this.switchTab('dashboard');
            
            // Start auto-refresh (every 30 seconds)
            this.startAutoRefresh();
            
            console.log('✅ [NC MANAGER] Notification Center initialized successfully');
            
        } catch (error) {
            console.error('❌ [NC MANAGER] Initialization failed:', error);
            this.showError('Failed to initialize Notification Center');
        }
    }
    
    /**
     * Setup sub-tab navigation
     */
    setupSubTabNavigation() {
        const subtabButtons = document.querySelectorAll('.subtab-btn');
        
        subtabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const subtab = btn.dataset.subtab;
                this.switchTab(subtab);
            });
        });
    }
    
    /**
     * Switch active tab
     */
    async switchTab(tabName) {
        console.log(`🔔 [NC MANAGER] Switching to tab: ${tabName}`);
        
        this.currentTab = tabName;
        
        // Update button states
        document.querySelectorAll('.subtab-btn').forEach(btn => {
            if (btn.dataset.subtab === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // Hide all tab contents
        document.querySelectorAll('.subtab-content').forEach(content => {
            content.classList.add('hidden');
        });
        
        // Show selected tab
        const selectedTab = document.getElementById(`${tabName}-tab`);
        if (selectedTab) {
            selectedTab.classList.remove('hidden');
        }
        
        // Load tab data
        try {
            switch (tabName) {
                case 'dashboard':
                    await this.dashboardManager.load();
                    break;
                case 'registry':
                    await this.registryManager.load();
                    break;
                case 'logs':
                    await this.logManager.load();
                    break;
                case 'settings':
                    await this.settingsManager.load();
                    break;
            }
        } catch (error) {
            console.error(`❌ [NC MANAGER] Failed to load tab ${tabName}:`, error);
            this.showError(`Failed to load ${tabName}`);
        }
    }
    
    /**
     * Start auto-refresh
     */
    startAutoRefresh() {
        // Refresh every 30 seconds
        this.refreshInterval = setInterval(() => {
            if (this.currentTab === 'dashboard') {
                console.log('🔄 [NC MANAGER] Auto-refreshing dashboard...');
                this.dashboardManager.load();
            }
        }, 30000);
        
        console.log('✅ [NC MANAGER] Auto-refresh started (30s interval)');
    }
    
    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            console.log('⏸️ [NC MANAGER] Auto-refresh stopped');
        }
    }
    
    /**
     * API Helper - GET request
     */
    async apiGet(endpoint) {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: this.buildHeaders()
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return response.json();
    }
    
    /**
     * API Helper - POST request
     */
    async apiPost(endpoint, data) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders({ includeIdempotency: true }),
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return response.json();
    }
    
    /**
     * API Helper - PUT request
     */
    async apiPut(endpoint, data) {
        const response = await fetch(endpoint, {
            method: 'PUT',
            headers: this.buildHeaders({ includeIdempotency: true }),
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return response.json();
    }

    /**
     * API Helper - DELETE request
     */
    async apiDelete(endpoint) {
        const response = await fetch(endpoint, {
            method: 'DELETE',
            headers: this.buildHeaders({ includeIdempotency: true })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return response.json();
    }
    
    /**
     * Show loading overlay
     */
    showLoading(message = 'Processing...') {
        const overlay = document.getElementById('loading-overlay');
        const messageEl = document.getElementById('loading-message');
        
        if (overlay && messageEl) {
            messageEl.textContent = message;
            overlay.classList.remove('hidden');
        }
    }
    
    /**
     * Hide loading overlay
     */
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }
    
    /**
     * Show error message
     */
    showError(message) {
        this.showToast(message, 'error');
    }
    
    /**
     * Show success message
     */
    showSuccess(message) {
        this.showToast(message, 'success');
    }
    
    /**
     * Show info message
     */
    showInfo(message) {
        this.showToast(message, 'info');
    }
    
    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        // Create toast container if it doesn't exist
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999;';
            document.body.appendChild(toastContainer);
        }
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'toast';
        
        // Style based on type
        let bgColor = '#3B82F6'; // blue (info)
        let icon = 'ℹ️';
        
        if (type === 'success') {
            bgColor = '#10B981'; // green
            icon = '✅';
        } else if (type === 'error') {
            bgColor = '#EF4444'; // red
            icon = '❌';
        } else if (type === 'warning') {
            bgColor = '#F59E0B'; // orange
            icon = '⚠️';
        }
        
        toast.style.cssText = `
            background: ${bgColor};
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            margin-bottom: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideIn 0.3s ease-out;
            min-width: 300px;
            max-width: 500px;
        `;
        
        toast.innerHTML = `
            <span style="font-size: 20px;">${icon}</span>
            <span style="flex: 1; font-weight: 500;">${message}</span>
            <button onclick="this.parentElement.remove()" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer; padding: 0; line-height: 1;">×</button>
        `;
        
        // Add to container
        toastContainer.appendChild(toast);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
    
    /**
     * Format date/time
     */
    formatDateTime(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString();
    }
    
    /**
     * Format relative time (e.g., "2 minutes ago")
     */
    formatRelativeTime(dateString) {
        if (!dateString) return 'N/A';
        
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
}

