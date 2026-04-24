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
  // ─── Optimal performance defaults (used by "↺ Optimal Defaults" buttons) ───
  const OPTIMAL_DEFAULTS = {
    speech: {
      speechTimeout:        1.5,
      initialTimeout:       7,
      bargeIn:              false,
      enhancedRecognition:  true,
      speechModel:          'phone_call'
    },
    bridge: {
      postGatherDelayMs:    500,
      heartbeatSilenceMs:   5000,
      maxCeilingMs:         15000
    }
  };

  const CONFIG = {
    API_BASE: '/api/agent-console'
  };

  /* --------------------------------------------------------------------------
     STATE
     -------------------------------------------------------------------------- */
  // ─── Voice Keywords modal working state ────────────────────────────────────
  let kwState = [];       // working copy of keywords array while modal is open
  let kwFilter = 'all';   // active category tab filter

  const state = {
    companyId: null,
    companyName: null,
    config: null,
    triggerStats: null,
    embedMode: null,
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
    currentAudioPlayer: null,
    // Unsaved-change guards (config is saved via "Save Changes"; greetings auto-save on blur/change)
    greetingsDirty: false,
    greetingRuleDirty: false
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
    
    // Speech Detection
    inputSpeechTimeout: document.getElementById('input-speech-timeout'),
    inputSpeechInitialTimeout: document.getElementById('input-speech-initial-timeout'),
    inputSpeechBargeIn: document.getElementById('input-speech-barge-in'),
    inputSpeechEnhanced: document.getElementById('input-speech-enhanced'),
    inputSpeechModel: document.getElementById('input-speech-model'),
    speechImpactSilence: document.getElementById('preview-silence'),
    speechImpactTotal: document.getElementById('preview-total'),
    speechImpactTip: document.getElementById('preview-tip'),

    // Speech Pipeline (Media Streams — C4/5)
    inputMediaStreamsOff: document.getElementById('input-media-streams-off'),
    inputMediaStreamsOn:  document.getElementById('input-media-streams-on'),
    msPreviewModel:            document.getElementById('ms-preview-model'),
    msPreviewModelSource:      document.getElementById('ms-preview-model-source'),
    msPreviewLanguage:         document.getElementById('ms-preview-language'),
    msPreviewLanguageSource:   document.getElementById('ms-preview-language-source'),
    msPreviewEndpointing:      document.getElementById('ms-preview-endpointing'),
    msPreviewEndpointingSource:document.getElementById('ms-preview-endpointing-source'),
    msPreviewUtteranceEnd:     document.getElementById('ms-preview-utterance-end'),
    msPreviewUtteranceEndSource:document.getElementById('ms-preview-utterance-end-source'),

    // Bridge (Latency Filler)
    inputBridgeEnabled: document.getElementById('input-bridge-enabled'),
    inputBridgeThreshold: document.getElementById('input-bridge-threshold'),
    inputBridgeHeartbeatSilence: document.getElementById('input-bridge-heartbeat-silence'),
    inputBridgeHardcap: document.getElementById('input-bridge-hardcap'),
    inputBridgeLines: document.getElementById('input-bridge-lines'),
    inputBridgeBookingPhrase: document.getElementById('input-bridge-booking-phrase'),
    inputBridgeTransferPhrase: document.getElementById('input-bridge-transfer-phrase'),
    // Turn 1 Welcome Bridge
    inputBridgeWelcomeEnabled: document.getElementById('input-bridge-welcome-enabled'),
    inputBridgeWelcomeLine: document.getElementById('input-bridge-welcome-line'),
    
    // Greeting Interceptor
    toggleInterceptorEnabled: document.getElementById('toggle-interceptor-enabled'),
    inputMaxWords: document.getElementById('input-max-words'),
    toggleBlockIntentWords: document.getElementById('toggle-block-intent-words'),
    inputIntentWords: document.getElementById('input-intent-words'),
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
    initSpeechDetectionListeners();
    initMediaStreamsListeners();
    setupUnsavedChangesProtection();
    loadGreetings();
    if (state.embedMode !== 'greetings') {
      loadConfig();
      loadHealthStatus();
    }
  }

  function extractCompanyId() {
    const params = new URLSearchParams(window.location.search);
    state.companyId = params.get('companyId');
    state.embedMode = params.get('embed');

    if (state.embedMode === 'greetings') {
      document.body.classList.add('embed-greetings');
    } else {
      document.body.classList.add('hide-greeting-interceptor');
    }
    
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

    // Promotions Console link
    const linkPromotionsConsole = document.getElementById('link-promotions-console');
    if (linkPromotionsConsole) {
      linkPromotionsConsole.addEventListener('click', (e) => {
        e.preventDefault();
        navigateWithUnsavedGuard(() => {
          window.location.href = `/agent-console/promotions.html?companyId=${encodeURIComponent(state.companyId)}`;
        });
      });
    }


    // ⚖️ Intent Arbitration Console link
    const linkInterceptorsConsole = document.getElementById('link-interceptors-console');
    if (linkInterceptorsConsole) {
      linkInterceptorsConsole.addEventListener('click', (e) => {
        e.preventDefault();
        navigateWithUnsavedGuard(() => {
          window.location.href = `/agent-console/interceptor.html?companyId=${encodeURIComponent(state.companyId)}`;
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
    
    DOM.btnSaveConfig.addEventListener('click', saveConfig);

    // Track changes (with null checks for optional fields)
    const inputs = [
      DOM.inputGreetingInitial,
      DOM.inputGreetingReturn,
      DOM.inputBridgeThreshold,
      DOM.inputBridgeHardcap,
      DOM.inputBridgeLines
    ].filter(Boolean);

    inputs.forEach(input => {
      input.addEventListener('input', () => { state.isDirty = true; });
    });

    if (DOM.inputBridgeEnabled) {
      DOM.inputBridgeEnabled.addEventListener('change', () => { state.isDirty = true; });
    }

    // Optimal defaults reset buttons
    document.getElementById('btn-reset-speech')?.addEventListener('click', resetSpeechToDefaults);
    document.getElementById('btn-reset-bridge')?.addEventListener('click', resetBridgeToDefaults);
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
      showToast('error', 'Load Failed', 'Could not load Agent 2.0 configuration.');
      
      // Use defaults
      state.config = {};
      state.triggerStats = {};
      renderConfig();
    }
  }

  function renderConfig() {
    const config = state.config;

    // Wire up the LLM Settings redirect link with companyId
    const llmLink = document.getElementById('link-to-llm-callhandling');
    if (llmLink) llmLink.href = `llm.html?companyId=${encodeURIComponent(state.companyId)}`;

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
    
    // Bridge (Latency Filler)
    const bridge = config.bridge || {};
    if (DOM.inputBridgeEnabled) DOM.inputBridgeEnabled.checked = bridge.enabled === true;
    if (DOM.inputBridgeThreshold) DOM.inputBridgeThreshold.value = bridge.postGatherDelayMs || bridge.thresholdMs || 500;
    if (DOM.inputBridgeHeartbeatSilence) DOM.inputBridgeHeartbeatSilence.value = bridge.heartbeatSilenceMs || 5000;
    if (DOM.inputBridgeHardcap) DOM.inputBridgeHardcap.value = bridge.maxCeilingMs || 15000;
    if (DOM.inputBridgeLines) DOM.inputBridgeLines.value = (bridge.lines || []).join('\n');
    if (DOM.inputBridgeBookingPhrase) DOM.inputBridgeBookingPhrase.value = bridge.bookingBridgePhrase || '';
    if (DOM.inputBridgeTransferPhrase) DOM.inputBridgeTransferPhrase.value = bridge.transferBridgePhrase || '';
    // Turn 1 Welcome Bridge
    const welcome = bridge.turn1Welcome || {};
    if (DOM.inputBridgeWelcomeEnabled) DOM.inputBridgeWelcomeEnabled.checked = welcome.enabled === true;
    if (DOM.inputBridgeWelcomeLine) DOM.inputBridgeWelcomeLine.value = welcome.line || '';
    
    // Speech Detection
    const speechDet = config.speechDetection || {};
    if (DOM.inputSpeechTimeout) DOM.inputSpeechTimeout.value = speechDet.speechTimeout ?? 1.5;
    if (DOM.inputSpeechInitialTimeout) DOM.inputSpeechInitialTimeout.value = speechDet.initialTimeout ?? 7;
    if (DOM.inputSpeechBargeIn) DOM.inputSpeechBargeIn.checked = speechDet.bargeIn === true;
    if (DOM.inputSpeechEnhanced) DOM.inputSpeechEnhanced.checked = speechDet.enhancedRecognition !== false;
    if (DOM.inputSpeechModel) DOM.inputSpeechModel.value = speechDet.speechModel || 'phone_call';
    kwUpdateCountBadge(speechDet.keywords || []);
    updateEnhancedStateForProvider(); // dim checkbox if Deepgram is active
    updateSpeechImpactPreview();

    // Speech Pipeline (Media Streams — C4/5)
    const ms = config.mediaStreams || {};
    const msEnabled = ms.enabled === true;
    if (DOM.inputMediaStreamsOff) DOM.inputMediaStreamsOff.checked = !msEnabled;
    if (DOM.inputMediaStreamsOn)  DOM.inputMediaStreamsOn.checked  = msEnabled;
    updateMediaStreamsPreview(ms, config.__mediaStreamsResolved);

    state.isDirty = false;
  }

  /* --------------------------------------------------------------------------
     SPEECH DETECTION HELPERS
     -------------------------------------------------------------------------- */
  function updateSpeechImpactPreview() {
    const val = parseFloat(DOM.inputSpeechTimeout?.value);
    if (!DOM.speechImpactSilence || isNaN(val)) return;

    DOM.speechImpactSilence.textContent = val.toFixed(1) + 's';

    // Rough estimate: silence + STT (~0.3s) + server T1 (~0.1s) + network (~0.1s)
    const low  = (val + 0.4).toFixed(1);
    const high = (val + 1.2).toFixed(1);
    DOM.speechImpactTotal.textContent = low + '–' + high + 's';

    let tip = '';
    if (val <= 1.0) tip = '⚡ Very fast — may cut off callers who pause naturally.';
    else if (val <= 1.5) tip = '✅ Recommended — fast and natural.';
    else if (val <= 2.5) tip = '⚠️ Noticeable delay but tolerant of pauses.';
    else tip = '🐢 Slow — only use if callers frequently need long pauses.';
    DOM.speechImpactTip.textContent = tip;
  }

  /**
   * When Speech Model switches to Deepgram (auto / nova-2-phonecall),
   * visually disable the Enhanced Recognition checkbox — it has no effect
   * and is auto-forced to false at runtime. Makes it clear to the user.
   */
  function updateEnhancedStateForProvider() {
    const model = DOM.inputSpeechModel?.value || 'phone_call';
    const isDeepgram = (model === 'nova-2-phonecall' || model === 'auto');
    const enhancedCheckbox = DOM.inputSpeechEnhanced;
    const enhancedLabel = enhancedCheckbox?.closest('.form-group');

    if (!enhancedCheckbox) return;

    if (isDeepgram) {
      enhancedCheckbox.disabled = true;
      if (enhancedLabel) {
        enhancedLabel.style.opacity = '0.45';
        enhancedLabel.title = 'Auto-disabled — has no effect when Deepgram (auto / nova-2-phonecall) is active';
      }
    } else {
      enhancedCheckbox.disabled = false;
      if (enhancedLabel) {
        enhancedLabel.style.opacity = '';
        enhancedLabel.title = '';
      }
    }
  }

  function initSpeechDetectionListeners() {
    if (DOM.inputSpeechTimeout) {
      DOM.inputSpeechTimeout.addEventListener('input', updateSpeechImpactPreview);
    }
    if (DOM.inputSpeechModel) {
      DOM.inputSpeechModel.addEventListener('change', updateEnhancedStateForProvider);
    }
  }

  /* --------------------------------------------------------------------------
     SPEECH PIPELINE (Media Streams — C4/5)
     --------------------------------------------------------------------------
     The radio flips `mediaStreams.enabled`. The preview shows the resolved
     config (tenant override → platform default → hardcoded fallback).
     Resolver output is optional — if the GET payload doesn't include
     `__mediaStreamsResolved`, fall back to tenant values merged with
     HARDCODED_FALLBACKS shape so the preview never reads "—" after save.
     -------------------------------------------------------------------------- */
  const MS_HARDCODED_FALLBACKS = {
    model: 'nova-3',
    endpointingMs: 300,
    utteranceEndMs: 1000,
    language: 'en-US'
  };

  function _msSourceLabel(source) {
    // source: 'tenant' | 'platform' | 'fallback' | null/undefined
    if (source === 'tenant')   return '(tenant override)';
    if (source === 'platform') return '(platform default)';
    if (source === 'fallback') return '(hardcoded fallback)';
    return '';
  }

  function updateMediaStreamsPreview(tenantMs, resolved) {
    // Prefer resolver output (authoritative) when the API surfaces it.
    // Otherwise fall back to the same precedence client-side.
    const t = tenantMs || {};
    const r = resolved || null;

    const model = r?.model ?? t.model ?? MS_HARDCODED_FALLBACKS.model;
    const lang  = r?.language ?? t.languageOverride ?? MS_HARDCODED_FALLBACKS.language;
    const ep    = r?.endpointingMs ?? t.endpointingMs ?? MS_HARDCODED_FALLBACKS.endpointingMs;
    const ue    = r?.utteranceEndMs ?? t.utteranceEndMs ?? MS_HARDCODED_FALLBACKS.utteranceEndMs;

    const modelSrc = r?.sources?.model ?? (t.model ? 'tenant' : 'fallback');
    const langSrc  = r?.sources?.language ?? (t.languageOverride ? 'tenant' : 'fallback');
    const epSrc    = r?.sources?.endpointingMs ?? (t.endpointingMs != null ? 'tenant' : 'fallback');
    const ueSrc    = r?.sources?.utteranceEndMs ?? (t.utteranceEndMs != null ? 'tenant' : 'fallback');

    if (DOM.msPreviewModel)        DOM.msPreviewModel.textContent = model;
    if (DOM.msPreviewLanguage)     DOM.msPreviewLanguage.textContent = lang;
    if (DOM.msPreviewEndpointing)  DOM.msPreviewEndpointing.textContent = ep + 'ms';
    if (DOM.msPreviewUtteranceEnd) DOM.msPreviewUtteranceEnd.textContent = ue + 'ms';

    if (DOM.msPreviewModelSource)        DOM.msPreviewModelSource.textContent = _msSourceLabel(modelSrc);
    if (DOM.msPreviewLanguageSource)     DOM.msPreviewLanguageSource.textContent = _msSourceLabel(langSrc);
    if (DOM.msPreviewEndpointingSource)  DOM.msPreviewEndpointingSource.textContent = _msSourceLabel(epSrc);
    if (DOM.msPreviewUtteranceEndSource) DOM.msPreviewUtteranceEndSource.textContent = _msSourceLabel(ueSrc);
  }

  function initMediaStreamsListeners() {
    const markDirty = () => { state.isDirty = true; };
    if (DOM.inputMediaStreamsOff) DOM.inputMediaStreamsOff.addEventListener('change', markDirty);
    if (DOM.inputMediaStreamsOn)  DOM.inputMediaStreamsOn.addEventListener('change', markDirty);
  }

  function resetSpeechToDefaults() {
    const d = OPTIMAL_DEFAULTS.speech;
    if (DOM.inputSpeechTimeout)       DOM.inputSpeechTimeout.value         = d.speechTimeout;
    if (DOM.inputSpeechInitialTimeout) DOM.inputSpeechInitialTimeout.value  = d.initialTimeout;
    if (DOM.inputSpeechBargeIn)       DOM.inputSpeechBargeIn.checked        = d.bargeIn;
    if (DOM.inputSpeechEnhanced)      DOM.inputSpeechEnhanced.checked       = d.enhancedRecognition;
    if (DOM.inputSpeechModel)         DOM.inputSpeechModel.value            = d.speechModel;
    updateSpeechImpactPreview();
    state.isDirty = true;
    showToast('info', 'Defaults Applied', 'Speech Detection reset to optimal. Save to persist.');
  }

  function resetBridgeToDefaults() {
    const d = OPTIMAL_DEFAULTS.bridge;
    if (DOM.inputBridgeThreshold)         DOM.inputBridgeThreshold.value         = d.postGatherDelayMs;
    if (DOM.inputBridgeHeartbeatSilence)  DOM.inputBridgeHeartbeatSilence.value  = d.heartbeatSilenceMs;
    if (DOM.inputBridgeHardcap)           DOM.inputBridgeHardcap.value           = d.maxCeilingMs;
    state.isDirty = true;
    showToast('info', 'Defaults Applied', 'Bridge reset to optimal. Save to persist.');
  }

  /* --------------------------------------------------------------------------
     SAVE CONFIG
     -------------------------------------------------------------------------- */
  async function saveConfig() {
    const updates = {
      // IMPORTANT: Greetings are managed by dedicated /greetings endpoints.
      // Do not write partial greetings here, or we risk overwriting callStart/interceptor/audio fields.
      discovery: {
        ...state.config.discovery
      },
      bridge: {
        enabled: DOM.inputBridgeEnabled?.checked || false,
        postGatherDelayMs: parseInt(DOM.inputBridgeThreshold?.value, 10) || 500,
        heartbeatSilenceMs: parseInt(DOM.inputBridgeHeartbeatSilence?.value, 10) || 5000,
        maxCeilingMs: parseInt(DOM.inputBridgeHardcap?.value, 10) || 15000,
        lines: (DOM.inputBridgeLines?.value || '').split('\n').map(l => l.trim()).filter(Boolean),
        bookingBridgePhrase: DOM.inputBridgeBookingPhrase?.value?.trim() || '',
        transferBridgePhrase: DOM.inputBridgeTransferPhrase?.value?.trim() || '',
        turn1Welcome: {
          enabled: DOM.inputBridgeWelcomeEnabled?.checked || false,
          line: DOM.inputBridgeWelcomeLine?.value?.trim() || ''
        }
      },
      speechDetection: {
        speechTimeout: parseFloat(DOM.inputSpeechTimeout?.value) || 1.5,
        initialTimeout: parseInt(DOM.inputSpeechInitialTimeout?.value, 10) || 7,
        bargeIn: DOM.inputSpeechBargeIn?.checked || false,
        enhancedRecognition: DOM.inputSpeechEnhanced?.checked !== false,
        speechModel: DOM.inputSpeechModel?.value || 'phone_call'
      },
      // Speech Pipeline (Media Streams — C4/5)
      // Only the enabled flag is saved from the UI; model/endpointing/utteranceEnd/language
      // come from platform AdminSettings.globalHub.mediaStreams.* (tenant overrides set
      // via admin-only route, not surfaced in this UI).
      mediaStreams: {
        ...(state.config.mediaStreams || {}),
        enabled: !!DOM.inputMediaStreamsOn?.checked
      }
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
      showToast('error', 'Save Failed', 'Could not save configuration.');
    }
  }

  /* --------------------------------------------------------------------------
     UTILITIES
     -------------------------------------------------------------------------- */
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
      const response = await AgentConsoleAuth.apiFetch(`/api/admin/agent2/${state.companyId}/greetings`);

      if (response.success && response.data) {
        state.greetings = response.data;
        
        // Auto-migrate if old schema detected
        await checkAndMigrateSchema();
        
        renderGreetings();
      }
    } catch (error) {
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
      try {
        const response = await AgentConsoleAuth.apiFetch(
          `/api/admin/agent2/${state.companyId}/greetings/migrate-schema`,
          { method: 'POST' }
        );
        
        if (response.success) {
          showToast('success', 'Migrated', `Greeting rules updated to new schema (${response.data.rulesMigrated} rules)`);
          
          // Reload greetings to get migrated data
          const reloadResponse = await AgentConsoleAuth.apiFetch(`/api/admin/agent2/${state.companyId}/greetings`);
          if (reloadResponse.success && reloadResponse.data) {
            state.greetings = reloadResponse.data;
          }
        }
      } catch (error) {
        // silent — migration failure is non-blocking
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
  /**
   * Highlight {name} placeholder in response text
   */
  function highlightNamePlaceholder(text) {
    if (!text) return '—';
    const escaped = escapeHtml(text);
    // Highlight {name} with blue background
    return escaped.replace(/\{name\}/gi, '<span style="background: #dbeafe; color: #1e40af; padding: 2px 4px; border-radius: 3px; font-weight: 600;">{name}</span>');
  }
  
  function renderGreetingRules() {
    if (!DOM.greetingRulesList) return;
    
    const rules = state.greetings.interceptor?.rules || [];
    
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
      
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/call-start`,
        {
          method: 'PUT',
          body: { enabled, text, emergencyFallback }
        }
      );
      
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
        state.greetingsDirty = false;
        showToast('success', 'Saved', 'Greeting interceptor settings updated successfully.');
      }
    } catch (error) {
      showToast('error', 'Save Failed', error.message || 'Could not save interceptor settings.');
    }
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * OPEN ADD GREETING RULE MODAL
   * ───────────────────────────────────────────────────────────────────────
   */
  function openAddGreetingRuleModal() {
    state.currentGreetingRule = null;
    state.greetingRuleDirty = false;
    
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
    const rule = state.greetings.interceptor.rules.find(r => (r.ruleId || r.id) === ruleId);

    if (!rule) {
      showToast('error', 'Rule Not Found', 'Could not find rule to edit.');
      return;
    }
    
    state.currentGreetingRule = rule;
    state.greetingRuleDirty = false;
    
    DOM.greetingRuleModalTitle.textContent = 'Edit Greeting Rule';
    DOM.inputRuleIdEdit.value = rule.ruleId || rule.id || '';
    DOM.inputRulePriority.value = rule.priority || 50;
    // Support both old and new field names for matchType
    DOM.inputRuleMatchType.value = rule.matchType || rule.matchMode || 'EXACT';
    DOM.inputRuleTriggers.value = (rule.triggers || []).join(', ');
    // Support both new and old field names for response
    DOM.inputRuleResponse.value = rule.response || rule.responseText || '';
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
        // Update existing rule - support both ruleId and id (legacy)
        const ruleId = state.currentGreetingRule.ruleId || state.currentGreetingRule.id;

        const updateResponse = await AgentConsoleAuth.apiFetch(
          `/api/admin/agent2/${state.companyId}/greetings/rules/${ruleId}`,
          {
            method: 'PATCH',
            body: { priority, matchType, triggers, response }
          }
        );
        
        if (updateResponse.success) {
          // Update local state - support both ruleId and id
          const ruleIndex = state.greetings.interceptor.rules.findIndex(r => (r.ruleId || r.id) === ruleId);
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
          state.greetingsDirty = false;
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
          state.greetingsDirty = false;
        }
      }
    } catch (error) {
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

    if (!ruleId || ruleId === 'undefined') {
      e.target.checked = !enabled;
      showToast('error', 'Invalid Rule', 'Rule ID is missing. Please reload the page.');
      return;
    }
    
    try {
      const response = await AgentConsoleAuth.apiFetch(
        `/api/admin/agent2/${state.companyId}/greetings/rules/${ruleId}`,
        {
          method: 'PATCH',
          body: { enabled }
        }
      );
      
      if (response.success) {
        const ruleIndex = state.greetings.interceptor.rules.findIndex(r => (r.ruleId || r.id) === ruleId);
        if (ruleIndex !== -1) {
          state.greetings.interceptor.rules[ruleIndex] = response.data;
        }
        renderGreetingRules();
        showToast('success', enabled ? 'Enabled' : 'Disabled', 'Greeting rule updated.');
      }
    } catch (error) {
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
    
    state.currentAudioPlayer.play().catch(() => {
      state.currentAudioPlayer = null;
      DOM.btnPlayRuleAudio.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M4 3L12 8L4 13V3Z" fill="currentColor"/></svg>Play';
      showToast('error', 'Audio Not Found', 'Audio file is missing — please regenerate.');
    });
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * CLOSE GREETING RULE MODAL
   * ───────────────────────────────────────────────────────────────────────
   */
  function closeGreetingRuleModal() {
    DOM.modalGreetingRule.classList.remove('active');
    state.currentGreetingRule = null;
    state.greetingRuleDirty = false;
  }
  
  /**
   * ───────────────────────────────────────────────────────────────────────
   * SETUP GREETINGS EVENT LISTENERS
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
    
    // Greeting Interceptor
    if (DOM.toggleInterceptorEnabled) {
      DOM.toggleInterceptorEnabled.addEventListener('change', () => {
        state.greetingsDirty = true;
        saveGreetingInterceptor();
      });
    }
    
    if (DOM.inputMaxWords) {
      DOM.inputMaxWords.addEventListener('input', () => { state.greetingsDirty = true; });
      DOM.inputMaxWords.addEventListener('blur', saveGreetingInterceptor);
    }
    
    if (DOM.toggleBlockIntentWords) {
      DOM.toggleBlockIntentWords.addEventListener('change', () => {
        state.greetingsDirty = true;
        saveGreetingInterceptor();
      });
    }
    
    if (DOM.inputIntentWords) {
      DOM.inputIntentWords.addEventListener('input', () => { state.greetingsDirty = true; });
      DOM.inputIntentWords.addEventListener('blur', saveGreetingInterceptor);
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

    // Track unsaved edits inside greeting rule modal (warn if leaving mid-edit)
    const modalInputs = [
      DOM.inputRulePriority,
      DOM.inputRuleMatchType,
      DOM.inputRuleTriggers,
      DOM.inputRuleResponse
    ].filter(Boolean);
    modalInputs.forEach(el => {
      el.addEventListener('input', () => { state.greetingRuleDirty = true; });
      el.addEventListener('change', () => { state.greetingRuleDirty = true; });
    });
    
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
     VOICE KEYWORDS MODAL
     Manages per-company STT hint keywords. Deepgram: phrase:boost format.
     Google: flat CSV. Deep-merge PATCH keeps timing settings safe.
     -------------------------------------------------------------------------- */

  /** Open the keywords modal — copies saved keywords into working state */
  function openKeywordsModal() {
    const saved = state.config?.speechDetection?.keywords || [];
    kwState = saved.map(k => ({ ...k })); // shallow clone each item
    kwFilter = 'all';
    kwRenderTable();
    kwUpdatePreview();
    kwSetFilterActive('all');
    document.getElementById('modal-voice-keywords').classList.add('active');
  }

  /** Close the keywords modal — discard working state */
  function closeKeywordsModal() {
    document.getElementById('modal-voice-keywords').classList.remove('active');
    kwState = [];
  }

  /** Parse bulk textarea input, add new keywords to working state */
  function kwParseBulk() {
    const raw = document.getElementById('kw-bulk-input')?.value || '';
    const category = document.getElementById('kw-bulk-category')?.value || 'custom';
    const boost = parseInt(document.getElementById('kw-bulk-boost')?.value, 10) || 3;

    const phrases = raw.split(',').map(p => p.trim()).filter(Boolean);
    const existing = new Set(kwState.map(k => k.phrase.toLowerCase()));
    let added = 0;

    for (const phrase of phrases) {
      if (!phrase || existing.has(phrase.toLowerCase())) continue;
      kwState.push({ phrase, boost, category, enabled: true });
      existing.add(phrase.toLowerCase());
      added++;
    }

    if (document.getElementById('kw-bulk-input')) document.getElementById('kw-bulk-input').value = '';
    kwRenderTable();
    kwUpdatePreview();
    if (added > 0) showToast('success', 'Keywords Added', `${added} keyword${added !== 1 ? 's' : ''} added.`);
    else showToast('info', 'No New Keywords', 'All phrases already exist or input was empty.');
  }

  /** Set active category tab filter and re-render table */
  function kwSetFilter(filter, btnEl) {
    kwFilter = filter;
    kwSetFilterActive(filter);
    kwRenderTable();
  }

  function kwSetFilterActive(filter) {
    document.querySelectorAll('.kw-tab-btn').forEach(btn => {
      const isActive = btn.dataset.filter === filter;
      btn.style.background = isActive ? 'var(--primary, #4f46e5)' : 'transparent';
      btn.style.color = isActive ? '#fff' : 'var(--text-secondary)';
      btn.style.borderColor = isActive ? 'var(--primary, #4f46e5)' : 'var(--border-color, #e5e7eb)';
    });
  }

  /** Render keywords table body, applying current filter */
  function kwRenderTable() {
    const tbody = document.getElementById('kw-table-body');
    if (!tbody) return;

    const filtered = kwState
      .map((kw, idx) => ({ ...kw, _idx: idx }))
      .filter(kw => kwFilter === 'all' || kw.category === kwFilter);

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr id="kw-empty-row"><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);font-style:italic;">${kwState.length === 0 ? 'No keywords yet — use Bulk Import above to add your first batch.' : `No keywords in category "<strong>${kwFilter}</strong>".`}</td></tr>`;
      return;
    }

    const categoryColors = { brand: '#7c3aed', symptom: '#dc2626', technical: '#2563eb', booking: '#059669', custom: '#6b7280' };
    tbody.innerHTML = filtered.map(kw => {
      const color = categoryColors[kw.category] || '#6b7280';
      return `<tr style="border-bottom: 1px solid var(--border-color, #e5e7eb);">
        <td style="padding: 8px 12px; font-size: 0.83rem;">${escapeHtml(kw.phrase)}</td>
        <td style="padding: 8px 12px;">
          <span style="font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: ${color}22; color: ${color};">${kw.category}</span>
        </td>
        <td style="padding: 8px 12px; text-align: center;">
          <input type="number" min="1" max="10" value="${kw.boost || 3}"
            onchange="kwUpdateBoost(${kw._idx}, this.value)"
            style="width: 52px; text-align: center; font-size: 0.82rem; padding: 3px 6px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 4px;">
        </td>
        <td style="padding: 8px 12px; text-align: center;">
          <input type="checkbox" ${kw.enabled !== false ? 'checked' : ''} onchange="kwToggleEnabled(${kw._idx}, this.checked)">
        </td>
        <td style="padding: 8px 12px; text-align: center;">
          <button type="button" onclick="kwDeleteRow(${kw._idx})" style="background:transparent;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;line-height:1;">×</button>
        </td>
      </tr>`;
    }).join('');
  }

  /** Update boost value for a keyword at index */
  function kwUpdateBoost(idx, val) {
    if (kwState[idx]) {
      kwState[idx].boost = Math.max(1, Math.min(10, parseInt(val, 10) || 3));
      kwUpdatePreview();
    }
  }

  /** Toggle enabled state for a keyword */
  function kwToggleEnabled(idx, checked) {
    if (kwState[idx]) {
      kwState[idx].enabled = checked;
      kwUpdatePreview();
    }
  }

  /** Delete a keyword by index */
  function kwDeleteRow(idx) {
    kwState.splice(idx, 1);
    kwRenderTable();
    kwUpdatePreview();
  }

  /** Compute client-side hints preview string (mirrors STTHintsBuilder logic) */
  function kwUpdatePreview() {
    const totalCount = kwState.length;
    const enabledKws = kwState.filter(k => k.enabled !== false).sort((a, b) => (b.boost || 3) - (a.boost || 3));

    // Detect provider
    const speechModel = DOM.inputSpeechModel?.value || state.config?.speechDetection?.speechModel || 'phone_call';
    const isDeepgram = (speechModel === 'nova-2-phonecall' || speechModel === 'auto');

    // Build preview string (custom keywords only — defaults/names handled server-side)
    let preview = '';
    if (isDeepgram) {
      for (const kw of enabledKws) {
        const token = `${kw.phrase}:${kw.boost || 3}`;
        const next = preview ? preview + ', ' + token : token;
        if (next.length > 800) { preview = next.substring(0, 797) + '...'; break; } // leave budget for defaults
        preview = next;
      }
    } else {
      for (const kw of enabledKws) {
        const next = preview ? preview + ', ' + kw.phrase : kw.phrase;
        if (next.length > 800) { preview = next.substring(0, 797) + '...'; break; }
        preview = next;
      }
    }
    if (preview) preview += ', … (+ defaults & names)';

    // Update UI
    const pct = Math.min(100, Math.round((preview.length / 1000) * 100));
    if (document.getElementById('kw-modal-count')) document.getElementById('kw-modal-count').textContent = totalCount;
    if (document.getElementById('kw-budget-pct')) document.getElementById('kw-budget-pct').textContent = pct;
    if (document.getElementById('kw-provider-note')) {
      document.getElementById('kw-provider-note').textContent = isDeepgram
        ? `${speechModel} (Deepgram — weighted phrase:boost)`
        : `${speechModel} (Google — flat CSV, weights ignored)`;
    }
    if (document.getElementById('kw-hints-preview')) {
      document.getElementById('kw-hints-preview').textContent = preview || '(no custom keywords — defaults only)';
    }
  }

  /** Update the count badge in the Speech Detection card */
  function kwUpdateCountBadge(keywords) {
    const badge = document.getElementById('kw-count-badge');
    if (!badge) return;
    const enabled = (keywords || []).filter(k => k.enabled !== false).length;
    if (enabled > 0) {
      badge.textContent = `${enabled} keyword${enabled !== 1 ? 's' : ''}`;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  }

  /** Save keywords — PATCH only the keywords array (deep-merge preserves timing settings) */
  async function kwSave() {
    const btn = document.getElementById('btn-save-keywords');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      const data = await AgentConsoleAuth.apiFetch(`${CONFIG.API_BASE}/${state.companyId}/agent2/config`, {
        method: 'PATCH',
        body: { speechDetection: { keywords: kwState } }
      });

      // Update local state
      if (!state.config.speechDetection) state.config.speechDetection = {};
      state.config.speechDetection.keywords = kwState.map(k => ({ ...k }));
      kwUpdateCountBadge(state.config.speechDetection.keywords);

      closeKeywordsModal();
      showToast('success', 'Saved', `${kwState.length} keyword${kwState.length !== 1 ? 's' : ''} saved successfully.`);

    } catch (err) {
      showToast('error', 'Save Failed', 'Could not save keywords.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Keywords'; }
    }
  }

  /* --------------------------------------------------------------------------
     AI KEYWORD SUGGESTIONS
     Calls POST /agent2/suggest-keywords → Claude Haiku generates brand names,
     symptoms, and technical terms based on company trade + services.
     Results are merged into kwState for review — nothing is saved until
     the user explicitly clicks "Save Keywords".
     -------------------------------------------------------------------------- */

  async function kwEnhanceWithAI() {
    const brandsEl  = document.getElementById('kw-ai-brands');
    const contextEl = document.getElementById('kw-ai-context');
    const btn       = document.getElementById('btn-kw-ai-enhance');
    const statusEl  = document.getElementById('kw-ai-status');

    const brands  = brandsEl?.value?.trim()  || '';
    const context = contextEl?.value?.trim() || '';

    // Loading state
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Thinking…'; }
    if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }

    try {
      const res = await AgentConsoleAuth.apiFetch(
        `${CONFIG.API_BASE}/${state.companyId}/agent2/suggest-keywords`,
        { method: 'POST', body: { brands, context } }
      );

      const suggestions = res.suggestions || [];

      if (suggestions.length === 0) {
        if (statusEl) {
          statusEl.textContent = 'No suggestions returned — try adding equipment brand names above.';
          statusEl.style.color = 'var(--warning, #f59e0b)';
          statusEl.style.display = '';
        }
        return;
      }

      // Merge into working state — skip exact duplicates (case-insensitive)
      const existing = new Set(kwState.map(k => k.phrase.toLowerCase()));
      let added = 0;
      for (const s of suggestions) {
        if (!existing.has(s.phrase.toLowerCase())) {
          kwState.push(s);
          existing.add(s.phrase.toLowerCase());
          added++;
        }
      }

      kwFilter = 'all';
      kwSetFilterActive('all');
      kwRenderTable();
      kwUpdatePreview();

      if (statusEl) {
        statusEl.textContent = added > 0
          ? `✅ ${added} keyword${added !== 1 ? 's' : ''} added — review the table and click Save when ready.`
          : '✅ All suggestions already exist in your list.';
        statusEl.style.color = 'var(--success, #10b981)';
        statusEl.style.display = '';
      }

      if (added > 0) {
        showToast('success', 'AI Suggestions Ready', `${added} keyword${added !== 1 ? 's' : ''} added for review — save when you're happy.`);
      }

    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `❌ ${err.message || 'Request failed — check connection and try again.'}`;
        statusEl.style.color = 'var(--error, #ef4444)';
        statusEl.style.display = '';
      }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '✨ Suggest with AI'; }
    }
  }

  /* --------------------------------------------------------------------------
     GLOBAL EXPORTS — expose keywords modal functions to inline onclick handlers
     (functions are defined inside the IIFE so must be pinned to window)
     -------------------------------------------------------------------------- */
  window.openKeywordsModal  = openKeywordsModal;
  window.closeKeywordsModal = closeKeywordsModal;
  window.kwParseBulk        = kwParseBulk;
  window.kwSetFilter        = kwSetFilter;
  window.kwUpdateBoost      = kwUpdateBoost;
  window.kwToggleEnabled    = kwToggleEnabled;
  window.kwDeleteRow        = kwDeleteRow;
  window.kwSave             = kwSave;
  window.kwEnhanceWithAI    = kwEnhanceWithAI;

  /* --------------------------------------------------------------------------
     BOOTSTRAP
     -------------------------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
