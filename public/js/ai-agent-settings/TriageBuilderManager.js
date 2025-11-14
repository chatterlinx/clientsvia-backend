/**
 * ============================================================================
 * TRIAGE BUILDER MANAGER
 * ============================================================================
 * 
 * Frontend controller for the LLM Triage Builder admin tool
 * 
 * Purpose: Admin content generator for creating service type triage packages
 * 
 * Features:
 * - Collect trade, situation, service type inputs
 * - Call backend LLM endpoint
 * - Display 3-section output with copy buttons
 * - Error handling and validation
 * 
 * Does NOT:
 * - Save to MongoDB
 * - Integrate into runtime logic
 * - Auto-apply to company templates
 * 
 * ============================================================================
 */

class TriageBuilderManager {
    constructor() {
        this.form = document.getElementById('triage-builder-form');
        this.generateBtn = document.getElementById('generate-btn');
        this.errorContainer = document.getElementById('error-container');
        this.errorMessage = document.getElementById('error-message');
        this.resultsContainer = document.getElementById('results-container');
        
        // Result elements
        this.frontlineContent = document.getElementById('frontline-content');
        this.frontlineStats = document.getElementById('frontline-stats');
        this.cheatsheetContent = document.getElementById('cheatsheet-content');
        this.cheatsheetStats = document.getElementById('cheatsheet-stats');
        this.responseLibraryContainer = document.getElementById('response-library-container');
        this.responseStats = document.getElementById('response-stats');
        
        // State
        this.isGenerating = false;
        this.currentResults = null;
        
        this.init();
    }
    
