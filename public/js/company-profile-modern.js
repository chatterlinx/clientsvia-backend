/**
 * Modern Company Profile Management System
 * Clean, maintainable, and feature-complete implementation
 * 
 * Architecture:
 * - Class-based modular design
 * - Centralized state management
 * - Robust error handling
 * - Modern ES6+ features
 * - Clean separation of concerns
 */

class CompanyProfileManager {
    constructor() {
        // API Configuration - force localhost during development
        this.apiBaseUrl = window.location.hostname === 'localhost' ? 
            `http://localhost:${window.location.port}` : '';
        
        this.companyId = null;
        this.currentData = null;
        this.hasUnsavedChanges = false;
        this.currentTab = 'overview';
        this.saveButton = null;
        this.initialized = false;

        // Bind methods to preserve context
        this.handleFormChange = this.handleFormChange.bind(this);
        this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
        this.handleTabSwitch = this.handleTabSwitch.bind(this);
        this.saveAllChanges = this.saveAllChanges.bind(this);
    }

    /**
     * Initialize the company profile system
     */
    async init() {
        try {
            console.log('🚀 Initializing Company Profile Manager...');
            
            // Extract company ID from URL
            this.extractCompanyId();
            
            if (!this.companyId) {
                throw new Error('No company ID found in URL');
            }

            // Initialize DOM elements and event listeners
            this.initializeDOM();
            this.setupEventListeners();
            this.createSaveButton();
            
            // Load company data
            await this.loadCompanyData();
            
            // Initialize tabs
            this.initializeTabs();
            
            this.initialized = true;
            console.log('✅ Company Profile Manager initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize Company Profile Manager:', error);
            this.showNotification('Failed to initialize company profile', 'error');
        }
    }

    /**
     * Extract company ID from URL parameters
     */
    extractCompanyId() {
        const urlParams = new URLSearchParams(window.location.search);
        this.companyId = urlParams.get('id');
        
        // For testing - provide default ID if none provided
        if (!this.companyId) {
            this.companyId = 'test123';
            console.warn('⚠️ No company ID found in URL parameters, using test ID:', this.companyId);
        }
        
        // Set global references for legacy compatibility
        window.currentCompanyId = this.companyId;
        window.companyId = this.companyId;
        
        console.log('🔍 Company ID extracted:', this.companyId);
    }

    /**
     * Initialize DOM element references
     */
    initializeDOM() {
        // Overview tab - Edit form container (modern approach)
        this.domElements = {
            // Edit form container (will populate with inputs dynamically)
            editFormContainer: document.getElementById('company-details-edit-form'),
            editButton: document.getElementById('edit-profile-button'),
            
            // Tab system
            tabButtons: document.querySelectorAll('.tab-button'),
            tabPanels: document.querySelectorAll('.tab-content-item'),
            
            // Loading states
            loadingIndicator: document.getElementById('loading-indicator')
        };

        // Validate required elements exist
        this.validateDOMElements();
    }

    /**
     * Validate that required DOM elements exist
     */
    validateDOMElements() {
        const requiredElements = ['editFormContainer', 'editButton'];
        const missing = requiredElements.filter(key => !this.domElements[key]);
        
        if (missing.length > 0) {
            console.warn('⚠️ Missing DOM elements:', missing);
        }
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // Form change tracking
        document.addEventListener('input', this.handleFormChange);
        document.addEventListener('change', this.handleFormChange);
        
        // Before unload warning
        window.addEventListener('beforeunload', this.handleBeforeUnload);
        
        // Tab switching
        this.domElements.tabButtons.forEach(button => {
            button.addEventListener('click', this.handleTabSwitch);
        });

        // Edit button (legacy - now hidden since form is always editable)
        if (this.domElements.editButton) {
            this.domElements.editButton.addEventListener('click', () => {
                // No longer needed - form is always editable
                console.log('Edit button clicked - form is already editable');
            });
        }
    }

    /**
     * Handle form input changes
     */
    handleFormChange(event) {
        if (event.target.matches('input, textarea, select')) {
            console.log('📝 Change detected:', event.target.name || event.target.id, event.target.value);
            this.setUnsavedChanges(true);
        }
    }

