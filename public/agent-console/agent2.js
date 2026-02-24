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
    isDirty: false,
    
    // ═══════════════════════════════════════════════════════════════
    // 🎙️ GREETINGS STATE (NEW - Feb 2026)
    // ═══════════════════════════════════════════════════════════════
    greetings: {
      callStart: {
        enabled: true,
        text: '',
        audioUrl: null
      },
      interceptor: {
        enabled: true,
        shortOnlyGate: {
          maxWords: 2,
          blockIfIntentWords: true
        },
        intentWords: [],
        rules: []
      }
    },
    currentGreetingRule: null,
    currentAudioPlayer: null
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
    
    // Legacy Greeting (old return caller system - kept for backward compatibility)
    inputGreetingInitial: document.getElementById('input-greeting-initial'),
    inputGreetingReturn: document.getElementById('input-greeting-return'),
    
    // ═══════════════════════════════════════════════════════════════
    // 🎙️ GREETINGS SYSTEM (NEW - Feb 2026)
    // ═══════════════════════════════════════════════════════════════
    
    // Call Start Greeting
    toggleCallStartEnabled: document.getElementById('toggle-call-start-enabled'),
    inputCallStartText: document.getElementById('input-call-start-text'),
    inputCallStartAudio: document.getElementById('input-call-start-audio'),
    btnPlayCallStartAudio: document.getElementById('btn-play-call-start-audio'),
    btnGenerateCallStartAudio: document.getElementById('btn-generate-call-start-audio'),
    callStartAudioStatus: document.getElementById('call-start-audio-status'),
    linkElevenLabsSetupCallStart: document.getElementById('link-elevenlabs-setup-callstart'),
    
    // Greeting Interceptor
    toggleInterceptorEnabled: document.getElementById('toggle-interceptor-enabled'),
    inputMaxWords: document.getElementById('input-max-words'),
    toggleBlockIntentWords: document.getElementById('toggle-block-intent-words'),
    inputIntentWords: document.getElementById('input-intent-words'),
    btnSeedGreetings: document.getElementById('btn-seed-greetings'),
    greetingRulesList: document.getElementById('greeting-rules-list'),
    btnAddGreetingRule: document.getElementById('btn-add-greeting-rule'),
    
    // Greeting Rule Modal
    modalGreetingRule: document.getElementById('modal-greeting-rule'),
    greetingRuleModalTitle: document.getElementById('greeting-rule-modal-title'),
    btnCloseGreetingRuleModal: document.getElementById('btn-close-greeting-rule-modal'),
    inputRuleIdEdit: document.getElementById('input-rule-id-edit'),
    inputRulePriority: document.getElementById('input-rule-priority'),
    inputRuleMatchType: document.getElementById('input-rule-match-type'),
    inputRuleTriggers: document.getElementById('input-rule-triggers'),
    inputRuleResponse: document.getElementById('input-rule-response'),
    inputRuleAudio: document.getElementById('input-rule-audio'),
    btnPlayRuleAudio: document.getElementById('btn-play-rule-audio'),
    btnGenerateRuleAudio: document.getElementById('btn-generate-rule-audio'),
    ruleAudioStatus: document.getElementById('rule-audio-status'),
    btnCancelGreetingRule: document.getElementById('btn-cancel-greeting-rule'),
    btnSaveGreetingRule: document.getElementById('btn-save-greeting-rule'),
    
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
    setupGreetingsEventListeners();
    loadConfig();
    loadGreetings();
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
    
    // Track changes (with null checks for optional fields)
    const inputs = [
      DOM.inputGreetingInitial,
      DOM.inputGreetingReturn,
      DOM.inputAckWord,
      DOM.inputRobotChallengeLine
    ].filter(Boolean);
    
    inputs.forEach(input => {
      input.addEventListener('input', () => { state.isDirty = true; });
    });
    
    if (DOM.inputRobotChallengeEnabled) {
      DOM.inputRobotChallengeEnabled.addEventListener('change', () => { state.isDirty = true; });
    }
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
    
    if (DOM.statClarifiers) DOM.statClarifiers.textContent = config.clarifiers?.length || 0;
    if (DOM.statVocabulary) DOM.statVocabulary.textContent = config.discovery?.vocabulary?.length || 0;
    
    // Legacy Greeting (backward compatibility - these fields may not exist in new UI)
    if (DOM.inputGreetingInitial) DOM.inputGreetingInitial.value = config.greetings?.initial || '';
    if (DOM.inputGreetingReturn) DOM.inputGreetingReturn.value = config.greetings?.returnCaller || '';
    
    // Discovery style
    if (DOM.inputAckWord) DOM.inputAckWord.value = config.discovery?.style?.ackWord || 'Ok.';
    if (DOM.inputRobotChallengeEnabled) DOM.inputRobotChallengeEnabled.checked = config.discovery?.style?.robotChallenge?.enabled || false;
    if (DOM.inputRobotChallengeLine) DOM.inputRobotChallengeLine.value = config.discovery?.style?.robotChallenge?.line || '';
    
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

  /* ══════════════════════════════════════════════════════════════════════════
     🎙️ GREETINGS MANAGEMENT - ENTERPRISE LEVEL (Feb 2026)
     ══════════════════════════════════════════════════════════════════════════
     
     Complete greetings system for Agent 2.0:
     - Call Start Greeting (outbound, before caller speaks)
     - Greeting Interceptor (inbound, responds to "hi", "hello", etc.)
     - Short-Only Gate (prevents hijacking real intent)
     - Intent Word Blocking (filters business keywords)
     - Greeting Rules (priority-based matching with audio support)
     
     ══════════════════════════════════════════════════════════════════════════ */
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * LOAD GREETINGS CONFIGURATION
   * ───────────────────────────────────────────────────────────────────────
   */
  async function loadGreetings() {
    try {
      console.log('[Greetings] Loading greetings config...');
      const response = await AgentConsoleAuth.apiFetch(`/api/admin/agent2/${state.companyId}/greetings`);
      
      console.log('[Greetings] API response:', response);
      
      if (response.success && response.data) {
        state.greetings = response.data;
        console.log('[Greetings] State updated:', state.greetings);
        console.log('[Greetings] Rules loaded:', state.greetings.interceptor?.rules);
        renderGreetings();
      }
    } catch (error) {
      console.error('[Greetings] Load failed:', error);
      showToast('error', 'Load Failed', 'Could not load greetings configuration.');
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * RENDER GREETINGS UI
   * ───────────────────────────────────────────────────────────────────────
   */
  function renderGreetings() {
    // Call Start Greeting
    if (DOM.toggleCallStartEnabled && state.greetings.callStart) {
      DOM.toggleCallStartEnabled.checked = state.greetings.callStart.enabled !== false;
      DOM.inputCallStartText.value = state.greetings.callStart.text || '';
      DOM.inputCallStartAudio.value = state.greetings.callStart.audioUrl || '';
      
      // Show/hide play button based on audio availability
      if (DOM.btnPlayCallStartAudio) {
        DOM.btnPlayCallStartAudio.style.display = state.greetings.callStart.audioUrl ? 'block' : 'none';
      }
      
      // Update audio status
      updateCallStartAudioStatus();
    }
    
    // Greeting Interceptor
    if (DOM.toggleInterceptorEnabled && state.greetings.interceptor) {
      DOM.toggleInterceptorEnabled.checked = state.greetings.interceptor.enabled !== false;
      DOM.inputMaxWords.value = state.greetings.interceptor.shortOnlyGate?.maxWords || 2;
      DOM.toggleBlockIntentWords.checked = state.greetings.interceptor.shortOnlyGate?.blockIfIntentWords !== false;
      
      // Intent words (array to comma-separated string)
      const intentWords = state.greetings.interceptor.intentWords || [];
      DOM.inputIntentWords.value = intentWords.join(', ');
      
      // Render greeting rules
      renderGreetingRules();
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * UPDATE CALL START AUDIO STATUS
   * ───────────────────────────────────────────────────────────────────────
   */
  function updateCallStartAudioStatus() {
    if (!DOM.callStartAudioStatus) return;
    
    const hasAudio = Boolean(state.greetings.callStart?.audioUrl);
    const hasText = Boolean(state.greetings.callStart?.text);
    
    if (hasAudio) {
      DOM.callStartAudioStatus.innerHTML = '<span style="color: #16a34a;">✅ Audio ready</span>';
      if (DOM.btnGenerateCallStartAudio) {
        DOM.btnGenerateCallStartAudio.textContent = 'Regenerate';
      }
    } else if (hasText) {
      DOM.callStartAudioStatus.innerHTML = '<span style="color: #6b7280;">No audio - will use TTS</span>';
      if (DOM.btnGenerateCallStartAudio) {
        DOM.btnGenerateCallStartAudio.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M13.5 3.5L6 11L2.5 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Generate';
      }
    } else {
      DOM.callStartAudioStatus.innerHTML = '<span style="color: #9ca3af;">Enter greeting text first</span>';
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * RENDER GREETING RULES TABLE
   * ───────────────────────────────────────────────────────────────────────
   */
  function renderGreetingRules() {
    if (!DOM.greetingRulesList) return;
    
    const rules = state.greetings.interceptor?.rules || [];
    
    console.log('[Greetings] Rendering rules, count:', rules.length);
    console.log('[Greetings] Rules data:', rules);
    
    if (rules.length === 0) {
      DOM.greetingRulesList.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: #6b7280;">
          <p>No greeting rules yet. Click "Add Rule" or "Seed From Global" to get started.</p>
        </div>
      `;
      return;
    }
    
    // Sort by priority (higher first)
    const sortedRules = [...rules].sort((a, b) => (b.priority || 50) - (a.priority || 50));
    
    const rowsHtml = sortedRules.map(rule => {
      console.log('[Greetings] Rendering rule:', rule);
      const isEnabled = rule.enabled !== false;
      const hasAudio = Boolean(rule.audioUrl);
      const matchBadgeColor = rule.matchType === 'EXACT' ? '#16a34a' : (rule.matchType === 'CONTAINS' ? '#3b82f6' : '#a855f7');
      
      const triggersDisplay = (rule.triggers || []).join(', ') || '—';
      const responseDisplay = rule.response || '—';
      console.log('[Greetings] Rule response field:', { response: rule.response, responseDisplay });
      
      return `
        <div style="display: grid; grid-template-columns: 50px 60px 80px 1fr 1fr 100px 80px; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; align-items: center; ${!isEnabled ? 'opacity: 0.5;' : ''}">
          <div>
            <label class="toggle-switch" style="margin: 0; transform: scale(0.8);">
              <input type="checkbox" class="toggle-rule-enabled" data-rule-id="${rule.ruleId}" ${isEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div style="font-weight: 600; font-size: 0.875rem;">${rule.priority || 50}</div>
          <div>
            <span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; background: ${matchBadgeColor}; color: white;">
              ${rule.matchType || 'EXACT'}
            </span>
          </div>
          <div style="font-size: 0.875rem; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(triggersDisplay)}">
            ${escapeHtml(triggersDisplay)}
          </div>
          <div style="font-size: 0.875rem; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(responseDisplay)}">
            ${escapeHtml(responseDisplay)}
          </div>
          <div style="text-align: center;">
            ${hasAudio 
              ? '<span style="color: #16a34a; font-size: 0.75rem; font-weight: 600;">✓ Audio</span>' 
              : '<span style="color: #9ca3af; font-size: 0.75rem;">—</span>'
            }
          </div>
          <div style="display: flex; gap: 4px; justify-content: flex-end;">
            <button class="btn btn-ghost btn-icon btn-edit-rule" data-rule-id="${rule.ruleId}" title="Edit">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M11.333 2A1.886 1.886 0 0 1 14 4.667l-9 9-3.667 1 1-3.667 9-9Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="btn btn-ghost btn-icon btn-delete-rule" data-rule-id="${rule.ruleId}" title="Delete">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4m2 0v9.333a1.333 1.333 0 0 1-1.334 1.334H4.667a1.333 1.333 0 0 1-1.334-1.334V4h9.334Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    DOM.greetingRulesList.innerHTML = rowsHtml;
    
    // Attach event listeners
    DOM.greetingRulesList.querySelectorAll('.toggle-rule-enabled').forEach(toggle => {
      toggle.addEventListener('change', handleRuleToggle);
    });
    
    DOM.greetingRulesList.querySelectorAll('.btn-edit-rule').forEach(btn => {
      btn.addEventListener('click', handleEditRule);
    });
    
    DOM.greetingRulesList.querySelectorAll('.btn-delete-rule').forEach(btn => {
      btn.addEventListener('click', handleDeleteRule);
    });
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * SAVE CALL START GREETING
   * ───────────────────────────────────────────────────────────────────────
   */
  async function saveCallStartGreeting() {
    try {
      const enabled = DOM.toggleCallStartEnabled.checked;
      const text = DOM.inputCallStartText.value.trim();
      
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/call-start`,
        {
          method: 'PUT',
          body: { enabled, text }
        }
      );
      
      if (response.success) {
        state.greetings.callStart = response.data;
        
        if (response.audioInvalidated) {
          showToast('warning', 'Audio Invalidated', 'Text changed — please regenerate audio to match new content.');
          DOM.inputCallStartAudio.value = '';
          DOM.btnPlayCallStartAudio.style.display = 'none';
        } else {
          showToast('success', 'Saved', 'Call start greeting updated successfully.');
        }
        
        updateCallStartAudioStatus();
      }
    } catch (error) {
      console.error('[Greetings] Save call start failed:', error);
      showToast('error', 'Save Failed', error.message || 'Could not save call start greeting.');
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * GENERATE CALL START AUDIO
   * ───────────────────────────────────────────────────────────────────────
   */
  async function generateCallStartAudio() {
    const text = DOM.inputCallStartText.value.trim();
    
    if (!text) {
      showToast('error', 'Text Required', 'Enter greeting text first');
      return;
    }
    
    const btn = DOM.btnGenerateCallStartAudio;
    const originalHtml = btn.innerHTML;
    
    btn.disabled = true;
    btn.textContent = 'Generating...';
    DOM.callStartAudioStatus.innerHTML = '<span style="color: #3b82f6;">Generating audio with your ElevenLabs voice...</span>';
    
    try {
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/call-start/audio`,
        {
          method: 'POST',
          body: { text }
        }
      );
      
      if (response.success && response.audioUrl) {
        state.greetings.callStart.audioUrl = response.audioUrl;
        DOM.inputCallStartAudio.value = response.audioUrl;
        DOM.btnPlayCallStartAudio.style.display = 'block';
        btn.textContent = 'Regenerate';
        DOM.callStartAudioStatus.innerHTML = '<span style="color: #16a34a;">✅ Audio generated! Click Save Changes to keep it.</span>';
        
        showToast('success', 'Audio Generated', response.cached ? 'Using cached audio' : 'Audio created with your ElevenLabs voice');
      }
    } catch (error) {
      console.error('[Greetings] Audio generation failed:', error);
      btn.innerHTML = originalHtml;
      
      const errorMsg = error.message || 'Generation failed';
      const hint = errorMsg.includes('voice') 
        ? 'Configure your ElevenLabs voice in Company Profile first.'
        : 'Could not generate audio.';
      DOM.callStartAudioStatus.innerHTML = `<span style="color: #dc2626;">❌ ${errorMsg}</span> ${hint}`;
      
      showToast('error', 'Generation Failed', error.message || 'Could not generate audio');
    } finally {
      btn.disabled = false;
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * PLAY CALL START AUDIO
   * ───────────────────────────────────────────────────────────────────────
   */
  function playCallStartAudio() {
    let audioUrl = DOM.inputCallStartAudio.value.trim();
    
    if (!audioUrl) {
      showToast('error', 'No Audio', 'Generate audio first');
      return;
    }
    
    // Stop any currently playing audio
    if (state.currentAudioPlayer) {
      state.currentAudioPlayer.pause();
      state.currentAudioPlayer = null;
      DOM.btnPlayCallStartAudio.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play';
      return;
    }
    
    // Add cache-busting parameter
    const cacheBuster = `_cb=${Date.now()}`;
    audioUrl = audioUrl.includes('?') ? `${audioUrl}&${cacheBuster}` : `${audioUrl}?${cacheBuster}`;
    
    state.currentAudioPlayer = new Audio(audioUrl);
    DOM.btnPlayCallStartAudio.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><rect x="4" y="3" width="3" height="10" fill="currentColor"/><rect x="9" y="3" width="3" height="10" fill="currentColor"/></svg>Stop';
    
    state.currentAudioPlayer.onended = () => {
      state.currentAudioPlayer = null;
      DOM.btnPlayCallStartAudio.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play';
    };
    
    state.currentAudioPlayer.play();
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * SAVE GREETING INTERCEPTOR SETTINGS
   * ───────────────────────────────────────────────────────────────────────
   */
  async function saveGreetingInterceptor() {
    try {
      const enabled = DOM.toggleInterceptorEnabled.checked;
      const maxWords = parseInt(DOM.inputMaxWords.value) || 2;
      const blockIfIntentWords = DOM.toggleBlockIntentWords.checked;
      
      // Parse intent words (comma-separated to array)
      const intentWordsText = DOM.inputIntentWords.value || '';
      const intentWords = intentWordsText
        .split(',')
        .map(word => word.trim().toLowerCase())
        .filter(Boolean);
      
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/interceptor`,
        {
          method: 'PUT',
          body: {
            enabled,
            shortOnlyGate: { maxWords, blockIfIntentWords },
            intentWords
          }
        }
      );
      
      if (response.success) {
        state.greetings.interceptor = response.data;
        showToast('success', 'Saved', 'Greeting interceptor settings updated successfully.');
      }
    } catch (error) {
      console.error('[Greetings] Save interceptor failed:', error);
      showToast('error', 'Save Failed', error.message || 'Could not save interceptor settings.');
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * SEED FROM GLOBAL (Load Default Greeting Rules)
   * ───────────────────────────────────────────────────────────────────────
   */
  async function seedGlobalGreetings() {
    if (!confirm('Load default greeting rules?\n\nThis will add 4 standard greeting rules (hi/hello, good morning, good afternoon, good evening) if they don\'t already exist.')) {
      return;
    }
    
    try {
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/seed-global`,
        { method: 'POST' }
      );
      
      if (response.success) {
        const { rulesAdded, rules } = response.data;
        
        if (rulesAdded === 0) {
          showToast('info', 'Already Loaded', 'All default greeting rules already exist.');
        } else {
          showToast('success', 'Rules Added', `${rulesAdded} default greeting rules added successfully.`);
          
          // Reload greetings to show new rules
          await loadGreetings();
        }
      }
    } catch (error) {
      console.error('[Greetings] Seed global failed:', error);
      showToast('error', 'Seed Failed', error.message || 'Could not load default greeting rules.');
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * OPEN ADD GREETING RULE MODAL
   * ───────────────────────────────────────────────────────────────────────
   */
  function openAddGreetingRuleModal() {
    state.currentGreetingRule = null;
    
    DOM.greetingRuleModalTitle.textContent = 'Add Greeting Rule';
    DOM.inputRuleIdEdit.value = '';
    DOM.inputRulePriority.value = '50';
    DOM.inputRuleMatchType.value = 'EXACT';
    DOM.inputRuleTriggers.value = '';
    DOM.inputRuleResponse.value = '';
    DOM.inputRuleAudio.value = '';
    DOM.btnPlayRuleAudio.style.display = 'none';
    DOM.ruleAudioStatus.textContent = 'Save the rule first, then generate audio.';
    
    DOM.modalGreetingRule.classList.add('active');
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * HANDLE EDIT RULE
   * ───────────────────────────────────────────────────────────────────────
   */
  function handleEditRule(e) {
    const ruleId = e.currentTarget.dataset.ruleId;
    const rule = state.greetings.interceptor.rules.find(r => r.ruleId === ruleId);
    
    if (!rule) return;
    
    state.currentGreetingRule = rule;
    
    DOM.greetingRuleModalTitle.textContent = 'Edit Greeting Rule';
    DOM.inputRuleIdEdit.value = rule.ruleId;
    DOM.inputRulePriority.value = rule.priority || 50;
    DOM.inputRuleMatchType.value = rule.matchType || 'EXACT';
    DOM.inputRuleTriggers.value = (rule.triggers || []).join(', ');
    DOM.inputRuleResponse.value = rule.response || '';
    DOM.inputRuleAudio.value = rule.audioUrl || '';
    DOM.btnPlayRuleAudio.style.display = rule.audioUrl ? 'block' : 'none';
    DOM.ruleAudioStatus.textContent = rule.audioUrl ? 'Audio ready' : 'No audio yet';
    
    DOM.modalGreetingRule.classList.add('active');
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * SAVE GREETING RULE (Create or Update)
   * ───────────────────────────────────────────────────────────────────────
   */
  async function saveGreetingRule() {
    try {
      const priority = parseInt(DOM.inputRulePriority.value) || 50;
      const matchType = DOM.inputRuleMatchType.value || 'EXACT';
      const triggersText = DOM.inputRuleTriggers.value.trim();
      const response = DOM.inputRuleResponse.value.trim();
      
      // Validation
      if (!triggersText) {
        showToast('error', 'Triggers Required', 'Enter at least one trigger phrase.');
        return;
      }
      
      if (!response) {
        showToast('error', 'Response Required', 'Enter a response text.');
        return;
      }
      
      const triggers = triggersText.split(',').map(t => t.trim()).filter(Boolean);
      
      if (triggers.length === 0) {
        showToast('error', 'Triggers Required', 'Enter at least one trigger phrase.');
        return;
      }
      
      const isEditing = Boolean(state.currentGreetingRule);
      
      if (isEditing) {
        // Update existing rule
        const ruleId = state.currentGreetingRule.ruleId;
        
        const updateResponse = await AgentConsoleAuth.apiFetch(
          `/api/admin/agent2/${state.companyId}/greetings/rules/${ruleId}`,
          {
            method: 'PATCH',
            body: { priority, matchType, triggers, response }
          }
        );
        
        if (updateResponse.success) {
          // Update local state
          const ruleIndex = state.greetings.interceptor.rules.findIndex(r => r.ruleId === ruleId);
          if (ruleIndex !== -1) {
            state.greetings.interceptor.rules[ruleIndex] = updateResponse.data;
          }
          
          if (updateResponse.audioInvalidated) {
            showToast('warning', 'Audio Invalidated', 'Response changed — please regenerate audio.');
          } else {
            showToast('success', 'Saved', 'Greeting rule updated successfully.');
          }
          
          renderGreetingRules();
          closeGreetingRuleModal();
        }
      } else {
        // Create new rule
        const ruleId = `greeting-rule-${Date.now()}`;
        
        const createResponse = await AgentConsoleAuth.apiFetch(
          `/api/admin/agent2/${state.companyId}/greetings/rules`,
          {
            method: 'POST',
            body: { ruleId, priority, matchType, triggers, response }
          }
        );
        
        if (createResponse.success) {
          state.greetings.interceptor.rules.push(createResponse.data);
          showToast('success', 'Created', 'Greeting rule created successfully.');
          renderGreetingRules();
          closeGreetingRuleModal();
        }
      }
    } catch (error) {
      console.error('[Greetings] Save rule failed:', error);
      showToast('error', 'Save Failed', error.message || 'Could not save greeting rule.');
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * HANDLE RULE TOGGLE (Enable/Disable)
   * ───────────────────────────────────────────────────────────────────────
   */
  async function handleRuleToggle(e) {
    const ruleId = e.target.dataset.ruleId;
    const enabled = e.target.checked;
    
    try {
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/rules/${ruleId}`,
        {
          method: 'PATCH',
          body: { enabled }
        }
      );
      
      if (response.success) {
        const ruleIndex = state.greetings.interceptor.rules.findIndex(r => r.ruleId === ruleId);
        if (ruleIndex !== -1) {
          state.greetings.interceptor.rules[ruleIndex] = response.data;
        }
        renderGreetingRules();
        showToast('success', enabled ? 'Enabled' : 'Disabled', 'Greeting rule updated.');
      }
    } catch (error) {
      console.error('[Greetings] Toggle rule failed:', error);
      e.target.checked = !enabled; // Revert toggle
      showToast('error', 'Toggle Failed', error.message || 'Could not update rule.');
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * HANDLE DELETE RULE
   * ───────────────────────────────────────────────────────────────────────
   */
  async function handleDeleteRule(e) {
    const ruleId = e.currentTarget.dataset.ruleId;
    const rule = state.greetings.interceptor.rules.find(r => r.ruleId === ruleId);
    
    if (!rule) return;
    
    if (!confirm(`Delete greeting rule?\n\nTriggers: ${(rule.triggers || []).join(', ')}\nResponse: ${rule.response}\n\nThis cannot be undone.`)) {
      return;
    }
    
    try {
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/rules/${ruleId}`,
        { method: 'DELETE' }
      );
      
      if (response.success) {
        state.greetings.interceptor.rules = state.greetings.interceptor.rules.filter(r => r.ruleId !== ruleId);
        renderGreetingRules();
        showToast('success', 'Deleted', 'Greeting rule deleted successfully.');
      }
    } catch (error) {
      console.error('[Greetings] Delete rule failed:', error);
      showToast('error', 'Delete Failed', error.message || 'Could not delete greeting rule.');
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * GENERATE RULE AUDIO
   * ───────────────────────────────────────────────────────────────────────
   */
  async function generateRuleAudio() {
    const ruleId = DOM.inputRuleIdEdit.value;
    const text = DOM.inputRuleResponse.value.trim();
    
    if (!ruleId) {
      showToast('error', 'Save First', 'Save the rule before generating audio');
      return;
    }
    
    if (!text) {
      showToast('error', 'Text Required', 'Enter response text first');
      return;
    }
    
    const btn = DOM.btnGenerateRuleAudio;
    const originalHtml = btn.innerHTML;
    
    btn.disabled = true;
    btn.textContent = 'Generating...';
    DOM.ruleAudioStatus.textContent = 'Generating audio with your ElevenLabs voice...';
    
    try {
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/rules/${ruleId}/audio`,
        {
          method: 'POST',
          body: { text }
        }
      );
      
      if (response.success && response.audioUrl) {
        DOM.inputRuleAudio.value = response.audioUrl;
        DOM.btnPlayRuleAudio.style.display = 'block';
        btn.textContent = 'Regenerate';
        DOM.ruleAudioStatus.textContent = '✅ Audio generated! Click Save Rule to keep it.';
        
        showToast('success', 'Audio Generated', response.cached ? 'Using cached audio' : 'Audio created with your ElevenLabs voice');
      }
    } catch (error) {
      console.error('[Greetings] Audio generation failed:', error);
      btn.innerHTML = originalHtml;
      
      const errorMsg = error.message || 'Generation failed';
      DOM.ruleAudioStatus.textContent = `❌ ${errorMsg}`;
      
      showToast('error', 'Generation Failed', error.message || 'Could not generate audio');
    } finally {
      btn.disabled = false;
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * PLAY RULE AUDIO
   * ───────────────────────────────────────────────────────────────────────
   */
  function playRuleAudio() {
    let audioUrl = DOM.inputRuleAudio.value.trim();
    
    if (!audioUrl) {
      showToast('error', 'No Audio', 'Generate audio first');
      return;
    }
    
    // Stop any currently playing audio
    if (state.currentAudioPlayer) {
      state.currentAudioPlayer.pause();
      state.currentAudioPlayer = null;
      DOM.btnPlayRuleAudio.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play';
      return;
    }
    
    // Add cache-busting parameter
    const cacheBuster = `_cb=${Date.now()}`;
    audioUrl = audioUrl.includes('?') ? `${audioUrl}&${cacheBuster}` : `${audioUrl}?${cacheBuster}`;
    
    state.currentAudioPlayer = new Audio(audioUrl);
    DOM.btnPlayRuleAudio.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><rect x="4" y="3" width="3" height="10" fill="currentColor"/><rect x="9" y="3" width="3" height="10" fill="currentColor"/></svg>Stop';
    
    state.currentAudioPlayer.onended = () => {
      state.currentAudioPlayer = null;
      DOM.btnPlayRuleAudio.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play';
    };
    
    state.currentAudioPlayer.play();
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * CLOSE GREETING RULE MODAL
   * ───────────────────────────────────────────────────────────────────────
   */
  function closeGreetingRuleModal() {
    DOM.modalGreetingRule.classList.remove('active');
    state.currentGreetingRule = null;
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * SETUP GREETINGS EVENT LISTENERS
   * ───────────────────────────────────────────────────────────────────────
   */
  function setupGreetingsEventListeners() {
    // Call Start Greeting
    if (DOM.toggleCallStartEnabled) {
      DOM.toggleCallStartEnabled.addEventListener('change', saveCallStartGreeting);
    }
    
    if (DOM.inputCallStartText) {
      DOM.inputCallStartText.addEventListener('blur', saveCallStartGreeting);
      DOM.inputCallStartText.addEventListener('input', updateCallStartAudioStatus);
    }
    
    if (DOM.btnGenerateCallStartAudio) {
      DOM.btnGenerateCallStartAudio.addEventListener('click', generateCallStartAudio);
    }
    
    if (DOM.btnPlayCallStartAudio) {
      DOM.btnPlayCallStartAudio.addEventListener('click', playCallStartAudio);
    }
    
    if (DOM.linkElevenLabsSetupCallStart) {
      DOM.linkElevenLabsSetupCallStart.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(`/company-profile.html?companyId=${encodeURIComponent(state.companyId)}#elevenlabs`, '_blank');
      });
    }
    
    // Greeting Interceptor
    if (DOM.toggleInterceptorEnabled) {
      DOM.toggleInterceptorEnabled.addEventListener('change', saveGreetingInterceptor);
    }
    
    if (DOM.inputMaxWords) {
      DOM.inputMaxWords.addEventListener('blur', saveGreetingInterceptor);
    }
    
    if (DOM.toggleBlockIntentWords) {
      DOM.toggleBlockIntentWords.addEventListener('change', saveGreetingInterceptor);
    }
    
    if (DOM.inputIntentWords) {
      DOM.inputIntentWords.addEventListener('blur', saveGreetingInterceptor);
    }
    
    if (DOM.btnSeedGreetings) {
      DOM.btnSeedGreetings.addEventListener('click', seedGlobalGreetings);
    }
    
    if (DOM.btnAddGreetingRule) {
      DOM.btnAddGreetingRule.addEventListener('click', openAddGreetingRuleModal);
    }
    
    // Modal controls
    if (DOM.btnCloseGreetingRuleModal) {
      DOM.btnCloseGreetingRuleModal.addEventListener('click', closeGreetingRuleModal);
    }
    
    if (DOM.btnCancelGreetingRule) {
      DOM.btnCancelGreetingRule.addEventListener('click', closeGreetingRuleModal);
    }
    
    if (DOM.btnSaveGreetingRule) {
      DOM.btnSaveGreetingRule.addEventListener('click', saveGreetingRule);
    }
    
    if (DOM.btnGenerateRuleAudio) {
      DOM.btnGenerateRuleAudio.addEventListener('click', generateRuleAudio);
    }
    
    if (DOM.btnPlayRuleAudio) {
      DOM.btnPlayRuleAudio.addEventListener('click', playRuleAudio);
    }
    
    // Close modal on backdrop click
    if (DOM.modalGreetingRule) {
      DOM.modalGreetingRule.addEventListener('click', (e) => {
        if (e.target === DOM.modalGreetingRule) {
          closeGreetingRuleModal();
        }
      });
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
