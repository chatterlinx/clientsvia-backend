// ============================================================================
// 📜 LOG MANAGER - Alert History
// ============================================================================

class LogManager {
    constructor(notificationCenter) {
        this.nc = notificationCenter;
        this.currentPage = 1;
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
        
        return `
            <div class="border-l-4 ${severityColors[log.severity]} p-4 rounded-r-lg shadow">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h5 class="font-mono text-sm font-semibold text-gray-900">${log.alertId}</h5>
                        <p class="text-gray-700 font-medium">${log.message}</p>
                    </div>
                    <div class="flex space-x-2">
                        <span class="px-2 py-1 rounded-full text-xs font-semibold ${log.severity === 'CRITICAL' ? 'bg-red-100 text-red-800' : log.severity === 'WARNING' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}">
                            ${log.severity}
                        </span>
                        ${statusBadge}
                    </div>
                </div>
                <div class="text-sm text-gray-600 space-y-1">
                    <div>Company: ${log.companyName}</div>
                    <div>Created: ${this.nc.formatDateTime(log.createdAt)}</div>
                    <div>Attempts: ${log.deliveryAttempts?.length || 0} | Level: ${log.escalation?.currentLevel || 1}/${log.escalation?.maxLevel || 3}</div>
                    ${log.acknowledgment?.isAcknowledged ? `
                        <div class="text-green-600">Acknowledged by ${log.acknowledgment.acknowledgedBy} at ${this.nc.formatDateTime(log.acknowledgment.acknowledgedAt)}</div>
                    ` : ''}
                </div>
                ${!log.acknowledgment?.isAcknowledged ? `
                    <div class="mt-3 flex space-x-2">
                        <button onclick="notificationCenter.logManager.acknowledgeAlert('${log.alertId}')" class="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700">
                            Acknowledge
                        </button>
                        <button onclick="notificationCenter.logManager.snoozeAlert('${log.alertId}')" class="px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700">
                            Snooze 1hr
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
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

