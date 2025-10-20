// ============================================================================
// CALL ARCHIVES MANAGER
// ============================================================================
// 📋 PURPOSE: Admin interface for searching and viewing call transcripts
// 🎯 FEATURES:
//    - Advanced search with multiple filters
//    - Full transcript viewing
//    - Recording playback
//    - Bulk export (CSV/JSON)
//    - Pagination
// ============================================================================

class CallArchivesManager {
    constructor() {
        console.log(`📞 [CALL ARCHIVES] CHECKPOINT 1: Constructor called`);
        this.currentPage = 1;
        this.limit = 50;
        this.filters = {};
        this.companies = [];
        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 2: Initialized`);
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * INITIALIZE
     * ────────────────────────────────────────────────────────────────────────
     */
    async init() {
        try {
            console.log(`📞 [CALL ARCHIVES] CHECKPOINT 3: Initializing...`);

            // Check authentication
            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error(`❌ [CALL ARCHIVES] No auth token found`);
                window.location.href = '/login.html';
                return;
            }

            console.log(`✅ [CALL ARCHIVES] CHECKPOINT 4: Auth token present`);

            // Load companies for filter dropdown
            await this.loadCompanies();

            // Load statistics
            await this.loadStats();

            // Perform initial search
            await this.search();

            console.log(`✅ [CALL ARCHIVES] CHECKPOINT 5: Initialized successfully`);

        } catch (error) {
            console.error(`❌ [CALL ARCHIVES] ERROR initializing:`, error);
            this.showError('Failed to initialize Call Archives');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * LOAD COMPANIES (for filter dropdown)
     * ────────────────────────────────────────────────────────────────────────
     */
    async loadCompanies() {
        try {
            console.log(`📊 [CALL ARCHIVES] CHECKPOINT 6: Loading companies...`);
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/companies', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to load companies');

            const data = await response.json();
            this.companies = data.companies || [];

            // Populate dropdown
            const companySelect = document.getElementById('filter-company');
            this.companies.forEach(company => {
                const option = document.createElement('option');
                option.value = company._id;
                option.textContent = company.companyName;
                companySelect.appendChild(option);
            });

            console.log(`✅ [CALL ARCHIVES] CHECKPOINT 7: Loaded ${this.companies.length} companies`);

        } catch (error) {
            console.error(`❌ [CALL ARCHIVES] ERROR loading companies:`, error);
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * LOAD STATISTICS
     * ────────────────────────────────────────────────────────────────────────
     */
    async loadStats() {
        try {
            console.log(`📊 [CALL ARCHIVES] CHECKPOINT 8: Loading statistics...`);
            
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/call-archives/stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to load stats');

            const result = await response.json();
            const stats = result.data;

            console.log(`✅ [CALL ARCHIVES] CHECKPOINT 9: Stats loaded:`, stats);

            // Render stats cards
            this.renderStats(stats);

        } catch (error) {
            console.error(`❌ [CALL ARCHIVES] ERROR loading stats:`, error);
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER STATISTICS CARDS
     * ────────────────────────────────────────────────────────────────────────
     */
    renderStats(stats) {
        const container = document.getElementById('stats-container');
        
        container.innerHTML = `
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600">Total Calls</p>
                        <p class="text-3xl font-bold text-gray-900">${stats.totalCalls.toLocaleString()}</p>
                    </div>
                    <i class="fas fa-phone text-4xl text-blue-500"></i>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600">Companies</p>
                        <p class="text-3xl font-bold text-gray-900">${stats.companiesWithCalls}</p>
                    </div>
                    <i class="fas fa-building text-4xl text-green-500"></i>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600">Avg Confidence</p>
                        <p class="text-3xl font-bold text-gray-900">${(stats.avgConfidence * 100).toFixed(1)}%</p>
                    </div>
                    <i class="fas fa-chart-line text-4xl text-purple-500"></i>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600">Top Source</p>
                        <p class="text-xl font-bold text-gray-900">${this.getTopSource(stats.sourceDistribution)}</p>
                    </div>
                    <i class="fas fa-brain text-4xl text-orange-500"></i>
                </div>
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * HELPER: Get top source from distribution
     * ────────────────────────────────────────────────────────────────────────
     */
    getTopSource(distribution) {
        if (!distribution || distribution.length === 0) return 'N/A';
        return distribution[0].source || 'N/A';
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * SEARCH CALL ARCHIVES
     * ────────────────────────────────────────────────────────────────────────
     */
    async search(page = 1) {
        try {
            console.log(`🔍 [CALL ARCHIVES] CHECKPOINT 10: Starting search (page ${page})...`);

            // Show loading state
            this.showLoading();

            // Build query parameters
            const params = new URLSearchParams();
            
            // Pagination
            params.append('page', page);
            params.append('limit', this.limit);

            // Filters
            const query = document.getElementById('search-query').value;
            const companyId = document.getElementById('filter-company').value;
            const source = document.getElementById('filter-source').value;
            const sentiment = document.getElementById('filter-sentiment').value;
            const minConfidence = document.getElementById('filter-min-confidence').value;
            const startDate = document.getElementById('filter-start-date').value;
            const endDate = document.getElementById('filter-end-date').value;

            if (query) params.append('query', query);
            if (companyId) params.append('companyId', companyId);
            if (source) params.append('source', source);
            if (sentiment) params.append('sentiment', sentiment);
            if (minConfidence) params.append('minConfidence', minConfidence);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            console.log(`🔍 [CALL ARCHIVES] CHECKPOINT 11: Query params:`, params.toString());

            // Fetch results
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-archives/search?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Search failed');

            const result = await response.json();
            
            console.log(`✅ [CALL ARCHIVES] CHECKPOINT 12: Found ${result.data.calls.length} calls`);

            // Store current page
            this.currentPage = page;

            // Render results
            this.renderResults(result.data);

            // Hide loading state
            this.hideLoading();

        } catch (error) {
            console.error(`❌ [CALL ARCHIVES] ERROR in search:`, error);
            this.showError('Failed to search call archives');
            this.hideLoading();
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER SEARCH RESULTS
     * ────────────────────────────────────────────────────────────────────────
     */
    renderResults(data) {
        const container = document.getElementById('results-container');
        const countDiv = document.getElementById('results-count');
        const noResultsState = document.getElementById('no-results-state');

        // Update count
        countDiv.textContent = `${data.pagination.total.toLocaleString()} calls found`;

        // Check if empty
        if (data.calls.length === 0) {
            container.innerHTML = '';
            noResultsState.classList.remove('hidden');
            document.getElementById('pagination-container').innerHTML = '';
            return;
        }

        noResultsState.classList.add('hidden');

        // Build table
        let html = `
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">AI Source</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Confidence</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transcript</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
        `;

        data.calls.forEach(call => {
            const date = new Date(call.createdAt).toLocaleString();
            const confidenceColor = call.confidence >= 0.8 ? 'text-green-600' : call.confidence >= 0.5 ? 'text-yellow-600' : 'text-red-600';
            
            html += `
                <tr class="hover:bg-gray-50">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${call.companyName}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${call.customerPhone}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${date}</td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <span class="px-2 py-1 text-xs font-medium rounded-full ${this.getSourceColor(call.source)}">
                            ${call.source || 'N/A'}
                        </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm ${confidenceColor} font-semibold">${(call.confidence * 100).toFixed(0)}%</td>
                    <td class="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">${call.transcriptPreview || 'No transcript'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm">
                        <button onclick="callArchivesManager.viewCall('${call.id}')" class="text-blue-600 hover:text-blue-800 font-medium">
                            <i class="fas fa-eye"></i> View
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;

        // Render pagination
        this.renderPagination(data.pagination);
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * HELPER: Get source badge color
     * ────────────────────────────────────────────────────────────────────────
     */
    getSourceColor(source) {
        const colors = {
            'companyQnA': 'bg-blue-100 text-blue-800',
            'tradeQnA': 'bg-green-100 text-green-800',
            'templates': 'bg-purple-100 text-purple-800',
            'inHouseFallback': 'bg-gray-100 text-gray-800'
        };
        return colors[source] || 'bg-gray-100 text-gray-800';
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER PAGINATION
     * ────────────────────────────────────────────────────────────────────────
     */
    renderPagination(pagination) {
        const container = document.getElementById('pagination-container');
        
        let html = `
            <div class="flex items-center justify-between">
                <div class="text-sm text-gray-600">
                    Showing page ${pagination.page} of ${pagination.pages} (${pagination.total} total calls)
                </div>
                <div class="flex space-x-2">
        `;

        // Previous button
        if (pagination.hasPrev) {
            html += `
                <button onclick="callArchivesManager.search(${pagination.page - 1})" class="btn-secondary">
                    <i class="fas fa-chevron-left"></i> Previous
                </button>
            `;
        }

        // Next button
        if (pagination.hasNext) {
            html += `
                <button onclick="callArchivesManager.search(${pagination.page + 1})" class="btn-primary">
                    Next <i class="fas fa-chevron-right"></i>
                </button>
            `;
        }

        html += `
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * VIEW CALL DETAILS
     * ────────────────────────────────────────────────────────────────────────
     */
    async viewCall(callId) {
        try {
            console.log(`📞 [CALL ARCHIVES] CHECKPOINT 13: Viewing call: ${callId}`);

            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/call-archives/${callId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to load call details');

            const result = await response.json();
            const call = result.data;

            console.log(`✅ [CALL ARCHIVES] CHECKPOINT 14: Call details loaded`);

            // Render modal
            this.renderCallDetails(call);

            // Show modal
            document.getElementById('call-details-modal').classList.remove('hidden');

        } catch (error) {
            console.error(`❌ [CALL ARCHIVES] ERROR viewing call:`, error);
            this.showError('Failed to load call details');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER CALL DETAILS MODAL
     * ────────────────────────────────────────────────────────────────────────
     */
    renderCallDetails(call) {
        const container = document.getElementById('call-details-content');
        const date = new Date(call.createdAt).toLocaleString();
        
        let html = `
            <!-- Company Info -->
            <div class="bg-blue-50 rounded-lg p-4 mb-6">
                <h4 class="font-semibold text-blue-900 mb-2">
                    <i class="fas fa-building"></i> Company Information
                </h4>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>Name:</strong> ${call.companyName}</div>
                    <div><strong>Contact:</strong> ${call.companyContact || 'N/A'}</div>
                    <div><strong>Phone:</strong> ${call.companyPhone || 'N/A'}</div>
                    <div><strong>Email:</strong> ${call.companyEmail || 'N/A'}</div>
                </div>
            </div>

            <!-- Call Info -->
            <div class="bg-gray-50 rounded-lg p-4 mb-6">
                <h4 class="font-semibold text-gray-900 mb-2">
                    <i class="fas fa-phone"></i> Call Information
                </h4>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>Customer:</strong> ${call.customerPhone}</div>
                    <div><strong>Date:</strong> ${date}</div>
                    <div><strong>Duration:</strong> ${call.duration || 0}s</div>
                    <div><strong>Twilio SID:</strong> ${call.twilioCallSid}</div>
                </div>
            </div>

            <!-- AI Performance -->
            <div class="bg-purple-50 rounded-lg p-4 mb-6">
                <h4 class="font-semibold text-purple-900 mb-2">
                    <i class="fas fa-brain"></i> AI Performance
                </h4>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>Source:</strong> <span class="px-2 py-1 text-xs font-medium rounded-full ${this.getSourceColor(call.source)}">${call.source}</span></div>
                    <div><strong>Confidence:</strong> ${(call.confidence * 100).toFixed(1)}%</div>
                    <div><strong>Response Time:</strong> ${call.responseTime || 0}ms</div>
                    <div><strong>Template:</strong> ${call.matchedTemplate || 'N/A'}</div>
                </div>
            </div>

            <!-- Transcript -->
            <div class="mb-6">
                <h4 class="font-semibold text-gray-900 mb-2">
                    <i class="fas fa-file-alt"></i> Full Transcript
                </h4>
                <div class="bg-white border border-gray-300 rounded-lg p-4 max-h-96 overflow-y-auto">
                    ${call.conversation.fullTranscript.plainText || 'No transcript available'}
                </div>
            </div>

            <!-- Recording -->
            ${call.conversation.recordingUrl ? `
                <div class="mb-6">
                    <h4 class="font-semibold text-gray-900 mb-2">
                        <i class="fas fa-microphone"></i> Recording
                    </h4>
                    <audio controls class="w-full">
                        <source src="${call.conversation.recordingUrl}" type="audio/mpeg">
                        Your browser does not support the audio element.
                    </audio>
                </div>
            ` : ''}

            <!-- Keywords & Topics -->
            ${call.searchMetadata.keywords.length > 0 ? `
                <div class="mb-6">
                    <h4 class="font-semibold text-gray-900 mb-2">
                        <i class="fas fa-tags"></i> Keywords & Topics
                    </h4>
                    <div class="flex flex-wrap gap-2">
                        ${call.searchMetadata.keywords.map(kw => `
                            <span class="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">${kw}</span>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        `;

        container.innerHTML = html;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * CLOSE MODAL
     * ────────────────────────────────────────────────────────────────────────
     */
    closeModal() {
        document.getElementById('call-details-modal').classList.add('hidden');
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * EXPORT CSV
     * ────────────────────────────────────────────────────────────────────────
     */
    async exportCSV() {
        await this.export('csv');
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * EXPORT JSON
     * ────────────────────────────────────────────────────────────────────────
     */
    async exportJSON() {
        await this.export('json');
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * EXPORT (generic)
     * ────────────────────────────────────────────────────────────────────────
     */
    async export(format) {
        try {
            console.log(`📤 [CALL ARCHIVES] CHECKPOINT 15: Exporting as ${format}...`);

            // Build filters
            const filters = {};
            const companyId = document.getElementById('filter-company').value;
            const source = document.getElementById('filter-source').value;
            const sentiment = document.getElementById('filter-sentiment').value;
            const startDate = document.getElementById('filter-start-date').value;
            const endDate = document.getElementById('filter-end-date').value;

            if (companyId) filters.companyId = companyId;
            if (source) filters.source = source;
            if (sentiment) filters.sentiment = sentiment;
            if (startDate) filters.startDate = startDate;
            if (endDate) filters.endDate = endDate;

            // Send request
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/call-archives/export', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ format, filters })
            });

            if (!response.ok) throw new Error('Export failed');

            // Download file
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `call-archives-${Date.now()}.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            console.log(`✅ [CALL ARCHIVES] CHECKPOINT 16: Export complete`);

        } catch (error) {
            console.error(`❌ [CALL ARCHIVES] ERROR exporting:`, error);
            this.showError('Failed to export call archives');
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * CLEAR FILTERS
     * ────────────────────────────────────────────────────────────────────────
     */
    clearFilters() {
        document.getElementById('search-query').value = '';
        document.getElementById('filter-company').value = '';
        document.getElementById('filter-source').value = '';
        document.getElementById('filter-sentiment').value = '';
        document.getElementById('filter-min-confidence').value = '';
        document.getElementById('filter-start-date').value = '';
        document.getElementById('filter-end-date').value = '';
        
        // Re-search
        this.search();
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * UI HELPERS
     * ────────────────────────────────────────────────────────────────────────
     */
    showLoading() {
        document.getElementById('loading-state').classList.remove('hidden');
        document.getElementById('results-container').classList.add('hidden');
        document.getElementById('no-results-state').classList.add('hidden');
    }

    hideLoading() {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('results-container').classList.remove('hidden');
    }

    showError(message) {
        alert(`❌ ${message}`);
    }
}

// Export to global scope
window.CallArchivesManager = CallArchivesManager;

