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
                    ${!log.resolution?.isResolved ? `
                        <button onclick="notificationCenter.logManager.resolveAlert('${log.alertId}')" 
                                class="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                            ✅ Resolve
                        </button>
                    ` : ''}
                    <button onclick="notificationCenter.logManager.copyDebugInfo('${log.alertId}')" 
                            class="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700">
                        📋 Copy Debug Info
                    </button>
                    ${log.intelligence?.fix?.fixUrl ? `
                        <a href="${log.intelligence.fix.fixUrl}" target="_blank"
                           class="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 inline-block">
                            ⚙️ Open Config
                        </a>
                    ` : ''}
                    ${log.intelligence?.fix?.uiFixUrl ? `
                        <a href="${log.intelligence.fix.uiFixUrl}" target="_blank"
                           class="px-3 py-1 bg-teal-600 text-white text-sm rounded hover:bg-teal-700 inline-block">
                            🛠️ Fix in UI
                        </a>
                    ` : ''}
                    ${log.intelligence?.fix?.externalDocs ? `
                        <a href="${log.intelligence.fix.externalDocs}" target="_blank"
                           class="px-3 py-1 bg-cyan-600 text-white text-sm rounded hover:bg-cyan-700 inline-block">
                            📚 View Docs
                        </a>
                    ` : ''}
                    ${(log.intelligence?.fix?.reproduceSteps && log.intelligence.fix.reproduceSteps.length > 0) || (log.intelligence?.fix?.verifySteps && log.intelligence.fix.verifySteps.length > 0) ? `
                        <button onclick="notificationCenter.logManager.showFixGuide('${log.alertId}')" 
                                class="px-3 py-1 bg-orange-600 text-white text-sm rounded hover:bg-orange-700">
                            🔧 Fix Guide
                        </button>
                    ` : ''}
                    ${log.code.includes('HEALTH') || log.code.includes('TWILIO') || log.code.includes('SMS') ? `
                        <button onclick="notificationCenter.logManager.testFix('${log.alertId}', '${log.code}')" 
                                class="px-3 py-1 bg-pink-600 text-white text-sm rounded hover:bg-pink-700">
                            🧪 Test Fix
                        </button>
                    ` : ''}
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
        // Use intelligence data if available (new error intelligence system)
        if (log.intelligence?.fix?.reproduceSteps && log.intelligence.fix.reproduceSteps.length > 0) {
            return log.intelligence.fix.reproduceSteps.join(' ');
        }
        
        // Fallback to hardcoded actions for backward compatibility
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
            
            // Build comprehensive debug report with ERROR INTELLIGENCE
            const intel = log.intelligence || {};
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

${intel.source ? `
═══════════════════════════════════════════════════════
🎯 ERROR SOURCE
═══════════════════════════════════════════════════════
- File: ${intel.source.file || 'Unknown'}
- Line: ${intel.source.line || 'Unknown'}
- Function: ${intel.source.function || 'Unknown'}
${intel.source.query ? `- Query: ${intel.source.query}` : ''}
` : ''}

${intel.dependencies ? `
═══════════════════════════════════════════════════════
🔗 DEPENDENCY ANALYSIS
═══════════════════════════════════════════════════════
${intel.dependencies.rootCause && intel.dependencies.rootCause !== log.code ? `
⚠️ THIS IS A CASCADE FAILURE!
Root Cause: ${intel.dependencies.rootCause}
Fix the root cause first, and this error will resolve automatically.
` : `✅ This is the ROOT CAUSE - fix this directly.`}

${intel.dependencies.cascadeFailures?.length > 0 ? `
Cascade Failures (will auto-resolve when this is fixed):
${intel.dependencies.cascadeFailures.map(f => `  - ${f}`).join('\n')}
` : ''}

${intel.dependencies.affectsServices?.length > 0 ? `
Affected Services:
${intel.dependencies.affectsServices.map(s => `  - ${s}`).join('\n')}
` : ''}
` : ''}

${intel.impact ? `
═══════════════════════════════════════════════════════
💥 IMPACT ASSESSMENT
═══════════════════════════════════════════════════════
Priority: ${intel.impact.priority}
Revenue Impact: ${intel.impact.revenue}
Customer Facing: ${intel.related?.customerFacing ? 'YES - Affects end users' : 'NO - Internal only'}
Companies Affected: ${intel.impact.companies}
Features Affected:
${intel.impact.features?.map(f => `  - ${f}`).join('\n') || '  - Unknown'}
` : ''}

