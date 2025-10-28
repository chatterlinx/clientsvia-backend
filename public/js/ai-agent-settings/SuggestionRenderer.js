// ============================================================================
// SUGGESTION RENDERER - UI DISPLAY LOGIC FOR AI SUGGESTIONS
// ============================================================================
//
// Purpose: Render suggestion cards for each type with appropriate styling
//          and actions. Pure UI rendering - no business logic.
//
// Features:
//   - Type-specific card rendering (5 types)
//   - Priority badges and confidence indicators
//   - Impact metrics display
//   - One-click Apply/Ignore actions
//   - "View Analysis" modal trigger
//
// Card Types:
//   1. Filler Word Suggestion
//   2. Synonym Mapping Suggestion
//   3. Keyword Suggestion
//   4. Negative Keyword Suggestion
//   5. Missing Scenario Suggestion (NEW)
//
// ============================================================================

// ============================================================================
// CORE RENDERING FUNCTIONS
// ============================================================================

/**
 * Render a suggestion card based on type
 * 
 * @param {Object} suggestion - Suggestion object from API
 * @returns {HTMLElement} - Rendered card element
 * 
 * @example
 * const card = renderSuggestionCard(suggestion);
 * container.appendChild(card);
 */
function renderSuggestionCard(suggestion) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'suggestion-card bg-white border-2 rounded-xl p-5 shadow-md hover:shadow-xl transition-all';
    cardDiv.dataset.suggestionId = suggestion._id;
    cardDiv.dataset.suggestionType = suggestion.type;
    
    // Add priority border color
    const borderColorClass = getPriorityBorderClass(suggestion.priority);
    cardDiv.classList.add(borderColorClass);
    
    // Render type-specific content
    let content = '';
    switch (suggestion.type) {
        case 'filler':
            content = renderFillerCard(suggestion);
            break;
        case 'synonym':
            content = renderSynonymCard(suggestion);
            break;
        case 'keyword':
            content = renderKeywordCard(suggestion);
            break;
        case 'negative_keyword':
            content = renderNegativeKeywordCard(suggestion);
            break;
        case 'missing_scenario':
            content = renderMissingScenarioCard(suggestion);
            break;
        default:
            content = renderGenericCard(suggestion);
    }
    
    cardDiv.innerHTML = content;
    return cardDiv;
}

// ============================================================================
// TYPE-SPECIFIC CARD RENDERERS
// ============================================================================

/**
 * Render filler word suggestion card
 * @private
 */
function renderFillerCard(suggestion) {
    const scopeIcon = suggestion.categoryId ? '📁' : '🌐';
    const scopeText = suggestion.categoryId ? 'Category-level' : 'Template-wide';
    
    return `
        <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-filter text-gray-600 text-xl"></i>
                </div>
                <div>
                    <h3 class="font-bold text-gray-900 flex items-center gap-2">
                        Add Filler Word
                        ${renderPriorityBadge(suggestion.priority)}
                    </h3>
                    <p class="text-sm text-gray-600">${scopeIcon} ${scopeText}</p>
                </div>
            </div>
            ${renderConfidenceBadge(suggestion.confidence)}
        </div>
        
        <div class="bg-gray-50 rounded-lg p-4 mb-4">
            <div class="flex items-center gap-3">
                <span class="text-sm text-gray-600 font-semibold">Filler Word:</span>
                <span class="px-3 py-1 bg-gray-200 text-gray-800 rounded-full font-mono font-bold">${escapeHtml(suggestion.fillerWord)}</span>
            </div>
        </div>
        
        <div class="grid grid-cols-2 gap-3 mb-4 text-sm">
            <div>
                <span class="text-gray-600">Detected:</span>
                <span class="font-bold text-gray-900">${suggestion.frequency} time${suggestion.frequency > 1 ? 's' : ''}</span>
            </div>
            <div>
                <span class="text-gray-600">Impact:</span>
                <span class="font-bold text-green-600">+${suggestion.estimatedImpact || 0}%</span>
            </div>
        </div>
        
        ${renderCardActions(suggestion._id)}
    `;
}