    init() {
        console.log('[TRIAGE BUILDER] Initializing...');
        
        // Form submission
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleGenerate();
        });
        
        // Copy buttons
        document.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const section = e.currentTarget.dataset.section;
                this.handleCopy(section);
            });
        });
        
        console.log('✅ [TRIAGE BUILDER] Initialized');
    }
    
    /**
     * Handle generate button click
     */
    async handleGenerate() {
        if (this.isGenerating) {
            console.warn('[TRIAGE BUILDER] Already generating, ignoring duplicate request');
            return;
        }
        
        console.log('[TRIAGE BUILDER] Generate button clicked');
        
        // Validate inputs
        const trade = document.getElementById('trade-select').value;
        const situation = document.getElementById('situation-textarea').value.trim();
        const serviceTypes = this.getSelectedServiceTypes();
        
        if (!trade) {
            this.showError('Please select a trade/industry');
            return;
        }
        
        if (!situation) {
            this.showError('Please describe the triage situation');
            return;
        }
        
        if (serviceTypes.length === 0) {
            this.showError('Please select at least one service type');
            return;
        }
        
        console.log('[TRIAGE BUILDER] Input validation passed', { trade, situation, serviceTypes });
        
        // Hide previous results/errors
        this.hideError();
        this.hideResults();
        
        // Show loading state
        this.setGenerating(true);
        
        try {
            // Call API
            const result = await this.callGenerateAPI(trade, situation, serviceTypes);
            
            console.log('[TRIAGE BUILDER] Generation successful', {
                frontlineLength: result.frontlineIntelSection.length,
                cheatsheetLength: result.cheatSheetTriageMap.length,
                responseCount: result.responseLibrary.length
            });
            
            // Store results
            this.currentResults = result;
            
            // Display results
            this.displayResults(result);
            
        } catch (error) {
            console.error('[TRIAGE BUILDER] Generation failed:', error);
            this.showError(error.message || 'An unexpected error occurred');
        } finally {
            this.setGenerating(false);
        }
    }
    
    /**
     * Get selected service types from checkboxes
     */
    getSelectedServiceTypes() {
        const serviceTypes = [];
        
        if (document.getElementById('service-repair').checked) {
            serviceTypes.push('REPAIR');
        }
        if (document.getElementById('service-maintenance').checked) {
            serviceTypes.push('MAINTENANCE');
        }
        if (document.getElementById('service-emergency').checked) {
            serviceTypes.push('EMERGENCY');
        }
        if (document.getElementById('service-other').checked) {
            serviceTypes.push('OTHER');
        }
        
        return serviceTypes;
    }
    
    /**
     * Call backend generate endpoint
     */
    async callGenerateAPI(trade, situation, serviceTypes) {
        const token = localStorage.getItem('jwt');
        
        if (!token) {
            throw new Error('Authentication required. Please log in.');
        }
        
        console.log('[TRIAGE BUILDER] Calling API endpoint...');
        
        const response = await fetch('/api/admin/triage-builder/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                trade,
                situation,
                serviceTypes
            })
        });
        
        console.log('[TRIAGE BUILDER] API response status:', response.status);
        
        if (!response.ok) {
            // Try to extract error message
            let errorMsg = `HTTP ${response.status}`;
            
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch (e) {
                // Failed to parse error JSON
            }
            
            throw new Error(errorMsg);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Generation failed');
        }
        
        // Validate response structure
        if (!data.frontlineIntelSection || !data.cheatSheetTriageMap || !data.responseLibrary) {
            throw new Error('Invalid response structure from API');
        }
        
        return {
            frontlineIntelSection: data.frontlineIntelSection,
            cheatSheetTriageMap: data.cheatSheetTriageMap,
            responseLibrary: data.responseLibrary
        };
    }
    
    /**
     * Display results in UI
     */
    displayResults(result) {
        console.log('[TRIAGE BUILDER] Displaying results');
        
        // Section 1: Frontline Intel
        this.frontlineContent.textContent = result.frontlineIntelSection;
        this.frontlineStats.textContent = `${result.frontlineIntelSection.length} chars`;
        
        // Section 2: Cheat Sheet
        this.cheatsheetContent.textContent = result.cheatSheetTriageMap;
        this.cheatsheetStats.textContent = `${result.cheatSheetTriageMap.length} chars`;
        
        // Section 3: Response Library
        this.responseStats.textContent = `${result.responseLibrary.length} responses`;
        this.responseLibraryContainer.innerHTML = '';
        
        result.responseLibrary.forEach((response, index) => {
            const item = document.createElement('div');
            item.className = 'response-library-item';
            
            item.innerHTML = `
                <div class="number">${index + 1}.</div>
                <div class="text">${this.escapeHtml(response)}</div>
                <button class="btn btn-copy btn-sm" data-response-index="${index}">
                    <i class="fas fa-copy me-1"></i>
                    Copy
                </button>
            `;
            
            // Add copy listener for individual response
            const copyBtn = item.querySelector('.btn-copy');
            copyBtn.addEventListener('click', () => {
                this.copyToClipboard(response, copyBtn);
            });
            
            this.responseLibraryContainer.appendChild(item);
        });
        
        // Show results container
        this.showResults();
    }
    
    /**
     * Handle copy button clicks
     */
    handleCopy(section) {
        if (!this.currentResults) {
            console.warn('[TRIAGE BUILDER] No results to copy');
            return;
        }
        
        let content = '';
        let button = null;
        
        switch (section) {
            case 'frontline':
                content = this.currentResults.frontlineIntelSection;
                button = document.querySelector('[data-section="frontline"]');
                break;
            case 'cheatsheet':
                content = this.currentResults.cheatSheetTriageMap;
                button = document.querySelector('[data-section="cheatsheet"]');
                break;
            case 'responses':
                content = this.currentResults.responseLibrary.join('\n\n');
                button = document.querySelector('[data-section="responses"]');
                break;
            default:
                console.error('[TRIAGE BUILDER] Unknown section:', section);
                return;
        }
        
        this.copyToClipboard(content, button);
    }
    
    /**
     * Copy content to clipboard
     */
    async copyToClipboard(content, button) {
        try {
            await navigator.clipboard.writeText(content);
            
            // Visual feedback
            if (button) {
                const originalHTML = button.innerHTML;
                button.classList.add('copied');
                button.innerHTML = '<i class="fas fa-check me-1"></i>Copied!';
                
                setTimeout(() => {
                    button.classList.remove('copied');
                    button.innerHTML = originalHTML;
                }, 2000);
            }
            
            console.log('[TRIAGE BUILDER] Content copied to clipboard');
        } catch (error) {
            console.error('[TRIAGE BUILDER] Failed to copy:', error);
            alert('Failed to copy to clipboard. Please try again.');
        }
    }
    
    /**
     * Set generating state (loading)
     */
    setGenerating(isGenerating) {
        this.isGenerating = isGenerating;
        
        if (isGenerating) {
            this.generateBtn.disabled = true;
            this.generateBtn.innerHTML = `
                <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                Generating...
            `;
        } else {
            this.generateBtn.disabled = false;
            this.generateBtn.innerHTML = `
                <i class="fas fa-sparkles me-2"></i>
                Generate Triage Package
            `;
        }
    }
    
    /**
     * Show error message
     */
    showError(message) {
        this.errorMessage.textContent = message;
        this.errorContainer.style.display = 'block';
        
        // Scroll to error
        this.errorContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    /**
     * Hide error message
     */
    hideError() {
        this.errorContainer.style.display = 'none';
    }
    
    /**
     * Show results container
     */
    showResults() {
        this.resultsContainer.classList.add('show');
        
        // Scroll to results
        setTimeout(() => {
            this.resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
    
    /**
     * Hide results container
     */
    hideResults() {
        this.resultsContainer.classList.remove('show');
    }
    
    /**
     * Escape HTML for safe display
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export to window for global access
window.TriageBuilderManager = TriageBuilderManager;

console.log('✅ [TRIAGE BUILDER] Manager class loaded');

