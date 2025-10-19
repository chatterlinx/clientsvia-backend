/**
 * ============================================================================
 * FILLER WORDS MANAGER - NOISE REDUCTION CONFIGURATION
 * ============================================================================
 * 
 * PURPOSE: Manage filler words that are stripped from caller speech
 * EXAMPLES: "um", "uh", "like", "you know", "basically", etc.
 * 
 * FEATURES:
 * - Inherited words from template (blue chips)
 * - Custom company words (white chips)
 * - Search/filter functionality
 * - Bulk add via textarea
 * - Export to JSON
 * - Reset to defaults
 * 
 * TECHNICAL:
 * - Company inherits from cloned template
 * - Can add custom words
 * - Cannot delete inherited words (only custom)
 * - Changes save to company configuration
 * 
 * ============================================================================
 */

class FillerWordsManager {
    constructor(parentManager) {
        this.parent = parentManager;
        this.companyId = parentManager.companyId;
        this.inheritedWords = []; // From template
        this.customWords = []; // Added by company
        this.allWords = [];
        this.filteredWords = [];
        this.searchTerm = '';
        
        console.log('🔇 [FILLER WORDS] Initialized');
    }
    
    /**
     * Load filler words from API
     */
    async load() {
        console.log('🔇 [FILLER WORDS] Loading...');
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/filler-words`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            this.inheritedWords = data.inherited || [];
            this.customWords = data.custom || [];
            this.allWords = [...this.inheritedWords, ...this.customWords];
            this.filteredWords = [...this.allWords];
            
            console.log('✅ [FILLER WORDS] Loaded:', {
                inherited: this.inheritedWords.length,
                custom: this.customWords.length,
                total: this.allWords.length
            });
            
            this.render();
            this.updateStats();
            this.attachEventListeners();
            
        } catch (error) {
            console.error('❌ [FILLER WORDS] Failed to load:', error);
            this.renderEmpty();
        }
    }
    
    /**
     * Render filler words
     */
    render() {
        const container = document.getElementById('filler-words-container');
        if (!container) return;
        
        if (this.allWords.length === 0) {
            this.renderEmpty();
            return;
        }
        
        // Sort alphabetically
        this.filteredWords.sort();
        
        let html = '<div class="flex flex-wrap gap-2">';
        
        this.filteredWords.forEach(word => {
            const isInherited = this.inheritedWords.includes(word);
            const chipClass = isInherited ? 'ai-settings-filler-chip inherited' : 'ai-settings-filler-chip';
            const canDelete = !isInherited;
            
            html += `
                <div class="${chipClass}">
                    <span>${this.escapeHtml(word)}</span>
                    ${canDelete ? `
                        <button 
                            class="ai-settings-filler-chip-remove" 
                            onclick="fillerWordsManager.deleteWord('${this.escapeHtml(word)}')"
                            title="Remove this word"
                        >
                            <i class="fas fa-times"></i>
                        </button>
                    ` : `
                        <i class="fas fa-lock text-gray-400 text-xs" title="Inherited from template"></i>
                    `}
                </div>
            `;
        });
        
        html += '</div>';
        
        container.innerHTML = html;
    }
    
    /**
     * Render empty state
     */
    renderEmpty() {
        const container = document.getElementById('filler-words-container');
        if (!container) return;
        
        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; min-height: 400px;">
                <div style="text-align: center; max-width: 600px; padding: 40px;">
                    <div style="font-size: 80px; margin-bottom: 24px; opacity: 0.3;">🔇</div>
                    
                    <h3 style="font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 12px;">
                        No Filler Words Yet
                    </h3>
                    
                    <p style="font-size: 16px; color: #6b7280; line-height: 1.6; margin-bottom: 32px;">
                        We checked, but there are no filler words configured. Filler words are automatically 
                        inherited from Global AI Brain templates when you activate them. These words (like "um", 
                        "uh", "you know") are removed from customer input for cleaner AI processing.
                    </p>
                    
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; color: white; text-align: left; margin-bottom: 24px;">
                        <h4 style="font-size: 16px; font-weight: 700; margin-bottom: 12px;">
                            💡 What are Filler Words?
                        </h4>
                        <p style="font-size: 14px; line-height: 1.6; margin-bottom: 12px;">
                            Filler words are common speech patterns (like "um", "uh", "you know", "like") that people 
                            use naturally but add no meaning. The AI strips these out before processing to improve 
                            accuracy and understanding.
                        </p>
                        <p style="font-size: 14px; line-height: 1.6;">
                            Example: "Um, I need to, like, book an appointment" → "I need to book an appointment"
                        </p>
                    </div>
                    
                    <div style="padding: 20px; background: #f9fafb; border-radius: 8px; border: 2px dashed #e5e7eb;">
                        <p style="font-size: 14px; color: #6b7280; margin-bottom: 12px;">
                            <strong style="color: #111827;">🚀 To get filler words:</strong>
                        </p>
                        <ol style="text-align: left; font-size: 14px; color: #6b7280; line-height: 1.8; padding-left: 20px;">
                            <li>Go to the <strong>AiCore Templates</strong> tab</li>
                            <li>Activate a template (e.g., "Universal AI Brain")</li>
                            <li>Filler words will automatically inherit from that template</li>
                            <li>You can add custom filler words specific to your business</li>
                        </ol>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Update statistics
     */
    updateStats() {
        const inheritedCount = document.getElementById('filler-inherited-count');
        const customCount = document.getElementById('filler-custom-count');
        const totalCount = document.getElementById('filler-total-count');
        
        if (inheritedCount) inheritedCount.textContent = this.inheritedWords.length;
        if (customCount) customCount.textContent = this.customWords.length;
        if (totalCount) totalCount.textContent = this.allWords.length;
    }
    
    /**
     * Attach event listeners
     */
    attachEventListeners() {
        const searchInput = document.getElementById('filler-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.search(e.target.value);
            });
        }
    }
    
    /**
     * Search filler words
     */
    search(term) {
        this.searchTerm = term.toLowerCase().trim();
        
        if (this.searchTerm === '') {
            this.filteredWords = [...this.allWords];
        } else {
            this.filteredWords = this.allWords.filter(word => 
                word.toLowerCase().includes(this.searchTerm)
            );
        }
        
        this.render();
    }
    
    /**
     * Show add word modal
     */
    showAddModal() {
        const html = `
            <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" id="add-filler-modal">
                <div class="bg-white rounded-lg shadow-2xl max-w-2xl w-full">
                    <div class="p-6 border-b-2 border-gray-200">
                        <h3 class="text-2xl font-bold text-gray-900">
                            <i class="fas fa-plus-circle text-green-600 mr-2"></i>
                            Add Filler Words
                        </h3>
                    </div>
                    <div class="p-6">
                        <p class="text-sm text-gray-600 mb-4">
                            Add multiple filler words, one per line. These will be automatically removed from caller speech.
                        </p>
                        <textarea 
                            id="new-filler-words" 
                            class="w-full h-48 p-4 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none font-mono text-sm"
                            placeholder="um&#10;uh&#10;like&#10;you know&#10;basically&#10;actually&#10;literally"
                        ></textarea>
                        <div class="text-xs text-gray-500 mt-2">
                            <i class="fas fa-info-circle mr-1"></i>
                            Tip: Paste a list from Excel or another source
                        </div>
                    </div>
                    <div class="p-6 border-t-2 border-gray-200 flex gap-3 justify-end">
                        <button 
                            onclick="document.getElementById('add-filler-modal').remove()" 
                            class="ai-settings-btn ai-settings-btn-secondary"
                        >
                            <i class="fas fa-times"></i>
                            Cancel
                        </button>
                        <button 
                            onclick="fillerWordsManager.addWords()" 
                            class="ai-settings-btn ai-settings-btn-success"
                        >
                            <i class="fas fa-check"></i>
                            Add Words
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', html);
        
        // Focus textarea
        setTimeout(() => {
            document.getElementById('new-filler-words')?.focus();
        }, 100);
    }
    
