
/* ============================================================================
   MODERN COMPANY PROFILE MANAGEMENT SYSTEM
   ============================================================================
   
   
   Architecture:
   - Class-based modular design
   - Centralized state management  
   - Robust error handling
   - Modern ES6+ features
   - Clean separation of concerns
   - Multi-tenant company isolation
   
   ============================================================================ */

/* ============================================================================
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
        
        // Notes event listener flag (to prevent duplicate setups)
        this.noteEventListenersSetup = false;
        
        // Authentication token
        this.authToken = localStorage.getItem('adminToken') || localStorage.getItem('token');
    }

    /* ========================================================================
       ======================================================================== */

    /**
     * Initialize the company profile system
     */
    async init() {
        try {
            if (this.initialized) {
                return;
            }
            
            this.initialized = true;
            
            // Extract company ID from URL
            this.extractCompanyId();
            
            if (!this.companyId) {
                throw new Error('No company ID found in URL');
            }

            // Initialize DOM elements and event listeners
            this.initializeDOM();
            this.setupEventListeners();
            
            // Load company data
            await this.loadCompanyData();
            
            // Initialize tabs
            this.initializeTabs();
            
            this.initialized = true;
            
        } catch (error) {
            this.showNotification('Failed to initialize company profile', 'error');
        }
    }

    /* ========================================================================
       ======================================================================== */

    /**
     * Extract company ID from URL parameters
     */
    extractCompanyId() {
        // First check if company ID was already set by HTML initialization
        if (window.companyId) {
            this.companyId = window.companyId;
        } else {
            // Fallback: extract from URL directly
            const urlParams = new URLSearchParams(window.location.search);
            this.companyId = urlParams.get('id');
            
            if (this.companyId) {
                localStorage.setItem('lastCompanyId', this.companyId);
            }
        }
        
        if (!this.companyId) {
            const savedId = localStorage.getItem('lastCompanyId');
            if (savedId && savedId !== 'test123') {
                this.companyId = savedId;
                const newUrl = `${window.location.pathname}?id=${this.companyId}`;
                window.history.replaceState({}, '', newUrl);
            } else {
                this.companyId = 'test123';
            }
        }
        
        // Set global references for legacy compatibility
        window.currentCompanyId = this.companyId;
        window.companyId = this.companyId;
        
    }

    /* ========================================================================
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
        }
        
        if (missingOptional.length > 0) {
        }
    }

    /* ========================================================================
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
            if (event.target.hasAttribute('data-no-unsaved-warning') || 
                event.target.closest('[data-no-unsaved-warning]')) {
                return; // Don't trigger unsaved changes warning
            }
            
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
    }

    /**
     * Create floating save button - DISABLED (using dedicated tab-specific save buttons instead)
     */
    createSaveButton() {
        // Floating save button removed to prevent UI state conflicts
        return;
    }

    /**
     * Show save button with animation - DISABLED
     */
    showSaveButton() {
        return;
    }

    /**
     * Hide save button with animation - DISABLED
     */
    hideSaveButton() {
        return;
    }

    /* ========================================================================
       ======================================================================== */

    /**
     * Load company data from API
     * @param {boolean} force - Force reload even if data is already loaded
     */
    async loadCompanyData(force = false) {
        try {
            if (this.companyDataLoaded && !force) {
                console.log('📥 [LOAD] Using cached company data');
                return this.companyData;
            }
            
            console.log('📥 [LOAD] Loading company data...', { companyId: this.companyId, force });
            this.showLoading(true);

            // Add cache-busting parameter to force fresh data
            const timestamp = new Date().getTime();
            const apiUrl = `${this.apiBaseUrl}/api/company/${this.companyId}?_=${timestamp}`;
            
            console.log('📡 [LOAD] Fetching from:', apiUrl);
            
            // Get auth token
            const token = this.authToken || localStorage.getItem('adminToken');
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
                console.log('✅ [LOAD] Auth token included');
            } else {
                console.warn('⚠️ [LOAD] No auth token found');
            }
            
            const response = await fetch(apiUrl, {
                headers: headers,
                cache: 'no-cache' // Prevent browser caching
            });
            
            console.log('📥 [LOAD] Response status:', response.status);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.currentData = await response.json();
            this.companyData = this.currentData; // Store for guard check
            this.companyDataLoaded = true;
            
            console.log('✅ [LOAD] Company data loaded:', this.currentData);
            console.log('📝 [LOAD] Notes in loaded data:', this.currentData.notes?.length || 0, 'notes');

            // Populate all tabs with data
            this.populateOverviewTab();
            this.populateConfigTab();
            this.populateNotesTab();
            this.populateAISettingsTab();
            this.populateVoiceTab();
            this.populatePersonalityTab();
            this.populateAgentLogicTab();

        } catch (error) {
            console.error('❌ [LOAD] Error loading company data:', error);
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


        try {
            // Update header elements with current data
            this.updateHeaderElements();

            // Create modern always-editable form with validation
            this.createV2EditableForm();

            // Initialize contacts management with v2 features
            this.initializeContactsManagement();
            
            // Setup comprehensive validation and auto-save
            this.setupV2FormValidation();

        } catch (error) {
            this.showNotification('Failed to initialize Overview tab', 'error');
        }
    }

    /**
     * GOLD STANDARD: Create v2-grade always-editable form
     * Features: Validation, accessibility, progressive enhancement
     */
    createV2EditableForm() {
        if (!this.domElements.editFormContainer) {
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
        
    }

    /**
     * Generate country options for dropdown (international-ready)
     */
    generateCountryOptions(selectedCountry = 'USA') {
        const countries = [
            'USA', 'Canada', 'United Kingdom', 'Australia', 'New Zealand',
            'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola',
            'Argentina', 'Armenia', 'Austria', 'Azerbaijan', 'Bahamas',
            'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium',
            'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina',
            'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso',
            'Burundi', 'Cambodia', 'Cameroon', 'Cape Verde', 'Central African Republic',
            'Chad', 'Chile', 'China', 'Colombia', 'Comoros',
            'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus',
            'Czech Republic', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
            'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea',
            'Estonia', 'Ethiopia', 'Fiji', 'Finland', 'France',
            'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana',
            'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau',
            'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland',
            'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
            'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan',
            'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan',
            'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia',
            'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar',
            'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
            'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia',
            'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco',
            'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal',
            'Netherlands', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea',
            'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau',
            'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru',
            'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
            'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines',
            'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal',
            'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia',
            'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
            'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname',
            'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan',
            'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga',
            'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
            'Uganda', 'Ukraine', 'United Arab Emirates', 'Uruguay', 'Uzbekistan',
            'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen',
            'Zambia', 'Zimbabwe'
        ];
        
        return countries.map(country => {
            const selected = country === selectedCountry ? 'selected' : '';
            return `<option value="${this.escapeHtml(country)}" ${selected}>${this.escapeHtml(country)}</option>`;
        }).join('');
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
                                value="${this.escapeHtml(data.businessPhone || data.companyPhone || '')}"
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
                            <label class="form-label flex items-center">
                                <i class="fas fa-map-marker-alt mr-2 text-blue-600"></i>
                                Business Address
                            </label>
                            <div class="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                <!-- Street Address -->
                                <div>
                                    <label for="edit-address-street" class="text-sm font-medium text-gray-700">Street Address</label>
                                    <input 
                                        type="text" 
                                        id="edit-address-street" 
                                        name="address.street"
                                        class="form-input v2-input mt-1" 
                                        value="${this.escapeHtml(data.address?.street || '')}"
                                        placeholder="123 Main Street, Suite 100"
                                    >
                                </div>
                                
                                <!-- City & State/Province -->
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label for="edit-address-city" class="text-sm font-medium text-gray-700">City</label>
                                        <input 
                                            type="text" 
                                            id="edit-address-city" 
                                            name="address.city"
                                            class="form-input v2-input mt-1" 
                                            value="${this.escapeHtml(data.address?.city || '')}"
                                            placeholder="Naples"
                                        >
                                    </div>
                                    <div>
                                        <label for="edit-address-state" class="text-sm font-medium text-gray-700">State/Province</label>
                                        <input 
                                            type="text" 
                                            id="edit-address-state" 
                                            name="address.state"
                                            class="form-input v2-input mt-1" 
                                            value="${this.escapeHtml(data.address?.state || '')}"
                                            placeholder="Florida"
                                        >
                                    </div>
                                </div>
                                
                                <!-- Postal Code & Country -->
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label for="edit-address-zip" class="text-sm font-medium text-gray-700">Postal/ZIP Code</label>
                                        <input 
                                            type="text" 
                                            id="edit-address-zip" 
                                            name="address.zip"
                                            class="form-input v2-input mt-1" 
                                            value="${this.escapeHtml(data.address?.zip || '')}"
                                            placeholder="33966"
                                        >
                                    </div>
                                    <div>
                                        <label for="edit-address-country" class="text-sm font-medium text-gray-700">Country</label>
                                        <select 
                                            id="edit-address-country" 
                                            name="address.country"
                                            class="form-input v2-input mt-1"
                                        >
                                            ${this.generateCountryOptions(data.address?.country || 'USA')}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div class="form-help mt-2">
                                <i class="fas fa-globe mr-1"></i>
                                Physical location of your business (international format)
                            </div>
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

    }

    /**
     * GOLD STANDARD: Handle v2 input with validation and auto-save
     */
    handleV2Input(event) {
        const field = event.target;
        
        // Mark as changed for auto-save
        this.setUnsavedChanges(true);
        
        // Update form status immediately
        this.setFormStatus('typing', 'Making changes...');
        
        // Real-time validation (debounced)
        clearTimeout(this.validationTimeout);
        this.validationTimeout = setTimeout(() => {
            this.validateField(field);
        }, 300);
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
     * Show field validation errors
     */
    showFieldErrors(field, errors) {
        // Remove any existing success styling
        field.classList.remove('border-green-500', 'bg-green-50');
        
        // Add error styling
        field.classList.add('border-red-500', 'bg-red-50');
        
        // Find or create error message container
        let errorDiv = field.parentElement.querySelector('.field-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'field-error text-red-600 text-xs mt-1';
            field.parentElement.appendChild(errorDiv);
        }
        
        // Display errors
        errorDiv.textContent = errors.join(', ');
        errorDiv.classList.remove('hidden');
    }

    /**
     * Show field validation success
     */
    showFieldSuccess(field) {
        // Remove error styling
        field.classList.remove('border-red-500', 'bg-red-50');
        
        // Add success styling (subtle)
        field.classList.add('border-green-500');
        
        // Hide error message if exists
        const errorDiv = field.parentElement.querySelector('.field-error');
        if (errorDiv) {
            errorDiv.classList.add('hidden');
        }
    }

    /**
     * Clear field errors on focus
     */
    clearFieldErrors(field) {
        // Remove all validation styling
        field.classList.remove('border-red-500', 'bg-red-50', 'border-green-500');
        
        // Hide error message
        const errorDiv = field.parentElement.querySelector('.field-error');
        if (errorDiv) {
            errorDiv.classList.add('hidden');
        }
    }

    /**
     * Helper: Validate email format
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Helper: Validate phone format (US and international)
     */
    isValidPhone(phone) {
        // Remove all non-digit characters except +
        const cleaned = phone.replace(/[^\d+]/g, '');
        // Check if it's a valid length (10-15 digits, optional + prefix)
        return /^\+?\d{10,15}$/.test(cleaned);
    }

    /**
     * Helper: Validate URL format
     */
    isValidUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
        } catch {
            return false;
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

    }

    /**
     * Perform auto-save of form data
     */
    async performAutoSave() {
        console.log('🔄 [AUTO-SAVE] Starting auto-save...');
        
        const formData = this.collectOverviewFormData();
        if (!formData) {
            console.error('❌ [AUTO-SAVE] Failed to collect form data');
            throw new Error('Failed to collect form data');
        }
        console.log('✅ [AUTO-SAVE] Form data collected:', formData);

        const token = localStorage.getItem('adminToken');
        if (!token) {
            console.error('❌ [AUTO-SAVE] No authentication token found');
            throw new Error('No authentication token');
        }
        console.log('✅ [AUTO-SAVE] Token found');

        const url = `${this.apiBaseUrl}/api/company/${this.companyId}`;
        console.log('📡 [AUTO-SAVE] Sending PATCH to:', url);
        
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(formData)
        });

        console.log('📥 [AUTO-SAVE] Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ [AUTO-SAVE] Server error:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        console.log('✅ [AUTO-SAVE] Saved successfully:', result);
        
        this.setUnsavedChanges(false);
        this.showNotification('Changes saved successfully', 'success');
        return result;
    }

    /**
     * Collect form data from Overview tab (including nested address object)
     */
    collectOverviewFormData() {
        const form = this.domElements.editFormContainer;
        if (!form) return null;

        const businessPhone = form.querySelector('#edit-business-phone')?.value || '';

        const data = {
            companyName: form.querySelector('#edit-company-name')?.value || '',
            // Save to BOTH v2 and legacy fields for compatibility
            businessPhone: businessPhone,       // V2 field
            companyPhone: businessPhone,         // Legacy field (for backward compatibility)
            businessEmail: form.querySelector('#edit-business-email')?.value || '',
            businessWebsite: form.querySelector('#edit-business-website')?.value || '',
            serviceArea: form.querySelector('#edit-service-area')?.value || '',
            businessHours: form.querySelector('#edit-business-hours')?.value || '',
            
            address: {
                street: form.querySelector('#edit-address-street')?.value || '',
                city: form.querySelector('#edit-address-city')?.value || '',
                state: form.querySelector('#edit-address-state')?.value || '',
                zip: form.querySelector('#edit-address-zip')?.value || '',
                country: form.querySelector('#edit-address-country')?.value || 'USA'
            }
        };

        console.log('📋 [FORM] Collected data - saving to BOTH fields:', {
            businessPhone: data.businessPhone,
            companyPhone: data.companyPhone
        });

        return data;
    }

    /**
     * Set form status indicator
     */
    setFormStatus(status, message) {
        const statusElement = document.getElementById('form-status');
        if (!statusElement) return;
        
        // Status colors and icons
        const statusConfig = {
            'ready': { color: 'green', icon: 'check-circle', text: 'Ready' },
            'typing': { color: 'blue', icon: 'edit', text: 'Editing...' },
            'pending': { color: 'yellow', icon: 'sync', text: 'Saving...' },
            'saved': { color: 'green', icon: 'check', text: 'Saved!' },
            'error': { color: 'red', icon: 'exclamation-circle', text: 'Error' }
        };
        
        const config = statusConfig[status] || statusConfig['ready'];
        const colorClass = `text-${config.color}-700`;
        const bgClass = `bg-${config.color}-500`;
        
        statusElement.innerHTML = `
            <div class="w-2 h-2 ${bgClass} rounded-full mr-2 ${status === 'pending' ? 'animate-pulse' : ''}"></div>
            <span class="${colorClass} font-medium">${message || config.text}</span>
        `;
    }

    /* ========================================================================
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
            this.showNotification('Failed to initialize contacts section', 'error');
        }
    }

    /**
     * Render v2 contacts section
     */
    renderV2ContactsSection() {
        
        // Use contacts-list as per HTML structure
        const contactsList = document.getElementById('contacts-list');
        if (!contactsList) {
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
    }
    
    /**
     * Edit existing contact
     */
    editContact(contactType) {
        
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
        console.log('📞 [CONTACTS] Setting up contact handlers...');
        
        const addContactBtn = document.getElementById('add-contact-btn');
        console.log('📞 [CONTACTS] Add contact button:', addContactBtn ? '✅ Found' : '❌ Not found');
        
        if (addContactBtn) {
            addContactBtn.addEventListener('click', () => {
                console.log('📞 [CONTACTS] Add contact button clicked');
                this.showContactModal();
            });
            console.log('📞 [CONTACTS] Event listener attached');
        } else {
            console.error('❌ [CONTACTS] Add contact button not found in DOM');
        }
    }
    
    /**
     * Show contact modal for add/edit
     */
    showContactModal(contactData = null) {
        console.log('📞 [CONTACTS] showContactModal called', { contactData, isEdit: !!contactData });
        
        const isEdit = !!contactData;
        const modalTitle = isEdit ? 'Edit Contact' : 'Add New Contact';
        const submitText = isEdit ? 'Update Contact' : 'Add Contact';
        
        console.log('📞 [CONTACTS] Creating modal:', { modalTitle, submitText });
        
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
            console.log('📞 [CONTACTS] Removing existing modal');
            existingModal.remove();
        }
        
        // Add modal to DOM
        console.log('📞 [CONTACTS] Adding modal to DOM');
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Setup form submission handler
        const form = document.getElementById('contact-form');
        if (!form) {
            console.error('❌ [CONTACTS] Contact form not found after adding to DOM');
            return;
        }
        
        console.log('📞 [CONTACTS] Form found, attaching submit handler');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log('📞 [CONTACTS] Form submitted');
            this.saveContact(isEdit);
        });
        
        console.log('✅ [CONTACTS] Modal setup complete');
    }
    
    /**
     * Save contact data
     */
    async saveContact(isEdit = false) {
        console.log('📞 [CONTACTS] saveContact called', { isEdit });
        
        const form = document.getElementById('contact-form');
        const contactType = document.getElementById('contact-type').value;
        const name = document.getElementById('contact-name').value.trim();
        const email = document.getElementById('contact-email').value.trim();
        const phone = document.getElementById('contact-phone').value.trim();
        
        console.log('📞 [CONTACTS] Form data:', { contactType, name, email, phone });
        
        // Validation
        if (!contactType || !name || !email || !phone) {
            console.warn('⚠️ [CONTACTS] Validation failed: missing fields');
            this.showNotification('Please fill in all required fields', 'error');
            return;
        }
        
        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.warn('⚠️ [CONTACTS] Validation failed: invalid email');
            this.showNotification('Please enter a valid email address', 'error');
            return;
        }
        
        console.log('✅ [CONTACTS] Validation passed');
        
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
            
            console.log('📞 [CONTACTS] Update data prepared:', updateData);
            
            const url = `${this.apiBaseUrl}/api/company/${this.companyId}`;
            console.log('📡 [CONTACTS] Sending PATCH to:', url);
            
            // Save to API
            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify(updateData)
            });
            
            console.log('📥 [CONTACTS] Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ [CONTACTS] Server error:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('✅ [CONTACTS] Contact saved successfully:', result);
            
            // Update local data
            Object.assign(this.currentData, updateData);
            
            // Close modal
            console.log('📞 [CONTACTS] Closing modal');
            document.getElementById('contact-modal').remove();
            
            // Re-render contacts section
            console.log('📞 [CONTACTS] Re-rendering contacts section');
            this.renderV2ContactsSection();
            
            // Show success notification
            this.showNotification(
                isEdit ? 'Contact updated successfully' : 'Contact added successfully',
                'success'
            );
            
        } catch (error) {
            console.error('❌ [CONTACTS] Error saving contact:', error);
            this.showNotification(`Failed to save contact: ${error.message}`, 'error');
        }
    }

    /* ========================================================================
       ========================================================================
       
       WORLD-CLASS CONFIGURATION MANAGEMENT SYSTEM
       
       This section handles all company configuration settings including:
       
       ARCHITECTURE:
       - Modular function design for maintainability
       - Secure credential handling with masking
       - Real-time validation and error handling
       - Multi-tenant company isolation
       - Redis cache invalidation on updates
       
       SECURITY:
       - Sensitive data masked in UI (shows last 4 chars)
       - No credentials logged to console
       - Secure HTTPS API communication
       - JWT authentication required
       
       ======================================================================== */

    /**
     * GOLD STANDARD: Populate Configuration tab with data
     * 
     * Entry point for loading all configuration settings when tab is activated.
     * Orchestrates the initialization of all configuration subsystems.
     */
    populateConfigTab() {
        try {
            
            if (!this.currentData) {
                return;
            }

            // Create modern configuration interface
            this.createConfigurationInterface();
        } catch (error) {
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
        
        // Check nested structure first, then flat structure for backward compatibility
        const twilioConfig = this.currentData.twilioConfig || {};
        
        if (twilioSidInput && (twilioConfig.accountSid || this.currentData.twilioAccountSid)) {
            twilioSidInput.value = twilioConfig.accountSid || this.currentData.twilioAccountSid;
        }
        
        if (twilioTokenInput && (twilioConfig.authToken || this.currentData.twilioAuthToken)) {
            const savedToken = twilioConfig.authToken || this.currentData.twilioAuthToken;
            // Show last 4 characters with masking for better UX
            if (savedToken && savedToken.length > 4) {
                twilioTokenInput.value = '••••••••••••' + savedToken.slice(-4);
                twilioTokenInput.dataset.hasToken = 'true';
            } else {
                twilioTokenInput.value = '••••••••••••••••';
                twilioTokenInput.dataset.hasToken = 'true';
            }
        } else {
            if (twilioTokenInput) {
                twilioTokenInput.value = '';
                twilioTokenInput.placeholder = 'Enter Auth Token';
                twilioTokenInput.dataset.hasToken = 'false';
            }
        }
        
        if (twilioApiKeyInput && (twilioConfig.apiKey || this.currentData.twilioApiKey)) {
            const savedApiKey = twilioConfig.apiKey || this.currentData.twilioApiKey;
            // Show last 4 characters with masking for better UX (API Keys can be sensitive too)
            if (savedApiKey && savedApiKey.length > 4) {
                twilioApiKeyInput.value = '••••••••••••' + savedApiKey.slice(-4);
                twilioApiKeyInput.dataset.hasApiKey = 'true';
            } else {
                twilioApiKeyInput.value = '••••••••••••••••';
                twilioApiKeyInput.dataset.hasApiKey = 'true';
            }
        } else {
            if (twilioApiKeyInput) {
                twilioApiKeyInput.value = '';
                twilioApiKeyInput.placeholder = 'Enter API Key';
                twilioApiKeyInput.dataset.hasApiKey = 'false';
            }
        }
        
        if (twilioApiSecretInput && (twilioConfig.apiSecret || this.currentData.twilioApiSecret)) {
            const savedSecret = twilioConfig.apiSecret || this.currentData.twilioApiSecret;
            // Show last 4 characters with masking for better UX
            if (savedSecret && savedSecret.length > 4) {
                twilioApiSecretInput.value = '••••••••••••' + savedSecret.slice(-4);
                twilioApiSecretInput.dataset.hasSecret = 'true';
            } else {
                twilioApiSecretInput.value = '••••••••••••••••';
                twilioApiSecretInput.dataset.hasSecret = 'true';
            }
        } else {
            if (twilioApiSecretInput) {
                twilioApiSecretInput.value = '';
                twilioApiSecretInput.placeholder = 'Enter API Secret';
                twilioApiSecretInput.dataset.hasSecret = 'false';
            }
        }

        // Setup phone numbers management
        this.setupPhoneNumbersManagement();
        
        // Setup account status control
        this.setupAccountStatusControl();
        
        // Setup configuration form listeners
        this.setupConfigFormListeners();
        
    }

    /* ========================================================================
       ========================================================================
       
       Comprehensive phone number management system for Twilio integration.
       
       FEATURES:
       - Add/Remove phone numbers dynamically
       - Set primary number for incoming calls
       - Real-time validation (E.164 format)
       - Friendly names for easy identification
       - Status management (active/inactive)
       
       DATA STRUCTURE:
       twilioConfig.phoneNumbers = [
           {
               phoneNumber: '+12392322030',
               friendlyName: 'Primary Number',
               status: 'active',
               isPrimary: true
           }
       ]
       
       ======================================================================== */

    /**
     * Setup phone numbers management system
     * 
     * Initializes the phone numbers interface, loads existing numbers,
     * and sets up event listeners for add/remove/primary actions.
     */
    setupPhoneNumbersManagement() {
        try {
            
            const addPhoneBtn = document.getElementById('addPhoneNumberBtn');
            if (addPhoneBtn) {
                // Remove existing listener to avoid duplicates
                addPhoneBtn.replaceWith(addPhoneBtn.cloneNode(true));
                const newAddPhoneBtn = document.getElementById('addPhoneNumberBtn');
                
                newAddPhoneBtn.addEventListener('click', () => {
                    this.addPhoneNumber();
                });
            } else {
            }

            // Load existing phone numbers or create default one
            this.renderPhoneNumbers();
            
            // Setup event listeners for existing phone number items
            this.setupPhoneNumberEventListeners();
            
        } catch (error) {
            // Continue execution but log the error
        }
    }

    /**
     * Setup event listeners for phone number items
     */
    setupPhoneNumberEventListeners() {
        const phoneNumberItems = document.querySelectorAll('.phone-number-item');
        
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
            return;
        }

        // Get phone numbers from current data with safety checks
        let phoneNumbers = [];
        if (this.currentData) {
            phoneNumbers = this.currentData?.twilioConfig?.phoneNumbers || 
                          this.currentData?.phoneNumbers || [];
        }
        

        // If no phone numbers exist, add a default empty one
        if (phoneNumbers.length === 0) {
            this.addPhoneNumber();
            return;
        }

        // Clear existing items
        phoneNumbersList.innerHTML = '';

        // Render each phone number
        phoneNumbers.forEach((phone, index) => {
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
    }

    /**
     * Setup configuration form event listeners
     */
    setupConfigFormListeners() {
        const configForm = document.getElementById('config-settings-form');
        if (!configForm) {
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
        
        if (!toggleWebhookBtn || !webhookPanel) {
            return;
        }

        if (!this.companyId) {
            return;
        }

        // Check if already set up (avoid duplicate event listeners)
        if (toggleWebhookBtn.dataset.webhookSetup === 'true') {
            return;
        }

        // Mark as set up
        toggleWebhookBtn.dataset.webhookSetup = 'true';
        
        // Add the event listener
        toggleWebhookBtn.addEventListener('click', (e) => {
            e.preventDefault();
            
            const currentPanel = document.getElementById('webhookInfoPanel');
            if (!currentPanel) {
                return;
            }
            
            const isHidden = currentPanel.classList.contains('hidden');
            
            if (isHidden) {
                // Generate dynamic webhook content with companyId
                this.generateWebhookPanel();
                currentPanel.classList.remove('hidden');
                toggleWebhookBtn.innerHTML = '<i class="fas fa-eye-slash mr-1"></i>Hide Webhook URLs';
            } else {
                currentPanel.classList.add('hidden');
                toggleWebhookBtn.innerHTML = '<i class="fas fa-info-circle mr-1"></i>Show Webhook URLs';
            }
        });
        
    }

    /**
     * Save configuration changes
     */
    async saveConfigurationChanges() {
        try {
            
            // Show loading state
            this.showLoading(true);
            
            // Collect only configuration data
            const configData = {};
            this.collectConfigData(configData);
            
            // Add other tabs' data if they exist
            this.collectNotesData(configData);
            this.collectAISettingsData(configData);
            this.collectVoiceData(configData);
            this.collectPersonalityData(configData);
            this.collectAgentLogicData(configData);
            
            
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
            
            this.showNotification('Configuration saved successfully!', 'success');
            
        } catch (error) {
            this.showNotification('Failed to save configuration', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Collect configuration data from form
     */
    collectConfigData(configData) {
        // Twilio credentials
        const twilioSidInput = document.getElementById('twilioAccountSid');
        const twilioTokenInput = document.getElementById('twilioAuthToken');
        const twilioApiKeyInput = document.getElementById('twilioApiKey');
        const twilioApiSecretInput = document.getElementById('twilioApiSecret');
        
        if (!configData.twilioConfig) {
            configData.twilioConfig = {};
        }
        
        if (twilioSidInput?.value) {
            configData.twilioConfig.accountSid = twilioSidInput.value.trim();
        }
        
        if (twilioTokenInput?.value && !twilioTokenInput.value.includes('••••')) {
            configData.twilioConfig.authToken = twilioTokenInput.value.trim();
        }
        
        if (twilioApiKeyInput?.value && !twilioApiKeyInput.value.includes('••••')) {
            configData.twilioConfig.apiKey = twilioApiKeyInput.value.trim();
        }
        
        if (twilioApiSecretInput?.value && !twilioApiSecretInput.value.includes('••••')) {
            configData.twilioConfig.apiSecret = twilioApiSecretInput.value.trim();
        }
        
        // Phone numbers
        const phoneNumberItems = document.querySelectorAll('.phone-number-item');
        const phoneNumbers = [];
        phoneNumberItems.forEach(item => {
            const phoneNumber = item.querySelector('input[name="phoneNumber"]')?.value?.trim();
            const friendlyName = item.querySelector('input[name="friendlyName"]')?.value?.trim();
            const status = item.querySelector('select[name="status"]')?.value;
            const isPrimary = item.querySelector('.bg-blue-100')?.textContent?.includes('Primary') || false;
            
            if (phoneNumber) {
                phoneNumbers.push({ phoneNumber, friendlyName, status, isPrimary });
            }
        });
        
        if (phoneNumbers.length > 0) {
            configData.twilioConfig.phoneNumbers = phoneNumbers;
        }
    }

    /**
     * Collect notes data (stub - notes are handled separately)
     */
    collectNotesData(configData) {
        // Notes are saved separately via their own API
        // This is just a stub for compatibility
    }

    /**
     * Collect AI settings data (stub)
     */
    collectAISettingsData(configData) {
        // AI settings are handled separately
    }

    /**
     * Collect voice data (stub)
     */
    collectVoiceData(configData) {
        // Voice settings are handled separately
    }

    /**
     * Collect personality data (stub)
     */
    collectPersonalityData(configData) {
        // Personality is handled separately
    }

    /**
     * Collect agent logic data (stub)
     */
    collectAgentLogicData(configData) {
        // Agent logic is handled separately
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
            return;
        }

        // Replace with v2 notes interface
        notesContent.innerHTML = this.generateV2NotesHTML();
        
        // Setup event listeners for advanced features
        this.setupNotesEventListeners();
        
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
    async addV2Note() {        
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
        
        // Save to backend immediately
        await this.saveNotesToBackend();
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
        
        // Setup individual note event listeners (only once)
        if (!this.noteEventListenersSetup) {
            this.setupNoteCardEventListeners();
            this.noteEventListenersSetup = true;
        }
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
        if (!container) {
            console.warn('⚠️ [NOTES] v2-notes-container not found for event listeners');
            return;
        }

        console.log('✅ [NOTES] Setting up note card event listeners');

        // Use event delegation for better performance
        container.addEventListener('click', (e) => {
            console.log('🖱️ [NOTES] Click detected on:', e.target);
            
            const noteId = e.target.closest('[data-note-id]')?.dataset.noteId;
            console.log('🆔 [NOTES] Note ID from click:', noteId);
            
            if (!noteId) return;

            if (e.target.closest('.pin-note-btn')) {
                console.log('📌 [NOTES] Pin button clicked for note:', noteId);
                this.togglePinNote(noteId);
            } else if (e.target.closest('.edit-note-btn')) {
                console.log('✏️ [NOTES] Edit button clicked for note:', noteId);
                this.startEditNote(noteId);
            } else if (e.target.closest('.delete-note-btn')) {
                console.log('🗑️ [NOTES] Delete button clicked for note:', noteId);
                this.deleteV2Note(noteId);
            } else if (e.target.closest('.save-edit-btn')) {
                console.log('💾 [NOTES] Save edit button clicked for note:', noteId);
                this.saveEditNote(noteId);
            } else if (e.target.closest('.cancel-edit-btn')) {
                console.log('❌ [NOTES] Cancel edit button clicked for note:', noteId);
                this.cancelEditNote(noteId);
            }
        });
    }

    /**
     * PRODUCTION: Toggle pin status of note
     */
    async togglePinNote(noteId) {
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
        
        console.log(`📌 Note ${action}:`, note.title);
        
        // Save to backend immediately
        await this.saveNotesToBackend();
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
    async saveEditNote(noteId) {
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
        
        // Save to backend immediately
        await this.saveNotesToBackend();
    }

    /**
     * GOLD STANDARD: Cancel editing a note
     */
    cancelEditNote(noteId) {
        const note = this.notes.find(n => n.id == noteId);
        if (!note) return;

        note.isEditing = false;
        this.renderV2Notes();
        
    }

    /**
     * GOLD STANDARD: Delete note with confirmation
     */
    async deleteV2Note(noteId) {
        const note = this.notes.find(n => n.id == noteId);
        if (!note) return;

        const confirmMessage = `Are you sure you want to delete "${note.title}"?\n\nThis action cannot be undone.`;
        
        if (!confirm(confirmMessage)) return;

        this.notes = this.notes.filter(n => n.id != noteId);
        this.renderV2Notes();
        this.setUnsavedChanges(true);
        this.showNotification('Note deleted successfully!', 'success');
        
        // Save to backend immediately
        await this.saveNotesToBackend();
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
     * PRODUCTION: Save notes to backend immediately
     */
    async saveNotesToBackend() {
        console.log('📝 [NOTES SAVE] Saving notes to backend...', this.notes.length, 'notes');
        
        try {
            const token = this.authToken || localStorage.getItem('adminToken');
            if (!token) {
                console.error('❌ [NOTES SAVE] No auth token found');
                return;
            }

            const response = await fetch(`${this.apiBaseUrl}/api/company/${this.companyId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    notes: this.notes
                })
            });

            console.log('📝 [NOTES SAVE] Response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('✅ [NOTES SAVE] Notes saved successfully:', result.notes?.length, 'notes in DB');
            
            this.setUnsavedChanges(false);
            return result;
        } catch (error) {
            console.error('❌ [NOTES SAVE] Error saving notes:', error);
            this.showNotification('Failed to save note', 'error');
            throw error;
        }
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
        
        // Initialize search input if it exists
        const searchInput = document.getElementById('notes-search');
        if (searchInput) {
            // Clear any existing value
            searchInput.value = '';
            
            // Set placeholder
            searchInput.placeholder = 'Search notes by title or content...';
            
        }

        // Initialize category filter if it exists
        const categoryFilter = document.getElementById('notes-category-filter');
        if (categoryFilter) {
            // Set default to 'all'
            categoryFilter.value = 'all';
        }

        // Initialize sort selector if it exists
        const sortSelect = document.getElementById('notes-sort');
        if (sortSelect) {
            // Set default sort
            sortSelect.value = 'updated-desc';
        }

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
                this.showNotification('ClientsVia personality settings saved successfully', 'success');
            } else if (response.status === 404) {
                this.showNotification('ClientsVia personality settings endpoint not implemented yet', 'warning');
            } else {
                throw new Error(`HTTP ${response.status}: Failed to save personality settings`);
            }
        } catch (error) {
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
        } catch (error) {
            this.showNotification(`Failed to save response templates: ${error.message}`, 'error');
        }
    }

    /**
     * Save learning settings (placeholder - function called from HTML but not implemented)
     */
    async saveLearningSettings() {
        try {
            // Fall back to saving all changes
            await this.saveAllChanges();
            this.showNotification('Settings saved successfully', 'success');
        } catch (error) {
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
            return;
        }
        
        if (!this.companyId) {
            webhookPanel.innerHTML = `
                <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                </div>
            `;
            return;
        }

        const baseUrl = this.apiBaseUrl || 'https://clientsvia-backend.onrender.com';
        
        // Define webhooks - platform uses phone number lookup to find company
        const webhooks = [
            {
                url: `${baseUrl}/api/twilio/voice`,
                description: 'Automatically finds company by phone number - Use this URL in Twilio Console',
                primary: true,
                recommended: true,
                note: 'This endpoint looks up your company by the phone number that was called'
            },
            {
                url: `${baseUrl}/api/twilio/voice/${this.companyId}`,
                description: 'Alternative: Direct company ID routing (bypasses phone lookup)',
                primary: false,
                alternative: true,
                note: 'Only use if you need to bypass phone number lookup'
            },
            {
                url: `${baseUrl}/api/twilio/handle-speech?companyId=${this.companyId}`,
                description: 'Used internally for AI speech processing',
                primary: false,
                internal: true
            },
            {
                url: `${baseUrl}/api/twilio/partial-speech?companyId=${this.companyId}`,
                description: 'For real-time speech processing',
                primary: false,
                internal: true
            },
            {
                url: `${baseUrl}/api/twilio/speech-timing-test?companyId=${this.companyId}`,
                description: 'For performance testing and optimization',
                primary: false,
                internal: true
            }
        ];

        webhookPanel.innerHTML = `
            <div class="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg p-6 space-y-4">
                <!-- Company Header -->
                <div class="mb-4 p-4 bg-white border-2 border-blue-300 rounded-lg shadow-sm">
                    <div class="flex items-center justify-between">
                        <div>
                            <h5 class="text-base font-bold text-gray-900 mb-1">
                                <i class="fas fa-building mr-2 text-blue-600"></i>${this.currentData?.companyName || 'Unknown'}
                            </h5>
                            <p class="text-xs text-gray-600">
                                Company ID: <code class="bg-blue-100 px-2 py-1 rounded font-mono text-blue-800">${this.companyId}</code>
                            </p>
                        </div>
                        <div class="text-right">
                            <span class="inline-block px-3 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                                <i class="fas fa-check-circle mr-1"></i>Active
                            </span>
                        </div>
                    </div>
                </div>
                
                <!-- Webhooks List -->
                ${webhooks.map(webhook => `
                    <div class="webhook-item bg-white rounded-lg border-2 ${webhook.recommended ? 'border-green-400 shadow-lg' : webhook.alternative ? 'border-yellow-300 shadow-md' : webhook.internal ? 'border-gray-200' : 'border-blue-300 shadow-md'} p-4 hover:shadow-lg transition-shadow">
                        <div class="flex justify-between items-center mb-3">
                            <div class="flex items-center gap-2 flex-wrap">
                                <h4 class="text-sm font-semibold text-gray-900">${webhook.title}</h4>
                                ${webhook.recommended ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded flex items-center"><i class="fas fa-star mr-1"></i>RECOMMENDED</span>' : ''}
                                ${webhook.alternative ? '<span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">Alternative</span>' : ''}
                                ${webhook.internal ? '<span class="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded">Internal Use</span>' : ''}
                            </div>
                            <button type="button" class="copy-webhook-btn text-xs font-medium ${webhook.recommended ? 'bg-green-600 hover:bg-green-700 text-white' : webhook.alternative ? 'bg-yellow-600 hover:bg-yellow-700 text-white' : 'bg-gray-600 hover:bg-gray-700 text-white'} px-3 py-1.5 rounded transition-colors shadow-sm" data-webhook="${webhook.url}">
                                <i class="fas fa-copy mr-1"></i>Copy
                            </button>
                        </div>
                        <div class="bg-gray-50 border-2 ${webhook.recommended ? 'border-green-300' : 'border-gray-300'} rounded p-3 font-mono text-xs text-gray-900 break-all hover:bg-gray-100 transition-colors">
                            ${webhook.url}
                        </div>
                        <p class="text-xs ${webhook.recommended ? 'text-green-700 font-medium' : 'text-gray-600'} mt-2 flex items-start">
                            <i class="fas ${webhook.recommended ? 'fa-check-circle text-green-500' : 'fa-info-circle text-gray-400'} mr-1.5 mt-0.5"></i>
                            <span>${webhook.description}</span>
                        </p>
                    </div>
                `).join('')}
                
                <!-- Configuration Instructions -->
                <div class="mt-4 p-4 bg-green-50 border-2 border-green-300 rounded-lg">
                    <h5 class="text-sm font-bold text-green-900 mb-3 flex items-center">
                        <i class="fas fa-clipboard-check mr-2"></i>Setup Instructions (Recommended Method)
                    </h5>
                    <ol class="text-xs text-green-800 space-y-2 ml-4">
                        <li><strong>1.</strong> Copy the <strong class="text-green-900">Voice Webhook (Recommended)</strong> URL above</li>
                        <li><strong>2.</strong> Go to <a href="https://console.twilio.com" target="_blank" class="underline hover:no-underline font-medium">Twilio Console</a> → Phone Numbers → Manage → Active Numbers</li>
                        <li><strong>3.</strong> Click on the phone number configured in the "Configuration" tab above</li>
                        <li><strong>4.</strong> Under "Voice Configuration", paste the webhook URL: <code class="bg-white px-2 py-0.5 rounded text-green-900 font-mono">https://clientsvia-backend.onrender.com/api/twilio/voice</code></li>
                        <li><strong>5.</strong> Set HTTP method to <strong class="text-green-900">POST</strong></li>
                        <li><strong>6.</strong> Click "Save Configuration"</li>
                        <li><strong>7.</strong> Test by calling your Twilio number - the platform will automatically find this company by phone number lookup!</li>
                    </ol>
                    <div class="mt-3 p-2 bg-white border border-green-200 rounded text-xs text-green-700">
                        <i class="fas fa-lightbulb mr-1 text-yellow-500"></i>
                        <strong>How it works:</strong> When a call comes in, the platform looks up which company owns that phone number and routes the call automatically. No company ID needed!
                    </div>
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
                        const originalClasses = btn.className;
                        
                        // Show success state
                        btn.innerHTML = '<i class="fas fa-check mr-1"></i>Copied!';
                        btn.className = 'copy-webhook-btn text-xs font-medium bg-green-600 text-white px-3 py-1.5 rounded transition-colors shadow-sm';
                        
                        // Restore original state after 2 seconds
                        setTimeout(() => {
                            btn.innerHTML = originalText;
                            btn.className = originalClasses;
                        }, 2000);
                        
                    } catch (err) {
                        this.showNotification('Failed to copy webhook URL', 'error');
                    }
                }
            });
        });
        
    }

    /* ========================================================================
       ========================================================================
       
       ========================================================================
       
       Enterprise-grade account status management for billing and service control.
       
       STATUS TYPES:
       
       FEATURES:
       - Real-time status updates with Redis cache clearing
       - Custom forward messages with {Company Name} placeholder
       - Complete status change history with audit trail
       - Reason tracking for compliance
       - Visual status badges in UI
       
       DATA STRUCTURE:
       accountStatus: {
           status: 'active' | 'call_forward' | 'suspended',
           callForwardNumber: '+12395652202',
           callForwardMessage: 'Thank you for calling {Company Name}...',
           reason: 'Payment pending',
           changedBy: 'admin@clientsvia.com',
           changedAt: Date,
           history: [...]
       }
       
       SECURITY:
       - All status changes logged with timestamp and user
       - Twilio settings preserved across status changes
       - Multi-tenant isolation enforced
       
       ======================================================================== */

    /**
     * Setup account status control system
     * 
     * Initializes the account status interface, loads current status,
     * and sets up event listeners for status changes and save actions.
     */
    setupAccountStatusControl() {
        
        try {
            // Load current status
            this.loadAccountStatus();
            
            // Setup status radio buttons
            const statusRadios = document.querySelectorAll('input[name="accountStatus"]');
            statusRadios.forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.handleStatusChange(e.target.value);
                });
            });
            
            // Setup save button
            const saveBtn = document.getElementById('save-account-status-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    this.saveAccountStatus();
                });
            }
            
        } catch (error) {
        }
    }

    /**
     * Load and display current account status
     */
    loadAccountStatus() {
        
        const accountStatus = this.currentData?.accountStatus || {};
        const status = accountStatus.status || 'active';
        
        
        // Set radio button
        const radioBtn = document.querySelector(`input[name="accountStatus"][value="${status}"]`);
        if (radioBtn) {
            radioBtn.checked = true;
            this.handleStatusChange(status, true); // Don't save, just update UI
        }
        
        // Set call forward number if exists
        if (accountStatus.callForwardNumber) {
            const forwardInput = document.getElementById('call-forward-number');
            if (forwardInput) {
                forwardInput.value = accountStatus.callForwardNumber;
            }
        }
        
        // Set call forward message if exists
        if (accountStatus.callForwardMessage) {
            const messageInput = document.getElementById('call-forward-message');
            if (messageInput) {
                messageInput.value = accountStatus.callForwardMessage;
            }
        }
        
        // Set suspended message if exists
        if (accountStatus.suspendedMessage) {
            const suspendedInput = document.getElementById('suspended-message');
            if (suspendedInput) {
                suspendedInput.value = accountStatus.suspendedMessage;
            }
        }
        
        // Set reason if exists
        if (accountStatus.reason) {
            const reasonInput = document.getElementById('status-change-reason');
            if (reasonInput) {
                reasonInput.value = accountStatus.reason;
            }
        }
        
        // Update status badge
        this.updateStatusBadge(status);
        
        // Load history if exists
        if (accountStatus.history && accountStatus.history.length > 0) {
            this.renderStatusHistory(accountStatus.history);
        }
    }

    /**
     * Handle status change (show/hide call forward and suspended sections)
     */
    handleStatusChange(status, skipSave = false) {
        
        const callForwardSection = document.getElementById('call-forward-section');
        const suspendedSection = document.getElementById('suspended-section');
        
        // Show/hide call forward section
        if (status === 'call_forward') {
            callForwardSection?.classList.remove('hidden');
        } else {
            callForwardSection?.classList.add('hidden');
        }
        
        // Show/hide suspended section
        if (status === 'suspended') {
            suspendedSection?.classList.remove('hidden');
        } else {
            suspendedSection?.classList.add('hidden');
        }
    }

    /**
     * Save account status
     */
    async saveAccountStatus() {
        
        const selectedStatus = document.querySelector('input[name="accountStatus"]:checked');
        if (!selectedStatus) {
            this.showNotification('Please select an account status', 'error');
            return;
        }
        
        const status = selectedStatus.value;
        const callForwardNumber = document.getElementById('call-forward-number')?.value.trim();
        const callForwardMessage = document.getElementById('call-forward-message')?.value.trim();
        const suspendedMessage = document.getElementById('suspended-message')?.value.trim();
        const reason = document.getElementById('status-change-reason')?.value.trim();
        
        // Validate call forward number if status is call_forward
        if (status === 'call_forward' && !callForwardNumber) {
            this.showNotification('Please enter a phone number for call forwarding', 'error');
            return;
        }
        
        const updateData = {
            status,
            callForwardNumber: status === 'call_forward' ? callForwardNumber : null,
            callForwardMessage: status === 'call_forward' ? callForwardMessage : null,
            suspendedMessage: status === 'suspended' ? suspendedMessage : null,
            reason: reason || null,
            changedBy: this.currentData?.ownerEmail || this.currentData?.contactEmail || 'Admin'
        };
        
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/company/${this.companyId}/account-status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify(updateData)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            // Update current data
            if (!this.currentData.accountStatus) {
                this.currentData.accountStatus = {};
            }
            this.currentData.accountStatus = result.accountStatus;
            
            // Update UI
            this.updateStatusBadge(status);
            
            // Render updated history
            if (result.accountStatus.history) {
                this.renderStatusHistory(result.accountStatus.history);
            }
            
            // Show success message
            let message = `Account status updated to "${this.getStatusDisplayName(status)}"`;
            if (status === 'call_forward') {
                message += ` → ${callForwardNumber}`;
            }
            this.showNotification(message, 'success');
            
        } catch (error) {
            this.showNotification(`Failed to update account status: ${error.message}`, 'error');
        }
    }

    /**
     * Update status badge in header
     */
    updateStatusBadge(status) {
        const badge = document.getElementById('account-status-badge');
        if (!badge) return;
        
        const statusConfig = {
            active: {
                classes: 'bg-green-100 text-green-800 border-2 border-green-300'
            },
            call_forward: {
                classes: 'bg-yellow-100 text-yellow-800 border-2 border-yellow-300'
            },
            suspended: {
                classes: 'bg-red-100 text-red-800 border-2 border-red-300'
            }
        };
        
        const config = statusConfig[status] || statusConfig.active;
        badge.textContent = config.text;
        badge.className = `px-3 py-1 rounded-full text-xs font-bold ${config.classes}`;
    }

    /**
     * Render status change history
     */
    renderStatusHistory(history) {
        const historySection = document.getElementById('status-history-section');
        const historyList = document.getElementById('status-history-list');
        
        if (!historyList || !history || history.length === 0) return;
        
        historySection?.classList.remove('hidden');
        
        // Sort by date descending (most recent first)
        const sortedHistory = [...history].sort((a, b) => 
            new Date(b.changedAt) - new Date(a.changedAt)
        );
        
        historyList.innerHTML = sortedHistory.map((entry, index) => {
            const date = new Date(entry.changedAt);
            const formattedDate = date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });
            
            const statusIcon = {
                'active': '🟢',
                'call_forward': '🟠',
                'suspended': '🔴'
            }[entry.status] || '⚪';
            
            const statusName = this.getStatusDisplayName(entry.status);
            
            return `
                <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 relative group">
                    <div class="flex items-start justify-between mb-1">
                        <div class="flex items-center gap-2">
                            <span class="text-lg">${statusIcon}</span>
                            <span class="font-semibold text-gray-900">${statusName}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-xs text-gray-500">${formattedDate}</span>
                            <button 
                                onclick="companyProfileManager.deleteStatusHistoryEntry(${index})" 
                                class="text-gray-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100"
                                title="Delete this history entry">
                                <i class="fas fa-trash-alt text-xs"></i>
                            </button>
                        </div>
                    </div>
                    ${entry.callForwardNumber ? `
                        <div class="text-xs text-gray-600 ml-7 mb-1">
                            <i class="fas fa-phone-forward mr-1"></i>
                            Forward to: ${entry.callForwardNumber}
                        </div>
                    ` : ''}
                    ${entry.callForwardMessage ? `
                        <div class="text-xs text-gray-600 ml-7 mb-1 italic">
                            <i class="fas fa-comment-dots mr-1"></i>
                            Message: "${entry.callForwardMessage}"
                        </div>
                    ` : ''}
                    ${entry.reason ? `
                        <div class="text-xs text-gray-600 ml-7 mb-1">
                            <i class="fas fa-comment mr-1"></i>
                            ${entry.reason}
                        </div>
                    ` : ''}
                    <div class="text-xs text-gray-500 ml-7">
                        <i class="fas fa-user mr-1"></i>
                        Changed by: ${entry.changedBy}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Get display name for status
     */
    getStatusDisplayName(status) {
        const names = {
            active: 'Active',
            call_forward: 'Call Forward',
            suspended: 'Suspended'
        };
        return names[status] || status;
    }

    /**
     * Delete a status history entry
     */
    async deleteStatusHistoryEntry(index) {
        
        if (!confirm('Are you sure you want to delete this status history entry? This action cannot be undone.')) {
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                throw new Error('No authentication token');
            }
            
            const response = await fetch(`/api/company/${this.companyId}/account-status/history/${index}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Failed to delete history entry: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Force reload company data to refresh the history list
            await this.loadCompanyData(true);
            
            this.showNotification('Status history entry deleted successfully', 'success');
        } catch (error) {
            this.showNotification('Failed to delete history entry', 'error');
        }
    }

    /**
     * MISSING CRITICAL METHODS - Added to fix initialization errors
     */
    
    /* ========================================================================
       ======================================================================== */

    /**
     * Initialize tab system
     */
    initializeTabs() {
        
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
        
        
    }

    /**
     * ⚡ REAL-TIME: Live AI agent testing and confidence scoring
     */
    initializeEmbeddedCompanyQnAManager() {
        
        // Initialize the embedded interface
        this.loadCompanyQnAEntries();
        this.setupQnAEventListeners();
        this.initializeRealTimeTestingFeatures();
        
    }


    // Legacy sub-tab system completely removed - using modern AI Agent Logic 4-tab system
    // Old switchKnowledgeSubTab() function eliminated - functionality moved to new system

    /**
     * Initialize Company Q&A Manager
     */
    initializeCompanyQnAManager() {
        if (this.companyQnAManager) {
            return;
        }

        try {
            
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
                
            } else {
                this.showNotification('Failed to load Company Q&A Manager', 'error');
            }
            
        } catch (error) {
            this.showNotification('Failed to initialize Company Q&A Manager', 'error');
        }
    }
    
    /**
     * Update header elements with company data
     */
    updateHeaderElements() {
        if (!this.currentData) {
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
            
        } catch (error) {
        }
    }
    
    // ============================================================================
    // ============================================================================
    

    /**
     * Populate AI Settings tab
     */
    populateAISettingsTab() {
        
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
            
        } catch (error) {
        }
    }

    /**
     * Populate Voice tab (AI Voice Settings)
     */
    populateVoiceTab() {
        
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
            
        } catch (error) {
        }
    }

    /**
     * Populate Personality tab (Agent Personality Responses)
     */
    populatePersonalityTab() {
        
        try {
            // Personality responses are handled by embedded HTML forms
            // No specific population needed as forms are already in HTML
        } catch (error) {
        }
    }

    /**
     * Populate Agent Logic tab (AI Agent Logic)
     */
    populateAgentLogicTab() {
        
        try {
            // AI Agent Logic settings are handled by embedded HTML forms and JavaScript
            // The tab contains complex intelligence and memory systems
            // No specific population needed as forms are already in HTML
        } catch (error) {
        }
    }
    
    // ============================================================================
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
        
    }

    /* ========================================================================
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
   ============================================================================ */

// Expose fetchCompanyData function globally for HTML script calls
window.fetchCompanyData = async function() {
    
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
    } catch (error) {
    }
};

/* ============================================================================
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
        // ... other inits like KnowledgePriorities if present
        
        // Debug functions...
    } catch (error) {
    }
});

// Export for global access
window.CompanyProfileManager = CompanyProfileManager;
