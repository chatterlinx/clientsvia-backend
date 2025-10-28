// ============================================================================
// SUGGESTION ANALYSIS MODAL - FULL LLM CONTEXT VIEWER
// ============================================================================
//
// Purpose: Display comprehensive analysis for AI suggestions including:
//          - Call transcript with timestamps
//          - LLM reasoning and confidence breakdown
//          - Pre-filled suggestion details
//          - Impact metrics (cost savings, performance)
//          - Apply/Customize actions
//
// Features:
//   - Beautiful, responsive modal design
//   - Syntax-highlighted transcript
//   - Formatted LLM reasoning
//   - Type-specific suggestion display
//   - One-click apply or customize
//   - Loading states and error handling
//
// ============================================================================

// ============================================================================
// MODAL STATE
// ============================================================================

let currentAnalysisData = null;
let modalElement = null;

// ============================================================================
// CORE MODAL FUNCTIONS
// ============================================================================

/**
 * Open full analysis modal for a suggestion
 * 
 * @param {String} suggestionId - Suggestion ID to analyze
 * 
 * @example
 * viewFullAnalysis('abc123');
 */
async function viewFullAnalysis(suggestionId) {
    try {
        // Show loading modal
        showLoadingModal();
        
        // Fetch full context from API
        const response = await fetch(`/api/admin/global-instant-responses/suggestions/${suggestionId}/context`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch context: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error('Failed to load suggestion context');
        }
        
        currentAnalysisData = data;
        
        // Render full modal
        renderAnalysisModal(data);
        
    } catch (error) {
        console.error('[ANALYSIS MODAL] Error:', error);
        showErrorModal(error.message);
        
        // Send error notification to backend
        try {
            await window.FrontendErrorReporter?.reportError({
                component: 'SuggestionAnalysisModal',
                operation: 'viewFullAnalysis',
                error: error.message,
                userMessage: 'Failed to load suggestion analysis. Please try again.'
            });
        } catch (notifError) {
            console.error('[ANALYSIS MODAL] Failed to send error notification:', notifError);
        }
    }
}

/**
 * Show loading modal
 * @private
 */
function showLoadingModal() {
    const html = `
        <div id="analysis-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div class="p-12 text-center">
                    <div class="animate-spin rounded-full h-16 w-16 border-b-4 border-purple-600 mx-auto mb-4"></div>
                    <p class="text-gray-600 font-semibold">Loading full analysis...</p>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    closeAnalysisModal();
    
    // Add to body
    document.body.insertAdjacentHTML('beforeend', html);
    modalElement = document.getElementById('analysis-modal');
}

/**
 * Show error modal
 * @private
 */
function showErrorModal(errorMessage) {
    const html = `
        <div id="analysis-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full">
                <div class="bg-gradient-to-r from-red-600 to-pink-600 p-6 rounded-t-2xl">
                    <h2 class="text-2xl font-bold text-white flex items-center gap-3">
                        <i class="fas fa-exclamation-circle"></i>
                        Error Loading Analysis
                    </h2>
                </div>
                <div class="p-8 text-center">
                    <i class="fas fa-times-circle text-red-500 text-6xl mb-4"></i>
                    <p class="text-gray-700 mb-6">${escapeHtml(errorMessage)}</p>
                    <button onclick="closeAnalysisModal()" 
                            class="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-bold transition-all">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal
    closeAnalysisModal();
    
    // Add to body
    document.body.insertAdjacentHTML('beforeend', html);
    modalElement = document.getElementById('analysis-modal');
}

/**
 * Render full analysis modal
 * @private
 */
