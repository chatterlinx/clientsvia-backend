/**
 * ============================================================================
 * LAP — Listener Act Parser Admin Page
 * ============================================================================
 *
 * Manages global LAP entries (phrase + action + responses) and per-company
 * audio generation. Phrases and responses are shared across all companies;
 * audio is generated per-company using their ElevenLabs voice settings.
 *
 * ============================================================================
 */
(function() {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let S = {
    companyId:     new URLSearchParams(window.location.search).get('companyId'),
    entries:       [],        // global LAP entries from API
    lapEnabled:    true,      // company toggle
    cooldownMs:    3000,      // company cooldown
    dirty:         false,     // unsaved changes flag
    audioCoverage: {},        // "response text" -> bool for current company
  };

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    if (!S.companyId) {
      document.body.innerHTML = '<h2 style="padding:40px;color:red;">Missing companyId</h2>';
      return;
    }

    // Set header company name/id
    document.getElementById('header-company-id').textContent = S.companyId.slice(-6);
    document.getElementById('header-company-id').title = S.companyId;

    // Load company name
    try {
      const co = await AgentConsoleAuth.apiFetch(`/api/company/${S.companyId}/profile`);
      if (co?.name) document.getElementById('header-company-name').textContent = co.name;
    } catch (_) {}

    // Back button
    document.getElementById('btn-back-to-profile')?.addEventListener('click', () => {
      window.location.href = `/agent-console/index.html?companyId=${S.companyId}`;
    });
    document.getElementById('header-logo-link')?.setAttribute('href', `/agent-console/index.html?companyId=${S.companyId}`);

    await Promise.all([loadEntries(), loadCompanyConfig(), loadAudioCoverage()]);
    render();
    wireEvents();
  }

  // ── API Functions ──────────────────────────────────────────────────────────

  async function loadEntries() {
    const data = await AgentConsoleAuth.apiFetch('/api/admin/globalshare/lap-groups');
    S.entries = (data?.entries || []).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }

  async function loadCompanyConfig() {
    try {
      const data = await AgentConsoleAuth.apiFetch(`/api/company/${S.companyId}/lap-config`);
      S.lapEnabled = data?.enabled ?? true;
      S.cooldownMs = data?.cooldownMs ?? 3000;
    } catch (_) {}
  }

  async function loadAudioCoverage() {
    try {
      const data = await AgentConsoleAuth.apiFetch(`/api/admin/globalshare/lap-groups/audio-status?companyId=${S.companyId}`);
      S.audioCoverage = data?.coverage || {};
    } catch (_) {
      S.audioCoverage = {};
    }
  }

  async function saveEntries() {
    await AgentConsoleAuth.apiFetch('/api/admin/globalshare/lap-groups/bulk', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ entries: S.entries }),
    });
  }

  async function saveCompanyConfig() {
    await AgentConsoleAuth.apiFetch(`/api/company/${S.companyId}/lap-config`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ enabled: S.lapEnabled, cooldownMs: S.cooldownMs }),
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function render() {
    const tbody = document.getElementById('lap-tbody');
    tbody.innerHTML = '';

    S.entries.forEach((entry, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.entryId = entry.id;

      // # column
      const tdNum = document.createElement('td');
      tdNum.textContent = idx + 1;
      tdNum.style.color = '#94a3b8';
      tdNum.style.fontWeight = '600';

      // Phrase column
      const tdPhrase = document.createElement('td');
      const phraseInput = document.createElement('input');
      phraseInput.type = 'text';
      phraseInput.className = 'lap-phrase-input';
      phraseInput.value = entry.phrase || '';
      phraseInput.placeholder = 'e.g., hold on';
      phraseInput.addEventListener('input', () => {
        entry.phrase = phraseInput.value;
        S.dirty = true;
        updateSaveBtn();
      });
      tdPhrase.appendChild(phraseInput);

      // Action column
      const tdAction = document.createElement('td');
      const actionSelect = document.createElement('select');
      actionSelect.className = 'lap-action-select';
      ['respond', 'hold', 'repeat_last'].forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a === 'repeat_last' ? 'repeat last' : a;
        if (entry.action === a) opt.selected = true;
        actionSelect.appendChild(opt);
      });
      actionSelect.addEventListener('change', () => {
        entry.action = actionSelect.value;
        S.dirty = true;
        render(); // re-render to show/hide hold config
      });
      tdAction.appendChild(actionSelect);

      // Responses column
      const tdResponses = document.createElement('td');
      const responseGroup = document.createElement('div');
      responseGroup.className = 'lap-response-group';

      const responses = entry.responses || [];
      responses.forEach((resp, rIdx) => {
        const row = document.createElement('div');
        row.className = 'lap-response-row';
        const respInput = document.createElement('input');
        respInput.type = 'text';
        respInput.className = 'lap-response-input';
        respInput.value = resp;
        respInput.placeholder = `Response ${rIdx + 1}`;
        respInput.addEventListener('input', () => {
          entry.responses[rIdx] = respInput.value;
          S.dirty = true;
          updateSaveBtn();
        });
        row.appendChild(respInput);

        if (responses.length > 1) {
          const delBtn = document.createElement('button');
          delBtn.className = 'lap-resp-del';
          delBtn.innerHTML = '&times;';
          delBtn.title = 'Remove response';
          delBtn.addEventListener('click', () => {
            entry.responses.splice(rIdx, 1);
            S.dirty = true;
            render();
          });
          row.appendChild(delBtn);
        }
        responseGroup.appendChild(row);
      });

      if (responses.length < 3) {
        const addBtn = document.createElement('button');
        addBtn.className = 'lap-add-response';
        addBtn.textContent = '+ Add response';
        addBtn.addEventListener('click', () => {
          entry.responses = entry.responses || [];
          entry.responses.push('');
          S.dirty = true;
          render();
        });
        responseGroup.appendChild(addBtn);
      }
      tdResponses.appendChild(responseGroup);

      // Audio column
      const tdAudio = document.createElement('td');
      tdAudio.style.textAlign = 'center';
      const totalResp = responses.filter(r => r.trim()).length;
      let cachedCount = 0;
      responses.forEach(r => {
        if (r.trim() && S.audioCoverage[r.trim()]) cachedCount++;
      });
      if (totalResp === 0) {
        tdAudio.innerHTML = '<span style="color:#94a3b8;">—</span>';
      } else if (cachedCount === totalResp) {
        tdAudio.innerHTML = '<span style="color:#16a34a;" title="All responses have audio">&#10003;</span>';
      } else {
        tdAudio.innerHTML = '<span style="color:#f59e0b;" title="' + cachedCount + '/' + totalResp + ' cached">&#9888;</span>';
      }

      // Enabled column
      const tdEnabled = document.createElement('td');
      tdEnabled.style.textAlign = 'center';
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'lap-toggle';
      const toggleCheck = document.createElement('input');
      toggleCheck.type = 'checkbox';
      toggleCheck.checked = entry.enabled !== false;
      toggleCheck.addEventListener('change', () => {
        entry.enabled = toggleCheck.checked;
        S.dirty = true;
        updateSaveBtn();
      });
      const toggleSlider = document.createElement('span');
      toggleSlider.className = 'lap-toggle-slider';
      toggleLabel.appendChild(toggleCheck);
      toggleLabel.appendChild(toggleSlider);
      tdEnabled.appendChild(toggleLabel);

      // Delete column
      const tdDel = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'lap-delete-btn';
      delBtn.innerHTML = '&#128465;';
      delBtn.title = 'Delete entry';
      delBtn.addEventListener('click', () => {
        if (confirm('Delete phrase "' + entry.phrase + '"?')) {
          S.entries.splice(idx, 1);
          S.dirty = true;
          render();
        }
      });
      tdDel.appendChild(delBtn);

      tr.appendChild(tdNum);
      tr.appendChild(tdPhrase);
      tr.appendChild(tdAction);
      tr.appendChild(tdResponses);
      tr.appendChild(tdAudio);
      tr.appendChild(tdEnabled);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);

      // Hold config panel (shown only when action === 'hold')
      if (entry.action === 'hold') {
        const holdTr = document.createElement('tr');
        holdTr.className = 'hold-config-row';
        const holdTd = document.createElement('td');
        holdTd.colSpan = 7;
        holdTd.innerHTML = [
          '<div class="hold-config-panel">',
          '  <div class="hold-config-grid">',
          '    <label>Max hold (sec)<input type="number" class="hold-input" value="' + ((entry.holdConfig?.maxHoldSeconds) || 60) + '" data-field="maxHoldSeconds"></label>',
          '    <label>Dead air check (sec)<input type="number" class="hold-input" value="' + ((entry.holdConfig?.deadAirCheckSeconds) || 15) + '" data-field="deadAirCheckSeconds"></label>',
          '    <label>Dead air prompt<input type="text" class="hold-input hold-input-wide" value="' + escAttr((entry.holdConfig?.deadAirPrompt) || 'Are you still there?') + '" data-field="deadAirPrompt"></label>',
          '    <label>Resume keywords<input type="text" class="hold-input hold-input-wide" value="' + escAttr(((entry.holdConfig?.resumeKeywords) || ['ok','back','ready']).join(', ')) + '" data-field="resumeKeywords"></label>',
          '  </div>',
          '</div>',
        ].join('\n');

        // Wire hold config inputs
        holdTd.querySelectorAll('.hold-input').forEach(inp => {
          inp.addEventListener('input', () => {
            if (!entry.holdConfig) entry.holdConfig = {};
            const field = inp.dataset.field;
            if (field === 'resumeKeywords') {
              entry.holdConfig[field] = inp.value.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
            } else if (field === 'maxHoldSeconds' || field === 'deadAirCheckSeconds') {
              entry.holdConfig[field] = parseInt(inp.value) || 0;
            } else {
              entry.holdConfig[field] = inp.value;
            }
            S.dirty = true;
            updateSaveBtn();
          });
        });
        holdTr.appendChild(holdTd);
        tbody.appendChild(holdTr);
      }
    });

    // Update company toggle state
    const toggleEl = document.getElementById('toggle-lap-enabled');
    if (toggleEl) toggleEl.checked = S.lapEnabled;
    const cooldownEl = document.getElementById('input-cooldown');
    if (cooldownEl) cooldownEl.value = S.cooldownMs;

    updateSaveBtn();
  }

  // ── Save Button State ──────────────────────────────────────────────────────

  function updateSaveBtn() {
    const saveBtn = document.getElementById('btn-save');
    if (!saveBtn) return;
    saveBtn.disabled = !S.dirty;
    saveBtn.textContent = S.dirty ? 'Save Changes' : 'Saved';
  }

  // ── Wire Events ────────────────────────────────────────────────────────────

  function wireEvents() {
    // Add entry
    document.getElementById('btn-add-entry')?.addEventListener('click', () => {
      S.entries.push({
        id:        crypto.randomUUID(),
        phrase:    '',
        action:    'respond',
        responses: [''],
        holdConfig: null,
        enabled:   true,
        sortOrder: S.entries.length,
      });
      S.dirty = true;
      render();
      // Focus the new phrase input
      const inputs = document.querySelectorAll('.lap-phrase-input');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    // Save
    document.getElementById('btn-save')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-save');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        // Clean empty phrases
        S.entries = S.entries.filter(e => e.phrase?.trim());
        S.entries.forEach((e, i) => { e.sortOrder = i; });

        await Promise.all([saveEntries(), saveCompanyConfig()]);
        S.dirty = false;
        showToast('success', 'Saved', S.entries.length + ' entries saved successfully.');
        render();
      } catch (err) {
        showToast('error', 'Save Failed', err.message);
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      }
    });

    // Company toggle
    document.getElementById('toggle-lap-enabled')?.addEventListener('change', (e) => {
      S.lapEnabled = e.target.checked;
      S.dirty = true;
      render();
    });

    document.getElementById('input-cooldown')?.addEventListener('input', (e) => {
      S.cooldownMs = parseInt(e.target.value) || 3000;
      S.dirty = true;
      updateSaveBtn();
    });

    // Generate Audio
    document.getElementById('btn-generate-audio')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-generate-audio');
      btn.disabled = true;
      btn.textContent = 'Generating...';
      try {
        // Collect all non-empty response texts
        const allResponses = [];
        S.entries.forEach(e => {
          (e.responses || []).forEach(r => {
            if (r.trim()) allResponses.push(r.trim());
          });
        });

        if (allResponses.length === 0) {
          showToast('warning', 'No Responses', 'Add response texts before generating audio.');
          return;
        }

        const result = await AgentConsoleAuth.apiFetch('/api/admin/globalshare/lap-groups/audio-generate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ companyId: S.companyId, texts: allResponses }),
        });

        showToast('success', 'Audio Generated', (result?.generated || 0) + ' audio files created, ' + (result?.skipped || 0) + ' already cached.');
        await loadAudioCoverage();
        render();
      } catch (err) {
        showToast('error', 'Audio Failed', err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Audio';
      }
    });
  }

  // ── Toast Helper ───────────────────────────────────────────────────────────

  function showToast(type, title, message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = '<strong>' + escHtml(title) + '</strong><span>' + escHtml(message) + '</span>';
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ── Escape Helpers ─────────────────────────────────────────────────────────

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function escAttr(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
