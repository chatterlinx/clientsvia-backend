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
            // Load main dashboard data
            const data = await this.nc.apiGet('/api/admin/notifications/dashboard');
            
            if (data.success) {
                this.renderDashboard(data.data);
            }
            
            // Load intelligence widgets in parallel
            // ✅ RE-ENABLED: Fixed redisClient export bug
            this.loadServiceHealth();
            this.loadRootCauseAnalysis();
            this.loadErrorTrends();
            
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
    
    // ========================================================================
    // 🧠 INTELLIGENCE WIDGETS
    // ========================================================================
    
    async loadServiceHealth() {
        try {
            const result = await this.nc.apiGet('/api/admin/notifications/dependency-health');
            if (result.success) {
                // Convert services object to array
                const servicesArray = Object.values(result.services || {});
                this.renderServiceHealth(servicesArray, result.overallStatus);
            }
        } catch (error) {
            console.error('❌ [DASHBOARD] Service health load failed:', error);
        }
    }
    
    renderServiceHealth(services, overallStatus) {
        const container = document.getElementById('service-health-widget');
        if (!container) return;
        
        // Map service names to icons
        const serviceIcons = {
            'MongoDB': '🍃',
            'Redis': '🔴',
            'Twilio': '📞',
            'ElevenLabs': '🎙️'
        };
        
        const statusEmoji = {
            'HEALTHY': '🟢',
            'DEGRADED': '🟡',
            'DOWN': '🔴',
            'CRITICAL': '🚨'
        };
        
        const statusColors = {
            'HEALTHY': 'text-green-600',
            'DEGRADED': 'text-yellow-600',
            'DOWN': 'text-red-600',
            'CRITICAL': 'text-red-700 font-bold'
        };
        
        const html = `
            <div class="bg-white rounded-lg shadow p-4 border-2 ${overallStatus === 'HEALTHY' ? 'border-green-500' : overallStatus === 'DEGRADED' ? 'border-yellow-500' : 'border-red-500'}">
                <h3 class="text-lg font-semibold mb-3 flex items-center justify-between">
                    <span>🔧 Service Health</span>
                    <span class="${statusColors[overallStatus]}">${statusEmoji[overallStatus]} ${overallStatus}</span>
                </h3>
                <div class="space-y-2">
                    ${services.map(service => `
                        <div class="flex items-center justify-between p-2 rounded ${service.status === 'HEALTHY' ? 'bg-green-50' : service.status === 'DEGRADED' ? 'bg-yellow-50' : 'bg-red-50'}">
                            <div class="flex items-center">
                                <span class="text-xl mr-2">${serviceIcons[service.name] || '🔧'}</span>
                                <span class="font-medium">${service.name}</span>
                            </div>
                            <div class="text-right">
                                <span class="text-sm ${service.status === 'HEALTHY' ? 'text-green-700' : service.status === 'DEGRADED' ? 'text-yellow-700' : 'text-red-700'} font-semibold">
                                    ${service.status === 'HEALTHY' ? '✓' : service.status === 'DEGRADED' ? '⚠' : '✗'} ${service.status}
                                </span>
                                ${service.responseTime ? `<span class="text-xs text-gray-500 ml-2">${service.responseTime}ms</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="mt-3 text-xs text-gray-500 text-right">
                    Auto-refreshes every 30s
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }
    
    async loadRootCauseAnalysis() {
        try {
            const result = await this.nc.apiGet('/api/admin/notifications/root-cause-analysis?timeWindow=15');
            if (result.success) {
                this.renderRootCauseAnalysis(result);
            }
        } catch (error) {
            console.error('❌ [DASHBOARD] Root cause analysis load failed:', error);
        }
    }
    
    renderRootCauseAnalysis(analysis) {
        const container = document.getElementById('root-cause-widget');
        if (!container) return;
        
        if (!analysis.detectedPattern) {
            container.innerHTML = `
                <div class="bg-white rounded-lg shadow p-4">
                    <h3 class="text-lg font-semibold mb-3">🧠 Root Cause Analysis</h3>
                    <div class="text-center py-6 text-gray-500">
                        <i class="fas fa-check-circle text-green-500 text-3xl mb-2"></i>
                        <p>No cascade patterns detected</p>
                        <p class="text-xs mt-1">All errors appear isolated</p>
                    </div>
                </div>
            `;
            return;
        }
        
        const pattern = analysis.detectedPattern;
        const html = `
            <div class="bg-white rounded-lg shadow p-4 border-l-4 ${pattern.confidence >= 0.9 ? 'border-red-500' : 'border-yellow-500'}">
                <h3 class="text-lg font-semibold mb-3">🧠 Root Cause Analysis</h3>
                <div class="bg-yellow-50 border border-yellow-200 rounded p-3 mb-3">
                    <div class="flex items-center justify-between mb-2">
                        <span class="font-semibold text-yellow-900">⚠️ PATTERN DETECTED: ${pattern.name}</span>
                        <span class="text-sm text-yellow-700">Confidence: ${(pattern.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <p class="text-sm text-yellow-800 mb-2">
                        <strong>Root Cause:</strong> <span class="font-mono">${pattern.rootCause}</span>
                    </p>
                    <p class="text-sm text-yellow-800 mb-2">
                        <strong>Fix Priority:</strong> ${pattern.fixPriority}
                    </p>
                </div>
                <div class="bg-blue-50 border border-blue-200 rounded p-3">
                    <p class="text-sm font-semibold text-blue-900 mb-1">💡 Recommended Actions:</p>
                    <ol class="text-sm text-blue-800 space-y-1 ml-4 list-decimal">
                        ${pattern.recommendation.map(step => `<li>${step}</li>`).join('')}
                    </ol>
                </div>
                <div class="mt-3 text-xs text-gray-500">
                    Analyzing last ${analysis.timeWindow} minutes of errors
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }
    
    async loadErrorTrends() {
        try {
            const result = await this.nc.apiGet('/api/admin/notifications/error-trends?periodHours=24');
            if (result.success) {
                // Pass the trends object from the response
                this.renderErrorTrends(result.trends || result);
            }
        } catch (error) {
            console.error('❌ [DASHBOARD] Error trends load failed:', error);
        }
    }
    
    renderErrorTrends(trends) {
        const container = document.getElementById('error-trends-widget');
        if (!container) return;
        
        // Handle empty or insufficient data
        if (!trends || trends.totalErrors === 0 || !trends.hourlyBreakdown) {
            container.innerHTML = `
                <div class="bg-white rounded-lg shadow p-4">
                    <h3 class="text-lg font-semibold mb-3">📈 Error Trends (24h)</h3>
                    <div class="text-center text-gray-500 py-8">
                        ✨ No errors detected in the last 24 hours!
                    </div>
                </div>
            `;
            return;
        }
        
        const trendIcon = trends.trend === 'INCREASING' ? '↗️' : trends.trend === 'DECREASING' ? '↘️' : '→';
        const trendColor = trends.trend === 'INCREASING' ? 'text-red-600' : trends.trend === 'DECREASING' ? 'text-green-600' : 'text-gray-600';
        
        // Generate sparkline
        const hourlyData = Object.entries(trends.hourlyBreakdown).map(([hour, data]) => ({
            hour,
            count: data.count || 0
        }));
        const maxCount = Math.max(...hourlyData.map(h => h.count), 1);
        const sparkline = hourlyData.map(h => {
            const height = (h.count / maxCount) * 40;
            return `<div class="w-1 bg-blue-500 rounded-t" style="height: ${height}px;" title="${h.hour}: ${h.count} errors"></div>`;
        }).join('');
        
        const html = `
            <div class="bg-white rounded-lg shadow p-4">
                <h3 class="text-lg font-semibold mb-3">📈 Error Trends (24h)</h3>
                
                <!-- Summary Stats -->
                <div class="grid grid-cols-3 gap-4 mb-4">
                    <div class="text-center">
                        <div class="text-2xl font-bold text-red-600">${trends.totalErrors}</div>
                        <div class="text-xs text-gray-500">Total Errors</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold ${trendColor}">${trendIcon} ${trends.trend}</div>
                        <div class="text-xs text-gray-500">Trend</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold text-yellow-600">${trends.newErrors?.count || 0}</div>
                        <div class="text-xs text-gray-500">New Errors</div>
                    </div>
                </div>
                
                <!-- Sparkline Chart -->
                <div class="mb-4">
                    <div class="flex items-end justify-between h-10 gap-1">
                        ${sparkline}
                    </div>
                    <div class="text-xs text-gray-500 text-center mt-1">Last 24 hours (hourly)</div>
                </div>
                
                <!-- Top Errors -->
                <div class="mt-4">
                    <p class="text-sm font-semibold text-gray-700 mb-2">🔥 Top Errors:</p>
                    <div class="space-y-1">
                        ${trends.topErrors.slice(0, 5).map(err => `
                            <div class="flex justify-between items-center text-sm">
                                <span class="font-mono text-xs truncate flex-1">${err.code || err._id || 'UNKNOWN'}</span>
                                <span class="ml-2 px-2 py-1 bg-gray-100 rounded font-semibold">${err.count}×</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                ${trends.anomalies?.hasAnomalies && trends.anomalies?.anomalies?.length > 0 ? `
                    <div class="mt-4 bg-red-50 border border-red-200 rounded p-2">
                        <p class="text-sm font-semibold text-red-900">🚨 Anomalies Detected:</p>
                        <ul class="text-xs text-red-800 mt-1 space-y-1">
                            ${trends.anomalies.map(a => `<li>• ${a}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
        `;
        
        container.innerHTML = html;
    }
}

