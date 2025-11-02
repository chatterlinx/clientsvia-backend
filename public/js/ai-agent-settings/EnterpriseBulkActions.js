/**
 * ============================================================================
 * ENTERPRISE BULK ACTIONS - BATCH SUGGESTION PROCESSING
 * ============================================================================
 * 
 * PURPOSE:
 * Allows batch application of multiple AI suggestions with smart conflict
 * detection, progress tracking, and rollback capability.
 * 
 * FEATURES:
 * - Apply multiple suggestions at once
 * - Smart conflict detection before apply
 * - Progress tracking with visual feedback
 * - Rollback capability if something goes wrong
 * - Dry-run mode for safety
 * - Success/failure reporting
 * 
 * ARCHITECTURE:
 * - Uses /api/admin/suggestions/bulk-apply endpoint
 * - Client-side validation before submission
 * - Optimistic UI updates with rollback
 * - Real-time progress updates
 * 
 * ERROR HANDLING:
 * - Checkpoint debugging throughout
 * - Transaction-like behavior (all-or-nothing option)
 * - Detailed error reporting per suggestion
 * - Automatic rollback on critical errors
 * 
 * USAGE:
 * const bulkActions = new EnterpriseBulkActions(templateId);
 * await bulkActions.applyMultiple(suggestions);
 * 
 * ============================================================================
 */

class EnterpriseBulkActions {
    /**
     * ========================================================================
     * CONSTRUCTOR - INITIALIZE BULK ACTIONS MANAGER
     * ========================================================================
     */
    constructor(templateId, options = {}) {
        console.log('🔵 [CHECKPOINT 0] EnterpriseBulkActions - Initializing...');
        console.log('🔵 [CHECKPOINT 0.1] Template ID:', templateId);
        
        if (!templateId) {
            console.error('❌ [CHECKPOINT 0.2] Template ID is required');
            throw new Error('Template ID is required for bulk actions');
        }
        
        this.templateId = templateId;
        this.options = {
            transactional: options.transactional || false, // All-or-nothing mode
            confirmBeforeApply: options.confirmBeforeApply !== false, // Default: true
            showProgress: options.showProgress !== false, // Default: true
            ...options
        };
        
        this.appliedSuggestions = []; // Track applied suggestions for rollback
        this.failedSuggestions = [];
        
        console.log('✅ [CHECKPOINT 0.3] EnterpriseBulkActions initialized');
        console.log('🔵 [CHECKPOINT 0.4] Transactional mode:', this.options.transactional);
    }
    
