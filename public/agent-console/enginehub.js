/**
 * ============================================================================
 * ENGINE HUB — PAGE CONTROLLER
 * ============================================================================
 *
 * PURPOSE:
 *   Full settings management for the Engine Hub (conversational intelligence
 *   engine). Manages Engine Hub config settings and Behavior Cards (BC)
 *   per company. Every setting is stored per-companyId — nothing hardcoded.
 *
 * ARCHITECTURE:
 *   CONFIG          — API base paths and constants
 *   STATE           — Single source of page state
 *   DOM             — All element references in one place
 *   API             — All fetch calls (settings + behavior cards CRUD)
 *   RENDERER        — Populates form fields from API data
 *   COLLECTOR       — Reads form fields back into a payload for PATCH
 *   NAV             — Section navigation (sidenav click → show/hide)
 *   BC_MANAGER      — Behavior Card list rendering + modal management
 *   TOAST           — Toast notification system
 *   INIT            — Wires everything together on DOMContentLoaded
 *
 * ROUTES CONSUMED:
 *   GET    /api/admin/engine-hub/company/:companyId/engine-hub/settings
 *   PATCH  /api/admin/engine-hub/company/:companyId/engine-hub/settings
 *   GET    /api/admin/engine-hub/company/:companyId/engine-hub/health
 *   GET    /api/admin/behavior-cards/company/:companyId/behavior-cards
 *   POST   /api/admin/behavior-cards/company/:companyId/behavior-cards
 *   PATCH  /api/admin/behavior-cards/company/:companyId/behavior-cards/:bcId
 *   DELETE /api/admin/behavior-cards/company/:companyId/behavior-cards/:bcId
 *
 * MULTI-TENANT:
 *   companyId is always read from URL ?companyId= param.
 *   Never hardcoded. Every API call scopes to this companyId.
 *
 * ============================================================================
 */