/**
 * Render synonym mapping suggestion card
 * @private
 */
function renderSynonymCard(suggestion) {
    const scopeIcon = suggestion.categoryId ? '📁' : '🌐';
    const scopeText = suggestion.categoryId ? 'Category-level' : 'Template-wide';
    
    return `
        <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-language text-purple-600 text-xl"></i>
                </div>
                <div>
                    <h3 class="font-bold text-gray-900 flex items-center gap-2">
                        Add Synonym Mapping
                        ${renderPriorityBadge(suggestion.priority)}
                    </h3>
                    <p class="text-sm text-gray-600">${scopeIcon} ${scopeText}</p>
                </div>
            </div>
            ${renderConfidenceBadge(suggestion.confidence)}
        </div>
        
        <div class="bg-purple-50 rounded-lg p-4 mb-4">
            <div class="flex items-center justify-center gap-3">
                <span class="px-3 py-2 bg-white border-2 border-purple-200 text-purple-800 rounded-lg font-bold">
                    "${escapeHtml(suggestion.colloquialTerm)}"
                </span>
                <i class="fas fa-arrow-right text-purple-600 text-xl"></i>
                <span class="px-3 py-2 bg-purple-600 text-white rounded-lg font-bold">
                    "${escapeHtml(suggestion.technicalTerm)}"
                </span>
            </div>
            <p class="text-xs text-center text-gray-600 mt-2">Customers say → AI understands</p>
        </div>
        
        <div class="grid grid-cols-2 gap-3 mb-4 text-sm">
            <div>
                <span class="text-gray-600">Detected:</span>
                <span class="font-bold text-gray-900">${suggestion.frequency} time${suggestion.frequency > 1 ? 's' : ''}</span>
            </div>
            <div>
                <span class="text-gray-600">Impact:</span>
                <span class="font-bold text-green-600">+${suggestion.estimatedImpact || 0}%</span>
            </div>
        </div>
        
        ${renderCardActions(suggestion._id)}
    `;
}

/**
 * Render keyword suggestion card
 * @private
 */
function renderKeywordCard(suggestion) {
    return `
        <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-key text-blue-600 text-xl"></i>
                </div>
                <div>
                    <h3 class="font-bold text-gray-900 flex items-center gap-2">
                        Add Missing Keyword
                        ${renderPriorityBadge(suggestion.priority)}
                    </h3>
                    <p class="text-sm text-gray-600">🎯 Scenario-specific</p>
                </div>
            </div>
            ${renderConfidenceBadge(suggestion.confidence)}
        </div>
        
        <div class="bg-blue-50 rounded-lg p-4 mb-4">
            <div class="flex items-center gap-3 mb-2">
                <span class="text-sm text-gray-600 font-semibold">Keyword:</span>
                <span class="px-3 py-1 bg-blue-600 text-white rounded-full font-bold">${escapeHtml(suggestion.keyword)}</span>
            </div>
            ${suggestion.scenarioId ? `<p class="text-xs text-gray-600">For scenario: ${escapeHtml(suggestion.scenarioId)}</p>` : ''}
        </div>
        
        <div class="grid grid-cols-2 gap-3 mb-4 text-sm">
            <div>
                <span class="text-gray-600">Missed matches:</span>
                <span class="font-bold text-red-600">${suggestion.frequency}</span>
            </div>
            <div>
                <span class="text-gray-600">Impact:</span>
                <span class="font-bold text-green-600">+${suggestion.estimatedImpact || 0}%</span>
            </div>
        </div>
        
        ${renderCardActions(suggestion._id)}
    `;
}

/**
 * Render negative keyword suggestion card
 * @private
 */
