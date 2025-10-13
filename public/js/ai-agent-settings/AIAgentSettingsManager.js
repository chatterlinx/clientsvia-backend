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
        this.scenariosManager = null;
        this.templateInfoManager = null;
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
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
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
                case 'scenarios':
                    await this.loadScenarios();
                    break;
                case 'template-info':
                    await this.loadTemplateInfo();
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
        // Will be implemented by FillerWordsManager
    }
    
    /**
     * Load Scenarios sub-tab
     */
    async loadScenarios() {
        console.log('💬 [AI AGENT SETTINGS] Loading scenarios...');
        // Will be implemented by ScenariosManager
    }
    
    /**
     * Load Template Info sub-tab
     */
    async loadTemplateInfo() {
        console.log('📦 [AI AGENT SETTINGS] Loading template info...');
        // Will be implemented by TemplateInfoManager
    }
    
    /**
     * Load Analytics sub-tab
     */
    async loadAnalytics() {
        console.log('📊 [AI AGENT SETTINGS] Loading analytics...');
        // Will be implemented by AnalyticsManager
    }
    
    /**
     * Update status banner
     */
    updateStatusBanner() {
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

