console.log('🚀 Loading company-profile-modern.js v2.8 - Clean Method Definitions');

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
            // 🗑️ REMOVED: this.createSaveButton(); - Using dedicated section-specific save buttons instead
            
            // Load company data
            await this.loadCompanyData();
            
            // Initialize tabs
            this.initializeTabs();
            
            this.initialized = true;
            
            // Debug: Check all required methods exist
            const requiredMethods = ['showLoading', 'showNotification', 'debounce', 'renderEnterpriseContactsSection', 'updateHeaderElements', 'initializeTabs'];
            const missingMethods = requiredMethods.filter(method => typeof this[method] !== 'function');
            if (missingMethods.length > 0) {
                console.error('❌ Missing methods:', missingMethods);
            } else {
                console.log('✅ All required methods available');
            }
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
        // First check if company ID was already set by HTML initialization
        if (window.companyId) {
            this.companyId = window.companyId;
            console.log('🔍 Using company ID from global window:', this.companyId);
        } else {
            // Fallback: extract from URL directly
            const urlParams = new URLSearchParams(window.location.search);
            this.companyId = urlParams.get('id');
            console.log('🔍 Extracted company ID from URL:', this.companyId);
        }
        
        // For testing - provide default ID if none provided
        if (!this.companyId) {
            this.companyId = 'test123';
            console.warn('⚠️ No company ID found in URL parameters, using test ID:', this.companyId);
        }
        
        // Set global references for legacy compatibility
        window.currentCompanyId = this.companyId;
        window.companyId = this.companyId;
        
        console.log('🔍 Final company ID set:', this.companyId);
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
     * GOLD STANDARD: Populate Overview tab with enterprise-grade UX
     * Features: Live validation, auto-save, accessibility, error recovery
     */
    populateOverviewTab() {
        if (!this.currentData) {
            this.showNotification('Company data not loaded', 'error');
            return;
        }

        console.log('📄 Populating Overview tab with enterprise features...');

        try {
            // Update header elements with current data
            this.updateHeaderElements();

            // Create modern always-editable form with validation
            this.createEnterpriseEditableForm();

            // Initialize contacts management with enterprise features
            this.initializeContactsManagement();
            
            // Setup comprehensive validation and auto-save
            this.setupEnterpriseFormValidation();

            console.log('✅ Overview tab initialized with enterprise features');
        } catch (error) {
            console.error('❌ Error initializing Overview tab:', error);
            this.showNotification('Failed to initialize Overview tab', 'error');
        }
    }

    /**
     * GOLD STANDARD: Create enterprise-grade always-editable form
     * Features: Validation, accessibility, progressive enhancement
     */
    createEnterpriseEditableForm() {
        if (!this.domElements.editFormContainer) {
            console.error('❌ Edit form container not found');
            return;
        }

        const formHTML = this.generateEnterpriseFormHTML();
        this.domElements.editFormContainer.innerHTML = formHTML;
        this.domElements.editFormContainer.classList.remove('hidden');

        // Hide legacy edit button (form is always visible)
        if (this.domElements.editButton) {
            this.domElements.editButton.style.display = 'none';
        }

        // Initialize enterprise form features
        this.initializeFormAccessibility();
        this.setupFormAutoSave();
        
        console.log('🔧 Enterprise editable form created');
    }

    /**
     * GOLD STANDARD: Generate enterprise form HTML with validation
     */
    generateEnterpriseFormHTML() {
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-textarea enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                            class="form-textarea enterprise-input" 
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
                                <span class="text-sm text-blue-900 font-semibold">Enterprise Live Editing</span>
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
     * GOLD STANDARD: Setup enterprise form validation and auto-save
     */
    setupEnterpriseFormValidation() {
        const form = this.domElements.editFormContainer;
        if (!form) return;

        // Get all enterprise inputs
        const inputs = form.querySelectorAll('.enterprise-input');
        
        inputs.forEach(input => {
            // Real-time validation on input
            input.addEventListener('input', (e) => this.handleEnterpriseInput(e));
            input.addEventListener('blur', (e) => this.validateField(e.target));
            input.addEventListener('focus', (e) => this.clearFieldErrors(e.target));
        });

        // Special handling for description character counter
        const descriptionField = document.getElementById('edit-description');
        if (descriptionField) {
            descriptionField.addEventListener('input', () => this.updateCharacterCounter());
        }

        console.log('🔧 Enterprise validation setup complete');
    }

    /**
     * GOLD STANDARD: Handle enterprise input with validation and auto-save
     */
    handleEnterpriseInput(event) {
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
        
        console.log(`📝 Enterprise field changed: ${field.name} = ${field.value.substring(0, 50)}...`);
    }

    /**
     * GOLD STANDARD: Validate individual field with enterprise rules
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
     * GOLD STANDARD: Setup form auto-save with enterprise features
     */
    setupFormAutoSave() {
        // Auto-save after 2 seconds of inactivity
        this.autoSaveTimeout = null;
        
        const form = this.domElements.editFormContainer;
        if (!form) return;

        const inputs = form.querySelectorAll('.enterprise-input');
        inputs.forEach(input => {
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

    /**
     * GOLD STANDARD: Initialize contacts management with enterprise features
     */
    initializeContactsManagement() {
        try {
            this.renderEnterpriseContactsSection();
            this.setupEnterpriseContactsHandlers();
            console.log('� Enterprise contacts management initialized');
        } catch (error) {
            console.error('❌ Error initializing contacts:', error);
            this.showNotification('Failed to initialize contacts section', 'error');
        }
    }

    /**
     * Render enterprise contacts section
     */
    renderEnterpriseContactsSection() {
        console.log('👥 Rendering enterprise contacts section...');
        
        const contactsContainer = document.getElementById('contacts-container');
        if (!contactsContainer) {
            console.warn('⚠️ Contacts container not found');
            return;
        }
        
        const contacts = this.currentData?.contacts || [];
        
        if (contacts.length === 0) {
            contactsContainer.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <div class="text-4xl mb-4">👥</div>
                    <p>No contacts added yet</p>
                    <button class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                            onclick="addNewContact()">
                        Add First Contact
                    </button>
                </div>
            `;
            return;
        }
        
        // Render contacts list
        const contactsHTML = contacts.map((contact, index) => `
            <div class="bg-white border rounded-lg p-4 shadow-sm">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <h4 class="font-semibold text-gray-900">${contact.name || 'Unnamed Contact'}</h4>
                        <p class="text-sm text-gray-600">${contact.role || 'No role specified'}</p>
                        <div class="mt-2 space-y-1">
                            ${contact.email ? `<p class="text-sm text-gray-700">📧 ${contact.email}</p>` : ''}
                            ${contact.phone ? `<p class="text-sm text-gray-700">📞 ${contact.phone}</p>` : ''}
                        </div>
                    </div>
                    <div class="flex space-x-2">
                        <button onclick="editContact(${index})" 
                                class="text-blue-600 hover:text-blue-800 text-sm">Edit</button>
                        <button onclick="deleteContact(${index})" 
                                class="text-red-600 hover:text-red-800 text-sm">Delete</button>
                    </div>
                </div>
            </div>
        `).join('');
        
        contactsContainer.innerHTML = `
            <div class="space-y-4">
                <div class="flex justify-between items-center">
                    <h3 class="text-lg font-medium">Contacts (${contacts.length})</h3>
                    <button onclick="addNewContact()" 
                            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                        Add Contact
                    </button>
                </div>
                <div class="space-y-3">
                    ${contactsHTML}
                </div>
            </div>
        `;
        
        console.log(`✅ Rendered ${contacts.length} contacts`);
    }
    
    /**
     * Debounce utility function to limit function calls
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
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
     * GOLD STANDARD: Populate Overview tab with enterprise-grade UX
     * Features: Live validation, auto-save, accessibility, error recovery
     */
    populateOverviewTab() {
        if (!this.currentData) {
            this.showNotification('Company data not loaded', 'error');
            return;
        }

        console.log('📄 Populating Overview tab with enterprise features...');

        try {
            // Update header elements with current data
            this.updateHeaderElements();

            // Create modern always-editable form with validation
            this.createEnterpriseEditableForm();

            // Initialize contacts management with enterprise features
            this.initializeContactsManagement();
            
            // Setup comprehensive validation and auto-save
            this.setupEnterpriseFormValidation();

            console.log('✅ Overview tab initialized with enterprise features');
        } catch (error) {
            console.error('❌ Error initializing Overview tab:', error);
            this.showNotification('Failed to initialize Overview tab', 'error');
        }
    }

    /**
     * GOLD STANDARD: Create enterprise-grade always-editable form
     * Features: Validation, accessibility, progressive enhancement
     */
    createEnterpriseEditableForm() {
        if (!this.domElements.editFormContainer) {
            console.error('❌ Edit form container not found');
            return;
        }

        const formHTML = this.generateEnterpriseFormHTML();
        this.domElements.editFormContainer.innerHTML = formHTML;
        this.domElements.editFormContainer.classList.remove('hidden');

        // Hide legacy edit button (form is always visible)
        if (this.domElements.editButton) {
            this.domElements.editButton.style.display = 'none';
        }

        // Initialize enterprise form features
        this.initializeFormAccessibility();
        this.setupFormAutoSave();
        
        console.log('🔧 Enterprise editable form created');
    }

    /**
     * GOLD STANDARD: Generate enterprise form HTML with validation
     */
    generateEnterpriseFormHTML() {
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-textarea enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                            class="form-textarea enterprise-input" 
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
                                <span class="text-sm text-blue-900 font-semibold">Enterprise Live Editing</span>
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
     * GOLD STANDARD: Setup enterprise form validation and auto-save
     */
    setupEnterpriseFormValidation() {
        const form = this.domElements.editFormContainer;
        if (!form) return;

        // Get all enterprise inputs
        const inputs = form.querySelectorAll('.enterprise-input');
        
        inputs.forEach(input => {
            // Real-time validation on input
            input.addEventListener('input', (e) => this.handleEnterpriseInput(e));
            input.addEventListener('blur', (e) => this.validateField(e.target));
            input.addEventListener('focus', (e) => this.clearFieldErrors(e.target));
        });

        // Special handling for description character counter
        const descriptionField = document.getElementById('edit-description');
        if (descriptionField) {
            descriptionField.addEventListener('input', () => this.updateCharacterCounter());
        }

        console.log('🔧 Enterprise validation setup complete');
    }

    /**
     * GOLD STANDARD: Handle enterprise input with validation and auto-save
     */
    handleEnterpriseInput(event) {
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
        
        console.log(`📝 Enterprise field changed: ${field.name} = ${field.value.substring(0, 50)}...`);
    }

    /**
     * GOLD STANDARD: Validate individual field with enterprise rules
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
     * GOLD STANDARD: Setup form auto-save with enterprise features
     */
    setupFormAutoSave() {
        // Auto-save after 2 seconds of inactivity
        this.autoSaveTimeout = null;
        
        const form = this.domElements.editFormContainer;
        if (!form) return;

        const inputs = form.querySelectorAll('.enterprise-input');
        inputs.forEach(input => {
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

    /**
     * GOLD STANDARD: Initialize contacts management with enterprise features
     */
    initializeContactsManagement() {
        try {
            this.renderEnterpriseContactsSection();
            this.setupEnterpriseContactsHandlers();
            console.log('� Enterprise contacts management initialized');
        } catch (error) {
            console.error('❌ Error initializing contacts:', error);
            this.showNotification('Failed to initialize contacts section', 'error');
        }
    }

    /**
     * Render enterprise contacts section
     */
    renderEnterpriseContactsSection() {
        console.log('👥 Rendering enterprise contacts section...');
        
        const contactsContainer = document.getElementById('contacts-container');
        if (!contactsContainer) {
            console.warn('⚠️ Contacts container not found');
            return;
        }
        
        const contacts = this.currentData?.contacts || [];
        
        if (contacts.length === 0) {
            contactsContainer.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <div class="text-4xl mb-4">👥</div>
                    <p>No contacts added yet</p>
                    <button class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                            onclick="addNewContact()">
                        Add First Contact
                    </button>
                </div>
            `;
            return;
        }
        
        // Render contacts list
        const contactsHTML = contacts.map((contact, index) => `
            <div class="bg-white border rounded-lg p-4 shadow-sm">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <h4 class="font-semibold text-gray-900">${contact.name || 'Unnamed Contact'}</h4>
                        <p class="text-sm text-gray-600">${contact.role || 'No role specified'}</p>
                        <div class="mt-2 space-y-1">
                            ${contact.email ? `<p class="text-sm text-gray-700">📧 ${contact.email}</p>` : ''}
                            ${contact.phone ? `<p class="text-sm text-gray-700">📞 ${contact.phone}</p>` : ''}
                        </div>
                    </div>
                    <div class="flex space-x-2">
                        <button onclick="editContact(${index})" 
                                class="text-blue-600 hover:text-blue-800 text-sm">Edit</button>
                        <button onclick="deleteContact(${index})" 
                                class="text-red-600 hover:text-red-800 text-sm">Delete</button>
                    </div>
                </div>
            </div>
        `).join('');
        
        contactsContainer.innerHTML = `
            <div class="space-y-4">
                <div class="flex justify-between items-center">
                    <h3 class="text-lg font-medium">Contacts (${contacts.length})</h3>
                    <button onclick="addNewContact()" 
                            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                        Add Contact
                    </button>
                </div>
                <div class="space-y-3">
                    ${contactsHTML}
                </div>
            </div>
        `;
        
        console.log(`✅ Rendered ${contacts.length} contacts`);
    }
    
    /**
     * Debounce utility function to limit function calls
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
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
     * GOLD STANDARD: Populate Overview tab with enterprise-grade UX
     * Features: Live validation, auto-save, accessibility, error recovery
     */
    populateOverviewTab() {
        if (!this.currentData) {
            this.showNotification('Company data not loaded', 'error');
            return;
        }

        console.log('📄 Populating Overview tab with enterprise features...');

        try {
            // Update header elements with current data
            this.updateHeaderElements();

            // Create modern always-editable form with validation
            this.createEnterpriseEditableForm();

            // Initialize contacts management with enterprise features
            this.initializeContactsManagement();
            
            // Setup comprehensive validation and auto-save
            this.setupEnterpriseFormValidation();

            console.log('✅ Overview tab initialized with enterprise features');
        } catch (error) {
            console.error('❌ Error initializing Overview tab:', error);
            this.showNotification('Failed to initialize Overview tab', 'error');
        }
    }

    /**
     * GOLD STANDARD: Create enterprise-grade always-editable form
     * Features: Validation, accessibility, progressive enhancement
     */
    createEnterpriseEditableForm() {
        if (!this.domElements.editFormContainer) {
            console.error('❌ Edit form container not found');
            return;
        }

        const formHTML = this.generateEnterpriseFormHTML();
        this.domElements.editFormContainer.innerHTML = formHTML;
        this.domElements.editFormContainer.classList.remove('hidden');

        // Hide legacy edit button (form is always visible)
        if (this.domElements.editButton) {
            this.domElements.editButton.style.display = 'none';
        }

        // Initialize enterprise form features
        this.initializeFormAccessibility();
        this.setupFormAutoSave();
        
        console.log('🔧 Enterprise editable form created');
    }

    /**
     * GOLD STANDARD: Generate enterprise form HTML with validation
     */
    generateEnterpriseFormHTML() {
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-textarea enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                            class="form-textarea enterprise-input" 
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
                                <span class="text-sm text-blue-900 font-semibold">Enterprise Live Editing</span>
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
     * GOLD STANDARD: Setup enterprise form validation and auto-save
     */
    setupEnterpriseFormValidation() {
        const form = this.domElements.editFormContainer;
        if (!form) return;

        // Get all enterprise inputs
        const inputs = form.querySelectorAll('.enterprise-input');
        
        inputs.forEach(input => {
            // Real-time validation on input
            input.addEventListener('input', (e) => this.handleEnterpriseInput(e));
            input.addEventListener('blur', (e) => this.validateField(e.target));
            input.addEventListener('focus', (e) => this.clearFieldErrors(e.target));
        });

        // Special handling for description character counter
        const descriptionField = document.getElementById('edit-description');
        if (descriptionField) {
            descriptionField.addEventListener('input', () => this.updateCharacterCounter());
        }

        console.log('🔧 Enterprise validation setup complete');
    }

    /**
     * GOLD STANDARD: Handle enterprise input with validation and auto-save
     */
    handleEnterpriseInput(event) {
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
        
        console.log(`📝 Enterprise field changed: ${field.name} = ${field.value.substring(0, 50)}...`);
    }

    /**
     * GOLD STANDARD: Validate individual field with enterprise rules
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
     * GOLD STANDARD: Setup form auto-save with enterprise features
     */
    setupFormAutoSave() {
        // Auto-save after 2 seconds of inactivity
        this.autoSaveTimeout = null;
        
        const form = this.domElements.editFormContainer;
        if (!form) return;

        const inputs = form.querySelectorAll('.enterprise-input');
        inputs.forEach(input => {
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

    /**
     * GOLD STANDARD: Initialize contacts management with enterprise features
     */
    initializeContactsManagement() {
        try {
            this.renderEnterpriseContactsSection();
            this.setupEnterpriseContactsHandlers();
            console.log('� Enterprise contacts management initialized');
        } catch (error) {
            console.error('❌ Error initializing contacts:', error);
            this.showNotification('Failed to initialize contacts section', 'error');
        }
    }

    /**
     * Render enterprise contacts section
     */
    renderEnterpriseContactsSection() {
        console.log('👥 Rendering enterprise contacts section...');
        
        const contactsContainer = document.getElementById('contacts-container');
        if (!contactsContainer) {
            console.warn('⚠️ Contacts container not found');
            return;
        }
        
        const contacts = this.currentData?.contacts || [];
        
        if (contacts.length === 0) {
            contactsContainer.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <div class="text-4xl mb-4">👥</div>
                    <p>No contacts added yet</p>
                    <button class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                            onclick="addNewContact()">
                        Add First Contact
                    </button>
                </div>
            `;
            return;
        }
        
        // Render contacts list
        const contactsHTML = contacts.map((contact, index) => `
            <div class="bg-white border rounded-lg p-4 shadow-sm">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <h4 class="font-semibold text-gray-900">${contact.name || 'Unnamed Contact'}</h4>
                        <p class="text-sm text-gray-600">${contact.role || 'No role specified'}</p>
                        <div class="mt-2 space-y-1">
                            ${contact.email ? `<p class="text-sm text-gray-700">📧 ${contact.email}</p>` : ''}
                            ${contact.phone ? `<p class="text-sm text-gray-700">📞 ${contact.phone}</p>` : ''}
                        </div>
                    </div>
                    <div class="flex space-x-2">
                        <button onclick="editContact(${index})" 
                                class="text-blue-600 hover:text-blue-800 text-sm">Edit</button>
                        <button onclick="deleteContact(${index})" 
                                class="text-red-600 hover:text-red-800 text-sm">Delete</button>
                    </div>
                </div>
            </div>
        `).join('');
        
        contactsContainer.innerHTML = `
            <div class="space-y-4">
                <div class="flex justify-between items-center">
                    <h3 class="text-lg font-medium">Contacts (${contacts.length})</h3>
                    <button onclick="addNewContact()" 
                            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                        Add Contact
                    </button>
                </div>
                <div class="space-y-3">
                    ${contactsHTML}
                </div>
            </div>
        `;
        
        console.log(`✅ Rendered ${contacts.length} contacts`);
    }
    
    /**
     * Debounce utility function to limit function calls
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
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
     * GOLD STANDARD: Populate Overview tab with enterprise-grade UX
     * Features: Live validation, auto-save, accessibility, error recovery
     */
    populateOverviewTab() {
        if (!this.currentData) {
            this.showNotification('Company data not loaded', 'error');
            return;
        }

        console.log('📄 Populating Overview tab with enterprise features...');

        try {
            // Update header elements with current data
            this.updateHeaderElements();

            // Create modern always-editable form with validation
            this.createEnterpriseEditableForm();

            // Initialize contacts management with enterprise features
            this.initializeContactsManagement();
            
            // Setup comprehensive validation and auto-save
            this.setupEnterpriseFormValidation();

            console.log('✅ Overview tab initialized with enterprise features');
        } catch (error) {
            console.error('❌ Error initializing Overview tab:', error);
            this.showNotification('Failed to initialize Overview tab', 'error');
        }
    }

    /**
     * GOLD STANDARD: Create enterprise-grade always-editable form
     * Features: Validation, accessibility, progressive enhancement
     */
    createEnterpriseEditableForm() {
        if (!this.domElements.editFormContainer) {
            console.error('❌ Edit form container not found');
            return;
        }

        const formHTML = this.generateEnterpriseFormHTML();
        this.domElements.editFormContainer.innerHTML = formHTML;
        this.domElements.editFormContainer.classList.remove('hidden');

        // Hide legacy edit button (form is always visible)
        if (this.domElements.editButton) {
            this.domElements.editButton.style.display = 'none';
        }

        // Initialize enterprise form features
        this.initializeFormAccessibility();
        this.setupFormAutoSave();
        
        console.log('🔧 Enterprise editable form created');
    }

    /**
     * GOLD STANDARD: Generate enterprise form HTML with validation
     */
    generateEnterpriseFormHTML() {
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
                                class="form-input enterprise-input" 
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
    
    /**
     * Initialize tab system
     */
    initializeTabs() {
        console.log('📑 Initializing tabs system...');
        
        // Setup tab switching logic if not already handled by HTML
        const tabButtons = document.querySelectorAll('[data-tab]');
        const tabPanes = document.querySelectorAll('.tab-pane');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTab = button.getAttribute('data-tab');
                this.switchTab(targetTab);
            });
        });
        
        console.log('✅ Tabs system initialized');
    }
    
    /**
     * Switch to specified tab
     * @param {string} tabName - Name of tab to switch to
     */
    switchTab(tabName) {
        // Update current tab
        this.currentTab = tabName;
        
        // Update active states
        document.querySelectorAll('[data-tab]').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        
        // Activate target tab
        const targetButton = document.querySelector(`[data-tab="${tabName}"]`);
        const targetPane = document.getElementById(tabName);
        
        if (targetButton) targetButton.classList.add('active');
        if (targetPane) targetPane.classList.add('active');
        
        console.log(`📑 Switched to tab: ${tabName}`);
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
            const companyIdElement = document.getElementById('company-id-display');
            if (companyIdElement) {
                companyIdElement.textContent = this.companyId;
            }
            
            console.log('✅ Header elements updated');
        } catch (error) {
            console.error('❌ Error updating header elements:', error);
        }
    }
    
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

// ...existing code...
}

/**
 * GLOBAL FUNCTION EXPOSURE FOR HTML SCRIPT COMPATIBILITY
 * Following the proven pattern from the working implementation
 */

// Expose fetchCompanyData function globally for HTML script calls
window.fetchCompanyData = async function() {
    console.log('🌐 Global fetchCompanyData called');
    if (window.companyProfileManager) {
        try {
            await window.companyProfileManager.loadCompanyData();
            console.log('✅ Global fetchCompanyData completed');
        } catch (error) {
            console.error('❌ Global fetchCompanyData failed:', error);
        }
    } else {
        console.error('❌ CompanyProfileManager not available for fetchCompanyData');
    }
};

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
