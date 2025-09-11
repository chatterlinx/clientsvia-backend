/**
 * ========================================= 
 * 🚀 PRODUCTION: ENTERPRISE COMPANY Q&A MANAGER
 * ✅ INTEGRATED: Full CRUD with real-time AI testing
 * 🛡️ SECURE: Multi-tenant with companyId isolation
 * ⚡ PERFORMANCE: Redis caching + Mongoose optimization
 * ========================================= 
 * 
 * This module handles the embedded Company Q&A Manager
 * integrated directly into AI Agent Logic Tab 2
 */

class EmbeddedQnAManager {
    constructor(apiBaseUrl) {
        // ✅ PRODUCTION FIX: Use current origin if no base URL provided
        this.apiBaseUrl = apiBaseUrl || window.location.origin || 'http://localhost:3000';
        this.companyId = window.companyId || this.extractCompanyIdFromURL();
        this.initialized = false;
        this.qnas = []; // Initialize qnas array for edit functionality
        this.currentStatusFilter = 'all'; // Track current status filter
        
        console.log('🚀 PRODUCTION: Embedded Q&A Manager initializing...');
        console.log('🌐 API Base URL:', this.apiBaseUrl);
        console.log('🏢 Company ID:', this.companyId);
    }

    /**
     * Extract company ID from current URL
     */
    extractCompanyIdFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const companyId = urlParams.get('id');
        console.log('🔍 Extracted company ID from URL:', companyId);
        return companyId;
    }

    /**
     * Initialize the embedded Q&A manager - Enhanced with validation
     */
    async initialize() {
        if (this.initialized) {
            console.log('🔄 Q&A Manager already initialized, refreshing data...');
            await this.loadCompanyQnAEntries();
            return;
        }
        
        try {
            console.log('🚀 Initializing Embedded Q&A Manager...');
            
            // Validate prerequisites
            if (!this.companyId) {
                throw new Error('Company ID is required for Q&A Manager initialization');
            }
            
            const authToken = this.getAuthToken();
            if (!authToken) {
                console.warn('⚠️ No auth token found - Q&A operations may fail');
                console.warn('🔍 Token search results:', {
                    adminToken: !!localStorage.getItem('adminToken'),
                    authToken: !!localStorage.getItem('authToken'),
                    sessionAuthToken: !!sessionStorage.getItem('authToken'),
                    token: !!localStorage.getItem('token'),
                    sessionToken: !!sessionStorage.getItem('token'),
                    cookieToken: !!this.getCookieValue('token'),
                    cookieAuthToken: !!this.getCookieValue('authToken')
                });
            } else {
                console.log('✅ Auth token found:', authToken.substring(0, 10) + '...');
            }
            
            await this.loadCompanyQnAEntries();
            this.setupEventListeners();
            this.initializeRealTimeFeatures();
            
            this.initialized = true;
            console.log('✅ Embedded Q&A Manager ready for company:', this.companyId);
            
        } catch (error) {
            console.error('❌ Failed to initialize Embedded Q&A Manager:', error);
            this.showErrorState('Initialization failed: ' + error.message);
        }
    }

    /**
     * Load Company Q&A entries with enterprise filtering
     */
    async loadCompanyQnAEntries() {
        try {
            console.log('📚 Loading Company Q&A entries...');
            console.log('🔑 Auth token available:', !!this.getAuthToken());
            console.log('🏢 Company ID:', this.companyId);
            
            // ✅ PRODUCTION FIX: Validate required elements exist
            const loadingEl = document.getElementById('qna-loading');
            const listEl = document.getElementById('qna-entries-list');
            const emptyEl = document.getElementById('qna-empty-state');
            
            if (!loadingEl || !listEl || !emptyEl) {
                console.warn('⚠️ Required Q&A DOM elements not found - tab may not be active yet');
                return;
            }
            
            // Show loading state
            if (loadingEl) loadingEl.classList.remove('hidden');
            if (listEl) listEl.classList.add('hidden');
            if (emptyEl) emptyEl.classList.add('hidden');

            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add authorization header if token is available
            const token = this.getAuthToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            // Use proper authenticated routes
            const filterStatus = this.currentStatusFilter || 'all';
            const response = await fetch(`${this.apiBaseUrl}/api/knowledge/company/${this.companyId}/qnas`, {
                method: 'GET',
                headers: headers,
                credentials: 'include' // Include cookies for additional auth
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ API Error Details:', {
                    status: response.status,
                    statusText: response.statusText,
                    url: response.url,
                    errorBody: errorText
                });
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            
            // Hide loading state
            if (loadingEl) loadingEl.classList.add('hidden');

            if (data.success && data.data && data.data.length > 0) {
                // Store Q&A entries for edit functionality
                this.qnas = data.data;
                console.log('✅ CHECKPOINT: Q&A entries stored for edit functionality:', this.qnas.length);
                
                // Enhanced debugging for display issue
                console.log('🔍 CHECKPOINT: About to render Q&A entries');
                console.log('🔍 CHECKPOINT: listEl exists:', !!listEl);
                console.log('🔍 CHECKPOINT: emptyEl exists:', !!emptyEl);
                
                // Store current Q&As for keyword regeneration functionality
                this.currentQnAs = data.data;
                
                this.renderQnAEntries(data.data);
                
                if (listEl) {
                    listEl.classList.remove('hidden');
                    console.log('✅ CHECKPOINT: Q&A list element shown (hidden class removed)');
            } else {
                    console.error('❌ CHECKPOINT: listEl is null - cannot show Q&A entries');
                }
                
                if (emptyEl) {
                    emptyEl.classList.add('hidden');
                    console.log('✅ CHECKPOINT: Empty state hidden');
                }
            } else {
                // Initialize empty array even when no data
                this.qnas = [];
                console.log('✅ CHECKPOINT: No Q&A entries - initialized empty array');
                
                if (listEl) {
                    listEl.classList.add('hidden');
                    console.log('✅ CHECKPOINT: Q&A list hidden (no entries)');
                }
                
                if (emptyEl) {
                    emptyEl.classList.remove('hidden');
                    console.log('✅ CHECKPOINT: Empty state shown');
                }
            }

            console.log(`✅ Loaded ${data.data?.length || 0} Company Q&A entries`);

        } catch (error) {
            console.error('❌ CRITICAL ERROR: Failed to load Company Q&A entries:', {
                errorMessage: error.message,
                errorStack: error.stack,
                companyId: this.companyId,
                apiBaseUrl: this.apiBaseUrl,
                timestamp: new Date().toISOString(),
                authTokenAvailable: !!this.getAuthToken(),
                authTokenSource: this.getAuthTokenSource(),
                requestUrl: `${this.apiBaseUrl}/api/knowledge/company/${this.companyId}/qnas`,
                fullError: error
            });
            
            // Show detailed error state
            this.showErrorState(`Q&A Load Failed: ${error.message}`);
            
            // NEVER mask errors - make them visible for debugging
            console.error('🔍 FULL ERROR DETAILS FOR DEBUGGING:', error);
        }
    }

    /**
     * Render Q&A entries with enterprise UI - Enhanced with status coordination
     */
    renderQnAEntries(qnas) {
        const renderId = Date.now();
        console.log(`🎨 CHECKPOINT: Starting to render Q&A entries (Render ID: ${renderId})`);
        console.log('🎨 CHECKPOINT: Number of entries to render:', qnas?.length || 0);
        console.log('🎨 CHECKPOINT: Current filter state:', this.currentStatusFilter);
        
        // Enhanced debugging for status coordination
        if (qnas && qnas.length > 0) {
            const statusCounts = {};
            qnas.forEach(qna => {
                statusCounts[qna.status] = (statusCounts[qna.status] || 0) + 1;
            });
            console.log('📊 CHECKPOINT: Q&A status distribution:', statusCounts);
        }
        
        const container = document.getElementById('qna-entries-list');
        if (!container) {
            console.error('❌ CHECKPOINT: qna-entries-list container not found');
            return;
        }
        
        console.log('✅ CHECKPOINT: Q&A container found, rendering entries');

        // Debug logging for category display
        qnas.forEach(qna => {
            console.log(`🎨 RENDER DEBUG: Q&A ${qna._id} - Category: "${qna.category}" - Question: "${qna.question.substring(0, 30)}"`);
        });
        
        container.innerHTML = qnas.map(qna => `
            <div class="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow duration-200" data-qna-id="${qna._id}">
                <div class="flex items-start justify-between mb-4">
                    <div class="flex-1">
                        <div class="flex items-center space-x-3 mb-2">
                            <span class="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                                ${qna.category || 'General'}
                            </span>
                            <span class="px-2 py-1 ${this.getStatusStyle(qna.status)} text-xs font-medium rounded-full">
                                <i class="fas fa-${this.getStatusIcon(qna.status)} mr-1"></i>
                                ${this.getStatusLabel(qna.status)}
                            </span>
                        </div>
                        <h4 class="text-lg font-semibold text-gray-900 mb-3">
                            <i class="fas fa-question-circle text-blue-500 mr-2"></i>
                            ${this.escapeHtml(qna.question)}
                        </h4>
                        <div class="bg-gray-50 rounded-lg p-4 mb-4">
                            <p class="text-gray-700">${this.escapeHtml(qna.answer)}</p>
                        </div>
                        
                        <!-- Keywords Display -->
                        ${qna.keywords && qna.keywords.length > 0 ? `
                            <div class="mb-4">
                                <div class="flex items-center mb-2">
                                    <i class="fas fa-tags text-orange-500 mr-2"></i>
                                    <span class="text-sm font-medium text-gray-700">Keywords (${qna.keywords.length})</span>
                                    <span class="ml-2 px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">
                                        AI Generated
                                    </span>
                                </div>
                                <div class="flex flex-wrap gap-1">
                                    ${qna.keywords.slice(0, 8).map(keyword => `
                                        <span class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800">
                                            ${this.escapeHtml(keyword)}
                                        </span>
                                    `).join('')}
                                    ${qna.keywords.length > 8 ? `
                                        <span class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                                            +${qna.keywords.length - 8} more
                                        </span>
                                    ` : ''}
                                </div>
                            </div>
                        ` : `
                            <div class="mb-4">
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center text-sm text-gray-500">
                                        <i class="fas fa-exclamation-triangle text-yellow-500 mr-2"></i>
                                        <span>No keywords generated - may affect AI agent matching</span>
                                    </div>
                                    <button onclick="embeddedQnAManager.regenerateKeywords('${qna._id}')" 
                                            class="text-xs bg-orange-600 hover:bg-orange-700 text-white font-medium py-1 px-2 rounded transition-colors duration-200">
                                        <i class="fas fa-magic mr-1"></i>Generate Keywords
                                    </button>
                                </div>
                            </div>
                        `}
                        
                        <div class="flex items-center text-xs text-gray-500 space-x-4">
                            <span><i class="fas fa-calendar mr-1"></i>Created: ${new Date(qna.createdAt).toLocaleDateString()}</span>
                            ${qna.analytics?.useCount ? `<span><i class="fas fa-chart-line mr-1"></i>Used: ${qna.analytics.useCount} times</span>` : ''}
                        </div>
                    </div>
                    
                    <div class="flex flex-col space-y-2 ml-4">
                        <button onclick="embeddedQnAManager.testWithAI('${qna._id}')" 
                                class="bg-green-600 hover:bg-green-700 text-white text-xs font-medium py-2 px-3 rounded-md transition-colors duration-200 flex items-center">
                            <i class="fas fa-vial mr-1"></i>Test AI
                        </button>
                        <button onclick="console.log('🔧 Edit button clicked for:', '${qna._id}'); if(window.embeddedQnAManager) { window.embeddedQnAManager.editEntry('${qna._id}'); } else { console.error('❌ embeddedQnAManager not available'); }" 
                                class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-2 px-3 rounded-md transition-colors duration-200 flex items-center">
                            <i class="fas fa-edit mr-1"></i>Edit
                        </button>
                        <button onclick="embeddedQnAManager.deleteEntry('${qna._id}')" 
                                class="bg-red-600 hover:bg-red-700 text-white text-xs font-medium py-2 px-3 rounded-md transition-colors duration-200 flex items-center">
                            <i class="fas fa-trash mr-1"></i>Delete
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
        
        console.log('✅ CHECKPOINT: Q&A entries HTML generated and inserted into container');
        console.log('🎨 CHECKPOINT: Container innerHTML length:', container.innerHTML.length);
        console.log('🎨 CHECKPOINT: Rendered entries for company:', this.companyId);
    }

    /**
     * Regenerate keywords for a Q&A entry
     */
    async regenerateKeywords(qnaId) {
        try {
            console.log('🔄 Regenerating keywords for Q&A:', qnaId);
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            const token = this.getAuthToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            // Find the Q&A entry
            const qna = this.currentQnAs.find(q => q._id === qnaId);
            if (!qna) {
                this.showNotification('❌ Q&A entry not found', 'error');
                return;
            }
            
            console.log('🔄 Updating Q&A to trigger keyword regeneration...');
            
            // Update the Q&A (this will trigger keyword regeneration middleware)
            const response = await fetch(`${this.apiBaseUrl}/api/knowledge/company/${this.companyId}/qnas/${qnaId}`, {
                method: 'PUT',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify({
                    question: qna.question,
                    answer: qna.answer,
                    category: qna.category,
                    status: qna.status,
                    forceKeywordRegeneration: true // Flag to force regeneration
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Keyword regeneration failed:', errorText);
                this.showNotification('❌ Failed to regenerate keywords', 'error');
                return;
            }
            
            const result = await response.json();
            console.log('✅ Keywords regenerated:', result);
            
            if (result.success) {
                this.showNotification('✅ Keywords regenerated successfully!', 'success');
                // Reload the entries to show updated keywords
                await this.loadCompanyQnAEntries();
            } else {
                this.showNotification('❌ Failed to regenerate keywords: ' + result.error, 'error');
            }
            
        } catch (error) {
            console.error('❌ Error regenerating keywords:', error);
            this.showNotification('❌ Error regenerating keywords: ' + error.message, 'error');
        }
    }

    /**
     * Test Q&A with live AI Agent
     */
    async testWithAI(qnaId) {
        try {
            console.log(`🧪 Testing Q&A ${qnaId} with AI Agent...`);
            
            const response = await fetch(`${this.apiBaseUrl}/api/ai-agent/company-knowledge/${this.companyId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    query: 'Test query for QnA',
                    testMode: true,
                    qnaId: qnaId
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.showNotification(`✅ AI Test: Confidence ${result.confidence || 'N/A'}`, 'success');
                console.log('✅ AI test completed');
            } else {
                throw new Error(result.error || 'Test failed');
            }

        } catch (error) {
            console.error('❌ AI test failed:', error);
            this.showNotification('❌ AI test failed: ' + error.message, 'error');
        }
    }

    /**
     * Update confidence threshold with real-time feedback
     */
    async updateThreshold(value) {
        try {
            console.log('🎯 Updating Company Q&A threshold to:', value);
            
            const displayEl = document.getElementById('company-qna-threshold-display');
            const valueEl = document.getElementById('clientsvia-threshold-value-companyQnA');
            const syncDisplayEl = document.getElementById('company-qna-sync-threshold-display');
            
            // Update all display elements
            const formattedValue = parseFloat(value).toFixed(2);
            if (displayEl) displayEl.textContent = formattedValue;
            if (valueEl) valueEl.textContent = formattedValue;
            if (syncDisplayEl) syncDisplayEl.textContent = formattedValue;

            // Save to backend
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add authorization header if token is available
            const token = this.getAuthToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const response = await fetch(`${this.apiBaseUrl}/api/ai-agent-logic/admin/${this.companyId}/ai-settings`, {
                method: 'PUT',
                headers: headers,
                credentials: 'include', // Include cookies for additional auth
                body: JSON.stringify({
                    thresholds: { companyKB: parseFloat(value) }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Threshold update failed:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorBody: errorText
                });
                this.showNotification('❌ Failed to update threshold: HTTP ' + response.status, 'error');
                return;
            }

            const result = await response.json();
            console.log('✅ Threshold update response:', result);
            console.log(`✅ Company Q&A threshold updated to ${formattedValue}`);
            
            // Visual feedback
            if (valueEl) {
                valueEl.classList.add('bg-green-100', 'text-green-800');
                setTimeout(() => {
                    valueEl.classList.remove('bg-green-100', 'text-green-800');
                }, 1000);
            }
            
            // Sync with main Knowledge Sources threshold slider
            const mainSlider = document.getElementById('clientsvia-threshold-companyQnA');
            if (mainSlider && mainSlider.value !== value) {
                mainSlider.value = value;
                console.log('🔄 Synced main threshold slider with Q&A manager update');
            }

        } catch (error) {
            console.error('❌ CRITICAL ERROR: Failed to update threshold:', {
                errorMessage: error.message,
                errorStack: error.stack,
                companyId: this.companyId,
                apiBaseUrl: this.apiBaseUrl,
                timestamp: new Date().toISOString(),
                authTokenAvailable: !!this.getAuthToken(),
                authTokenSource: this.getAuthTokenSource(),
                requestUrl: `${this.apiBaseUrl}/api/ai-agent-logic/admin/${this.companyId}/ai-settings`,
                thresholdValue: value,
                requestData: { thresholds: { companyKB: parseFloat(value) } },
                fullError: error
            });
            
            this.showNotification('❌ Threshold update failed: ' + error.message, 'error');
            
            // NEVER mask errors - make them visible for debugging
            console.error('🔍 FULL THRESHOLD ERROR DETAILS FOR DEBUGGING:', error);
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Confidence threshold slider
        const thresholdSlider = document.getElementById('clientsvia-threshold-companyQnA');
        if (thresholdSlider) {
            thresholdSlider.addEventListener('input', (e) => {
                this.updateThreshold(e.target.value);
            });
        }

        // Add new Q&A button
        const addBtn = document.getElementById('add-new-qna-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this.showAddModal();
            });
        }

        // Test priority flow button
        const testFlowBtn = document.getElementById('test-priority-flow-btn');
        if (testFlowBtn) {
            testFlowBtn.addEventListener('click', () => {
                this.testPriorityFlow();
            });
        }

        // 🔧 CRITICAL: Connect Status Filter dropdown to Q&A filtering
        console.log('🔍 CHECKPOINT: Looking for qna-status-filter element');
        const statusFilter = document.getElementById('qna-status-filter');
        console.log('🔍 CHECKPOINT: qna-status-filter found:', !!statusFilter);
        
        if (statusFilter) {
            console.log('🔍 CHECKPOINT: Status filter element exists, adding event listener');
            statusFilter.addEventListener('change', (e) => {
                const selectedStatus = e.target.value;
                console.log('🔍 CHECKPOINT: Status filter changed to:', selectedStatus);
                console.log('🔍 CHECKPOINT: Triggering filterQnAByStatus method');
                this.filterQnAByStatus(selectedStatus);
            });
            console.log('✅ CHECKPOINT: Status filter dropdown connected successfully');
        } else {
            console.error('❌ CHECKPOINT: qna-status-filter dropdown not found in DOM');
            console.log('🔍 CHECKPOINT: Available select elements:', 
                Array.from(document.querySelectorAll('select')).map(s => s.id).filter(id => id));
        }

        console.log('✅ Event listeners configured');
    }

    /**
     * Filter Q&A entries by status (coordinated with Status Filter dropdown)
     */
    async filterQnAByStatus(status) {
        try {
            console.log('🔍 CHECKPOINT: Filtering Q&A entries by status:', status);
            
            // Update current filter state
            this.currentStatusFilter = status || 'all';
            console.log('🔍 CHECKPOINT: Updated current filter state to:', this.currentStatusFilter);
            
            // Determine the API status parameter
            let apiStatus = status;
            if (status === '' || status === 'all') {
                apiStatus = 'all';  // Show all entries
            }
            
            console.log('🔍 CHECKPOINT: API status parameter:', apiStatus);
            
            // Reload Q&A entries with the selected status filter
            const headers = {
                'Content-Type': 'application/json'
            };
            
            const token = this.getAuthToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const url = `${this.apiBaseUrl}/api/knowledge/company/${this.companyId}/qnas?status=${apiStatus}&_cb=${Date.now()}`;
            console.log('🔍 CHECKPOINT: Filtering URL:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('✅ CHECKPOINT: Filtered Q&A data received:', data.data?.length || 0);
            
            if (data.success && data.data) {
                this.qnas = data.data;
                
                // Show status distribution for debugging
                const statusCounts = {};
                data.data.forEach(qna => {
                    statusCounts[qna.status] = (statusCounts[qna.status] || 0) + 1;
                });
                console.log('📊 CHECKPOINT: Filtered status distribution:', statusCounts);
                
                console.log('🔍 CHECKPOINT: About to render filtered entries');
                this.renderQnAEntries(data.data);
                console.log('🔍 CHECKPOINT: Finished rendering filtered entries');
                
                // Update UI visibility
                const listEl = document.getElementById('qna-entries-list');
                const emptyEl = document.getElementById('qna-empty-state');
                
                console.log('🔍 CHECKPOINT: Updating UI visibility for filtered results');
                console.log('🔍 CHECKPOINT: listEl exists:', !!listEl);
                console.log('🔍 CHECKPOINT: emptyEl exists:', !!emptyEl);
                
                if (data.data.length > 0) {
                    if (listEl) {
                        listEl.classList.remove('hidden');
                        console.log('✅ CHECKPOINT: Filtered Q&A list shown');
                    }
                    if (emptyEl) {
                        emptyEl.classList.add('hidden');
                        console.log('✅ CHECKPOINT: Empty state hidden for filtered results');
                    }
                } else {
                    if (listEl) {
                        listEl.classList.add('hidden');
                        console.log('⚠️ CHECKPOINT: Q&A list hidden - no filtered results');
                    }
                    if (emptyEl) {
                        emptyEl.classList.remove('hidden');
                        console.log('⚠️ CHECKPOINT: Empty state shown for filtered results');
                    }
                }
                
                console.log(`✅ CHECKPOINT: Status filter applied - showing ${data.data.length} entries with status: ${status || 'all'}`);
                console.log('🔍 CHECKPOINT: UI should now show only filtered entries');
            }
            
        } catch (error) {
            console.error('❌ CRITICAL: Status filtering failed:', error);
            this.showNotification('❌ Failed to filter by status', 'error');
        }
    }

    /**
     * Initialize real-time features
     */
    initializeRealTimeFeatures() {
        console.log('✅ Real-time features initialized');
    }

    /**
     * Show error state
     */
    showErrorState(message) {
        const loadingEl = document.getElementById('qna-loading');
        if (loadingEl) {
            loadingEl.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-exclamation-triangle text-2xl text-red-400 mb-3"></i>
                    <p class="text-red-600">Failed to load Q&A entries</p>
                    <p class="text-sm text-gray-500 mb-4">${message}</p>
                    <button onclick="embeddedQnAManager.loadCompanyQnAEntries()" 
                            class="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg">
                        <i class="fas fa-redo mr-2"></i>Retry
                    </button>
                </div>
            `;
            loadingEl.classList.remove('hidden');
        }
    }

    /**
     * Show notification - Enhanced with better user feedback
     */
    showNotification(message, type = 'info') {
        console.log(`${type.toUpperCase()}: ${message}`);
        
        // Try to use the global notification system if available
        if (typeof showNotification === 'function') {
            const title = type === 'error' ? 'Error' : type === 'success' ? 'Success' : 'Info';
            showNotification(title, message, type);
        } else {
            // Fallback to alert for critical messages
            if (type === 'error') {
                alert('❌ ' + message);
            } else if (type === 'success') {
                alert('✅ ' + message);
            }
        }
    }

    /**
     * Utility: Escape HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get auth token - Enhanced to check multiple storage locations
     */
    getAuthToken() {
        // Try multiple token storage locations for maximum compatibility
        // Check adminToken first as it's the primary token used by login system
        return localStorage.getItem('adminToken') ||  // PRIMARY: Used by login system
               localStorage.getItem('authToken') || 
               sessionStorage.getItem('authToken') ||
               localStorage.getItem('token') || 
               sessionStorage.getItem('token') ||
               this.getCookieValue('token') || 
               this.getCookieValue('authToken') || '';
    }

    /**
     * Helper function to extract token from cookies
     */
    getCookieValue(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return '';
    }

    /**
     * Get auth token source for debugging - NEVER mask this information
     */
    getAuthTokenSource() {
        if (localStorage.getItem('adminToken')) return 'localStorage.adminToken';
        if (localStorage.getItem('authToken')) return 'localStorage.authToken';
        if (sessionStorage.getItem('authToken')) return 'sessionStorage.authToken';
        if (localStorage.getItem('token')) return 'localStorage.token';
        if (sessionStorage.getItem('token')) return 'sessionStorage.token';
        if (this.getCookieValue('token')) return 'cookie.token';
        if (this.getCookieValue('authToken')) return 'cookie.authToken';
        return 'none';
    }

    /**
     * 🎯 PRODUCTION FIX: Implement missing button functionality
     */
    
    /**
     * Test Priority Flow - Connect to AI Agent routing system
     */
    async testPriorityFlow() {
        try {
            console.log('🧪 Testing AI Agent Priority Flow...');
            
            // Show loading state
            const testBtn = document.getElementById('test-priority-flow-btn');
            if (testBtn) {
                testBtn.disabled = true;
                testBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Testing...';
            }
            
            const testQuery = prompt('Enter a test question to test AI routing:', 'What are your business hours?');
            if (!testQuery) {
                this.resetTestButton();
                return;
            }
            
            const response = await fetch(`${this.apiBaseUrl}/api/ai-agent/test-priority-flow/${this.companyId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    query: testQuery,
                    includeAllSources: true
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showPriorityFlowResults(result);
            } else {
                this.showNotification('❌ Priority flow test failed: ' + result.error, 'error');
            }
            
        } catch (error) {
            console.error('❌ Priority flow test failed:', error);
            this.showNotification('❌ Test failed: ' + error.message, 'error');
        } finally {
            this.resetTestButton();
        }
    }
    
    /**
     * Reset test button state
     */
    resetTestButton() {
        const testBtn = document.getElementById('test-priority-flow-btn');
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.innerHTML = '<i class="fas fa-vial mr-2"></i>Test Priority Flow';
        }
    }
    
    /**
     * Show priority flow test results
     */
    showPriorityFlowResults(results) {
        const resultsHtml = results.sources.map(source => `
            <div class="mb-4 p-4 border rounded-lg ${source.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}">
                <div class="flex items-center justify-between mb-2">
                    <h5 class="font-semibold">${source.sourceName}</h5>
                    <span class="px-2 py-1 text-xs rounded ${source.passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                        ${source.passed ? '✅ PASSED' : '❌ FAILED'}
                    </span>
                </div>
                <div class="text-sm space-y-1">
                    <p><strong>Confidence:</strong> ${(source.confidence * 100).toFixed(1)}% (threshold: ${(source.threshold * 100).toFixed(0)}%)</p>
                    <p><strong>Response Time:</strong> ${source.responseTime}ms</p>
                    <p><strong>Found:</strong> ${source.found ? 'Yes' : 'No'}</p>
                </div>
            </div>
        `).join('');
        
        const modalHtml = `
            <div class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
                <div class="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
                    <div class="flex items-center justify-between pb-4 border-b">
                        <h3 class="text-lg font-semibold">🧪 AI Agent Priority Flow Test Results</h3>
                        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="text-gray-400 hover:text-gray-600">
                            <i class="fas fa-times text-xl"></i>
                        </button>
                    </div>
                    <div class="mt-4 max-h-96 overflow-y-auto">
                        ${resultsHtml}
                    </div>
                    <div class="mt-4 text-sm text-gray-600">
                        <p><strong>Total Response Time:</strong> ${results.totalResponseTime}ms</p>
                        <p><strong>Sources Tested:</strong> ${results.sources.length}</p>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    
    /**
     * Show Add Q&A Modal
     */
    showAddModal() {
        const modalHtml = `
            <div class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
                <div class="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
                    <div class="flex items-center justify-between pb-4 border-b">
                        <h3 class="text-lg font-semibold">➕ Add New Company Q&A</h3>
                        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="text-gray-400 hover:text-gray-600">
                            <i class="fas fa-times text-xl"></i>
                        </button>
                    </div>
                    <form id="add-qna-form" class="mt-4 space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Question</label>
                            <input type="text" id="new-question" class="form-input w-full" placeholder="Enter the question..." required>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Answer</label>
                            <textarea id="new-answer" class="form-textarea w-full" rows="4" placeholder="Enter the answer..." required></textarea>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Category</label>
                            <select id="new-category" class="form-select w-full">
                                <option value="general">General</option>
                                <option value="services">Services</option>
                                <option value="pricing">Pricing</option>
                                <option value="scheduling">Scheduling</option>
                                <option value="emergency">Emergency</option>
                            </select>
                        </div>
                        <div class="flex items-center space-x-4">
                            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg">
                                <i class="fas fa-save mr-2"></i>Save Q&A
                            </button>
                            <button type="button" onclick="this.closest('.fixed').remove()" class="bg-gray-300 hover:bg-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Add form submit handler
        document.getElementById('add-qna-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveNewQnA();
        });
    }
    
    /**
     * Save new Q&A entry
     */
    async saveNewQnA() {
        try {
            const question = document.getElementById('new-question').value.trim();
            const answer = document.getElementById('new-answer').value.trim();
            const category = document.getElementById('new-category').value;
            
            if (!question || !answer) {
                this.showNotification('❌ Question and answer are required', 'error');
                return;
            }
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add authorization header if token is available
            const token = this.getAuthToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const response = await fetch(`${this.apiBaseUrl}/api/knowledge/company/${this.companyId}/qnas`, {
                method: 'POST',
                headers: headers,
                credentials: 'include', // Include cookies for additional auth
                body: JSON.stringify({
                    question,
                    answer,
                    category,
                    status: 'active'  // Fixed: Use 'status' field instead of 'isActive'
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Save Q&A API Error:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorBody: errorText
                });
                this.showNotification('❌ Failed to create Q&A: HTTP ' + response.status, 'error');
                return;
            }

            const result = await response.json();
            console.log('✅ Save Q&A Response:', result);
            
            if (result.success) {
                this.showNotification('✅ Q&A entry created successfully!', 'success');
                // Close modal
                const modal = document.querySelector('.fixed');
                if (modal) modal.remove();
                // Reload entries
                this.loadCompanyQnAEntries();
            } else {
                this.showNotification('❌ Failed to create Q&A: ' + (result.error || 'Unknown error'), 'error');
            }
            
        } catch (error) {
            console.error('❌ CRITICAL ERROR: Failed to save Q&A:', {
                errorMessage: error.message,
                errorStack: error.stack,
                companyId: this.companyId,
                apiBaseUrl: this.apiBaseUrl,
                timestamp: new Date().toISOString(),
                authTokenAvailable: !!this.getAuthToken(),
                authTokenSource: this.getAuthTokenSource(),
                requestUrl: `${this.apiBaseUrl}/api/knowledge/company/${this.companyId}/qnas`,
                requestData: { question, answer, category },
                fullError: error
            });
            
            this.showNotification('❌ Save failed: ' + error.message, 'error');
            
            // NEVER mask errors - make them visible for debugging
            console.error('🔍 FULL SAVE ERROR DETAILS FOR DEBUGGING:', error);
        }
    }
    
    /**
     * Edit Q&A entry - Full implementation with Mongoose + Redis pattern
     */
    async editEntry(id) {
        try {
            console.log('🔧 CHECKPOINT: Starting Q&A edit for ID:', id);
            
            // Find the Q&A entry to edit
            console.log('🔍 CHECKPOINT: Looking for Q&A in qnas array:', !!this.qnas);
            console.log('🔍 CHECKPOINT: qnas array length:', this.qnas?.length || 0);
            
            if (!this.qnas || !Array.isArray(this.qnas)) {
                console.error('❌ CHECKPOINT: qnas array not available - using currentQnAs or reloading');
                // Try using currentQnAs first, then reload if needed
                if (this.currentQnAs && Array.isArray(this.currentQnAs)) {
                    this.qnas = this.currentQnAs;
                } else {
                    await this.loadCompanyQnAEntries();
                }
            }
            
            const qna = this.qnas?.find(q => q._id === id) || this.currentQnAs?.find(q => q._id === id);
            if (!qna) {
                console.error('❌ CHECKPOINT: Q&A entry not found for editing');
                console.error('❌ CHECKPOINT: Available IDs:', this.qnas?.map(q => q._id) || []);
                this.showNotification('❌ Q&A entry not found', 'error');
                return;
            }
            
            console.log('✅ CHECKPOINT: Q&A entry found for editing:', qna.question.substring(0, 50));
            
            // Create edit modal HTML
            const editModalHtml = `
                <div id="edit-qna-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                        <div class="p-6">
                            <div class="flex items-center justify-between mb-6">
                                <h3 class="text-lg font-semibold text-gray-800">
                                    <i class="fas fa-edit mr-2 text-blue-600"></i>Edit Q&A Entry
                                </h3>
                                <button onclick="closeEditModal()" class="text-gray-400 hover:text-gray-600">
                                    <i class="fas fa-times text-xl"></i>
                                </button>
                            </div>
                            
                            <form id="edit-qna-form" onsubmit="saveEditedQnA(event, '${id}')">
                                <div class="space-y-4">
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-2">Question</label>
                                        <input type="text" id="edit-question" value="${qna.question.replace(/"/g, '&quot;')}" 
                                               class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                               required>
                                    </div>
                                    
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-2">Answer</label>
                                        <textarea id="edit-answer" rows="4" 
                                                  class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                  required>${qna.answer}</textarea>
                                    </div>
                                    
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-2">Category</label>
                                        <select id="edit-category" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                                            <option value="general" ${qna.category === 'general' ? 'selected' : ''}>General</option>
                                            <option value="pricing" ${qna.category === 'pricing' ? 'selected' : ''}>Pricing</option>
                                            <option value="services" ${qna.category === 'services' ? 'selected' : ''}>Services</option>
                                            <option value="technical" ${qna.category === 'technical' ? 'selected' : ''}>Technical</option>
                                            <option value="emergency" ${qna.category === 'emergency' ? 'selected' : ''}>Emergency</option>
                                            <option value="scheduling" ${qna.category === 'scheduling' ? 'selected' : ''}>Scheduling</option>
                                        </select>
                                    </div>
                                    
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-2">Status</label>
                                        <select id="edit-status" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                                            <option value="active" ${qna.status === 'active' ? 'selected' : ''}>Active</option>
                                            <option value="draft" ${qna.status === 'draft' ? 'selected' : ''}>Draft</option>
                                            <option value="under_review" ${qna.status === 'under_review' ? 'selected' : ''}>Under Review</option>
                                            <option value="archived" ${qna.status === 'archived' ? 'selected' : ''}>Archived</option>
                                        </select>
                                    </div>
                                    
                                    <!-- Keywords Editing Section -->
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-2">
                                            <i class="fas fa-tags mr-1 text-orange-500"></i>Keywords
                                        </label>
                                        <div class="mb-2">
                                            <div class="text-xs text-gray-600 mb-2">
                                                Current AI-generated keywords (${qna.keywords ? qna.keywords.length : 0}):
                                            </div>
                                            <div class="flex flex-wrap gap-1 mb-3 p-2 bg-gray-50 rounded border min-h-[40px]">
                                                ${qna.keywords && qna.keywords.length > 0 ? 
                                                    qna.keywords.map(keyword => `
                                                        <span class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800">
                                                            ${keyword}
                                                        </span>
                                                    `).join('') 
                                                    : '<span class="text-xs text-gray-500">No keywords generated</span>'
                                                }
                                            </div>
                                        </div>
                                        <textarea id="edit-keywords" rows="2" 
                                                  placeholder="Add custom keywords (comma-separated). Leave empty to regenerate automatically."
                                                  class="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">${(qna.keywordCategories?.custom || []).join(', ')}</textarea>
                                        <div class="text-xs text-gray-500 mt-1">
                                            💡 Tip: Keywords help AI agents find this Q&A faster during phone calls
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="flex justify-end space-x-3 mt-6 pt-4 border-t">
                                    <button type="button" onclick="closeEditModal()" 
                                            class="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">
                                        Cancel
                                    </button>
                                    <button type="submit" 
                                            class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md transition-colors">
                                        <i class="fas fa-save mr-2"></i>Save Changes
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            `;
            
            // Add modal to page
            document.body.insertAdjacentHTML('beforeend', editModalHtml);
            
            console.log('✅ CHECKPOINT: Edit modal created and displayed');
            
        } catch (error) {
            console.error('❌ CRITICAL: Edit modal creation failed:', error);
            this.showNotification('❌ Failed to open edit dialog', 'error');
        }
    }
    
    /**
     * Save edited Q&A entry using Mongoose + Redis pattern
     */
    async saveEditedQnA(event, qnaId) {
        event.preventDefault();
        
        try {
            console.log('💾 CHECKPOINT: Starting Q&A edit save for ID:', qnaId);
            
            const question = document.getElementById('edit-question').value.trim();
            const answer = document.getElementById('edit-answer').value.trim();
            const category = document.getElementById('edit-category').value;
            const status = document.getElementById('edit-status').value;
            const customKeywords = document.getElementById('edit-keywords').value.trim();
            
            if (!question || !answer) {
                this.showNotification('❌ Question and answer are required', 'error');
                return;
            }
            
            console.log('💾 CHECKPOINT: Edit data collected:', { 
                question: question.substring(0, 50), 
                category, 
                status, 
                customKeywords: customKeywords.substring(0, 50) 
            });
            
            this.showLoading('Saving changes...');
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add authorization header
            const token = this.getAuthToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            console.log('💾 CHECKPOINT: Making PUT request to update Q&A');
            
            const response = await fetch(`${this.apiBaseUrl}/api/knowledge/company/${this.companyId}/qnas/${qnaId}`, {
                method: 'PUT',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify({
                    question,
                    answer,
                    category,
                    status,  // Include status field for proper Active/Inactive control
                    customKeywords: customKeywords ? customKeywords.split(',').map(k => k.trim()).filter(k => k) : [],
                    lastModified: new Date()
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ CHECKPOINT: Edit save failed:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorBody: errorText
                });
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('✅ CHECKPOINT: Q&A edit saved successfully:', result);
            
            // Close modal
            this.closeEditModal();
            
            console.log('🔄 CHECKPOINT: Edit successful, reloading Q&A list to show changes');
            
            // Force refresh by adding cache-busting parameter
            const originalApiCall = this.loadCompanyQnAEntries;
            this.loadCompanyQnAEntries = async () => {
                const cacheBuster = `&_cb=${Date.now()}`;
                const originalUrl = `${this.apiBaseUrl}/api/knowledge/company/${this.companyId}/qnas`;
                const fullUrl = `${originalUrl}?status=all${cacheBuster}`;
                
                console.log('🔄 CHECKPOINT: Force refreshing after edit');
                console.log('🔄 CHECKPOINT: Full URL being called:', fullUrl);
                console.log('🔄 CHECKPOINT: Expected to get ALL entries regardless of status');
                
                const headers = { 'Content-Type': 'application/json' };
                const token = this.getAuthToken();
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                    console.log('🔄 CHECKPOINT: Auth token included in force refresh');
                }
                
                const response = await fetch(fullUrl, {
                    method: 'GET',
                    headers: headers,
                    credentials: 'include'
                });
                
                console.log('🔄 CHECKPOINT: Force refresh response status:', response.status);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('❌ CHECKPOINT: Force refresh failed:', {
                        status: response.status,
                        errorBody: errorText,
                        url: fullUrl
                    });
                    return;
                }
                
                const data = await response.json();
                console.log('🔄 CHECKPOINT: Force refresh response data:', data);
                
                if (data.success && data.data) {
                    this.qnas = data.data;
                    console.log('✅ CHECKPOINT: Force refresh loaded entries:', this.qnas.length);
                    console.log('🔄 CHECKPOINT: Entry statuses:', this.qnas.map(q => q.status));
                    
                    this.renderQnAEntries(data.data);
                    
                    const listEl = document.getElementById('qna-entries-list');
                    const emptyEl = document.getElementById('qna-empty-state');
                    
                    if (data.data.length > 0) {
                        if (listEl) listEl.classList.remove('hidden');
                        if (emptyEl) emptyEl.classList.add('hidden');
                        console.log('✅ CHECKPOINT: Q&A list shown after force refresh');
                    } else {
                        if (listEl) listEl.classList.add('hidden');
                        if (emptyEl) emptyEl.classList.remove('hidden');
                        console.log('⚠️ CHECKPOINT: Empty state shown - no entries found');
                    }
                } else {
                    console.error('❌ CHECKPOINT: Invalid response data from force refresh:', data);
                }
            };
            
            // Reload Q&A list to show changes (with force refresh)
            await this.loadCompanyQnAEntries();
            
            // Restore original method
            this.loadCompanyQnAEntries = originalApiCall;
            
            console.log('✅ CHECKPOINT: Q&A list force refreshed after edit');
            
            this.showNotification('✅ Q&A updated successfully!', 'success');
            
        } catch (error) {
            console.error('❌ CRITICAL: Q&A edit save failed:', error);
            this.showNotification('❌ Failed to save changes: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * Close edit modal
     */
    closeEditModal() {
        const modal = document.getElementById('edit-qna-modal');
        if (modal) {
            modal.remove();
            console.log('✅ CHECKPOINT: Edit modal closed');
        }
    }
    
    /**
     * Get status styling for consistent UI
     */
    getStatusStyle(status) {
        const styles = {
            'active': 'bg-green-100 text-green-800',
            'draft': 'bg-yellow-100 text-yellow-800', 
            'under_review': 'bg-blue-100 text-blue-800',
            'archived': 'bg-gray-100 text-gray-800'
        };
        return styles[status] || 'bg-gray-100 text-gray-800';
    }
    
    /**
     * Get status icon for consistent UI
     */
    getStatusIcon(status) {
        const icons = {
            'active': 'check-circle',
            'draft': 'edit',
            'under_review': 'clock',
            'archived': 'archive'
        };
        return icons[status] || 'question';
    }
    
    /**
     * Get status label for consistent UI
     */
    getStatusLabel(status) {
        const labels = {
            'active': 'Active',
            'draft': 'Draft',
            'under_review': 'Under Review', 
            'archived': 'Archived'
        };
        return labels[status] || 'Unknown';
    }
    
    /**
     * Show loading state for edit operations
     */
    showLoading(message = 'Loading...') {
        try {
            // Create or update loading overlay
            let loadingOverlay = document.getElementById('qna-edit-loading');
            if (!loadingOverlay) {
                loadingOverlay = document.createElement('div');
                loadingOverlay.id = 'qna-edit-loading';
                loadingOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
                loadingOverlay.innerHTML = `
                    <div class="bg-white rounded-lg p-6 shadow-xl">
                        <div class="flex items-center space-x-3">
                            <i class="fas fa-spinner fa-spin text-blue-600 text-xl"></i>
                            <span class="text-gray-800 font-medium">${message}</span>
                        </div>
                    </div>
                `;
                document.body.appendChild(loadingOverlay);
            } else {
                loadingOverlay.querySelector('span').textContent = message;
                loadingOverlay.style.display = 'flex';
            }
            console.log('✅ CHECKPOINT: Loading state shown:', message);
        } catch (error) {
            console.error('❌ CHECKPOINT: Failed to show loading state:', error);
        }
    }
    
    /**
     * Hide loading state
     */
    hideLoading() {
        try {
            const loadingOverlay = document.getElementById('qna-edit-loading');
            if (loadingOverlay) {
                loadingOverlay.remove();
                console.log('✅ CHECKPOINT: Loading state hidden');
            }
        } catch (error) {
            console.error('❌ CHECKPOINT: Failed to hide loading state:', error);
        }
    }
    
    /**
     * Delete Q&A entry - Full implementation with Mongoose + Redis pattern
     */
    async deleteEntry(id) {
        try {
            console.log('🗑️ CHECKPOINT: Starting Q&A delete for ID:', id);
            
            // Find the Q&A entry to delete
            const qna = this.qnas?.find(q => q._id === id);
            if (!qna) {
                console.error('❌ CHECKPOINT: Q&A entry not found for deletion');
                this.showNotification('❌ Q&A entry not found', 'error');
                return;
            }
            
            console.log('✅ CHECKPOINT: Q&A entry found for deletion:', qna.question.substring(0, 50));
            
            // Show confirmation dialog
            const confirmed = confirm(`Are you sure you want to delete this Q&A?\n\nQuestion: ${qna.question}\n\nThis action cannot be undone.`);
            
            if (!confirmed) {
                console.log('ℹ️ CHECKPOINT: Delete operation cancelled by user');
                return;
            }
            
            console.log('🗑️ CHECKPOINT: Delete confirmed by user, proceeding...');
            
            this.showLoading('Deleting Q&A entry...');
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add authorization header
            const token = this.getAuthToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            console.log('🗑️ CHECKPOINT: Making DELETE request to API');
            
            const response = await fetch(`${this.apiBaseUrl}/api/knowledge/company/${this.companyId}/qnas/${id}`, {
                method: 'DELETE',
                headers: headers,
                credentials: 'include'
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ CHECKPOINT: Delete operation failed:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorBody: errorText
                });
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('✅ CHECKPOINT: Q&A deleted successfully:', result);
            
            // Reload Q&A list to show changes (triggers Redis cache refresh)
            await this.loadCompanyQnAEntries();
            
            this.showNotification('✅ Q&A entry deleted successfully!', 'success');
            
        } catch (error) {
            console.error('❌ CRITICAL: Q&A delete failed:', error);
            this.showNotification('❌ Failed to delete Q&A entry: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
}

// ========================================= 
// 🚀 PRODUCTION: GLOBAL INITIALIZATION
// ========================================= 

// Global instance
let embeddedQnAManager = null;

// ✅ PRODUCTION FIX: Enhanced initialization with better timing
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 PRODUCTION: Setting up embedded Q&A manager initialization...');
    
    // Initialize when AI Agent Logic tab is accessed
    const aiAgentTab = document.getElementById('tab-ai-agent-logic');
    if (aiAgentTab) {
        aiAgentTab.addEventListener('click', function() {
            console.log('🎯 AI Agent Logic tab clicked - initializing Q&A manager...');
            setTimeout(() => {
                if (!embeddedQnAManager) {
                    embeddedQnAManager = new EmbeddedQnAManager();
                    window.embeddedQnAManager = embeddedQnAManager; // Make globally available
                    embeddedQnAManager.initialize();
                } else {
                    // Re-initialize if tab is switched back
                    embeddedQnAManager.initialize();
                }
            }, 200); // Increased delay to ensure DOM is ready
        });
    }
    
    // Also initialize when knowledge tab within AI Agent Logic is clicked
    document.addEventListener('click', function(event) {
        if (event.target && event.target.id === 'clientsvia-tab-knowledge') {
            console.log('🎯 Knowledge tab clicked within AI Agent Logic...');
            setTimeout(() => {
                if (!embeddedQnAManager) {
                    embeddedQnAManager = new EmbeddedQnAManager();
                    window.embeddedQnAManager = embeddedQnAManager; // Make globally available
                }
                embeddedQnAManager.initialize();
            }, 300);
        }
    });
});

// Global functions for HTML onclick handlers
function updateCompanyQnAThreshold(value) {
    if (embeddedQnAManager) {
        embeddedQnAManager.updateThreshold(value);
    }
}

// Global function for closing edit modal
function closeEditModal() {
    if (embeddedQnAManager) {
        embeddedQnAManager.closeEditModal();
    }
}

// Global function for saving edited Q&A
function saveEditedQnA(event, qnaId) {
    event.preventDefault();
    if (embeddedQnAManager) {
        embeddedQnAManager.saveEditedQnA(event, qnaId);
    }
}

function showAddQnAModal() {
    if (embeddedQnAManager) {
        embeddedQnAManager.showAddModal();
    }
}
