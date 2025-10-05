console.log('🚀 Loading company-profile-modern.js v2.20 - Fixed company ID display in header subheader');

/* ============================================================================
   MODERN COMPANY PROFILE MANAGEMENT SYSTEM
   ============================================================================
   
   📋 FILE ORGANIZATION:
   ├── 🏗️  CLASS DEFINITION & CORE ARCHITECTURE
   ├── 🚀  INITIALIZATION & SETUP METHODS  
   ├── 🔍  COMPANY ID & URL MANAGEMENT
   ├── 🎯  DOM MANAGEMENT & VALIDATION
   ├── 📡  EVENT HANDLING SYSTEM
   ├── 🗂️  TAB MANAGEMENT SYSTEM
   ├── 💾  DATA LOADING & PROCESSING
   ├── 📋  OVERVIEW TAB - COMPANY DETAILS
   ├── 👥  CONTACTS TAB - CONTACT MANAGEMENT
   ├── ⚙️  CONFIGURATION TAB - SETTINGS
   ├── 📞  PHONE NUMBERS MANAGEMENT
   ├── 🔧  UTILITY FUNCTIONS & HELPERS
   ├── 🌐  GLOBAL FUNCTION EXPOSURE
   └── 🚀  INITIALIZATION & EXPORTS
   
   Architecture:
   - Class-based modular design
   - Centralized state management  
   - Robust error handling
   - Modern ES6+ features
   - Clean separation of concerns
   - Multi-tenant company isolation
   
   ============================================================================ */

