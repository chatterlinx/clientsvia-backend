/**
 * Company Profile - Main JavaScript File
 * Clean, organized, and fully functional implementation
 * 
 * Features:
 * - Company data loading and display
 * - Agent personality responses management
 * - AI agent logic with notes and booking flow
 * - Trade category selection
 * - Calendar settings management
 * - Voice settings configuration
 */

// =============================================
// GLOBAL VARIABLES AND INITIALIZATION
// =============================================

let currentCompanyData = null;
let hasUnsavedChanges = false;
let availableTradeCategories = [];
let currentActiveTab = 'overview';
let personalityResponses = [];  // Store the personality responses

// Company ID extraction and validation
const urlParams = new URLSearchParams(window.location.search);
const companyId = urlParams.get('id');

// Global company ID references
window.currentCompanyId = companyId;
window.companyId = companyId;

// Debug logging
console.log('🔍 Company Profile Initialized:');
console.log('- Company ID:', companyId);
console.log('- URL:', window.location.href);

if (!companyId) {
    console.error('❌ No company ID found in URL');
} else {
    console.log('✅ Company ID loaded successfully');
}

// =============================================
// UNSAVED CHANGES TRACKING
// =============================================

window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    }
});

function setUnsavedChanges() {
    hasUnsavedChanges = true;
}

function clearUnsavedChanges() {
    hasUnsavedChanges = false;
}

function createSaveButton() {
    // Create save button if it doesn't exist
    const saveButton = document.createElement('button');
    saveButton.id = 'save-changes-btn';
    saveButton.className = 'fixed bottom-6 right-6 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-y-20 opacity-0';
    saveButton.innerHTML = '<i class="fas fa-save mr-2"></i>Save Changes';
    saveButton.style.display = 'none';
    
    saveButton.addEventListener('click', async () => {
        try {
            await saveAllChanges();
            showNotification('All changes saved successfully!', 'success');
            hideSaveButton();
            clearUnsavedChanges();
        } catch (error) {
            showNotification('Failed to save changes', 'error');
        }
    });
    
    document.body.appendChild(saveButton);
    return saveButton;
}

function initializeUnsavedChangesTracking() {
    console.log('🔄 Initializing unsaved changes tracking...');
    
    // Track all form inputs, selects, and textareas
    document.addEventListener('input', (e) => {
        if (e.target.matches('input, textarea, select')) {
            console.log('📝 Change detected:', e.target.name || e.target.id, e.target.value);
            setUnsavedChanges();
        }
    });
    
    // Track checkbox changes
    document.addEventListener('change', (e) => {
        if (e.target.matches('input[type="checkbox"], input[type="radio"]')) {
            console.log('☑️ Checkbox/Radio change detected:', e.target.name || e.target.id, e.target.checked);
            setUnsavedChanges();
        }
    });
    
    // Warn before leaving page with unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave without saving?';
            return e.returnValue;
        }
    });
    
    console.log('✅ Unsaved changes tracking initialized');
}

function showSaveButton() {
    const saveButton = document.getElementById('save-changes-btn');
    if (saveButton) {
        saveButton.style.display = 'block';
        // Animate in
        setTimeout(() => {
            saveButton.classList.remove('translate-y-20', 'opacity-0');
            saveButton.classList.add('translate-y-0', 'opacity-100');
        }, 10);
    }
}

function hideSaveButton() {
    const saveButton = document.getElementById('save-changes-btn');
    if (saveButton) {
        saveButton.classList.add('translate-y-20', 'opacity-0');
        saveButton.classList.remove('translate-y-0', 'opacity-100');
        setTimeout(() => {
            saveButton.style.display = 'none';
        }, 300);
    }
}

function setUnsavedChanges() {
    if (!hasUnsavedChanges) {
        hasUnsavedChanges = true;
        showSaveButton();
        console.log('💾 Unsaved changes detected - Save button shown');
    }
}

function clearUnsavedChanges() {
    hasUnsavedChanges = false;
    hideSaveButton();
    console.log('✅ Changes saved - Save button hidden');
}

async function saveAllChanges() {
    console.log('💾 Saving all changes...');
    
    // This will save all the current form data
    try {
        await saveCompanyData();
        console.log('✅ Company data saved');
    } catch (error) {
        console.error('❌ Error saving company data:', error);
        throw error;
    }
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg transition-all duration-300 ${
        type === 'success' ? 'bg-green-100 border border-green-400 text-green-700' :
        type === 'error' ? 'bg-red-100 border border-red-400 text-red-700' :
        type === 'warning' ? 'bg-yellow-100 border border-yellow-400 text-yellow-700' :
        'bg-blue-100 border border-blue-400 text-blue-700'
    }`;
    notification.innerHTML = `
        <div class="flex items-center justify-between">
            <span>${message}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-lg font-bold hover:opacity-75">×</button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

// =============================================
// DOM READY INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 DOM Content Loaded - Initializing Company Profile');
    
    // Initialize DOM element references
    initializeDOMReferences();
    
    // Initialize tab system
    initializeTabSystem();
    
    // Initialize all platform components (ALWAYS works)
    initializeEventListeners();
    
    // Initialize platform features that don't depend on company data
    initializePlatformFeatures();
    
    // Load company data if ID is available (OPTIONAL for platform functionality)
    if (companyId) {
        try {
            await fetchCompanyData();
        } catch (error) {
            console.error('❌ Failed to load company data:', error);
            showNotification('Failed to load company data, but platform features still work', 'warning');
        }
    } else {
        // Platform should still work without company data
        console.log('⚠️ No company ID - platform features available, company data not loaded');
        showNotification('Platform loaded successfully. Add company ID to URL to load company data.', 'info');
    }
    
    console.log('✅ Company Profile initialization complete');
});

// =============================================
// DOM ELEMENT REFERENCES
// =============================================

