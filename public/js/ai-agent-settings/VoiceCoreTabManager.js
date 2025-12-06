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
        
        // NOTE: LLM-0 Controls moved to Control Plane → Live Agent Status
    }

    /**
     * Get current active tab
     */
    getActiveTab() {
        return this.activeTab;
    }
}

// Note: Global instance is declared in company-profile.html initialization script