/* ============================================================================
   🏗️ CLASS DEFINITION & CORE ARCHITECTURE
   ============================================================================ */

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
    }

    /* ========================================================================
       🚀 INITIALIZATION & SETUP METHODS
       ======================================================================== */

    /**
     * Initialize the company profile system
     */
    async init() {
        try {
            // 🔧 [FIXED] - Initialization Guard (Micro-Surgery #2)
            if (this.initialized) {
                console.log('🛡️ Company Profile Manager already initialized, skipping...');
                return;
            }
            
            console.log('🚀 Initializing Company Profile Manager...');
            this.initialized = true;
            
            // Extract company ID from URL
            this.extractCompanyId();
            
            if (!this.companyId) {
                throw new Error('No company ID found in URL');
            }

            // Initialize DOM elements and event listeners
            this.initializeDOM();
            this.setupEventListeners();
            // 🗑️ REMOVED: this.createSaveButton(); - Using dedicated section-specific save buttons instead
            
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

    /* ========================================================================
       🔍 COMPANY ID & URL MANAGEMENT
       ======================================================================== */

    /**
     * Extract company ID from URL parameters
     */
    extractCompanyId() {
        // First check if company ID was already set by HTML initialization
        if (window.companyId) {
            this.companyId = window.companyId;
            console.log('🔍 Using company ID from global window:', this.companyId);
        } else {
            // Fallback: extract from URL directly
            const urlParams = new URLSearchParams(window.location.search);
            this.companyId = urlParams.get('id');
            console.log('🔍 Extracted company ID from URL:', this.companyId);
            
            // 🛡️ SAFEGUARD: Store company ID in localStorage to prevent loss
            if (this.companyId) {
                localStorage.setItem('lastCompanyId', this.companyId);
            }
        }
        
        // 🔄 RECOVERY: Try to recover from localStorage if URL lost the ID
        if (!this.companyId) {
            const savedId = localStorage.getItem('lastCompanyId');
            if (savedId && savedId !== 'test123') {
                this.companyId = savedId;
                console.warn('⚠️ Company ID lost from URL, recovered from localStorage:', this.companyId);
                // 🔧 FIX URL: Restore the ID parameter
                const newUrl = `${window.location.pathname}?id=${this.companyId}`;
                window.history.replaceState({}, '', newUrl);
                console.log('✅ URL restored:', newUrl);
            } else {
                this.companyId = 'test123';
                console.warn('⚠️ No company ID found in URL or localStorage, using test ID:', this.companyId);
            }
        }
        
        // Set global references for legacy compatibility
        window.currentCompanyId = this.companyId;
        window.companyId = this.companyId;
        
        console.log('🔍 Final company ID set:', this.companyId);
    }

    /* ========================================================================
       🎯 DOM MANAGEMENT & VALIDATION
       ======================================================================== */

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
        const requiredElements = ['editFormContainer'];
        const optionalElements = ['editButton']; // Non-critical elements
        
        const missing = requiredElements.filter(key => !this.domElements[key]);
        const missingOptional = optionalElements.filter(key => !this.domElements[key]);
        
        if (missing.length > 0) {
            console.warn('⚠️ Missing required DOM elements:', missing);
        }
        
        if (missingOptional.length > 0) {
            console.log('ℹ️ Optional DOM elements not found (this is normal):', missingOptional);
        }
    }

    /* ========================================================================
       📡 EVENT HANDLING SYSTEM
       ======================================================================== */

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // Form change tracking
        document.addEventListener('input', (event) => this.handleFormChange(event));
        document.addEventListener('change', (event) => this.handleFormChange(event));
        
        // Before unload warning
        window.addEventListener('beforeunload', (event) => this.handleBeforeUnload(event));
        
        // Tab switching
        this.domElements.tabButtons.forEach(button => {
            button.addEventListener('click', (event) => this.handleTabSwitch(event));
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
            // 🛡️ SAFEGUARD: Skip unsaved warning for elements marked with data-no-unsaved-warning
            if (event.target.hasAttribute('data-no-unsaved-warning') || 
                event.target.closest('[data-no-unsaved-warning]')) {
                console.log('📝 Change detected (no warning):', event.target.name || event.target.id);
                return; // Don't trigger unsaved changes warning
            }
            
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
     * Set unsaved changes state - SIMPLIFIED (no floating button)
     */
    setUnsavedChanges(hasChanges) {
        this.hasUnsavedChanges = hasChanges;
        console.log('📝 Unsaved changes state set to:', hasChanges);
    }

    /**
     * Create floating save button - DISABLED (using dedicated tab-specific save buttons instead)
     */
    createSaveButton() {
        console.log('⚠️ Floating save button creation disabled - using dedicated tab-specific save buttons');
        // Floating save button removed to prevent UI state conflicts
        return;
    }

    /**
     * Show save button with animation - DISABLED
     */
    showSaveButton() {
        console.log('⚠️ Floating save button disabled - use dedicated tab-specific save buttons');
        return;
    }

    /**
     * Hide save button with animation - DISABLED
     */
    hideSaveButton() {
        console.log('⚠️ Floating save button disabled - use dedicated tab-specific save buttons');
        return;
    }

    /* ========================================================================
       💾 DATA LOADING & PROCESSING
       ======================================================================== */

    /**
     * Load company data from API
     */
    async loadCompanyData() {
        try {
            // 🔧 [FIXED] - Data Loading Guard (Micro-Surgery #2)
            if (this.companyDataLoaded) {
                console.log('🛡️ Company data already loaded, skipping...');
                return this.companyData;
            }
            
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
            this.companyData = this.currentData; // Store for guard check
            this.companyDataLoaded = true; // 🔧 [FIXED] - Set loaded flag
            console.log('✅ Company data loaded:', this.currentData);

            // Populate all tabs with data
            this.populateOverviewTab();
            this.populateConfigTab();
            this.populateNotesTab();
            // 🗑️ DELETED: this.populateCalendarSettingsTab() - Calendar tab destroyed
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

    /* ========================================================================
       📋 OVERVIEW TAB - COMPANY DETAILS
       ======================================================================== */

    /**
     * GOLD STANDARD: Populate Overview tab with v2-grade UX
     * Features: Live validation, auto-save, accessibility, error recovery
     */
    populateOverviewTab() {
        if (!this.currentData) {
            this.showNotification('Company data not loaded', 'error');
            return;
        }

        console.log('📄 Populating Overview tab with v2 features...');

        try {
            // Update header elements with current data
            this.updateHeaderElements();

            // Create modern always-editable form with validation
            this.createV2EditableForm();

            // Initialize contacts management with v2 features
            this.initializeContactsManagement();
            
            // Setup comprehensive validation and auto-save
            this.setupV2FormValidation();

            console.log('✅ Overview tab initialized with v2 features');
        } catch (error) {
            console.error('❌ Error initializing Overview tab:', error);
            this.showNotification('Failed to initialize Overview tab', 'error');
        }
    }

    /**
     * GOLD STANDARD: Create v2-grade always-editable form
     * Features: Validation, accessibility, progressive enhancement
     */
    createV2EditableForm() {
        if (!this.domElements.editFormContainer) {
            console.error('❌ Edit form container not found');
            return;
        }

        const formHTML = this.generateV2FormHTML();
        this.domElements.editFormContainer.innerHTML = formHTML;
        this.domElements.editFormContainer.classList.remove('hidden');

        // Hide legacy edit button (form is always visible)
        if (this.domElements.editButton) {
            this.domElements.editButton.style.display = 'none';
        }

        // Initialize v2 form features
        this.initializeFormAccessibility();
        this.setupFormAutoSave();
        
        console.log('🔧 V2 editable form created');
    }

    /**
     * GOLD STANDARD: Generate v2 form HTML with validation
     */
    generateV2FormHTML() {
        const data = this.currentData;
        const requiredFields = ['companyName'];
        
        return `
            <div class="bg-white rounded-xl border border-gray-200 p-8 shadow-sm hover:shadow-md transition-shadow duration-200">
                <!-- Header Section -->
                <div class="flex justify-between items-center mb-8">
                    <div class="flex items-center">
                        <div class="bg-indigo-100 p-3 rounded-lg mr-4">
                            <i class="fas fa-building text-indigo-600 text-xl"></i>
                        </div>
                        <div>
                            <h3 class="text-xl font-semibold text-gray-900">Company Information</h3>
                            <p class="text-sm text-gray-600 mt-1">Manage your business details and contact information</p>
                        </div>
                    </div>
                    <div class="flex items-center space-x-2">
                        <div id="validation-status" class="hidden">
                            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium">
                                <i class="fas fa-check-circle mr-1"></i>
                                All fields valid
                            </span>
                        </div>
                        <span class="text-sm text-gray-500 bg-gray-100 px-4 py-2 rounded-full">
                            <i class="fas fa-edit text-gray-400 mr-1"></i>
                            Live editing enabled
                        </span>
                    </div>
                </div>
                
                <!-- Form Fields Grid -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <!-- Left Column - Essential Info -->
                    <div class="space-y-6">
                        <div class="form-group">
                            <label for="edit-company-name" class="form-label required">
                                Company Name
                                <span class="text-red-500 ml-1" title="Required field">*</span>
                            </label>
                            <input 
                                type="text" 
                                id="edit-company-name" 
                                name="companyName"
                                class="form-input v2-input" 
                                value="${this.escapeHtml(data.companyName || data.name || '')}"
                                placeholder="Enter your company name"
                                required
                                aria-describedby="company-name-help"
                                data-validate="required|min:2|max:100"
                            >
                            <div id="company-name-help" class="form-help">
                                This name will appear on all communications and documents
                            </div>
                            <div class="field-validation hidden"></div>
                        </div>

                        <div class="form-group">
                            <label for="edit-business-phone" class="form-label">
                                Business Phone
                            </label>
                            <input 
                                type="tel" 
                                id="edit-business-phone" 
                                name="businessPhone"
                                class="form-input v2-input" 
                                value="${this.escapeHtml(data.companyPhone || data.businessPhone || '')}"
                                placeholder="+1 (555) 123-4567"
                                aria-describedby="business-phone-help"
                                data-validate="phone"
                            >
                            <div id="business-phone-help" class="form-help">
                                Primary contact number for customers and partners
                            </div>
                            <div class="field-validation hidden"></div>
                        </div>

                        <div class="form-group">
                            <label for="edit-business-email" class="form-label">
                                Business Email
                            </label>
                            <input 
                                type="email" 
                                id="edit-business-email" 
                                name="businessEmail"
                                class="form-input v2-input" 
                                value="${this.escapeHtml(data.businessEmail || '')}"
                                placeholder="contact@yourcompany.com"
                                aria-describedby="business-email-help"
                                data-validate="email"
                            >
                            <div id="business-email-help" class="form-help">
                                Main email address for business communications
                            </div>
                            <div class="field-validation hidden"></div>
                        </div>

                        <div class="form-group">
                            <label for="edit-business-website" class="form-label">
                                Website
                            </label>
                            <input 
                                type="text" 
                                id="edit-business-website" 
                                name="businessWebsite"
                                class="form-input v2-input" 
                                value="${this.escapeHtml(data.businessWebsite || '')}"
                                placeholder="www.yourcompany.com"
                                aria-describedby="business-website-help"
                            >
                            <div id="business-website-help" class="form-help">
                                Your company's website URL
                            </div>
                            <div class="field-validation hidden"></div>
                        </div>
                    </div>

                    <!-- Right Column - Additional Details -->
                    <div class="space-y-6">
                        <div class="form-group">
                            <label for="edit-business-address" class="form-label">
                                Business Address
                            </label>
                            <textarea 
                                id="edit-business-address" 
                                name="businessAddress"
                                class="form-textarea v2-input" 
                                rows="3"
                                placeholder="123 Main Street&#10;Suite 100&#10;City, State 12345"
                                aria-describedby="business-address-help"
                                data-validate="address"
                            >${this.escapeHtml(data.companyAddress || data.businessAddress || '')}</textarea>
                            <div id="business-address-help" class="form-help">
                                Physical location of your business
                            </div>
                            <div class="field-validation hidden"></div>
                        </div>

                        <div class="form-group">
                            <label for="edit-service-area" class="form-label">
                                Service Area
                            </label>
                            <input 
                                type="text" 
                                id="edit-service-area" 
                                name="serviceArea"
                                class="form-input v2-input" 
                                value="${this.escapeHtml(data.serviceArea || '')}"
                                placeholder="Greater Metro Area, 50-mile radius"
                                aria-describedby="service-area-help"
                            >
                            <div id="service-area-help" class="form-help">
                                Geographic area where you provide services
                            </div>
                            <div class="field-validation hidden"></div>
                        </div>

                        <div class="form-group">
                            <label for="edit-business-hours" class="form-label">
                                Business Hours
                            </label>
                            <input 
                                type="text" 
                                id="edit-business-hours" 
                                name="businessHours"
                                class="form-input v2-input" 
                                value="${this.escapeHtml(data.businessHours || '')}"
                                placeholder="Monday-Friday: 9:00 AM - 5:00 PM"
                                aria-describedby="business-hours-help"
                            >
                            <div id="business-hours-help" class="form-help">
                                When your business is open for customers
                            </div>
                            <div class="field-validation hidden"></div>
                        </div>
                    </div>
                </div>

                <!-- Description Section -->
                <div class="mt-8">
                    <div class="form-group">
                        <label for="edit-description" class="form-label">
                            Business Description
                        </label>
                        <textarea 
                            id="edit-description" 
                            name="description"
                            class="form-textarea v2-input" 
                            rows="4"
                            placeholder="Describe your business, services, and what makes you unique..."
                            aria-describedby="description-help"
                            data-validate="max:1000"
                        >${this.escapeHtml(data.description || '')}</textarea>
                        <div id="description-help" class="form-help">
                            Brief overview of your business and services (up to 1000 characters)
                        </div>
                        <div class="field-validation hidden"></div>
                        <div class="text-right mt-1">
                            <span id="description-counter" class="text-xs text-gray-500">
                                ${(data.description || '').length}/1000 characters
                            </span>
                        </div>
                    </div>
                </div>
                
                <!-- Status Indicator -->
                <div class="mt-8 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center">
                            <div class="bg-blue-100 p-2 rounded-lg mr-3">
                                <i class="fas fa-magic text-blue-600"></i>
                            </div>
                            <div>
                                <span class="text-sm text-blue-900 font-semibold">V2 Live Editing</span>
                                <p class="text-xs text-blue-700 mt-1">Changes are validated in real-time and auto-saved</p>
                            </div>
                        </div>
                        <div id="form-status" class="flex items-center text-sm">
                            <div class="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                            <span class="text-green-700 font-medium">Ready</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * GOLD STANDARD: Setup v2 form validation and auto-save
     */
    setupV2FormValidation() {
        const form = this.domElements.editFormContainer;
        if (!form) return;

        // Get all v2 inputs
        const inputs = form.querySelectorAll('.v2-input');
        
        inputs.forEach(input => {
            // Real-time validation on input
            input.addEventListener('input', (e) => this.handleV2Input(e));
            input.addEventListener('blur', (e) => this.validateField(e.target));
            input.addEventListener('focus', (e) => this.clearFieldErrors(e.target));
        });

        // Special handling for description character counter
        const descriptionField = document.getElementById('edit-description');
        if (descriptionField) {
            descriptionField.addEventListener('input', () => this.updateCharacterCounter());
        }

        console.log('🔧 V2 validation setup complete');
    }

    /**
     * GOLD STANDARD: Handle v2 input with validation and auto-save
     */
    handleV2Input(event) {
        const field = event.target;
        
        // Mark as changed for auto-save
        this.setUnsavedChanges(true);
        
        // Real-time validation (debounced)
        clearTimeout(this.validationTimeout);
        this.validationTimeout = setTimeout(() => {
            this.validateField(field);
            this.updateFormStatus();
        }, 300);

        // Update form status
        this.setFormStatus('typing', 'Making changes...');
        
        console.log(`📝 V2 field changed: ${field.name} = ${field.value.substring(0, 50)}...`);
    }

    /**
     * GOLD STANDARD: Validate individual field with v2 rules
     */
    validateField(field) {
        const rules = field.getAttribute('data-validate');
        if (!rules) return true;

        const validationContainer = field.parentNode.querySelector('.field-validation');
        if (!validationContainer) return true;

        const value = field.value.trim();
        const ruleArray = rules.split('|');
        const errors = [];

        // Apply validation rules
        for (const rule of ruleArray) {
            const [ruleName, ruleValue] = rule.split(':');
            
            switch (ruleName) {
                case 'required':
                    if (!value) errors.push('This field is required');
                    break;
                case 'min':
                    if (value.length < parseInt(ruleValue)) {
                        errors.push(`Minimum ${ruleValue} characters required`);
                    }
                    break;
                case 'max':
                    if (value.length > parseInt(ruleValue)) {
                        errors.push(`Maximum ${ruleValue} characters allowed`);
                    }
                    break;
                case 'email':
                    if (value && !this.isValidEmail(value)) {
                        errors.push('Please enter a valid email address');
                    }
                    break;
                case 'phone':
                    if (value && !this.isValidPhone(value)) {
                        errors.push('Please enter a valid phone number');
                    }
                    break;
                case 'url':
                    if (value && !this.isValidUrl(value)) {
                        errors.push('Please enter a valid website URL');
                    }
                    break;
            }
        }

        // Display validation results
        if (errors.length > 0) {
            this.showFieldErrors(field, errors);
            return false;
        } else {
            this.showFieldSuccess(field);
            return true;
        }
    }

    /**
     * GOLD STANDARD: Initialize form accessibility features
     */
    initializeFormAccessibility() {
        const form = this.domElements.editFormContainer;
        if (!form) return;

        // Add ARIA labels and descriptions
        const inputs = form.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            // Ensure proper labeling
            const label = form.querySelector(`label[for="${input.id}"]`);
            if (label && !input.getAttribute('aria-labelledby')) {
                input.setAttribute('aria-labelledby', label.id || `${input.id}-label`);
            }

            // Add required indicators for screen readers
            if (input.hasAttribute('required')) {
                input.setAttribute('aria-required', 'true');
            }
        });

        console.log('♿ Accessibility features initialized');
    }

    /**
     * GOLD STANDARD: Setup form auto-save with v2 features
     */
    setupFormAutoSave() {
        // Auto-save after 2 seconds of inactivity
        this.autoSaveTimeout = null;
        
        const form = this.domElements.editFormContainer;
        if (!form) return;

        const inputs = form.querySelectorAll('.v2-input');
        inputs.forEach((input) => {
            input.addEventListener('input', () => {
                clearTimeout(this.autoSaveTimeout);
                this.setFormStatus('pending', 'Auto-saving...');
                
                this.autoSaveTimeout = setTimeout(async () => {
                    try {
                        await this.performAutoSave();
                        this.setFormStatus('saved', 'All changes saved');
                    } catch (error) {
                        this.setFormStatus('error', 'Auto-save failed');
                        console.error('Auto-save failed:', error);
                    }
                }, 2000);
            });
        });

        console.log('💾 Auto-save enabled');
    }

    /* ========================================================================
       👥 CONTACTS TAB - CONTACT MANAGEMENT
       ======================================================================== */

    /**
     * GOLD STANDARD: Initialize contacts management with v2 features
     */
    initializeContactsManagement() {
        try {
            this.renderV2ContactsSection();
            this.setupV2ContactsHandlers();
            console.log('� V2 contacts management initialized');
        } catch (error) {
            console.error('❌ Error initializing contacts:', error);
            this.showNotification('Failed to initialize contacts section', 'error');
        }
    }

    /**
     * Render v2 contacts section
     */
    renderV2ContactsSection() {
        console.log('👥 Rendering v2 contacts section...');
        
        // Use contacts-list as per HTML structure
        const contactsList = document.getElementById('contacts-list');
        if (!contactsList) {
            console.log('ℹ️ Contacts list not found - skipping contacts rendering');
            return;
        }
        
        const hasOwner = this.currentData?.ownerName || this.currentData?.ownerEmail || this.currentData?.ownerPhone;
        const hasContact = this.currentData?.contactName || this.currentData?.contactEmail || this.currentData?.contactPhone;
        
        // Build contacts HTML
        let contactsHTML = '';
        
        // Owner Card
        if (hasOwner) {
            contactsHTML += `
                <div class="bg-white rounded-lg border-2 border-indigo-200 p-6 hover:shadow-md transition-shadow">
                    <div class="flex items-start justify-between mb-4">
                        <div class="flex items-center">
                            <div class="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mr-4">
                                <i class="fas fa-crown text-indigo-600 text-xl"></i>
                            </div>
                            <div>
                                <h4 class="font-semibold text-gray-900">Owner / Primary Contact</h4>
                                <p class="text-sm text-gray-500">Main company owner</p>
                            </div>
                        </div>
                        <button onclick="companyProfileManager.editContact('owner')" 
                                class="text-indigo-600 hover:text-indigo-700 text-sm font-medium">
                            <i class="fas fa-edit mr-1"></i>Edit
                        </button>
                    </div>
                    <div class="space-y-3">
                        <div class="flex items-center text-sm">
                            <i class="fas fa-user w-5 text-gray-400"></i>
                            <span class="ml-3 text-gray-700">${this.currentData?.ownerName || 'Not set'}</span>
                        </div>
                        <div class="flex items-center text-sm">
                            <i class="fas fa-envelope w-5 text-gray-400"></i>
                            <span class="ml-3 text-gray-700">${this.currentData?.ownerEmail || 'Not set'}</span>
                        </div>
                        <div class="flex items-center text-sm">
                            <i class="fas fa-phone w-5 text-gray-400"></i>
                            <span class="ml-3 text-gray-700">${this.currentData?.ownerPhone || 'Not set'}</span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Secondary Contact Card
        if (hasContact) {
            contactsHTML += `
                <div class="bg-white rounded-lg border-2 border-gray-200 p-6 hover:shadow-md transition-shadow">
                    <div class="flex items-start justify-between mb-4">
                        <div class="flex items-center">
                            <div class="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mr-4">
                                <i class="fas fa-user text-gray-600 text-xl"></i>
                            </div>
                            <div>
                                <h4 class="font-semibold text-gray-900">Secondary Contact</h4>
                                <p class="text-sm text-gray-500">Additional contact person</p>
                            </div>
                        </div>
                        <button onclick="companyProfileManager.editContact('secondary')" 
                                class="text-indigo-600 hover:text-indigo-700 text-sm font-medium">
                            <i class="fas fa-edit mr-1"></i>Edit
                        </button>
                    </div>
                    <div class="space-y-3">
                        <div class="flex items-center text-sm">
                            <i class="fas fa-user w-5 text-gray-400"></i>
                            <span class="ml-3 text-gray-700">${this.currentData?.contactName || 'Not set'}</span>
                        </div>
                        <div class="flex items-center text-sm">
                            <i class="fas fa-envelope w-5 text-gray-400"></i>
                            <span class="ml-3 text-gray-700">${this.currentData?.contactEmail || 'Not set'}</span>
                        </div>
                        <div class="flex items-center text-sm">
                            <i class="fas fa-phone w-5 text-gray-400"></i>
                            <span class="ml-3 text-gray-700">${this.currentData?.contactPhone || 'Not set'}</span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Empty state
        if (!hasOwner && !hasContact) {
            contactsHTML = `
                <div class="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <i class="fas fa-address-book text-gray-300 text-5xl mb-4"></i>
                    <h3 class="text-lg font-medium text-gray-900 mb-2">No Contacts Yet</h3>
                    <p class="text-gray-500 mb-4">Add your first contact to get started</p>
                    <button onclick="companyProfileManager.showContactModal()" 
                            class="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">
                        <i class="fas fa-plus mr-2"></i>Add First Contact
                    </button>
                </div>
            `;
        }
        
        contactsList.innerHTML = contactsHTML;
        console.log('✅ V2 contacts section rendered with', (hasOwner ? 1 : 0) + (hasContact ? 1 : 0), 'contact(s)');
    }
    
    /**
     * Edit existing contact
     */
    editContact(contactType) {
        console.log(`📝 Editing ${contactType} contact`);
        
        const contactData = {
            type: contactType,
            name: contactType === 'owner' ? this.currentData?.ownerName : this.currentData?.contactName,
            email: contactType === 'owner' ? this.currentData?.ownerEmail : this.currentData?.contactEmail,
            phone: contactType === 'owner' ? this.currentData?.ownerPhone : this.currentData?.contactPhone
        };
        
        this.showContactModal(contactData);
    }
    
    /**
     * Setup v2 contacts event handlers
     */
    setupV2ContactsHandlers() {
        console.log('👥 Setting up v2 contacts handlers...');
        
        const addContactBtn = document.getElementById('add-contact-btn');
        if (addContactBtn) {
            addContactBtn.addEventListener('click', () => {
                console.log('📞 Add Contact button clicked');
                this.showContactModal();
            });
            console.log('✅ Add Contact button handler attached');
        } else {
            console.warn('⚠️ Add Contact button not found in DOM');
        }
        
        console.log('✅ V2 contacts handlers setup complete');
    }
    
    /**
     * Show contact modal for add/edit
     */
    showContactModal(contactData = null) {
        const isEdit = !!contactData;
        const modalTitle = isEdit ? 'Edit Contact' : 'Add New Contact';
        const submitText = isEdit ? 'Update Contact' : 'Add Contact';
        
        // Create modal HTML
        const modalHTML = `
            <div id="contact-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
                <div class="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                    <!-- Modal Header -->
                    <div class="flex items-center justify-between p-5 border-b border-gray-200">
                        <h3 class="text-xl font-semibold text-gray-900">
                            <i class="fas fa-user-plus mr-2 text-indigo-600"></i>${modalTitle}
                        </h3>
                        <button type="button" onclick="document.getElementById('contact-modal').remove()" class="text-gray-400 hover:text-gray-500 text-2xl">&times;</button>
                    </div>
                    
                    <!-- Modal Body -->
                    <form id="contact-form" class="p-6">
                        <div class="space-y-4">
                            <!-- Contact Type Selection -->
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">
                                    Contact Type <span class="text-red-500">*</span>
                                </label>
                                <select id="contact-type" name="contactType" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                    <option value="">-- Select Type --</option>
                                    <option value="owner" ${contactData?.type === 'owner' ? 'selected' : ''}>Owner/Primary Contact</option>
                                    <option value="secondary" ${contactData?.type === 'secondary' ? 'selected' : ''}>Secondary Contact</option>
                                </select>
                            </div>
                            
                            <!-- Contact Name -->
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">
                                    Full Name <span class="text-red-500">*</span>
                                </label>
                                <input type="text" id="contact-name" name="name" required
                                       value="${contactData?.name || ''}"
                                       placeholder="John Doe"
                                       class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                            
                            <!-- Contact Email -->
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">
                                    Email Address <span class="text-red-500">*</span>
                                </label>
                                <input type="email" id="contact-email" name="email" required
                                       value="${contactData?.email || ''}"
                                       placeholder="john@example.com"
                                       class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                            
                            <!-- Contact Phone -->
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">
                                    Phone Number <span class="text-red-500">*</span>
                                </label>
                                <input type="tel" id="contact-phone" name="phone" required
                                       value="${contactData?.phone || ''}"
                                       placeholder="+1 (555) 123-4567"
                                       class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                        </div>
                        
                        <!-- Form Actions -->
                        <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
                            <button type="button" onclick="document.getElementById('contact-modal').remove()"
                                    class="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">
                                Cancel
                            </button>
                            <button type="submit"
                                    class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">
                                <i class="fas fa-save mr-2"></i>${submitText}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        // Remove existing modal if any
        const existingModal = document.getElementById('contact-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Setup form submission handler
        const form = document.getElementById('contact-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveContact(isEdit);
        });
        
        console.log(`✅ Contact modal displayed (${isEdit ? 'edit' : 'add'} mode)`);
    }
    
    /**
     * Save contact data
     */
    async saveContact(isEdit = false) {
        const form = document.getElementById('contact-form');
        const contactType = document.getElementById('contact-type').value;
        const name = document.getElementById('contact-name').value.trim();
        const email = document.getElementById('contact-email').value.trim();
        const phone = document.getElementById('contact-phone').value.trim();
        
        // Validation
        if (!contactType || !name || !email || !phone) {
            this.showNotification('Please fill in all required fields', 'error');
            return;
        }
        
        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            this.showNotification('Please enter a valid email address', 'error');
            return;
        }
        
        console.log('💾 Saving contact...', { contactType, name, email, phone });
        
        try {
            // Prepare update data based on contact type
            const updateData = {};
            if (contactType === 'owner') {
                updateData.ownerName = name;
                updateData.ownerEmail = email;
                updateData.ownerPhone = phone;
            } else {
                updateData.contactName = name;
                updateData.contactEmail = email;
                updateData.contactPhone = phone;
            }
            
            // Save to API
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify(updateData)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log('✅ Contact saved successfully:', result);
            
            // Update local data
            Object.assign(this.currentData, updateData);
            
            // Close modal
            document.getElementById('contact-modal').remove();
            
            // Re-render contacts section
            this.renderV2ContactsSection();
            
            // Show success notification
            this.showNotification(
                isEdit ? 'Contact updated successfully' : 'Contact added successfully',
                'success'
            );
            
        } catch (error) {
            console.error('❌ Error saving contact:', error);
            this.showNotification('Failed to save contact. Please try again.', 'error');
        }
    }

    /* ========================================================================
       ⚙️ CONFIGURATION TAB - SETTINGS
       ======================================================================== */

    /**
     * GOLD STANDARD: Populate Configuration tab with data
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
            flatToken: this.currentData.twilioAuthToken,
            authTokenValue: this.currentData.twilioConfig?.authToken
        });
        
        // Check nested structure first, then flat structure for backward compatibility
        const twilioConfig = this.currentData.twilioConfig || {};
        
        console.log('🔧 DEBUG: About to process Auth Token:', {
            twilioTokenInput: !!twilioTokenInput,
            authToken: twilioConfig.authToken,
            flatAuthToken: this.currentData.twilioAuthToken,
            hasEither: !!(twilioConfig.authToken || this.currentData.twilioAuthToken)
        });
        
        if (twilioSidInput && (twilioConfig.accountSid || this.currentData.twilioAccountSid)) {
            twilioSidInput.value = twilioConfig.accountSid || this.currentData.twilioAccountSid;
            console.log('🔧 Loaded Twilio SID:', twilioSidInput.value);
        }
        
        if (twilioTokenInput && (twilioConfig.authToken || this.currentData.twilioAuthToken)) {
            const savedToken = twilioConfig.authToken || this.currentData.twilioAuthToken;
            // Show last 4 characters with masking for better UX
            if (savedToken && savedToken.length > 4) {
                twilioTokenInput.value = '••••••••••••' + savedToken.slice(-4);
                twilioTokenInput.dataset.hasToken = 'true';
                console.log('🔧 Loaded Twilio Auth Token (showing last 4):', '••••••••••••' + savedToken.slice(-4));
                console.log('🔧 Full token for debug:', savedToken);
            } else {
                twilioTokenInput.value = '••••••••••••••••';
                twilioTokenInput.dataset.hasToken = 'true';
                console.log('🔧 Loaded Twilio Auth Token (fully masked - short token)');
            }
        } else {
            if (twilioTokenInput) {
                twilioTokenInput.value = '';
                twilioTokenInput.placeholder = 'Enter Auth Token';
                twilioTokenInput.dataset.hasToken = 'false';
                console.log('🔧 No Twilio Auth Token found - field empty');
            }
        }
        
        if (twilioApiKeyInput && (twilioConfig.apiKey || this.currentData.twilioApiKey)) {
            const savedApiKey = twilioConfig.apiKey || this.currentData.twilioApiKey;
            // Show last 4 characters with masking for better UX (API Keys can be sensitive too)
            if (savedApiKey && savedApiKey.length > 4) {
                twilioApiKeyInput.value = '••••••••••••' + savedApiKey.slice(-4);
                twilioApiKeyInput.dataset.hasApiKey = 'true';
                console.log('🔧 Loaded Twilio API Key (showing last 4):', '••••••••••••' + savedApiKey.slice(-4));
            } else {
                twilioApiKeyInput.value = '••••••••••••••••';
                twilioApiKeyInput.dataset.hasApiKey = 'true';
                console.log('🔧 Loaded Twilio API Key (fully masked - short key)');
            }
        } else {
            if (twilioApiKeyInput) {
                twilioApiKeyInput.value = '';
                twilioApiKeyInput.placeholder = 'Enter API Key';
                twilioApiKeyInput.dataset.hasApiKey = 'false';
                console.log('🔧 No Twilio API Key found - field empty');
            }
        }
        
        if (twilioApiSecretInput && (twilioConfig.apiSecret || this.currentData.twilioApiSecret)) {
            const savedSecret = twilioConfig.apiSecret || this.currentData.twilioApiSecret;
            // Show last 4 characters with masking for better UX
            if (savedSecret && savedSecret.length > 4) {
                twilioApiSecretInput.value = '••••••••••••' + savedSecret.slice(-4);
                twilioApiSecretInput.dataset.hasSecret = 'true';
                console.log('🔧 Loaded Twilio API Secret (showing last 4):', '••••••••••••' + savedSecret.slice(-4));
            } else {
                twilioApiSecretInput.value = '••••••••••••••••';
                twilioApiSecretInput.dataset.hasSecret = 'true';
                console.log('🔧 Loaded Twilio API Secret (fully masked - short secret)');
            }
        } else {
            if (twilioApiSecretInput) {
                twilioApiSecretInput.value = '';
                twilioApiSecretInput.placeholder = 'Enter API Secret';
                twilioApiSecretInput.dataset.hasSecret = 'false';
                console.log('🔧 No Twilio API Secret found - field empty');
            }
        }

        // Setup phone numbers management
        this.setupPhoneNumbersManagement();
        
        // Setup configuration form listeners
        this.setupConfigFormListeners();
        
        console.log('✅ Configuration interface ready');
    }

    /* ========================================================================
       📞 PHONE NUMBERS MANAGEMENT
       ======================================================================== */

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
            // 🗑️ DELETED: this.collectCalendarData(configData) - Calendar tab destroyed
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
     * PRODUCTION: Populate Notes tab with v2-grade note management system
     * Features: Pin/unpin, edit in-place, timestamps, search, categories, auto-save
     */
    populateNotesTab() {        
        // Initialize notes management system with advanced features
        this.initializeV2NotesSystem();
    }

    /**
     * PRODUCTION: Initialize v2 notes management system
     */
    initializeV2NotesSystem() {        
        // Initialize notes array with v2 structure
        this.notes = this.currentData?.notes || [];
        
        // Ensure notes have proper structure
        this.notes = this.notes.map(note => this.normalizeNoteStructure(note));
        
        // Setup v2 notes interface
        this.setupV2NotesInterface();
        
        // Render notes with advanced features
        this.renderV2Notes();
        
        // Setup search and filtering
        this.setupNotesSearch();
        
        console.log('✅ V2 notes system initialized with', this.notes.length, 'notes');
    }

    /**
     * PRODUCTION: Normalize note structure for v2 features
     */
    normalizeNoteStructure(note) {
        return {
            id: note.id || Date.now() + Math.random(),
            content: note.content || note.text || '',
            title: note.title || this.extractTitleFromContent(note.content || note.text || ''),
            isPinned: note.isPinned || false,
            category: note.category || 'general',
            priority: note.priority || 'normal',
            tags: note.tags || [],
            createdAt: note.createdAt || note.timestamp || new Date().toISOString(),
            updatedAt: note.updatedAt || note.timestamp || new Date().toISOString(),
            author: note.author || 'Developer',
            isEditing: false
        };
    }

    /**
     * GOLD STANDARD: Extract title from note content
     */
    extractTitleFromContent(content) {
        if (!content) return 'Untitled Note';
        
        // Get first line as title, max 50 chars
        const firstLine = content.split('\n')[0].trim();
        return firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine || 'Untitled Note';
    }

    /**
     * GOLD STANDARD: Setup v2 notes interface with advanced controls
     */
    setupV2NotesInterface() {
        // Transform the basic notes HTML into v2-grade interface
        const notesContent = document.getElementById('notes-content');
        if (!notesContent) {
            console.error('❌ Notes content container not found');
            return;
        }

        // Replace with v2 notes interface
        notesContent.innerHTML = this.generateV2NotesHTML();
        
        // Setup event listeners for advanced features
        this.setupNotesEventListeners();
        
        console.log('✅ V2 notes interface created');
    }

    /**
     * GOLD STANDARD: Generate v2 notes HTML interface
     */
    generateV2NotesHTML() {
        return `
            <section class="profile-section bg-transparent shadow-none p-0">
                <!-- Header with Stats and Controls -->
                <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6">
                    <div>
                        <h2 class="text-2xl font-bold text-gray-900 flex items-center">
                            <div class="bg-gradient-to-r from-purple-100 to-indigo-100 p-3 rounded-xl mr-4">
                                <i class="fas fa-sticky-note text-purple-600 text-xl"></i>
                            </div>
                            Developer Notes
                        </h2>
                        <p class="text-gray-600 mt-2">Manage your development notes, ideas, and documentation</p>
                    </div>
                    <div class="flex items-center space-x-4 mt-4 lg:mt-0">
                        <div class="text-sm text-gray-500 bg-gray-100 px-4 py-2 rounded-full">
                            <span id="notes-count">0</span> total notes
                        </div>
                        <div class="text-sm text-gray-500 bg-purple-100 px-4 py-2 rounded-full">
                            <span id="pinned-count">0</span> pinned
                        </div>
                    </div>
                </div>

                <!-- Search, Filter, and Add Controls -->
                <div class="bg-white rounded-xl border border-gray-200 p-6 mb-6 shadow-sm">
                    <div class="flex flex-col lg:flex-row lg:items-center lg:space-x-6 space-y-4 lg:space-y-0">
                        <!-- Search Bar -->
                        <div class="flex-1">
                            <div class="relative">
                                <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                                <input 
                                    type="text" 
                                    id="notes-search" 
                                    class="form-input pl-10 pr-4" 
                                    placeholder="Search notes by title, content, or tags..."
                                >
                            </div>
                        </div>
                        
                        <!-- Category Filter -->
                        <div>
                            <select id="notes-category-filter" class="form-select">
                                <option value="">All Categories</option>
                                <option value="general">General</option>
                                <option value="bug">Bug Reports</option>
                                <option value="feature">Feature Ideas</option>
                                <option value="todo">To Do</option>
                                <option value="meeting">Meeting Notes</option>
                                <option value="documentation">Documentation</option>
                            </select>
                        </div>
                        
                        <!-- Sort Options -->
                        <div>
                            <select id="notes-sort" class="form-select">
                                <option value="updated-desc">Recently Updated</option>
                                <option value="created-desc">Recently Created</option>
                                <option value="title-asc">Title A-Z</option>
                                <option value="priority-desc">Priority High-Low</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Quick Add Note -->
                <div class="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border-2 border-dashed border-purple-200 p-6 mb-6">
                    <div class="mb-4">
                        <label for="quick-note-title" class="form-label">Note Title</label>
                        <input 
                            type="text" 
                            id="quick-note-title" 
                            class="form-input" 
                            placeholder="Quick note title..."
                        >
                    </div>
                    <div class="mb-4">
                        <label for="quick-note-content" class="form-label">Note Content</label>
                        <textarea 
                            id="quick-note-content" 
                            class="form-textarea" 
                            rows="4" 
                            placeholder="Write your note here... (Markdown supported)"
                        ></textarea>
                    </div>
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                        <div class="flex items-center space-x-4">
                            <select id="quick-note-category" class="form-select">
                                <option value="general">General</option>
                                <option value="bug">Bug Report</option>
                                <option value="feature">Feature Idea</option>
                                <option value="todo">To Do</option>
                                <option value="meeting">Meeting Notes</option>
                                <option value="documentation">Documentation</option>
                            </select>
                            <select id="quick-note-priority" class="form-select">
                                <option value="normal">Normal</option>
                                <option value="high">High Priority</option>
                                <option value="low">Low Priority</option>
                            </select>
                        </div>
                        <div class="flex items-center space-x-3">
                            <label class="flex items-center">
                                <input type="checkbox" id="quick-note-pin" class="form-checkbox mr-2">
                                <span class="text-sm text-gray-700">Pin to top</span>
                            </label>
                            <button id="add-v2-note" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm hover:shadow-md transition-all duration-200 flex items-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                                <i class="fas fa-plus mr-2 text-sm"></i>
                                Add Note
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Notes Display Area -->
                <div id="v2-notes-container">
                    <!-- Notes will be rendered here -->
                </div>

                <!-- Empty State (will be shown when no notes) -->
                <div id="notes-empty-state" class="hidden text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                    <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-purple-100 mb-4">
                        <i class="fas fa-sticky-note text-purple-600 text-2xl"></i>
                    </div>
                    <h3 class="text-lg font-medium text-gray-900 mb-2">No notes yet</h3>
                    <p class="text-sm text-gray-600 mb-6 max-w-sm mx-auto">
                        Start organizing your development thoughts, ideas, and documentation with your first note.
                    </p>
                </div>
            </section>
        `;
    }

    /**
     * GOLD STANDARD: Setup comprehensive event listeners for notes functionality
     */
    setupNotesEventListeners() {
        // Add note button
        const addButton = document.getElementById('add-v2-note');
        if (addButton) {
            addButton.addEventListener('click', () => this.addV2Note());
        }

        // Search functionality
        const searchInput = document.getElementById('notes-search');
        if (searchInput) {
            searchInput.addEventListener('input', this.debounce(() => this.filterNotes(), 300));
        }

        // Category filter
        const categoryFilter = document.getElementById('notes-category-filter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => this.filterNotes());
        }

        // Sort options
        const sortSelect = document.getElementById('notes-sort');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => this.renderV2Notes());
        }

        // Quick title auto-generation
        const contentTextarea = document.getElementById('quick-note-content');
        const titleInput = document.getElementById('quick-note-title');
        
        if (contentTextarea && titleInput) {
            contentTextarea.addEventListener('input', () => {
                if (!titleInput.value.trim()) {
                    const generatedTitle = this.extractTitleFromContent(contentTextarea.value);
                    if (generatedTitle !== 'Untitled Note') {
                        titleInput.value = generatedTitle;
                    }
                }
            });
        }

        // Event listeners setup complete
    }

    /**
     * PRODUCTION: Add v2 note with full feature set
     */
    addV2Note() {        
        const titleInput = document.getElementById('quick-note-title');
        const contentTextarea = document.getElementById('quick-note-content');
        const categorySelect = document.getElementById('quick-note-category');
        const prioritySelect = document.getElementById('quick-note-priority');
        const pinCheckbox = document.getElementById('quick-note-pin');

        // Validation
        if (!contentTextarea?.value.trim()) {
            this.showNotification('Please enter note content', 'error');
            contentTextarea?.focus();
            return;
        }

        const title = titleInput?.value.trim() || this.extractTitleFromContent(contentTextarea.value);
        
        const newNote = {
            id: Date.now() + Math.random(),
            title: title,
            content: contentTextarea.value.trim(),
            category: categorySelect?.value || 'general',
            priority: prioritySelect?.value || 'normal',
            isPinned: pinCheckbox?.checked || false,
            tags: this.extractTagsFromContent(contentTextarea.value),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            author: 'Developer',
            isEditing: false
        };

        // Add to notes array (pinned notes go to top)
        if (newNote.isPinned) {
            this.notes.unshift(newNote);
        } else {
            // Add after pinned notes
            const firstUnpinnedIndex = this.notes.findIndex(note => !note.isPinned);
            if (firstUnpinnedIndex === -1) {
                this.notes.push(newNote);
            } else {
                this.notes.splice(firstUnpinnedIndex, 0, newNote);
            }
        }

        // Clear form
        titleInput.value = '';
        contentTextarea.value = '';
        categorySelect.value = 'general';
        prioritySelect.value = 'normal';
        pinCheckbox.checked = false;

        // Update display
        this.renderV2Notes();
        this.setUnsavedChanges(true);
        this.showNotification('Note added successfully!', 'success');
    }

    /**
     * PRODUCTION: Extract tags from note content (#hashtags)
     */
    extractTagsFromContent(content) {
        const tagRegex = /#(\w+)/g;
        const tags = [];
        let match;
        
        while ((match = tagRegex.exec(content)) !== null) {
            tags.push(match[1].toLowerCase());
        }
        
        return [...new Set(tags)]; // Remove duplicates
    }

    /**
     * PRODUCTION: Render v2 notes with advanced features
     */
    renderV2Notes() {
        const container = document.getElementById('v2-notes-container');
        const emptyState = document.getElementById('notes-empty-state');
        
        if (!container) {
            console.error('❌ V2 notes container not found');
            return;
        }

        // Update counts
        this.updateNotesCounts();

        // Sort notes
        const sortedNotes = this.sortNotes([...this.notes]);
        
        if (sortedNotes.length === 0) {
            container.innerHTML = '';
            emptyState?.classList.remove('hidden');
            return;
        }

        emptyState?.classList.add('hidden');
        
        // Separate pinned and regular notes
        const pinnedNotes = sortedNotes.filter(note => note.isPinned);
        const regularNotes = sortedNotes.filter(note => !note.isPinned);

        let html = '';

        // Render pinned notes section
        if (pinnedNotes.length > 0) {
            html += `
                <div class="mb-6">
                    <div class="flex items-center mb-3">
                        <i class="fas fa-thumbtack text-yellow-600 mr-2"></i>
                        <h3 class="text-base font-semibold text-gray-900">Pinned Notes</h3>
                        <span class="ml-2 bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">${pinnedNotes.length}</span>
                    </div>
                    <div class="space-y-2">
                        ${pinnedNotes.map(note => this.generateNoteHTML(note)).join('')}
                    </div>
                </div>
            `;
        }

        // Render regular notes section
        if (regularNotes.length > 0) {
            html += `
                <div>
                    <div class="flex items-center mb-3">
                        <i class="fas fa-sticky-note text-gray-600 mr-2"></i>
                        <h3 class="text-base font-semibold text-gray-900">Notes</h3>
                        <span class="ml-2 bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full">${regularNotes.length}</span>
                    </div>
                    <div class="space-y-2">
                        ${regularNotes.map(note => this.generateNoteHTML(note)).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
        
        // Setup individual note event listeners
        this.setupNoteCardEventListeners();
    }

    /**
     * PRODUCTION: Generate HTML for individual note with all features
     */
    generateNoteHTML(note) {
        const categoryColors = {
            general: 'bg-gray-100 text-gray-800',
            bug: 'bg-red-100 text-red-800',
            feature: 'bg-blue-100 text-blue-800',
            todo: 'bg-green-100 text-green-800',
            meeting: 'bg-purple-100 text-purple-800',
            documentation: 'bg-indigo-100 text-indigo-800'
        };

        const priorityColors = {
            low: 'text-gray-500',
            normal: 'text-blue-500',
            high: 'text-red-500'
        };

        const createdDate = new Date(note.createdAt).toLocaleDateString();
        const updatedDate = new Date(note.updatedAt).toLocaleDateString();
        const isRecent = (Date.now() - new Date(note.updatedAt).getTime()) < 24 * 60 * 60 * 1000;

        return `
            <div class="note-card bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 ${note.isPinned ? 'ring-2 ring-yellow-200' : ''}" data-note-id="${note.id}">
                <!-- Compact Note Layout -->
                <div class="p-2">
                    <!-- Title and Actions Row -->
                    <div class="flex items-start justify-between mb-1">
                        ${note.isEditing ? `
                            <input 
                                type="text" 
                                class="note-title-edit form-input text-sm font-semibold flex-1 mr-2" 
                                value="${this.escapeHtml(note.title)}"
                            >
                        ` : `
                            <div class="flex-1">
                                <h4 class="text-sm font-semibold text-gray-900 break-words">
                                    ${this.escapeHtml(note.title)}
                                    ${isRecent ? '<span class="ml-1.5 bg-green-100 text-green-800 text-xs px-1.5 py-0.5 rounded-full">New</span>' : ''}
                                </h4>
                            </div>
                        `}
                        
                        <!-- Action Buttons -->
                        <div class="flex items-center space-x-0.5 ml-2">
                            <button class="pin-note-btn p-1 rounded hover:bg-gray-100 transition-colors ${note.isPinned ? 'text-yellow-600' : 'text-gray-400'}" 
                                    data-note-id="${note.id}" 
                                    title="${note.isPinned ? 'Unpin note' : 'Pin note'}">
                                <i class="fas fa-thumbtack text-xs"></i>
                            </button>
                            <button class="edit-note-btn p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors" 
                                    data-note-id="${note.id}" 
                                    title="Edit note">
                                <i class="fas fa-edit text-xs"></i>
                            </button>
                            <button class="delete-note-btn p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600 transition-colors" 
                                    data-note-id="${note.id}" 
                                    title="Delete note">
                                <i class="fas fa-trash text-xs"></i>
                            </button>
                        </div>
                    </div>
                    
                    <!-- Metadata Row -->
                    <div class="flex items-center flex-wrap gap-2 text-xs text-gray-500 mb-2">
                        <span class="${categoryColors[note.category] || categoryColors.general} px-1.5 py-0.5 rounded-full text-xs font-medium">
                            ${note.category}
                        </span>
                        <span class="flex items-center ${priorityColors[note.priority]}">
                            <i class="fas fa-flag mr-1"></i>
                            ${note.priority}
                        </span>
                        <span class="flex items-center">
                            <i class="fas fa-clock mr-1"></i>
                            ${createdDate === updatedDate ? createdDate : `Updated ${updatedDate}`}
                        </span>
                        <span class="flex items-center text-gray-400">
                            By ${note.author}
                        </span>
                    </div>

                    <!-- Note Content -->
                    ${note.isEditing ? `
                        <textarea 
                            class="note-content-edit form-textarea w-full text-sm resize-none mb-1.5" 
                            rows="2"
                        >${this.escapeHtml(note.content)}</textarea>
                        <div class="flex justify-end space-x-2">
                            <button class="cancel-edit-btn bg-gray-300 hover:bg-gray-400 text-gray-700 px-2 py-1 rounded text-xs" data-note-id="${note.id}">
                                Cancel
                            </button>
                            <button class="save-edit-btn bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs" data-note-id="${note.id}">
                                Save
                            </button>
                        </div>
                    ` : `
                        <div class="text-sm text-gray-700 whitespace-pre-wrap break-words leading-tight mb-2">
                            ${this.formatNoteContent(note.content)}
                        </div>
                        
                        <!-- Tags and Time -->
                        <div class="flex items-center justify-between">
                            <div class="flex flex-wrap gap-1">
                                ${note.tags && note.tags.length > 0 ? note.tags.map(tag => `
                                    <span class="bg-indigo-100 text-indigo-800 text-xs px-1.5 py-0.5 rounded">
                                        #${tag}
                                    </span>
                                `).join('') : ''}
                            </div>
                            <span class="text-xs text-gray-400" title="Created: ${new Date(note.createdAt).toLocaleString()}">
                                ${this.getRelativeTime(note.updatedAt)}
                            </span>
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    /**
     * GOLD STANDARD: Format note content with basic markdown support
     */
    formatNoteContent(content) {
        return content
            // Bold text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Italic text
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // Code inline
            .replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1 rounded">$1</code>')
            // Links
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-blue-600 hover:underline">$1</a>')
            // Hashtags
            .replace(/#(\w+)/g, '<span class="text-indigo-600 font-medium">#$1</span>');
    }

    /**
     * GOLD STANDARD: Get relative time string
     */
    getRelativeTime(timestamp) {
        const now = new Date();
        const time = new Date(timestamp);
        const diffMs = now - time;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return time.toLocaleDateString();
    }

    /**
     * GOLD STANDARD: Setup event listeners for individual note cards
     */
    setupNoteCardEventListeners() {
        const container = document.getElementById('v2-notes-container');
        if (!container) return;

        // Use event delegation for better performance
        container.addEventListener('click', (e) => {
            const noteId = e.target.closest('[data-note-id]')?.dataset.noteId;
            if (!noteId) return;

            if (e.target.closest('.pin-note-btn')) {
                this.togglePinNote(noteId);
            } else if (e.target.closest('.edit-note-btn')) {
                this.startEditNote(noteId);
            } else if (e.target.closest('.delete-note-btn')) {
                this.deleteV2Note(noteId);
            } else if (e.target.closest('.save-edit-btn')) {
                this.saveEditNote(noteId);
            } else if (e.target.closest('.cancel-edit-btn')) {
                this.cancelEditNote(noteId);
            }
        });
    }

    /**
     * PRODUCTION: Toggle pin status of note
     */
    togglePinNote(noteId) {
        const note = this.notes.find(n => n.id == noteId);
        if (!note) return;

        note.isPinned = !note.isPinned;
        note.updatedAt = new Date().toISOString();
        
        // Move pinned notes to top, unpinned notes to their proper position
        this.notes = this.notes.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });

        this.renderV2Notes();
        this.setUnsavedChanges(true);
        
        const action = note.isPinned ? 'pinned' : 'unpinned';
        this.showNotification(`Note ${action} successfully!`, 'success');
        
        console.log(`� Note ${action}:`, note.title);
    }

    /**
     * GOLD STANDARD: Start editing a note
     */
    startEditNote(noteId) {
        const note = this.notes.find(n => n.id == noteId);
        if (!note) return;

        // Set all other notes to not editing
        this.notes.forEach(n => n.isEditing = false);
        
        // Set this note to editing mode
        note.isEditing = true;
        
        this.renderV2Notes();
        
        // Focus on the content textarea
        setTimeout(() => {
            const textarea = document.querySelector(`[data-note-id="${noteId}"] .note-content-edit`);
            if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }
        }, 100);
    }

    /**
     * PRODUCTION: Save edited note
     */
    saveEditNote(noteId) {
        const note = this.notes.find(n => n.id == noteId);
        if (!note) return;

        const noteCard = document.querySelector(`[data-note-id="${noteId}"]`);
        const titleInput = noteCard?.querySelector('.note-title-edit');
        const contentTextarea = noteCard?.querySelector('.note-content-edit');

        if (!contentTextarea?.value.trim()) {
            this.showNotification('Note content cannot be empty', 'error');
            return;
        }

        // Update note data
        const newTitle = titleInput?.value.trim() || this.extractTitleFromContent(contentTextarea.value);
        const newContent = contentTextarea.value.trim();
        
        note.title = newTitle;
        note.content = newContent;
        note.tags = this.extractTagsFromContent(newContent);
        note.updatedAt = new Date().toISOString();
        note.isEditing = false;

        this.renderV2Notes();
        this.setUnsavedChanges(true);
        this.showNotification('Note updated successfully!', 'success');
        
        console.log('💾 Note saved:', note.title);
    }

    /**
     * GOLD STANDARD: Cancel editing a note
     */
    cancelEditNote(noteId) {
        const note = this.notes.find(n => n.id == noteId);
        if (!note) return;

        note.isEditing = false;
        this.renderV2Notes();
        
        console.log('❌ Cancelled editing note:', note.title);
    }

    /**
     * GOLD STANDARD: Delete note with confirmation
     */
    deleteV2Note(noteId) {
        const note = this.notes.find(n => n.id == noteId);
        if (!note) return;

        const confirmMessage = `Are you sure you want to delete "${note.title}"?\n\nThis action cannot be undone.`;
        
        if (!confirm(confirmMessage)) return;

        this.notes = this.notes.filter(n => n.id != noteId);
        this.renderV2Notes();
        this.setUnsavedChanges(true);
        this.showNotification('Note deleted successfully!', 'success');
    }

    /**
     * GOLD STANDARD: Update notes counts in header
     */
    updateNotesCounts() {
        const totalCount = document.getElementById('notes-count');
        const pinnedCount = document.getElementById('pinned-count');
        
        if (totalCount) totalCount.textContent = this.notes.length;
        if (pinnedCount) pinnedCount.textContent = this.notes.filter(n => n.isPinned).length;
    }

    /**
     * GOLD STANDARD: Sort notes based on selected criteria
     */
    sortNotes(notes) {
        const sortSelect = document.getElementById('notes-sort');
        const sortBy = sortSelect?.value || 'updated-desc';

        return notes.sort((a, b) => {
            // Always keep pinned notes at top within their group
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
    }

    /**
     * GOLD STANDARD: Setup notes search and filtering functionality
     */
    setupNotesSearch() {
        console.log('🔍 Setting up notes search functionality...');
        
        // Initialize search input if it exists
        const searchInput = document.getElementById('notes-search');
        if (searchInput) {
            // Clear any existing value
            searchInput.value = '';
            
            // Set placeholder
            searchInput.placeholder = 'Search notes by title or content...';
            
            console.log('✅ Notes search input initialized');
        }

        // Initialize category filter if it exists
        const categoryFilter = document.getElementById('notes-category-filter');
        if (categoryFilter) {
            // Set default to 'all'
            categoryFilter.value = 'all';
            console.log('✅ Notes category filter initialized');
        }

        // Initialize sort selector if it exists
        const sortSelect = document.getElementById('notes-sort');
        if (sortSelect) {
            // Set default sort
            sortSelect.value = 'updated-desc';
            console.log('✅ Notes sort selector initialized');
        }

        console.log('✅ Notes search setup complete');
    }

    /**
     * GOLD STANDARD: Filter notes based on search criteria
     */
    filterNotes() {
        const searchInput = document.getElementById('notes-search');
        const categoryFilter = document.getElementById('notes-category-filter');
        
        const searchTerm = searchInput?.value.toLowerCase().trim() || '';
        const selectedCategory = categoryFilter?.value || 'all';

        // Filter notes based on criteria
        let filteredNotes = this.notes;

        // Apply search filter
        if (searchTerm) {
            filteredNotes = filteredNotes.filter(note => {
                const title = (note.title || '').toLowerCase();
                const content = (note.content || note.text || '').toLowerCase();
                return title.includes(searchTerm) || content.includes(searchTerm);
            });
        }

        // Apply category filter
        if (selectedCategory && selectedCategory !== 'all') {
            filteredNotes = filteredNotes.filter(note => 
                note.category === selectedCategory
            );
        }

        // Sort the filtered notes
        const sortedNotes = this.sortNotes(filteredNotes);

        // Re-render with filtered notes
        this.renderFilteredNotes(sortedNotes);

        console.log(`🔍 Filtered notes: ${filteredNotes.length} of ${this.notes.length} notes shown`);
    }

    /**
     * GOLD STANDARD: Render filtered notes (separate from main render to avoid recursion)
     */
    renderFilteredNotes(filteredNotes) {
        const notesContainer = document.getElementById('notes-list');
        if (!notesContainer) {
            console.warn('Notes container not found for filtering');
            return;
        }

        if (filteredNotes.length === 0) {
            notesContainer.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-search text-4xl mb-4 text-gray-300"></i>
                    <p class="text-lg font-medium">No notes found</p>
                    <p class="text-sm">Try adjusting your search criteria</p>
                </div>
            `;
            return;
        }

        // Render the filtered notes
        const notesHTML = filteredNotes.map(note => this.generateNoteHTML(note)).join('');
        notesContainer.innerHTML = notesHTML;

        // Re-attach event listeners for the rendered notes
        this.attachNoteEventListeners();
    }

    /**
     * GOLD STANDARD: Attach event listeners to note elements
     */
    attachNoteEventListeners() {
        // Pin/unpin functionality
        document.querySelectorAll('.pin-note').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const noteId = e.target.closest('.note-item').dataset.noteId;
                this.togglePinNote(noteId);
            });
        });

        // Delete functionality
        document.querySelectorAll('.delete-note').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const noteId = e.target.closest('.note-item').dataset.noteId;
                this.deleteV2Note(noteId);
            });
        });

        // Edit functionality
        document.querySelectorAll('.edit-note').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const noteId = e.target.closest('.note-item').dataset.noteId;
                this.startEditNote(noteId);
            });
        });
    }

    /**
     * GOLD STANDARD: Generate HTML for a single note
     */
    generateNoteHTML(note) {
        const dateStr = new Date(note.updatedAt).toLocaleDateString();
        const timeStr = new Date(note.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        return `
            <div class="note-item bg-white rounded-lg border border-gray-200 p-4 mb-4 hover:shadow-md transition-shadow ${note.isPinned ? 'ring-2 ring-yellow-200 bg-yellow-50' : ''}" data-note-id="${note.id}">
                <div class="flex justify-between items-start mb-2">
                    <h4 class="font-semibold text-gray-900 ${note.isPinned ? 'text-yellow-800' : ''}">${this.escapeHtml(note.title)}</h4>
                    <div class="flex items-center space-x-2">
                        ${note.isPinned ? '<i class="fas fa-thumbtack text-yellow-600" title="Pinned"></i>' : ''}
                        <button class="pin-note text-gray-400 hover:text-yellow-600" title="${note.isPinned ? 'Unpin' : 'Pin'} note">
                            <i class="fas fa-thumbtack"></i>
                        </button>
                        <button class="edit-note text-gray-400 hover:text-blue-600" title="Edit note">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="delete-note text-gray-400 hover:text-red-600" title="Delete note">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <p class="text-gray-700 text-sm mb-2">${this.escapeHtml(note.content || note.text || '')}</p>
                <div class="flex justify-between items-center text-xs text-gray-500">
                    <span class="bg-gray-100 px-2 py-1 rounded">${note.category || 'general'}</span>
                    <span>${dateStr} at ${timeStr}</span>
                </div>
            </div>
        `;
    }

    /**
     * GOLD STANDARD: Collect ClientsVia agent personality settings (migrated from HTML)
     */
    async saveClientsviaAgentPersonalitySettings() {
        const companyId = this.companyId;
        if (!companyId) return;

        const personalitySettings = {
            voiceTone: document.getElementById('clientsvia-voiceToneSelect')?.value,
            speechPace: document.getElementById('clientsvia-speechPaceSelect')?.value,
            bargeIn: document.getElementById('clientsvia-bargeInToggle')?.checked,
            acknowledgeEmotion: document.getElementById('clientsvia-emotionToggle')?.checked,
            useEmojis: document.getElementById('clientsvia-emojiToggle')?.checked
        };

        try {
            const response = await fetch(`${this.apiBaseUrl}/api/company/${companyId}/personality`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ personalitySettings })
            });

            if (response.ok) {
                const saved = document.getElementById('clientsvia-personality-settings-saved');
                if (saved) {
                    saved.classList.remove('hidden');
                    setTimeout(() => saved.classList.add('hidden'), 3000);
                }
                console.log('✅ ClientsVia personality settings saved successfully');
                this.showNotification('ClientsVia personality settings saved successfully', 'success');
            } else if (response.status === 404) {
                console.warn('⚠️ ClientsVia personality settings endpoint not implemented yet');
                this.showNotification('ClientsVia personality settings endpoint not implemented yet', 'warning');
            } else {
                throw new Error(`HTTP ${response.status}: Failed to save personality settings`);
            }
        } catch (error) {
            console.error('❌ Failed to save ClientsVia personality settings:', error);
            this.showNotification(`Failed to save ClientsVia personality settings: ${error.message}`, 'error');
        }
    }

    /**
     * Save response templates (migrated from legacy company-profile.js)
     */
    async saveResponseTemplates() {
        try {
            // Use existing personality save logic since templates are part of personality responses
            await this.savePersonalityResponses();
            console.log('✅ Response templates saved via personality system');
        } catch (error) {
            console.error('❌ Failed to save response templates:', error);
            this.showNotification(`Failed to save response templates: ${error.message}`, 'error');
        }
    }

    /**
     * Save learning settings (placeholder - function called from HTML but not implemented)
     */
    async saveLearningSettings() {
        console.warn('⚠️ saveLearningSettings() called but not implemented - using general save');
        try {
            // Fall back to saving all changes
            await this.saveAllChanges();
            this.showNotification('Settings saved successfully', 'success');
        } catch (error) {
            console.error('❌ Failed to save learning settings:', error);
            this.showNotification(`Failed to save settings: ${error.message}`, 'error');
        }
    }

    /**
     * Setup event handlers for legacy onclick functions (removes onclick attributes)
     */
    setupLegacyEventHandlers() {
        // Handle saveClientsviaAgentPersonalitySettings
        const personalityBtn = document.querySelector('[onclick*="saveClientsviaAgentPersonalitySettings"]');
        if (personalityBtn) {
            personalityBtn.removeAttribute('onclick');
            personalityBtn.addEventListener('click', () => {
                this.saveClientsviaAgentPersonalitySettings();
            });
        }

        // Handle saveResponseTemplates  
        const templatesBtn = document.querySelector('[onclick*="saveResponseTemplates"]');
        if (templatesBtn) {
            templatesBtn.removeAttribute('onclick');
            templatesBtn.addEventListener('click', () => {
                this.saveResponseTemplates();
            });
        }

        // Handle saveLearningSettings
        const learningBtn = document.querySelector('[onclick*="saveLearningSettings"]');
        if (learningBtn) {
            learningBtn.removeAttribute('onclick');
            learningBtn.addEventListener('click', () => {
                this.saveLearningSettings();
            });
        }

        console.log('✅ Legacy onclick handlers migrated to modern event listeners');
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

    /**
     * MISSING CRITICAL METHODS - Added to fix initialization errors
     */
    
    /* ========================================================================
       🗂️ TAB MANAGEMENT SYSTEM
       ======================================================================== */

    /**
     * Initialize tab system
     */
    initializeTabs() {
        console.log('📑 Initializing tabs system...');
        
        // Setup tab switching logic if not already handled by HTML
        const tabButtons = document.querySelectorAll('[data-tab]');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTab = button.getAttribute('data-tab');
                this.switchTab(targetTab);
            });
        });
        
        // Set initial tab to overview
        this.switchTab('overview');
        
        console.log('✅ Tabs system initialized');
    }
    
    /**
     * Switch to specified tab
     * @param {string} tabName - Name of tab to switch to
     */
    switchTab(tabName) {
        // Update current tab
        this.currentTab = tabName;
        
        // Update active states for tab buttons - use correct CSS classes
        document.querySelectorAll('[data-tab]').forEach(btn => {
            btn.classList.remove('active', 'tab-button-active');
            btn.classList.add('tab-button-inactive');
        });
        
        // Hide all tab content items
        document.querySelectorAll('.tab-content-item').forEach(pane => {
            pane.classList.add('hidden');
        });
        
        // Activate target tab button - use correct CSS classes
        const targetButton = document.querySelector(`[data-tab="${tabName}"]`);
        if (targetButton) {
            targetButton.classList.add('active', 'tab-button-active');
            targetButton.classList.remove('tab-button-inactive');
        }
        
        // Show target tab content
        const targetPane = document.getElementById(`${tabName}-content`);
        if (targetPane) {
            targetPane.classList.remove('hidden');
        } else {
            // Fallback: try with exact tabName as ID
            const fallbackPane = document.getElementById(tabName);
            if (fallbackPane) {
                fallbackPane.classList.remove('hidden');
            }
        }
        
        console.log(`📑 Switched to tab: ${tabName}`);
        
        // ✅ PRODUCTION: Knowledge Sources integrated into AI Agent Logic Tab 2
        // 🗑️ CLEAN SWEEP: Legacy knowledge-sources tab handling removed
    }

    /**
     * ✅ PRODUCTION: V2 Company Q&A Manager Integration
     * 🚀 PERFORMANCE: Embedded directly in AI Agent Logic Tab 2
     * 🛡️ SECURITY: Multi-tenant isolation with companyId validation
     * ⚡ REAL-TIME: Live AI agent testing and confidence scoring
     */
    initializeEmbeddedCompanyQnAManager() {
        console.log('🚀 PRODUCTION: Initializing embedded Company Q&A Manager in AI Agent Logic Tab 2');
        
        // Initialize the embedded interface
        this.loadCompanyQnAEntries();
        this.setupQnAEventListeners();
        this.initializeRealTimeTestingFeatures();
        
        console.log('✅ V2 Company Q&A Manager ready - integrated with AI Agent Logic');
    }

    // ✅ PRODUCTION: Legacy knowledge sub-tabs removed
    // 🗑️ CLEAN SWEEP: setupKnowledgeSubTabs() eliminated - functionality integrated into AI Agent Logic Tab 2

    // Legacy sub-tab system completely removed - using modern AI Agent Logic 4-tab system
    // Old switchKnowledgeSubTab() function eliminated - functionality moved to new system

    /**
     * Initialize Company Q&A Manager
     */
    initializeCompanyQnAManager() {
        if (this.companyQnAManager) {
            console.log('📚 Company Q&A Manager already initialized');
            return;
        }

        try {
            console.log('🚀 Initializing Company Q&A Manager...');
            
            // Create a simple API client for the CompanyQnAManager
            const apiClient = {
                baseUrl: this.apiBaseUrl,
                
                // GET request wrapper
                get: async (url) => {
                    const response = await fetch(`${this.apiBaseUrl}${url}`, {
                        method: 'GET',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    return response.json();
                },
                
                // POST request wrapper
                post: async (url, data) => {
                    const response = await fetch(`${this.apiBaseUrl}${url}`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    return response.json();
                },
                
                // PUT request wrapper
                put: async (url, data) => {
                    const response = await fetch(`${this.apiBaseUrl}${url}`, {
                        method: 'PUT',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    return response.json();
                },
                
                // DELETE request wrapper
                delete: async (url) => {
                    const response = await fetch(`${this.apiBaseUrl}${url}`, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    return response.json();
                }
            };

            // Initialize CompanyQnAManager if the class is available
            if (typeof CompanyQnAManager !== 'undefined') {
                this.companyQnAManager = new CompanyQnAManager('company-qna-manager-container', apiClient);
                
                // Set the current company ID
                if (this.companyId) {
                    this.companyQnAManager.setCompanyId(this.companyId);
                }
                
                console.log('✅ Company Q&A Manager initialized successfully');
            } else {
                console.error('❌ CompanyQnAManager class not found. Make sure the script is loaded.');
                this.showNotification('Failed to load Company Q&A Manager', 'error');
            }
            
        } catch (error) {
            console.error('❌ Failed to initialize Company Q&A Manager:', error);
            this.showNotification('Failed to initialize Company Q&A Manager', 'error');
        }
    }
    
    /**
     * Update header elements with company data
     */
    updateHeaderElements() {
        if (!this.currentData) {
            console.log('⚠️ No data available for header update');
            return;
        }
        
        try {
            // Update company name in header if element exists
            const companyNameElement = document.getElementById('company-name-header');
            if (companyNameElement && this.currentData.companyName) {
                companyNameElement.textContent = this.currentData.companyName;
            }
            
            // Update page title
            if (this.currentData.companyName) {
                document.title = `${this.currentData.companyName} - Company Profile`;
            }
            
            // Update any other header elements
            const companyIdElement = document.getElementById('company-id-subheader');
            if (companyIdElement) {
                companyIdElement.textContent = `ID: ${this.companyId}`;
            }
            
            console.log('✅ Header elements updated');
        } catch (error) {
            console.error('❌ Error updating header elements:', error);
        }
    }
    
    // ============================================================================
    // 🏗️ MISSING POPULATE FUNCTIONS - FIXING LOOSE HANGING CODES
    // ============================================================================
    
    // 🗑️ DELETED: populateCalendarSettingsTab() - Calendar tab destroyed

    /**
     * Populate AI Settings tab
     */
    populateAISettingsTab() {
        console.log('🤖 Populating AI Settings tab...');
        
        try {
            if (this.currentData) {
                // Populate AI core personality
                const personalitySelect = document.getElementById('aiCorePersonality');
                if (personalitySelect && this.currentData.aiCorePersonality) {
                    personalitySelect.value = this.currentData.aiCorePersonality;
                }
                
                // Populate other AI settings fields as needed
                // Additional AI settings population can be added here
            }
            
            console.log('✅ AI Settings tab populated');
        } catch (error) {
            console.error('❌ Error populating AI Settings tab:', error);
        }
    }

    /**
     * Populate Voice tab (AI Voice Settings)
     */
    populateVoiceTab() {
        console.log('🎤 Populating Voice tab...');
        
        try {
            if (this.currentData) {
                // Populate voice selector
                const voiceSelector = document.getElementById('voice-selector');
                if (voiceSelector && this.currentData.voiceId) {
                    voiceSelector.value = this.currentData.voiceId;
                }
                
                // Voice settings are handled by embedded HTML forms and JavaScript
                // Voice loading and preview is handled by existing scripts
            }
            
            console.log('✅ Voice tab populated');
        } catch (error) {
            console.error('❌ Error populating Voice tab:', error);
        }
    }

    /**
     * Populate Personality tab (Agent Personality Responses)
     */
    populatePersonalityTab() {
        console.log('🎭 Populating Personality tab...');
        
        try {
            // Personality responses are handled by embedded HTML forms
            // No specific population needed as forms are already in HTML
            console.log('✅ Personality tab populated');
        } catch (error) {
            console.error('❌ Error populating Personality tab:', error);
        }
    }

    /**
     * Populate Agent Logic tab (AI Agent Logic)
     */
    populateAgentLogicTab() {
        console.log('🧠 Populating Agent Logic tab...');
        
        try {
            // AI Agent Logic settings are handled by embedded HTML forms and JavaScript
            // The tab contains complex intelligence and memory systems
            // No specific population needed as forms are already in HTML
            console.log('✅ Agent Logic tab populated');
        } catch (error) {
            console.error('❌ Error populating Agent Logic tab:', error);
        }
    }
    
    // ============================================================================
    // 🔧 UTILITY FUNCTIONS
    // ============================================================================

    /**
     * Show or hide loading indicator
     * @param {boolean} show - Whether to show loading state
     */
    showLoading(show) {
        // Create loading indicator if it doesn't exist
        let loadingIndicator = document.getElementById('global-loading-indicator');
        if (!loadingIndicator) {
            loadingIndicator = document.createElement('div');
            loadingIndicator.id = 'global-loading-indicator';
            loadingIndicator.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            loadingIndicator.innerHTML = `
                <div class="bg-white rounded-lg p-6 shadow-xl">
                    <div class="flex items-center space-x-3">
                        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                        <span class="text-gray-700">Loading...</span>
                    </div>
                </div>
            `;
            document.body.appendChild(loadingIndicator);
        }
        
        loadingIndicator.style.display = show ? 'flex' : 'none';
        
        // Also handle any loading buttons
        const loadingButtons = document.querySelectorAll('.loading');
        loadingButtons.forEach(btn => {
            if (show) {
                btn.disabled = true;
                btn.classList.add('opacity-50');
                const originalText = btn.innerHTML;
                btn.dataset.originalText = originalText;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Loading...';
            } else {
                btn.disabled = false;
                btn.classList.remove('opacity-50');
                if (btn.dataset.originalText) {
                    btn.innerHTML = btn.dataset.originalText;
                }
            }
        });
        
        console.log(`🔄 Loading indicator ${show ? 'shown' : 'hidden'}`);
    }
    
    /**
     * Show notification to user
     * @param {string} message - Message to display
     * @param {string} type - Type of notification (success, error, warning, info)
     */
    showNotification(message, type = 'info') {
        // Create notification container if it doesn't exist
        let notificationContainer = document.getElementById('notification-container');
        if (!notificationContainer) {
            notificationContainer = document.createElement('div');
            notificationContainer.id = 'notification-container';
            notificationContainer.className = 'fixed top-4 right-4 z-50 space-y-2';
            document.body.appendChild(notificationContainer);
        }
        
        const notification = document.createElement('div');
        const baseClasses = 'p-4 rounded-lg shadow-lg transition-all duration-300 max-w-sm';
        const typeClasses = {
            success: 'bg-green-100 border border-green-400 text-green-700',
            error: 'bg-red-100 border border-red-400 text-red-700', 
            warning: 'bg-yellow-100 border border-yellow-400 text-yellow-700',
            info: 'bg-blue-100 border border-blue-400 text-blue-700'
        };
        
        notification.className = `${baseClasses} ${typeClasses[type] || typeClasses.info}`;
        
        const icons = {
            success: '✅',
            error: '❌', 
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        notification.innerHTML = `
            <div class="flex items-start justify-between">
                <div class="flex items-start">
                    <span class="mr-2 text-lg">${icons[type] || icons.info}</span>
                    <span class="text-sm font-medium">${message}</span>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" 
                        class="ml-3 text-lg hover:opacity-75 focus:outline-none">×</button>
            </div>
        `;
        
        notificationContainer.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
        
        console.log(`📢 Notification (${type}): ${message}`);
    }

    /* ========================================================================
       🔧 UTILITY FUNCTIONS
       ======================================================================== */

    /**
     * Escape HTML to prevent XSS attacks
     * @param {string} str - String to escape
     * @returns {string} Escaped HTML string
     */
    escapeHtml(str) {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Debounce utility method for delayed function execution
     * @param {Function} func - Function to debounce
     * @param {number} wait - Delay in milliseconds
     * @returns {Function} Debounced function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Local Company Q&A Manager removed - tab was deleted per user request
}

/* ============================================================================
   🌐 GLOBAL FUNCTION EXPOSURE FOR HTML SCRIPT COMPATIBILITY
   ============================================================================ */

// Expose fetchCompanyData function globally for HTML script calls
window.fetchCompanyData = async function() {
    console.log('🌐 Global fetchCompanyData called');
    
    // Wait for CompanyProfileManager to be available
    const waitForManager = () => {
        return new Promise((resolve) => {
            const checkManager = () => {
                if (window.companyProfileManager) {
                    resolve();
                } else {
                    setTimeout(checkManager, 50); // Check every 50ms
                }
            };
            checkManager();
        });
    };
    
    try {
        await waitForManager();
        await window.companyProfileManager.loadCompanyData();
        console.log('✅ Global fetchCompanyData completed');
    } catch (error) {
        console.error('❌ Global fetchCompanyData failed:', error);
    }
};

/* ============================================================================
   🚀 INITIALIZATION & EXPORTS
   ============================================================================ */

// Global instance
let companyProfileManager = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        companyProfileManager = new CompanyProfileManager();
        
        // Set global reference BEFORE initializing
        window.companyProfileManager = companyProfileManager;
        
        await companyProfileManager.init();
        
        // Initialize tab managers
        console.log('🔧 Initializing tab managers...');
        // ... other inits like KnowledgePriorities if present
        
        // Debug functions...
    } catch (error) {
        console.error('❌ Failed to initialize:', error);
    }
});

// Export for global access
window.CompanyProfileManager = CompanyProfileManager;
