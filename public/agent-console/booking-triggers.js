/**
 * ============================================================================
 * BOOKING TRIGGERS — Admin Console Client
 * ============================================================================
 *
 * Manages CompanyBookingTrigger CRUD:
 *   - Load + render trigger list with stats
 *   - Create / edit / delete via modal editor
 *   - Tag inputs for keywords, phrases, negative arrays
 *   - firesOnSteps checkboxes, behavior radios, redirectMode conditional
 *   - responseMode toggle (standard / llm) with conditional form sections
 *   - Instant audio status + manual regeneration
 *   - Test-phrase panel against the live trigger pool
 *
 * API BASE: /api/admin/agent2/company/:companyId/booking-triggers
 *
 * ============================================================================
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

let companyId    = null;
let companyName  = 'Company';
let authToken    = null;
let allTriggers  = [];
let editingRuleId = null;   // null = new trigger mode

// Tag input state — Map<fieldId, string[]>
const tagState = {
  keywords:     [],
  phrases:      [],
  negKeywords:  [],
  negPhrases:   [],
  tags:         []
};

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Read companyId + auth from URL or localStorage (same pattern as booking.js)
  const params = new URLSearchParams(window.location.search);
  companyId = params.get('companyId') || localStorage.getItem('selectedCompanyId');
  authToken = localStorage.getItem('authToken') || localStorage.getItem('token');

  if (!companyId) {
    showError('No companyId in URL — add ?companyId=xxx to the URL.');
    return;
  }

  loadCompanyMeta();
  loadTriggers();
  bindUI();
});

// ─────────────────────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = () => `/api/admin/agent2/company/${companyId}/booking-triggers`;

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    },
    ...opts
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY META
// ─────────────────────────────────────────────────────────────────────────────

async function loadCompanyMeta() {
  try {
    const data = await apiFetch(`/api/v2/companies/${companyId}`);
    companyName = data?.company?.companyName || data?.companyName || companyId;
  } catch (_) { /* non-critical — just display companyId */ }

  document.getElementById('header-company-name').textContent = companyName;
  document.getElementById('header-company-id').textContent   = companyId;

  // Back links
  const backUrl = `/agent-console/booking.html?companyId=${companyId}`;
  document.getElementById('btn-back').href        = backUrl;
  document.getElementById('btn-header-back').addEventListener('click', () => { window.location.href = backUrl; });
  document.getElementById('header-logo-link').href = `/agent-console/company-profile.html?companyId=${companyId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD + RENDER TRIGGER LIST
// ─────────────────────────────────────────────────────────────────────────────

async function loadTriggers() {
  document.getElementById('trigger-list-container').innerHTML = '<div class="loading-overlay">Loading triggers...</div>';

  try {
    const res = await apiFetch(API_BASE());
    allTriggers = res.data || [];
    updateStats(res.stats, allTriggers);
    renderTriggerList(allTriggers);
  } catch (err) {
    document.getElementById('trigger-list-container').innerHTML =
      `<div class="loading-overlay" style="color:#dc2626">Failed to load: ${err.message}</div>`;
  }
}

function updateStats(stats, triggers) {
  const active = triggers.filter(t => !t.isDeleted && t.enabled);
  document.getElementById('stat-total').textContent    = triggers.length;
  document.getElementById('stat-active').textContent   = active.length;
  document.getElementById('stat-info').textContent     = stats?.byBehavior?.INFO     ?? active.filter(t => t.behavior === 'INFO').length;
  document.getElementById('stat-block').textContent    = stats?.byBehavior?.BLOCK    ?? active.filter(t => t.behavior === 'BLOCK').length;
  document.getElementById('stat-redirect').textContent = stats?.byBehavior?.REDIRECT ?? active.filter(t => t.behavior === 'REDIRECT').length;
}

function renderTriggerList(triggers) {
  const container = document.getElementById('trigger-list-container');

  if (!triggers.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No booking triggers yet</h3>
        <p>Create your first trigger to intercept specific caller phrases during booking.</p>
      </div>`;
    return;
  }

  const rows = triggers.map(t => `
    <tr data-ruleid="${t.ruleId}">
      <td class="trigger-label-cell">
        <div class="trigger-label">${esc(t.label)}</div>
        <div class="trigger-rule-id">${esc(t.ruleId)}</div>
      </td>
      <td>${renderBehaviorBadge(t.behavior)}</td>
      <td class="steps-cell">${renderStepChips(t.firesOnSteps)}</td>
      <td>${renderModeBadge(t.responseMode)}</td>
      <td>${renderKeywordSummary(t)}</td>
      <td>
        <div class="toggle-pill ${t.enabled ? 'on' : 'off'}" data-action="toggle" title="${t.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}"></div>
      </td>
      <td>
        <div class="btn-row">
          <button class="btn-icon-sm" data-action="edit" title="Edit trigger">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9.5 2.5L11.5 4.5M1 13H3L11.5 4.5L9.5 2.5L1 11V13Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="btn-icon-sm danger" data-action="delete" title="Delete trigger">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 3.5H13M4.5 3.5V2H9.5V3.5M5.5 6.5V10.5M8.5 6.5V10.5M2.5 3.5L3 12H11L11.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <table class="trigger-table">
      <thead>
        <tr>
          <th>Label / Rule ID</th>
          <th>Behavior</th>
          <th>Active Steps</th>
          <th>Mode</th>
          <th>Keywords / Phrases</th>
          <th>On</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  // Bind row actions
  container.querySelectorAll('[data-action="edit"]').forEach(btn => {
    const ruleId = btn.closest('tr').dataset.ruleid;
    btn.addEventListener('click', () => openEditModal(ruleId));
  });
  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    const ruleId = btn.closest('tr').dataset.ruleid;
    btn.addEventListener('click', () => { openEditModal(ruleId); showDeleteConfirm(); });
  });
  container.querySelectorAll('[data-action="toggle"]').forEach(pill => {
    const ruleId = pill.closest('tr').dataset.ruleid;
    pill.addEventListener('click', () => quickToggleEnabled(ruleId, pill));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function renderBehaviorBadge(behavior) {
  const map = {
    INFO:     '<span class="badge badge-info">INFO</span>',
    BLOCK:    '<span class="badge badge-block">BLOCK</span>',
    REDIRECT: '<span class="badge badge-redirect">REDIRECT</span>'
  };
  return map[behavior] || `<span class="badge badge-standard">${esc(behavior)}</span>`;
}

function renderModeBadge(mode) {
  if (mode === 'llm') return '<span class="badge badge-llm">LLM</span>';
  return '<span class="badge badge-standard">STD</span>';
}

function renderStepChips(steps) {
  if (!Array.isArray(steps) || !steps.length) return '<span class="step-chip any">ANY</span>';
  return steps.map(s => `<span class="step-chip ${s === 'ANY' ? 'any' : ''}">${esc(s.replace('COLLECT_', ''))}</span>`).join('');
}

function renderKeywordSummary(t) {
  const kw = (t.keywords || []).slice(0, 3);
  const ph = (t.phrases  || []).slice(0, 2);
  const parts = [...kw.map(k => `<code style="font-size:0.75rem;background:var(--bg-tertiary);padding:1px 5px;border-radius:3px">${esc(k)}</code>`),
                 ...ph.map(p => `<em style="font-size:0.75rem;color:var(--text-muted)">"${esc(p)}"</em>`)];
  if (!parts.length) return '<span style="color:var(--text-muted);font-size:0.8125rem">—</span>';
  const total = (t.keywords?.length || 0) + (t.phrases?.length || 0);
  const more  = total > 5 ? ` <span style="color:var(--text-muted);font-size:0.75rem">+${total - 5}</span>` : '';
  return parts.join(' ') + more;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK TOGGLE ENABLED
// ─────────────────────────────────────────────────────────────────────────────

async function quickToggleEnabled(ruleId, pillEl) {
  const trigger = allTriggers.find(t => t.ruleId === ruleId);
  if (!trigger) return;
  const newEnabled = !trigger.enabled;

  pillEl.classList.toggle('on',  newEnabled);
  pillEl.classList.toggle('off', !newEnabled);
  trigger.enabled = newEnabled;

  try {
    await apiFetch(`${API_BASE()}/${ruleId}`, {
      method: 'PATCH',
      body:   JSON.stringify({ enabled: newEnabled })
    });
    toast(`Trigger ${newEnabled ? 'enabled' : 'disabled'}`, 'success');
  } catch (err) {
    // Rollback
    trigger.enabled = !newEnabled;
    pillEl.classList.toggle('on',  !newEnabled);
    pillEl.classList.toggle('off', newEnabled);
    toast(`Failed: ${err.message}`, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL — OPEN / CLOSE
// ─────────────────────────────────────────────────────────────────────────────

function openNewModal() {
  editingRuleId = null;
  resetModalForm();
  document.getElementById('modal-title').textContent = 'New Booking Trigger';
  document.getElementById('f-ruleId').readOnly = false;
  document.getElementById('btn-delete-trigger').style.display = 'none';
  hideDeleteConfirm();
  setModalOpen(true);
}

function openEditModal(ruleId) {
  const trigger = allTriggers.find(t => t.ruleId === ruleId);
  if (!trigger) { toast('Trigger not found locally — refresh the page', 'error'); return; }

  editingRuleId = ruleId;
  resetModalForm();
  populateModalForm(trigger);

  document.getElementById('modal-title').textContent = `Edit: ${trigger.label}`;
  document.getElementById('f-ruleId').readOnly = true;
  document.getElementById('btn-delete-trigger').style.display = 'inline-flex';
  hideDeleteConfirm();
  setModalOpen(true);

  // Load audio status
  loadAudioStatus(trigger);
}

function setModalOpen(open) {
  document.getElementById('modal-overlay').classList.toggle('open', open);
  if (!open) editingRuleId = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL FORM — RESET + POPULATE
// ─────────────────────────────────────────────────────────────────────────────

function resetModalForm() {
  // Text fields
  document.getElementById('f-ruleId').value          = '';
  document.getElementById('f-label').value           = '';
  document.getElementById('f-description').value     = '';
  document.getElementById('f-priority').value        = '50';
  document.getElementById('f-maxInputWords').value   = '';
  document.getElementById('f-answerText').value      = '';
  document.getElementById('f-followUpQuestion').value = '';
  document.getElementById('f-includedFacts').value   = '';
  document.getElementById('f-excludedFacts').value   = '';
  document.getElementById('f-backupAnswer').value    = '';
  document.getElementById('f-redirectMode').value    = '';

  // Steps — default: ANY checked
  setStepCheckboxes(['ANY']);

  // Behavior — default: INFO
  setBehaviorRadio('INFO');

  // Response mode — default: standard
  setResponseMode('standard');

  // Tag inputs — clear all
  for (const key of Object.keys(tagState)) tagState[key] = [];
  renderAllTags();

  // Enabled — default: on
  setEnabledToggle(true);

  // Audio status
  resetAudioStatus();
}

function populateModalForm(t) {
  document.getElementById('f-ruleId').value           = t.ruleId || '';
  document.getElementById('f-label').value            = t.label || '';
  document.getElementById('f-description').value      = t.description || '';
  document.getElementById('f-priority').value         = t.priority ?? 50;
  document.getElementById('f-maxInputWords').value    = t.maxInputWords ?? '';
  document.getElementById('f-answerText').value       = t.answerText || '';
  document.getElementById('f-followUpQuestion').value = t.followUpQuestion || '';
  document.getElementById('f-redirectMode').value     = t.redirectMode || '';

  if (t.llmFactPack) {
    document.getElementById('f-includedFacts').value = t.llmFactPack.includedFacts || '';
    document.getElementById('f-excludedFacts').value = t.llmFactPack.excludedFacts || '';
    document.getElementById('f-backupAnswer').value  = t.llmFactPack.backupAnswer  || '';
  }

  setStepCheckboxes(t.firesOnSteps?.length ? t.firesOnSteps : ['ANY']);
  setBehaviorRadio(t.behavior || 'INFO');
  setResponseMode(t.responseMode || 'standard');

  tagState.keywords    = [...(t.keywords         || [])];
  tagState.phrases     = [...(t.phrases          || [])];
  tagState.negKeywords = [...(t.negativeKeywords || [])];
  tagState.negPhrases  = [...(t.negativePhrases  || [])];
  tagState.tags        = [...(t.tags             || [])];
  renderAllTags();

  setEnabledToggle(t.enabled !== false);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEPS CHECKBOXES
// ─────────────────────────────────────────────────────────────────────────────

function setStepCheckboxes(steps) {
  document.querySelectorAll('#steps-grid .step-checkbox').forEach(el => {
    const val  = el.dataset.step;
    const on   = steps.includes(val);
    el.classList.toggle('checked', on);
    el.querySelector('input').checked = on;
  });
}

function getSelectedSteps() {
  return [...document.querySelectorAll('#steps-grid .step-checkbox input:checked')]
    .map(el => el.value);
}

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR RADIO
// ─────────────────────────────────────────────────────────────────────────────

function setBehaviorRadio(behavior) {
  document.querySelectorAll('#behavior-radios .behavior-radio').forEach(el => {
    const val = el.dataset.behavior;
    const sel = val === behavior;
    el.classList.remove('selected-info', 'selected-block', 'selected-redirect');
    if (sel) el.classList.add(`selected-${val.toLowerCase()}`);
    el.querySelector('input').checked = sel;
  });

  // Show/hide redirectMode field
  document.getElementById('redirect-mode-group').style.display =
    behavior === 'REDIRECT' ? 'flex' : 'none';
}

function getSelectedBehavior() {
  const el = document.querySelector('#behavior-radios input:checked');
  return el ? el.value : 'INFO';
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE MODE TOGGLE
// ─────────────────────────────────────────────────────────────────────────────

function setResponseMode(mode) {
  const isLlm = mode === 'llm';
  document.getElementById('tab-standard').classList.toggle('active', !isLlm);
  document.getElementById('tab-llm').classList.toggle('active', isLlm);
  document.getElementById('standard-fields').style.display = isLlm ? 'none' : 'block';
  document.getElementById('llm-fields').style.display      = isLlm ? 'block' : 'none';
}

function getCurrentResponseMode() {
  return document.getElementById('tab-llm').classList.contains('active') ? 'llm' : 'standard';
}

// ─────────────────────────────────────────────────────────────────────────────
// ENABLED TOGGLE
// ─────────────────────────────────────────────────────────────────────────────

function setEnabledToggle(on) {
  const el  = document.getElementById('enabled-toggle');
  const lbl = document.getElementById('enabled-label');
  el.classList.toggle('on',  on);
  el.classList.toggle('off', !on);
  lbl.textContent = on ? 'Enabled' : 'Disabled';
}

function getEnabledValue() {
  return document.getElementById('enabled-toggle').classList.contains('on');
}

// ─────────────────────────────────────────────────────────────────────────────
// TAG INPUTS
// ─────────────────────────────────────────────────────────────────────────────

const TAG_CONFIG = [
  { key: 'keywords',    containerId: 'keywords-container',     inputId: 'keywords-input'     },
  { key: 'phrases',     containerId: 'phrases-container',      inputId: 'phrases-input'      },
  { key: 'negKeywords', containerId: 'neg-keywords-container', inputId: 'neg-keywords-input' },
  { key: 'negPhrases',  containerId: 'neg-phrases-container',  inputId: 'neg-phrases-input'  },
  { key: 'tags',        containerId: 'tags-container',         inputId: 'tags-input'         }
];

function renderAllTags() {
  TAG_CONFIG.forEach(({ key, containerId, inputId }) => {
    renderTagContainer(key, containerId, inputId);
  });
}

function renderTagContainer(key, containerId, inputId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Remove old tags (keep the input at the end)
  container.querySelectorAll('.tag').forEach(el => el.remove());

  const inputEl = document.getElementById(inputId);

  tagState[key].forEach((val, idx) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `${esc(val)} <span class="tag-remove" data-idx="${idx}">×</span>`;
    tag.querySelector('.tag-remove').addEventListener('click', () => {
      tagState[key].splice(idx, 1);
      renderTagContainer(key, containerId, inputId);
    });
    container.insertBefore(tag, inputEl);
  });
}

function addTag(key, val) {
  const v = val.trim().toLowerCase();
  if (!v || tagState[key].includes(v)) return;
  tagState[key].push(v);
}

function bindTagInputs() {
  TAG_CONFIG.forEach(({ key, containerId, inputId }) => {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;

    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = inputEl.value.replace(/,/g, '').trim();
        if (val) {
          addTag(key, val);
          inputEl.value = '';
          renderTagContainer(key, containerId, inputId);
        }
      } else if (e.key === 'Backspace' && !inputEl.value && tagState[key].length) {
        tagState[key].pop();
        renderTagContainer(key, containerId, inputId);
      }
    });

    inputEl.addEventListener('blur', () => {
      const val = inputEl.value.trim();
      if (val) {
        addTag(key, val);
        inputEl.value = '';
        renderTagContainer(key, containerId, inputId);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO STATUS
// ─────────────────────────────────────────────────────────────────────────────

async function loadAudioStatus(trigger) {
  if (trigger.responseMode === 'llm') {
    document.getElementById('audio-status-text').textContent = 'LLM mode — audio generated dynamically per call';
    document.getElementById('audio-dot').className = 'audio-dot missing';
    document.getElementById('btn-gen-audio').style.display = 'none';
    return;
  }

  if (!trigger.answerText?.trim()) {
    document.getElementById('audio-status-text').textContent = 'No answer text — add text to enable audio caching';
    document.getElementById('btn-gen-audio').style.display = 'none';
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE()}/${trigger.ruleId}`);
    const audio = res.audio;
    const dot   = document.getElementById('audio-dot');
    const txt   = document.getElementById('audio-status-text');
    const btn   = document.getElementById('btn-gen-audio');

    if (audio?.cached) {
      dot.className = 'audio-dot cached';
      txt.textContent = `✅ Cached — ${audio.url}`;
    } else {
      dot.className = 'audio-dot missing';
      txt.textContent = 'Not cached — click Regenerate to pre-build';
    }
    btn.style.display = 'inline-flex';
  } catch (err) {
    document.getElementById('audio-status-text').textContent = `Could not check audio: ${err.message}`;
  }
}

