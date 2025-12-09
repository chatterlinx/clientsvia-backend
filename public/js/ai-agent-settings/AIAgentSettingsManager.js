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
            
            // NOTE: Sub-tabs removed - all AiCore functionality moved to Control Plane V2
            // The AI Agent Settings tab now only handles:
            // 1. Status banner and readiness score
            // 2. Diagnostic modals
            // 3. Pre-activation message
            // 4. Go Live functionality
            
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
            
            // Load company data (includes preActivationMessage)
            if (this.parent && this.parent.companyData) {
                this.company = this.parent.companyData;
            }
            
            // Update status banner
            this.updateStatusBanner();
            
            // Load pre-activation message into UI (with small delay to ensure DOM is ready)
            setTimeout(() => {
                this.loadPreActivationMessage();
            }, 500);
            
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
                case 'aicore-cheat-sheet':
                    await this.loadAiCoreCheatSheet();
                    break;
                // REMOVED Dec 2025: aicore-call-flow (Mission Control), aicore-knowledgebase, analytics
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
     * Load AiCore Cheat Sheet sub-tab
     */
    async loadAiCoreCheatSheet() {
        console.log('🧠 [AI AGENT SETTINGS] Loading AiCore Cheat Sheet...');
        
        // CheatSheetManager is loaded globally from CheatSheetManager.js
        if (typeof cheatSheetManager === 'undefined') {
            console.error('❌ [AI AGENT SETTINGS] CheatSheetManager not found!');
            this.showError('Cheat Sheet manager failed to load');
            return;
        }
        
        // Load cheat sheet data for this company
        await cheatSheetManager.load(this.companyId);
        
        console.log('✅ [AI AGENT SETTINGS] Cheat Sheet loaded successfully');
    }
    
    // REMOVED Dec 2025: loadAiCoreCallFlow (replaced by Mission Control)
    // REMOVED Dec 2025: loadAiCoreKnowledgebase (always showed zeros)
    // REMOVED Dec 2025: loadAnalytics (broken, use Black Box)
    
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
            // Add timestamp to force cache refresh
            const timestamp = Date.now();
            const response = await fetch(`/api/company/${this.companyId}/configuration/readiness?refresh=true&_=${timestamp}`, {
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
            console.log('🚨 [AI AGENT SETTINGS] Blockers count:', readiness.blockers?.length || 0);
            console.log('🚨 [AI AGENT SETTINGS] Blockers:', readiness.blockers);
            
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
            
            // Update component stats with color coding
            const stats = readiness.components || {};
            
            // Templates
            const templatesEl = document.getElementById('stat-templates');
            const templatesConfigured = stats.templates?.configured;
            templatesEl.textContent = templatesConfigured ? '✓' : '✗';
            templatesEl.parentElement.parentElement.className = 'stat-item ' + (templatesConfigured ? 'stat-success' : 'stat-error');
            
            // Variables
            const variablesEl = document.getElementById('stat-variables');
            const variablesConfigured = stats.variables?.configured;
            variablesEl.textContent = variablesConfigured ? '✓' : '✗';
            variablesEl.parentElement.parentElement.className = 'stat-item ' + (variablesConfigured ? 'stat-success' : 'stat-error');
            
            // Twilio
            const twilioEl = document.getElementById('stat-twilio');
            const twilioConfigured = stats.twilio?.configured;
            twilioEl.textContent = twilioConfigured ? '✓' : '✗';
            twilioEl.parentElement.parentElement.className = 'stat-item ' + (twilioConfigured ? 'stat-success' : 'stat-error');
            
            // Voice
            const voiceEl = document.getElementById('stat-voice');
            const voiceConfigured = stats.voice?.configured;
            voiceEl.textContent = voiceConfigured ? '✓' : '✗';
            voiceEl.parentElement.parentElement.className = 'stat-item ' + (voiceConfigured ? 'stat-success' : 'stat-error');
            
            // Scenarios
            const scenariosEl = document.getElementById('stat-scenarios');
            const scenariosConfigured = (stats.scenarios?.active > 0);
            scenariosEl.textContent = scenariosConfigured ? '✓' : '✗';
            scenariosEl.parentElement.parentElement.className = 'stat-item ' + (scenariosConfigured ? 'stat-success' : 'stat-error');
            
            // CheatSheet
            const cheatsheetEl = document.getElementById('stat-cheatsheet');
            if (cheatsheetEl) {
                const cheatsheetConfigured = stats.cheatsheet?.configured || false;
                cheatsheetEl.textContent = cheatsheetConfigured ? '✓' : '✗';
                cheatsheetEl.parentElement.parentElement.className = 'stat-item ' + (cheatsheetConfigured ? 'stat-success' : 'stat-error');
            }
            
            // Frontline-Intel (separate icon from CheatSheet)
            const frontlineIntelEl = document.getElementById('stat-frontline-intel');
            if (frontlineIntelEl) {
                const frontlineIntelConfigured = stats.cheatsheet?.hasInstructions || false;
                frontlineIntelEl.textContent = frontlineIntelConfigured ? '✓' : '✗';
                frontlineIntelEl.parentElement.parentElement.className = 'stat-item ' + (frontlineIntelConfigured ? 'stat-success' : 'stat-error');
            }
            
            // 3-Tier Settings
            const tierSettingsEl = document.getElementById('stat-tier-settings');
            if (tierSettingsEl) {
                const tierSettingsConfigured = stats.tierSettings?.configured || false;
                tierSettingsEl.textContent = tierSettingsConfigured ? '✓' : '✗';
                tierSettingsEl.parentElement.parentElement.className = 'stat-item ' + (tierSettingsConfigured ? 'stat-success' : 'stat-error');
            }
            
            // 3-Tier LLM
            const tierLlmEl = document.getElementById('stat-tier-llm');
            if (tierLlmEl) {
                const tierLlmConfigured = stats.tierLlm?.configured || false;
                tierLlmEl.textContent = tierLlmConfigured ? '✓' : '✗';
                tierLlmEl.parentElement.parentElement.className = 'stat-item ' + (tierLlmConfigured ? 'stat-success' : 'stat-error');
            }
            
            // Brain LLM
            const brainLlmEl = document.getElementById('stat-brain-llm');
            if (brainLlmEl) {
                const brainLlmConfigured = stats.brainLlm?.configured || false;
                brainLlmEl.textContent = brainLlmConfigured ? '✓' : '✗';
                brainLlmEl.parentElement.parentElement.className = 'stat-item ' + (brainLlmConfigured ? 'stat-success' : 'stat-error');
            }
            
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
            // Account Status
            'ACCOUNT_SUSPENDED': { icon: '🔒', priority: 'critical', category: 'Account', impact: 0 },
            'ACCOUNT_CALL_FORWARD': { icon: '📞', priority: 'critical', category: 'Account', impact: 0 },
            'ACCOUNT_STATUS_UNKNOWN': { icon: '❓', priority: 'critical', category: 'Account', impact: 0 },
            'ACCOUNT_STATUS_ERROR': { icon: '❌', priority: 'critical', category: 'Account', impact: 0 },
            
            // Templates
            'NO_TEMPLATE': { icon: '📋', priority: 'critical', category: 'Templates', impact: 30 },
            'TEMPLATE_NOT_FOUND': { icon: '🔍', priority: 'major', category: 'Templates', impact: 15 },
            'TEMPLATES_ERROR': { icon: '❌', priority: 'critical', category: 'Templates', impact: 30 },
            
            // Variables
            'MISSING_REQUIRED_VARIABLES': { icon: '🔧', priority: 'critical', category: 'Variables', impact: 30 },
            'VARIABLES_ERROR': { icon: '❌', priority: 'critical', category: 'Variables', impact: 30 },
            
            // Twilio
            'NO_TWILIO': { icon: '📞', priority: 'critical', category: 'Twilio', impact: 20 },
            'NO_TWILIO_CREDENTIALS': { icon: '🔑', priority: 'critical', category: 'Twilio', impact: 10 },
            'NO_TWILIO_PHONE': { icon: '📱', priority: 'critical', category: 'Twilio', impact: 10 },
            'TWILIO_ERROR': { icon: '❌', priority: 'critical', category: 'Twilio', impact: 20 },
            
            // Voice
            'NO_VOICE': { icon: '🎙️', priority: 'critical', category: 'Voice', impact: 10 },
            'VOICE_ERROR': { icon: '❌', priority: 'critical', category: 'Voice', impact: 10 },
            
            // Scenarios
            'NO_SCENARIOS': { icon: '🎭', priority: 'critical', category: 'Scenarios', impact: 10 },
            'FEW_SCENARIOS': { icon: '⚠️', priority: 'major', category: 'Scenarios', impact: 5 },
            'SCENARIOS_ERROR': { icon: '❌', priority: 'critical', category: 'Scenarios', impact: 10 },
            
            // Default fallback
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
                                <button class="action-fix-btn" onclick="window.navigateToV2('${blocker.target}')">
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
     * Load pre-activation message into UI
     */
    async loadPreActivationMessage() {
        const textarea = document.getElementById('pre-activation-message');
        if (!textarea) {
            console.log('📞 [PRE-ACTIVATION] Textarea not found yet, will try again later');
            return;
        }
        
        try {
            // Fetch company data to get the message
            const response = await fetch(`/api/company/${this.companyId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch company data');
            }
            
            const company = await response.json();
            
            // Get message from correct path
            const message = company.configuration?.readiness?.preActivationMessage || 
                          "Thank you for calling {companyName}. Our AI receptionist is currently being configured and will be available shortly. For immediate assistance, please call our main office line. Thank you for your patience.";
            
            textarea.value = message;
            
            console.log('📞 [PRE-ACTIVATION] Loaded message:', message.substring(0, 50) + '...');
            
        } catch (error) {
            console.error('❌ [PRE-ACTIVATION] Failed to load message:', error);
            // Set default message on error
            textarea.value = "Thank you for calling {companyName}. Our AI receptionist is currently being configured and will be available shortly. For immediate assistance, please call our main office line. Thank you for your patience.";
        }
    }
    
    /**
     * Save pre-activation message
     */
    async savePreActivationMessage() {
        const textarea = document.getElementById('pre-activation-message');
        if (!textarea) return;
        
        const message = textarea.value.trim();
        
        if (!message) {
            this.showError('Please enter a pre-activation message');
            return;
        }
        
        try {
            console.log('📞 [PRE-ACTIVATION] Saving message...');
            
            const response = await fetch(`/api/company/${this.companyId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    'configuration.readiness.preActivationMessage': message
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to save message');
            }
            
            console.log('✅ [PRE-ACTIVATION] Message saved successfully');
            this.showSuccess('Pre-activation message saved!');
            
            // Reload company data
            await this.loadConfiguration();
            
        } catch (error) {
            console.error('❌ [PRE-ACTIVATION] Save failed:', error);
            this.showError(`Failed to save message: ${error.message}`);
        }
    }
    
    /**
     * Reset pre-activation message to default
     */
    async resetPreActivationMessage() {
        const defaultMessage = "Thank you for calling {companyName}. Our AI receptionist is currently being configured and will be available shortly. For immediate assistance, please call our main office line. Thank you for your patience.";
        
        const textarea = document.getElementById('pre-activation-message');
        if (!textarea) return;
        
        textarea.value = defaultMessage;
        
        console.log('🔄 [PRE-ACTIVATION] Reset to default message');
        this.showInfo('Message reset to default. Click "Save Message" to apply.');
    }
    
    /**
     * Show detailed diagnostics for a component
     * @param {string} component - Component name (templates|variables|twilio|voice|scenarios)
     */
    showDiagnostics(component) {
        console.log(`[AI AGENT SETTINGS] Opening diagnostics for: ${component}`);
        
        // Open diagnostic modal
        diagnosticModal.show(component, this.companyId);
    }
    
    /**
     * Refresh configuration (called after updates)
     */
    async refresh() {
        console.log('🔄 [AI AGENT SETTINGS] Refreshing configuration...');
        await this.loadConfiguration();
        await this.loadSubTab(this.currentSubTab);
        
        // Reload pre-activation message
        setTimeout(() => {
            this.loadPreActivationMessage();
        }, 300);
    }
}

// Export for use in company-profile.html
if (typeof window !== 'undefined') {
    window.AIAgentSettingsManager = AIAgentSettingsManager;
}

