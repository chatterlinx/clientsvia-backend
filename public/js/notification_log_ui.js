/**
 * AI Agent Logic - Notification Log Viewer UI
 * Spartan Coder - Bulletproof Gold Standard Implementation
 * STRICTLY CONFINED TO AI AGENT LOGIC TAB
 */

/**
 * Cleanup notification log viewer - Called when leaving AI Agent Logic tab
 */
function cleanupNotificationLogViewer() {
    try {
        console.log('🧹 [NOTIFICATION-LOG] Cleaning up log viewer...');
        
        // Clear refresh interval
        if (notificationLogState.refreshInterval) {
            clearInterval(notificationLogState.refreshInterval);
            notificationLogState.refreshInterval = null;
        }
        
        // Clear any pending timeouts
        if (window.notificationLogSearchTimeout) {
            clearTimeout(window.notificationLogSearchTimeout);
            window.notificationLogSearchTimeout = null;
        }
        
        // Reset state
        notificationLogState.initialized = false;
        notificationLogState.isRefreshing = false;
        notificationLogState.currentLogs = [];
        
        console.log('✅ [NOTIFICATION-LOG] Cleanup complete');
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Cleanup failed:', error);
    }
}

// Notification Log Viewer State - Isolated to AI Agent Logic tab
const notificationLogState = {
    initialized: false,
    currentLogs: [],
    filters: {
        type: 'all',
        status: 'all',
        timeframe: '24h'
    },
    pagination: {
        limit: 20,
        offset: 0,
        total: 0,
        hasMore: false
    },
    refreshInterval: null,
    isRefreshing: false
};

/**
 * Initialize Notification Log Viewer - Called from AI Agent Logic tab
 */
async function initializeNotificationLogViewer() {
    try {
        console.log('📊 [NOTIFICATION-LOG] Initializing log viewer...');
        
        // Prevent double initialization
        if (notificationLogState.initialized) {
            console.log('⚠️ [NOTIFICATION-LOG] Already initialized, skipping...');
            return;
        }
        
        // Check if we're in AI Agent Logic context
        if (!isAIAgentLogicTabActive()) {
            console.warn('[NOTIFICATION-LOG] Not in AI Agent Logic context - skipping initialization');
            return;
        }
        
        // Initialize UI components
        setupNotificationLogFilters();
        setupNotificationLogPagination();
        
        // Load initial data
        await refreshNotificationLogs();
        
        // Setup auto-refresh (every 30 seconds)
        notificationLogState.refreshInterval = setInterval(() => {
            if (isAIAgentLogicTabActive() && !notificationLogState.isRefreshing) {
                refreshNotificationLogs();
            }
        }, 30000);
        
        notificationLogState.initialized = true;
        console.log('✅ [NOTIFICATION-LOG] Initialization complete');
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Initialization failed:', error);
        showErrorMessage('Failed to initialize notification log viewer: ' + error.message);
    }
}

/**
 * Cleanup when leaving AI Agent Logic tab
 */
function cleanupNotificationLogViewer() {
    try {
        console.log('🧹 [NOTIFICATION-LOG] Cleaning up log viewer...');
        
        // Clear refresh interval
        if (notificationLogState.refreshInterval) {
            clearInterval(notificationLogState.refreshInterval);
            notificationLogState.refreshInterval = null;
        }
        
        // Reset state
        notificationLogState.initialized = false;
        notificationLogState.currentLogs = [];
        notificationLogState.isRefreshing = false;
        
        console.log('✅ [NOTIFICATION-LOG] Cleanup complete');
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Cleanup failed:', error);
    }
}

/**
 * Setup notification log filters
 */
