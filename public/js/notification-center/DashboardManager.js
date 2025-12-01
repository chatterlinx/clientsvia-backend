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
                // Store full service data for click-to-view details
                this.serviceHealthData = result.services || {};
                // Convert services object to array with keys
                const servicesArray = Object.entries(result.services || {}).map(([key, value]) => ({
                    ...value,
                    key: key
                }));
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
            'ElevenLabs': '🎙️',
            'OpenAI (GPT-4)': '🤖',
            'LLM-0 Orchestration': '🧠'
        };
        
        const statusEmoji = {
            'HEALTHY': '🟢',
            'DEGRADED': '🟡',
            'DOWN': '🔴',
            'CRITICAL': '🚨',
            'NOT_CONFIGURED': '⚪'
        };
        
        const statusColors = {
            'HEALTHY': 'text-green-600',
            'DEGRADED': 'text-yellow-600',
            'DOWN': 'text-red-600',
            'CRITICAL': 'text-red-700 font-bold',
            'NOT_CONFIGURED': 'text-gray-500'
        };
        
        const html = `
            <div class="bg-white rounded-lg shadow p-4 border-2 ${overallStatus === 'HEALTHY' ? 'border-green-500' : overallStatus === 'DEGRADED' ? 'border-yellow-500' : 'border-red-500'}">
                <h3 class="text-lg font-semibold mb-3 flex items-center justify-between">
                    <span>🔧 Service Health</span>
                    <span class="${statusColors[overallStatus]}">${statusEmoji[overallStatus]} ${overallStatus}</span>
                </h3>
                <div class="space-y-2">
                    ${services.map(service => `
                        <div class="flex items-center justify-between p-2 rounded cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all ${service.status === 'HEALTHY' ? 'bg-green-50 hover:bg-green-100' : service.status === 'DEGRADED' ? 'bg-yellow-50 hover:bg-yellow-100' : service.status === 'NOT_CONFIGURED' ? 'bg-gray-50 hover:bg-gray-100' : 'bg-red-50 hover:bg-red-100'}"
                             onclick="dashboardManager.showServiceDetails('${service.key}')"
                             title="Click to see details">
                            <div class="flex items-center">
                                <span class="text-xl mr-2">${serviceIcons[service.name] || '🔧'}</span>
                                <span class="font-medium">${service.name}</span>
                            </div>
                            <div class="text-right flex items-center">
                                <span class="text-sm ${service.status === 'HEALTHY' ? 'text-green-700' : service.status === 'DEGRADED' ? 'text-yellow-700' : service.status === 'NOT_CONFIGURED' ? 'text-gray-600' : 'text-red-700'} font-semibold">
                                    ${service.status === 'HEALTHY' ? '✓' : service.status === 'DEGRADED' ? '⚠' : service.status === 'NOT_CONFIGURED' ? '✗' : '✗'} ${service.status}
                                </span>
                                ${service.responseTime ? `<span class="text-xs text-gray-500 ml-2">${service.responseTime}ms</span>` : ''}
                                <span class="ml-2 text-gray-400 text-xs">▶</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="mt-3 text-xs text-gray-500 text-right">
                    Auto-refreshes every 30s • Click any service for details
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }
    
    /**
     * Show detailed information about a service when clicked
     */
    showServiceDetails(serviceKey) {
        const service = this.serviceHealthData?.[serviceKey];
        if (!service) {
            this.nc.showError('Service details not available');
            return;
        }
        
        // Build status-specific styling
        const isHealthy = service.status === 'HEALTHY';
        const isDown = service.status === 'DOWN' || service.status === 'CRITICAL';
        const isDegraded = service.status === 'DEGRADED';
        const isNotConfigured = service.status === 'NOT_CONFIGURED';
        
        const statusBgClass = isHealthy ? 'bg-green-50 border-green-500' :
                             isDegraded ? 'bg-yellow-50 border-yellow-500' :
                             isNotConfigured ? 'bg-gray-50 border-gray-400' :
                             'bg-red-50 border-red-500';
        
        const statusTextClass = isHealthy ? 'text-green-700' :
                               isDegraded ? 'text-yellow-700' :
                               isNotConfigured ? 'text-gray-600' :
                               'text-red-700';
        
        // Build details HTML
        let detailsHtml = `
            <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onclick="this.remove()">
                <div class="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto" onclick="event.stopPropagation()">
                    <div class="p-6">
                        <div class="flex items-center justify-between mb-4">
                            <h2 class="text-xl font-bold flex items-center">
                                <span class="mr-2">${this.getServiceIcon(service.name)}</span>
                                ${service.name}
                            </h2>
                            <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                        </div>
                        
                        <div class="${statusBgClass} border-l-4 p-4 rounded mb-4">
                            <div class="flex items-center justify-between">
                                <span class="${statusTextClass} font-bold text-lg">${service.status}</span>
                                ${service.responseTime ? `<span class="text-gray-500">${service.responseTime}ms</span>` : ''}
                            </div>
                            ${service.message ? `<p class="mt-2 ${statusTextClass}">${service.message}</p>` : ''}
                        </div>
        `;
        
        // Show error details if down
        if (isDown && service.error) {
            detailsHtml += `
                <div class="bg-red-100 border border-red-300 rounded p-3 mb-4">
                    <h4 class="font-semibold text-red-900 mb-1">❌ Error Details</h4>
                    <p class="text-red-800 font-mono text-sm">${this.escapeHtml(service.error)}</p>
                </div>
            `;
        }
        
        // Show impact if available
        if (service.impact) {
            detailsHtml += `
                <div class="${isDown ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'} border rounded p-3 mb-4">
                    <h4 class="font-semibold ${isDown ? 'text-red-900' : 'text-yellow-900'} mb-1">⚠️ Impact</h4>
                    <p class="${isDown ? 'text-red-800' : 'text-yellow-800'}">${service.impact}</p>
                </div>
            `;
        }
        
        // Show action if available
        if (service.action) {
            detailsHtml += `
                <div class="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
                    <h4 class="font-semibold text-blue-900 mb-1">🔧 Recommended Action</h4>
                    <p class="text-blue-800">${service.action}</p>
                </div>
            `;
        }
        
        // Show missing vars if available
        if (service.missingVars && service.missingVars.length > 0) {
            detailsHtml += `
                <div class="bg-orange-50 border border-orange-200 rounded p-3 mb-4">
                    <h4 class="font-semibold text-orange-900 mb-1">📋 Missing Environment Variables</h4>
                    <ul class="list-disc list-inside text-orange-800">
                        ${service.missingVars.map(v => `<li><code class="font-mono bg-orange-100 px-1 rounded">${v}</code></li>`).join('')}
                    </ul>
                </div>
            `;
        }
        
        // Show details if available
        if (service.details && Object.keys(service.details).length > 0) {
            detailsHtml += `
                <div class="bg-gray-50 border border-gray-200 rounded p-3 mb-4">
                    <h4 class="font-semibold text-gray-900 mb-2">📊 Service Details</h4>
                    <dl class="grid grid-cols-2 gap-2 text-sm">
                        ${Object.entries(service.details).map(([key, value]) => `
                            <dt class="text-gray-600">${this.formatDetailKey(key)}:</dt>
                            <dd class="text-gray-900 font-mono">${this.formatDetailValue(value)}</dd>
                        `).join('')}
                    </dl>
                </div>
            `;
        }
        
        // Show note if available
        if (service.note) {
            detailsHtml += `
                <div class="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
                    <h4 class="font-semibold text-blue-900 mb-1">ℹ️ Note</h4>
                    <p class="text-blue-800 text-sm">${service.note}</p>
                </div>
            `;
        }
        
        // Add helpful links based on service
        const helpLinks = this.getServiceHelpLinks(service.name);
        if (helpLinks) {
            detailsHtml += `
                <div class="border-t pt-4 mt-4">
                    <h4 class="font-semibold text-gray-700 mb-2">🔗 Helpful Links</h4>
                    <div class="flex flex-wrap gap-2">
                        ${helpLinks}
                    </div>
                </div>
            `;
        }
        
        detailsHtml += `
                    </div>
                </div>
            </div>
        `;
        
        // Insert modal into DOM
        document.body.insertAdjacentHTML('beforeend', detailsHtml);
    }
    
    getServiceIcon(serviceName) {
        const icons = {
            'MongoDB': '🍃',
            'Redis': '🔴',
            'Twilio': '📞',
            'ElevenLabs': '🎙️',
            'OpenAI (GPT-4)': '🤖',
            'LLM-0 Orchestration': '🧠'
        };
        return icons[serviceName] || '🔧';
    }
    
    getServiceHelpLinks(serviceName) {
        const links = {
            'MongoDB': `
                <a href="https://cloud.mongodb.com" target="_blank" class="px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200">MongoDB Atlas Dashboard</a>
                <a href="https://www.mongodb.com/docs/atlas/troubleshoot-connection/" target="_blank" class="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Troubleshoot Connection</a>
            `,
            'Redis': `
                <a href="https://dashboard.render.com" target="_blank" class="px-3 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200">Render Dashboard</a>
                <a href="https://redis.io/docs/troubleshooting/" target="_blank" class="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Redis Troubleshooting</a>
            `,
            'Twilio': `
                <a href="https://console.twilio.com" target="_blank" class="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">Twilio Console</a>
                <a href="https://www.twilio.com/docs/usage/troubleshooting" target="_blank" class="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Twilio Troubleshooting</a>
            `,
            'ElevenLabs': `
                <a href="https://elevenlabs.io/app" target="_blank" class="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">ElevenLabs Dashboard</a>
            `,
            'OpenAI (GPT-4)': `
                <a href="https://platform.openai.com" target="_blank" class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200">OpenAI Platform</a>
                <a href="https://platform.openai.com/api-keys" target="_blank" class="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">API Keys</a>
                <a href="https://status.openai.com" target="_blank" class="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">OpenAI Status</a>
            `
        };
        return links[serviceName] || null;
    }
    
    formatDetailKey(key) {
        // Convert camelCase to Title Case with spaces
        return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    }
    
    formatDetailValue(value) {
        if (value === null || value === undefined) return 'N/A';
        if (typeof value === 'object') return JSON.stringify(value);
        if (typeof value === 'boolean') return value ? '✓ Yes' : '✗ No';
        return String(value);
    }
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
                            ${trends.anomalies.anomalies.map(a => `
                                <li>• Hour ${a.hour}: ${a.errorCount} errors (${a.deviation}% above average)</li>
                            `).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
        `;
        
        container.innerHTML = html;
    }
}

