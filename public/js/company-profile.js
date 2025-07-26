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
    
    // Initialize ElevenLabs voice settings
    initializeEnhancedVoiceSettings();
    
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
    // OTHER TABS - IMPLEMENTED
    // ==========================================
    
    // All major tabs implemented:
    // ✅ Configuration tab
    // ✅ Calendar settings  
    // ✅ AI Settings
    // ✅ Trade categories (multi-select with persistence)
    // ✅ Personality responses
    
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
// TRADE CATEGORIES MANAGEMENT - MULTI-SELECT FOR COMPANY
// =============================================

/**
 * Load all available trade categories and populate the multi-select dropdown
 */
async function loadTradeCategorySelector() {
    try {
        console.log('📋 Loading trade categories for company selection...');
        
        const response = await fetch('/api/trade-categories');
        if (!response.ok) {
            throw new Error(`Failed to load trade categories: ${response.statusText}`);
        }
        
        const categories = await response.json();
        console.log('📋 Available trade categories:', categories.length);
        
        const select = document.getElementById('agent-trade-categories');
        if (!select) {
            console.warn('Trade category select element not found');
            return;
        }
        
        // Clear existing options
        select.innerHTML = '';
        
        // Add categories as options
        categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = `${category.name} (${category.qas ? category.qas.length : 0} Q&As)`;
            option.title = category.description || `${category.name} trade category`;
            select.appendChild(option);
        });
        
        // Load company's currently selected categories
        await loadCompanyTradeCategories();
        
        // Load company's language setting
        await loadCompanyLanguage();
        
        console.log('✅ Trade categories selector loaded');
        
    } catch (error) {
        console.error('❌ Error loading trade categories:', error);
        showNotification('Failed to load trade categories', 'error');
    }
}

/**
 * Load the company's currently selected trade categories
 */
async function loadCompanyTradeCategories() {
    try {
        console.log('📋 Loading company trade categories...');
        
        const response = await fetch(`/api/companies/${companyId}/trade-categories`);
        if (!response.ok) {
            throw new Error(`Failed to load company trade categories: ${response.statusText}`);
        }
        
        const data = await response.json();
        const selectedCategories = data.tradeCategories || [];
        
        const select = document.getElementById('agent-trade-categories');
        if (!select) return;
        
        // Clear all selections first
        for (const option of select.options) {
            option.selected = false;
        }
        
        // Select the company's categories
        selectedCategories.forEach(categoryName => {
            for (const option of select.options) {
                if (option.value === categoryName) {
                    option.selected = true;
                    break;
                }
            }
        });
        
        // Update the count display
        updateSelectedCategoriesCount();
        
        console.log(`✅ Company has ${selectedCategories.length} trade categories selected:`, selectedCategories);
        
    } catch (error) {
        console.error('❌ Error loading company trade categories:', error);
        // Don't show error notification here as it might be called during page load
    }
}

/**
 * Update the display of how many categories are selected
 */
function updateSelectedCategoriesCount() {
    const select = document.getElementById('agent-trade-categories');
    if (!select) return;
    
    const selectedCount = select.selectedOptions.length;
    const totalCount = select.options.length;
    
    // Find or create count display element
    let countDisplay = document.getElementById('trade-categories-count');
    if (!countDisplay) {
        countDisplay = document.createElement('div');
        countDisplay.id = 'trade-categories-count';
        countDisplay.className = 'mt-2 text-sm font-medium';
        select.parentNode.insertBefore(countDisplay, select.nextSibling);
    }
    
    if (selectedCount === 0) {
        countDisplay.innerHTML = `<span class="text-gray-500"><i class="fas fa-info-circle mr-1"></i>No categories selected</span>`;
    } else {
        countDisplay.innerHTML = `<span class="text-indigo-600"><i class="fas fa-check-circle mr-1"></i>${selectedCount} of ${totalCount} categories selected</span>`;
    }
}

/**
 * Handle selection changes in the multi-select
 */
