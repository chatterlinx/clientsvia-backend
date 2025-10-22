// ============================================================================
// 📜 LOG MANAGER - Alert History
// ============================================================================

class LogManager {
    constructor(notificationCenter) {
        this.nc = notificationCenter;
        this.currentPage = 1;
        this.logs = []; // Store current logs for copyDebugInfo
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Filter handlers
        const severityFilter = document.getElementById('log-filter-severity');
        const acknowledgedFilter = document.getElementById('log-filter-acknowledged');
        
        if (severityFilter) {
            severityFilter.addEventListener('change', () => this.load());
        }
        if (acknowledgedFilter) {
            acknowledgedFilter.addEventListener('change', () => this.load());
        }
    }
    
    async load() {
        console.log('📜 [LOG] Loading alert logs...');
        
        try {
            const severity = document.getElementById('log-filter-severity')?.value || '';
            const acknowledged = document.getElementById('log-filter-acknowledged')?.value || '';
            
            let url = `/api/admin/notifications/logs?page=${this.currentPage}&limit=20`;
            if (severity) url += `&severity=${severity}`;
            if (acknowledged) url += `&acknowledged=${acknowledged}`;
            
            const data = await this.nc.apiGet(url);
            
            if (data.success) {
                this.renderLogs(data.data.logs, data.data.pagination);
            }
            
        } catch (error) {
            console.error('❌ [LOG] Load failed:', error);
        }
    }
    
