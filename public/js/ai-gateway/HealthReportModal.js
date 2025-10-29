// ============================================================================
// 📋 AI GATEWAY - HEALTH REPORT MODAL
// ============================================================================
// PURPOSE: Display full diagnostic report for a health check log
// FEATURES: Formatted report display, copy to clipboard, detailed breakdown
// USAGE: window.healthReportModal.open(logId)
// CREATED: 2025-10-29
// ============================================================================

class HealthReportModal {
    constructor() {
        console.log('🏗️ [HEALTH REPORT MODAL] Initializing...');
        this.modal = null;
        this.currentLog = null;
        this.createModal();
        console.log('✅ [HEALTH REPORT MODAL] Initialized');
    }

    // ========================================================================
    // 🏗️ CREATE MODAL STRUCTURE
    // ========================================================================

    createModal() {
        this.modal = document.createElement('div');
        this.modal.id = 'health-report-modal';
        this.modal.className = 'hidden fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4';
        this.modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                <!-- Header -->
                <div class="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <i class="fas fa-file-medical-alt text-white text-2xl"></i>
                        <div>
                            <h2 class="text-xl font-bold text-white">Health Check Report</h2>
                            <p id="report-timestamp" class="text-purple-100 text-sm">Loading...</p>
                        </div>
                    </div>
                    <button onclick="window.healthReportModal.close()" class="text-white hover:text-purple-200 transition-colors">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>

                <!-- Content -->
                <div class="flex-1 overflow-y-auto p-6">
                    <!-- Loading State -->
                    <div id="report-loading" class="space-y-4">
                        <div class="animate-pulse bg-gray-200 rounded h-32"></div>
                        <div class="animate-pulse bg-gray-200 rounded h-32"></div>
                        <div class="animate-pulse bg-gray-200 rounded h-32"></div>
                    </div>

                    <!-- Report Content -->
                    <div id="report-content" class="hidden space-y-6">
                        <!-- Overall Status Banner -->
                        <div id="overall-status-banner" class="p-4 rounded-lg border-2">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-3">
                                    <span id="status-icon" class="text-3xl"></span>
                                    <div>
                                        <h3 id="status-title" class="text-lg font-bold">Loading...</h3>
                                        <p id="status-subtitle" class="text-sm text-gray-600">Loading...</p>
                                    </div>
                                </div>
                                <span id="severity-badge" class="px-3 py-1 rounded-full text-sm font-medium"></span>
                            </div>
                        </div>

                        <!-- System Status Breakdown -->
                        <div>
                            <h4 class="text-md font-bold text-gray-900 mb-3 flex items-center gap-2">
                                <i class="fas fa-server text-gray-600"></i>
                                System Status Breakdown
                            </h4>
                            <div id="system-status-grid" class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <!-- Populated by JS -->
                            </div>
                        </div>

                        <!-- Root Cause Analysis -->
                        <div id="root-cause-section" class="hidden">
                            <h4 class="text-md font-bold text-gray-900 mb-3 flex items-center gap-2">
                                <i class="fas fa-search text-red-600"></i>
                                Root Cause Analysis
                            </h4>
                            <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                                <p id="root-cause-text" class="text-gray-800"></p>
                            </div>
                        </div>

                        <!-- Suggested Fixes -->
                        <div id="suggested-fixes-section" class="hidden">
                            <h4 class="text-md font-bold text-gray-900 mb-3 flex items-center gap-2">
                                <i class="fas fa-tools text-blue-600"></i>
                                Suggested Fixes
                            </h4>
                            <ul id="suggested-fixes-list" class="space-y-2">
                                <!-- Populated by JS -->
                            </ul>
                        </div>

                        <!-- Technical Details -->
                        <div id="technical-details-section" class="hidden">
                            <h4 class="text-md font-bold text-gray-900 mb-3 flex items-center gap-2">
                                <i class="fas fa-code text-gray-600"></i>
                                Technical Details
                            </h4>
                            <pre id="technical-details-pre" class="bg-gray-100 border border-gray-300 rounded-lg p-4 text-xs overflow-x-auto"></pre>
                        </div>

                        <!-- Formatted Report (for copy-paste) -->
                        <div>
                            <h4 class="text-md font-bold text-gray-900 mb-3 flex items-center gap-2">
                                <i class="fas fa-clipboard text-green-600"></i>
                                Copy-Paste Report
                            </h4>
                            <div class="relative">
                                <pre id="formatted-report-pre" class="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-x-auto max-h-96 font-mono"></pre>
                                <button onclick="window.healthReportModal.copyReport()" class="absolute top-2 right-2 px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors">
                                    <i class="fas fa-copy mr-1"></i> Copy Report
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="bg-gray-50 px-6 py-4 flex items-center justify-between border-t">
                    <span id="report-id" class="text-xs text-gray-500"></span>
                    <button onclick="window.healthReportModal.close()" class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors">
                        Close
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);