function handleTradeCategoryChange() {
    updateSelectedCategoriesCount();
    
    const select = document.getElementById('agent-trade-categories');
    const selectedValues = Array.from(select.selectedOptions).map(opt => opt.value);
    
    console.log('📋 Trade categories selection changed:', selectedValues);
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

/**
 * Save the selected trade categories for this company
 */
async function saveTradeCategories() {
    try {
        console.log('💾 Saving trade categories...');
        
        const select = document.getElementById('agent-trade-categories');
        if (!select) {
            throw new Error('Trade category select element not found');
        }
        
        const selectedValues = Array.from(select.selectedOptions).map(opt => opt.value);
        
        // Validation
        if (selectedValues.length === 0) {
            showNotification('Please select at least one trade category', 'warning');
            return;
        }
        
        if (selectedValues.length > 10) {
            showNotification('Maximum 10 trade categories allowed', 'error');
            return;
        }
        
        console.log('📋 Saving categories:', selectedValues);
        
        const response = await fetch(`/api/companies/${companyId}/trade-categories`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tradeCategories: selectedValues })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Save failed: ${errorData.error || response.statusText}`);
        }
        
        const result = await response.json();
        console.log('✅ Trade categories save response:', result);
        
        // Update local data
        if (currentCompanyData) {
            currentCompanyData.tradeTypes = selectedValues;
        }
        
        // Show success message with count
        showNotification(`${selectedValues.length} trade categories saved successfully!`);
        console.log('✅ Trade categories saved:', selectedValues);
        
        // Update count display
        updateSelectedCategoriesCount();
        
    } catch (error) {
        console.error('❌ Error saving trade categories:', error);
        showNotification(`Failed to save trade categories: ${error.message}`, 'error');
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
    
    // Enhanced validation
    const promptValue = promptInput.value?.trim();
    const nameValue = nameInput.value?.trim();
    
    if (!promptValue || !nameValue) {
        showNotification('Both prompt and field name are required', 'error');
        if (!promptValue) {
            promptInput?.classList.add('border-red-300', 'bg-red-50');
            setTimeout(() => {
                promptInput?.classList.remove('border-red-300', 'bg-red-50');
            }, 3000);
        }
        if (!nameValue) {
            nameInput?.classList.add('border-red-300', 'bg-red-50');
            setTimeout(() => {
                nameInput?.classList.remove('border-red-300', 'bg-red-50');
            }, 3000);
        }
        return;
    }
    
    // Length validation
    if (promptValue.length > 500) {
        showNotification('Prompt must be less than 500 characters', 'error');
        promptInput?.classList.add('border-red-300', 'bg-red-50');
        setTimeout(() => {
            promptInput?.classList.remove('border-red-300', 'bg-red-50');
        }, 3000);
        return;
    }
    
    if (nameValue.length > 100) {
        showNotification('Field name must be less than 100 characters', 'error');
        nameInput?.classList.add('border-red-300', 'bg-red-50');
        setTimeout(() => {
            nameInput?.classList.remove('border-red-300', 'bg-red-50');
        }, 3000);
        return;
    }
    
    // Sanitize field name (alphanumeric and underscores only)
    const sanitizedName = nameValue.replace(/[^a-zA-Z0-9_]/g, '_');
    if (sanitizedName !== nameValue) {
        showNotification('Field name can only contain letters, numbers, and underscores. Name has been sanitized.', 'warning');
        nameInput.value = sanitizedName;
    }
    
    // Check for duplicate field names
    const fieldName = sanitizedName.toLowerCase();
    const existingField = bookingFlowFields.find(field => field.name.toLowerCase() === fieldName);
    if (existingField) {
        showNotification('A field with this name already exists', 'error');
        nameInput.classList.add('border-red-300', 'bg-red-50');
        setTimeout(() => {
            nameInput.classList.remove('border-red-300', 'bg-red-50');
        }, 3000);
        return;
    }
    
    // Maximum fields check
    if (bookingFlowFields.length >= 20) {
        showNotification('Maximum 20 booking fields allowed', 'error');
        return;
    }
    
    const field = {
        id: Date.now(),
        prompt: promptValue,
        name: sanitizedName,
        order: bookingFlowFields.length
    };
    
    bookingFlowFields.push(field);
    
    // Clear inputs
    promptInput.value = '';
    nameInput.value = '';
    
    // Focus back to prompt input for easy adding of multiple fields
    promptInput.focus();
    
    renderBookingFlowTable();
    showNotification('Booking field added successfully!');
    console.log('📋 Booking field added:', field);
}

function deleteBookingField(fieldId) {
    const field = bookingFlowFields.find(f => f.id === fieldId);
    if (!field) return;
    
    if (confirm(`Are you sure you want to delete the field "${field.prompt}"?\n\nThis action cannot be undone.`)) {
        bookingFlowFields = bookingFlowFields.filter(field => field.id !== fieldId);
        renderBookingFlowTable();
        showNotification('Field deleted successfully');
        console.log('🗑️ Booking field deleted:', field);
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
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="px-6 py-8 text-center text-gray-500">
                    <div class="flex flex-col items-center">
                        <svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                        </svg>
                        <p class="text-sm text-gray-500">No booking fields configured yet.</p>
                        <p class="text-xs text-gray-400 mt-1">Add your first field above to get started.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = bookingFlowFields.map((field, index) => `
        <tr class="hover:bg-gray-50 transition-colors duration-150">
            <td class="px-6 py-4 text-sm text-gray-900">
                <div class="flex items-start">
                    <span class="inline-flex items-center justify-center w-6 h-6 text-xs font-medium text-blue-600 bg-blue-100 rounded-full mr-3 flex-shrink-0">${index + 1}</span>
                    <span class="break-words">${escapeHTML(field.prompt)}</span>
                </div>
            </td>
            <td class="px-6 py-4 text-sm font-mono text-gray-700 bg-gray-50">
                <code class="px-2 py-1 bg-gray-200 rounded text-xs">${escapeHTML(field.name)}</code>
            </td>
            <td class="px-6 py-4 text-sm">
                <div class="flex items-center space-x-2">
                    ${index > 0 ? `
                        <button 
                            onclick="moveBookingField(${field.id}, 'up')" 
                            class="inline-flex items-center p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors duration-150"
                            title="Move up"
                        >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                            </svg>
                        </button>
                    ` : '<div class="w-8"></div>'}
                    
                    ${index < bookingFlowFields.length - 1 ? `
                        <button 
                            onclick="moveBookingField(${field.id}, 'down')" 
                            class="inline-flex items-center p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors duration-150"
                            title="Move down"
                        >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    ` : '<div class="w-8"></div>'}
                    
                    <button 
                        onclick="deleteBookingField(${field.id})" 
                        class="inline-flex items-center p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors duration-150 ml-2"
                        title="Delete field"
                    >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function saveBookingFlow() {
    try {
        console.log('💾 Saving booking flow...');
        
        // Clean the data for backend - remove frontend-only fields
        const cleanedFields = bookingFlowFields.map(field => ({
            prompt: field.prompt,
            name: field.name,
            required: field.required || true,
            type: field.type || 'text'
        }));
        
        const response = await fetch(`/api/companies/${companyId}/booking-flow`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(cleanedFields)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Save failed: ${errorData.error || response.statusText}`);
        }
        
        const result = await response.json();
        console.log('✅ Booking flow save response:', result);
        
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
        showNotification(`Failed to save booking flow: ${error.message}`, 'error');
    }
}

async function loadBookingFlow() {
    try {
        console.log('📋 Loading booking flow configuration...');
        
        const response = await fetch(`/api/companies/${companyId}/booking-flow`);
        
        if (!response.ok) {
            throw new Error(`Failed to load booking flow: ${response.statusText}`);
        }
        
        const bookingFlowData = await response.json();
        console.log('✅ Booking flow loaded:', bookingFlowData);
        
        // Transform the data to include IDs for frontend management
        bookingFlowFields = bookingFlowData.map((field, index) => ({
            id: field.id || Date.now() + index, // Use existing ID or generate one
            prompt: field.prompt,
            name: field.name,
            order: index
        }));
        
        renderBookingFlowTable();
        return bookingFlowData;
    } catch (error) {
        console.error('❌ Error loading booking flow:', error);
        // Initialize with default empty state
        bookingFlowFields = [];
        renderBookingFlowTable();
        showNotification('Failed to load booking flow configuration', 'error');
    }
}

// =============================================
// 🧠 AI AGENT INTELLIGENCE SETTINGS - CONNECTED TO BACKEND
// =============================================

/**
 * Load agent intelligence settings from backend
 */
async function loadAgentIntelligenceSettings() {
    try {
        console.log('🧠 Loading agent intelligence settings...');
        
        const response = await fetch(`/api/agent/settings/${companyId}`);
        
        if (!response.ok) {
            throw new Error(`Failed to load settings: ${response.statusText}`);
        }
        
        const settings = await response.json();
        console.log('✅ Agent intelligence settings loaded:', settings);
        
        // Populate UI controls with actual settings
        populateAgentIntelligenceUI(settings);
        
        return settings;
    } catch (error) {
        console.error('❌ Error loading agent intelligence settings:', error);
        showNotification('Failed to load agent settings', 'error');
        
        // Load defaults if backend fails
        populateAgentIntelligenceUI({});
    }
}

/**
 * Populate the UI with agent intelligence settings
 */
function populateAgentIntelligenceUI(settings) {
    console.log('📝 Populating agent intelligence UI with:', settings);
    
    // Core AI Configuration
    const useLLMSelect = document.getElementById('agent-useLLM');
    if (useLLMSelect) {
        useLLMSelect.value = settings.useLLM !== false ? 'true' : 'false';
    }
    
    const primaryLLMSelect = document.getElementById('agent-primaryLLM');
    if (primaryLLMSelect) {
        primaryLLMSelect.value = settings.primaryLLM || 'ollama-phi3';
    }
    
    const fallbackLLMSelect = document.getElementById('agent-fallbackLLM');
    if (fallbackLLMSelect) {
        fallbackLLMSelect.value = settings.fallbackLLM || 'gemini-pro';
    }
    
    const memoryModeSelect = document.getElementById('agent-memoryMode');
    if (memoryModeSelect) {
        memoryModeSelect.value = settings.memoryMode || 'conversation';
    }
    
    // Intelligence Thresholds
    const fallbackThresholdSlider = document.getElementById('agent-fallbackThreshold');
    const fallbackThresholdValue = document.getElementById('fallback-threshold-value');
    if (fallbackThresholdSlider && fallbackThresholdValue) {
        const threshold = settings.fallbackThreshold || 0.5;
        fallbackThresholdSlider.value = threshold;
        fallbackThresholdValue.textContent = threshold.toFixed(2);
    }
    
    const escalationModeSelect = document.getElementById('agent-escalationMode');
    if (escalationModeSelect) {
        escalationModeSelect.value = settings.escalationMode || 'ask';
    }
    
    const rePromptSelect = document.getElementById('agent-rePromptAfterTurns');
    if (rePromptSelect) {
        rePromptSelect.value = settings.rePromptAfterTurns || 2;
    }
    
    const maxPromptsSelect = document.getElementById('agent-maxPromptsPerCall');
    if (maxPromptsSelect) {
        maxPromptsSelect.value = settings.maxPromptsPerCall || 3;
    }
    
    // Advanced Features
    const semanticSearchCheckbox = document.getElementById('agent-semanticSearchEnabled');
    if (semanticSearchCheckbox) {
        semanticSearchCheckbox.checked = settings.semanticSearchEnabled || false;
    }
    
    const confidenceScoringCheckbox = document.getElementById('agent-confidenceScoring');
    if (confidenceScoringCheckbox) {
        confidenceScoringCheckbox.checked = settings.confidenceScoring !== false;
    }
    
    const autoLearningCheckbox = document.getElementById('agent-autoLearningQueue');
    if (autoLearningCheckbox) {
        autoLearningCheckbox.checked = settings.autoLearningQueue || false;
    }
    
    // Allowed LLM Models
    const allowedLLMs = settings.allowedLLMs || ['ollama-phi3', 'gemini-pro'];
    const modelCheckboxes = [
        'llm-ollama-phi3',
        'llm-ollama-mistral', 
        'llm-gemini-pro',
        'llm-openai-gpt4',
        'llm-claude-3'
    ];
    
    modelCheckboxes.forEach(checkboxId => {
        const checkbox = document.getElementById(checkboxId);
        if (checkbox) {
            const modelName = checkboxId.replace('llm-', '').replace('-', '-');
            checkbox.checked = allowedLLMs.includes(modelName);
        }
    });
    
    // Update active models count
    updateActiveModelsCount();
    
    console.log('✅ Agent intelligence UI populated');
}

/**
 * Save agent intelligence settings to backend
 */
async function saveAgentSettings() {
    try {
        console.log('💾 Saving agent intelligence settings...');
        
        // Collect all settings from UI
        const settings = {
            // Core AI Configuration
            useLLM: document.getElementById('agent-useLLM')?.value === 'true',
            primaryLLM: document.getElementById('agent-primaryLLM')?.value || 'ollama-phi3',
            fallbackLLM: document.getElementById('agent-fallbackLLM')?.value || 'gemini-pro',
            memoryMode: document.getElementById('agent-memoryMode')?.value || 'conversation',
            
            // Intelligence Thresholds
            fallbackThreshold: parseFloat(document.getElementById('agent-fallbackThreshold')?.value) || 0.5,
            escalationMode: document.getElementById('agent-escalationMode')?.value || 'ask',
            rePromptAfterTurns: parseInt(document.getElementById('agent-rePromptAfterTurns')?.value) || 2,
            maxPromptsPerCall: parseInt(document.getElementById('agent-maxPromptsPerCall')?.value) || 3,
            
            // Advanced Features
            semanticSearchEnabled: document.getElementById('agent-semanticSearchEnabled')?.checked || false,
            confidenceScoring: document.getElementById('agent-confidenceScoring')?.checked !== false,
            autoLearningQueue: document.getElementById('agent-autoLearningQueue')?.checked || false,
            
            // Allowed LLM Models
            allowedLLMs: []
        };
        
        // Collect selected LLM models
        const selectedLLMCheckboxes = [
            { id: 'llm-ollama-phi3', name: 'ollama-phi3' },
            { id: 'llm-ollama-mistral', name: 'ollama-mistral' },
            { id: 'llm-gemini-pro', name: 'gemini-pro' },
            { id: 'llm-openai-gpt4', name: 'openai-gpt4' },
            { id: 'llm-claude-3', name: 'claude-3' }
        ];
        
        selectedLLMCheckboxes.forEach(({ id, name }) => {
            const checkbox = document.getElementById(id);
            if (checkbox?.checked) {
                settings.allowedLLMs.push(name);
            }
        });
        
        console.log('🚀 Settings to save:', settings);
        
        // Save to backend
        const response = await fetch(`/api/agent/settings/${companyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });
        
        if (!response.ok) {
            throw new Error(`Save failed: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('✅ Settings saved:', result);
        
        // Show success feedback
        const savedElement = document.getElementById('agent-settings-saved');
        if (savedElement) {
            savedElement.classList.remove('hidden');
            setTimeout(() => {
                savedElement.classList.add('hidden');
            }, 3000);
        }
        
        showNotification('Agent settings saved successfully!');
        
    } catch (error) {
        console.error('❌ Error saving agent settings:', error);
        showNotification('Failed to save agent settings', 'error');
    }
}

/**
 * Reset agent settings to defaults
 */
async function resetToDefaults() {
    if (!confirm('Are you sure you want to reset all agent settings to defaults? This cannot be undone.')) {
        return;
    }
    
    try {
        console.log('🔄 Resetting agent settings to defaults...');
        
        const response = await fetch(`/api/agent/settings/${companyId}/reset`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Reset failed: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('✅ Settings reset:', result);
        
        // Repopulate UI with default settings
        populateAgentIntelligenceUI(result.settings);
        
        showNotification('Agent settings reset to defaults');
        
    } catch (error) {
        console.error('❌ Error resetting agent settings:', error);
        showNotification('Failed to reset agent settings', 'error');
    }
}

/**
 * Test agent configuration with current settings
 */
async function testAgentConfiguration() {
    const testMessage = document.getElementById('testMessage')?.value;
    
    if (!testMessage?.trim()) {
        showNotification('Please enter a test message first', 'error');
        return;
    }
    
    // Save current settings first, then test
    await saveAgentSettings();
    
    // Run the actual test
    await runAgentTest();
}

/**
 * Update active models count display
 */
function updateActiveModelsCount() {
    const modelCheckboxList = [
        'llm-ollama-phi3',
        'llm-ollama-mistral', 
        'llm-gemini-pro',
        'llm-openai-gpt4',
        'llm-claude-3'
    ];
    
    let activeCount = 0;
    modelCheckboxList.forEach(checkboxId => {
        const checkbox = document.getElementById(checkboxId);
        if (checkbox?.checked) {
            activeCount++;
        }
    });
    
    const countDisplay = document.getElementById('activeModelsCount');
    if (countDisplay) {
        countDisplay.textContent = `${activeCount} selected`;
    }
}

// Add event listeners for threshold slider
document.addEventListener('DOMContentLoaded', function() {
    const fallbackThresholdSlider = document.getElementById('agent-fallbackThreshold');
    const fallbackThresholdValue = document.getElementById('fallback-threshold-value');
    
    if (fallbackThresholdSlider && fallbackThresholdValue) {
        fallbackThresholdSlider.addEventListener('input', function() {
            fallbackThresholdValue.textContent = parseFloat(this.value).toFixed(2);
        });
    }
    
    // Add event listeners for LLM checkboxes to update count
    const modelCheckboxIds = [
        'llm-ollama-phi3',
        'llm-ollama-mistral', 
        'llm-gemini-pro',
        'llm-openai-gpt4',
        'llm-claude-3'
    ];
    
    modelCheckboxIds.forEach(checkboxId => {
        const checkbox = document.getElementById(checkboxId);
        if (checkbox) {
            checkbox.addEventListener('change', updateActiveModelsCount);
        }
    });
});

// =============================================
// 🎤 ENHANCED ELEVENLABS VOICE SETTINGS
// Latest ElevenLabs SDK Integration
// ===========================================

let availableVoices = [];
let availableModels = [];
let currentVoiceSettings = {
    stability: 0.5,
    similarity_boost: 0.7,
    style: 0.0,
    use_speaker_boost: true,
    model_id: 'eleven_turbo_v2_5',
    output_format: 'mp3_44100_128',
    optimize_streaming_latency: 0
};

/**
 * Initialize Enhanced ElevenLabs Voice Settings
 */
function initializeEnhancedVoiceSettings() {
    console.log('🎤 Initializing Enhanced ElevenLabs Voice Settings...');
    
    // Test if voice selector exists
    const voiceSelector = document.getElementById('voice-selector');
    console.log('🔍 Voice selector element found:', !!voiceSelector);
    
    // Bind event listeners
    bindVoiceSettingsEvents();
    
    // Load API key toggle state
    loadApiKeyToggle();
    
    // Load initial data
    loadElevenLabsData();
    
    // Force load default voices immediately as a test
    setTimeout(() => {
        console.log('🧪 Force loading default voices as test...');
        loadDefaultVoices();
    }, 1000);
}

/**
 * Bind all voice settings event listeners
 */
function bindVoiceSettingsEvents() {
    // API Connection Test
    document.getElementById('test-api-connection')?.addEventListener('click', testApiConnection);
    
    // Voice Management
    document.getElementById('refresh-voices')?.addEventListener('click', loadElevenLabsVoices);
    document.getElementById('voice-selector')?.addEventListener('change', handleVoiceChange);
    
    // Voice Settings Controls
    document.getElementById('reset-voice-settings')?.addEventListener('click', resetVoiceSettings);
    
    // Test & Preview
    document.getElementById('test-voice-btn')?.addEventListener('click', testVoiceSynthesis);
    document.getElementById('stream-test-btn')?.addEventListener('click', testVoiceStreaming);
    document.getElementById('play-voice-sample')?.addEventListener('click', playVoiceSample);
    
    // Save Settings
    document.getElementById('save-voice-settings')?.addEventListener('click', saveVoiceSettings);
    
    // Real-time slider updates
    ['voice-stability', 'voice-similarity', 'voice-style'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateVoiceSettingsPreview);
    });
    
    // Model and format changes
    ['voice-model', 'voice-format', 'voice-latency'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', updateVoiceSettingsPreview);
    });
    
    document.getElementById('voice-speaker-boost')?.addEventListener('change', updateVoiceSettingsPreview);
}

/**
 * Load all ElevenLabs data (voices, models, user info)
 */
async function loadElevenLabsData() {
    try {
        showNotification('Loading ElevenLabs data...', 'info');
        
        await Promise.all([
            loadElevenLabsVoices(),
            loadElevenLabsModels(),
            loadUserSubscriptionInfo()
        ]);
        
        console.log('✅ ElevenLabs data loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load ElevenLabs data:', error);
        showNotification('Failed to load ElevenLabs data', 'error');
    }
}

/**
 * Test API connection
 */
async function testApiConnection() {
    const apiKey = document.getElementById('elevenlabsApiKey')?.value?.trim();
    
    if (!apiKey) {
        showNotification('Please enter your ElevenLabs API key first', 'warning');
        return;
    }
    
    const button = document.getElementById('test-api-connection');
    const originalText = button.innerHTML;
    
    try {
        button.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Testing...';
        button.disabled = true;
        
        const response = await fetch('/api/elevenlabs/user', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification('✅ API connection successful!', 'success');
            displaySubscriptionInfo(data.user);
        } else {
            throw new Error('API connection failed');
        }
    } catch (error) {
        console.error('❌ API connection test failed:', error);
        showNotification('❌ API connection failed. Please check your API key.', 'error');
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

/**
 * Load available voices from ElevenLabs
 */
async function loadElevenLabsVoices() {
    try {
        console.log('🎤 Loading ElevenLabs voices...');
        const response = await fetch('/api/elevenlabs/voices');
        const data = await response.json();
        
        if (data.success && data.voices && data.voices.length > 0) {
            availableVoices = data.voices;
            populateVoiceSelector(availableVoices);
            console.log(`✅ Loaded ${data.count} voices`);
            showNotification(`Loaded ${data.count} voices`, 'success');
        } else {
            throw new Error(data.message || 'No voices returned');
        }
    } catch (error) {
        console.error('❌ Failed to load voices:', error);
        
        // Load default voices as fallback
        loadDefaultVoices();
        showNotification('Using default voices. Configure ElevenLabs API key for full voice library.', 'warning');
    }
}

/**
 * Load default voices when API fails
 */
function loadDefaultVoices() {
    const defaultVoices = [
        { voice_id: 'rachel', name: 'Rachel', gender: 'female', category: 'conversational' },
        { voice_id: 'adam', name: 'Adam', gender: 'male', category: 'conversational' },
        { voice_id: 'bella', name: 'Bella', gender: 'female', category: 'professional' },
        { voice_id: 'antoni', name: 'Antoni', gender: 'male', category: 'professional' },
        { voice_id: 'josh', name: 'Josh', gender: 'male', category: 'narration' },
        { voice_id: 'sam', name: 'Sam', gender: 'male', category: 'conversational' }
    ];
    
    availableVoices = defaultVoices;
    populateVoiceSelector(defaultVoices);
    console.log('📢 Loaded default voices as fallback');
}

/**
 * Load available models from ElevenLabs
 */
async function loadElevenLabsModels() {
    try {
        const response = await fetch('/api/elevenlabs/models');
        const data = await response.json();
        
        if (data.success) {
            availableModels = data.models;
            populateModelSelector(availableModels);
            console.log(`✅ Loaded ${data.count} models`);
        }
    } catch (error) {
        console.error('❌ Failed to load models:', error);
        // Don't show error notification for models as it's not critical
    }
}

/**
 * Load user subscription information
 */
async function loadUserSubscriptionInfo() {
    try {
        const response = await fetch('/api/elevenlabs/user');
        const data = await response.json();
        
        if (data.success) {
            displaySubscriptionInfo(data.user);
        }
    } catch (error) {
        console.error('❌ Failed to load user info:', error);
        // Don't show error for subscription info
    }
}

/**
 * Populate voice selector dropdown
 */
function populateVoiceSelector(voices) {
    console.log('🎙️ populateVoiceSelector called with voices:', voices.length);
    
    const selector = document.getElementById('voice-selector');
    console.log('🔍 Voice selector element:', selector);
    
    if (!selector) {
        console.error('❌ Voice selector element not found!');
        return;
    }
    
    // Clear existing options except the first
    selector.innerHTML = '<option value="">Choose a voice...</option>';
    console.log('🧹 Cleared voice selector, adding', voices.length, 'voices');
    
    voices.forEach((voice, index) => {
        const option = document.createElement('option');
        option.value = voice.voice_id;
        option.textContent = `${voice.name} (${voice.gender || 'Unknown'}, ${voice.category || 'General'})`;
        option.dataset.voice = JSON.stringify(voice);
        selector.appendChild(option);
        console.log(`✅ Added voice ${index + 1}:`, voice.name);
    });
    
    console.log('🎤 Voice selector populated with', selector.options.length, 'total options');
}

/**
 * Populate model selector dropdown
 */
function populateModelSelector(models) {
    const selector = document.getElementById('voice-model');
    if (!selector || models.length === 0) return;
    
    // Clear existing options
    selector.innerHTML = '';
    
    models.forEach(model => {
        if (model.can_do_text_to_speech) {
            const option = document.createElement('option');
            option.value = model.model_id;
            option.textContent = `${model.name} - ${model.description}`;
            selector.appendChild(option);
        }
    });
    
    // Set default to turbo if available
    if (selector.querySelector('option[value="eleven_turbo_v2_5"]')) {
        selector.value = 'eleven_turbo_v2_5';
    }
}

/**
 * Display subscription information
 */
function displaySubscriptionInfo(userInfo) {
    const container = document.getElementById('subscription-details');
    const section = document.getElementById('subscription-info');
    
    if (!container || !userInfo) return;
    
    const charUsed = userInfo.character_count || 0;
    const charLimit = userInfo.character_limit || 0;
    const charPercentage = charLimit > 0 ? Math.round((charUsed / charLimit) * 100) : 0;
    
    container.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <span class="font-medium">Tier:</span>
            <span class="px-2 py-1 text-xs rounded ${userInfo.tier === 'free' ? 'bg-gray-100' : 'bg-blue-100'} text-gray-800">
                ${userInfo.tier || 'Unknown'}
            </span>
        </div>
        <div class="flex items-center justify-between mb-2">
            <span class="font-medium">Characters:</span>
            <span class="text-sm">${charUsed.toLocaleString()} / ${charLimit.toLocaleString()} (${charPercentage}%)</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2">
            <div class="bg-blue-600 h-2 rounded-full" style="width: ${Math.min(charPercentage, 100)}%"></div>
        </div>
    `;
    
    section.classList.remove('hidden');
}

/**
 * Handle voice selection change
 */
async function handleVoiceChange() {
    const selector = document.getElementById('voice-selector');
    const selectedOption = selector.selectedOptions[0];
    
    if (!selectedOption || !selectedOption.dataset.voice) {
        document.getElementById('voice-preview-section').classList.add('hidden');
        return;
    }
    
    const voice = JSON.parse(selectedOption.dataset.voice);
    displayVoiceInfo(voice);
    
    // Load optimal settings for this voice
    if (voice.settings) {
        loadOptimalVoiceSettings(voice.settings);
    }
    
    document.getElementById('voice-preview-section').classList.remove('hidden');
}

/**
 * Display voice information
 */
function displayVoiceInfo(voice) {
    const container = document.getElementById('voice-info');
    if (!container) return;
    
    container.innerHTML = `
        <div class="grid grid-cols-2 gap-2 text-sm">
            <div><strong>Name:</strong> ${voice.name}</div>
            <div><strong>Gender:</strong> ${voice.gender || 'Unknown'}</div>
            <div><strong>Category:</strong> ${voice.category || 'General'}</div>
            <div><strong>Accent:</strong> ${voice.accent || 'Unknown'}</div>
        </div>
        ${voice.description ? `<p class="text-xs text-gray-600 mt-2">${voice.description}</p>` : ''}
    `;
}

/**
 * Load optimal voice settings
 */
function loadOptimalVoiceSettings(settings) {
    if (settings.stability !== undefined) {
        document.getElementById('voice-stability').value = settings.stability;
        updateSliderValue('stability', settings.stability);
    }
    if (settings.similarity_boost !== undefined) {
        document.getElementById('voice-similarity').value = settings.similarity_boost;
        updateSliderValue('similarity', settings.similarity_boost);
    }
    if (settings.style !== undefined) {
        document.getElementById('voice-style').value = settings.style;
        updateSliderValue('style', settings.style);
    }
    if (settings.use_speaker_boost !== undefined) {
        document.getElementById('voice-speaker-boost').checked = settings.use_speaker_boost;
    }
}

/**
 * Update slider value display
 */
function updateSliderValue(type, value) {
    const displayElement = document.getElementById(`${type}-value`);
    if (displayElement) {
        displayElement.textContent = parseFloat(value).toFixed(1);
    }
    
    // Update current settings
    if (type === 'stability') currentVoiceSettings.stability = parseFloat(value);
    if (type === 'similarity') currentVoiceSettings.similarity_boost = parseFloat(value);
    if (type === 'style') currentVoiceSettings.style = parseFloat(value);
}

/**
 * Update checkbox value
 */
function updateCheckboxValue(type, checked) {
    if (type === 'speaker-boost') {
        currentVoiceSettings.use_speaker_boost = checked;
    }
}

/**
 * Reset voice settings to optimal defaults
 */
function resetVoiceSettings() {
    document.getElementById('voice-stability').value = 0.5;
    document.getElementById('voice-similarity').value = 0.7;
    document.getElementById('voice-style').value = 0.0;
    document.getElementById('voice-speaker-boost').checked = true;
    document.getElementById('voice-model').value = 'eleven_turbo_v2_5';
    document.getElementById('voice-format').value = 'mp3_44100_128';
    document.getElementById('voice-latency').value = '0';
    
    updateSliderValue('stability', 0.5);
    updateSliderValue('similarity', 0.7);
    updateSliderValue('style', 0.0);
    updateCheckboxValue('speaker-boost', true);
    
    showNotification('Voice settings reset to optimal defaults', 'info');
}

/**
 * Update voice settings preview
 */
function updateVoiceSettingsPreview() {
    currentVoiceSettings = {
        stability: parseFloat(document.getElementById('voice-stability').value),
        similarity_boost: parseFloat(document.getElementById('voice-similarity').value),
        style: parseFloat(document.getElementById('voice-style').value),
        use_speaker_boost: document.getElementById('voice-speaker-boost').checked,
        model_id: document.getElementById('voice-model').value,
        output_format: document.getElementById('voice-format').value,
        optimize_streaming_latency: parseInt(document.getElementById('voice-latency').value)
    };
}

/**
 * Test voice synthesis
 */
async function testVoiceSynthesis() {
    const voiceId = document.getElementById('voice-selector').value;
    const testText = document.getElementById('test-text').value.trim();
    
    if (!voiceId || !testText) {
        showNotification('Please select a voice and enter test text', 'warning');
        return;
    }
    
    const button = document.getElementById('test-voice-btn');
    const originalText = button.innerHTML;
    
    try {
        button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generating...';
        button.disabled = true;
        
        updateVoiceSettingsPreview();
        
        const response = await fetch('/api/elevenlabs/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: testText,
                voiceId: voiceId,
                ...currentVoiceSettings
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            displayTestResults(data, 'synthesis');
            showNotification('✅ Test audio generated successfully!', 'success');
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error('❌ Voice synthesis test failed:', error);
        showNotification('❌ Voice synthesis test failed', 'error');
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

/**
 * Test voice streaming
 */
async function testVoiceStreaming() {
    const voiceId = document.getElementById('voice-selector').value;
    const testText = document.getElementById('test-text').value.trim();
    
    if (!voiceId || !testText) {
        showNotification('Please select a voice and enter test text', 'warning');
        return;
    }
    
    const button = document.getElementById('stream-test-btn');
    const originalText = button.innerHTML;
    
    try {
        button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Streaming...';
        button.disabled = true;
        
        updateVoiceSettingsPreview();
        
        const response = await fetch('/api/elevenlabs/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: testText,
                voiceId: voiceId,
                ...currentVoiceSettings,
                optimize_streaming_latency: 4 // Max optimization for streaming test
            })
        });
        
        if (response.ok) {
            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            displayStreamingResults(audioUrl);
            showNotification('✅ Streaming test completed!', 'success');
        } else {
            throw new Error('Streaming test failed');
        }
    } catch (error) {
        console.error('❌ Voice streaming test failed:', error);
        showNotification('❌ Voice streaming test failed', 'error');
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

/**
 * Play voice sample from preview URL
 */
async function playVoiceSample() {
    const selector = document.getElementById('voice-selector');
    const selectedOption = selector.selectedOptions[0];
    
    if (!selectedOption || !selectedOption.dataset.voice) {
        showNotification('Please select a voice first', 'warning');
        return;
    }
    
    const voice = JSON.parse(selectedOption.dataset.voice);
    
    if (voice.preview_url) {
        const audio = document.getElementById('voice-preview-audio');
        audio.src = voice.preview_url;
        audio.classList.remove('hidden');
        audio.play();
        showNotification('Playing voice sample...', 'info');
    } else {
        showNotification('No preview available for this voice', 'warning');
    }
}

/**
 * Display test results
 */
function displayTestResults(data, type) {
    const container = document.getElementById('test-results');
    if (!container) return;
    
    const audioBlob = new Blob([Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0))], { type: 'audio/mpeg' });
    const audioUrl = URL.createObjectURL(audioBlob);
    
    container.innerHTML = `
        <div class="text-center">
            <div class="mb-3">
                <i class="fas fa-check-circle text-green-600 text-2xl mb-2"></i>
                <p class="font-medium text-gray-800">Test ${type} completed!</p>
                <p class="text-sm text-gray-600">Audio size: ${(data.size / 1024).toFixed(1)} KB</p>
                <p class="text-sm text-gray-600">Format: ${data.format}</p>
            </div>
            <audio controls class="w-full max-w-sm mx-auto">
                <source src="${audioUrl}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
        </div>
    `;
}

/**
 * Display streaming results
 */
function displayStreamingResults(audioUrl) {
    const container = document.getElementById('test-results');
    if (!container) return;
    
    container.innerHTML = `
        <div class="text-center">
            <div class="mb-3">
                <i class="fas fa-broadcast-tower text-blue-600 text-2xl mb-2"></i>
                <p class="font-medium text-gray-800">Streaming test completed!</p>
                <p class="text-sm text-gray-600">Real-time streaming optimized</p>
            </div>
            <audio controls class="w-full max-w-sm mx-auto">
                <source src="${audioUrl}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
        </div>
    `;
}

/**
 * Filter voices based on criteria
 */
function filterVoices() {
    const genderFilter = document.getElementById('voice-gender-filter').value;
    const categoryFilter = document.getElementById('voice-category-filter').value;
    
    let filteredVoices = availableVoices;
    
    if (genderFilter) {
        filteredVoices = filteredVoices.filter(voice => 
            voice.gender && voice.gender.toLowerCase() === genderFilter.toLowerCase()
        );
    }
    
    if (categoryFilter) {
        filteredVoices = filteredVoices.filter(voice => 
            voice.category && voice.category.toLowerCase().includes(categoryFilter.toLowerCase())
        );
    }
    
    populateVoiceSelector(filteredVoices);
}

/**
 * Save voice settings
 */
async function saveVoiceSettings() {
    try {
        const voiceId = document.getElementById('voice-selector').value;
        const apiKey = document.getElementById('elevenlabsApiKey').value.trim();
        
        if (!voiceId) {
            showNotification('Please select a voice first', 'warning');
            return;
        }
        
        updateVoiceSettingsPreview();
        
        const voiceSettings = {
            apiKey: apiKey,
            voiceId: voiceId,
            ...currentVoiceSettings
        };
        
        // Save to company settings (you'll need to implement the endpoint)
        const response = await fetch(`/api/companies/${companyId}/voice-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(voiceSettings)
        });
        
        if (response.ok) {
            showNotification('✅ Voice settings saved successfully!', 'success');
        } else {
            throw new Error('Failed to save voice settings');
        }
    } catch (error) {
        console.error('❌ Failed to save voice settings:', error);
        showNotification('❌ Failed to save voice settings', 'error');
    }
}

/**
 * Toggle between ClientsVia global API and company's own API
 */
function toggleApiKeySource() {
    const toggle = document.getElementById('useOwnApiKey');
    const apiKeyInput = document.getElementById('elevenlabsApiKey');
    const globalApiInfo = document.getElementById('global-api-info');
    const ownApiInfo = document.getElementById('own-api-info');
    const apiSourceDescription = document.getElementById('api-source-description');
    const toggleLabel = document.getElementById('toggle-label');
    const apiKeyRequired = document.getElementById('api-key-required');
    
    if (!toggle) return;
    
    const useOwnApi = toggle.checked;
    
    if (useOwnApi) {
        // Switch to own API mode
        apiKeyInput.disabled = false;
        apiKeyInput.required = true;
        globalApiInfo.classList.add('hidden');
        ownApiInfo.classList.remove('hidden');
        apiSourceDescription.textContent = 'Using your personal ElevenLabs API account';
        toggleLabel.textContent = 'Using Own API';
        apiKeyRequired.classList.remove('hidden');
        
        console.log('🔑 Switched to company own API mode');
        showNotification('Switched to your own ElevenLabs API', 'info');
    } else {
        // Switch to global API mode
        apiKeyInput.disabled = true;
        apiKeyInput.required = false;
        globalApiInfo.classList.remove('hidden');
        ownApiInfo.classList.add('hidden');
        apiSourceDescription.textContent = 'Using ClientsVia global API (default for all companies)';
        toggleLabel.textContent = 'Use Own API';
        apiKeyRequired.classList.add('hidden');
        
        console.log('🏢 Switched to ClientsVia global API mode');
        showNotification('Switched to ClientsVia global API', 'success');
    }
    
    // Save the toggle state
    saveApiKeyToggle(useOwnApi);
}

/**
 * Save API key toggle state to backend
 */
async function saveApiKeyToggle(useOwnApi) {
    try {
        const companyId = getCompanyIdFromUrl();
        if (!companyId) return;
        
        const response = await fetch(`/api/companies/${companyId}/voice-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                'elevenLabs.useOwnApiKey': useOwnApi 
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save API toggle state');
        }
        
        console.log('✅ API toggle state saved:', useOwnApi);
    } catch (error) {
        console.error('❌ Error saving API toggle state:', error);
        showNotification('Failed to save API preference', 'error');
    }
}

/**
 * Load API key toggle state from company data
 */
async function loadApiKeyToggle() {
    try {
        const companyId = getCompanyIdFromUrl();
        if (!companyId) return;
        
        const response = await fetch(`/api/companies/${companyId}`);
        if (!response.ok) return;
        
        const company = await response.json();
        const useOwnApi = company.aiSettings?.elevenLabs?.useOwnApiKey || false;
        
        const toggle = document.getElementById('useOwnApiKey');
        if (toggle) {
            toggle.checked = useOwnApi;
            toggleApiKeySource(); // Apply the toggle state to UI
        }
        
        // Load API key if using own API
        if (useOwnApi && company.aiSettings?.elevenLabs?.apiKey) {
            const apiKeyInput = document.getElementById('elevenlabsApiKey');
            if (apiKeyInput) {
                apiKeyInput.value = company.aiSettings.elevenLabs.apiKey;
            }
        }
        
        console.log('🔑 API toggle state loaded:', useOwnApi);
    } catch (error) {
        console.error('❌ Error loading API toggle state:', error);
    }
}

// =============================================
// PLATFORM FEATURES INITIALIZATION
// =============================================

function initializePlatformFeatures() {
    console.log('🔧 Initializing platform features...');
    
    // Initialize Enhanced Voice Settings
    initializeEnhancedVoiceSettings();
    
    // Initialize other platform features here as needed
    console.log('✅ Platform features initialized');
}

// =============================================
// HANDLE LANGUAGE CHANGE
// =============================================

/**
 * Handle language selection change
 */
function handleLanguageChange() {
    console.log('🌐 Language change detected');
    const languageSelect = document.getElementById('agent-language');
    if (languageSelect) {
        const selectedLanguage = languageSelect.value;
        console.log('Selected language:', selectedLanguage);
        setUnsavedChanges();
    }
}

// =============================================
// GLOBAL FUNCTION EXPOSURE FOR HTML HANDLERS
// =============================================

// Explicitly expose functions to global scope for HTML event handlers
window.filterVoices = filterVoices;
window.toggleApiKeySource = toggleApiKeySource;
window.handleVoiceChange = handleVoiceChange;
window.updateCheckboxValue = updateCheckboxValue;
window.handleTradeCategoryChange = handleTradeCategoryChange;
window.handleLanguageChange = handleLanguageChange;

console.log('🌐 Global functions exposed for HTML event handlers');
console.log('Available functions:', {
    filterVoices: typeof window.filterVoices,
    toggleApiKeySource: typeof window.toggleApiKeySource,
    handleVoiceChange: typeof window.handleVoiceChange,
    updateCheckboxValue: typeof window.updateCheckboxValue,
    handleTradeCategoryChange: typeof window.handleTradeCategoryChange,
    handleLanguageChange: typeof window.handleLanguageChange
});
