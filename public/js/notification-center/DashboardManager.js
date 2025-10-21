// ============================================================================
// 📊 DASHBOARD MANAGER
// ============================================================================

class DashboardManager {
    constructor(notificationCenter) {
        this.nc = notificationCenter;
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Health check button
        const healthCheckBtn = document.getElementById('run-health-check-btn');
        if (healthCheckBtn) {
            healthCheckBtn.addEventListener('click', () => this.runHealthCheck());
        }
    }
    
    async load() {
        console.log('📊 [DASHBOARD] Loading dashboard...');
        
        try {
            const data = await this.nc.apiGet('/api/admin/notifications/dashboard');
            
            if (data.success) {
                this.renderDashboard(data.data);
            }
            
        } catch (error) {
            console.error('❌ [DASHBOARD] Load failed:', error);
        }
    }
    
    renderDashboard(data) {
        // Update alert counts
        document.getElementById('critical-count').textContent = data.unacknowledgedAlerts.CRITICAL || 0;
        document.getElementById('warning-count').textContent = data.unacknowledgedAlerts.WARNING || 0;
        document.getElementById('info-count').textContent = data.unacknowledgedAlerts.INFO || 0;
        
        // Update system status
        document.getElementById('registry-total').textContent = data.notificationPointsValidation.total || 0;
        document.getElementById('registry-valid').textContent = `${data.notificationPointsValidation.valid || 0} (${data.notificationPointsValidation.percentage || 0}%)`;
        document.getElementById('last-health-check').textContent = this.nc.formatRelativeTime(data.latestHealthCheck?.timestamp);
        
        // Render recent alerts
        this.renderRecentAlerts(data.recentAlerts || []);
    }
    
    renderRecentAlerts(alerts) {
        const container = document.getElementById('recent-alerts-container');
        
        if (alerts.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-check-circle text-green-500 text-4xl mb-2"></i>
                    <p class="text-lg">No unacknowledged alerts!</p>
                    <p class="text-sm">All systems operational</p>
                </div>
            `;
            return;
        }
        
        const html = `
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Alert ID</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    ${alerts.map(alert => this.renderAlertRow(alert)).join('')}
                </tbody>
            </table>
        `;
        
        container.innerHTML = html;
    }
    
    renderAlertRow(alert) {
        const severityColors = {
            'CRITICAL': 'bg-red-100 text-red-800',
            'WARNING': 'bg-yellow-100 text-yellow-800',
            'INFO': 'bg-blue-100 text-blue-800'
        };
        
        return `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-mono">${alert.alertId}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 py-1 rounded-full text-xs font-semibold ${severityColors[alert.severity]}">
                        ${alert.severity}
                    </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-900">${alert.message}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${alert.companyName}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${this.nc.formatRelativeTime(alert.createdAt)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                    <button onclick="notificationCenter.dashboardManager.acknowledgeAlert('${alert.alertId}')" class="text-green-600 hover:text-green-800 mr-2">
                        <i class="fas fa-check mr-1"></i>Acknowledge
                    </button>
                </td>
            </tr>
        `;
    }
    
    async acknowledgeAlert(alertId) {
        if (!confirm(`Acknowledge alert ${alertId}?`)) return;
        
        try {
            this.nc.showLoading('Acknowledging alert...');
            
            await this.nc.apiPost('/api/admin/notifications/acknowledge', {
                alertId: alertId,
                acknowledgedBy: 'Admin (Web UI)'
            });
            
            this.nc.hideLoading();
            this.nc.showSuccess('Alert acknowledged!');
            this.load(); // Reload dashboard
            
        } catch (error) {
            this.nc.hideLoading();
            this.nc.showError('Failed to acknowledge alert');
            console.error('❌ [DASHBOARD] Acknowledge failed:', error);
        }
    }
    
    async runHealthCheck() {
        if (!confirm('Run platform health check? This will test 10+ critical systems.')) return;
        
        try {
            this.nc.showLoading('Running health check... (this may take a few seconds)');
            
            const result = await this.nc.apiPost('/api/admin/notifications/health-check', {
                triggeredBy: 'manual'
            });
            
            this.nc.hideLoading();
            
            if (result.success) {
                const data = result.data;
                const status = data.overallStatus;
                const emoji = status === 'HEALTHY' ? '✅' : status === 'WARNING' ? '⚠️' : '🚨';
                
                alert(`${emoji} Health Check Complete!\n\nStatus: ${status}\nPassed: ${data.summary.passed}/${data.summary.total}\nFailed: ${data.summary.failed}\nWarnings: ${data.summary.warnings}\nDuration: ${data.totalDuration}ms`);
                
                this.load(); // Reload dashboard
            }
            
        } catch (error) {
            this.nc.hideLoading();
            this.nc.showError('Health check failed');
            console.error('❌ [DASHBOARD] Health check failed:', error);
        }
    }
}

