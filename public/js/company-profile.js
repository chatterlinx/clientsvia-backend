// public/js/company-profile.js
// Final complete version, restoring all original functions and correctly integrating Calendar Settings.

document.addEventListener('DOMContentLoaded', () => {
    // --- TOP-LEVEL VARIABLES --- //
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');
    
    // Debug company ID loading
    console.log('🔍 Company Profile Debug:');
    console.log('- URL:', window.location.href);
    console.log('- URL Search Params:', window.location.search);
    console.log('- Extracted Company ID:', companyId);
    console.log('- Company ID type:', typeof companyId);
    console.log('- Company ID length:', companyId?.length);
    
    if (!companyId) {
        console.error('❌ NO COMPANY ID FOUND IN URL!');
        console.log('💡 Expected URL format: company-profile.html?id=COMPANY_ID');
    } else {
        console.log('✅ Company ID found:', companyId);
    }
    
    // Make companyId globally available for workflow management
    window.currentCompanyId = companyId;
    window.companyId = companyId; // Also set window.companyId for consistency with HTML script

    // --- UNSAVED CHANGES CODE START --- //
    let hasUnsavedChanges = false;
    window.addEventListener('beforeunload', (event) => {
        if (hasUnsavedChanges) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    function trackUnsavedChanges(formId) {
        const observer = new MutationObserver((mutationsList, obs) => {
            const form = document.getElementById(formId);
            if (form) {
                form.removeEventListener('input', setUnsavedChangesFlag); 
                form.addEventListener('input', setUnsavedChangesFlag);
                obs.disconnect(); 
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    const setUnsavedChangesFlag = () => { hasUnsavedChanges = true; };
    // --- UNSAVED CHANGES CODE END --- //

    // --- DOM ELEMENT REFERENCES --- //
    const companyNameHeader = document.getElementById('company-name-header');
    const companyIdSubheader = document.getElementById('company-id-subheader');
    const editProfileButton = document.getElementById('edit-profile-button');
    const companyStatusBadge = document.getElementById('company-status-badge');
    const companyDetailsView = document.getElementById('company-details-view');
    const viewCompanyName = document.getElementById('company-name-view');
    const viewCompanyOwner = document.getElementById('company-owner-view');
    const viewCompanyOwnerEmail = document.getElementById('company-owner-email-view');
    const viewCompanyOwnerPhone = document.getElementById('company-owner-phone-view');
    const viewCompanyContactName = document.getElementById('company-contact-name-view');
    const viewCompanyContactEmail = document.getElementById('company-contact-email-view');
    const viewCompanyContactPhone = document.getElementById('company-contact-phone-view');
    const viewCompanyAddress = document.getElementById('company-address-view');
    const companyDetailsEditFormContainer = document.getElementById('company-details-edit-form');
    const additionalContactsViewContainer = document.getElementById('additional-contacts-view-container');
    
    const configSettingsForm = document.getElementById('config-settings-form');
    const twilioAccountSidInput = document.getElementById('twilioAccountSid');
    const twilioAuthTokenInput = document.getElementById('twilioAuthToken');
    
    const newNoteTextarea = document.getElementById('new-note-textarea');
    const addNewNoteButton = document.getElementById('add-new-note-button');
    const notesDisplayArea = document.getElementById('notes-display-area');

    const personalityResponsesForm = document.getElementById('personality-responses-form');
    const personalityResponsesList = document.getElementById('personality-responses-list');
    
    const aiSettingsForm = document.getElementById('ai-settings-form');
    const llmFallbackEnabledCheckbox = document.getElementById('llmFallbackEnabled');
    const escalationMessageContainer = document.getElementById('escalationMessageContainer');
    const customEscalationMessageInput = document.getElementById('customEscalationMessage');

    // Calendar Settings Tab Elements
    const gcalStatusContainer = document.getElementById('gcal-status-container');
    const gcalCalendarsListContainer = document.getElementById('gcal-calendars-list-container');
    const gcalCalendarsList = document.getElementById('gcal-calendars-list');
    
    const agentSetupPageContainer = document.getElementById('agent-setup-content');
    const agentSetupForm = agentSetupPageContainer?.querySelector('#agent-setup-form');
    const agentModeSelect = agentSetupPageContainer?.querySelector('#agentModeSelect');
    const companySpecialtiesInputAgentSetup = agentSetupPageContainer?.querySelector('#companySpecialties');
    const timezoneSelectAgentSetup = agentSetupPageContainer?.querySelector('#agentSetupTimezoneSelect'); 
    const currentTimeDisplayAgentSetup = agentSetupPageContainer?.querySelector('#agentSetupCurrentTimeDisplay');
    const categoryQAsTextarea = agentSetupPageContainer?.querySelector('#categoryQAs');
    const companyQnaForm = agentSetupPageContainer?.querySelector('#companyQnaForm');
    const companyQnaQuestion = agentSetupPageContainer?.querySelector('#companyQnaQuestion');
    const companyQnaAnswer = agentSetupPageContainer?.querySelector('#companyQnaAnswer');
    const companyQnaKeywords = agentSetupPageContainer?.querySelector('#companyQnaKeywords');
    const companyQnaPreview = agentSetupPageContainer?.querySelector('#companyQnaPreview');
    const placeholderSelect = agentSetupPageContainer?.querySelector('#placeholderSelect');
    const insertPlaceholderBtn = agentSetupPageContainer?.querySelector('#insertPlaceholderBtn');
    const companyQnaSaveBtn = agentSetupPageContainer?.querySelector('#companyQnaSaveBtn');
    const companyQnaCancelBtn = agentSetupPageContainer?.querySelector('#companyQnaCancelBtn');
    const companyQnaList = agentSetupPageContainer?.querySelector('#companyQnaList');
    const companyQnaFormError = agentSetupPageContainer?.querySelector('#companyQnaFormError');

    function updateQnaSaveBtnState() {
        if (!companyQnaSaveBtn) return;
        const q = companyQnaQuestion?.value.trim();
        const a = companyQnaAnswer?.value.trim();
        companyQnaSaveBtn.disabled = !q || !a;
    }

    if (companyQnaQuestion) companyQnaQuestion.addEventListener('input', updateQnaSaveBtnState);
    if (companyQnaAnswer) {
        companyQnaAnswer.addEventListener('input', () => { updateQnaSaveBtnState(); updateAllPreviews(); });
    }
    const toggle24HoursCheckbox = agentSetupPageContainer?.querySelector('#toggle24Hours');
    const operatingHoursListContainer = agentSetupPageContainer?.querySelector('#operating-hours-list');
    const agentGreetingTextareaAgentSetup = agentSetupPageContainer?.querySelector('#agentGreeting');
    const greetingTypeTtsRadio = agentSetupPageContainer?.querySelector('#greetingTypeTTS');
    const greetingTypeAudioRadio = agentSetupPageContainer?.querySelector('#greetingTypeAudio');
    const greetingAudioFileInput = agentSetupPageContainer?.querySelector('#greetingAudioFile');
    const greetingAudioUploadContainer = agentSetupPageContainer?.querySelector('#greetingAudioUploadContainer');
    const greetingTextContainer = agentSetupPageContainer?.querySelector('#greetingTextContainer');
    const greetingAudioPreview = agentSetupPageContainer?.querySelector('#greetingAudioPreview');
    const mainAgentScriptTextarea = agentSetupPageContainer?.querySelector('#mainAgentScript');
    const agentClosingTextareaAgentSetup = agentSetupPageContainer?.querySelector('#agentClosing');
    
    const serviceSchedulingRulesContainer = agentSetupPageContainer?.querySelector('#serviceSchedulingRulesContainer'); 
    const addSchedulingRuleButton = agentSetupPageContainer?.querySelector('#add-new-scheduling-rule-btn'); 

    const callRoutingListContainer = agentSetupPageContainer?.querySelector('#call-routing-list');
    const afterHoursRoutingListContainer = agentSetupPageContainer?.querySelector('#after-hours-routing-list');
    const callSummariesListContainer = agentSetupPageContainer?.querySelector('#call-summaries-list');
    const afterHoursNotificationsListContainer = agentSetupPageContainer?.querySelector('#after-hours-notifications-list');
    const malfunctionForwardingListContainer = agentSetupPageContainer?.querySelector('#malfunction-forwarding-list');
    const malfunctionNotificationsListContainer = agentSetupPageContainer?.querySelector('#malfunction-notifications-list');
    const placeholdersListContainer = agentSetupPageContainer?.querySelector('#placeholders-list');
    const addPlaceholderBtn = agentSetupPageContainer?.querySelector('#add-placeholder-btn');
    const saveAgentSetupButton = agentSetupPageContainer?.querySelector('#save-agent-setup-button');

    const currentTimeDisplaySpan = agentSetupPageContainer?.querySelector('#current-time-display span'); 
    const schedulingInterpreterOutputDiv = agentSetupPageContainer?.querySelector('#scheduling-interpreter-output');


    // --- STATE AND DATA --- //
    let currentCompanyData = null;
    let availableTradeCategories = [];
    let availableGoogleCalendars = []; // To store fetched Google Calendars for use in scheduling rules
    let companyQnaListData = [];
    let uploadedGreetingAudioUrl = '';
    const daysOfWeekForOperatingHours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const ianaTimeZones = [
        { value: "America/New_York", label: "(GMT-05:00) Eastern Time (US & Canada)" }, { value: "America/Chicago", label: "(GMT-06:00) Central Time (US & Canada)" }, { value: "America/Denver", label: "(GMT-07:00) Mountain Time (US & Canada)" }, { value: "America/Los_Angeles", label: "(GMT-08:00) Pacific Time (US & Canada)" }, { value: "America/Phoenix", label: "(GMT-07:00) Arizona (MST - no DST)" }, { value: "America/Anchorage", label: "(GMT-09:00) Alaska" }, { value: "Pacific/Honolulu", label: "(GMT-10:00) Hawaii" }, { value: "Europe/London", label: "(GMT+00:00) London, Dublin, Lisbon" }, { value: "Europe/Berlin", label: "(GMT+01:00) Amsterdam, Berlin, Paris, Rome, Madrid" }, { value: "Europe/Moscow", label: "(GMT+03:00) Moscow, St. Petersburg" }, { value: "Asia/Dubai", label: "(GMT+04:00) Abu Dhabi, Muscat" }, { value: "Asia/Karachi", label: "(GMT+05:00) Islamabad, Karachi" }, { value: "Asia/Kolkata", label: "(GMT+05:30) Mumbai, New Delhi" }, { value: "Asia/Singapore", label: "(GMT+08:00) Singapore, Hong Kong, Beijing" }, { value: "Asia/Tokyo", label: "(GMT+09:00) Tokyo, Seoul" }, { value: "Australia/Sydney", label: "(GMT+10:00) Sydney, Melbourne, Canberra" }, { value: "Australia/Perth", label: "(GMT+08:00) Perth" }, { value: "Pacific/Auckland", label: "(GMT+12:00) Auckland, Wellington" }, { value: "Etc/GMT", label: "(GMT+00:00) Coordinated Universal Time (UTC)" }
    ];
    ianaTimeZones.sort((a, b) => a.label.localeCompare(b.label));
    const defaultProtocols = { /* This should be your full defaultProtocols object */ };

    // --- HELPER AND RENDER FUNCTIONS --- //
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, match => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
        })[match]);
    }
    
    function showToast(message, type = 'success', duration = 4000) {
        const toast = document.getElementById('toast-notification');
        if (!toast) return;
        toast.textContent = message;
        toast.className = `show ${type}`;
        setTimeout(() => {
            toast.className = toast.className.replace('show', '');
        }, duration);
    }

    function updateGreetingTypeUI() {
        const useAudio = greetingTypeAudioRadio?.checked;
        if (greetingAudioUploadContainer) greetingAudioUploadContainer.classList[useAudio ? 'remove' : 'add']('hidden');
        if (greetingTextContainer) greetingTextContainer.classList[useAudio ? 'add' : 'remove']('hidden');
    }

    function getCurrentPlaceholders() {
        const arr = [];
        if (!placeholdersListContainer) return arr;
        placeholdersListContainer.querySelectorAll('.dynamic-list-item').forEach(row => {
            const nameInput = row.querySelector('input[name^="placeholderName_"]');
            const valueInput = row.querySelector('input[name^="placeholderValue_"]');
            const name = nameInput?.value.trim();
            if (name) arr.push({ name, value: valueInput?.value || '' });
        });
        return arr;
    }

    function applyPlaceholdersToText(text, placeholders) {
        let result = text || '';
        (placeholders || []).forEach(ph => {
            // Handle double curly braces format {{AgentName}}
            const doubleRegex = new RegExp(`\\{\\{\\s*${ph.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\}}`, 'gi');
            result = result.replace(doubleRegex, ph.value || '');
            
            // Handle single curly braces format {AgentName}
            const singleRegex = new RegExp(`\\{\\s*${ph.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\}`, 'gi');
            result = result.replace(singleRegex, ph.value || '');
        });
        return result;
    }

    function updatePlaceholderSelectOptions() {
        if (!placeholderSelect) return;
        const placeholders = getCurrentPlaceholders();
        placeholderSelect.innerHTML = '';
        placeholders.forEach(ph => {
            const opt = document.createElement('option');
            opt.value = ph.name;
            opt.textContent = ph.name;
            placeholderSelect.appendChild(opt);
        });
    }

    function updateAllPreviews() {
        const placeholders = getCurrentPlaceholders();
        if (companyQnaPreview && companyQnaAnswer) {
            companyQnaPreview.textContent = applyPlaceholdersToText(companyQnaAnswer.value, placeholders);
        }
        if (personalityResponsesList) {
            personalityResponsesList.querySelectorAll('.response-item').forEach(item => {
                const input = item.querySelector('input.response-text');
                const preview = item.querySelector('.response-preview');
                if (input && preview) {
                    preview.textContent = applyPlaceholdersToText(input.value, placeholders);
                }
            });
        }
    }

    const handleDynamicItemRemove = (e) => {
        const itemToRemove = e.target.closest('.dynamic-list-item, .additional-contact-edit-block, .scheduling-rule-item'); 
        if (itemToRemove) {
            itemToRemove.remove();
            hasUnsavedChanges = true;
            if (itemToRemove.classList.contains('scheduling-rule-item')) {
                 refreshInterpreterForRule(serviceSchedulingRulesContainer?.querySelector('.scheduling-rule-item'));
            }
            if (itemToRemove.parentElement?.id === 'placeholders-list') {
                updatePlaceholderSelectOptions();
                updateAllPreviews();
            }
        }
    };
    
    function renderDynamicListItems(containerElem, dataArray, itemHtmlCallback, removeButtonClass) {
        if (!containerElem) return;
        containerElem.innerHTML = ''; 
        (dataArray || []).forEach((item, index) => {
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'dynamic-list-item'; 
            itemWrapper.innerHTML = itemHtmlCallback(index, item);
            
            const removeBtn = itemWrapper.querySelector(`.${removeButtonClass}`);
            if (removeBtn) {
                removeBtn.removeEventListener('click', handleDynamicItemRemove); 
                removeBtn.addEventListener('click', handleDynamicItemRemove);
            }
            containerElem.appendChild(itemWrapper);
        });
    }
    
    function collectDynamicListValues(containerId, nameInputNamePrefix, contactInputNamePrefix, itemStructureCallback) {
        const items = [];
        if (!agentSetupPageContainer) { 
            console.warn(`collectDynamicListValues: agentSetupPageContainer not found when trying to access ${containerId}`);
            return items;
        }
        const container = agentSetupPageContainer.querySelector(`#${containerId}`);
        if (!container) {
            return items;
        }
        container.querySelectorAll('.dynamic-list-item').forEach((row) => { 
            const nameInput = nameInputNamePrefix ? row.querySelector(`input[name^="${nameInputNamePrefix}"]`) : null;
            const contactInputEl = contactInputNamePrefix ? row.querySelector(`input[name^="${contactInputNamePrefix}"]`) : row.querySelector('input[type="text"], input[type="tel"], input[type="email"]');
            
            const nameVal = nameInput ? nameInput.value.trim() : undefined; 
            const contactVal = contactInputEl ? contactInputEl.value.trim() : '';

            if (itemStructureCallback) {
                const item = itemStructureCallback(nameVal, contactVal);
                if (item) { 
                    items.push(item);
                }
            }
        });
        return items;
    }

    function renderTradeCategories(categories, containerElement, savedCategories = []) {
        if (!containerElement) { console.warn("renderTradeCategories: containerElement not found"); return;}
        containerElement.innerHTML = '';
        if (!categories || categories.length === 0) {
            containerElement.innerHTML = '<p class="text-sm text-gray-500">Could not load trade categories.</p>';
            return;
        }
        categories.forEach(category => {
            const isChecked = savedCategories.includes(category.name);
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.className = 'flex items-center';
            const categoryIdSuffix = category._id || category.name.replace(/\s+/g, '-').toLowerCase();
            checkboxWrapper.innerHTML = `
                <input id="category-${categoryIdSuffix}" type="checkbox" name="category" value="${escapeHTML(category.name)}" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${isChecked ? 'checked' : ''}>
                <label for="category-${categoryIdSuffix}" class="ml-3 block text-sm font-medium text-gray-700">${escapeHTML(category.name)}</label>`;
            containerElement.appendChild(checkboxWrapper);
        });
    }

    function populateTimezoneDropdown() {
        if (!timezoneSelectAgentSetup) { console.warn("populateTimezoneDropdown: timezoneSelectAgentSetup not found"); return; }
        timezoneSelectAgentSetup.innerHTML = '';
        ianaTimeZones.forEach(tz => {
            const option = document.createElement('option');
            option.value = tz.value;
            option.textContent = tz.label;
            timezoneSelectAgentSetup.appendChild(option);
        });
    }

    async function loadAndDisplayCategoryQAs() {
        if (!agentSetupPageContainer || !categoryQAsTextarea) {
            if (categoryQAsTextarea) {
                categoryQAsTextarea.value = '';
                categoryQAsTextarea.placeholder = "Select business categories to view their Q&A scripts.";
            }
            return;
        }
        const selectedCategoryCheckboxes = agentSetupPageContainer.querySelectorAll('input[name="category"]:checked');
        const selectedCategoryNames = Array.from(selectedCategoryCheckboxes).map(cb => cb.value);
        if (selectedCategoryNames.length === 0) {
            categoryQAsTextarea.value = '';
            categoryQAsTextarea.placeholder = "Select one or more business categories to see their specific Q&A scripts here.";
            return;
        }
        categoryQAsTextarea.value = 'Loading Q&As...';
        categoryQAsTextarea.placeholder = 'Loading Q&As...';
        try {
            const qnaFetchPromises = selectedCategoryNames.map(name =>
                fetch(`/api/trade-categories/qas?categoryName=${encodeURIComponent(name)}`)
                .then(response => {
                    if (!response.ok) {
                        return response.json().catch(() => null).then(errData => {
                           const detail = errData?.message || response.statusText || `HTTP error ${response.status}`;
                           throw new Error(`Failed to fetch Q&A for '${name}': ${detail}`);
                        });
                    }
                    return response.json();
                })
                .catch(error => {
                    console.error(`Error fetching Q&A for '${name}':`, error.message);
                    return { categoryName: name, qnaText: `Error: Could not load Q&A for ${name}. (${error.message})`, error: true };
                })
            );
            const fetchedQAs = await Promise.all(qnaFetchPromises);
            let combinedQAText = "";
            fetchedQAs.forEach(item => {
                if (item && item.categoryName && item.qnaText) {
                    combinedQAText += `--- ${escapeHTML(item.categoryName)} Q&A ---\n`;
                    combinedQAText += `${escapeHTML(item.qnaText)}\n\n`;
                } else if (item && item.categoryName && item.error) {
                    combinedQAText += `--- ${escapeHTML(item.categoryName)} Q&A ---\n`;
                    combinedQAText += `${escapeHTML(item.qnaText)}\n\n`; 
                }
            });
            categoryQAsTextarea.value = combinedQAText.trim() || "No Q&A content found for the selected categories, or an error occurred.";
            if (!combinedQAText.trim()) {
                 categoryQAsTextarea.placeholder = "No Q&A content found for selected categories, or an error occurred during loading.";
            }
        } catch (error) {
            console.error("Overall error loading category Q&As:", error);
            categoryQAsTextarea.value = "Failed to load Q&A content due to a general error.";
            categoryQAsTextarea.placeholder = "Failed to load Q&A content.";
        }
    }

    async function fetchCompanyQnA() {
        if (!companyId || !companyQnaList) return;
        companyQnaList.innerHTML = '<p class="text-gray-500 italic">Loading...</p>';
        try {
            const res = await fetch(`/api/company/${companyId}/qna`);
            if (!res.ok) throw new Error('Failed to load Q&A');
            const data = await res.json();
            companyQnaListData = Array.isArray(data) ? data : [];
            renderCompanyQnA(companyQnaListData);
        } catch (err) {
            companyQnaList.innerHTML = `<p class="text-red-500">${err.message}</p>`;
        }
    }

    function renderCompanyQnA(entries) {
        if (!companyQnaList) return;
        companyQnaList.innerHTML = '';
        if (!entries || entries.length === 0) {
            companyQnaList.innerHTML = '<p class="text-gray-500 italic">No Q&A defined.</p>';
            return;
        }
        entries.forEach(e => {
            const row = document.createElement('div');
            row.className = 'flex items-start justify-between border p-3 rounded';
            const keywordsHTML = (e.keywords && e.keywords.length)
                ? `<div class="mt-1 text-xs text-gray-500">${e.keywords.map(k => `<span class='inline-block bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded mr-1'>${escapeHTML(k)}</span>`).join('')}</div>`
                : '';
            row.innerHTML =
                `<div class="flex-1"><p class="font-semibold">${escapeHTML(e.question)}</p>${keywordsHTML}</div>` +
                `<div class="flex-1 ml-4">${escapeHTML(e.answer)}</div>` +
                `<div class="ml-4 flex-none text-right"><button class="text-sm text-blue-600 mr-2" data-id="${e._id}" data-action="edit">Edit</button><button class="text-sm text-red-600" data-id="${e._id}" data-action="delete">Delete</button></div>`;
            companyQnaList.appendChild(row);
        });
        companyQnaList.querySelectorAll('button[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', () => startEditQna(btn.dataset.id));
        });
        companyQnaList.querySelectorAll('button[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => deleteQna(btn.dataset.id));
        });
    }

    function resetQnaForm() {
        if (!companyQnaForm) return;
        companyQnaForm.reset();
        companyQnaForm.dataset.editing = '';
        if (companyQnaCancelBtn) companyQnaCancelBtn.classList.add('hidden');
        if (companyQnaSaveBtn) companyQnaSaveBtn.textContent = 'Add';
        updateQnaSaveBtnState();
        if (companyQnaQuestion) companyQnaQuestion.focus();
    }

    function startEditQna(id) {
        const entry = (companyQnaListData || []).find(e => e._id === id);
        if (!entry) return;
        if (companyQnaQuestion) companyQnaQuestion.value = entry.question;
        if (companyQnaAnswer) companyQnaAnswer.value = entry.answer;
        if (companyQnaKeywords) companyQnaKeywords.value = (entry.keywords || []).join(', ');
        if (companyQnaForm) companyQnaForm.dataset.editing = id;
        if (companyQnaCancelBtn) companyQnaCancelBtn.classList.remove('hidden');
        if (companyQnaSaveBtn) companyQnaSaveBtn.textContent = 'Save';
        updateQnaSaveBtnState();
    }

    async function deleteQna(id) {
        if (!companyId) return;
        if (!confirm('Delete entry?')) return;
        const res = await fetch(`/api/company/${companyId}/qna/${id}`, { method: 'DELETE' });
        if (res.ok) {
            companyQnaListData = companyQnaListData.filter(e => e._id !== id);
            renderCompanyQnA(companyQnaListData);
        }
    }

    async function handleQnaSubmit(ev) {
        ev.preventDefault();
        if (!companyId) return;
        const q = companyQnaQuestion?.value.trim();
        const a = companyQnaAnswer?.value.trim();
        const k = companyQnaKeywords?.value.split(',').map(t => t.trim()).filter(Boolean);
        if (!q || !a) {
            updateQnaSaveBtnState();
            return;
        }
        const id = companyQnaForm?.dataset.editing;
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/company/${companyId}/qna/${id}` : `/api/company/${companyId}/qna`;
        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: q, answer: a, keywords: k })
            });
            if (!res.ok) throw new Error('Failed to save');
            const data = await res.json();
            if (method === 'POST') {
                companyQnaListData = Array.isArray(data) ? data : [];
            } else {
                if (id) {
                    const idx = companyQnaListData.findIndex(e => e._id === id);
                    if (idx !== -1) companyQnaListData[idx] = data;
                }
            }
            renderCompanyQnA(companyQnaListData);
            resetQnaForm();
            if (companyQnaFormError) companyQnaFormError.classList.add('hidden');
        } catch (err) {
            if (companyQnaFormError) {
                companyQnaFormError.textContent = 'Could not save Q&A. Please check all fields and try again.';
                companyQnaFormError.classList.remove('hidden');
            }
            console.error('Error saving Q&A', err);
        }
        updateQnaSaveBtnState();
    }
    
    async function fetchAvailableTradeCategories() {
        try {
            const response = await fetch('/api/trade-categories');
            if (!response.ok) throw new Error(`Failed to fetch trade categories (Status: ${response.status} ${response.statusText})`);
            availableTradeCategories = await response.json();
            const categoriesContainer = agentSetupPageContainer?.querySelector('#agentSetupCategoriesContainer');
            const savedCats = currentCompanyData?.agentSetup?.categories || (currentCompanyData?.tradeTypes || []);
            renderTradeCategories(availableTradeCategories, categoriesContainer, savedCats);
        } catch (error) {
            console.error('Error fetching trade categories:', error);
            availableTradeCategories = [];
            const categoriesContainer = agentSetupPageContainer?.querySelector('#agentSetupCategoriesContainer');
            if(categoriesContainer) categoriesContainer.innerHTML = `<p class="text-sm text-red-500">Error loading categories: ${error.message}</p>`;
        }
    }

    // Note: Google TTS functionality has been removed - using ElevenLabs only
    
    async function fetchCompanyData() {
        // Use local companyId if available, otherwise use global window.companyId
        const currentCompanyId = companyId || window.companyId;
        console.log('📡 fetchCompanyData called, companyId:', currentCompanyId);
        
        if (!currentCompanyId) {
            console.error('❌ fetchCompanyData: No company ID available');
            if (companyNameHeader) companyNameHeader.textContent = "Company Profile (No ID)";
            if (companyIdSubheader) companyIdSubheader.textContent = "ID: Not available";
            if (editProfileButton) editProfileButton.style.display = 'none';
            initializeAgentSetupInteractivity();
            populateAgentSetupForm({}, []);
            populatePersonalityResponses({});
            return;
        }
        
        console.log('🔍 Fetching company data for ID:', currentCompanyId);
        
        try {
            const response = await fetch(`/api/company/${currentCompanyId}`);
            if (!response.ok) {
                let errorResponseMessage = `HTTP error! Status: ${response.status} ${response.statusText}`;
                try { const errorData = await response.json(); errorResponseMessage = errorData.message || JSON.stringify(errorData); } catch (e) { /* Ignore parsing error if response not JSON */ }
                throw new Error(errorResponseMessage);
            }
            currentCompanyData = await response.json();
            
            console.log('✅ Company data fetched successfully:', currentCompanyData.name);
            console.log('[JS company-profile.js] Fetched currentCompanyData:', JSON.stringify(currentCompanyData, null, 2));
            
            currentCompanyData.address = currentCompanyData.address || {};
            currentCompanyData.additionalContacts = currentCompanyData.additionalContacts || [];
            currentCompanyData.notes = currentCompanyData.notes || [];
            currentCompanyData.twilioConfig = currentCompanyData.twilioConfig || {};
            currentCompanyData.aiSettings = currentCompanyData.aiSettings || {};
            currentCompanyData.agentSetup = currentCompanyData.agentSetup || {};
            currentCompanyData.integrations = currentCompanyData.integrations || {};
            currentCompanyData.integrations.googleOAuth = currentCompanyData.integrations.googleOAuth || {};
            
            currentCompanyData.agentSetup.agentMode = currentCompanyData.agentSetup.agentMode || 'full';
            currentCompanyData.agentSetup.categories = currentCompanyData.agentSetup.categories || (currentCompanyData.tradeTypes || []);
            currentCompanyData.agentSetup.timezone = currentCompanyData.agentSetup.timezone || currentCompanyData.timezone || 'America/New_York';
            currentCompanyData.tradeTypes = currentCompanyData.agentSetup.categories; 
            currentCompanyData.timezone = currentCompanyData.agentSetup.timezone; 
            currentCompanyData.agentSetup.companySpecialties = currentCompanyData.agentSetup.companySpecialties || '';
            currentCompanyData.agentSetup.operatingHours = currentCompanyData.agentSetup.operatingHours?.length === 7
                ? currentCompanyData.agentSetup.operatingHours
                : daysOfWeekForOperatingHours.map(day => ({ day: day, enabled: !['Saturday', 'Sunday'].includes(day), start: '09:00', end: '17:00' }));
            currentCompanyData.agentSetup.use247Routing = typeof currentCompanyData.agentSetup.use247Routing === 'boolean' ? currentCompanyData.agentSetup.use247Routing : false;
            currentCompanyData.agentSetup.protocols = { ...defaultProtocols, ...(currentCompanyData.agentSetup.protocols || {}) };
            currentCompanyData.agentSetup.textToPayPhoneSource = currentCompanyData.agentSetup.textToPayPhoneSource || 'callerID';
            currentCompanyData.agentSetup.schedulingRules = currentCompanyData.agentSetup.schedulingRules || []; 
            currentCompanyData.agentSetup.callRouting = currentCompanyData.agentSetup.callRouting || [];
            currentCompanyData.agentSetup.afterHoursRouting = currentCompanyData.agentSetup.afterHoursRouting || [];
            currentCompanyData.agentSetup.summaryRecipients = currentCompanyData.agentSetup.summaryRecipients || [];
            currentCompanyData.agentSetup.afterHoursRecipients = currentCompanyData.agentSetup.afterHoursRecipients || [];
            currentCompanyData.agentSetup.malfunctionForwarding = currentCompanyData.agentSetup.malfunctionForwarding || [];
            currentCompanyData.agentSetup.malfunctionRecipients = currentCompanyData.agentSetup.malfunctionRecipients || [];
            if (typeof currentCompanyData.isActive !== 'boolean') currentCompanyData.isActive = true;

            // Make company data globally available for other scripts
            window.currentCompanyData = currentCompanyData;

            await fetchAvailableTradeCategories();
            populateCompanyData(currentCompanyData); 
            updateCompanyStatusDisplay(currentCompanyData.isActive);
            populateConfigurationForm(currentCompanyData.twilioConfig);
            
            renderCalendarSettings(currentCompanyData);

            populateAiSettingsForm(currentCompanyData.aiSettings);
            populateAgentSetupForm(currentCompanyData.agentSetup, currentCompanyData.tradeTypes);
            // --- ADD THIS BLOCK TO POPULATE THE NEW VOICE TAB ---
            if (currentCompanyData) {
                const voiceSettings = {
                    ttsProvider: currentCompanyData.aiSettings?.ttsProvider || 'elevenlabs',
                    elevenlabsApiKey: currentCompanyData.aiSettings?.elevenLabs?.apiKey,
                    elevenlabsVoiceId: currentCompanyData.aiSettings?.elevenLabs?.voiceId,
                    elevenlabsStability: currentCompanyData.aiSettings?.elevenLabs?.stability,
                    elevenlabsClarity: currentCompanyData.aiSettings?.elevenLabs?.similarityBoost,
                    twilioSpeechConfidenceThreshold: currentCompanyData.aiSettings?.twilioSpeechConfidenceThreshold ?? 0.5,
                    fuzzyMatchThreshold: currentCompanyData.aiSettings?.fuzzyMatchThreshold ?? 0.3
                };
                // TODO: Implement populateAiVoiceSettings function if needed
                console.log('Voice settings prepared:', voiceSettings);
            }
            // --- END OF NEW BLOCK ---
            populatePersonalityResponses(currentCompanyData.personalityResponses || {});
            renderNotes();
            initializeAgentSetupInteractivity();
            
            // Initialize monitoring system after company data is loaded
            if (agentSetupPageContainer && currentCompanyData) {
                console.log('✅ Company data loaded successfully, initializing monitoring system for:', companyId);
                console.log('✅ Agent setup container found:', !!agentSetupPageContainer);
                console.log('✅ Company data available:', !!currentCompanyData);
                initializeMonitoringSystem();
            } else {
                console.warn('⚠️ Monitoring system NOT initialized:');
                console.warn('  - Agent setup container:', !!agentSetupPageContainer);
                console.warn('  - Company data:', !!currentCompanyData);
                console.warn('  - Company ID:', companyId);
            }
            
            // Initialize behavior engine configuration
            if (currentCompanyData && currentCompanyData.agentSetup && currentCompanyData.agentSetup.behaviors) {
                console.log('🧠 Initializing behavior configuration...');
                populateBehaviorConfiguration(currentCompanyData.agentSetup.behaviors);
            } else {
                console.log('🧠 No behavior configuration found, using defaults');
                populateBehaviorConfiguration({});
            }
        } catch (error) {
            console.error('Error fetching company data:', error.message, error.stack);
            if (companyNameHeader) companyNameHeader.textContent = "Error Loading Profile";
            if (companyIdSubheader) companyIdSubheader.textContent = `Error: ${error.message}`;
            document.querySelectorAll('#tab-content-area > .tab-content-item').forEach(tc => tc.innerHTML = `<p class="text-red-500 p-4">Failed to load company data: ${error.message}</p>`);
        }
    }

    // Expose fetchCompanyData globally so it can be called from the HTML DOMContentLoaded script
    window.fetchCompanyData = fetchCompanyData;

    function updateCompanyStatusDisplay(isActive) {
        if (companyStatusBadge) {
            companyStatusBadge.textContent = isActive ? 'Active' : 'Inactive';
            companyStatusBadge.className = `status-badge ${isActive ? 'status-active' : 'status-inactive'}`;
        } else {
            console.error('[JS company-profile.js] DEBUG: updateCompanyStatusDisplay - companyStatusBadge element not found!');
        }
    }

    function populateCompanyData(data) {
        if (!data) {
            console.error('[JS company-profile.js] DEBUG: populateCompanyData - No data provided!');
            return;
        }
    
        const overviewElements = {
            companyNameHeader: document.getElementById('company-name-header'),
            companyIdSubheader: document.getElementById('company-id-subheader'),
            viewCompanyName: document.getElementById('company-name-view'),
            viewCompanyOwner: document.getElementById('company-owner-view'),
            viewCompanyOwnerEmail: document.getElementById('company-owner-email-view'),
            viewCompanyOwnerPhone: document.getElementById('company-owner-phone-view'),
            viewCompanyContactName: document.getElementById('company-contact-name-view'),
            viewCompanyContactEmail: document.getElementById('company-contact-email-view'),
            viewCompanyContactPhone: document.getElementById('company-contact-phone-view'),
            viewCompanyAddress: document.getElementById('company-address-view'),
            additionalContactsViewContainer: document.getElementById('additional-contacts-view-container'),
            companyDetailsView: document.getElementById('company-details-view'),
            companyDetailsEditFormContainer: document.getElementById('company-details-edit-form'),
            editProfileButton: document.getElementById('edit-profile-button'),
            companyStatusBadge: document.getElementById('company-status-badge')
        };
    
        const setAndLog = (element, value, elementName) => {
            if (element) {
                element.textContent = value || 'N/A';
            } else {
                console.error(`[JS company-profile.js] DEBUG: ${elementName} element not found!`);
            }
        };
    
        setAndLog(overviewElements.companyNameHeader, data.companyName, 'companyNameHeader');
        setAndLog(overviewElements.companyIdSubheader, `ID: ${data._id || 'N/A'}`, 'companyIdSubheader');
        setAndLog(overviewElements.viewCompanyName, data.companyName, 'viewCompanyName');
        setAndLog(overviewElements.viewCompanyOwner, data.ownerName, 'viewCompanyOwner');
        setAndLog(overviewElements.viewCompanyOwnerEmail, data.ownerEmail, 'viewCompanyOwnerEmail');
        setAndLog(overviewElements.viewCompanyOwnerPhone, data.ownerPhone, 'viewCompanyOwnerPhone');
        setAndLog(overviewElements.viewCompanyContactName, data.contactName, 'viewCompanyContactName');
        setAndLog(overviewElements.viewCompanyContactEmail, data.contactEmail, 'viewCompanyContactEmail');
        setAndLog(overviewElements.viewCompanyContactPhone, data.contactPhone, 'viewCompanyContactPhone');
    
        if (overviewElements.viewCompanyAddress) {
            const addressString = data.address && (data.address.street || data.address.city || data.address.state || data.address.zip || data.address.country)
                ? `${data.address.street || ''}, ${data.address.city || ''}, ${data.address.state || ''} ${data.address.zip || ''}, ${data.address.country || ''}`.replace(/, ,/g, ',').replace(/^, |, $/g, '').trim().replace(/,$/, '') || 'N/A'
                : 'N/A';
            setAndLog(overviewElements.viewCompanyAddress, addressString, 'viewCompanyAddress');
        } else {
            console.error('[JS company-profile.js] DEBUG: viewCompanyAddress not found');
        }
        
        if (overviewElements.additionalContactsViewContainer) {
            overviewElements.additionalContactsViewContainer.innerHTML = '';
            if (data.additionalContacts && data.additionalContacts.length > 0) {
                const titleH3 = document.createElement('h3');
                titleH3.className = 'text-md font-semibold text-gray-700 pt-4 mt-4 border-t';
                titleH3.innerHTML = '<i class="fas fa-users mr-2 text-indigo-600"></i>Additional Contacts';
                overviewElements.additionalContactsViewContainer.appendChild(titleH3);
                data.additionalContacts.forEach(contact => {
                    const contactBlock = document.createElement('div');
                    contactBlock.className = 'contact-block-view';
                    contactBlock.innerHTML = `
                        <div class="detail-item"><span class="detail-label">Name:</span><span class="detail-value">${escapeHTML(contact.name || 'N/A')}</span></div>
                        <div class="detail-item"><span class="detail-label">Title:</span><span class="detail-value">${escapeHTML(contact.title || 'N/A')}</span></div>
                        <div class="detail-item"><span class="detail-label">Email:</span><span class="detail-value">${escapeHTML(contact.email || 'N/A')}</span></div>
                        <div class="detail-item"><span class="detail-label">Phone:</span><span class="detail-value">${escapeHTML(contact.phone || 'N/A')}</span></div>
                        <div class="detail-item"><span class="detail-label">Notes:</span><span class="detail-value whitespace-pre-wrap">${escapeHTML(contact.notes || 'N/A')}</span></div>
                    `;
                    overviewElements.additionalContactsViewContainer.appendChild(contactBlock);
                });
            }
        } else {
            console.error('[JS company-profile.js] DEBUG: additionalContactsViewContainer not found');
        }
    
        updateCompanyStatusDisplay(data.isActive); 
        
        if (overviewElements.companyDetailsView) overviewElements.companyDetailsView.classList.remove('hidden');
        else console.error('[JS company-profile.js] DEBUG: companyDetailsView not found');
    
        if (overviewElements.companyDetailsEditFormContainer) overviewElements.companyDetailsEditFormContainer.classList.add('hidden');
    
        if (overviewElements.editProfileButton) {
            overviewElements.editProfileButton.innerHTML = '<i class="fas fa-edit mr-2"></i>Edit Profile';
            overviewElements.editProfileButton.disabled = false;
        } else {
            console.error('[JS company-profile.js] DEBUG: editProfileButton not found');
        }
    }

    function showEditForm() {
        if (!currentCompanyData || !companyDetailsEditFormContainer) return;
        const isActiveChecked = typeof currentCompanyData.isActive === 'boolean' ? currentCompanyData.isActive : true;
        let additionalContactsEditHTML = '';
        (currentCompanyData.additionalContacts || []).forEach((contact) => {
            additionalContactsEditHTML += `
                <div class="additional-contact-edit-block p-4 border border-gray-300 rounded-lg mt-4 space-y-3 relative">
                    <button type="button" class="absolute top-2 right-2 text-red-500 hover:text-red-700 remove-additional-contact-btn"><i class="fas fa-times-circle"></i></button>
                    <h4 class="text-sm font-medium text-gray-600">Additional Contact</h4>
                    <div><label class="form-label">Name</label><input type="text" name="additionalContactName" class="form-input" value="${escapeHTML(contact.name || '')}"></div>
                    <div><label class="form-label">Title</label><input type="text" name="additionalContactTitle" class="form-input" value="${escapeHTML(contact.title || '')}"></div>
                    <div><label class="form-label">Email</label><input type="email" name="additionalContactEmail" class="form-input" value="${escapeHTML(contact.email || '')}"></div>
                    <div><label class="form-label">Phone</label><input type="tel" name="additionalContactPhone" class="form-input" value="${escapeHTML(contact.phone || '')}"></div>
                    <div><label class="form-label">Notes</label><textarea name="additionalContactNotes" rows="2" class="form-textarea">${escapeHTML(contact.notes || '')}</textarea></div>
                </div>`;
        });
        const formHTML = `
            <form id="actual-edit-company-form" class="space-y-4">
                <div><label for="editCompanyName" class="form-label">Company Name <span class="text-red-500">*</span></label><input type="text" name="companyName" id="editCompanyName" class="form-input" value="${escapeHTML(currentCompanyData.companyName || '')}" required></div>
                <h3 class="text-md font-semibold pt-2">Owner Information</h3>
                <div><label for="editOwnerName" class="form-label">Owner's Name <span class="text-red-500">*</span></label><input type="text" name="ownerName" id="editOwnerName" class="form-input" value="${escapeHTML(currentCompanyData.ownerName || '')}" required></div>
                <div><label for="editOwnerEmail" class="form-label">Owner's Email <span class="text-red-500">*</span></label><input type="email" name="ownerEmail" id="editOwnerEmail" class="form-input" value="${escapeHTML(currentCompanyData.ownerEmail || '')}" required></div>
                <div><label for="editOwnerPhone" class="form-label">Owner's Phone</label><input type="tel" name="ownerPhone" id="editOwnerPhone" class="form-input" value="${escapeHTML(currentCompanyData.ownerPhone || '')}"></div>
                <h3 class="text-md font-semibold pt-2">Primary Contact</h3>
                <div><label for="editContactName" class="form-label">Contact Name</label><input type="text" name="contactName" id="editContactName" class="form-input" value="${escapeHTML(currentCompanyData.contactName || '')}"></div>
                <div><label for="editContactEmail" class="form-label">Contact Email</label><input type="email" name="contactEmail" id="editContactEmail" class="form-input" value="${escapeHTML(currentCompanyData.contactEmail || '')}"></div>
                <div><label for="editContactPhone" class="form-label">Contact Phone <span class="text-red-500">*</span></label><input type="tel" name="contactPhone" id="editContactPhone" class="form-input" value="${escapeHTML(currentCompanyData.contactPhone || '')}" required></div>
                <div class="pt-4 border-t border-gray-200">
                    <h3 class="text-md font-semibold text-gray-700">Additional Contacts</h3>
                    <div id="additional-contacts-edit-container">${additionalContactsEditHTML}</div>
                    <button type="button" id="add-additional-contact-btn" class="mt-3 text-sm bg-blue-500 hover:bg-blue-600 text-white py-2 px-3 rounded-md flex items-center"><i class="fas fa-plus mr-2"></i>Add Another Contact</button>
                </div>
                <h3 class="text-md font-semibold pt-2">Company Address</h3>
                <div><label for="editAddressStreet" class="form-label">Street <span class="text-red-500">*</span></label><input type="text" name="addressStreet" id="editAddressStreet" class="form-input" value="${escapeHTML(currentCompanyData.address?.street || '')}" required></div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div><label for="editAddressCity" class="form-label">City <span class="text-red-500">*</span></label><input type="text" name="addressCity" id="editAddressCity" class="form-input" value="${escapeHTML(currentCompanyData.address?.city || '')}" required></div>
                    <div><label for="editAddressState" class="form-label">State <span class="text-red-500">*</span></label><input type="text" name="addressState" id="editAddressState" class="form-input" value="${escapeHTML(currentCompanyData.address?.state || '')}" required></div>
                    <div><label for="editAddressZip" class="form-label">Zip Code <span class="text-red-500">*</span></label><input type="text" name="addressZip" id="editAddressZip" class="form-input" value="${escapeHTML(currentCompanyData.address?.zip || '')}" required></div>
                </div>
                <div><label for="editAddressCountry" class="form-label">Country <span class="text-red-500">*</span></label><input type="text" name="addressCountry" id="editAddressCountry" class="form-input" value="${escapeHTML(currentCompanyData.address?.country || 'USA')}" required></div>
                <div class="mt-4 pt-4 border-t"><label class="flex items-center cursor-pointer"><input type="checkbox" name="isActive" id="editIsActive" class="form-checkbox h-5 w-5 text-indigo-600" ${isActiveChecked ? 'checked' : ''}><span class="ml-2 form-label !mt-0">Company is Active</span></label></div>
                <div class="mt-6 pt-4 border-t flex justify-end gap-3">
                    <button type="button" id="cancel-edit-button" class="bg-gray-300 hover:bg-gray-400 text-gray-700 font-semibold py-2 px-4 rounded-lg">Cancel</button>
                    <button type="submit" id="save-changes-button" class="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg">Save Changes</button>
                </div>
            </form>`;
        if (companyDetailsEditFormContainer) {
            companyDetailsEditFormContainer.innerHTML = formHTML;
            document.getElementById('actual-edit-company-form')?.addEventListener('submit', handleSaveChanges);
            document.getElementById('cancel-edit-button')?.addEventListener('click', hideEditForm);
            document.getElementById('add-additional-contact-btn')?.addEventListener('click', addAdditionalContactFieldBlock);
            companyDetailsEditFormContainer.querySelectorAll('.remove-additional-contact-btn').forEach(btn => {
                btn.addEventListener('click', handleDynamicItemRemove);
            });
            companyDetailsView?.classList.add('hidden');
            companyDetailsEditFormContainer.classList.remove('hidden');
            trackUnsavedChanges('actual-edit-company-form');
        }
        if (editProfileButton) editProfileButton.innerHTML = '<i class="fas fa-eye mr-2"></i>View Profile';
    }

    function addAdditionalContactFieldBlock() {
        const container = document.getElementById('additional-contacts-edit-container');
        if (!container) return;
        const contactBlockHTML = `
            <div class="additional-contact-edit-block p-4 border border-gray-300 rounded-lg mt-4 space-y-3 relative">
                <button type="button" class="absolute top-2 right-2 text-red-500 hover:text-red-700 remove-additional-contact-btn"><i class="fas fa-times-circle"></i></button>
                <h4 class="text-sm font-medium text-gray-600">New Additional Contact</h4>
                <div><label class="form-label">Name</label><input type="text" name="additionalContactName" class="form-input"></div>
                <div><label class="form-label">Title</label><input type="text" name="additionalContactTitle" class="form-input"></div>
                <div><label class="form-label">Email</label><input type="email" name="additionalContactEmail" class="form-input"></div>
                <div><label class="form-label">Phone</label><input type="tel" name="additionalContactPhone" class="form-input"></div>
                <div><label class="form-label">Notes</label><textarea name="additionalContactNotes" rows="2" class="form-textarea"></textarea></div>
            </div>`;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contactBlockHTML.trim();
        const newBlock = tempDiv.firstElementChild;
        if (newBlock) {
            newBlock.querySelector('.remove-additional-contact-btn')?.addEventListener('click', handleDynamicItemRemove);
            container.appendChild(newBlock);
            hasUnsavedChanges = true; 
        }
    }

    function hideEditForm() {
        if (companyDetailsEditFormContainer) {
            companyDetailsEditFormContainer.classList.add('hidden');
            companyDetailsEditFormContainer.innerHTML = '';
        }
        if (companyDetailsView) companyDetailsView.classList.remove('hidden');
        if (editProfileButton) editProfileButton.innerHTML = '<i class="fas fa-edit mr-2"></i>Edit Profile';
    }

    // --- Google Calendar Settings Tab Logic ---

    async function renderCalendarSettings(companyData) {
        if (!gcalStatusContainer) return;
    
        const gcal = companyData.integrations?.googleOAuth || {};
    
        if (gcal.isAuthorized) {
            gcalStatusContainer.innerHTML = `
                <div class="flex flex-col md:flex-row items-start md:items-center justify-between">
                    <div>
                        <div class="flex items-center">
                            <i class="fas fa-check-circle text-green-500 text-xl mr-3"></i>
                            <div>
                                <h3 class="font-semibold text-gray-800">Google Calendar Connected</h3>
                                <p class="text-sm text-gray-600">Connected as: <span class="font-medium text-indigo-600">${escapeHTML(gcal.googleAccountEmail)}</span></p>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3 md:mt-0">
                        <button id="disconnect-google-calendar-btn" class="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-150 ease-in-out flex items-center">
                            <i class="fas fa-unlink mr-2"></i>Disconnect
                        </button>
                    </div>
                </div>
            `;
            gcalCalendarsListContainer?.classList.remove('hidden');
            fetchAndRenderCalendarList();
    
            document.getElementById('disconnect-google-calendar-btn')?.addEventListener('click', handleDisconnectGoogleCalendar);
        } else {
            let errorMessageHTML = '';
            if (gcal.lastAuthError) {
                errorMessageHTML = `<p class="text-sm text-red-600 mt-2"><i class="fas fa-exclamation-triangle mr-1"></i>Last Error: ${escapeHTML(gcal.lastAuthError)}</p>`;
            }
            gcalStatusContainer.innerHTML = `
                 <div class="flex flex-col md:flex-row items-start md:items-center justify-between">
                    <div>
                        <div class="flex items-center">
                            <i class="fas fa-times-circle text-gray-400 text-xl mr-3"></i>
                            <div>
                                <h3 class="font-semibold text-gray-800">Google Calendar Not Connected</h3>
                                <p class="text-sm text-gray-600">Connect a Google account to allow the AI agent to read calendar availability and create events.</p>
                                ${errorMessageHTML}
                            </div>
                        </div>
                    </div>
                    <div class="mt-3 md:mt-0">
                        <button id="connect-google-calendar-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-150 ease-in-out flex items-center">
                           <i class="fab fa-google mr-2"></i>Connect Google Calendar
                        </button>
                    </div>
                </div>
            `;
            gcalCalendarsListContainer?.classList.add('hidden');
            if(gcalCalendarsList) gcalCalendarsList.innerHTML = ''; 
            availableGoogleCalendars = [];
    
            document.getElementById('connect-google-calendar-btn')?.addEventListener('click', handleConnectGoogleCalendar);
        }
    }
    
    function handleConnectGoogleCalendar() {
        if (!companyId) {
            showToast('Company ID is missing. Cannot start authorization.', 'error');
            return;
        }
        window.location.href = `/api/company/${companyId}/google-calendar/authorize`;
    }

    async function handleDisconnectGoogleCalendar() {
        if (!companyId) {
            showToast('Company ID is missing.', 'error');
            return;
        }
        if (!window.confirm('Are you sure you want to disconnect your Google Calendar? This will prevent the AI from scheduling appointments.')) {
            return;
        }

        try {
            const response = await fetch(`/api/company/${companyId}/google-calendar/disconnect`, { method: 'POST' });
            if (!response.ok) {
                const err = await response.json().catch(() => ({ message: 'An unknown error occurred.' }));
                throw new Error(err.message);
            }
            showToast('Google Calendar disconnected successfully.', 'success');
            await fetchCompanyData();
        } catch (error) {
            console.error('Error disconnecting Google Calendar:', error);
            showToast(`Disconnect failed: ${error.message}`, 'error');
        }
    }
    
    async function fetchAndRenderCalendarList() {
        if (!gcalCalendarsList) return;
        gcalCalendarsList.innerHTML = `<p class="text-gray-500">Loading calendars...</p>`;
        try {
            const response = await fetch(`/api/company/${companyId}/google-calendars/list`);
            if (!response.ok) {
                const err = await response.json().catch(() => ({ message: 'Could not fetch calendars.'}));
                throw new Error(err.message);
            }
            const calendars = await response.json();
            availableGoogleCalendars = calendars;
            
            if (calendars.length === 0) {
                 gcalCalendarsList.innerHTML = `<p class="text-gray-500 italic">No calendars with write-access found in the connected Google account.</p>`;
                 return;
            }
            
            gcalCalendarsList.innerHTML = calendars.map(cal => `
                <div class="p-3 border-b border-gray-200 last:border-b-0 flex items-center justify-between">
                    <div>
                        <p class="font-medium text-gray-800">${escapeHTML(cal.summary)} ${cal.primary ? '<span class="text-xs bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full ml-2">Primary</span>' : ''}</p>
                        <p class="text-xs text-gray-500">${escapeHTML(cal.id)}</p>
                    </div>
                    <div class="text-sm text-gray-600">${escapeHTML(cal.timeZone)}</div>
                </div>
            `).join('');

        } catch(error) {
            console.error('Failed to fetch calendar list:', error);
            gcalCalendarsList.innerHTML = `<p class="text-red-500">Error loading calendars: ${error.message}</p>`;
            availableGoogleCalendars = [];
        }
    }
    
    function checkForGoogleAuthStatusInURL() {
        const params = new URLSearchParams(window.location.search);
        const success = params.get('googleAuthSuccess');
        const error = params.get('googleAuthError');

        if (success) {
            showToast('Google Calendar connected successfully!', 'success');
        }
        if (error) {
            showToast(`Google Calendar connection failed: ${error}`, 'error', 6000);
        }

        if (success || error) {
            const newParams = new URLSearchParams(window.location.search);
            newParams.delete('googleAuthSuccess');
            newParams.delete('googleAuthError');
            const newUrl = `${window.location.pathname}?${newParams.toString()}`;
            window.history.replaceState({}, document.title, newUrl);
        }
    }


    function populateAiSettingsForm(aiSettings = {}) {
        if (!aiSettingsForm) return;
        const form = aiSettingsForm;
        if (form.elements.aiModel) form.elements.aiModel.value = aiSettings.model || 'gemini-2.5-flash';
        if (form.elements.aiCorePersonality) form.elements.aiCorePersonality.value = aiSettings.personality || 'friendly';
        if (form.elements.knowledgeBaseSource) form.elements.knowledgeBaseSource.value = aiSettings.knowledgeBaseSource || '';
        if (form.elements.sentimentAnalysis) form.elements.sentimentAnalysis.checked = !!aiSettings.sentimentAnalysis;
        if (form.elements.dataLogging) form.elements.dataLogging.checked = typeof aiSettings.dataLogging === 'boolean' ? aiSettings.dataLogging : true;
        if (llmFallbackEnabledCheckbox) {
            llmFallbackEnabledCheckbox.checked = !!aiSettings.llmFallbackEnabled;
        }
        if (customEscalationMessageInput) {
            customEscalationMessageInput.value = aiSettings.customEscalationMessage || '';
        }
        if (escalationMessageContainer && llmFallbackEnabledCheckbox) {
            escalationMessageContainer.style.display = llmFallbackEnabledCheckbox.checked ? 'none' : 'block';
        }
    }

    function populateConfigurationForm(twilioConfig = {}) {
        if (!configSettingsForm) return;
        if (twilioAccountSidInput) twilioAccountSidInput.value = twilioConfig.accountSid || '';
        if (twilioAuthTokenInput) twilioAuthTokenInput.value = twilioConfig.authToken || '';
        
        // Handle backward compatibility and populate phone numbers
        populatePhoneNumbers(twilioConfig);
    }

    function populatePhoneNumbers(twilioConfig) {
        const phoneNumbersList = document.getElementById('phoneNumbersList');
        if (!phoneNumbersList) return;

        // Clear existing phone numbers except the first (template) one
        const phoneItems = phoneNumbersList.querySelectorAll('.phone-number-item');
        phoneItems.forEach((item, index) => {
            if (index > 0) item.remove(); // Keep first item as template
        });

        let phoneNumbers = [];
        
        // Check if we have new format (multiple phone numbers)
        if (twilioConfig.phoneNumbers && twilioConfig.phoneNumbers.length > 0) {
            phoneNumbers = twilioConfig.phoneNumbers;
        } 
        // Handle backward compatibility with single phone number
        else if (twilioConfig.phoneNumber) {
            phoneNumbers = [{
                phoneNumber: twilioConfig.phoneNumber,
                friendlyName: 'Primary Number',
                status: 'active',
                isPrimary: true
            }];
        }

        // Populate the first item with primary number or first number
        const firstItem = phoneNumbersList.querySelector('.phone-number-item');
        if (firstItem && phoneNumbers.length > 0) {
            const primaryNumber = phoneNumbers.find(p => p.isPrimary) || phoneNumbers[0];
            const phoneInput = firstItem.querySelector('input[name="phoneNumber"]');
            const nameInput = firstItem.querySelector('input[name="friendlyName"]');
            const statusSelect = firstItem.querySelector('select[name="status"]');
            
            if (phoneInput) phoneInput.value = primaryNumber.phoneNumber || '';
            if (nameInput) nameInput.value = primaryNumber.friendlyName || 'Primary Number';
            if (statusSelect) statusSelect.value = primaryNumber.status || 'active';
            
            // Set primary badge
            const badge = firstItem.querySelector('.bg-blue-100.text-blue-800');
            if (badge && primaryNumber.isPrimary) {
                badge.textContent = 'Primary';
                badge.onclick = null;
            }
        }

        // Add additional phone numbers
        phoneNumbers.slice(1).forEach(phone => {
            addPhoneNumberWithData(phone);
        });

        // Update AI Agent Setup options
        setTimeout(() => {
            if (typeof updateAIAgentPhoneOptions === 'function') {
                updateAIAgentPhoneOptions();
            }
        }, 100);
    }

    function addPhoneNumberWithData(phoneData) {
        const phoneNumbersList = document.getElementById('phoneNumbersList');
        const template = document.getElementById('phoneNumberTemplate');
        
        if (template && phoneNumbersList) {
            const clone = template.content.cloneNode(true);
            const phoneInput = clone.querySelector('input[name="phoneNumber"]');
            const nameInput = clone.querySelector('input[name="friendlyName"]');
            const statusSelect = clone.querySelector('select[name="status"]');
            
            if (phoneInput) phoneInput.value = phoneData.phoneNumber || '';
            if (nameInput) nameInput.value = phoneData.friendlyName || '';
            if (statusSelect) statusSelect.value = phoneData.status || 'active';
            
            phoneNumbersList.appendChild(clone);
            
            // Set primary badge if needed
            if (phoneData.isPrimary) {
                const addedItem = phoneNumbersList.lastElementChild;
                const setPrimaryBtn = addedItem.querySelector('button[onclick*="setPrimaryNumber"]');
                if (setPrimaryBtn) {
                    setPrimaryBtn.textContent = 'Primary';
                    setPrimaryBtn.className = 'bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full';
                    setPrimaryBtn.onclick = null;
                }
            }
        }
    }

    function renderNotes() {
        if (!notesDisplayArea || !currentCompanyData) return;
        notesDisplayArea.innerHTML = '';
        const notes = currentCompanyData.notes || [];
        if (notes.length === 0) {
            notesDisplayArea.innerHTML = '<p class="text-gray-500 italic text-center py-4">No notes yet.</p>';
            return;
        }
        const sortedNotes = [...notes].sort((a, b) => (a.isPinned === b.isPinned) ? (new Date(b.createdAt) - new Date(a.createdAt)) : a.isPinned ? -1 : 1);
        sortedNotes.forEach(note => {
            const card = document.createElement('div');
            card.className = `note-card ${note.isPinned ? 'pinned' : ''}`;
            card.dataset.noteId = note._id;
            let ts = `Created: ${new Date(note.createdAt).toLocaleString()}`;
            if (note.updatedAt && new Date(note.updatedAt).getTime() !== new Date(note.createdAt).getTime()) {
                ts += `<br>Edited: ${new Date(note.updatedAt).toLocaleString()}`;
            }
            card.innerHTML = `
                <div class="note-content">${escapeHTML(note.text)}</div>
                <div class="note-timestamps">${ts}</div>
                <div class="note-actions">
                    <button class="note-action-button edit-note-btn"><i class="fas fa-edit mr-1"></i>Edit</button>
                    <button class="note-action-button pin-note-btn"><i class="fas fa-thumbtack mr-1 ${note.isPinned ? 'pinned-icon' : ''}"></i>${note.isPinned ? 'Unpin' : 'Pin'}</button>
                    <button class="note-action-button delete-note-btn"><i class="fas fa-trash-alt mr-1"></i>Delete</button>
                </div>
                <div class="edit-area hidden mt-2">
                    <textarea class="notes-textarea existing-note-edit-area wider-textbox" rows="4">${escapeHTML(note.text)}</textarea>
                    <div class="mt-2 flex justify-end gap-2">
                        <button class="text-xs bg-gray-300 hover:bg-gray-400 text-gray-700 py-1 px-3 rounded cancel-edit-btn">Cancel</button>
                        <button class="text-xs bg-green-500 hover:bg-green-600 text-white py-1 px-3 rounded save-edit-btn">Save Edit</button>
                    </div>
                </div>`;
            notesDisplayArea.appendChild(card);
        });
        attachNoteActionListeners();
    }

    function attachNoteActionListeners() {
        document.querySelectorAll('.edit-note-btn').forEach(b => { b.removeEventListener('click', handleToggleEditNote); b.addEventListener('click', handleToggleEditNote); });
        document.querySelectorAll('.pin-note-btn').forEach(b => { b.removeEventListener('click', handlePinNote); b.addEventListener('click', handlePinNote); });
        document.querySelectorAll('.delete-note-btn').forEach(b => { b.removeEventListener('click', handleDeleteNote); b.addEventListener('click', handleDeleteNote); });
        document.querySelectorAll('.save-edit-btn').forEach(b => { b.removeEventListener('click', handleSaveNoteEdit); b.addEventListener('click', handleSaveNoteEdit); });
        document.querySelectorAll('.cancel-edit-btn').forEach(b => { b.removeEventListener('click', handleToggleEditNote); b.addEventListener('click', handleToggleEditNote); });
    }

    const personalityCategories = [
        { key: 'cantUnderstand', description: 'Used when the caller cannot be understood.' },
        { key: 'speakClearly', description: 'Prompts the caller to speak more clearly.' },
        { key: 'outOfCategory', description: 'Triggered when a question is outside defined categories.' },
        { key: 'transferToRep', description: 'Said before transferring to a live representative.' },
        { key: 'calendarHesitation', description: 'When the caller hesitates to book an appointment.' },
        { key: 'businessClosed', description: 'Goodbye phrases when the business is closed.' },
        { key: 'frustratedCaller', description: 'Used for calming a frustrated caller.' },
        { key: 'businessHours', description: 'Explains normal business hours.' },
        { key: 'connectionTrouble', description: 'Used when call quality is poor.' },
        { key: 'agentNotUnderstood', description: 'Agent was not understood by the caller.' },
        
        // NEW: Professional Humor & Engagement Categories
        { key: 'lightHumor', description: 'Professional humor responses to keep calls engaging.' },
        { key: 'customerJoke', description: 'Responses when customers make jokes or are playful.' },
        { key: 'weatherSmallTalk', description: 'Engaging responses to weather or small talk comments.' },
        { key: 'complimentResponse', description: 'Professional responses to customer compliments.' },
        { key: 'casualGreeting', description: 'Warm, casual greeting variations for friendly tone.' },
        { key: 'empathyResponse', description: 'Empathetic responses showing understanding of customer pain points.' }
    ];

    function createResponseItem(text = '') {
        const item = document.createElement('div');
        item.className = 'flex items-center gap-2 response-item';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input flex-1 response-text';
        input.value = text;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-response-btn text-red-600 text-xs';
        remove.innerHTML = '<i class="fas fa-times"></i>';
        item.appendChild(input);
        item.appendChild(remove);
        return item;
    }

    function populatePersonalityResponses(responses = {}) {
        if (!personalityResponsesList) return;
        personalityResponsesList.innerHTML = '';
        personalityCategories.forEach(({ key, description }) => {
            const card = document.createElement('div');
            card.className = 'bg-white p-4 rounded shadow-sm space-y-2';
            card.dataset.category = key;
            const header = document.createElement('div');
            header.className = 'flex justify-between items-center';
            const title = document.createElement('h3');
            title.className = 'font-semibold';
            title.textContent = key;
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'add-response-btn text-blue-600 text-sm';
            addBtn.innerHTML = '<i class="fas fa-plus-circle mr-1"></i>Add';
            header.appendChild(title);
            header.appendChild(addBtn);
            const desc = document.createElement('p');
            desc.className = 'text-xs text-gray-500';
            desc.textContent = description;
            const list = document.createElement('div');
            list.className = 'space-y-2 response-list';
            (responses[key] || []).forEach(r => list.appendChild(createResponseItem(r)));
            card.appendChild(header);
            card.appendChild(desc);
            card.appendChild(list);
            personalityResponsesList.appendChild(card);
        });
    }

    if (personalityResponsesList) {
        personalityResponsesList.addEventListener('click', (e) => {
            if (e.target.closest('.add-response-btn')) {
                const card = e.target.closest('[data-category]');
                if (card) {
                    const list = card.querySelector('.response-list');
                    list.appendChild(createResponseItem(''));
                }
            } else if (e.target.closest('.remove-response-btn')) {
                const item = e.target.closest('.response-item');
                if (item) item.remove();
            }
        });
    }

    async function handleSavePersonalityResponses(event) {
        event.preventDefault();
        if (!companyId || !personalityResponsesForm) return;
        const data = {};
        personalityResponsesList.querySelectorAll('[data-category]').forEach(card => {
            const cat = card.dataset.category;
            const values = Array.from(card.querySelectorAll('input.response-text'))
                .map(i => i.value.trim())
                .filter(Boolean);
            data[cat] = values;
        });
        const btn = personalityResponsesForm.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }
        try {
            const res = await fetch(`/api/company/${companyId}/personality-responses`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personalityResponses: data }) });
            if (!res.ok) { const err = await res.json().catch(() => ({ message: 'Failed to save responses' })); throw new Error(err.message); }
            const updated = await res.json();
            currentCompanyData.personalityResponses = updated.personalityResponses || {};
            populatePersonalityResponses(currentCompanyData.personalityResponses);
            hasUnsavedChanges = false;
            alert('Personality responses saved!');
        } catch (e) {
            alert(`Error saving responses: ${e.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Responses'; }
        }
    }

    async function handleAddNewNote() {
        if (!newNoteTextarea || !companyId) return;
        const text = newNoteTextarea.value.trim();
        if (!text) { console.warn("Note cannot be empty."); return; }
        const btn = addNewNoteButton;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...'; }
        try {
            const res = await fetch(`/api/company/${companyId}/notes`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, isPinned: false })
            });
            if (!res.ok) { const err = await res.json().catch(() => ({ message: `Failed to add note. Status: ${res.status}` })); throw new Error(err.message); }
            const saved = await res.json();
            currentCompanyData.notes = [saved, ...(currentCompanyData.notes || [])];
            newNoteTextarea.value = '';
            renderNotes();
            alert('Note added successfully!');
        } catch (e) {
            console.error("Error adding note:", e); 
            alert(`Failed to add note: ${e.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus-circle mr-2"></i>Add Note'; }
        }
    }

    function handleToggleEditNote(event) {
        const card = event.target.closest('.note-card');
        if (!card) return;
        const editArea = card.querySelector('.edit-area');
        const noteContent = card.querySelector('.note-content');
        const noteActions = card.querySelector('.note-actions');
        if (!editArea || !noteContent || !noteActions) return;
        const isEditing = !editArea.classList.contains('hidden');
        editArea.classList.toggle('hidden', isEditing);
        noteContent.classList.toggle('hidden', !isEditing);
        noteActions.classList.toggle('hidden', !isEditing);
        if (!isEditing) {
            const noteId = card.dataset.noteId;
            const note = currentCompanyData.notes.find(n => (n._id || n.id) === noteId);
            const textarea = editArea.querySelector('textarea');
            if (note && textarea) textarea.value = note.text;
            textarea?.focus();
        }
    }
    async function handleSaveNoteEdit(event) {
        const card = event.target.closest('.note-card');
        if(!card) return;
        const noteId = card.dataset.noteId;
        const textarea = card.querySelector('.existing-note-edit-area');
        if(!textarea) return;
        const newText = textarea.value.trim();
        const saveButton = event.target;
        saveButton.disabled = true; saveButton.textContent = 'Saving...';
        try {
            const res = await fetch(`/api/company/${companyId}/notes/${noteId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: newText })
            });
            if (!res.ok) { const err = await res.json().catch(() => ({ message: `Failed to update note. Status: ${res.status}` })); throw new Error(err.message); }
            const updatedNote = await res.json();
            const noteIndex = currentCompanyData.notes.findIndex(n => (n._id || n.id) === noteId);
            if (noteIndex > -1) currentCompanyData.notes[noteIndex] = updatedNote;
            renderNotes();
            alert('Note updated successfully!');
        } catch (e) {
            console.error("Error updating note:", e); 
            alert(`Failed to update note: ${e.message}`);
        } finally {
            if (card.contains(saveButton)) { saveButton.disabled = false; saveButton.textContent = 'Save Edit';}
        }
    }
    async function handlePinNote(event) {
        const card = event.target.closest('.note-card');
        if(!card) return;
        const noteId = card.dataset.noteId;
        const noteIndex = currentCompanyData.notes.findIndex(n => (n._id || n.id) === noteId);
        if (noteIndex > -1) {
            const newPinStatus = !currentCompanyData.notes[noteIndex].isPinned;
            try {
                const res = await fetch(`/api/company/${companyId}/notes/${noteId}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPinned: newPinStatus })
                });
                if (!res.ok) { const err = await res.json().catch(() => ({ message: `Failed to update pin status. Status: ${res.status}` })); throw new Error(err.message); }
                const updatedNote = await res.json();
                currentCompanyData.notes[noteIndex] = updatedNote;
                renderNotes();
                alert(`Note ${newPinStatus ? 'pinned' : 'unpinned'} successfully!`);
            } catch (e) {
                console.error("Error pinning note:", e); 
                alert(`Failed to update pin status: ${e.message}`);
            }
        }
    }
    async function handleDeleteNote(event) {
        const card = event.target.closest('.note-card');
        if(!card) return;
        const noteId = card.dataset.noteId;
        const noteToDelete = currentCompanyData.notes.find(n => (n._id || n.id) === noteId);
        if (!noteToDelete) return;
        const userConfirmed = window.confirm(`Are you sure you want to delete this note: "${escapeHTML(noteToDelete.text.substring(0, 30))}..."?`);
        if (!userConfirmed) return;
        const deleteButton = event.currentTarget;
        if (deleteButton) { deleteButton.disabled = true; deleteButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
        try {
            const res = await fetch(`/api/company/${companyId}/notes/${noteId}`, { method: 'DELETE' });
            if (!res.ok) { const err = await res.json().catch(() => ({message: `Failed to delete note. Status: ${res.status}`})); throw new Error(err.message); }
            currentCompanyData.notes = currentCompanyData.notes.filter(n => (n._id || n.id) !== noteId);
            renderNotes();
            alert('Note deleted successfully!');
        } catch (e) {
            console.error("Error deleting note:", e); 
            alert(`Failed to delete note: ${e.message}`);
        } finally {
            if (deleteButton && deleteButton.parentElement) { 
                deleteButton.disabled = false; deleteButton.innerHTML = '<i class="fas fa-trash-alt mr-1.5"></i>Delete'; 
            }
        }
    }
    
    // --- MODIFIED: Service Scheduling Rules UI Logic (with GoogleCalendarId dropdown) ---
    function createSchedulingRuleHTML(rule = {}, ruleIndex = Date.now()) {
        const defaultRuleData = { 
            serviceName: '',
            schedulingType: 'immediate',
            futureBookingLeadDays: 7,
            dailyServiceHours: daysOfWeekForOperatingHours.map(day => ({ day: day, enabled: !['Saturday', 'Sunday'].includes(day), startTime: '08:00', endTime: '17:00' })),
            sameDayCutoffTime: '18:00',
            appointmentSlotIncrementMinutes: 60,
            roundTo: 'hour',
            initialBufferMinutes: 120,
            searchCalendar: 'next',
            googleCalendarId: rule.googleCalendarId || '', 
            ...rule 
        };

        let dailyHoursHTML = '<div class="scheduling-rule-daily-hours-header"><span>Day</span><span class="text-center">Enabled</span><span>Start Time</span><span>End Time</span></div>';
        defaultRuleData.dailyServiceHours.forEach(daySetting => {
            const dayLC = daySetting.day.toLowerCase().replace(/\s+/g, '');
            const idPrefix = `rule_${ruleIndex}_${dayLC}`;
            dailyHoursHTML += `
                <div class="grid grid-cols-4 gap-x-3 items-center rule-daily-hours-row py-1">
                    <label class="form-label self-center" for="${idPrefix}_enabled">${daySetting.day}</label>
                    <input type="checkbox" id="${idPrefix}_enabled" name="ruleDayEnabled_${ruleIndex}_${dayLC}" data-day="${daySetting.day}" class="form-checkbox justify-self-center rule-day-enabled" ${daySetting.enabled ? 'checked' : ''}>
                    <input type="time" id="${idPrefix}_startTime" name="ruleDayStartTime_${ruleIndex}_${dayLC}" data-day="${daySetting.day}" class="form-input rule-day-start-time text-xs p-1" value="${daySetting.startTime || '08:00'}">
                    <input type="time" id="${idPrefix}_endTime" name="ruleDayEndTime_${ruleIndex}_${dayLC}" data-day="${daySetting.day}" class="form-input rule-day-end-time text-xs p-1" value="${daySetting.endTime || '17:00'}">
                </div>
            `;
        });
        
        let calendarOptionsHTML = '<option value="">None (Use Agent Only)</option>';
        if (availableGoogleCalendars.length > 0) {
            calendarOptionsHTML += availableGoogleCalendars.map(cal => 
                `<option value="${escapeHTML(cal.id)}" ${defaultRuleData.googleCalendarId === cal.id ? 'selected' : ''}>${escapeHTML(cal.summary)}</option>`
            ).join('');
        }

        return `
            <div class="p-4 border border-gray-300 rounded-lg mt-4 space-y-4 bg-gray-50 scheduling-rule-item" data-rule-index="${ruleIndex}">
                <div class="flex justify-between items-center">
                    <h4 class="text-md font-semibold text-indigo-700">Scheduling Rule (<span class="rule-service-name-display">${escapeHTML(defaultRuleData.serviceName) || 'New Rule'}</span>)</h4>
                    <button type="button" class="text-red-500 hover:text-red-700 remove-scheduling-rule-btn">
                        <i class="fas fa-trash-alt mr-1"></i>Remove Rule
                    </button>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="ruleServiceName_${ruleIndex}" class="form-label">Service Name <span class="text-red-500">*</span></label>
                        <input type="text" id="ruleServiceName_${ruleIndex}" name="ruleServiceName_${ruleIndex}" class="form-input rule-service-name-input" placeholder="e.g., Repair Service" value="${escapeHTML(defaultRuleData.serviceName)}">
                    </div>
                    <div>
                        <label for="ruleSchedulingType_${ruleIndex}" class="form-label">Scheduling Type <span class="text-red-500">*</span></label>
                        <select id="ruleSchedulingType_${ruleIndex}" name="ruleSchedulingType_${ruleIndex}" class="form-select rule-scheduling-type-select">
                            <option value="immediate" ${defaultRuleData.schedulingType === 'immediate' ? 'selected' : ''}>Immediate / Soonest</option>
                            <option value="future" ${defaultRuleData.schedulingType === 'future' ? 'selected' : ''}>Future Booked</option>
                        </select>
                    </div>
                </div>
                <div class="rule-future-booking-lead-days-container ${defaultRuleData.schedulingType === 'future' ? '' : 'hidden'}">
                    <label for="ruleFutureBookingLeadDays_${ruleIndex}" class="form-label">Future Booking Lead Time (days)</label>
                    <input type="number" id="ruleFutureBookingLeadDays_${ruleIndex}" name="ruleFutureBookingLeadDays_${ruleIndex}" class="form-input" value="${defaultRuleData.futureBookingLeadDays}" min="0">
                </div>
                <div>
                    <label class="form-label mb-1 block">Daily Service Hours for this Rule <span class="text-red-500">*</span></label>
                    <div class="space-y-1 p-3 border rounded-md bg-white daily-hours-subform">${dailyHoursHTML}</div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="ruleSameDayCutoffTime_${ruleIndex}" class="form-label">Same-Day Cutoff Time (e.g., 18:00)</label>
                        <input type="time" id="ruleSameDayCutoffTime_${ruleIndex}" name="ruleSameDayCutoffTime_${ruleIndex}" class="form-input" value="${defaultRuleData.sameDayCutoffTime}">
                    </div>
                    <div>
                        <label for="ruleApptSlotIncrement_${ruleIndex}" class="form-label">Appt. Slot Increment (mins) <span class="text-red-500">*</span></label>
                        <input type="number" id="ruleApptSlotIncrement_${ruleIndex}" name="ruleApptSlotIncrement_${ruleIndex}" class="form-input" value="${defaultRuleData.appointmentSlotIncrementMinutes}" min="15">
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label for="ruleRoundTo_${ruleIndex}" class="form-label">Round To <span class="text-red-500">*</span></label>
                        <select id="ruleRoundTo_${ruleIndex}" name="ruleRoundTo_${ruleIndex}" class="form-select">
                            <option value="hour" ${defaultRuleData.roundTo === 'hour' ? 'selected' : ''}>Next Full Hour</option>
                            <option value="half" ${defaultRuleData.roundTo === 'half' ? 'selected' : ''}>Next Half Hour</option>
                            <option value="none" ${defaultRuleData.roundTo === 'none' ? 'selected' : ''}>No Rounding</option>
                        </select>
                    </div>
                    <div>
                        <label for="ruleInitialBufferMinutes_${ruleIndex}" class="form-label">Initial Call Buffer (mins) <span class="text-red-500">*</span></label>
                        <input type="number" id="ruleInitialBufferMinutes_${ruleIndex}" name="ruleInitialBufferMinutes_${ruleIndex}" class="form-input" value="${defaultRuleData.initialBufferMinutes}" min="0">
                    </div>
                    <div>
                        <label for="ruleSearchCalendar_${ruleIndex}" class="form-label">Search Calendar <span class="text-red-500">*</span></label>
                        <select id="ruleSearchCalendar_${ruleIndex}" name="ruleSearchCalendar_${ruleIndex}" class="form-select">
                            <option value="next" ${defaultRuleData.searchCalendar === 'next' ? 'selected' : ''}>Next Available</option>
                            <option value="same" ${defaultRuleData.searchCalendar === 'same' ? 'selected' : ''}>Same Day Only</option>
                        </select>
                    </div>
                </div>
                 <div>
                     <label for="ruleGoogleCalendarId_${ruleIndex}" class="form-label">Google Calendar for this Service</label>
                     <select id="ruleGoogleCalendarId_${ruleIndex}" name="ruleGoogleCalendarId_${ruleIndex}" class="form-select">
                        ${calendarOptionsHTML}
                     </select>
                     <p class="text-xs text-gray-500 mt-1">Select a calendar for availability checks and booking. Connect calendars in the 'Calendar Settings' tab.</p>
                </div>
                <div class="mt-3">
                    <button type="button" class="text-sm text-blue-600 hover:text-blue-800 preview-this-rule-btn">Preview this rule's logic</button>
                </div>
            </div>
        `;
    }
    
    function handleSchedulingTypeChange(event) {
        const selectElement = event.target;
        const ruleItem = selectElement.closest('.scheduling-rule-item');
        if (!ruleItem) return;
        const futureBookingContainer = ruleItem.querySelector('.rule-future-booking-lead-days-container');
        if (futureBookingContainer) {
            futureBookingContainer.classList.toggle('hidden', selectElement.value !== 'future');
        }
    }

    function attachSchedulingRuleEventListeners(ruleElement) {
        const removeButton = ruleElement.querySelector('.remove-scheduling-rule-btn');
        if (removeButton) {
            removeButton.removeEventListener('click', handleDynamicItemRemove); 
            removeButton.addEventListener('click', handleDynamicItemRemove);
        }
        const schedulingTypeSelect = ruleElement.querySelector('.rule-scheduling-type-select');
        if (schedulingTypeSelect) {
            schedulingTypeSelect.removeEventListener('change', handleSchedulingTypeChange); 
            schedulingTypeSelect.addEventListener('change', handleSchedulingTypeChange);
        }
        const serviceNameInput = ruleElement.querySelector('.rule-service-name-input');
        if (serviceNameInput) {
             serviceNameInput.removeEventListener('input', handleRuleInputChange); 
            serviceNameInput.addEventListener('input', handleRuleInputChange);
        }
        const previewButton = ruleElement.querySelector('.preview-this-rule-btn');
        if (previewButton) {
            previewButton.removeEventListener('click', () => refreshInterpreterForRule(ruleElement));
            previewButton.addEventListener('click', () => refreshInterpreterForRule(ruleElement));
        }
        ruleElement.querySelectorAll('input, select').forEach(input => {
            input.removeEventListener('input', () => handleRuleInputChange({target: input})); 
            input.removeEventListener('change', () => handleRuleInputChange({target: input})); 
            input.addEventListener('input', () => handleRuleInputChange({target: input}));
            input.addEventListener('change', () => handleRuleInputChange({target: input}));
        });
    }

    function handleRuleInputChange(event) { 
        const ruleElement = event.target.closest('.scheduling-rule-item');
        if (ruleElement) {
            if(event.target.classList.contains('rule-service-name-input')) {
                const displayName = ruleElement.querySelector('.rule-service-name-display');
                if (displayName) displayName.textContent = event.target.value || 'New Rule';
            }
            refreshInterpreterForRule(ruleElement);
        }
    }
    
    let interpreterIntervalId = null;

    function updateCurrentTimeForInterpreter() {
        if (currentTimeDisplaySpan && agentSetupPageContainer) { 
            const now = new Date();
            const companyTimezone = (timezoneSelectAgentSetup && timezoneSelectAgentSetup.value) 
                                     ? timezoneSelectAgentSetup.value 
                                     : currentCompanyData?.agentSetup?.timezone || currentCompanyData?.timezone || 'America/New_York';
            try {
                currentTimeDisplaySpan.textContent = now.toLocaleString('en-US', { 
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', 
                    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: companyTimezone, hour12: true 
                });
            } catch (e) {
                currentTimeDisplaySpan.textContent = now.toLocaleString() + ` (Local time. Error with TZ: ${companyTimezone})`;
                console.warn("Error formatting time for timezone in interpreter:", companyTimezone, e);
            }
        }
    }

    function interpretAndDisplayRule(ruleConfig, displayElement) {
        if (!displayElement) { console.warn("Interpreter display element not found"); return; }
        if (!ruleConfig || !ruleConfig.serviceName) {
            displayElement.innerHTML = '<p class="italic">Enter a Service Name for the rule and other details to see its live interpretation.</p>';
            return;
        }

        const output = [];
        const now = new Date(); 
        const companyTimezone = (timezoneSelectAgentSetup && timezoneSelectAgentSetup.value) 
                                 ? timezoneSelectAgentSetup.value 
                                 : currentCompanyData?.agentSetup?.timezone || currentCompanyData?.timezone || 'America/New_York';

        output.push(`<strong>Interpreting Rule: "${escapeHTML(ruleConfig.serviceName)}"</strong>`);
        output.push(`(Using current device time: ${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} for calculation base. Rule TZ: ${companyTimezone})`);

        let earliestBookableTime = new Date(now.getTime());
        let calculationDay = new Date(now.getTime()); 

        if (ruleConfig.schedulingType === 'future') {
            const leadDays = parseInt(ruleConfig.futureBookingLeadDays, 10) || 0;
            calculationDay.setDate(now.getDate() + leadDays); 
            earliestBookableTime = new Date(calculationDay.getFullYear(), calculationDay.getMonth(), calculationDay.getDate()); 

            const futureDayName = daysOfWeekForOperatingHours[earliestBookableTime.getDay() === 0 ? 6 : earliestBookableTime.getDay() - 1];
            const futureDayHours = ruleConfig.dailyServiceHours?.find(ds => ds.day === futureDayName);

            if (futureDayHours && futureDayHours.enabled && futureDayHours.startTime) {
                 earliestBookableTime.setHours(parseInt(futureDayHours.startTime.split(':')[0],10), parseInt(futureDayHours.startTime.split(':')[1],10),0,0);
            } else { 
                 earliestBookableTime.setHours(8,0,0,0); 
                 output.push(`<span class="text-orange-600">Warning: Target future day ${futureDayName} not enabled or no start time, defaulting to 8 AM.</span>`);
            }
            output.push(`Booking type: Future. Earliest consideration from: ${earliestBookableTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`);
        } else { 
            const initialBuffer = parseInt(ruleConfig.initialBufferMinutes, 10) || 0;
            earliestBookableTime.setMinutes(now.getMinutes() + initialBuffer); 
            output.push(`Initial buffer: ${initialBuffer} min. Time after buffer: ${earliestBookableTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`);

            const minutes = earliestBookableTime.getMinutes();
            const currentHours = earliestBookableTime.getHours();
            if (ruleConfig.roundTo === 'hour') {
                if (minutes > 0) earliestBookableTime.setHours(currentHours + 1, 0, 0, 0);
            } else if (ruleConfig.roundTo === 'half') {
                if (minutes > 30) earliestBookableTime.setHours(currentHours + 1, 0, 0, 0);
                else if (minutes > 0 && minutes <= 30) earliestBookableTime.setMinutes(30, 0, 0);
            }
            output.push(`After rounding (${ruleConfig.roundTo}): ${earliestBookableTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`);
            calculationDay = new Date(earliestBookableTime.getTime()); 
        }
        
        let nextAvailableSlotFound = false;
        let countDaysChecked = 0;
        let finalCalculatedSlotStartTimeStr = "Not found within 7 days based on rules.";

        while(!nextAvailableSlotFound && countDaysChecked < 7) {
            const checkDayName = daysOfWeekForOperatingHours[calculationDay.getDay() === 0 ? 6 : calculationDay.getDay() - 1];
            const serviceHoursForCheckDay = ruleConfig.dailyServiceHours?.find(ds => ds.day === checkDayName);

            if (serviceHoursForCheckDay && serviceHoursForCheckDay.enabled && serviceHoursForCheckDay.startTime && serviceHoursForCheckDay.endTime) {
                let slotSearchStartTime = new Date(calculationDay.getFullYear(), calculationDay.getMonth(), calculationDay.getDate());
                slotSearchStartTime.setHours(parseInt(serviceHoursForCheckDay.startTime.split(':')[0], 10), parseInt(serviceHoursForCheckDay.startTime.split(':')[1], 10), 0, 0);

                let serviceDayEndTime = new Date(calculationDay.getFullYear(), calculationDay.getMonth(), calculationDay.getDate());
                serviceDayEndTime.setHours(parseInt(serviceHoursForCheckDay.endTime.split(':')[0], 10), parseInt(serviceHoursForCheckDay.endTime.split(':')[1], 10), 0, 0);
                
                if (calculationDay.toDateString() === earliestBookableTime.toDateString() && earliestBookableTime > slotSearchStartTime) {
                    slotSearchStartTime = new Date(earliestBookableTime.getTime());
                }
                
                if (ruleConfig.schedulingType === 'immediate' && calculationDay.toDateString() === now.toDateString() && ruleConfig.sameDayCutoffTime) {
                    const cutoffTimeParts = ruleConfig.sameDayCutoffTime.split(':');
                    if (cutoffTimeParts.length === 2) {
                        const cutoffDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()); 
                        cutoffDateTime.setHours(parseInt(cutoffTimeParts[0],10), parseInt(cutoffTimeParts[1],10),0,0);
                        if (now >= cutoffDateTime) {
                            calculationDay.setDate(calculationDay.getDate() + 1); 
                            earliestBookableTime = new Date(calculationDay.getFullYear(), calculationDay.getMonth(), calculationDay.getDate(),8,0,0); 
                            countDaysChecked++;
                            continue; 
                        }
                    }
                }
                
                while(slotSearchStartTime < serviceDayEndTime) {
                    let potentialSlotEnd = new Date(slotSearchStartTime.getTime());
                    potentialSlotEnd.setMinutes(potentialSlotEnd.getMinutes() + (parseInt(ruleConfig.appointmentSlotIncrementMinutes,10) || 60));

                    if (potentialSlotEnd <= serviceDayEndTime) {
                        finalCalculatedSlotStartTimeStr = `${slotSearchStartTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${slotSearchStartTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
                        nextAvailableSlotFound = true;
                        break; 
                    }
                    slotSearchStartTime.setMinutes(slotSearchStartTime.getMinutes() + (parseInt(ruleConfig.appointmentSlotIncrementMinutes,10) || 60) ); 
                }
                 if (nextAvailableSlotFound) break;

            }
            calculationDay.setDate(calculationDay.getDate() + 1); 
            earliestBookableTime = new Date(calculationDay.getFullYear(), calculationDay.getMonth(), calculationDay.getDate(),8,0,0); 
            countDaysChecked++;
        }

        if (nextAvailableSlotFound) {
             output.push(`Earliest bookable slot: <strong class="text-green-700">${finalCalculatedSlotStartTimeStr}</strong>`);
        } else {
            output.push(`<span class="text-red-600">No available slots found within the next 7 days based on these rule settings.</span>`);
        }
        
        output.push(`Appointment slots configured as: ${ruleConfig.appointmentSlotIncrementMinutes || 60} minutes.`);
        output.push(`Agent prompt: "Based on settings for ${escapeHTML(ruleConfig.serviceName)}, the first available time I see is around ${finalCalculatedSlotStartTimeStr}. Would that work for you, or do you have another time in mind?"`);

        displayElement.innerHTML = output.join('<br>');
    }
    
    function getRuleDataFromFormBlock(ruleElement) {
        if (!ruleElement) return null;
        const ruleIndex = ruleElement.dataset.ruleIndex;
        const ruleData = {
            serviceName: ruleElement.querySelector(`input[name="ruleServiceName_${ruleIndex}"]`)?.value.trim(),
            schedulingType: ruleElement.querySelector(`select[name="ruleSchedulingType_${ruleIndex}"]`)?.value,
            futureBookingLeadDays: parseInt(ruleElement.querySelector(`input[name="ruleFutureBookingLeadDays_${ruleIndex}"]`)?.value, 10) || 0,
            dailyServiceHours: [],
            sameDayCutoffTime: ruleElement.querySelector(`input[name="ruleSameDayCutoffTime_${ruleIndex}"]`)?.value || null,
            appointmentSlotIncrementMinutes: parseInt(ruleElement.querySelector(`input[name="ruleApptSlotIncrement_${ruleIndex}"]`)?.value, 10) || 60,
            roundTo: ruleElement.querySelector(`select[name="ruleRoundTo_${ruleIndex}"]`)?.value,
            initialBufferMinutes: parseInt(ruleElement.querySelector(`input[name="ruleInitialBufferMinutes_${ruleIndex}"]`)?.value, 10) || 0,
            searchCalendar: ruleElement.querySelector(`select[name="ruleSearchCalendar_${ruleIndex}"]`)?.value,
            googleCalendarId: ruleElement.querySelector(`select[name="ruleGoogleCalendarId_${ruleIndex}"]`)?.value.trim() || null 
        };

        daysOfWeekForOperatingHours.forEach(dayName => { 
            const dayLC = dayName.toLowerCase().replace(/\s+/g, ''); 
            const idPrefix = `rule_${ruleIndex}_${dayLC}`; 
            const enabledInput = ruleElement.querySelector(`input[id="${idPrefix}_enabled"]`); 
            const startTimeInput = ruleElement.querySelector(`input[id="${idPrefix}_startTime"]`);
            const endTimeInput = ruleElement.querySelector(`input[id="${idPrefix}_endTime"]`);

            ruleData.dailyServiceHours.push({
                day: dayName,
                enabled: enabledInput?.checked || false,
                startTime: startTimeInput?.value || '',
                endTime: endTimeInput?.value || ''
            });
        });
        return ruleData;
    }

    function refreshInterpreterForRule(ruleElement) { 
        if (schedulingInterpreterOutputDiv) {
            const targetRuleElement = ruleElement || serviceSchedulingRulesContainer?.querySelector('.scheduling-rule-item');
            if (targetRuleElement) {
                const ruleData = getRuleDataFromFormBlock(targetRuleElement);
                if (ruleData && ruleData.serviceName) {
                    interpretAndDisplayRule(ruleData, schedulingInterpreterOutputDiv);
                } else if (ruleData) { 
                     schedulingInterpreterOutputDiv.innerHTML = '<p class="italic">Enter a Service Name for the rule to see its live interpretation.</p>';
                } else { 
                     schedulingInterpreterOutputDiv.innerHTML = '<p class="italic">Could not read rule data to interpret.</p>';
                }
            } else {
                 schedulingInterpreterOutputDiv.innerHTML = '<p class="italic">Add and configure a scheduling rule to see its live interpretation.</p>';
            }
        }
    }
    
    function populateAgentSetupForm(agentSetup = {}, companyTradeTypes = []) {
        if (!agentSetupPageContainer) {
            console.warn("Agent Setup Page Container not found, cannot populate form.");
            return;
        }
        
        const categoryCheckboxes = agentSetupPageContainer.querySelectorAll('input[name="category"]');
        if (categoryCheckboxes.length > 0) { 
            categoryCheckboxes.forEach(cb => {
                cb.checked = (companyTradeTypes || []).includes(cb.value);
            });
        }
        
        const selectedCategoriesListLocal = agentSetupPageContainer.querySelector('#selectedCategoriesList');
        if(selectedCategoriesListLocal && categoryCheckboxes.length > 0) {
            const checkedCategoriesHTML = Array.from(categoryCheckboxes)
                .filter(cb => cb.checked)
                .map(cb => `<li>${escapeHTML(cb.value)}</li>`).join('');
            selectedCategoriesListLocal.innerHTML = checkedCategoriesHTML || '<li class="text-gray-500 italic">No categories selected yet.</li>';
        }

        if (agentModeSelect) agentModeSelect.value = agentSetup.agentMode || 'full';
        if (companySpecialtiesInputAgentSetup) companySpecialtiesInputAgentSetup.value = agentSetup.companySpecialties || '';
        if (timezoneSelectAgentSetup) {
            timezoneSelectAgentSetup.value = agentSetup.timezone || currentCompanyData?.timezone || 'America/New_York';
            if(currentTimeDisplayAgentSetup || currentTimeDisplaySpan) { 
                 setTimeout(updateCurrentTimeForInterpreter, 0); 
                 if (timezoneSelectAgentSetup.dispatchEvent) { 
                     timezoneSelectAgentSetup.dispatchEvent(new Event('change'));
                 }
            }
        }

        if (operatingHoursListContainer) { 
            operatingHoursListContainer.innerHTML = `<div class="grid grid-cols-4 gap-x-3 mb-1 px-2"><span class="text-xs font-medium text-gray-500">Day</span><span class="text-xs font-medium text-gray-500 text-center">Enabled</span><span class="text-xs font-medium text-gray-500">Open From</span><span class="text-xs font-medium text-gray-500">Open To</span></div>`;
            const hoursData = agentSetup.operatingHours?.length === 7 ? agentSetup.operatingHours :
                daysOfWeekForOperatingHours.map(day => ({ day: day, enabled: !['Saturday', 'Sunday'].includes(day), start: '09:00', end: '17:00' }));
            hoursData.forEach(daySetting => {
                const dayLC = daySetting.day.toLowerCase().substring(0, 3);
                const row = document.createElement('div');
                row.className = 'grid grid-cols-4 gap-x-3 items-center p-2 hover:bg-gray-100 rounded-md';
                row.innerHTML = `
                    <label class="form-label">${daySetting.day}</label>
                    <input type="checkbox" id="opHours_${dayLC}_enabled" name="operatingHours_${dayLC}_enabled" class="form-checkbox justify-self-center" ${daySetting.enabled ? 'checked' : ''}>
                    <input type="time" name="operatingHours_${dayLC}_start" value="${daySetting.start || '09:00'}" class="form-input ${dayLC}-time">
                    <input type="time" name="operatingHours_${dayLC}_end" value="${daySetting.end || '17:00'}" class="form-input ${dayLC}-time">`;
                operatingHoursListContainer.appendChild(row);
            });
        }
        if (toggle24HoursCheckbox) {
            toggle24HoursCheckbox.checked = !!agentSetup.use247Routing;
            if(operatingHoursListContainer && toggle24HoursCheckbox.dispatchEvent) {
                toggle24HoursCheckbox.dispatchEvent(new Event('change'));
            }
         }

        const gType = agentSetup.greetingType || 'tts';
        if (greetingTypeTtsRadio) greetingTypeTtsRadio.checked = gType === 'tts';
        if (greetingTypeAudioRadio) greetingTypeAudioRadio.checked = gType === 'audio';
        uploadedGreetingAudioUrl = agentSetup.greetingAudioUrl || '';
        if (greetingAudioPreview) {
            if (uploadedGreetingAudioUrl) {
                greetingAudioPreview.src = uploadedGreetingAudioUrl;
                greetingAudioPreview.classList.remove('hidden');
            } else {
                greetingAudioPreview.classList.add('hidden');
                greetingAudioPreview.src = '';
            }
        }
        updateGreetingTypeUI();

        if (agentGreetingTextareaAgentSetup) agentGreetingTextareaAgentSetup.value = agentSetup.agentGreeting || '';
        if (mainAgentScriptTextarea) mainAgentScriptTextarea.value = agentSetup.mainAgentScript || defaultProtocols.mainAgentScript || '';
        if (agentClosingTextareaAgentSetup) agentClosingTextareaAgentSetup.value = agentSetup.agentClosing || '';
        
        agentSetupPageContainer.querySelectorAll('.protocol-section textarea').forEach(textarea => {
            const protocolName = textarea.name;
            if (protocolName) {
                const key = protocolName.replace(/^protocol/, '');
                const camelCaseKey = key.charAt(0).toLowerCase() + key.slice(1);
                textarea.value = (agentSetup.protocols || {})[camelCaseKey] || defaultProtocols[camelCaseKey] || '';
            }
        });
        const textToPaySelect = agentSetupPageContainer.querySelector('select[name="textToPayPhoneSource"]');
        if (textToPaySelect) textToPaySelect.value = agentSetup.textToPayPhoneSource || 'callerID';

        if (serviceSchedulingRulesContainer) {
            serviceSchedulingRulesContainer.innerHTML = ''; 
            const rules = agentSetup.schedulingRules || [];
            if (rules.length > 0) {
                rules.forEach((rule, index) => {
                    const ruleHTML = createSchedulingRuleHTML(rule, `rule_${index}`); 
                    const tempDiv = document.createElement('div'); tempDiv.innerHTML = ruleHTML; const ruleElement = tempDiv.firstElementChild;

                    if (ruleElement) {
                        serviceSchedulingRulesContainer.appendChild(ruleElement);
                        attachSchedulingRuleEventListeners(ruleElement);
                        const serviceNameInput = ruleElement.querySelector('.rule-service-name-input');
                        const displayName = ruleElement.querySelector('.rule-service-name-display');
                        if(serviceNameInput && displayName && serviceNameInput.value) {
                             displayName.textContent = escapeHTML(serviceNameInput.value);
                        }
                        const schedulingTypeSelect = ruleElement.querySelector('.rule-scheduling-type-select');
                        if(schedulingTypeSelect) handleSchedulingTypeChange({target: schedulingTypeSelect});
                    }
                });
            }
            refreshInterpreterForRule(serviceSchedulingRulesContainer.querySelector('.scheduling-rule-item'));
        }
        
        renderDynamicListItems(callRoutingListContainer, agentSetup.callRouting, (idx, item) => `<div class="flex items-end space-x-2 mt-2"><input type="text" name="callRoutingName_${idx}" placeholder="Department / Name" class="form-input flex-1" value="${escapeHTML(item.name || '')}"><input type="tel" name="callRoutingPhone_${idx}" placeholder="Phone Number (E.164)" class="form-input flex-1" value="${escapeHTML(item.phoneNumber || '')}"><button type="button" class="remove-call-routing form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-call-routing');
        renderDynamicListItems(afterHoursRoutingListContainer, agentSetup.afterHoursRouting, (idx, item) => `<div class="flex items-end space-x-2 mt-2"><input type="text" name="ahRoutingName_${idx}" placeholder="e.g., On-Call Tech" class="form-input flex-1" value="${escapeHTML(item.name || '')}"><input type="tel" name="ahRoutingPhone_${idx}" placeholder="Phone Number (E.164)" class="form-input flex-1" value="${escapeHTML(item.phoneNumber || '')}"><button type="button" class="remove-ah-route form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-ah-route');
        renderDynamicListItems(callSummariesListContainer, agentSetup.summaryRecipients, (idx, item) => `<div class="flex items-end space-x-2 mt-2"><input type="text" name="summaryRecipient_${idx}" placeholder="Email or Phone Number" class="form-input flex-1" value="${escapeHTML(item.contact || '')}"><button type="button" class="remove-summary-recipient form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-summary-recipient');
        renderDynamicListItems(afterHoursNotificationsListContainer, agentSetup.afterHoursRecipients, (idx, item) => `<div class="flex items-end space-x-2 mt-2"><input type="text" name="ahNotificationRecipient_${idx}" placeholder="Email or Phone Number" class="form-input flex-1" value="${escapeHTML(item.contact || '')}"><button type="button" class="remove-ah-notification form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-ah-notification');
        renderDynamicListItems(malfunctionForwardingListContainer, agentSetup.malfunctionForwarding, (idx, item) => `<div class="flex items-end space-x-2 mt-2"><input type="tel" name="mfForwardingPhone_${idx}" placeholder="Phone Number (E.164)" class="form-input flex-1" value="${escapeHTML(item.phoneNumber || '')}"><button type="button" class="remove-mf-forward form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-mf-forward');
        renderDynamicListItems(malfunctionNotificationsListContainer, agentSetup.malfunctionRecipients, (idx, item) => `<div class="flex items-end space-x-2 mt-2"><input type="tel" name="mfNotificationRecipient_${idx}" placeholder="Phone Number (E.164) for SMS" class="form-input flex-1" value="${escapeHTML(item.phoneNumber || item.contact || '')}"><button type="button" class="remove-mf-notify form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-mf-notify');
        renderDynamicListItems(placeholdersListContainer, agentSetup.placeholders, (idx, item) => `<div class="flex items-end space-x-2 mt-1"><input type="text" name="placeholderName_${idx}" placeholder="Name" class="form-input flex-1" value="${escapeHTML(item.name || '')}"><input type="text" name="placeholderValue_${idx}" placeholder="Value" class="form-input flex-1" value="${escapeHTML(item.value || '')}"><button type="button" class="remove-placeholder form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-placeholder');

        loadAndDisplayCategoryQAs();
        fetchCompanyQnA();
        updatePlaceholderSelectOptions();
        updateAllPreviews();
        
        // Populate behavior configuration
        if (agentSetup.behaviors) {
            console.log('🧠 Populating behavior configuration from agent setup:', agentSetup.behaviors);
            populateBehaviorConfiguration(agentSetup.behaviors);
        } else {
            console.log('🧠 No behavior configuration found in agent setup, using defaults');
            populateBehaviorConfiguration({});
        }
    }

    async function handleSaveAgentSetup(event) {
        event.preventDefault();
        if (!agentSetupForm || !companyId || !agentSetupPageContainer) return;

        const agentSetupData = {
            agentMode: agentSetupPageContainer.querySelector('#agentModeSelect')?.value || 'full',
            categories: Array.from(agentSetupPageContainer.querySelectorAll('input[name="category"]:checked')).map(cb => cb.value),
            companySpecialties: agentSetupPageContainer.querySelector('#companySpecialties')?.value.trim() || '',
            timezone: agentSetupPageContainer.querySelector('#agentSetupTimezoneSelect')?.value || 'America/New_York',
            operatingHours: daysOfWeekForOperatingHours.map(day => {
                const dayLC = day.toLowerCase().substring(0, 3); 
                return {
                    day: day,
                    enabled: agentSetupPageContainer.querySelector(`input[id="opHours_${dayLC}_enabled"]`)?.checked || agentSetupPageContainer.querySelector(`input[name="operatingHours_${dayLC}_enabled"]`)?.checked || false, 
                    start: agentSetupPageContainer.querySelector(`input[name="operatingHours_${dayLC}_start"]`)?.value || '',
                    end: agentSetupPageContainer.querySelector(`input[name="operatingHours_${dayLC}_end"]`)?.value || ''
                };
            }),
            use247Routing: agentSetupPageContainer.querySelector('#toggle24Hours')?.checked || false,
            greetingType: greetingTypeAudioRadio?.checked ? 'audio' : 'tts',
            greetingAudioUrl: uploadedGreetingAudioUrl,
            agentGreeting: agentSetupPageContainer.querySelector('#agentGreeting')?.value.trim() || '',
            mainAgentScript: agentSetupPageContainer.querySelector('#mainAgentScript')?.value.trim() || '',
            agentClosing: agentSetupPageContainer.querySelector('#agentClosing')?.value.trim() || '',
            protocols: {},
            textToPayPhoneSource: agentSetupPageContainer.querySelector('select[name="textToPayPhoneSource"]')?.value || 'callerID',
            schedulingRules: [], 
            callRouting: [], afterHoursRouting: [], summaryRecipients: [],
            afterHoursRecipients: [], malfunctionForwarding: [], malfunctionRecipients: []
        };
        
        agentSetupPageContainer.querySelectorAll('.protocol-section textarea').forEach(textarea => {
            const protocolName = textarea.name;
            if (protocolName) {
                const key = protocolName.replace(/^protocol/, '');
                agentSetupData.protocols[key.charAt(0).toLowerCase() + key.slice(1)] = textarea.value.trim();
            }
        });
        
        if (serviceSchedulingRulesContainer) {
            serviceSchedulingRulesContainer.querySelectorAll('.scheduling-rule-item').forEach(ruleItem => {
                const ruleData = getRuleDataFromFormBlock(ruleItem);
                if (ruleData && ruleData.serviceName) { 
                    agentSetupData.schedulingRules.push(ruleData);
                }
            });
        }
        
        agentSetupData.callRouting = collectDynamicListValues('call-routing-list', 'callRoutingName_', 'callRoutingPhone_', (name, phone) => (name || phone) ? { name: name || '', phoneNumber: phone } : null);
        agentSetupData.afterHoursRouting = collectDynamicListValues('after-hours-routing-list', 'ahRoutingName_', 'ahRoutingPhone_', (name, phone) => (name || phone) ? { name: name || '', phoneNumber: phone } : null);
        agentSetupData.summaryRecipients = collectDynamicListValues('call-summaries-list', null, 'summaryRecipient_', (name, contact) => contact ? { contact: contact } : null);
        agentSetupData.afterHoursRecipients = collectDynamicListValues('after-hours-notifications-list', null, 'ahNotificationRecipient_', (name, contact) => contact ? { contact: contact } : null);
        agentSetupData.malfunctionForwarding = collectDynamicListValues('malfunction-forwarding-list', null, 'mfForwardingPhone_', (name, phone) => phone ? { phoneNumber: phone } : null);
        agentSetupData.malfunctionRecipients = collectDynamicListValues('malfunction-notifications-list', null, 'mfNotificationRecipient_', (name, phone) => phone ? { phoneNumber: phone } : null);
        agentSetupData.placeholders = collectDynamicListValues('placeholders-list', 'placeholderName_', 'placeholderValue_', (name, value) => name ? { name: name, value: value || '' } : null);

        const saveBtnLocal = saveAgentSetupButton;
        if (saveBtnLocal) { saveBtnLocal.disabled = true; saveBtnLocal.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }
        
        try {
            // Add behavior configuration
            const behaviorConfig = collectBehaviorConfiguration();
            agentSetupData.behaviors = behaviorConfig;
            console.log('🧠 Added behavior configuration to save data:', behaviorConfig);
            
            const payload = { agentSetup: agentSetupData, tradeTypes: agentSetupData.categories, timezone: agentSetupData.timezone };
            const response = await fetch(`/api/company/${companyId}/agentsetup`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            if (!response.ok) { 
                const errData = await response.json().catch(() => ({message: `Failed to save Agent Setup. Status: ${response.status}, Response: ${response.statusText}` })); 
                console.error("Server error data:", errData);
                throw new Error(errData.message || `HTTP error! status: ${response.status}`); 
            }
            const updatedCompany = await response.json();
            currentCompanyData = { ...currentCompanyData, ...updatedCompany }; 
            currentCompanyData.agentSetup = updatedCompany.agentSetup || agentSetupData; 
            currentCompanyData.tradeTypes = updatedCompany.tradeTypes || agentSetupData.categories;
            currentCompanyData.timezone = updatedCompany.timezone || agentSetupData.timezone;

            populateAgentSetupForm(currentCompanyData.agentSetup, currentCompanyData.tradeTypes);
            populateCompanyData(currentCompanyData); 
            hasUnsavedChanges = false;
            alert('Agent Setup saved successfully!'); 
        } catch (error) {
            console.error('Error saving Agent Setup:', error);
            alert(`Error saving Agent Setup: ${error.message}`); 
        } finally {
            if (saveBtnLocal) { saveBtnLocal.disabled = false; saveBtnLocal.innerHTML = '<i class="fas fa-save mr-2"></i>Save Agent Setup'; }
        }
    }

    async function handleSaveChanges(event) {
        event.preventDefault();
        if (!currentCompanyData || !companyId) return;
        const form = event.target;
        const updatedData = {
            companyName: form.elements.companyName.value,
            ownerName: form.elements.ownerName.value,
            ownerEmail: form.elements.ownerEmail.value,
            ownerPhone: form.elements.ownerPhone.value,
            contactName: form.elements.contactName.value,
            contactEmail: form.elements.contactEmail.value,
            contactPhone: form.elements.contactPhone.value,
            address: {
                street: form.elements.addressStreet.value,
                city: form.elements.addressCity.value,
                state: form.elements.addressState.value,
                zip: form.elements.addressZip.value,
                country: form.elements.addressCountry.value,
            },
            isActive: form.elements.isActive.checked,
            additionalContacts: []
        };
        const contactBlocks = companyDetailsEditFormContainer?.querySelectorAll('.additional-contact-edit-block');
        contactBlocks?.forEach((block) => {
            const name = block.querySelector(`input[name="additionalContactName"]`)?.value.trim();
            const title = block.querySelector(`input[name="additionalContactTitle"]`)?.value.trim();
            const email = block.querySelector(`input[name="additionalContactEmail"]`)?.value.trim();
            const phone = block.querySelector(`input[name="additionalContactPhone"]`)?.value.trim();
            const notes = block.querySelector(`textarea[name="additionalContactNotes"]`)?.value.trim();
            if (name || title || email || phone || notes) {
                updatedData.additionalContacts.push({ name: name || null, title: title || null, email: email || null, phone: phone || null, notes: notes || null });
            }
        });
        const saveButton = document.getElementById('save-changes-button');
        if (saveButton) { saveButton.disabled = true; saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }
        try {
            const response = await fetch(`/api/company/${companyId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedData)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `Failed to save. Status: ${response.status}` }));
                throw new Error(errorData.message);
            }
            const savedCompanyData = await response.json();
            const agentSetupToPreserve = currentCompanyData.agentSetup; 
            const aiSettingsToPreserve = currentCompanyData.aiSettings; 
            const twilioConfigToPreserve = currentCompanyData.twilioConfig; 
            const notesToPreserve = currentCompanyData.notes; 
            const integrationsToPreserve = currentCompanyData.integrations;

            currentCompanyData = { 
                ...savedCompanyData, 
                agentSetup: agentSetupToPreserve,
                aiSettings: aiSettingsToPreserve,
                twilioConfig: twilioConfigToPreserve,
                notes: notesToPreserve,
                integrations: integrationsToPreserve
            };
            currentCompanyData.additionalContacts = savedCompanyData.additionalContacts || [];

            populateCompanyData(currentCompanyData);
            hideEditForm();
            hasUnsavedChanges = false;
             alert('Company details updated successfully!');
        } catch (error) {
            console.error("handleSaveChanges: Error saving company details:", error);
             alert(`Failed to update company: ${error.message}`);
        } finally {
            if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = 'Save Changes'; }
        }
    }

    async function handleSaveConfiguration(event) {
        event.preventDefault();
        if (!companyId || !configSettingsForm) return;
        
        // Collect multiple phone numbers
        const phoneNumbers = [];
        if (typeof getConfiguredPhoneNumbers === 'function') {
            phoneNumbers.push(...getConfiguredPhoneNumbers());
        }
        
        // Get primary phone number for backward compatibility
        const primaryPhone = phoneNumbers.find(p => p.isPrimary)?.phoneNumber || phoneNumbers[0]?.phoneNumber || null;
        
        const twilioConfigData = {
            accountSid: twilioAccountSidInput?.value.trim() || null,
            authToken: twilioAuthTokenInput?.value || null, 
            phoneNumber: primaryPhone, // Primary phone number for backward compatibility
            phoneNumbers: phoneNumbers // New multiple phone numbers array
        };
        const fullConfigData = { twilioConfig: twilioConfigData };
        const saveButton = configSettingsForm.querySelector('button[type="submit"]');
        if (saveButton) { saveButton.disabled = true; saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }
        try {
            const response = await fetch(`/api/company/${companyId}/configuration`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fullConfigData)
            });
            if (!response.ok) { const err = await response.json().catch(() => ({ message: `Failed to save configuration. Status: ${response.status}` })); throw new Error(err.message); }
            const updatedCompany = await response.json();
            currentCompanyData.twilioConfig = updatedCompany.twilioConfig || {};
            populateConfigurationForm(currentCompanyData.twilioConfig);
            hasUnsavedChanges = false;
            alert('Configuration settings saved successfully!');
        } catch (error) {
            console.error('Error saving configuration:', error);
            alert(`Error saving configuration: ${error.message}`);
        } finally {
            if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = '<i class="fas fa-save mr-2"></i>Save Configuration'; }
        }
    }

    async function handleSaveAiSettings(event) {
        event.preventDefault();
        if (!aiSettingsForm || !companyId) return;
        const formData = new FormData(aiSettingsForm);
        const aiSettingsData = {
            model: formData.get('aiModel'),
            personality: formData.get('aiCorePersonality'),
            knowledgeBaseSource: formData.get('knowledgeBaseSource')?.trim() || '',
            sentimentAnalysis: aiSettingsForm.querySelector('#sentimentAnalysis')?.checked || false,
            dataLogging: aiSettingsForm.querySelector('#dataLogging')?.checked || true,
            llmFallbackEnabled: llmFallbackEnabledCheckbox?.checked || false,
            customEscalationMessage: formData.get('customEscalationMessage')?.trim() || ''
        };
        const saveButton = aiSettingsForm.querySelector('button[type="submit"]');
        if (saveButton) { saveButton.disabled = true; saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }
        try {
            const response = await fetch(`/api/company/${companyId}/aisettings`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiSettings: aiSettingsData })
            });
            if (!response.ok) { const err = await response.json().catch(() => ({ message: `Failed to save AI settings. Status: ${response.status}` })); throw new Error(err.message); }
            const updatedCompany = await response.json();
            currentCompanyData.aiSettings = updatedCompany.aiSettings || {};
            populateAiSettingsForm(currentCompanyData.aiSettings);
            hasUnsavedChanges = false;
            alert('AI Core Settings saved successfully!');
        } catch (error) {
            console.error('Error saving AI settings:', error);
            alert(`Error saving AI settings: ${error.message}`);
        } finally {
            if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = '<i class="fas fa-save mr-2"></i>Save AI Core Settings'; }
        }
    }

    async function reportMalfunction(currentCompanyId, errorMessage) {
        if (!currentCompanyId) { console.error("Cannot report malfunction: Company ID is missing."); return; }
        if (!errorMessage || typeof errorMessage !== 'string' || errorMessage.trim() === "") { console.error("Cannot report malfunction: Error message is invalid."); return; }
        console.log(`Reporting malfunction for company ${currentCompanyId}: ${errorMessage}`);
        try {
            const response = await fetch('/api/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify({ companyId: currentCompanyId, error: errorMessage, timestamp: new Date().toISOString(), }),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'HTTP error! Status: ${response.status}' }));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            console.log('Malfunction reported successfully:', await response.json());
        } catch (error) {
            console.error('Failed to report malfunction:', error);
        }
    }

    function initializeAgentSetupInteractivity() {
        if (!agentSetupPageContainer) {
            console.warn("initializeAgentSetupInteractivity: agentSetupPageContainer not found.");
            return;
        }
        trackUnsavedChanges('agent-setup-form');
        greetingTypeTtsRadio?.addEventListener('change', updateGreetingTypeUI);
        greetingTypeAudioRadio?.addEventListener('change', updateGreetingTypeUI);
        greetingAudioFileInput?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const res = await fetch('/api/upload/greeting', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fileName: file.name, data: reader.result })
                    });
                    if (!res.ok) throw new Error('Upload failed');
                    const data = await res.json();
                    uploadedGreetingAudioUrl = data.url;
                    if (greetingAudioPreview) {
                        greetingAudioPreview.src = uploadedGreetingAudioUrl;
                        greetingAudioPreview.classList.remove('hidden');
                    }
                    showToast('Audio uploaded successfully');
                } catch (err) {
                    console.error('Audio upload error', err);
                    alert('Failed to upload audio');
                }
            };
            reader.readAsDataURL(file);
        });
        const saveAgentSetupBtnLocal = agentSetupPageContainer.querySelector('#save-agent-setup-button');
        if (saveAgentSetupBtnLocal && !saveAgentSetupBtnLocal.dataset.listenerAttached) {
            saveAgentSetupBtnLocal.addEventListener('click', handleSaveAgentSetup);
            saveAgentSetupBtnLocal.dataset.listenerAttached = 'true';
        }
        
        const agentModeSelectElement = agentSetupPageContainer.querySelector('#agentModeSelect'); 
        const mainAgentScriptOuterDiv = agentSetupPageContainer.querySelector('div[data-section-name="agent-script"] div[data-section-type="full"]');
        function toggleAgentSetupSectionsVisibility(mode) {
            agentSetupPageContainer.querySelectorAll('.agent-setup-section-container').forEach(section => {
                const sectionType = section.getAttribute('data-section-type');
                let shouldBeHidden = false;
                if (mode === 'receptionist' && sectionType && sectionType.includes('full') && !sectionType.includes('receptionist')) {
                    shouldBeHidden = true;
                }
                section.classList.toggle('hidden-by-mode', shouldBeHidden);
            });
            if (mainAgentScriptOuterDiv) {
                mainAgentScriptOuterDiv.classList.toggle('hidden-by-mode', mode === 'receptionist');
            }
        }
        if (agentModeSelectElement) { 
            agentModeSelectElement.addEventListener('change', (event) => toggleAgentSetupSectionsVisibility(event.target.value));
             if(currentCompanyData?.agentSetup?.agentMode) {
                 toggleAgentSetupSectionsVisibility(currentCompanyData.agentSetup.agentMode);
            } else if (agentModeSelectElement.value) { 
                 toggleAgentSetupSectionsVisibility(agentModeSelectElement.value);
            } else {
                 toggleAgentSetupSectionsVisibility('full'); 
            }
        }
        
        const selectedCategoriesListLocal = agentSetupPageContainer.querySelector('#selectedCategoriesList');
        agentSetupPageContainer.addEventListener('change', (event) => {
            if (event.target.name === 'category' && event.target.type === 'checkbox') {
                if (selectedCategoriesListLocal) {
                    const checkedCategories = Array.from(agentSetupPageContainer.querySelectorAll('input[name="category"]:checked'))
                        .map(cb => `<li>${escapeHTML(cb.value)}</li>`).join('');
                    selectedCategoriesListLocal.innerHTML = checkedCategories || '<li class="text-gray-500 italic">No categories selected yet.</li>';
                }
                loadAndDisplayCategoryQAs();
            }
        });
        
        const timezoneSelectElement = agentSetupPageContainer.querySelector('#agentSetupTimezoneSelect'); 
        const currentTimeDisplayElement = agentSetupPageContainer.querySelector('#agentSetupCurrentTimeDisplay'); 

        function updateCurrentTimeAgentSetup() {
            if (!timezoneSelectElement || !currentTimeDisplayElement) return;
            const selectedTimezone = timezoneSelectElement.value;
            try {
                const timeString = new Date().toLocaleTimeString('en-US', { timeZone: selectedTimezone, hour: '2-digit', minute: '2-digit', hour12: true });
                const tzData = ianaTimeZones.find(tz => tz.value === selectedTimezone);
                const tzLabel = tzData ? tzData.label : selectedTimezone;
                currentTimeDisplayElement.textContent = `Current Agent Time: ${timeString} ${tzLabel}`;
            } catch (e) {
                currentTimeDisplayElement.textContent = 'Could not display time for selected zone.';
            }
        }
        if (timezoneSelectElement) timezoneSelectElement.addEventListener('change', updateCurrentTimeAgentSetup);
        if (currentTimeDisplayElement && timezoneSelectElement) { 
            if(timezoneSelectElement.value) updateCurrentTimeAgentSetup(); 
            setInterval(updateCurrentTimeAgentSetup, 60000); 
        }

        const protocolToggles = agentSetupPageContainer.querySelectorAll('.protocol-toggle');
        protocolToggles.forEach(toggle => { 
            const targetId = toggle.getAttribute('data-protocol-target');
            const section = agentSetupPageContainer.querySelector(`#${targetId}`);
            const chevron = toggle.querySelector('i.fas');
            if (section && chevron) {
                section.classList.add('collapsed');
                chevron.classList.remove('fa-chevron-down'); 
                chevron.classList.add('fa-chevron-right');
                toggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    const isCollapsed = section.classList.contains('collapsed');
                    section.classList.toggle('collapsed', !isCollapsed);
                    chevron.classList.toggle('fa-chevron-right', !isCollapsed);
                    chevron.classList.toggle('fa-chevron-down', isCollapsed);
                });
            }
         });
        
        const toggle24Hours = agentSetupPageContainer.querySelector('#toggle24Hours'); 
        const opHoursListContainer = agentSetupPageContainer.querySelector('#operating-hours-list'); 

        if (toggle24Hours && opHoursListContainer) { 
            const setOperatingHoursDisabled = (isDisabled) => {
                opHoursListContainer.querySelectorAll('input[type="time"], input[type="checkbox"]:not(#toggle24Hours)').forEach(input => {
                    input.disabled = isDisabled;
                    input.classList.toggle('disabled-input', isDisabled);
                });
            };
            toggle24Hours.addEventListener('change', () => setOperatingHoursDisabled(toggle24Hours.checked));
            const initialDisabledState = currentCompanyData?.agentSetup?.use247Routing ?? toggle24Hours.checked; 
            setOperatingHoursDisabled(initialDisabledState); 
        }
        
        function setupDynamicList(addButtonId, containerId, itemHtmlCallback, removeButtonClass) {
             const addButton = agentSetupPageContainer?.querySelector(`#${addButtonId}`);
            const container = agentSetupPageContainer?.querySelector(`#${containerId}`);
            if (!addButton || !container) {
                console.warn(`Dynamic list setup missing elements for: Button ID '${addButtonId}' or Container ID '${containerId}' within Agent Setup tab.`);
                return;
            }
            addButton.addEventListener('click', () => {
                const newItemWrapper = document.createElement('div');
                newItemWrapper.className = `dynamic-list-item`; 
                newItemWrapper.innerHTML = itemHtmlCallback(container.querySelectorAll('.dynamic-list-item').length);
                const removeBtn = newItemWrapper.querySelector(`.${removeButtonClass}`);
                if (removeBtn) {
                     removeBtn.removeEventListener('click', handleDynamicItemRemove);
                    removeBtn.addEventListener('click', handleDynamicItemRemove);
                }
                container.appendChild(newItemWrapper);
                hasUnsavedChanges = true;
                if (containerId === 'placeholders-list') {
                    updatePlaceholderSelectOptions();
                    updateAllPreviews();
                }
            });
        }
        
        setupDynamicList('add-call-routing-option', 'call-routing-list', (idx) => `<div class="flex items-end space-x-2 mt-2"><input type="text" name="callRoutingName_${idx}" placeholder="Department / Name" class="form-input flex-1"><input type="tel" name="callRoutingPhone_${idx}" placeholder="Phone Number (E.164)" class="form-input flex-1"><button type="button" class="remove-call-routing form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-call-routing');
        setupDynamicList('add-after-hours-routing-option', 'after-hours-routing-list', (idx) => `<div class="flex items-end space-x-2 mt-2"><input type="text" name="ahRoutingName_${idx}" placeholder="e.g., On-Call Tech" class="form-input flex-1"><input type="tel" name="ahRoutingPhone_${idx}" placeholder="Phone Number (E.164)" class="form-input flex-1"><button type="button" class="remove-ah-route form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-ah-route');
        setupDynamicList('add-call-summary-recipient', 'call-summaries-list', (idx) => `<div class="flex items-end space-x-2 mt-2"><input type="text" name="summaryRecipient_${idx}" placeholder="Email or Phone Number" class="form-input flex-1"><button type="button" class="remove-summary-recipient form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-summary-recipient');
        setupDynamicList('add-after-hours-notification-recipient', 'after-hours-notifications-list', (idx) => `<div class="flex items-end space-x-2 mt-2"><input type="text" name="ahNotificationRecipient_${idx}" placeholder="Email or Phone Number" class="form-input flex-1"><button type="button" class="remove-ah-notification form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-ah-notification');
        setupDynamicList('add-malfunction-forwarding-number', 'malfunction-forwarding-list', (idx) => `<div class="flex items-end space-x-2 mt-2"><input type="tel" name="mfForwardingPhone_${idx}" placeholder="Phone Number (E.164)" class="form-input flex-1"><button type="button" class="remove-mf-forward form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-mf-forward');
        setupDynamicList('add-malfunction-notification-recipient', 'malfunction-notifications-list', (idx) => `<div class="flex items-end space-x-2 mt-2"><input type="tel" name="mfNotificationRecipient_${idx}" placeholder="Phone Number (E.164) for SMS" class="form-input flex-1" value="${escapeHTML(item.phoneNumber || item.contact || '')}"><button type="button" class="remove-mf-notify form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-mf-notify');
        setupDynamicList('add-placeholder-btn', 'placeholders-list', (idx) => `<div class="flex items-end space-x-2 mt-1"><input type="text" name="placeholderName_${idx}" placeholder="Name" class="form-input flex-1"><input type="text" name="placeholderValue_${idx}" placeholder="Value" class="form-input flex-1"><button type="button" class="remove-placeholder form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-placeholder');

        if (placeholdersListContainer) {
            placeholdersListContainer.addEventListener('input', () => {
                updatePlaceholderSelectOptions();
                updateAllPreviews();
            });
        }

        if (insertPlaceholderBtn && placeholderSelect && companyQnaAnswer) {
            insertPlaceholderBtn.addEventListener('click', () => {
                const token = placeholderSelect.value;
                if (!token) return;
                const placeholder = `{{${token}}}`;
                const start = companyQnaAnswer.selectionStart || 0;
                const end = companyQnaAnswer.selectionEnd || 0;
                const val = companyQnaAnswer.value;
                companyQnaAnswer.value = val.slice(0, start) + placeholder + val.slice(end);
                companyQnaAnswer.focus();
                companyQnaAnswer.selectionStart = companyQnaAnswer.selectionEnd = start + placeholder.length;
                companyQnaAnswer.dispatchEvent(new Event('input'));
            });
        }

        if (addSchedulingRuleButton && serviceSchedulingRulesContainer) {
            addSchedulingRuleButton.addEventListener('click', () => {
                const newRuleHTML = createSchedulingRuleHTML({}, `new_${Date.now()}`);
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = newRuleHTML;
                const newRuleElement = tempContainer.firstElementChild; 
                
                if (newRuleElement) {
                    serviceSchedulingRulesContainer.appendChild(newRuleElement);
                    attachSchedulingRuleEventListeners(newRuleElement); 
                    hasUnsavedChanges = true; 
                    refreshInterpreterForRule(newRuleElement); 
                }
            });
        }
    }

    // Setup AI Voice Tab function
    function setupAiVoiceTab() {
        console.log('Setting up AI Voice tab...');
        // This function sets up the AI voice configuration UI
        // Add voice-related initialization here if needed
    }

    // --- AGENT MONITORING & OVERSIGHT SYSTEM --- //
    
    // Monitoring system state
    let monitoringData = {
        pendingReviews: 0,
        flaggedInteractions: 0,
        approvalRate: 0,
        recentActivity: []
    };

    // Initialize monitoring system
    function initializeMonitoringSystem() {
        console.log('🎯 initializeMonitoringSystem called');
        console.log('🎯 Company ID available:', !!companyId, companyId);
        console.log('🎯 Company data available:', !!currentCompanyData);
        console.log('🎯 Agent setup container:', !!agentSetupPageContainer);
        
        if (!companyId) {
            console.error('❌ Cannot initialize monitoring: No company ID available');
            showMonitoringNotification('Company ID not found - monitoring disabled', 'warning');
            return;
        }
        
        if (!currentCompanyData) {
            console.error('❌ Cannot initialize monitoring: Company data not loaded');
            showMonitoringNotification('Company data not loaded - monitoring disabled', 'warning');
            return;
        }
        
        // Check if monitoring UI elements exist before setting up
        const monitoringSection = document.getElementById('agent-monitoring-section');
        if (!monitoringSection) {
            console.warn('⚠️ Monitoring UI section not found - monitoring system available but UI not loaded');
            return;
        }
        
        console.log('✅ Initializing monitoring for company:', currentCompanyData.name || companyId);
        setupMonitoringEventListeners();
        loadMonitoringData();
        startRealTimeUpdates();
        
        showMonitoringNotification('Monitoring system initialized', 'success');
    }

    // Setup event listeners for monitoring interface - ENHANCED LINE BY LINE
    function setupMonitoringEventListeners() {
        console.log('🔧 [STEP 1] Setting up monitoring event listeners...');
        
        // STEP 1: Find and setup dashboard button
        console.log('🎛️ [STEP 1.1] Setting up dashboard button...');
        const openDashboardBtn = document.getElementById('open-monitoring-dashboard');
        if (openDashboardBtn) {
            // Remove any existing listeners
            openDashboardBtn.replaceWith(openDashboardBtn.cloneNode(true));
            const newDashboardBtn = document.getElementById('open-monitoring-dashboard');
            
            newDashboardBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🎛️ Dashboard button clicked');
                openMonitoringDashboard();
            });
            console.log('✅ [STEP 1.1] Dashboard button listener added');
        } else {
            console.warn('⚠️ [STEP 1.1] Dashboard button not found in DOM');
        }
        
        // STEP 2: Find and setup review pending button
        console.log('👀 [STEP 1.2] Setting up review pending button...');
        const reviewPendingBtn = document.getElementById('review-pending-interactions');
        if (reviewPendingBtn) {
            reviewPendingBtn.replaceWith(reviewPendingBtn.cloneNode(true));
            const newReviewBtn = document.getElementById('review-pending-interactions');
            
            newReviewBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('👀 Review pending button clicked');
                openPendingReviews();
            });
            console.log('✅ [STEP 1.2] Review pending button listener added');
        } else {
            console.warn('⚠️ [STEP 1.2] Review pending button not found in DOM');
        }
        
        // STEP 3: Find and setup view flagged button
        console.log('🚩 [STEP 1.3] Setting up view flagged button...');
        const viewFlaggedBtn = document.getElementById('view-flagged-items');
        if (viewFlaggedBtn) {
            viewFlaggedBtn.replaceWith(viewFlaggedBtn.cloneNode(true));
            const newFlaggedBtn = document.getElementById('view-flagged-items');
            
            newFlaggedBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🚩 View flagged button clicked');
                openFlaggedItems();
            });
            console.log('✅ [STEP 1.3] View flagged button listener added');
        } else {
            console.warn('⚠️ [STEP 1.3] View flagged button not found in DOM');
        }
        
        // STEP 4: Find and setup export data button
        console.log('📥 [STEP 1.4] Setting up export data button...');
        const exportDataBtn = document.getElementById('export-monitoring-data');
        if (exportDataBtn) {
            exportDataBtn.replaceWith(exportDataBtn.cloneNode(true));
            const newExportBtn = document.getElementById('export-monitoring-data');
            
            newExportBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('📥 Export data button clicked');
                exportMonitoringData();
            });
            console.log('✅ [STEP 1.4] Export data button listener added');
        } else {
            console.warn('⚠️ [STEP 1.4] Export data button not found in DOM');
        }

        // STEP 5: Setup configuration checkboxes
        console.log('⚙️ [STEP 2] Setting up configuration checkboxes...');
        const configCheckboxes = [
            'auto-flag-repeats',
            'require-approval', 
            'alert-on-flags',
            'detailed-logging'
        ];

        configCheckboxes.forEach((checkboxId, index) => {
            console.log(`📋 [STEP 2.${index + 1}] Setting up checkbox: ${checkboxId}`);
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    console.log(`📋 Checkbox ${checkboxId} changed to:`, e.target.checked);
                    updateMonitoringConfig();
                });
                console.log(`✅ [STEP 2.${index + 1}] Checkbox ${checkboxId} listener added`);
            } else {
                console.warn(`⚠️ [STEP 2.${index + 1}] Checkbox ${checkboxId} not found in DOM`);
            }
        });

        // STEP 6: Setup repeat threshold selector
        console.log('🔢 [STEP 3] Setting up repeat threshold selector...');
        const repeatThresholdSelect = document.getElementById('repeat-threshold');
        if (repeatThresholdSelect) {
            repeatThresholdSelect.addEventListener('change', (e) => {
                console.log('🔢 Repeat threshold changed to:', e.target.value);
                updateMonitoringConfig();
            });
            console.log('✅ [STEP 3] Repeat threshold selector listener added');
        } else {
            console.warn('⚠️ [STEP 3] Repeat threshold selector not found in DOM');
        }

        // STEP 7: Add keyboard shortcuts
        console.log('⌨️ [STEP 4] Setting up keyboard shortcuts...');
        document.addEventListener('keydown', (e) => {
            // Ctrl+M to open monitoring dashboard
            if (e.ctrlKey && e.key === 'm') {
                e.preventDefault();
                console.log('⌨️ Keyboard shortcut: Ctrl+M (Dashboard)');
                openMonitoringDashboard();
            }
            // Ctrl+R to open pending reviews
            if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                console.log('⌨️ Keyboard shortcut: Ctrl+R (Reviews)');
                openPendingReviews();
            }
        });
        console.log('✅ [STEP 4] Keyboard shortcuts added');

        // STEP 8: Setup auto-refresh toggle
        console.log('🔄 [STEP 5] Setting up auto-refresh controls...');
        addAutoRefreshControls();
        console.log('✅ [STEP 5] Auto-refresh controls added');

        console.log('🎉 [COMPLETE] All monitoring event listeners setup successfully');
    }

    // Add auto-refresh controls to monitoring interface
    function addAutoRefreshControls() {
        const statusContainer = document.getElementById('monitoring-status')?.parentElement;
        if (statusContainer) {
            const refreshToggle = document.createElement('div');
            refreshToggle.className = 'text-xs mt-2';
            refreshToggle.innerHTML = `
                <label class="flex items-center cursor-pointer">
                    <input type="checkbox" id="auto-refresh-toggle" class="mr-1" checked>
                    <span class="text-gray-600">Auto-refresh (30s)</span>
                </label>
            `;
            statusContainer.appendChild(refreshToggle);

            const toggleCheckbox = document.getElementById('auto-refresh-toggle');
            toggleCheckbox.addEventListener('change', (e) => {
                console.log('🔄 Auto-refresh toggled:', e.target.checked);
                if (e.target.checked) {
                    startRealTimeUpdates();
                } else {
                    stopRealTimeUpdates();
                }
            });
        }
    }

    // Load monitoring data from backend - ENHANCED LINE BY LINE
    async function loadMonitoringData() {
        console.log('🔍 [STEP 1] Starting loadMonitoringData function...');
        
        try {
            // STEP 1: Validate company ID
            if (!companyId) {
                console.error('❌ [STEP 1] No company ID available for monitoring data');
                showMonitoringNotification('Company ID not found', 'error');
                return;
            }
            console.log('✅ [STEP 1] Company ID validated:', companyId);

            // STEP 2: Construct API endpoint URL
            const apiUrl = `/api/monitoring/dashboard/${companyId}`;
            console.log('🌐 [STEP 2] API URL constructed:', apiUrl);

            // STEP 3: Make fetch request with error handling
            console.log('📡 [STEP 3] Making fetch request...');
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            console.log('📡 [STEP 3] Response received:', response.status, response.statusText);
            
            // STEP 4: Handle response based on status
            if (response.ok) {
                console.log('✅ [STEP 4] Response OK, parsing JSON...');
                const data = await response.json();
                console.log('📊 [STEP 4] Monitoring data loaded:', data);
                console.log('🎯 [STEP 5] Calling updateMonitoringDisplay...');
                updateMonitoringDisplay(data);
                monitoringData = data;
                console.log('✅ [STEP 5] Monitoring data successfully loaded and displayed');
            } else if (response.status === 404) {
                console.log('⚠️ [STEP 4] No monitoring data found (404), initializing empty data...');
                // Initialize with empty data
                const emptyData = {
                    companyName: currentCompanyData?.name || 'Unknown Company',
                    pendingReviews: 0,
                    flaggedInteractions: 0,
                    approvalRate: 0,
                    recentActivity: [],
                    analytics: {
                        totalInteractions: 0,
                        averageConfidence: 0,
                        escalationRate: 0,
                        approvedInteractions: 0,
                        disapprovedInteractions: 0
                    }
                };
                console.log('🔄 [STEP 5] Updating display with empty data...');
                updateMonitoringDisplay(emptyData);
                monitoringData = emptyData;
                console.log('✅ [STEP 5] Empty monitoring data initialized');
            } else if (response.status === 500) {
                console.error('💥 [STEP 4] Server error (500), monitoring system may not be initialized');
                const errorData = await response.text();
                console.error('💥 [STEP 4] Server error details:', errorData);
                throw new Error(`Server Error: Monitoring system initialization required`);
            } else {
                console.error(`❌ [STEP 4] HTTP Error ${response.status}: ${response.statusText}`);
                const errorText = await response.text();
                console.error('❌ [STEP 4] Error details:', errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('💥 [ERROR] loadMonitoringData failed:', error);
            console.error('💥 [ERROR] Error stack:', error.stack);
            
            // Show user-friendly error message
            let errorMessage = 'Failed to load monitoring data';
            if (error.message.includes('fetch')) {
                errorMessage = 'Network error - please check connection';
            } else if (error.message.includes('Server Error')) {
                errorMessage = 'Monitoring system initializing - please wait';
            } else if (error.message.includes('404')) {
                errorMessage = 'Monitoring data not found - will initialize';
            }
            
            showMonitoringNotification(errorMessage, 'error');
            
            // Initialize with error state but still show UI
            const errorData = {
                companyName: currentCompanyData?.name || 'Unknown Company',
                pendingReviews: '?',
                flaggedInteractions: '?',
                approvalRate: '?',
                recentActivity: [{
                    type: 'error',
                    title: 'Monitoring System Status',
                    description: 'Initializing or temporarily unavailable',
                    timestamp: new Date()
                }],
                analytics: {
                    totalInteractions: '?',
                    averageConfidence: '?',
                    escalationRate: '?'
                }
            };
            updateMonitoringDisplay(errorData);
            monitoringData = errorData;
        }
    }

    // Update monitoring display with fresh data - ENHANCED LINE BY LINE
    function updateMonitoringDisplay(data) {
        console.log('🎨 [STEP 1] Starting updateMonitoringDisplay with data:', data);
        
        // STEP 1: Validate input data
        if (!data || typeof data !== 'object') {
            console.error('❌ [STEP 1] Invalid data provided to updateMonitoringDisplay:', data);
            return;
        }
        console.log('✅ [STEP 1] Data validation passed');
        
        // STEP 2: Update pending reviews metric
        console.log('📊 [STEP 2] Updating pending reviews...');
        const pendingReviewsEl = document.getElementById('pending-reviews');
        if (pendingReviewsEl) {
            const pendingCount = data.pendingReviews || 0;
            pendingReviewsEl.textContent = pendingCount;
            console.log('✅ [STEP 2] Pending reviews updated to:', pendingCount);
            
            // Update the warning indicator
            const parentEl = pendingReviewsEl.closest('.bg-white');
            if (parentEl) {
                const warningEl = parentEl.querySelector('.text-orange-600, .text-green-600');
                if (warningEl) {
                    if (pendingCount > 0) {
                        warningEl.textContent = '⚠️ Needs attention';
                        warningEl.className = 'text-xs text-orange-600';
                    } else {
                        warningEl.textContent = '✓ All reviewed';
                        warningEl.className = 'text-xs text-green-600';
                    }
                }
            }
        } else {
            console.warn('⚠️ [STEP 2] pending-reviews element not found in DOM');
        }
        
        // STEP 3: Update flagged interactions metric
        console.log('🚩 [STEP 3] Updating flagged interactions...');
        const flaggedInteractionsEl = document.getElementById('flagged-interactions');
        if (flaggedInteractionsEl) {
            const flaggedCount = data.flaggedInteractions || 0;
            flaggedInteractionsEl.textContent = flaggedCount;
            console.log('✅ [STEP 3] Flagged interactions updated to:', flaggedCount);
            
            // Update the flag indicator
            const parentEl = flaggedInteractionsEl.closest('.bg-white');
            if (parentEl) {
                const flagEl = parentEl.querySelector('.text-red-600, .text-green-600');
                if (flagEl) {
                    if (flaggedCount > 0) {
                        flagEl.textContent = '🚩 Requires review';
                        flagEl.className = 'text-xs text-red-600';
                    } else {
                        flagEl.textContent = '✓ No flags';
                        flagEl.className = 'text-xs text-green-600';
                    }
                }
            }
        } else {
            console.warn('⚠️ [STEP 3] flagged-interactions element not found in DOM');
        }
        
        // STEP 4: Update approval rate metric
        console.log('📈 [STEP 4] Updating approval rate...');
        const approvalRateEl = document.getElementById('approval-rate');
        if (approvalRateEl) {
            let rate;
            if (typeof data.approvalRate === 'number') {
                rate = Math.round(data.approvalRate * 100);
            } else if (typeof data.approvalRate === 'string') {
                rate = data.approvalRate;
            } else {
                rate = 0;
            }
            approvalRateEl.textContent = typeof rate === 'number' ? `${rate}%` : rate;
            console.log('✅ [STEP 4] Approval rate updated to:', rate);
            
            // Update the performance indicator
            const parentEl = approvalRateEl.closest('.bg-white');
            if (parentEl) {
                const perfEl = parentEl.querySelector('.text-green-600, .text-orange-600, .text-red-600');
                if (perfEl && typeof rate === 'number') {
                    if (rate >= 80) {
                        perfEl.textContent = '✓ Good performance';
                        perfEl.className = 'text-xs text-green-600';
                    } else if (rate >= 60) {
                        perfEl.textContent = '⚠️ Needs improvement';
                        perfEl.className = 'text-xs text-orange-600';
                    } else {
                        perfEl.textContent = '⚠️ Poor performance';
                        perfEl.className = 'text-xs text-red-600';
                    }
                }
            }
        } else {
            console.warn('⚠️ [STEP 4] approval-rate element not found in DOM');
        }

        // STEP 5: Update monitoring status
        console.log('🟢 [STEP 5] Updating monitoring status...');
        const monitoringStatusEl = document.getElementById('monitoring-status');
        if (monitoringStatusEl) {
            // Determine status based on data freshness and errors
            let status = 'ACTIVE';
            let statusClass = 'text-green-600';
            
            if (data.error) {
                status = 'ERROR';
                statusClass = 'text-red-600';
            } else if (data.pendingReviews === '?' || data.flaggedInteractions === '?') {
                status = 'INIT';
                statusClass = 'text-orange-600';
            }
            
            monitoringStatusEl.textContent = status;
            monitoringStatusEl.className = `text-2xl font-bold ${statusClass}`;
            console.log('✅ [STEP 5] Monitoring status updated to:', status);
        } else {
            console.warn('⚠️ [STEP 5] monitoring-status element not found in DOM');
        }

        // STEP 6: Update activity feed
        console.log('📋 [STEP 6] Updating activity feed...');
        try {
            updateActivityFeed(data.recentActivity || []);
            console.log('✅ [STEP 6] Activity feed updated successfully');
        } catch (error) {
            console.error('❌ [STEP 6] Error updating activity feed:', error);
        }

        // STEP 7: Update analytics
        console.log('📊 [STEP 7] Updating monitoring analytics...');
        try {
            updateMonitoringAnalytics(data.analytics || {});
            console.log('✅ [STEP 7] Analytics updated successfully');
        } catch (error) {
            console.error('❌ [STEP 7] Error updating analytics:', error);
        }
        
        console.log('🎉 [COMPLETE] updateMonitoringDisplay finished successfully');
    }

    // Update activity feed - ENHANCED LINE BY LINE
    function updateActivityFeed(activities) {
        console.log('📋 [STEP 1] Starting updateActivityFeed with activities:', activities);
        
        // STEP 1: Find the feed container
        const feedContainer = document.getElementById('monitoring-activity-feed');
        if (!feedContainer) {
            console.error('❌ [STEP 1] Activity feed container not found in DOM');
            return;
        }
        console.log('✅ [STEP 1] Feed container found');

        // STEP 2: Validate activities array
        if (!Array.isArray(activities)) {
            console.warn('⚠️ [STEP 2] Activities is not an array:', typeof activities);
            activities = [];
        }
        console.log('📊 [STEP 2] Processing', activities.length, 'activities');

        // STEP 3: Clear existing content
        feedContainer.innerHTML = '';
        console.log('🧹 [STEP 3] Feed container cleared');

        // STEP 4: Handle empty state
        if (activities.length === 0) {
            console.log('📭 [STEP 4] No activities to display, showing empty state');
            feedContainer.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-history text-gray-300 text-3xl mb-3"></i>
                    <p class="text-gray-500 text-sm">No recent monitoring activity</p>
                    <p class="text-gray-400 text-xs">Activity will appear here as interactions are processed</p>
                </div>
            `;
            return;
        }

        // STEP 5: Process and display activities
        console.log('🔄 [STEP 5] Creating activity elements...');
        const maxActivities = 10;
        const activitiesToShow = activities.slice(0, maxActivities);
        
        activitiesToShow.forEach((activity, index) => {
            try {
                console.log(`📝 [STEP 5.${index + 1}] Creating activity element for:`, activity.type);
                const activityEl = createActivityElement(activity);
                feedContainer.appendChild(activityEl);
                console.log(`✅ [STEP 5.${index + 1}] Activity element added successfully`);
            } catch (error) {
                console.error(`❌ [STEP 5.${index + 1}] Error creating activity element:`, error);
                // Add error placeholder
                const errorEl = document.createElement('div');
                errorEl.className = 'text-red-500 text-sm p-2 bg-red-50 rounded';
                errorEl.textContent = 'Error displaying activity';
                feedContainer.appendChild(errorEl);
            }
        });

        // STEP 6: Add "more activities" indicator if needed
        if (activities.length > maxActivities) {
            console.log(`📊 [STEP 6] Adding "more activities" indicator (${activities.length - maxActivities} more)`);
            const moreEl = document.createElement('div');
            moreEl.className = 'text-center py-2 border-t border-gray-200 mt-3';
            moreEl.innerHTML = `
                <button class="text-blue-600 hover:text-blue-800 text-sm font-medium" onclick="loadAllActivities()">
                    <i class="fas fa-chevron-down mr-1"></i>
                    View ${activities.length - maxActivities} more activities
                </button>
            `;
            feedContainer.appendChild(moreEl);
        }

        console.log('🎉 [COMPLETE] updateActivityFeed finished successfully');
    }

    // Create activity element - ENHANCED LINE BY LINE
    function createActivityElement(activity) {
        console.log('🎨 [STEP 1] Creating activity element for:', activity);
        
        // STEP 1: Validate activity object
        if (!activity || typeof activity !== 'object') {
            console.error('❌ [STEP 1] Invalid activity object:', activity);
            throw new Error('Invalid activity object');
        }
        
        // STEP 2: Determine activity styling based on type
        let borderColor, iconClass, iconColor, bgColor;
        const activityType = activity.type || 'unknown';
        
        console.log('🎭 [STEP 2] Determining styling for activity type:', activityType);
        
        switch (activityType) {
            case 'flag':
                borderColor = 'border-orange-400';
                iconClass = 'fas fa-flag';
                iconColor = 'text-orange-500';
                bgColor = 'bg-orange-50';
                break;
            case 'approval':
                borderColor = 'border-green-400';
                iconClass = 'fas fa-check';
                iconColor = 'text-green-500';
                bgColor = 'bg-green-50';
                break;
            case 'disapproval':
                borderColor = 'border-red-400';
                iconClass = 'fas fa-times';
                iconColor = 'text-red-500';
                bgColor = 'bg-red-50';
                break;
            case 'error':
                borderColor = 'border-red-600';
                iconClass = 'fas fa-exclamation-triangle';
                iconColor = 'text-red-600';
                bgColor = 'bg-red-50';
                break;
            case 'review':
                borderColor = 'border-blue-400';
                iconClass = 'fas fa-eye';
                iconColor = 'text-blue-500';
                bgColor = 'bg-blue-50';
                break;
            case 'system':
                borderColor = 'border-purple-400';
                iconClass = 'fas fa-cog';
                iconColor = 'text-purple-500';
                bgColor = 'bg-purple-50';
                break;
            default:
                borderColor = 'border-gray-400';
                iconClass = 'fas fa-info';
                iconColor = 'text-gray-500';
                bgColor = 'bg-gray-50';
        }
        console.log('✅ [STEP 2] Styling determined:', { borderColor, iconClass, iconColor });

        // STEP 3: Create DOM element
        console.log('🏗️ [STEP 3] Creating DOM element...');
        const div = document.createElement('div');
        
        // STEP 4: Set element classes
        div.className = `flex items-center text-sm text-gray-700 ${bgColor} rounded-lg p-3 border-l-4 ${borderColor} hover:shadow-sm transition-shadow duration-200`;
        console.log('✅ [STEP 4] Element classes set');

        // STEP 5: Prepare content data with fallbacks
        const title = activity.title || 'Unknown Activity';
        const description = activity.description || 'No description available';
        const timestamp = activity.timestamp || new Date();
        
        console.log('📝 [STEP 5] Content prepared:', { title: title.substring(0, 50), description: description.substring(0, 50) });

        // STEP 6: Format timestamp
        let timeDisplay;
        try {
            timeDisplay = formatTimeAgo(timestamp);
        } catch (error) {
            console.warn('⚠️ [STEP 6] Error formatting timestamp:', error);
            timeDisplay = 'Unknown time';
        }
        console.log('⏰ [STEP 6] Timestamp formatted:', timeDisplay);

        // STEP 7: Build HTML content
        div.innerHTML = `
            <i class="${iconClass} ${iconColor} mr-3 flex-shrink-0"></i>
            <div class="flex-1 min-w-0">
                <span class="font-medium text-gray-800 block truncate">${escapeHtml(title)}</span>
                <div class="text-xs text-gray-600 mt-1 break-words">${escapeHtml(description)}</div>
            </div>
            <span class="text-xs text-gray-400 ml-2 flex-shrink-0">${timeDisplay}</span>
        `;
        console.log('✅ [STEP 7] HTML content built');

        // STEP 8: Add click handler for detailed view (if interaction ID available)
        if (activity.interactionId) {
            div.style.cursor = 'pointer';
            div.addEventListener('click', () => {
                console.log('🖱️ Activity clicked, opening details for:', activity.interactionId);
                openActivityDetails(activity);
            });
            div.title = 'Click to view details';
        }

        console.log('🎉 [COMPLETE] Activity element created successfully');
        return div;
    }

    // Helper function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Open activity details (placeholder function)
    function openActivityDetails(activity) {
        console.log('📖 Opening activity details:', activity);
        // TODO: Implement detailed activity view modal
        showMonitoringNotification('Activity details view - coming soon', 'info');
    }

    // Update monitoring analytics
    function updateMonitoringAnalytics(analytics) {
        // This would update the analytics section with charts/graphs
        // For now, just update the simple counters shown
        const analyticsContainer = document.querySelector('.monitoring-analytics');
        if (!analyticsContainer) return;

        // Update totals if available
        if (analytics.totalInteractions) {
            const totalEl = analyticsContainer.querySelector('.total-interactions');
            if (totalEl) totalEl.textContent = analytics.totalInteractions;
        }
    }

    // Open monitoring dashboard in modal/new window - ENHANCED LINE BY LINE
    function openMonitoringDashboard() {
        console.log('🎛️ [STEP 1] Opening monitoring dashboard...');
        
        try {
            // STEP 1: Check if company ID is available
            if (!companyId) {
                console.error('❌ [STEP 1] Cannot open dashboard: No company ID');
                showMonitoringNotification('Company ID not available', 'error');
                return;
            }
            console.log('✅ [STEP 1] Company ID validated:', companyId);

            // STEP 2: Show loading state
            console.log('⏳ [STEP 2] Showing loading state...');
            showMonitoringNotification('Loading monitoring dashboard...', 'info');

            // STEP 3: Create modal backdrop
            console.log('🏗️ [STEP 3] Creating modal backdrop...');
            const existingModal = document.querySelector('.monitoring-dashboard-modal');
            if (existingModal) {
                console.log('🗑️ [STEP 3] Removing existing modal...');
                existingModal.remove();
            }

            const modal = document.createElement('div');
            modal.className = 'monitoring-dashboard-modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            console.log('✅ [STEP 3] Modal backdrop created');

            // STEP 4: Create modal content structure
            console.log('📋 [STEP 4] Building modal content...');
            modal.innerHTML = `
                <div class="bg-white rounded-lg max-w-6xl w-full mx-4 max-h-90vh overflow-hidden flex flex-col">
                    <!-- Header -->
                    <div class="flex justify-between items-center p-6 border-b">
                        <div class="flex items-center">
                            <i class="fas fa-tachometer-alt text-orange-600 text-xl mr-3"></i>
                            <h3 class="text-xl font-semibold text-gray-800">Agent Monitoring Dashboard</h3>
                            <span class="ml-3 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">LIVE</span>
                        </div>
                        <div class="flex items-center space-x-3">
                            <button id="refresh-dashboard" class="text-gray-500 hover:text-gray-700" title="Refresh Data">
                                <i class="fas fa-sync-alt"></i>
                            </button>
                            <button id="close-dashboard" class="text-gray-400 hover:text-gray-600 text-xl">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                    
                    <!-- Content -->
                    <div class="flex-1 overflow-y-auto p-6">
                        <div id="dashboard-content">
                            <div class="text-center py-8">
                                <i class="fas fa-spinner fa-spin text-gray-400 text-3xl mb-3"></i>
                                <p class="text-gray-600">Loading dashboard data...</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            console.log('✅ [STEP 4] Modal content created');

            // STEP 5: Add modal to DOM
            document.body.appendChild(modal);
            console.log('✅ [STEP 5] Modal added to DOM');

            // STEP 6: Setup close functionality
            console.log('🔒 [STEP 6] Setting up close functionality...');
            const closeBtn = modal.querySelector('#close-dashboard');
            const refreshBtn = modal.querySelector('#refresh-dashboard');
            
            closeBtn.addEventListener('click', () => {
                console.log('🔒 Dashboard close button clicked');
                modal.remove();
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    console.log('🔒 Dashboard backdrop clicked');
                    modal.remove();
                }
            });

            // ESC key to close
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    console.log('🔒 ESC key pressed, closing dashboard');
                    modal.remove();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);

            // STEP 7: Setup refresh functionality
            refreshBtn.addEventListener('click', () => {
                console.log('🔄 Dashboard refresh button clicked');
                loadDashboardContent();
            });
            console.log('✅ [STEP 6] Close and refresh functionality setup');

            // STEP 8: Load dashboard content
            console.log('📊 [STEP 7] Loading dashboard content...');
            loadDashboardContent();

            console.log('🎉 [COMPLETE] Monitoring dashboard opened successfully');

        } catch (error) {
            console.error('💥 [ERROR] Failed to open monitoring dashboard:', error);
            showMonitoringNotification('Failed to open dashboard', 'error');
        }
    }

    // Load dashboard content
    async function loadDashboardContent() {
        console.log('📊 [DASHBOARD] Loading dashboard content...');
        
        const contentContainer = document.getElementById('dashboard-content');
        if (!contentContainer) {
            console.error('❌ [DASHBOARD] Content container not found');
            return;
        }

        try {
            // Show loading state
            contentContainer.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-spinner fa-spin text-orange-600 text-3xl mb-3"></i>
                    <p class="text-gray-600">Loading real-time monitoring data...</p>
                </div>
            `;

            // Load comprehensive dashboard data
            const response = await fetch(`/api/monitoring/dashboard/${companyId}`);
            
            if (response.ok) {
                const data = await response.json();
                console.log('📊 [DASHBOARD] Data loaded:', data);
                renderDashboardContent(data);
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

        } catch (error) {
            console.error('💥 [DASHBOARD] Error loading content:', error);
            contentContainer.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-exclamation-triangle text-red-500 text-3xl mb-3"></i>
                    <p class="text-red-600">Error loading dashboard data</p>
                    <p class="text-gray-500 text-sm mt-2">${error.message}</p>
                    <button onclick="loadDashboardContent()" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                        <i class="fas fa-retry mr-2"></i>Retry
                    </button>
                </div>
            `;
        }
    }

    // Render dashboard content
    function renderDashboardContent(data) {
        console.log('🎨 [DASHBOARD] Rendering dashboard content...');
        
        const contentContainer = document.getElementById('dashboard-content');
        if (!contentContainer) return;

        // Build comprehensive dashboard HTML
        contentContainer.innerHTML = `
            <!-- Key Metrics Grid -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div class="bg-gradient-to-r from-green-500 to-green-600 rounded-lg p-6 text-white">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-green-100 text-sm">System Status</p>
                            <p class="text-2xl font-bold">ACTIVE</p>
                        </div>
                        <i class="fas fa-shield-alt text-3xl text-green-200"></i>
                    </div>
                </div>
                
                <div class="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg p-6 text-white">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-blue-100 text-sm">Pending Reviews</p>
                            <p class="text-2xl font-bold">${data.pendingReviews || 0}</p>
                        </div>
                        <i class="fas fa-clipboard-check text-3xl text-blue-200"></i>
                    </div>
                </div>
                
                <div class="bg-gradient-to-r from-orange-500 to-orange-600 rounded-lg p-6 text-white">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-orange-100 text-sm">Flagged Items</p>
                            <p class="text-2xl font-bold">${data.flaggedInteractions || 0}</p>
                        </div>
                        <i class="fas fa-flag text-3xl text-orange-200"></i>
                    </div>
                </div>
                
                <div class="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg p-6 text-white">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-purple-100 text-sm">Approval Rate</p>
                            <p class="text-2xl font-bold">${Math.round((data.approvalRate || 0) * 100)}%</p>
                        </div>
                        <i class="fas fa-thumbs-up text-3xl text-purple-200"></i>
                    </div>
                </div>
            </div>

            <!-- Charts and Activity -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <!-- Recent Activity -->
                <div class="bg-white rounded-lg border p-6">
                    <h4 class="text-lg font-semibold mb-4 flex items-center">
                        <i class="fas fa-clock text-blue-500 mr-2"></i>
                        Recent Activity
                    </h4>
                    <div class="space-y-3 max-h-64 overflow-y-auto">
                        ${(data.recentActivity || []).map(activity => `
                            <div class="flex items-center text-sm border-b pb-2">
                                <i class="fas fa-${activity.type === 'approval' ? 'check text-green-500' : activity.type === 'flag' ? 'flag text-orange-500' : 'times text-red-500'} mr-3"></i>
                                <div class="flex-1">
                                    <div class="font-medium">${activity.title}</div>
                                    <div class="text-gray-500 text-xs">${activity.description}</div>
                                </div>
                                <span class="text-xs text-gray-400">${formatTimeAgo(activity.timestamp)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Analytics Summary -->
                <div class="bg-white rounded-lg border p-6">
                    <h4 class="text-lg font-semibold mb-4 flex items-center">
                        <i class="fas fa-chart-bar text-purple-500 mr-2"></i>
                        Analytics Summary
                    </h4>
                    <div class="space-y-4">
                        <div class="flex justify-between items-center">
                            <span class="text-gray-600">Total Interactions</span>
                            <span class="font-semibold">${data.analytics?.totalInteractions || 0}</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-600">Average Confidence</span>
                            <span class="font-semibold">${Math.round((data.analytics?.averageConfidence || 0) * 100)}%</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-600">Escalation Rate</span>
                            <span class="font-semibold">${Math.round((data.analytics?.escalationRate || 0) * 100)}%</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        console.log('✅ [DASHBOARD] Content rendered successfully');
    }

    // Open pending reviews interface - ENHANCED LINE BY LINE  
    function openPendingReviews() {
        console.log('👀 [STEP 1] Opening pending reviews interface...');
        
        try {
            // STEP 1: Validate prerequisites
            if (!companyId) {
                console.error('❌ [STEP 1] Cannot open reviews: No company ID');
                showMonitoringNotification('Company ID not available', 'error');
                return;
            }
            console.log('✅ [STEP 1] Company ID validated:', companyId);

            // STEP 2: Show loading notification
            console.log('⏳ [STEP 2] Showing loading notification...');
            showMonitoringNotification('Loading pending reviews...', 'info');

            // STEP 3: Load pending interactions
            console.log('📡 [STEP 3] Loading pending interactions...');
            loadPendingInteractions();

        } catch (error) {
            console.error('💥 [ERROR] Failed to open pending reviews:', error);
            showMonitoringNotification('Failed to open pending reviews', 'error');
        }
    }

    // Open flagged items interface  
    function openFlaggedItems() {
        loadFlaggedInteractions();
    }

    // Load pending interactions for review - ENHANCED LINE BY LINE
    async function loadPendingInteractions() {
        console.log('📋 [STEP 1] Starting loadPendingInteractions...');
        
        try {
            // STEP 1: Validate company ID
            if (!companyId) {
                console.error('❌ [STEP 1] No company ID for loading pending interactions');
                showMonitoringNotification('Company ID not found', 'error');
                return;
            }
            console.log('✅ [STEP 1] Company ID validated:', companyId);

            // STEP 2: Construct API endpoint
            const apiUrl = `/api/monitoring/pending/${companyId}`;
            console.log('🌐 [STEP 2] API URL:', apiUrl);

            // STEP 3: Make API request
            console.log('📡 [STEP 3] Making API request...');
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            console.log('📡 [STEP 3] Response received:', response.status, response.statusText);

            // STEP 4: Handle response
            if (response.ok) {
                const interactions = await response.json();
                console.log('✅ [STEP 4] Pending interactions loaded:', interactions.length, 'items');
                console.log('🎭 [STEP 5] Opening interaction review modal...');
                showInteractionReviewModal(interactions, 'pending');
            } else if (response.status === 404) {
                console.log('📭 [STEP 4] No pending interactions found');
                showInteractionReviewModal([], 'pending');
            } else {
                const errorText = await response.text();
                console.error('❌ [STEP 4] API error:', response.status, errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

        } catch (error) {
            console.error('💥 [ERROR] loadPendingInteractions failed:', error);
            
            // Show user-friendly error message
            let errorMessage = 'Failed to load pending interactions';
            if (error.message.includes('fetch')) {
                errorMessage = 'Network error - please check connection';
            } else if (error.message.includes('404')) {
                errorMessage = 'No pending interactions found';
                // Still show empty modal
                showInteractionReviewModal([], 'pending');
                return;
            }
            
            showMonitoringNotification(errorMessage, 'error');
        }
    }

    // Load flagged interactions
    async function loadFlaggedInteractions() {
        try {
            const response = await fetch(`/api/monitoring/flagged/${companyId}`);
            if (response.ok) {
                const interactions = await response.json();
                showInteractionReviewModal(interactions, 'flagged');
            }
        } catch (error) {
            console.error('Error loading flagged interactions:', error);
            showMonitoringNotification('Failed to load flagged interactions', 'error');
        }
    }

    // Show interaction review modal
    function showInteractionReviewModal(interactions, type) {
        const modal = createInteractionReviewModal(interactions, type);
        document.body.appendChild(modal);
    }

    // Create interaction review modal
    function createInteractionReviewModal(interactions, type) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        const title = type === 'pending' ? 'Pending Reviews' : 'Flagged Interactions';
        
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-90vh overflow-y-auto">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-semibold">${title}</h3>
                    <button class="close-modal text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="space-y-4">
                    ${interactions.map(interaction => createInteractionCard(interaction, type)).join('')}
                </div>
            </div>
        `;

        // Add event listeners
        modal.querySelector('.close-modal').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        return modal;
    }

    // Create interaction card for review
    function createInteractionCard(interaction, type) {
        return `
            <div class="border rounded-lg p-4 bg-gray-50" data-interaction-id="${interaction._id}">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <div class="font-medium">Caller: ${interaction.callerInfo?.number || 'Unknown'}</div>
                        <div class="text-sm text-gray-500">${formatDate(interaction.timestamp)}</div>
                    </div>
                    <div class="flex space-x-2">
                        <button class="approve-btn bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm">
                            <i class="fas fa-check mr-1"></i>Approve
                        </button>
                        <button class="disapprove-btn bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm">
                            <i class="fas fa-times mr-1"></i>Disapprove
                        </button>
                        <button class="edit-btn bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm">
                            <i class="fas fa-edit mr-1"></i>Edit
                        </button>
                    </div>
                </div>
                <div class="mb-3">
                    <div class="font-medium text-sm text-gray-700">Question:</div>
                    <div class="bg-white p-2 rounded border">${interaction.userInput}</div>
                </div>
                <div class="mb-3">
                    <div class="font-medium text-sm text-gray-700">Agent Response:</div>
                    <div class="bg-white p-2 rounded border">${interaction.agentResponse}</div>
                </div>
                ${interaction.reasoning ? `
                    <div class="mb-3">
                        <div class="font-medium text-sm text-gray-700">AI Reasoning:</div>
                        <div class="bg-blue-50 p-2 rounded border text-sm">${interaction.reasoning}</div>
                    </div>
                ` : ''}
                ${interaction.flags && interaction.flags.length > 0 ? `
                    <div class="flex flex-wrap gap-1">
                        ${interaction.flags.map(flag => `
                            <span class="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded">${flag}</span>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    // Handle interaction approval
    async function approveInteraction(interactionId) {
        try {
            const response = await fetch(`/api/monitoring/approve/${interactionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId })
            });

            if (response.ok) {
                showMonitoringNotification('Interaction approved', 'success');
                loadMonitoringData(); // Refresh data
            }
        } catch (error) {
            console.error('Error approving interaction:', error);
            showMonitoringNotification('Failed to approve interaction', 'error');
        }
    }

    // Handle interaction disapproval
    async function disapproveInteraction(interactionId, reason = '') {
        try {
            const response = await fetch(`/api/monitoring/disapprove/${interactionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, reason })
            });

            if (response.ok) {
                showMonitoringNotification('Interaction disapproved and blacklisted', 'success');
                loadMonitoringData(); // Refresh data
            }
        } catch (error) {
            console.error('Error disapproving interaction:', error);
            showMonitoringNotification('Failed to disapprove interaction', 'error');
        }
    }

    // Update monitoring configuration
    async function updateMonitoringConfig() {
        const config = {
            autoFlagRepeats: document.getElementById('auto-flag-repeats')?.checked || false,
            requireApproval: document.getElementById('require-approval')?.checked || false,
            alertOnFlags: document.getElementById('alert-on-flags')?.checked || false,
            detailedLogging: document.getElementById('detailed-logging')?.checked || false,
            repeatThreshold: parseInt(document.getElementById('repeat-threshold')?.value) || 5
        };

        try {
            const response = await fetch(`/api/monitoring/config/${companyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (response.ok) {
                showMonitoringNotification('Monitoring settings updated', 'success');
            }
        } catch (error) {
            console.error('Error updating monitoring config:', error);
            showMonitoringNotification('Failed to update settings', 'error');
        }
    }

    // Export monitoring data
    async function exportMonitoringData() {
        try {
            const response = await fetch(`/api/monitoring/export/${companyId}`);
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `monitoring-data-${companyId}-${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                showMonitoringNotification('Data exported successfully', 'success');
            }
        } catch (error) {
            console.error('Error exporting monitoring data:', error);
            showMonitoringNotification('Failed to export data', 'error');
        }
    }

    // Start real-time updates - ENHANCED LINE BY LINE
    function startRealTimeUpdates() {
        console.log('🔄 [STEP 1] Starting real-time monitoring updates...');
        
        // STEP 1: Clear any existing intervals
        if (window.monitoringUpdateInterval) {
            console.log('🧹 [STEP 1] Clearing existing update interval');
            clearInterval(window.monitoringUpdateInterval);
        }

        // STEP 2: Validate prerequisites
        if (!companyId) {
            console.error('❌ [STEP 2] Cannot start updates: No company ID');
            return;
        }
        console.log('✅ [STEP 2] Company ID available for updates:', companyId);

        // STEP 3: Set up periodic updates
        const updateInterval = 30000; // 30 seconds
        console.log(`⏰ [STEP 3] Setting up updates every ${updateInterval/1000}s`);
        
        window.monitoringUpdateInterval = setInterval(async () => {
            try {
                console.log('🔄 [UPDATE] Performing scheduled monitoring data refresh...');
                
                // Check if monitoring section is visible
                const monitoringSection = document.querySelector('[data-section-name="agent-monitoring"]');
                const isVisible = monitoringSection && !monitoringSection.querySelector('.section-content.collapsed');
                
                if (isVisible) {
                    console.log('👁️ [UPDATE] Monitoring section visible, refreshing data...');
                    await loadMonitoringData();
                    console.log('✅ [UPDATE] Data refreshed successfully');
                } else {
                    console.log('👁️‍🗨️ [UPDATE] Monitoring section not visible, skipping refresh');
                }
                
            } catch (error) {
                console.error('💥 [UPDATE] Error during scheduled update:', error);
            }
        }, updateInterval);
        
        console.log('✅ [STEP 3] Real-time updates started successfully');

        // STEP 4: Add page visibility API support
        console.log('👁️ [STEP 4] Setting up page visibility monitoring...');
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('👁️ [VISIBILITY] Page hidden, pausing updates');
                stopRealTimeUpdates();
            } else {
                console.log('👁️ [VISIBILITY] Page visible, resuming updates');
                startRealTimeUpdates();
                // Immediate refresh when page becomes visible
                loadMonitoringData();
            }
        });
        console.log('✅ [STEP 4] Page visibility monitoring setup');
        
        // STEP 5: Add network status monitoring  
        console.log('🌐 [STEP 5] Setting up network status monitoring...');
        window.addEventListener('online', () => {
            console.log('🌐 [NETWORK] Connection restored, refreshing data');
            loadMonitoringData();
        });
        
        window.addEventListener('offline', () => {
            console.log('🌐 [NETWORK] Connection lost, pausing updates');
            showMonitoringNotification('Connection lost - updates paused', 'warning');
        });
        console.log('✅ [STEP 5] Network status monitoring setup');
        
        console.log('🎉 [COMPLETE] Real-time monitoring system fully initialized');
    }

    // Stop real-time updates
    function stopRealTimeUpdates() {
        console.log('⏹️ [STOP] Stopping real-time monitoring updates...');
        
        if (window.monitoringUpdateInterval) {
            clearInterval(window.monitoringUpdateInterval);
            window.monitoringUpdateInterval = null;
            console.log('✅ [STOP] Update interval cleared');
        } else {
            console.log('ℹ️ [STOP] No active update interval to clear');
        }
    }

    // Show monitoring notification
    function showMonitoringNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg text-white z-50 ${
            type === 'success' ? 'bg-green-600' : 
            type === 'error' ? 'bg-red-600' : 'bg-blue-600'
        }`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    // Utility functions
    function formatTimeAgo(timestamp) {
        const now = new Date();
        const time = new Date(timestamp);
        const diff = now - time;
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    }

    function formatDate(timestamp) {
        return new Date(timestamp).toLocaleString();
    }

    // Setup AI Voice Tab function
    function setupAiVoiceTab() {
        console.log('Setting up AI Voice tab...');
        // This function sets up the AI voice configuration UI
        // Add voice-related initialization here if needed
    }

    // Initialize monitoring system if on agent setup tab
    // Note: Monitoring will be initialized after company data is loaded in fetchCompanyData()
    console.log('Agent setup container found:', !!agentSetupPageContainer);
    console.log('Company ID from URL:', companyId);

    // We need to call these setup functions.
    // This one builds the UI
    setupAiVoiceTab(); 
    
    // *** CRITICAL: Set up form event listeners ***
    // Add personality responses form submit event listener
    if (personalityResponsesForm) {
        personalityResponsesForm.addEventListener('submit', handleSavePersonalityResponses);
        console.log('✅ Personality responses form event listener attached');
    } else {
        console.warn('⚠️ Personality responses form not found - will try again after data load');
    }
    
    // *** CRITICAL: Set up agent setup accordion functionality ***
    // This needs to run immediately when page loads, not just when company data is fetched
    if (agentSetupPageContainer) {
        const sectionHeaders = agentSetupPageContainer.querySelectorAll('.agent-setup-section-header');
        console.log(`🔧 Setting up ${sectionHeaders.length} accordion sections...`);
        
        sectionHeaders.forEach(header => {
            const sectionContent = header.nextElementSibling;
            const chevron = header.querySelector('i.fas.fa-chevron-up, i.fas.fa-chevron-down');
            if (sectionContent && chevron) { 
                // Initialize collapsed state (except for categories which should be open by default)
                if (header.parentElement?.dataset.sectionName !== 'categories') { 
                    sectionContent.classList.add('collapsed');
                    chevron.classList.remove('fa-chevron-up'); 
                    chevron.classList.add('fa-chevron-down'); 
                } else { 
                    sectionContent.classList.remove('collapsed');
                    chevron.classList.remove('fa-chevron-down'); 
                    chevron.classList.add('fa-chevron-up'); 
                }
                
                // Add click event listener for accordion functionality
                header.addEventListener('click', () => {
                    console.log('🖱️ Accordion section clicked:', header.parentElement?.dataset.sectionName);
                    sectionContent.classList.toggle('collapsed');
                    chevron.classList.toggle('fa-chevron-up');
                    chevron.classList.toggle('fa-chevron-down');
                });
                
                console.log('✅ Accordion setup for section:', header.parentElement?.dataset.sectionName);
            } else {
                console.warn('⚠️ Missing content or chevron for accordion section:', header.parentElement?.dataset.sectionName);
            }
        });
        
        console.log('🎯 Agent setup accordion initialization complete');
    } else {
        console.warn('⚠️ Agent setup container not found - accordion setup skipped');
    }
    
    // *** CRITICAL: Fetch company data on page load ***
    console.log('🚀 Starting initial company data fetch...');
    fetchCompanyData().then(() => {
        console.log('✅ Initial company data fetch completed');
    }).catch(error => {
        console.error('❌ Initial company data fetch failed:', error);
    });
    
    // Initialize behavior engine configuration
    initializeBehaviorEngine();
    
    // You must call populateAiVoiceSettings(currentCompanyData.voiceSettings) inside your main
    // fetchCompanyData() function after you get a successful response.
});

// ===========================================
// BEHAVIOR ENGINE CONFIGURATION
// ===========================================

/**
 * Initialize behavior engine configuration
 */
function initializeBehaviorEngine() {
    console.log('🧠 Initializing behavior engine configuration...');
    
    // Test behavior button
    const testBehaviorBtn = document.getElementById('test-behavior-btn');
    if (testBehaviorBtn) {
        testBehaviorBtn.addEventListener('click', testBehaviorDetection);
        console.log('✅ Behavior test button initialized');
    }
    
    // Add behavior settings to the save handler
    setupBehaviorSaveHandler();
}

/**
 * Populate behavior configuration form with current data
 */
function populateBehaviorConfiguration(behaviorConfig) {
    console.log('📝 Populating behavior configuration:', behaviorConfig);
    
    if (!behaviorConfig) {
        console.log('⚠️ No behavior configuration found, using defaults');
        return;
    }
    
    // Populate form fields
    const frustrationKeywords = document.getElementById('frustration-keywords');
    const silenceThreshold = document.getElementById('silence-threshold');
    const repetitionLimit = document.getElementById('repetition-limit');
    const offTopicKeywords = document.getElementById('off-topic-keywords');
    const useLLMSentiment = document.getElementById('use-llm-sentiment');
    const enableEmpathy = document.getElementById('enable-empathy-responses');
    
    if (frustrationKeywords) {
        frustrationKeywords.value = behaviorConfig.frustrationKeywords?.join(', ') || 'frustrated, annoyed, upset, ridiculous, terrible';
    }
    
    if (silenceThreshold) {
        silenceThreshold.value = behaviorConfig.silenceThreshold || 8;
    }
    
    if (repetitionLimit) {
        repetitionLimit.value = behaviorConfig.repetitionLimit || 3;
    }
    
    if (offTopicKeywords) {
        offTopicKeywords.value = behaviorConfig.offTopicKeywords?.join(', ') || 'spam, unrelated, politics';
    }
    
    if (useLLMSentiment) {
        useLLMSentiment.checked = behaviorConfig.useLLMForSentiment || false;
    }
    
    if (enableEmpathy) {
        enableEmpathy.checked = behaviorConfig.enableEmpathyResponses !== false; // Default to true
    }
    
    console.log('✅ Behavior configuration populated');
}

/**
 * Collect behavior configuration from form
 */
function collectBehaviorConfiguration() {
    console.log('📦 Collecting behavior configuration from form...');
    
    const frustrationKeywords = document.getElementById('frustration-keywords')?.value.split(',').map(k => k.trim()).filter(Boolean) || [];
    const silenceThreshold = parseInt(document.getElementById('silence-threshold')?.value) || 8;
    const repetitionLimit = parseInt(document.getElementById('repetition-limit')?.value) || 3;
    const offTopicKeywords = document.getElementById('off-topic-keywords')?.value.split(',').map(k => k.trim()).filter(Boolean) || [];
    const useLLMSentiment = document.getElementById('use-llm-sentiment')?.checked || false;
    const enableEmpathy = document.getElementById('enable-empathy-responses')?.checked !== false;
    
    const behaviorConfig = {
        frustrationKeywords,
        silenceThreshold,
        repetitionLimit,
        offTopicKeywords,
        useLLMForSentiment: useLLMSentiment,
        enableEmpathyResponses: enableEmpathy
    };
    
    console.log('✅ Collected behavior configuration:', behaviorConfig);
    return behaviorConfig;
}

/**
 * Test behavior detection with sample input
 */
async function testBehaviorDetection() {
    console.log('🧪 Testing behavior detection...');
    
    const testInput = document.getElementById('behavior-test-input');
    const resultDiv = document.getElementById('behavior-test-result');
    const detectionType = document.getElementById('behavior-detection-type');
    const responseText = document.getElementById('behavior-response-text');
    const actionText = document.getElementById('behavior-action');
    
    if (!testInput || !resultDiv) {
        console.error('❌ Test elements not found');
        return;
    }
    
    const query = testInput.value.trim();
    if (!query) {
        showToast('Please enter a test phrase', 'error');
        return;
    }
    
    // Show loading
    resultDiv.classList.remove('hidden');
    detectionType.textContent = 'Testing...';
    responseText.textContent = '';
    actionText.textContent = '';
    
    try {
        // Collect current behavior configuration
        const behaviorConfig = collectBehaviorConfiguration();
        
        // Test with current company data
        const response = await fetch('/api/ai-agent/test-behavior', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                companyId: currentCompanyData._id,
                behaviorConfig: behaviorConfig
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            
            if (result.behaviorDetected) {
                detectionType.textContent = result.behaviorDetected.action || 'Unknown';
                responseText.textContent = result.behaviorDetected.message || 'No response';
                actionText.textContent = result.behaviorDetected.flags?.join(', ') || 'No flags';
                
                // Color code the result
                resultDiv.className = 'mt-3 p-3 bg-red-50 border border-red-200 rounded-lg';
                showToast('Behavior detected!', 'warning');
            } else {
                detectionType.textContent = 'No behavior detected';
                responseText.textContent = 'Normal processing would continue';
                actionText.textContent = 'No special action';
                
                // Color code as normal
                resultDiv.className = 'mt-3 p-3 bg-green-50 border border-green-200 rounded-lg';
                showToast('No behavior detected - normal processing', 'success');
            }
        } else {
            throw new Error('Test failed');
        }
    } catch (error) {
        console.error('❌ Behavior test failed:', error);
        detectionType.textContent = 'Test failed';
        responseText.textContent = 'Error occurred during testing';
        actionText.textContent = 'Check console for details';
        
        resultDiv.className = 'mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg';
        showToast('Behavior test failed', 'error');
    }
}

/**
 * Setup behavior configuration save handler
 */
function setupBehaviorSaveHandler() {
    console.log('🔧 Setting up behavior save handler...');
    
    // Add behavior configuration to the main save handler
    const originalSaveHandler = window.handleSaveAgentSetup;
    if (originalSaveHandler) {
        window.handleSaveAgentSetup = function(event) {
            console.log('💾 Enhanced save handler called - including behavior configuration');
            
            // Add behavior configuration to the save data
            const behaviorConfig = collectBehaviorConfiguration();
            
            // Store in global currentCompanyData for saving
            if (currentCompanyData && currentCompanyData.agentSetup) {
                currentCompanyData.agentSetup.behaviors = behaviorConfig;
                console.log('✅ Behavior configuration added to save data');
            }
            
            // Call original save handler
            return originalSaveHandler.call(this, event);
        };
    }
    
    // Also add to the populateAgentSetupForm function
    const originalPopulateHandler = window.populateAgentSetupForm;
    if (originalPopulateHandler) {
        window.populateAgentSetupForm = function(companyData) {
            console.log('📋 Enhanced populate handler called - including behavior configuration');
            
            // Call original populate handler
            const result = originalPopulateHandler.call(this, companyData);
            
            // Add behavior configuration population
            if (companyData && companyData.agentSetup && companyData.agentSetup.behaviors) {
                populateBehaviorConfiguration(companyData.agentSetup.behaviors);
            }
            
            return result;
        };
    }
    
    console.log('✅ Behavior save handler setup complete');
}
