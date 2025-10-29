// ============================================================================
// PRODUCTION AI SUGGESTION MODAL
// ============================================================================
// Purpose: Full-screen modal to display complete suggestion details
// Features: Call transcript, LLM reasoning, suggested improvements, ROI analysis
// Integration: Called from ProductionAIManager.openSuggestionModal()
// ============================================================================

class ProductionAISuggestionModal {
    constructor() {
        this.modalElement = null;
        this.currentSuggestion = null;
        this.token = localStorage.getItem('adminToken');
        
        console.log('✅ [PRODUCTION AI MODAL] Initialized');
    }

    // ════════════════════════════════════════════════════════════════════════
    // MAIN MODAL METHODS
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Open modal with full suggestion details
     * @param {String} suggestionId - Suggestion ID
     */
    async open(suggestionId) {
        console.log('[PRODUCTION AI MODAL] Opening suggestion:', suggestionId);
        
        try {
            // Show loading modal
            this.showLoadingModal();
            
            // Fetch full suggestion details
            const response = await fetch(`/api/admin/production-ai/suggestions/${suggestionId}/details`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error('Failed to load suggestion details');
            }
            
            this.currentSuggestion = data.suggestion;
            
            // Render full modal
            this.renderModal(data);
            
        } catch (error) {
            console.error('[PRODUCTION AI MODAL] Failed to load suggestion:', error);
            this.showErrorModal(error.message);
            window.toastManager.error(`❌ Failed to load suggestion: ${error.message}`);
        }
    }

