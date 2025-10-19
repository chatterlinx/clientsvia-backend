/**
 * ============================================================================
 * AI AGENT SETTINGS MANAGER - MAIN ORCHESTRATOR
 * ============================================================================
 * 
 * PURPOSE: Coordinates all AI Agent Settings sub-tabs
 * ISOLATION: 100% self-contained, zero dependencies on legacy code
 * ARCHITECTURE: Clean module pattern, easy to delete/replace
 * 
 * MANAGES:
 * - Variables (company-specific data)
 * - Filler Words (inherited + custom)
 * - Scenarios (500+ conversation flows)
 * - Template Info (version, sync status)
 * - Analytics (performance metrics)
 * 
 * ============================================================================
 */

class AIAgentSettingsManager {
    constructor(companyId) {
        this.companyId = companyId;
        this.currentSubTab = 'variables'; // Default
        this.configuration = null;
        this.isLoading = false;
        
        // Sub-managers (loaded lazily)
        this.variablesManager = null;
        this.fillerWordsManager = null;
        this.aiCoreTemplatesManager = null;
        this.scenariosManager = null;
        this.templateHubManager = null;
        this.analyticsManager = null;
        
        console.log(`🤖 [AI AGENT SETTINGS] Initialized for company: ${companyId}`);
    }
    
    /**
     * Initialize the AI Agent Settings tab
     */
    async initialize() {
        console.log('🤖 [AI AGENT SETTINGS] Initializing...');
        
        try {
            // Load configuration
            await this.loadConfiguration();
            
            // Initialize UI
            this.initializeSubTabs();
            
            // Load default sub-tab
            await this.switchSubTab('variables');
            
            console.log('✅ [AI AGENT SETTINGS] Initialized successfully');
        } catch (error) {
            console.error('❌ [AI AGENT SETTINGS] Initialization failed:', error);
            this.showError('Failed to initialize AI Agent Settings');
        }
    }
    
