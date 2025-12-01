/**
 * ============================================================================
 * FRONTLINE SCRIPT BUILDER UI
 * ============================================================================
 * 
 * PURPOSE: Admin-only LLM-powered script generation panel
 * LOCATION: Frontline-Intel tab (above the textarea)
 * 
 * FLOW:
 * 1. Load company context (Brain-2, Triage, Booking, Transfer)
 * 2. Admin writes brief + selects tone/aggro
 * 3. Click "Generate Script Draft"
 * 4. LLM generates script
 * 5. Script appears in textarea (admin can edit)
 * 
 * ============================================================================
 */

class FrontlineScriptBuilder {
    constructor(companyId, containerId = 'frontline-script-builder-panel') {
        this.companyId = companyId;
        this.containerId = containerId;
        this.context = null;
        this.presets = null;
        this.isLoading = false;
        
        console.log('[SCRIPT BUILDER] Initialized for company:', companyId);
    }
    
    /**
     * Render the Script Builder panel
     */
    async render(targetElement) {
        console.log('[SCRIPT BUILDER] Rendering panel');
        
        // Create container if it doesn't exist
        let container = document.getElementById(this.containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = this.containerId;
            if (targetElement) {
                targetElement.insertBefore(container, targetElement.firstChild);
            } else {
                document.body.appendChild(container);
            }
        }
        
        // Initial loading state
        container.innerHTML = this.getLoadingHTML();
        
        try {
            // Load presets and context in parallel
            const [presetsRes, contextRes] = await Promise.all([
                this.fetchPresets(),
                this.fetchContext()
            ]);
            
            this.presets = presetsRes;
            this.context = contextRes;
            
            // Render full UI
            container.innerHTML = this.getBuilderHTML();
            this.attachEventListeners(container);
            
        } catch (error) {
            console.error('[SCRIPT BUILDER] Error rendering:', error);
            container.innerHTML = this.getErrorHTML(error.message);
        }
    }
    