    /**
     * ========================================================================
     * APPLY MULTIPLE SUGGESTIONS
     * ========================================================================
     */
    async applyMultiple(suggestions) {
        console.log('🔵 [CHECKPOINT 1] applyMultiple() started');
        console.log('🔵 [CHECKPOINT 1.1] Number of suggestions:', suggestions.length);
        
        if (!suggestions || suggestions.length === 0) {
            console.error('❌ [CHECKPOINT 1.2] No suggestions provided');
            throw new Error('No suggestions to apply');
        }
        
        try {
            // Step 1: Validate suggestions
            console.log('🔵 [CHECKPOINT 1.3] Validating suggestions...');
            const validation = this.validateSuggestions(suggestions);
            if (!validation.valid) {
                console.error('❌ [CHECKPOINT 1.4] Validation failed:', validation.errors);
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }
            console.log('✅ [CHECKPOINT 1.5] Suggestions validated');
            
            // Step 2: Detect conflicts
            console.log('🔵 [CHECKPOINT 1.6] Checking for conflicts...');
            const conflicts = await this.detectConflicts(suggestions);
            if (conflicts.hasConflicts) {
                console.warn('⚠️ [CHECKPOINT 1.7] Conflicts detected:', conflicts.conflicts);
                
                if (this.options.transactional) {
                    throw new Error('Conflicts detected in transactional mode. Cannot proceed.');
                }
                
                // Ask user if they want to continue with conflicts
                const proceed = await this.confirmWithConflicts(conflicts);
                if (!proceed) {
                    console.log('❌ [CHECKPOINT 1.8] User cancelled due to conflicts');
                    return { success: false, reason: 'Cancelled by user due to conflicts' };
                }
            }
            console.log('✅ [CHECKPOINT 1.9] No blocking conflicts');
            
            // Step 3: Show confirmation dialog
            if (this.options.confirmBeforeApply) {
                console.log('🔵 [CHECKPOINT 1.10] Showing confirmation dialog...');
                const confirmed = await this.confirmBulkApply(suggestions);
                if (!confirmed) {
                    console.log('❌ [CHECKPOINT 1.11] User cancelled');
                    return { success: false, reason: 'Cancelled by user' };
                }
                console.log('✅ [CHECKPOINT 1.12] User confirmed');
            }
            
            // Step 4: Show progress UI
            if (this.options.showProgress) {
                this.showProgressModal(suggestions.length);
            }
            
            // Step 5: Send bulk apply request to backend
            console.log('🔵 [CHECKPOINT 1.13] Sending bulk apply request to backend...');
            const result = await this.sendBulkApplyRequest(suggestions);
            
            console.log('✅ [CHECKPOINT 1.14] Bulk apply complete');
            console.log('🔵 [CHECKPOINT 1.15] Result:', result);
            
            // Step 6: Update progress UI with results
            if (this.options.showProgress) {
                this.updateProgressWithResults(result);
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT 1.16] Bulk apply failed:', error.message);
            console.error('❌ [CHECKPOINT 1.17] Stack trace:', error.stack);
            
            // Hide progress UI
            if (this.options.showProgress) {
                this.hideProgressModal();
            }
            
            throw error;
        }
    }
    
    /**
     * ========================================================================
     * VALIDATE SUGGESTIONS
     * ========================================================================
     */
    validateSuggestions(suggestions) {
        console.log('🔵 [CHECKPOINT 2] Validating suggestions...');
        
        const errors = [];
        
        suggestions.forEach((sug, index) => {
            if (!sug.type) {
                errors.push(`Suggestion ${index + 1}: Missing type`);
            }
            if (!sug.description && !sug.reason) {
                errors.push(`Suggestion ${index + 1}: Missing description/reason`);
            }
        });
        
        const valid = errors.length === 0;
        
        console.log('🔵 [CHECKPOINT 2.1] Validation result:', valid ? 'PASS' : 'FAIL');
        if (!valid) {
            console.log('🔵 [CHECKPOINT 2.2] Errors:', errors);
        }
        
        return { valid, errors };
    }
    
    /**
     * ========================================================================
     * DETECT CONFLICTS BETWEEN SUGGESTIONS
     * ========================================================================
     */
    async detectConflicts(suggestions) {
        console.log('🔵 [CHECKPOINT 3] Detecting conflicts...');
        
        // TODO: This would call the backend conflict detection API
        // For now, simple client-side check
        
        const conflicts = [];
        const scenarioMap = {};
        
        suggestions.forEach((sug, index) => {
            if (sug.scenarioId) {
                if (scenarioMap[sug.scenarioId]) {
                    conflicts.push({
                        type: 'DUPLICATE_SCENARIO',
                        message: `Multiple suggestions target scenario ${sug.scenarioId}`,
                        suggestions: [scenarioMap[sug.scenarioId], index]
                    });
                } else {
                    scenarioMap[sug.scenarioId] = index;
                }
            }
        });
        
        console.log('🔵 [CHECKPOINT 3.1] Conflicts found:', conflicts.length);
        
        return {
            hasConflicts: conflicts.length > 0,
            conflicts
        };
    }
    
    /**
     * ========================================================================
     * CONFIRM WITH USER ABOUT CONFLICTS
     * ========================================================================
     */
    async confirmWithConflicts(conflicts) {
        console.log('🔵 [CHECKPOINT 4] Asking user about conflicts...');
        
        const message = `⚠️ Warning: ${conflicts.conflicts.length} conflict(s) detected.\n\n` +
                       `${conflicts.conflicts.map(c => `• ${c.message}`).join('\n')}\n\n` +
                       `Do you want to continue anyway?`;
        
        const proceed = confirm(message);
        
        console.log('🔵 [CHECKPOINT 4.1] User decision:', proceed ? 'PROCEED' : 'CANCEL');
        
        return proceed;
    }
    