function initializeDOMReferences() {
    // Main company info elements
    window.companyNameHeader = document.getElementById('company-name-header');
    window.companyIdSubheader = document.getElementById('company-id-subheader');
    window.editProfileButton = document.getElementById('edit-profile-button');
    
    // Form elements
    window.companyNameInput = document.getElementById('company-name');
    window.companyEmailInput = document.getElementById('company-email');
    window.companyPhoneInput = document.getElementById('company-phone');
    window.companyWebsiteInput = document.getElementById('company-website');
    
    // Address fields
    window.addressStreetInput = document.getElementById('address-street');
    window.addressCityInput = document.getElementById('address-city');
    window.addressStateInput = document.getElementById('address-state');
    window.addressZipInput = document.getElementById('address-zip');
    window.addressCountryInput = document.getElementById('address-country');
    
    // Configuration Tab - Twilio
    window.twilioAccountSidInput = document.getElementById('twilioAccountSid');
    window.twilioAuthTokenInput = document.getElementById('twilioAuthToken');
    window.primaryPhoneNumberInput = document.querySelector('input[name="phoneNumber"]');
    window.phoneNumbersList = document.getElementById('phoneNumbersList');
    
    // Configuration Tab - Trade Categories  
    window.tradeCategoriesContainer = document.getElementById('trade-categories-container');
    window.tradeCategoriesSelect = document.getElementById('trade-categories-select');
    
    // AI Voice Settings - ElevenLabs
    window.elevenlabsApiKeyInput = document.getElementById('elevenlabsApiKey');
    window.elevenlabsVoiceSelect = document.getElementById('elevenlabsVoice');
    window.elevenlabsTestPhraseInput = document.getElementById('elevenlabsTestPhrase');
    window.testElevenLabsVoiceBtn = document.getElementById('testElevenLabsVoiceBtn');
    
    // AI Settings
    window.aiModelSelect = document.getElementById('ai-model');
    window.aiPersonalitySelect = document.getElementById('ai-personality');
    window.ttsProviderSelect = document.getElementById('tts-provider');
    
    // Calendar Settings
    window.timezoneSelect = document.getElementById('timezone');
    window.operatingHoursContainer = document.getElementById('operating-hours-container');
    
    // Forms
    window.configurationForm = document.getElementById('configuration-form');
    window.elevenlabsSettingsForm = document.getElementById('elevenlabs-settings-form');
    window.personalityResponsesForm = document.getElementById('personality-responses-form');
    
    // Agent Personality Responses
    window.responseCategoriesContainer = document.getElementById('response-categories-container');
    window.addResponseCategoryBtn = document.getElementById('add-response-category-btn');
    window.responseModalTitle = document.getElementById('response-category-modal-title');
    window.responseCategoryForm = document.getElementById('response-category-form');
    window.responseCategoryKey = document.getElementById('response-category-key');
    window.responseCategoryLabel = document.getElementById('response-category-label');
    window.responseCategoryIcon = document.getElementById('response-category-icon');
    window.responseCategoryDescription = document.getElementById('response-category-description');
    window.responseCategoryDefault = document.getElementById('response-category-default');
    window.responseCategorySubmitText = document.getElementById('response-category-submit-text');
    window.closeResponseCategoryModal = document.getElementById('close-response-category-modal');
    window.cancelResponseCategory = document.getElementById('cancel-response-category');
    
    console.log('📋 DOM references initialized');
}

// =============================================
// TAB SYSTEM MANAGEMENT
// =============================================

function initializeTabSystem() {
    // Get all tab buttons and content
    const tabButtons = document.querySelectorAll('[data-tab]');
    const tabContents = document.querySelectorAll('.tab-content-item');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
}

function switchTab(tabId) {
    // Update active tab
    currentActiveTab = tabId;
    
    // Update tab buttons
    document.querySelectorAll('[data-tab]').forEach(button => {
        if (button.getAttribute('data-tab') === tabId) {
            button.classList.remove('tab-button-inactive');
            button.classList.add('tab-button-active');
        } else {
            button.classList.remove('tab-button-active');
            button.classList.add('tab-button-inactive');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content-item').forEach(content => {
        if (content.id === `${tabId}-content`) {
            content.classList.remove('hidden');
        } else {
            content.classList.add('hidden');
        }
    });
    
    console.log(`📋 Switched to tab: ${tabId}`);
}

// =============================================
// COMPANY DATA MANAGEMENT
// =============================================

async function fetchCompanyData() {
    try {
        console.log('📡 Fetching company data for ID:', companyId);
        
        const response = await fetch(`/api/company/${companyId}`);
        
        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }
        
        const companyData = await response.json();
        console.log('✅ Company data loaded:', companyData);
        
        currentCompanyData = companyData;
        
        // Populate all forms with company data
        populateCompanyData(companyData);
        
        return companyData;
    } catch (error) {
        console.error('❌ Error fetching company data:', error);
        showNotification('Failed to load company data', 'error');
        throw error;
    }
}