function setupNotificationLogFilters() {
    try {
        // Type filter
        const typeFilter = document.getElementById('log-type-filter');
        if (typeFilter) {
            typeFilter.addEventListener('change', (e) => {
                notificationLogState.filters.type = e.target.value;
                notificationLogState.pagination.offset = 0; // Reset pagination
                refreshNotificationLogs();
            });
        }
        
        // Status filter
        const statusFilter = document.getElementById('log-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                notificationLogState.filters.status = e.target.value;
                notificationLogState.pagination.offset = 0; // Reset pagination
                refreshNotificationLogs();
            });
        }
        
        // Timeframe filter
        const timeframeFilter = document.getElementById('log-timeframe-filter');
        if (timeframeFilter) {
            timeframeFilter.addEventListener('change', (e) => {
                notificationLogState.filters.timeframe = e.target.value;
                notificationLogState.pagination.offset = 0; // Reset pagination
                refreshNotificationLogs();
            });
        }
        
        // Search functionality with improved timeout handling
        const searchInput = document.getElementById('log-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                // Clear existing timeout
                if (window.notificationLogSearchTimeout) {
                    clearTimeout(window.notificationLogSearchTimeout);
                }
                
                // Set new timeout with global reference for cleanup
                window.notificationLogSearchTimeout = setTimeout(() => {
                    notificationLogState.filters.search = e.target.value.trim();
                    notificationLogState.pagination.offset = 0; // Reset pagination
                    refreshNotificationLogs();
                }, 500); // Debounce search
            });
        }
        
        console.log('✅ [NOTIFICATION-LOG] Filters setup complete');
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Filter setup failed:', error);
    }
}

/**
 * Setup notification log pagination
 */
function setupNotificationLogPagination() {
    try {
        // Previous page button
        const prevButton = document.getElementById('log-prev-page');
        if (prevButton) {
            prevButton.addEventListener('click', () => {
                if (notificationLogState.pagination.offset > 0) {
                    notificationLogState.pagination.offset -= notificationLogState.pagination.limit;
                    refreshNotificationLogs();
                }
            });
        }
        
        // Next page button
        const nextButton = document.getElementById('log-next-page');
        if (nextButton) {
            nextButton.addEventListener('click', () => {
                if (notificationLogState.pagination.hasMore) {
                    notificationLogState.pagination.offset += notificationLogState.pagination.limit;
                    refreshNotificationLogs();
                }
            });
        }
        
        // Refresh button
        const refreshButton = document.getElementById('log-refresh-btn');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                refreshNotificationLogs();
            });
        }
        
        console.log('✅ [NOTIFICATION-LOG] Pagination setup complete');
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Pagination setup failed:', error);
    }
}

/**
 * Refresh notification logs from server
 */
async function refreshNotificationLogs() {
    try {
        if (notificationLogState.isRefreshing) {
            console.log('⚠️ [NOTIFICATION-LOG] Already refreshing, skipping...');
            return;
        }
        
        notificationLogState.isRefreshing = true;
        
        // Show loading state
        const loadingElement = document.getElementById('log-loading');
        const tableBody = document.getElementById('notification-log-tbody');
        
        if (loadingElement) loadingElement.style.display = 'block';
        if (tableBody) tableBody.style.opacity = '0.5';
        
        // Build query parameters
        const params = new URLSearchParams({
            limit: notificationLogState.pagination.limit,
            offset: notificationLogState.pagination.offset,
            companyId: getCurrentCompanyIdSafe() || ''
        });
        
        // Add filters
        if (notificationLogState.filters.type !== 'all') {
            params.append('type', notificationLogState.filters.type);
        }
        if (notificationLogState.filters.status !== 'all') {
            params.append('status', notificationLogState.filters.status);
        }
        if (notificationLogState.filters.search) {
            params.append('search', notificationLogState.filters.search);
        }
        
        // Fetch logs
        const response = await fetch(`/api/event-hooks/logs/${notificationLogState.filters.timeframe}?${params}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            notificationLogState.currentLogs = data.data.logs;
            notificationLogState.pagination.total = data.data.pagination.total;
            notificationLogState.pagination.hasMore = data.data.pagination.hasMore;
            
            // Update UI
            renderNotificationLogs();
            updatePaginationControls();
            
            console.log(`✅ [NOTIFICATION-LOG] Loaded ${data.data.logs.length} logs`);
        } else {
            throw new Error(data.error || 'Failed to fetch logs');
        }
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Refresh failed:', error);
        showErrorMessage('Failed to refresh notification logs: ' + error.message);
        
        // Show empty state on error
        if (document.getElementById('notification-log-tbody')) {
            document.getElementById('notification-log-tbody').innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-4 text-center text-red-600">
                        <i class="fas fa-exclamation-triangle mr-2"></i>
                        Error loading logs: ${error.message}
                    </td>
                </tr>
            `;
        }
        
    } finally {
        notificationLogState.isRefreshing = false;
        
        // Hide loading state
        const loadingElement = document.getElementById('log-loading');
        const tableBody = document.getElementById('notification-log-tbody');
        
        if (loadingElement) loadingElement.style.display = 'none';
        if (tableBody) tableBody.style.opacity = '1';
    }
}

