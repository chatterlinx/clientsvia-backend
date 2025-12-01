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
        
        // Map service names to icons (status-independent)
        const serviceIcons = {
            'MongoDB': '🍃',
            'Redis': '⚡',  // Lightning bolt - neutral icon, status shown separately
            'Twilio': '📞',
            'ElevenLabs': '🎙️',
            'OpenAI (GPT-4)': '🤖',
            'LLM-0 Orchestration': '🧠'
        };
        
        // Status indicator emojis (colored circles)
        const statusEmoji = {
            'HEALTHY': '🟢',
            'DEGRADED': '🟡',
            'DOWN': '🔴',
            'CRITICAL': '🚨',
            'NOT_CONFIGURED': '⚪'
        };
        
        // Function to get dynamic icon with status color
        const getServiceIcon = (serviceName, status) => {
            const baseIcon = serviceIcons[serviceName] || '🔧';
            const statusDot = statusEmoji[status] || '⚪';
            return `${statusDot}`;  // Show status dot as the main indicator
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
                                <span class="text-xl mr-2">${getServiceIcon(service.name, service.status)}</span>
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
        
        // Store for copy function
        this.currentServiceDebug = { key: serviceKey, service };
        
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
        
        // Get troubleshooting info for this service
        const troubleshoot = this.getServiceTroubleshooting(service.name, service);
        
        // Build details HTML
        let detailsHtml = `
            <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" id="service-detail-modal" onclick="this.remove()">
                <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto" onclick="event.stopPropagation()">
                    <div class="p-6">
                        <!-- Header with Copy Button -->
                        <div class="flex items-center justify-between mb-4">
                            <h2 class="text-xl font-bold flex items-center">
                                <span class="mr-2">${this.getServiceIcon(service.name)}</span>
                                ${service.name}
                            </h2>
                            <div class="flex items-center gap-2">
                                <button onclick="dashboardManager.copyServiceDebugInfo()" 
                                        class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm flex items-center gap-1">
                                    📋 Copy Debug Info
                                </button>
                                <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                            </div>
                        </div>
                        
                        <!-- Status Banner -->
                        <div class="${statusBgClass} border-l-4 p-4 rounded mb-4">
                            <div class="flex items-center justify-between">
                                <span class="${statusTextClass} font-bold text-lg">${service.status}</span>
                                ${service.responseTime ? `<span class="text-gray-500">${service.responseTime}ms</span>` : ''}
                            </div>
                            ${service.message ? `<p class="mt-2 ${statusTextClass}">${service.message}</p>` : ''}
                        </div>
        `;
        
        // CHECKPOINTS SECTION - Show what was checked
        detailsHtml += `
            <div class="bg-gray-50 border border-gray-200 rounded p-3 mb-4">
                <h4 class="font-semibold text-gray-900 mb-2">🔍 Health Check Checkpoints</h4>
                <div class="space-y-1 text-sm">
                    ${troubleshoot.checkpoints.map(cp => `
                        <div class="flex items-center gap-2">
                            <span class="${cp.passed ? 'text-green-600' : 'text-red-600'}">${cp.passed ? '✓' : '✗'}</span>
                            <span class="${cp.passed ? 'text-gray-600' : 'text-red-700 font-medium'}">${cp.name}</span>
                            ${cp.value ? `<span class="text-gray-400 font-mono text-xs ml-auto">${cp.value}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        // ERROR ORIGIN - Where the error came from
        detailsHtml += `
            <div class="bg-slate-50 border border-slate-200 rounded p-3 mb-4">
                <h4 class="font-semibold text-slate-900 mb-2">📍 Error Origin</h4>
                <dl class="text-sm space-y-1">
                    <div class="flex justify-between">
                        <dt class="text-slate-600">Source File:</dt>
                        <dd class="font-mono text-slate-900">${troubleshoot.sourceFile}</dd>
                    </div>
                    <div class="flex justify-between">
                        <dt class="text-slate-600">Check Function:</dt>
                        <dd class="font-mono text-slate-900">${troubleshoot.checkFunction}</dd>
                    </div>
                    <div class="flex justify-between">
                        <dt class="text-slate-600">Environment Variable:</dt>
                        <dd class="font-mono text-slate-900">${troubleshoot.envVar || 'N/A'}</dd>
                    </div>
                </dl>
            </div>
        `;
        
        // Show error details if down
        if ((isDown || isNotConfigured) && service.error) {
            detailsHtml += `
                <div class="bg-red-100 border border-red-300 rounded p-3 mb-4">
                    <h4 class="font-semibold text-red-900 mb-1">❌ Error Details</h4>
                    <p class="text-red-800 font-mono text-sm break-all">${this.escapeHtml(service.error)}</p>
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
        
        // FIX INSTRUCTIONS - Step by step
        detailsHtml += `
            <div class="bg-emerald-50 border border-emerald-200 rounded p-3 mb-4">
                <h4 class="font-semibold text-emerald-900 mb-2">🔧 How to Fix</h4>
                <ol class="list-decimal list-inside text-emerald-800 space-y-2 text-sm">
                    ${troubleshoot.fixSteps.map(step => `<li>${step}</li>`).join('')}
                </ol>
            </div>
        `;
        
        // Show missing vars if available
        if (service.missingVars && service.missingVars.length > 0) {
            detailsHtml += `
                <div class="bg-orange-50 border border-orange-200 rounded p-3 mb-4">
                    <h4 class="font-semibold text-orange-900 mb-1">📋 Missing Environment Variables</h4>
                    <ul class="list-disc list-inside text-orange-800">
                        ${service.missingVars.map(v => `<li><code class="font-mono bg-orange-100 px-1 rounded">${v}</code></li>`).join('')}
                    </ul>
                    <p class="text-xs text-orange-600 mt-2">Set these in Render Dashboard → Environment Variables</p>
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
                            <dd class="text-gray-900 font-mono text-xs break-all">${this.formatDetailValue(value)}</dd>
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
        
        // Show action if available
        if (service.action) {
            detailsHtml += `
                <div class="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
                    <h4 class="font-semibold text-blue-900 mb-1">💡 Recommended Action</h4>
                    <p class="text-blue-800">${service.action}</p>
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
        
        // Copy Debug Info reminder
        detailsHtml += `
            <div class="border-t pt-4 mt-4 bg-blue-50 -mx-6 -mb-6 px-6 py-4 rounded-b-lg">
                <p class="text-sm text-blue-800">
                    <strong>💡 Need help?</strong> Click "Copy Debug Info" above and paste to your AI assistant for instant troubleshooting!
                </p>
            </div>
        `;
        
        detailsHtml += `
                    </div>
                </div>
            </div>
        `;
        
        // Insert modal into DOM
        document.body.insertAdjacentHTML('beforeend', detailsHtml);
    }
    
    /**
     * Copy comprehensive debug info for the current service
     */
    async copyServiceDebugInfo() {
        if (!this.currentServiceDebug) {
            this.nc.showError('No service data to copy');
            return;
        }
        
        const { key, service } = this.currentServiceDebug;
        const troubleshoot = this.getServiceTroubleshooting(service.name, service);
        
        // Build environment check section if available (comes from enhanced checkRedis)
        let envCheckSection = '';
        if (service.envCheck) {
            envCheckSection = `
═══════════════════════════════════════════════════════
🔐 ENVIRONMENT VARIABLE CHECK (LIVE)
═══════════════════════════════════════════════════════
${Object.entries(service.envCheck).map(([k, v]) => `${k}: ${v}`).join('\n')}
`;
        }
        
        // Build root cause section if available
        let rootCauseSection = '';
        if (service.rootCause || service.fixAction) {
            rootCauseSection = `
═══════════════════════════════════════════════════════
🎯 ROOT CAUSE ANALYSIS
═══════════════════════════════════════════════════════
${service.rootCause ? `Root Cause: ${service.rootCause}` : ''}
${service.fixAction ? `Fix Action: ${service.fixAction}` : ''}
`;
        }
        
        const debugReport = `
═══════════════════════════════════════════════════════
🔧 SERVICE HEALTH DEBUG REPORT
═══════════════════════════════════════════════════════

SERVICE: ${service.name}
STATUS: ${service.status}
RESPONSE TIME: ${service.responseTime || 'N/A'}ms
CRITICAL: ${service.critical ? 'YES' : 'NO'}
TIMESTAMP: ${new Date().toISOString()}

═══════════════════════════════════════════════════════
📍 ERROR ORIGIN
═══════════════════════════════════════════════════════
Source File: ${troubleshoot.sourceFile}
Check Function: ${troubleshoot.checkFunction}
Environment Variable: ${troubleshoot.envVar || 'N/A'}

═══════════════════════════════════════════════════════
❌ ERROR MESSAGE
═══════════════════════════════════════════════════════
${service.message || 'No message'}

${service.error ? `
ERROR DETAILS:
${service.error}
${service.errorCode ? `Error Code: ${service.errorCode}` : ''}
` : ''}

═══════════════════════════════════════════════════════
🔍 HEALTH CHECK CHECKPOINTS
═══════════════════════════════════════════════════════
${troubleshoot.checkpoints.map(cp => `${cp.passed ? '✓' : '✗'} ${cp.name}${cp.value ? ` (${cp.value})` : ''}`).join('\n')}
${rootCauseSection}${envCheckSection}
═══════════════════════════════════════════════════════
⚠️ IMPACT
═══════════════════════════════════════════════════════
${service.impact || 'No impact information available'}

═══════════════════════════════════════════════════════
📋 MISSING ENVIRONMENT VARIABLES
═══════════════════════════════════════════════════════
${service.missingVars?.length > 0 ? service.missingVars.join('\n') : 'None'}

═══════════════════════════════════════════════════════
📊 SERVICE DETAILS
═══════════════════════════════════════════════════════
${service.details ? Object.entries(service.details).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') : 'No details available'}

═══════════════════════════════════════════════════════
🔧 RECOMMENDED FIX STEPS
═══════════════════════════════════════════════════════
${troubleshoot.fixSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

═══════════════════════════════════════════════════════
💡 NOTES
═══════════════════════════════════════════════════════
${service.note || 'None'}
${service.action ? `\nAction: ${service.action}` : ''}

═══════════════════════════════════════════════════════
Generated: ${new Date().toISOString()}
Platform: ClientsVia Multi-Tenant Backend
Dashboard: /admin-notification-center.html#dashboard
═══════════════════════════════════════════════════════

Paste this report to your AI assistant for instant troubleshooting!
        `.trim();
        
        try {
            await navigator.clipboard.writeText(debugReport);
            this.nc.showSuccess('✅ Debug info copied! Paste to AI assistant for help.');
        } catch (error) {
            console.error('Copy failed:', error);
            this.nc.showError('Failed to copy debug info');
        }
    }
    
    /**
     * Get service-specific troubleshooting information
     * Uses LIVE checkpoints from backend if available, otherwise falls back to defaults
     */
    getServiceTroubleshooting(serviceName, service) {
        // ====================================================================
        // PRIORITY: Use LIVE checkpoints from backend if available
        // This gives us real diagnostic data from the actual health check!
        // ====================================================================
        const liveCheckpoints = service.checkpoints ? 
            service.checkpoints.map(cp => ({
                name: cp.name,
                passed: cp.status === 'passed' || cp.status === 'info',
                value: cp.message
            })) : null;
        
        // Use service-provided troubleshooting steps if available
        const liveTroubleshooting = service.troubleshooting;
        
        const troubleshootingData = {
            'MongoDB': {
                sourceFile: 'services/DependencyHealthMonitor.js',
                checkFunction: 'checkMongoDB()',
                envVar: 'MONGODB_URI',
                checkpoints: liveCheckpoints || [
                    { name: 'Mongoose connection state', passed: service.status === 'HEALTHY', value: service.details?.state || service.message },
                    { name: 'Database ping test', passed: service.status === 'HEALTHY', value: service.responseTime ? `${service.responseTime}ms` : 'Failed' },
                    { name: 'Response time < 500ms', passed: (service.responseTime || 9999) < 500, value: service.responseTime ? `${service.responseTime}ms` : 'N/A' }
                ],
                fixSteps: liveTroubleshooting || [
                    'Check MongoDB Atlas dashboard at https://cloud.mongodb.com',
                    'Verify MONGODB_URI environment variable in Render Dashboard',
                    'Ensure IP whitelist includes 0.0.0.0/0 (allow all) in Atlas Network Access',
                    'Check if Atlas cluster is paused (free tier pauses after 7 days inactive)',
                    'Verify credentials in connection string are correct',
                    'Try restarting the Render service'
                ]
            },
            'Redis': {
                sourceFile: 'services/DependencyHealthMonitor.js',
                checkFunction: 'checkRedis()',
                envVar: 'REDIS_URL',
                // USE LIVE CHECKPOINTS if available - these come from the enhanced checkRedis()
                checkpoints: liveCheckpoints || [
                    { name: 'Redis client initialized', passed: !service.message?.includes('not initialized'), value: service.message?.includes('not initialized') ? 'NOT INITIALIZED' : 'OK' },
                    { name: 'Redis ping test', passed: service.status === 'HEALTHY', value: service.responseTime ? `${service.responseTime}ms` : 'Failed' },
                    { name: 'Response time < 150ms', passed: (service.responseTime || 9999) < 150, value: service.responseTime ? `${service.responseTime}ms` : 'N/A' },
                    { name: 'Response time < 250ms (critical)', passed: (service.responseTime || 9999) < 250, value: service.responseTime ? `${service.responseTime}ms` : 'N/A' }
                ],
                // USE LIVE TROUBLESHOOTING if available - these come from the enhanced checkRedis()
                fixSteps: liveTroubleshooting || [
                    'Check Render Dashboard → Redis addon status',
                    'Verify REDIS_URL environment variable is set in Render',
                    'Ensure Redis addon is properly linked to your web service',
                    'Check if Redis addon subscription is active (not expired)',
                    'Look for "Redis client not initialized" → means REDIS_URL is missing or invalid',
                    'If latency > 250ms, check if Redis and Web Service are in same region',
                    'Try restarting the Render service to re-establish connection'
                ]
            },
            'Twilio': {
                sourceFile: 'services/DependencyHealthMonitor.js',
                checkFunction: 'checkTwilio()',
                envVar: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN',
                checkpoints: [
                    { name: 'Twilio credentials configured', passed: service.status !== 'NOT_CONFIGURED', value: service.status === 'NOT_CONFIGURED' ? 'MISSING' : 'OK' },
                    { name: 'Account SID format valid (AC...)', passed: service.status !== 'DOWN' || !service.message?.includes('format'), value: service.details?.accountSid || 'N/A' },
                    { name: 'API authentication', passed: service.status === 'HEALTHY', value: service.error?.includes('auth') ? 'FAILED' : 'OK' },
                    { name: 'Account status active', passed: service.status === 'HEALTHY', value: service.details?.accountStatus || 'Unknown' }
                ],
                fixSteps: [
                    'Go to https://console.twilio.com → Dashboard',
                    'Copy Account SID (starts with AC) and Auth Token',
                    'Set TWILIO_ACCOUNT_SID in Render Environment Variables',
                    'Set TWILIO_AUTH_TOKEN in Render Environment Variables',
                    'Set TWILIO_PHONE_NUMBER with your Twilio phone (format: +1234567890)',
                    'Verify your Twilio account is active and has credits',
                    'Check if account is in trial mode (may have restrictions)'
                ]
            },
            'ElevenLabs': {
                sourceFile: 'services/DependencyHealthMonitor.js',
                checkFunction: 'checkElevenLabs()',
                envVar: 'ELEVENLABS_API_KEY',
                checkpoints: [
                    { name: 'API key configured', passed: service.status !== 'DOWN' || !service.message?.includes('not configured'), value: service.message?.includes('not configured') ? 'MISSING' : 'OK' },
                    { name: 'API key format valid (>20 chars)', passed: service.status === 'HEALTHY', value: service.details?.apiKey || 'N/A' }
                ],
                fixSteps: [
                    'Go to https://elevenlabs.io/app → Profile → API Keys',
                    'Generate or copy your API key',
                    'Set ELEVENLABS_API_KEY in Render Environment Variables',
                    'Verify your ElevenLabs subscription has available quota'
                ]
            },
            'OpenAI (GPT-4)': {
                sourceFile: 'services/DependencyHealthMonitor.js',
                checkFunction: 'checkOpenAI()',
                envVar: 'OPENAI_API_KEY, ENABLE_3_TIER_INTELLIGENCE',
                checkpoints: [
                    { name: '3-Tier Intelligence enabled', passed: service.status !== 'NOT_CONFIGURED', value: service.details?.featureFlag || 'Unknown' },
                    { name: 'API key configured', passed: !service.message?.includes('not configured'), value: service.missingVars?.includes('OPENAI_API_KEY') ? 'MISSING' : 'OK' },
                    { name: 'API key format valid (sk-...)', passed: !service.message?.includes('format'), value: service.details?.apiKey || 'N/A' },
                    { name: 'API connection test', passed: service.status === 'HEALTHY', value: service.error || 'OK' }
                ],
                fixSteps: [
                    'Check if ENABLE_3_TIER_INTELLIGENCE=true (if false, OpenAI is not needed)',
                    'Go to https://platform.openai.com/api-keys',
                    'Create new API key or copy existing one',
                    'Set OPENAI_API_KEY in Render Environment Variables (must start with sk-)',
                    'Verify OpenAI account has available credits/quota',
                    'Check https://status.openai.com for service outages',
                    'If using Tier 3 LLM, ensure billing is set up on OpenAI'
                ]
            },
            'LLM-0 Orchestration': {
                sourceFile: 'services/OrchestrationHealthCheck.js',
                checkFunction: 'checkOrchestrationPipeline()',
                envVar: 'OPENAI_API_KEY (for Micro-LLM)',
                checkpoints: [
                    { name: 'Preprocessing (FillerStripper)', passed: service.status === 'HEALTHY', value: service.details?.components?.[0]?.status || 'Unknown' },
                    { name: 'Intelligence (EmotionDetector)', passed: service.status === 'HEALTHY', value: service.details?.components?.[1]?.status || 'Unknown' },
                    { name: 'Routing (MicroLLMRouter)', passed: service.status === 'HEALTHY', value: service.details?.components?.[2]?.status || 'Unknown' },
                    { name: 'Personality (HumanLayerAssembler)', passed: service.status === 'HEALTHY', value: service.details?.components?.[3]?.status || 'Unknown' },
                    { name: 'Micro-LLM (gpt-4o-mini)', passed: service.status === 'HEALTHY', value: service.details?.components?.[4]?.status || 'Unknown' }
                ],
                fixSteps: [
                    'LLM-0 requires OpenAI API for gpt-4o-mini routing',
                    'First fix OpenAI (GPT-4) connection if it is DOWN',
                    'Verify OPENAI_API_KEY is set and valid in Render',
                    'Check if any orchestration component files are missing',
                    'Review Render logs for specific component errors',
                    'Restart service after fixing OpenAI connection'
                ]
            }
        };
        
        // Default fallback for unknown services
        const defaultTroubleshoot = {
            sourceFile: 'services/DependencyHealthMonitor.js',
            checkFunction: 'getDependencyStatus()',
            envVar: 'Unknown',
            checkpoints: [
                { name: 'Service check completed', passed: service.status === 'HEALTHY', value: service.status }
            ],
            fixSteps: [
                'Check Render logs for specific error messages',
                'Verify all required environment variables are set',
                'Try restarting the service',
                'Contact support if issue persists'
            ]
        };
        
        return troubleshootingData[serviceName] || defaultTroubleshoot;
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

