/**
 * ============================================================================
 * AGENT 2.0 DISCOVERY — PAGE CONTROLLER
 * ClientVia Platform · Clean Architecture · Production Grade
 * 
 * Responsibilities:
 * - Load and display Agent 2.0 configuration
 * - Handle config updates (greeting, phrases, style)
 * - Live Test Turn functionality
 * - Generate sample handoff payloads
 * 
 * Uses AgentConsoleAuth for centralized authentication.
 * ============================================================================
 */

(function() {
  'use strict';

  /* --------------------------------------------------------------------------
     CONFIGURATION
     -------------------------------------------------------------------------- */
  const CONFIG = {
    API_BASE: '/api/agent-console',
    DEFAULT_CONSENT_PHRASES: [
      'yes',
      'yeah',
      'sure',
      'ok',
      'okay',
      'yes please',
      'that works',
      'sounds good',
      'let\'s do it'
    ],
    DEFAULT_ESCALATION_PHRASES: [
      'speak to a human',
      'talk to someone',
      'real person',
      'operator',
      'representative',
      'manager'
    ]
  };

  /* --------------------------------------------------------------------------
     STATE
     -------------------------------------------------------------------------- */
  const state = {
    companyId: null,
    companyName: null,
    config: null,
    triggerStats: null,
    testSession: {
      mode: 'DISCOVERY',
      turn: 0,
      callerName: null,
      intent: null
    },
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
    btnBackToProfile: document.getElementById('btn-back-to-profile'),
    btnSaveConfig: document.getElementById('btn-save-config'),
    
    // Stats
    statTriggerCards: document.getElementById('stat-trigger-cards'),
    statTriggerGroup: document.getElementById('stat-trigger-group'),
    statClarifiers: document.getElementById('stat-clarifiers'),
    statVocabulary: document.getElementById('stat-vocabulary'),
    badgeDiscoveryStatus: document.getElementById('badge-discovery-status'),
    
    // Greeting
    inputGreetingInitial: document.getElementById('input-greeting-initial'),
    inputGreetingReturn: document.getElementById('input-greeting-return'),
    
    // Consent Phrases
    consentPhrasesList: document.getElementById('consent-phrases-list'),
    inputConsentPhrase: document.getElementById('input-consent-phrase'),
    btnAddConsentPhrase: document.getElementById('btn-add-consent-phrase'),
    
    // Escalation Phrases
    escalationPhrasesList: document.getElementById('escalation-phrases-list'),
    inputEscalationPhrase: document.getElementById('input-escalation-phrase'),
    btnAddEscalationPhrase: document.getElementById('btn-add-escalation-phrase'),
    
    // Discovery Style
    inputAckWord: document.getElementById('input-ack-word'),
    inputRobotChallengeEnabled: document.getElementById('input-robot-challenge-enabled'),
    inputRobotChallengeLine: document.getElementById('input-robot-challenge-line'),
    
    // Test Panel
    testInput: document.getElementById('test-input'),
    btnTestTurn: document.getElementById('btn-test-turn'),
    testOutputReply: document.getElementById('test-output-reply'),
    testSessionState: document.getElementById('test-session-state'),
    testHandoffPayload: document.getElementById('test-handoff-payload'),
    testTraceLog: document.getElementById('test-trace-log'),
    btnResetSession: document.getElementById('btn-reset-session'),
    btnGeneratePayload: document.getElementById('btn-generate-payload'),
    
    // Toast
    toastContainer: document.getElementById('toast-container')
  };

  /* --------------------------------------------------------------------------
     INITIALIZATION
     -------------------------------------------------------------------------- */
  function init() {
    // Require auth before anything else
    if (!AgentConsoleAuth.requireAuth()) {
      return;
    }

    extractCompanyId();
    
    if (!state.companyId) {
      showToast('error', 'Missing Company ID', 'No companyId found in URL.');
      return;
    }
    
    setupEventListeners();
    loadConfig();
  }

  function extractCompanyId() {
    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');
    
    if (state.companyId) {
      DOM.headerCompanyId.textContent = truncateId(state.companyId);
      DOM.headerCompanyId.title = state.companyId;
      DOM.btnBack.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
      
      // Update header logo link with companyId
      const logoLink = document.getElementById('header-logo-link');
      if (logoLink) {
        logoLink.href = `/company-profile.html?companyId=${encodeURIComponent(state.companyId)}`;
      }
    }
  }

  function truncateId(id) {
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  }

  function setupEventListeners() {
    // Navigation
    DOM.btnBack.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
    });
    
    // Back to Company Profile
    DOM.btnBackToProfile.addEventListener('click', () => {
      window.location.href = `/company-profile.html?companyId=${encodeURIComponent(state.companyId)}`;
    });
    
    // Trigger Console link
    const linkTriggerConsole = document.getElementById('link-trigger-console');
    if (linkTriggerConsole) {
      linkTriggerConsole.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = `/agent-console/triggers.html?companyId=${encodeURIComponent(state.companyId)}`;
      });
    }
    
    const statBoxTriggers = document.getElementById('stat-box-triggers');
    if (statBoxTriggers) {
      statBoxTriggers.addEventListener('click', () => {
        window.location.href = `/agent-console/triggers.html?companyId=${encodeURIComponent(state.companyId)}`;
      });
      statBoxTriggers.style.cursor = 'pointer';
    }
    
    DOM.btnDownloadTruth.addEventListener('click', downloadTruthJson);
    DOM.btnSaveConfig.addEventListener('click', saveConfig);
    
    // Consent phrases
    DOM.btnAddConsentPhrase.addEventListener('click', () => addPhrase('consent'));
    DOM.inputConsentPhrase.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addPhrase('consent');
    });
    
    // Escalation phrases
    DOM.btnAddEscalationPhrase.addEventListener('click', () => addPhrase('escalation'));
    DOM.inputEscalationPhrase.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addPhrase('escalation');
    });
    
    // Test panel
    DOM.btnTestTurn.addEventListener('click', runTestTurn);
    DOM.testInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') runTestTurn();
    });
    DOM.btnResetSession.addEventListener('click', resetTestSession);
    DOM.btnGeneratePayload.addEventListener('click', generateSamplePayload);
    
    // Track changes
    const inputs = [
      DOM.inputGreetingInitial,
      DOM.inputGreetingReturn,
      DOM.inputAckWord,
      DOM.inputRobotChallengeLine
    ];
    inputs.forEach(input => {
      input.addEventListener('input', () => { state.isDirty = true; });
    });
    DOM.inputRobotChallengeEnabled.addEventListener('change', () => { state.isDirty = true; });
  }

  /* --------------------------------------------------------------------------
     DATA LOADING
     -------------------------------------------------------------------------- */
  async function loadConfig() {
    try {
      const response = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE}/${state.companyId}/agent2/config`);
      state.companyName = response.companyName;
      state.config = response.agent2 || {};
      state.triggerStats = response.triggerStats || {};
      
      DOM.headerCompanyName.textContent = state.companyName;
      renderConfig();
      
    } catch (error) {
      console.error('[Agent2] Failed to load config:', error);
      showToast('error', 'Load Failed', 'Could not load Agent 2.0 configuration.');
      
      // Use defaults
      state.config = {};
      state.triggerStats = {};
      renderConfig();
    }
  }

  function renderConfig() {
    const config = state.config;
    
    // Stats
    const triggerCount = state.triggerStats?.totalActiveCount || 0;
    const groupName = state.triggerStats?.activeGroupName || 'No Group Selected';
    const groupIcon = state.triggerStats?.activeGroupIcon || '📋';
    
    DOM.statTriggerCards.textContent = triggerCount;
    
    if (DOM.statTriggerGroup) {
      if (state.triggerStats?.activeGroupName) {
        DOM.statTriggerGroup.textContent = `${groupIcon} ${groupName}`;
        DOM.statTriggerGroup.style.color = '#374151';
      } else {
        DOM.statTriggerGroup.textContent = 'No Group Selected';
        DOM.statTriggerGroup.style.color = '#dc2626';
      }
    }
    
    DOM.statClarifiers.textContent = config.clarifiers?.length || 0;
    DOM.statVocabulary.textContent = config.discovery?.vocabulary?.length || 0;
    
    // Greeting
    DOM.inputGreetingInitial.value = config.greetings?.initial || '';
    DOM.inputGreetingReturn.value = config.greetings?.returnCaller || '';
    
    // Discovery style
    DOM.inputAckWord.value = config.discovery?.style?.ackWord || 'Ok.';
    DOM.inputRobotChallengeEnabled.checked = config.discovery?.style?.robotChallenge?.enabled || false;
    DOM.inputRobotChallengeLine.value = config.discovery?.style?.robotChallenge?.line || '';
    
    // Consent phrases
    const consentPhrases = config.consentPhrases || CONFIG.DEFAULT_CONSENT_PHRASES;
    renderPhraseList('consent', consentPhrases);
    
    // Escalation phrases
    const escalationPhrases = config.escalationPhrases || CONFIG.DEFAULT_ESCALATION_PHRASES;
    renderPhraseList('escalation', escalationPhrases);
    
    state.isDirty = false;
  }

  /* --------------------------------------------------------------------------
     PHRASE LIST MANAGEMENT
     -------------------------------------------------------------------------- */
  function renderPhraseList(type, phrases) {
    const container = type === 'consent' ? DOM.consentPhrasesList : DOM.escalationPhrasesList;
    container.innerHTML = '';
    
    phrases.forEach((phrase, index) => {
      const tag = document.createElement('span');
      tag.className = 'phrase-tag';
      tag.innerHTML = `
        ${escapeHtml(phrase)}
        <button type="button" class="phrase-remove" data-type="${type}" data-index="${index}">×</button>
      `;
      container.appendChild(tag);
    });
    
    // Add event listeners for remove buttons
    container.querySelectorAll('.phrase-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.target.dataset.type;
        const index = parseInt(e.target.dataset.index);
        removePhrase(type, index);
      });
    });
  }

  function addPhrase(type) {
    const input = type === 'consent' ? DOM.inputConsentPhrase : DOM.inputEscalationPhrase;
    const phrase = input.value.trim().toLowerCase();
    
    if (!phrase) return;
    
    const arrayKey = type === 'consent' ? 'consentPhrases' : 'escalationPhrases';
    const defaults = type === 'consent' ? CONFIG.DEFAULT_CONSENT_PHRASES : CONFIG.DEFAULT_ESCALATION_PHRASES;
    
    if (!state.config[arrayKey]) {
      state.config[arrayKey] = [...defaults];
    }
    
    if (state.config[arrayKey].includes(phrase)) {
      showToast('warning', 'Duplicate', 'This phrase already exists.');
      return;
    }
    
    state.config[arrayKey].push(phrase);
    renderPhraseList(type, state.config[arrayKey]);
    
    input.value = '';
    state.isDirty = true;
  }

  function removePhrase(type, index) {
    const arrayKey = type === 'consent' ? 'consentPhrases' : 'escalationPhrases';
    const defaults = type === 'consent' ? CONFIG.DEFAULT_CONSENT_PHRASES : CONFIG.DEFAULT_ESCALATION_PHRASES;
    
    if (!state.config[arrayKey]) {
      state.config[arrayKey] = [...defaults];
    }
    
    state.config[arrayKey].splice(index, 1);
    renderPhraseList(type, state.config[arrayKey]);
    state.isDirty = true;
  }

  /* --------------------------------------------------------------------------
     SAVE CONFIG
     -------------------------------------------------------------------------- */
  async function saveConfig() {
    const updates = {
      greetings: {
        initial: DOM.inputGreetingInitial.value.trim(),
        returnCaller: DOM.inputGreetingReturn.value.trim()
      },
      discovery: {
        ...state.config.discovery,
        style: {
          ackWord: DOM.inputAckWord.value.trim() || 'Ok.',
          robotChallenge: {
            enabled: DOM.inputRobotChallengeEnabled.checked,
            line: DOM.inputRobotChallengeLine.value.trim()
          }
        }
      },
      consentPhrases: state.config.consentPhrases,
      escalationPhrases: state.config.escalationPhrases
    };
    
    try {
      const data = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE}/${state.companyId}/agent2/config`, {
        method: 'PATCH',
        body: updates
      });
      
      state.config = data.agent2;
      state.isDirty = false;
      
      showToast('success', 'Saved', 'Agent 2.0 configuration updated successfully.');
      
    } catch (error) {
      console.error('[Agent2] Save failed:', error);
      showToast('error', 'Save Failed', 'Could not save configuration.');
    }
  }

  /* --------------------------------------------------------------------------
     TEST TURN
     -------------------------------------------------------------------------- */
  async function runTestTurn() {
    const text = DOM.testInput.value.trim();
    if (!text) {
      showToast('warning', 'Empty Input', 'Please enter what the caller says.');
      return;
    }
    
    DOM.btnTestTurn.disabled = true;
    DOM.testOutputReply.textContent = 'Processing...';
    DOM.testOutputReply.classList.remove('empty');
    
    appendTraceLog(`[Turn ${state.testSession.turn + 1}] Caller: "${text}"`);
    
    try {
      const data = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE}/${state.companyId}/agent2/test-turn`, {
        method: 'POST',
        body: {
          text,
          session: state.testSession
        }
      });
      
      // Update display
      DOM.testOutputReply.textContent = data.result?.replyText || 'No reply generated.';
      
      // Update session state
      if (data.result?.sessionUpdates) {
        Object.assign(state.testSession, data.result.sessionUpdates);
      }
      state.testSession.turn++;
      DOM.testSessionState.textContent = JSON.stringify(state.testSession, null, 2);
      
      // Check for handoff payload
      if (data.result?.handoffPayload) {
        DOM.testHandoffPayload.innerHTML = syntaxHighlight(JSON.stringify(data.result.handoffPayload, null, 2));
        appendTraceLog(`[HANDOFF TRIGGERED] Mode switching to BOOKING`);
      }
      
      appendTraceLog(`[Agent] ${data.result?.replyText || 'No reply'}`);
      
      // Clear input
      DOM.testInput.value = '';
      
    } catch (error) {
      console.error('[Agent2] Test turn failed:', error);
      DOM.testOutputReply.textContent = 'Error: ' + error.message;
      appendTraceLog(`[ERROR] ${error.message}`);
    } finally {
      DOM.btnTestTurn.disabled = false;
    }
  }

  function resetTestSession() {
    state.testSession = {
      mode: 'DISCOVERY',
      turn: 0,
      callerName: null,
      intent: null
    };
    
    DOM.testSessionState.textContent = JSON.stringify(state.testSession, null, 2);
    DOM.testOutputReply.textContent = 'Send a message to test the discovery flow...';
    DOM.testOutputReply.classList.add('empty');
    DOM.testHandoffPayload.textContent = 'No handoff triggered yet...';
    DOM.testTraceLog.textContent = '[Session reset - ready for new test]';
    DOM.testInput.value = '';
    
    showToast('info', 'Session Reset', 'Test session has been reset.');
  }

  function appendTraceLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const currentLog = DOM.testTraceLog.textContent;
    if (currentLog.startsWith('[Trace') || currentLog.startsWith('[Session')) {
      DOM.testTraceLog.textContent = `${timestamp} ${message}`;
    } else {
      DOM.testTraceLog.textContent = `${currentLog}\n${timestamp} ${message}`;
    }
    
    // Auto-scroll
    DOM.testTraceLog.parentElement.scrollTop = DOM.testTraceLog.parentElement.scrollHeight;
  }

  function generateSamplePayload() {
    const samplePayload = {
      handoffContractVersion: 'AC1',
      companyId: state.companyId,
      callSid: `CA_TEST_${Date.now()}`,
      fromPhone: '+15551234567',
      assumptions: {
        firstName: state.testSession.callerName?.split(' ')[0] || 'Unknown',
        lastName: state.testSession.callerName?.split(' ').slice(1).join(' ') || ''
      },
      summary: {
        issue: state.testSession.intent || 'Service request',
        serviceType: 'general',
        urgency: 'routine'
      }
    };
    
    DOM.testHandoffPayload.innerHTML = syntaxHighlight(JSON.stringify(samplePayload, null, 2));
    showToast('info', 'Sample Generated', 'Sample handoff payload created.');
  }

  /* --------------------------------------------------------------------------
     DOWNLOAD TRUTH
     -------------------------------------------------------------------------- */
  async function downloadTruthJson() {
    try {
      const data = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE}/${state.companyId}/truth`);
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
      console.error('[Agent2] Download failed:', error);
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