    /**
     * Fetch presets from API
     */
    async fetchPresets() {
        const response = await fetch('/api/admin/frontline-script/presets', {
            headers: this.getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load presets');
        return response.json();
    }
    
    /**
     * Fetch context from API
     */
    async fetchContext() {
        const response = await fetch(`/api/admin/frontline-script/context/${this.companyId}`, {
            headers: this.getAuthHeaders()
        });
        
        if (!response.ok) throw new Error('Failed to load context');
        return response.json();
    }
    
    /**
     * Get auth headers
     */
    getAuthHeaders() {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }
    
    /**
     * Loading HTML
     */
    getLoadingHTML() {
        return `
            <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); 
                        border-radius: 12px; padding: 24px; margin-bottom: 20px;
                        color: white; text-align: center;">
                <i class="fas fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 12px;"></i>
                <p style="font-size: 14px; opacity: 0.9;">Loading Script Builder...</p>
            </div>
        `;
    }
    
    /**
     * Error HTML
     */
    getErrorHTML(message) {
        return `
            <div style="background: #fef2f2; border: 1px solid #fecaca; 
                        border-radius: 12px; padding: 24px; margin-bottom: 20px;">
                <h3 style="color: #dc2626; font-size: 16px; margin-bottom: 8px;">
                    <i class="fas fa-exclamation-triangle"></i> Script Builder Error
                </h3>
                <p style="color: #991b1b; font-size: 14px;">${message}</p>
                <button onclick="location.reload()" 
                        style="margin-top: 12px; padding: 8px 16px; background: #dc2626; 
                               color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Retry
                </button>
            </div>
        `;
    }
    
    /**
     * Main builder HTML
     */
    getBuilderHTML() {
        const company = this.context?.company || {};
        const brain2 = this.context?.brain2 || {};
        const triage = this.context?.triage || {};
        const tonePresets = this.presets?.tonePresets || [];
        const aggroLevels = this.presets?.aggressivenessLevels || [];
        
        return `
            <div id="${this.containerId}" class="script-builder-panel" 
                 style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); 
                        border-radius: 12px; padding: 24px; margin-bottom: 20px; color: white;">
                
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                    <div>
                        <h2 style="font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-magic"></i>
                            Frontline Script Builder (Admin-Only)
                        </h2>
                        <p style="font-size: 13px; opacity: 0.9; margin-top: 4px;">
                            Use your AiCore scenarios and triage rules to auto-generate a receptionist script.
                        </p>
                    </div>
                    <button id="toggle-builder-btn" onclick="this.closest('.script-builder-panel').classList.toggle('collapsed')"
                            style="padding: 6px 12px; background: rgba(255,255,255,0.2); border: none; 
                                   border-radius: 6px; color: white; cursor: pointer; font-size: 12px;">
                        <i class="fas fa-chevron-up"></i> Collapse
                    </button>
                </div>
                
                <!-- Context Summary -->
                <div class="builder-content" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
                        <div style="text-align: center; padding: 8px;">
                            <div style="font-size: 24px; font-weight: 700;">${brain2.categories?.length || 0}</div>
                            <div style="font-size: 11px; opacity: 0.8;">Categories</div>
                        </div>
                        <div style="text-align: center; padding: 8px;">
                            <div style="font-size: 24px; font-weight: 700;">${brain2.scenarios?.length || 0}</div>
                            <div style="font-size: 11px; opacity: 0.8;">Scenarios</div>
                        </div>
                        <div style="text-align: center; padding: 8px;">
                            <div style="font-size: 24px; font-weight: 700;">${triage.cards?.length || 0}</div>
                            <div style="font-size: 11px; opacity: 0.8;">Triage Cards</div>
                        </div>
                        <div style="text-align: center; padding: 8px;">
                            <div style="font-size: 24px; font-weight: 700;">${this.context?.bookingRules?.length || 0}</div>
                            <div style="font-size: 11px; opacity: 0.8;">Booking Rules</div>
                        </div>
                        <div style="text-align: center; padding: 8px;">
                            <div style="font-size: 24px; font-weight: 700;">${this.context?.transferRules?.length || 0}</div>
                            <div style="font-size: 11px; opacity: 0.8;">Transfer Rules</div>
                        </div>
                    </div>
                    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px;">
                        <strong>Trade:</strong> ${company.trade || 'Not set'} &nbsp;|&nbsp;
                        <strong>Company:</strong> ${company.name || 'Unknown'}
                    </div>
                </div>
                
                <!-- Form -->
                <div class="builder-content" style="display: grid; gap: 16px;">
                    
                    <!-- Admin Brief -->
                    <div>
                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px;">
                            <i class="fas fa-comment-alt"></i> Describe this business and preferences
                        </label>
                        <textarea id="admin-brief-input" rows="3"
                                  placeholder="e.g., High-end residential HVAC company in Southwest Florida. Priority is emergency calls, then maintenance appointments. Tone should be warm but professional. Always capture email for follow-up."
                                  style="width: 100%; padding: 12px; border: none; border-radius: 8px; 
                                         font-size: 13px; line-height: 1.5; resize: vertical;"></textarea>
                    </div>
                    
                    <!-- Options Row -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
                        
                        <!-- Tone Preset -->
                        <div>
                            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">
                                <i class="fas fa-theater-masks"></i> Tone
                            </label>
                            <select id="tone-preset-select" 
                                    style="width: 100%; padding: 10px; border: none; border-radius: 6px; font-size: 13px;">
                                ${tonePresets.map(t => `
                                    <option value="${t.value}" ${t.value === 'professional_warm' ? 'selected' : ''}>
                                        ${t.name}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        
                        <!-- Lead Capture -->
                        <div>
                            <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">
                                <i class="fas fa-user-plus"></i> Lead Capture
                            </label>
                            <select id="aggressiveness-select" 
                                    style="width: 100%; padding: 10px; border: none; border-radius: 6px; font-size: 13px;">
                                ${aggroLevels.map(a => `
                                    <option value="${a.value}" ${a.value === 'medium' ? 'selected' : ''}>
                                        ${a.name} - ${a.description}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        
                        <!-- Include Examples -->
                        <div style="display: flex; align-items: center; gap: 8px; padding-top: 20px;">
                            <input type="checkbox" id="include-examples-checkbox" checked
                                   style="width: 18px; height: 18px;">
                            <label for="include-examples-checkbox" style="font-size: 13px;">
                                Include example dialogues
                            </label>
                        </div>
                    </div>
                    
                    <!-- Generate Button -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
                        <p style="font-size: 11px; opacity: 0.7; max-width: 400px;">
                            ⚠️ This will replace the current script in the editor. You can undo (Cmd+Z) before saving.
                        </p>
                        <button id="generate-script-btn" 
                                style="padding: 12px 24px; background: #10b981; border: none; border-radius: 8px;
                                       color: white; font-size: 14px; font-weight: 600; cursor: pointer;
                                       display: flex; align-items: center; gap: 8px; transition: all 0.2s;">
                            <i class="fas fa-wand-magic-sparkles"></i>
                            Generate Script Draft
                        </button>
                    </div>
                </div>
                
                <!-- Recent Drafts (collapsed by default) -->
                <details style="margin-top: 16px;" class="builder-content">
                    <summary style="cursor: pointer; font-size: 13px; opacity: 0.9;">
                        <i class="fas fa-history"></i> View Recent Drafts
                    </summary>
                    <div id="recent-drafts-container" style="margin-top: 12px; background: rgba(255,255,255,0.1); 
                                                             border-radius: 8px; padding: 12px; max-height: 200px; overflow-y: auto;">
                        <p style="font-size: 12px; opacity: 0.7;">Loading...</p>
                    </div>
                </details>
            </div>
            
            <style>
                .script-builder-panel.collapsed .builder-content {
                    display: none !important;
                }
                .script-builder-panel.collapsed #toggle-builder-btn i {
                    transform: rotate(180deg);
                }
                #generate-script-btn:hover {
                    background: #059669;
                    transform: translateY(-1px);
                }
                #generate-script-btn:disabled {
                    background: #6b7280;
                    cursor: not-allowed;
                    transform: none;
                }
            </style>
        `;
    }
    
    /**
     * Attach event listeners
     */
    attachEventListeners(container) {
        // Generate button
        const generateBtn = container.querySelector('#generate-script-btn');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.handleGenerate());
        }
        
        // Load recent drafts when details is opened
        const details = container.querySelector('details');
        if (details) {
            details.addEventListener('toggle', () => {
                if (details.open) {
                    this.loadRecentDrafts();
                }
            });
        }
    }
    
    /**
     * Handle generate button click
     */
    async handleGenerate() {
        if (this.isLoading) return;
        
        const generateBtn = document.getElementById('generate-script-btn');
        const adminBrief = document.getElementById('admin-brief-input')?.value || '';
        const tonePreset = document.getElementById('tone-preset-select')?.value || 'professional_warm';
        const aggressiveness = document.getElementById('aggressiveness-select')?.value || 'medium';
        const includeExamples = document.getElementById('include-examples-checkbox')?.checked ?? true;
        
        this.isLoading = true;
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        
        try {
            const response = await fetch('/api/admin/frontline-script/generate', {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify({
                    companyId: this.companyId,
                    versionId: `draft-${Date.now()}`,
                    adminBrief,
                    tonePreset,
                    aggressiveness,
                    includeExamples
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Generation failed');
            }
            
            const result = await response.json();
            
            if (result.scriptText) {
                // Send script to the parent page / textarea
                this.applyGeneratedScript(result.scriptText);
                
                // Show success
                this.showNotification('✅ Script generated! Review and save when ready.', 'success');
            } else {
                throw new Error('No script returned');
            }
            
        } catch (error) {
            console.error('[SCRIPT BUILDER] Generation error:', error);
            this.showNotification(`❌ ${error.message}`, 'error');
        } finally {
            this.isLoading = false;
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Script Draft';
        }
    }
    
    /**
     * Apply generated script to the textarea
     */
    applyGeneratedScript(scriptText) {
        // Try multiple possible textarea locations
        const possibleTextareas = [
            document.getElementById('frontline-intel-textarea'),
            document.getElementById('company-instructions-textarea'),
            document.querySelector('textarea[name="companyInstructions"]'),
            document.querySelector('.frontline-intel-editor textarea')
        ];
        
        for (const textarea of possibleTextareas) {
            if (textarea) {
                textarea.value = scriptText;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('[SCRIPT BUILDER] Applied script to textarea');
                return;
            }
        }
        
        // If in popup, send to parent
        if (window.opener) {
            window.opener.postMessage({
                type: 'frontlineScriptGenerated',
                scriptText
            }, '*');
            console.log('[SCRIPT BUILDER] Sent script to parent window');
            return;
        }
        
        // Fallback: dispatch custom event
        window.dispatchEvent(new CustomEvent('frontlineScriptGenerated', {
            detail: { scriptText }
        }));
        console.log('[SCRIPT BUILDER] Dispatched script event');
    }
    
    /**
     * Load recent drafts
     */
    async loadRecentDrafts() {
        const container = document.getElementById('recent-drafts-container');
        if (!container) return;
        
        try {
            const response = await fetch(`/api/admin/frontline-script/drafts/${this.companyId}?limit=5`, {
                headers: this.getAuthHeaders()
            });
            
            if (!response.ok) throw new Error('Failed to load drafts');
            
            const data = await response.json();
            const drafts = data.drafts || [];
            
            if (drafts.length === 0) {
                container.innerHTML = '<p style="font-size: 12px; opacity: 0.7;">No drafts yet.</p>';
                return;
            }
            
            container.innerHTML = drafts.map(d => `
                <div style="padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 12px;">
                    <div style="display: flex; justify-content: space-between;">
                        <span><strong>${new Date(d.createdAt).toLocaleString()}</strong></span>
                        <span>${d.wasApplied ? '✅ Applied' : '📝 Draft'}</span>
                    </div>
                    <div style="opacity: 0.8; margin-top: 4px;">
                        ${d.parameters?.tonePreset || 'default'} • ${d.contextSnapshot?.scenariosCount || 0} scenarios
                    </div>
                    <button onclick="window.scriptBuilder?.loadDraft('${d.id}')" 
                            style="margin-top: 6px; padding: 4px 8px; background: rgba(255,255,255,0.2); 
                                   border: none; border-radius: 4px; color: white; font-size: 11px; cursor: pointer;">
                        Load This Draft
                    </button>
                </div>
            `).join('');
            
        } catch (error) {
            container.innerHTML = `<p style="font-size: 12px; color: #fca5a5;">Error: ${error.message}</p>`;
        }
    }
    
    /**
     * Load a specific draft
     */
    async loadDraft(draftId) {
        try {
            const response = await fetch(`/api/admin/frontline-script/draft/${draftId}`, {
                headers: this.getAuthHeaders()
            });
            
            if (!response.ok) throw new Error('Failed to load draft');
            
            const data = await response.json();
            if (data.draft?.scriptText) {
                this.applyGeneratedScript(data.draft.scriptText);
                this.showNotification('✅ Draft loaded!', 'success');
            }
            
        } catch (error) {
            this.showNotification(`❌ ${error.message}`, 'error');
        }
    }
    
    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Use existing notification system if available
        if (window.CheatSheetManager?.prototype?.showNotification) {
            // Try to use CheatSheetManager's notification
        }
        
        // Fallback: simple toast
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; 
            padding: 12px 20px; border-radius: 8px; 
            background: ${type === 'error' ? '#dc2626' : type === 'success' ? '#10b981' : '#3b82f6'};
            color: white; font-size: 14px; font-weight: 500;
            z-index: 10000; animation: slideIn 0.3s ease;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.remove(), 4000);
    }
}

// Export for use
window.FrontlineScriptBuilder = FrontlineScriptBuilder;

