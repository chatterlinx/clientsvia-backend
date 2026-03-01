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
      }
    },
    currentAudioPlayer: null,
    llm0Controls: {},

    // Unsaved-change guards (config is saved via "Save Changes"; greetings auto-save on blur/change)
    greetingsDirty: false
  };

  /* --------------------------------------------------------------------------
     UNSAVED CHANGES PROTECTION
     -------------------------------------------------------------------------- */
  function hasUnsavedChanges() {
    return state.isDirty === true || state.greetingsDirty === true || state.greetingRuleDirty === true;
  }

  function confirmDiscardUnsavedChanges() {
    return confirm('You have unsaved changes. Leave this page without saving?');
  }

  function navigateWithUnsavedGuard(navigateFn) {
    if (hasUnsavedChanges() && !confirmDiscardUnsavedChanges()) return;
    navigateFn();
  }

  function setupUnsavedChangesProtection() {
    // Browser-level guard: refresh/close/tab switch/back button.
    window.addEventListener('beforeunload', (e) => {
      if (!hasUnsavedChanges()) return;
      e.preventDefault();
      // Required for Chrome/Safari to show the prompt
      e.returnValue = '';
    });
  }

  /* --------------------------------------------------------------------------
     DOM REFERENCES
     -------------------------------------------------------------------------- */
  const DOM = {
    // Header
    headerCompanyName: document.getElementById('header-company-name'),
    headerCompanyId: document.getElementById('header-company-id'),
    // Note: btnDownloadTruth removed - handled by shared/truthButton.js
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
    inputCallStartEmergencyFallback: document.getElementById('input-call-start-emergency-fallback'),
    inputCallStartAudio: document.getElementById('input-call-start-audio'),
    btnPlayCallStartAudio: document.getElementById('btn-play-call-start-audio'),
    btnGenerateCallStartAudio: document.getElementById('btn-generate-call-start-audio'),
    callStartAudioStatus: document.getElementById('call-start-audio-status'),
    linkElevenLabsSetupCallStart: document.getElementById('link-elevenlabs-setup-callstart'),
    
    // Bridge (Latency Filler)
    inputBridgeEnabled: document.getElementById('input-bridge-enabled'),
    inputBridgeThreshold: document.getElementById('input-bridge-threshold'),
    inputBridgeHardcap: document.getElementById('input-bridge-hardcap'),
    inputBridgeMaxPerCall: document.getElementById('input-bridge-max-per-call'),
    inputBridgeMaxRedirects: document.getElementById('input-bridge-max-redirects'),
    inputBridgeLines: document.getElementById('input-bridge-lines'),
    
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
    inputRecoveryAudioUnclear: document.getElementById('input-recovery-audio-unclear'),
    inputRecoverySilence: document.getElementById('input-recovery-silence'),
    inputRecoveryConnectionCutout: document.getElementById('input-recovery-connection-cutout'),
    inputRecoveryGeneralError: document.getElementById('input-recovery-general-error'),
    inputRecoveryTechnicalTransfer: document.getElementById('input-recovery-technical-transfer'),
    inputDiscoveryConsentQuestion: document.getElementById('input-discovery-consent-question'),
    inputFallbackNoMatchAnswer: document.getElementById('input-fallback-no-match-answer'),
    inputFallbackNoMatchWhenReasonCaptured: document.getElementById('input-fallback-no-match-when-reason-captured'),
    inputFallbackNoMatchClarifierQuestion: document.getElementById('input-fallback-no-match-clarifier-question'),
    
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
    setupUnsavedChangesProtection();
    loadConfig();
    loadGreetings();
    loadHealthStatus();
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
      navigateWithUnsavedGuard(() => {
        window.location.href = `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
      });
    });

    // Header logo link (also navigates away)
    const headerLogoLink = document.getElementById('header-logo-link');
    if (headerLogoLink) {
      headerLogoLink.addEventListener('click', (e) => {
        e.preventDefault();
        const href = headerLogoLink.getAttribute('href');
        navigateWithUnsavedGuard(() => {
          if (href) window.location.href = href;
        });
      });
    }
    
    // Back to Company Profile
    DOM.btnBackToProfile.addEventListener('click', () => {
      navigateWithUnsavedGuard(() => {
        window.location.href = `/company-profile.html?companyId=${encodeURIComponent(state.companyId)}`;
      });
    });
    
    // Trigger Console link
    const linkTriggerConsole = document.getElementById('link-trigger-console');
    if (linkTriggerConsole) {
      linkTriggerConsole.addEventListener('click', (e) => {
        e.preventDefault();
        navigateWithUnsavedGuard(() => {
          window.location.href = `/agent-console/triggers.html?companyId=${encodeURIComponent(state.companyId)}`;
        });
      });
    }
    
    const statBoxTriggers = document.getElementById('stat-box-triggers');
    if (statBoxTriggers) {
      statBoxTriggers.addEventListener('click', () => {
        navigateWithUnsavedGuard(() => {
          window.location.href = `/agent-console/triggers.html?companyId=${encodeURIComponent(state.companyId)}`;
        });
      });
      statBoxTriggers.style.cursor = 'pointer';
    }
    
    // Health Monitor
    const btnRefreshHealth = document.getElementById('btn-refresh-health');
    if (btnRefreshHealth) {
      btnRefreshHealth.addEventListener('click', refreshHealthStatus);
    }
    
    // Note: btnDownloadTruth event listener removed - handled by shared/truthButton.js
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
      DOM.inputRobotChallengeLine,
      DOM.inputRecoveryAudioUnclear,
      DOM.inputRecoverySilence,
      DOM.inputRecoveryConnectionCutout,
      DOM.inputRecoveryGeneralError,
      DOM.inputRecoveryTechnicalTransfer,
      DOM.inputDiscoveryConsentQuestion,
      DOM.inputFallbackNoMatchAnswer,
      DOM.inputFallbackNoMatchWhenReasonCaptured,
      DOM.inputFallbackNoMatchClarifierQuestion,
      DOM.inputBridgeThreshold,
      DOM.inputBridgeHardcap,
      DOM.inputBridgeMaxPerCall,
      DOM.inputBridgeMaxRedirects,
      DOM.inputBridgeLines
    ].filter(Boolean);
    
    inputs.forEach(input => {
      input.addEventListener('input', () => { state.isDirty = true; });
    });
    
    if (DOM.inputRobotChallengeEnabled) {
      DOM.inputRobotChallengeEnabled.addEventListener('change', () => { state.isDirty = true; });
    }
    if (DOM.inputBridgeEnabled) {
      DOM.inputBridgeEnabled.addEventListener('change', () => { state.isDirty = true; });
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
      state.llm0Controls = response.llm0Controls || {};
      state.triggerStats = response.triggerStats || {};
      
      DOM.headerCompanyName.textContent = state.companyName;
      renderConfig();
      
    } catch (error) {
      console.error('[Agent2] Failed to load config:', error);
      showToast('error', 'Load Failed', 'Could not load Agent 2.0 configuration.');
      
      // Use defaults
      state.config = {};
      state.llm0Controls = {};
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
    if (DOM.inputGreetingReturn) {
      const returnCallerValue = config.greetings?.returnCaller;
      const returnCallerText = typeof returnCallerValue === 'string'
        ? returnCallerValue
        : (returnCallerValue?.text || '');
      DOM.inputGreetingReturn.value = returnCallerText;
    }
    
    // Discovery style
    if (DOM.inputAckWord) DOM.inputAckWord.value = config.discovery?.style?.ackWord || 'Ok.';
    if (DOM.inputRobotChallengeEnabled) DOM.inputRobotChallengeEnabled.checked = config.discovery?.style?.robotChallenge?.enabled || false;
    if (DOM.inputRobotChallengeLine) DOM.inputRobotChallengeLine.value = config.discovery?.style?.robotChallenge?.line || '';
    if (DOM.inputDiscoveryConsentQuestion) DOM.inputDiscoveryConsentQuestion.value = config.discovery?.discoveryHandoff?.consentQuestion || '';
    if (DOM.inputFallbackNoMatchAnswer) DOM.inputFallbackNoMatchAnswer.value = config.discovery?.playbook?.fallback?.noMatchAnswer || '';
    if (DOM.inputFallbackNoMatchWhenReasonCaptured) DOM.inputFallbackNoMatchWhenReasonCaptured.value = config.discovery?.playbook?.fallback?.noMatchWhenReasonCaptured || '';
    if (DOM.inputFallbackNoMatchClarifierQuestion) DOM.inputFallbackNoMatchClarifierQuestion.value = config.discovery?.playbook?.fallback?.noMatchClarifierQuestion || '';
    // Bridge (Latency Filler)
    const bridge = config.bridge || {};
    if (DOM.inputBridgeEnabled) DOM.inputBridgeEnabled.checked = bridge.enabled === true;
    if (DOM.inputBridgeThreshold) DOM.inputBridgeThreshold.value = bridge.thresholdMs || 1100;
    if (DOM.inputBridgeHardcap) DOM.inputBridgeHardcap.value = bridge.hardCapMs || 6000;
    if (DOM.inputBridgeMaxPerCall) DOM.inputBridgeMaxPerCall.value = bridge.maxBridgesPerCall || 2;
    if (DOM.inputBridgeMaxRedirects) DOM.inputBridgeMaxRedirects.value = bridge.maxRedirectAttempts || 2;
    if (DOM.inputBridgeLines) DOM.inputBridgeLines.value = (bridge.lines || []).join('\n');
    
    const rm = state.llm0Controls?.recoveryMessages || {};
    if (DOM.inputRecoveryAudioUnclear) DOM.inputRecoveryAudioUnclear.value = rm.audioUnclear || '';
    if (DOM.inputRecoverySilence) DOM.inputRecoverySilence.value = rm.silenceRecovery || rm.noSpeech || '';
    if (DOM.inputRecoveryConnectionCutout) DOM.inputRecoveryConnectionCutout.value = rm.connectionCutOut || '';
    if (DOM.inputRecoveryGeneralError) DOM.inputRecoveryGeneralError.value = rm.generalError || '';
    if (DOM.inputRecoveryTechnicalTransfer) DOM.inputRecoveryTechnicalTransfer.value = rm.technicalTransfer || '';
    
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
  function parseBulkPhrases(raw) {
    const text = `${raw || ''}`.trim();
    if (!text) return [];

    // Allow bulk add via commas / new lines / semicolons.
    // Example: "yes, yeah, sure" → ["yes","yeah","sure"]
    return text
      .split(/[,;\n]+/g)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => p.toLowerCase());
  }

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
    const phrases = parseBulkPhrases(input.value);
    if (phrases.length === 0) return;
    
    const arrayKey = type === 'consent' ? 'consentPhrases' : 'escalationPhrases';
    const defaults = type === 'consent' ? CONFIG.DEFAULT_CONSENT_PHRASES : CONFIG.DEFAULT_ESCALATION_PHRASES;
    
    if (!state.config[arrayKey]) {
      state.config[arrayKey] = [...defaults];
    }

    // De-dupe within the pasted set and against existing phrases.
    const existing = new Set((state.config[arrayKey] || []).map(p => `${p}`.trim().toLowerCase()).filter(Boolean));
    const uniqueIncoming = Array.from(new Set(phrases));

    let added = 0;
    let skipped = 0;
    for (const phrase of uniqueIncoming) {
      if (!phrase) continue;
      if (existing.has(phrase)) {
        skipped++;
        continue;
      }
      state.config[arrayKey].push(phrase);
      existing.add(phrase);
      added++;
    }

    if (added === 0) {
      showToast('warning', 'Duplicate', 'All phrases already exist.');
      return;
    }

    renderPhraseList(type, state.config[arrayKey]);
    input.value = '';
    state.isDirty = true;

    if (skipped > 0) {
      showToast('success', 'Added', `Added ${added} phrase${added !== 1 ? 's' : ''} (skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}).`);
    } else {
      showToast('success', 'Added', `Added ${added} phrase${added !== 1 ? 's' : ''}.`);
    }
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
      // IMPORTANT: Greetings are managed by dedicated /greetings endpoints.
      // Do not write partial greetings here, or we risk overwriting callStart/interceptor/audio fields.
      discovery: {
        ...state.config.discovery,
        style: {
          ackWord: DOM.inputAckWord.value.trim() || 'Ok.',
          robotChallenge: {
            enabled: DOM.inputRobotChallengeEnabled.checked,
            line: DOM.inputRobotChallengeLine.value.trim()
          }
        },
        discoveryHandoff: {
          ...(state.config.discovery?.discoveryHandoff || {}),
          consentQuestion: DOM.inputDiscoveryConsentQuestion?.value?.trim() || ''
        },
        playbook: {
          ...(state.config.discovery?.playbook || {}),
          fallback: {
            ...(state.config.discovery?.playbook?.fallback || {}),
            noMatchAnswer: DOM.inputFallbackNoMatchAnswer?.value?.trim() || '',
            noMatchWhenReasonCaptured: DOM.inputFallbackNoMatchWhenReasonCaptured?.value?.trim() || '',
            noMatchClarifierQuestion: DOM.inputFallbackNoMatchClarifierQuestion?.value?.trim() || ''
          }
        }
      },
      bridge: {
        enabled: DOM.inputBridgeEnabled?.checked || false,
        thresholdMs: parseInt(DOM.inputBridgeThreshold?.value, 10) || 1100,
        hardCapMs: parseInt(DOM.inputBridgeHardcap?.value, 10) || 6000,
        maxBridgesPerCall: parseInt(DOM.inputBridgeMaxPerCall?.value, 10) || 2,
        maxRedirectAttempts: parseInt(DOM.inputBridgeMaxRedirects?.value, 10) || 2,
        lines: (DOM.inputBridgeLines?.value || '').split('\n').map(l => l.trim()).filter(Boolean)
      },
      consentPhrases: state.config.consentPhrases,
      escalationPhrases: state.config.escalationPhrases,
      llm0Controls: {
        ...(state.llm0Controls || {}),
        recoveryMessages: {
          ...(state.llm0Controls?.recoveryMessages || {}),
          audioUnclear: DOM.inputRecoveryAudioUnclear?.value?.trim() || '',
          silenceRecovery: DOM.inputRecoverySilence?.value?.trim() || '',
          connectionCutOut: DOM.inputRecoveryConnectionCutout?.value?.trim() || '',
          generalError: DOM.inputRecoveryGeneralError?.value?.trim() || '',
          technicalTransfer: DOM.inputRecoveryTechnicalTransfer?.value?.trim() || ''
        }
      }
    };
    
    try {
      const data = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE}/${state.companyId}/agent2/config`, {
        method: 'PATCH',
        body: updates
      });
      
      state.config = data.agent2;
      state.llm0Controls = data.llm0Controls || state.llm0Controls;
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

  // Note: downloadTruthJson removed - handled by shared/truthButton.js

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
        
        // Auto-migrate if old schema detected
        await checkAndMigrateSchema();
        
        renderGreetings();
      }
    } catch (error) {
      console.error('[Greetings] Load failed:', error);
      showToast('error', 'Load Failed', 'Could not load greetings configuration.');
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * CHECK AND AUTO-MIGRATE OLD SCHEMA
   * ───────────────────────────────────────────────────────────────────────
   * Automatically migrates old greeting rules from legacy schema to new schema
   * ───────────────────────────────────────────────────────────────────────
   */
  async function checkAndMigrateSchema() {
    const rules = state.greetings.interceptor?.rules || [];
    
    // Check if any rule has old schema (has 'id' but not 'ruleId')
    const hasOldSchema = rules.some(r => r.id && !r.ruleId);
    
    if (hasOldSchema) {
      console.log('[Greetings] Old schema detected, auto-migrating to new schema...');
      
      try {
        const response = await AgentConsoleAuth.apiFetch(
          `/api/admin/agent2/${state.companyId}/greetings/migrate-schema`,
          { method: 'POST' }
        );
        
        if (response.success) {
          console.log('[Greetings] Schema migrated successfully:', response.data);
          showToast('success', 'Migrated', `Greeting rules updated to new schema (${response.data.rulesMigrated} rules)`);
          
          // Reload greetings to get migrated data
          const reloadResponse = await AgentConsoleAuth.apiFetch(`/api/admin/agent2/${state.companyId}/greetings`);
          if (reloadResponse.success && reloadResponse.data) {
            state.greetings = reloadResponse.data;
            console.log('[Greetings] Reloaded after migration:', state.greetings);
          }
        }
      } catch (error) {
        console.error('[Greetings] Auto-migration failed:', error);
      }
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
      console.log('[Greetings] LOAD — callStart:', JSON.stringify(state.greetings.callStart, null, 2));
      console.log('[Greetings] LOAD — emergencyFallback:', state.greetings.callStart.emergencyFallback || '(empty)');
      DOM.toggleCallStartEnabled.checked = state.greetings.callStart.enabled !== false;
      DOM.inputCallStartText.value = state.greetings.callStart.text || '';
      if (DOM.inputCallStartEmergencyFallback) {
        DOM.inputCallStartEmergencyFallback.value = state.greetings.callStart.emergencyFallback || '';
      }
      DOM.inputCallStartAudio.value = state.greetings.callStart.audioUrl || '';
      
      // Show/hide play button based on audio availability
      if (DOM.btnPlayCallStartAudio) {
        DOM.btnPlayCallStartAudio.style.display = state.greetings.callStart.audioUrl ? 'block' : 'none';
      }
      
      // Update audio status
      updateCallStartAudioStatus();
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
   * SAVE CALL START GREETING
   * ───────────────────────────────────────────────────────────────────────
   */
  async function saveCallStartGreeting() {
    if (!DOM.greetingRulesList) return;
    
    const rules = state.greetings.interceptor?.rules || [];
    
    console.log('[Greetings] Rendering rules, count:', rules.length);
    console.log('[Greetings] Rules data:', rules);
    
    if (rules.length === 0) {
      DOM.greetingRulesList.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: #6b7280;">
          <p>No greeting rules yet. Click "Add Rule" to create your first greeting response.</p>
        </div>
      `;
      return;
    }
    
    // Sort by priority (higher first)
    const sortedRules = [...rules].sort((a, b) => (b.priority || 50) - (a.priority || 50));
    
    const rowsHtml = sortedRules.map(rule => {
      const isEnabled = rule.enabled !== false;
      const hasAudio = Boolean(rule.audioUrl);
      
      // Support both old and new field names for matchType
      const matchType = rule.matchType || rule.matchMode || 'EXACT';
      const matchBadgeColor = matchType === 'EXACT' ? '#16a34a' : (matchType === 'CONTAINS' ? '#3b82f6' : '#a855f7');
      
      const triggersDisplay = (rule.triggers || []).join(', ') || '—';
      
      // Support both old and new field names for response and ruleId
      const responseDisplay = rule.response || rule.responseText || '—';
      const actualRuleId = rule.ruleId || rule.id || `rule-${Date.now()}`;
      
      return `
        <div style="display: grid; grid-template-columns: 50px 60px 80px 1fr 1fr 100px 80px; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; align-items: center; ${!isEnabled ? 'opacity: 0.5;' : ''}">
          <div>
            <label class="toggle-switch" style="margin: 0; transform: scale(0.8);">
              <input type="checkbox" class="toggle-rule-enabled" data-rule-id="${actualRuleId}" ${isEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div style="font-weight: 600; font-size: 0.875rem;">${rule.priority || 50}</div>
          <div>
            <span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; background: ${matchBadgeColor}; color: white;">
              ${matchType}
            </span>
          </div>
          <div style="font-size: 0.875rem; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(triggersDisplay)}">
            ${escapeHtml(triggersDisplay)}
          </div>
          <div style="font-size: 0.875rem; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(responseDisplay)}">
            ${highlightNamePlaceholder(responseDisplay)}
          </div>
          <div style="text-align: center;">
            ${hasAudio 
              ? '<span style="color: #16a34a; font-size: 0.75rem; font-weight: 600;">✓ Audio</span>' 
              : '<span style="color: #9ca3af; font-size: 0.75rem;">—</span>'
            }
          </div>
          <div style="display: flex; gap: 4px; justify-content: flex-end;">
            <button class="btn btn-ghost btn-icon btn-edit-rule" data-rule-id="${actualRuleId}" title="Edit">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M11.333 2A1.886 1.886 0 0 1 14 4.667l-9 9-3.667 1 1-3.667 9-9Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="btn btn-ghost btn-icon btn-delete-rule" data-rule-id="${actualRuleId}" title="Delete">
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
      const emergencyFallback = DOM.inputCallStartEmergencyFallback?.value?.trim() || '';
      
      console.log('[Greetings] SAVE_START — enabled:', enabled, '| text:', text.substring(0, 50), '| emergencyFallback:', emergencyFallback.substring(0, 50));
      
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/call-start`,
        {
          method: 'PUT',
          body: { enabled, text, emergencyFallback }
        }
      );
      
      console.log('[Greetings] SAVE_RESPONSE — success:', response.success, '| data.emergencyFallback:', response.data?.emergencyFallback);
      
      if (response.success) {
        state.greetings.callStart = response.data;
        state.greetingsDirty = false;
        
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
        DOM.callStartAudioStatus.innerHTML = '<span style="color: #16a34a;">✅ Audio generated and saved.</span>';
        
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
    
    state.currentAudioPlayer.play().catch(() => {
      state.currentAudioPlayer = null;
      DOM.btnPlayCallStartAudio.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play';
      showToast('error', 'Audio Not Found', 'Audio file is missing — please regenerate.');
    });
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * SETUP GREETINGS EVENT LISTENERS (Call Start only - Interceptor moved to Triggers Console)
   * ───────────────────────────────────────────────────────────────────────
   */
  function setupGreetingsEventListeners() {
    // Call Start Greeting
    if (DOM.toggleCallStartEnabled) {
      DOM.toggleCallStartEnabled.addEventListener('change', () => {
        state.greetingsDirty = true;
        saveCallStartGreeting();
      });
    }
    
    if (DOM.inputCallStartText) {
      DOM.inputCallStartText.addEventListener('input', () => {
        state.greetingsDirty = true;
        updateCallStartAudioStatus();
      });
      DOM.inputCallStartText.addEventListener('blur', saveCallStartGreeting);
    }
    
    if (DOM.inputCallStartEmergencyFallback) {
      DOM.inputCallStartEmergencyFallback.addEventListener('input', () => {
        state.greetingsDirty = true;
      });
      DOM.inputCallStartEmergencyFallback.addEventListener('blur', saveCallStartGreeting);
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
  }

  /* ══════════════════════════════════════════════════════════════════════════
     🏥 SYSTEM STATUS - Minimal health check (issues-only display)
     ══════════════════════════════════════════════════════════════════════════ */
  
  /**
   * Load and display system health. Only shows issues - green bar means all good.
   */
  async function loadHealthStatus() {
    const summary = document.getElementById('health-summary');
    const summaryIcon = document.getElementById('health-summary-icon');
    const summaryText = document.getElementById('health-summary-text');
    
    if (!summary || !summaryText) return;
    
    try {
      const profile = await AgentConsoleAuth.apiFetch(`/api/company/${state.companyId}`);
      
      // Collect critical issues only
      const issues = [];
      
      // Twilio: Can't receive calls without this
      const hasTwilio = profile.twilioConfig?.accountSid && profile.twilioConfig?.authToken;
      if (!hasTwilio) issues.push('Twilio not configured');
      if (profile.twilioConfig?.accountStatus === 'suspended') issues.push('Twilio suspended');
      
      // Voice: Can't speak without this
      if (!profile.aiAgentSettings?.voiceSettings?.voiceId) issues.push('No voice configured');
      
      // Triggers: Can't respond intelligently without these
      if ((state.triggerStats?.totalActiveCount || 0) === 0) issues.push('No trigger cards');
      
      // Render minimal status bar
      if (issues.length === 0) {
        summary.style.background = '#f0fdf4';
        summary.style.borderColor = '#bbf7d0';
        if (summaryIcon) summaryIcon.textContent = '✅';
        summaryText.innerHTML = '<span style="color: #166534;">All systems operational</span>';
      } else {
        summary.style.background = '#fef2f2';
        summary.style.borderColor = '#fecaca';
        if (summaryIcon) summaryIcon.textContent = '⚠️';
        summaryText.innerHTML = `<span style="color: #dc2626;">${issues.join(' • ')}</span>`;
      }
    } catch (error) {
      console.error('[Health] Failed to load:', error);
      summary.style.background = '#fef2f2';
      summary.style.borderColor = '#fecaca';
      if (summaryIcon) summaryIcon.textContent = '❌';
      summaryText.innerHTML = '<span style="color: #dc2626;">Could not check status</span>';
    }
  }
  
  
  async function refreshHealthStatus() {
    const btn = document.getElementById('btn-refresh-health');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '...';
    }
    await loadHealthStatus();
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Refresh';
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
