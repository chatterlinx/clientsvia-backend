// ============================================================================
// 🔔 GLOBAL NOTIFICATION TAB STATUS MONITOR
// ============================================================================
// Purpose: Auto-updates Notification Center tab color on ALL admin pages
//
// Features:
// - Runs on every admin page (index.html, company-profile.html, etc.)
// - Updates tab color every 30 seconds
// - Shows badge with unacknowledged alert count
// - No dependencies - vanilla JavaScript
//
// Tab States:
// - GREEN (healthy) = No critical/warning alerts
// - YELLOW (warning) = Warning alerts present
// - RED (critical) = Critical alerts present (PULSING!)
// - GRAY (offline) = System offline / health check failed
//
// Usage: Include in every admin page:
// <script src="/js/global-notification-tab-monitor.js"></script>
// ============================================================================

(function() {
    'use strict';
    
    console.log('🔔 [GLOBAL TAB MONITOR] Initializing notification tab monitor...');
    
    class GlobalNotificationTabMonitor {
        constructor() {
            this.updateInterval = 30000; // 30 seconds
            this.tabElement = null;
            this.intervalId = null;
            
            this.init();
        }
        
        async init() {
            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.start());
            } else {
                this.start();
            }
        }
        
        start() {
            // Find the notification center tab link
            this.tabElement = document.querySelector('a[href="/admin-notification-center.html"]') ||
                             document.querySelector('a[href="admin-notification-center.html"]');
            
            if (!this.tabElement) {
                console.warn('⚠️ [GLOBAL TAB MONITOR] Notification Center tab not found in navigation');
                return;
            }
            
            console.log('✅ [GLOBAL TAB MONITOR] Tab found, starting monitor...');
            
            // Initial update
            this.updateTabStatus();
            
            // Auto-refresh every 30 seconds
            this.intervalId = setInterval(() => {
                this.updateTabStatus();
            }, this.updateInterval);
            
            console.log(`✅ [GLOBAL TAB MONITOR] Monitor started (${this.updateInterval/1000}s interval)`);
        }
        
        async updateTabStatus() {
            try {
                const token = localStorage.getItem('adminToken'); // FIXED: Use adminToken (same as index.html)
                if (!token) {
                    console.warn('⚠️ [GLOBAL TAB MONITOR] No auth token, skipping update');
                    return;
                }
                
                // Fetch current platform status
                const response = await fetch('/api/admin/notifications/status', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    this.setTabStatus('offline', 0);
                    return;
                }
                
                const data = await response.json();
                
                if (data.success) {
                    this.setTabStatus(data.overallStatus, data.unacknowledgedCount);
                    console.log(`🔔 [GLOBAL TAB MONITOR] Status: ${data.overallStatus} | Alerts: ${data.unacknowledgedCount}`);
                } else {
                    this.setTabStatus('offline', 0);
                }
                
            } catch (error) {
                console.error('❌ [GLOBAL TAB MONITOR] Update failed:', error);
                this.setTabStatus('offline', 0);
            }
        }
        
        setTabStatus(status, alertCount) {
            if (!this.tabElement) return;
            
            // Remove all status classes
            this.tabElement.classList.remove(
                'status-healthy',
                'status-warning',
                'status-critical',
                'status-offline'
            );
            
            // Add new status class
            this.tabElement.classList.add(`status-${status.toLowerCase()}`);
            
            // Update alert count badge
            if (alertCount > 0) {
                this.tabElement.setAttribute('data-alert-count', alertCount);
            } else {
                this.tabElement.removeAttribute('data-alert-count');
            }
            
            // Update tooltip
            const statusMessages = {
                'healthy': '✅ All systems operational',
                'warning': `⚠️ ${alertCount} warning(s) - click to view`,
                'critical': `🚨 ${alertCount} CRITICAL alert(s) - IMMEDIATE ACTION REQUIRED`,
                'offline': '⚫ System offline - check logs'
            };
            
            this.tabElement.setAttribute('title', statusMessages[status.toLowerCase()] || 'Notification Center');
        }
        
        stop() {
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
                console.log('⏸️ [GLOBAL TAB MONITOR] Monitor stopped');
            }
        }
    }
    
    // Auto-initialize on script load
    window.globalNotificationTabMonitor = new GlobalNotificationTabMonitor();
    
})();

