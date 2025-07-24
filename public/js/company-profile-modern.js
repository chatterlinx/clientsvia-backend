console.log('🚀 Loading company-profile-modern.js v2.1 - Auth Token Fix');

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
                                type="url" 
                                id="edit-business-website" 
                                name="businessWebsite"
                                class="form-input enterprise-input" 
                                value="${this.escapeHtml(data.businessWebsite || '')}"
                                placeholder="https://www.yourcompany.com"
                                aria-describedby="business-website-help"
                                data-validate="url"
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
            descriptionField.addEventListener('input', this.updateCharacterCounter.bind(this));
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
     * GOLD STANDARD: Validation utility methods
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    isValidPhone(phone) {
        // Remove all non-digits for validation
        const cleaned = phone.replace(/\D/g, '');
        return cleaned.length >= 10 && cleaned.length <= 15;
    }

    isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * GOLD STANDARD: Update character counter for description field
     */
    updateCharacterCounter() {
        const descriptionField = document.getElementById('edit-description');
        const counter = document.getElementById('description-counter');
        
        if (descriptionField && counter) {
            const length = descriptionField.value.length;
            const maxLength = 1000;
            
            counter.textContent = `${length}/${maxLength} characters`;
            
            // Color coding based on usage
            if (length > maxLength * 0.9) {
                counter.className = 'text-xs text-red-600 font-medium';
            } else if (length > maxLength * 0.75) {
                counter.className = 'text-xs text-yellow-600';
            } else {
                counter.className = 'text-xs text-gray-500';
            }
        }
    }

    /**
     * GOLD STANDARD: Show field validation errors
     */
    showFieldErrors(field, errors) {
        const validationContainer = field.parentNode.querySelector('.field-validation');
        if (!validationContainer) return;

        validationContainer.innerHTML = errors.map(error => 
            `<div class="text-red-600 text-xs mt-1 flex items-center">
                <i class="fas fa-exclamation-circle mr-1"></i>
                ${error}
            </div>`
        ).join('');
        
        validationContainer.classList.remove('hidden');
        field.classList.add('border-red-300');
        field.classList.remove('border-green-300');
    }

    /**
     * GOLD STANDARD: Show field validation success
     */
    showFieldSuccess(field) {
        const validationContainer = field.parentNode.querySelector('.field-validation');
        if (validationContainer) {
            validationContainer.classList.add('hidden');
        }
        
        field.classList.remove('border-red-300');
        field.classList.add('border-green-300');
    }

    /**
     * GOLD STANDARD: Clear field errors on focus
     */
    clearFieldErrors(field) {
        const validationContainer = field.parentNode.querySelector('.field-validation');
        if (validationContainer) {
            validationContainer.classList.add('hidden');
        }
        
        field.classList.remove('border-red-300', 'border-green-300');
    }

    /**
     * GOLD STANDARD: Set form status indicator
     */
    setFormStatus(status, message) {
        const statusElement = document.getElementById('form-status');
        if (!statusElement) return;

        const statusConfigs = {
            ready: { color: 'text-green-700', bgColor: 'bg-green-500', icon: 'fas fa-check-circle' },
            typing: { color: 'text-blue-700', bgColor: 'bg-blue-500', icon: 'fas fa-edit' },
            pending: { color: 'text-yellow-700', bgColor: 'bg-yellow-500', icon: 'fas fa-clock' },
            saved: { color: 'text-green-700', bgColor: 'bg-green-500', icon: 'fas fa-check-circle' },
            error: { color: 'text-red-700', bgColor: 'bg-red-500', icon: 'fas fa-exclamation-circle' }
        };

        const config = statusConfigs[status] || statusConfigs.ready;
        
        statusElement.innerHTML = `
            <div class="w-2 h-2 ${config.bgColor} rounded-full mr-2 ${status === 'pending' ? 'animate-pulse' : ''}"></div>
            <span class="${config.color} font-medium">${message}</span>
        `;
    }

    /**
     * GOLD STANDARD: Update overall form validation status
     */
    updateFormStatus() {
        const form = this.domElements.editFormContainer;
        if (!form) return;

        const inputs = form.querySelectorAll('.enterprise-input');
        let allValid = true;
        let hasErrors = false;

        inputs.forEach(input => {
            const hasError = input.classList.contains('border-red-300');
            if (hasError) {
                allValid = false;
                hasErrors = true;
            }
        });

        const validationStatus = document.getElementById('validation-status');
        if (validationStatus) {
            if (allValid && !hasErrors) {
                validationStatus.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800';
                validationStatus.innerHTML = '<i class="fas fa-check-circle mr-1"></i>All fields valid';
                validationStatus.classList.remove('hidden');
            } else if (hasErrors) {
                validationStatus.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800';
                validationStatus.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i>Please fix errors';
                validationStatus.classList.remove('hidden');
            } else {
                validationStatus.classList.add('hidden');
            }
        }
    }

    /**
     * GOLD STANDARD: Perform auto-save operation
     */
    async performAutoSave() {
        if (!this.hasUnsavedChanges) return;

        try {
            console.log('💾 Performing auto-save...');
            await this.saveAllChanges(true); // true = silent save
            console.log('✅ Auto-save completed');
        } catch (error) {
            console.error('❌ Auto-save failed:', error);
            throw error;
        }
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
     * GOLD STANDARD: Populate Notes tab with enterprise-grade note management system
     * Features: Pin/unpin, edit in-place, timestamps, search, categories, auto-save
     */
    populateNotesTab() {
        console.log('📝 Initializing enterprise Notes management system...');
        
        // Initialize notes management system with advanced features
        this.initializeEnterpriseNotesSystem();
    }

    /**
     * GOLD STANDARD: Initialize enterprise notes management system
     */
    initializeEnterpriseNotesSystem() {
        console.log('📝 Initializing enterprise notes system...');
        console.log('📝 Current data notes:', this.currentData?.notes);
        
        // Initialize notes array with enterprise structure
        this.notes = this.currentData?.notes || [];
        console.log('📝 Notes after initialization:', this.notes);
        
        // Ensure notes have proper structure
        this.notes = this.notes.map(note => this.normalizeNoteStructure(note));
        console.log('📝 Notes after normalization:', this.notes);
        
        // Setup enterprise notes interface
        this.setupEnterpriseNotesInterface();
        
        // Render notes with advanced features
        this.renderEnterpriseNotes();
        
        // Setup search and filtering
        this.setupNotesSearch();
        
        console.log('✅ Enterprise notes system initialized with', this.notes.length, 'notes');
    }

    /**
     * GOLD STANDARD: Normalize note structure for enterprise features
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
     * GOLD STANDARD: Setup enterprise notes interface with advanced controls
     */
    setupEnterpriseNotesInterface() {
        // Transform the basic notes HTML into enterprise-grade interface
        const notesContent = document.getElementById('notes-content');
        if (!notesContent) {
            console.error('❌ Notes content container not found');
            return;
        }

        // Replace with enterprise notes interface
        notesContent.innerHTML = this.generateEnterpriseNotesHTML();
        
        // Setup event listeners for advanced features
        this.setupNotesEventListeners();
        
        console.log('✅ Enterprise notes interface created');
    }

    /**
     * GOLD STANDARD: Generate enterprise notes HTML interface
     */
    generateEnterpriseNotesHTML() {
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
                            <button id="add-enterprise-note" class="btn-primary flex items-center">
                                <i class="fas fa-plus mr-2"></i>
                                Add Note
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Notes Display Area -->
                <div id="enterprise-notes-container">
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
        const addButton = document.getElementById('add-enterprise-note');
        if (addButton) {
            addButton.addEventListener('click', () => this.addEnterpriseNote());
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
            sortSelect.addEventListener('change', () => this.renderEnterpriseNotes());
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

        console.log('✅ Enterprise notes event listeners setup complete');
    }

    /**
     * GOLD STANDARD: Add enterprise note with full feature set
     */
    addEnterpriseNote() {
        console.log('📝 Adding enterprise note...');
        
        const titleInput = document.getElementById('quick-note-title');
        const contentTextarea = document.getElementById('quick-note-content');
        const categorySelect = document.getElementById('quick-note-category');
        const prioritySelect = document.getElementById('quick-note-priority');
        const pinCheckbox = document.getElementById('quick-note-pin');

        console.log('📝 Form elements found:', {
            titleInput: !!titleInput,
            contentTextarea: !!contentTextarea,
            categorySelect: !!categorySelect,
            prioritySelect: !!prioritySelect,
            pinCheckbox: !!pinCheckbox
        });

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

        console.log('📝 Creating new note:', newNote);
        console.log('📝 Current notes array before addition:', this.notes);

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

        console.log('📝 Notes array after addition:', this.notes);

        // Clear form
        titleInput.value = '';
        contentTextarea.value = '';
        categorySelect.value = 'general';
        prioritySelect.value = 'normal';
        pinCheckbox.checked = false;

        // Update display
        this.renderEnterpriseNotes();
        this.setUnsavedChanges(true);
        this.showNotification('Note added successfully!', 'success');
        
        console.log('📝 Enterprise note added successfully:', newNote);
    }

    /**
     * GOLD STANDARD: Extract tags from note content (#hashtags)
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
     * GOLD STANDARD: Render enterprise notes with advanced features
     */
    renderEnterpriseNotes() {
        const container = document.getElementById('enterprise-notes-container');
        const emptyState = document.getElementById('notes-empty-state');
        
        if (!container) {
            console.error('❌ Enterprise notes container not found');
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
                <div class="mb-8">
                    <div class="flex items-center mb-4">
                        <i class="fas fa-thumbtack text-yellow-600 mr-2"></i>
                        <h3 class="text-lg font-semibold text-gray-900">Pinned Notes</h3>
                        <span class="ml-2 bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">${pinnedNotes.length}</span>
                    </div>
                    <div class="space-y-4">
                        ${pinnedNotes.map(note => this.generateNoteHTML(note)).join('')}
                    </div>
                </div>
            `;
        }

        // Render regular notes section
        if (regularNotes.length > 0) {
            html += `
                <div>
                    <div class="flex items-center mb-4">
                        <i class="fas fa-sticky-note text-gray-600 mr-2"></i>
                        <h3 class="text-lg font-semibold text-gray-900">Notes</h3>
                        <span class="ml-2 bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full">${regularNotes.length}</span>
                    </div>
                    <div class="space-y-4">
                        ${regularNotes.map(note => this.generateNoteHTML(note)).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
        
        // Setup individual note event listeners
        this.setupNoteCardEventListeners();
        
        console.log(`✅ Rendered ${sortedNotes.length} enterprise notes`);
    }

    /**
     * GOLD STANDARD: Generate HTML for individual note with all features
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
            <div class="note-card bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 ${note.isPinned ? 'ring-2 ring-yellow-200' : ''}" data-note-id="${note.id}">
                <!-- Note Header -->
                <div class="flex items-start justify-between p-4 border-b border-gray-100">
                    <div class="flex-1 pr-4">
                        ${note.isEditing ? `
                            <input 
                                type="text" 
                                class="note-title-edit form-input text-lg font-semibold mb-2 w-full" 
                                value="${this.escapeHtml(note.title)}"
                            >
                        ` : `
                            <h4 class="text-lg font-semibold text-gray-900 mb-2 break-words">
                                ${this.escapeHtml(note.title)}
                                ${isRecent ? '<span class="ml-2 bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">New</span>' : ''}
                            </h4>
                        `}
                        
                        <!-- Metadata -->
                        <div class="flex items-center flex-wrap gap-4 text-sm text-gray-500">
                            <span class="${categoryColors[note.category] || categoryColors.general} px-2 py-1 rounded-full text-xs font-medium">
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
                            <span class="flex items-center text-xs text-gray-400">
                                By ${note.author}
                            </span>
                        </div>
                    </div>
                    
                    <!-- Action Buttons -->
                    <div class="flex items-center space-x-1">
                        <button class="pin-note-btn p-2 rounded-lg hover:bg-gray-100 transition-colors ${note.isPinned ? 'text-yellow-600' : 'text-gray-400'}" 
                                data-note-id="${note.id}" 
                                title="${note.isPinned ? 'Unpin note' : 'Pin note'}">
                            <i class="fas fa-thumbtack text-sm"></i>
                        </button>
                        <button class="edit-note-btn p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors" 
                                data-note-id="${note.id}" 
                                title="Edit note">
                            <i class="fas fa-edit text-sm"></i>
                        </button>
                        <button class="delete-note-btn p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-600 transition-colors" 
                                data-note-id="${note.id}" 
                                title="Delete note">
                            <i class="fas fa-trash text-sm"></i>
                        </button>
                    </div>
                </div>

                <!-- Note Content -->
                <div class="note-content p-4">
                    ${note.isEditing ? `
                        <textarea 
                            class="note-content-edit form-textarea w-full" 
                            rows="6"
                        >${this.escapeHtml(note.content)}</textarea>
                        <div class="flex justify-end space-x-2 mt-3">
                            <button class="cancel-edit-btn bg-gray-300 hover:bg-gray-400 text-gray-700 px-4 py-2 rounded-lg text-sm" data-note-id="${note.id}">
                                Cancel
                            </button>
                            <button class="save-edit-btn bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm" data-note-id="${note.id}">
                                Save Changes
                            </button>
                        </div>
                    ` : `
                        <div class="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap break-words leading-relaxed">
                            ${this.formatNoteContent(note.content)}
                        </div>
                        
                        <!-- Tags -->
                        ${note.tags && note.tags.length > 0 ? `
                            <div class="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100">
                                ${note.tags.map(tag => `
                                    <span class="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full">
                                        #${tag}
                                    </span>
                                `).join('')}
                            </div>
                        ` : ''}
                        
                        <!-- Footer with timestamp -->
                        <div class="flex items-center justify-end mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">
                            <span title="Created: ${new Date(note.createdAt).toLocaleString()}">
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
        const container = document.getElementById('enterprise-notes-container');
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
                this.deleteEnterpriseNote(noteId);
            } else if (e.target.closest('.save-edit-btn')) {
                this.saveEditNote(noteId);
            } else if (e.target.closest('.cancel-edit-btn')) {
                this.cancelEditNote(noteId);
            }
        });
    }

    /**
     * GOLD STANDARD: Toggle pin status of note
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

        this.renderEnterpriseNotes();
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
        
        this.renderEnterpriseNotes();
        
        // Focus on the content textarea
        setTimeout(() => {
            const textarea = document.querySelector(`[data-note-id="${noteId}"] .note-content-edit`);
            if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }
        }, 100);
        
        console.log('✏️ Started editing note:', note.title);
    }

    /**
     * GOLD STANDARD: Save edited note
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

        this.renderEnterpriseNotes();
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
        this.renderEnterpriseNotes();
        
        console.log('❌ Cancelled editing note:', note.title);
    }

    /**
     * GOLD STANDARD: Delete note with confirmation
     */
    deleteEnterpriseNote(noteId) {
        const note = this.notes.find(n => n.id == noteId);
        if (!note) return;

        const confirmMessage = `Are you sure you want to delete "${note.title}"?\n\nThis action cannot be undone.`;
        
        if (!confirm(confirmMessage)) return;

        this.notes = this.notes.filter(n => n.id != noteId);
        this.renderEnterpriseNotes();
        this.setUnsavedChanges(true);
        this.showNotification('Note deleted successfully!', 'success');
        
        console.log('🗑️ Note deleted:', note.title);
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

            switch (sortBy) {
                case 'created-desc':
                    return new Date(b.createdAt) - new Date(a.createdAt);
                case 'title-asc':
                    return a.title.localeCompare(b.title);
                case 'priority-desc':
                    const priorityOrder = { high: 3, normal: 2, low: 1 };
                    return (priorityOrder[b.priority] || 2) - (priorityOrder[a.priority] || 2);
                case 'updated-desc':
                default:
                    return new Date(b.updatedAt) - new Date(a.updatedAt);
            }
        });
    }

    /**
     * GOLD STANDARD: Filter notes based on search and category
     */
    filterNotes() {
        const searchInput = document.getElementById('notes-search');
        const categoryFilter = document.getElementById('notes-category-filter');
        
        const searchTerm = searchInput?.value.toLowerCase() || '';
        const selectedCategory = categoryFilter?.value || '';

        // Filter notes
        const filteredNotes = this.notes.filter(note => {
            const matchesSearch = !searchTerm || 
                note.title.toLowerCase().includes(searchTerm) ||
                note.content.toLowerCase().includes(searchTerm) ||
                note.tags.some(tag => tag.includes(searchTerm));
            
            const matchesCategory = !selectedCategory || note.category === selectedCategory;
            
            return matchesSearch && matchesCategory;
        });

        // Temporarily update notes array for rendering
        const originalNotes = [...this.notes];
        this.notes = filteredNotes;
        this.renderEnterpriseNotes();
        this.notes = originalNotes;

        console.log(`🔍 Filtered notes: ${filteredNotes.length}/${originalNotes.length} shown`);
    }

    /**
     * GOLD STANDARD: Setup notes search functionality
     */
    setupNotesSearch() {
        const searchInput = document.getElementById('notes-search');
        if (searchInput) {
            // Clear search button
            const clearBtn = document.createElement('button');
            clearBtn.innerHTML = '<i class="fas fa-times"></i>';
            clearBtn.className = 'absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 hidden';
            clearBtn.id = 'clear-search-btn';
            
            searchInput.parentNode.appendChild(clearBtn);
            
            // Show/hide clear button
            searchInput.addEventListener('input', () => {
                if (searchInput.value) {
                    clearBtn.classList.remove('hidden');
                } else {
                    clearBtn.classList.add('hidden');
                }
            });
            
            // Clear search
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearBtn.classList.add('hidden');
                this.renderEnterpriseNotes();
            });
        }
    }

    /**
     * GOLD STANDARD: Debounce utility for search
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Delete note - Legacy method kept for compatibility
     */
    deleteNote(noteId) {
        this.deleteEnterpriseNote(noteId);
    }

    /**
     * GOLD STANDARD: Render notes - Updated to use enterprise system
     */
    renderNotes() {
        this.renderEnterpriseNotes();
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
     * GOLD STANDARD: Collect Overview tab data with enterprise validation
     * Features: Data sanitization, validation, error handling
     */
    collectOverviewData(data) {
        console.log('📊 Collecting Overview data with enterprise validation...');

        try {
            // Define field mappings with validation rules
            const fieldMappings = {
                'edit-company-name': { 
                    key: 'companyName', 
                    required: true,
                    sanitize: true,
                    aliases: ['name'] // Backward compatibility
                },
                'edit-business-phone': { 
                    key: 'businessPhone', 
                    format: 'phone',
                    aliases: ['companyPhone'] // Backward compatibility
                },
                'edit-business-email': { 
                    key: 'businessEmail', 
                    format: 'email',
                    sanitize: true 
                },
                'edit-business-website': { 
                    key: 'businessWebsite', 
                    format: 'url',
                    sanitize: true 
                },
                'edit-business-address': { 
                    key: 'businessAddress', 
                    sanitize: true,
                    aliases: ['companyAddress'] // Backward compatibility
                },
                'edit-description': { 
                    key: 'description', 
                    maxLength: 1000,
                    sanitize: true 
                },
                'edit-service-area': { 
                    key: 'serviceArea', 
                    sanitize: true 
                },
                'edit-business-hours': { 
                    key: 'businessHours', 
                    sanitize: true 
                }
            };

            const validationErrors = [];
            const collectedData = {};

            // Process each field with enterprise-grade validation
            Object.entries(fieldMappings).forEach(([inputId, config]) => {
                const input = document.getElementById(inputId);
                if (!input) {
                    console.warn(`⚠️ Input element not found: ${inputId}`);
                    return;
                }

                let value = input.value || '';

                // Sanitize input if required
                if (config.sanitize) {
                    value = this.sanitizeInput(value);
                }

                // Format validation
                if (value && config.format) {
                    if (!this.validateFormat(value, config.format)) {
                        validationErrors.push(`Invalid ${config.format} format for ${config.key}`);
                    }
                }

                // Required field validation
                if (config.required && !value.trim()) {
                    validationErrors.push(`${config.key} is required`);
                }

                // Length validation
                if (config.maxLength && value.length > config.maxLength) {
                    validationErrors.push(`${config.key} exceeds maximum length of ${config.maxLength}`);
                }

                // Store the main value
                collectedData[config.key] = value.trim();

                // Store aliases for backward compatibility
                if (config.aliases) {
                    config.aliases.forEach(alias => {
                        collectedData[alias] = value.trim();
                    });
                }

                console.log(`📝 Collected ${config.key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`);
            });

            // Handle validation errors
            if (validationErrors.length > 0) {
                console.warn('⚠️ Validation errors found:', validationErrors);
                this.showNotification(`Validation errors: ${validationErrors.join(', ')}`, 'warning');
                
                // Still collect data but mark as having errors
                collectedData._hasValidationErrors = true;
                collectedData._validationErrors = validationErrors;
            }

            // Merge collected data into main data object
            Object.assign(data, collectedData);

            // Collect contacts data with enterprise validation
            this.collectEnterpriseContactsData(data);

            console.log('✅ Overview data collection completed', {
                fieldsCollected: Object.keys(collectedData).length,
                hasErrors: !!collectedData._hasValidationErrors,
                contactsCount: data.contacts ? data.contacts.length : 0,
                additionalContactsCount: data.additionalContacts ? data.additionalContacts.length : 0
            });

        } catch (error) {
            console.error('❌ Error collecting Overview data:', error);
            this.showNotification('Failed to collect form data', 'error');
            throw error;
        }
    }

    /**
     * GOLD STANDARD: Sanitize user input to prevent XSS and data issues
     */
    sanitizeInput(input) {
        if (typeof input !== 'string') return input;
        
        return input
            .trim()
            // Remove potentially dangerous HTML/Script tags
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<[^>]*>/g, '') // Remove all HTML tags
            // Normalize whitespace
            .replace(/\s+/g, ' ')
            // Remove control characters except newlines and tabs
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }

    /**
     * GOLD STANDARD: Validate data format
     */
    validateFormat(value, format) {
        switch (format) {
            case 'email':
                return this.isValidEmail(value);
            case 'phone':
                return this.isValidPhone(value);
            case 'url':
                return this.isValidUrl(value);
            default:
                return true;
        }
    }

    /**
     * GOLD STANDARD: Collect contacts data with enterprise validation
     */
    collectEnterpriseContactsData(data) {
        console.log('📞 Starting contacts data collection...');
        
        try {
            const contactsList = document.getElementById('contacts-list');
            if (!contactsList) {
                console.log('📞 No contacts section found, skipping contacts collection');
                return;
            }

            const contacts = [];
            const contactElements = contactsList.querySelectorAll('.contact-item');

            console.log(`📞 Found ${contactElements.length} contact elements in DOM`);

            contactElements.forEach((contactElement, index) => {
                console.log(`📞 Processing contact ${index + 1}`);
                
                const contact = {
                    name: '',
                    role: '',
                    phones: [],
                    notes: ''
                };

                // Collect name
                const nameInput = contactElement.querySelector('.contact-name');
                if (nameInput) {
                    contact.name = this.sanitizeInput(nameInput.value);
                    console.log(`📞 Contact ${index + 1} name: "${contact.name}"`);
                }

                // Collect role
                const roleInput = contactElement.querySelector('.contact-role');
                if (roleInput) {
                    contact.role = this.sanitizeInput(roleInput.value);
                    console.log(`📞 Contact ${index + 1} role: "${contact.role}"`);
                }

                // Collect phone numbers
                const phoneElements = contactElement.querySelectorAll('.phone-row');
                console.log(`📞 Contact ${index + 1} has ${phoneElements.length} phone elements`);
                
                phoneElements.forEach((phoneElement, phoneIndex) => {
                    const typeSelect = phoneElement.querySelector('.phone-type');
                    const valueInput = phoneElement.querySelector('.phone-value');
                    
                    if (typeSelect && valueInput && valueInput.value.trim()) {
                        const phoneValue = valueInput.value.trim();
                        
                        // Validate phone number
                        if (this.isValidPhone(phoneValue)) {
                            contact.phones.push({
                                type: typeSelect.value,
                                value: phoneValue
                            });
                            console.log(`📞 Contact ${index + 1} phone ${phoneIndex + 1}: ${typeSelect.value} - ${phoneValue}`);
                        } else {
                            console.warn(`⚠️ Invalid phone number for contact ${index + 1}: ${phoneValue}`);
                        }
                    }
                });

                // Collect notes
                const notesInput = contactElement.querySelector('.contact-notes');
                if (notesInput) {
                    contact.notes = this.sanitizeInput(notesInput.value);
                    console.log(`📞 Contact ${index + 1} notes: "${contact.notes.substring(0, 50)}${contact.notes.length > 50 ? '...' : ''}"`);
                }

                // Only add contact if it has meaningful data
                const hasData = contact.name || contact.role || contact.phones.length > 0 || contact.notes;
                if (hasData) {
                    contacts.push(contact);
                    console.log(`📞 Contact ${index + 1} added to collection (has meaningful data)`);
                } else {
                    console.log(`📞 Contact ${index + 1} skipped (no meaningful data)`);
                }
            });

            data.contacts = contacts;
            
            // Also save in legacy format for backward compatibility
            data.additionalContacts = contacts.map(contact => ({
                name: contact.name || '',
                role: contact.role || '',
                email: contact.email || '', // In case email is added later
                phone: contact.phones && contact.phones.length > 0 ? contact.phones[0].value : '',
                notes: contact.notes || ''
            }));
            
            console.log(`📞 Collected ${contacts.length} contacts with enterprise validation`);
            console.log(`📞 Legacy format: ${data.additionalContacts.length} additionalContacts`);

        } catch (error) {
            console.error('❌ Error collecting contacts data:', error);
            // Don't throw - contacts are optional
            data.contacts = data.contacts || [];
        }
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
        
        if (twilioToken?.value.trim()) {
            const tokenValue = twilioToken.value.trim();
            // Check if it's a masked value (starts with bullets) or a new token
            const isMaskedValue = tokenValue.startsWith('••••••••••••') || tokenValue === '••••••••••••••••';
            
            if (!isMaskedValue) {
                // It's a new token, save it
                data.twilioConfig.authToken = tokenValue;
                console.log('🔧 Set NEW authToken:', '***masked***');
            } else {
                // It's a masked value, preserve existing token if we have one
                const existingToken = this.currentData?.twilioConfig?.authToken || this.currentData?.twilioAuthToken;
                if (existingToken) {
                    data.twilioConfig.authToken = existingToken;
                    console.log('🔧 Preserved existing authToken:', '***masked***');
                }
            }
        }
        
        if (twilioApiKey?.value.trim()) {
            const apiKeyValue = twilioApiKey.value.trim();
            // Check if it's a masked value (starts with bullets) or a new API key
            const isMaskedValue = apiKeyValue.startsWith('••••••••••••') || apiKeyValue === '••••••••••••••••';
            
            if (!isMaskedValue) {
                // It's a new API key, save it
                data.twilioConfig.apiKey = apiKeyValue;
                console.log('🔧 Set NEW apiKey:', '***masked***');
            } else {
                // It's a masked value, preserve existing API key if we have one
                const existingApiKey = this.currentData?.twilioConfig?.apiKey || this.currentData?.twilioApiKey;
                if (existingApiKey) {
                    data.twilioConfig.apiKey = existingApiKey;
                    console.log('🔧 Preserved existing apiKey:', '***masked***');
                }
            }
        }
        
        if (twilioApiSecret?.value.trim()) {
            const secretValue = twilioApiSecret.value.trim();
            // Check if it's a masked value (starts with bullets) or a new secret
            const isMaskedValue = secretValue.startsWith('••••••••••••') || secretValue === '••••••••••••••••';
            
            if (!isMaskedValue) {
                // It's a new secret, save it
                data.twilioConfig.apiSecret = secretValue;
                console.log('🔧 Set NEW apiSecret:', '***masked***');
            } else {
                // It's a masked value, preserve existing secret if we have one
                const existingSecret = this.currentData?.twilioConfig?.apiSecret || this.currentData?.twilioApiSecret;
                if (existingSecret) {
                    data.twilioConfig.apiSecret = existingSecret;
                    console.log('🔧 Preserved existing apiSecret:', '***masked***');
                }
            }
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
     * GOLD STANDARD: Collect Notes tab data with enterprise structure
     */
    collectNotesData(data) {
        console.log('📝 Collecting enterprise notes data...');
        console.log('📝 Current notes state:', this.notes);
        console.log('📝 Notes is array?', Array.isArray(this.notes));
        console.log('📝 Notes length:', this.notes ? this.notes.length : 'undefined');
        
        if (this.notes && Array.isArray(this.notes) && this.notes.length > 0) {
            // Ensure all notes have proper enterprise structure
            const processedNotes = this.notes.map(note => ({
                id: note.id || Date.now() + Math.random(),
                title: note.title || this.extractTitleFromContent(note.content || ''),
                content: note.content || note.text || '',
                category: note.category || 'general',
                priority: note.priority || 'normal',
                isPinned: note.isPinned || false,
                tags: note.tags || [],
                createdAt: note.createdAt || note.timestamp || new Date().toISOString(),
                updatedAt: note.updatedAt || note.timestamp || new Date().toISOString(),
                author: note.author || 'Developer'
            }));

            data.notes = processedNotes;
            console.log(`📝 Collected ${processedNotes.length} enterprise notes for saving:`, processedNotes);
            
            // Also save in legacy format for backward compatibility
            data.legacyNotes = processedNotes.map(note => ({
                id: note.id,
                text: note.content,
                timestamp: note.updatedAt,
                author: note.author,
                isPinned: note.isPinned
            }));
            
        } else {
            data.notes = [];
            data.legacyNotes = [];
            console.log('📝 No notes to collect - setting empty arrays');
        }
        
        console.log('📝 Final notes data being saved:', data.notes);
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
     * GOLD STANDARD: Render enterprise contacts section with advanced UX
     */
    renderEnterpriseContactsSection() {
        // Map database 'additionalContacts' to frontend 'contacts' format
        let contacts = [];
        if (Array.isArray(this.currentData.contacts)) {
            contacts = this.currentData.contacts;
        } else if (Array.isArray(this.currentData.additionalContacts)) {
            // Convert additionalContacts (legacy format) to new contacts format
            contacts = this.currentData.additionalContacts.map(contact => ({
                name: contact.name || '',
                role: contact.role || '',
                phones: contact.phone ? [{ type: 'cell', value: contact.phone }] : [],
                notes: contact.notes || ''
            }));
            // Update the current data to use the new format
            this.currentData.contacts = contacts;
        }
        
        const contactsList = document.getElementById('contacts-list');
        
        if (!contactsList) {
            console.warn('⚠️ Contacts list container not found');
            return;
        }

        console.log(`👥 Rendering ${contacts.length} contacts with enterprise features`);

        // Clear existing contacts
        contactsList.innerHTML = '';

        if (contacts.length === 0) {
            // Show empty state with call-to-action
            contactsList.innerHTML = this.generateEmptyContactsState();
            return;
        }

        // Render each contact with enterprise features
        contacts.forEach((contact, index) => {
            const contactElement = this.createEnterpriseContactElement(contact, index);
            contactsList.appendChild(contactElement);
        });

        // Add "Add Contact" button at the bottom
        const addContactSection = document.createElement('div');
        addContactSection.className = 'mt-6 text-center';
        addContactSection.innerHTML = `
            <button 
                type="button" 
                id="add-contact-btn" 
                class="inline-flex items-center px-6 py-3 border border-dashed border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                aria-label="Add new contact"
            >
                <i class="fas fa-user-plus mr-2 text-indigo-600"></i>
                Add New Contact
            </button>
        `;
        contactsList.appendChild(addContactSection);
    }

    /**
     * GOLD STANDARD: Generate empty contacts state with call-to-action
     */
    generateEmptyContactsState() {
        return `
            <div class="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-indigo-100 mb-4">
                    <i class="fas fa-users text-indigo-600 text-2xl"></i>
                </div>
                <h3 class="text-lg font-medium text-gray-900 mb-2">No contacts added yet</h3>
                <p class="text-sm text-gray-600 mb-6 max-w-sm mx-auto">
                    Add key contacts for your business to help customers reach the right person quickly.
                </p>
                <button 
                    type="button" 
                    id="add-contact-btn" 
                    class="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors duration-200"
                    aria-label="Add your first contact"
                >
                    <i class="fas fa-user-plus mr-2"></i>
                    Add Your First Contact
                </button>
            </div>
        `;
    }

    /**
     * GOLD STANDARD: Create enterprise contact element with validation
     */
    createEnterpriseContactElement(contact, index) {
        const contactDiv = document.createElement('div');
        contactDiv.className = 'contact-item bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow duration-200 mb-4';
        contactDiv.setAttribute('data-contact-index', index);
        
        contactDiv.innerHTML = `
            <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between">
                <!-- Contact Information -->
                <div class="flex-1 lg:mr-6">
                    <!-- Header -->
                    <div class="flex items-center justify-between mb-4">
                        <div class="flex items-center">
                            <div class="bg-indigo-100 p-2 rounded-lg mr-3">
                                <i class="fas fa-user text-indigo-600"></i>
                            </div>
                            <h4 class="text-lg font-semibold text-gray-900">
                                Contact ${index + 1}
                                ${contact.name ? `- ${this.escapeHtml(contact.name)}` : ''}
                            </h4>
                        </div>
                        <button 
                            type="button" 
                            class="remove-contact-btn text-gray-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors duration-200" 
                            data-contact-index="${index}"
                            aria-label="Remove contact ${index + 1}"
                            title="Remove this contact"
                        >
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>

                    <!-- Basic Information Grid -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div class="form-group">
                            <label class="form-label">Full Name</label>
                            <input 
                                type="text" 
                                class="form-input contact-name enterprise-input" 
                                value="${this.escapeHtml(contact.name || '')}" 
                                data-contact-index="${index}" 
                                placeholder="Enter contact name"
                                aria-describedby="contact-name-help-${index}"
                            >
                            <div id="contact-name-help-${index}" class="form-help">
                                Full name of the contact person
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Role / Title</label>
                            <input 
                                type="text" 
                                class="form-input contact-role enterprise-input" 
                                value="${this.escapeHtml(contact.role || '')}" 
                                data-contact-index="${index}" 
                                placeholder="e.g., Customer Service Manager"
                                aria-describedby="contact-role-help-${index}"
                            >
                            <div id="contact-role-help-${index}" class="form-help">
                                Job title or department
                            </div>
                        </div>
                    </div>

                    <!-- Phone Numbers Section -->
                    <div class="mb-4">
                        <div class="flex items-center justify-between mb-3">
                            <label class="form-label mb-0">Phone Numbers</label>
                            <button 
                                type="button" 
                                class="add-phone-btn text-sm text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center px-3 py-1 rounded-md hover:bg-indigo-50 transition-colors duration-200" 
                                data-contact-index="${index}"
                                aria-label="Add phone number for contact ${index + 1}"
                            >
                                <i class="fas fa-plus mr-1"></i>
                                Add Phone
                            </button>
                        </div>
                        <div class="space-y-3" id="contact-phones-${index}">
                            ${this.renderContactPhones(contact.phones || [], index)}
                        </div>
                        ${(contact.phones || []).length === 0 ? `
                            <div class="text-center py-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                <i class="fas fa-phone text-gray-400 mb-2"></i>
                                <p class="text-sm text-gray-600">No phone numbers added</p>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Notes Section -->
                    <div class="form-group">
                        <label class="form-label">Notes</label>
                        <textarea 
                            class="form-textarea contact-notes enterprise-input" 
                            data-contact-index="${index}" 
                            rows="3" 
                            placeholder="Special notes about this contact (availability, preferences, etc.)"
                            aria-describedby="contact-notes-help-${index}"
                        >${this.escapeHtml(contact.notes || '')}</textarea>
                        <div id="contact-notes-help-${index}" class="form-help">
                            Any special information about contacting this person
                        </div>
                    </div>
                </div>
            </div>
        `;

        return contactDiv;
    }

    /**
     * GOLD STANDARD: Render contact phone numbers with validation
     */
    renderContactPhones(phones, contactIndex) {
        if (!Array.isArray(phones) || phones.length === 0) {
            return '';
        }

        return phones.map((phone, phoneIndex) => `
            <div class="phone-row flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                <div class="flex-shrink-0">
                    <select 
                        class="form-select phone-type text-sm" 
                        data-contact-index="${contactIndex}" 
                        data-phone-index="${phoneIndex}"
                        aria-label="Phone type for contact ${contactIndex + 1}, phone ${phoneIndex + 1}"
                    >
                        <option value="cell" ${phone.type === 'cell' ? 'selected' : ''}>📱 Cell</option>
                        <option value="office" ${phone.type === 'office' ? 'selected' : ''}>🏢 Office</option>
                        <option value="landline" ${phone.type === 'landline' ? 'selected' : ''}>📞 Landline</option>
                        <option value="fax" ${phone.type === 'fax' ? 'selected' : ''}>📠 Fax</option>
                        <option value="other" ${phone.type === 'other' ? 'selected' : ''}>📋 Other</option>
                    </select>
                </div>
                <div class="flex-1">
                    <input 
                        type="tel" 
                        class="form-input phone-value" 
                        value="${this.escapeHtml(phone.value || '')}" 
                        data-contact-index="${contactIndex}" 
                        data-phone-index="${phoneIndex}" 
                        placeholder="(555) 123-4567"
                        aria-label="Phone number for contact ${contactIndex + 1}"
                    >
                </div>
                <button 
                    type="button" 
                    class="remove-phone-btn flex-shrink-0 text-gray-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors duration-200" 
                    data-contact-index="${contactIndex}" 
                    data-phone-index="${phoneIndex}"
                    aria-label="Remove phone number ${phoneIndex + 1} for contact ${contactIndex + 1}"
                    title="Remove this phone number"
                >
                    <i class="fas fa-trash text-sm"></i>
                </button>
            </div>
        `).join('');
    }

    /**
     * GOLD STANDARD: Setup enterprise contacts event handlers
     */
    setupEnterpriseContactsHandlers() {
        const contactsList = document.getElementById('contacts-list');
        if (!contactsList) {
            console.warn('⚠️ Contacts list not found for handler setup');
            return;
        }

        // Use event delegation for better performance and dynamic content handling
        contactsList.addEventListener('click', this.handleContactsClick.bind(this));
        contactsList.addEventListener('input', this.handleContactsInput.bind(this));
        contactsList.addEventListener('change', this.handleContactsChange.bind(this));

        console.log('👥 Enterprise contacts handlers setup complete');
    }

    /**
     * GOLD STANDARD: Handle contacts click events with enterprise logic
     */
    handleContactsClick(event) {
        const target = event.target.closest('button');
        if (!target) return;

        event.preventDefault();
        
        if (target.id === 'add-contact-btn' || target.classList.contains('add-contact-btn')) {
            this.addNewContact();
        } else if (target.classList.contains('add-phone-btn')) {
            this.addPhoneToContact(parseInt(target.dataset.contactIndex));
        } else if (target.classList.contains('remove-phone-btn')) {
            this.removePhoneFromContact(
                parseInt(target.dataset.contactIndex), 
                parseInt(target.dataset.phoneIndex)
            );
        } else if (target.classList.contains('remove-contact-btn')) {
            this.removeContact(parseInt(target.dataset.contactIndex));
        }
    }

    /**
     * GOLD STANDARD: Handle contacts input events with validation
     */
    handleContactsInput(event) {
        if (event.target.classList.contains('enterprise-input')) {
            this.setUnsavedChanges(true);
            
            // Auto-save after 2 seconds of inactivity
            clearTimeout(this.contactsAutoSaveTimeout);
            this.contactsAutoSaveTimeout = setTimeout(() => {
                this.performAutoSave().catch(console.error);
            }, 2000);
        }
    }

    /**
     * GOLD STANDARD: Handle contacts change events
     */
    handleContactsChange(event) {
        if (event.target.classList.contains('phone-type')) {
            this.setUnsavedChanges(true);
        }
    }

    /**
     * GOLD STANDARD: Add new contact with enterprise defaults
     */
    addNewContact() {
        console.log('👤 Adding new contact...');
        console.log('👤 Current data contacts:', this.currentData.contacts);
        console.log('👤 Current data additionalContacts:', this.currentData.additionalContacts);
        
        if (!Array.isArray(this.currentData.contacts)) {
            this.currentData.contacts = [];
            console.log('👤 Initialized contacts array');
        }

        const newContact = {
            name: '',
            role: '',
            phones: [{ type: 'cell', value: '' }], // Start with one phone number
            notes: ''
        };

        this.currentData.contacts.push(newContact);
        console.log('👤 New contact added, total contacts:', this.currentData.contacts.length);
        
        this.renderEnterpriseContactsSection();
        this.setUnsavedChanges(true);

        // Focus on the name field of the new contact
        setTimeout(() => {
            const newContactNameField = document.querySelector(`[data-contact-index="${this.currentData.contacts.length - 1}"] .contact-name`);
            if (newContactNameField) {
                newContactNameField.focus();
                console.log('👤 Focused on new contact name field');
            } else {
                console.warn('👤 Could not find name field to focus');
            }
        }, 100);

        console.log('👤 New contact added successfully');
    }

    /**
     * GOLD STANDARD: Add phone to contact with validation
     */
    addPhoneToContact(contactIndex) {
        if (!this.currentData.contacts[contactIndex]) {
            console.error('❌ Invalid contact index:', contactIndex);
            return;
        }

        if (!Array.isArray(this.currentData.contacts[contactIndex].phones)) {
            this.currentData.contacts[contactIndex].phones = [];
        }

        // Limit to 5 phone numbers per contact
        if (this.currentData.contacts[contactIndex].phones.length >= 5) {
            this.showNotification('Maximum 5 phone numbers per contact', 'warning');
            return;
        }

        this.currentData.contacts[contactIndex].phones.push({ 
            type: 'cell', 
            value: '' 
        });

        this.renderEnterpriseContactsSection();
        this.setUnsavedChanges(true);

        console.log(`📞 Phone added to contact ${contactIndex}`);
    }

    /**
     * GOLD STANDARD: Remove phone from contact with confirmation
     */
    removePhoneFromContact(contactIndex, phoneIndex) {
        if (!this.currentData.contacts[contactIndex]?.phones?.[phoneIndex]) {
            console.error('❌ Invalid phone index:', { contactIndex, phoneIndex });
            return;
        }

        // Show confirmation for last phone number
        const phones = this.currentData.contacts[contactIndex].phones;
        if (phones.length === 1) {
            if (!confirm('Remove the last phone number for this contact?')) {
                return;
            }
        }

        phones.splice(phoneIndex, 1);
        this.renderEnterpriseContactsSection();
        this.setUnsavedChanges(true);

        console.log(`📞 Phone removed from contact ${contactIndex}`);
    }

    /**
     * GOLD STANDARD: Remove contact with confirmation
     */
    removeContact(contactIndex) {
        if (!this.currentData.contacts[contactIndex]) {
            console.error('❌ Invalid contact index:', contactIndex);
            return;
        }

        const contact = this.currentData.contacts[contactIndex];
        const contactName = contact.name || `Contact ${contactIndex + 1}`;
        
        if (!confirm(`Remove ${contactName}? This action cannot be undone.`)) {
            return;
        }

        this.currentData.contacts.splice(contactIndex, 1);
        this.renderEnterpriseContactsSection();
        this.setUnsavedChanges(true);

        this.showNotification(`${contactName} removed`, 'success');
        console.log(`👤 Contact removed: ${contactName}`);
    }

    /**
     * GOLD STANDARD: Legacy method for backward compatibility - deprecated
     * Use collectEnterpriseContactsData instead
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
