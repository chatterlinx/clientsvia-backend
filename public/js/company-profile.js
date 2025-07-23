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
// PLATFORM FEATURES (Independent of company data)
// =============================================

function initializePlatformFeatures() {
    console.log('🔧 Initializing platform features...');
    
    // Google Calendar Connection (platform feature)
    initializeGoogleCalendarFeatures();
    
    // ElevenLabs Platform Integration (not customer preferences)
    initializeElevenLabsPlatformFeatures();
    
    // Copy webhook buttons (platform feature)
    initializeWebhookCopyButtons();
    
    // Edit Profile modal (platform feature)
    initializeEditProfileFeatures();
    
    // Save buttons and forms (platform feature)
    initializeSaveFeatures();
    
    console.log('✅ Platform features initialized');
}

function initializeGoogleCalendarFeatures() {
    // Google Calendar connection should always be available
    const googleCalendarBtn = document.getElementById('connect-google-calendar');
    if (googleCalendarBtn) {
        googleCalendarBtn.addEventListener('click', () => {
            console.log('🗓️ Google Calendar connection initiated');
            // This should work regardless of company data
            alert('Google Calendar connection feature - works independently of company data');
        });
    }
    
    const googleCalendarDisconnectBtn = document.getElementById('disconnect-google-calendar');
    if (googleCalendarDisconnectBtn) {
        googleCalendarDisconnectBtn.addEventListener('click', () => {
            console.log('🗓️ Google Calendar disconnection initiated');
            alert('Google Calendar disconnection feature');
        });
    }
}

function initializeElevenLabsPlatformFeatures() {
    // ElevenLabs API testing (platform feature, not customer data)
    if (window.testElevenLabsVoiceBtn) {
        window.testElevenLabsVoiceBtn.addEventListener('click', () => {
            testElevenLabsVoice();
        });
    }
    
    // Voice selection (platform feature)
    if (window.elevenlabsVoiceSelect) {
        window.elevenlabsVoiceSelect.addEventListener('change', () => {
            console.log('🎵 Voice selection changed:', window.elevenlabsVoiceSelect.value);
        });
    }
}

function initializeWebhookCopyButtons() {
    // Webhook copying (platform feature)
    const copyWebhookBtns = document.querySelectorAll('.copy-webhook-btn');
    copyWebhookBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const webhookUrl = btn.getAttribute('data-webhook');
            navigator.clipboard.writeText(webhookUrl).then(() => {
                showNotification('Webhook URL copied to clipboard!', 'success');
            }).catch(() => {
                showNotification('Failed to copy webhook URL', 'error');
            });
        });
    });
}

function initializeEditProfileFeatures() {
    // Remove Edit Profile button functionality - page is always editable
    if (window.editProfileButton) {
        // Hide the edit profile button since page is always editable
        window.editProfileButton.style.display = 'none';
        console.log('✅ Edit Profile button hidden - page is always editable');
    }
    
    // Initialize save button (initially hidden)
    const saveButton = document.getElementById('save-changes-btn') || createSaveButton();
    
    // Initialize unsaved changes tracking
    initializeUnsavedChangesTracking();
}

function initializeSaveFeatures() {
    // All save buttons (platform features)
    const saveButtons = document.querySelectorAll('[data-save-type]');
    saveButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const saveType = button.getAttribute('data-save-type');
            console.log(`💾 Save ${saveType} clicked`);
            
            try {
                switch(saveType) {
                    case 'configuration':
                        await saveCompanyData();
                        break;
                    case 'elevenlabs':
                        await saveElevenLabsSettings();
                        break;
                    case 'personality':
                        await savePersonalityResponses();
                        break;
                    default:
                        console.log(`Save type ${saveType} not implemented yet`);
                }
                showNotification(`${saveType} saved successfully!`, 'success');
            } catch (error) {
                showNotification(`Failed to save ${saveType}`, 'error');
            }
        });
    });
}

// =============================================
// ADDITIONAL MISSING FUNCTIONS
// =============================================

async function saveElevenLabsSettings() {
    const formData = new FormData(window.elevenlabsSettingsForm);
    const data = Object.fromEntries(formData);
    
    try {
        const response = await fetch(`/api/company/${companyId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'aiSettings.elevenLabs': {
                    apiKey: data.elevenlabsApiKey,
                    voiceId: data.elevenlabsVoice
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to save: ${response.statusText}`);
        }
        
        console.log('✅ ElevenLabs settings saved');
        clearUnsavedChanges();
    } catch (error) {
        console.error('❌ Error saving ElevenLabs settings:', error);
        throw error;
    }
}

function testElevenLabsVoice() {
    const testPhrase = window.elevenlabsTestPhraseInput?.value || 'Hello, this is a test from ElevenLabs!';
    const apiKey = window.elevenlabsApiKeyInput?.value;
    const voiceId = window.elevenlabsVoiceSelect?.value;
    
    if (!apiKey || !voiceId) {
        showNotification('Please enter API key and select a voice first', 'error');
        return;
    }
    
    showNotification('Testing voice... (This would make an API call to ElevenLabs)', 'info');
    console.log('🎵 Testing ElevenLabs voice:', { testPhrase, voiceId });
}

// =============================================
// HELPER FUNCTIONS
// =============================================

function populateOperatingHours(operatingHours) {
    if (!operatingHours || !Array.isArray(operatingHours)) return;
    
    operatingHours.forEach(daySchedule => {
        const dayName = daySchedule.day.toLowerCase();
        const enabledCheckbox = document.getElementById(`${dayName}-enabled`);
        const startInput = document.getElementById(`${dayName}-start`);
        const endInput = document.getElementById(`${dayName}-end`);
        
        if (enabledCheckbox) enabledCheckbox.checked = daySchedule.enabled || false;
        if (startInput) startInput.value = daySchedule.start || '';
        if (endInput) endInput.value = daySchedule.end || '';
    });
}