        // Close on overlay click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.close();
            }
        });
    }

    // ========================================================================
    // 🔓 OPEN MODAL
    // ========================================================================

    async open(logId) {
        console.log(`📖 [HEALTH REPORT MODAL] Opening report for log: ${logId}`);

        // Show modal
        this.modal.classList.remove('hidden');

        // Show loading state
        document.getElementById('report-loading').classList.remove('hidden');
        document.getElementById('report-content').classList.add('hidden');

        try {
            // Fetch log details
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/ai-gateway/health/log/${logId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load report');
            }

            this.currentLog = data.log;
            this.renderReport(data.log);

            console.log('✅ [HEALTH REPORT MODAL] Report loaded and rendered');

        } catch (error) {
            console.error('❌ [HEALTH REPORT MODAL] Failed to load report:', error.message);
            window.toastManager?.error(`Failed to load report: ${error.message}`);
            this.close();
        }
    }

    // ========================================================================
    // 🎨 RENDER REPORT
    // ========================================================================

    renderReport(log) {
        console.log('🎨 [HEALTH REPORT MODAL] Rendering report...');

        // Hide loading, show content
        document.getElementById('report-loading').classList.add('hidden');
        document.getElementById('report-content').classList.remove('hidden');

        // Header timestamp
        const timestamp = new Date(log.timestamp).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        document.getElementById('report-timestamp').textContent = timestamp;

        // Overall status banner
        this.renderStatusBanner(log);

        // System status grid
        this.renderSystemStatus(log);

        // Root cause analysis
        if (log.rootCauseAnalysis && log.rootCauseAnalysis !== 'All systems operational') {
            document.getElementById('root-cause-section').classList.remove('hidden');
            document.getElementById('root-cause-text').textContent = log.rootCauseAnalysis;
        } else {
            document.getElementById('root-cause-section').classList.add('hidden');
        }

        // Suggested fixes
        if (log.suggestedFixes && log.suggestedFixes.length > 0) {
            document.getElementById('suggested-fixes-section').classList.remove('hidden');
            const fixesList = document.getElementById('suggested-fixes-list');
            fixesList.innerHTML = log.suggestedFixes.map((fix, index) => `
                <li class="flex items-start gap-2">
                    <span class="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">${index + 1}</span>
                    <span class="text-gray-800">${fix}</span>
                </li>
            `).join('');
        } else {
            document.getElementById('suggested-fixes-section').classList.add('hidden');
        }

        // Technical details
        if (log.diagnosticDetails && Object.keys(log.diagnosticDetails).length > 0) {
            document.getElementById('technical-details-section').classList.remove('hidden');
            document.getElementById('technical-details-pre').textContent = JSON.stringify(log.diagnosticDetails, null, 2);
        } else {
            document.getElementById('technical-details-section').classList.add('hidden');
        }

        // Formatted report
        document.getElementById('formatted-report-pre').textContent = log.reportFormatted || 'No formatted report available';

        // Footer
        document.getElementById('report-id').textContent = `Report ID: ${log._id}`;
    }

    // ========================================================================
    // 🎨 RENDER STATUS BANNER
    // ========================================================================

    renderStatusBanner(log) {
        const statusIcon = document.getElementById('status-icon');
        const statusTitle = document.getElementById('status-title');
        const statusSubtitle = document.getElementById('status-subtitle');
        const severityBadge = document.getElementById('severity-badge');
        const banner = document.getElementById('overall-status-banner');

        // Determine icon, colors, text based on status
        if (log.overallStatus === 'ALL_HEALTHY') {
            banner.className = 'p-4 rounded-lg border-2 bg-green-50 border-green-300';
            statusIcon.textContent = '✅';
            statusTitle.textContent = 'All Systems Healthy';
            statusTitle.className = 'text-lg font-bold text-green-800';
            statusSubtitle.textContent = 'All services are operating normally';
            statusSubtitle.className = 'text-sm text-green-600';
        } else if (log.overallStatus === 'DEGRADED') {
            banner.className = 'p-4 rounded-lg border-2 bg-yellow-50 border-yellow-300';
            statusIcon.textContent = '⚠️';
            statusTitle.textContent = 'Degraded Performance';
            statusTitle.className = 'text-lg font-bold text-yellow-800';
            statusSubtitle.textContent = `${log.unhealthyCount} service(s) experiencing issues`;
            statusSubtitle.className = 'text-sm text-yellow-600';
        } else if (log.overallStatus === 'CRITICAL') {
            banner.className = 'p-4 rounded-lg border-2 bg-red-50 border-red-300';
            statusIcon.textContent = '❌';
            statusTitle.textContent = 'Critical System Failure';
            statusTitle.className = 'text-lg font-bold text-red-800';
            statusSubtitle.textContent = `${log.unhealthyCount} service(s) down`;
            statusSubtitle.className = 'text-sm text-red-600';
        }

        // Severity badge
        const severityColors = {
            'INFO': 'bg-blue-100 text-blue-800',
            'WARNING': 'bg-yellow-100 text-yellow-800',
            'ERROR': 'bg-orange-100 text-orange-800',
            'CRITICAL': 'bg-red-100 text-red-800'
        };
        severityBadge.textContent = log.severity || 'INFO';
        severityBadge.className = `px-3 py-1 rounded-full text-sm font-medium ${severityColors[log.severity] || severityColors.INFO}`;
    }

    // ========================================================================
    // 🎨 RENDER SYSTEM STATUS
    // ========================================================================

    renderSystemStatus(log) {
        const grid = document.getElementById('system-status-grid');
        
        const systems = [
            {
                name: 'OpenAI',
                icon: 'fa-robot',
                color: 'purple',
                data: log.openai
            },
            {
                name: 'MongoDB',
                icon: 'fa-database',
                color: 'green',
                data: log.mongodb
            },
            {
                name: 'Redis',
                icon: 'fa-server',
                color: 'red',
                data: log.redis
            },
            {
                name: '3-Tier System',
                icon: 'fa-layer-group',
                color: 'yellow',
                data: log.tier3System
            }
        ];

        grid.innerHTML = systems.map(system => {
            const isHealthy = system.data.status === 'HEALTHY' || system.data.status === 'ENABLED';
            const statusColor = isHealthy ? 'text-green-600' : 'text-red-600';
            const bgColor = isHealthy ? 'bg-green-50' : 'bg-red-50';
            const borderColor = isHealthy ? 'border-green-200' : 'border-red-200';

            return `
                <div class="${bgColor} ${borderColor} border rounded-lg p-4">
                    <div class="flex items-center gap-2 mb-2">
                        <i class="fas ${system.icon} ${statusColor}"></i>
                        <h5 class="font-bold text-gray-900">${system.name}</h5>
                    </div>
                    <p class="${statusColor} font-medium mb-1">${system.data.status}</p>
                    ${system.data.responseTime ? `<p class="text-xs text-gray-600">Response: ${system.data.responseTime}ms</p>` : ''}
                    ${system.data.error ? `<p class="text-xs text-red-600 mt-2">Error: ${system.data.error}</p>` : ''}
                    ${system.data.details && system.data.details.model ? `<p class="text-xs text-gray-600">Model: ${system.data.details.model}</p>` : ''}
                </div>
            `;
        }).join('');
    }

    // ========================================================================
    // 📋 COPY REPORT TO CLIPBOARD
    // ========================================================================

    async copyReport() {
        console.log('📋 [HEALTH REPORT MODAL] Copying report to clipboard...');

        try {
            const reportText = this.currentLog.reportFormatted || document.getElementById('formatted-report-pre').textContent;

            await navigator.clipboard.writeText(reportText);

            window.toastManager?.success('✅ Report copied to clipboard!');
            console.log('✅ [HEALTH REPORT MODAL] Report copied successfully');

        } catch (error) {
            console.error('❌ [HEALTH REPORT MODAL] Failed to copy report:', error.message);
            window.toastManager?.error(`Failed to copy: ${error.message}`);
        }
    }

    // ========================================================================
    // 🔒 CLOSE MODAL
    // ========================================================================

    close() {
        console.log('🔒 [HEALTH REPORT MODAL] Closing modal');
        this.modal.classList.add('hidden');
        this.currentLog = null;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 🌐 GLOBAL INITIALIZATION (with DOM ready check)
// ────────────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    // DOM is still loading, wait for it
    document.addEventListener('DOMContentLoaded', () => {
        window.healthReportModal = new HealthReportModal();
        console.log('✅ [HEALTH REPORT MODAL] Global instance created (after DOM ready)');
    });
} else {
    // DOM is already ready, initialize immediately
    window.healthReportModal = new HealthReportModal();
    console.log('✅ [HEALTH REPORT MODAL] Global instance created (DOM already ready)');
}