function renderAnalysisModal(data) {
    const { suggestion, call, template, impactMetrics } = data;
    
    const html = `
        <div id="analysis-modal" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col">
                
                <!-- Header (Fixed) -->
                <div class="bg-gradient-to-r from-purple-600 to-pink-600 p-6 rounded-t-2xl flex items-center justify-between flex-shrink-0">
                    <div>
                        <h2 class="text-2xl font-bold text-white flex items-center gap-3">
                            <i class="fas fa-microscope"></i>
                            Full AI Analysis
                        </h2>
                        <p class="text-purple-100 text-sm mt-1">Deep dive into LLM reasoning and call context</p>
                    </div>
                    <button onclick="closeAnalysisModal()" 
                            class="text-white hover:text-gray-200 transition-colors">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                
                <!-- Scrollable Content -->
                <div class="flex-1 overflow-y-auto p-8 space-y-6">
                    
                    ${renderSuggestionSummary(suggestion)}
                    
                    ${call ? renderCallDetails(call) : ''}
                    
                    ${call ? renderTranscriptSection(call) : ''}
                    
                    ${suggestion.llmReasoning ? renderLLMReasoningSection(suggestion) : ''}
                    
                    ${renderSuggestedActionSection(suggestion)}
                    
                    ${renderImpactMetricsSection(impactMetrics)}
                    
                </div>
                
                <!-- Footer Actions (Fixed) -->
                <div class="border-t border-gray-200 p-6 flex gap-3 flex-shrink-0">
                    <button onclick="applyFromModal('${suggestion._id}')" 
                            class="flex-1 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-bold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2">
                        <i class="fas fa-check-circle"></i>
                        Apply Suggestion
                    </button>
                    <button onclick="customizeAndApply('${suggestion._id}')" 
                            class="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold transition-all flex items-center gap-2">
                        <i class="fas fa-edit"></i>
                        Customize & Apply
                    </button>
                    <button onclick="closeAnalysisModal()" 
                            class="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition-all">
                        Close
                    </button>
                </div>
                
            </div>
        </div>
    `;
    
    // Remove existing modal
    closeAnalysisModal();
    
    // Add to body
    document.body.insertAdjacentHTML('beforeend', html);
    modalElement = document.getElementById('analysis-modal');
}

// ============================================================================
// SECTION RENDERERS
// ============================================================================

/**
 * Render suggestion summary section
 * @private
 */
function renderSuggestionSummary(suggestion) {
    const typeIcons = {
        filler: 'fa-filter',
        synonym: 'fa-language',
        keyword: 'fa-key',
        negative_keyword: 'fa-ban',
        missing_scenario: 'fa-sparkles'
    };
    
    const typeLabels = {
        filler: 'Filler Word',
        synonym: 'Synonym Mapping',
        keyword: 'Missing Keyword',
        negative_keyword: 'Negative Keyword',
        missing_scenario: 'Missing Scenario'
    };
    
    const icon = typeIcons[suggestion.type] || 'fa-question';
    const label = typeLabels[suggestion.type] || suggestion.type;
    
    return `
        <div class="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-6 border-2 border-purple-200">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-2xl font-bold text-gray-900 flex items-center gap-3">
                    <i class="fas ${icon} text-purple-600"></i>
                    ${escapeHtml(label)}
                </h3>
                <div class="flex items-center gap-3">
                    ${renderPriorityBadge(suggestion.priority)}
                    ${renderConfidenceBadge(suggestion.confidence)}
                </div>
            </div>
            
            ${renderSuggestionDetails(suggestion)}
        </div>
    `;
}

/**
 * Render type-specific suggestion details
 * @private
 */
function renderSuggestionDetails(suggestion) {
    switch (suggestion.type) {
        case 'missing_scenario':
            return renderMissingScenarioDetails(suggestion);
        case 'synonym':
            return `
                <div class="flex items-center justify-center gap-4 bg-white rounded-lg p-4">
                    <span class="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg font-bold text-lg">"${escapeHtml(suggestion.colloquialTerm)}"</span>
                    <i class="fas fa-arrow-right text-purple-600 text-2xl"></i>
                    <span class="px-4 py-2 bg-purple-600 text-white rounded-lg font-bold text-lg">"${escapeHtml(suggestion.technicalTerm)}"</span>
                </div>
            `;
        case 'filler':
            return `
                <div class="bg-white rounded-lg p-4">
                    <span class="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg font-bold text-lg font-mono">${escapeHtml(suggestion.fillerWord)}</span>
                </div>
            `;
        case 'keyword':
        case 'negative_keyword':
            return `
                <div class="bg-white rounded-lg p-4">
                    <span class="px-4 py-2 ${suggestion.type === 'negative_keyword' ? 'bg-red-600' : 'bg-blue-600'} text-white rounded-lg font-bold text-lg">${escapeHtml(suggestion.keyword)}</span>
                </div>
            `;
        default:
            return '';
    }
}

/**
 * Render missing scenario details
 * @private
 */
