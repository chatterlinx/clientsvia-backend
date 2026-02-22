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

window.GlobalHubManager = (function() {
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
        lastNames: [],
        firstNamesLastUpdated: null,
        lastNamesLastUpdated: null,
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
    
    /**
     * Parse textarea content into names array and count duplicates
     */
    function parseNamesWithStats(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const seen = new Map();
        let duplicateCount = 0;
        
        for (const name of lines) {
            const key = name.toLowerCase();
            if (seen.has(key)) {
                duplicateCount++;
            } else {
                seen.set(key, name);
            }
        }
        
        return {
            total: lines.length,
            unique: seen.size,
            duplicates: duplicateCount,
            names: lines
        };
    }
    
    /**
     * Search names in textarea
     */
    function searchNames(text, query) {
        if (!query || query.length < 2) return [];
        
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const lowerQuery = query.toLowerCase();
        
        return lines.filter(name => name.toLowerCase().includes(lowerQuery)).slice(0, 50);
    }
    
    /**
     * Update modal stats display
     */
    function updateModalStats(type, stats) {
        const totalEl = type === 'first' ? elements.firstNamesTotalCount : elements.lastNamesTotalCount;
        const dupEl = type === 'first' ? elements.firstNamesDuplicateCount : elements.lastNamesDuplicateCount;
        
        if (totalEl) totalEl.textContent = formatNumber(stats.total);
        if (dupEl) {
            dupEl.textContent = formatNumber(stats.duplicates);
            dupEl.className = stats.duplicates > 0 ? 'text-orange-500 font-bold' : 'text-gray-400';
        }
    }
    
    /**
     * Show search results
     */
    function showSearchResults(type, results, query) {
        const resultsEl = type === 'first' ? elements.firstNamesSearchResults : elements.lastNamesSearchResults;
        const countEl = type === 'first' ? elements.firstNamesSearchCount : elements.lastNamesSearchCount;
        const listEl = type === 'first' ? elements.firstNamesSearchList : elements.lastNamesSearchList;
        
        if (!resultsEl || !listEl) return;
        
        if (results.length === 0 || !query || query.length < 2) {
            resultsEl.classList.add('hidden');
            return;
        }
        
        resultsEl.classList.remove('hidden');
        if (countEl) countEl.textContent = results.length + (results.length === 50 ? '+' : '');
        
        const colorClass = type === 'first' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800';
        listEl.innerHTML = results.map(name => {
            const highlighted = name.replace(
                new RegExp(`(${query})`, 'gi'),
                '<strong class="underline">$1</strong>'
            );
            return `<span class="px-2 py-1 ${colorClass} rounded text-sm">${highlighted}</span>`;
        }).join('');
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
    
    /**
     * Seed first names with curated starter list
     */
    async function seedFirstNames() {
        try {
            const response = await fetch(`${API_BASE}/first-names/seed`, {
                method: 'POST',
                headers: getAuthHeaders(),
                credentials: 'include'
            });
            
            if (response.status === 401) {
                window.location.href = '/login.html';
                return null;
            }
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `Failed to seed: ${response.statusText}`);
            }
            
            return data;
            
        } catch (error) {
            console.error('[GlobalHubManager] Error seeding first names:', error);
            showToast(error.message || 'Failed to seed first names', 'error');
            return null;
        }
    }
    
    /**
     * Fetch last names list
     */
    async function fetchLastNames() {
        try {
            const response = await fetch(`${API_BASE}/last-names`, {
                method: 'GET',
                headers: getAuthHeaders(),
                credentials: 'include'
            });
            
            if (response.status === 401) {
                window.location.href = '/login.html';
                return null;
            }
            
            if (!response.ok) {
                throw new Error(`Failed to fetch last names: ${response.statusText}`);
            }
            
            const data = await response.json();
            return data.data;
            
        } catch (error) {
            console.error('[GlobalHubManager] Error fetching last names:', error);
            showToast('Failed to load last names', 'error');
            return null;
        }
    }
    
    /**
     * Save last names list
     */
    async function saveLastNames(namesArray) {
        try {
            const response = await fetch(`${API_BASE}/last-names`, {
                method: 'POST',
                headers: getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({ lastNames: namesArray })
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
            console.error('[GlobalHubManager] Error saving last names:', error);
            showToast(error.message || 'Failed to save last names', 'error');
            return null;
        }
    }
    
    /**
     * Seed last names with US Census data
     */
    async function seedLastNames() {
        try {
            const response = await fetch(`${API_BASE}/last-names/seed`, {
                method: 'POST',
                headers: getAuthHeaders(),
                credentials: 'include'
            });
            
            if (response.status === 401) {
                window.location.href = '/login.html';
                return null;
            }
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `Failed to seed: ${response.statusText}`);
            }
            
            return data;
            
        } catch (error) {
            console.error('[GlobalHubManager] Error seeding last names:', error);
            showToast(error.message || 'Failed to seed last names', 'error');
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
        const lastNames = status.dictionaries?.lastNames;
        
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
            state.firstNamesLastUpdated = firstNames.lastUpdated;
        }
        
        if (lastNames) {
            // Update count
            if (elements.lastNamesCount) {
                elements.lastNamesCount.textContent = formatNumber(lastNames.count);
            }
            
            // Update last updated
            if (elements.lastNamesUpdated) {
                elements.lastNamesUpdated.textContent = formatDate(lastNames.lastUpdated);
            }
            
            // Store state
            state.lastNamesLastUpdated = lastNames.lastUpdated;
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
        const searchInput = elements.firstNamesSearch;
        
        if (!modal || !textarea) return;
        
        // Show loading state
        textarea.value = 'Loading...';
        textarea.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
        if (searchInput) searchInput.value = '';
        
        // Hide search results
        if (elements.firstNamesSearchResults) {
            elements.firstNamesSearchResults.classList.add('hidden');
        }
        
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
        
        // Update stats
        const stats = parseNamesWithStats(textarea.value);
        updateModalStats('first', stats);
        
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
        // Clear search
        if (elements.firstNamesSearch) elements.firstNamesSearch.value = '';
        if (elements.firstNamesSearchResults) elements.firstNamesSearchResults.classList.add('hidden');
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
    // LAST NAMES MODAL FUNCTIONS
    // ========================================================================
    
    /**
     * Open the last names modal
     */
    async function openLastNamesModal() {
        const modal = elements.lastNamesModal;
        const textarea = elements.lastNamesTextarea;
        const saveBtn = elements.saveLastNamesBtn;
        const searchInput = elements.lastNamesSearch;
        
        if (!modal || !textarea) return;
        
        // Show loading state
        textarea.value = 'Loading...';
        textarea.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
        if (searchInput) searchInput.value = '';
        
        // Hide search results
        if (elements.lastNamesSearchResults) {
            elements.lastNamesSearchResults.classList.add('hidden');
        }
        
        // Show modal
        modal.classList.add('active');
        
        // Fetch current names
        const data = await fetchLastNames();
        
        if (data) {
            state.lastNames = data.lastNames || [];
            textarea.value = state.lastNames.join('\n');
        } else {
            textarea.value = '';
        }
        
        // Update stats
        const stats = parseNamesWithStats(textarea.value);
        updateModalStats('last', stats);
        
        // Enable editing
        textarea.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
        
        // Focus textarea
        textarea.focus();
    }
    
    /**
     * Close the last names modal
     */
    function closeLastNamesModal() {
        const modal = elements.lastNamesModal;
        if (modal) {
            modal.classList.remove('active');
        }
        // Clear search
        if (elements.lastNamesSearch) elements.lastNamesSearch.value = '';
        if (elements.lastNamesSearchResults) elements.lastNamesSearchResults.classList.add('hidden');
    }
    
    /**
     * Save last names from modal
     */
    async function handleSaveLastNames() {
        const textarea = elements.lastNamesTextarea;
        const saveBtn = elements.saveLastNamesBtn;
        
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
        const result = await saveLastNames(namesArray);
        
        // Reset button
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
        }
        
        if (result && result.success) {
            // Update textarea with normalized names
            if (result.data?.lastNames) {
                textarea.value = result.data.lastNames.join('\n');
                state.lastNames = result.data.lastNames;
            }
            
            // Show success message with stats
            const stats = result.data?.stats;
            let message = result.message || 'Saved successfully';
            if (stats && stats.duplicatesRemoved > 0) {
                message += ` (${stats.duplicatesRemoved} duplicates removed)`;
            }
            showToast(message, 'success');
            
            // Close modal
            closeLastNamesModal();
            
            // Refresh dashboard
            const status = await fetchStatus();
            updateDashboard(status);
        }
    }
    
    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================
    
    /**
     * Handle seed first names button click
     */
    async function handleSeedFirstNames() {
        const seedBtn = elements.seedFirstNamesBtn;
        
        // Confirm with user
        const currentCount = state.firstNames?.length || 0;
        if (currentCount > 0) {
            const confirmed = confirm(`This will replace the current ${currentCount.toLocaleString()} names with ~9,500 SSA names. Continue?`);
            if (!confirmed) return;
        }
        
        // Show loading state
        if (seedBtn) {
            seedBtn.disabled = true;
            seedBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Seeding...';
        }
        
        // Call seed API
        const result = await seedFirstNames();
        
        // Reset button
        if (seedBtn) {
            seedBtn.disabled = false;
            seedBtn.innerHTML = '<i class="fas fa-seedling"></i> Seed';
        }
        
        if (result && result.success) {
            showToast(result.message || `Seeded ${result.data?.count?.toLocaleString() || ''} names`, 'success');
            
            // Refresh dashboard
            const status = await fetchStatus();
            updateDashboard(status);
        }
    }
    
    /**
     * Handle seed last names button click
     */
    async function handleSeedLastNames() {
        const seedBtn = elements.seedLastNamesBtn;
        
        // Confirm with user
        const currentCount = state.lastNames?.length || 0;
        if (currentCount > 0) {
            const confirmed = confirm(`This will replace the current ${currentCount.toLocaleString()} names with ~162,000 Census surnames. Continue?`);
            if (!confirmed) return;
        }
        
        // Show loading state
        if (seedBtn) {
            seedBtn.disabled = true;
            seedBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Seeding...';
        }
        
        // Call seed API
        const result = await seedLastNames();
        
        // Reset button
        if (seedBtn) {
            seedBtn.disabled = false;
            seedBtn.innerHTML = '<i class="fas fa-seedling"></i> Seed';
        }
        
        if (result && result.success) {
            showToast(result.message || `Seeded ${result.data?.count?.toLocaleString() || ''} surnames`, 'success');
            
            // Refresh dashboard
            const status = await fetchStatus();
            updateDashboard(status);
        }
    }
    
    /**
     * Set up event listeners
     */
    function setupEventListeners() {
        // ====== FIRST NAMES ======
        
        // Seed First Names button
        if (elements.seedFirstNamesBtn) {
            elements.seedFirstNamesBtn.addEventListener('click', handleSeedFirstNames);
        }
        
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
        
        // ====== LAST NAMES ======
        
        // Seed Last Names button
        if (elements.seedLastNamesBtn) {
            elements.seedLastNamesBtn.addEventListener('click', handleSeedLastNames);
        }
        
        // Edit Last Names button
        if (elements.editLastNamesBtn) {
            elements.editLastNamesBtn.addEventListener('click', openLastNamesModal);
        }
        
        // Close last names modal button
        if (elements.closeLastNamesModalBtn) {
            elements.closeLastNamesModalBtn.addEventListener('click', closeLastNamesModal);
        }
        
        // Cancel last names button
        if (elements.cancelLastNamesModalBtn) {
            elements.cancelLastNamesModalBtn.addEventListener('click', closeLastNamesModal);
        }
        
        // Save first names button
        if (elements.saveFirstNamesBtn) {
            elements.saveFirstNamesBtn.addEventListener('click', handleSaveFirstNames);
        }
        
        // Save last names button
        if (elements.saveLastNamesBtn) {
            elements.saveLastNamesBtn.addEventListener('click', handleSaveLastNames);
        }
        
        // Close first names modal on backdrop click
        if (elements.firstNamesModal) {
            elements.firstNamesModal.addEventListener('click', (e) => {
                if (e.target === elements.firstNamesModal) {
                    closeFirstNamesModal();
                }
            });
        }
        
        // Close last names modal on backdrop click
        if (elements.lastNamesModal) {
            elements.lastNamesModal.addEventListener('click', (e) => {
                if (e.target === elements.lastNamesModal) {
                    closeLastNamesModal();
                }
            });
        }
        
        // Close modals on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeFirstNamesModal();
                closeLastNamesModal();
            }
        });
        
        // Save on Ctrl+S / Cmd+S when modal is open
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                if (elements.firstNamesModal?.classList.contains('active')) {
                    e.preventDefault();
                    handleSaveFirstNames();
                } else if (elements.lastNamesModal?.classList.contains('active')) {
                    e.preventDefault();
                    handleSaveLastNames();
                }
            }
        });
        
        // ====== SEARCH & STATS ======
        
        // First names search
        if (elements.firstNamesSearch) {
            elements.firstNamesSearch.addEventListener('input', (e) => {
                const query = e.target.value;
                const text = elements.firstNamesTextarea?.value || '';
                const results = searchNames(text, query);
                showSearchResults('first', results, query);
            });
        }
        
        // Last names search
        if (elements.lastNamesSearch) {
            elements.lastNamesSearch.addEventListener('input', (e) => {
                const query = e.target.value;
                const text = elements.lastNamesTextarea?.value || '';
                const results = searchNames(text, query);
                showSearchResults('last', results, query);
            });
        }
        
        // First names textarea changes (update stats)
        if (elements.firstNamesTextarea) {
            elements.firstNamesTextarea.addEventListener('input', () => {
                const stats = parseNamesWithStats(elements.firstNamesTextarea.value);
                updateModalStats('first', stats);
            });
        }
        
        // Last names textarea changes (update stats)
        if (elements.lastNamesTextarea) {
            elements.lastNamesTextarea.addEventListener('input', () => {
                const stats = parseNamesWithStats(elements.lastNamesTextarea.value);
                updateModalStats('last', stats);
            });
        }
    }
    
    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    /**
     * Cache DOM element references
     */
    function cacheElements() {
        elements = {
            // First Names Dashboard elements
            firstNamesCount: document.getElementById('first-names-count'),
            firstNamesUpdated: document.getElementById('first-names-updated'),
            seedFirstNamesBtn: document.getElementById('seed-first-names-btn'),
            editFirstNamesBtn: document.getElementById('edit-first-names-btn'),
            
            // First Names Modal elements
            firstNamesModal: document.getElementById('first-names-modal'),
            firstNamesTextarea: document.getElementById('first-names-textarea'),
            closeModalBtn: document.getElementById('close-modal-btn'),
            cancelModalBtn: document.getElementById('cancel-modal-btn'),
            saveFirstNamesBtn: document.getElementById('save-first-names-btn'),
            firstNamesSearch: document.getElementById('first-names-search'),
            firstNamesTotalCount: document.getElementById('first-names-total-count'),
            firstNamesDuplicateCount: document.getElementById('first-names-duplicate-count'),
            firstNamesSearchResults: document.getElementById('first-names-search-results'),
            firstNamesSearchCount: document.getElementById('first-names-search-count'),
            firstNamesSearchList: document.getElementById('first-names-search-list'),
            
            // Last Names Dashboard elements
            lastNamesCount: document.getElementById('last-names-count'),
            lastNamesUpdated: document.getElementById('last-names-updated'),
            seedLastNamesBtn: document.getElementById('seed-last-names-btn'),
            editLastNamesBtn: document.getElementById('edit-last-names-btn'),
            
            // Last Names Modal elements
            lastNamesModal: document.getElementById('last-names-modal'),
            lastNamesTextarea: document.getElementById('last-names-textarea'),
            closeLastNamesModalBtn: document.getElementById('close-last-names-modal-btn'),
            cancelLastNamesModalBtn: document.getElementById('cancel-last-names-modal-btn'),
            saveLastNamesBtn: document.getElementById('save-last-names-btn'),
            lastNamesSearch: document.getElementById('last-names-search'),
            lastNamesTotalCount: document.getElementById('last-names-total-count'),
            lastNamesDuplicateCount: document.getElementById('last-names-duplicate-count'),
            lastNamesSearchResults: document.getElementById('last-names-search-results'),
            lastNamesSearchCount: document.getElementById('last-names-search-count'),
            lastNamesSearchList: document.getElementById('last-names-search-list'),
            
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
        openLastNamesModal,
        closeLastNamesModal,
        refresh: async () => {
            const status = await fetchStatus();
            updateDashboard(status);
        }
    };
    
})();