/**
 * Render notification logs in the table
 */
function renderNotificationLogs() {
    try {
        const tbody = document.getElementById('notification-log-tbody');
        if (!tbody) {
            console.warn('[NOTIFICATION-LOG] Log table body not found');
            return;
        }
        
        if (notificationLogState.currentLogs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-4 text-center text-gray-500">
                        <i class="fas fa-inbox mr-2"></i>
                        No notification logs found for the selected filters.
                    </td>
                </tr>
            `;
            return;
        }
        
        const rows = notificationLogState.currentLogs.map(log => {
            const statusClass = getStatusClass(log.status);
            const typeIcon = getTypeIcon(log.type);
            const formattedTime = new Date(log.timestamp).toLocaleString();
            
            return `
                <tr class="hover:bg-gray-50 transition-colors cursor-pointer" onclick="showLogDetails('${log.id}')">
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${formattedTime}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getTypeClass(log.type)}">
                            <i class="${typeIcon} mr-1"></i>
                            ${log.type}
                        </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 max-w-xs truncate">
                        ${escapeHtml(log.recipient)}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                        ${escapeHtml(log.subject || log.message || 'No subject')}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass}">
                            ${log.status}
                        </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${log.processingTime}ms
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${escapeHtml(log.source)}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button onclick="event.stopPropagation(); showLogDetails('${log.id}')" class="text-indigo-600 hover:text-indigo-900">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        tbody.innerHTML = rows;
        
        console.log(`✅ [NOTIFICATION-LOG] Rendered ${notificationLogState.currentLogs.length} log entries`);
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Render failed:', error);
    }
}

/**
 * Update pagination controls
 */
function updatePaginationControls() {
    try {
        const prevButton = document.getElementById('log-prev-page');
        const nextButton = document.getElementById('log-next-page');
        const pageInfo = document.getElementById('log-page-info');
        
        if (prevButton) {
            prevButton.disabled = notificationLogState.pagination.offset === 0;
            prevButton.className = `px-3 py-2 ml-3 text-sm leading-4 text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 ${
                prevButton.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:text-gray-700'
            }`;
        }
        
        if (nextButton) {
            nextButton.disabled = !notificationLogState.pagination.hasMore;
            nextButton.className = `px-3 py-2 ml-3 text-sm leading-4 text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 ${
                nextButton.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:text-gray-700'
            }`;
        }
        
        if (pageInfo) {
            const start = notificationLogState.pagination.offset + 1;
            const end = Math.min(
                notificationLogState.pagination.offset + notificationLogState.pagination.limit,
                notificationLogState.pagination.total
            );
            
            pageInfo.textContent = `Showing ${start}-${end} of ${notificationLogState.pagination.total} entries`;
        }
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Pagination update failed:', error);
    }
}

/**
 * Show detailed log information in modal
 */
