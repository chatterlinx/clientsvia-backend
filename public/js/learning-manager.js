/**
 * Learning Management JavaScript for Agent Setup
 * Handles AI learning suggestions and knowledge base management
 */

class LearningManager {
    constructor(companyId) {
        this.companyId = companyId;
        this.currentModalSuggestion = null;
        this.init();
    }

    async init() {
        console.log(`[LearningManager] Initializing for company: ${this.companyId}`);
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Load initial data
        await this.loadAnalytics();
        await this.loadPendingSuggestions();
        await this.loadApprovedKnowledge();
        
        console.log('[LearningManager] Initialization complete');
    }

    setupEventListeners() {
        // Bulk approve button
        document.getElementById('bulk-approve-btn')?.addEventListener('click', () => {
            this.bulkApproveSuggestions();
        });

        // Knowledge search
        document.getElementById('knowledge-search')?.addEventListener('input', (e) => {
            this.searchKnowledge(e.target.value);
        });

        // Refresh knowledge button
        document.getElementById('refresh-knowledge-btn')?.addEventListener('click', () => {
            this.loadApprovedKnowledge();
        });

        // Learning settings
        document.getElementById('auto-approve-high-confidence')?.addEventListener('change', (e) => {
            this.updateLearningSetting('autoApprove', e.target.checked);
        });

        document.getElementById('daily-learning-summary')?.addEventListener('change', (e) => {
            this.updateLearningSetting('dailySummary', e.target.checked);
        });

        // Modal event listeners
        this.setupModalListeners();
    }