    renderLogs(logs, pagination) {
        const container = document.getElementById('logs-container');
        
        // Store logs for copyDebugInfo function
        this.logs = logs;
        
        if (logs.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-inbox text-4xl mb-2"></i>
                    <p class="text-lg">No logs found</p>
                </div>
            `;
            return;
        }
        
        let html = '<div class="space-y-4">';
        
        logs.forEach(log => {
            html += this.renderLogCard(log);
        });
        
        html += '</div>';
        
        // Add pagination
        if (pagination.pages > 1) {
            html += this.renderPagination(pagination);
        }
        
        container.innerHTML = html;
    }
    
    renderLogCard(log) {
        const severityColors = {
            'CRITICAL': 'border-red-500 bg-red-50',
            'WARNING': 'border-yellow-500 bg-yellow-50',
            'INFO': 'border-blue-500 bg-blue-50'
        };
        
        const statusBadge = log.acknowledgment?.isAcknowledged
            ? '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">✅ Acknowledged</span>'
            : '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">⏳ Waiting</span>';
        
        // Generate suggested actions based on error code
        const suggestedActions = this.getSuggestedActions(log);
        
        return `
            <div class="border-l-4 ${severityColors[log.severity]} p-4 rounded-r-lg shadow">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex-1">
                        <h5 class="font-mono text-sm font-semibold text-gray-900">${log.alertId}</h5>
                        <p class="text-gray-700 font-medium">${log.message}</p>
                        <p class="text-xs text-gray-500 mt-1">Code: <span class="font-mono">${log.code}</span></p>
                    </div>
                    <div class="flex space-x-2">
                        <span class="px-2 py-1 rounded-full text-xs font-semibold ${log.severity === 'CRITICAL' ? 'bg-red-100 text-red-800' : log.severity === 'WARNING' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}">
                            ${log.severity}
                        </span>
                        ${statusBadge}
                    </div>
                </div>
                <div class="text-sm text-gray-600 space-y-1">
                    <div>Company: ${log.companyName} ${log.companyId ? `<span class="text-xs font-mono text-gray-400">(${log.companyId})</span>` : ''}</div>
                    <div>Created: ${this.nc.formatDateTime(log.createdAt)}</div>
                    <div>Attempts: ${log.deliveryAttempts?.length || 0} | Level: ${log.escalation?.currentLevel || 1}/${log.escalation?.maxLevel || 3}</div>
                    ${log.acknowledgment?.isAcknowledged ? `
                        <div class="text-green-600">Acknowledged by ${log.acknowledgment.acknowledgedBy} at ${this.nc.formatDateTime(log.acknowledgment.acknowledgedAt)}</div>
                    ` : ''}
                </div>
                
                <!-- Suggested Actions -->
                ${suggestedActions ? `
                    <div class="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                        <p class="text-sm font-semibold text-blue-900 mb-1">💡 Suggested Actions:</p>
                        <p class="text-sm text-blue-800">${suggestedActions}</p>
                    </div>
                ` : ''}
                
                <!-- Expandable Details -->
                <div class="mt-3">
                    <button onclick="notificationCenter.logManager.toggleDetails('${log.alertId}')" 
                            class="text-sm text-blue-600 hover:text-blue-800 font-medium">
                        ▶ Show Details
                    </button>
                    <div id="details-${log.alertId}" class="hidden mt-2 p-3 bg-gray-100 rounded text-xs font-mono">
                        ${log.details ? `<div class="mb-2"><strong>Details:</strong><br>${this.escapeHtml(log.details)}</div>` : ''}
                        ${log.stackTrace ? `<div class="mb-2"><strong>Stack Trace:</strong><br><pre class="whitespace-pre-wrap text-xs overflow-x-auto">${this.escapeHtml(log.stackTrace)}</pre></div>` : ''}
                        ${log.deliveryAttempts?.length > 0 ? `
                            <div class="mb-2">
                                <strong>Delivery Attempts:</strong><br>
                                ${log.deliveryAttempts.map((attempt, idx) => `
                                    Attempt ${attempt.attemptNumber}: SMS=${attempt.sms?.length || 0} sent, Email=${attempt.email?.length || 0} sent
                                `).join('<br>')}
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                <!-- Action Buttons -->
                <div class="mt-3 flex flex-wrap gap-2">
                    ${!log.acknowledgment?.isAcknowledged ? `
                        <button onclick="notificationCenter.logManager.acknowledgeAlert('${log.alertId}')" 
                                class="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700">
                            ✅ Acknowledge
                        </button>
                        <button onclick="notificationCenter.logManager.snoozeAlert('${log.alertId}')" 
                                class="px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700">
                            ⏰ Snooze 1hr
                        </button>
                    ` : ''}
                    <button onclick="notificationCenter.logManager.copyDebugInfo('${log.alertId}')" 
                            class="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700">
                        📋 Copy Debug Info
                    </button>
                    ${log.companyId ? `
                        <a href="/company-profile.html?id=${log.companyId}" target="_blank"
                           class="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 inline-block">
                            🏢 View Company
                        </a>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    getSuggestedActions(log) {
        const actions = {
            'NOTIFICATION_SYSTEM_FAILURE': '1. Check Settings tab for Twilio credentials. 2. Verify SMS client is configured. 3. Check Render logs for detailed error.',
            'TWILIO_API_FAILURE': '1. Verify Twilio Account SID and Auth Token in Settings. 2. Check Twilio Console for account status. 3. Ensure phone numbers are valid.',
            'TWILIO_GREETING_FAILURE': '1. Check company AI settings. 2. Verify ElevenLabs API key if using voice. 3. Review greeting templates.',
            'AI_AGENT_INIT_FAILURE': '1. Check company AI Agent settings. 2. Verify knowledge base is configured. 3. Check company template settings.',
            'DB_CONNECTION_ERROR': '1. Check MongoDB Atlas connection. 2. Verify MONGODB_URI environment variable. 3. Check database cluster status.',
            'REDIS_CONNECTION_ERROR': '1. Check Redis connection. 2. Verify REDIS_URL environment variable. 3. Check Redis server status.',
            'SMS_DELIVERY_FAILURE': '1. Check Twilio credentials. 2. Verify phone number format (+1234567890). 3. Check Twilio Console for delivery logs.',
            'EMAIL_DELIVERY_FAILURE': '1. Check email service credentials. 2. Verify email addresses. 3. Check spam filters.'
        };
        
        return actions[log.code] || null;
    }
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    toggleDetails(alertId) {
        const detailsDiv = document.getElementById(`details-${alertId}`);
        const button = event.target;
        
        if (detailsDiv.classList.contains('hidden')) {
            detailsDiv.classList.remove('hidden');
            button.textContent = '▼ Hide Details';
        } else {
            detailsDiv.classList.add('hidden');
            button.textContent = '▶ Show Details';
        }
    }
    
    async copyDebugInfo(alertId) {
        try {
            // Find the log in the current data
            const log = this.logs.find(l => l.alertId === alertId);
            if (!log) {
                this.nc.showError('Alert not found');
                return;
            }
            
            // Build comprehensive debug report
            const debugInfo = `
═══════════════════════════════════════════════════════
🐛 CLIENTSVIA ALERT DEBUG REPORT
═══════════════════════════════════════════════════════

ALERT ID: ${log.alertId}
CODE: ${log.code}
SEVERITY: ${log.severity}
STATUS: ${log.acknowledgment?.isAcknowledged ? 'Acknowledged' : 'Waiting'}

MESSAGE:
${log.message}

COMPANY:
- Name: ${log.companyName}
- ID: ${log.companyId || 'N/A'}

TIMELINE:
- Created: ${log.createdAt}
- Updated: ${log.updatedAt}
${log.acknowledgment?.isAcknowledged ? `- Acknowledged: ${log.acknowledgment.acknowledgedAt} by ${log.acknowledgment.acknowledgedBy}` : ''}

DELIVERY ATTEMPTS: ${log.deliveryAttempts?.length || 0}
${log.deliveryAttempts?.map((attempt, idx) => `
  Attempt ${attempt.attemptNumber}:
  - Timestamp: ${attempt.timestamp}
  - SMS: ${attempt.sms?.length || 0} sent, ${attempt.sms?.filter(s => s.status === 'sent').length || 0} successful
  - Email: ${attempt.email?.length || 0} sent, ${attempt.email?.filter(e => e.status === 'sent').length || 0} successful
`).join('') || '  No attempts recorded'}

ESCALATION:
- Current Level: ${log.escalation?.currentLevel || 1}/${log.escalation?.maxLevel || 3}
- Enabled: ${log.escalation?.isEnabled ? 'Yes' : 'No'}

${log.details ? `
DETAILS:
${log.details}
` : ''}

${log.stackTrace ? `
STACK TRACE:
${log.stackTrace}
` : ''}

SUGGESTED ACTIONS:
${this.getSuggestedActions(log) || 'Review Render logs and check system configuration.'}

═══════════════════════════════════════════════════════
Generated: ${new Date().toISOString()}
Platform: ClientsVia Multi-Tenant Backend
Environment: Production
═══════════════════════════════════════════════════════

Paste this report to your AI assistant for debugging help.
            `.trim();
            
            // Copy to clipboard
            await navigator.clipboard.writeText(debugInfo);
            
            this.nc.showSuccess('✅ Debug info copied to clipboard! Paste it to your AI assistant.');
            
        } catch (error) {
            console.error('Copy failed:', error);
            this.nc.showError('Failed to copy debug info');
        }
    }
    
    renderPagination(pagination) {
        let html = '<div class="flex justify-center items-center space-x-2 mt-6">';
        
        for (let i = 1; i <= pagination.pages; i++) {
            const active = i === pagination.page ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100';
            html += `<button onclick="notificationCenter.logManager.goToPage(${i})" class="px-3 py-1 rounded border ${active}">${i}</button>`;
        }
        
        html += '</div>';
        return html;
    }
    
    goToPage(page) {
        this.currentPage = page;
        this.load();
    }
    
    async acknowledgeAlert(alertId) {
        if (!confirm(`Acknowledge alert ${alertId}?`)) return;
        
        try {
            await this.nc.apiPost('/api/admin/notifications/acknowledge', {
                alertId: alertId,
                acknowledgedBy: 'Admin (Web UI)'
            });
            
            this.nc.showSuccess('Alert acknowledged!');
            this.load();
            
        } catch (error) {
            this.nc.showError('Failed to acknowledge alert');
        }
    }
    
    async snoozeAlert(alertId) {
        try {
            await this.nc.apiPost('/api/admin/notifications/snooze', {
                alertId: alertId,
                minutes: 60,
                reason: 'Snoozed from web UI'
            });
            
            this.nc.showSuccess('Alert snoozed for 1 hour!');
            this.load();
            
        } catch (error) {
            this.nc.showError('Failed to snooze alert');
        }
    }
}

