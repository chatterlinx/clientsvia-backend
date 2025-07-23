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
        
        // Set global references for legacy compatibility
        window.currentCompanyId = this.companyId;
        window.companyId = this.companyId;
        
        console.log('🔍 Company ID extracted:', this.companyId);
    }

    /**
     * Initialize DOM element references
     */
    initializeDOM() {
        // Overview tab - VIEW elements (read-only display)
        this.domElements = {
            // View elements for display
            companyNameView: document.getElementById('company-name-view'),
            companyOwnerView: document.getElementById('company-owner-view'),
            companyOwnerEmailView: document.getElementById('company-owner-email-view'),
            companyOwnerPhoneView: document.getElementById('company-owner-phone-view'),
            companyContactNameView: document.getElementById('company-contact-name-view'),
            companyContactEmailView: document.getElementById('company-contact-email-view'),
            companyContactPhoneView: document.getElementById('company-contact-phone-view'),
            companyAddressView: document.getElementById('company-address-view'),
            
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
        const requiredElements = ['companyNameView', 'editFormContainer', 'editButton'];
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

        // Edit button
        if (this.domElements.editButton) {
            this.domElements.editButton.addEventListener('click', () => {
                this.showEditForm();
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
        this.saveButton.className = 'fixed bottom-6 right-6 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-y-20 opacity-0';
        this.saveButton.innerHTML = '<i class="fas fa-save mr-2"></i>Save Changes';
        this.saveButton.style.display = 'none';
        
        this.saveButton.addEventListener('click', async () => {
            await this.saveAllChanges();
        });
        
        document.body.appendChild(this.saveButton);
    }

    /**
     * Show save button with animation
     */
    showSaveButton() {
        if (!this.saveButton) return;
        
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
            console.log('📥 Loading company data...');
            this.showLoading(true);

            const response = await fetch(`${this.apiBaseUrl}/api/company/${this.companyId}`);
            
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
            this.showNotification('Failed to load company data', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Populate Overview tab with data
     */
    populateOverviewTab() {
        if (!this.currentData) return;

        console.log('📄 Populating Overview tab...');

        // Update header elements
        this.updateHeaderElements();

        // Modern UX: Show editable form directly, no separate view/edit modes
        this.createModernEditableForm();
        
        // Still populate view elements for any legacy components that need them
        this.populateViewElements();
    }

    /**
     * Populate view elements (for legacy compatibility)
     */
    populateViewElements() {
        const viewMappings = {
            companyNameView: this.currentData.companyName || this.currentData.name || 'No name provided',
            companyOwnerView: this.currentData.ownerName || 'No owner provided',
            companyOwnerEmailView: this.currentData.ownerEmail || this.currentData.businessEmail || 'No email provided',
            companyOwnerPhoneView: this.currentData.ownerPhone || this.currentData.businessPhone || 'No phone provided',
            companyContactNameView: this.currentData.contactName || 'No contact provided',
            companyContactEmailView: this.currentData.contactEmail || this.currentData.businessEmail || 'No contact email provided',
            companyContactPhoneView: this.currentData.contactPhone || this.currentData.businessPhone || 'No contact phone provided',
            companyAddressView: this.formatAddress(this.currentData)
        };

        Object.entries(viewMappings).forEach(([elementKey, value]) => {
            const element = this.domElements[elementKey];
            if (element) {
                element.textContent = value;
                console.log(`✅ ${elementKey}:`, value);
            }
        });
    }

    /**
     * Create modern always-editable form
     */
    createModernEditableForm() {
        if (!this.domElements.editFormContainer) return;

        const formHTML = `
            <div class="bg-white rounded-lg border border-gray-200 p-6">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-lg font-semibold text-gray-900">Company Information</h3>
                    <span class="text-sm text-gray-500">All fields are editable</span>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label class="form-label">Company Name *</label>
                        <input type="text" id="edit-company-name" class="form-input" 
                               value="${this.escapeHtml(this.currentData.companyName || this.currentData.name || '')}"
                               placeholder="Enter company name">
                    </div>
                    <div>
                        <label class="form-label">Business Phone</label>
                        <input type="tel" id="edit-business-phone" class="form-input" 
                               value="${this.escapeHtml(this.currentData.businessPhone || '')}"
                               placeholder="+1-555-123-4567">
                    </div>
                    <div>
                        <label class="form-label">Business Email</label>
                        <input type="email" id="edit-business-email" class="form-input" 
                               value="${this.escapeHtml(this.currentData.businessEmail || '')}"
                               placeholder="contact@company.com">
                    </div>
                    <div>
                        <label class="form-label">Website</label>
                        <input type="url" id="edit-business-website" class="form-input" 
                               value="${this.escapeHtml(this.currentData.businessWebsite || '')}"
                               placeholder="https://www.company.com">
                    </div>
                    <div class="md:col-span-2">
                        <label class="form-label">Business Address</label>
                        <input type="text" id="edit-business-address" class="form-input" 
                               value="${this.escapeHtml(this.currentData.businessAddress || '')}"
                               placeholder="123 Main St, City, State 12345">
                    </div>
                    <div class="md:col-span-2">
                        <label class="form-label">Description</label>
                        <textarea id="edit-description" class="form-textarea" rows="3" 
                                  placeholder="Describe your business and services...">${this.escapeHtml(this.currentData.description || '')}</textarea>
                    </div>
                    <div>
                        <label class="form-label">Service Area</label>
                        <input type="text" id="edit-service-area" class="form-input" 
                               value="${this.escapeHtml(this.currentData.serviceArea || '')}"
                               placeholder="Greater Metro Area">
                    </div>
                    <div>
                        <label class="form-label">Business Hours</label>
                        <input type="text" id="edit-business-hours" class="form-input" 
                               value="${this.escapeHtml(this.currentData.businessHours || '')}"
                               placeholder="Monday-Friday: 9:00 AM - 5:00 PM">
                    </div>
                </div>
                
                <div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div class="flex items-center">
                        <i class="fas fa-info-circle text-blue-600 mr-2"></i>
                        <span class="text-sm text-blue-800">Changes are tracked automatically. Save button will appear when you make edits.</span>
                    </div>
                </div>
            </div>
        `;

        this.domElements.editFormContainer.innerHTML = formHTML;
        this.domElements.editFormContainer.classList.remove('hidden');

        // Hide the static view elements since we're using the modern always-editable form
        const staticViewContainer = document.getElementById('company-details-view');
        if (staticViewContainer) {
            staticViewContainer.style.display = 'none';
        }

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
     * Create editable form in the edit container
     */
    createEditForm() {
        if (!this.domElements.editFormContainer) return;

        const formHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label class="form-label">Company Name</label>
                    <input type="text" id="edit-company-name" class="form-input" 
                           value="${this.escapeHtml(this.currentData.companyName || this.currentData.name || '')}">
                </div>
                <div>
                    <label class="form-label">Business Phone</label>
                    <input type="tel" id="edit-business-phone" class="form-input" 
                           value="${this.escapeHtml(this.currentData.businessPhone || '')}">
                </div>
                <div>
                    <label class="form-label">Business Email</label>
                    <input type="email" id="edit-business-email" class="form-input" 
                           value="${this.escapeHtml(this.currentData.businessEmail || '')}">
                </div>
                <div>
                    <label class="form-label">Website</label>
                    <input type="url" id="edit-business-website" class="form-input" 
                           value="${this.escapeHtml(this.currentData.businessWebsite || '')}">
                </div>
                <div class="md:col-span-2">
                    <label class="form-label">Business Address</label>
                    <input type="text" id="edit-business-address" class="form-input" 
                           value="${this.escapeHtml(this.currentData.businessAddress || '')}">
                </div>
                <div class="md:col-span-2">
                    <label class="form-label">Description</label>
                    <textarea id="edit-description" class="form-textarea" rows="3">${this.escapeHtml(this.currentData.description || '')}</textarea>
                </div>
                <div>
                    <label class="form-label">Service Area</label>
                    <input type="text" id="edit-service-area" class="form-input" 
                           value="${this.escapeHtml(this.currentData.serviceArea || '')}">
                </div>
                <div>
                    <label class="form-label">Business Hours</label>
                    <input type="text" id="edit-business-hours" class="form-input" 
                           value="${this.escapeHtml(this.currentData.businessHours || '')}">
                </div>
            </div>
            <div class="flex justify-end space-x-3 mt-6">
                <button type="button" id="cancel-edit-btn" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg">
                    Cancel
                </button>
                <button type="button" id="save-edit-btn" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">
                    <i class="fas fa-save mr-2"></i>Save Changes
                </button>
            </div>
        `;

        this.domElements.editFormContainer.innerHTML = formHTML;
        this.domElements.editFormContainer.classList.remove('hidden');

        // Add event listeners for edit form
        this.setupEditFormListeners();
    }

    /**
     * Setup event listeners for the edit form
     */
    setupEditFormListeners() {
        const saveBtn = document.getElementById('save-edit-btn');
        const cancelBtn = document.getElementById('cancel-edit-btn');

        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveAllChanges());
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelEdit());
        }

        // Track changes in edit form
        const editInputs = this.domElements.editFormContainer.querySelectorAll('input, textarea');
        editInputs.forEach(input => {
            input.addEventListener('input', () => this.setUnsavedChanges(true));
        });
    }

    /**
     * Cancel editing and hide form
     */
    cancelEdit() {
        this.domElements.editFormContainer.classList.add('hidden');
        this.setUnsavedChanges(false);
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
        console.log('⚙️ Populating Config tab...');
        
        if (!this.currentData) {
            console.log('⚠️ No company data available for Config tab');
            return;
        }

        // Create modern configuration interface
        this.createConfigurationInterface();
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
        
        if (twilioSidInput && this.currentData.twilioAccountSid) {
            twilioSidInput.value = this.currentData.twilioAccountSid;
        }
        
        if (twilioTokenInput && this.currentData.twilioAuthToken) {
            twilioTokenInput.value = '••••••••••••••••'; // Mask for security
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
        const addPhoneBtn = document.getElementById('addPhoneNumberBtn');
        if (addPhoneBtn) {
            addPhoneBtn.addEventListener('click', () => {
                this.addPhoneNumber();
            });
        }

        // Load existing phone numbers
        if (this.currentData.phoneNumbers && Array.isArray(this.currentData.phoneNumbers)) {
            this.renderPhoneNumbers(this.currentData.phoneNumbers);
        }
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
        
        this.setUnsavedChanges(true);
        console.log('📞 New phone number field added');
    }

    /**
     * Render existing phone numbers
     */
    renderPhoneNumbers(phoneNumbers) {
        phoneNumbers.forEach((phone, index) => {
            const phoneInputs = document.querySelectorAll('input[name="phoneNumber"]');
            if (phoneInputs[index]) {
                phoneInputs[index].value = phone.number || '';
            }
            
            const friendlyInputs = document.querySelectorAll('input[name="friendlyName"]');
            if (friendlyInputs[index]) {
                friendlyInputs[index].value = phone.friendlyName || '';
            }
        });
    }

    /**
     * Setup configuration form event listeners
     */
    setupConfigFormListeners() {
        const configForm = document.getElementById('config-settings-form');
        if (!configForm) return;

        // Track changes in configuration inputs
        const configInputs = configForm.querySelectorAll('input, select, textarea');
        configInputs.forEach(input => {
            input.addEventListener('input', () => {
                this.setUnsavedChanges(true);
                console.log(`⚙️ Config field changed: ${input.name || input.id}`);
            });
        });

        console.log('✅ Config form listeners setup');
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
        if (this.currentData?.aiSettings?.elevenLabs) {
            const settings = this.currentData.aiSettings.elevenLabs;
            
            if (apiKeyInput && settings.apiKey) {
                apiKeyInput.value = settings.apiKey.substring(0, 8) + '••••••••••••••••';
            }
            
            if (voiceSelect && settings.voiceId) {
                voiceSelect.value = settings.voiceId;
            }
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
        
        // Setup personality response fields
        this.setupPersonalityResponses();
        
        // Setup personality response form handlers
        this.setupPersonalityFormHandlers();
        
        console.log('✅ Personality tab configured');
    }

    /**
     * Setup personality response fields
     */
    setupPersonalityResponses() {
        const responseFields = [
            'greeting', 'farewell', 'hold', 'transfer', 'unavailable',
            'businessHours', 'afterHours', 'voicemail', 'callback'
        ];

        const responses = this.currentData?.personalityResponses || {};

        responseFields.forEach(field => {
            const input = document.getElementById(`personality-${field}`);
            if (input) {
                // Set current value if available
                if (responses[field]) {
                    input.value = responses[field];
                }
                
                // Set default placeholders for empty fields
                if (!input.value) {
                    input.placeholder = this.getDefaultPersonalityResponse(field);
                }

                // Track changes
                input.addEventListener('input', () => {
                    this.setUnsavedChanges(true);
                    console.log(`🎭 Personality ${field} updated`);
                });
            }
        });
    }

    /**
     * Get default personality response for a field
     */
    getDefaultPersonalityResponse(field) {
        const defaults = {
            greeting: 'Hello! Thank you for calling. How can I help you today?',
            farewell: 'Thank you for calling. Have a great day!',
            hold: 'Please hold for just a moment while I check on that for you.',
            transfer: 'Let me transfer you to someone who can better assist you.',
            unavailable: 'I\'m sorry, but that service is currently unavailable.',
            businessHours: 'Our business hours are Monday through Friday, 9 AM to 5 PM.',
            afterHours: 'Thank you for calling. We are currently closed. Please call back during business hours.',
            voicemail: 'Please leave your name, number, and a brief message, and we\'ll get back to you soon.',
            callback: 'I\'d be happy to have someone call you back. What\'s the best number to reach you?'
        };

        return defaults[field] || 'Enter your custom response here...';
    }

    /**
     * Setup personality form handlers
     */
    setupPersonalityFormHandlers() {
        const personalityForm = document.getElementById('personality-responses-form');
        if (!personalityForm) return;

        // Find and setup save button
        const saveBtn = personalityForm.querySelector('[data-save-type="personality"]') ||
                       personalityForm.querySelector('button[type="submit"]');
        
        if (saveBtn) {
            saveBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                await this.savePersonalityResponses();
            });
        }

        // Setup form submission
        personalityForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.savePersonalityResponses();
        });
    }

    /**
     * Save personality responses
     */
    async savePersonalityResponses() {
        try {
            console.log('💾 Saving personality responses...');
            
            const responses = {};
            const responseFields = [
                'greeting', 'farewell', 'hold', 'transfer', 'unavailable',
                'businessHours', 'afterHours', 'voicemail', 'callback'
            ];

            responseFields.forEach(field => {
                const input = document.getElementById(`personality-${field}`);
                if (input && input.value.trim()) {
                    responses[field] = input.value.trim();
                }
            });

            // In a real implementation, this would be a separate API call
            // For now, we'll include it in the main save
            if (this.currentData) {
                this.currentData.personalityResponses = responses;
            }

            this.showNotification('Personality responses saved successfully!', 'success');
            console.log('✅ Personality responses saved:', responses);
            
        } catch (error) {
            console.error('❌ Error saving personality responses:', error);
            this.showNotification('Failed to save personality responses', 'error');
        }
    }

    /**
     * Populate AI Agent Logic tab with data
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
    }

    /**
     * Save all changes to the backend
     */
    async saveAllChanges() {
        try {
            console.log('💾 Saving all changes...');
            this.showLoading(true);

            // Collect data from all tabs
            const updateData = this.collectAllFormData();

            const response = await fetch(`${this.apiBaseUrl}/api/company/${this.companyId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const savedData = await response.json();
            console.log('✅ Changes saved successfully:', savedData);

            this.currentData = { ...this.currentData, ...savedData.data || updateData };
            this.setUnsavedChanges(false);
            
            // Refresh the display with updated data
            this.populateOverviewTab();
            
            this.showNotification('All changes saved successfully!', 'success');

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
        
        // Agent Logic tab data
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
            if (input && input.value.trim()) {
                data[dataKey] = input.value.trim();
            }
        });
    }

    /**
     * Collect Configuration tab data
     */
    collectConfigData(data) {
        // Twilio credentials
        const twilioSid = document.getElementById('twilioAccountSid');
        const twilioToken = document.getElementById('twilioAuthToken');
        
        if (twilioSid?.value.trim()) {
            data.twilioAccountSid = twilioSid.value.trim();
        }
        
        if (twilioToken?.value.trim() && twilioToken.value !== '••••••••••••••••') {
            data.twilioAuthToken = twilioToken.value.trim();
        }

        // Phone numbers
        const phoneNumbers = [];
        const phoneInputs = document.querySelectorAll('input[name="phoneNumber"]');
        const friendlyInputs = document.querySelectorAll('input[name="friendlyName"]');
        
        phoneInputs.forEach((phoneInput, index) => {
            if (phoneInput.value.trim()) {
                phoneNumbers.push({
                    number: phoneInput.value.trim(),
                    friendlyName: friendlyInputs[index]?.value.trim() || '',
                    isPrimary: index === 0
                });
            }
        });
        
        if (phoneNumbers.length > 0) {
            data.phoneNumbers = phoneNumbers;
        }
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
            data.aiSettings = data.aiSettings || {};
            data.aiSettings.elevenLabs = data.aiSettings.elevenLabs || {};
            data.aiSettings.elevenLabs.apiKey = apiKeyInput.value;
        }
        
        if (voiceSelect?.value) {
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
        const responseFields = [
            'greeting', 'farewell', 'hold', 'transfer', 'unavailable',
            'businessHours', 'afterHours', 'voicemail', 'callback'
        ];

        responseFields.forEach(field => {
            const input = document.getElementById(`personality-${field}`);
            if (input?.value.trim()) {
                responses[field] = input.value.trim();
            }
        });

        if (Object.keys(responses).length > 0) {
            data.personalityResponses = responses;
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
     * Show edit form for Overview tab
     */
    showEditForm() {
        if (!this.currentData) {
            this.showNotification('No company data loaded', 'error');
            return;
        }

        // Create and show edit form
        this.createEditForm();
        
        // Scroll to edit form
        this.domElements.editFormContainer.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'nearest' 
        });
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
    } catch (error) {
        console.error('❌ Failed to initialize company profile:', error);
    }
});

// Export for global access
window.CompanyProfileManager = CompanyProfileManager;
window.companyProfileManager = companyProfileManager;