    setupModalListeners() {
        // Suggestion review modal
        document.getElementById('close-suggestion-modal')?.addEventListener('click', () => {
            this.closeSuggestionModal();
        });

        document.getElementById('approve-suggestion-btn')?.addEventListener('click', () => {
            this.approveSuggestionFromModal();
        });

        document.getElementById('reject-suggestion-btn')?.addEventListener('click', () => {
            this.rejectSuggestionFromModal();
        });

        // Knowledge edit modal
        document.getElementById('close-knowledge-modal')?.addEventListener('click', () => {
            this.closeKnowledgeModal();
        });

        document.getElementById('save-knowledge-btn')?.addEventListener('click', () => {
            this.saveKnowledgeFromModal();
        });

        document.getElementById('delete-knowledge-btn')?.addEventListener('click', () => {
            this.deleteKnowledgeFromModal();
        });

        document.getElementById('cancel-knowledge-edit-btn')?.addEventListener('click', () => {
            this.closeKnowledgeModal();
        });

        // Close modals when clicking outside
        document.getElementById('suggestion-review-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'suggestion-review-modal') {
                this.closeSuggestionModal();
            }
        });

        document.getElementById('knowledge-edit-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'knowledge-edit-modal') {
                this.closeKnowledgeModal();
            }
        });
    }

    async loadAnalytics() {
        try {
            console.log('[LearningManager] Loading analytics...');
            const response = await fetch(`/api/learning/analytics/${this.companyId}`);
            if (!response.ok) throw new Error('Failed to load analytics');
            
            const analytics = await response.json();
            this.updateAnalyticsDashboard(analytics);
        } catch (error) {
            console.error('[LearningManager] Error loading analytics:', error);
        }
    }

    updateAnalyticsDashboard(analytics) {
        const statusCounts = analytics.statusCounts || {};
        
        // Update dashboard cards
        document.getElementById('pending-suggestions-count').textContent = statusCounts.pending || 0;
        document.getElementById('approved-knowledge-count').textContent = analytics.approvedKnowledgeCount || 0;
        
        // Calculate weekly learning
        const weeklyCount = analytics.recentActivity?.reduce((sum, day) => sum + day.count, 0) || 0;
        document.getElementById('weekly-learning-count').textContent = weeklyCount;
        
        // Calculate learning score (simple formula)
        const totalSuggestions = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
        const approvalRate = totalSuggestions > 0 ? Math.round(((statusCounts.approved || 0) / totalSuggestions) * 100) : 0;
        document.getElementById('learning-score').textContent = `${approvalRate}%`;
        
        // Enable/disable bulk approve button
        const bulkApproveBtn = document.getElementById('bulk-approve-btn');
        if (bulkApproveBtn) {
            bulkApproveBtn.disabled = (statusCounts.pending || 0) === 0;
        }
    }

    async loadPendingSuggestions() {
        try {
            console.log('[LearningManager] Loading pending suggestions...');
            const response = await fetch(`/api/learning/suggestions/${this.companyId}?status=pending&limit=10`);
            if (!response.ok) throw new Error('Failed to load suggestions');
            
            const data = await response.json();
            this.renderPendingSuggestions(data.suggestions || []);
        } catch (error) {
            console.error('[LearningManager] Error loading suggestions:', error);
            this.showError('Failed to load pending suggestions');
        }
    }

    renderPendingSuggestions(suggestions) {
        const container = document.getElementById('pending-suggestions-list');
        if (!container) return;

        if (suggestions.length === 0) {
            container.innerHTML = `
                <div class="p-4 text-center text-gray-500">
                    <i class="fas fa-brain text-2xl mb-2"></i>
                    <p>No pending suggestions yet. The AI will learn from calls and suggest new knowledge entries.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = suggestions.map(suggestion => `
            <div class="p-3 bg-white border-b border-gray-200 hover:bg-gray-50 transition" data-suggestion-id="${suggestion._id}">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <h5 class="text-sm font-medium text-gray-900 mb-1">${this.escapeHtml(suggestion.question)}</h5>
                        <p class="text-xs text-gray-600 mb-2">${this.escapeHtml(suggestion.suggestedAnswer)}</p>
                        <div class="flex items-center space-x-3 text-xs text-gray-500">
                            <span><i class="fas fa-calendar mr-1"></i>${new Date(suggestion.createdAt).toLocaleDateString()}</span>
                            ${suggestion.confidence ? `<span><i class="fas fa-percent mr-1"></i>${Math.round(suggestion.confidence * 100)}% confidence</span>` : ''}
                            ${suggestion.originalCallSid ? `<span><i class="fas fa-phone mr-1"></i>From call</span>` : ''}
                        </div>
                    </div>
                    <div class="flex space-x-2 ml-3">
                        <button onclick="learningManager.approveSuggestion('${suggestion._id}')" 
                                class="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded transition">
                            <i class="fas fa-check mr-1"></i>Approve
                        </button>
                        <button onclick="learningManager.rejectSuggestion('${suggestion._id}')" 
                                class="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded transition">
                            <i class="fas fa-times mr-1"></i>Reject
                        </button>
                        <button onclick="learningManager.reviewSuggestion('${suggestion._id}')" 
                                class="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition">
                            <i class="fas fa-eye mr-1"></i>Review
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async approveSuggestion(suggestionId) {
        try {
            console.log(`[LearningManager] Approving suggestion: ${suggestionId}`);
            const response = await fetch(`/api/learning/${this.companyId}/suggestions/${suggestionId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) throw new Error('Failed to approve suggestion');
            
            this.showSuccess('Suggestion approved successfully!');
            await this.loadAnalytics();
            await this.loadPendingSuggestions();
            await this.loadApprovedKnowledge();
        } catch (error) {
            console.error('[LearningManager] Error approving suggestion:', error);
            this.showError('Failed to approve suggestion');
        }
    }

    async rejectSuggestion(suggestionId) {
        try {
            console.log(`[LearningManager] Rejecting suggestion: ${suggestionId}`);
            const response = await fetch(`/api/learning/${this.companyId}/suggestions/${suggestionId}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) throw new Error('Failed to reject suggestion');
            
            this.showSuccess('Suggestion rejected');
            await this.loadAnalytics();
            await this.loadPendingSuggestions();
        } catch (error) {
            console.error('[LearningManager] Error rejecting suggestion:', error);
            this.showError('Failed to reject suggestion');
        }
    }

    async bulkApproveSuggestions() {
        if (!confirm('Are you sure you want to approve all pending suggestions?')) return;

        try {
            console.log('[LearningManager] Bulk approving suggestions...');
            const response = await fetch(`/api/learning/${this.companyId}/suggestions/bulk-approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) throw new Error('Failed to bulk approve suggestions');
            
            const result = await response.json();
            this.showSuccess(`Approved ${result.approvedCount || 0} suggestions!`);
            await this.loadAnalytics();
            await this.loadPendingSuggestions();
            await this.loadApprovedKnowledge();
        } catch (error) {
            console.error('[LearningManager] Error bulk approving:', error);
            this.showError('Failed to bulk approve suggestions');
        }
    }

    async reviewSuggestion(suggestionId) {
        try {
            console.log(`[LearningManager] Opening review modal for suggestion: ${suggestionId}`);
            
            // Fetch suggestion details
            const response = await fetch(`/api/learning/suggestions/${this.companyId}?suggestionId=${suggestionId}`);
            if (!response.ok) throw new Error('Failed to load suggestion');
            
            const suggestions = await response.json();
            const suggestion = suggestions.find(s => s._id === suggestionId);
            if (!suggestion) throw new Error('Suggestion not found');
            
            // Store current suggestion for modal actions
            this.currentModalSuggestion = suggestion;
            
            // Populate modal
            document.getElementById('suggestion-question').textContent = suggestion.question;
            document.getElementById('suggestion-answer').value = suggestion.answer;
            document.getElementById('suggestion-category').value = suggestion.category || 'general';
            document.getElementById('suggestion-confidence').textContent = `${Math.round(suggestion.confidence * 100)}%`;
            document.getElementById('suggestion-tags').value = (suggestion.tags || []).join(', ');
            document.getElementById('suggestion-review-notes').value = '';
            
            // Add confidence color coding
            const confidenceEl = document.getElementById('suggestion-confidence');
            const confidencePercent = suggestion.confidence * 100;
            if (confidencePercent >= 90) {
                confidenceEl.className = 'p-2 bg-green-50 border border-green-200 rounded text-sm font-medium text-green-800';
            } else if (confidencePercent >= 70) {
                confidenceEl.className = 'p-2 bg-yellow-50 border border-yellow-200 rounded text-sm font-medium text-yellow-800';
            } else {
                confidenceEl.className = 'p-2 bg-red-50 border border-red-200 rounded text-sm font-medium text-red-800';
            }
            
            // Show modal
            document.getElementById('suggestion-review-modal').classList.remove('hidden');
            
        } catch (error) {
            console.error('[LearningManager] Error opening review modal:', error);
            this.showError('Failed to load suggestion details');
        }
    }

    async loadApprovedKnowledge(searchQuery = '') {
        try {
            console.log('[LearningManager] Loading approved knowledge...');
            const response = await fetch(`/api/learning/knowledge/${this.companyId}?limit=20${searchQuery}`);
            if (!response.ok) throw new Error('Failed to load knowledge');
            
            const data = await response.json();
            this.renderApprovedKnowledge(data.knowledge || []);
        } catch (error) {
            console.error('[LearningManager] Error loading knowledge:', error);
            this.showError('Failed to load approved knowledge');
        }
    }

    renderApprovedKnowledge(knowledge) {
        const container = document.getElementById('approved-knowledge-list');
        if (!container) return;

        if (knowledge.length === 0) {
            container.innerHTML = `
                <div class="p-4 text-center text-gray-500">
                    <i class="fas fa-database text-2xl mb-2"></i>
                    <p>No approved knowledge entries yet.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = knowledge.map(entry => `
            <div class="p-3 bg-white border-b border-gray-200 hover:bg-gray-50 transition">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <h5 class="text-sm font-medium text-gray-900 mb-1">${this.escapeHtml(entry.question)}</h5>
                        <p class="text-xs text-gray-600 mb-2">${this.escapeHtml(entry.answer)}</p>
                        <div class="flex items-center space-x-3 text-xs text-gray-500">
                            <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded">${entry.category || 'General'}</span>
                            <span><i class="fas fa-calendar mr-1"></i>${new Date(entry.createdAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div class="flex space-x-2 ml-3">
                        <button onclick="learningManager.editKnowledge('${entry._id}')" 
                                class="text-xs bg-gray-600 hover:bg-gray-700 text-white px-2 py-1 rounded transition">
                            <i class="fas fa-edit mr-1"></i>Edit
                        </button>
                        <button onclick="learningManager.deleteKnowledge('${entry._id}')" 
                                class="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded transition">
                            <i class="fas fa-trash mr-1"></i>Delete
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async deleteKnowledge(knowledgeId) {
        if (!confirm('Are you sure you want to delete this knowledge entry?')) return;

        try {
            console.log(`[LearningManager] Deleting knowledge: ${knowledgeId}`);
            const response = await fetch(`/api/learning/${this.companyId}/knowledge/${knowledgeId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Failed to delete knowledge');
            
            this.showSuccess('Knowledge entry deleted');
            await this.loadAnalytics();
            await this.loadApprovedKnowledge();
        } catch (error) {
            console.error('[LearningManager] Error deleting knowledge:', error);
            this.showError('Failed to delete knowledge entry');
        }
    }

    async editKnowledge(knowledgeId) {
        try {
            console.log(`[LearningManager] Opening edit modal for knowledge: ${knowledgeId}`);
            
            // Fetch knowledge details
            const response = await fetch(`/api/learning/knowledge/${this.companyId}?knowledgeId=${knowledgeId}`);
            if (!response.ok) throw new Error('Failed to load knowledge entry');
            
            const knowledge = await response.json();
            const entry = Array.isArray(knowledge) ? knowledge.find(k => k._id === knowledgeId) : knowledge;
            if (!entry) throw new Error('Knowledge entry not found');
            
            // Store current knowledge for modal actions
            this.currentModalKnowledge = entry;
            
            // Populate modal
            document.getElementById('edit-knowledge-question').value = entry.question;
            document.getElementById('edit-knowledge-answer').value = entry.answer;
            document.getElementById('edit-knowledge-category').value = entry.category || 'general';
            document.getElementById('edit-knowledge-status').value = entry.isActive ? 'true' : 'false';
            document.getElementById('edit-knowledge-tags').value = (entry.tags || []).join(', ');
            
            // Show modal
            document.getElementById('knowledge-edit-modal').classList.remove('hidden');
            
        } catch (error) {
            console.error('[LearningManager] Error opening edit modal:', error);
            this.showError('Failed to load knowledge entry details');
        }
    }

    searchKnowledge(query) {
        if (query.trim()) {
            this.loadApprovedKnowledge(`&search=${encodeURIComponent(query)}`);
        } else {
            this.loadApprovedKnowledge();
        }
    }

    updateLearningSetting(setting, value) {
        console.log(`[LearningManager] Updated setting ${setting}:`, value);
        // TODO: Save learning settings to backend
        this.showInfo('Learning settings saved!');
    }

    // Utility methods
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showSuccess(message) {
        this.showToast(message, 'success');
    }

    showError(message) {
        this.showToast(message, 'error');
    }

    showInfo(message) {
        this.showToast(message, 'info');
    }

    showToast(message, type = 'info') {
        // Use existing toast notification system if available
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    // Modal handler functions
    closeSuggestionModal() {
        document.getElementById('suggestion-review-modal').classList.add('hidden');
        this.currentModalSuggestion = null;
    }

    closeKnowledgeModal() {
        document.getElementById('knowledge-edit-modal').classList.add('hidden');
        this.currentModalKnowledge = null;
    }

    async approveSuggestionFromModal() {
        if (!this.currentModalSuggestion) return;

        try {
            const reviewData = {
                category: document.getElementById('suggestion-category').value,
                tags: document.getElementById('suggestion-tags').value.split(',').map(t => t.trim()).filter(t => t),
                reviewNotes: document.getElementById('suggestion-review-notes').value
            };

            // Update answer if edited
            const editedAnswer = document.getElementById('suggestion-answer').value;
            if (editedAnswer !== this.currentModalSuggestion.answer) {
                reviewData.answer = editedAnswer;
            }

            const response = await fetch(`/api/learning/suggestions/${this.currentModalSuggestion._id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reviewData)
            });

            if (!response.ok) throw new Error('Failed to approve suggestion');

            this.showSuccess('Suggestion approved successfully!');
            this.closeSuggestionModal();
            
            // Refresh data
            await this.loadAnalytics();
            await this.loadPendingSuggestions();
            await this.loadApprovedKnowledge();

        } catch (error) {
            console.error('[LearningManager] Error approving suggestion:', error);
            this.showError('Failed to approve suggestion');
        }
    }

    async rejectSuggestionFromModal() {
        if (!this.currentModalSuggestion) return;

        try {
            const reviewData = {
                reviewNotes: document.getElementById('suggestion-review-notes').value
            };

            const response = await fetch(`/api/learning/suggestions/${this.currentModalSuggestion._id}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reviewData)
            });

            if (!response.ok) throw new Error('Failed to reject suggestion');

            this.showSuccess('Suggestion rejected');
            this.closeSuggestionModal();
            
            // Refresh data
            await this.loadAnalytics();
            await this.loadPendingSuggestions();

        } catch (error) {
            console.error('[LearningManager] Error rejecting suggestion:', error);
            this.showError('Failed to reject suggestion');
        }
    }

    async saveKnowledgeFromModal() {
        if (!this.currentModalKnowledge) return;

        try {
            const updateData = {
                question: document.getElementById('edit-knowledge-question').value,
                answer: document.getElementById('edit-knowledge-answer').value,
                category: document.getElementById('edit-knowledge-category').value,
                isActive: document.getElementById('edit-knowledge-status').value === 'true',
                tags: document.getElementById('edit-knowledge-tags').value.split(',').map(t => t.trim()).filter(t => t)
            };

            const response = await fetch(`/api/learning/knowledge/${this.currentModalKnowledge._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateData)
            });

            if (!response.ok) throw new Error('Failed to update knowledge entry');

            this.showSuccess('Knowledge entry updated successfully!');
            this.closeKnowledgeModal();
            
            // Refresh data
            await this.loadApprovedKnowledge();

        } catch (error) {
            console.error('[LearningManager] Error updating knowledge:', error);
            this.showError('Failed to update knowledge entry');
        }
    }

    async deleteKnowledgeFromModal() {
        if (!this.currentModalKnowledge) return;

        if (!confirm('Are you sure you want to delete this knowledge entry? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`/api/learning/knowledge/${this.currentModalKnowledge._id}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw new Error('Failed to delete knowledge entry');

            this.showSuccess('Knowledge entry deleted successfully!');
            this.closeKnowledgeModal();
            
            // Refresh data
            await this.loadAnalytics();
            await this.loadApprovedKnowledge();

        } catch (error) {
            console.error('[LearningManager] Error deleting knowledge:', error);
            this.showError('Failed to delete knowledge entry');
        }
    }
}

// Initialize learning manager when company ID is available
function initLearningManager(companyId) {
    if (companyId && !window.learningManager) {
        window.learningManager = new LearningManager(companyId);
    }
}

// Auto-initialize if company ID is available in URL
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');
    if (companyId) {
        initLearningManager(companyId);
    }
});