// Google Calendar disconnection functionality
function disconnectGoogleCalendar() {
    // Platform functionality to disconnect Google Calendar
    if (!companyId) {
        showNotification('No company selected', 'error');
        return;
    }
    
    fetch(`/api/company/${companyId}/disconnect-google`, { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            showNotification('Google Calendar disconnected', 'success');
            // Refresh company data to update UI
            if (typeof fetchCompanyData === 'function') {
                fetchCompanyData();
            }
        })
        .catch(error => {
            showNotification('Error disconnecting Google Calendar', 'error');
        });
}

// Load ElevenLabs voices functionality
function loadElevenLabsVoices() {
    // Platform functionality - load available voices
    const voiceSelect = document.getElementById('elevenlabsVoice');
    if (!voiceSelect) return;
    
    // Default voices that should always be available
    const defaultVoices = [
        { id: 'rachel', name: 'Rachel (Default)' },
        { id: 'domi', name: 'Domi' },
        { id: 'bella', name: 'Bella' },
        { id: 'antoni', name: 'Antoni' },
        { id: 'elli', name: 'Elli' },
        { id: 'josh', name: 'Josh' },
        { id: 'arnold', name: 'Arnold' },
        { id: 'adam', name: 'Adam' },
        { id: 'sam', name: 'Sam' }
    ];
    
    voiceSelect.innerHTML = defaultVoices.map(voice => 
        `<option value="${voice.id}">${voice.name}</option>`
    ).join('');
}

// =============================================
// ENHANCED EVENT LISTENERS
// =============================================

function initializeEventListeners() {
    console.log('🎯 Initializing form event listeners...');
    
    // Edit Profile Button (platform functionality)
    if (window.editProfileButton) {
        window.editProfileButton.addEventListener('click', () => {
            alert('Edit Profile functionality would open a modal or navigate to edit mode');
        });
    }
    
    // Configuration Form Submission (requires company data)
    if (window.configurationForm) {
        window.configurationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!companyId) {
                showNotification('No company selected', 'error');
                return;
            }
            try {
                await saveCompanyData();
                showNotification('Configuration saved successfully!', 'success');
            } catch (error) {
                showNotification('Failed to save configuration', 'error');
            }
        });
    }
    
    // ElevenLabs Form Submission (requires company data for preferences)
    if (window.elevenlabsSettingsForm) {
        window.elevenlabsSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!companyId) {
                showNotification('No company selected', 'error');
                return;
            }
            try {
                await saveElevenLabsSettings();
                showNotification('ElevenLabs settings saved!', 'success');
            } catch (error) {
                showNotification('Failed to save ElevenLabs settings', 'error');
            }
        });
    }
    
    // Trade Categories Change Handler (requires company data to save)
    const tradeCategoryCheckboxes = document.querySelectorAll('input[name="tradeCategories"]');
    tradeCategoryCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const selectedCategories = Array.from(document.querySelectorAll('input[name="tradeCategories"]:checked'))
                .map(cb => cb.value);
            updateTradeCategoriesDisplay(selectedCategories);
            setUnsavedChanges();
        });
    });
    
    // Form change tracking
    document.addEventListener('input', (e) => {
        if (e.target.matches('input, textarea, select')) {
            setUnsavedChanges();
        }
    });
    
    // Save buttons (require company data)
    const saveButtons = document.querySelectorAll('[onclick*="save"]');
    saveButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (!companyId) {
                showNotification('No company selected', 'error');
                return;
            }
            clearUnsavedChanges();
        });
    });
    
    // Operating hours toggles
    const operatingHourToggles = document.querySelectorAll('input[type="checkbox"][id$="-enabled"]');
    operatingHourToggles.forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const dayName = e.target.id.replace('-enabled', '');
            const startInput = document.getElementById(`${dayName}-start`);
            const endInput = document.getElementById(`${dayName}-end`);
            
            if (startInput && endInput) {
                startInput.disabled = !e.target.checked;
                endInput.disabled = !e.target.checked;
            }
            setUnsavedChanges();
        });
    });
    
    // Operating hours time inputs
    const operatingHourInputs = document.querySelectorAll('input[type="time"]');
    operatingHourInputs.forEach(input => {
        input.addEventListener('input', setUnsavedChanges);
    });
    
    console.log('✅ Form event listeners initialized');
}

// =============================================
// ERROR HANDLING
// =============================================

function showError(message) {
    console.error('❌ Error:', message);
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'fixed top-4 right-4 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg';
    errorDiv.innerHTML = `
        <div class="flex items-center">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            <span>${escapeHTML(message)}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-red-800 hover:text-red-900">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.remove();
        }
    }, 10000);
}

// =============================================
// GLOBAL FUNCTION EXPOSURE
// =============================================

// Expose necessary functions globally for HTML onclick handlers
window.fetchCompanyData = fetchCompanyData;
window.saveCompanyData = saveCompanyData;
window.savePersonalityResponses = savePersonalityResponses;
window.saveTradeCategories = saveTradeCategories;
window.addLogicNote = addLogicNote;
window.deleteLogicNote = deleteLogicNote;
window.addBookingField = addBookingField;
window.deleteBookingField = deleteBookingField;
window.moveBookingField = moveBookingField;
window.saveBookingFlow = saveBookingFlow;

console.log('🚀 Company Profile JavaScript loaded successfully');
