/**
 * ============================================================================
 * 🌐 GLOBAL HUB MANAGER - Frontend Controller
 * ============================================================================
 * 
 * PURPOSE:
 * Manages the Global Hub UI - cross-tenant shared resources interface.
 * Handles the First Names dictionary modal and API interactions.
 * 
 * ARCHITECTURE:
 * - Self-contained module (no external dependencies except DOM)
 * - Communicates with /api/admin/global-hub/* endpoints
 * - Handles authentication via localStorage token
 * 
 * FEATURES:
 * - Load and display Global Hub status
 * - First Names modal: load, edit, save
 * - Toast notifications for feedback
 * - Auto-refresh on save
 * 
 * ============================================================================
 */

const GlobalHubManager = (function() {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    
    const API_BASE = '/api/admin/global-hub';
    
    // ========================================================================
    // DOM ELEMENTS (cached on init)
    // ========================================================================
    
    let elements = {};
    
    // ========================================================================
    // STATE
    // ========================================================================
    
    let state = {
        firstNames: [],
        lastUpdated: null,
        isLoading: false
    };
    
    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================
    
    /**
     * Get authorization headers for API requests
     */
    function getAuthHeaders() {
        const token = localStorage.getItem('adminToken');
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
    }
    
    /**
     * Format date for display
     */
    function formatDate(dateString) {
        if (!dateString) return 'Never updated';
        
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
        
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }
    
    /**
     * Format number with commas
     */
    function formatNumber(num) {
        if (num === null || num === undefined) return '-';
        return num.toLocaleString();
    }
    
    /**
     * Show toast notification
     */
    function showToast(message, type = 'success') {
        const toast = elements.toast;
        if (!toast) return;
        
        toast.textContent = message;
        toast.className = `toast ${type}`;
        
        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);
        
        // Auto-hide
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
    
    // ========================================================================
    // API FUNCTIONS
    // ========================================================================
    
    /**
     * Fetch Global Hub status (overview of all dictionaries)
     */
    async function fetchStatus() {
        try {
            const response = await fetch(`${API_BASE}/status`, {
                method: 'GET',
                headers: getAuthHeaders(),
                credentials: 'include'
            });
            
            if (response.status === 401) {
                window.location.href = '/login.html';
                return null;
            }
            
            if (!response.ok) {
                throw new Error(`Failed to fetch status: ${response.statusText}`);
            }
            
            const data = await response.json();
            return data.data;
            
        } catch (error) {
            console.error('[GlobalHubManager] Error fetching status:', error);
            showToast('Failed to load Global Hub status', 'error');
            return null;
        }
    }
    
    /**
     * Fetch first names list
     */
    async function fetchFirstNames() {
        try {
            const response = await fetch(`${API_BASE}/first-names`, {
                method: 'GET',
                headers: getAuthHeaders(),
                credentials: 'include'
            });
            
            if (response.status === 401) {
                window.location.href = '/login.html';
                return null;
            }
            
            if (!response.ok) {
                throw new Error(`Failed to fetch first names: ${response.statusText}`);
            }
            
            const data = await response.json();
            return data.data;
            
        } catch (error) {
            console.error('[GlobalHubManager] Error fetching first names:', error);
            showToast('Failed to load first names', 'error');
            return null;
        }
    }
    
    /**
     * Save first names list
     */
    async function saveFirstNames(namesArray) {
        try {
            const response = await fetch(`${API_BASE}/first-names`, {
                method: 'POST',
                headers: getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({ firstNames: namesArray })
            });
            
            if (response.status === 401) {
                window.location.href = '/login.html';
                return null;
            }
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `Failed to save: ${response.statusText}`);
            }
            
            return data;
            
        } catch (error) {
            console.error('[GlobalHubManager] Error saving first names:', error);
            showToast(error.message || 'Failed to save first names', 'error');
            return null;
        }
    }
    
    // ========================================================================
    // UI UPDATE FUNCTIONS
    // ========================================================================
    
    /**
     * Update the dashboard display with current status
     */
    function updateDashboard(status) {
        if (!status) return;
        
        const firstNames = status.dictionaries?.firstNames;
        
        if (firstNames) {
            // Update count
            if (elements.firstNamesCount) {
                elements.firstNamesCount.textContent = formatNumber(firstNames.count);
            }
            
            // Update last updated
            if (elements.firstNamesUpdated) {
                elements.firstNamesUpdated.textContent = formatDate(firstNames.lastUpdated);
            }
            
            // Store state
            state.lastUpdated = firstNames.lastUpdated;
        }
    }
    
    // ========================================================================
    // MODAL FUNCTIONS
    // ========================================================================
    
    /**
     * Open the first names modal
     */
    async function openFirstNamesModal() {
        const modal = elements.firstNamesModal;
        const textarea = elements.firstNamesTextarea;
        const saveBtn = elements.saveFirstNamesBtn;
        
        if (!modal || !textarea) return;
        
        // Show loading state
        textarea.value = 'Loading...';
        textarea.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
        
        // Show modal
        modal.classList.add('active');
        
        // Fetch current names
        const data = await fetchFirstNames();
        
        if (data) {
            state.firstNames = data.firstNames || [];
            textarea.value = state.firstNames.join('\n');
        } else {
            textarea.value = '';
        }
        
        // Enable editing
        textarea.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
        
        // Focus textarea
        textarea.focus();
    }
    
    /**
     * Close the first names modal
     */
    function closeFirstNamesModal() {
        const modal = elements.firstNamesModal;
        if (modal) {
            modal.classList.remove('active');
        }
    }
    
    /**
     * Save first names from modal
     */
    async function handleSaveFirstNames() {
        const textarea = elements.firstNamesTextarea;
        const saveBtn = elements.saveFirstNamesBtn;
        
        if (!textarea) return;
        
        // Parse textarea content into array
        const text = textarea.value;
        const namesArray = text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        // Show loading state
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        // Save to API
        const result = await saveFirstNames(namesArray);
        
        // Reset button
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
        }
        
        if (result && result.success) {
            // Update textarea with normalized names
            if (result.data?.firstNames) {
                textarea.value = result.data.firstNames.join('\n');
                state.firstNames = result.data.firstNames;
            }
            
            // Show success message with stats
            const stats = result.data?.stats;
            let message = result.message || 'Saved successfully';
            if (stats && stats.duplicatesRemoved > 0) {
                message += ` (${stats.duplicatesRemoved} duplicates removed)`;
            }
            showToast(message, 'success');
            
            // Close modal
            closeFirstNamesModal();
            
            // Refresh dashboard
            const status = await fetchStatus();
            updateDashboard(status);
        }
    }
    
    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================
    
    /**
     * Set up event listeners
     */
    function setupEventListeners() {
        // Edit First Names button
        if (elements.editFirstNamesBtn) {
            elements.editFirstNamesBtn.addEventListener('click', openFirstNamesModal);
        }
        
        // Close modal button
        if (elements.closeModalBtn) {
            elements.closeModalBtn.addEventListener('click', closeFirstNamesModal);
        }
        
        // Cancel button
        if (elements.cancelModalBtn) {
            elements.cancelModalBtn.addEventListener('click', closeFirstNamesModal);
        }
        
        // Save button
        if (elements.saveFirstNamesBtn) {
            elements.saveFirstNamesBtn.addEventListener('click', handleSaveFirstNames);
        }
        
        // Close modal on backdrop click
        if (elements.firstNamesModal) {
            elements.firstNamesModal.addEventListener('click', (e) => {
                if (e.target === elements.firstNamesModal) {
                    closeFirstNamesModal();
                }
            });
        }
        
        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeFirstNamesModal();
            }
        });
        
        // Save on Ctrl+S / Cmd+S when modal is open
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                if (elements.firstNamesModal?.classList.contains('active')) {
                    e.preventDefault();
                    handleSaveFirstNames();
                }
            }
        });
    }
    
    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    /**
     * Cache DOM element references
     */
    function cacheElements() {
        elements = {
            // Dashboard elements
            firstNamesCount: document.getElementById('first-names-count'),
            firstNamesUpdated: document.getElementById('first-names-updated'),
            editFirstNamesBtn: document.getElementById('edit-first-names-btn'),
            
            // Modal elements
            firstNamesModal: document.getElementById('first-names-modal'),
            firstNamesTextarea: document.getElementById('first-names-textarea'),
            closeModalBtn: document.getElementById('close-modal-btn'),
            cancelModalBtn: document.getElementById('cancel-modal-btn'),
            saveFirstNamesBtn: document.getElementById('save-first-names-btn'),
            
            // Toast
            toast: document.getElementById('toast')
        };
    }
    
    /**
     * Initialize the Global Hub Manager
     */
    async function init() {
        console.log('[GlobalHubManager] Initializing...');
        
        // Cache DOM elements
        cacheElements();
        
        // Set up event listeners
        setupEventListeners();
        
        // Load initial data
        const status = await fetchStatus();
        updateDashboard(status);
        
        console.log('[GlobalHubManager] Initialized successfully');
    }
    
    // ========================================================================
    // PUBLIC API
    // ========================================================================
    
    return {
        init,
        openFirstNamesModal,
        closeFirstNamesModal,
        refresh: async () => {
            const status = await fetchStatus();
            updateDashboard(status);
        }
    };
    
})();