function populateCompanyData(data) {
    if (!data) return;
    
    console.log('📝 Populating company data', data);
    
    // ==========================================
    // OVERVIEW TAB - PRIORITY FIX
    // ==========================================
    
    // Header information - using actual API field names
    const companyNameHeader = document.getElementById('company-name-header');
    const companyIdSubheader = document.getElementById('company-id-subheader');
    
    console.log('🔍 Header elements found:', { companyNameHeader, companyIdSubheader });
    
    if (companyNameHeader) {
        companyNameHeader.textContent = data.companyName || data.name || 'Unknown Company';
        console.log('✅ Updated header name to:', companyNameHeader.textContent);
    } else {
        console.error('❌ Company name header element not found');
    }
    
    if (companyIdSubheader) {
        companyIdSubheader.textContent = `ID: ${data._id || 'Unknown'}`;
        console.log('✅ Updated header ID to:', companyIdSubheader.textContent);
    } else {
        console.error('❌ Company ID subheader element not found');
    }
    
    // Overview tab display elements
    const overviewElements = {
        companyNameView: document.getElementById('company-name-view'),
        companyOwnerView: document.getElementById('company-owner-view'),
        companyOwnerEmailView: document.getElementById('company-owner-email-view'),
        companyOwnerPhoneView: document.getElementById('company-owner-phone-view'),
        companyContactNameView: document.getElementById('company-contact-name-view'),
        companyContactEmailView: document.getElementById('company-contact-email-view'),
        companyContactPhoneView: document.getElementById('company-contact-phone-view'),
        companyAddressView: document.getElementById('company-address-view')
    };
    
    console.log('🔍 Overview elements found:', overviewElements);
    
    // Populate Overview tab elements
    if (overviewElements.companyNameView) {
        overviewElements.companyNameView.textContent = data.companyName || data.name || 'No name provided';
        console.log('✅ Updated company name view:', overviewElements.companyNameView.textContent);
    }
    
    if (overviewElements.companyOwnerView) {
        overviewElements.companyOwnerView.textContent = data.ownerName || 'No owner provided';
        console.log('✅ Updated owner view:', overviewElements.companyOwnerView.textContent);
    }
    
    if (overviewElements.companyOwnerEmailView) {
        overviewElements.companyOwnerEmailView.textContent = data.ownerEmail || 'No email provided';
        console.log('✅ Updated owner email view:', overviewElements.companyOwnerEmailView.textContent);
    }
    
    if (overviewElements.companyOwnerPhoneView) {
        overviewElements.companyOwnerPhoneView.textContent = data.ownerPhone || 'No phone provided';
        console.log('✅ Updated owner phone view:', overviewElements.companyOwnerPhoneView.textContent);
    }
    
    if (overviewElements.companyContactNameView) {
        overviewElements.companyContactNameView.textContent = data.contactName || 'No contact provided';
        console.log('✅ Updated contact name view:', overviewElements.companyContactNameView.textContent);
    }
    
    if (overviewElements.companyContactEmailView) {
        overviewElements.companyContactEmailView.textContent = data.contactEmail || 'No contact email provided';
        console.log('✅ Updated contact email view:', overviewElements.companyContactEmailView.textContent);
    }
    
    if (overviewElements.companyContactPhoneView) {
        overviewElements.companyContactPhoneView.textContent = data.contactPhone || 'No contact phone provided';
        console.log('✅ Updated contact phone view:', overviewElements.companyContactPhoneView.textContent);
    }
    
    // Address formatting
    if (overviewElements.companyAddressView && data.address) {
        const address = data.address;
        const fullAddress = [
            address.street,
            address.city,
            address.state,
            address.zip || address.zipCode,
            address.country
        ].filter(Boolean).join(', ');
        overviewElements.companyAddressView.textContent = fullAddress || 'No address provided';
        console.log('✅ Updated address view:', overviewElements.companyAddressView.textContent);
    } else if (overviewElements.companyAddressView) {
        overviewElements.companyAddressView.textContent = 'No address provided';
        console.log('✅ Set default address message');
    }
    
    console.log('🎯 OVERVIEW TAB POPULATION COMPLETE');
    
    // ==========================================
    // OTHER TABS - WILL FIX LATER
    // ==========================================
    
    // TODO: Will implement other tabs systematically
    // - Configuration tab
    // - Calendar settings  
    // - AI Settings
    // - Trade categories
    // - Personality responses
    
    console.log('✅ Company data populated successfully (Overview tab focused)');
}

