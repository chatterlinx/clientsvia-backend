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
        'bg-blue-100 border border-blue-400 text-blue-700'
    }`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
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
    
    // Load company data if ID is available
    if (companyId) {
        await fetchCompanyData();
    } else {
        showError('No company ID provided in URL');
    }
    
    // Initialize all components
    initializeEventListeners();
    
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
    
    // Header information - using actual API field names
    const companyNameHeader = document.getElementById('company-name-header');
    const companyIdSubheader = document.getElementById('company-id-subheader');
    
    if (companyNameHeader) {
        companyNameHeader.textContent = data.companyName || data.name || 'Unknown Company';
    }
    if (companyIdSubheader) {
        companyIdSubheader.textContent = `ID: ${data._id || 'Unknown'}`;
    }
    
    // Overview tab display elements
    const companyNameView = document.getElementById('company-name-view');
    const companyOwnerView = document.getElementById('company-owner-view');
    const companyOwnerEmailView = document.getElementById('company-owner-email-view');
    const companyOwnerPhoneView = document.getElementById('company-owner-phone-view');
    const companyContactNameView = document.getElementById('company-contact-name-view');
    const companyContactEmailView = document.getElementById('company-contact-email-view');
    const companyContactPhoneView = document.getElementById('company-contact-phone-view');
    const companyAddressView = document.getElementById('company-address-view');
    
    if (companyNameView) companyNameView.textContent = data.companyName || data.name || '';
    if (companyOwnerView) companyOwnerView.textContent = data.ownerName || '';
    if (companyOwnerEmailView) companyOwnerEmailView.textContent = data.ownerEmail || '';
    if (companyOwnerPhoneView) companyOwnerPhoneView.textContent = data.ownerPhone || '';
    if (companyContactNameView) companyContactNameView.textContent = data.contactName || '';
    if (companyContactEmailView) companyContactEmailView.textContent = data.contactEmail || '';
    if (companyContactPhoneView) companyContactPhoneView.textContent = data.contactPhone || '';
    
    // Address formatting
    if (companyAddressView && data.address) {
        const address = data.address;
        const fullAddress = [
            address.street,
            address.city,
            address.state,
            address.zip || address.zipCode,
            address.country
        ].filter(Boolean).join(', ');
        companyAddressView.textContent = fullAddress || 'No address provided';
    }
    
    // Basic company information - mapping API fields to form fields  
    if (window.companyNameInput) window.companyNameInput.value = data.companyName || data.name || '';
    if (window.companyEmailInput) window.companyEmailInput.value = data.email || data.ownerEmail || '';
    if (window.companyPhoneInput) window.companyPhoneInput.value = data.phone || data.ownerPhone || '';
    if (window.companyWebsiteInput) window.companyWebsiteInput.value = data.website || '';
    
    // Address information
    if (data.address) {
        if (window.addressStreetInput) window.addressStreetInput.value = data.address.street || '';
        if (window.addressCityInput) window.addressCityInput.value = data.address.city || '';
        if (window.addressStateInput) window.addressStateInput.value = data.address.state || '';
        if (window.addressZipInput) window.addressZipInput.value = data.address.zipCode || '';
        if (window.addressCountryInput) window.addressCountryInput.value = data.address.country || '';
    }
    
    // Populate agent personality responses
    populatePersonalityResponses(data.agentSetup?.personalityResponses || data.aiAgentSetup?.personalityResponses || {});
    
    // Populate trade categories
    populateTradeCategories(data.tradeTypes || []);
    
    console.log('✅ Company data populated successfully');
}

async function saveCompanyData() {
    try {
        console.log('💾 Saving company data...');
        
        const formData = {
            name: window.companyNameInput?.value || '',
            email: window.companyEmailInput?.value || '',
            phone: window.companyPhoneInput?.value || '',
            website: window.companyWebsiteInput?.value || '',
            address: {
                street: window.addressStreetInput?.value || '',
                city: window.addressCityInput?.value || '',
                state: window.addressStateInput?.value || '',
                zipCode: window.addressZipInput?.value || '',
                country: window.addressCountryInput?.value || ''
            }
        };
        
        const response = await fetch(`/api/company/${companyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        if (!response.ok) {
            throw new Error(`Save failed: ${response.statusText}`);
        }
        
        const updatedData = await response.json();
        currentCompanyData = { ...currentCompanyData, ...updatedData };
        
        clearUnsavedChanges();
        showNotification('Company data saved successfully!');
        
        console.log('✅ Company data saved successfully');
        
    } catch (error) {
        console.error('❌ Error saving company data:', error);
        showNotification('Failed to save company data', 'error');
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
    
    const select = document.getElementById('trade-category-select');
    if (!select) return;
    
    // Clear existing selections
    for (const option of select.options) {
        option.selected = false;
    }
    
    // Select the categories for this company
    selectedCategories.forEach(category => {
        for (const option of select.options) {
            if (option.value === category) {
                option.selected = true;
            }
        }
    });
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
// EVENT LISTENERS INITIALIZATION
// =============================================

function initializeEventListeners() {
    // Form change tracking
    document.addEventListener('input', (e) => {
        if (e.target.matches('input, textarea, select')) {
            setUnsavedChanges();
        }
    });
    
    // Save buttons
    const saveButtons = document.querySelectorAll('[onclick*="save"]');
    saveButtons.forEach(button => {
        button.addEventListener('click', clearUnsavedChanges);
    });
    
    // Load trade categories when needed
    if (document.getElementById('trade-category-select')) {
        loadTradeCategorySelector();
    }
    
    console.log('🎯 Event listeners initialized');
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
