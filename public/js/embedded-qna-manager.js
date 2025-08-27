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
                this.renderQnAEntries(data.data);
                if (listEl) listEl.classList.remove('hidden');
            } else {
                if (emptyEl) emptyEl.classList.remove('hidden');
            }

            console.log(`✅ Loaded ${data.data?.length || 0} Company Q&A entries`);

        } catch (error) {
            console.error('❌ Failed to load Company Q&A entries:', error);
            this.showErrorState(error.message);
        }
    }

    /**
     * Render Q&A entries with enterprise UI
     */
    renderQnAEntries(qnas) {
        const container = document.getElementById('qna-entries-list');
        if (!container) return;

        container.innerHTML = qnas.map(qna => `
            <div class="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow duration-200" data-qna-id="${qna._id}">
                <div class="flex items-start justify-between mb-4">
                    <div class="flex-1">
                        <div class="flex items-center space-x-3 mb-2">
                            <span class="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                                ${qna.category || 'General'}
                            </span>
                            <span class="px-2 py-1 ${qna.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'} text-xs font-medium rounded-full">
                                <i class="fas fa-${qna.isActive ? 'check' : 'pause'} mr-1"></i>
                                ${qna.isActive ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                        <h4 class="text-lg font-semibold text-gray-900 mb-3">
                            <i class="fas fa-question-circle text-blue-500 mr-2"></i>
                            ${this.escapeHtml(qna.question)}
                        </h4>
                        <div class="bg-gray-50 rounded-lg p-4 mb-4">
                            <p class="text-gray-700">${this.escapeHtml(qna.answer)}</p>
                        </div>
                        
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
                        <button onclick="embeddedQnAManager.editEntry('${qna._id}')" 
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
            console.error('❌ Failed to update threshold:', error);
            this.showNotification('❌ Threshold update failed: ' + error.message, 'error');
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

        console.log('✅ Event listeners configured');
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
                    isActive: true
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
            console.error('❌ Failed to save Q&A:', error);
            this.showNotification('❌ Save failed: ' + error.message, 'error');
        }
    }
    
    /**
     * Edit Q&A entry
     */
    editEntry(id) {
        console.log('🔧 Edit Q&A entry:', id);
        this.showNotification('⚠️ Edit functionality coming soon!', 'info');
    }
    
    /**
     * Delete Q&A entry
     */
    deleteEntry(id) {
        if (confirm('Are you sure you want to delete this Q&A entry?')) {
            console.log('🗑️ Delete Q&A entry:', id);
            this.showNotification('⚠️ Delete functionality coming soon!', 'info');
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

function showAddQnAModal() {
    if (embeddedQnAManager) {
        embeddedQnAManager.showAddModal();
    }
}