function renderNegativeKeywordCard(suggestion) {
    return `
        <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-ban text-red-600 text-xl"></i>
                </div>
                <div>
                    <h3 class="font-bold text-gray-900 flex items-center gap-2">
                        Add Negative Keyword
                        ${renderPriorityBadge(suggestion.priority)}
                    </h3>
                    <p class="text-sm text-gray-600">🎯 Prevent false matches</p>
                </div>
            </div>
            ${renderConfidenceBadge(suggestion.confidence)}
        </div>
        
        <div class="bg-red-50 rounded-lg p-4 mb-4">
            <div class="flex items-center gap-3 mb-2">
                <span class="text-sm text-gray-600 font-semibold">Negative Keyword:</span>
                <span class="px-3 py-1 bg-red-600 text-white rounded-full font-bold">${escapeHtml(suggestion.keyword)}</span>
            </div>
            <p class="text-xs text-gray-600">Prevents mismatches when this word is present</p>
        </div>
        
        <div class="grid grid-cols-2 gap-3 mb-4 text-sm">
            <div>
                <span class="text-gray-600">False matches:</span>
                <span class="font-bold text-red-600">${suggestion.frequency}</span>
            </div>
            <div>
                <span class="text-gray-600">Impact:</span>
                <span class="font-bold text-green-600">+${suggestion.estimatedImpact || 0}%</span>
            </div>
        </div>
        
        ${renderCardActions(suggestion._id)}
    `;
}

/**
 * Render missing scenario suggestion card (NEW!)
 * @private
 */
function renderMissingScenarioCard(suggestion) {
    const keywords = (suggestion.suggestedKeywords || []).slice(0, 3);
    const moreCount = Math.max(0, (suggestion.suggestedKeywords || []).length - 3);
    
    return `
        <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-sparkles text-purple-600 text-xl"></i>
                </div>
                <div>
                    <h3 class="font-bold text-gray-900 flex items-center gap-2">
                        New Scenario Needed
                        ${renderPriorityBadge(suggestion.priority)}
                    </h3>
                    <p class="text-sm text-gray-600">🤖 AI-Generated</p>
                </div>
            </div>
            ${renderConfidenceBadge(suggestion.confidence)}
        </div>
        
        <div class="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-4 mb-4 border-2 border-purple-200">
            <h4 class="font-bold text-purple-900 mb-2 flex items-center gap-2">
                <i class="fas fa-lightbulb text-yellow-500"></i>
                ${escapeHtml(suggestion.suggestedScenarioName)}
            </h4>
            <p class="text-sm text-gray-700 mb-3">
                <strong>Category:</strong> ${escapeHtml(suggestion.suggestedCategory)}
            </p>
            <div class="flex flex-wrap gap-2 mb-2">
                ${keywords.map(kw => `<span class="px-2 py-1 bg-white text-purple-800 border border-purple-300 rounded-full text-xs font-semibold">${escapeHtml(kw)}</span>`).join('')}
                ${moreCount > 0 ? `<span class="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">+${moreCount} more</span>` : ''}
            </div>
            <p class="text-xs text-gray-600 mt-2">
                <i class="fas fa-chart-line mr-1"></i>
                Based on ${suggestion.frequency} Tier 3 calls
            </p>
        </div>
        
        <div class="grid grid-cols-3 gap-2 mb-4 text-sm">
            <div class="bg-gray-50 rounded p-2">
                <span class="text-gray-600 block text-xs">Tier 3 Calls</span>
                <span class="font-bold text-gray-900">${suggestion.frequency}</span>
            </div>
            <div class="bg-green-50 rounded p-2">
                <span class="text-gray-600 block text-xs">Est. Savings</span>
                <span class="font-bold text-green-600">${Math.round(suggestion.frequency * 0.02 * 100)/100} USD</span>
            </div>
            <div class="bg-blue-50 rounded p-2">
                <span class="text-gray-600 block text-xs">Impact</span>
                <span class="font-bold text-blue-600">+${suggestion.estimatedImpact || 0}%</span>
            </div>
        </div>
        
        ${renderCardActions(suggestion._id, true)}
    `;
}