    /**
     * Load company configuration from API
     */
    async loadConfiguration() {
        console.log('📥 [AI AGENT SETTINGS] Loading configuration...');
        
        this.isLoading = true;
        this.showLoadingState();
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/configuration`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.configuration = await response.json();
            
            console.log('✅ [AI AGENT SETTINGS] Configuration loaded:', this.configuration);
            
            // Update status banner
            this.updateStatusBanner();
            
            return this.configuration;
            
        } catch (error) {
            console.error('❌ [AI AGENT SETTINGS] Failed to load configuration:', error);
            
            // Show friendly error
            this.showError('No template cloned yet. Clone a Global AI Brain template to start configuring.');
            
            // Set empty configuration
            this.configuration = {
                variables: {},
                variablesStatus: { required: 0, configured: 0, missing: [], isValid: false },
                fillerWords: { inherited: [], custom: [], active: [] },
                clonedFrom: null
            };
            
        } finally {
            this.isLoading = false;
            this.hideLoadingState();
        }
    }
    
    /**
     * Initialize sub-tab navigation
     */
    initializeSubTabs() {
        console.log('🎨 [AI AGENT SETTINGS] Initializing sub-tabs...');
        
        const subTabButtons = document.querySelectorAll('.ai-settings-subtab-btn');
        
        subTabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const subTab = btn.dataset.subtab;
                this.switchSubTab(subTab);
            });
        });
    }
    
    /**
     * Switch to a different sub-tab
     */
    async switchSubTab(subTabName) {
        console.log(`🔄 [AI AGENT SETTINGS] Switching to sub-tab: ${subTabName}`);
        
        this.currentSubTab = subTabName;
        
        // Update UI
        this.updateSubTabUI(subTabName);
        
        // Load sub-tab content
        await this.loadSubTab(subTabName);
    }
    
    /**
     * Update sub-tab UI (buttons and content visibility)
     */
    updateSubTabUI(subTabName) {
        // Update buttons
        document.querySelectorAll('.ai-settings-subtab-btn').forEach(btn => {
            if (btn.dataset.subtab === subTabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // Update content
        document.querySelectorAll('.ai-settings-subtab-content').forEach(content => {
            if (content.id === `ai-settings-${subTabName}-content`) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });
    }
    
    /**
     * Load specific sub-tab content
     */
    async loadSubTab(subTabName) {
        console.log(`📥 [AI AGENT SETTINGS] Loading sub-tab: ${subTabName}`);
        
        try {
            switch (subTabName) {
                case 'variables':
                    await this.loadVariables();
                    break;
                case 'filler-words':
                    await this.loadFillerWords();
                    break;
                case 'aicore-templates':
                    await this.loadAiCoreTemplates();
                    break;
                case 'scenarios':
                    await this.loadScenarios();
                    break;
                case 'template-hub':
                    await this.loadTemplateHub();
                    break;
                case 'analytics':
                    await this.loadAnalytics();
                    break;
                default:
                    console.warn(`Unknown sub-tab: ${subTabName}`);
            }
        } catch (error) {
            console.error(`❌ [AI AGENT SETTINGS] Failed to load sub-tab ${subTabName}:`, error);
            this.showError(`Failed to load ${subTabName}`);
        }
    }
    
    /**
     * Load Variables sub-tab
     */
    async loadVariables() {
        console.log('📝 [AI AGENT SETTINGS] Loading variables...');
        
        if (!this.variablesManager) {
            this.variablesManager = new VariablesManager(this);
        }
        
        await this.variablesManager.load();
    }
    
    /**
     * Save variables (called from UI)
     */
    async saveVariables() {
        if (this.variablesManager) {
            await this.variablesManager.save();
        }
    }
    
    /**
     * Preview variables (called from UI)
     */
    async previewVariables() {
        alert('Preview feature coming soon!');
    }
    
    /**
     * Load Filler Words sub-tab
     */
    async loadFillerWords() {
        console.log('🔇 [AI AGENT SETTINGS] Loading filler words...');
        
        if (!this.fillerWordsManager) {
            this.fillerWordsManager = new FillerWordsManager(this);
        }
        
        await this.fillerWordsManager.load();
    }
    
    /**
     * Show add filler word modal (called from UI)
     */
    showAddFillerWordModal() {
        if (this.fillerWordsManager) {
            this.fillerWordsManager.showAddModal();
        }
    }
    
    /**
     * Export filler words (called from UI)
     */
    exportFillerWords() {
        if (this.fillerWordsManager) {
            this.fillerWordsManager.exportToJSON();
        }
    }
    
    /**
     * Reset filler words (called from UI)
     */
    resetFillerWords() {
        if (this.fillerWordsManager) {
            this.fillerWordsManager.reset();
        }
    }
    
    /**
     * Load AiCore Templates sub-tab (NEW)
     */
    async loadAiCoreTemplates() {
        console.log('🧠 [AI AGENT SETTINGS] Loading AiCore Templates...');
        
        if (!this.aiCoreTemplatesManager) {
            this.aiCoreTemplatesManager = new AiCoreTemplatesManager(this);
        }
        
        await this.aiCoreTemplatesManager.load();
    }
    
    /**
     * Load Scenarios sub-tab
     */
    async loadScenarios() {
        console.log('💬 [AI AGENT SETTINGS] Loading scenarios...');
        
        if (!this.scenariosManager) {
            this.scenariosManager = new ScenariosManager(this);
        }
        
        await this.scenariosManager.load();
    }
    
    /**
     * Load Template Hub sub-tab
     */
    async loadTemplateHub() {
        console.log('🏢 [AI AGENT SETTINGS] Loading template hub...');
        
        if (!this.templateHubManager) {
            this.templateHubManager = new TemplateHubManager(this);
        }
        
        await this.templateHubManager.load();
    }
    
    /**
     * Load Analytics sub-tab
     */
    async loadAnalytics() {
        console.log('📊 [AI AGENT SETTINGS] Loading analytics...');
        
        if (!this.analyticsManager) {
            this.analyticsManager = new AnalyticsManager(this);
        }
        
        await this.analyticsManager.load();
    }
    
    /**
     * Update status banner with readiness score
     * CRITICAL: Fetches real-time readiness score from backend
     */
    async updateStatusBanner() {
        const banner = document.getElementById('ai-settings-status-banner');
        const progressBar = document.getElementById('ai-settings-progress-bar');
        const blockersContainer = document.getElementById('ai-settings-blockers');
        
        if (!banner) return;
        
        try {
            // Fetch readiness score from API
            const response = await fetch(`/api/company/${this.companyId}/configuration/readiness`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                console.warn('Failed to fetch readiness score, using fallback');
                this.updateStatusBannerFallback();
                return;
            }
            
            const readiness = await response.json();
            console.log('📊 [AI AGENT SETTINGS] Readiness score:', readiness);
            
            // Update banner class based on score
            banner.className = 'ai-settings-status-banner';
            if (readiness.canGoLive) {
                banner.classList.add('success');
            } else if (readiness.score < 30) {
                banner.classList.add('error');
            } else {
                banner.classList.add('warning');
            }
            
            // Update text and Go Live button
            const textEl = banner.querySelector('.ai-settings-status-text');
            const goLiveBtn = document.getElementById('ai-settings-go-live-btn');
            
            if (textEl) {
                if (readiness.canGoLive) {
                    if (readiness.components?.readiness?.isLive) {
                        textEl.innerHTML = `🟢 <strong>Live!</strong> Your AI Agent is active and handling calls (Score: ${readiness.score}/100)`;
                    } else {
                        textEl.innerHTML = `✅ <strong>Ready to Go Live!</strong> Configuration score: ${readiness.score}/100 - All checks passed`;
                    }
                } else {
                    const blockerCount = readiness.blockers?.length || 0;
                    textEl.innerHTML = `⚠️ <strong>Not Ready</strong> - Score: ${readiness.score}/100 (${blockerCount} blocker${blockerCount !== 1 ? 's' : ''})`;
                }
            }
            
            // Update Go Live button state
            if (goLiveBtn) {
                if (readiness.components?.readiness?.isLive) {
                    // Already live - show status
                    goLiveBtn.textContent = '🟢 Live';
                    goLiveBtn.disabled = true;
                    goLiveBtn.classList.add('is-live');
                    goLiveBtn.classList.remove('ai-settings-btn-success');
                    goLiveBtn.classList.add('ai-settings-btn-secondary');
                } else if (readiness.canGoLive) {
                    // Ready to go live - enable button
                    goLiveBtn.textContent = '🚀 Go Live Now';
                    goLiveBtn.disabled = false;
                    goLiveBtn.classList.remove('is-live', 'ai-settings-btn-secondary');
                    goLiveBtn.classList.add('ai-settings-btn-success');
                } else {
                    // Not ready - disable button
                    goLiveBtn.textContent = '🔒 Cannot Go Live';
                    goLiveBtn.disabled = true;
                    goLiveBtn.classList.remove('is-live', 'ai-settings-btn-success');
                    goLiveBtn.classList.add('ai-settings-btn-secondary');
                }
            }
            
            // Update progress bar
            if (progressBar) {
                const fill = progressBar.querySelector('.ai-settings-progress-fill');
                if (fill) {
                    fill.style.width = `${readiness.score}%`;
                    
                    // Color based on score
                    if (readiness.score >= 80) {
                        fill.style.background = '#10b981'; // Green
                    } else if (readiness.score >= 50) {
                        fill.style.background = '#f59e0b'; // Orange
                    } else {
                        fill.style.background = '#ef4444'; // Red
                    }
                }
            }
            
            // Update blockers list
            if (blockersContainer) {
                this.renderBlockers(readiness.blockers || [], blockersContainer);
            }
            
            // Store readiness for other components
            this.readiness = readiness;
            
        } catch (error) {
            console.error('❌ [AI AGENT SETTINGS] Failed to fetch readiness:', error);
            this.updateStatusBannerFallback();
        }
    }
    
    /**
     * Fallback status banner (when readiness API fails)
     */
    updateStatusBannerFallback() {
        const banner = document.getElementById('ai-settings-status-banner');
        const progressBar = document.getElementById('ai-settings-progress-bar');
        
        if (!banner || !this.configuration) return;
        
        const status = this.configuration.variablesStatus || { required: 0, configured: 0, isValid: false };
        const percentage = status.required > 0 ? Math.round((status.configured / status.required) * 100) : 100;
        
        // Update banner class
        banner.className = 'ai-settings-status-banner';
        if (status.isValid) {
            banner.classList.add('success');
        } else if (status.configured === 0) {
            banner.classList.add('error');
        } else {
            banner.classList.add('warning');
        }
        
        // Update text
        const textEl = banner.querySelector('.ai-settings-status-text');
        if (textEl) {
            if (status.isValid) {
                textEl.innerHTML = `✅ Configuration complete! Your AI is ready to go live.`;
            } else {
                const missing = status.required - status.configured;
                textEl.innerHTML = `⚠️ ${missing} required variable${missing > 1 ? 's' : ''} missing. Complete configuration to go live.`;
            }
        }
        
        // Update progress bar
        if (progressBar) {
            const fill = progressBar.querySelector('.ai-settings-progress-fill');
            if (fill) {
                fill.style.width = `${percentage}%`;
            }
        }
    }
    
    /**
     * Render blockers list
     */
    renderBlockers(blockers, container) {
        if (!container) return;
        
        if (blockers.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        container.innerHTML = `
            <div class="ai-settings-blockers-header">
                <h4>⚠️ Issues to Fix (${blockers.length})</h4>
                <p>Resolve these blockers to go live:</p>
            </div>
            <div class="ai-settings-blockers-list">
                ${blockers.map(blocker => `
                    <div class="ai-settings-blocker-item">
                        <div class="blocker-icon">🚫</div>
                        <div class="blocker-content">
                            <div class="blocker-code">${blocker.code}</div>
                            <div class="blocker-message">${blocker.message}</div>
                        </div>
                        ${blocker.target ? `
                            <button class="blocker-fix-btn" onclick="aiAgentSettings.navigateToFix('${blocker.target}')">
                                Fix Now →
                            </button>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    /**
     * Navigate to fix location (called from blocker "Fix Now" button)
     */
    navigateToFix(target) {
        console.log(`🎯 [AI AGENT SETTINGS] Navigating to fix: ${target}`);
        
        // Parse target like "/company/:companyId/ai-agent-settings/variables#phone"
        const parts = target.split('/');
        const lastPart = parts[parts.length - 1];
        
        if (lastPart.includes('#')) {
            const [subTab, fieldId] = lastPart.split('#');
            this.switchSubTab(subTab);
            
            // Scroll to field after a short delay
            setTimeout(() => {
                const field = document.getElementById(fieldId) || 
                             document.querySelector(`[data-field="${fieldId}"]`);
                if (field) {
                    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    field.focus();
                    
                    // Highlight field
                    field.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.5)';
                    setTimeout(() => {
                        field.style.boxShadow = '';
                    }, 2000);
                }
            }, 300);
        } else {
            // Just switch to sub-tab
            this.switchSubTab(lastPart);
        }
    }
    
    /**
     * Show loading state
     */
    showLoadingState() {
        const container = document.getElementById('ai-agent-settings-container');
        if (container) {
            container.style.opacity = '0.6';
            container.style.pointerEvents = 'none';
        }
    }
    
    /**
     * Hide loading state
     */
    hideLoadingState() {
        const container = document.getElementById('ai-agent-settings-container');
        if (container) {
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }
    }
    
    /**
     * Show error message
     */
    showError(message) {
        console.error('❌ [AI AGENT SETTINGS]', message);
        
        // Create notification (you can use your existing notification system)
        const notification = document.createElement('div');
        notification.className = 'notification error';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fee2e2;
            border: 2px solid #ef4444;
            color: #991b1b;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }
    
    /**
     * Show success message
     */
    showSuccess(message) {
        console.log('✅ [AI AGENT SETTINGS]', message);
        
        const notification = document.createElement('div');
        notification.className = 'notification success';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #d1fae5;
            border: 2px solid #10b981;
            color: #065f46;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    /**
     * Go Live - Activate the AI Agent for production use
     * CRITICAL: Only callable when readiness.canGoLive === true
     */
    async goLive() {
        console.log('🚀 [AI AGENT SETTINGS] Initiating Go Live...');
        
        // Double-check readiness
        if (!this.readiness || !this.readiness.canGoLive) {
            this.showError('Cannot go live: Configuration is not ready. Please resolve all blockers first.');
            return;
        }
        
        // Show confirmation dialog
        const confirmed = confirm(
            `🚀 GO LIVE CONFIRMATION\n\n` +
            `You are about to activate your AI Agent for production use.\n\n` +
            `Current Status:\n` +
            `✅ Configuration Score: ${this.readiness.score}/100\n` +
            `✅ All blockers resolved\n` +
            `✅ Ready to handle live calls\n\n` +
            `Once activated, your AI Agent will:\n` +
            `• Answer incoming calls automatically\n` +
            `• Handle customer inquiries 24/7\n` +
            `• Use the configured scenarios and variables\n\n` +
            `Proceed with Go Live?`
        );
        
        if (!confirmed) {
            console.log('🚫 [AI AGENT SETTINGS] Go Live cancelled by user');
            return;
        }
        
        try {
            this.showLoadingState();
            
            // Call Go Live API
            const response = await fetch(`/api/company/${this.companyId}/configuration/go-live`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to go live');
            }
            
            const result = await response.json();
            
            console.log('✅ [AI AGENT SETTINGS] Go Live successful!', result);
            
            // Show success message
            this.showSuccess('🎉 Your AI Agent is now LIVE and handling calls!');
            
            // Refresh configuration to update UI
            await this.refresh();
            
        } catch (error) {
            console.error('❌ [AI AGENT SETTINGS] Go Live failed:', error);
            this.showError(`Failed to go live: ${error.message}`);
        } finally {
            this.hideLoadingState();
        }
    }
    
    /**
     * Refresh configuration (called after updates)
     */
    async refresh() {
        console.log('🔄 [AI AGENT SETTINGS] Refreshing configuration...');
        await this.loadConfiguration();
        await this.loadSubTab(this.currentSubTab);
    }
}

// Export for use in company-profile.html
if (typeof window !== 'undefined') {
    window.AIAgentSettingsManager = AIAgentSettingsManager;
}