function renderMissingScenarioDetails(suggestion) {
    return `
        <div class="space-y-3">
            <div class="bg-white rounded-lg p-4">
                <span class="text-sm text-gray-600 font-semibold">Scenario Name:</span>
                <p class="text-lg font-bold text-gray-900 mt-1">${escapeHtml(suggestion.suggestedScenarioName)}</p>
            </div>
            <div class="bg-white rounded-lg p-4">
                <span class="text-sm text-gray-600 font-semibold">Category:</span>
                <p class="text-lg font-bold text-gray-900 mt-1">${escapeHtml(suggestion.suggestedCategory)}</p>
            </div>
            <div class="bg-white rounded-lg p-4">
                <span class="text-sm text-gray-600 font-semibold">Keywords:</span>
                <div class="flex flex-wrap gap-2 mt-2">
                    ${(suggestion.suggestedKeywords || []).map(kw => `
                        <span class="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-semibold">${escapeHtml(kw)}</span>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * Render call details section
 * @private
 */
function renderCallDetails(call) {
    return `
        <div class="bg-white rounded-xl p-6 border-2 border-gray-200">
            <h3 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <i class="fas fa-phone text-blue-600"></i>
                Call Details
            </h3>
            <div class="grid grid-cols-2 gap-4 text-sm">
                <div>
                    <span class="text-gray-600">Company:</span>
                    <p class="font-bold text-gray-900">${escapeHtml(call.companyName)}</p>
                </div>
                <div>
                    <span class="text-gray-600">Caller:</span>
                    <p class="font-bold text-gray-900">${escapeHtml(call.callerPhone)}</p>
                </div>
                <div>
                    <span class="text-gray-600">Date:</span>
                    <p class="font-bold text-gray-900">${new Date(call.timestamp).toLocaleString()}</p>
                </div>
                <div>
                    <span class="text-gray-600">Duration:</span>
                    <p class="font-bold text-gray-900">${call.duration ? `${call.duration}s` : 'N/A'}</p>
                </div>
                <div>
                    <span class="text-gray-600">Tier:</span>
                    <p class="font-bold text-purple-600">Tier ${call.tier} (LLM)</p>
                </div>
                <div>
                    <span class="text-gray-600">Cost:</span>
                    <p class="font-bold text-red-600">$${(call.cost || 0).toFixed(3)}</p>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render transcript section
 * @private
 */
function renderTranscriptSection(call) {
    if (!call.transcript || call.transcript.length === 0) {
        return '';
    }
    
    const transcriptLines = call.transcript.map(line => {
        const speakerClass = line.speaker === 'AI' ? 'bg-blue-50 border-l-4 border-blue-500' : 'bg-gray-50 border-l-4 border-gray-400';
        return `
            <div class="p-3 ${speakerClass} rounded-r-lg">
                <div class="flex items-center gap-3 mb-1">
                    ${line.timestamp ? `<span class="text-xs text-gray-500 font-mono">${line.timestamp}</span>` : ''}
                    ${line.speaker ? `<span class="text-xs font-bold ${line.speaker === 'AI' ? 'text-blue-600' : 'text-gray-700'}">${escapeHtml(line.speaker)}</span>` : ''}
                </div>
                <p class="text-gray-800">${escapeHtml(line.message)}</p>
            </div>
        `;
    }).join('');
    
    return `
        <div class="bg-white rounded-xl p-6 border-2 border-gray-200">
            <h3 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <i class="fas fa-file-alt text-green-600"></i>
                Call Transcript
            </h3>
            <div class="space-y-2 max-h-96 overflow-y-auto">
                ${transcriptLines}
            </div>
        </div>
    `;
}

/**
 * Render LLM reasoning section
 * @private
 */
function renderLLMReasoningSection(suggestion) {
    return `
        <div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 border-2 border-blue-200">
            <h3 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <i class="fas fa-brain text-indigo-600"></i>
                LLM Reasoning
                ${suggestion.llmModel ? `<span class="text-sm font-normal text-gray-600">(${escapeHtml(suggestion.llmModel)})</span>` : ''}
            </h3>
            <div class="bg-white rounded-lg p-4 text-gray-800 leading-relaxed">
                ${formatLLMReasoning(suggestion.llmReasoning)}
            </div>
        </div>
    `;
}

/**
 * Render suggested action section
 * @private
 */
function renderSuggestedActionSection(suggestion) {
    if (suggestion.type !== 'missing_scenario') return '';
    
    return `
        <div class="bg-white rounded-xl p-6 border-2 border-gray-200">
            <h3 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <i class="fas fa-cogs text-orange-600"></i>
                Pre-filled Scenario Configuration
            </h3>
            <div class="space-y-4">
                ${suggestion.suggestedResponse ? `
                    <div>
                        <label class="text-sm text-gray-600 font-semibold">AI Response:</label>
                        <div class="bg-gray-50 rounded-lg p-4 mt-1 text-gray-800 font-mono text-sm">
                            ${escapeHtml(suggestion.suggestedResponse)}
                        </div>
                    </div>
                ` : ''}
                ${suggestion.suggestedBehavior ? `
                    <div>
                        <label class="text-sm text-gray-600 font-semibold">Behavior:</label>
                        <p class="text-gray-900 font-bold mt-1">${escapeHtml(suggestion.suggestedBehavior)}</p>
                    </div>
                ` : ''}
                ${suggestion.suggestedActionHook ? `
                    <div>
                        <label class="text-sm text-gray-600 font-semibold">Action Hook:</label>
                        <p class="text-gray-900 font-bold mt-1">${escapeHtml(suggestion.suggestedActionHook)}</p>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Render impact metrics section
 * @private
 */
function renderImpactMetricsSection(metrics) {
    if (!metrics) return '';
    
    return `
        <div class="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-6 border-2 border-green-200">
            <h3 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <i class="fas fa-chart-line text-green-600"></i>
                Impact Metrics
            </h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div class="bg-white rounded-lg p-4 text-center">
                    <p class="text-sm text-gray-600 mb-1">Calls Affected</p>
                    <p class="text-2xl font-bold text-gray-900">${metrics.callsAffected}</p>
                </div>
                <div class="bg-white rounded-lg p-4 text-center">
                    <p class="text-sm text-gray-600 mb-1">Monthly Savings</p>
                    <p class="text-2xl font-bold text-green-600">$${metrics.monthlySavings}</p>
                </div>
                <div class="bg-white rounded-lg p-4 text-center">
                    <p class="text-sm text-gray-600 mb-1">Yearly Savings</p>
                    <p class="text-2xl font-bold text-green-600">$${metrics.yearlySavings}</p>
                </div>
                <div class="bg-white rounded-lg p-4 text-center">
                    <p class="text-sm text-gray-600 mb-1">Speed Boost</p>
                    <p class="text-2xl font-bold text-blue-600">${metrics.responseTimeImprovementPercent}%</p>
                </div>
            </div>
        </div>
    `;
}

// ============================================================================
// MODAL ACTIONS
// ============================================================================

/**
 * Apply suggestion from modal
 */
async function applyFromModal(suggestionId) {
    await applySuggestion(suggestionId);
    closeAnalysisModal();
}

/**
 * Customize and apply (opens scenario editor for missing scenarios)
 */
function customizeAndApply(suggestionId) {
    // TODO: Implement scenario editor integration
    alert('Customize feature coming soon! For now, use "Apply" to accept the AI suggestion as-is.');
}

/**
 * Close analysis modal
 */
function closeAnalysisModal() {
    if (modalElement) {
        modalElement.remove();
        modalElement = null;
    }
    currentAnalysisData = null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format LLM reasoning with markdown-like syntax
 * @private
 */
function formatLLMReasoning(reasoning) {
    if (!reasoning) return 'No reasoning provided.';
    
    return reasoning
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/\*(.+?)\*/g, '<em>$1</em>') // Italic
        .replace(/\n\n/g, '</p><p class="mt-2">') // Paragraphs
        .replace(/\n/g, '<br>'); // Line breaks
}

/**
 * Render priority badge
 * @private
 */
function renderPriorityBadge(priority) {
    const badges = {
        critical: '<span class="px-3 py-1 bg-red-500 text-white text-xs rounded-full font-bold uppercase">Critical</span>',
        high: '<span class="px-3 py-1 bg-orange-500 text-white text-xs rounded-full font-bold uppercase">High</span>',
        medium: '<span class="px-3 py-1 bg-yellow-500 text-white text-xs rounded-full font-bold uppercase">Medium</span>',
        low: '<span class="px-3 py-1 bg-gray-400 text-white text-xs rounded-full font-bold uppercase">Low</span>'
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
        colorClass = 'bg-green-100 text-green-700 border-2 border-green-500';
    } else if (percent >= 75) {
        colorClass = 'bg-blue-100 text-blue-700 border-2 border-blue-500';
    } else if (percent >= 60) {
        colorClass = 'bg-yellow-100 text-yellow-700 border-2 border-yellow-500';
    }
    
    return `
        <div class="px-4 py-2 ${colorClass} rounded-lg font-bold text-sm">
            ${percent}% Confidence
        </div>
    `;
}

/**
 * Escape HTML
 * @private
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// EXPORTS
// ============================================================================

window.SuggestionAnalysisModal = {
    viewFullAnalysis,
    closeAnalysisModal
};

// Make functions globally accessible
window.viewFullAnalysis = viewFullAnalysis;
window.closeAnalysisModal = closeAnalysisModal;
window.applyFromModal = applyFromModal;
window.customizeAndApply = customizeAndApply;

console.log('✅ [SUGGESTION ANALYSIS MODAL] Loaded successfully');