    /**
     * Handle before unload event
     */
    handleBeforeUnload(event) {
        if (this.hasUnsavedChanges) {
            event.preventDefault();
            event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    }

    /**
     * Handle tab switching
     */
    handleTabSwitch(event) {
        const tabName = event.target.dataset.tab;
        if (tabName && tabName !== this.currentTab) {
            this.switchTab(tabName);
        }
    }

    /**
     * Set unsaved changes state
     */
    setUnsavedChanges(hasChanges) {
        this.hasUnsavedChanges = hasChanges;
        
        if (hasChanges) {
            this.showSaveButton();
        } else {
            this.hideSaveButton();
        }
    }

    /**
     * Create floating save button
     */
    createSaveButton() {
        if (this.saveButton) return;

        this.saveButton = document.createElement('button');
        this.saveButton.id = 'floating-save-btn';
        this.saveButton.className = 'fixed bottom-6 right-6 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-8 rounded-xl shadow-2xl z-50 transition-all duration-300 transform translate-y-20 opacity-0 border-2 border-green-400';
        this.saveButton.innerHTML = '<i class="fas fa-save mr-3 text-lg"></i><span class="text-lg">Save Changes</span>';
        this.saveButton.style.display = 'none';
        
        this.saveButton.addEventListener('click', async () => {
            await this.saveAllChanges();
        });
        
        document.body.appendChild(this.saveButton);
        console.log('✅ Floating save button created');
    }

    /**
     * Show save button with animation
     */
    showSaveButton() {
        if (!this.saveButton) return;
        
        console.log('💾 Showing save button');
        this.saveButton.style.display = 'block';
        setTimeout(() => {
            this.saveButton.classList.remove('translate-y-20', 'opacity-0');
        }, 10);
    }

    /**
     * Hide save button with animation
     */
    hideSaveButton() {
        if (!this.saveButton) return;
        
        this.saveButton.classList.add('translate-y-20', 'opacity-0');
        setTimeout(() => {
            this.saveButton.style.display = 'none';
        }, 300);
    }

    /**
     * Load company data from API
     */
    async loadCompanyData() {
        try {
            console.log('📥 Loading company data for ID:', this.companyId);
            console.log('🌐 API Base URL:', this.apiBaseUrl);
            this.showLoading(true);

            const apiUrl = `${this.apiBaseUrl}/api/company/${this.companyId}`;
            console.log('📞 Fetching from:', apiUrl);
            
            const response = await fetch(apiUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.currentData = await response.json();
            console.log('✅ Company data loaded:', this.currentData);

            // Populate all tabs with data
            this.populateOverviewTab();
            this.populateConfigTab();
            this.populateNotesTab();
            this.populateCalendarTab();
            this.populateAISettingsTab();
            this.populateVoiceTab();
            this.populatePersonalityTab();
            this.populateAgentLogicTab();

        } catch (error) {
            console.error('❌ Failed to load company data:', error);
            console.error('Error details:', {
                message: error.message,
                companyId: this.companyId,
                apiBaseUrl: this.apiBaseUrl,
                fullUrl: `${this.apiBaseUrl}/api/company/${this.companyId}`
            });
            
            this.showNotification(`Failed to load company data: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Populate Overview tab with data and setup contacts
     */
    populateOverviewTab() {
        if (!this.currentData) return;

        console.log('📄 Populating Overview tab...');

        // Update header elements
        this.updateHeaderElements();

        // Modern UX: Show editable form directly, no separate view/edit modes
        this.createModernEditableForm();

        this.renderContactsSection();
        this.setupContactsHandlers();
    }

    /**
     * Create modern always-editable form
     */
    createModernEditableForm() {
        if (!this.domElements.editFormContainer) return;

        console.log('🔧 Creating modern form with data:', this.currentData);

        const formHTML = `
            <div class="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-semibold text-gray-900 flex items-center">
                        <i class="fas fa-building text-indigo-600 mr-2"></i>
                        Company Information
                    </h3>
                    <span class="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">All fields are editable</span>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-1">
                        <label class="form-label text-gray-700 font-medium">Company Name *</label>
                        <input type="text" id="edit-company-name" class="form-input focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                               value="${this.escapeHtml(this.currentData.companyName || this.currentData.name || '')}"
                               placeholder="Enter company name">
                    </div>
                    <div class="space-y-1">
                        <label class="form-label text-gray-700 font-medium">Business Phone</label>
                        <input type="tel" id="edit-business-phone" class="form-input focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                               value="${this.escapeHtml(this.currentData.companyPhone || this.currentData.businessPhone || '')}"
                               placeholder="+1-555-123-4567">
                    </div>
                    <div class="space-y-1">
                        <label class="form-label text-gray-700 font-medium">Business Email</label>
                        <input type="email" id="edit-business-email" class="form-input focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                               value="${this.escapeHtml(this.currentData.businessEmail || '')}"
                               placeholder="contact@company.com">
                    </div>
                    <div class="space-y-1">
                        <label class="form-label text-gray-700 font-medium">Website</label>
                        <input type="url" id="edit-business-website" class="form-input focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                               value="${this.escapeHtml(this.currentData.businessWebsite || '')}"
                               placeholder="https://www.company.com">
                    </div>
                    <div class="md:col-span-2 space-y-1">
                        <label class="form-label text-gray-700 font-medium">Business Address</label>
                        <input type="text" id="edit-business-address" class="form-input focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                               value="${this.escapeHtml(this.currentData.companyAddress || this.currentData.businessAddress || '')}"
                               placeholder="123 Main St, City, State 12345">
                    </div>
                    <div class="md:col-span-2 space-y-1">
                        <label class="form-label text-gray-700 font-medium">Description</label>                        <textarea id="edit-description" class="form-textarea wider-textbox focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" rows="3" 
                            placeholder="Describe your business and services...">${this.escapeHtml(this.currentData.description || '')}</textarea>
                    </div>
                    <div class="space-y-1">
                        <label class="form-label text-gray-700 font-medium">Service Area</label>
                        <input type="text" id="edit-service-area" class="form-input focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                               value="${this.escapeHtml(this.currentData.serviceArea || '')}"
                               placeholder="Greater Metro Area">
                    </div>
                    <div class="space-y-1">
                        <label class="form-label text-gray-700 font-medium">Business Hours</label>
                        <input type="text" id="edit-business-hours" class="form-input focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                               value="${this.escapeHtml(this.currentData.businessHours || '')}"
                               placeholder="Monday-Friday: 9:00 AM - 5:00 PM">
                    </div>
                </div>
                
                <div class="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
                    <div class="flex items-center">
                        <i class="fas fa-magic text-blue-600 mr-2"></i>
                        <span class="text-sm text-blue-800 font-medium">Live editing enabled - Save button appears automatically when you make changes</span>
                    </div>
                </div>
            </div>
        `;

        this.domElements.editFormContainer.innerHTML = formHTML;
        this.domElements.editFormContainer.classList.remove('hidden');

        // Hide the old edit button since form is always visible
        if (this.domElements.editButton) {
            this.domElements.editButton.style.display = 'none';
        }

        // Setup modern form listeners
        this.setupModernFormListeners();
    }

    /**
     * Setup event listeners for the modern always-editable form
     */
    setupModernFormListeners() {
        // Track changes in edit form
        const editInputs = this.domElements.editFormContainer.querySelectorAll('input, textarea');
        editInputs.forEach(input => {
            input.addEventListener('input', () => {
                this.setUnsavedChanges(true);
                console.log(`📝 Field changed: ${input.id} = ${input.value}`);
            });
        });

        console.log('✅ Modern form listeners setup complete');
    }

    /**
     * Format address data for display
     */
    formatAddress(data) {
        // Check for new simplified field first, then legacy field
        if (data.companyAddress) {
            return data.companyAddress;
        }
        
        if (data.businessAddress) {
            return data.businessAddress;
        }
        
        if (data.address && typeof data.address === 'object') {
            const addr = data.address;
            return [addr.street, addr.city, addr.state, addr.zipCode || addr.zip, addr.country]
                .filter(Boolean).join(', ') || 'No address provided';
        }
        
        return 'No address provided';
    }

    /**
     * Escape HTML for safe insertion
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Populate Configuration tab with data
     */
    populateConfigTab() {
        try {
            console.log('⚙️ Populating Config tab...');
            
            if (!this.currentData) {
                console.log('⚠️ No company data available for Config tab');
                return;
            }

            // Create modern configuration interface
            this.createConfigurationInterface();
        } catch (error) {
            console.error('❌ Error populating Config tab:', error);
            this.showNotification('Error loading configuration data', 'error');
        }
    }

    /**
     * Create modern configuration interface
     */
    createConfigurationInterface() {
        const configContent = document.getElementById('config-content');
        if (!configContent) {
            console.warn('Config content container not found');
            return;
        }

        // Look for Twilio configuration fields
        const twilioSidInput = document.getElementById('twilioAccountSid');
        const twilioTokenInput = document.getElementById('twilioAuthToken');
        const twilioApiKeyInput = document.getElementById('twilioApiKey');
        const twilioApiSecretInput = document.getElementById('twilioApiSecret');
        
        console.log('🔧 Loading Twilio config:', {
            twilioConfig: this.currentData.twilioConfig,
            flatSid: this.currentData.twilioAccountSid,
            flatToken: this.currentData.twilioAuthToken
        });
        
        // Check nested structure first, then flat structure for backward compatibility
        const twilioConfig = this.currentData.twilioConfig || {};
        
        if (twilioSidInput && (twilioConfig.accountSid || this.currentData.twilioAccountSid)) {
            twilioSidInput.value = twilioConfig.accountSid || this.currentData.twilioAccountSid;
            console.log('🔧 Loaded Twilio SID:', twilioSidInput.value);
        }
        
        if (twilioTokenInput && (twilioConfig.authToken || this.currentData.twilioAuthToken)) {
            twilioTokenInput.value = '••••••••••••••••'; // Mask for security
            console.log('🔧 Loaded Twilio Auth Token (masked)');
        }
        
        if (twilioApiKeyInput && (twilioConfig.apiKey || this.currentData.twilioApiKey)) {
            twilioApiKeyInput.value = twilioConfig.apiKey || this.currentData.twilioApiKey;
            console.log('🔧 Loaded Twilio API Key:', twilioApiKeyInput.value);
        }
        
        if (twilioApiSecretInput && (twilioConfig.apiSecret || this.currentData.twilioApiSecret)) {
            twilioApiSecretInput.value = '••••••••••••••••'; // Mask for security
            console.log('🔧 Loaded Twilio API Secret (masked)');
        }

        // Setup phone numbers management
        this.setupPhoneNumbersManagement();
        
        // Setup configuration form listeners
        this.setupConfigFormListeners();
        
        console.log('✅ Configuration interface ready');
    }

    /**
     * Setup phone numbers management
     */
    setupPhoneNumbersManagement() {
        try {
            console.log('📞 Setting up phone numbers management...');
            
            const addPhoneBtn = document.getElementById('addPhoneNumberBtn');
            if (addPhoneBtn) {
                // Remove existing listener to avoid duplicates
                addPhoneBtn.replaceWith(addPhoneBtn.cloneNode(true));
                const newAddPhoneBtn = document.getElementById('addPhoneNumberBtn');
                
                newAddPhoneBtn.addEventListener('click', () => {
                    this.addPhoneNumber();
                });
                console.log('📞 Add phone button listener attached');
            } else {
                console.warn('📞 Add phone button not found');
            }

            // Load existing phone numbers or create default one
            this.renderPhoneNumbers();
            
            // Setup event listeners for existing phone number items
            this.setupPhoneNumberEventListeners();
            
            console.log('✅ Phone numbers management setup complete');
        } catch (error) {
            console.error('❌ Error setting up phone numbers management:', error);
            // Continue execution but log the error
        }
    }

    /**
     * Setup event listeners for phone number items
     */
    setupPhoneNumberEventListeners() {
        const phoneNumberItems = document.querySelectorAll('.phone-number-item');
        console.log(`📞 Setting up event listeners for ${phoneNumberItems.length} phone number items`);
        
        phoneNumberItems.forEach((item, index) => {
            this.setupSinglePhoneNumberListeners(item);
            
            // Also add change listeners for form inputs to track unsaved changes
            const inputs = item.querySelectorAll('input, select');
            inputs.forEach(input => {
                input.addEventListener('change', () => {
                    this.setUnsavedChanges(true);
                });
                input.addEventListener('input', () => {
                    this.setUnsavedChanges(true);
                });
            });
        });
    }

    /**
     * Render existing phone numbers
     */
    renderPhoneNumbers() {
        const phoneNumbersList = document.getElementById('phoneNumbersList');
        if (!phoneNumbersList) {
            console.warn('📞 Phone numbers list element not found');
            return;
        }

        // Get phone numbers from current data with safety checks
        let phoneNumbers = [];
        if (this.currentData) {
            phoneNumbers = this.currentData?.twilioConfig?.phoneNumbers || 
                          this.currentData?.phoneNumbers || [];
        }
        
        console.log('📞 Rendering phone numbers:', phoneNumbers);

        // If no phone numbers exist, add a default empty one
        if (phoneNumbers.length === 0) {
            console.log('📞 No phone numbers found, adding default empty one');
            this.addPhoneNumber();
            return;
        }

        // Clear existing items
        phoneNumbersList.innerHTML = '';

        // Render each phone number
        phoneNumbers.forEach((phone, index) => {
            console.log(`📞 Adding phone number ${index + 1}:`, phone);
            this.addPhoneNumberWithData(phone, index === 0);
        });
    }

    /**
     * Add phone number field with existing data
     */
    addPhoneNumberWithData(phoneData, isPrimary = false) {
        const phoneNumbersList = document.getElementById('phoneNumbersList');
        const template = document.getElementById('phoneNumberTemplate');
        
        if (!phoneNumbersList || !template) return;

        const newItem = template.content.cloneNode(true);
        
        // Populate with existing data
        const phoneInput = newItem.querySelector('input[name="phoneNumber"]');
        const friendlyInput = newItem.querySelector('input[name="friendlyName"]');
        const statusSelect = newItem.querySelector('select[name="status"]');
        const setPrimaryBtn = newItem.querySelector('button[title="Set as Primary"]');
        
        if (phoneInput) phoneInput.value = phoneData.phoneNumber || phoneData.number || '';
        if (friendlyInput) friendlyInput.value = phoneData.friendlyName || '';
        if (statusSelect) statusSelect.value = phoneData.status || 'active';
        
        if (setPrimaryBtn && (isPrimary || phoneData.isPrimary)) {
            setPrimaryBtn.textContent = 'Primary';
            setPrimaryBtn.classList.remove('bg-blue-100', 'text-blue-800');
            setPrimaryBtn.classList.add('bg-green-100', 'text-green-800');
        }
        
        phoneNumbersList.appendChild(newItem);
        
        // Setup event listeners for this item
        const addedItem = phoneNumbersList.lastElementChild;
        this.setupSinglePhoneNumberListeners(addedItem);
    }

    /**
     * Setup event listeners for a single phone number item
     */
    setupSinglePhoneNumberListeners(item) {
        if (!item) return;
        
        const deleteBtn = item.querySelector('button[title="Remove"]');
        const setPrimaryBtn = item.querySelector('button[title="Set as Primary"]');
        
        // Handle delete button
        if (deleteBtn) {
            // Remove existing event listeners by cloning the element
            const newDeleteBtn = deleteBtn.cloneNode(true);
            deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
            
            newDeleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('📞 Delete button clicked');
                this.removePhoneNumber(item);
            });
        }
        
        // Handle set primary button
        if (setPrimaryBtn) {
            // Remove existing event listeners by cloning the element
            const newSetPrimaryBtn = setPrimaryBtn.cloneNode(true);
            setPrimaryBtn.parentNode.replaceChild(newSetPrimaryBtn, setPrimaryBtn);
            
            newSetPrimaryBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('📞 Set primary button clicked');
                this.setPrimaryNumber(item);
            });
        }
        
        // Add change listeners to inputs for unsaved changes tracking
        const inputs = item.querySelectorAll('input, select');
        inputs.forEach(input => {
            input.addEventListener('change', () => {
                this.setUnsavedChanges(true);
            });
            input.addEventListener('input', () => {
                this.setUnsavedChanges(true);
            });
        });
    }

    /**
     * Add new phone number field
     */
    addPhoneNumber() {
        const phoneNumbersList = document.getElementById('phoneNumbersList');
        const template = document.getElementById('phoneNumberTemplate');
        
        if (!phoneNumbersList || !template) return;

        const newItem = template.content.cloneNode(true);
        phoneNumbersList.appendChild(newItem);
        
        // Setup event listeners for the newly added item
        const addedItem = phoneNumbersList.lastElementChild;
        this.setupSinglePhoneNumberListeners(addedItem);
        
        this.setUnsavedChanges(true);
        console.log('📞 New phone number field added');
    }

    /**
     * Remove phone number field
     */
    removePhoneNumber(phoneItem) {
        if (!phoneItem) return;
        
        // Don't allow removing the last phone number
        const phoneNumbersList = document.getElementById('phoneNumbersList');
        const allItems = phoneNumbersList.querySelectorAll('.phone-number-item');
        
        if (allItems.length <= 1) {
            this.showNotification('Cannot remove the last phone number', 'error');
            return;
        }
        
        phoneItem.remove();
        this.setUnsavedChanges(true);
        console.log('📞 Phone number field removed');
    }

    /**
     * Set phone number as primary
     */
    setPrimaryNumber(phoneItem) {
        if (!phoneItem) return;
        
        // Remove primary status from all items
        const phoneNumbersList = document.getElementById('phoneNumbersList');
        const allItems = phoneNumbersList.querySelectorAll('.phone-number-item');
        
        allItems.forEach(item => {
            const primaryBtn = item.querySelector('button[title="Set as Primary"]');
            if (primaryBtn) {
                primaryBtn.textContent = 'Set Primary';
                primaryBtn.classList.remove('bg-green-100', 'text-green-800');
                primaryBtn.classList.add('bg-blue-100', 'text-blue-800');
            }
        });
        
        // Set this item as primary
        const primaryBtn = phoneItem.querySelector('button[title="Set as Primary"]');
        if (primaryBtn) {
            primaryBtn.textContent = 'Primary';
            primaryBtn.classList.remove('bg-blue-100', 'text-blue-800');
            primaryBtn.classList.add('bg-green-100', 'text-green-800');
        }
        
        this.setUnsavedChanges(true);
        console.log('📞 Primary phone number updated');
    }

    /**
     * Setup configuration form event listeners
     */
    setupConfigFormListeners() {
        const configForm = document.getElementById('config-settings-form');
        if (!configForm) {
            console.warn('❌ Config form not found');
            return;
        }

        // Setup webhook toggle functionality
        this.setupWebhookToggle();

        // Setup form submission
        configForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveConfigurationChanges();
        });

        // Track changes for unsaved indicator
        const inputs = configForm.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                this.setUnsavedChanges(true);
            });
        });
    }

    /**
     * Setup webhook toggle functionality
     */
    setupWebhookToggle() {
        const toggleWebhookBtn = document.getElementById('toggleWebhookInfo');
        const webhookPanel = document.getElementById('webhookInfoPanel');
        
        console.log('🔧 Setting up webhook toggle...', { 
            toggleWebhookBtn: !!toggleWebhookBtn, 
            webhookPanel: !!webhookPanel,
            companyId: this.companyId 
        });
        
        if (!toggleWebhookBtn || !webhookPanel) {
            console.warn('❌ Webhook toggle elements not found:', { 
                toggleWebhookBtn: !!toggleWebhookBtn, 
                webhookPanel: !!webhookPanel 
            });
            return;
        }

        if (!this.companyId) {
            console.warn('❌ Company ID not available for webhook setup');
            return;
        }

        // Check if already set up (avoid duplicate event listeners)
        if (toggleWebhookBtn.dataset.webhookSetup === 'true') {
            console.log('✅ Webhook toggle already set up');
            return;
        }

        // Mark as set up
        toggleWebhookBtn.dataset.webhookSetup = 'true';
        
        // Add the event listener
        toggleWebhookBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('🔘 Webhook toggle clicked for company:', this.companyId);
            
            const currentPanel = document.getElementById('webhookInfoPanel');
            if (!currentPanel) {
                console.error('❌ Webhook panel disappeared');
                return;
            }
            
            const isHidden = currentPanel.classList.contains('hidden');
            console.log('📊 Panel hidden state:', isHidden);
            
            if (isHidden) {
                // Generate dynamic webhook content with companyId
                console.log('🔧 Generating webhook panel for company:', this.companyId);
                this.generateWebhookPanel();
                currentPanel.classList.remove('hidden');
                toggleWebhookBtn.innerHTML = '<i class="fas fa-eye-slash mr-1"></i>Hide Webhook URLs';
            } else {
                currentPanel.classList.add('hidden');
                toggleWebhookBtn.innerHTML = '<i class="fas fa-info-circle mr-1"></i>Show Webhook URLs';
            }
        });
        
        console.log('✅ Webhook toggle setup complete');
    }

    /**
     * Save configuration changes
     */
    async saveConfigurationChanges() {
        try {
            console.log('💾 Saving configuration changes...');
            
            // Show loading state
            this.showLoading(true);
            
            // Collect only configuration data
            const configData = {};
            this.collectConfigData(configData);
            
            // Add other tabs' data if they exist
            this.collectNotesData(configData);
            this.collectCalendarData(configData);
            this.collectAISettingsData(configData);
            this.collectVoiceData(configData);
            this.collectPersonalityData(configData);
            this.collectAgentLogicData(configData);
            
            console.log('📤 Sending configuration data:', configData);
            
            // Send PATCH request
            const response = await fetch(`${this.apiBaseUrl}/api/company/${this.companyId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(configData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to save configuration');
            }

            const updatedCompany = await response.json();
            this.currentData = updatedCompany;
            this.setUnsavedChanges(false);
            
            console.log('✅ Configuration saved successfully');
            this.showNotification('Configuration saved successfully!', 'success');
            
        } catch (error) {
            console.error('❌ Error saving configuration:', error);
            this.showNotification('Failed to save configuration', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Populate Notes tab with data
     */
    populateNotesTab() {
        console.log('📝 Populating Notes tab...');
        
        // Initialize notes management system
        this.initializeNotesSystem();
    }

    /**
     * Initialize notes management system
     */
    initializeNotesSystem() {
        // Initialize notes array
        this.notes = this.currentData?.notes || [];
        
        // Setup notes interface
        this.setupNotesInterface();
        
        // Render existing notes
        this.renderNotes();
        
        console.log('✅ Notes system initialized');
    }

    /**
     * Setup notes interface and event listeners
     */
    setupNotesInterface() {
        // Find add note button
        const addNoteBtn = document.querySelector('[onclick*="addLogicNote"]') || 
                          document.getElementById('add-note-btn');
        
        if (addNoteBtn) {
            // Remove existing onclick and add modern event listener
            addNoteBtn.removeAttribute('onclick');
            addNoteBtn.addEventListener('click', () => {
                this.addNote();
            });
        }

        // Setup note textarea
        const noteTextarea = document.getElementById('new-logic-note') || 
                           document.getElementById('new-note');
        
        if (noteTextarea) {
            noteTextarea.addEventListener('input', () => {
                this.setUnsavedChanges(true);
            });
        }
    }

    /**
     * Add new note
     */
    addNote() {
        const textarea = document.getElementById('new-logic-note') || 
                        document.getElementById('new-note');
        
        if (!textarea || !textarea.value.trim()) {
            this.showNotification('Please enter a note', 'error');
            return;
        }

        const note = {
            id: Date.now(),
            content: textarea.value.trim(),
            timestamp: new Date().toISOString(),
            author: 'Admin' // Could be made dynamic
        };

        this.notes.unshift(note);
        textarea.value = '';
        
        this.renderNotes();
        this.setUnsavedChanges(true);
        this.showNotification('Note added successfully!', 'success');
        
        console.log('📝 Note added:', note);
    }

    /**
     * Delete note
     */
    deleteNote(noteId) {
        if (!confirm('Are you sure you want to delete this note?')) return;

        this.notes = this.notes.filter(note => note.id !== noteId);
        this.renderNotes();
        this.setUnsavedChanges(true);
        this.showNotification('Note deleted', 'success');
        
        console.log('🗑️ Note deleted:', noteId);
    }

    /**
     * Render notes list
     */
    renderNotes() {
        const container = document.getElementById('logic-notes-list') || 
                         document.getElementById('notes-list');
        
        if (!container) {
            console.warn('Notes container not found');
            return;
        }

        if (this.notes.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-sticky-note text-3xl mb-3 text-gray-300"></i>
                    <p>No notes yet. Add your first note above.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.notes.map(note => `
            <div class="note-card bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
                <div class="note-content text-gray-800 whitespace-pre-wrap mb-3">
                    ${this.escapeHtml(note.content)}
                </div>
                <div class="flex justify-between items-center text-sm text-gray-500">
                    <div class="note-timestamps">
                        <span class="mr-4">
                            <i class="fas fa-clock mr-1"></i>
                            ${new Date(note.timestamp).toLocaleString()}
                        </span>
                        <span>
                            <i class="fas fa-user mr-1"></i>
                            ${this.escapeHtml(note.author)}
                        </span>
                    </div>
                    <button onclick="companyProfileManager.deleteNote(${note.id})" 
                            class="text-red-600 hover:text-red-800 transition-colors">
                        <i class="fas fa-trash mr-1"></i>Delete
                    </button>
                </div>
            </div>
        `).join('');

        console.log(`✅ Rendered ${this.notes.length} notes`);
    }

    /**
     * Populate Calendar Settings tab with data
     */
    populateCalendarTab() {
        console.log('📅 Populating Calendar tab...');
        
        // Setup Google Calendar integration
        this.setupGoogleCalendarIntegration();
        
        // Setup timezone selection
        this.setupTimezoneSelection();
        
        // Setup operating hours
        this.setupOperatingHours();
        
        console.log('✅ Calendar tab configured');
    }

    /**
     * Setup Google Calendar integration
     */
    setupGoogleCalendarIntegration() {
        const connectBtn = document.getElementById('connect-google-calendar');
        const disconnectBtn = document.getElementById('disconnect-google-calendar');
        
        if (connectBtn) {
            connectBtn.addEventListener('click', () => {
                this.connectGoogleCalendar();
            });
        }

        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => {
                this.disconnectGoogleCalendar();
            });
        }

        // Show current connection status
        if (this.currentData?.googleCalendar?.connected) {
            this.showGoogleCalendarConnected();
        } else {
            this.showGoogleCalendarDisconnected();
        }
    }

    /**
     * Connect Google Calendar
     */
    async connectGoogleCalendar() {
        try {
            // This would typically redirect to Google OAuth
            this.showNotification('Redirecting to Google Calendar authorization...', 'info');
            
            // In a real implementation, this would open Google OAuth flow
            console.log('🗓️ Google Calendar connection initiated');
            
            // For demo purposes, simulate connection
            setTimeout(() => {
                this.showNotification('Google Calendar connected successfully!', 'success');
                this.showGoogleCalendarConnected();
                this.setUnsavedChanges(true);
            }, 2000);
            
        } catch (error) {
            console.error('❌ Google Calendar connection failed:', error);
            this.showNotification('Failed to connect Google Calendar', 'error');
        }
    }

    /**
     * Disconnect Google Calendar
     */
    async disconnectGoogleCalendar() {
        if (!confirm('Are you sure you want to disconnect Google Calendar?')) return;

        try {
            this.showNotification('Disconnecting Google Calendar...', 'info');
            
            // API call to disconnect
            // const response = await fetch(`/api/companies/${this.companyId}/disconnect-google`, {
            //     method: 'POST'
            // });
            
            setTimeout(() => {
                this.showNotification('Google Calendar disconnected', 'success');
                this.showGoogleCalendarDisconnected();
                this.setUnsavedChanges(true);
            }, 1000);
            
        } catch (error) {
            console.error('❌ Google Calendar disconnection failed:', error);
            this.showNotification('Failed to disconnect Google Calendar', 'error');
        }
    }

    /**
     * Show Google Calendar connected state
     */
    showGoogleCalendarConnected() {
        const connectBtn = document.getElementById('connect-google-calendar');
        const disconnectBtn = document.getElementById('disconnect-google-calendar');
        
        if (connectBtn) connectBtn.style.display = 'none';
        if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
    }

    /**
     * Show Google Calendar disconnected state
     */
    showGoogleCalendarDisconnected() {
        const connectBtn = document.getElementById('connect-google-calendar');
        const disconnectBtn = document.getElementById('disconnect-google-calendar');
        
        if (connectBtn) connectBtn.style.display = 'inline-block';
        if (disconnectBtn) disconnectBtn.style.display = 'none';
    }

    /**
     * Setup timezone selection
     */
    setupTimezoneSelection() {
        const timezoneSelect = document.getElementById('timezone');
        if (!timezoneSelect) return;

        // Set current timezone if available
        if (this.currentData?.timezone) {
            timezoneSelect.value = this.currentData.timezone;
        }

        // Track timezone changes
        timezoneSelect.addEventListener('change', () => {
            this.setUnsavedChanges(true);
            console.log('🌍 Timezone changed to:', timezoneSelect.value);
        });
    }

    /**
     * Setup operating hours management
     */
    setupOperatingHours() {
        const operatingHours = this.currentData?.operatingHours || this.getDefaultOperatingHours();
        
        operatingHours.forEach(daySchedule => {
            const dayName = daySchedule.day.toLowerCase();
            const enabledCheckbox = document.getElementById(`${dayName}-enabled`);
            const startInput = document.getElementById(`${dayName}-start`);
            const endInput = document.getElementById(`${dayName}-end`);

            if (enabledCheckbox) {
                enabledCheckbox.checked = daySchedule.enabled || false;
                enabledCheckbox.addEventListener('change', () => {
                    this.setUnsavedChanges(true);
                    this.toggleDayInputs(dayName, enabledCheckbox.checked);
                });
            }

            if (startInput) {
                startInput.value = daySchedule.start || '09:00';
                startInput.addEventListener('change', () => this.setUnsavedChanges(true));
            }

            if (endInput) {
                endInput.value = daySchedule.end || '17:00';
                endInput.addEventListener('change', () => this.setUnsavedChanges(true));
            }

            // Initial state
            this.toggleDayInputs(dayName, daySchedule.enabled);
        });
    }

    /**
     * Toggle day input fields based on enabled state
     */
    toggleDayInputs(dayName, enabled) {
        const startInput = document.getElementById(`${dayName}-start`);
        const endInput = document.getElementById(`${dayName}-end`);

        if (startInput) startInput.disabled = !enabled;
        if (endInput) endInput.disabled = !enabled;
    }

    /**
     * Get default operating hours
     */
    getDefaultOperatingHours() {
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        return days.map(day => ({
            day: day,
            enabled: ['saturday', 'sunday'].includes(day) ? false : true,
            start: '09:00',
            end: '17:00'
        }));
    }

    /**
     * Populate AI Settings tab with data
     */
    populateAISettingsTab() {
        console.log('🤖 Populating AI Settings tab...');
        
        // Setup AI model selection
        this.setupAIModelSelection();
        
        // Setup AI personality configuration
        this.setupAIPersonalityConfig();
        
        // Setup TTS provider selection
        this.setupTTSProviderConfig();
        
        console.log('✅ AI Settings tab configured');
    }

    /**
     * Setup AI model selection
     */
    setupAIModelSelection() {
        const aiModelSelect = document.getElementById('ai-model');
        if (!aiModelSelect) return;

        // Set current AI model if available
        if (this.currentData?.aiSettings?.model) {
            aiModelSelect.value = this.currentData.aiSettings.model;
        }

        // Track AI model changes
        aiModelSelect.addEventListener('change', () => {
            this.setUnsavedChanges(true);
            console.log('🤖 AI model changed to:', aiModelSelect.value);
        });
    }

    /**
     * Setup AI personality configuration
     */
    setupAIPersonalityConfig() {
        const personalitySelect = document.getElementById('ai-personality');
        if (!personalitySelect) return;

        // Set current personality if available
        if (this.currentData?.aiSettings?.personality) {
            personalitySelect.value = this.currentData.aiSettings.personality;
        }

        // Track personality changes
        personalitySelect.addEventListener('change', () => {
            this.setUnsavedChanges(true);
            console.log('🎭 AI personality changed to:', personalitySelect.value);
        });
    }

    /**
     * Setup TTS provider configuration
     */
    setupTTSProviderConfig() {
        const ttsProviderSelect = document.getElementById('tts-provider');
        if (!ttsProviderSelect) return;

        // Set current TTS provider if available
        if (this.currentData?.aiSettings?.ttsProvider) {
            ttsProviderSelect.value = this.currentData.aiSettings.ttsProvider;
        }

        // Track TTS provider changes
        ttsProviderSelect.addEventListener('change', () => {
            this.setUnsavedChanges(true);
            console.log('🎙️ TTS provider changed to:', ttsProviderSelect.value);
        });
    }

    /**
     * Populate Voice Settings tab with data
     */
    populateVoiceTab() {
        console.log('🎙️ Populating Voice tab...');
        
        // Setup ElevenLabs configuration
        this.setupElevenLabsConfig();
        
        // Load available voices
        this.loadElevenLabsVoices();
        
        // Setup voice testing
        this.setupVoiceTesting();
        
        console.log('✅ Voice tab configured');
    }

    /**
     * Setup ElevenLabs configuration
     */
    setupElevenLabsConfig() {
        const apiKeyInput = document.getElementById('elevenlabsApiKey');
        const voiceSelect = document.getElementById('elevenlabsVoice');
        
        // Set current ElevenLabs settings if available
        let apiKey = null;
        let voiceId = null;
        
        // Check for API key in multiple locations
        if (this.currentData?.elevenLabsApiKey) {
            apiKey = this.currentData.elevenLabsApiKey;
        } else if (this.currentData?.aiSettings?.elevenLabs?.apiKey) {
            apiKey = this.currentData.aiSettings.elevenLabs.apiKey;
        }
        
        // Check for voice ID in multiple locations
        if (this.currentData?.elevenLabsVoiceId) {
            voiceId = this.currentData.elevenLabsVoiceId;
        } else if (this.currentData?.aiSettings?.elevenLabs?.voiceId) {
            voiceId = this.currentData.aiSettings.elevenLabs.voiceId;
        } else if (this.currentData?.voiceSettings?.voiceId) {
            voiceId = this.currentData.voiceSettings.voiceId;
        }
        
        if (apiKeyInput && apiKey) {
            apiKeyInput.value = apiKey.substring(0, 8) + '••••••••••••••••';
        }
        
        if (voiceSelect && voiceId) {
            voiceSelect.value = voiceId;
        }

        // Track API key changes
        if (apiKeyInput) {
            apiKeyInput.addEventListener('input', () => {
                this.setUnsavedChanges(true);
                console.log('🔑 ElevenLabs API key updated');
            });
        }

        // Track voice selection changes
        if (voiceSelect) {
            voiceSelect.addEventListener('change', () => {
                this.setUnsavedChanges(true);
                console.log('🎵 ElevenLabs voice changed to:', voiceSelect.value);
            });
        }
    }

    /**
     * Load ElevenLabs voices
     */
    loadElevenLabsVoices() {
        const voiceSelect = document.getElementById('elevenlabsVoice');
        if (!voiceSelect) return;

        // Default voices available in ElevenLabs
        const defaultVoices = [
            { id: 'rachel', name: 'Rachel (Default Female)' },
            { id: 'domi', name: 'Domi (Young Female)' },
            { id: 'bella', name: 'Bella (Soft Female)' },
            { id: 'antoni', name: 'Antoni (Male)' },
            { id: 'elli', name: 'Elli (Emotional Female)' },
            { id: 'josh', name: 'Josh (Deep Male)' },
            { id: 'arnold', name: 'Arnold (Crisp Male)' },
            { id: 'adam', name: 'Adam (Deep Male)' },
            { id: 'sam', name: 'Sam (Raspy Male)' }
        ];

        // Clear existing options
        voiceSelect.innerHTML = '';

        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Select a voice...';
        voiceSelect.appendChild(defaultOption);

        // Add voice options
        defaultVoices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.id;
            option.textContent = voice.name;
            voiceSelect.appendChild(option);
        });

        console.log('✅ ElevenLabs voices loaded');
    }

    /**
     * Setup voice testing functionality
     */
    setupVoiceTesting() {
        const testBtn = document.getElementById('testElevenLabsVoiceBtn');
        const testPhraseInput = document.getElementById('elevenlabsTestPhrase');
        
        if (!testBtn) return;

        testBtn.addEventListener('click', () => {
            this.testElevenLabsVoice();
        });

        // Set default test phrase if empty
        if (testPhraseInput && !testPhraseInput.value) {
            testPhraseInput.value = 'Hello, this is a test of the ElevenLabs voice synthesis. How does this sound?';
        }
    }

    /**
     * Test ElevenLabs voice
     */
    async testElevenLabsVoice() {
        const apiKeyInput = document.getElementById('elevenlabsApiKey');
        const voiceSelect = document.getElementById('elevenlabsVoice');
        const testPhraseInput = document.getElementById('elevenlabsTestPhrase');
        
        const apiKey = apiKeyInput?.value;
        const voiceId = voiceSelect?.value;
        const testPhrase = testPhraseInput?.value || 'Hello, this is a test from ElevenLabs!';

        if (!apiKey || apiKey.includes('••••')) {
            this.showNotification('Please enter a valid ElevenLabs API key', 'error');
            return;
        }

        if (!voiceId) {
            this.showNotification('Please select a voice first', 'error');
            return;
        }

        try {
            this.showNotification('Generating voice sample...', 'info');
            
            // In a real implementation, this would make an API call to ElevenLabs
            // For demo purposes, we'll simulate the test
            console.log('🎵 Testing ElevenLabs voice:', { 
                voiceId, 
                testPhrase: testPhrase.substring(0, 50) + '...' 
            });
            
            // Simulate API call delay
            setTimeout(() => {
                this.showNotification('Voice test completed! (Demo mode)', 'success');
            }, 2000);
            
        } catch (error) {
            console.error('❌ Voice test failed:', error);
            this.showNotification('Voice test failed', 'error');
        }
    }

    /**
     * Populate Personality Responses tab with data
     */
    populatePersonalityTab() {
        console.log('🎭 Populating Personality tab...');
        
        // Setup placeholder management
        this.setupPlaceholderManagement();
        
        // Setup response category management
        this.setupResponseCategoryManagement();
        
        // Setup personality response fields
        this.setupPersonalityResponses();
        
        console.log('✅ Personality tab configured');
    }

    /**
     * Setup placeholder management functionality
     */
    setupPlaceholderManagement() {
        // Initialize placeholders with default company placeholders
        if (!this.currentData.placeholders) {
            this.currentData.placeholders = this.getDefaultPlaceholders();
        }

        // Populate the placeholders table
        this.populatePlaceholdersTable();

        // Setup event listeners for placeholder management
        this.setupPlaceholderEventListeners();
    }

    /**
     * Get default placeholders based on company data
     */
    getDefaultPlaceholders() {
        const defaultPlaceholders = {
            companyname: {
                value: this.currentData?.companyName || 'Your Company Name',
                description: 'The name of your company',
                type: 'system'
            },
            businessphone: {
                value: this.currentData?.businessPhone || this.currentData?.ownerPhone || 'Your Business Phone',
                description: 'Main business phone number',
                type: 'system'
            },
            businessemail: {
                value: this.currentData?.businessEmail || this.currentData?.ownerEmail || 'Your Business Email',
                description: 'Main business email address',
                type: 'system'
            },
            businesshours: {
                value: this.currentData?.businessHours || 'Monday-Friday: 9 AM to 5 PM',
                description: 'Standard business operating hours',
                type: 'system'
            }
        };

        return defaultPlaceholders;
    }

    /**
     * Populate the placeholders table
     */
    populatePlaceholdersTable() {
        const tableBody = document.getElementById('placeholders-table-body');
        if (!tableBody) return;

        tableBody.innerHTML = '';
        const placeholders = this.currentData.placeholders || {};

        Object.entries(placeholders).forEach(([key, placeholder]) => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50';
            
            const typeColor = placeholder.type === 'system' ? 'text-blue-600 bg-blue-100' : 'text-purple-600 bg-purple-100';
            
            row.innerHTML = `
                <td class="px-4 py-3">
                    <code class="bg-gray-100 px-2 py-1 rounded text-sm font-mono text-purple-700">{${key}}</code>
                </td>
                <td class="px-4 py-3">
                    <div class="text-sm text-gray-900">${placeholder.value}</div>
                    ${placeholder.description ? `<div class="text-xs text-gray-500">${placeholder.description}</div>` : ''}
                </td>
                <td class="px-4 py-3">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeColor}">
                        ${placeholder.type}
                    </span>
                </td>
                <td class="px-4 py-3 text-right">
                    <div class="flex justify-end space-x-2">
                        <button class="edit-placeholder-btn text-indigo-600 hover:text-indigo-800 text-sm" data-key="${key}">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${placeholder.type === 'custom' ? `
                            <button class="delete-placeholder-btn text-red-600 hover:text-red-800 text-sm" data-key="${key}">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            `;
            
            tableBody.appendChild(row);
        });

        // Add event listeners to the new buttons
        this.setupPlaceholderRowEventListeners();
    }

    /**
     * Setup event listeners for placeholder management
     */
    setupPlaceholderEventListeners() {
        // Add placeholder button
        const addBtn = document.getElementById('add-placeholder-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.openPlaceholderModal());
        }

        // Modal close buttons
        const closeBtn = document.getElementById('close-placeholder-modal');
        const cancelBtn = document.getElementById('cancel-placeholder');
        const modal = document.getElementById('placeholder-modal');

        if (closeBtn) closeBtn.addEventListener('click', () => this.closePlaceholderModal());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closePlaceholderModal());
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closePlaceholderModal();
            });
        }

        // Form submission
        const form = document.getElementById('placeholder-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.savePlaceholder();
            });
        }
    }

    /**
     * Setup event listeners for placeholder table rows
     */
    setupPlaceholderRowEventListeners() {
        // Edit buttons
        document.querySelectorAll('.edit-placeholder-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.closest('button').dataset.key;
                this.editPlaceholder(key);
            });
        });

        // Delete buttons
        document.querySelectorAll('.delete-placeholder-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.closest('button').dataset.key;
                this.deletePlaceholder(key);
            });
        });
    }

    /**
     * Open placeholder modal for adding/editing
     */
    openPlaceholderModal(placeholderKey = null) {
        const modal = document.getElementById('placeholder-modal');
        const title = document.getElementById('placeholder-modal-title');
        const submitText = document.getElementById('placeholder-submit-text');
        const form = document.getElementById('placeholder-form');

        if (placeholderKey) {
            // Edit mode
            title.textContent = 'Edit Placeholder';
            submitText.textContent = 'Update Placeholder';
            const placeholder = this.currentData.placeholders[placeholderKey];
            document.getElementById('placeholder-name').value = placeholderKey;
            document.getElementById('placeholder-value').value = placeholder.value;
            document.getElementById('placeholder-description').value = placeholder.description || '';
            form.dataset.editKey = placeholderKey;
        } else {
            // Add mode
            title.textContent = 'Add Placeholder';
            submitText.textContent = 'Add Placeholder';
            form.reset();
            delete form.dataset.editKey;
        }

        modal.classList.remove('hidden');
    }

    /**
     * Close placeholder modal
     */
    closePlaceholderModal() {
        const modal = document.getElementById('placeholder-modal');
        modal.classList.add('hidden');
    }

    /**
     * Save placeholder (add or update)
     */
    savePlaceholder() {
        const form = document.getElementById('placeholder-form');
        const name = document.getElementById('placeholder-name').value.trim().toLowerCase();
        const value = document.getElementById('placeholder-value').value.trim();
        const description = document.getElementById('placeholder-description').value.trim();

        if (!name || !value) {
            this.showNotification('Please fill in required fields', 'error');
            return;
        }

        // Validate placeholder name
        if (!/^[a-z0-9_]+$/.test(name)) {
            this.showNotification('Placeholder name can only contain lowercase letters, numbers, and underscores', 'error');
            return;
        }

        const isEdit = form.dataset.editKey;
        const placeholders = this.currentData.placeholders || {};

        // Check if name already exists (only for new placeholders)
        if (!isEdit && placeholders[name]) {
            this.showNotification('A placeholder with this name already exists', 'error');
            return;
        }

        // Save the placeholder
        placeholders[name] = {
            value: value,
            description: description,
            type: 'custom'
        };

        this.currentData.placeholders = placeholders;
        this.setUnsavedChanges(true);
        
        // Refresh the table
        this.populatePlaceholdersTable();
        
        // Close modal
        this.closePlaceholderModal();
        
        this.showNotification(`Placeholder {${name}} ${isEdit ? 'updated' : 'added'} successfully!`, 'success');
    }

    /**
     * Edit placeholder
     */
    editPlaceholder(key) {
        this.openPlaceholderModal(key);
    }

    /**
     * Delete placeholder
     */
    deletePlaceholder(key) {
        if (confirm(`Are you sure you want to delete the placeholder {${key}}?`)) {
            delete this.currentData.placeholders[key];
            this.setUnsavedChanges(true);
            this.populatePlaceholdersTable();
            this.showNotification(`Placeholder {${key}} deleted successfully!`, 'success');
        }
    }

    /**
     * Process placeholders in text
     */
    processPlaceholders(text) {
        if (!text || !this.currentData.placeholders) return text;

        let processedText = text;
        Object.entries(this.currentData.placeholders).forEach(([key, placeholder]) => {
            const regex = new RegExp(`\\{${key}\\}`, 'gi');
            processedText = processedText.replace(regex, placeholder.value);
        });

        return processedText;
    }

    /**
     * Setup response category management functionality
     */
    setupResponseCategoryManagement() {
        // Initialize response categories with defaults if not exists
        if (!this.currentData.responseCategories) {
            this.currentData.responseCategories = this.getDefaultResponseCategories();
        }

        // Populate the response categories
        this.populateResponseCategories();

        // Setup event listeners for response category management
        this.setupResponseCategoryEventListeners();
    }

    /**
     * Get default response categories
     */
    getDefaultResponseCategories() {
        return {
            greeting: {
                label: 'Greeting Response',
                icon: 'fas fa-hand-wave',
                description: 'How the agent greets callers when they first connect',
                defaultTemplate: 'Hello! Thank you for calling {companyname}. How can I help you today?'
            },
            farewell: {
                label: 'Farewell Response',
                icon: 'fas fa-hand-peace',
                description: 'How the agent says goodbye to callers',
                defaultTemplate: 'Thank you for choosing {companyname}. Have a wonderful day!'
            },
            hold: {
                label: 'Hold Response',
                icon: 'fas fa-pause-circle',
                description: 'What the agent says when placing callers on hold',
                defaultTemplate: 'Please hold for just a moment while I check on that for you.'
            },
            transfer: {
                label: 'Transfer Response',
                icon: 'fas fa-phone-flip',
                description: 'What the agent says when transferring calls',
                defaultTemplate: 'Let me transfer you to someone who can better assist you with that.'
            },
            unavailable: {
                label: 'Service Unavailable',
                icon: 'fas fa-exclamation-triangle',
                description: 'Response when a service is not available',
                defaultTemplate: 'I apologize, but that service is currently unavailable. Is there something else I can help you with?'
            },
            businessHours: {
                label: 'Business Hours Info',
                icon: 'fas fa-clock',
                description: 'How the agent communicates business hours',
                defaultTemplate: 'Our business hours are {businesshours}. We\'d be happy to help you during those times.'
            },
            afterHours: {
                label: 'After Hours Response',
                icon: 'fas fa-moon',
                description: 'Response when calling outside business hours',
                defaultTemplate: 'Thank you for calling {companyname}. We are currently closed. Please call back during business hours or leave a message.'
            },
            voicemail: {
                label: 'Voicemail Instructions',
                icon: 'fas fa-voicemail',
                description: 'Instructions for leaving a voicemail',
                defaultTemplate: 'Please leave your name, phone number, and a brief message after the tone, and we\'ll get back to you as soon as possible.'
            },
            callback: {
                label: 'Callback Request',
                icon: 'fas fa-phone-volume',
                description: 'How the agent handles callback requests',
                defaultTemplate: 'I\'d be happy to have someone call you back. What\'s the best number to reach you at?'
            }
        };
    }

    /**
     * Populate response categories display
     */
    populateResponseCategories() {
        const container = document.getElementById('response-categories-container');
        if (!container) return;

        container.innerHTML = '';
        const categories = this.currentData.responseCategories || {};

        Object.entries(categories).forEach(([key, category]) => {
            const categoryCard = document.createElement('div');
            categoryCard.className = 'bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow';
            
            categoryCard.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-3">
                        <div class="flex-shrink-0">
                            <div class="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                                <i class="${category.icon || 'fas fa-comment'} text-indigo-600 text-sm"></i>
                            </div>
                        </div>
                        <div class="flex-1">
                            <h4 class="text-sm font-medium text-gray-900">${category.label}</h4>
                            <p class="text-xs text-gray-500">${category.description || ''}</p>
                            ${category.defaultTemplate ? `<p class="text-xs text-gray-400 mt-1 italic">Default: "${category.defaultTemplate.substring(0, 50)}${category.defaultTemplate.length > 50 ? '...' : ''}"</p>` : ''}
                        </div>
                    </div>
                    <div class="flex items-center space-x-2">
                        <button class="edit-response-category-btn text-indigo-600 hover:text-indigo-800 text-sm p-1" data-key="${key}" title="Edit Category">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="delete-response-category-btn text-red-600 hover:text-red-800 text-sm p-1" data-key="${key}" title="Delete Category">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            
            container.appendChild(categoryCard);
        });

        // Setup event listeners for the new buttons
        this.setupResponseCategoryRowEventListeners();
    }

    /**
     * Setup event listeners for response category management
     */
    setupResponseCategoryEventListeners() {
        // Add response category button
        const addBtn = document.getElementById('add-response-category-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.openResponseCategoryModal());
        }

        // Modal close buttons
        const closeBtn = document.getElementById('close-response-category-modal');
        const cancelBtn = document.getElementById('cancel-response-category');
        const modal = document.getElementById('response-category-modal');

        if (closeBtn) closeBtn.addEventListener('click', () => this.closeResponseCategoryModal());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeResponseCategoryModal());
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeResponseCategoryModal();
            });
        }

        // Form submission
        const form = document.getElementById('response-category-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveResponseCategory();
            });
        }
    }

    /**
     * Setup event listeners for response category cards
     */
    setupResponseCategoryRowEventListeners() {
        // Edit buttons
        document.querySelectorAll('.edit-response-category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.closest('button').dataset.key;
                this.editResponseCategory(key);
            });
        });

        // Delete buttons
        document.querySelectorAll('.delete-response-category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.closest('button').dataset.key;
                this.deleteResponseCategory(key);
            });
        });
    }

    /**
     * Open response category modal for adding/editing
     */
    openResponseCategoryModal(categoryKey = null) {
        const modal = document.getElementById('response-category-modal');
        const title = document.getElementById('response-category-modal-title');
        const submitText = document.getElementById('response-category-submit-text');
        const form = document.getElementById('response-category-form');

        if (categoryKey) {
            // Edit mode
            title.textContent = 'Edit Response Category';
            submitText.textContent = 'Update Category';
            const category = this.currentData.responseCategories[categoryKey];
            document.getElementById('response-category-key').value = categoryKey;
            document.getElementById('response-category-label').value = category.label;
            document.getElementById('response-category-icon').value = category.icon || '';
            document.getElementById('response-category-description').value = category.description || '';
            document.getElementById('response-category-default').value = category.defaultTemplate || '';
            form.dataset.editKey = categoryKey;
        } else {
            // Add mode
            title.textContent = 'Add Response Category';
            submitText.textContent = 'Add Category';
            form.reset();
            delete form.dataset.editKey;
        }

        modal.classList.remove('hidden');
    }

    /**
     * Close response category modal
     */
    closeResponseCategoryModal() {
        const modal = document.getElementById('response-category-modal');
        modal.classList.add('hidden');
    }

    /**
     * Save response category (add or update)
     */
    saveResponseCategory() {
        const form = document.getElementById('response-category-form');
        const key = document.getElementById('response-category-key').value.trim().toLowerCase();
        const label = document.getElementById('response-category-label').value.trim();
        const icon = document.getElementById('response-category-icon').value.trim();
        const description = document.getElementById('response-category-description').value.trim();
        const defaultTemplate = document.getElementById('response-category-default').value.trim();

        if (!key || !label) {
            this.showNotification('Please fill in required fields', 'error');
            return;
        }

        // Validate category key
        if (!/^[a-z0-9_]+$/.test(key)) {
            this.showNotification('Category key can only contain lowercase letters, numbers, and underscores', 'error');
            return;
        }

        const isEdit = form.dataset.editKey;
        const categories = this.currentData.responseCategories || {};

        // Check if key already exists (only for new categories)
        if (!isEdit && categories[key]) {
            this.showNotification('A category with this key already exists', 'error');
            return;
        }

        // Save the category
        categories[key] = {
            label: label,
            icon: icon || 'fas fa-comment',
            description: description,
            defaultTemplate: defaultTemplate
        };

        this.currentData.responseCategories = categories;
        this.setUnsavedChanges(true);
        
        // Refresh the display
        this.populateResponseCategories();
        
        // Refresh the personality responses (they depend on categories)
        this.setupPersonalityResponses();
        
        // Close modal
        this.closeResponseCategoryModal();
        
        this.showNotification(`Response category "${label}" ${isEdit ? 'updated' : 'added'} successfully!`, 'success');
    }

    /**
     * Edit response category
     */
    editResponseCategory(key) {
        this.openResponseCategoryModal(key);
    }

    /**
     * Delete response category
     */
    deleteResponseCategory(key) {
        const category = this.currentData.responseCategories[key];
        if (confirm(`Are you sure you want to delete the "${category.label}" response category? This will also remove any saved responses for this category.`)) {
            delete this.currentData.responseCategories[key];
            
            // Also remove any saved responses for this category
            if (this.currentData.personalityResponses && this.currentData.personalityResponses[key]) {
                delete this.currentData.personalityResponses[key];
            }
            
            this.setUnsavedChanges(true);
            this.populateResponseCategories();
            this.setupPersonalityResponses(); // Refresh the response fields
            this.showNotification(`Response category "${category.label}" deleted successfully!`, 'success');
        }
    }

    /**
     * Populate Agent Logic tab with data
     */
    populateAgentLogicTab() {
        console.log('🧠 Populating Agent Logic tab...');
        
        // Initialize booking flow management
        this.initializeBookingFlowManagement();
        
        // Initialize agent logic notes (separate from general notes)
        this.initializeAgentLogicNotes();
        
        console.log('✅ Agent Logic tab configured');
    }

    /**
     * Initialize booking flow management
     */
    initializeBookingFlowManagement() {
        // Initialize booking flow fields
        this.bookingFlowFields = this.currentData?.bookingFlow || [];
        
        // Setup add booking field functionality
        this.setupBookingFieldManagement();
        
        // Render existing booking flow
        this.renderBookingFlowTable();
    }

    /**
     * Setup booking field management
     */
    setupBookingFieldManagement() {
        // Find add field button
        const addFieldBtn = document.querySelector('[onclick*="addBookingField"]') ||
                           document.getElementById('add-booking-field-btn');
        
        if (addFieldBtn) {
            // Remove existing onclick and add modern event listener
            addFieldBtn.removeAttribute('onclick');
            addFieldBtn.addEventListener('click', () => {
                this.addBookingField();
            });
        }

        // Setup save booking flow button
        const saveFlowBtn = document.querySelector('[onclick*="saveBookingFlow"]') ||
                           document.getElementById('save-booking-flow-btn');
        
        if (saveFlowBtn) {
            saveFlowBtn.removeAttribute('onclick');
            saveFlowBtn.addEventListener('click', () => {
                this.saveBookingFlow();
            });
        }
    }

    /**
     * Add new booking field
     */
    addBookingField() {
        const promptInput = document.getElementById('new-prompt');
        const nameInput = document.getElementById('new-name');

        if (!promptInput?.value.trim() || !nameInput?.value.trim()) {
            this.showNotification('Please fill in both prompt and field name', 'error');
            return;
        }

        const field = {
            id: Date.now(),
            prompt: promptInput.value.trim(),
            name: nameInput.value.trim(),
            order: this.bookingFlowFields.length
        };

        this.bookingFlowFields.push(field);

        // Clear inputs
        promptInput.value = '';
        nameInput.value = '';

        // Re-render table
        this.renderBookingFlowTable();
        
        this.setUnsavedChanges(true);
        this.showNotification('Booking field added successfully!', 'success');
        console.log('📋 Booking field added:', field);
    }

    /**
     * Delete booking field
     */
    deleteBookingField(fieldId) {
        if (!confirm('Are you sure you want to delete this field?')) return;

        this.bookingFlowFields = this.bookingFlowFields.filter(field => field.id !== fieldId);
        this.renderBookingFlowTable();
        
        this.setUnsavedChanges(true);
        this.showNotification('Field deleted', 'success');
        console.log('🗑️ Booking field deleted:', fieldId);
    }

    /**
     * Move booking field up or down
     */
    moveBookingField(fieldId, direction) {
        const currentIndex = this.bookingFlowFields.findIndex(field => field.id === fieldId);
        if (currentIndex === -1) return;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

        if (newIndex < 0 || newIndex >= this.bookingFlowFields.length) return;

        // Swap fields
        [this.bookingFlowFields[currentIndex], this.bookingFlowFields[newIndex]] = 
        [this.bookingFlowFields[newIndex], this.bookingFlowFields[currentIndex]];

        this.renderBookingFlowTable();
        this.setUnsavedChanges(true);
        console.log(`↕️ Booking field moved ${direction}:`, fieldId);
    }

    /**
     * Render booking flow table
     */
    renderBookingFlowTable() {
        const tbody = document.getElementById('booking-flow-body');
        if (!tbody) {
            console.warn('Booking flow table body not found');
            return;
        }

        if (this.bookingFlowFields.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center text-gray-500 py-8">
                        <div class="flex flex-col items-center">
                            <i class="fas fa-clipboard-list text-3xl mb-3 text-gray-300"></i>
                            <p>No booking fields configured yet.</p>
                            <p class="text-sm">Add your first field above to get started.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.bookingFlowFields.map((field, index) => `
            <tr class="hover:bg-gray-50">
                <td class="p-3 border border-gray-200">
                    <div class="max-w-xs">
                        <p class="text-sm text-gray-900">${this.escapeHtml(field.prompt)}</p>
                    </div>
                </td>
                <td class="p-3 border border-gray-200">
                    <code class="bg-gray-100 px-2 py-1 rounded text-sm">${this.escapeHtml(field.name)}</code>
                </td>
                <td class="p-3 border border-gray-200">
                    <div class="flex items-center space-x-2">
                        ${index > 0 ? `
                            <button onclick="companyProfileManager.moveBookingField(${field.id}, 'up')" 
                                    class="text-blue-600 hover:text-blue-800 text-sm transition-colors" 
                                    title="Move up">
                                <i class="fas fa-arrow-up"></i>
                            </button>
                        ` : '<span class="w-4"></span>'}
                        
                        ${index < this.bookingFlowFields.length - 1 ? `
                            <button onclick="companyProfileManager.moveBookingField(${field.id}, 'down')" 
                                    class="text-blue-600 hover:text-blue-800 text-sm transition-colors" 
                                    title="Move down">
                                <i class="fas fa-arrow-down"></i>
                            </button>
                        ` : '<span class="w-4"></span>'}
                        
                        <button onclick="companyProfileManager.deleteBookingField(${field.id})" 
                                class="text-red-600 hover:text-red-800 text-sm ml-2 transition-colors" 
                                title="Delete field">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        console.log(`✅ Rendered ${this.bookingFlowFields.length} booking flow fields`);
    }

    /**
     * Save booking flow
     */
    async saveBookingFlow() {
        try {
            console.log('💾 Saving booking flow...');

            // In a real implementation, this would be a separate API call
            // For now, we'll include it in the main save
            if (this.currentData) {
                this.currentData.bookingFlow = this.bookingFlowFields;
            }

            // Show saved indicator
            const savedElement = document.getElementById('booking-flow-saved');
            if (savedElement) {
                savedElement.classList.remove('hidden');
                setTimeout(() => {
                    savedElement.classList.add('hidden');
                }, 3000);
            }

            this.showNotification('Booking flow saved successfully!', 'success');
            console.log('✅ Booking flow saved:', this.bookingFlowFields);

        } catch (error) {
            console.error('❌ Error saving booking flow:', error);
            this.showNotification('Failed to save booking flow', 'error');
        }
    }

    /**
     * Initialize agent logic notes (separate from general notes)
     */
    initializeAgentLogicNotes() {
        // Agent logic notes are handled similarly to general notes
        // but stored separately for organization
        this.agentLogicNotes = this.currentData?.agentLogicNotes || [];
        
        // Notes functionality is already implemented in the notes system
        // This is just for separation of concerns
        console.log('📝 Agent logic notes initialized');
       }

    /**
     * Initialize tab system
     */
    initializeTabs() {
        // Show overview tab by default
        this.switchTab('overview');
    }

    /**
     * Switch to a specific tab
     */
    switchTab(tabName) {
        console.log(`🔄 Switching to tab: ${tabName}`);
        
        // Update current tab
        this.currentTab = tabName;

        // Update button states
        this.domElements.tabButtons.forEach(button => {
            if (button.dataset.tab === tabName) {
                button.classList.remove('tab-button-inactive');
                               button.classList.add('tab-button-active');
            } else {
                button.classList.remove('tab-button-active');
                button.classList.add('tab-button-inactive');
            }
        });

        // Update panel visibility
        this.domElements.tabPanels.forEach(panel => {
            if (panel.id === `${tabName}-content`) {
                panel.style.display = 'block';
                panel.classList.remove('hidden');
            } else {
                panel.style.display = 'none';
                panel.classList.add('hidden');
            }
        });

        // Handle lazy loading for specific tabs
        if (tabName === 'personality-responses') {
            this.ensurePersonalityTabLoaded();
        }
        
        // Ensure webhook toggle is properly set up when configuration tab is accessed
        if (tabName === 'config') {
            // Delay setup to ensure DOM elements are ready
            setTimeout(() => {
                this.setupWebhookToggle();
                // Also add a debug function to window for manual testing
                window.debugWebhookToggle = () => {
                    console.log('🐛 Debug webhook toggle called');
                    this.setupWebhookToggle();
                    
                    // Try to click the button programmatically for testing
                    const btn = document.getElementById('toggleWebhookInfo');
                    if (btn) {
                        console.log('🐛 Found button, attempting click');
                        btn.click();
                    } else {
                        console.log('🐛 Button not found');
                    }
                };
            }, 100);
        }
    }

    /**
     * Ensure personality tab is properly loaded when accessed
     */
    ensurePersonalityTabLoaded() {
        const container = document.getElementById('personality-responses-list');
        if (container && container.children.length === 0) {
            console.log('🎭 Lazy loading personality responses...');
            this.setupPlaceholderManagement();
            this.setupPersonalityResponses();
        }
    }

    /**
     * Save all changes to the backend
     */
    async saveAllChanges(showNotification = true) {
        if (!this.companyId) {
            console.error('❌ No company ID available for saving');
            this.showNotification('No company ID found', 'error');
            return;
        }

        console.log('💾 Starting saveAllChanges for company ID:', this.companyId);

        try {
            // Collect data from all tabs
            console.log('💾 Collecting form data from all tabs...');
            const updateData = this.collectAllFormData();
            
            console.log('💾 Collected update data:', JSON.stringify(updateData, null, 2));
            
            if (Object.keys(updateData).length === 0) {
                console.warn('⚠️ No data collected to save');
                this.showNotification('No changes to save', 'warning');
                return;
            }

            console.log('💾 Sending PATCH request...');
            this.showLoading(true);
            
            const url = `${this.apiBaseUrl}/api/company/${this.companyId}`;
            console.log('💾 Request URL:', url);

            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });

            console.log('💾 Response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Save failed with response:', errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }

            const savedData = await response.json();
            console.log('✅ Changes saved successfully:', savedData);

            // Update current data with the saved response
            this.currentData = { ...this.currentData, ...savedData };
            this.setUnsavedChanges(false);
            
            // Refresh the display with updated data
            this.populateOverviewTab();
            
            // Notify directory page to refresh (if open in another tab)
            try {
                localStorage.setItem('companyProfileUpdated', Date.now().toString());
                console.log('📢 Directory refresh signal sent');
            } catch (e) {
                console.warn('Could not send directory refresh signal:', e);
            }
            
            if (showNotification) {
                this.showNotification('All changes saved successfully!', 'success');
            }

        } catch (error) {
            console.error('❌ Failed to save changes:', error);
            this.showNotification('Failed to save changes', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Collect form data from all tabs
     */
    collectAllFormData() {
        const data = {};

        // Overview tab data
        this.collectOverviewData(data);
        
        // Configuration tab data
        this.collectConfigData(data);
        
        // Notes tab data
        this.collectNotesData(data);
        
        // Calendar tab data
        this.collectCalendarData(data);

        // AI Settings tab data
        this.collectAISettingsData(data);
        
        // Voice tab data
        this.collectVoiceData(data);
        
        // Personality tab data
        this.collectPersonalityData(data);
        
        // // // // Agent Logic tab data
        this.collectAgentLogicData(data);

        console.log('📤 Collected form data:', data);
        return data;
    }

    /**
     * Collect Overview tab data
     */
    collectOverviewData(data) {
        const fields = {
            'edit-company-name': 'companyName',
            'edit-business-phone': 'businessPhone',
            'edit-business-email': 'businessEmail',
            'edit-business-website': 'businessWebsite',
            'edit-business-address': 'businessAddress',
            'edit-description': 'description',
            'edit-service-area': 'serviceArea',
            'edit-business-hours': 'businessHours'
        };

        Object.entries(fields).forEach(([inputId, dataKey]) => {
            const input = document.getElementById(inputId);
            if (input) {
                // Always include the field, even if empty (to allow clearing values)
                data[dataKey] = input.value.trim();
                
                // For backward compatibility with simplified workflow,
                // also set the corresponding company* field if it's phone or address
                if (dataKey === 'businessPhone') {
                    data['companyPhone'] = input.value.trim();
                } else if (dataKey === 'businessAddress') {
                    data['companyAddress'] = input.value.trim();
                }
            }
        });

        this.collectContactsData(data);
    }

    /**
     * Collect Configuration tab data
     */
    collectConfigData(data) {
        console.log('🔧 Starting collectConfigData...');
        
        // Twilio credentials
        const twilioSid = document.getElementById('twilioAccountSid');
        const twilioToken = document.getElementById('twilioAuthToken');
        const twilioApiKey = document.getElementById('twilioApiKey');
        const twilioApiSecret = document.getElementById('twilioApiSecret');
        
        console.log('🔧 Found Twilio elements:', {
            twilioSid: !!twilioSid,
            twilioToken: !!twilioToken,
            twilioApiKey: !!twilioApiKey,
            twilioApiSecret: !!twilioApiSecret
        });
        
        // Initialize twilioConfig object if it doesn't exist
        if (!data.twilioConfig) {
            data.twilioConfig = {};
        }
        
        if (twilioSid?.value.trim()) {
            data.twilioConfig.accountSid = twilioSid.value.trim();
            console.log('🔧 Set accountSid:', data.twilioConfig.accountSid);
        }
        
        if (twilioToken?.value.trim() && twilioToken.value !== '••••••••••••••••') {
            data.twilioConfig.authToken = twilioToken.value.trim();
            console.log('🔧 Set authToken:', '***masked***');
        }
        
        if (twilioApiKey?.value.trim()) {
            data.twilioConfig.apiKey = twilioApiKey.value.trim();
            console.log('🔧 Set apiKey:', data.twilioConfig.apiKey);
        }
        
        if (twilioApiSecret?.value.trim() && twilioApiSecret.value !== '••••••••••••••••') {
            data.twilioConfig.apiSecret = twilioApiSecret.value.trim();
            console.log('🔧 Set apiSecret:', '***masked***');
        }

        // ElevenLabs credentials
        const elevenLabsApiKey = document.getElementById('elevenLabsApiKey');
        const elevenLabsVoiceId = document.getElementById('elevenLabsVoiceId');
        
        if (elevenLabsApiKey?.value.trim() && elevenLabsApiKey.value !== '••••••••••••••••') {
            data.elevenLabsApiKey = elevenLabsApiKey.value.trim();
            console.log('🔧 Set elevenLabsApiKey:', '***masked***');
        }
        
        if (elevenLabsVoiceId?.value.trim()) {
            data.elevenLabsVoiceId = elevenLabsVoiceId.value.trim();
            console.log('🔧 Set elevenLabsVoiceId:', data.elevenLabsVoiceId);
        }

        // Phone numbers - save to twilioConfig.phoneNumbers
        const phoneNumbers = [];
        const phoneNumberItems = document.querySelectorAll('.phone-number-item');
        
        console.log('🔧 Found phone number items:', phoneNumberItems.length);
        
        phoneNumberItems.forEach((item, index) => {
            const phoneInput = item.querySelector('input[name="phoneNumber"]');
            const friendlyInput = item.querySelector('input[name="friendlyName"]');
            const statusSelect = item.querySelector('select[name="status"]');
            const isPrimaryBtn = item.querySelector('button[title="Set as Primary"]');
            
            console.log(`🔧 Phone item ${index}:`, {
                phoneValue: phoneInput?.value,
                friendlyValue: friendlyInput?.value,
                statusValue: statusSelect?.value,
                isPrimary: isPrimaryBtn?.textContent
            });
            
            if (phoneInput?.value.trim()) {
                const isPrimary = isPrimaryBtn?.textContent === 'Primary';
                
                const phoneData = {
                    phoneNumber: phoneInput.value.trim(),
                    friendlyName: friendlyInput?.value.trim() || '',
                    status: statusSelect?.value || 'active',
                    isPrimary: isPrimary || index === 0 // First one is primary by default
                };
                
                phoneNumbers.push(phoneData);
                console.log(`🔧 Added phone number ${index}:`, phoneData);
            }
        });
        
        if (phoneNumbers.length > 0) {
            data.twilioConfig.phoneNumbers = phoneNumbers;
            console.log('🔧 Set phoneNumbers:', phoneNumbers.length, 'items');
        }

        console.log('📋 Configuration data collected:', JSON.stringify(data, null, 2));
    }

    /**
     * Collect Notes tab data
     */
    collectNotesData(data) {
        if (this.notes && this.notes.length > 0) {
            data.notes = this.notes;
        }
    }

    /**
     * Collect Calendar tab data
     */
    collectCalendarData(data) {
        // Timezone
        const timezoneSelect = document.getElementById('timezone');
        if (timezoneSelect?.value) {
            data.timezone = timezoneSelect.value;
        }

        // Operating hours
        const operatingHours = [];
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        days.forEach(day => {
            const enabledCheckbox = document.getElementById(`${day}-enabled`);
            const startInput = document.getElementById(`${day}-start`);
            const endInput = document.getElementById(`${day}-end`);

            operatingHours.push({
                day: day,
                enabled: enabledCheckbox?.checked || false,
                start: startInput?.value || '09:00',
                end: endInput?.value || '17:00'
            });
        });

        data.operatingHours = operatingHours;
    }

    /**
     * Collect AI Settings tab data
     */
    collectAISettingsData(data) {
        const aiSettings = {};
        
        const aiModelSelect = document.getElementById('ai-model');
        const personalitySelect = document.getElementById('ai-personality');
        const ttsProviderSelect = document.getElementById('tts-provider');
        
        if (aiModelSelect?.value) aiSettings.model = aiModelSelect.value;
        if (personalitySelect?.value) aiSettings.personality = personalitySelect.value;
        if (ttsProviderSelect?.value) aiSettings.ttsProvider = ttsProviderSelect.value;
        
        if (Object.keys(aiSettings).length > 0) {
            data.aiSettings = { ...data.aiSettings, ...aiSettings };
        }
    }

    /**
     * Collect Voice tab data
     */
    collectVoiceData(data) {
        const apiKeyInput = document.getElementById('elevenlabsApiKey');
        const voiceSelect = document.getElementById('elevenlabsVoice');
        
        if (apiKeyInput?.value && !apiKeyInput.value.includes('••••')) {
            // Save to both locations for consistency
            data.elevenLabsApiKey = apiKeyInput.value;
            data.aiSettings = data.aiSettings || {};
            data.aiSettings.elevenLabs = data.aiSettings.elevenLabs || {};
            data.aiSettings.elevenLabs.apiKey = apiKeyInput.value;
        }
        
        if (voiceSelect?.value) {
            // Save to both locations for consistency
            data.elevenLabsVoiceId = voiceSelect.value;
            data.aiSettings = data.aiSettings || {};
            data.aiSettings.elevenLabs = data.aiSettings.elevenLabs || {};
            data.aiSettings.elevenLabs.voiceId = voiceSelect.value;
        }
    }

    /**
     * Collect Personality tab data
     */
    collectPersonalityData(data) {
        const responses = {};
        const responseCategories = this.currentData?.responseCategories || this.getDefaultResponseCategories();

        // Collect responses based on current response categories
        Object.keys(responseCategories).forEach(field => {
            const input = document.getElementById(`personality-${field}`);
            if (input?.value.trim()) {
                responses[field] = input.value.trim();
            }
        });

        if (Object.keys(responses).length > 0) {
            data.personalityResponses = responses;
        }

        // Include response categories if they exist
        if (this.currentData?.responseCategories && Object.keys(this.currentData.responseCategories).length > 0) {
            data.responseCategories = this.currentData.responseCategories;
        }

        // Include placeholders if they exist
        if (this.currentData?.placeholders && Object.keys(this.currentData.placeholders).length > 0) {
            data.placeholders = this.currentData.placeholders;
        }
    }

    /**
     * Collect Agent Logic tab data
     */
    collectAgentLogicData(data) {
        if (this.bookingFlowFields && this.bookingFlowFields.length > 0) {
            data.bookingFlow = this.bookingFlowFields;
        }
        
        if (this.agentLogicNotes && this.agentLogicNotes.length > 0) {
            data.agentLogicNotes = this.agentLogicNotes;
        }
    }

    /**
     * Show loading state
     */
    showLoading(show) {
        if (this.domElements.loadingIndicator) {
            this.domElements.loadingIndicator.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * Show notification to user
     */
    showNotification(message, type = 'info') {
        console.log(`📢 ${type.toUpperCase()}: ${message}`);
        
        // Create or update notification element
        let notification = document.getElementById('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.className = 'fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 transition-all duration-300';
            document.body.appendChild(notification);
        }

        // Set styles based on type
        const typeStyles = {
            success: 'bg-green-500 text-white',
            error: 'bg-red-500 text-white',
            warning: 'bg-yellow-500 text-black',
            info: 'bg-blue-500 text-white'
        };

        notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 transition-all duration-300 ${typeStyles[type]}`;
        notification.textContent = message;
        notification.style.display = 'block';

        // Auto-hide after 5 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                notification.style.display = 'none';
                notification.style.opacity = '1';
            }, 300);
        }, 5000);
    }

    /**
     * Update header elements and remove loading placeholders
     */
    updateHeaderElements() {
        // Update main header
        const companyNameHeader = document.getElementById('company-name-header');
        if (companyNameHeader) {
            companyNameHeader.textContent = this.currentData.companyName || this.currentData.name || 'Company Profile';
        }

        // Update company ID subheader
        const companyIdSubheader = document.getElementById('company-id-subheader');
        if (companyIdSubheader) {
            companyIdSubheader.textContent = `ID: ${this.companyId}`;
        }

        console.log('✅ Header elements updated');
    }

    /**
     * Setup personality response fields based on response categories
     */
    setupPersonalityResponses() {
        const responseFields = this.currentData?.responseCategories || this.getDefaultResponseCategories();
        const responses = this.currentData?.personalityResponses || {};
        const container = document.getElementById('personality-responses-list');
        
        if (!container) {
            console.warn('❌ Personality responses container not found');
            return;
        }

        // Clear existing content
        container.innerHTML = '';

        // Build form fields based on response categories
        Object.entries(responseFields).forEach(([key, field]) => {
            const fieldContainer = document.createElement('div');
            fieldContainer.className = 'bg-white border border-gray-200 rounded-lg p-6 shadow-sm';

            // Get array of responses for this category
            const currentValues = Array.isArray(responses[key]) ? responses[key] : (responses[key] ? [responses[key]] : []);
            const defaultValue = field.defaultTemplate || this.getDefaultPersonalityResponse(key);

            // Build dynamic response list
            let responseListHtml = '';
            (currentValues.length ? currentValues : [defaultValue]).forEach((val, idx) => {
                responseListHtml += `
                    <div class="flex items-center mb-2 response-row">
                        <textarea
                            class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm response-textarea"
                            rows="2"
                            data-category="${key}"
                            data-index="${idx}"
                            placeholder="${defaultValue}"
                        >${val}</textarea>
                        <button type="button" class="ml-2 text-red-600 hover:text-red-800 remove-response-btn" data-category="${key}" data-index="${idx}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            });

            fieldContainer.innerHTML = `
                <div class="flex items-start space-x-4">
                    <div class="flex-shrink-0">
                        <div class="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                            <i class="${field.icon || 'fas fa-comment'} text-indigo-600"></i>
                        </div>
                    </div>
                    <div class="flex-1">
                        <label class="block text-sm font-medium text-gray-900 mb-1">
                            ${field.label}
                        </label>
                        <p class="text-sm text-gray-600 mb-3">${field.description}</p>
                        <div class="response-list" data-category="${key}">
                            ${responseListHtml}
                        </div>
                        <button type="button" class="mt-2 text-xs text-indigo-600 hover:text-indigo-800 add-response-btn" data-category="${key}">
                            <i class="fas fa-plus mr-1"></i>Add Response
                        </button>
                    </div>
                </div>
            `;

            container.appendChild(fieldContainer);
        });

        // Event delegation for add/remove
        container.addEventListener('click', (e) => {
            if (e.target.closest('.add-response-btn')) {
                const key = e.target.closest('.add-response-btn').dataset.category;
                const list = container.querySelector(`.response-list[data-category="${key}"]`);
                if (list) {
                    const idx = list.querySelectorAll('.response-row').length;
                    const defaultValue = responseFields[key].defaultTemplate || this.getDefaultPersonalityResponse(key);
                    const div = document.createElement('div');
                    div.className = 'flex items-center mb-2 response-row';
                    div.innerHTML = `
                        <textarea class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm response-textarea" rows="2" data-category="${key}" data-index="${idx}" placeholder="${defaultValue}"></textarea>
                        <button type="button" class="ml-2 text-red-600 hover:text-red-800 remove-response-btn" data-category="${key}" data-index="${idx}"><i class="fas fa-trash"></i></button>
                    `;
                    list.appendChild(div);
                    this.setUnsavedChanges(true);
                }
            } else if (e.target.closest('.remove-response-btn')) {
                const btn = e.target.closest('.remove-response-btn');
                const key = btn.dataset.category;
                const idx = parseInt(btn.dataset.index, 10);
                const list = container.querySelector(`.response-list[data-category="${key}"]`);
                if (list) {
                    const rows = list.querySelectorAll('.response-row');
                    if (rows[idx]) {
                        rows[idx].remove();
                        this.setUnsavedChanges(true);
                    }
                }
            }
        });

        // Track changes in textareas
        container.addEventListener('input', (e) => {
            if (e.target.classList.contains('response-textarea')) {
                this.setUnsavedChanges(true);
            }
        });

        console.log('✅ Personality response fields (multi-response) created');
    }

    /**
     * Save personality responses (multi-response per category)
     */
    async savePersonalityResponses() {
        try {
            console.log('💾 Saving personality responses...');
            const responses = {};
            const responseFields = this.currentData?.responseCategories || this.getDefaultResponseCategories();
            Object.keys(responseFields).forEach(field => {
                const list = document.querySelector(`.response-list[data-category="${field}"]`);
                if (list) {
                    const values = Array.from(list.querySelectorAll('.response-textarea'))
                        .map(t => t.value.trim())
                        .filter(Boolean);
                    if (values.length) responses[field] = values;
                }
            });
            if (this.currentData) {
                this.currentData.personalityResponses = responses;
            }
            await this.saveAllChanges(false);
            this.showNotification('Personality responses saved successfully!', 'success');
            console.log('✅ Personality responses saved:', responses);
        } catch (error) {
            console.error('❌ Error saving personality responses:', error);
            this.showNotification('Failed to save personality responses', 'error');
        }
    }

    /**
     * Render dynamic company contacts section
     */
    renderContactsSection() {
        const contacts = Array.isArray(this.currentData.contacts) ? this.currentData.contacts : [];
        const contactsList = document.getElementById('contacts-list');
        if (!contactsList) return;
        contactsList.innerHTML = '';
        contacts.forEach((contact, cIdx) => {
            const contactDiv = document.createElement('div');
            contactDiv.className = 'border border-gray-200 rounded-lg p-4 bg-gray-50';
            contactDiv.innerHTML = `
                <div class="flex flex-col md:flex-row md:items-center md:space-x-6">
                    <div class="flex-1">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                            <div>
                                <label class="form-label">Name</label>
                                <input type="text" class="form-input contact-name" value="${contact.name || ''}" data-cidx="${cIdx}" placeholder="Contact Name">
                            </div>
                            <div>
                                <label class="form-label">Role</label>
                                <input type="text" class="form-input contact-role" value="${contact.role || ''}" data-cidx="${cIdx}" placeholder="Role (e.g. Customer Service)">
                            </div>
                        </div>
                        <div class="mb-2">
                            <label class="form-label">Phone Numbers</label>
                            <div class="space-y-2" id="contact-phones-${cIdx}">
                                ${(contact.phones||[]).map((phone, pIdx) => `
                                    <div class="flex items-center mb-1 phone-row">
                                        <select class="form-select phone-type" data-cidx="${cIdx}" data-pidx="${pIdx}">
                                            <option value="cell" ${phone.type==='cell'?'selected':''}>Cell</option>
                                            <option value="office" ${phone.type==='office'?'selected':''}>Office</option>
                                            <option value="landline" ${phone.type==='landline'?'selected':''}>Landline</option>
                                            <option value="other" ${phone.type==='other'?'selected':''}>Other</option>
                                        </select>
                                        <input type="tel" class="form-input ml-2 phone-value" value="${phone.value||''}" data-cidx="${cIdx}" data-pidx="${pIdx}" placeholder="Phone Number">
                                        <button type="button" class="ml-2 text-red-600 hover:text-red-800 remove-phone-btn" data-cidx="${cIdx}" data-pidx="${pIdx}"><i class="fas fa-trash"></i></button>
                                    </div>
                                `).join('')}
                            </div>
                            <button type="button" class="mt-2 text-xs text-indigo-600 hover:text-indigo-800 add-phone-btn" data-cidx="${cIdx}"><i class="fas fa-plus mr-1"></i>Add Phone</button>
                        </div>
                        <div class="mb-2">
                            <label class="form-label">Notes</label>
                            <textarea class="form-textarea wider-textbox contact-notes" data-cidx="${cIdx}" rows="2" placeholder="Special notes about this contact...">${contact.notes||''}</textarea>
                        </div>
                    </div>
                    <div class="flex flex-col items-end justify-between ml-0 md:ml-4 mt-4 md:mt-0">
                        <button type="button" class="text-red-600 hover:text-red-800 remove-contact-btn" data-cidx="${cIdx}"><i class="fas fa-trash mr-1"></i>Remove Contact</button>
                    </div>
                </div>
            `;
            contactsList.appendChild(contactDiv);
        });
    }

    /**
     * Setup dynamic contacts event handlers
     */
    setupContactsHandlers() {
        const contactsList = document.getElementById('contacts-list');
        const addContactBtn = document.getElementById('add-contact-btn');
        if (!contactsList || !addContactBtn) return;
        // Add contact
        addContactBtn.onclick = () => {
            if (!Array.isArray(this.currentData.contacts)) this.currentData.contacts = [];
            this.currentData.contacts.push({ name: '', role: '', phones: [], notes: '' });
            this.renderContactsSection();
            this.setUnsavedChanges(true);
        };
        // Delegate events for add/remove phone and remove contact
        contactsList.onclick = (e) => {
            const addPhoneBtn = e.target.closest('.add-phone-btn');
            const removePhoneBtn = e.target.closest('.remove-phone-btn');
            const removeContactBtn = e.target.closest('.remove-contact-btn');
            if (addPhoneBtn) {
                const cidx = parseInt(addPhoneBtn.dataset.cidx, 10);
                if (Array.isArray(this.currentData.contacts[cidx].phones)) {
                    this.currentData.contacts[cidx].phones.push({ type: 'cell', value: '' });
                } else {
                    this.currentData.contacts[cidx].phones = [{ type: 'cell', value: '' }];
                }
                this.renderContactsSection();
                this.setUnsavedChanges(true);
            } else if (removePhoneBtn) {
                const cidx = parseInt(removePhoneBtn.dataset.cidx, 10);
                const pidx = parseInt(removePhoneBtn.dataset.pidx, 10);
                if (Array.isArray(this.currentData.contacts[cidx].phones)) {
                    this.currentData.contacts[cidx].phones.splice(pidx, 1);
                }
                this.renderContactsSection();
                this.setUnsavedChanges(true);
            } else if (removeContactBtn) {
                const cidx = parseInt(removeContactBtn.dataset.cidx, 10);
                this.currentData.contacts.splice(cidx, 1);
                this.renderContactsSection();
                this.setUnsavedChanges(true);
            }
        };
        // Delegate input changes
        contactsList.oninput = (e) => {
            const nameInput = e.target.classList.contains('contact-name');
            const roleInput = e.target.classList.contains('contact-role');
            const notesInput = e.target.classList.contains('contact-notes');
            const phoneType = e.target.classList.contains('phone-type');
            const phoneValue = e.target.classList.contains('phone-value');
            if (nameInput || roleInput || notesInput || phoneType || phoneValue) {
                const cidx = parseInt(e.target.dataset.cidx, 10);
                if (nameInput) this.currentData.contacts[cidx].name = e.target.value;
                if (roleInput) this.currentData.contacts[cidx].role = e.target.value;
                if (notesInput) this.currentData.contacts[cidx].notes = e.target.value;
                if (phoneType || phoneValue) {
                    const pidx = parseInt(e.target.dataset.pidx, 10);
                    if (phoneType) this.currentData.contacts[cidx].phones[pidx].type = e.target.value;
                    if (phoneValue) this.currentData.contacts[cidx].phones[pidx].value = e.target.value;
                }
                this.setUnsavedChanges(true);
            }
        };
    }

    /**
     * Collect contacts data for saving
     */
    collectContactsData(data) {
        // Collect additional contacts from the UI
        const contactsContainer = document.querySelector('#additionalContactsContainer');
        if (contactsContainer) {
            const contacts = [];
            const contactRows = contactsContainer.querySelectorAll('.contact-row');
            
            contactRows.forEach(row => {
                const nameInput = row.querySelector('input[placeholder="Contact Name"]');
                const roleInput = row.querySelector('input[placeholder="Role/Title"]');
                const emailInput = row.querySelector('input[placeholder="Email"]');
                const phoneInput = row.querySelector('input[placeholder="Phone"]');
                
                if (nameInput && nameInput.value.trim()) {
                    contacts.push({
                        name: nameInput.value.trim(),
                        role: roleInput ? roleInput.value.trim() : '',
                        email: emailInput ? emailInput.value.trim() : '',
                        phone: phoneInput ? phoneInput.value.trim() : ''
                    });
                }
            });
            
            data.additionalContacts = contacts;
        }

        // Legacy contacts support
        if (Array.isArray(this.currentData.contacts)) {
            // Deep copy to avoid mutation
            data.contacts = JSON.parse(JSON.stringify(this.currentData.contacts));
        }
    }

    /**
     * Initialize all sections and tabs
     */
    initializeAll() {
        this.renderContactsSection();
        this.setupContactsHandlers();
    }

    /**
     * Generate dynamic webhook panel with company-specific URLs
     */
    generateWebhookPanel() {
        const webhookPanel = document.getElementById('webhookInfoPanel');
        if (!webhookPanel) {
            console.error('❌ Webhook panel not found');
            return;
        }
        
        if (!this.companyId) {
            console.error('❌ Company ID not available');
            webhookPanel.innerHTML = `
                <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p class="text-red-800 text-sm">⚠️ Company ID not found. Please refresh the page.</p>
                </div>
            `;
            return;
        }

        const baseUrl = this.apiBaseUrl || 'https://clientsvia-backend.onrender.com';
        console.log('🔧 Generating webhooks for company:', this.companyId, 'Base URL:', baseUrl);
        
        // Define webhooks with companyId parameter
        const webhooks = [
            {
                title: '🎤 Voice Webhook (Primary)',
                url: `${baseUrl}/api/twilio/voice?companyId=${this.companyId}`,
                description: 'Configure this in Twilio Console → Phone Numbers → Voice Configuration',
                primary: true
            },
            {
                title: '🗣️ Speech Recognition',
                url: `${baseUrl}/api/twilio/handle-speech?companyId=${this.companyId}`,
                description: 'Used internally for AI speech processing',
                primary: true
            },
            {
                title: '📞 Partial Speech',
                url: `${baseUrl}/api/twilio/partial-speech?companyId=${this.companyId}`,
                description: 'For real-time speech processing',
                primary: false
            },
            {
                title: '⏱️ Speech Timing Test',
                url: `${baseUrl}/api/twilio/speech-timing-test?companyId=${this.companyId}`,
                description: 'For performance testing and optimization',
                primary: false
            }
        ];

        webhookPanel.innerHTML = `
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
                <div class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
                    <h5 class="text-sm font-medium text-blue-900 mb-1">🏢 Company: ${this.currentData?.companyName || 'Unknown'}</h5>
                    <p class="text-xs text-blue-700">Company ID: <code class="bg-white px-1 rounded">${this.companyId}</code></p>
                </div>
                
                ${webhooks.map(webhook => `
                    <div class="webhook-item">
                        <div class="flex justify-between items-center mb-2">
                            <h4 class="text-sm font-medium text-gray-900">${webhook.title}</h4>
                            <button type="button" class="copy-webhook-btn text-xs ${webhook.primary ? 'bg-blue-100 hover:bg-blue-200 text-blue-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'} px-2 py-1 rounded" data-webhook="${webhook.url}">
                                <i class="fas fa-copy mr-1"></i>Copy
                            </button>
                        </div>
                        <div class="bg-white border rounded p-2 font-mono text-sm text-gray-800 break-all">
                            ${webhook.url}
                        </div>
                        <p class="text-xs text-gray-600 mt-1">${webhook.description}</p>
                    </div>
                `).join('')}
                
                <!-- Configuration Instructions -->
                <div class="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                    <h5 class="text-sm font-medium text-blue-900 mb-2">📋 Quick Setup Instructions:</h5>
                    <ol class="text-xs text-blue-800 space-y-1">
                        <li>1. Go to <a href="https://console.twilio.com" target="_blank" class="underline hover:no-underline">Twilio Console</a></li>
                        <li>2. Navigate to Phone Numbers → Manage → Active Numbers</li>
                        <li>3. Click on your phone number</li>
                        <li>4. Set Voice Configuration webhook to the <strong>Voice Webhook URL</strong> above</li>
                        <li>5. Set HTTP method to <strong>POST</strong></li>
                        <li>6. Save configuration</li>
                        <li>7. Test by calling your number - the AI agent will respond with company-specific data</li>
                    </ol>
                </div>
            </div>
        `;

        // Re-setup copy functionality for dynamically generated buttons
        this.setupWebhookCopyButtons();
    }

    /**
     * Setup copy functionality for webhook buttons
     */
    setupWebhookCopyButtons() {
        const copyButtons = document.querySelectorAll('.copy-webhook-btn');
        copyButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const webhookUrl = btn.dataset.webhook;
                if (webhookUrl) {
                    try {
                        await navigator.clipboard.writeText(webhookUrl);
                        const originalText = btn.innerHTML;
                        btn.innerHTML = '<i class="fas fa-check mr-1"></i>Copied!';
                        btn.classList.add('bg-green-100', 'text-green-700');
                        btn.classList.remove('bg-blue-100', 'text-blue-700', 'bg-gray-100', 'text-gray-600');
                        
                        setTimeout(() => {
                            btn.innerHTML = originalText;
                            btn.classList.remove('bg-green-100', 'text-green-700');
                            // Restore original colors based on webhook type
                            if (webhookUrl.includes('voice') || webhookUrl.includes('speech')) {
                                btn.classList.add('bg-blue-100', 'text-blue-700');
                            } else {
                                btn.classList.add('bg-gray-100', 'text-gray-600');
                            }
                        }, 2000);
                    } catch (err) {
                        console.error('Failed to copy webhook URL:', err);
                        this.showNotification('Failed to copy webhook URL', 'error');
                    }
                }
            });
        });
    }
}

// =============================================
// INITIALIZATION
// =============================================

// Global instance
let companyProfileManager = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        companyProfileManager = new CompanyProfileManager();
        await companyProfileManager.init();
        
        // Add global debug functions for testing
        window.debugCompanyProfile = companyProfileManager;
        window.testWebhookButton = () => {
            console.log('🧪 Testing webhook button...');
            if (companyProfileManager) {
                companyProfileManager.setupWebhookToggle();
                const btn = document.getElementById('toggleWebhookInfo');
                const panel = document.getElementById('webhookInfoPanel');
                console.log('Button found:', !!btn);
                console.log('Panel found:', !!panel);
                if (btn) {
                    console.log('Button text:', btn.innerHTML);
                    console.log('Button dataset:', btn.dataset);
                }
                if (panel) {
                    console.log('Panel classes:', panel.className);
                }
            }
        };
        
    } catch (error) {
        console.error('❌ Failed to initialize company profile:', error);
    }
});

// Export for global access
window.CompanyProfileManager = CompanyProfileManager;
window.companyProfileManager = companyProfileManager;