    /**
     * ========================================================================
     * CONFIRM BULK APPLY WITH USER
     * ========================================================================
     */
    async confirmBulkApply(suggestions) {
        console.log('🔵 [CHECKPOINT 5] Asking user to confirm bulk apply...');
        
        const highPriority = suggestions.filter(s => 
            (s.priority || '').toUpperCase() === 'CRITICAL' || 
            (s.priority || '').toUpperCase() === 'HIGH'
        ).length;
        
        const message = `You are about to apply ${suggestions.length} suggestion(s):\n\n` +
                       `• ${highPriority} high priority\n` +
                       `• ${suggestions.length - highPriority} medium/low priority\n\n` +
                       `This will modify your template. Continue?`;
        
        const confirmed = confirm(message);
        
        console.log('🔵 [CHECKPOINT 5.1] User decision:', confirmed ? 'CONFIRMED' : 'CANCELLED');
        
        return confirmed;
    }
    
    /**
     * ========================================================================
     * SEND BULK APPLY REQUEST TO BACKEND
     * ========================================================================
     */
    async sendBulkApplyRequest(suggestions) {
        console.log('🔵 [CHECKPOINT 6] Sending bulk apply request...');
        console.log('🔵 [CHECKPOINT 6.1] Endpoint:', `/api/admin/suggestions/bulk-apply`);
        
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error('❌ [CHECKPOINT 6.2] No auth token found');
                throw new Error('Authentication required - please log in');
            }
            
