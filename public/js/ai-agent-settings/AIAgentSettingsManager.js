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
            // 1. Pre-activation message
            // 2. VoiceCore (Twilio, System Diagnostics)
            // 3. AiCore Control Center link
            
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
            
            // Health system removed - legacy code eliminated
            
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
                // ☢️ NUKED Feb 2026: cheatSheet references removed
                case 'aicore-cheat-sheet':
                    console.warn('Cheat Sheet sub-tab NUKED Feb 2026');
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
    
    // ☢️ NUKED Feb 2026: cheatSheet references removed
    // loadAiCoreCheatSheet() - entire function removed
    
    // REMOVED Dec 2025: loadAiCoreCallFlow (replaced by Mission Control)
    // REMOVED Dec 2025: loadAiCoreKnowledgebase (always showed zeros)
    // REMOVED Dec 2025: loadAnalytics (broken, use Black Box)
    
    /**
     * Stub: Health system removed Feb 2026 - VariablesManager may still call this
     */
    async updateStatusBanner() {
        return;
    }
    
    /**
     * Stub: Diagnostics removed Feb 2026 - HTML may still have onclick handlers
     */
    showDiagnostics(component) {
        return;
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
     * Show info message
     * @param {string} message - Message to display
     * @param {number} [duration=4000] - Display duration in ms (VariablesManager passes 8000)
     */
    showInfo(message, duration = 4000) {
        console.log('ℹ️ [AI AGENT SETTINGS]', message);
        
        const notification = document.createElement('div');
        notification.className = 'notification info';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #dbeafe;
            border: 2px solid #3b82f6;
            color: #1e40af;
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
        }, duration);
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