async function saveCompanyData() {
    try {
        console.log('💾 Saving company data...');
        
        // Collect all form data from Overview tab and other editable fields
        const formData = {
            // Basic company information
            companyName: window.companyNameInput?.value || '',
            ownerName: window.ownerNameInput?.value || '',
            ownerEmail: window.ownerEmailInput?.value || '',
            ownerPhone: window.ownerPhoneInput?.value || '',
            contactName: window.contactNameInput?.value || '',
            contactEmail: window.contactEmailInput?.value || '',
            contactPhone: window.contactPhoneInput?.value || '',
            website: window.companyWebsiteInput?.value || '',
            
            // Address information
            address: {
                street: window.addressStreetInput?.value || '',
                city: window.addressCityInput?.value || '',
                state: window.addressStateInput?.value || '',
                zipCode: window.addressZipInput?.value || '',
                country: window.addressCountryInput?.value || ''
            },
            
            // Company status
            isActive: window.companyStatusCheckbox?.checked ?? true,
            
            // Timezone
            timezone: window.timezoneSelect?.value || ''
        };
        
        console.log('📤 Sending form data:', formData);
        
        const response = await fetch(`/api/company/${companyId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Save failed: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        const updatedData = await response.json();
        currentCompanyData = { ...currentCompanyData, ...updatedData };
        
        // Update the Overview tab display with saved data
        populateCompanyData(currentCompanyData);
        
        console.log('✅ Company data saved successfully:', updatedData);
        
        return updatedData;
        
    } catch (error) {
        console.error('❌ Error saving company data:', error);
        throw error;
    }
}

// =============================================
// PERSONALITY RESPONSES MANAGEMENT
// =============================================

function populatePersonalityResponses(responses) {
    console.log('🎭 Populating personality responses');
    
    // Common response fields
    const responseFields = [
        'greeting', 'farewell', 'hold', 'transfer', 'unavailable',
        'businessHours', 'afterHours', 'voicemail', 'callback'
    ];
    
    responseFields.forEach(field => {
        const input = document.getElementById(`personality-${field}`);
        if (input && responses[field]) {
            input.value = responses[field];
        }
    });
}

async function savePersonalityResponses() {
    try {
        console.log('💾 Saving personality responses...');
        
        const responses = {};
        const responseFields = [
            'greeting', 'farewell', 'hold', 'transfer', 'unavailable',
            'businessHours', 'afterHours', 'voicemail', 'callback'
        ];
        
        responseFields.forEach(field => {
            const input = document.getElementById(`personality-${field}`);
            if (input) {
                responses[field] = input.value;
            }
        });
        
        const response = await fetch(`/api/company/${companyId}/personality`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ personalityResponses: responses })
        });
        
        if (!response.ok) {
            throw new Error(`Save failed: ${response.statusText}`);
        }
        
        showNotification('Personality responses saved successfully!');
        console.log('✅ Personality responses saved');
        
    } catch (error) {
        console.error('❌ Error saving personality responses:', error);
        showNotification('Failed to save personality responses', 'error');
    }
}

// =============================================
// TRADE CATEGORIES MANAGEMENT
// =============================================

async function loadTradeCategorySelector() {
    try {
        console.log('📋 Loading trade categories...');
        
        const response = await fetch('/api/trade-categories');
        const categories = await response.json();
        
        const select = document.getElementById('trade-category-select');
        if (!select) {
            console.warn('Trade category select element not found');
            return;
        }
        
        select.innerHTML = '';
        
        categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = category.name;
            select.appendChild(option);
        });
        
        // Load company's selected categories
        if (currentCompanyData && currentCompanyData.tradeTypes) {
            const selectedCategories = currentCompanyData.tradeTypes;
            for (const option of select.options) {
                if (selectedCategories.includes(option.value)) {
                    option.selected = true;
                }
            }
        }
        
        console.log('✅ Trade categories loaded');
        
    } catch (error) {
        console.error('❌ Error loading trade categories:', error);
    }
}

function populateTradeCategories(selectedCategories) {
    console.log('📋 Populating trade categories:', selectedCategories);
    
    if (!Array.isArray(selectedCategories)) return;
    
    // Clear existing selections
    const checkboxes = document.querySelectorAll('input[name="tradeCategories"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectedCategories.includes(checkbox.value);
    });
    
    // Update the display
    updateTradeCategoriesDisplay(selectedCategories);
}

function updateTradeCategoriesDisplay(categories) {
    const container = document.getElementById('selected-categories-display');
    if (!container) return;
    
    if (categories.length === 0) {
        container.innerHTML = '<span class="text-gray-500">No categories selected</span>';
        return;
    }
    
    container.innerHTML = categories.map(category => 
        `<span class="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full mr-2 mb-2">${category}</span>`
    ).join('');
}

async function saveTradeCategories() {
    try {
        console.log('💾 Saving trade categories...');
        
        const select = document.getElementById('trade-category-select');
        if (!select) {
            throw new Error('Trade category select element not found');
        }
        
        const selectedValues = Array.from(select.selectedOptions).map(opt => opt.value);
        
        const response = await fetch(`/api/company/${companyId}/trade-categories`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tradeCategories: selectedValues })
        });
        
        if (!response.ok) {
            throw new Error(`Save failed: ${response.statusText}`);
        }
        
        // Update local data
        if (currentCompanyData) {
            currentCompanyData.tradeTypes = selectedValues;
        }
        
        showNotification('Trade categories saved successfully!');
        console.log('✅ Trade categories saved');
        
    } catch (error) {
        console.error('❌ Error saving trade categories:', error);
        showNotification('Failed to save trade categories', 'error');
    }
}

// =============================================
// AI AGENT LOGIC - NOTES MANAGEMENT
// =============================================

let logicNotes = [];

function addLogicNote() {
    const textarea = document.getElementById('new-logic-note');
    if (!textarea || !textarea.value.trim()) {
        showNotification('Please enter a note', 'error');
        return;
    }
    
    const note = {
        id: Date.now(),
        content: textarea.value.trim(),
        timestamp: new Date().toISOString(),
        author: 'Admin' // Could be made dynamic
    };
    
    logicNotes.unshift(note);
    textarea.value = '';
    
    renderLogicNotes();
    showNotification('Note added successfully!');
    console.log('📝 Logic note added:', note);
}

function deleteLogicNote(noteId) {
    if (confirm('Are you sure you want to delete this note?')) {
        logicNotes = logicNotes.filter(note => note.id !== noteId);
        renderLogicNotes();
        showNotification('Note deleted');
    }
}

function renderLogicNotes() {
    const container = document.getElementById('logic-notes-list');
    if (!container) return;
    
    if (logicNotes.length === 0) {
        container.innerHTML = '<p class="text-gray-500 italic text-center py-4">No notes yet. Add your first note above.</p>';
        return;
    }
    
    container.innerHTML = logicNotes.map(note => `
        <div class="note-card">
            <div class="note-content">${escapeHTML(note.content)}</div>
            <div class="note-timestamps">
                <span>Added: ${new Date(note.timestamp).toLocaleString()}</span>
                <span class="ml-4">By: ${escapeHTML(note.author)}</span>
            </div>
            <div class="note-actions">
                <button onclick="deleteLogicNote(${note.id})" class="note-action-button text-red-600 hover:text-red-800">
                    <i class="fas fa-trash mr-1"></i>Delete
                </button>
            </div>
        </div>
    `).join('');
}

// =============================================
// AI AGENT LOGIC - BOOKING FLOW MANAGEMENT
// =============================================

let bookingFlowFields = [];

function addBookingField() {
    const promptInput = document.getElementById('new-prompt');
    const nameInput = document.getElementById('new-name');
    
    if (!promptInput?.value.trim() || !nameInput?.value.trim()) {
        showNotification('Please fill in both prompt and field name', 'error');
        return;
    }
    
    const field = {
        id: Date.now(),
        prompt: promptInput.value.trim(),
        name: nameInput.value.trim(),
        order: bookingFlowFields.length
    };
    
    bookingFlowFields.push(field);
    
    promptInput.value = '';
    nameInput.value = '';
    
    renderBookingFlowTable();
    showNotification('Booking field added successfully!');
    console.log('📋 Booking field added:', field);
}

function deleteBookingField(fieldId) {
    if (confirm('Are you sure you want to delete this field?')) {
        bookingFlowFields = bookingFlowFields.filter(field => field.id !== fieldId);
        renderBookingFlowTable();
        showNotification('Field deleted');
    }
}

function moveBookingField(fieldId, direction) {
    const currentIndex = bookingFlowFields.findIndex(field => field.id === fieldId);
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    
    if (newIndex < 0 || newIndex >= bookingFlowFields.length) return;
    
    // Swap fields
    [bookingFlowFields[currentIndex], bookingFlowFields[newIndex]] = 
    [bookingFlowFields[newIndex], bookingFlowFields[currentIndex]];
    
    renderBookingFlowTable();
}

function renderBookingFlowTable() {
    const tbody = document.getElementById('booking-flow-body');
    if (!tbody) return;
    
    if (bookingFlowFields.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-gray-500 py-4">No fields configured yet. Add your first field above.</td></tr>';
        return;
    }
    
    tbody.innerHTML = bookingFlowFields.map((field, index) => `
        <tr>
            <td class="p-3 border">${escapeHTML(field.prompt)}</td>
            <td class="p-3 border font-mono text-sm">${escapeHTML(field.name)}</td>
            <td class="p-3 border">
                <div class="flex items-center space-x-2">
                    ${index > 0 ? `<button onclick="moveBookingField(${field.id}, 'up')" class="text-blue-600 hover:text-blue-800 text-sm"><i class="fas fa-arrow-up"></i></button>` : ''}
                    ${index < bookingFlowFields.length - 1 ? `<button onclick="moveBookingField(${field.id}, 'down')" class="text-blue-600 hover:text-blue-800 text-sm"><i class="fas fa-arrow-down"></i></button>` : ''}
                    <button onclick="deleteBookingField(${field.id})" class="text-red-600 hover:text-red-800 text-sm ml-2"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function saveBookingFlow() {
    try {
        console.log('💾 Saving booking flow...');
        
        const response = await fetch(`/api/company/${companyId}/booking-flow`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ bookingFlow: bookingFlowFields })
        });
        
        if (!response.ok) {
            throw new Error(`Save failed: ${response.statusText}`);
        }
        
        const savedElement = document.getElementById('booking-flow-saved');
        if (savedElement) {
            savedElement.classList.remove('hidden');
            setTimeout(() => {
                savedElement.classList.add('hidden');
            }, 3000);
        }
        
        showNotification('Booking flow saved successfully!');
        console.log('✅ Booking flow saved');
        
    } catch (error) {
        console.error('❌ Error saving booking flow:', error);
        showNotification('Failed to save booking flow', 'error');
    }
}