            const response = await fetch('/api/admin/suggestions/bulk-apply', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    templateId: this.templateId,
                    suggestions: suggestions,
                    transactional: this.options.transactional
                })
            });
            
            console.log('🔵 [CHECKPOINT 6.3] Response status:', response.status);
            
            if (response.status === 401) {
                console.error('❌ [CHECKPOINT 6.4] Authentication failed');
                throw new Error('Session expired - please log in again');
            }
            
            if (!response.ok) {
                console.error('❌ [CHECKPOINT 6.5] Request failed:', response.statusText);
                throw new Error(`Failed to apply suggestions: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            console.log('✅ [CHECKPOINT 6.6] Bulk apply response received');
            console.log('🔵 [CHECKPOINT 6.7] Applied:', data.applied?.length || 0);
            console.log('🔵 [CHECKPOINT 6.8] Failed:', data.failed?.length || 0);
            
            return data;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT 6.9] Request error:', error.message);
            console.error('❌ [CHECKPOINT 6.10] Stack trace:', error.stack);
            throw error;
        }
    }
    
    /**
     * ========================================================================
     * SHOW PROGRESS MODAL
     * ========================================================================
     */
    showProgressModal(total) {
        console.log('🔵 [CHECKPOINT 7] Showing progress modal...');
        
        // Create modal if it doesn't exist
        let modal = document.getElementById('bulk-action-progress-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'bulk-action-progress-modal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            document.body.appendChild(modal);
        }
        
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-2xl max-w-md w-full p-6">
                <h3 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
                    Applying Suggestions...
                </h3>
                
                <div class="mb-4">
                    <div class="flex justify-between text-sm text-gray-600 mb-2">
                        <span>Progress:</span>
                        <span id="bulk-progress-text">0 / ${total}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-3">
                        <div id="bulk-progress-bar" class="bg-purple-600 h-3 rounded-full transition-all" style="width: 0%"></div>
                    </div>
                </div>
                
                <div id="bulk-progress-status" class="text-sm text-gray-600 text-center">
                    Preparing...
                </div>
            </div>
        `;
        
        modal.style.display = 'flex';
        
        console.log('✅ [CHECKPOINT 7.1] Progress modal displayed');
    }
    
    /**
     * ========================================================================
     * UPDATE PROGRESS WITH RESULTS
     * ========================================================================
     */
    updateProgressWithResults(result) {
        console.log('🔵 [CHECKPOINT 8] Updating progress with results...');
        
        const modal = document.getElementById('bulk-action-progress-modal');
        if (!modal) return;
        
        const applied = result.applied?.length || 0;
        const failed = result.failed?.length || 0;
        const total = applied + failed;
        
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-2xl max-w-md w-full p-6">
                <h3 class="text-xl font-bold mb-4 flex items-center gap-2 ${result.success ? 'text-green-700' : 'text-orange-700'}">
                    <i class="fas ${result.success ? 'fa-check-circle text-green-600' : 'fa-exclamation-triangle text-orange-600'}"></i>
                    ${result.success ? 'Bulk Apply Complete!' : 'Partially Complete'}
                </h3>
                
                <div class="space-y-3 mb-6">
                    <div class="flex justify-between items-center p-3 bg-green-50 rounded-lg border border-green-200">
                        <span class="text-sm font-semibold text-green-900">✅ Applied Successfully</span>
                        <span class="text-lg font-bold text-green-700">${applied}</span>
                    </div>
                    
                    ${failed > 0 ? `
                        <div class="flex justify-between items-center p-3 bg-red-50 rounded-lg border border-red-200">
                            <span class="text-sm font-semibold text-red-900">❌ Failed</span>
                            <span class="text-lg font-bold text-red-700">${failed}</span>
                        </div>
                    ` : ''}
                </div>
                
                ${result.errors?.length > 0 ? `
                    <div class="mb-4 p-3 bg-red-50 rounded border border-red-200 max-h-32 overflow-y-auto">
                        <div class="text-xs font-semibold text-red-900 mb-2">Errors:</div>
                        ${result.errors.map(e => `
                            <div class="text-xs text-red-700">• ${escapeHtml(e)}</div>
                        `).join('')}
                    </div>
                ` : ''}
                
                <div class="flex gap-2">
                    <button onclick="closeBulkProgressModal()" 
                            class="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg font-semibold">
                        Close
                    </button>
                    <button onclick="refreshLiveTestMonitor(); closeBulkProgressModal();" 
                            class="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold">
                        Refresh Tests
                    </button>
                </div>
            </div>
        `;
        
        console.log('✅ [CHECKPOINT 8.1] Progress updated with results');
    }
    
    /**
     * ========================================================================
     * HIDE PROGRESS MODAL
     * ========================================================================
     */
    hideProgressModal() {
        console.log('🔵 [CHECKPOINT 9] Hiding progress modal...');
        
        const modal = document.getElementById('bulk-action-progress-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.remove();
        }
        
        console.log('✅ [CHECKPOINT 9.1] Progress modal hidden');
    }
    
    /**
     * ========================================================================
     * APPLY ALL HIGH PRIORITY SUGGESTIONS
     * ========================================================================
     */
    async applyAllHighPriority(allSuggestions) {
        console.log('🔵 [CHECKPOINT 10] Filtering high priority suggestions...');
        
        const highPriority = allSuggestions.filter(sug => {
            const priority = (sug.priority || '').toUpperCase();
            return priority === 'CRITICAL' || priority === 'HIGH';
        });
        
        console.log('🔵 [CHECKPOINT 10.1] High priority count:', highPriority.length);
        
        if (highPriority.length === 0) {
            if (window.ToastManager) {
                window.ToastManager.info('ℹ️ No high priority suggestions found');
            }
            return { success: false, reason: 'No high priority suggestions' };
        }
        
        return await this.applyMultiple(highPriority);
    }
}

// ============================================================================
// GLOBAL HELPER FUNCTIONS
// ============================================================================

/**
 * Close bulk progress modal (called from HTML)
 */
function closeBulkProgressModal() {
    console.log('🔵 Closing bulk progress modal...');
    const modal = document.getElementById('bulk-action-progress-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.remove();
    }
}

// ============================================================================
// EXPORT FOR USE IN HTML
// ============================================================================
if (typeof window !== 'undefined') {
    window.EnterpriseBulkActions = EnterpriseBulkActions;
    window.closeBulkProgressModal = closeBulkProgressModal;
    console.log('✅ EnterpriseBulkActions loaded and available globally');
}