function showLogDetails(logId) {
    try {
        const log = notificationLogState.currentLogs.find(l => l.id === logId);
        if (!log) {
            console.warn('[NOTIFICATION-LOG] Log not found:', logId);
            return;
        }
        
        // Create modal content
        const modalContent = `
            <div id="log-detail-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
                <div class="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white">
                    <div class="mt-3">
                        <div class="flex items-center justify-between mb-4">
                            <h3 class="text-lg font-medium text-gray-900">
                                <i class="fas fa-envelope mr-2"></i>Notification Log Details
                            </h3>
                            <button onclick="closeLogDetails()" class="text-gray-400 hover:text-gray-600">
                                <i class="fas fa-times text-xl"></i>
                            </button>
                        </div>
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Timestamp</label>
                                <p class="mt-1 text-sm text-gray-900">${new Date(log.timestamp).toLocaleString()}</p>
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Type</label>
                                <p class="mt-1">
                                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getTypeClass(log.type)}">
                                        <i class="${getTypeIcon(log.type)} mr-1"></i>
                                        ${log.type}
                                    </span>
                                </p>
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Status</label>
                                <p class="mt-1">
                                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusClass(log.status)}">
                                        ${log.status}
                                    </span>
                                </p>
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Processing Time</label>
                                <p class="mt-1 text-sm text-gray-900">${log.processingTime}ms</p>
                            </div>
                            
                            <div class="md:col-span-2">
                                <label class="block text-sm font-medium text-gray-700">Recipient</label>
                                <p class="mt-1 text-sm text-gray-900">${escapeHtml(log.recipient)}</p>
                            </div>
                            
                            ${log.subject ? `
                                <div class="md:col-span-2">
                                    <label class="block text-sm font-medium text-gray-700">Subject</label>
                                    <p class="mt-1 text-sm text-gray-900">${escapeHtml(log.subject)}</p>
                                </div>
                            ` : ''}
                            
                            <div class="md:col-span-2">
                                <label class="block text-sm font-medium text-gray-700">Message</label>
                                <div class="mt-1 p-3 bg-gray-50 rounded-md">
                                    <p class="text-sm text-gray-900 whitespace-pre-wrap">${escapeHtml(log.message)}</p>
                                </div>
                            </div>
                            
                            ${log.errorMessage ? `
                                <div class="md:col-span-2">
                                    <label class="block text-sm font-medium text-red-700">Error Message</label>
                                    <div class="mt-1 p-3 bg-red-50 border border-red-200 rounded-md">
                                        <p class="text-sm text-red-800">${escapeHtml(log.errorMessage)}</p>
                                    </div>
                                </div>
                            ` : ''}
                            
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Source</label>
                                <p class="mt-1 text-sm text-gray-900">${escapeHtml(log.source)}</p>
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Event Type</label>
                                <p class="mt-1 text-sm text-gray-900">${escapeHtml(log.eventType)}</p>
                            </div>
                        </div>
                        
                        <div class="mt-6 flex justify-end">
                            <button onclick="closeLogDetails()" class="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalContent);
        
        // Prevent body scroll
        document.body.style.overflow = 'hidden';
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Show details failed:', error);
        showErrorMessage('Failed to show log details: ' + error.message);
    }
}

/**
 * Close log details modal
 */
function closeLogDetails() {
    try {
        const modal = document.getElementById('log-detail-modal');
        if (modal) {
            modal.remove();
        }
        
        // Restore body scroll
        document.body.style.overflow = '';
        
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Close details failed:', error);
    }
}

/**
 * Generate sample notification data for testing
 */
async function generateSampleNotificationData() {
    try {
        console.log('🎲 [NOTIFICATION-LOG] Generating sample data...');
        
        const response = await fetch('/api/event-hooks/test/generate-sample-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ [NOTIFICATION-LOG] Sample data generated:', data.data);
            // Refresh the logs to show new data
            await refreshNotificationLogs();
            
            // Show success message
            showNotificationMessage(`Generated ${data.data.length} sample notification logs`, 'success');
        } else {
            throw new Error(data.error || 'Failed to generate sample data');
        }
    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] Sample data generation failed:', error);
        showNotificationMessage('Failed to generate sample data: ' + error.message, 'error');
    }
}

/**
 * Export notification logs to CSV with current filters
 */
async function exportNotificationLogs() {
    try {
        console.log('📊 [NOTIFICATION-LOG] Starting CSV export...');
        
        // Get current filter values
        const typeFilter = document.getElementById('notification-type-filter');
        const statusFilter = document.getElementById('notification-status-filter');
        const timeframeFilter = document.getElementById('notification-timeframe-filter');
        
        const exportParams = new URLSearchParams({
            range: timeframeFilter?.value || '24h',
            type: typeFilter?.value || 'all',
            status: statusFilter?.value || 'all'
        });

        // Add company isolation if available
        const companyId = getCompanyId();
        if (companyId) {
            exportParams.append('companyId', companyId);
        }

        console.log('📊 [NOTIFICATION-LOG] Export parameters:', Object.fromEntries(exportParams));

        // Build download URL
        const downloadUrl = `/api/notifications/logs/export?${exportParams.toString()}`;
        
        // Show loading state
        const exportButton = document.querySelector('button[onclick="exportNotificationLogs()"]');
        const originalText = exportButton?.innerHTML;
        if (exportButton) {
            exportButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Exporting...';
            exportButton.disabled = true;
        }

        // Trigger download
        try {
            const response = await fetch(downloadUrl);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
            }

            // Get the CSV content
            const csvContent = await response.text();
            
            // Extract filename from Content-Disposition header
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'notification_logs.csv';
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="(.+)"/);
                if (filenameMatch) {
                    filename = filenameMatch[1];
                }
            }

            // Create and trigger download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            console.log(`✅ [NOTIFICATION-LOG] CSV export completed: ${filename}`);
            showNotificationMessage(`Successfully exported notification logs to ${filename}`, 'success');

        } catch (fetchError) {
            console.error('❌ [NOTIFICATION-LOG] Export download failed:', fetchError);
            showNotificationMessage('Failed to download export: ' + fetchError.message, 'error');
        }

    } catch (error) {
        console.error('❌ [NOTIFICATION-LOG] CSV export failed:', error);
        showNotificationMessage('Failed to export notification logs: ' + error.message, 'error');
    } finally {
        // Restore button state
        const exportButton = document.querySelector('button[onclick="exportNotificationLogs()"]');
        if (exportButton) {
            exportButton.innerHTML = '<i class="fas fa-download mr-1"></i>Export CSV';
            exportButton.disabled = false;
        }
    }
}

/**
 * Show notification message to user
 */
function showNotificationMessage(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    // Could implement toast notifications here
    // For now, we'll just log to console
}

// Helper functions for UI styling and formatting
function getStatusClass(status) {
    const classes = {
        'sent': 'bg-green-100 text-green-800',
        'completed': 'bg-green-100 text-green-800',
        'failed': 'bg-red-100 text-red-800',
        'pending': 'bg-yellow-100 text-yellow-800',
        'retrying': 'bg-blue-100 text-blue-800'
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
}

function getTypeClass(type) {
    const classes = {
        'sms': 'bg-blue-100 text-blue-800',
        'email': 'bg-purple-100 text-purple-800',
        'event_hook': 'bg-indigo-100 text-indigo-800',
        'voice': 'bg-orange-100 text-orange-800',
        'webhook': 'bg-teal-100 text-teal-800'
    };
    return classes[type] || 'bg-gray-100 text-gray-800';
}

function getTypeIcon(type) {
    const icons = {
        'sms': 'fas fa-sms',
        'email': 'fas fa-envelope',
        'event_hook': 'fas fa-bolt',
        'voice': 'fas fa-phone',
        'webhook': 'fas fa-webhook'
    };
    return icons[type] || 'fas fa-bell';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to check if AI Agent Logic tab is active
function isAIAgentLogicTabActive() {
    try {
        const activeTab = document.querySelector('.tab-btn.active');
        return activeTab && activeTab.textContent.includes('AI Agent Logic');
    } catch (error) {
        return false;
    }
}

// Helper function to get company ID safely
function getCurrentCompanyIdSafe() {
    try {
        // Try multiple methods to get company ID
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('id') || 
               window.currentCompanyId || 
               localStorage.getItem('currentCompanyId') ||
               '686a680241806a4991f7367f'; // Default fallback
    } catch (error) {
        console.warn('[NOTIFICATION-LOG] Failed to get company ID:', error);
        return '686a680241806a4991f7367f'; // Default fallback
    }
}

/**
 * Load previous page of notification logs
 */
function loadPreviousNotificationPage() {
    if (notificationLogState.pagination.offset > 0) {
        notificationLogState.pagination.offset = Math.max(0, 
            notificationLogState.pagination.offset - notificationLogState.pagination.limit);
        refreshNotificationLogs();
    }
}

/**
 * Load next page of notification logs
 */
function loadNextNotificationPage() {
    if (notificationLogState.pagination.hasMore) {
        notificationLogState.pagination.offset += notificationLogState.pagination.limit;
        refreshNotificationLogs();
    }
}

// Export functions for global access
window.initializeNotificationLogViewer = initializeNotificationLogViewer;
window.cleanupNotificationLogViewer = cleanupNotificationLogViewer;
window.refreshNotificationLogs = refreshNotificationLogs;
window.showLogDetails = showLogDetails;
window.closeLogDetails = closeLogDetails;
window.generateSampleNotificationData = generateSampleNotificationData;
window.exportNotificationLogs = exportNotificationLogs;

console.log('📊 [NOTIFICATION-LOG] UI module loaded successfully');