${intel.fix?.reproduceSteps?.length > 0 ? `
═══════════════════════════════════════════════════════
🔧 HOW TO FIX
═══════════════════════════════════════════════════════

REPRODUCTION STEPS:
${intel.fix.reproduceSteps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}

${intel.fix.verifySteps?.length > 0 ? `
VERIFICATION STEPS (after fix):
${intel.fix.verifySteps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}
` : ''}

${intel.fix.envVars?.length > 0 ? `
REQUIRED ENVIRONMENT VARIABLES:
${intel.fix.envVars.map(v => `  - ${v}`).join('\n')}
Location: ${intel.fix.configFile || 'Render Dashboard → Environment Variables'}
` : ''}

${intel.fix.fixUrl ? `
DIRECT FIX LINK: ${intel.fix.fixUrl}
` : ''}

${intel.fix.uiFixUrl ? `
UI FIX LINK: ${intel.fix.uiFixUrl}
` : ''}

${intel.fix.externalDocs ? `
EXTERNAL DOCUMENTATION: ${intel.fix.externalDocs}
` : ''}
` : `
═══════════════════════════════════════════════════════
🔧 SUGGESTED ACTIONS
═══════════════════════════════════════════════════════
${this.getSuggestedActions(log) || 'Review Render logs and check system configuration.'}
`}

${intel.related?.commonCauses?.length > 0 ? `
═══════════════════════════════════════════════════════
🤔 COMMON CAUSES
═══════════════════════════════════════════════════════
${intel.related.commonCauses.map(c => `  - ${c}`).join('\n')}
` : ''}

${intel.related?.errors?.length > 0 ? `
═══════════════════════════════════════════════════════
🔗 RELATED ERRORS
═══════════════════════════════════════════════════════
${intel.related.errors.map(e => `  - ${e}`).join('\n')}
` : ''}

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

═══════════════════════════════════════════════════════
Generated: ${new Date().toISOString()}
Platform: ClientsVia Multi-Tenant Backend
Environment: Production
═══════════════════════════════════════════════════════

