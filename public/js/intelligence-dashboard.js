/**
 * ============================================================================
 * INTELLIGENCE DASHBOARD - JavaScript Functions
 * ============================================================================
 * 
 * This file contains all JavaScript functions for the Intelligence Dashboard tab.
 * It works with the SuggestionManager to fetch, display, and manage AI optimization suggestions.
 * 
 * Load this file AFTER the manager classes are loaded.
 */

// ============================================
// GLOBAL STATE
// ============================================

let suggestionManager;
let synonymManager;
let fillerManager;
let testReportExporter;

let currentTemplateId = null;
let currentSuggestions = [];
let activeFilters = {
    type: '',
    priority: '',
    minConfidence: 0.7
};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize managers on page load
 */
function initializeManagers() {
    try {
        suggestionManager = new SuggestionManager();
        synonymManager = new SynonymManager();
        fillerManager = new FillerManager();
        testReportExporter = new TestReportExporter();
        
        console.log('✅ [INTELLIGENCE] All managers initialized successfully');
        
        // Auto-load suggestions if we're on the intelligence tab
        const intelligenceTab = document.getElementById('intelligence-tab');
        if (intelligenceTab && !intelligenceTab.classList.contains('hidden')) {
            loadSuggestions();
        }
        
    } catch (error) {
        console.error('❌ [INTELLIGENCE] Failed to initialize managers:', error);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeManagers);
} else {
    initializeManagers();
}

// ============================================
// SUGGESTION LOADING
// ============================================

/**
 * Load suggestions for current template
 */
async function loadSuggestions() {
    // Get current template ID from global state or dashboard
    currentTemplateId = window.currentDashboardTemplateId || window.activeTemplateId;
    
    if (!currentTemplateId) {
        console.warn('⚠️ [INTELLIGENCE] No template selected');
        showSuggestionsEmpty();
        return;
    }
    
    try {
        showLoadingState();
        
        const result = await suggestionManager.getSuggestions(
            currentTemplateId,
            activeFilters,
            true // force refresh
        );
        
        currentSuggestions = result.suggestions;
        
        // Update stats
        updateSuggestionStats(result.summary);
        
        // Render suggestions
        renderSuggestions(currentSuggestions);
        
        // Update badge
        updateIntelligenceBadge(result.summary.total || result.count || 0);
        
        console.log('✅ [INTELLIGENCE] Loaded', result.count, 'suggestions');
        
    } catch (error) {
        console.error('❌ [INTELLIGENCE] Failed to load suggestions:', error);
        showError(`Failed to load suggestions: ${error.message}`);
    }
}

/**
 * Update stats bar with counts
 */
function updateSuggestionStats(summary) {
    document.getElementById('stat-high').textContent = summary.high || 0;
    document.getElementById('stat-medium').textContent = summary.medium || 0;
    document.getElementById('stat-low').textContent = summary.low || 0;
    document.getElementById('stat-total').textContent = summary.total || 0;
}

/**
 * Update intelligence badge (notification count)
 */
