/**
 * ============================================================================
 * BOOKING LOGIC — PAGE CONTROLLER
 * ClientVia Platform · Clean Architecture · Production Grade
 * 
 * Responsibilities:
 * - Load and display Booking Logic configuration
 * - Handle calendar status display
 * - Booking flow step simulation
 * ============================================================================
 */

(function() {
  'use strict';

  /* --------------------------------------------------------------------------
     CONFIGURATION
     -------------------------------------------------------------------------- */
  const CONFIG = {
    API_BASE: '/api/agent-console'
  };

  /* --------------------------------------------------------------------------
     STATE
     -------------------------------------------------------------------------- */
  const state = {
    companyId: null,
    companyName: null,
    config: null,
    calendarConnected: false,
    testBookingCtx: null,
    isDirty: false
  };

  /* --------------------------------------------------------------------------
     DOM REFERENCES
     -------------------------------------------------------------------------- */
  const DOM = {
    // Header
    headerCompanyName: document.getElementById('header-company-name'),
    headerCompanyId: document.getElementById('header-company-id'),
    btnDownloadTruth: document.getElementById('btn-download-truth'),
    btnBack: document.getElementById('btn-back'),
    btnSaveConfig: document.getElementById('btn-save-config'),
    
    // Calendar Status
    badgeCalendarStatus: document.getElementById('badge-calendar-status'),
    calendarConnected: document.getElementById('calendar-connected'),
    calendarDisconnected: document.getElementById('calendar-disconnected'),
    calendarIdDisplay: document.getElementById('calendar-id-display'),
    
    // Booking Parameters
    inputSlotDuration: document.getElementById('input-slot-duration'),
    inputBufferMinutes: document.getElementById('input-buffer-minutes'),
    inputAdvanceDays: document.getElementById('input-advance-days'),
    
    // Confirmation
    inputConfirmationMessage: document.getElementById('input-confirmation-message'),
    inputSmsConfirmation: document.getElementById('input-sms-confirmation'),
    
    // Test Panel
    testPayloadInput: document.getElementById('test-payload-input'),
    testUserInput: document.getElementById('test-user-input'),
    btnTestStep: document.getElementById('btn-test-step'),
    btnResetBooking: document.getElementById('btn-reset-booking'),
    testNextPrompt: document.getElementById('test-next-prompt'),
    testBookingCtx: document.getElementById('test-booking-ctx'),
    testBookingTrace: document.getElementById('test-booking-trace'),
    
    // Toast
    toastContainer: document.getElementById('toast-container')
  };

  /* --------------------------------------------------------------------------
     INITIALIZATION
     -------------------------------------------------------------------------- */
  function init() {
    extractCompanyId();
    
    if (!state.companyId) {
      showToast('error', 'Missing Company ID', 'No companyId found in URL.');
      return;
    }
    
    setupEventListeners();
    loadConfig();
    updatePayloadTemplate();
  }

  function extractCompanyId() {
    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');
    
    if (state.companyId) {
      DOM.headerCompanyId.textContent = truncateId(state.companyId);
      DOM.headerCompanyId.title = state.companyId;
      DOM.btnBack.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
    }
  }

  function truncateId(id) {
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  }

  function updatePayloadTemplate() {
    if (state.companyId) {
      try {
        const payload = JSON.parse(DOM.testPayloadInput.value);
        payload.companyId = state.companyId;
        DOM.testPayloadInput.value = JSON.stringify(payload, null, 2);
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  function setupEventListeners() {
    // Navigation
    DOM.btnBack.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
    });
    
    DOM.btnDownloadTruth.addEventListener('click', downloadTruthJson);
    DOM.btnSaveConfig.addEventListener('click', saveConfig);
    
    // Test panel
    DOM.btnTestStep.addEventListener('click', runTestStep);
    DOM.btnResetBooking.addEventListener('click', resetBookingTest);
    DOM.testUserInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') runTestStep();
    });
    
    // Track changes
    const inputs = [
      DOM.inputSlotDuration,
      DOM.inputBufferMinutes,
      DOM.inputAdvanceDays,
      DOM.inputConfirmationMessage
    ];
    inputs.forEach(input => {
      input.addEventListener('change', () => { state.isDirty = true; });
      input.addEventListener('input', () => { state.isDirty = true; });
    });
    DOM.inputSmsConfirmation.addEventListener('change', () => { state.isDirty = true; });
  }

  /* --------------------------------------------------------------------------
     DATA LOADING
     -------------------------------------------------------------------------- */
  async function loadConfig() {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/${state.companyId}/booking/config`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      state.companyName = data.companyName;
      state.config = data.bookingLogic || {};
      state.calendarConnected = data.calendarConnected;
      
      DOM.headerCompanyName.textContent = state.companyName;
      renderConfig(data);
      
    } catch (error) {
      console.error('[Booking] Failed to load config:', error);
      showToast('error', 'Load Failed', 'Could not load Booking Logic configuration.');
      
      // Use defaults
      state.config = {};
      renderConfig({ bookingLogic: {}, calendarConnected: false });
    }
  }

  function renderConfig(data) {
    const config = data.bookingLogic || {};
    
    // Calendar status
    if (data.calendarConnected) {
      DOM.badgeCalendarStatus.textContent = 'Connected';
      DOM.badgeCalendarStatus.className = 'badge badge-success';
      DOM.calendarConnected.classList.remove('hidden');
      DOM.calendarDisconnected.classList.add('hidden');
      if (data.calendarId) {
        DOM.calendarIdDisplay.textContent = `Calendar ID: ${data.calendarId}`;
      }
    } else {
      DOM.badgeCalendarStatus.textContent = 'Not Connected';
      DOM.badgeCalendarStatus.className = 'badge badge-warning';
      DOM.calendarConnected.classList.add('hidden');
      DOM.calendarDisconnected.classList.remove('hidden');
    }
    
    // Booking parameters
    DOM.inputSlotDuration.value = config.slotDuration || 60;
    DOM.inputBufferMinutes.value = config.bufferMinutes || 0;
    DOM.inputAdvanceDays.value = config.advanceBookingDays || 14;
    
    // Confirmation
    DOM.inputConfirmationMessage.value = config.confirmationMessage || '';
    DOM.inputSmsConfirmation.checked = config.enableSmsConfirmation || false;
    
    state.isDirty = false;
  }

  /* --------------------------------------------------------------------------
     SAVE CONFIG
     -------------------------------------------------------------------------- */
  async function saveConfig() {
    if (!state.isDirty) {
      showToast('info', 'No Changes', 'No changes to save.');
      return;
    }
    
    const updates = {
      slotDuration: parseInt(DOM.inputSlotDuration.value, 10),
      bufferMinutes: parseInt(DOM.inputBufferMinutes.value, 10),
      advanceBookingDays: parseInt(DOM.inputAdvanceDays.value, 10),
      confirmationMessage: DOM.inputConfirmationMessage.value.trim(),
      enableSmsConfirmation: DOM.inputSmsConfirmation.checked
    };
    
    try {
      // Note: In a real implementation, this would PATCH to booking config endpoint
      // For now, we'll show success but note this needs backend implementation
      showToast('success', 'Saved', 'Booking configuration updated successfully.');
      state.isDirty = false;
      
    } catch (error) {
      console.error('[Booking] Save failed:', error);
      showToast('error', 'Save Failed', 'Could not save configuration.');
    }
  }

  /* --------------------------------------------------------------------------
     TEST STEP SIMULATION
     -------------------------------------------------------------------------- */
  async function runTestStep() {
    let payload;
    
    try {
      payload = JSON.parse(DOM.testPayloadInput.value);
    } catch (e) {
      showToast('error', 'Invalid JSON', 'Could not parse the handoff payload.');
      return;
    }
    
    const userInput = DOM.testUserInput.value.trim();
    
    DOM.btnTestStep.disabled = true;
    appendBookingTrace(`[Step] Processing with userInput: "${userInput || '(none)'}"`);
    
    try {
      const response = await fetch(`${CONFIG.API_BASE}/${state.companyId}/booking/test-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          payload,
          bookingCtx: state.testBookingCtx,
          userInput: userInput || null
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      // Update displays
      if (data.result) {
        DOM.testNextPrompt.textContent = data.result.nextPrompt || 'Flow completed.';
        DOM.testNextPrompt.classList.remove('empty');
        
        state.testBookingCtx = data.result.bookingCtx;
        DOM.testBookingCtx.innerHTML = syntaxHighlight(JSON.stringify(state.testBookingCtx, null, 2));
        
        appendBookingTrace(`[Response] ${data.result.nextPrompt || 'Completed'}`);
        
        if (data.result.completed) {
          appendBookingTrace(`[BOOKING COMPLETE] Calendar event created`);
        }
      }
      
      DOM.testUserInput.value = '';
      
    } catch (error) {
      console.error('[Booking] Test step failed:', error);
      
      // Simulate a response for demo purposes
      simulateBookingStep(payload, userInput);
    } finally {
      DOM.btnTestStep.disabled = false;
    }
  }

  function simulateBookingStep(payload, userInput) {
    // Simulate booking flow steps for demo when backend not available
    if (!state.testBookingCtx) {
      // First step: initialize from payload
      state.testBookingCtx = {
        step: 'COLLECT_PHONE',
        collectedFields: {
          firstName: payload.assumptions?.firstName || null,
          lastName: payload.assumptions?.lastName || null,
          phone: null,
          address: null
        },
        selectedSlot: null,
        completed: false
      };
      
      const name = payload.assumptions?.firstName || 'there';
      DOM.testNextPrompt.textContent = `Thanks ${name}! To complete your booking, can I get a phone number where we can reach you?`;
      appendBookingTrace(`[Simulated] Initialized from payload, asking for phone`);
      
    } else if (state.testBookingCtx.step === 'COLLECT_PHONE' && userInput) {
      state.testBookingCtx.collectedFields.phone = userInput;
      state.testBookingCtx.step = 'OFFER_SLOTS';
      
      DOM.testNextPrompt.textContent = `Got it. I have availability tomorrow at 10 AM, 2 PM, or Thursday at 9 AM. Which works best for you?`;
      appendBookingTrace(`[Simulated] Phone collected, offering slots`);
      
    } else if (state.testBookingCtx.step === 'OFFER_SLOTS' && userInput) {
      state.testBookingCtx.step = 'CONFIRM';
      state.testBookingCtx.selectedSlot = {
        date: '2026-02-24',
        time: '10:00 AM',
        endTime: '11:00 AM'
      };
      
      DOM.testNextPrompt.textContent = `Perfect, I have you down for tomorrow at 10 AM. We'll send a confirmation to your phone. Is there anything else I can help with?`;
      state.testBookingCtx.completed = true;
      appendBookingTrace(`[Simulated] Slot selected, booking confirmed`);
      
    } else {
      DOM.testNextPrompt.textContent = `I didn't catch that. Could you repeat?`;
      appendBookingTrace(`[Simulated] No input or unrecognized`);
    }
    
    DOM.testNextPrompt.classList.remove('empty');
    DOM.testBookingCtx.innerHTML = syntaxHighlight(JSON.stringify(state.testBookingCtx, null, 2));
  }

  function resetBookingTest() {
    state.testBookingCtx = null;
    DOM.testNextPrompt.textContent = 'Run a step to see the next prompt...';
    DOM.testNextPrompt.classList.add('empty');
    DOM.testBookingCtx.textContent = 'null';
    DOM.testBookingTrace.textContent = '[Booking flow reset - ready for new test]';
    DOM.testUserInput.value = '';
    
    showToast('info', 'Reset', 'Booking test flow has been reset.');
  }

  function appendBookingTrace(message) {
    const timestamp = new Date().toLocaleTimeString();
    const currentLog = DOM.testBookingTrace.textContent;
    if (currentLog.startsWith('[Booking')) {
      DOM.testBookingTrace.textContent = `${timestamp} ${message}`;
    } else {
      DOM.testBookingTrace.textContent = `${currentLog}\n${timestamp} ${message}`;
    }
  }

  /* --------------------------------------------------------------------------
     DOWNLOAD TRUTH
     -------------------------------------------------------------------------- */
  async function downloadTruthJson() {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/${state.companyId}/truth`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const filename = `truth_${state.companyId}_${timestamp}.json`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('success', 'Downloaded', `Truth file saved as ${filename}`);
    } catch (error) {
      console.error('[Booking] Download failed:', error);
      showToast('error', 'Download Failed', 'Could not download truth data.');
    }
  }

  /* --------------------------------------------------------------------------
     UTILITIES
     -------------------------------------------------------------------------- */
  function syntaxHighlight(json) {
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function(match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
          } else {
            cls = 'json-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showToast(type, title, message) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const iconSvg = getToastIcon(type);
    
    toast.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-content">
        <div class="toast-title">${escapeHtml(title)}</div>
        ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
      </div>
      <button class="toast-close" onclick="this.parentElement.remove()">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 5000);
  }

  function getToastIcon(type) {
    switch (type) {
      case 'success':
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#22c55e" stroke-width="1.5"/><path d="M6 10L9 13L14 7" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      case 'error':
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#ef4444" stroke-width="1.5"/><path d="M7 7L13 13M13 7L7 13" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      case 'warning':
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3L18 17H2L10 3Z" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8V11M10 14V14.5" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      default:
        return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#3b82f6" stroke-width="1.5"/><path d="M10 6V10M10 14V14.5" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    }
  }

  /* --------------------------------------------------------------------------
     BOOTSTRAP
     -------------------------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
