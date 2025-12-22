/**
 * ============================================================================
 * JSON EXPORT MANAGER
 * ============================================================================
 * 
 * Provides JSON export and autofill functionality for the Global AI Brain.
 * Enables ChatGPT (Prime) → AI Coder workflow:
 * 1) Export template/category/scenario as JSON
 * 2) Apply scenario spec to auto-fill UI forms
 * 
 * GLOBAL FUNCTIONS:
 * - window.exportTemplateJSON(templateId)
 * - window.exportCategoryJSON(templateId, categoryId)
 * - window.exportScenarioJSON(templateId, categoryId, scenarioId)
 * - window.applyScenarioSpec(scenarioSpec)
 * - window.applyTemplateSpec(templateSpec)
 * 
 * ============================================================================
 */

(function() {
    'use strict';
    
    const API_BASE = '';
    
    // ========================================================================
    // EXPORT FUNCTIONS
    // ========================================================================
    
    /**
     * Export entire template as JSON
     */
    window.exportTemplateJSON = async function(templateId) {
        try {
            if (!templateId) {
                templateId = window.currentTemplateId || window.templateId;
            }
            
            if (!templateId) {
                showExportToast('❌ No template selected', 'error');
                return null;
            }
            
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`${API_BASE}/api/export/template/${templateId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                const json = JSON.stringify(result.export, null, 2);
                
                // Copy to clipboard
                await navigator.clipboard.writeText(json);
                
                showExportToast(`✅ Template exported! ${result.export.summary?.scenarioCount || 0} scenarios copied to clipboard.`, 'success');
                
                // Also log to console for debugging
                console.log('[EXPORT] Template JSON:', result.export);
                
                return result.export;
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('[EXPORT] Error:', error);
            showExportToast(`❌ Export failed: ${error.message}`, 'error');
            return null;
        }
    };
    
    /**
     * Export single category as JSON
     */
    window.exportCategoryJSON = async function(templateId, categoryId) {
        try {
            if (!templateId) {
                templateId = window.currentTemplateId || window.templateId;
            }
            
            if (!templateId || !categoryId) {
                showExportToast('❌ Template ID and Category ID required', 'error');
                return null;
            }
            
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`${API_BASE}/api/export/category/${templateId}/${categoryId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                const json = JSON.stringify(result.export, null, 2);
                await navigator.clipboard.writeText(json);
                
                showExportToast(`✅ Category exported! ${result.export.category?.scenarioCount || 0} scenarios copied.`, 'success');
                console.log('[EXPORT] Category JSON:', result.export);
                
                return result.export;
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('[EXPORT] Error:', error);
            showExportToast(`❌ Export failed: ${error.message}`, 'error');
            return null;
        }
    };
    
    /**
     * Export single scenario as JSON
     */
    window.exportScenarioJSON = async function(templateId, categoryId, scenarioId) {
        try {
            if (!templateId) {
                templateId = window.currentTemplateId || window.templateId;
            }
            
            if (!templateId || !categoryId || !scenarioId) {
                showExportToast('❌ Template, Category, and Scenario IDs required', 'error');
                return null;
            }
            
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const response = await fetch(`${API_BASE}/api/export/scenario/${templateId}/${categoryId}/${scenarioId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                const json = JSON.stringify(result.export, null, 2);
                await navigator.clipboard.writeText(json);
                
                const validation = result.export.validation;
                const status = validation?.valid ? '✅' : '⚠️';
                showExportToast(`${status} Scenario exported! Triggers: ${validation?.stats?.triggerCount || 0}`, 'success');
                console.log('[EXPORT] Scenario JSON:', result.export);
                
                return result.export;
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('[EXPORT] Error:', error);
            showExportToast(`❌ Export failed: ${error.message}`, 'error');
            return null;
        }
    };
    
    // ========================================================================
    // AUTOFILL FUNCTIONS (Phase C)
    // ========================================================================
    
    /**
     * Apply scenario spec to auto-fill the scenario edit form
     * This is the deterministic execution endpoint for ChatGPT directives
     */
    window.applyScenarioSpec = async function(scenarioSpec) {
        console.log('[AUTOFILL] Applying scenario spec:', scenarioSpec);
        
        try {
            // Validate required fields
            if (!scenarioSpec) {
                throw new Error('No scenario spec provided');
            }
            
            const results = {
                fieldsSet: [],
                errors: [],
                warnings: []
            };
            
            // Basic Info fields
            if (scenarioSpec.name) {
                setFieldValue('scenario-name', scenarioSpec.name);
                results.fieldsSet.push('name');
            }
            
            // Triggers
            if (scenarioSpec.triggers && Array.isArray(scenarioSpec.triggers)) {
                setTriggersField(scenarioSpec.triggers);
                results.fieldsSet.push(`triggers (${scenarioSpec.triggers.length})`);
            }
            
            // Negative Triggers
            if (scenarioSpec.negativeTriggers && Array.isArray(scenarioSpec.negativeTriggers)) {
                setNegativeTriggersField(scenarioSpec.negativeTriggers);
                results.fieldsSet.push(`negativeTriggers (${scenarioSpec.negativeTriggers.length})`);
            }
            
            // Quick Replies
            if (scenarioSpec.quickReplies && Array.isArray(scenarioSpec.quickReplies)) {
                setRepliesField('quick', scenarioSpec.quickReplies);
                results.fieldsSet.push(`quickReplies (${scenarioSpec.quickReplies.length})`);
            }
            
            // Full Replies
            if (scenarioSpec.fullReplies && Array.isArray(scenarioSpec.fullReplies)) {
                setRepliesField('full', scenarioSpec.fullReplies);
                results.fieldsSet.push(`fullReplies (${scenarioSpec.fullReplies.length})`);
            }
            
            // Confidence
            if (scenarioSpec.minConfidence !== undefined) {
                setFieldValue('min-confidence', scenarioSpec.minConfidence);
                results.fieldsSet.push('minConfidence');
            }
            
            // Priority
            if (scenarioSpec.priority !== undefined) {
                setFieldValue('priority', scenarioSpec.priority);
                results.fieldsSet.push('priority');
            }
            
            // Reply Selection Strategy
            if (scenarioSpec.replySelectionStrategy) {
                setSelectValue('reply-strategy', scenarioSpec.replySelectionStrategy);
                results.fieldsSet.push('replySelectionStrategy');
            }
            
            // Channel
            if (scenarioSpec.channel) {
                setSelectValue('channel', scenarioSpec.channel);
                results.fieldsSet.push('channel');
            }
            
            // Language
            if (scenarioSpec.language) {
                setSelectValue('language', scenarioSpec.language);
                results.fieldsSet.push('language');
            }
            
            // Scenario Type
            if (scenarioSpec.scenarioType) {
                setSelectValue('scenario-type', scenarioSpec.scenarioType);
                results.fieldsSet.push('scenarioType');
            }
            
            // Status
            if (scenarioSpec.status) {
                setSelectValue('scenario-status', scenarioSpec.status);
                results.fieldsSet.push('status');
            }
            
            // Enabled
            if (scenarioSpec.enabled !== undefined) {
                setCheckboxValue('scenario-enabled', scenarioSpec.enabled);
                results.fieldsSet.push('enabled');
            }
            
            // Log results
            console.log('[AUTOFILL] Applied:', results);
            showExportToast(`✅ Auto-filled ${results.fieldsSet.length} fields. Ready to save.`, 'success');
            
            return {
                success: true,
                fieldsSet: results.fieldsSet,
                errors: results.errors,
                warnings: results.warnings
            };
            
        } catch (error) {
            console.error('[AUTOFILL] Error:', error);
            showExportToast(`❌ Autofill failed: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    };
    
    /**
     * Apply template-level spec (synonyms, fillers, settings)
     */
    window.applyTemplateSpec = async function(templateSpec) {
        console.log('[AUTOFILL] Applying template spec:', templateSpec);
        
        try {
            const results = {
                fieldsSet: [],
                errors: [],
                warnings: []
            };
            
            // Template name
            if (templateSpec.templateName) {
                setFieldValue('template-name', templateSpec.templateName);
                results.fieldsSet.push('templateName');
            }
            
            // Synonyms (if SynonymManager is available)
            if (templateSpec.synonyms && window.SynonymManager) {
                // This would need to interface with SynonymManager
                results.warnings.push('Synonyms must be applied via SynonymManager UI');
            }
            
            // Fillers (if FillerManager is available)
            if (templateSpec.fillers && window.FillerManager) {
                // This would need to interface with FillerManager
                results.warnings.push('Fillers must be applied via FillerManager UI');
            }
            
            console.log('[AUTOFILL] Template applied:', results);
            showExportToast(`✅ Template spec applied. ${results.warnings.length} warnings.`, 'success');
            
            return {
                success: true,
                fieldsSet: results.fieldsSet,
                errors: results.errors,
                warnings: results.warnings
            };
            
        } catch (error) {
            console.error('[AUTOFILL] Error:', error);
            showExportToast(`❌ Template autofill failed: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    };
    
    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================
    
    function setFieldValue(fieldId, value) {
        // Try multiple possible selectors
        const selectors = [
            `#${fieldId}`,
            `[name="${fieldId}"]`,
            `[data-field="${fieldId}"]`,
            `.${fieldId}-input`,
            `#scenario-${fieldId}`,
            `#edit-scenario-${fieldId}`
        ];
        
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                element.value = value;
                // Trigger change event
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
        }
        
        console.warn(`[AUTOFILL] Field not found: ${fieldId}`);
        return false;
    }
    
    function setSelectValue(fieldId, value) {
        return setFieldValue(fieldId, value);
    }
    
    function setCheckboxValue(fieldId, checked) {
        const selectors = [
            `#${fieldId}`,
            `[name="${fieldId}"]`,
            `[data-field="${fieldId}"]`
        ];
        
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.type === 'checkbox') {
                element.checked = checked;
                element.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
        
        return false;
    }
    
    function setTriggersField(triggers) {
        // Look for triggers textarea or tags input
        const selectors = [
            '#scenario-triggers',
            '#triggers-input',
            '[name="triggers"]',
            '.triggers-textarea',
            '#edit-triggers'
        ];
        
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                // If it's a textarea, join with newlines
                if (element.tagName === 'TEXTAREA') {
                    element.value = triggers.join('\n');
                } else {
                    element.value = triggers.join(', ');
                }
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
        }
        
        // Try to find a tag input system
        if (window.addTriggerTag) {
            triggers.forEach(t => window.addTriggerTag(t));
            return true;
        }
        
        console.warn('[AUTOFILL] Triggers field not found');
        return false;
    }
    
    function setNegativeTriggersField(negativeTriggers) {
        const selectors = [
            '#negative-triggers',
            '#scenario-negative-triggers',
            '[name="negativeTriggers"]',
            '.negative-triggers-textarea'
        ];
        
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                if (element.tagName === 'TEXTAREA') {
                    element.value = negativeTriggers.join('\n');
                } else {
                    element.value = negativeTriggers.join(', ');
                }
                element.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
        
        return false;
    }
    
    function setRepliesField(type, replies) {
        const selectors = type === 'quick' ? [
            '#quick-replies',
            '#scenario-quick-replies',
            '[name="quickReplies"]',
            '.quick-replies-textarea'
        ] : [
            '#full-replies',
            '#scenario-full-replies',
            '[name="fullReplies"]',
            '.full-replies-textarea'
        ];
        
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                // Replies should be joined with double newlines for readability
                element.value = replies.join('\n\n');
                element.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
        
        // Try array-based reply system
        const addFn = type === 'quick' ? window.addQuickReply : window.addFullReply;
        if (addFn) {
            replies.forEach(r => addFn(r));
            return true;
        }
        
        return false;
    }
    
    function showExportToast(message, type = 'info') {
        // Use existing toast system if available
        if (window.showToast) {
            window.showToast(message, type);
            return;
        }
        
        if (window.ToastManager) {
            const method = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
            window.ToastManager[method](message);
            return;
        }
        
        // Fallback: create simple toast
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 16px 24px;
            background: ${type === 'error' ? '#dc2626' : type === 'success' ? '#059669' : '#3b82f6'};
            color: white;
            border-radius: 8px;
            font-weight: 600;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
    
    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    console.log('[JSON EXPORT MANAGER] Loaded. Available functions:');
    console.log('  - window.exportTemplateJSON(templateId)');
    console.log('  - window.exportCategoryJSON(templateId, categoryId)');
    console.log('  - window.exportScenarioJSON(templateId, categoryId, scenarioId)');
    console.log('  - window.applyScenarioSpec(scenarioSpec)');
    console.log('  - window.applyTemplateSpec(templateSpec)');
    
})();