    /**
     * Add words from modal
     */
    async addWords() {
        const textarea = document.getElementById('new-filler-words');
        if (!textarea) return;
        
        const words = textarea.value
            .split('\n')
            .map(w => w.trim().toLowerCase())
            .filter(w => w.length > 0)
            .filter(w => !this.allWords.includes(w)); // Prevent duplicates
        
        if (words.length === 0) {
            alert('⚠️ No new words to add');
            return;
        }
        
        console.log(`🔇 [FILLER WORDS] Adding ${words.length} words:`, words);
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/filler-words`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                },
                body: JSON.stringify({ words })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            console.log('✅ [FILLER WORDS] Added successfully');
            
            // Reload
            await this.load();
            
            // Close modal
            document.getElementById('add-filler-modal')?.remove();
            
            this.parent.showSuccess(`Added ${words.length} filler word(s)!`);
            
        } catch (error) {
            console.error('❌ [FILLER WORDS] Failed to add:', error);
            this.parent.showError('Failed to add filler words');
        }
    }
    
    /**
     * Delete a single word
     */
    async deleteWord(word) {
        if (this.inheritedWords.includes(word)) {
            alert('⚠️ Cannot delete inherited words from template. You can only delete custom words you added.');
            return;
        }
        
        if (!confirm(`Delete "${word}" from your filler words?`)) {
            return;
        }
        
        console.log(`🔇 [FILLER WORDS] Deleting: ${word}`);
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/filler-words/${encodeURIComponent(word)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            console.log('✅ [FILLER WORDS] Deleted successfully');
            
            // Remove from arrays
            this.customWords = this.customWords.filter(w => w !== word);
            this.allWords = [...this.inheritedWords, ...this.customWords];
            this.filteredWords = this.filteredWords.filter(w => w !== word);
            
            // Re-render
            this.render();
            this.updateStats();
            
            this.parent.showSuccess(`Deleted "${word}"`);
            
        } catch (error) {
            console.error('❌ [FILLER WORDS] Failed to delete:', error);
            this.parent.showError('Failed to delete filler word');
        }
    }
    
    /**
     * Reset to template defaults
     */
    async reset() {
        if (!confirm('⚠️ This will remove all custom filler words and reset to template defaults. Continue?')) {
            return;
        }
        
        console.log('🔇 [FILLER WORDS] Resetting to defaults...');
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration/filler-words/reset`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            console.log('✅ [FILLER WORDS] Reset successfully');
            
            // Reload
            await this.load();
            
            this.parent.showSuccess('Reset to template defaults!');
            
        } catch (error) {
            console.error('❌ [FILLER WORDS] Failed to reset:', error);
            this.parent.showError('Failed to reset filler words');
        }
    }
    
    /**
     * Export to JSON
     */
    exportToJSON() {
        const data = {
            inherited: this.inheritedWords,
            custom: this.customWords,
            all: this.allWords,
            exportedAt: new Date().toISOString(),
            companyId: this.companyId
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `filler-words-${this.companyId}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('📥 [FILLER WORDS] Exported to JSON');
    }
    
    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use in AIAgentSettingsManager
if (typeof window !== 'undefined') {
    window.FillerWordsManager = FillerWordsManager;
}