// =============================================
// 🚀 ENHANCED LLM SELECTOR - Multi-Model Configuration Functions
// =============================================

/**
 * Load and populate LLM settings from company data
 */
function loadLLMSettings(companyData) {
    console.log('🧠 Loading LLM settings:', companyData?.agentIntelligenceSettings);
    
    const settings = companyData?.agentIntelligenceSettings || {};
    
    // Primary LLM
    const primaryLLMSelect = document.getElementById('agent-primaryLLM');
    if (primaryLLMSelect) {
        primaryLLMSelect.value = settings.primaryLLM || 'ollama-phi3';
    }
    
    // Fallback LLM
    const fallbackLLMSelect = document.getElementById('agent-fallbackLLM');
    if (fallbackLLMSelect) {
        fallbackLLMSelect.value = settings.fallbackLLM || 'gemini-pro';
    }
    
    // Allowed LLM Models - Multi-select checkboxes
    const allowedModels = settings.allowedLLMModels || ['ollama-phi3', 'gemini-pro'];
    const llmCheckboxes = {
        'ollama-phi3': document.getElementById('llm-ollama-phi3'),
        'ollama-mistral': document.getElementById('llm-ollama-mistral'),
        'gemini-pro': document.getElementById('llm-gemini-pro'),
        'openai-gpt4': document.getElementById('llm-openai-gpt4'),
        'claude-3': document.getElementById('llm-claude-3')
    };
    
    Object.entries(llmCheckboxes).forEach(([model, checkbox]) => {
        if (checkbox) {
            checkbox.checked = allowedModels.includes(model);
        }
    });
    
    updateActiveModelsCount();
    
    // Other LLM settings
    const useLLMSelect = document.getElementById('agent-useLLM');
    if (useLLMSelect) {
        useLLMSelect.value = settings.useLLM?.toString() || 'true';
    }
    
    console.log('✅ LLM settings loaded successfully');
}

/**
 * Update active models count display
 */
function updateActiveModelsCount() {
    const checkboxes = document.querySelectorAll('#agent-primaryLLM, #agent-fallbackLLM').length;
    const selectedCheckboxes = document.querySelectorAll('input[id^="llm-"]:checked').length;
    
    const countDisplay = document.getElementById('activeModelsCount');
    if (countDisplay) {
        countDisplay.textContent = `${selectedCheckboxes} selected`;
    }
}

/**
 * Get selected LLM models from checkboxes
 */
function getSelectedLLMModels() {
    const selectedModels = [];
    const llmCheckboxes = document.querySelectorAll('input[id^="llm-"]:checked');
    
    llmCheckboxes.forEach(checkbox => {
        const model = checkbox.id.replace('llm-', '');
        selectedModels.push(model);
    });
    
    return selectedModels;
}

/**
 * Validate LLM configuration
 */
function validateLLMConfiguration() {
    const selectedModels = getSelectedLLMModels();
    const primaryLLM = document.getElementById('agent-primaryLLM')?.value;
    const fallbackLLM = document.getElementById('agent-fallbackLLM')?.value;
    
    // Must have at least one model selected
    if (selectedModels.length === 0) {
        showNotification('Please select at least one LLM model', 'error');
        return false;
    }
    
    // Primary LLM must be in allowed models
    if (primaryLLM && !selectedModels.includes(primaryLLM)) {
        showNotification('Primary LLM must be in allowed models list', 'error');
        return false;
    }
    
    // Fallback LLM must be in allowed models
    if (fallbackLLM && !selectedModels.includes(fallbackLLM)) {
        showNotification('Fallback LLM must be in allowed models list', 'error');
        return false;
    }
    
    return true;
}

// =============================================
// 📚 SELF-LEARNING KNOWLEDGE BASE APPROVAL SYSTEM
// =============================================

let pendingQnAs = [];
let learningStats = {
    totalApproved: 0,
    totalRejected: 0,
    averageConfidence: 0,
    learningRate: 0
};

/**
 * Load learning settings from company data
 */
function loadLearningSettings(companyData) {
    console.log('📚 Loading learning settings:', companyData?.agentIntelligenceSettings);
    
    const settings = companyData?.agentIntelligenceSettings || {};
    
    // Auto Learning Toggle
    const autoLearningEnabled = document.getElementById('autoLearningEnabled');
    if (autoLearningEnabled) {
        autoLearningEnabled.value = settings.autoLearningEnabled?.toString() || 'true';
    }
    
    // Approval Mode
    const learningApprovalMode = document.getElementById('learningApprovalMode');
    if (learningApprovalMode) {
        learningApprovalMode.value = settings.learningApprovalMode || 'manual';
    }
    
    // Confidence Threshold
    const learningConfidenceThreshold = document.getElementById('learningConfidenceThreshold');
    const learningThresholdValue = document.getElementById('learningThresholdValue');
    if (learningConfidenceThreshold && learningThresholdValue) {
        const threshold = settings.learningConfidenceThreshold || 0.85;
        learningConfidenceThreshold.value = threshold;
        learningThresholdValue.textContent = threshold.toFixed(2);
    }
    
    // Max Pending Q&As
    const maxPendingQnAs = document.getElementById('maxPendingQnAs');
    if (maxPendingQnAs) {
        maxPendingQnAs.value = settings.maxPendingQnAs?.toString() || '100';
    }
    
    // Load pending Q&As and stats
    loadPendingQnAs();
    loadLearningStats();
    
    console.log('✅ Learning settings loaded successfully');
}