/**
 * Render generic card for unknown types
 * @private
 */
function renderGenericCard(suggestion) {
    return `
        <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-question text-gray-600 text-xl"></i>
                </div>
                <div>
                    <h3 class="font-bold text-gray-900 flex items-center gap-2">
                        ${escapeHtml(suggestion.type)}
                        ${renderPriorityBadge(suggestion.priority)}
                    </h3>
                </div>
            </div>
            ${renderConfidenceBadge(suggestion.confidence)}
        </div>
        
        <div class="bg-gray-50 rounded-lg p-4 mb-4">
            <pre class="text-xs text-gray-700 whitespace-pre-wrap">${JSON.stringify(suggestion, null, 2)}</pre>
        </div>
        
        ${renderCardActions(suggestion._id)}
    `;
}

// ============================================================================
// HELPER UI COMPONENTS
// ============================================================================

/**
 * Render priority badge
 * @private
 */
function renderPriorityBadge(priority) {
    const badges = {
        critical: '<span class="px-2 py-1 bg-red-500 text-white text-xs rounded-full font-bold">CRITICAL</span>',
        high: '<span class="px-2 py-1 bg-orange-500 text-white text-xs rounded-full font-bold">HIGH</span>',
        medium: '<span class="px-2 py-1 bg-yellow-500 text-white text-xs rounded-full font-bold">MEDIUM</span>',
        low: '<span class="px-2 py-1 bg-gray-400 text-white text-xs rounded-full font-bold">LOW</span>'
    };
    return badges[priority] || badges.medium;
}

/**
 * Render confidence badge
 * @private
 */
function renderConfidenceBadge(confidence) {
    const percent = Math.round(confidence * 100);
    let colorClass = 'bg-gray-100 text-gray-700';
    
    if (percent >= 90) {
        colorClass = 'bg-green-100 text-green-700';
    } else if (percent >= 75) {
        colorClass = 'bg-blue-100 text-blue-700';
    } else if (percent >= 60) {
        colorClass = 'bg-yellow-100 text-yellow-700';
    }
    
    return `
        <div class="text-right">
            <div class="text-xs text-gray-500 mb-1">Confidence</div>
            <div class="px-3 py-1 ${colorClass} rounded-full font-bold text-sm">${percent}%</div>
        </div>
    `;
}

/**
 * Get priority border color class
 * @private
 */
function getPriorityBorderClass(priority) {
    const classes = {
        critical: 'border-red-300',
        high: 'border-orange-300',
        medium: 'border-yellow-300',
        low: 'border-gray-300'
    };
    return classes[priority] || classes.medium;
}

/**
 * Render card action buttons
 * @private
 */
function renderCardActions(suggestionId, showViewAnalysis = true) {
    return `
        <div class="flex gap-2 pt-3 border-t border-gray-200">
            <button onclick="applySuggestion('${suggestionId}')" 
                    class="flex-1 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-bold transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                <i class="fas fa-check"></i>
                Apply
            </button>
            <button onclick="ignoreSuggestion('${suggestionId}')" 
                    class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold transition-all flex items-center gap-2">
                <i class="fas fa-times"></i>
                Ignore
            </button>
            ${showViewAnalysis ? `
                <button onclick="viewFullAnalysis('${suggestionId}')" 
                        class="px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg font-semibold transition-all flex items-center gap-2"
                        title="View full call transcript and LLM reasoning">
                    <i class="fas fa-microscope"></i>
                    Details
                </button>
            ` : ''}
        </div>
    `;
}

/**
 * Escape HTML to prevent XSS
 * @private
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// EXPORTS (Module Pattern)
// ============================================================================

// Make functions available globally
window.SuggestionRenderer = {
    renderSuggestionCard,
    renderFillerCard,
    renderSynonymCard,
    renderKeywordCard,
    renderNegativeKeywordCard,
    renderMissingScenarioCard
};

console.log('✅ [SUGGESTION RENDERER] Loaded successfully');