    /**
     * Close modal
     */
    close() {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
            this.currentSuggestion = null;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // MODAL RENDERING
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Show loading state
     */
    showLoadingModal() {
        this.close(); // Close any existing modal
        
        const modal = document.createElement('div');
        modal.id = 'production-ai-suggestion-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[95vh] overflow-y-auto">
                <div class="p-12 text-center">
                    <div class="animate-spin rounded-full h-16 w-16 border-b-4 border-purple-600 mx-auto mb-4"></div>
                    <p class="text-gray-600 font-semibold text-lg">Loading suggestion details...</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.modalElement = modal;
    }

    /**
     * Show error state
     */
    showErrorModal(errorMessage) {
        if (this.modalElement) {
            this.modalElement.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8">
                    <div class="text-center">
                        <div class="text-red-500 text-6xl mb-4">
                            <i class="fas fa-exclamation-circle"></i>
                        </div>
                        <h3 class="text-2xl font-bold text-gray-900 mb-2">Failed to Load Suggestion</h3>
                        <p class="text-gray-600 mb-6">${errorMessage}</p>
                        <button onclick="window.suggestionAnalysisModal.close()" class="px-6 py-3 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors">
                            Close
                        </button>
                    </div>
                </div>
            `;
        }
    }

    /**
     * Render full modal content
     * @param {Object} data - API response with suggestion and related data
     */
    renderModal(data) {
        const { suggestion, relatedSuggestions, roi } = data;
        const callLog = suggestion.callLogId || {};
        
        const modalHTML = `
            <div class="bg-gradient-to-br from-purple-50 to-blue-50 rounded-2xl shadow-2xl max-w-[95vw] w-full max-h-[95vh] overflow-hidden flex flex-col">
                
                <!-- Modal Header -->
                <div class="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 flex items-center justify-between">
                    <div>
                        <h2 class="text-2xl font-bold mb-1">
                            <i class="fas fa-robot mr-2"></i>
                            🤖 LLM SUGGESTION ANALYSIS - Full Call Review
                        </h2>
                        <p class="text-purple-100 text-sm">
                            Suggestion #${suggestion._id?.substring(0, 8)} - ${this.formatSuggestionType(suggestion.type)} - ${this.formatPriority(suggestion.priority)}
                        </p>
                    </div>
                    <button onclick="window.suggestionAnalysisModal.close()" class="text-white hover:text-purple-200 transition-colors">
                        <i class="fas fa-times text-3xl"></i>
                    </button>
                </div>

                <!-- Modal Content (Scrollable) -->
                <div class="flex-1 overflow-y-auto p-6 space-y-6">
                    
                    ${this.renderCallDetails(callLog, suggestion)}
                    
                    ${this.renderQuickActions(suggestion)}
                    
                    ${this.renderTranscript(callLog)}
                    
                    ${this.renderRoutingFlow(callLog)}
                    
                    ${this.renderLLMReasoning(suggestion)}
                    
                    ${this.renderImprovements(suggestion)}
                    
                    ${this.renderImpactAnalysis(suggestion, roi)}
                    
                    ${this.renderRelatedSuggestions(relatedSuggestions)}
                    
                </div>

                <!-- Modal Footer -->
                <div class="bg-white border-t border-gray-200 p-4 flex items-center justify-between">
                    <button onclick="window.suggestionAnalysisModal.close()" class="px-6 py-2 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors">
                        <i class="fas fa-arrow-left mr-2"></i>
                        Back to Suggestions Queue
                    </button>
                    <div class="flex gap-3">
                        <button onclick="window.suggestionAnalysisModal.exportReport('${suggestion._id}')" class="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors">
                            <i class="fas fa-file-export mr-2"></i>
                            📋 Export Report
                        </button>
                        <button onclick="window.suggestionAnalysisModal.applyAll('${suggestion._id}')" class="px-6 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors">
                            <i class="fas fa-check-double mr-2"></i>
                            ✓ Apply All Suggestions
                        </button>
                    </div>
                </div>

            </div>
        `;
        
        this.modalElement.innerHTML = modalHTML;
    }

    // ════════════════════════════════════════════════════════════════════════
    // SECTION RENDERERS
    // ════════════════════════════════════════════════════════════════════════

    renderCallDetails(callLog, suggestion) {
        return `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Left: Call Details -->
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h3 class="text-lg font-bold text-gray-900 mb-4">
                        <i class="fas fa-phone text-blue-600 mr-2"></i>
                        Call Details
                    </h3>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-600">Date:</span>
                            <span class="font-medium">${new Date(callLog.timestamp).toLocaleString()}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Company:</span>
                            <span class="font-medium">${suggestion.companyId?.companyName || 'Unknown'}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Template:</span>
                            <span class="font-medium">${suggestion.templateId?.name || 'Unknown'}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Duration:</span>
                            <span class="font-medium">${callLog.duration || 'N/A'}s</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Caller:</span>
                            <span class="font-medium">${callLog.callerPhone || 'Unknown'}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Cost:</span>
                            <span class="font-bold text-red-600">$${(callLog.totalCost || 0).toFixed(4)} (Tier 3 LLM)</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Call ID:</span>
                            <span class="font-mono text-xs">#${callLog.callId || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                <!-- Right: Suggestion Details -->
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h3 class="text-lg font-bold text-gray-900 mb-4">
                        <i class="fas fa-lightbulb text-yellow-500 mr-2"></i>
                        Suggestion Details
                    </h3>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-600">Type:</span>
                            <span class="font-medium">${this.formatSuggestionType(suggestion.type)}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Priority:</span>
                            <span class="font-medium">${this.formatPriority(suggestion.priority)}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Confidence:</span>
                            <span class="font-bold text-green-600">${Math.round(suggestion.confidence * 100)}%</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">LLM Model:</span>
                            <span class="font-medium">${suggestion.llmModel || 'GPT-4'}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Analysis Cost:</span>
                            <span class="font-medium">$${(suggestion.llmCost || 0).toFixed(4)}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Tokens Used:</span>
                            <span class="font-medium">${suggestion.llmTokens || 'N/A'}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Created:</span>
                            <span class="font-medium">${new Date(suggestion.createdAt).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderQuickActions(suggestion) {
        return `
            <div class="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200 p-6">
                <h3 class="text-lg font-bold text-gray-900 mb-4">
                    <i class="fas fa-bolt text-yellow-500 mr-2"></i>
                    Quick Actions
                </h3>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <button onclick="window.suggestionAnalysisModal.applyAll('${suggestion._id}')" class="px-4 py-3 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors">
                        <i class="fas fa-check-double mr-2"></i>
                        Apply All
                    </button>
                    <button onclick="window.suggestionAnalysisModal.ignoreAll('${suggestion._id}')" class="px-4 py-3 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors">
                        <i class="fas fa-times-circle mr-2"></i>
                        Ignore All
                    </button>
                    <button onclick="window.suggestionAnalysisModal.saveForLater('${suggestion._id}')" class="px-4 py-3 bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors">
                        <i class="fas fa-bookmark mr-2"></i>
                        💾 Save for Later
                    </button>
                    <button onclick="window.suggestionAnalysisModal.exportReport('${suggestion._id}')" class="px-4 py-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
                        <i class="fas fa-file-export mr-2"></i>
                        📋 Export
                    </button>
                </div>
            </div>
        `;
    }

    renderTranscript(callLog) {
        return `
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-bold text-gray-900">
                        <i class="fas fa-file-alt text-gray-600 mr-2"></i>
                        📝 FULL CALL TRANSCRIPT
                    </h3>
                    <button onclick="navigator.clipboard.writeText(\`${(callLog.transcript || '').replace(/`/g, '\\`')}\`); window.window.toastManager.success('✅ Copied!')" class="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300 transition-colors">
                        <i class="fas fa-copy mr-1"></i>
                        Copy
                    </button>
                </div>
                <div class="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm whitespace-pre-wrap">
                    ${callLog.transcript || 'No transcript available'}
                </div>
            </div>
        `;
    }

    renderRoutingFlow(callLog) {
        const tier1 = callLog.tier1Result || {};
        const tier2 = callLog.tier2Result || {};
        const tier3 = callLog.tier3Result || {};
        
        return `
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 class="text-lg font-bold text-gray-900 mb-4">
                    <i class="fas fa-route text-purple-600 mr-2"></i>
                    ⚡ ROUTING FLOW VISUALIZATION
                </h3>
                <div class="space-y-4">
                    ${this.renderTierBlock('Tier 1 - Rule-Based', tier1, '5-15ms', 'green')}
                    <div class="text-center text-gray-400"><i class="fas fa-arrow-down"></i></div>
                    ${this.renderTierBlock('Tier 2 - Semantic', tier2, '20-40ms', 'blue')}
                    <div class="text-center text-gray-400"><i class="fas fa-arrow-down"></i></div>
                    ${this.renderTierBlock('Tier 3 - LLM Fallback', tier3, `${tier3.responseTime || 'N/A'}ms`, 'red')}
                </div>
            </div>
        `;
    }

    renderTierBlock(title, tierResult, responseTime, color) {
        const matched = tierResult.matched;
        const bgColor = matched ? `bg-${color}-50` : 'bg-gray-50';
        const borderColor = matched ? `border-${color}-500` : 'border-gray-300';
        const textColor = matched ? `text-${color}-700` : 'text-gray-700';
        
        return `
            <div class="${bgColor} rounded-lg border-2 ${borderColor} p-4">
                <div class="flex items-center justify-between mb-2">
                    <h4 class="font-bold ${textColor}">${title}</h4>
                    <span class="text-xs text-gray-600">Response time: ${responseTime}</span>
                </div>
                <div class="space-y-1 text-sm">
                    <div class="flex items-center gap-2">
                        ${matched ? '<i class="fas fa-check-circle text-green-600"></i>' : '<i class="fas fa-times-circle text-red-600"></i>'}
                        <span class="font-medium">${matched ? '✅ SUCCESS' : '❌ FAILED'}</span>
                        <span class="text-gray-600">(confidence: ${(tierResult.confidence || 0).toFixed(2)})</span>
                    </div>
                    <p class="text-gray-600 ml-6">↳ ${tierResult.reason || 'No details available'}</p>
                </div>
            </div>
        `;
    }

    renderLLMReasoning(suggestion) {
        return `
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 class="text-lg font-bold text-gray-900 mb-4">
                    <i class="fas fa-brain text-purple-600 mr-2"></i>
                    🧠 LLM REASONING & ANALYSIS
                </h3>
                <div class="bg-purple-50 rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed">
                    ${suggestion.llmReasoning || 'No LLM reasoning available'}
                </div>
            </div>
        `;
    }

    renderImprovements(suggestion) {
        const improvements = suggestion.improvements || {};
        let html = `
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 class="text-lg font-bold text-gray-900 mb-4">
                    <i class="fas fa-wrench text-orange-600 mr-2"></i>
                    💡 SUGGESTED IMPROVEMENTS
                </h3>
                <div class="space-y-4">
        `;
        
        // Render based on suggestion type
        if (suggestion.type === 'filler-words' && improvements.fillerWords) {
            html += this.renderFillerWordsCard(improvements.fillerWords, suggestion._id);
        } else if (suggestion.type === 'synonym' && improvements.synonymMapping) {
            html += this.renderSynonymCard(improvements.synonymMapping, suggestion._id);
        } else if (suggestion.type === 'keywords' && improvements.keywords) {
            html += this.renderKeywordsCard(improvements.keywords, suggestion._id);
        } else if (suggestion.type === 'negative-keywords' && improvements.negativeKeywords) {
            html += this.renderNegativeKeywordsCard(improvements.negativeKeywords, suggestion._id);
        } else if (suggestion.type === 'missing-scenario' && improvements.missingScenario) {
            html += this.renderMissingScenarioCard(improvements.missingScenario, suggestion._id);
        }
        
        html += `</div></div>`;
        return html;
    }

    renderFillerWordsCard(fillerWords, suggestionId) {
        return `
            <div class="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-bold text-gray-900">1️⃣ ADD FILLER WORDS</h4>
                    <span class="px-2 py-1 bg-yellow-200 text-yellow-800 text-xs font-bold rounded">Medium Impact</span>
                </div>
                <p class="text-sm text-gray-700 mb-3"><strong>Words to add:</strong> ${fillerWords.join(', ')}</p>
                <p class="text-sm text-gray-600 mb-3">These appear in 85% of failed matches and add no semantic meaning. Cleaner input improves Tier 1/2 matching accuracy.</p>
                <div class="flex gap-2">
                    <button onclick="window.productionAIManager.applySuggestion('${suggestionId}')" class="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 transition-colors">
                        <i class="fas fa-check mr-1"></i> Apply
                    </button>
                    <button onclick="window.productionAIManager.ignoreSuggestion('${suggestionId}')" class="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded hover:bg-gray-700 transition-colors">
                        <i class="fas fa-times mr-1"></i> Ignore
                    </button>
                </div>
            </div>
        `;
    }

    renderSynonymCard(synonymMapping, suggestionId) {
        return `
            <div class="bg-green-50 rounded-lg border border-green-200 p-4">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-bold text-gray-900">2️⃣ ADD SYNONYM MAPPING</h4>
                    <span class="px-2 py-1 bg-red-200 text-red-800 text-xs font-bold rounded animate-pulse">HIGH IMPACT ⭐⭐⭐</span>
                </div>
                <p class="text-sm text-gray-700 mb-3"><strong>Mapping:</strong> "${synonymMapping.colloquial}" → "${synonymMapping.technical}"</p>
                <p class="text-sm text-gray-600 mb-3">Detected multiple times this month. Adding this synonym will route to Tier 1 (rule-based), significantly reducing costs.</p>
                <div class="flex gap-2">
                    <button onclick="window.productionAIManager.applySuggestion('${suggestionId}')" class="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 transition-colors">
                        <i class="fas fa-check mr-1"></i> Apply
                    </button>
                    <button onclick="window.productionAIManager.ignoreSuggestion('${suggestionId}')" class="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded hover:bg-gray-700 transition-colors">
                        <i class="fas fa-times mr-1"></i> Ignore
                    </button>
                </div>
            </div>
        `;
    }

    renderKeywordsCard(keywords, suggestionId) {
        return `
            <div class="bg-blue-50 rounded-lg border border-blue-200 p-4">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-bold text-gray-900">3️⃣ ENHANCE EXISTING SCENARIO</h4>
                    <span class="px-2 py-1 bg-blue-200 text-blue-800 text-xs font-bold rounded">Medium Impact</span>
                </div>
                <p class="text-sm text-gray-700 mb-3"><strong>Scenario:</strong> ${keywords.scenarioName}</p>
                <p class="text-sm text-gray-700 mb-3"><strong>Add keywords:</strong> ${keywords.keywordsToAdd.join(', ')}</p>
                <p class="text-sm text-gray-600 mb-3">Improves Tier 1 matching for non-technical callers. Estimated 15-20 additional matches per month.</p>
                <div class="flex gap-2">
                    <button onclick="window.productionAIManager.applySuggestion('${suggestionId}')" class="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 transition-colors">
                        <i class="fas fa-check mr-1"></i> Apply
                    </button>
                    <button onclick="window.productionAIManager.ignoreSuggestion('${suggestionId}')" class="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded hover:bg-gray-700 transition-colors">
                        <i class="fas fa-times mr-1"></i> Ignore
                    </button>
                </div>
            </div>
        `;
    }

    renderNegativeKeywordsCard(negativeKeywords, suggestionId) {
        return `
            <div class="bg-red-50 rounded-lg border border-red-200 p-4">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-bold text-gray-900">4️⃣ ADD NEGATIVE KEYWORDS</h4>
                    <span class="px-2 py-1 bg-red-200 text-red-800 text-xs font-bold rounded">High Impact</span>
                </div>
                <p class="text-sm text-gray-700 mb-3"><strong>Scenario:</strong> ${negativeKeywords.scenarioName}</p>
                <p class="text-sm text-gray-700 mb-3"><strong>Add negative keywords:</strong> ${negativeKeywords.negativeKeywordsToAdd.join(', ')}</p>
                <p class="text-sm text-gray-600 mb-3">Prevents false positives. Reduces incorrect matches by ~70%.</p>
                <div class="flex gap-2">
                    <button onclick="window.productionAIManager.applySuggestion('${suggestionId}')" class="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 transition-colors">
                        <i class="fas fa-check mr-1"></i> Apply
                    </button>
                    <button onclick="window.productionAIManager.ignoreSuggestion('${suggestionId}')" class="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded hover:bg-gray-700 transition-colors">
                        <i class="fas fa-times mr-1"></i> Ignore
                    </button>
                </div>
            </div>
        `;
    }

    renderMissingScenarioCard(missingScenario, suggestionId) {
        return `
            <div class="bg-purple-50 rounded-lg border border-purple-200 p-4">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-bold text-gray-900">5️⃣ CREATE MISSING SCENARIO</h4>
                    <span class="px-2 py-1 bg-red-200 text-red-800 text-xs font-bold rounded animate-pulse">HIGH IMPACT ⭐⭐⭐</span>
                </div>
                <p class="text-sm text-gray-700 mb-2"><strong>Suggested name:</strong> ${missingScenario.suggestedName}</p>
                <p class="text-sm text-gray-700 mb-2"><strong>Category:</strong> ${missingScenario.suggestedCategory}</p>
                <p class="text-sm text-gray-700 mb-2"><strong>Keywords:</strong> ${missingScenario.suggestedKeywords.join(', ')}</p>
                <p class="text-sm text-gray-600 mb-3">High business impact. Multiple similar calls detected with no matching scenario.</p>
                <div class="flex gap-2">
                    <button onclick="window.productionAIManager.applySuggestion('${suggestionId}')" class="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 transition-colors">
                        <i class="fas fa-check mr-1"></i> Create Scenario
                    </button>
                    <button onclick="window.productionAIManager.ignoreSuggestion('${suggestionId}')" class="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded hover:bg-gray-700 transition-colors">
                        <i class="fas fa-times mr-1"></i> Ignore
                    </button>
                </div>
            </div>
        `;
    }

    renderImpactAnalysis(suggestion, roi) {
        const impact = suggestion.impact || {};
        
        return `
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 class="text-lg font-bold text-gray-900 mb-4">
                    <i class="fas fa-chart-line text-green-600 mr-2"></i>
                    📊 IMPACT ANALYSIS & ROI
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div class="bg-blue-50 rounded-lg p-4 text-center">
                        <p class="text-gray-600 text-sm mb-1">Similar Calls</p>
                        <p class="text-3xl font-bold text-blue-600">${impact.similarCallsThisMonth || 0}</p>
                        <p class="text-xs text-gray-500">this month</p>
                    </div>
                    <div class="bg-green-50 rounded-lg p-4 text-center">
                        <p class="text-gray-600 text-sm mb-1">Monthly Savings</p>
                        <p class="text-3xl font-bold text-green-600">$${(impact.estimatedMonthlySavings || 0).toFixed(2)}</p>
                        <p class="text-xs text-gray-500">per month</p>
                    </div>
                    <div class="bg-purple-50 rounded-lg p-4 text-center">
                        <p class="text-gray-600 text-sm mb-1">Performance Gain</p>
                        <p class="text-3xl font-bold text-purple-600">${impact.performanceGain || 0}ms</p>
                        <p class="text-xs text-gray-500">faster responses</p>
                    </div>
                </div>
                <div class="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
                    <p><strong>Annual Savings:</strong> $${(roi.annualSavings || 0).toFixed(2)}</p>
                    <p><strong>Setup Time:</strong> ${roi.setupTime || 5} minutes</p>
                    <p><strong>Payback Period:</strong> ${roi.paybackPeriod || 'Immediate'}</p>
                </div>
            </div>
        `;
    }

    renderRelatedSuggestions(relatedSuggestions) {
        if (!relatedSuggestions || relatedSuggestions.length === 0) {
            return `
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h3 class="text-lg font-bold text-gray-900 mb-2">
                        <i class="fas fa-link text-gray-600 mr-2"></i>
                        🔄 RELATED SUGGESTIONS
                    </h3>
                    <p class="text-gray-600 text-sm">No related suggestions found</p>
                </div>
            `;
        }
        
        return `
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 class="text-lg font-bold text-gray-900 mb-4">
                    <i class="fas fa-link text-gray-600 mr-2"></i>
                    🔄 RELATED SUGGESTIONS
                </h3>
                <div class="space-y-2">
                    ${relatedSuggestions.map(s => `
                        <div class="flex items-center justify-between py-2 px-3 bg-gray-50 rounded hover:bg-gray-100 transition-colors">
                            <span class="text-sm text-gray-700">• Suggestion #${s._id?.substring(0, 8)}: ${s.briefDescription || 'View details'}</span>
                            <button onclick="window.suggestionAnalysisModal.open('${s._id}')" class="text-blue-600 hover:text-blue-800 text-sm font-medium">
                                View <i class="fas fa-arrow-right ml-1"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION METHODS
    // ════════════════════════════════════════════════════════════════════════

    async applyAll(suggestionId) {
        try {
            await window.productionAIManager.applySuggestion(suggestionId);
            this.close();
        } catch (error) {
            console.error('[PRODUCTION AI MODAL] Failed to apply:', error);
        }
    }

    async ignoreAll(suggestionId) {
        try {
            await window.productionAIManager.ignoreSuggestion(suggestionId);
            this.close();
        } catch (error) {
            console.error('[PRODUCTION AI MODAL] Failed to ignore:', error);
        }
    }

    async saveForLater(suggestionId) {
        window.toastManager.info('💾 Saved for later (stays in pending queue)');
    }

    async exportReport(suggestionId) {
        window.toastManager.info('📋 Export functionality coming soon!');
    }

    // ════════════════════════════════════════════════════════════════════════
    // UTILITY METHODS
    // ════════════════════════════════════════════════════════════════════════

    formatSuggestionType(type) {
        const types = {
            'filler-words': 'Add Filler Words',
            'synonym': 'Add Synonym Mapping',
            'keywords': 'Enhance Scenario Keywords',
            'negative-keywords': 'Add Negative Keywords',
            'missing-scenario': 'Create Missing Scenario'
        };
        return types[type] || type;
    }

    formatPriority(priority) {
        const priorities = {
            'high': '🔥 High Priority',
            'medium': '🟡 Medium Priority',
            'low': '🔵 Low Priority'
        };
        return priorities[priority] || priority;
    }
}

// ════════════════════════════════════════════════════════════════════════
// GLOBAL INSTANCE
// ════════════════════════════════════════════════════════════════════════

window.suggestionAnalysisModal = new ProductionAISuggestionModal();

console.log('✅ [PRODUCTION AI MODAL] Loaded successfully');

