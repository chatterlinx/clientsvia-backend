/**
 * ============================================================================
 * TELEPHONY TAB MANAGER
 * ============================================================================
 * 
 * Manages tab switching for the Telephony Control Panel
 * Tabs: Dashboard | Messages & Greetings | Call Logs
 * 
 * ============================================================================
 */

class TelephonyTabManager {
    constructor() {
        this.activeTab = 'dashboard';
        this.initialized = false;
    }

    /**
     * Initialize tab switching
     */
    initialize() {
        console.log('📞 [TELEPHONY TABS] Initializing...');

        this.attachEventListeners();
        this.initialized = true;

        console.log('✅ [TELEPHONY TABS] Initialized');
    }

    /**
     * Attach event listeners to tab buttons
     */
    attachEventListeners() {
        const tabButtons = document.querySelectorAll('.telephony-tab');

        tabButtons.forEach(button => {
            // Skip disabled tabs
            if (button.disabled) return;

            button.addEventListener('click', () => {
                const tabName = button.dataset.tab;
                this.switchTab(tabName);
            });
        });

        console.log(`📞 [TELEPHONY TABS] Event listeners attached to ${tabButtons.length} tabs`);
    }

    /**
     * Switch to a specific tab
     */
    switchTab(tabName) {
        console.log(`📞 [TELEPHONY TABS] Switching to tab: ${tabName}`);

        // Update active tab
        this.activeTab = tabName;

        // Update tab button states
        document.querySelectorAll('.telephony-tab').forEach(button => {
            if (button.dataset.tab === tabName) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });

        // Update tab content visibility
        document.querySelectorAll('.telephony-tab-content').forEach(content => {
            const contentTabName = content.id.replace('tab-', '');
            if (contentTabName === tabName) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        // Initialize tab content if needed
        this.initializeTabContent(tabName);

        console.log(`✅ [TELEPHONY TABS] Switched to: ${tabName}`);
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
    }

    /**
     * Get current active tab
     */
    getActiveTab() {
        return this.activeTab;
    }
}

// Note: Global instance is declared in company-profile.html initialization script