function resetAudioStatus() {
  document.getElementById('audio-dot').className          = 'audio-dot missing';
  document.getElementById('audio-status-text').textContent = 'Save the trigger first to generate audio';
  document.getElementById('btn-gen-audio').style.display  = 'none';
}

async function regenerateAudio() {
  if (!editingRuleId) return;
  const btn = document.getElementById('btn-gen-audio');
  btn.textContent = 'Generating…';
  btn.disabled    = true;

  try {
    const res = await apiFetch(`${API_BASE()}/${editingRuleId}/generate-audio`, {
      method: 'POST',
      body:   JSON.stringify({ force: true })
    });
    const dot = document.getElementById('audio-dot');
    const txt = document.getElementById('audio-status-text');

    if (res.data?.cached) {
      dot.className = 'audio-dot cached';
      txt.textContent = `✅ Cached — ${res.data.url}`;
    }
    toast('Audio generated', 'success');
  } catch (err) {
    toast(`Audio generation failed: ${err.message}`, 'error');
  } finally {
    btn.textContent = 'Regenerate';
    btn.disabled    = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE TRIGGER (create or update)
// ─────────────────────────────────────────────────────────────────────────────

async function saveTrigger() {
  const responseMode = getCurrentResponseMode();
  const behavior     = getSelectedBehavior();
  const firesOnSteps = getSelectedSteps();
  const isLlm        = responseMode === 'llm';

  const body = {
    ruleId:           document.getElementById('f-ruleId').value.trim(),
    label:            document.getElementById('f-label').value.trim(),
    description:      document.getElementById('f-description').value.trim(),
    priority:         parseInt(document.getElementById('f-priority').value, 10) || 50,
    maxInputWords:    parseInt(document.getElementById('f-maxInputWords').value, 10) || null,
    keywords:         tagState.keywords,
    phrases:          tagState.phrases,
    negativeKeywords: tagState.negKeywords,
    negativePhrases:  tagState.negPhrases,
    responseMode,
    answerText:       isLlm ? '[LLM-generated response]' : document.getElementById('f-answerText').value.trim(),
    llmFactPack:      isLlm ? {
      includedFacts: document.getElementById('f-includedFacts').value.trim(),
      excludedFacts: document.getElementById('f-excludedFacts').value.trim(),
      backupAnswer:  document.getElementById('f-backupAnswer').value.trim()
    } : undefined,
    followUpQuestion: document.getElementById('f-followUpQuestion').value.trim(),
    firesOnSteps:     firesOnSteps.length ? firesOnSteps : ['ANY'],
    behavior,
    redirectMode:     behavior === 'REDIRECT' ? document.getElementById('f-redirectMode').value.trim() : null,
    tags:             tagState.tags,
    enabled:          getEnabledValue()
  };

  // Client-side validation
  if (!body.ruleId)  { toast('Rule ID is required', 'error'); return; }
  if (!body.label)   { toast('Label is required', 'error'); return; }
  if (!isLlm && !body.answerText) { toast('Answer Text is required for standard mode', 'error'); return; }
  if (behavior === 'REDIRECT' && !body.redirectMode) { toast('Redirect Mode is required when behavior is REDIRECT', 'error'); return; }

  const saveBtn = document.getElementById('btn-modal-save');
  saveBtn.textContent = 'Saving…';
  saveBtn.disabled    = true;

  try {
    if (editingRuleId) {
      // Update
      await apiFetch(`${API_BASE()}/${editingRuleId}`, {
        method: 'PATCH',
        body:   JSON.stringify(body)
      });
      toast('Trigger updated', 'success');
    } else {
      // Create
      await apiFetch(API_BASE(), {
        method: 'POST',
        body:   JSON.stringify(body)
      });
      toast('Trigger created', 'success');
    }

    setModalOpen(false);
    await loadTriggers();

  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    saveBtn.textContent = 'Save Trigger';
    saveBtn.disabled    = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE TRIGGER
// ─────────────────────────────────────────────────────────────────────────────

function showDeleteConfirm() {
  document.getElementById('confirm-delete-bar').classList.add('show');
}
function hideDeleteConfirm() {
  document.getElementById('confirm-delete-bar').classList.remove('show');
}

async function deleteTrigger() {
  if (!editingRuleId) return;

  try {
    await apiFetch(`${API_BASE()}/${editingRuleId}`, { method: 'DELETE' });
    toast('Trigger deleted', 'success');
    setModalOpen(false);
    await loadTriggers();
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST MATCH PANEL
// ─────────────────────────────────────────────────────────────────────────────

async function runTestMatch() {
  const phrase = document.getElementById('test-phrase').value.trim();
  const step   = document.getElementById('test-step').value;

  if (!phrase) { toast('Enter a phrase to test', 'error'); return; }

  const btn = document.getElementById('btn-test-match');
  btn.textContent = 'Testing…';
  btn.disabled    = true;

  const resultEl = document.getElementById('test-result');
  const labelEl  = document.getElementById('test-result-label');
  const metaEl   = document.getElementById('test-result-meta');

  try {
    const res  = await apiFetch(`${API_BASE()}/test-match`, {
      method: 'POST',
      body:   JSON.stringify({ phrase, step })
    });
    const d = res.data;

    resultEl.className = `test-result ${d.matched ? 'matched' : 'no-match'}`;
    resultEl.style.display = 'block';

    if (d.matched) {
      labelEl.textContent = `✅ MATCHED → ${d.card?.ruleId}  [${d.behavior}]`;
      metaEl.innerHTML = [
        d.matchType  ? `Match type: <strong>${d.matchType}</strong>` : '',
        d.matchedOn  ? `Matched on: <strong>"${esc(d.matchedOn)}"</strong>` : '',
        d.card?.label ? `Label: ${esc(d.card.label)}` : '',
        d.card?.answerText ? `Response: "${esc(d.card.answerText.substring(0, 100))}${d.card.answerText.length > 100 ? '…' : ''}"` : ''
      ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    } else {
      labelEl.textContent = `No match — ${d.poolInfo.evaluated} triggers evaluated (pool: ${d.poolInfo.stepPoolSize} for step ${step})`;
      metaEl.textContent = `Total triggers loaded: ${d.poolInfo.totalLoaded}`;
    }
  } catch (err) {
    resultEl.className = 'test-result no-match';
    resultEl.style.display = 'block';
    labelEl.textContent = `Error: ${err.message}`;
    metaEl.textContent  = '';
  } finally {
    btn.textContent = 'Run Test';
    btn.disabled    = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = `toast ${type}`; }, 3500);
}

function showError(msg) {
  document.getElementById('trigger-list-container').innerHTML =
    `<div class="loading-overlay" style="color:#dc2626">${esc(msg)}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BIND ALL UI EVENTS
// ─────────────────────────────────────────────────────────────────────────────

function bindUI() {
  // New trigger button
  document.getElementById('btn-new-trigger').addEventListener('click', openNewModal);

  // Modal close
  document.getElementById('modal-close').addEventListener('click', () => setModalOpen(false));
  document.getElementById('btn-modal-cancel').addEventListener('click', () => setModalOpen(false));
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) setModalOpen(false);
  });

  // Modal save
  document.getElementById('btn-modal-save').addEventListener('click', saveTrigger);

  // Delete + confirm
  document.getElementById('btn-delete-trigger').addEventListener('click', showDeleteConfirm);
  document.getElementById('btn-confirm-delete').addEventListener('click', deleteTrigger);
  document.getElementById('btn-cancel-delete').addEventListener('click', hideDeleteConfirm);

  // Steps checkboxes — custom click handling
  document.querySelectorAll('#steps-grid .step-checkbox').forEach(el => {
    el.addEventListener('click', () => {
      const chk = el.querySelector('input');
      chk.checked = !chk.checked;
      el.classList.toggle('checked', chk.checked);
    });
  });

  // Behavior radios
  document.querySelectorAll('#behavior-radios .behavior-radio').forEach(el => {
    el.addEventListener('click', () => {
      setBehaviorRadio(el.dataset.behavior);
    });
  });

  // Response mode tabs
  document.getElementById('tab-standard').addEventListener('click', () => setResponseMode('standard'));
  document.getElementById('tab-llm').addEventListener('click', () => setResponseMode('llm'));

  // Enabled toggle
  document.getElementById('enabled-toggle').addEventListener('click', () => {
    setEnabledToggle(!getEnabledValue());
  });

  // Audio regenerate button
  document.getElementById('btn-gen-audio').addEventListener('click', regenerateAudio);

  // Test match panel
  document.getElementById('btn-test-match').addEventListener('click', runTestMatch);
  document.getElementById('test-phrase').addEventListener('keydown', e => {
    if (e.key === 'Enter') runTestMatch();
  });

  // Tag inputs
  bindTagInputs();
}
