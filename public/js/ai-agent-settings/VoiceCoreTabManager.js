/**
 * ============================================================================
 * VOICECORE TAB MANAGER
 * ============================================================================
 * 
 * Manages tab switching for the VoiceCore Panel (AI Voice & Greetings)
 * Tabs: Dashboard | Messages & Greetings | Call Logs | LLM-0 Controls
 * 
 * ============================================================================
 */

class VoiceCoreTabManager {
    constructor() {
        this.activeTab = 'dashboard';
        this.initialized = false;
    }

    /**
     * Initialize tab switching
     */
    initialize() {
        console.log('🎤 [VOICECORE TABS] Initializing...');

        this.attachEventListeners();
        this.initialized = true;

        console.log('✅ [VOICECORE TABS] Initialized');
    }

    /**
     * Attach event listeners to tab buttons
     */
    attachEventListeners() {
        const tabButtons = document.querySelectorAll('.voicecore-tab');

        tabButtons.forEach(button => {
            // Skip disabled tabs
            if (button.disabled) return;

            button.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent event bubbling to main tab system
                const tabName = button.dataset.voicecoreTab;
                this.switchTab(tabName);
            });
        });

        console.log(`🎤 [VOICECORE TABS] Event listeners attached to ${tabButtons.length} tabs`);
    }

    /**
     * Switch to a specific tab
     */
    switchTab(tabName) {
        console.log(`🎤 [VOICECORE TABS] Switching to tab: ${tabName}`);

        // Update active tab
        this.activeTab = tabName;

        // Update tab button states
        document.querySelectorAll('.voicecore-tab').forEach(button => {
            if (button.dataset.voicecoreTab === tabName) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });

        // Update tab content visibility
        document.querySelectorAll('.voicecore-tab-content').forEach(content => {
            const contentTabName = content.id.replace('tab-', '');
            if (contentTabName === tabName) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        // Initialize tab content if needed
        this.initializeTabContent(tabName);

        console.log(`✅ [VOICECORE TABS] Switched to: ${tabName}`);
    }

    /**
     * Initialize tab content when first viewed
     */
    initializeTabContent(tabName) {
        if (tabName === 'messages') {
            // Initialize Connection Messages Manager if not already initialized
            if (window.connectionMessagesManager && !window.connectionMessagesManager.initialized) {
                window.connectionMessagesManager.initialize();
            }
        }
        
        if (tabName === 'llm0-controls') {
            // Initialize LLM-0 Controls Manager
            const companyId = window.currentCompanyId || document.querySelector('[data-company-id]')?.dataset?.companyId;
            if (companyId && window.initLLM0Controls) {
                console.log('🧠 [VOICECORE TABS] Initializing LLM-0 Controls for company:', companyId);
                window.initLLM0Controls(companyId, 'llm0-controls-container');
            } else if (!companyId) {
                console.warn('🧠 [VOICECORE TABS] No company ID found for LLM-0 Controls');
                document.getElementById('llm0-controls-container').innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #ef4444;">
                        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                        <h3>Company ID Required</h3>
                        <p>Please select a company first.</p>
                    </div>
                `;
            } else if (!window.initLLM0Controls) {
                console.warn('🧠 [VOICECORE TABS] LLM0ControlsManager script not loaded');
            }
        }
    }

    /**
     * Get current active tab
     */
    getActiveTab() {
        return this.activeTab;
    }
}

// Note: Global instance is declared in company-profile.html initialization script

