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
        this.aiCoreFillerFilterManager = null;
        this.aiCoreTemplatesManager = null;
        this.aiCoreLiveScenariosManager = null;
        this.aiCoreKnowledgebaseManager = null;
        this.analyticsManager = null;
        this.aiPerformanceDashboard = null;
        
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
                case 'aicore-filler-filter':
                    await this.loadAiCoreFillerFilter();
                    break;
                case 'aicore-templates':
                    await this.loadAiCoreTemplates();
                    break;
                case 'aicore-live-scenarios':
                    await this.loadAiCoreLiveScenarios();
                    break;
                case 'aicore-knowledgebase':
                    await this.loadAiCoreKnowledgebase();
                    break;
                case 'analytics':
                    await this.loadAnalytics();
                    break;
                case 'ai-performance':
                    await this.loadAIPerformance();
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
            // Expose globally for onclick handlers
            window.variablesManager = this.variablesManager;
        }
        
        await this.variablesManager.load();
    }
    
    /**
     * Load AiCore Filler Filter sub-tab
     */
    async loadAiCoreFillerFilter() {
        console.log('🔇 [AI AGENT SETTINGS] Loading AiCore Filler Filter...');
        
        if (!this.aiCoreFillerFilterManager) {
            this.aiCoreFillerFilterManager = new AiCoreFillerFilterManager(this.companyId);
            // Expose globally for onclick handlers
            window.aiCoreFillerFilterManager = this.aiCoreFillerFilterManager;
        }
        
        await this.aiCoreFillerFilterManager.load();
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
            // Expose globally for onclick handlers
            window.aiCoreTemplatesManager = this.aiCoreTemplatesManager;
        }
        
        try {
            const subTab = document.getElementById('ai-settings-aicore-templates-content');
            const rootContainer = document.querySelector('.ai-settings-container');
            console.log('🧩 [LAYOUT CHECK] before-load', {
                root: rootContainer ? getComputedStyle(rootContainer).maxWidth : 'n/a',
                subTab: subTab ? getComputedStyle(subTab).maxWidth : 'n/a'
            });
        } catch {}

        await this.aiCoreTemplatesManager.load();

        try {
            const subTab = document.getElementById('ai-settings-aicore-templates-content');
            const rootContainer = document.querySelector('.ai-settings-container');
            console.log('🧩 [LAYOUT CHECK] after-load', {
                root: rootContainer ? getComputedStyle(rootContainer).maxWidth : 'n/a',
                subTab: subTab ? getComputedStyle(subTab).maxWidth : 'n/a'
            });
        } catch {}
    }
    
    /**
     * Load AiCore Live Scenarios sub-tab (NEW)
     */
    async loadAiCoreLiveScenarios() {
        console.log('🎭 [AI AGENT SETTINGS] Loading AiCore Live Scenarios...');
        
        if (!this.aiCoreLiveScenariosManager) {
            this.aiCoreLiveScenariosManager = new AiCoreLiveScenariosManager(this);
            window.aiCoreLiveScenariosManager = this.aiCoreLiveScenariosManager;
        }
        
        await this.aiCoreLiveScenariosManager.load();
    }
    
    /**
     * Load AiCore Knowledgebase sub-tab (NEW)
     */
    async loadAiCoreKnowledgebase() {
        console.log('🧠 [AI AGENT SETTINGS] Loading AiCore Knowledgebase...');
        
        if (!this.aiCoreKnowledgebaseManager) {
            this.aiCoreKnowledgebaseManager = new AiCoreKnowledgebaseManager(this);
            window.aiCoreKnowledgebaseManager = this.aiCoreKnowledgebaseManager;
        }
        
        await this.aiCoreKnowledgebaseManager.load();
    }
    
    /**
     * Load Analytics sub-tab
     */
    async loadAnalytics() {
        console.log('📊 [AI AGENT SETTINGS] Loading analytics...');
        
        if (!this.analyticsManager) {
            this.analyticsManager = new AnalyticsManager(this.companyId);
            // Expose globally for onclick handlers
            window.analyticsManager = this.analyticsManager;
        }
        
        await this.analyticsManager.load();
    }
    
    /**
     * Load AI Performance Dashboard
     */
    async loadAIPerformance() {
        console.log('🚀 [AI AGENT SETTINGS] Loading AI Performance Dashboard...');
        
        if (!this.aiPerformanceDashboard) {
            this.aiPerformanceDashboard = new AIPerformanceDashboard(this.companyId);
            // Expose globally for onclick handlers
            window.aiPerformanceDashboard = this.aiPerformanceDashboard;
        }
        
        await this.aiPerformanceDashboard.load();
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
            
            // Determine state class
            banner.className = 'ai-settings-mission-control';
            let stateClass = 'warning';
            let progressColor = '#f59e0b';
            
            if (readiness.components?.readiness?.isLive) {
                stateClass = 'live';
                progressColor = '#06b6d4';
            } else if (readiness.canGoLive) {
                stateClass = 'ready';
                progressColor = '#10b981';
            } else if (readiness.score < 30) {
                stateClass = 'error';
                progressColor = '#ef4444';
            }
            
            banner.classList.add(stateClass);
            
            // Update circular progress ring
            const progressRing = document.getElementById('progress-ring-circle');
            const progressText = document.getElementById('progress-ring-text');
            
            if (progressRing && progressText) {
                const circumference = 2 * Math.PI * 54; // 339.292
                const offset = circumference - (readiness.score / 100) * circumference;
                progressRing.style.strokeDashoffset = offset;
                progressRing.style.stroke = progressColor;
                progressText.textContent = `${readiness.score}%`;
            }
            
            // Update status text
            const textEl = banner.querySelector('.ai-settings-status-text');
            const subtitle = banner.querySelector('.mission-subtitle');
            
            if (textEl && subtitle) {
                if (readiness.components?.readiness?.isLive) {
                    textEl.textContent = 'System Live & Operational';
                    subtitle.textContent = 'Your AI Agent is actively handling customer calls';
                } else if (readiness.canGoLive) {
                    textEl.textContent = 'Ready for Launch';
                    subtitle.textContent = 'All systems configured and ready to go live';
                } else {
                    const blockerCount = readiness.blockers?.length || 0;
                    textEl.textContent = 'Configuration In Progress';
                    subtitle.textContent = `${blockerCount} issue${blockerCount !== 1 ? 's' : ''} require${blockerCount === 1 ? 's' : ''} attention before going live`;
                }
            }
            
            // Update component stats
            const stats = readiness.components || {};
            document.getElementById('stat-templates').textContent = stats.templates?.configured ? '✓' : '✗';
            document.getElementById('stat-variables').textContent = stats.variables?.configured ? '✓' : '✗';
            document.getElementById('stat-twilio').textContent = stats.twilio?.configured ? '✓' : '✗';
            document.getElementById('stat-voice').textContent = stats.voice?.configured ? '✓' : '✗';
            
            // Update Go Live button
            const goLiveBtn = document.getElementById('ai-settings-go-live-btn');
            const goLiveHint = document.getElementById('go-live-hint');
            
            if (goLiveBtn) {
                const btnIcon = goLiveBtn.querySelector('.btn-icon');
                const btnText = goLiveBtn.querySelector('.btn-text');
                
                if (readiness.components?.readiness?.isLive) {
                    btnIcon.textContent = '🟢';
                    btnText.textContent = 'System Live';
                    goLiveBtn.disabled = true;
                    if (goLiveHint) goLiveHint.textContent = 'AI Agent is operational';
                } else if (readiness.canGoLive) {
                    btnIcon.textContent = '🚀';
                    btnText.textContent = 'Go Live Now';
                    goLiveBtn.disabled = false;
                    if (goLiveHint) goLiveHint.textContent = 'Click to activate AI Agent';
                } else {
                    btnIcon.textContent = '🔒';
                    btnText.textContent = 'Cannot Go Live';
                    goLiveBtn.disabled = true;
                    if (goLiveHint) goLiveHint.textContent = 'Fix issues below to enable';
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
     * Render blockers list (NEW DESIGN)
     */
    renderBlockers(blockers, container) {
        if (!container) return;
        
        if (blockers.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        
        // Map blocker codes to icons and priorities
        const blockerMeta = {
            'NO_TEMPLATE': { icon: '📋', priority: 'critical', category: 'Templates', impact: 30 },
            'MISSING_VARIABLES': { icon: '🔧', priority: 'critical', category: 'Configuration', impact: 25 },
            'NO_TWILIO': { icon: '📞', priority: 'critical', category: 'Telephony', impact: 30 },
            'NO_VOICE': { icon: '🎙️', priority: 'warning', category: 'Voice', impact: 15 },
            'DEFAULT': { icon: '⚠️', priority: 'warning', category: 'Configuration', impact: 10 }
        };
        
        container.innerHTML = `
            <div class="action-center-header">
                <h4>🚨 Action Required (${blockers.length})</h4>
                <p>Resolve these issues to enable your AI Agent for production</p>
            </div>
            <div class="action-center-list">
                ${blockers.map(blocker => {
                    const meta = blockerMeta[blocker.code] || blockerMeta['DEFAULT'];
                    return `
                        <div class="action-card">
                            <div class="action-icon ${meta.priority}">
                                ${meta.icon}
                            </div>
                            <div class="action-content">
                                <div class="action-header">
                                    <span class="action-priority ${meta.priority}">
                                        ${meta.priority === 'critical' ? '🔴 CRITICAL' : '🟡 WARNING'}
                                    </span>
                                    <span class="action-code">${blocker.code}</span>
                                </div>
                                <div class="action-message">${blocker.message}</div>
                                <div class="action-impact">
                                    <span>💡 Impact:</span>
                                    <span class="action-impact-points">+${meta.impact} points</span>
                                    <span>when resolved</span>
                                </div>
                            </div>
                            ${blocker.target ? `
                                <button class="action-fix-btn" onclick="aiAgentSettings.navigateToFix('${blocker.target}')">
                                    <span>Fix Now</span>
                                    <i class="fas fa-arrow-right"></i>
                                </button>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
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