(function () {
  'use strict';

  // ==========================================================================
  // CONFIG
  // ==========================================================================

  const CONFIG = {
    EH_API:  '/api/admin/engine-hub',
    BC_API:  '/api/admin/behavior-cards',
    VERSION: 'ENGINEHUB_V1.0',

    // Standalone types must match BehaviorCard model STANDALONE_TYPES
    STANDALONE_TYPES: [
      'inbound_greeting',
      'discovery_flow',
      'escalation_ladder',
      'after_hours_intake',
      'mid_flow_interrupt',
      'payment_routing',
      'manager_request'
    ],

    STANDALONE_LABELS: {
      inbound_greeting:    'Inbound Greeting',
      discovery_flow:      'Discovery Flow',
      escalation_ladder:   'Escalation Ladder',
      after_hours_intake:  'After-Hours Intake',
      mid_flow_interrupt:  'Mid-Flow Interrupt',
      payment_routing:     'Payment Routing',
      manager_request:     'Manager Request'
    },

    AFTER_ACTION_LABELS: {
      none:                  'None — informational response only',
      collect_info_then_book:'collect_info_then_book — continue to booking',
      route_to_payment:      'route_to_payment — payment flow',
      escalate_to_human:     'escalate_to_human — escalation ladder',
      take_message:          'take_message — after-hours capture',
      schedule_callback:     'schedule_callback — callback queue',
      transfer:              'transfer — live agent connect'
    },

    STATUS_COLORS: {
      NOT_CONFIGURED: 'status-unconfigured',
      DISABLED:       'status-disabled',
      ACTIVE:         'status-active',
      LEARNING:       'status-learning',
      PASSIVE:        'status-passive'
    },

    STATUS_LABELS: {
      NOT_CONFIGURED: 'Not Configured',
      DISABLED:       'Disabled',
      ACTIVE:         'Active',
      LEARNING:       'Learning',
      PASSIVE:        'Passive'
    }
  };

  // ==========================================================================
  // STATE
  // ==========================================================================

  const state = {
    companyId:    null,
    companyName:  null,
    settings:     null,
    isConfigured: false,
    cards:        [],         // all BC for this company
    editingBcId:  null,       // bcId currently open in modal (null = creating)
    editingBcType: null,      // 'category_linked' or 'standalone' (from active tab)
    isSaving:     false,
    isLoading:    false
  };

  // ==========================================================================
  // DOM REFERENCES
  // ==========================================================================

  const DOM = {};

  function bindDOM() {
    // Header
    DOM.statusBadge       = document.getElementById('status-badge');
    DOM.statusDot         = document.getElementById('status-dot');
    DOM.statusLabel       = document.getElementById('status-label');
    DOM.headerCompanyName = document.getElementById('header-company-name');
    DOM.headerCompanyId   = document.getElementById('header-company-id');
    DOM.btnBack           = document.getElementById('btn-back');
    DOM.btnSaveAll        = document.getElementById('btn-save-all');

    // Banner
    DOM.bannerNotConfigured = document.getElementById('banner-not-configured');

    // Sidenav items
    DOM.navItems = document.querySelectorAll('.eh-nav-item[data-section]');

    // Sections
    DOM.sections = document.querySelectorAll('.eh-section');

    // ── Engine Control ──────────────────────────────────────────────────────
    DOM.fieldEnabled   = document.getElementById('field-enabled');
    DOM.modeRadios     = document.querySelectorAll('input[name="mode"]');

    // ── Intent Detection ────────────────────────────────────────────────────
    DOM.fieldMultiIntent   = document.getElementById('field-multi-intent');
    DOM.fieldConfidence    = document.getElementById('field-confidence');
    DOM.confidenceDisplay  = document.getElementById('confidence-display');
    DOM.fieldMaxIntents    = document.getElementById('field-max-intents');

    // ── Policy Router ───────────────────────────────────────────────────────
    DOM.policyCheckboxes = document.querySelectorAll('input[data-policy]');

    // ── Mid-Flow Interrupts ─────────────────────────────────────────────────
    DOM.mfBookingSlotSelection  = document.getElementById('mf-bookingSlotSelection');
    DOM.mfBookingAddressCapture = document.getElementById('mf-bookingAddressCapture');
    DOM.mfBookingConfirmation   = document.getElementById('mf-bookingConfirmation');
    DOM.mfAfterHoursIntake      = document.getElementById('mf-afterHoursIntake');
    DOM.mfTransferInProgress    = document.getElementById('mf-transferInProgress');

    // ── Knowledge Engine ────────────────────────────────────────────────────
    DOM.fieldStrictGrounded = document.getElementById('field-strict-grounded');
    DOM.kcMatchRadios       = document.querySelectorAll('input[name="on-no-kc-match"]');
    DOM.fieldLogKcMisses    = document.getElementById('field-log-kc-misses');

    // ── Agenda State ────────────────────────────────────────────────────────
    DOM.fieldMaxDeferred     = document.getElementById('field-max-deferred');
    DOM.fieldAutoSurface     = document.getElementById('field-auto-surface');
    DOM.fieldDeferredTimeout = document.getElementById('field-deferred-timeout');

    // ── Escalation Ladder ───────────────────────────────────────────────────
    DOM.rungDeescalate       = document.getElementById('rung-deescalate');
    DOM.rungConfirmTransfer  = document.getElementById('rung-confirm-transfer');
    DOM.altVoicemail         = document.getElementById('alt-voicemail');
    DOM.altCallback          = document.getElementById('alt-callback');
    DOM.altAppointment       = document.getElementById('alt-appointment');
    DOM.altEmergency         = document.getElementById('alt-emergency');
    DOM.emergencyNumber      = document.getElementById('emergency-number');

    // ── Trace ───────────────────────────────────────────────────────────────
    DOM.fieldTraceEnabled  = document.getElementById('field-trace-enabled');
    DOM.fieldTraceShowCI   = document.getElementById('field-trace-show-ci');
    DOM.fieldAlertThreshold = document.getElementById('field-alert-threshold');

    // ── Behavior Cards ──────────────────────────────────────────────────────
    DOM.bcTabs           = document.querySelectorAll('.eh-bc-tab');
    DOM.bcPanels         = document.querySelectorAll('.eh-bc-panel');
    DOM.bcListCategory   = document.getElementById('bc-list-category');
    DOM.bcListStandalone = document.getElementById('bc-list-standalone');
    DOM.bcEmptyCategory  = document.getElementById('bc-empty-category');
    DOM.bcEmptyStandalone = document.getElementById('bc-empty-standalone');
    DOM.btnNewCategoryBc  = document.getElementById('btn-new-category-bc');
    DOM.btnNewStandaloneBc = document.getElementById('btn-new-standalone-bc');

    // ── BC Modal ────────────────────────────────────────────────────────────
    DOM.bcModal            = document.getElementById('bc-modal');
    DOM.bcModalTitle       = document.getElementById('bc-modal-title');
    DOM.bcModalId          = document.getElementById('bc-modal-id');
    DOM.bcModalType        = document.getElementById('bc-modal-type');
    DOM.bcName             = document.getElementById('bc-name');
    DOM.bcCategory         = document.getElementById('bc-category');
    DOM.bcCategoryGroup    = document.getElementById('bc-category-group');
    DOM.bcStandaloneType   = document.getElementById('bc-standalone-type');
    DOM.bcStandaloneGroup  = document.getElementById('bc-standalone-type-group');
    DOM.bcTone             = document.getElementById('bc-tone');
    DOM.bcDoList           = document.getElementById('bc-do-list');
    DOM.bcDoNotList        = document.getElementById('bc-donot-list');
    DOM.bcExamplesList     = document.getElementById('bc-examples-list');
    DOM.bcAfterAction      = document.getElementById('bc-after-action');
    DOM.bcModalClose       = document.getElementById('bc-modal-close');
    DOM.bcModalCancel      = document.getElementById('bc-modal-cancel');
    DOM.bcModalSave        = document.getElementById('bc-modal-save');
    DOM.bcModalDelete      = document.getElementById('bc-modal-delete');
    DOM.btnAddDo           = document.querySelector('.eh-btn-add[data-list="do"]');
    DOM.btnAddDoNot        = document.querySelector('.eh-btn-add[data-list="doNot"]');
    DOM.btnAddExample      = document.querySelector('.eh-btn-add[data-list="exampleResponses"]');

    // Toast
    DOM.toast = document.getElementById('eh-toast');
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  function getCompanyId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('companyId') || '';
  }

  function getAuthHeaders() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    return token
      ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      : { 'Content-Type': 'application/json' };
  }

  // ==========================================================================
  // TOAST
  // ==========================================================================

  let _toastTimeout = null;

  function showToast(type, message) {
    if (!DOM.toast) return;
    DOM.toast.textContent = message;
    DOM.toast.className   = `eh-toast eh-toast--${type}`;
    DOM.toast.style.display = 'block';
    clearTimeout(_toastTimeout);
    _toastTimeout = setTimeout(() => {
      DOM.toast.style.display = 'none';
    }, 4000);
  }

  // ==========================================================================
  // API — ENGINE HUB SETTINGS
  // ==========================================================================

  async function apiGetSettings() {
    const url = `${CONFIG.EH_API}/company/${state.companyId}/engine-hub/settings`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`GET settings failed: ${res.status}`);
    return res.json();
  }

  async function apiPatchSettings(payload) {
    const url = `${CONFIG.EH_API}/company/${state.companyId}/engine-hub/settings`;
    const res = await fetch(url, {
      method:  'PATCH',
      headers: getAuthHeaders(),
      body:    JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `PATCH settings failed: ${res.status}`);
    }
    return res.json();
  }

  async function apiGetHealth() {
    const url = `${CONFIG.EH_API}/company/${state.companyId}/engine-hub/health`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`GET health failed: ${res.status}`);
    return res.json();
  }

  // ==========================================================================
  // API — BEHAVIOR CARDS
  // ==========================================================================

  async function apiGetBehaviorCards() {
    const url = `${CONFIG.BC_API}/company/${state.companyId}/behavior-cards`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`GET behavior cards failed: ${res.status}`);
    return res.json();
  }

  async function apiCreateBehaviorCard(payload) {
    const url = `${CONFIG.BC_API}/company/${state.companyId}/behavior-cards`;
    const res = await fetch(url, {
      method:  'POST',
      headers: getAuthHeaders(),
      body:    JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `POST failed: ${res.status}`);
    return data;
  }

  async function apiUpdateBehaviorCard(bcId, payload) {
    const url = `${CONFIG.BC_API}/company/${state.companyId}/behavior-cards/${bcId}`;
    const res = await fetch(url, {
      method:  'PATCH',
      headers: getAuthHeaders(),
      body:    JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `PATCH failed: ${res.status}`);
    return data;
  }

  async function apiDeleteBehaviorCard(bcId) {
    const url = `${CONFIG.BC_API}/company/${state.companyId}/behavior-cards/${bcId}`;
    const res = await fetch(url, {
      method:  'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `DELETE failed: ${res.status}`);
    return data;
  }

  // ==========================================================================
  // RENDERER — populate form fields from settings object
  // ==========================================================================

  function renderSettings(settings) {
    if (!settings) return;

    // ── Engine Control ──────────────────────────────────────────────────────
    DOM.fieldEnabled.checked = !!settings.enabled;

    DOM.modeRadios.forEach(r => {
      r.checked = (r.value === (settings.mode || 'passive'));
    });

    // ── Intent Detection ────────────────────────────────────────────────────
    const id = settings.intentDetection || {};
    DOM.fieldMultiIntent.checked = id.multiIntentEnabled !== false;

    const conf = id.confidenceThreshold ?? 0.75;
    DOM.fieldConfidence.value     = Math.round(conf * 100);
    DOM.confidenceDisplay.textContent = conf.toFixed(2);

    DOM.fieldMaxIntents.value = String(id.maxIntentsPerTurn ?? 2);

    // ── Policy Router ───────────────────────────────────────────────────────
    const enabledPolicies = (settings.policyRouter || {}).enabledPolicies || [];
    DOM.policyCheckboxes.forEach(cb => {
      cb.checked = enabledPolicies.includes(cb.dataset.policy);
    });

    // ── Mid-Flow Interrupts ─────────────────────────────────────────────────
    const mf = settings.midFlowInterrupt || {};
    _setSelectValue(DOM.mfBookingSlotSelection,  mf.bookingSlotSelection  || 'pause_resume');
    _setSelectValue(DOM.mfBookingAddressCapture, mf.bookingAddressCapture || 'pause_resume');
    _setSelectValue(DOM.mfBookingConfirmation,   mf.bookingConfirmation   || 'book_then_defer');
    _setSelectValue(DOM.mfAfterHoursIntake,      mf.afterHoursIntake      || 'answer_then_book');
    _setSelectValue(DOM.mfTransferInProgress,    mf.transferInProgress    || 'block_injection');

    // ── Knowledge Engine ────────────────────────────────────────────────────
    const ke = settings.knowledgeEngine || {};
    DOM.fieldStrictGrounded.checked = ke.strictGroundedMode !== false;

    const onNoMatch = ke.onNoKcMatch || 'abstain';
    DOM.kcMatchRadios.forEach(r => { r.checked = (r.value === onNoMatch); });

    DOM.fieldLogKcMisses.checked = ke.logKcMisses !== false;

    // ── Agenda State ────────────────────────────────────────────────────────
    const ag = settings.agendaState || {};
    _setSelectValue(DOM.fieldMaxDeferred, String(ag.maxDeferredIntents ?? 3));
    DOM.fieldAutoSurface.checked = ag.autoSurfaceDeferred !== false;
    _setSelectValue(DOM.fieldDeferredTimeout, String(ag.deferredTimeoutTurns ?? 5));

    // ── Escalation (stored in policyRouter.escalationConfig or dedicated field)
    // NOTE: The escalation config is not yet wired to a dedicated DB field.
    // These fields will be serialised as part of policyRouter.escalationConfig
    // when the backend adds that sub-schema. For now, render from defaults.
    const esc = (settings.policyRouter || {}).escalationConfig || {};
    DOM.rungDeescalate.checked      = esc.rung1DeEscalate !== false;
    DOM.rungConfirmTransfer.checked = esc.rung4ConfirmTransfer !== false;
    DOM.altVoicemail.checked        = esc.altVoicemail !== false;
    DOM.altCallback.checked         = esc.altCallback !== false;
    DOM.altAppointment.checked      = esc.altAppointment !== false;
    DOM.altEmergency.checked        = !!esc.altEmergency;
    DOM.emergencyNumber.value       = esc.emergencyNumber || '';

    // ── Trace ───────────────────────────────────────────────────────────────
    const tr = settings.trace || {};
    DOM.fieldTraceEnabled.checked  = tr.enabled !== false;
    DOM.fieldTraceShowCI.checked   = tr.showInCallIntelligence !== false;
    DOM.fieldAlertThreshold.value  = String(tr.alertOnFallbackCount ?? 2);
  }

  function _setSelectValue(select, value) {
    if (!select) return;
    // Check if option exists; if not, leave unchanged
    const opts = Array.from(select.options).map(o => o.value);
    if (opts.includes(value)) select.value = value;
  }

  // ==========================================================================
  // COLLECTOR — read form fields back into PATCH payload
  // ==========================================================================

  function collectSettings() {
    const enabledPolicies = [];
    DOM.policyCheckboxes.forEach(cb => {
      if (cb.checked) enabledPolicies.push(cb.dataset.policy);
    });

    const confRaw   = parseInt(DOM.fieldConfidence.value, 10);
    const confFloat = (confRaw / 100);

    // Selected mode radio
    let mode = 'passive';
    DOM.modeRadios.forEach(r => { if (r.checked) mode = r.value; });

    // Selected on-no-kc-match radio
    let onNoKcMatch = 'abstain';
    DOM.kcMatchRadios.forEach(r => { if (r.checked) onNoKcMatch = r.value; });

    // Escalation config packed into policyRouter
    const escalationConfig = {
      rung1DeEscalate:     DOM.rungDeescalate.checked,
      rung4ConfirmTransfer: DOM.rungConfirmTransfer.checked,
      altVoicemail:        DOM.altVoicemail.checked,
      altCallback:         DOM.altCallback.checked,
      altAppointment:      DOM.altAppointment.checked,
      altEmergency:        DOM.altEmergency.checked,
      emergencyNumber:     DOM.emergencyNumber.value.trim()
    };

    return {
      enabled: DOM.fieldEnabled.checked,
      mode,

      intentDetection: {
        multiIntentEnabled:  DOM.fieldMultiIntent.checked,
        confidenceThreshold: confFloat,
        maxIntentsPerTurn:   parseInt(DOM.fieldMaxIntents.value, 10)
      },

      policyRouter: {
        enabledPolicies,
        escalationConfig
      },

      midFlowInterrupt: {
        bookingSlotSelection:  DOM.mfBookingSlotSelection.value,
        bookingAddressCapture: DOM.mfBookingAddressCapture.value,
        bookingConfirmation:   DOM.mfBookingConfirmation.value,
        afterHoursIntake:      DOM.mfAfterHoursIntake.value,
        transferInProgress:    DOM.mfTransferInProgress.value
      },

      knowledgeEngine: {
        strictGroundedMode: DOM.fieldStrictGrounded.checked,
        onNoKcMatch,
        logKcMisses:        DOM.fieldLogKcMisses.checked
      },

      agendaState: {
        maxDeferredIntents:   parseInt(DOM.fieldMaxDeferred.value, 10),
        autoSurfaceDeferred:  DOM.fieldAutoSurface.checked,
        deferredTimeoutTurns: parseInt(DOM.fieldDeferredTimeout.value, 10)
      },

      trace: {
        enabled:               DOM.fieldTraceEnabled.checked,
        showInCallIntelligence: DOM.fieldTraceShowCI.checked,
        alertOnFallbackCount:  parseInt(DOM.fieldAlertThreshold.value, 10) || 2
      }
    };
  }

  // ==========================================================================
  // STATUS BADGE
  // ==========================================================================

  function renderStatusBadge(status) {
    if (!DOM.statusBadge || !DOM.statusDot || !DOM.statusLabel) return;

    // Remove all status classes
    Object.values(CONFIG.STATUS_COLORS).forEach(cls => {
      DOM.statusBadge.classList.remove(cls);
      DOM.statusDot.classList.remove(cls);
    });

    const colorClass = CONFIG.STATUS_COLORS[status] || 'status-disabled';
    DOM.statusBadge.classList.add(colorClass);
    DOM.statusDot.classList.add(colorClass);
    DOM.statusLabel.textContent = CONFIG.STATUS_LABELS[status] || status;
  }

  // ==========================================================================
  // NAV — section navigation
  // ==========================================================================

  function initNav() {
    DOM.navItems.forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        const target = item.dataset.section;
        activateSection(target);
      });
    });
  }

  function activateSection(sectionId) {
    // Update nav active state
    DOM.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.section === sectionId);
    });

    // Show/hide sections
    DOM.sections.forEach(section => {
      const id = section.id.replace('section-', '');
      section.classList.toggle('active', id === sectionId);
    });

    // Scroll main to top when switching sections
    const main = document.getElementById('eh-main');
    if (main) main.scrollTop = 0;
  }

  // ==========================================================================
  // BEHAVIOR CARDS — LIST RENDERING
  // ==========================================================================

  function renderBehaviorCards(cards) {
    state.cards = cards || [];

    const categoryCards  = state.cards.filter(c => c.type === 'category_linked');
    const standaloneCards = state.cards.filter(c => c.type === 'standalone');

    _renderBcList(DOM.bcListCategory,   DOM.bcEmptyCategory,   categoryCards,  'category_linked');
    _renderBcList(DOM.bcListStandalone, DOM.bcEmptyStandalone, standaloneCards, 'standalone');
  }

  function _renderBcList(listEl, emptyEl, cards, type) {
    if (!listEl || !emptyEl) return;

    // Remove existing card rows (not the empty placeholder)
    listEl.querySelectorAll('.eh-bc-card').forEach(el => el.remove());

    if (cards.length === 0) {
      emptyEl.style.display = 'flex';
      return;
    }

    emptyEl.style.display = 'none';

    cards.forEach(card => {
      const el = _buildBcCard(card);
      listEl.insertBefore(el, emptyEl);
    });
  }

  function _buildBcCard(card) {
    const el = document.createElement('div');
    el.className = 'eh-bc-card';
    el.dataset.bcId = card._id;

    const identifier = card.type === 'category_linked'
      ? card.category
      : (CONFIG.STANDALONE_LABELS[card.standaloneType] || card.standaloneType);

    const enabledBadge = card.enabled
      ? '<span class="eh-bc-badge eh-bc-badge--on">Enabled</span>'
      : '<span class="eh-bc-badge eh-bc-badge--off">Disabled</span>';

    const doCount   = (card.rules && card.rules.do)   ? card.rules.do.length   : 0;
    const dontCount = (card.rules && card.rules.doNot) ? card.rules.doNot.length : 0;

    el.innerHTML = `
      <div class="eh-bc-card-header">
        <div class="eh-bc-card-title">
          <strong>${_escHtml(card.name)}</strong>
          <span class="eh-bc-card-identifier">${_escHtml(identifier)}</span>
        </div>
        <div class="eh-bc-card-meta">
          ${enabledBadge}
          <button class="eh-btn-ghost eh-bc-edit-btn" data-bc-id="${card._id}">Edit</button>
        </div>
      </div>
      ${card.tone ? `<p class="eh-bc-card-tone">${_escHtml(card.tone)}</p>` : ''}
      <div class="eh-bc-card-stats">
        ${doCount > 0   ? `<span>${doCount} Do rule${doCount !== 1 ? 's' : ''}</span>` : ''}
        ${dontCount > 0 ? `<span>${dontCount} Do Not rule${dontCount !== 1 ? 's' : ''}</span>` : ''}
        ${card.afterAction && card.afterAction !== 'none'
          ? `<span class="eh-bc-after-action">After: ${_escHtml(card.afterAction)}</span>`
          : ''}
      </div>
    `;

    el.querySelector('.eh-bc-edit-btn').addEventListener('click', () => {
      openBcModal(card._id);
    });

    return el;
  }

  // ==========================================================================
  // BEHAVIOR CARD MODAL
  // ==========================================================================

  function openBcModal(bcId) {
    // Determine type from tab context or from existing card
    if (bcId) {
      // Editing existing card
      const card = state.cards.find(c => c._id === bcId);
      if (!card) return;

      state.editingBcId   = bcId;
      state.editingBcType = card.type;

      DOM.bcModalTitle.textContent = 'Edit Behavior Card';
      DOM.bcModalId.value          = bcId;
      DOM.bcModalType.value        = card.type;

      // Populate fields
      DOM.bcName.value  = card.name || '';
      DOM.bcTone.value  = card.tone || '';

      if (card.type === 'category_linked') {
        DOM.bcCategoryGroup.style.display   = '';
        DOM.bcStandaloneGroup.style.display = 'none';
        DOM.bcCategory.value = card.category || '';
      } else {
        DOM.bcCategoryGroup.style.display   = 'none';
        DOM.bcStandaloneGroup.style.display = '';
        _setSelectValue(DOM.bcStandaloneType, card.standaloneType || '');
      }

      _renderRulesList(DOM.bcDoList,       card.rules && card.rules.do               || []);
      _renderRulesList(DOM.bcDoNotList,    card.rules && card.rules.doNot            || []);
      _renderRulesList(DOM.bcExamplesList, card.rules && card.rules.exampleResponses || []);

      _setSelectValue(DOM.bcAfterAction, card.afterAction || 'none');

      DOM.bcModalDelete.style.display = 'inline-flex';

    } else {
      // Creating new card — type from active tab
      const activeTab = document.querySelector('.eh-bc-tab.active');
      const tabType   = activeTab ? activeTab.dataset.bcTab : 'category';
      const type      = (tabType === 'standalone') ? 'standalone' : 'category_linked';

      state.editingBcId   = null;
      state.editingBcType = type;

      DOM.bcModalTitle.textContent = type === 'standalone'
        ? 'New Standalone Behavior Card'
        : 'New Category Behavior Card';

      DOM.bcModalId.value   = '';
      DOM.bcModalType.value = type;

      DOM.bcName.value  = '';
      DOM.bcTone.value  = '';
      DOM.bcCategory.value = '';
      _setSelectValue(DOM.bcStandaloneType, '');

      if (type === 'category_linked') {
        DOM.bcCategoryGroup.style.display   = '';
        DOM.bcStandaloneGroup.style.display = 'none';
      } else {
        DOM.bcCategoryGroup.style.display   = 'none';
        DOM.bcStandaloneGroup.style.display = '';
      }

      _renderRulesList(DOM.bcDoList,       []);
      _renderRulesList(DOM.bcDoNotList,    []);
      _renderRulesList(DOM.bcExamplesList, []);

      _setSelectValue(DOM.bcAfterAction, 'none');

      DOM.bcModalDelete.style.display = 'none';
    }

    DOM.bcModal.style.display = 'flex';
    DOM.bcName.focus();
  }

  function closeBcModal() {
    DOM.bcModal.style.display    = 'none';
    state.editingBcId            = null;
    state.editingBcType          = null;
  }

  function _renderRulesList(container, rules) {
    container.innerHTML = '';
    (rules || []).forEach(rule => {
      container.appendChild(_buildRuleRow(rule));
    });
  }

  function _buildRuleRow(value) {
    const row = document.createElement('div');
    row.className = 'eh-rule-row';
    row.innerHTML = `
      <input type="text" class="eh-input eh-rule-input" value="${_escAttr(value)}" placeholder="Enter rule…">
      <button type="button" class="eh-btn-ghost eh-rule-remove" title="Remove">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    row.querySelector('.eh-rule-remove').addEventListener('click', () => row.remove());
    return row;
  }

  function _addRuleToList(listId) {
    const container = document.getElementById(
      listId === 'do'               ? 'bc-do-list' :
      listId === 'doNot'            ? 'bc-donot-list' :
                                      'bc-examples-list'
    );
    if (!container) return;
    const row = _buildRuleRow('');
    container.appendChild(row);
    row.querySelector('.eh-rule-input').focus();
  }

  function _collectRulesFromList(container) {
    return Array.from(container.querySelectorAll('.eh-rule-input'))
      .map(i => i.value.trim())
      .filter(v => v.length > 0);
  }

  async function saveBcModal() {
    const name = DOM.bcName.value.trim();
    if (!name) {
      showToast('error', 'Card Name is required');
      DOM.bcName.focus();
      return;
    }

    const type = DOM.bcModalType.value;

    let category      = '';
    let standaloneType = null;

    if (type === 'category_linked') {
      category = DOM.bcCategory.value.trim();
      if (!category) {
        showToast('error', 'KC Category is required for category-linked cards');
        DOM.bcCategory.focus();
        return;
      }
    } else {
      standaloneType = DOM.bcStandaloneType.value;
      if (!standaloneType) {
        showToast('error', 'Please select a Standalone Type');
        DOM.bcStandaloneType.focus();
        return;
      }
    }

    const payload = {
      name,
      type,
      category:       type === 'category_linked' ? category : undefined,
      standaloneType: type === 'standalone'       ? standaloneType : undefined,
      tone:           DOM.bcTone.value.trim(),
      rules: {
        do:               _collectRulesFromList(DOM.bcDoList),
        doNot:            _collectRulesFromList(DOM.bcDoNotList),
        exampleResponses: _collectRulesFromList(DOM.bcExamplesList)
      },
      afterAction: DOM.bcAfterAction.value || 'none'
    };

    DOM.bcModalSave.disabled    = true;
    DOM.bcModalSave.textContent = 'Saving…';

    try {
      if (state.editingBcId) {
        // PATCH — only patchable fields
        const patchPayload = {
          name:        payload.name,
          tone:        payload.tone,
          rules:       payload.rules,
          afterAction: payload.afterAction
        };
        await apiUpdateBehaviorCard(state.editingBcId, patchPayload);
        showToast('success', `Behavior Card "${name}" updated`);
      } else {
        await apiCreateBehaviorCard(payload);
        showToast('success', `Behavior Card "${name}" created`);
      }

      closeBcModal();
      await loadBehaviorCards();

    } catch (err) {
      showToast('error', err.message || 'Failed to save Behavior Card');
    } finally {
      DOM.bcModalSave.disabled    = false;
      DOM.bcModalSave.textContent = 'Save Behavior Card';
    }
  }

  async function deleteBcCard() {
    if (!state.editingBcId) return;

    const card = state.cards.find(c => c._id === state.editingBcId);
    const name = card ? card.name : 'this card';

    if (!confirm(`Delete Behavior Card "${name}"? This cannot be undone.`)) return;

    DOM.bcModalDelete.disabled    = true;
    DOM.bcModalDelete.textContent = 'Deleting…';

    try {
      await apiDeleteBehaviorCard(state.editingBcId);
      showToast('success', `Behavior Card "${name}" deleted`);
      closeBcModal();
      await loadBehaviorCards();
    } catch (err) {
      showToast('error', err.message || 'Failed to delete Behavior Card');
      DOM.bcModalDelete.disabled    = false;
      DOM.bcModalDelete.textContent = 'Delete Card';
    }
  }

  // ==========================================================================
  // BEHAVIOR CARD TABS
  // ==========================================================================

  function initBcTabs() {
    DOM.bcTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        DOM.bcTabs.forEach(t => t.classList.remove('active'));
        DOM.bcPanels.forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const panelId = `bc-panel-${tab.dataset.bcTab}`;
        const panel   = document.getElementById(panelId);
        if (panel) panel.classList.add('active');
      });
    });
  }

  // ==========================================================================
  // DATA LOADING
  // ==========================================================================

  async function loadSettings() {
    try {
      const data = await apiGetSettings();
      state.settings     = data.settings;
      state.isConfigured = data.isConfigured;
      state.companyName  = data.companyName;

      // Header company info
      if (DOM.headerCompanyName) DOM.headerCompanyName.textContent = data.companyName || '—';
      if (DOM.headerCompanyId)   DOM.headerCompanyId.textContent   = state.companyId;

      renderSettings(data.settings);

      // Banner — shown when never configured
      if (DOM.bannerNotConfigured) {
        DOM.bannerNotConfigured.style.display = data.isConfigured ? 'none' : 'flex';
      }

    } catch (err) {
      showToast('error', 'Failed to load Engine Hub settings. Check auth.');
      console.error('[ENGINE HUB] loadSettings failed', err);
    }
  }

  async function loadHealth() {
    try {
      const data = await apiGetHealth();
      renderStatusBadge(data.status || 'NOT_CONFIGURED');
    } catch (err) {
      renderStatusBadge('NOT_CONFIGURED');
    }
  }

  async function loadBehaviorCards() {
    try {
      const data = await apiGetBehaviorCards();
      renderBehaviorCards(data.cards || []);
    } catch (err) {
      showToast('error', 'Failed to load Behavior Cards');
      console.error('[ENGINE HUB] loadBehaviorCards failed', err);
    }
  }

  // ==========================================================================
  // SAVE ALL
  // ==========================================================================

  async function saveAllSettings() {
    if (state.isSaving) return;
    state.isSaving = true;

    DOM.btnSaveAll.disabled    = true;
    DOM.btnSaveAll.textContent = 'Saving…';

    try {
      const payload = collectSettings();
      const data    = await apiPatchSettings(payload);

      state.settings     = data.settings;
      state.isConfigured = true;

      // Hide the not-configured banner after first save
      if (DOM.bannerNotConfigured) DOM.bannerNotConfigured.style.display = 'none';

      // Refresh health badge
      await loadHealth();

      showToast('success', '✓ Engine Hub settings saved');

    } catch (err) {
      showToast('error', err.message || 'Save failed — check the console');
      console.error('[ENGINE HUB] saveAllSettings failed', err);
    } finally {
      state.isSaving             = false;
      DOM.btnSaveAll.disabled    = false;
      DOM.btnSaveAll.textContent = 'Save All Settings';
    }
  }

  // ==========================================================================
  // CONFIDENCE SLIDER — live label update
  // ==========================================================================

  function initConfidenceSlider() {
    if (!DOM.fieldConfidence || !DOM.confidenceDisplay) return;
    DOM.fieldConfidence.addEventListener('input', () => {
      const val = parseInt(DOM.fieldConfidence.value, 10) / 100;
      DOM.confidenceDisplay.textContent = val.toFixed(2);
    });
  }

  // ==========================================================================
  // ESCAPE HELPERS
  // ==========================================================================

  function _escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _escAttr(str) {
    return String(str || '').replace(/"/g, '&quot;');
  }

  // ==========================================================================
  // EVENT LISTENERS
  // ==========================================================================

  function setupEventListeners() {
    // Back button
    DOM.btnBack.addEventListener('click', () => {
      window.location.href =
        `/agent-console/index.html?companyId=${encodeURIComponent(state.companyId)}`;
    });

    // Save All
    DOM.btnSaveAll.addEventListener('click', saveAllSettings);

    // BC new buttons
    if (DOM.btnNewCategoryBc) {
      DOM.btnNewCategoryBc.addEventListener('click', () => openBcModal(null));
    }
    if (DOM.btnNewStandaloneBc) {
      DOM.btnNewStandaloneBc.addEventListener('click', () => openBcModal(null));
    }

    // BC Modal — close/cancel
    DOM.bcModalClose.addEventListener('click',  closeBcModal);
    DOM.bcModalCancel.addEventListener('click', closeBcModal);

    // BC Modal — save
    DOM.bcModalSave.addEventListener('click', saveBcModal);

    // BC Modal — delete
    DOM.bcModalDelete.addEventListener('click', deleteBcCard);

    // BC Modal — close on overlay click
    DOM.bcModal.addEventListener('click', e => {
      if (e.target === DOM.bcModal) closeBcModal();
    });

    // BC Modal — Add rule/example buttons
    DOM.btnAddDo.addEventListener('click',      () => _addRuleToList('do'));
    DOM.btnAddDoNot.addEventListener('click',   () => _addRuleToList('doNot'));
    DOM.btnAddExample.addEventListener('click', () => _addRuleToList('exampleResponses'));

    // Keyboard — Esc closes modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && DOM.bcModal.style.display === 'flex') {
        closeBcModal();
      }
    });
  }

  // ==========================================================================
  // INIT
  // ==========================================================================

  async function init() {
    state.companyId = getCompanyId();

    if (!state.companyId) {
      document.body.innerHTML = `
        <div style="padding:48px;text-align:center;font-family:Inter,sans-serif;">
          <h2 style="color:#EF4444">Missing companyId</h2>
          <p>Open this page with <code>?companyId=&lt;id&gt;</code> in the URL.</p>
          <a href="/agent-console/index.html" style="color:#3B82F6">← Agent Console</a>
        </div>
      `;
      return;
    }

    // Bind all DOM references before anything else
    bindDOM();

    // Wire navigation
    initNav();
    initBcTabs();
    initConfidenceSlider();
    setupEventListeners();

    // Show loading state on status badge
    renderStatusBadge('NOT_CONFIGURED');

    // Load all data in parallel
    await Promise.all([
      loadSettings(),
      loadHealth(),
      loadBehaviorCards()
    ]);
  }

  // Boot on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
