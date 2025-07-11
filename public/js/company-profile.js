// public/js/company-profile.js
// Final complete version, restoring all original functions and correctly integrating Calendar Settings.

document.addEventListener('DOMContentLoaded', () => {
    // --- TOP-LEVEL VARIABLES --- //
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');

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
    const twilioPhoneNumberInput = document.getElementById('twilioPhoneNumber');
    const smsJobAlertsCheckbox = document.getElementById('smsJobAlerts');
    const smsCustomerRepliesCheckbox = document.getElementById('smsCustomerReplies');
    const smsAppointmentRemindersCheckbox = document.getElementById('smsAppointmentReminders');
    
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

    // Google TTS function removed - using ElevenLabs only
    
    async function fetchCompanyData() {
        if (!companyId) {
            if (companyNameHeader) companyNameHeader.textContent = "Company Profile (No ID)";
            if (companyIdSubheader) companyIdSubheader.textContent = "ID: Not available";
            if (editProfileButton) editProfileButton.style.display = 'none';
            initializeAgentSetupInteractivity();
            populateAgentSetupForm({}, []);
            populatePersonalityResponses({});
            return;
        }
        try {
            const response = await fetch(`/api/company/${companyId}`);
            if (!response.ok) {
                let errorResponseMessage = `HTTP error! Status: ${response.status} ${response.statusText}`;
                try { const errorData = await response.json(); errorResponseMessage = errorData.message || JSON.stringify(errorData); } catch (e) { /* Ignore parsing error if response not JSON */ }
                throw new Error(errorResponseMessage);
            }
            currentCompanyData = await response.json();
            
            console.log('[JS company-profile.js] Fetched currentCompanyData:', JSON.stringify(currentCompanyData, null, 2));
            
            currentCompanyData.address = currentCompanyData.address || {};
            currentCompanyData.additionalContacts = currentCompanyData.additionalContacts || [];
            currentCompanyData.notes = currentCompanyData.notes || [];
            currentCompanyData.twilioConfig = currentCompanyData.twilioConfig || {};
            currentCompanyData.smsSettings = currentCompanyData.smsSettings || {};
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

            await fetchAvailableTradeCategories();
            populateCompanyData(currentCompanyData); 
            updateCompanyStatusDisplay(currentCompanyData.isActive);
            populateConfigurationForm(currentCompanyData.twilioConfig, currentCompanyData.smsSettings);
            
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
                    fuzzyMatchThreshold: currentCompanyData.aiSettings?.fuzzyMatchThreshold ?? 0.5,
                    speechConfirmation: currentCompanyData.aiSettings?.speechConfirmation || { enabled: false, confirmKey: 5, prompts: ["I heard: '{transcript}'. Press 5 or say yes to confirm. If not, say no or repeat."], maxAttempts: 2 },
                    logCalls: currentCompanyData.aiSettings?.logCalls ?? false
                };
                populateAiVoiceSettings(voiceSettings);
            }
            // --- END OF NEW BLOCK ---
            populatePersonalityResponses(currentCompanyData.personalityResponses || {});
            renderNotes();
            initializeAgentSetupInteractivity();
        } catch (error) {
            console.error('Error fetching company data:', error.message, error.stack);
            if (companyNameHeader) companyNameHeader.textContent = "Error Loading Profile";
            if (companyIdSubheader) companyIdSubheader.textContent = `Error: ${error.message}`;
            document.querySelectorAll('#tab-content-area > .tab-content-item').forEach(tc => tc.innerHTML = `<p class="text-red-500 p-4">Failed to load company data: ${error.message}</p>`);
        }
    }

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

    function populateConfigurationForm(twilioConfig = {}, smsSettings = {}) {
        if (!configSettingsForm) return;
        if (twilioAccountSidInput) twilioAccountSidInput.value = twilioConfig.accountSid || '';
        if (twilioAuthTokenInput) twilioAuthTokenInput.value = twilioConfig.authToken || '';
        if (twilioPhoneNumberInput) twilioPhoneNumberInput.value = twilioConfig.phoneNumber || '';
        if (smsJobAlertsCheckbox) smsJobAlertsCheckbox.checked = !!smsSettings.jobAlerts;
        if (smsCustomerRepliesCheckbox) smsCustomerRepliesCheckbox.checked = !!smsSettings.customerReplies;
        if (smsAppointmentRemindersCheckbox) smsAppointmentRemindersCheckbox.checked = !!smsSettings.appointmentReminders;
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
        { key: 'agentNotUnderstood', description: 'Agent was not understood by the caller.' }
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
            const smsSettingsToPreserve = currentCompanyData.smsSettings; 
            const notesToPreserve = currentCompanyData.notes; 
            const integrationsToPreserve = currentCompanyData.integrations;

            currentCompanyData = { 
                ...savedCompanyData, 
                agentSetup: agentSetupToPreserve,
                aiSettings: aiSettingsToPreserve,
                twilioConfig: twilioConfigToPreserve,
                smsSettings: smsSettingsToPreserve,
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
        const twilioConfigData = {
            accountSid: twilioAccountSidInput?.value.trim() || null,
            authToken: twilioAuthTokenInput?.value || null, 
            phoneNumber: twilioPhoneNumberInput?.value.trim() || null,
        };
        const smsSettingsData = {
            jobAlerts: smsJobAlertsCheckbox?.checked || false,
            customerReplies: smsCustomerRepliesCheckbox?.checked || false,
            appointmentReminders: smsAppointmentRemindersCheckbox?.checked || false,
        };
        const fullConfigData = { twilioConfig: twilioConfigData, smsSettings: smsSettingsData };
        const saveButton = configSettingsForm.querySelector('button[type="submit"]');
        if (saveButton) { saveButton.disabled = true; saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }
        try {
            const response = await fetch(`/api/company/${companyId}/configuration`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fullConfigData)
            });
            if (!response.ok) { const err = await response.json().catch(() => ({ message: `Failed to save configuration. Status: ${response.status}` })); throw new Error(err.message); }
            const updatedCompany = await response.json();
            currentCompanyData.twilioConfig = updatedCompany.twilioConfig || {};
            currentCompanyData.smsSettings = updatedCompany.smsSettings || {};
            populateConfigurationForm(currentCompanyData.twilioConfig, currentCompanyData.smsSettings);
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
        if (!llmFallbackEnabledCheckbox.checked && !customEscalationMessageInput.value.trim()) {
            alert('Please provide an escalation message.');
            if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = '<i class="fas fa-save mr-2"></i>Save AI Core Settings'; }
            return;
        }
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
                const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
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

        const sectionHeaders = agentSetupPageContainer.querySelectorAll('.agent-setup-section-header');
        sectionHeaders.forEach(header => {
            const sectionContent = header.nextElementSibling;
            const chevron = header.querySelector('i.fas.fa-chevron-up, i.fas.fa-chevron-down');
            if (sectionContent && chevron) { 
                if (header.parentElement?.dataset.sectionName !== 'categories') { 
                    sectionContent.classList.add('collapsed');
                    chevron.classList.remove('fa-chevron-up'); 
                    chevron.classList.add('fa-chevron-down'); 
                } else { 
                    sectionContent.classList.remove('collapsed');
                    chevron.classList.remove('fa-chevron-down'); 
                    chevron.classList.add('fa-chevron-up'); 
                }
                header.addEventListener('click', () => {
                    sectionContent.classList.toggle('collapsed');
                    chevron.classList.toggle('fa-chevron-up');
                    chevron.classList.toggle('fa-chevron-down');
                });
            }
        });

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
        setupDynamicList('add-malfunction-notification-recipient', 'malfunction-notifications-list', (idx) => `<div class="flex items-end space-x-2 mt-2"><input type="tel" name="mfNotificationRecipient_${idx}" placeholder="Phone Number (E.164) for SMS" class="form-input flex-1"><button type="button" class="remove-mf-notify form-button-agent-setup remove-button-agent-setup text-xs h-9">Remove</button></div>`, 'remove-mf-notify');
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

    // --- TAB SWITCHING LOGIC --- //
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content-item');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            tabButtons.forEach(b => b.classList.remove('tab-button-active'));
            tabContents.forEach(tc => tc.classList.add('hidden'));
            this.classList.add('tab-button-active');
            const tab = this.getAttribute('data-tab');
            const content = document.getElementById(`${tab}-content`);
            if (content) content.classList.remove('hidden');
        });
    });

    // --- ELEVENLABS FORM LOGIC --- //
    const elevenlabsSettingsForm = document.getElementById('elevenlabs-settings-form');
    const testElevenLabsVoiceBtn = document.getElementById('testElevenLabsVoiceBtn');
    if (elevenlabsSettingsForm) {
        elevenlabsSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!companyId) return;
            const apiKey = document.getElementById('elevenlabsApiKey')?.value || '';
            const voice = document.getElementById('elevenlabsVoice')?.value || '';
            // Add more fields as needed
            try {
                const res = await fetch(`/api/company/${companyId}/elevenlabs`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ elevenlabs: { apiKey, voice } })
                });
                if (!res.ok) throw new Error('Failed to save ElevenLabs settings');
                alert('ElevenLabs settings saved!');
            } catch (err) {
                alert('Error saving ElevenLabs settings: ' + err.message);
            }
        });
    }
    if (testElevenLabsVoiceBtn) {
        testElevenLabsVoiceBtn.addEventListener('click', async () => {
            const phrase = document.getElementById('elevenlabsTestPhrase')?.value || '';
            const voice = document.getElementById('elevenlabsVoice')?.value || '';
            const apiKey = document.getElementById('elevenlabsApiKey')?.value || '';
            if (!phrase || !voice || !apiKey) return alert('Please fill in API Key, Voice, and Test Phrase.');
            testElevenLabsVoiceBtn.disabled = true;
            testElevenLabsVoiceBtn.textContent = 'Playing...';
            try {
                const res = await fetch('/api/elevenlabs/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: phrase, voice: voice, apiKey: apiKey })
                });
                if (!res.ok) throw new Error('Failed to synthesize voice');
                const data = await res.json();
                const audioContent = data.audioContent;
                if (!audioContent) throw new Error('No audio returned');
                const binary = atob(audioContent);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const blob = new Blob([bytes.buffer], { type: 'audio/mp3' });
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.addEventListener('ended', () => {
                    testElevenLabsVoiceBtn.disabled = false;
                    testElevenLabsVoiceBtn.textContent = 'Listen to Test Phrase';
                    URL.revokeObjectURL(url);
                });
                audio.play().catch(err => {
                    testElevenLabsVoiceBtn.disabled = false;
                    testElevenLabsVoiceBtn.textContent = 'Listen to Test Phrase';
                    console.error('Playback failed', err);
                });
            } catch (err) {
                alert('Playback failed: ' + err.message);
                testElevenLabsVoiceBtn.disabled = false;
                testElevenLabsVoiceBtn.textContent = 'Listen to Test Phrase';
            }
        });
    }

    // --- SCRIPT EXECUTION START --- //
    checkForGoogleAuthStatusInURL(); // Check for auth status on page load
    populateTimezoneDropdown();
    fetchCompanyData(); 

    if (currentTimeDisplaySpan) {
        updateCurrentTimeForInterpreter(); 
        if (interpreterIntervalId) clearInterval(interpreterIntervalId); 
        interpreterIntervalId = setInterval(updateCurrentTimeForInterpreter, 30000); 
    }
    
    if (editProfileButton) { editProfileButton.addEventListener('click', () => { if (companyDetailsEditFormContainer?.classList.contains('hidden')) { showEditForm(); } else { hideEditForm(); } }); }
    if (addNewNoteButton) { addNewNoteButton.addEventListener('click', handleAddNewNote); }
    if (configSettingsForm) { configSettingsForm.addEventListener('submit', handleSaveConfiguration); trackUnsavedChanges('config-settings-form'); }
    if (aiSettingsForm) { aiSettingsForm.addEventListener('submit', handleSaveAiSettings); trackUnsavedChanges('ai-settings-form'); }
    if (personalityResponsesForm) { personalityResponsesForm.addEventListener('submit', handleSavePersonalityResponses); trackUnsavedChanges('personality-responses-form'); }
    if (llmFallbackEnabledCheckbox) {
        llmFallbackEnabledCheckbox.addEventListener('change', () => {
            if (escalationMessageContainer) {
                escalationMessageContainer.style.display = llmFallbackEnabledCheckbox.checked ? 'none' : 'block';
            }
        });
    }
    if (companyQnaForm) { companyQnaForm.addEventListener('submit', handleQnaSubmit); }
    if (companyQnaCancelBtn) { companyQnaCancelBtn.addEventListener('click', resetQnaForm); }
    updateQnaSaveBtnState();
    const testMalfunctionBtn = document.getElementById('test-malfunction-btn');
    if (testMalfunctionBtn) { testMalfunctionBtn.addEventListener('click', () => { if (companyId) { const testErrorMessage = `Simulated critical failure in AI core processing for company ${companyId} at ${new Date().toLocaleTimeString()}.`; reportMalfunction(companyId, testErrorMessage); } else { console.warn('Company ID not available to test malfunction reporting.');} }); }

    const testVoiceBtn = document.getElementById('testVoiceBtn');
    if (testVoiceBtn) {
        testVoiceBtn.addEventListener('click', async () => {
            const phraseEl = document.getElementById('ttsTestPhrase');
            const voiceEl = document.getElementById('googleVoiceSelection');
            const pitchEl = document.getElementById('googleVoicePitch');
            const speedEl = document.getElementById('googleVoiceSpeed');
            const text = phraseEl?.value || '';
            const voiceName = voiceEl?.value || '';
            const pitch = parseFloat(pitchEl?.value || '0');
            const speed = parseFloat(speedEl?.value || '1');
            if (!text || !voiceName) return;
            const originalLabel = testVoiceBtn.textContent;
            testVoiceBtn.disabled = true;
            testVoiceBtn.textContent = 'Playing...';
            try {
                // Call the backend test endpoint for Google TTS
                const params = new URLSearchParams({
                    text,
                    voice: voiceName,
                    pitch: pitch.toString(),
                    speed: speed.toString()
                });
                const res = await fetch(`/api/test/google-tts?${params.toString()}`);
                if (!res.ok) throw new Error('TTS failed');
                const data = await res.json();
                const audioContent = data.audioContent;
                if (!audioContent) throw new Error('No audio returned');
                const binary = atob(audioContent);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const blob = new Blob([bytes.buffer], { type: 'audio/mp3' });
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.addEventListener('ended', () => {
                    testVoiceBtn.disabled = false;
                    testVoiceBtn.textContent = originalLabel;
                    URL.revokeObjectURL(url);
                });
                audio.play().catch(err => {
                    testVoiceBtn.disabled = false;
                    testVoiceBtn.textContent = originalLabel;
                    console.error('Playback failed', err);
                });
            } catch (err) {
                alert('Playback failed: ' + err.message);
                testVoiceBtn.disabled = false;
                testVoiceBtn.textContent = originalLabel;
            }
        });
    }

    async function loadGeminiModels() {
        try {
            const res = await fetch('/api/ai/models');
            if (!res.ok) throw new Error('Failed to fetch Gemini models');
            const models = await res.json();
            const select = document.getElementById('aiModel');
            if (select) {
                select.innerHTML = '';
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.displayName;
                    select.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('Error loading Gemini models:', err);
        }
    }
    loadGeminiModels();

    // =================================================================
    // --- UNIFIED AI VOICE SETTINGS TAB LOGIC (NEW & CONTAINED) ---
    // =================================================================

    let googleSettings, elevenlabsSettings, fuzzyMatchInput, thresholdValue, responseDelayInput, delayValue, stabilityValue, clarityValue;
    let unsavedGoogle = {};
    let unsavedElevenlabs = {};

    // Function to dynamically load voices
    const loadTtsVoices = async (provider) => {
        // Default to elevenlabs if no provider specified
        if (!provider) provider = 'elevenlabs'; 
        
        const companyId = new URLSearchParams(window.location.search).get('id');
        
        // Get API key only if field has a non-placeholder value
        const apiKeyInput = document.getElementById('elevenlabsApiKey');
        const apiKey = (provider === 'elevenlabs' && apiKeyInput && apiKeyInput.value !== '*****') 
            ? apiKeyInput.value.trim() 
            : null;

        try {
            // Always use POST for ElevenLabs
            let res;
            if (provider === 'elevenlabs') {
                res = await fetch('/api/tts/voices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider, companyId, apiKey: apiKey || undefined })
                });
            } else {
                // Use GET for other providers (though we now only support ElevenLabs)
                res = await fetch(`/api/tts/voices?provider=${provider}&companyId=${companyId}`);
            }
            if (!res.ok) throw new Error(`Failed to fetch voices for ${provider}`);
            const voices = await res.json();

            const selectId = (provider === 'google') ? 'googleVoiceSelect' : 'elevenlabsVoiceSelect';
            const voiceSelect = document.getElementById(selectId);
            voiceSelect.innerHTML = ''; // Clear previous options
            voices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id; // API should return 'id' and 'displayName'
                opt.textContent = v.displayName;
                voiceSelect.appendChild(opt);
            });
        } catch (err) {
            console.error(`Could not load voices: ${err.message}`);
            if (provider === 'elevenlabs') {
                document.getElementById('elevenlabsVoiceSelect').innerHTML = '<option>API Key is required to load voices.</option>';
            }
            showToast(`Could not load voices: ${err.message}`, 'error');
        }
    };

    function setupAiVoiceTab() {
        // 1. Get the main container for our new tab
        const container = document.getElementById('ai-voice-content');
        if (!container) return;

        // 2. Define the complete HTML for our new UI
        const voiceUIHTML = `
            <section class="profile-section bg-transparent shadow-none p-0">
                <h2 class="profile-section-title"><i class="fas fa-microphone-alt mr-2 text-indigo-600"></i>Unified Voice & TTS Settings</h2>
                <p class="text-sm text-gray-500 mb-6">Configure the Text-to-Speech provider and voice for the AI agent.</p>
                
                <form id="ai-voice-settings-form" class="space-y-6">
                    <div>
                        <label for="ttsProviderSelect" class="form-label text-base font-semibold">TTS Provider</label>
                        <p class="text-xs text-gray-500 mb-2">Choose which service will generate the AI's voice.</p>
                        <select id="ttsProviderSelect" name="ttsProvider" class="form-select wider-textbox">
                            <option value="google">Google Cloud TTS (Reliable & Diverse)</option>
                            <option value="elevenlabs">ElevenLabs (Expressive & Natural)</option>
                        </select>
                    </div>

                    <div id="googleTtsSettings" class="p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-4">
                        <h3 class="font-semibold text-gray-700">Google Cloud TTS Settings</h3>
                        <div>
                            <label for="googleVoiceSelect" class="form-label">Google Voice</label>
                            <select id="googleVoiceSelect" name="googleVoiceName" class="form-select">
                                <option>Loading voices...</option>
                            </select>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label for="googleVoicePitch" class="form-label">Voice Pitch (-20 to +20)</label>
                                <input type="range" id="googleVoicePitch" name="googleVoicePitch" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" min="-20" max="20" step="0.1" value="0">
                            </div>
                            <div>
                                <label for="googleVoiceSpeed" class="form-label">Speaking Speed (0.25x to 4x)</label>
                                <input type="range" id="googleVoiceSpeed" name="googleVoiceSpeed" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" min="0.25" max="4.0" step="0.05" value="1">
                            </div>
                        </div>
                    </div>

                    <div id="elevenlabsTtsSettings" class="p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-4 hidden">
                         <h3 class="font-semibold text-gray-700">ElevenLabs TTS Settings</h3>
                        <div>
                            <label for="elevenlabsApiKey" class="form-label">ElevenLabs API Key</label>
                            <input type="password" id="elevenlabsApiKey" name="elevenlabsApiKey" class="form-input wider-textbox" placeholder="Enter your ElevenLabs API Key">
                            <p id="elevenlabsKeyHint" class="text-xs text-gray-500 mt-1">Using ClientsVia master account to load ElevenLabs voices.</p>
                            <p id="elevenlabsKeyWarning" class="text-xs text-orange-600 mt-1 hidden">Using custom API key for this company.</p>
                        </div>
                        <div>
                            <label for="elevenlabsVoiceSelect" class="form-label">ElevenLabs Voice</label>
                            <select id="elevenlabsVoiceSelect" name="elevenlabsVoiceId" class="form-select">
                                <option>Enter API Key to load voices...</option>
                            </select>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label for="elevenlabsStability" class="form-label">Stability (More variable <-> More stable)</label>
                                <input type="range" id="elevenlabsStability" name="elevenlabsStability" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" min="0" max="1" step="0.05" value="0.75">
                                <span id="elevenlabsStabilityValue" class="ml-2">0.75</span>
                            </div>
                            <div>
                                <label for="elevenlabsClarity" class="form-label">Clarity + Similarity</label>
                                 <input type="range" id="elevenlabsClarity" name="elevenlabsClarity" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" min="0" max="1" step="0.05" value="0.75">
                                <span id="elevenlabsClarityValue" class="ml-2">0.75</span>
                            </div>
                        </div>
                    </div>

                    <div class="p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-4">
                        <h3 class="font-semibold text-gray-700">Agent Performance Controls</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="flex items-center mt-6">
                                <input type="checkbox" id="logCalls" name="logCalls" class="form-checkbox">
                                <span class="ml-2">Enable Call Logging</span>
                                <p class="text-xs text-gray-500 mt-1">
                                    <strong>Enable Call Logging:</strong> When checked, caller and agent speech are recorded to the <code>callLogs</code> database collection.
                                    <br>
                                    • Useful for troubleshooting, QA, and reviewing agent performance.<br>
                                    • <span class="text-red-600">Do not enable in production unless you need to audit or debug — may capture sensitive info.</span><br>
                                    Logs can be viewed in the "Logs" tab of the dashboard.
                                </p>
                            </div>
                            <div class="col-span-1 md:col-span-2">
                                <label for="twilioSpeechConfidenceThreshold" class="form-label">Twilio Speech Confidence Threshold</label>
                                <input type="range" id="twilioSpeechConfidenceThreshold" name="twilioSpeechConfidenceThreshold" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" min="0.1" max="1" step="0.05" value="0.5">
                                <p class="text-xs text-gray-500">Higher values will reject more poor-quality speech, but may require customers to repeat themselves more often.</p>
                            </div>
                            <div>
                                <label for="fuzzyMatchThreshold" class="form-label">Fuzzy Match Threshold</label>
                                <input type="range" id="fuzzyMatchThreshold" name="fuzzyMatchThreshold" min="0.2" max="0.9" step="0.01" value="0.5" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                                <span id="fuzzyThresholdValue" class="ml-2">0.5</span>
                                <p class="text-xs text-gray-500 mt-1">
                                    <strong>Fuzzy Match Threshold:</strong> This controls how closely the AI will match a caller's words to your Q&amp;A entries.
                                    <br>
                                    • <strong>Lower values (0.2–0.5):</strong> More lenient, matches even if caller’s words are a little different. Use if your customers are not precise or speak in many ways.<br>
                                    • <strong>Higher values (0.7–0.9):</strong> More strict, only matches very close to your Q&amp;A wording. Use if you want to avoid false matches.
                                    <br>
                                    <em>Ideal range: Start at <strong>0.5</strong> and adjust up/down based on how accurately the AI answers your callers. Lower if too many “no match” responses, higher if it’s answering the wrong thing.</em>
                                </p>
                            </div>
                        </div>
                        <div class="mt-4">
                            <label class="flex items-center">
                                <input type="checkbox" id="speechConfirmEnabled" name="speechConfirmEnabled" class="form-checkbox">
                                <span class="ml-2">Enable Speech Confirmation</span>
                            </label>
                            <p class="text-xs text-gray-500 mt-1">
                                <strong>Enable Speech Confirmation:</strong> The agent will repeat what it heard and require approval before acting.<br>
                                Example prompt: “I heard: '{transcript}'. Press 5 or say yes to confirm. If not, say no or repeat.”<br>
                                Setting is stored with the company profile and used on all calls when enabled.
                            </p>
                            <div class="confirmation-settings ml-6 mt-2 space-y-2 hidden">
                                <label class="form-label">Confirmation Key
                                    <input id="confirmKey" name="confirmKey" type="number" class="form-input ml-2 w-20" value="5">
                                </label>
                                <label class="form-label block">Confirmation Phrases
                                    <textarea id="confirmationPrompts" name="confirmationPrompts" class="form-textarea wider-textbox" rows="2">I heard: '{transcript}'. Press 5 or say yes to confirm. If not, say no or repeat.</textarea>
                                </label>
                                <label class="form-label">Max Recognition Attempts
                                    <input id="maxAttempts" name="maxAttempts" type="number" class="form-input ml-2 w-20" value="2">
                                </label>
                            </div>
                            <button type="button" id="resetVoiceDefaults" class="text-sm text-indigo-600 mt-2 underline">Reset to Defaults</button>
                        </div>
                    </div>

                    <div class="pt-4 border-t">
                        <label for="unifiedTestPhrase" class="form-label">Test Phrase</label>
                        <textarea id="unifiedTestPhrase" class="form-textarea wider-textbox" rows="2">Hello, this is a test of the selected voice configuration.</textarea>
                        <button id="unifiedTestVoiceBtn" type="button" class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md mt-2 flex items-center">
                            <i class="fas fa-play mr-2"></i>Test Voice
                        </button>
                    </div>

                    <div class="mt-8 pt-5 border-t border-gray-200">
                        <button type="submit" class="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-6 rounded-lg shadow-md transition duration-150 ease-in-out">
                            <i class="fas fa-save mr-2"></i>Save Voice Settings
                        </button>
                    </div>
                </form>
            </section>
        `;

        // Inject the HTML into our tab container
        container.innerHTML = voiceUIHTML;

        // 3. Get references to our new UI elements
        const form = document.getElementById('ai-voice-settings-form');
        console.log('🔍 Looking for form ai-voice-settings-form:', form);
        if (!form) {
            console.error('❌ Form ai-voice-settings-form not found!');
            return;
        }
        const providerSelect = document.getElementById('ttsProviderSelect');
        googleSettings = document.getElementById('googleTtsSettings');
        elevenlabsSettings = document.getElementById('elevenlabsTtsSettings');
        const elevenlabsApiKeyInput = document.getElementById('elevenlabsApiKey');
        const testButton = document.getElementById('unifiedTestVoiceBtn');
        const confirmToggle = document.getElementById('speechConfirmEnabled');
        const confirmContainer = document.querySelector('.confirmation-settings');
        fuzzyMatchInput = document.getElementById('fuzzyMatchThreshold');
        thresholdValue = document.getElementById('fuzzyThresholdValue');
        const stabilityInput = document.getElementById('elevenlabsStability');
        const clarityInput = document.getElementById('elevenlabsClarity');
        stabilityValue = document.getElementById('elevenlabsStabilityValue');
        clarityValue = document.getElementById('elevenlabsClarityValue');
        if (stabilityValue && stabilityInput) {
            stabilityValue.textContent = Number(stabilityInput.value).toFixed(2);
        }
        if (clarityValue && clarityInput) {
            clarityValue.textContent = Number(clarityInput.value).toFixed(2);
        }
        
        // 4. Define the functions that make the tab work

        // Function to show/hide setting blocks based on provider
        const toggleProviderView = async (provider) => {
            googleSettings.classList.toggle('hidden', provider !== 'google');
            elevenlabsSettings.classList.toggle('hidden', provider !== 'elevenlabs');
            await loadTtsVoices(provider); // Load voices for the selected provider
            applyUnsavedProviderSettings(provider);
        };

        const captureCurrentProviderSettings = () => {
            if (providerSelect.value === 'google') {
                unsavedGoogle = {
                    voiceName: document.getElementById('googleVoiceSelect').value,
                    voicePitch: document.getElementById('googleVoicePitch').value,
                    voiceSpeed: document.getElementById('googleVoiceSpeed').value
                };
            } else {
                unsavedElevenlabs = {
                    apiKey: document.getElementById('elevenlabsApiKey').value,
                    voiceId: document.getElementById('elevenlabsVoiceSelect').value,
                    stability: document.getElementById('elevenlabsStability').value,
                    clarity: document.getElementById('elevenlabsClarity').value
                };
            }
        };

        const applyUnsavedProviderSettings = (provider) => {
            if (provider === 'google' && Object.keys(unsavedGoogle).length) {
                if (unsavedGoogle.voiceName) document.getElementById('googleVoiceSelect').value = unsavedGoogle.voiceName;
                if (unsavedGoogle.voicePitch) document.getElementById('googleVoicePitch').value = unsavedGoogle.voicePitch;
                if (unsavedGoogle.voiceSpeed) document.getElementById('googleVoiceSpeed').value = unsavedGoogle.voiceSpeed;
            }
            if (provider === 'elevenlabs' && Object.keys(unsavedElevenlabs).length) {
                const apiInput = document.getElementById('elevenlabsApiKey');
                if (unsavedElevenlabs.apiKey !== undefined) {
                    apiInput.value = unsavedElevenlabs.apiKey;
                    const hasVal = apiInput.value.trim() !== '';
                    document.getElementById('elevenlabsKeyHint').classList.toggle('hidden', hasVal);
                    document.getElementById('elevenlabsKeyWarning').classList.toggle('hidden', !hasVal);
                }
                if (unsavedElevenlabs.voiceId) document.getElementById('elevenlabsVoiceSelect').value = unsavedElevenlabs.voiceId;
                if (unsavedElevenlabs.stability) {
                    document.getElementById('elevenlabsStability').value = unsavedElevenlabs.stability;
                    if (stabilityValue) stabilityValue.textContent = Number(unsavedElevenlabs.stability).toFixed(2);
                }
                if (unsavedElevenlabs.clarity) {
                    document.getElementById('elevenlabsClarity').value = unsavedElevenlabs.clarity;
                    if (clarityValue) clarityValue.textContent = Number(unsavedElevenlabs.clarity).toFixed(2);
                }
            }
        };

        // Adding spacing to change line numbers for console output
        
        
        
        
        
        // Function to handle the form submission
        const handleSaveVoiceSettings = async (event) => {
            console.log('✅ Voice settings save initiated');
            event.preventDefault();
            const companyId = new URLSearchParams(window.location.search).get('id');
            if (!companyId) return showToast('Company ID is missing.', 'error');

            const formData = new FormData(form);
            const settings = Object.fromEntries(formData.entries());

            settings.twilioSpeechConfidenceThreshold = parseFloat(settings.twilioSpeechConfidenceThreshold || '0.5');
            settings.fuzzyMatchThreshold = parseFloat(formData.get('fuzzyMatchThreshold'));
            settings.logCalls = formData.get('logCalls') === 'on';
            settings.speechConfirmation = {
                enabled: formData.get('speechConfirmEnabled') === 'on',
                confirmKey: parseInt(formData.get('confirmKey') || '5'),
                prompts: (formData.get('confirmationPrompts') || '').split('\n').filter(t => t.trim() !== ''),
                maxAttempts: parseInt(formData.get('maxAttempts') || '2')
            };

            if (settings.elevenlabsApiKey === '*****') {
                if (document.getElementById('elevenlabsApiKey').dataset.hasValue === 'true') {
                    delete settings.elevenlabsApiKey; // keep existing
                } else {
                    settings.elevenlabsApiKey = '';
                }
            }
            
            // Ensure numeric values are numbers, not strings
            settings.googleVoicePitch = parseFloat(settings.googleVoicePitch);
            settings.googleVoiceSpeed = parseFloat(settings.googleVoiceSpeed);
            settings.elevenlabsStability = parseFloat(settings.elevenlabsStability);
            settings.elevenlabsClarity = parseFloat(settings.elevenlabsClarity);

            const saveBtn = form.querySelector('button[type="submit"]');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
            
            try {
                console.log('Attempting to save voice settings:', settings);
                const res = await fetch(`/api/company/${companyId}/voice-settings`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                console.log('Server response status:', res.status);
                const responseData = await res.json();
                console.log('Server response data:', responseData);
                if (!res.ok) throw new Error(`Server error: ${res.status} - ${responseData.message || 'Unknown error'}`);
                showToast('Voice settings saved successfully!', 'success');
            } catch (err) {
                console.error('Voice settings save error:', err);
                showToast(`Error: ${err.message}`, 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Voice Settings';
            }
        };

        // 5. Attach event listeners
        providerSelect.addEventListener('change', () => {
            captureCurrentProviderSettings();
            toggleProviderView(providerSelect.value);
        });
        const keyHint = document.getElementById('elevenlabsKeyHint');
        const keyWarning = document.getElementById('elevenlabsKeyWarning');

        elevenlabsApiKeyInput.addEventListener('input', () => {
            const hasVal = elevenlabsApiKeyInput.value.trim() !== '';
            keyHint.classList.toggle('hidden', hasVal);
            keyWarning.classList.toggle('hidden', !hasVal);
            if (providerSelect.value === 'elevenlabs') {
                loadTtsVoices('elevenlabs');
            }
        });

        if (confirmToggle) {
            confirmToggle.addEventListener('change', () => {
                confirmContainer.classList.toggle('hidden', !confirmToggle.checked);
            });
        }

        if (fuzzyMatchInput) {
            fuzzyMatchInput.addEventListener('input', () => {
                if (thresholdValue) thresholdValue.textContent = fuzzyMatchInput.value;
            });
        }

        if (responseDelayInput) {
            responseDelayInput.addEventListener('input', () => {
                if (delayValue) delayValue.textContent = `${responseDelayInput.value} ms`;
            });
        }

        if (stabilityInput) {
            stabilityInput.addEventListener('input', () => {
                if (stabilityValue) stabilityValue.textContent = Number(stabilityInput.value).toFixed(2);
            });
        }

        if (clarityInput) {
            clarityInput.addEventListener('input', () => {
                if (clarityValue) clarityValue.textContent = Number(clarityInput.value).toFixed(2);
            });
        }

                const resetBtn = document.getElementById('resetVoiceDefaults');
                if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                document.getElementById('logCalls').checked = false;
                document.getElementById('twilioSpeechConfidenceThreshold').value = 0.5;
                if (fuzzyMatchInput) fuzzyMatchInput.value = 0.5;
                if (thresholdValue) thresholdValue.textContent = '0.5';
                document.getElementById('elevenlabsStability').value = 0.75;
                document.getElementById('elevenlabsClarity').value = 0.75;
                if (stabilityValue) stabilityValue.textContent = '0.75';
                if (clarityValue) clarityValue.textContent = '0.75';
                document.getElementById('speechConfirmEnabled').checked = false;
                document.getElementById('confirmKey').value = 5;
                document.getElementById('confirmationPrompts').value = "I heard: '{transcript}'. Press 5 or say yes to confirm. If not, say no or repeat.";
                document.getElementById('maxAttempts').value = 2;
                confirmContainer.classList.add('hidden');
            });
        }
        console.log('📎 Attaching submit event listener to form:', form);
        form.addEventListener('submit', handleSaveVoiceSettings);
        console.log('✅ Event listener attached successfully');

        // Function to test the current voice configuration
        const handleTestVoice = async () => {
            const provider = providerSelect.value;
            const text = document.getElementById('unifiedTestPhrase').value;
            let settings = {};

            if (provider === 'google') {
                settings.voiceName = document.getElementById('googleVoiceSelect').value;
                settings.pitch = parseFloat(document.getElementById('googleVoicePitch').value);
                settings.speed = parseFloat(document.getElementById('googleVoiceSpeed').value);
            } else {
                const customApiKey = document.getElementById('elevenlabsApiKey').value.trim();
                var apiKeyToSend = (customApiKey === '' || customApiKey === '*****') ? undefined : customApiKey;
                settings.voiceId = document.getElementById('elevenlabsVoiceSelect').value;
                settings.stability = parseFloat(document.getElementById('elevenlabsStability').value);
                settings.clarity = parseFloat(document.getElementById('elevenlabsClarity').value);
            }

            const originalHtml = testButton.innerHTML;
            testButton.disabled = true;
            testButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Playing...';

            try {
                const payload = { provider, text, settings };
                if (typeof apiKeyToSend !== 'undefined') {
                    payload.apiKey = apiKeyToSend; // Only include if user provided
                }
                const resp = await fetch('/api/test/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!resp.ok) throw new Error('TTS request failed');
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.addEventListener('ended', () => {
                    testButton.disabled = false;
                    testButton.innerHTML = originalHtml;
                    URL.revokeObjectURL(url);
                });
                audio.play().catch(err => {
                    testButton.disabled = false;
                    testButton.innerHTML = originalHtml;
                    console.error('Playback failed', err);
                });
            } catch (err) {
                showToast(`Playback failed: ${err.message}`, 'error');
                testButton.disabled = false;
                testButton.innerHTML = originalHtml;
            }
        };

        testButton.addEventListener('click', handleTestVoice);

        // 6. Initial population of data will be handled by a new function
        // called from within your main fetchCompanyData() success block.
    }

    // This function needs to be created to populate the form with saved data
    function populateAiVoiceSettings(voiceSettings = {}) {
        if (!document.getElementById('ai-voice-settings-form')) return; // Check if our UI exists

        document.getElementById('ttsProviderSelect').value = voiceSettings.ttsProvider || 'elevenlabs';
        
        // Populate Google Fields
        document.getElementById('googleVoicePitch').value = voiceSettings.googleVoicePitch ?? 0;
        document.getElementById('googleVoiceSpeed').value = voiceSettings.googleVoiceSpeed ?? 1;
        
        // Populate ElevenLabs Fields
        const apiInput = document.getElementById('elevenlabsApiKey');
        const keyHint = document.getElementById('elevenlabsKeyHint');
        const keyWarning = document.getElementById('elevenlabsKeyWarning');
        if (voiceSettings.elevenlabsApiKey) {
            apiInput.value = '*****';
            apiInput.dataset.hasValue = 'true';
            if (keyHint) keyHint.classList.add('hidden');
            if (keyWarning) keyWarning.classList.remove('hidden');
        } else {
            apiInput.value = '';
            apiInput.dataset.hasValue = 'false';
            if (keyHint) keyHint.classList.remove('hidden');
            if (keyWarning) keyWarning.classList.add('hidden');
        }
        document.getElementById('elevenlabsStability').value = voiceSettings.elevenlabsStability ?? 0.75;
        document.getElementById('elevenlabsClarity').value = voiceSettings.elevenlabsClarity ?? 0.75;
        if (stabilityValue) stabilityValue.textContent = Number(document.getElementById('elevenlabsStability').value).toFixed(2);
        if (clarityValue) clarityValue.textContent = Number(document.getElementById('elevenlabsClarity').value).toFixed(2);

        document.getElementById('logCalls').checked = !!voiceSettings.logCalls;
        document.getElementById('twilioSpeechConfidenceThreshold').value = voiceSettings.twilioSpeechConfidenceThreshold ?? 0.5;
        if (fuzzyMatchInput) fuzzyMatchInput.value = voiceSettings.fuzzyMatchThreshold ?? 0.5;
        if (thresholdValue) thresholdValue.textContent = voiceSettings.fuzzyMatchThreshold ?? 0.5;

        const confirmEnabled = voiceSettings.speechConfirmation?.enabled ?? false;
        document.getElementById('speechConfirmEnabled').checked = confirmEnabled;
        document.getElementById('confirmKey').value = voiceSettings.speechConfirmation?.confirmKey ?? 5;
        document.getElementById('confirmationPrompts').value = (voiceSettings.speechConfirmation?.prompts || []).join('\n');
        document.getElementById('maxAttempts').value = voiceSettings.speechConfirmation?.maxAttempts ?? 2;
        document.querySelector('.confirmation-settings').classList.toggle('hidden', !confirmEnabled);
        
        // Trigger the view toggle and load voices
        const providerSelect = document.getElementById('ttsProviderSelect');
        googleSettings.classList.toggle('hidden', providerSelect.value !== 'google');
        elevenlabsSettings.classList.toggle('hidden', providerSelect.value !== 'elevenlabs');

        // Load voices and then select the saved one
        const loadAndSelect = async () => {
            await loadTtsVoices(providerSelect.value);
            if(providerSelect.value === 'google') {
                document.getElementById('googleVoiceSelect').value = voiceSettings.googleVoiceName || '';
            } else {
                document.getElementById('elevenlabsVoiceSelect').value = voiceSettings.elevenlabsVoiceId || '';
            }
        };
        loadAndSelect();
    }

    // We need to call these setup functions.
    // This one builds the UI
    setupAiVoiceTab(); 
    // You must call populateAiVoiceSettings(currentCompanyData.voiceSettings) inside your main
    // fetchCompanyData() function after you get a successful response.
});