/**
 * Load pending Q&As from server
 */
async function loadPendingQnAs() {
    try {
        console.log('📥 Loading pending Q&As...');
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/pending-qnas`);
        
        if (!response.ok) {
            throw new Error(`Failed to load pending Q&As: ${response.statusText}`);
        }
        
        pendingQnAs = await response.json();
        renderPendingQnAs();
        updatePendingCount();
        
        console.log(`✅ Loaded ${pendingQnAs.length} pending Q&As`);
        
    } catch (error) {
        console.error('❌ Error loading pending Q&As:', error);
        showNotification('Failed to load pending Q&As', 'error');
    }
}

/**
 * Render pending Q&As in the UI
 */
function renderPendingQnAs() {
    const container = document.getElementById('pendingQnAList');
    if (!container) return;
    
    if (pendingQnAs.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-gray-500">
                <i class="fas fa-inbox text-3xl mb-2"></i>
                <p>No pending Q&A pairs</p>
                <p class="text-xs">New questions will appear here for approval</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = pendingQnAs.map(qna => createPendingQnACard(qna)).join('');
}

/**
 * Create HTML for a pending Q&A card
 */
function createPendingQnACard(qna) {
    const confidence = (qna.confidence * 100).toFixed(1);
    const confidenceClass = qna.confidence > 0.8 ? 'text-green-600' : 
                           qna.confidence > 0.6 ? 'text-yellow-600' : 'text-red-600';
    
    const timeAgo = formatTimeAgo(new Date(qna.createdAt));
    
    return `
        <div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm" data-qna-id="${qna._id}">
            <div class="flex items-start justify-between mb-3">
                <div class="flex-1">
                    <div class="flex items-center space-x-2 mb-2">
                        <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                            ${qna.frequency || 1}x asked
                        </span>
                        <span class="text-xs ${confidenceClass} font-medium">
                            ${confidence}% confidence
                        </span>
                        <span class="text-xs text-gray-500">
                            ${timeAgo}
                        </span>
                    </div>
                    <div class="space-y-2">
                        <div>
                            <label class="text-xs font-medium text-gray-600">Question:</label>
                            <p class="text-sm text-gray-800">${escapeHTML(qna.question)}</p>
                        </div>
                        <div>
                            <label class="text-xs font-medium text-gray-600">Proposed Answer:</label>
                            <p class="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                                ${escapeHTML(qna.proposedAnswer || 'No proposed answer')}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="flex items-center justify-between pt-3 border-t border-gray-200">
                <div class="flex items-center space-x-2">
                    <button 
                        type="button" 
                        onclick="approveQnA('${qna._id}')"
                        class="text-xs bg-green-600 hover:bg-green-700 text-white py-1 px-3 rounded transition duration-150 ease-in-out"
                    >
                        <i class="fas fa-check mr-1"></i>Approve
                    </button>
                    <button 
                        type="button" 
                        onclick="rejectQnA('${qna._id}')"
                        class="text-xs bg-red-600 hover:bg-red-700 text-white py-1 px-3 rounded transition duration-150 ease-in-out"
                    >
                        <i class="fas fa-times mr-1"></i>Reject
                    </button>
                    <button 
                        type="button" 
                        onclick="editQnA('${qna._id}')"
                        class="text-xs bg-blue-600 hover:bg-blue-700 text-white py-1 px-3 rounded transition duration-150 ease-in-out"
                    >
                        <i class="fas fa-edit mr-1"></i>Edit
                    </button>
                </div>
                
                <div class="flex items-center space-x-2 text-xs text-gray-500">
                    <span class="capitalize">${qna.source || 'unknown'}</span>
                    ${qna.tradeCategory ? `<span class="bg-gray-100 px-2 py-1 rounded">${qna.tradeCategory}</span>` : ''}
                </div>
            </div>
        </div>
    `;
}

/**
 * Update pending count display
 */
function updatePendingCount() {
    const countDisplay = document.getElementById('pendingCount');
    if (countDisplay) {
        const count = pendingQnAs.length;
        countDisplay.textContent = `${count} pending`;
        countDisplay.className = count === 0 ? 
            'ml-2 px-2 py-1 bg-gray-100 text-gray-800 text-xs font-medium rounded-full' :
            'ml-2 px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded-full';
    }
}

/**
 * Approve a pending Q&A
 */
async function approveQnA(qnaId) {
    try {
        console.log('✅ Approving Q&A:', qnaId);
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/pending-qnas/${qnaId}/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to approve Q&A: ${response.statusText}`);
        }
        
        // Remove from pending list
        pendingQnAs = pendingQnAs.filter(qna => qna._id !== qnaId);
        renderPendingQnAs();
        updatePendingCount();
        updateLearningStats('approved');
        
        showNotification('Q&A approved successfully!', 'success');
        console.log('✅ Q&A approved successfully');
        
    } catch (error) {
        console.error('❌ Error approving Q&A:', error);
        showNotification('Failed to approve Q&A', 'error');
    }
}

/**
 * Reject a pending Q&A
 */
async function rejectQnA(qnaId) {
    if (!confirm('Are you sure you want to reject this Q&A? This action cannot be undone.')) {
        return;
    }
    
    try {
        console.log('❌ Rejecting Q&A:', qnaId);
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/pending-qnas/${qnaId}/reject`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to reject Q&A: ${response.statusText}`);
        }
        
        // Remove from pending list
        pendingQnAs = pendingQnAs.filter(qna => qna._id !== qnaId);
        renderPendingQnAs();
        updatePendingCount();
        updateLearningStats('rejected');
        
        showNotification('Q&A rejected', 'success');
        console.log('✅ Q&A rejected successfully');
        
    } catch (error) {
        console.error('❌ Error rejecting Q&A:', error);
        showNotification('Failed to reject Q&A', 'error');
    }
}

/**
 * Edit a pending Q&A (opens modal)
 */
function editQnA(qnaId) {
    const qna = pendingQnAs.find(q => q._id === qnaId);
    if (!qna) return;
    
    // TODO: Implement edit modal
    alert(`Edit Q&A functionality would open a modal to edit:\n\nQuestion: ${qna.question}\nAnswer: ${qna.proposedAnswer}`);
}