function updateIntelligenceBadge(count) {
    const badge = document.getElementById('intelligence-badge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

// ============================================
// SUGGESTION RENDERING
// ============================================

/**
 * Render all suggestions
 */
function renderSuggestions(suggestions) {
    const container = document.getElementById('suggestions-container');
    const emptyState = document.getElementById('suggestions-empty');
    
    if (!container || !emptyState) {
        console.error('❌ [INTELLIGENCE] Container elements not found');
        return;
    }
    
    if (suggestions.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    emptyState.classList.add('hidden');
    container.innerHTML = suggestions.map(s => renderSuggestionCard(s)).join('');
}

/**
 * Render a single suggestion card
 */
function renderSuggestionCard(suggestion) {
    const priorityColors = {
        high: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100' },
        medium: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', badge: 'bg-yellow-100' },
        low: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', badge: 'bg-gray-100' }
    };
    
    const typeIcons = {
        filler: '🔇',
        synonym: '🔤',
        keyword: '🎯',
        negative_keyword: '⚠️',
        conflict: '🔀'
    };
    
    const typeNames = {
        filler: 'Filler Word',
        synonym: 'Synonym Mapping',
        keyword: 'Missing Keyword',
        negative_keyword: 'Negative Keyword',
        conflict: 'Keyword Conflict'
    };
    
    const colors = priorityColors[suggestion.priority] || priorityColors.medium;
    const suggestionId = suggestion._id || suggestion.id;
    
    return `
        <div class="bg-white rounded-lg shadow-sm border-2 ${colors.border} p-6 hover:shadow-md transition-all">
            <!-- Header -->
            <div class="flex items-start justify-between mb-4">
                <div class="flex items-center gap-3">
                    <div class="text-4xl">${typeIcons[suggestion.type] || '📋'}</div>
                    <div>
                        <h3 class="text-lg font-bold ${colors.text}">
                            ${typeNames[suggestion.type] || 'Unknown'}
                        </h3>
                        <p class="text-sm text-gray-600">
                            Priority: <span class="font-semibold">${suggestion.priority.toUpperCase()}</span>
                            | Confidence: <span class="font-semibold">${(suggestion.confidence * 100).toFixed(0)}%</span>
                            | Impact: <span class="font-semibold">+${suggestion.estimatedImpact || 0}%</span>
                        </p>
                    </div>
                </div>
                
                <div class="flex gap-2">
                    <button onclick="applySuggestion('${suggestionId}')" 
                            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors text-sm">
                        <i class="fas fa-check mr-1"></i> Apply
                    </button>
                    <button onclick="ignoreSuggestion('${suggestionId}')" 
                            class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold transition-colors text-sm">
                        <i class="fas fa-eye-slash mr-1"></i> Ignore
                    </button>
                    <button onclick="dismissSuggestion('${suggestionId}')" 
                            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors text-sm">
                        <i class="fas fa-times mr-1"></i> Dismiss
                    </button>
                </div>
            </div>
            
            <!-- Content -->
            <div class="mb-4">
                ${renderSuggestionContent(suggestion)}
            </div>
            
            <!-- Example Calls -->
            ${suggestion.contextPhrases && suggestion.contextPhrases.length > 0 ? `
                <div class="bg-gray-50 rounded-lg p-4">
                    <h4 class="text-sm font-semibold text-gray-700 mb-2">
                        <i class="fas fa-quote-left mr-1"></i> Example Phrases:
                    </h4>
                    <div class="space-y-2">
                        ${suggestion.contextPhrases.slice(0, 3).map(phrase => `
                            <div class="text-sm text-gray-600 italic">
                                "${phrase.substring(0, 100)}${phrase.length > 100 ? '...' : ''}"
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Render suggestion-specific content
 */
function renderSuggestionContent(suggestion) {
    switch (suggestion.type) {
        case 'filler':
            return `
                <p class="text-gray-700">
                    Add "<span class="font-bold text-blue-600">${suggestion.word || suggestion.fillerWord || 'unknown'}</span>" to filler list
                    <span class="text-sm text-gray-500">(appears ${suggestion.frequency || 0} times in test calls)</span>
                </p>
            `;
        
        case 'synonym':
            return `
                <p class="text-gray-700">
                    Map "<span class="font-bold text-blue-600">${suggestion.colloquialTerm || 'unknown'}</span>" 
                    → "<span class="font-bold text-green-600">${suggestion.technicalTerm || 'unknown'}</span>"
                    <span class="text-sm text-gray-500">(appears ${suggestion.frequency || 0} times)</span>
                </p>
            `;
        
        case 'keyword':
            return `
                <p class="text-gray-700">
                    Add keyword "<span class="font-bold text-blue-600">${suggestion.keyword || suggestion.missingKeyword || 'unknown'}</span>" to scenario
                    <span class="text-sm text-gray-500">(missing in ${suggestion.frequency || 0} failed matches)</span>
                </p>
            `;
        
        case 'negative_keyword':
            return `
                <p class="text-gray-700">
                    Add negative keyword "<span class="font-bold text-red-600">${suggestion.keyword || 'unknown'}</span>"
                    <span class="text-sm text-gray-500">(prevents false matches)</span>
                </p>
            `;
        
        case 'conflict':
            const details = suggestion.conflictDetails || {};
            return `
                <p class="text-gray-700">
                    Conflict detected between scenarios:
                    <span class="font-bold">${details.scenarioA || 'Scenario A'}</span> and 
                    <span class="font-bold">${details.scenarioB || 'Scenario B'}</span>
                    <br>
                    <span class="text-sm text-gray-500">
                        Overlapping keywords: ${(details.overlappingKeywords || []).join(', ') || 'none'}
                    </span>
                </p>
            `;
        
        default:
            return '<p class="text-gray-500">Unknown suggestion type</p>';
    }
}

// ============================================
// SUGGESTION ACTIONS
// ============================================

/**
 * Apply a suggestion
 */
async function applySuggestion(suggestionId) {
    if (!confirm('Apply this suggestion? This will update your template immediately.')) {
        return;
    }
    
    try {
        showLoadingState();
        
        await suggestionManager.applySuggestion(currentTemplateId, suggestionId);
        
        alert('✅ Suggestion applied successfully!');
        
        // Reload suggestions
        await loadSuggestions();
        
    } catch (error) {
        console.error('❌ [INTELLIGENCE] Failed to apply suggestion:', error);
        alert(`❌ Failed to apply: ${error.message}`);
    }
}

/**
 * Ignore a suggestion
 */
async function ignoreSuggestion(suggestionId) {
    const reason = prompt('Why are you ignoring this suggestion? (optional)');
    
    try {
        showLoadingState();
        
        await suggestionManager.ignoreSuggestion(currentTemplateId, suggestionId, reason || '');
        
        console.log('✅ [INTELLIGENCE] Suggestion ignored');
        
        // Reload suggestions
        await loadSuggestions();
        
    } catch (error) {
        console.error('❌ [INTELLIGENCE] Failed to ignore suggestion:', error);
        alert(`❌ Failed to ignore: ${error.message}`);
    }
}

/**
 * Dismiss a suggestion permanently
 */
async function dismissSuggestion(suggestionId) {
    if (!confirm('Permanently dismiss this suggestion? This cannot be undone.')) {
        return;
    }
    
    try {
        showLoadingState();
        
        await suggestionManager.dismissSuggestion(currentTemplateId, suggestionId);
        
        console.log('✅ [INTELLIGENCE] Suggestion dismissed');
        
        // Reload suggestions
        await loadSuggestions();
        
    } catch (error) {
        console.error('❌ [INTELLIGENCE] Failed to dismiss suggestion:', error);
        alert(`❌ Failed to dismiss: ${error.message}`);
    }
}

// ============================================
// BATCH OPERATIONS
// ============================================

/**
 * Apply all high-priority suggestions
 */
async function applyAllHighPriority() {
    if (!confirm('Apply ALL high-priority suggestions? This may take a moment.')) {
        return;
    }
    
    try {
        showLoadingState();
        
        const result = await suggestionManager.applyAllHighPriority(currentTemplateId);
        
        alert(`✅ Applied ${result.success} suggestions! ${result.failed > 0 ? `(${result.failed} failed)` : ''}`);
        
        // Reload suggestions
        await loadSuggestions();
        
    } catch (error) {
        console.error('❌ [INTELLIGENCE] Batch apply failed:', error);
        alert(`❌ Batch apply failed: ${error.message}`);
    }
}

/**
 * Ignore all low-priority suggestions
 */
async function ignoreAllLowPriority() {
    if (!confirm('Ignore ALL low-priority suggestions?')) {
        return;
    }
    
    try {
        showLoadingState();
        
        const result = await suggestionManager.ignoreAllLowPriority(currentTemplateId, 'Bulk ignore: low priority');
        
        console.log(`✅ [INTELLIGENCE] Ignored ${result.success} suggestions`);
        
        // Reload suggestions
        await loadSuggestions();
        
    } catch (error) {
        console.error('❌ [INTELLIGENCE] Batch ignore failed:', error);
        alert(`❌ Batch ignore failed: ${error.message}`);
    }
}

// ============================================
// FILTERING
// ============================================

/**
 * Filter suggestions by priority
 */
function filterSuggestionsByPriority(priority) {
    activeFilters.priority = priority === 'all' ? '' : priority;
    applySuggestionFilters();
}

/**
 * Apply all active filters
 */
function applySuggestionFilters() {
    const typeSelect = document.getElementById('filter-type');
    const confidenceSelect = document.getElementById('filter-confidence');
    
    if (typeSelect) {
        activeFilters.type = typeSelect.value;
    }
    
    if (confidenceSelect) {
        activeFilters.minConfidence = parseFloat(confidenceSelect.value);
    }
    
    loadSuggestions();
}

/**
 * Refresh suggestions
 */
function refreshSuggestions() {
    loadSuggestions();
}

// ============================================
// UI HELPERS
// ============================================

/**
 * Show loading state
 */
function showLoadingState() {
    const container = document.getElementById('suggestions-container');
    if (container) {
        container.classList.remove('hidden');
        container.innerHTML = `
            <div class="text-center py-12">
                <i class="fas fa-spinner fa-spin text-4xl text-blue-500 mb-4"></i>
                <p class="text-gray-600">Loading suggestions...</p>
            </div>
        `;
    }
}

/**
 * Show empty state
 */
function showSuggestionsEmpty() {
    const container = document.getElementById('suggestions-container');
    const emptyState = document.getElementById('suggestions-empty');
    
    if (container) {
        container.innerHTML = '';
        container.classList.add('hidden');
    }
    
    if (emptyState) {
        emptyState.classList.remove('hidden');
    }
}

/**
 * Show error message
 */
function showError(message) {
    const container = document.getElementById('suggestions-container');
    if (container) {
        container.classList.remove('hidden');
        container.innerHTML = `
            <div class="text-center py-12">
                <i class="fas fa-exclamation-triangle text-4xl text-red-500 mb-4"></i>
                <p class="text-gray-600">${message}</p>
                <button onclick="loadSuggestions()" class="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors">
                    <i class="fas fa-redo mr-2"></i>
                    Try Again
                </button>
            </div>
        `;
    }
}

/**
 * Show "How to Analyze" info
 */
function showHowToAnalyze() {
    alert(`📚 How to Generate Suggestions:

1. Go to the "Overview" tab
2. Run test calls using the Test Phrase Library
3. After running 10+ test calls, come back to Intelligence tab
4. Suggestions will appear automatically

Or you can trigger manual analysis by running test calls through the API.

The system analyzes:
- Frequently occurring words (potential fillers)
- Colloquial terms that could be synonyms
- Keywords missing from scenarios
- Conflicts between scenarios`);
}

// ============================================
// EXPORTS (for use in main file)
// ============================================

// Make functions globally available
window.loadSuggestions = loadSuggestions;
window.applySuggestion = applySuggestion;
window.ignoreSuggestion = ignoreSuggestion;
window.dismissSuggestion = dismissSuggestion;
window.applyAllHighPriority = applyAllHighPriority;
window.ignoreAllLowPriority = ignoreAllLowPriority;
window.filterSuggestionsByPriority = filterSuggestionsByPriority;
window.applySuggestionFilters = applySuggestionFilters;
window.refreshSuggestions = refreshSuggestions;
window.showHowToAnalyze = showHowToAnalyze;

console.log('✅ [INTELLIGENCE] Dashboard JavaScript loaded');