Paste this report to your AI assistant for instant root cause analysis!
            `.trim();
            
            // Copy to clipboard
            await navigator.clipboard.writeText(debugInfo);
            
            this.nc.showSuccess('✅ Debug info copied to clipboard! Paste it to your AI assistant.');
            
        } catch (error) {
            console.error('Copy failed:', error);
            this.nc.showError('Failed to copy debug info');
        }
    }
    
    async showFixGuide(alertId) {
        try {
            const log = this.logs.find(l => l.alertId === alertId);
            if (!log || !log.intelligence) {
                this.nc.showError('Fix guide not available for this alert');
                return;
            }
            
            const intel = log.intelligence;
            let guideHtml = `
                <div class="space-y-4">
                    <div class="bg-gradient-to-r from-red-50 to-orange-50 border-l-4 border-red-500 p-4 rounded">
                        <h3 class="font-bold text-lg text-gray-900 mb-2">🔧 Fix Guide: ${log.code}</h3>
                        <p class="text-gray-700">${log.message}</p>
                    </div>
            `;
            
            // Root Cause
            if (intel.dependencies?.rootCause) {
                guideHtml += `
                    <div class="bg-red-50 border border-red-200 p-4 rounded">
                        <h4 class="font-semibold text-red-900 mb-2">🎯 Root Cause</h4>
                        <p class="text-gray-800">${intel.dependencies.rootCause}</p>
                    </div>
                `;
            }
            
            // Impact
            if (intel.impact) {
                guideHtml += `
                    <div class="bg-orange-50 border border-orange-200 p-4 rounded">
                        <h4 class="font-semibold text-orange-900 mb-2">⚠️ Impact Assessment</h4>
                        <ul class="list-disc list-inside text-gray-800 space-y-1">
                            ${intel.impact.priority ? `<li><strong>Priority:</strong> ${intel.impact.priority}</li>` : ''}
                            ${intel.impact.companies ? `<li><strong>Affected Companies:</strong> ${intel.impact.companies}</li>` : ''}
                            ${intel.impact.revenue ? `<li><strong>Revenue Impact:</strong> ${intel.impact.revenue}</li>` : ''}
                            ${intel.impact.features?.length > 0 ? `<li><strong>Affected Features:</strong> ${intel.impact.features.join(', ')}</li>` : ''}
                        </ul>
                    </div>
                `;
            }
            
            // Reproduce Steps
            if (intel.fix?.reproduceSteps && intel.fix.reproduceSteps.length > 0) {
                guideHtml += `
                    <div class="bg-blue-50 border border-blue-200 p-4 rounded">
                        <h4 class="font-semibold text-blue-900 mb-2">🔍 How to Reproduce</h4>
                        <ol class="list-decimal list-inside text-gray-800 space-y-2">
                            ${intel.fix.reproduceSteps.map(step => `<li>${step}</li>`).join('')}
                        </ol>
                    </div>
                `;
            }
            
            // Fix Instructions
            if (intel.fix?.verifySteps && intel.fix.verifySteps.length > 0) {
                guideHtml += `
                    <div class="bg-green-50 border border-green-200 p-4 rounded">
                        <h4 class="font-semibold text-green-900 mb-2">✅ How to Verify Fix</h4>
                        <ol class="list-decimal list-inside text-gray-800 space-y-2">
                            ${intel.fix.verifySteps.map(step => `<li>${step}</li>`).join('')}
                        </ol>
                    </div>
                `;
            }
            
            // Related Errors
            if (intel.related?.errors && intel.related.errors.length > 0) {
                guideHtml += `
                    <div class="bg-purple-50 border border-purple-200 p-4 rounded">
                        <h4 class="font-semibold text-purple-900 mb-2">🔗 Related Errors</h4>
                        <ul class="list-disc list-inside text-gray-800 space-y-1">
                            ${intel.related.errors.map(err => `<li><code class="font-mono text-sm">${err}</code></li>`).join('')}
                        </ul>
                    </div>
                `;
            }
            
            // External Links
            const hasLinks = intel.fix?.fixUrl || intel.fix?.uiFixUrl || intel.fix?.externalDocs;
            if (hasLinks) {
                guideHtml += `
                    <div class="bg-indigo-50 border border-indigo-200 p-4 rounded">
                        <h4 class="font-semibold text-indigo-900 mb-2">🔗 Quick Links</h4>
                        <div class="flex flex-wrap gap-2">
                            ${intel.fix?.fixUrl ? `<a href="${intel.fix.fixUrl}" target="_blank" class="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700">⚙️ Open Config</a>` : ''}
                            ${intel.fix?.uiFixUrl ? `<a href="${intel.fix.uiFixUrl}" target="_blank" class="px-3 py-1 bg-teal-600 text-white text-sm rounded hover:bg-teal-700">🛠️ Fix in UI</a>` : ''}
                            ${intel.fix?.externalDocs ? `<a href="${intel.fix.externalDocs}" target="_blank" class="px-3 py-1 bg-cyan-600 text-white text-sm rounded hover:bg-cyan-700">📚 View Docs</a>` : ''}
                        </div>
                    </div>
                `;
            }
            
            guideHtml += '</div>';
            
            // Show in modal
            this.showModal('Fix Guide', guideHtml);
            
        } catch (error) {
            console.error('❌ [LOG] Error showing fix guide:', error);
            this.nc.showError('Failed to load fix guide');
        }
    }
    
    async testFix(alertId, errorCode) {
        try {
            this.nc.showInfo('🧪 Running test...');
            
            // Determine what test to run based on error code
            let testEndpoint = null;
            let testName = '';
            
            if (errorCode.includes('HEALTH') || errorCode.includes('PLATFORM')) {
                testEndpoint = '/api/admin/notifications/health-check';
                testName = 'Platform Health Check';
            } else if (errorCode.includes('TWILIO') || errorCode.includes('SMS')) {
                testEndpoint = '/api/admin/notifications/test-sms';
                testName = 'SMS Delivery Test';
            }
            
            if (!testEndpoint) {
                this.nc.showError('No test available for this error type');
                return;
            }
            
            console.log(`🧪 [LOG] Running ${testName}...`);
            const response = await this.nc.apiPost(testEndpoint, {});
            
            if (response.success) {
                // Check the ACTUAL health check results, not just API success
                const status = response.data?.overallStatus || 'UNKNOWN';
                const passed = response.data?.summary?.passed || 0;
                const total = response.data?.summary?.total || 0;
                const failed = response.data?.summary?.failed || 0;
                const warnings = response.data?.summary?.warnings || 0;
                
                if (status === 'HEALTHY' || status === 'PASS') {
                    this.nc.showSuccess(`✅ ${testName} PASSED! All systems operational (${passed}/${total} checks passed)`);
                } else if (status === 'WARNING') {
                    this.nc.showWarning(`⚠️ ${testName} completed with WARNINGS: ${warnings} warning(s), ${failed} failure(s). Check details in new alert.`);
                } else if (status === 'CRITICAL' || status === 'FAIL') {
                    this.nc.showError(`🚨 ${testName} FAILED: ${failed} critical failure(s), ${warnings} warning(s). Check Alert Log for details!`);
                } else {
                    this.nc.showInfo(`ℹ️ ${testName} completed. Status: ${status}`);
                }
                
                // Auto-refresh logs to show new test results
                setTimeout(() => {
                    this.load();
                }, 2000);
            } else {
                this.nc.showError(`❌ ${testName} failed to run: ${response.message || 'Unknown error'}`);
            }
            
        } catch (error) {
            console.error('❌ [LOG] Test failed:', error);
            this.nc.showError(`Test failed: ${error.message}`);
        }
    }
    
    showModal(title, contentHtml) {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                <div class="flex justify-between items-center p-4 border-b">
                    <h2 class="text-xl font-bold text-gray-900">${title}</h2>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700 text-2xl font-bold">
                        ×
                    </button>
                </div>
                <div class="p-6 overflow-y-auto flex-1">
                    ${contentHtml}
                </div>
                <div class="flex justify-end p-4 border-t">
                    <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
                        Close
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
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
    
    async resolveAlert(alertId) {
        if (!confirm(`Mark alert ${alertId} as resolved? This will start the 90-day auto-purge countdown.`)) return;
        
        try {
            await this.nc.apiPost('/api/admin/notifications/resolve', {
                alertId: alertId,
                resolvedBy: 'Admin (Web UI)',
                action: 'manual_resolve',
                notes: 'Manually resolved from Alert Log'
            });
            
            this.nc.showSuccess('Alert resolved! Will auto-delete in 90 days.');
            this.load();
            
        } catch (error) {
            this.nc.showError('Failed to resolve alert');
            console.error('❌ [LOG] Resolve failed:', error);
        }
    }
}