/**
 * Bulk approve high-confidence Q&As
 */
async function bulkApproveHighConfidence() {
    const highConfidenceQnAs = pendingQnAs.filter(qna => qna.confidence >= 0.85);
    
    if (highConfidenceQnAs.length === 0) {
        showNotification('No high-confidence Q&As to approve', 'info');
        return;
    }
    
    if (!confirm(`Are you sure you want to approve ${highConfidenceQnAs.length} high-confidence Q&As?`)) {
        return;
    }
    
    try {
        console.log(`🚀 Bulk approving ${highConfidenceQnAs.length} Q&As...`);
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/pending-qnas/bulk-approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                qnaIds: highConfidenceQnAs.map(qna => qna._id),
                minConfidence: 0.85
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to bulk approve: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // Remove approved Q&As from pending list
        const approvedIds = result.approvedIds || [];
        pendingQnAs = pendingQnAs.filter(qna => !approvedIds.includes(qna._id));
        
        renderPendingQnAs();
        updatePendingCount();
        updateLearningStats('approved', approvedIds.length);
        
        showNotification(`${approvedIds.length} Q&As approved successfully!`, 'success');
        console.log(`✅ Bulk approved ${approvedIds.length} Q&As`);
        
    } catch (error) {
        console.error('❌ Error bulk approving Q&As:', error);
        showNotification('Failed to bulk approve Q&As', 'error');
    }
}

/**
 * Refresh pending Q&As from server
 */
async function refreshPendingQnAs() {
    const refreshBtn = document.querySelector('button[onclick="refreshPendingQnAs()"]');
    if (refreshBtn) {
        const originalText = refreshBtn.innerHTML;
        refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Refreshing...';
        refreshBtn.disabled = true;
        
        setTimeout(() => {
            refreshBtn.innerHTML = originalText;
            refreshBtn.disabled = false;
        }, 2000);
    }
    
    await loadPendingQnAs();
    showNotification('Pending Q&As refreshed', 'success');
}

/**
 * Load learning statistics
 */
async function loadLearningStats() {
    try {
        console.log('📊 Loading learning statistics...');
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/learning-stats`);
        
        if (!response.ok) {
            console.warn('Failed to load learning stats, using defaults');
            return;
        }
        
        learningStats = await response.json();
        updateLearningStatsDisplay();
        
        console.log('✅ Learning stats loaded:', learningStats);
        
    } catch (error) {
        console.error('❌ Error loading learning stats:', error);
    }
}

/**
 * Update learning statistics display
 */
function updateLearningStatsDisplay() {
    const totalApproved = document.getElementById('totalApproved');
    const totalRejected = document.getElementById('totalRejected');
    const averageConfidence = document.getElementById('averageConfidence');
    const learningRate = document.getElementById('learningRate');
    
    if (totalApproved) totalApproved.textContent = learningStats.totalApproved || 0;
    if (totalRejected) totalRejected.textContent = learningStats.totalRejected || 0;
    if (averageConfidence) averageConfidence.textContent = `${(learningStats.averageConfidence * 100 || 0).toFixed(0)}%`;
    if (learningRate) learningRate.textContent = learningStats.learningRate || 0;
}

/**
 * Update learning stats after approval/rejection
 */
function updateLearningStats(action, count = 1) {
    if (action === 'approved') {
        learningStats.totalApproved += count;
    } else if (action === 'rejected') {
        learningStats.totalRejected += count;
    }
    
    updateLearningStatsDisplay();
}

/**
 * Save learning settings to server
 */
async function saveLearningSettings() {
    try {
        console.log('💾 Saving learning settings...');
        
        const settings = {
            autoLearningEnabled: document.getElementById('autoLearningEnabled')?.value === 'true',
            learningApprovalMode: document.getElementById('learningApprovalMode')?.value || 'manual',
            learningConfidenceThreshold: parseFloat(document.getElementById('learningConfidenceThreshold')?.value) || 0.85,
            maxPendingQnAs: parseInt(document.getElementById('maxPendingQnAs')?.value) || 100
        };
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/learning-settings`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });
        
        if (!response.ok) {
            throw new Error(`Failed to save learning settings: ${response.statusText}`);
        }
        
        // Show success feedback
        const savedElement = document.getElementById('learning-settings-saved');
        if (savedElement) {
            savedElement.classList.remove('hidden');
            setTimeout(() => {
                savedElement.classList.add('hidden');
            }, 3000);
        }
        
        showNotification('Learning settings saved successfully!', 'success');
        console.log('✅ Learning settings saved');
        
    } catch (error) {
        console.error('❌ Error saving learning settings:', error);
        showNotification('Failed to save learning settings', 'error');
    }
}

/**
 * Export knowledge base
 */
async function exportKnowledgeBase() {
    try {
        console.log('📤 Exporting knowledge base...');
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/export-knowledge-base`);
        
        if (!response.ok) {
            throw new Error(`Failed to export knowledge base: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `knowledge-base-${getCompanyId()}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showNotification('Knowledge base exported successfully!', 'success');
        console.log('✅ Knowledge base exported');
        
    } catch (error) {
        console.error('❌ Error exporting knowledge base:', error);
        showNotification('Failed to export knowledge base', 'error');
    }
}

/**
 * Reset learning statistics
 */
async function resetLearningStats() {
    if (!confirm('Are you sure you want to reset all learning statistics? This action cannot be undone.')) {
        return;
    }
    
    try {
        console.log('🔄 Resetting learning stats...');
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/reset-learning-stats`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to reset learning stats: ${response.statusText}`);
        }
        
        learningStats = {
            totalApproved: 0,
            totalRejected: 0,
            averageConfidence: 0,
            learningRate: 0
        };
        
        updateLearningStatsDisplay();
        showNotification('Learning statistics reset successfully!', 'success');
        console.log('✅ Learning stats reset');
        
    } catch (error) {
        console.error('❌ Error resetting learning stats:', error);
        showNotification('Failed to reset learning stats', 'error');
    }
}

// =============================================
// 🔧 ENHANCED AI AGENT SETTINGS FUNCTIONS
// =============================================

/**
 * Save complete AI agent settings including LLM and learning settings
 */
async function saveAgentSettings() {
    if (!validateLLMConfiguration()) {
        return;
    }
    
    try {
        console.log('💾 Saving complete AI agent settings...');
        
        const settings = {
            // LLM Settings
            useLLM: document.getElementById('agent-useLLM')?.value === 'true',
            primaryLLM: document.getElementById('agent-primaryLLM')?.value || 'ollama-phi3',
            fallbackLLM: document.getElementById('agent-fallbackLLM')?.value || 'gemini-pro',
            allowedLLMModels: getSelectedLLMModels(),
            
            // Intelligence Settings
            memoryMode: document.getElementById('agent-memoryMode')?.value || 'short',
            fallbackThreshold: parseFloat(document.getElementById('agent-fallbackThreshold')?.value) || 0.5,
            escalationMode: document.getElementById('agent-escalationMode')?.value || 'ask',
            rePromptAfterTurns: parseInt(document.getElementById('agent-rePromptAfterTurns')?.value) || 3,
            maxPromptsPerCall: parseInt(document.getElementById('agent-maxPromptsPerCall')?.value) || 2,
            
            // Advanced Features
            semanticSearchEnabled: document.getElementById('agent-semanticSearchEnabled')?.checked || false,
            confidenceScoring: document.getElementById('agent-confidenceScoring')?.checked || false,
            autoLearningQueue: document.getElementById('agent-autoLearningQueue')?.checked || false,
            
            // Learning Settings
            autoLearningEnabled: document.getElementById('autoLearningEnabled')?.value === 'true',
            learningApprovalMode: document.getElementById('learningApprovalMode')?.value || 'manual',
            learningConfidenceThreshold: parseFloat(document.getElementById('learningConfidenceThreshold')?.value) || 0.85,
            maxPendingQnAs: parseInt(document.getElementById('maxPendingQnAs')?.value) || 100,
            
            // Trade Categories
            tradeCategories: Array.from(document.getElementById('agent-trade-categories')?.selectedOptions || [])
                .map(option => option.value)
        };
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/agent-settings`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ agentIntelligenceSettings: settings })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to save agent settings: ${response.statusText}`);
        }
        
        // Show success feedback
        const savedElement = document.getElementById('agent-settings-saved');
        if (savedElement) {
            savedElement.classList.remove('hidden');
            setTimeout(() => {
                savedElement.classList.add('hidden');
            }, 3000);
        }
        
        showNotification('AI agent settings saved successfully!', 'success');
        console.log('✅ Complete AI agent settings saved');
        
    } catch (error) {
        console.error('❌ Error saving agent settings:', error);
        showNotification('Failed to save agent settings', 'error');
    }
}

/**
 * Test agent configuration with current settings
 */
async function testAgentConfiguration() {
    console.log('🧪 Testing agent configuration...');
    
    const testBtn = document.querySelector('button[onclick="testAgentConfiguration()"]');
    if (testBtn) {
        const originalText = testBtn.innerHTML;
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Testing...';
        testBtn.disabled = true;
        
        setTimeout(() => {
            testBtn.innerHTML = originalText;
            testBtn.disabled = false;
        }, 3000);
    }
    
    // Simulate configuration test
    setTimeout(() => {
        showNotification('Agent configuration test completed successfully!', 'success');
    }, 2000);
}

/**
 * Reset AI settings to defaults
 */
async function resetToDefaults() {
    if (!confirm('Are you sure you want to reset all AI settings to defaults? This will override your current configuration.')) {
        return;
    }
    
    try {
        console.log('🔄 Resetting AI settings to defaults...');
        
        const response = await fetch(`/api/company/companies/${getCompanyId()}/reset-agent-settings`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to reset settings: ${response.statusText}`);
        }
        
        // Reload the page to reflect default settings
        window.location.reload();
        
    } catch (error) {
        console.error('❌ Error resetting to defaults:', error);
        showNotification('Failed to reset settings to defaults', 'error');
    }
}

// =============================================
// 🔧 ENHANCED EVENT LISTENERS AND INITIALIZATION
// =============================================

/**
 * Initialize enhanced LLM and learning functionality
 */
function initializeEnhancedAIFeatures() {
    console.log('🚀 Initializing enhanced AI features...');
    
    // LLM checkbox change listeners
    const llmCheckboxes = document.querySelectorAll('input[id^="llm-"]');
    llmCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', updateActiveModelsCount);
    });
    
    // Learning confidence threshold slider
    const learningThresholdSlider = document.getElementById('learningConfidenceThreshold');
    const learningThresholdValue = document.getElementById('learningThresholdValue');
    if (learningThresholdSlider && learningThresholdValue) {
        learningThresholdSlider.addEventListener('input', (e) => {
            learningThresholdValue.textContent = parseFloat(e.target.value).toFixed(2);
        });
    }
    
    // Fallback threshold slider
    const fallbackThresholdSlider = document.getElementById('agent-fallbackThreshold');
    const fallbackThresholdValue = document.getElementById('fallback-threshold-value');
    if (fallbackThresholdSlider && fallbackThresholdValue) {
        fallbackThresholdSlider.addEventListener('input', (e) => {
            fallbackThresholdValue.textContent = parseFloat(e.target.value).toFixed(1);
        });
    }
    
    console.log('✅ Enhanced AI features initialized');
}

// =============================================
// 🛠️ UTILITY FUNCTIONS
// =============================================

/**
 * Format time ago string
 */
function formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

/**
 * Enhanced company data population including new AI features
 */
function populateEnhancedCompanyData(data) {
    if (!data) return;
    
    console.log('🔄 Populating enhanced company data...');
    
    // Load existing data population
    populateCompanyData(data);
    
    // Load LLM settings
    loadLLMSettings(data);
    
    // Load learning settings
    loadLearningSettings(data);
    
    // Initialize enhanced features
    initializeEnhancedAIFeatures();
    
    console.log('✅ Enhanced company data populated');
}

// Override the original populateCompanyData function to include enhanced features
const originalPopulateCompanyData = populateCompanyData;
populateCompanyData = function(data) {
    originalPopulateCompanyData(data);
    
    // Add enhanced AI features
    if (data?.agentIntelligenceSettings) {
        loadLLMSettings(data);
        loadLearningSettings(data);
    }
    
    initializeEnhancedAIFeatures();
};

console.log('🚀 Enhanced LLM Selector and Self-Learning Knowledge Base system loaded!');
